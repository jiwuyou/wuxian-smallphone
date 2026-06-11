const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { createId } = require("../shared/types");

function createRuntimeAdapter(config = {}) {
  const mode = normalizeText(config.mode) || "mock";
  if (mode === "cc-connect" || mode === "ccconnect") {
    return createCcConnectAdapter(config);
  }
  if (mode === "cc-webclient" || mode === "cc_webclient" || mode === "ccwebclient") {
    return createCcWebclientAdapter(config);
  }
  if (mode === "openai-compatible") {
    return createOpenAICompatibleAdapter(config);
  }
  if (mode === "openclaw-cli") {
    return createOpenClawCliAdapter(config);
  }
  if (mode === "openclaw-http") {
    return createOpenClawHttpAdapter(config);
  }
  return createMockAdapter(config);
}

function createCcConnectAdapter(config) {
  const wsUrl = normalizeText(config.ccConnectWsUrl) || "ws://127.0.0.1:21010/bridge/ws";
  const token = normalizeText(config.ccConnectToken);
  const project = normalizeText(config.ccConnectProject) || "smallphone";
  const platform = normalizeText(config.ccConnectPlatform) || "smallphone";
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 300000;
  const client = new CcConnectBridgeClient({ wsUrl, token, project, platform, timeoutMs });

  return {
    describe() {
      return {
        id: "cc-connect",
        kind: "runtime",
        wsUrl: redactUrlToken(wsUrl),
        project,
        platform,
        timeoutMs,
      };
    },
    async sendTurn(payload) {
      const reply = await client.sendTurn({
        sessionKey: payload.thread?.runtime?.sessionKey || `smallphone:thread:${payload.thread?.id || createId("thread")}`,
        userId: payload.contact?.id || "smallphone-user",
        userName: payload.contact?.displayName || "SmallPhone",
        content: buildRuntimePrompt(payload),
      });
      return {
        runtimeSessionId: reply.replyCtx || payload.runtimeSessionId || createId("ccrun"),
        runtimeSessionKey: payload.thread?.runtime?.sessionKey || "",
        assistantText: normalizeText(reply.content) || "cc-connect returned no text.",
        toolCalls: [],
      };
    },
  };
}

