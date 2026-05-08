const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const {
  compilePromptBoard,
  createDefaultPromptBoardModulesV1,
  normalizePromptBoardModules,
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

test("service: prompt-board defaults resolve from workflow and can be overridden per-thread", async () => {
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

  const preview = await service.previewThreadPromptBoard("thread-aki", { text: "ping" });
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

test("service: prompt-board contentOverride is persisted and takes precedence over template", async () => {
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

  const preview = await service.previewThreadPromptBoard("thread-aki", { text: "ping" });
  assert.ok(preview.finalText.includes("User message:\nping"));
  assert.ok(preview.finalText.includes("OVERRIDDEN INSTRUCTION"));
  assert.equal(preview.finalText.includes("TEMPLATE SHOULD NOT SHOW"), false);
});

test("service: prompt-board preview uses routed thread context (runtime provider parity)", async () => {
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

  const preview = await service.previewThreadPromptBoard("thread-aki", { text: "ping" });
  assert.ok(preview.finalText.includes("Provider: cc-webclient"));
});

test("prompt-board compiler supports fields/vars/app and prefers resolvedValue over fallback", () => {
  const compiled = compilePromptBoard({
    modules: [
      {
        id: "m1",
        title: "Fields",
        description: "",
        enabled: true,
        order: 1,
        template: "F={{fields.foo}} V={{vars.foo}} A={{app.foo}}",
        contentOverride: null,
        fields: [{ id: "foo", value: "FALLBACK", resolvedValue: "RESOLVED", sourceType: "manual" }],
      },
    ],
    context: {},
  });

  assert.equal(compiled.finalText, "F=RESOLVED V=RESOLVED A=RESOLVED");
});

test("module normalizer preserves kind/fields/workflow and strips resolvedValue by default (persistence-safe)", () => {
  const normalized = normalizePromptBoardModules([
    {
      id: "m1",
      enabled: true,
      order: 1,
      template: "x",
      kind: "template",
      fields: [{ id: "foo", value: "fallback", resolvedValue: "should-not-persist", sourceType: "manual" }],
      workflow: {},
    },
  ]);

  assert.equal(normalized[0].kind, "template");
  assert.ok(Array.isArray(normalized[0].fields));
  assert.equal(normalized[0].fields[0].id, "foo");
  assert.equal(normalized[0].fields[0].value, "fallback");
  assert.equal(Object.prototype.hasOwnProperty.call(normalized[0].fields[0], "resolvedValue"), false);
  assert.ok(normalized[0].workflow && typeof normalized[0].workflow === "object");
  assert.equal(normalized[0].workflow.mode, "parallel");
  assert.equal(normalized[0].workflow.nodeType, "context.block");
  assert.ok(Array.isArray(normalized[0].workflow.inputs));
  assert.ok(Array.isArray(normalized[0].workflow.outputs));
  assert.ok(normalized[0].workflow.outputs.length >= 1);
});

test("service: prompt-board query field is resolved on backend (json path)", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(init.method || "GET").toUpperCase(), "GET");
    assert.ok(init.signal);
    return new Response(JSON.stringify({ data: { value: "hello" } }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });

  const preview = await service.previewThreadPromptBoard("thread-aki", {
    text: "ping",
    modules: [
      {
        id: "pb.query",
        title: "Query",
        description: "",
        enabled: true,
        order: 1,
        template: "Q={{fields.q}}",
        contentOverride: null,
        kind: "template",
        fields: [
          {
            id: "q",
            sourceType: "query",
            source: "http://example.invalid/value",
            path: "data.value",
            value: "FALLBACK",
          },
        ],
        workflow: { mode: "parallel", nodeType: "context.block", inputs: [], outputs: ["context.block"] },
      },
    ],
  });

  assert.equal(preview.finalText, "Q=hello");
});

test("service: prompt-board query field falls back to value when json path is missing", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ data: { other: "nope" } }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });

  const preview = await service.previewThreadPromptBoard("thread-aki", {
    text: "ping",
    modules: [
      {
        id: "pb.query",
        enabled: true,
        order: 1,
        template: "Q={{fields.q}}",
        contentOverride: null,
        fields: [
          {
            id: "q",
            sourceType: "query",
            source: "http://example.invalid/missing",
            path: "data.value",
            value: "FALLBACK",
          },
        ],
      },
    ],
  });

  assert.equal(preview.finalText, "Q=FALLBACK");
});

test("service: prompt-board query field falls back to value when body is not json but path is configured", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("not-json", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });

  const preview = await service.previewThreadPromptBoard("thread-aki", {
    text: "ping",
    modules: [
      {
        id: "pb.query",
        enabled: true,
        order: 1,
        template: "Q={{fields.q}}",
        contentOverride: null,
        fields: [
          {
            id: "q",
            sourceType: "query",
            source: "http://example.invalid/not-json",
            path: "data.value",
            value: "FALLBACK",
          },
        ],
      },
    ],
  });

  assert.equal(preview.finalText, "Q=FALLBACK");
});

test("service: prompt-board query field falls back to value when backend fetch fails", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: "nope" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new SmallPhoneService({
    dataFile: tmpDataFile(),
    runtime: { mode: "mock" },
    artifactSync: { enabled: false },
  });

  const preview = await service.previewThreadPromptBoard("thread-aki", {
    text: "ping",
    modules: [
      {
        id: "pb.query",
        enabled: true,
        order: 1,
        template: "Q={{fields.q}}",
        contentOverride: null,
        fields: [
          { id: "q", sourceType: "query", source: "http://example.invalid/fail", path: "data.value", value: "FALLBACK" },
        ],
      },
    ],
  });

  assert.equal(preview.finalText, "Q=FALLBACK");
});
