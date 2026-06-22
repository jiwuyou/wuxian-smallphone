const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const { _test: runtimeTest } = require("../packages/openclaw-adapter");
const { DEFAULT_CONTACT_ID } = require("../packages/shared/types");

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smallphone-home-"));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`server did not start: ${output}`));
    }, 5000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (settled || !output.includes("[smallphone] listening")) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited before listen code=${code} signal=${signal}: ${output}`));
    });
  });
}

function assertNoPromptConfigFields(value) {
  const forbidden = new Set([
    "persona",
    "workflowId",
    "workflowVersion",
    "workflowInput",
    "workflowInputs",
    "promptBoard",
    "systemPrompt",
    "system_prompt",
    "roleCard",
    "role_card",
  ]);
  const seen = new Set();
  const walk = (node, pathParts = []) => {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);
    for (const [key, child] of Object.entries(node)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      assert.equal(forbidden.has(key), false, `unexpected public prompt config field: ${[...pathParts, key].join(".")}`);
      assert.equal(normalized.startsWith("worldbook"), false, `unexpected public worldbook field: ${[...pathParts, key].join(".")}`);
      walk(child, [...pathParts, key]);
    }
  };
  walk(value);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test("workflows: service exposes required workflow definitions", () => {
  const home = tmpHome();
  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      runtime: { mode: "mock" },
    });
    const workflows = service.listWorkflows();
    const contactWorkflows = service.listContactWorkflows();

    assert.ok(Array.isArray(workflows) && workflows.length >= 2);
    assert.ok(Array.isArray(contactWorkflows) && contactWorkflows.length >= 2);
    assert.ok(workflows.find((wf) => wf.id === "smallphone.default.contact" && wf.version === 1));
    assert.ok(workflows.find((wf) => wf.id === "smallphone.task.agent" && wf.version === 1));

    const defaultWf = contactWorkflows.find((wf) => wf.id === "smallphone.default.contact" && wf.version === 1);
    assert.ok(defaultWf);
    assert.ok(Array.isArray(defaultWf.promptBoardDefaults?.modules));
    assert.ok(defaultWf.promptBoardDefaults.modules.length > 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("server: exposes /api/workflows and /api/contact-workflows", async (t) => {
  const home = tmpHome();
  let port = 0;
  try {
    port = await getFreePort();
  } catch (err) {
    if (String(err?.code) === "EPERM") {
      t.skip("network listen not permitted in this environment");
      fs.rmSync(home, { recursive: true, force: true });
      return;
    }
    throw err;
  }
  const child = spawn(process.execPath, ["./apps/core/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      SMALLPHONE_HOME: home,
      SMALLPHONE_HOST: "127.0.0.1",
      SMALLPHONE_HOSTS: "127.0.0.1",
      SMALLPHONE_PORT: String(port),
      SMALLPHONE_RUNTIME_MODE: "mock",
      SMALLPHONE_TASK_WORKER_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);
    const bootstrapRes = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
    assert.equal(bootstrapRes.status, 200);
    const bootstrap = await bootstrapRes.json();
    assert.ok(Array.isArray(bootstrap.workflows));
    assert.ok(bootstrap.workflows.find((wf) => wf.id === "smallphone.default.contact"));

    const workflowsRes = await fetch(`http://127.0.0.1:${port}/api/workflows`);
    assert.equal(workflowsRes.status, 200);
    const workflows = await workflowsRes.json();
    assert.ok(workflows.find((wf) => wf.id === "smallphone.default.contact"));

    const contactRes = await fetch(`http://127.0.0.1:${port}/api/contact-workflows`);
    assert.equal(contactRes.status, 200);
    const contactWorkflows = await contactRes.json();
    assert.ok(contactWorkflows.find((wf) => wf.id === "smallphone.task.agent"));
  } finally {
    await stopServer(child);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("companions: create/update materializes workflow inputs and rejects legacy fields", async () => {
  const home = tmpHome();
  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      runtime: { mode: "mock" },
    });

    await assert.rejects(
      () =>
        service.createCompanion({
          name: "Legacy",
          persona: "legacy persona",
          workflowId: "smallphone.default.contact",
          workflowVersion: 1,
          workflowInput: {
            contactProjectDir: "/tmp/smallphone-contact-legacy",
            contactPersona: "Contact persona",
            userPersona: "User persona",
          },
        }),
      (err) => String(err?.statusCode) === "400",
    );

    const created = await service.createCompanion({
      name: "WorkflowContact",
      displayName: "WorkflowContact",
      workflowId: "smallphone.default.contact",
      workflowVersion: 1,
      workflowInput: {
        contactProjectDir: "/tmp/smallphone-contact-workflow",
        contactPersona: "You are WorkflowContact. Reply concisely.",
        userPersona: "The user prefers bullet-point plans and minimal small talk.",
      },
    });

    assert.equal(created.thread.runtime.workspaceDir, "/tmp/smallphone-contact-workflow");
    assert.equal(Object.hasOwn(created.contact, "workflowInput"), false);
    assert.equal(Object.hasOwn(created.thread, "workflowInput"), false);
    assert.equal(Object.hasOwn(created.contact.character, "persona"), false);
    assertNoPromptConfigFields(created.contact);
    assertNoPromptConfigFields(created.thread);

    let state = service.store.read();
    let storedContact = state.contacts.find((item) => item.id === created.contact.id);
    let storedThread = state.threads.find((item) => item.contactId === created.contact.id);
    let storedCharacter = state.characters.find((item) => item.id === storedContact.characterId);
    assert.equal(storedCharacter.persona, "You are WorkflowContact. Reply concisely.");
    assert.equal(storedContact.workflowId, "smallphone.default.contact");
    assert.equal(storedContact.workflowVersion, 1);
    assert.equal(storedCharacter.workflowId, "smallphone.default.contact");
    assert.equal(storedCharacter.workflowVersion, 1);
    assert.equal(storedThread.workflowId, "smallphone.default.contact");
    assert.equal(storedThread.workflowVersion, 1);
    assert.equal(storedThread.workflowInput.userPersona, "The user prefers bullet-point plans and minimal small talk.");

    const updated = await service.updateCompanion(created.contact.id, {
      name: "WorkflowContact",
      workflowId: "smallphone.default.contact",
      workflowVersion: 1,
      workflowInput: {
        contactProjectDir: "/tmp/smallphone-contact-workflow-updated",
        contactPersona: "You are WorkflowContact v2.",
        userPersona: "User persona v2.",
      },
    });

    assert.equal(updated.thread.runtime.workspaceDir, "/tmp/smallphone-contact-workflow-updated");
    assert.equal(Object.hasOwn(updated.contact, "workflowInput"), false);
    assertNoPromptConfigFields(updated.contact);
    assertNoPromptConfigFields(updated.thread);

    state = service.store.read();
    const updatedContact = state.contacts.find((item) => item.id === created.contact.id);
    const updatedThread = state.threads.find((item) => item.contactId === created.contact.id);
    const updatedCharacter = state.characters.find((item) => item.id === updatedContact.characterId);
    assert.equal(updatedContact.workflowId, "smallphone.default.contact");
    assert.equal(updatedThread.workflowInput.userPersona, "User persona v2.");
    assert.equal(updatedCharacter.persona, "You are WorkflowContact v2.");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("companions: minimal no-prompt create derives internal workflow defaults and returns public payload", async () => {
  const home = tmpHome();
  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      runtime: { mode: "mock" },
    });

    const created = await service.createCompanion({
      name: "NoPrompt",
      agentType: "codex",
    });

    assert.equal(created.contact.displayName, "NoPrompt");
    assert.equal(created.thread.title, "NoPrompt");
    assert.equal(created.thread.runtime.agentType, "codex");
    assert.ok(created.thread.runtime.workspaceDir.endsWith(path.join("channel-workspaces", "channel-noprompt")));
    assert.equal(Object.hasOwn(created.contact, "workflowInput"), false);
    assert.equal(Object.hasOwn(created.thread, "workflowInput"), false);
    assert.equal(Object.hasOwn(created.contact.character, "persona"), false);
    assertNoPromptConfigFields(created.contact);
    assertNoPromptConfigFields(created.thread);

    const state = service.store.read();
    const storedContact = state.contacts.find((item) => item.id === created.contact.id);
    const storedThread = state.threads.find((item) => item.id === created.thread.id);
    const storedCharacter = state.characters.find((item) => item.id === storedContact.characterId);
    assert.equal(storedContact.workflowId, "smallphone.default.contact");
    assert.equal(storedThread.workflowVersion, 1);
    assert.equal(storedThread.workflowInput.contactProjectDir, created.thread.runtime.workspaceDir);
    assert.equal(storedThread.workflowInput.contactPersona, "");
    assert.equal(storedThread.workflowInput.userPersona, "");
    assert.equal(storedCharacter.persona, "");
    assert.equal(storedCharacter.permissionPolicy.agentMode, "suggest");
    assert.equal(storedCharacter.permissionPolicy.template, "safe");

    const reply = await service.sendMessage(created.thread.id, { text: "hello" });
    assert.equal(reply.userMessage.content, "hello");
    assert.equal(reply.assistantMessage.role, "assistant");

    const bootstrap = await service.bootstrapHydrated();
    assertNoPromptConfigFields(bootstrap.contacts.find((item) => item.id === created.contact.id));
    assertNoPromptConfigFields(bootstrap.threads.find((item) => item.id === created.thread.id));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("store normalization: backfills workflow fields for legacy companion records so partial updateCompanion works", async () => {
  const home = tmpHome();
  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      runtime: { mode: "mock" },
    });

    const seeded = service.store.read();
    const legacy = structuredClone(seeded);

    const contact = legacy.contacts.find((item) => item.id === DEFAULT_CONTACT_ID);
    const thread = legacy.threads.find((item) => item.contactId === DEFAULT_CONTACT_ID);
    const character = contact ? legacy.characters.find((item) => item.id === contact.characterId) : null;
    assert.ok(contact && thread && character);

    delete contact.workflowId;
    delete contact.workflowVersion;
    delete contact.workflowInput;
    delete thread.workflowId;
    delete thread.workflowVersion;
    delete thread.workflowInput;
    delete character.workflowId;
    delete character.workflowVersion;
    delete character.workflowInput;

    fs.writeFileSync(service.store.filePath, JSON.stringify(legacy, null, 2));

    const updated = await service.updateCompanion(DEFAULT_CONTACT_ID, {
      displayName: "Aki Legacy Updated",
    });

    assert.equal(updated.contact.displayName, "Aki Legacy Updated");
    assert.equal(Object.hasOwn(updated.contact, "workflowInput"), false);

    const normalized = service.store.read();
    const normalizedContact = normalized.contacts.find((item) => item.id === DEFAULT_CONTACT_ID);
    const normalizedThread = normalized.threads.find((item) => item.contactId === DEFAULT_CONTACT_ID);
    const normalizedCharacter = normalizedContact
      ? normalized.characters.find((item) => item.id === normalizedContact.characterId)
      : null;
    assert.ok(normalizedContact && normalizedThread && normalizedCharacter);
    assert.ok(normalizedContact.workflowId);
    assert.ok(normalizedContact.workflowVersion);
    assert.equal(normalizedContact.workflowInput?.userPersona, "");
    assert.ok(normalizedThread.workflowInput?.contactProjectDir);
    assert.equal(normalizedCharacter.workflowInput?.contactPersona, "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("runtime prompt: includes workflowInput.userPersona", () => {
  const prompt = runtimeTest.buildRuntimePrompt({
    runtimeSessionId: "r1",
    thread: {
      id: "thread-test",
      title: "Test Thread",
      runtime: { sessionKey: "smallphone:thread:thread-test" },
      workflowInput: {
        contactProjectDir: "/tmp/ignored",
        contactPersona: "ignored",
        userPersona: "User persona for prompt injection.",
      },
    },
    contact: { id: "c1", displayName: "Contact" },
    character: { id: "ch1", name: "Contact", persona: "Character persona" },
    relationship: { trust: 0.5, intimacy: 0.3, tension: 0.1 },
    memories: [],
    messages: [{ role: "user", content: "hi" }],
    timeContext: { block: "" },
    turnContext: null,
  });

  assert.ok(prompt.includes("User persona: User persona for prompt injection."));
});