function createCcWebclientAdapter(config) {
  const baseUrl = normalizeText(config.webclientBaseUrl) || normalizeText(config.baseUrl);
  const token = normalizeText(config.webclientToken) || normalizeText(config.token);
  const appId = normalizeText(config.webclientAppId) || normalizeText(config.appId);
  const project = normalizeText(config.ccConnectProject) || normalizeText(config.project);
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 300000;
  const pollIntervalMs = Number.isFinite(Number(config.pollIntervalMs)) ? Number(config.pollIntervalMs) : 750;
  const historyLimit = Number.isFinite(Number(config.historyLimit)) ? Number(config.historyLimit) : 80;
  const fetchImpl = typeof config.fetch === "function" ? config.fetch : fetch;

  return {
    describe() {
      return {
        id: "cc-webclient",
        kind: "runtime",
        baseUrl: baseUrl ? redactUrlToken(baseUrl) : "(unset)",
        appId: appId || "(unset)",
        project: project || "(unset)",
        timeoutMs,
        pollIntervalMs,
      };
    },
    async fetchAttachment(params) {
      if (!baseUrl || !token || !appId) {
        throw new Error("cc-webclient runtime requires webclientBaseUrl, webclientToken, and webclientAppId.");
      }
      const rawUrl = normalizeText(params?.url);
      if (!rawUrl) {
        throw new Error("cc-webclient fetchAttachment requires url.");
      }
      const resolved = resolveWebclientAttachmentUrl({
        baseUrl,
        appId,
        url: rawUrl,
      });
      if (!resolved.ok) {
        throw new Error(resolved.error);
      }

      let response;
      try {
        response = await fetchWithTimeout(
          resolved.url,
          {
            method: "GET",
            headers: {
              authorization: `Bearer ${token}`,
            },
          },
          timeoutMs,
          fetchImpl,
        );
      } catch (error) {
        const message = String(error?.message || error || "").trim();
        throw new Error(redactMessageToken(message));
      }

      const headers = collectHeaders(response?.headers);
      let body;
      try {
        const ab = await response.arrayBuffer();
        body = Buffer.from(ab);
      } catch (error) {
        throw new Error(
          `cc-webclient fetchAttachment failed to read body for ${redactUrlToken(resolved.url)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const contentType = normalizeText(response?.headers?.get?.("content-type")) || normalizeText(params?.attachment?.mimeType);
      const disposition = normalizeText(response?.headers?.get?.("content-disposition"));
      const inferredName = parseFileNameFromContentDisposition(disposition);
      const fileName = inferredName || normalizeText(params?.attachment?.fileName);

      return {
        statusCode: Number.isFinite(Number(response?.status)) ? Number(response.status) : 200,
        headers,
        body,
        fileName,
        mimeType: contentType,
      };
    },
    async sendTurn(payload) {
      const turnProject = normalizeText(payload?.thread?.runtime?.project) || project;
      if (!baseUrl || !token || !appId || !turnProject) {
        throw new Error(
          "cc-webclient runtime requires webclientBaseUrl, webclientToken, webclientAppId, and ccConnectProject.",
        );
      }

      const preferredSessionId = derivePreferredWebclientSessionId(payload);
      const sessionKey = deriveWebclientSessionKey(payload, turnProject);
      const sessionName = deriveWebclientSessionName(payload);
      const ensuredSession = await ensureWebclientSession({
        baseUrl,
        token,
        appId,
        project: turnProject,
        sessionKey,
        sessionId: preferredSessionId,
        name: sessionName,
        timeoutMs,
        fetchImpl,
      });
      const sessionId = ensuredSession.sessionId;

      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      const imageAttachments = attachments.filter((att) => normalizeAttachmentKind(att) === "image");
      const fileAttachments = attachments.filter((att) => normalizeAttachmentKind(att) === "file");

      const webclientImages = await buildWebclientImages(imageAttachments);
      const message =
        payload?.runtimePassThrough === true && attachments.length === 0
          ? getPassThroughMessageText(payload)
          : buildWebclientTurnMessage(payload, fileAttachments);

      const sendUrl = buildWebclientUrl(baseUrl, appId, `/api/v1/projects/${encodeURIComponent(turnProject)}/send`);
      const sendResponse = await fetchWithTimeout(
        sendUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            session_key: sessionKey,
            session_id: sessionId,
            message,
            ...(webclientImages.length ? { images: webclientImages } : {}),
          }),
        },
        timeoutMs,
        fetchImpl,
      );

      if (!sendResponse.ok) {
        const text = await sendResponse.text();
        throw new Error(`cc-webclient send failed with status ${sendResponse.status}: ${text.slice(0, 400)}`);
      }

      const sendJson = await safeJson(sendResponse);
      const sendData = unwrapV1Data(sendJson);
      const outboxId = normalizeText(sendData?.outbox_id) || normalizeText(sendData?.outboxId);
      const resolvedSessionId = safePathSegment(normalizeText(sendData?.session_id) || sessionId) || sessionId;

      const assistant = await pollWebclientAssistantReply({
        baseUrl,
        token,
        appId,
        project: turnProject,
        sessionId: resolvedSessionId,
        outboxId,
        timeoutMs,
        pollIntervalMs,
        historyLimit,
        onEvent: payload?.onEvent,
        fetchImpl,
      });

      return {
        runtimeSessionId: resolvedSessionId || payload.runtimeSessionId || createId("runtime"),
        runtimeSessionKey: sessionKey,
        assistantText: assistant.assistantText || "cc-webclient returned no text.",
        toolCalls: [],
        ...(assistant.assistantAttachments?.length ? { assistantAttachments: assistant.assistantAttachments } : {}),
      };
    },
  };
}

class CcConnectBridgeClient {
  constructor(options) {
    this.wsUrl = options.wsUrl;
    this.token = options.token;
    this.project = options.project;
    this.platform = options.platform;
    this.timeoutMs = options.timeoutMs;
    this.ws = null;
    this.connecting = null;
    this.pending = new Map();
    this.pingTimer = null;
  }

  async sendTurn(turn) {
    const ws = await this.connect();
    const replyCtx = `smallphone-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const msgId = createId("ccmsg");
    const pending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.pending.get(replyCtx);
        if (current?.chunks?.length) {
          current.settleReply({ type: "timeout_with_partial_reply" });
          return;
        }
        current?.reject(new Error(`cc-connect bridge timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      const chunks = [];
      const finish = (message) => {
        this.pending.delete(replyCtx);
        clearTimeout(timer);
        resolve(message);
      };
      const pendingEntry = {
        chunks,
        addReply: (message) => {
          const text = extractBridgeText(message);
          if (text && !chunks.includes(text)) {
            chunks.push(text);
          }
          turn.onEvent?.({
            type: "reply",
            replyCtx,
            text,
            content: chunks.join("\n\n").trim(),
            chunks: [...chunks],
            done: false,
            raw: message,
          });
        },
        settleReply: (message = {}) => {
          const finalText = extractBridgeText(message);
          if (finalText && !chunks.includes(finalText)) {
            chunks.push(finalText);
          }
          const content = chunks.join("\n\n").trim();
          turn.onEvent?.({
            type: "reply",
            replyCtx,
            text: finalText,
            content,
            chunks: [...chunks],
            done: true,
            raw: message,
          });
          finish({
            replyCtx,
            content,
            raw: { type: "reply_batch", terminal: message, chunks },
          });
        },
        reject: (error) => {
          this.pending.delete(replyCtx);
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending.set(replyCtx, pendingEntry);
    });

    ws.send(
      JSON.stringify({
        type: "message",
        msg_id: msgId,
        session_key: turn.sessionKey,
        user_id: turn.userId,
        user_name: turn.userName,
        content: turn.content,
        reply_ctx: replyCtx,
        project: this.project,
      }),
    );
    return pending;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = new Promise((resolve, reject) => {
      const url = appendBridgeToken(this.wsUrl, this.token);
      const ws = new WebSocket(url);
      let settled = false;

      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const cleanupPending = (error) => {
        for (const [, pending] of this.pending) {
          pending.reject(error);
        }
        this.pending.clear();
      };

      ws.once("open", () => {
        ws.send(
          JSON.stringify({
            type: "register",
            platform: this.platform,
            project: this.project,
            capabilities: ["text"],
            metadata: {
              adapter: "smallphone",
              progress_style: "legacy",
            },
          }),
        );
      });

      ws.on("message", (data) => {
        let message;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (message.type === "register_ack") {
          if (!message.ok) {
            fail(new Error(message.error || "cc-connect bridge registration failed"));
            return;
          }
          if (!settled) {
            settled = true;
            this.ws = ws;
            this.startPing();
            resolve(ws);
          }
          return;
        }
        const replyContext = getBridgeReplyContext(message);
        if (isBridgeReplyMessage(message)) {
          const pending = this.pending.get(replyContext);
          if (pending) {
            pending.addReply(message);
            if (isBridgeCompletionMessage(message)) {
              pending.settleReply(message);
            }
          }
          return;
        }
        if (isBridgeCompletionMessage(message)) {
          const pending = this.pending.get(replyContext);
          if (pending) {
            pending.settleReply(message);
          }
          return;
        }
        if (message.type === "preview_start") {
          ws.send(
            JSON.stringify({
              type: "preview_ack",
              ref_id: message.ref_id,
              preview_handle: message.reply_ctx || message.ref_id,
            }),
          );
        }
      });

      ws.once("error", (error) => {
        fail(error);
        cleanupPending(error);
      });
      ws.once("close", () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        this.stopPing();
        cleanupPending(new Error("cc-connect bridge disconnected"));
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopPing();
        return;
      }
      this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    }, 30000);
    this.pingTimer.unref?.();
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

function createMockAdapter() {
  return {
    describe() {
      return { id: "mock", kind: "runtime" };
    },
    async sendTurn(payload) {
      const latestUserText = getLatestRuntimeUserText(payload);
      const triggerNote = normalizeText(payload.trigger?.note);
      const primaryText = payload.trigger?.mode === "decision_only" ? triggerNote || latestUserText : latestUserText || triggerNote;
      const hints = [];
      if (payload.memories.length) {
        hints.push(`我记得 ${payload.memories[0].text}`);
      }
      if (payload.relationship) {
        hints.push(`当前关系信任值 ${payload.relationship.trust.toFixed(2)}`);
      }
      return {
        runtimeSessionId: payload.runtimeSessionId || createId("runtime"),
        runtimeSessionKey: payload.thread?.runtime?.sessionKey || "",
        assistantText: [`P0 runtime received: ${primaryText || "empty input"}.`, ...hints].join(" "),
        toolCalls: [],
        decision: {
          action: payload.trigger?.mode === "decision_only" ? "send" : "send",
          reason: "mock runtime defaults to send",
        },
      };
    },
  };
}

function createOpenClawCliAdapter(config) {
  const command = normalizeText(config.command) || process.execPath;
  const entry = resolveOpenClawEntry(config.entry);
  const argsPrefix = entry ? [entry] : [];
  const agentId = normalizeText(config.agentId) || "main";
  const model = normalizeText(config.model);
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 300000;
  const openaiApiKey = normalizeText(config.openaiApiKey) || readCodexOpenAiApiKey();
  return {
    describe() {
      return {
        id: "openclaw-cli",
        kind: "runtime",
        command,
        entry: entry || "(global openclaw expected on PATH)",
        agentId,
        model: model || "(default)",
        timeoutMs,
      };
    },
    async sendTurn(payload) {
      if (!entry && command === process.execPath) {
        throw new Error("OpenClaw CLI adapter could not find a local entry file. Set SMALLPHONE_OPENCLAW_ENTRY or SMALLPHONE_OPENCLAW_COMMAND.");
      }
      const prompt = buildRuntimePrompt(payload);
      const args = [...argsPrefix, "agent", "--agent", agentId, "--message", prompt, "--local", "--json"];
      if (model) {
        args.push("--model", model);
      }
      const output = await runProcess(
        command,
        args,
        {
          ...(openaiApiKey ? { OPENAI_API_KEY: openaiApiKey } : {}),
          SMALLPHONE_CONTEXT_JSON: JSON.stringify({
            threadId: payload.thread.id,
            contactId: payload.contact.id,
            runtimeSessionId: payload.runtimeSessionId || "",
          }),
        },
        timeoutMs,
      );
      const parsed = parseOpenClawJson(output);
      const payloads = Array.isArray(parsed?.payloads)
        ? parsed.payloads
        : Array.isArray(parsed?.result?.payloads)
          ? parsed.result.payloads
          : [];
      const assistantText = payloads
        .map((item) => normalizeText(item?.text))
        .filter(Boolean)
        .join("\n\n");
      const sessionId =
        normalizeText(parsed?.meta?.agentMeta?.sessionId) ||
        normalizeText(parsed?.result?.meta?.agentMeta?.sessionId) ||
        payload.runtimeSessionId ||
        createId("runtime");
      return {
        runtimeSessionId: sessionId,
        runtimeSessionKey: payload.thread?.runtime?.sessionKey || "",
        assistantText: assistantText || "OpenClaw returned no text payload.",
        toolCalls: [],
      };
    },
  };
}

function createOpenClawHttpAdapter(config) {
  const baseUrl = normalizeText(config.baseUrl);
  const token = normalizeText(config.token);
  const model = normalizeText(config.model) || "newxy/gpt-5.4";
  const agentId = normalizeText(config.agentId) || "main";
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 300000;
  return {
    describe() {
      return {
        id: "openclaw-http",
        kind: "runtime",
        baseUrl: baseUrl || "(unset)",
        model,
        agentId,
        timeoutMs,
      };
    },
    async sendTurn(payload) {
      if (!baseUrl) {
        throw new Error("SMALLPHONE_OPENCLAW_HTTP_URL is required for openclaw-http mode.");
      }
      const routing = payload.thread?.runtime || {};
      const outboundPayload = stripRuntimeRosterFields(payload);
      const response = await fetchWithTimeout(
        `${baseUrl.replace(/\/+$/, "")}/smallphone/turn`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ...outboundPayload,
            runtimeRouting: {
              agentId: normalizeText(routing.agentId),
              workspaceDir: normalizeText(routing.workspaceDir),
              sessionKey: normalizeText(routing.sessionKey),
              resumeSummary: normalizeText(routing.resumeSummary),
            },
          }),
        },
        timeoutMs,
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenClaw HTTP adapter failed with status ${response.status}: ${text.slice(0, 400)}`);
      }
      const json = await response.json();
      return {
        runtimeSessionId:
          normalizeText(json?.runtimeSessionId) ||
          payload.runtimeSessionId ||
          createId("runtime"),
        runtimeSessionKey:
          normalizeText(json?.runtimeSessionKey) ||
          payload.thread?.runtime?.sessionKey ||
          "",
        assistantText: normalizeText(json?.assistantText) || "OpenClaw gateway returned no text.",
        toolCalls: Array.isArray(json?.toolCalls) ? json.toolCalls : [],
        decision: json?.decision || null,
      };
    },
  };
}

function stripRuntimeRosterFields(payload) {
  // Guardrail: runtime adapters should not forward whole rosters/state blobs
  // (e.g. all contacts/personas). They should stick to per-turn fields supplied
  // by domain (payload.character/contact/turnContext, etc).
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const out = { ...payload };
  for (const key of ["contacts", "characters", "personas"]) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      delete out[key];
    }
  }
  return out;
}

