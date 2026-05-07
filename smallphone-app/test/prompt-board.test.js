const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const {
  compilePromptBoard,
  createDefaultPromptBoardModulesV1,
} = require("../packages/shared/prompt-board");
const { _test: runtimeTest } = require("../packages/openclaw-adapter");

function tmpDataFile() {
  return path.join(
    os.tmpdir(),
    `smallphone-prompt-board-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
}

test("prompt-board compiler never includes module title/description in finalText", () => {
  const compiled = compilePromptBoard({
    modules: [
      {
        id: "m1",
        title: "THIS MUST NOT SHIP",
        description: "DESC MUST NOT SHIP",
        enabled: true,
        template: "",
        contentOverride: null,
        order: 1,
      },
      {
        id: "m2",
        title: "UI title",
        description: "UI desc",
        enabled: true,
        template: "{{value}}",
        contentOverride: null,
        order: 2,
      },
    ],
    context: { value: "hello" },
  });

  assert.equal(compiled.finalText, "hello");
  assert.equal(compiled.finalText.includes("THIS MUST NOT SHIP"), false);
  assert.equal(compiled.finalText.includes("DESC MUST NOT SHIP"), false);
});

test("service: prompt-board defaults resolve from workflow and can be overridden per-thread", () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });

  const initial = service.getThreadPromptBoard("thread-aki");
  assert.equal(initial.threadId, "thread-aki");
  assert.equal(initial.source, "workflow");
  assert.ok(Array.isArray(initial.modules) && initial.modules.length >= 8);

  const modules = createDefaultPromptBoardModulesV1();
  const instruction = modules.find((m) => m.id === "pb.instruction");
  assert.ok(instruction);
  instruction.template = "Reply with ONLY: ok";

  const saved = service.saveThreadPromptBoard("thread-aki", { modules });
  assert.equal(saved.source, "thread");

  const preview = service.previewThreadPromptBoard("thread-aki", { text: "ping" });
  assert.equal(preview.threadId, "thread-aki");
  assert.ok(typeof preview.finalText === "string");
  assert.ok(Array.isArray(preview.sections));
  assert.ok(preview.compiled && typeof preview.compiled === "object");
  assert.ok(preview.compiled.finalText === preview.finalText);
  assert.ok(Array.isArray(preview.compiled.sections));
  assert.ok(preview.compiled.sections.length === preview.sections.length);
  assert.ok(preview.finalText.includes("User message:\nping"));
  assert.ok(preview.finalText.includes("Reply with ONLY: ok"));
});

test("cc-webclient runtime builder uses promptBoardCompiled.finalText when provided", () => {
  const message = runtimeTest.buildWebclientTurnMessage(
    {
      promptBoardCompiled: { finalText: "OVERRIDE\n\nTEXT" },
      character: { name: "A", persona: "P" },
      contact: { displayName: "C" },
      thread: { id: "t", title: "T" },
      relationship: { trust: 0.1, intimacy: 0.2, tension: 0.3 },
      memories: [],
      messages: [],
      timeContext: null,
      turnContext: null,
    },
    [],
  );
  assert.equal(message, "OVERRIDE\n\nTEXT");
});

test("cc-webclient runtime builder preserves promptBoardCompiled.finalText byte-for-byte", () => {
  const finalText = "  OVERRIDE\n\nTEXT  \n";
  const message = runtimeTest.buildWebclientTurnMessage(
    {
      promptBoardCompiled: { finalText },
      character: { name: "A", persona: "P" },
      contact: { displayName: "C" },
      thread: { id: "t", title: "T" },
      relationship: { trust: 0.1, intimacy: 0.2, tension: 0.3 },
      memories: [],
      messages: [],
      timeContext: null,
      turnContext: null,
    },
    [],
  );
  assert.equal(message, finalText);
});

test("service: prompt-board contentOverride is persisted and takes precedence over template", () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });

  const modules = createDefaultPromptBoardModulesV1();
  const instruction = modules.find((m) => m.id === "pb.instruction");
  assert.ok(instruction);
  instruction.template = "TEMPLATE SHOULD NOT SHOW";
  instruction.contentOverride = "OVERRIDDEN INSTRUCTION";
  service.saveThreadPromptBoard("thread-aki", { modules });

  const preview = service.previewThreadPromptBoard("thread-aki", { text: "ping" });
  assert.ok(preview.finalText.includes("User message:\nping"));
  assert.ok(preview.finalText.includes("OVERRIDDEN INSTRUCTION"));
  assert.equal(preview.finalText.includes("TEMPLATE SHOULD NOT SHOW"), false);
});

test("service: prompt-board preview uses routed thread context (runtime provider parity)", () => {
  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: {
      mode: "cc-webclient",
      webclientBaseUrl: "http://example.invalid",
      webclientToken: "token",
      webclientAppId: "app",
      ccConnectProject: "project",
    },
    artifactSync: { enabled: false },
  });

  const modules = createDefaultPromptBoardModulesV1();
  modules.push({
    id: "pb.provider",
    title: "Provider",
    description: "Debug provider surface.",
    enabled: true,
    order: 5,
    template: "Provider: {{thread.runtime.provider}}",
    contentOverride: null,
  });
  service.saveThreadPromptBoard("thread-aki", { modules });

  const preview = service.previewThreadPromptBoard("thread-aki", { text: "ping" });
  assert.ok(preview.finalText.includes("Provider: cc-webclient"));
});
