const test = require("node:test");
const assert = require("node:assert/strict");

const { createRuntimeAdapter, _test } = require("./index");

function makeJsonResponse(json, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return json;
    },
    async text() {
      return JSON.stringify(json ?? null);
    },
  };
}

test("openclaw-http adapter strips roster fields from outbound JSON", async (t) => {
  const originalFetch = global.fetch;
  let captured = null;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (_url, options = {}) => {
    captured = JSON.parse(String(options.body || "{}"));
    return makeJsonResponse({
      runtimeSessionId: "s1",
      runtimeSessionKey: "k1",
      assistantText: "ok",
      toolCalls: [],
    });
  };

  const runtime = createRuntimeAdapter({
    mode: "openclaw-http",
    baseUrl: "http://127.0.0.1:59999",
    timeoutMs: 2000,
  });

  const result = await runtime.sendTurn({
    runtimeSessionId: "r1",
    thread: { id: "t1", title: "Thread", runtime: { sessionKey: "sk", agentId: "main", workspaceDir: "/tmp/ws" } },
    contact: { id: "c1", displayName: "Alice" },
    character: { name: "Bob", persona: "persona" },
    relationship: { trust: 0.5, intimacy: 0.1, tension: 0.2 },
    memories: [],
    messages: [{ role: "user", content: "hello" }],
    turnContext: null,
    // Simulate an accidental "roster blob" on the runtime payload.
    contacts: [{ id: "c2", displayName: "ROSTER_CONTACT_SHOULD_NOT_LEAK" }],
    characters: [{ id: "ch2", name: "ROSTER_CHARACTER_SHOULD_NOT_LEAK" }],
    personas: [{ id: "p1", label: "ROSTER_PERSONA_SHOULD_NOT_LEAK" }],
  });

  assert.equal(result.runtimeSessionId, "s1");
  assert.equal(result.runtimeSessionKey, "k1");
  assert.equal(result.assistantText, "ok");

  assert.ok(captured, "expected outbound JSON body");
  assert.equal(captured.contacts, undefined);
  assert.equal(captured.characters, undefined);
  assert.equal(captured.personas, undefined);
  assert.deepEqual(captured.runtimeRouting, {
    agentId: "main",
    workspaceDir: "/tmp/ws",
    sessionKey: "sk",
    resumeSummary: "",
  });
});

test("openai-compatible adapter does not serialize roster fields into messages", async (t) => {
  const originalFetch = global.fetch;
  let captured = null;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (_url, options = {}) => {
    captured = JSON.parse(String(options.body || "{}"));
    return makeJsonResponse({
      id: "chatcmpl-1",
      choices: [{ message: { content: "ok" } }],
    });
  };

  const runtime = createRuntimeAdapter({
    mode: "openai-compatible",
    openaiBaseUrl: "http://127.0.0.1:59998/v1",
    openaiApiKey: "test-key",
    openaiModel: "test-model",
    timeoutMs: 2000,
  });

  const rosterMarker = "ROSTER_SHOULD_NOT_LEAK";
  await runtime.sendTurn({
    runtimeSessionId: "r1",
    thread: { id: "t1", title: "Thread", runtime: { sessionKey: "sk" } },
    contact: { id: "c1", displayName: "Alice" },
    character: { name: "Bob", persona: "persona" },
    relationship: { trust: 0.5, intimacy: 0.1, tension: 0.2 },
    memories: [],
    messages: [{ role: "user", content: "hello" }],
    turnContext: null,
    contacts: [{ id: "c2", displayName: rosterMarker }],
    characters: [{ id: "ch2", name: rosterMarker }],
  });

  assert.ok(captured, "expected outbound JSON body");
  assert.equal(captured.model, "test-model");
  assert.equal(Array.isArray(captured.messages), true);
  assert.doesNotMatch(JSON.stringify(captured), new RegExp(rosterMarker));
});

test("cc-connect adapter does not include roster fields in outbound prompt", async (t) => {
  const rosterMarker = "ROSTER_SHOULD_NOT_LEAK";
  const prompt = _test.buildRuntimePrompt({
    runtimeSessionId: "r1",
    thread: { id: "t1", title: "Thread", runtime: { sessionKey: "sk" } },
    contact: { id: "c1", displayName: "Alice" },
    character: { name: "Bob", persona: "persona" },
    relationship: { trust: 0.5, intimacy: 0.1, tension: 0.2 },
    memories: [],
    messages: [{ role: "user", content: "hello" }],
    turnContext: null,
    contacts: [{ id: "c2", displayName: rosterMarker }],
    characters: [{ id: "ch2", name: rosterMarker }],
  });

  assert.match(prompt, /Character:\s*Bob/);
  assert.match(prompt, /Contact:\s*Alice/);
  assert.doesNotMatch(prompt, new RegExp(rosterMarker));
});