function createOpenAICompatibleAdapter(config) {
  const inferred = readCodexProviderConfig();
  const baseUrl = normalizeText(config.openaiBaseUrl) || inferred.baseUrl;
  const apiKey =
    normalizeText(config.openaiApiKey) ||
    normalizeText(config.openaiApiKey) ||
    inferred.apiKey ||
    readCodexOpenAiApiKey();
  const model =
    normalizeText(config.openaiModel) ||
    normalizeText(config.model) ||
    inferred.model ||
    "gpt-5.4";
  const reasoningEffort =
    normalizeText(config.openaiReasoningEffort) || inferred.reasoningEffort || "";
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 300000;
  return {
    describe() {
      return {
        id: "openai-compatible",
        kind: "runtime",
        baseUrl: baseUrl || "(unset)",
        model,
        timeoutMs,
      };
    },
    async sendTurn(payload) {
      if (!baseUrl || !apiKey) {
        throw new Error("OpenAI-compatible runtime requires baseUrl and apiKey.");
      }
      const response = await fetchWithTimeout(
        `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: buildOpenAICompatibleMessages(payload),
            temperature: 0.7,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          }),
        },
        timeoutMs,
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI-compatible runtime failed with status ${response.status}: ${text.slice(0, 400)}`);
      }
      const json = await response.json();
      const assistantText =
        normalizeText(json?.choices?.[0]?.message?.content) ||
        normalizeText(json?.choices?.[0]?.text) ||
        "";
      return {
        runtimeSessionId:
          normalizeText(json?.id) ||
          payload.runtimeSessionId ||
          createId("runtime"),
        runtimeSessionKey: payload.thread?.runtime?.sessionKey || "",
        assistantText: assistantText || "OpenAI-compatible runtime returned no text.",
        toolCalls: [],
      };
    },
  };
}

