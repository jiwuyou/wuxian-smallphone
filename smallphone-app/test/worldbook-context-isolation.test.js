const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");

function tmpDataFile() {
  return path.join(
    os.tmpdir(),
    `smallphone-worldbook-context-isolation-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
}

function createTestService() {
  return new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });
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

test("previewTurnContext only injects always_on contact worldbook entries for the active contact", () => {
  const service = createTestService();

  const ctx = service.previewTurnContext("thread-aki", { text: "hello" });
  const ids = ctx.matchedWorldbookEntries.map((entry) => entry.id);

  assert.ok(ids.includes("contact_aki_default"));
  assert.ok(ids.includes("smallphone_product_context"));
  assert.equal(ids.includes("contact_mira_default"), false);
  assert.equal(ids.includes("contact_sora_default"), false);
});

test("sendMessage turnContext worldbook entries are isolated per contact", async () => {
  const service = createTestService();
  const payloads = captureRuntimePayloads(service);

  await service.sendMessage("thread-mira", { text: "hello" });

  assert.equal(payloads.length, 1);
  const ids = payloads[0].turnContext.matchedWorldbookEntries.map((entry) => entry.id);
  assert.ok(ids.includes("contact_mira_default"));
  assert.ok(ids.includes("smallphone_product_context"));
  assert.equal(ids.includes("contact_aki_default"), false);
  assert.equal(ids.includes("contact_sora_default"), false);
});

