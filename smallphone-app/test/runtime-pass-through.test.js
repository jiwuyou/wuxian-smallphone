const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");

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