function buildRuntimePrompt(payload) {
  const userPersona = normalizeText(
    payload?.thread?.workflowInput?.userPersona ||
      payload?.thread?.workflowInputs?.userPersona ||
      payload?.contact?.workflowInput?.userPersona ||
      payload?.character?.workflowInput?.userPersona,
  );
  const memoryBlock = payload.memories.map((item) => `- ${item.text}`).join("\n");
  const recent = buildRecentConversationBlock(payload);
  const turnContextBlock = buildTurnContextBlock(payload.turnContext);
  const timeContextBlock = buildTimeContextBlock(payload.timeContext);
  return [
    "SmallPhone turn",
    `Character: ${payload.character.name}`,
    `Persona: ${payload.character.persona}`,
    userPersona ? `User persona: ${userPersona}` : "",
    `Contact: ${payload.contact.displayName}`,
    `Thread: ${payload.thread.title}`,
    `Relationship: trust=${payload.relationship.trust.toFixed(2)}, intimacy=${payload.relationship.intimacy.toFixed(2)}, tension=${payload.relationship.tension.toFixed(2)}`,
    timeContextBlock,
    turnContextBlock,
    memoryBlock ? `Relevant memories:\n${memoryBlock}` : "",
    "Recent conversation:",
    recent,
    "Reply as the contact inside a small-phone chat. Be concise and concrete.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildOpenAICompatibleMessages(payload) {
  const timeContextBlock = buildTimeContextBlock(payload.timeContext);
  const userPersona = normalizeText(
    payload?.thread?.workflowInput?.userPersona ||
      payload?.thread?.workflowInputs?.userPersona ||
      payload?.contact?.workflowInput?.userPersona ||
      payload?.character?.workflowInput?.userPersona,
  );
  return [
    {
      role: "system",
      content:
        [
          `You are ${payload.contact.displayName} in a small-phone chat.`,
          `Character persona: ${payload.character.persona}`,
          userPersona ? `User persona: ${userPersona}` : "",
          `Reply briefly, concretely, and in-character.`,
          timeContextBlock,
          buildTurnContextBlock(payload.turnContext),
          payload.memories.length
            ? `Relevant memories:\n${payload.memories.map((item) => `- ${item.text}`).join("\n")}`
            : "",
          `Relationship state: trust=${payload.relationship.trust.toFixed(2)}, intimacy=${payload.relationship.intimacy.toFixed(2)}, tension=${payload.relationship.tension.toFixed(2)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
    },
    ...buildOpenAICompatibleHistoryMessages(payload),
  ];
}

function buildRecentConversationBlock(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages.slice(-8) : [];
  if (!messages.length) {
    return "";
  }
  const latestUserIndex = latestUserMessageIndex(messages);
  return messages
    .map((item, index) => `${item.role}: ${index === latestUserIndex ? getLatestRuntimeUserText(payload) : item.content}`)
    .join("\n");
}

function buildOpenAICompatibleHistoryMessages(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages.slice(-8) : [];
  const latestUserIndex = latestUserMessageIndex(messages);
  return messages.map((item, index) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: index === latestUserIndex ? getLatestRuntimeUserText(payload) : item.content,
  }));
}

function latestUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function buildTimeContextBlock(timeContext) {
  return normalizeText(timeContext?.block);
}

function buildTurnContextBlock(turnContext) {
  if (!turnContext) {
    return "";
  }
  const lines = ["Dynamic SmallPhone context:"];
  if (turnContext.activeMask?.id) {
    lines.push(
      `- Active mask: ${turnContext.activeMask.id} (${Number(turnContext.activeMask.confidence || 0).toFixed(2)})`,
    );
  }
  if (turnContext.relationshipState?.id) {
    lines.push(
      `- Relationship state: ${turnContext.relationshipState.id} (${Number(turnContext.relationshipState.intensity || 0).toFixed(2)})`,
    );
  }
  if (Array.isArray(turnContext.matchedWorldbookEntries) && turnContext.matchedWorldbookEntries.length) {
    lines.push("- Matched worldbook:");
    for (const entry of turnContext.matchedWorldbookEntries) {
      lines.push(`  - ${entry.name || entry.id}: ${entry.content}`);
    }
  }
  if (Array.isArray(turnContext.replyGuidance) && turnContext.replyGuidance.length) {
    lines.push("- Reply guidance:");
    for (const guidance of turnContext.replyGuidance) {
      lines.push(`  - ${guidance}`);
    }
  }
  return lines.join("\n");
}

function runProcess(command, args, extraEnv = {}, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command failed: ${command} ${args.join(" ")}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function resolveOpenClawEntry(explicitEntry = "") {
  const preferred = normalizeText(explicitEntry);
  if (preferred && fs.existsSync(preferred)) {
    return preferred;
  }
  const localEntry = path.join("/root/projects/smallphone/openclaw", "openclaw.mjs");
  if (fs.existsSync(localEntry)) {
    return localEntry;
  }
  return "";
}

function readCodexOpenAiApiKey() {
  const authPath = path.join(process.env.HOME || "/root", ".codex", "auth.json");
  try {
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8"));
    return normalizeText(raw?.OPENAI_API_KEY);
  } catch {
    return "";
  }
}

function readCodexProviderConfig() {
  const configPath = path.join(process.env.HOME || "/root", ".codex", "config.toml");
  try {
    const text = fs.readFileSync(configPath, "utf8");
    const lines = text.split(/\r?\n/);
    let section = "";
    let providerId = "";
    let model = "";
    let baseUrl = "";
    let apiKey = "";
    let defaultModel = "";
    let reasoningEffort = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }
      const entryMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*['"]([^'"]*)['"]$/);
      if (!entryMatch) {
        continue;
      }
      const key = entryMatch[1];
      const value = normalizeText(entryMatch[2]);
      if (!section) {
        if (key === "model_provider") {
          providerId = value;
        } else if (key === "model") {
          model = value;
        }
        continue;
      }
      if (section === `model_providers.${providerId}`) {
        if (key === "base_url") {
          baseUrl = value;
        } else if (key === "api_key") {
          apiKey = value;
        } else if (key === "default_model") {
          defaultModel = value;
        }
        continue;
      }
      if (section === `model_providers.${providerId}.settings` && key === "model_reasoning_effort") {
        reasoningEffort = value;
      }
    }
    if (!providerId) {
      return { baseUrl: "", apiKey: "", model, reasoningEffort: "" };
    }
    return {
      baseUrl,
      apiKey,
      model: model || defaultModel,
      reasoningEffort,
    };
  } catch {
    return { baseUrl: "", apiKey: "", model: "", reasoningEffort: "" };
  }
}

function appendBridgeToken(wsUrl, token) {
  if (!token) {
    return wsUrl;
  }
  const url = new URL(wsUrl);
  if (!url.searchParams.has("token")) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

function redactUrlToken(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "...");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function extractBridgeText(message) {
  if (message.type === "card" && message.card) {
    return normalizeContentText(message.card.title) || normalizeContentText(message.card.text) || JSON.stringify(message.card);
  }
  if (message.type === "buttons") {
    return normalizeContentText(message.content);
  }
  return normalizeContentText(
    message.content ||
    message.text ||
    message.message ||
    message.result ||
    message.payload?.content ||
    message.payload?.text ||
    message.payload?.message ||
    message.payload?.result,
  );
}

function getBridgeReplyContext(message) {
  return normalizeText(
    message?.reply_ctx ||
    message?.replyCtx ||
    message?.ref_id ||
    message?.preview_handle ||
    message?.payload?.reply_ctx ||
    message?.payload?.replyCtx ||
    message?.payload?.ref_id ||
    message?.payload?.preview_handle,
  );
}

function isBridgeReplyMessage(message) {
  return message?.type === "reply" || message?.type === "card" || message?.type === "buttons";
}

function isBridgeCompletionMessage(message) {
  const type = normalizeText(message?.type).toLowerCase();
  const event = normalizeText(message?.event).toLowerCase();
  const status = normalizeText(message?.status || message?.payload?.status).toLowerCase();
  return (
    message?.done === true ||
    message?.final === true ||
    message?.payload?.done === true ||
    message?.payload?.final === true ||
    status === "done" ||
    status === "completed" ||
    status === "complete" ||
    type === "done" ||
    type === "complete" ||
    type === "completed" ||
    type === "reply_done" ||
    type === "reply.complete" ||
    type === "reply.completed" ||
    type === "turn_done" ||
    type === "turn.complete" ||
    type === "turn.completed" ||
    event === "reply.completed" ||
    event === "turn.completed"
  );
}

function parseOpenClawJson(output) {
  const text = String(output || "").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Failed to parse OpenClaw JSON output: ${text.slice(0, 240)}`);
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeContentText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeContentText(item))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (value && typeof value === "object") {
    return normalizeContentText(value.text || value.content || value.message || value.title);
  }
  return "";
}

function buildWebclientUrl(baseUrl, appId, suffixPath) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const app = safePathSegment(appId);
  const suffix = String(suffixPath || "").trim();
  if (!base || !app || !suffix.startsWith("/")) {
    return "";
  }
  return `${base}/apps/${encodeURIComponent(app)}${suffix}`;
}

function resolveWebclientAttachmentUrl({ baseUrl, appId, url }) {
  const baseText = String(baseUrl || "").trim();
  let base;
  try {
    base = new URL(baseText);
  } catch {
    return { ok: false, url: "", error: `cc-webclient fetchAttachment has invalid baseUrl: ${redactUrlToken(baseText)}` };
  }

  let resolved;
  try {
    resolved = new URL(String(url || "").trim(), base);
  } catch {
    return { ok: false, url: "", error: `cc-webclient fetchAttachment has invalid url: ${redactUrlToken(String(url || "").trim())}` };
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return { ok: false, url: "", error: `cc-webclient fetchAttachment refused non-http(s) url: ${redactUrlToken(resolved.toString())}` };
  }

  const safeAppId = safePathSegment(appId);
  const allowedPrefixes = [`/apps/${safeAppId}/attachments/`, "/attachments/"];
  const okPrefix = allowedPrefixes.some((prefix) => resolved.pathname.startsWith(prefix));
  if (!okPrefix) {
    return { ok: false, url: "", error: `cc-webclient fetchAttachment refused non-attachment path: ${redactUrlToken(resolved.toString())}` };
  }

  // Rewrite any public_url origin back to the internal webclientBaseUrl origin.
  const internal = new URL(base.toString());
  internal.pathname = resolved.pathname;
  internal.search = resolved.search;
  internal.hash = resolved.hash;

  // Never forward query token; rely on Bearer token.
  if (internal.searchParams.has("token")) {
    internal.searchParams.delete("token");
  }

  return { ok: true, url: internal.toString(), error: "" };
}

function deriveWebclientSessionKey(payload, project) {
  const normalizedProject = normalizeText(project);
  const sessionName = deriveWebclientSessionName(payload);
  return `webclient:${normalizedProject || "smallphone"}:${sessionName}`;
}

function collectHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      const k = String(key || "").toLowerCase();
      out[k] = String(value || "");
    });
    return out;
  }
  // Fallback for test stubs.
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      out[String(key || "").toLowerCase()] = String(value || "");
    }
  }
  return out;
}

