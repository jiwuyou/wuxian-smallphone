const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");

const PROJECT_NAME = "smallphone-contact-aki";
const MANAGEMENT_URL = "http://127.0.0.1:9840";
const MANAGEMENT_TOKEN = "management-token";

function tmpDataFile() {
  return path.join(os.tmpdir(), `smallphone-runtime-project-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function createTestService() {
  const dataFile = tmpDataFile();
  const service = new SmallPhoneService({
    dataFile,
    runtime: {
      mode: "cc-webclient",
      ccConnectProject: PROJECT_NAME,
    },
    permissions: {
      ccConnectManagementUrl: MANAGEMENT_URL,
      ccConnectManagementToken: MANAGEMENT_TOKEN,
    },
    artifactSync: { enabled: false },
  });
  service.store.update((state) => {
    const thread = state.threads.find((item) => item.id === "thread-aki");
    assert.ok(thread);
    thread.runtime = {
      ...(thread.runtime || {}),
      provider: "cc-webclient",
      project: PROJECT_NAME,
      agentType: "codex",
      workspaceDir: "/workspace/local-old",
    };
    return state;
  });
  return { service, dataFile };
}

function installFetchStub(t, handler) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const result = await handler(call, calls.length);
    const status = Number.isFinite(Number(result?.status)) ? Number(result.status) : 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(result?.body ?? { ok: true, data: {} });
      },
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  return calls;
}

function projectResponse(overrides = {}) {
  return {
    name: PROJECT_NAME,
      mode: "auto-edit",
      work_dir: "/workspace/project",
      show_context_indicator: true,
      reply_footer: true,
      admin_from: "ops",
      disabled_commands: ["rm", "shutdown"],
    token: "secret-token",
    authorization: "Bearer secret-token",
    management_url: "http://127.0.0.1:9840?token=secret-token",
    ...overrides,
  };
}

test("runtime project settings GET maps cc-connect fields and sanitizes response", async (t) => {
  const { service, dataFile } = createTestService();
  const calls = installFetchStub(t, (call) => {
    assert.equal(call.method, "GET");
    return { body: { ok: true, data: projectResponse() } };
  });
  t.after(() => fs.rmSync(dataFile, { force: true }));

  const result = await service.getThreadRuntimeProjectSettings("thread-aki");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${MANAGEMENT_URL}/api/v1/projects/${PROJECT_NAME}`);
  assert.equal(calls[0].headers.authorization, `Bearer ${MANAGEMENT_TOKEN}`);
  assert.deepEqual(result, {
    ok: true,
    available: true,
    skipped: false,
    threadId: "thread-aki",
    project: PROJECT_NAME,
    settings: {
      mode: "auto-edit",
      agentMode: "auto-edit",
      workDir: "/workspace/project",
      showContextIndicator: true,
      replyFooter: true,
      adminFrom: "ops",
      disabledCommands: ["rm", "shutdown"],
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes(MANAGEMENT_TOKEN), false);
  assert.equal(serialized.includes(MANAGEMENT_URL), false);
});

test("runtime project settings PATCH sends only allowed fields and syncs local mode/work_dir", async (t) => {
  const { service, dataFile } = createTestService();
  const calls = installFetchStub(t, (call) => {
    if (call.method === "PATCH") {
      return { body: { ok: true, data: { updated: true } } };
    }
    return {
      body: {
        ok: true,
        data: projectResponse({
          mode: "full-auto",
          work_dir: "/workspace/project-new",
          show_context_indicator: false,
          reply_footer: false,
          admin_from: "admin@example.test",
          disabled_commands: ["rm", "curl"],
        }),
      },
    };
  });
  t.after(() => fs.rmSync(dataFile, { force: true }));

  const result = await service.saveThreadRuntimeProjectSettings("thread-aki", {
    agentMode: "full-auto",
    work_dir: "/workspace/project-new",
    showContextIndicator: false,
    reply_footer: false,
    adminFrom: "admin@example.test",
    disabledCommands: ["rm", "curl", "rm", "", null],
    token: "do-not-send",
    authorization: "Bearer do-not-send",
    managementUrl: "http://example.invalid/secret",
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, `${MANAGEMENT_URL}/api/v1/projects/${PROJECT_NAME}`);
  assert.equal(calls[0].headers.authorization, `Bearer ${MANAGEMENT_TOKEN}`);
  assert.deepEqual(calls[0].body, {
    mode: "full-auto",
    work_dir: "/workspace/project-new",
    show_context_indicator: false,
    reply_footer: false,
    admin_from: "admin@example.test",
    disabled_commands: ["rm", "curl"],
  });
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].url, `${MANAGEMENT_URL}/api/v1/projects/${PROJECT_NAME}`);
  assert.deepEqual(result.settings, {
    mode: "full-auto",
    agentMode: "full-auto",
    workDir: "/workspace/project-new",
    showContextIndicator: false,
    replyFooter: false,
    adminFrom: "admin@example.test",
    disabledCommands: ["rm", "curl"],
  });
  assert.equal(JSON.stringify(result).includes("secret-token"), false);

  const state = service.store.read();
  const thread = state.threads.find((item) => item.id === "thread-aki");
  const contact = state.contacts.find((item) => item.id === thread.contactId);
  const character = state.characters.find((item) => item.id === contact.characterId);
  assert.equal(thread.runtime.workspaceDir, "/workspace/project-new");
  assert.equal(character.permissionPolicy.agentMode, "full-auto");
  assert.equal(character.permissionPolicy.template, "trusted");
});
