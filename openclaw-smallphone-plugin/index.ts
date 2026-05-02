import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { definePluginEntry } from "../openclaw/dist/plugin-sdk/plugin-entry.js";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../openclaw/dist/plugin-sdk/core.js";

const require = createRequire(import.meta.url);
const { SmallPhoneService } = require("../smallphone-app/packages/domain/service.js");

type SmallPhonePayload = {
  runtimeSessionId?: string;
  trigger?: {
    type?: string;
    note?: string;
    mode?: string;
  };
  runtimeRouting?: {
    agentId?: string;
    workspaceDir?: string;
    sessionKey?: string;
    resumeSummary?: string;
  };
  runtimeMeta?: {
    finalPromptText?: string;
    systemPromptReport?: unknown;
    toolSummary?: {
      calls?: number;
      tools?: string[];
      failures?: number;
      totalToolTimeMs?: number;
    };
    stopReason?: string;
    durationMs?: number;
  };
  thread?: {
    id?: string;
    title?: string;
  };
  contact?: {
    id?: string;
    displayName?: string;
  };
  character?: {
    name?: string;
    persona?: string;
  };
  relationship?: {
    trust?: number;
    intimacy?: number;
    tension?: number;
  };
  memories?: Array<{
    text?: string;
    salience?: number;
  }>;
  messages?: Array<{
    role?: string;
    content?: string;
  }>;
  turnContext?: {
    activeMask?: {
      id?: string;
      confidence?: number;
      reason?: string;
    } | null;
    relationshipState?: {
      id?: string;
      intensity?: number;
    } | null;
    matchedWorldbookEntries?: Array<{
      id?: string;
      name?: string;
      priority?: number;
      content?: string;
    }>;
    replyGuidance?: string[];
    generatedAt?: string;
  } | null;
};

