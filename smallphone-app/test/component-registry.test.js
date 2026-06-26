const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SmallPhoneService } = require("../packages/domain/service");
const {
  readComponentRegistry,
  writeMenuOverridesDocument,
} = require("../packages/domain/component-registry");

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
  assert.ok(registry.components.find((component) => component.id === "hermes-webui"));
  assert.ok(registry.components.find((component) => component.id === "cloudcli" && component.title === "CC/Codex"));
  assert.ok(registry.appInstances.find((instance) => instance.appId === "controlled-browser"));
  assert.equal(registry.menuRegistry.homeTarget, "hermes-webui");
  assert.ok(registry.menuRegistry.quickEntries.find((entry) => entry.id === "hermes-webui" && entry.home));
  const messages = registry.menuRegistry.items.find((entry) => entry.id === "messages");
  assert.equal(messages.entry.type, "webview");
  assert.equal(messages.entry.url, "http://127.0.0.1:22082/");
  assert.equal(messages.controlEntry.type, "service-control");
  assert.deepEqual(messages.controlEntry.serviceNames, ["smallphone-core", "smallphone-frontend-beta"]);
  assert.equal(registry.menuRegistry.serviceIndex["smallphone-frontend-beta"].url, "http://127.0.0.1:22082/");
  assert.equal(registry.menuRegistry.serviceIndex["smallphone-core"].url, "http://127.0.0.1:22000/");
  assert.equal(registry.menuRegistry.serviceIndex.cloudcli.componentId, "cloudcli");
  assert.equal(registry.menuRegistry.serviceIndex.cloudcli.url, "http://127.0.0.1:23083/");
});

test("component registry: final menu protects builtin entries and applies user home override", () => {
  const componentsDir = tmpDir("smallphone-components-protected-");
  const overridesFile = path.join(tmpDir("smallphone-menu-overrides-"), "menu-overrides.json");
  fs.writeFileSync(
    path.join(componentsDir, "hermes-webui.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "hermes-webui",
      title: "Hermes Extension",
      kind: "ai-partner",
      shellMenu: {
        visible: false,
        section: "ai",
        order: 5,
        entry: { type: "webview", url: "http://127.0.0.1:23084/" },
      },
      smallphoneApp: {
        visible: false,
        section: "ai",
        order: 5,
        entry: { type: "webview", url: "http://127.0.0.1:23084/" },
      },
      serviceManager: {
        services: [
          {
            name: "hermes-webui",
            serviceRef: "service-manager://services/hermes-webui",
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
          },
        ],
      },
      ai: { visible: true },
    }),
    "utf8",
  );
  fs.writeFileSync(
    overridesFile,
    JSON.stringify({
      homeTarget: "cloudcli",
      favorites: ["cloudcli"],
      items: {
        "controlled-browser": { visible: false },
      },
    }),
    "utf8",
  );

  try {
    const registry = readComponentRegistry({ dir: componentsDir, menuOverridesFile: overridesFile });
    const hermes = registry.menuRegistry.items.find((item) => item.id === "hermes-webui");
    const cloudcli = registry.menuRegistry.items.find((item) => item.id === "cloudcli");
    const controlledBrowser = registry.menuRegistry.items.find((item) => item.id === "controlled-browser");

    assert.equal(hermes.protected, true);
    assert.equal(hermes.visible, true);
    assert.equal(hermes.source, "builtin+extension");
    assert.equal(registry.menuRegistry.homeTarget, "cloudcli");
    assert.equal(cloudcli.title, "CC/Codex");
    assert.equal(cloudcli.home, true);
    assert.equal(cloudcli.serviceNames.includes("cloudcli"), true);
    assert.equal(controlledBrowser.visible, false);
  } finally {
    fs.rmSync(componentsDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(overridesFile), { recursive: true, force: true });
  }
});

test("component registry: menu overrides writer updates home target safely", () => {
  const componentsDir = path.join(tmpDir("smallphone-components-writer-"), "missing-components");
  const overridesFile = path.join(tmpDir("smallphone-menu-writer-"), "menu-overrides.json");

  try {
    const written = writeMenuOverridesDocument({
      homeTarget: "cloudcli",
      favorites: ["cloudcli"],
      items: {
        cloudcli: {
          title: "CC/Codex",
          favorite: true,
        },
      },
    }, { menuOverridesFile: overridesFile });
    assert.equal(written.homeTarget, "cloudcli");
    assert.deepEqual(written.favorites, ["cloudcli"]);

    const registry = readComponentRegistry({ dir: componentsDir, menuOverridesFile: overridesFile });
    assert.equal(registry.menuRegistry.homeTarget, "cloudcli");
    assert.equal(registry.menuRegistry.items.find((item) => item.id === "cloudcli").home, true);
  } finally {
    fs.rmSync(path.dirname(componentsDir), { recursive: true, force: true });
    fs.rmSync(path.dirname(overridesFile), { recursive: true, force: true });
  }
});

test("component registry: menu overrides preserve top-level url and control entry", () => {
  const componentsDir = path.join(tmpDir("smallphone-components-menu-url-"), "missing-components");
  const overridesFile = path.join(tmpDir("smallphone-menu-url-writer-"), "menu-overrides.json");
  const overrideUrl = "http://127.0.0.1:23999/workspace";
  const overrideRef = "service-manager://services/cloudcli";

  try {
    const written = writeMenuOverridesDocument({
      items: {
        cloudcli: {
          title: "CC/Codex Local",
          url: overrideUrl,
          controlEntry: {
            type: "service-control",
            serviceNames: ["cloudcli"],
            serviceRefs: [overrideRef],
          },
          visible: true,
          favorite: true,
          home: true,
        },
      },
    }, { menuOverridesFile: overridesFile });

    assert.equal(written.items.cloudcli.title, "CC/Codex Local");
    assert.equal(written.items.cloudcli.url, overrideUrl);
    assert.deepEqual(written.items.cloudcli.controlEntry.serviceNames, ["cloudcli"]);
    assert.deepEqual(written.items.cloudcli.controlEntry.serviceRefs, [overrideRef]);

    const registry = readComponentRegistry({ dir: componentsDir, menuOverridesFile: overridesFile });
    const cloudcli = registry.menuRegistry.items.find((item) => item.id === "cloudcli");

    assert.equal(registry.menuRegistry.homeTarget, "cloudcli");
    assert.equal(cloudcli.title, "CC/Codex Local");
    assert.equal(cloudcli.entry.type, "webview");
    assert.equal(cloudcli.entry.url, overrideUrl);
    assert.equal(cloudcli.visible, true);
    assert.equal(cloudcli.favorite, true);
    assert.equal(cloudcli.home, true);
    assert.equal(cloudcli.controlEntry.type, "service-control");
    assert.deepEqual(cloudcli.controlEntry.serviceNames, ["cloudcli"]);
    assert.ok(cloudcli.controlEntry.serviceRefs.includes(overrideRef));
    assert.equal(registry.menuRegistry.serviceIndex.cloudcli.serviceRef, overrideRef);
  } finally {
    fs.rmSync(path.dirname(componentsDir), { recursive: true, force: true });
    fs.rmSync(path.dirname(overridesFile), { recursive: true, force: true });
  }
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

    assert.equal(registry.staticAppControls.hiddenAppIds.includes("messages"), false);
    assert.ok(registry.components.find((component) => component.id === "messages" && component.smallphoneApp.visible === true));
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