function parseFileNameFromContentDisposition(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const star = text.match(/filename\*\s*=\s*([^;]+)/i);
  if (star) {
    let v = String(star[1] || "").trim();
    v = v.replace(/^utf-8''/i, "");
    v = v.replace(/^['"]|['"]$/g, "");
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  const normal = text.match(/filename\s*=\s*([^;]+)/i);
  if (normal) {
    let v = String(normal[1] || "").trim();
    v = v.replace(/^['"]|['"]$/g, "");
    return v;
  }
  return "";
}

function redactMessageToken(message) {
  const text = String(message || "").trim();
  if (!text) return "";
  // Best-effort: redact any ?token=... fragments inside error strings.
  return text.replace(/([?&]token=)[^\s&#]+/gi, "$1...");
}

function derivePreferredWebclientSessionId(payload) {
  const explicit = safePathSegment(normalizeText(payload?.runtimeSessionId) || normalizeText(payload?.thread?.runtimeSessionId));
  if (isLikelyWebclientSessionId(explicit)) {
    return explicit;
  }
  return "";
}

function deriveWebclientSessionName(payload) {
  const sessionGen = Number(payload?.thread?.runtime?.sessionGeneration) || 1;
  const baseThreadId = safePathSegment(payload?.thread?.id || "");
  return safePathSegment(baseThreadId ? (sessionGen > 1 ? `${baseThreadId}-v${Math.floor(sessionGen)}` : baseThreadId) : "default") || "default";
}

function isLikelyWebclientSessionId(value) {
  const text = String(value || "").trim();
  return /^s\d+$/i.test(text) || /^web[_-]/i.test(text);
}

function safePathSegment(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const safe = text.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return safe.slice(0, 120);
}

function normalizeAttachmentKind(att) {
  const kind = normalizeText(att?.kind).toLowerCase();
  if (kind === "image") return "image";
  if (kind === "file") return "file";
  return "";
}

async function buildWebclientImages(imageAttachments) {
  if (!Array.isArray(imageAttachments) || imageAttachments.length === 0) {
    return [];
  }
  if (imageAttachments.length > 4) {
    throw new Error(`cc-webclient supports at most 4 images per message (received ${imageAttachments.length}).`);
  }
  const images = [];
  for (const att of imageAttachments) {
    const localPath = normalizeText(att?.localPath);
    const mimeType = normalizeText(att?.mimeType) || "application/octet-stream";
    const fileName = normalizeText(att?.fileName) || path.basename(localPath || "") || "image";
    if (!localPath) {
      throw new Error(`cc-webclient image attachment is missing localPath (${fileName}).`);
    }
    let data;
    try {
      data = fs.readFileSync(localPath);
    } catch (error) {
      throw new Error(
        `cc-webclient failed to read image attachment ${fileName} at ${localPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const maxImageBytes = 5 * 1024 * 1024;
    if (data.length > maxImageBytes) {
      throw new Error(`cc-webclient image attachment is too large: ${data.length} > ${maxImageBytes} bytes (${fileName})`);
    }
    images.push({
      mime_type: mimeType,
      file_name: fileName,
      data: data.toString("base64"),
    });
  }
  return images;
}

function buildWebclientTurnMessage(payload, fileAttachments) {
  if (typeof payload?.promptBoardCompiled?.finalText === "string") {
    return payload.promptBoardCompiled.finalText;
  }
  const latestUserText = getLatestRuntimeUserText(payload);
  const triggerNote = normalizeText(payload?.trigger?.note);
  const primaryText =
    payload?.trigger?.mode === "decision_only"
      ? triggerNote || latestUserText
      : latestUserText || triggerNote;

  const userPersona = normalizeText(
    payload?.thread?.workflowInput?.userPersona ||
      payload?.thread?.workflowInputs?.userPersona ||
      payload?.contact?.workflowInput?.userPersona ||
      payload?.character?.workflowInput?.userPersona,
  );

  const memoryBlock = Array.isArray(payload?.memories)
    ? payload.memories.map((item) => `- ${item.text}`).join("\n")
    : "";
  const turnContextBlock = buildTurnContextBlock(payload?.turnContext);

  const fileBlock = buildWebclientFileBlock(fileAttachments);

  return [
    "SmallPhone turn",
    `Character: ${payload?.character?.name || ""}`,
    `Persona: ${payload?.character?.persona || ""}`,
    userPersona ? `User persona: ${userPersona}` : "",
    `Contact: ${payload?.contact?.displayName || ""}`,
    `Thread: ${payload?.thread?.title || payload?.thread?.id || ""}`,
    payload?.relationship
      ? `Relationship: trust=${Number(payload.relationship.trust || 0).toFixed(2)}, intimacy=${Number(payload.relationship.intimacy || 0).toFixed(2)}, tension=${Number(payload.relationship.tension || 0).toFixed(2)}`
      : "",
    buildTimeContextBlock(payload?.timeContext),
    turnContextBlock,
    memoryBlock ? `Relevant memories:\n${memoryBlock}` : "",
    fileBlock,
    primaryText ? `User message:\n${primaryText}` : "",
    "Reply as the contact inside a small-phone chat. Be concise and concrete.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getLatestUserMessageText(payload) {
  const content = payload?.messages?.filter((item) => item.role === "user").at(-1)?.content;
  return typeof content === "string" ? content : "";
}

function getLatestRuntimeUserText(payload) {
  const content = payload?.runtimeUserText;
  return typeof content === "string" && content ? content : getLatestUserMessageText(payload);
}

function getPassThroughMessageText(payload) {
  const content = payload?.runtimePassThroughText;
  return typeof content === "string" ? content : getLatestRuntimeUserText(payload);
}

function buildWebclientFileBlock(fileAttachments) {
  if (!Array.isArray(fileAttachments) || fileAttachments.length === 0) {
    return "";
  }
  const lines = ["Attached files (read local_path on the host):"];
  for (const att of fileAttachments) {
    const fileName = normalizeText(att?.fileName) || "(unnamed)";
    const mimeType = normalizeText(att?.mimeType) || "application/octet-stream";
    const size = Number.isFinite(Number(att?.size)) ? Number(att.size) : 0;
    const localPath = normalizeText(att?.localPath);
    const id = normalizeText(att?.id);
    lines.push(
      `- ${fileName} | mime=${mimeType} | size=${size || "unknown"} | local_path=${localPath || "(missing)"}${id ? ` | id=${id}` : ""}`,
    );
  }
  return lines.join("\n");
}

async function ensureWebclientSession(params) {
  if (params.sessionId) {
    return { sessionId: params.sessionId };
  }
  const createUrl = buildWebclientUrl(
    params.baseUrl,
    params.appId,
    `/api/v1/projects/${encodeURIComponent(params.project)}/sessions`,
  );
  if (!createUrl) {
    throw new Error("cc-webclient session create URL could not be constructed.");
  }
  const response = await fetchWithTimeout(
    createUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        session_key: params.sessionKey,
        name: params.name || "default",
      }),
    },
    params.timeoutMs,
    params.fetchImpl,
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`cc-webclient create session failed with status ${response.status}: ${body.slice(0, 400)}`);
  }
  const json = await safeJson(response);
  const data = unwrapV1Data(json);
  const sessionId = safePathSegment(normalizeText(data?.id) || normalizeText(data?.session_id) || normalizeText(data?.sessionId));
  if (!sessionId) {
    throw new Error("cc-webclient create session returned no session id.");
  }
  return { sessionId };
}

async function pollWebclientAssistantReply(params) {
  const sessionUrl = buildWebclientUrl(
    params.baseUrl,
    params.appId,
    `/api/v1/projects/${encodeURIComponent(params.project)}/sessions/${encodeURIComponent(params.sessionId)}?history_limit=${encodeURIComponent(String(params.historyLimit || 80))}`,
  );
  if (!sessionUrl) {
    throw new Error("cc-webclient session URL could not be constructed.");
  }

  const startedAt = Date.now();
  let lastEmitted = "";

  while (Date.now() - startedAt <= params.timeoutMs) {
    const response = await fetchWithTimeout(
      sessionUrl,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${params.token}`,
        },
      },
      Math.min(15000, params.timeoutMs),
      params.fetchImpl,
    );

    if (!response.ok) {
      const body = await response.text();
      // A brand-new session might race; keep polling on 404 briefly.
      if (response.status !== 404) {
        throw new Error(`cc-webclient session poll failed with status ${response.status}: ${body.slice(0, 400)}`);
      }
      await sleep(params.pollIntervalMs);
      continue;
    }

    const json = await safeJson(response);
    const data = unwrapV1Data(json);
    const history = Array.isArray(data?.history) ? data.history : [];
    const matched = findAssistantMessageForOutbox(history, params.outboxId);
    if (matched) {
      const assistantText = normalizeContentText(matched?.content);
      if (assistantText && assistantText !== lastEmitted) {
        params.onEvent?.({
          type: "reply",
          replyCtx: params.outboxId || params.sessionId,
          text: assistantText,
          content: assistantText,
          chunks: [assistantText],
          done: true,
          raw: { source: "cc-webclient", message: matched },
        });
        lastEmitted = assistantText;
      }
      return {
        assistantText,
        assistantAttachments: extractAssistantAttachments(matched),
      };
    }

    // Best-effort: surface any partial assistant text from run events as a stream update.
    const partial = bestEffortAssistantTextFromRunEvents(data?.run_events, params.outboxId);
    if (partial && partial !== lastEmitted) {
      params.onEvent?.({
        type: "reply",
        replyCtx: params.outboxId || params.sessionId,
        text: partial,
        content: partial,
        chunks: [partial],
        done: false,
        raw: { source: "cc-webclient", kind: "run_events" },
      });
      lastEmitted = partial;
    }

    await sleep(params.pollIntervalMs);
  }

  throw new Error(`Request timed out after ${params.timeoutMs}ms: ${sessionUrl}`);
}

function findAssistantMessageForOutbox(history, outboxId) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const needle = normalizeText(outboxId);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    const role = normalizeText(item?.role).toLowerCase();
    if (role !== "assistant") continue;
    if (!needle) return item;
    const userMsgId = normalizeText(item?.user_message_id) || normalizeText(item?.userMessageId);
    const runId = normalizeText(item?.run_id) || normalizeText(item?.runId);
    if (userMsgId === needle || runId === needle) {
      return item;
    }
  }
  return null;
}

function extractAssistantAttachments(message) {
  const out = [];
  const images = Array.isArray(message?.images) ? message.images : [];
  const files = Array.isArray(message?.files) ? message.files : [];
  for (const img of images) {
    const url = normalizeText(img?.url);
    if (!url) continue;
    out.push({
      kind: "image",
      fileName: normalizeText(img?.file_name),
      mimeType: normalizeText(img?.mime_type),
      size: Number.isFinite(Number(img?.size)) ? Number(img.size) : 0,
      url,
      webclientId: normalizeText(img?.id),
    });
  }
  for (const file of files) {
    const url = normalizeText(file?.url);
    if (!url) continue;
    out.push({
      kind: "file",
      fileName: normalizeText(file?.file_name),
      mimeType: normalizeText(file?.mime_type),
      size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
      url,
      webclientId: normalizeText(file?.id),
    });
  }
  return out;
}

function bestEffortAssistantTextFromRunEvents(runEvents, outboxId) {
  if (!Array.isArray(runEvents) || runEvents.length === 0) return "";
  const needle = normalizeText(outboxId);
  const chunks = [];
  for (const ev of runEvents) {
    if (needle) {
      const userMsgId = normalizeText(ev?.user_message_id) || normalizeText(ev?.userMessageId);
      const runId = normalizeText(ev?.run_id) || normalizeText(ev?.runId);
      if (userMsgId !== needle && runId !== needle) {
        continue;
      }
    }
    const type = normalizeText(ev?.type).toLowerCase();
    if (!type.includes("assistant") && type !== "reply") {
      continue;
    }
    const content = normalizeContentText(ev?.content);
    if (content) {
      chunks.push(content);
    }
  }
  if (!chunks.length) return "";
  return chunks.join("\n").trim();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function unwrapV1Data(json) {
  if (json && typeof json === "object" && Object.prototype.hasOwnProperty.call(json, "data")) {
    return json.data;
  }
  return json;
}

function sleep(ms) {
  const waitMs = Number.isFinite(Number(ms)) ? Number(ms) : 0;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
}

module.exports = {
  createRuntimeAdapter,
  _test: {
    stripRuntimeRosterFields,
    buildRuntimePrompt,
    buildOpenAICompatibleMessages,
    buildWebclientTurnMessage,
    buildTurnContextBlock,
  },
};