type PluginConfig = {
  agentId?: string;
  model?: string;
  workspaceDir?: string;
  timeoutMs?: number;
  smallphoneApiBaseUrl?: string;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SMALLPHONE_CHANNEL = "smallphone";
const SMALLPHONE_API_BASE_URL = process.env.SMALLPHONE_API_BASE_URL || "http://127.0.0.1:53125";
const SMALLPHONE_TOOL_ALLOW = [
  "smallphone_contacts",
  "smallphone_threads",
  "smallphone_reminders",
  "smallphone_timeline",
] as const;
let smallPhoneServiceSingleton: InstanceType<typeof SmallPhoneService> | null = null;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function previewText(value: unknown, maxLength = 160): string {
  const text = normalizeText(value).replace(/\s+/g, " ");
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function readPluginConfig(api: OpenClawPluginApi): Required<PluginConfig> {
  const raw = (api.pluginConfig ?? {}) as PluginConfig;
  return {
    agentId: normalizeText(raw.agentId) || "main",
    model: normalizeText(raw.model) || "newxy/gpt-5.4",
    workspaceDir:
      normalizeText(raw.workspaceDir) || "/root/projects/smallphone/smallphone-active/smallphone-app",
    timeoutMs: Number.isFinite(Number(raw.timeoutMs)) ? Number(raw.timeoutMs) : 120000,
    smallphoneApiBaseUrl: normalizeText(raw.smallphoneApiBaseUrl) || SMALLPHONE_API_BASE_URL,
  };
}

function buildSessionKey(payload: SmallPhonePayload): string {
  const explicitRoutingSessionKey = normalizeText(payload.runtimeRouting?.sessionKey);
  if (explicitRoutingSessionKey) {
    return explicitRoutingSessionKey;
  }
  const explicitSessionKey =
    normalizeText((payload.thread as { runtime?: { sessionKey?: string } } | undefined)?.runtime?.sessionKey) ||
    normalizeText((payload.thread as { sessionKey?: string } | undefined)?.sessionKey);
  if (explicitSessionKey) {
    return explicitSessionKey;
  }
  const threadId = normalizeText(payload.thread?.id);
  if (threadId) {
    return `smallphone:thread:${threadId}`;
  }
  const channelId = normalizeText((payload.turnContext as { channelId?: string } | undefined)?.channelId);
  if (channelId) {
    return `smallphone:channel:${channelId}`;
  }
  const runtimeSessionId = normalizeText(payload.runtimeSessionId);
  if (runtimeSessionId) {
    return `smallphone:runtime:${runtimeSessionId}`;
  }
  const seed = JSON.stringify({
    contactId: normalizeText(payload.contact?.id),
    title: normalizeText(payload.thread?.title),
  });
  return `smallphone:fallback:${crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
}

function buildPrompt(payload: SmallPhonePayload): string {
  const triggerType = normalizeText(payload.trigger?.type);
  const triggerNote = normalizeText(payload.trigger?.note);
  if (triggerType === "scheduled_check" && triggerNote) {
    return [
      "你正在处理一次 SmallPhone 定时联系检查。",
      `任务背景：${triggerNote}`,
      "你必须先判断现在是否应该主动联系对方。",
      "输出格式只能三选一：",
      "1. [[send]] 后面直接写要发出的消息正文。",
      "2. [[skip]] 后面写一句不发送的原因。",
      "3. [[defer]] 后面写一句稍后再检查的原因。",
      "除这三种格式外，不要输出别的解释。",
    ].join("\n");
  }
  const latestUserMessage = [...(payload.messages ?? [])]
    .reverse()
    .find((item) => normalizeText(item.role) === "user" && normalizeText(item.content));
  if (latestUserMessage) {
    return normalizeText(latestUserMessage.content);
  }
  return "继续当前 SmallPhone 对话。";
}

async function readJsonBody(req: IncomingMessage): Promise<SmallPhonePayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text) as SmallPhonePayload;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): true {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(payload, null, 2));
  return true;
}

function resolveSessionFile(api: OpenClawPluginApi, sessionKey: string): string {
  const safeName = sessionKey.replace(/[^a-zA-Z0-9:_-]+/g, "-");
  return path.join(api.runtime.state.resolveStateDir(), "plugins", "smallphone", "sessions", `${safeName}.jsonl`);
}

function resolveTurnContextFile(api: OpenClawPluginApi, sessionKey: string): string {
  const safeName = sessionKey.replace(/[^a-zA-Z0-9:_-]+/g, "-");
  return path.join(
    api.runtime.state.resolveStateDir(),
    "plugins",
    "smallphone",
    "turn-context",
    `${safeName}.json`,
  );
}

async function persistTurnContext(
  api: OpenClawPluginApi,
  sessionKey: string,
  payload: SmallPhonePayload,
): Promise<void> {
  const filePath = resolveTurnContextFile(api, sessionKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const persisted = {
    sessionKey,
    channel: SMALLPHONE_CHANNEL,
    threadId: normalizeText(payload.thread?.id),
    channelId:
      normalizeText((payload.thread as { channelId?: string } | undefined)?.channelId) ||
      normalizeText((payload.turnContext as { channelId?: string } | undefined)?.channelId),
    windowId:
      normalizeText((payload.thread as { windowId?: string } | undefined)?.windowId) ||
      normalizeText((payload.turnContext as { windowId?: string } | undefined)?.windowId),
    contactId: normalizeText(payload.contact?.id),
    contactName: normalizeText(payload.contact?.displayName),
    characterName: normalizeText(payload.character?.name),
    characterPersona: normalizeText(payload.character?.persona),
    resumeSummary:
      normalizeText(payload.runtimeRouting?.resumeSummary) ||
      normalizeText((payload.thread as { runtime?: { resumeSummary?: string } } | undefined)?.runtime?.resumeSummary),
    relationship: {
      trust: normalizeNumber(payload.relationship?.trust),
      intimacy: normalizeNumber(payload.relationship?.intimacy),
      tension: normalizeNumber(payload.relationship?.tension),
    },
    turnContext: payload.turnContext ?? null,
    runtimeMeta: payload.runtimeMeta ?? null,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(persisted, null, 2), "utf8");
  api.logger.info("smallphone turn-context persisted", {
    sessionKey,
    filePath,
  });
}

async function readTurnContext(
  api: OpenClawPluginApi,
  sessionKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const filePath = resolveTurnContextFile(api, sessionKey);
    const raw = await fs.readFile(filePath, "utf8");
    api.logger.info("smallphone turn-context loaded", {
      sessionKey,
      filePath,
    });
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseScheduledDecision(text: string): {
  action: "send" | "skip" | "defer";
  reason: string;
  assistantText: string;
} {
  const trimmed = normalizeText(text);
  if (/^\[\[skip\]\]/i.test(trimmed)) {
    return {
      action: "skip",
      reason: trimmed.replace(/^\[\[skip\]\]\s*/i, "").trim(),
      assistantText: "",
    };
  }
  if (/^\[\[defer\]\]/i.test(trimmed)) {
    return {
      action: "defer",
      reason: trimmed.replace(/^\[\[defer\]\]\s*/i, "").trim(),
      assistantText: "",
    };
  }
  if (/^\[\[send\]\]/i.test(trimmed)) {
    return {
      action: "send",
      reason: "assistant chose to send",
      assistantText: trimmed.replace(/^\[\[send\]\]\s*/i, "").trim(),
    };
  }
  return {
    action: trimmed ? "send" : "skip",
    reason: trimmed ? "assistant returned plain text" : "assistant returned no text",
    assistantText: trimmed,
  };
}

function buildPromptInjectionText(record: Record<string, unknown>): string {
  const turnContext = (record.turnContext ?? null) as SmallPhonePayload["turnContext"];
  const lines: string[] = [
    "SmallPhone dynamic context:",
    `- Contact: ${normalizeText(record.contactName) || "联系人"}`,
  ];
  const characterName = normalizeText(record.characterName);
  const persona = normalizeText(record.characterPersona);
  if (characterName) {
    lines.push(`- Character: ${characterName}`);
  }
  if (persona) {
    lines.push(`- Persona: ${persona}`);
  }
  const resumeSummary = normalizeText(record.resumeSummary);
  if (resumeSummary) {
    lines.push(`- Session handoff summary: ${resumeSummary}`);
  }
  const trust = normalizeNumber((record.relationship as SmallPhonePayload["relationship"] | undefined)?.trust);
  const intimacy = normalizeNumber(
    (record.relationship as SmallPhonePayload["relationship"] | undefined)?.intimacy,
  );
  const tension = normalizeNumber(
    (record.relationship as SmallPhonePayload["relationship"] | undefined)?.tension,
  );
  lines.push(
    `- Relationship baseline: trust=${trust.toFixed(2)}, intimacy=${intimacy.toFixed(2)}, tension=${tension.toFixed(2)}`,
  );
  if (turnContext?.activeMask?.id) {
    lines.push(
      `- Active mask: ${normalizeText(turnContext.activeMask.id)} (${normalizeNumber(
        turnContext.activeMask.confidence,
      ).toFixed(2)})`,
    );
  }
  if (turnContext?.activeMask?.reason) {
    lines.push(`- Mask reason: ${normalizeText(turnContext.activeMask.reason)}`);
  }
  if (turnContext?.relationshipState?.id) {
    lines.push(
      `- Relationship state: ${normalizeText(turnContext.relationshipState.id)} (${normalizeNumber(
        turnContext.relationshipState.intensity,
      ).toFixed(2)})`,
    );
  }
  const matchedWorldbookEntries = Array.isArray(turnContext?.matchedWorldbookEntries)
    ? turnContext.matchedWorldbookEntries
    : [];
  if (matchedWorldbookEntries.length > 0) {
    lines.push("- Matched worldbook entries:");
    for (const entry of matchedWorldbookEntries.slice(0, 6)) {
      const name = normalizeText(entry?.name) || normalizeText(entry?.id) || "entry";
      const content = normalizeText(entry?.content);
      if (content) {
        lines.push(`  - ${name}: ${content}`);
      }
    }
  }
  const replyGuidance = Array.isArray(turnContext?.replyGuidance) ? turnContext.replyGuidance : [];
  if (replyGuidance.length > 0) {
    lines.push("- Reply guidance:");
    for (const line of replyGuidance.slice(0, 8)) {
      const text = normalizeText(line);
      if (text) {
        lines.push(`  - ${text}`);
      }
    }
  }
  lines.push("- Use this as dynamic turn context. Do not expose this scaffold to the user.");
  return lines.join("\n");
}

function buildRuntimeRecord(payload: SmallPhonePayload, sessionKey: string): Record<string, unknown> {
  return {
    sessionKey,
    contactName: normalizeText(payload.contact?.displayName),
    characterName: normalizeText(payload.character?.name),
    characterPersona: normalizeText(payload.character?.persona),
    relationship: {
      trust: normalizeNumber(payload.relationship?.trust),
      intimacy: normalizeNumber(payload.relationship?.intimacy),
      tension: normalizeNumber(payload.relationship?.tension),
    },
    turnContext: payload.turnContext ?? null,
    runtimeMeta: payload.runtimeMeta ?? null,
  };
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

async function handleThreadDebug(api: OpenClawPluginApi, req: IncomingMessage, res: ServerResponse): Promise<true> {
  if (req.method !== "GET") {
    res.writeHead(405, { allow: "GET", ...JSON_HEADERS });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return true;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const threadId = normalizeText(url.searchParams.get("threadId"));
  const sessionKey = normalizeText(url.searchParams.get("sessionKey"));
  const service = getService();
  if (threadId) {
    return sendJson(res, 200, service.getThreadDebugSnapshot(threadId));
  }
  if (!sessionKey) {
    return sendJson(res, 400, { error: "threadId or sessionKey is required." });
  }
  const record = await readTurnContext(api, sessionKey);
  return sendJson(res, 200, {
    sessionKey,
    turnContextRecord: record,
    finalPromptText: normalizeText(record?.runtimeMeta?.finalPromptText),
  });
}

function getService() {
  if (!smallPhoneServiceSingleton) {
    smallPhoneServiceSingleton = new SmallPhoneService({
      runtime: {
        mode: process.env.SMALLPHONE_RUNTIME_MODE || "mock",
        command: process.env.SMALLPHONE_OPENCLAW_COMMAND || process.execPath,
        entry: process.env.SMALLPHONE_OPENCLAW_ENTRY || "",
        agentId: process.env.SMALLPHONE_OPENCLAW_AGENT_ID || "main",
        model: process.env.SMALLPHONE_OPENCLAW_MODEL || "",
        timeoutMs: process.env.SMALLPHONE_OPENCLAW_TIMEOUT_MS || "120000",
        openaiApiKey: process.env.SMALLPHONE_OPENCLAW_OPENAI_API_KEY || "",
        openaiBaseUrl: process.env.SMALLPHONE_OPENAI_BASE_URL || "",
        openaiModel: process.env.SMALLPHONE_OPENAI_MODEL || "",
        openaiReasoningEffort: process.env.SMALLPHONE_OPENAI_REASONING_EFFORT || "",
        baseUrl: process.env.SMALLPHONE_OPENCLAW_HTTP_URL || "",
        token: process.env.SMALLPHONE_OPENCLAW_HTTP_TOKEN || "",
      },
    });
  }
  return smallPhoneServiceSingleton;
}

function resolveThreadIdFromSessionKey(sessionKey: string): string {
  const text = normalizeText(sessionKey);
  const match = text.match(/^smallphone:thread:([^:]+)(?::v\d+)?$/);
  return match?.[1] ? normalizeText(match[1]) : "";
}

function registerSmallPhoneTools(api: OpenClawPluginApi): void {
  api.registerTool((ctx: OpenClawPluginToolContext) => {
    const service = getService();
    const currentThreadId = resolveThreadIdFromSessionKey(normalizeText(ctx.sessionKey));
    return [
      {
        name: "smallphone_contacts",
        label: "SmallPhone Contacts",
        description: "List SmallPhone contacts and relationship baselines.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            includeArchived: {
              type: "boolean",
              description: "Include archived contacts when true.",
            },
          },
        },
        async execute(_toolCallId: string, params: { includeArchived?: boolean }) {
          const contacts = service
            .listContacts()
            .filter((item) => params?.includeArchived || item.status !== "archived");
          return jsonToolResult({ contacts });
        },
      },
      {
        name: "smallphone_threads",
        label: "SmallPhone Threads",
        description: "List SmallPhone thread state and routing metadata.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            contactId: {
              type: "string",
              description: "Filter by contact id.",
            },
          },
        },
        async execute(_toolCallId: string, params: { contactId?: string }) {
          const contactId = normalizeText(params?.contactId);
          const threads = service
            .listThreads()
            .filter((item) => !contactId || normalizeText(item.contactId) === contactId);
          return jsonToolResult({ threads });
        },
      },
      {
        name: "smallphone_reminders",
        label: "SmallPhone Reminders",
        description: "List or create reminders in the current SmallPhone thread.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: {
              type: "string",
              enum: ["list", "create"],
              description: "Choose whether to list reminders or create one.",
            },
            threadId: {
              type: "string",
              description: "Optional thread id override. Defaults to the active SmallPhone thread.",
            },
            note: {
              type: "string",
              description: "Reminder note for create action.",
            },
            dueAt: {
              type: "string",
              description: "ISO due time for create action.",
            },
          },
        },
        async execute(
          _toolCallId: string,
          params: { action?: string; threadId?: string; note?: string; dueAt?: string },
        ) {
          const action = normalizeText(params?.action) || "list";
          const threadId = normalizeText(params?.threadId) || currentThreadId;
          if (action === "create") {
            if (!threadId) {
              throw new Error("threadId required for reminder creation.");
            }
            const note = normalizeText(params?.note);
            const dueAt = normalizeText(params?.dueAt);
            if (!note || !dueAt) {
              throw new Error("note and dueAt required for reminder creation.");
            }
            const reminders = service.createReminder({ threadId, note, dueAt });
            return jsonToolResult({ ok: true, threadId, reminders });
          }
          const reminders = service
            .listReminders()
            .filter((item) => !threadId || normalizeText(item.threadId) === threadId);
          return jsonToolResult({ threadId: threadId || null, reminders });
        },
      },
      {
        name: "smallphone_timeline",
        label: "SmallPhone Timeline",
        description: "Read or append SmallPhone timeline events for the current thread.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: {
              type: "string",
              enum: ["list", "append"],
              description: "Choose whether to read or append timeline events.",
            },
            threadId: {
              type: "string",
              description: "Optional thread id override. Defaults to the active SmallPhone thread.",
            },
            title: {
              type: "string",
              description: "Timeline title for append action.",
            },
            detail: {
              type: "string",
              description: "Timeline detail for append action.",
            },
            eventType: {
              type: "string",
              description: "Optional event type for append action.",
            },
          },
        },
        async execute(
          _toolCallId: string,
          params: { action?: string; threadId?: string; title?: string; detail?: string; eventType?: string },
        ) {
          const action = normalizeText(params?.action) || "list";
          const threadId = normalizeText(params?.threadId) || currentThreadId;
          if (action === "append") {
            if (!threadId) {
              throw new Error("threadId required for timeline append.");
            }
            const title = normalizeText(params?.title);
            if (!title) {
              throw new Error("title required for timeline append.");
            }
            const timeline = service.createTimelineEvent({
              threadId,
              title,
              detail: normalizeText(params?.detail),
              type: normalizeText(params?.eventType) || "system",
            });
            return jsonToolResult({ ok: true, threadId, timeline });
          }
          const timeline = service
            .listTimeline()
            .filter((item) => !threadId || normalizeText(item.threadId) === threadId);
          return jsonToolResult({ threadId: threadId || null, timeline });
        },
      },
    ];
  });
}

async function handleTurn(api: OpenClawPluginApi, req: IncomingMessage, res: ServerResponse): Promise<true> {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST", ...JSON_HEADERS });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return true;
  }

  let payload: SmallPhonePayload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid JSON body",
    });
  }

  const pluginConfig = readPluginConfig(api);
  const sessionKey = buildSessionKey(payload);
  const sessionId = normalizeText(payload.thread?.id) || normalizeText(payload.runtimeSessionId) || crypto.createHash("sha1").update(sessionKey).digest("hex").slice(0, 16);
  const sessionFile = resolveSessionFile(api, sessionKey);
  const cfg = api.runtime.config.loadConfig();
  const explicitThreadRuntime = (payload.thread as {
    runtime?: { agentId?: string; workspaceDir?: string };
  } | undefined)?.runtime;
  const agentId =
    normalizeText(payload.runtimeRouting?.agentId) ||
    normalizeText(explicitThreadRuntime?.agentId) ||
    pluginConfig.agentId;
  const workspaceDir =
    normalizeText(payload.runtimeRouting?.workspaceDir) ||
    normalizeText(explicitThreadRuntime?.workspaceDir) ||
    pluginConfig.workspaceDir;
  const agentDir = api.runtime.agent.resolveAgentDir(cfg, agentId);

  api.logger.info("smallphone turn start", {
    threadId: normalizeText(payload.thread?.id),
    incomingRuntimeSessionId: normalizeText(payload.runtimeSessionId),
    sessionId,
    sessionKey,
    workspaceDir,
    agentId,
  });

  if (!workspaceDir) {
    return sendJson(res, 500, {
      error: `Agent workspace not found for agent: ${agentId}`,
    });
  }

  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await persistTurnContext(api, sessionKey, payload);
  const extraSystemPrompt = buildPromptInjectionText(buildRuntimeRecord(payload, sessionKey));
  const prompt = buildPrompt(payload);
  const startedAt = Date.now();

  api.logger.info("smallphone agent run start", {
    sessionId,
    sessionKey,
    threadId: normalizeText(payload.thread?.id),
    workspaceDir,
    agentId,
    timeoutMs: pluginConfig.timeoutMs,
    hasResumeSummary: Boolean(normalizeText(payload.runtimeRouting?.resumeSummary)),
    messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
    promptPreview: previewText(prompt, 120),
    extraSystemPromptPreview: previewText(extraSystemPrompt, 200),
  });

  try {
    const result = await api.runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      agentId,
      sessionFile,
      workspaceDir,
      agentDir,
      config: cfg,
      prompt,
      provider: pluginConfig.model.split("/")[0] || undefined,
      model: pluginConfig.model.split("/").slice(1).join("/") || undefined,
      timeoutMs: pluginConfig.timeoutMs,
      runId: `smallphone-${Date.now().toString(36)}`,
      trigger: "manual",
      bootstrapContextMode: "lightweight",
      disableMessageTool: true,
      verboseLevel: "off",
      toolsAllow: [...SMALLPHONE_TOOL_ALLOW],
      extraSystemPrompt,
    });

    const rawAssistantText = (result.payloads ?? [])
      .map((item) => normalizeText(item?.text))
      .filter(Boolean)
      .join("\n\n");
    const scheduledDecision = normalizeText(payload.trigger?.type) === "scheduled_check"
      ? parseScheduledDecision(rawAssistantText)
      : null;
    const assistantText = scheduledDecision?.assistantText ?? rawAssistantText;
    const runtimeMeta = {
      finalPromptText: normalizeText(result.meta?.finalPromptText),
      systemPromptReport: result.meta?.systemPromptReport,
      toolSummary: result.meta?.toolSummary,
      stopReason: normalizeText(result.meta?.stopReason),
      durationMs: Number.isFinite(Number(result.meta?.durationMs)) ? Number(result.meta.durationMs) : Date.now() - startedAt,
    };
    await persistTurnContext(api, sessionKey, {
      ...payload,
      runtimeMeta,
    });

    api.logger.info("smallphone turn success", {
      sessionId,
      sessionKey,
      durationMs: Date.now() - startedAt,
      payloadCount: Array.isArray(result.payloads) ? result.payloads.length : 0,
      assistantTextPreview: assistantText.slice(0, 120),
      toolSummary: runtimeMeta.toolSummary,
    });

    return sendJson(res, 200, {
      runtimeSessionId: sessionId,
      runtimeSessionKey: sessionKey,
      sessionKey,
      assistantText: assistantText || "",
      toolCalls: runtimeMeta.toolSummary?.tools?.map((name) => ({ name })) || [],
      decision:
        scheduledDecision || {
          action: "send",
          reason: assistantText ? "assistant text generated" : "assistant returned no text",
        },
      meta: {
        agentId,
        workspaceDir,
        requestedSessionKey: sessionKey,
        model: pluginConfig.model,
        runtimeMeta,
      },
    });
  } catch (error) {
    api.logger.error("smallphone route failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionKey,
      sessionId,
      durationMs: Date.now() - startedAt,
      agentId,
      workspaceDir,
    });
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
      runtimeSessionId: sessionId,
    });
  }
}

export default definePluginEntry({
  id: "smallphone",
  name: "SmallPhone",
  description: "SmallPhone dedicated agent ingress route",
  register(api: OpenClawPluginApi) {
    registerSmallPhoneTools(api);

    api.on("before_prompt_build", async (_event, ctx) => {
      const sessionKey = normalizeText((ctx as { sessionKey?: string }).sessionKey);
      const channelId = normalizeText((ctx as { channelId?: string }).channelId);
      if (!sessionKey || channelId !== SMALLPHONE_CHANNEL) {
        return;
      }
      api.logger.info("smallphone before_prompt_build hit", {
        sessionKey,
        channelId,
      });
      const record = await readTurnContext(api, sessionKey);
      if (!record) {
        api.logger.warn("smallphone before_prompt_build missing turn-context", {
          sessionKey,
        });
        return;
      }
      return {
        prependContext: buildPromptInjectionText(record),
      };
    });

    api.registerHttpRoute({
      path: "/smallphone/turn",
      auth: "gateway",
      match: "exact",
      replaceExisting: true,
      handler: async (req, res) => await handleTurn(api, req, res),
    });

    api.registerHttpRoute({
      path: "/smallphone/debug",
      auth: "gateway",
      match: "exact",
      replaceExisting: true,
      handler: async (req, res) => await handleThreadDebug(api, req, res),
    });
  },
});
