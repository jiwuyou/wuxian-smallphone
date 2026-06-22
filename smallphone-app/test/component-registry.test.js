const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const { readComponentRegistry } = require("../packages/domain/component-registry");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("component registry: falls back to core apps and controlled browser", () => {
  const dir = path.join(tmpDir("smallphone-components-empty-"), "missing-components");
  const registry = readComponentRegistry({ dir });

  assert.equal(registry.errors.length, 0);
  assert.ok(registry.components.find((component) => component.id === "messages" && component.smallphoneApp.staticAppId === "messages"));
  assert.ok(registry.components.find((component) => component.id === "sillytavern" && component.smallphoneApp.staticAppId === "sillytavern"));
  assert.ok(registry.components.find((component) => component.id === "controlled-browser"));
  assert.ok(registry.appInstances.find((instance) => instance.appId === "controlled-browser"));
});

test("component registry: SmallPhone consumes only smallphoneApp from four-layer manifests", () => {
  const home = tmpDir("smallphone-home-");
  const componentsDir = tmpDir("smallphone-components-");
  fs.writeFileSync(
    path.join(componentsDir, "messages.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "messages",
      title: "消息",
      shellMenu: {
        visible: true,
        entry: { type: "webview", url: "http://127.0.0.1:22082/" },
      },
      smallphoneApp: {
        visible: false,
        staticAppId: "messages",
        entry: { type: "native-view", view: "messages" },
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(componentsDir, "hermes-webui.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "hermes-webui",
      title: "Hermes",
      kind: "ai-partner",
      shellMenu: {
        visible: true,
        section: "ai",
        order: 40,
        entry: {
          type: "webview",
          url: "http://127.0.0.1:23084/",
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["hermes-webui"],
        },
      },
      smallphoneApp: {
        visible: true,
        section: "ai",
        order: 40,
        icon: "sparkles",
        entry: {
          type: "webview",
          url: "http://127.0.0.1:23084/",
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["hermes-webui"],
        },
      },
      serviceManager: {
        required: true,
        services: [
          {
            name: "hermes-webui",
            title: "Hermes WebUI",
            role: "web",
            port: 23084,
            url: "http://127.0.0.1:23084/",
            serviceRef: "service-manager://services/hermes-webui",
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/hermes-webui.repair",
          },
        ],
      },
      ai: {
        visible: true,
        summaryDoc: "/root/.config/openhouseai/ai-docs/hermes-webui/openhouse.ai.md",
        capabilities: "/root/.config/openhouseai/ai-docs/hermes-webui/capabilities.json",
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(componentsDir, "legacy-menu-only.json"),
    JSON.stringify({
      id: "legacy-menu-only",
      title: "Legacy",
      menu: {
        entry: {
          type: "webview",
          url: "http://127.0.0.1:29999/",
        },
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(componentsDir, "forbidden.json"),
    JSON.stringify({
      id: "forbidden",
      title: "Forbidden",
      smallphoneApp: {
        entry: { type: "webview", url: "http://127.0.0.1:29998/" },
      },
      command: "must-not-leak",
      env: {
        SECRET_TOKEN: "must-not-leak",
      },
    }),
    "utf8",
  );

  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      componentRegistryDir: componentsDir,
      runtime: { mode: "mock" },
    });
    const registry = service.getAppRegistry();

    assert.ok(registry.staticAppControls.hiddenAppIds.includes("messages"));
    assert.ok(registry.components.find((component) => component.id === "messages" && component.smallphoneApp.visible === false));
    assert.ok(registry.components.find((component) => component.id === "hermes-webui"));
    assert.equal(Boolean(registry.components.find((component) => component.id === "legacy-menu-only")), false);
    assert.equal(Boolean(registry.components.find((component) => component.id === "forbidden")), false);

    const app = registry.apps.find((item) => item.id === "hermes-webui");
    assert.equal(app.title, "Hermes");
    assert.equal(app.entry, "http://127.0.0.1:23084/");
    assert.equal(app.service.id, "hermes-webui");

    const instance = registry.appInstances.find((item) => item.id === "component-hermes-webui");
    assert.equal(instance.appId, "hermes-webui");
    assert.equal(instance.settings.url, "http://127.0.0.1:23084/");
    assert.equal(instance.settings.serviceId, "hermes-webui");
    assert.equal(instance.settings.serviceRef, "service-manager://services/hermes-webui");
    assert.equal(instance.settings.controlEntry.type, "service-control");

    const serialized = JSON.stringify(registry);
    assert.ok(!serialized.includes("must-not-leak"));
    assert.ok(!serialized.includes("SECRET_TOKEN"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(componentsDir, { recursive: true, force: true });
  }
});

test("components API exposes registry and AI capability documents", () => {
  const home = tmpDir("smallphone-ai-home-");
  const componentsDir = tmpDir("smallphone-ai-components-");
  const docsDir = path.join(componentsDir, "ai-docs", "example");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "openhouse.ai.md"), "# Example\n\nUse service-manager refs for repair.\n", "utf8");
  fs.writeFileSync(
    path.join(docsDir, "capabilities.json"),
    JSON.stringify({
      intents: ["open", "repair"],
      controls: ["status", "repair"],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(componentsDir, "example.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "example-ai",
      title: "Example AI",
      kind: "ai-partner",
      smallphoneApp: {
        visible: true,
        entry: { type: "webview", url: "http://127.0.0.1:23084/" },
      },
      serviceManager: {
        services: [
          {
            name: "example-ai",
            serviceRef: "service-manager://services/example-ai",
            controls: ["status", "repair"],
            repairActionRef: "service-manager://actions/example-ai.repair",
          },
        ],
      },
      ai: {
        visible: true,
        summaryDoc: "./ai-docs/example/openhouse.ai.md#example",
        capabilities: "./ai-docs/example/capabilities.json",
        intents: [
          { name: "open", target: "smallphoneApp.entry" },
          { name: "repair", target: "serviceManager.services.example-ai.repairActionRef" },
        ],
      },
    }),
    "utf8",
  );

  try {
    const service = new SmallPhoneService({
      smallphoneHome: home,
      componentRegistryDir: componentsDir,
      runtime: { mode: "mock" },
    });

    const components = service.getComponents();
    assert.ok(components.components.find((component) => component.id === "example-ai"));

    const capabilities = service.getAiCapabilities();
    const item = capabilities.components.find((component) => component.id === "example-ai");
    assert.ok(item);
    assert.match(item.ai.summary, /Use service-manager refs/);
    assert.equal(item.ai.summaryDocFragment, "example");
    assert.deepEqual(item.ai.capabilitiesDocument.intents, ["open", "repair"]);
    assert.equal(item.serviceManager.services[0].repairActionRef, "service-manager://actions/example-ai.repair");
    assert.equal(capabilities.errors.some((error) => String(error.file || "").includes("example")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(componentsDir, { recursive: true, force: true });
  }
});
