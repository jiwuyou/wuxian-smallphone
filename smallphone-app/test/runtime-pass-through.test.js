const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const { createRuntimeAdapter } = require("../packages/openclaw-adapter");

function tmpDataFile() {
  return path.join(os.tmpdir(), `smallphone-runtime-pass-through-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function captureRuntimePayloads(service) {
  const payloads = [];
  service.runtime = {
    async sendTurn(payload) {
      payloads.push(payload);
      return {
        runtimeSessionId: payload.runtimeSessionId || "runtime-test",
        runtimeSessionKey: payload.thread?.runtime?.sessionKey || "",
        assistantText: "ok",
        toolCalls: [],
      };
    },
  };
  return payloads;
}

function createTestService() {
  return new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });
}

function latestUserText(payload) {
  return payload.messages.filter((item) => item.role === "user").at(-1)?.content || "";
}

function installFetchStub(t, handler) {
  const calls = [];
  const runtime = createRuntimeAdapter({
    mode: "cc-webclient",
    webclientBaseUrl: "http://127.0.0.1:21040",
    webclientToken: "test-token",
    webclientAppId: "smallphone",
    ccConnectProject: "smallphone-contact-aki",
    pollIntervalMs: 1,
    timeoutMs: 50,
    fetch: async (url, init = {}) => {
      const call = {
        url: String(url),
        method: String(init.method || "GET").toUpperCase(),
        headers: init.headers || {},
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const result = await handler(call, calls);
      const status = Number.isFinite(Number(result?.status)) ? Number(result.status) : 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
          return JSON.stringify(result?.body ?? { ok: true, data: {} });
        },
        async json() {
          return result?.body ?? { ok: true, data: {} };
        },
      };
    },
  });
  t.after(() => {
    calls.length = 0;
  });
  return { calls, runtime };
}

test("sendMessage preserves raw whitespace for pass-through while storing trimmed text", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);

  const result = await service.sendMessage("thread-aki", {
    text: "  /help  ",
    runtimePassThrough: true,
  });

  assert.equal(result.userMessage.content, "/help");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].runtimePassThrough, true);
  assert.equal(payloads[0].runtimePassThroughText, "  /help  ");
  assert.equal(latestUserText(payloads[0]), "/help");
});

test("sendMessage stores original multi-part content while runtime receives numbered current-message labels", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);

  const result = await service.sendMessage("thread-aki", {
    text: "first\nsecond",
    textParts: ["first", "second"],
  });

  assert.equal(result.userMessage.content, "first\nsecond");
  assert.equal(payloads.length, 1);
  assert.equal(
    latestUserText(payloads[0]),
    "当前消息第1条：first\n当前消息第2条：second",
  );
  assert.deepEqual(payloads[0].runtimeTextParts, ["first", "second"]);
  assert.equal(payloads[0].runtimeUserText, "当前消息第1条：first\n当前消息第2条：second");

  const stored = service.getMessages("thread-aki").filter((item) => item.role === "user").at(-1);
  assert.equal(stored.content, "first\nsecond");
  assert.equal(stored.content.includes("当前消息第1条"), false);
});

test("sendMessage uses labeled multi-part text for runtime pass-through", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);

  await service.sendMessage("thread-aki", {
    text: "first\nsecond",
    textParts: ["first", "second"],
    runtimePassThrough: true,
  });

  assert.equal(payloads.length, 1);
  assert.equal(
    payloads[0].runtimePassThroughText,
    "当前消息第1条：first\n当前消息第2条：second",
  );
});

test("sendMessage keeps one text part unlabeled for runtime", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);

  const result = await service.sendMessage("thread-aki", {
    text: "single",
    textParts: ["single"],
  });

  assert.equal(result.userMessage.content, "single");
  assert.equal(latestUserText(payloads[0]), "single");
  assert.equal(payloads[0].runtimeUserText, "single");
});

test("sendMessage injects backend time context for enabled thread timezone without storing it", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);
  await service.updateCompanion("contact-aki", {
    name: "Aki",
    timeSettings: {
      enabled: true,
      timezone: "America/New_York",
    },
  });

  const result = await service.sendMessage("thread-aki", {
    text: "what time is it?",
  });

  assert.equal(result.userMessage.content, "what time is it?");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].timeContext.enabled, true);
  assert.equal(payloads[0].timeContext.timezone, "America/New_York");
  assert.match(payloads[0].timeContext.utcIso, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(payloads[0].timeContext.block, /Current backend time:/);
  assert.match(payloads[0].timeContext.block, /- timezone: America\/New_York/);
  assert.match(payloads[0].timeContext.block, /- local: /);
  assert.match(payloads[0].timeContext.block, /- utc: /);

  const stored = service.getMessages("thread-aki").filter((item) => item.role === "user").at(-1);
  assert.equal(stored.content, "what time is it?");
  assert.equal(stored.content.includes("Current backend time"), false);
});

test("cc-webclient runtime message includes numbered parts and time block", async (t) => {
  const service = createTestService();
  const { calls, runtime } = installFetchStub(t, (call) => {
    if (call.method === "POST" && call.url.endsWith("/sessions")) {
      return { body: { ok: true, data: { id: "session-1" } } };
    }
    if (call.method === "POST" && call.url.endsWith("/send")) {
      return { body: { ok: true, data: { outbox_id: "outbox-1", session_id: "session-1" } } };
    }
    if (call.method === "GET" && call.url.includes("/sessions/session-1")) {
      return {
        body: {
          ok: true,
          data: {
            history: [
              {
                role: "assistant",
                user_message_id: "outbox-1",
                content: "ok",
              },
            ],
          },
        },
      };
    }
    throw new Error(`Unexpected fetch call: ${call.method} ${call.url}`);
  });
  service.runtime = runtime;
  const existing = service.listContacts().find((item) => item.id === "contact-aki");
  assert.ok(existing);
  const testUserPersona = "The user prefers bullet-point plans and minimal small talk.";
  await service.updateCompanion("contact-aki", {
    name: "Aki",
    timeSettings: {
      enabled: true,
      timezone: "Asia/Tokyo",
    },
    workflowId: existing.workflowId,
    workflowVersion: existing.workflowVersion,
    workflowInput: {
      ...(existing.workflowInput || {}),
      userPersona: testUserPersona,
    },
  });

  const result = await service.sendMessage("thread-aki", {
    text: "alpha\nbeta",
    textParts: ["alpha", "beta"],
  });

  const sendCall = calls.find((item) => item.method === "POST" && item.url.endsWith("/send"));
  assert.ok(sendCall);
  assert.match(sendCall.body.message, /Current backend time:/);
  assert.match(sendCall.body.message, /- timezone: Asia\/Tokyo/);
  assert.match(sendCall.body.message, /- utc: \d{4}-\d{2}-\d{2}T/);
  assert.ok(sendCall.body.message.includes(`User persona: ${testUserPersona}`));
  assert.match(sendCall.body.message, /当前消息第1条：alpha/);
  assert.match(sendCall.body.message, /当前消息第2条：beta/);
  assert.equal(result.userMessage.content, "alpha\nbeta");
});

test("invalid companion timezone is sanitized to stable UTC default", async () => {
  const service = createTestService();

  const updated = await service.updateCompanion("contact-aki", {
    name: "Aki",
    timeSettings: {
      enabled: true,
      timezone: "Mars/Olympus",
    },
  });

  assert.deepEqual(updated.contact.timeSettings, {
    enabled: true,
    timezone: "Etc/UTC",
  });
  assert.deepEqual(updated.thread.timeSettings, {
    enabled: true,
    timezone: "Etc/UTC",
  });
});

test("sendMessage escapes double slash and disables pass-through", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);

  const result = await service.sendMessage("thread-aki", {
    text: "  //help  ",
    runtimePassThrough: true,
  });

  assert.equal(result.userMessage.content, "/help");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].runtimePassThrough, false);
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[0], "runtimePassThroughText"), false);
  assert.equal(latestUserText(payloads[0]), "/help");
});

test("sendMessage disables pass-through when attachments are present", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);
  const attachment = service.createAttachment({
    fileName: "note.txt",
    mimeType: "text/plain",
    data: Buffer.from("hello", "utf8").toString("base64"),
  });

  const result = await service.sendMessage("thread-aki", {
    text: "  /help  ",
    runtimePassThrough: true,
    attachments: [attachment.id],
  });

  assert.equal(result.userMessage.content, "/help");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].runtimePassThrough, false);
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[0], "runtimePassThroughText"), false);
  assert.equal(payloads[0].attachments.length, 1);

  const record = service.getAttachment(attachment.id);
  fs.rmSync(path.dirname(record.localPath), { recursive: true, force: true });
});