test("user content: default includes workflows app", () => {
  const home = tmpHome();
  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      runtime: { mode: "mock" },
    });
    const content = service.getUserContent();
    assert.ok(content.apps.find((app) => app.id === "workflows"));
    assert.ok(content.appInstances.find((instance) => instance.id === "instance-workflows" && instance.appId === "workflows"));
    const defaultLayout = content.desktopLayouts.find((layout) => layout.id === "default");
    assert.ok(defaultLayout);
    assert.ok(defaultLayout.items.find((item) => item.instanceId === "instance-workflows"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("user content: existing default desktop layout backfills workflows app instance", () => {
  const home = tmpHome();
  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      runtime: { mode: "mock" },
    });
    const seeded = service.store.read();
    const legacy = structuredClone(seeded);
    legacy.appInstances = legacy.appInstances.filter((item) => item.id !== "instance-workflows");
    legacy.desktopLayouts = legacy.desktopLayouts.map((layout) =>
      layout.id === "default"
        ? {
            ...layout,
            items: layout.items.filter((item) => item.instanceId !== "instance-workflows"),
          }
        : layout,
    );
    fs.writeFileSync(service.store.filePath, JSON.stringify(legacy, null, 2));

    const content = service.getUserContent();

    assert.ok(content.apps.find((app) => app.id === "workflows"));
    assert.ok(content.appInstances.find((instance) => instance.id === "instance-workflows" && instance.appId === "workflows"));
    const defaultLayout = content.desktopLayouts.find((layout) => layout.id === "default");
    assert.ok(defaultLayout);
    assert.ok(defaultLayout.items.find((item) => item.instanceId === "instance-workflows"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
