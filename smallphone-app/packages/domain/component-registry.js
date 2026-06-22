const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_COMPONENTS_DIR = path.join(os.homedir(), ".config", "openhouseai", "components.d");
const DEFAULT_CONTROLLED_BROWSER_URL = "http://127.0.0.1:23080/";
const SERVICE_MANAGER_REF_PREFIX = "service-manager://";
const FORBIDDEN_MANIFEST_KEYS = new Set(["command", "shell", "script", "args"]);
const STATIC_APP_ALIASES = {
  chat: "messages",
};
const KNOWN_STATIC_APP_IDS = new Set([
  "messages",
  "sillytavern",
]);
const CONTROL_CAPABILITIES = new Set(["status", "start", "stop", "restart", "logs", "repair"]);

function readComponentRegistry(options = {}) {
  const dir = resolveComponentRegistryDir(options);
  const errors = [];
  const byId = new Map(defaultComponentManifests(options).map((component) => [component.id, component]));

  for (const filePath of listRegistryFiles(dir, errors)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const component = normalizeComponentManifest(parsed, { sourcePath: filePath });
      if (component) {
        byId.set(component.id, component);
      }
    } catch (error) {
      errors.push({
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const components = [...byId.values()].sort((a, b) => {
    const orderDelta = Number(a.smallphoneApp?.order || 0) - Number(b.smallphoneApp?.order || 0);
    if (orderDelta) return orderDelta;
    return String(a.title || a.id).localeCompare(String(b.title || b.id));
  });

  const apps = [];
  const appInstances = [];
  const hiddenAppIds = new Set();

  for (const component of components) {
    const smallphoneApp = component.smallphoneApp || {};
    const staticAppId = normalizeStaticAppId(smallphoneApp.staticAppId || smallphoneApp.appId);
    if (smallphoneApp.visible === false && staticAppId) {
      hiddenAppIds.add(staticAppId);
      continue;
    }
    if (smallphoneApp.visible === false || staticAppId) {
      continue;
    }
    const dynamic = createDynamicRegistryRecords(component);
    if (!dynamic) {
      continue;
    }
    apps.push(dynamic.app);
    appInstances.push(dynamic.appInstance);
  }

  return {
    sourceDir: dir,
    generatedAt: new Date().toISOString(),
    components,
    apps,
    appInstances,
    staticAppControls: {
      hiddenAppIds: [...hiddenAppIds].sort(),
    },
    errors,
  };
}

function resolveComponentRegistryDir(options = {}) {
  return String(
    options.dir ||
      options.componentRegistryDir ||
      options.env?.SMALLPHONE_COMPONENTS_DIR ||
      process.env.SMALLPHONE_COMPONENTS_DIR ||
      DEFAULT_COMPONENTS_DIR,
  ).trim() || DEFAULT_COMPONENTS_DIR;
}

function listRegistryFiles(dir, errors) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    errors.push({
      file: dir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function defaultComponentManifests(options = {}) {
  const controlledBrowserUrl = String(
    options.controlledBrowserUrl ||
      options.env?.SMALLPHONE_CONTROLLED_BROWSER_URL ||
      process.env.SMALLPHONE_CONTROLLED_BROWSER_URL ||
      DEFAULT_CONTROLLED_BROWSER_URL,
  ).trim();
  return [
    normalizeComponentManifest({
      schemaVersion: 1,
      id: "messages",
      title: "消息",
      description: "AI conversations with Claude Code, OpenCode, and Codex contacts.",
      kind: "core-app",
      shellMenu: {
        visible: true,
        section: "smallphone",
        order: 10,
        entry: {
          type: "webview",
          url: "http://127.0.0.1:22082/",
        },
      },
      smallphoneApp: {
        visible: true,
        section: "desktop",
        order: 10,
        staticAppId: "messages",
        icon: "message-circle",
        entry: {
          type: "native-view",
          view: "messages",
        },
      },
      serviceManager: {
        required: false,
        services: [],
      },
      ai: {
        visible: true,
        summaryDoc: "/root/.config/openhouseai/ai-docs/smallphone/openhouse.ai.md#messages",
        capabilities: "/root/.config/openhouseai/ai-docs/smallphone/capabilities.json",
      },
    }),
    normalizeComponentManifest({
      schemaVersion: 1,
      id: "sillytavern",
      title: "SillyTavern",
      description: "SillyTavern installer and launcher in SmallPhone.",
      kind: "ai-partner",
      shellMenu: {
        visible: true,
        section: "ai",
        order: 50,
        entry: {
          type: "webview",
          url: "http://127.0.0.1:8000/",
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["smallphone-sillytavern"],
        },
      },
      smallphoneApp: {
        visible: true,
        section: "ai",
        order: 50,
        staticAppId: "sillytavern",
        icon: "sparkles",
        entry: {
          type: "native-view",
          view: "sillytavern",
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["smallphone-sillytavern"],
        },
      },
      serviceManager: {
        required: true,
        services: [
          {
            name: "smallphone-sillytavern",
            title: "SillyTavern",
            role: "web",
            port: 8000,
            url: "http://127.0.0.1:8000/",
            serviceRef: "service-manager://services/smallphone-sillytavern",
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/smallphone-sillytavern.repair",
          },
        ],
      },
      ai: {
        visible: true,
        summaryDoc: "/root/.config/openhouseai/ai-docs/smallphone/openhouse.ai.md#sillytavern",
        capabilities: "/root/.config/openhouseai/ai-docs/smallphone/capabilities.json",
      },
    }),
    normalizeComponentManifest({
      schemaVersion: 1,
      id: "controlled-browser",
      title: "受控浏览器",
      description: "A WebView browser that can be controlled through the registered browser service.",
      kind: "controlled-browser",
      shellMenu: {
        visible: Boolean(controlledBrowserUrl),
        section: "tools",
        order: 60,
        entry: {
          type: "webview",
          url: controlledBrowserUrl,
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["controlled-browser"],
        },
      },
      smallphoneApp: {
        visible: Boolean(controlledBrowserUrl),
        section: "tools",
        order: 60,
        icon: "globe",
        entry: {
          type: "webview",
          url: controlledBrowserUrl,
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["controlled-browser"],
        },
      },
      serviceManager: {
        required: true,
        services: [
          {
            name: "controlled-browser",
            title: "受控浏览器",
            role: "web",
            port: 23080,
            url: controlledBrowserUrl,
            serviceRef: "service-manager://services/controlled-browser",
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/controlled-browser.repair",
          },
        ],
      },
      ai: {
        visible: true,
        summaryDoc: "/root/.config/openhouseai/ai-docs/smallphone/openhouse.ai.md#controlled-browser",
        capabilities: "/root/.config/openhouseai/ai-docs/smallphone/capabilities.json",
      },
    }),
  ].filter(Boolean);
}

function normalizeComponentManifest(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const id = normalizePublicId(input.id || input.componentId || input.component_id);
  if (!id || hasForbiddenManifestKey(input)) {
    return null;
  }

  const smallphoneApp = normalizeSmallphoneApp(input.smallphoneApp || input.smallphone_app, id);
  if (!smallphoneApp) {
    return null;
  }

  const serviceManager = normalizeServiceManagerLayer(input.serviceManager || input.service_manager);
  const serviceNames = serviceManager.services.map((service) => service.name).filter(Boolean);
  const controlEntry = normalizeSmallphoneControlEntry(smallphoneApp.controlEntry, serviceNames);
  const title = normalizeString(input.title || input.name || id) || id;

  return {
    schemaVersion: 1,
    id,
    title,
    name: normalizeString(input.name || title) || title,
    description: normalizeString(input.description),
    kind: normalizeString(input.kind || "app") || "app",
    source: "component-registry",
    sourcePath: normalizeString(options.sourcePath),
    shellMenu: normalizeShellMenu(input.shellMenu || input.shell_menu),
    smallphoneApp: {
      ...smallphoneApp,
      ...(controlEntry ? { controlEntry } : {}),
    },
    serviceManager,
    ai: normalizeAiLayer(input.ai),
    visible: smallphoneApp.visible,
    section: smallphoneApp.section,
    order: smallphoneApp.order,
    staticAppId: smallphoneApp.staticAppId,
    entry: smallphoneApp.entry,
    icon: smallphoneApp.icon,
    services: serviceManager.services,
    aiDocs: normalizeString(input.ai?.summaryDoc || input.ai?.summary_doc),
    capabilities: normalizeString(input.ai?.capabilities),
  };
}

function normalizeSmallphoneApp(value, componentId) {
  if (!isPlainObject(value)) {
    return null;
  }
  const rawEntry = isPlainObject(value.entry) ? value.entry : {};
  const entryUrl = normalizeUrlLike(rawEntry.url || rawEntry.href || rawEntry.uri);
  const entryType = normalizeString(rawEntry.type || (entryUrl ? "webview" : ""));
  const entryView = normalizePublicId(rawEntry.view || rawEntry.nativeView || rawEntry.native_view);
  const staticAppId = normalizeStaticAppId(
    value.staticAppId ||
      value.static_app_id ||
      value.appId ||
      value.app_id ||
      (entryType === "native-view" ? entryView : "") ||
      inferStaticAppId(componentId),
  );
  const resolvedEntryType = normalizeEntryType(entryType || (staticAppId ? "native-view" : "webview"));
  const visible = normalizeVisible(value.visible, value.enabled);

  if (resolvedEntryType === "webview" && !entryUrl) {
    return null;
  }
  if (resolvedEntryType === "native-view" && !entryView && !staticAppId) {
    return null;
  }

  return {
    visible,
    section: normalizeString(value.section || "apps") || "apps",
    order: normalizeFiniteNumber(value.order, 100),
    staticAppId,
    icon: normalizeString(value.icon),
    entry: {
      type: resolvedEntryType,
      url: resolvedEntryType === "webview" ? entryUrl : "",
      view: resolvedEntryType === "native-view" ? (entryView || staticAppId) : "",
    },
    controlEntry: isPlainObject(value.controlEntry || value.control_entry)
      ? (value.controlEntry || value.control_entry)
      : null,
  };
}

function normalizeShellMenu(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const rawEntry = isPlainObject(value.entry) ? value.entry : {};
  const rawControlEntry = isPlainObject(value.controlEntry || value.control_entry)
    ? (value.controlEntry || value.control_entry)
    : null;
  return {
    visible: normalizeVisible(value.visible, value.enabled),
    section: normalizeString(value.section),
    order: normalizeFiniteNumber(value.order, 100),
    entry: {
      type: normalizeEntryType(rawEntry.type),
      url: normalizeUrlLike(rawEntry.url || rawEntry.href || rawEntry.uri),
      view: normalizePublicId(rawEntry.view || rawEntry.nativeView || rawEntry.native_view),
    },
    controlEntry: rawControlEntry ? normalizeSmallphoneControlEntry(rawControlEntry, []) : null,
  };
}

function normalizeServiceManagerLayer(value) {
  const layer = isPlainObject(value) ? value : {};
  const services = Array.isArray(layer.services)
    ? layer.services.map(normalizeServiceManagerService).filter(Boolean)
    : [];
  return {
    required: Boolean(layer.required) || services.length > 0,
    services,
  };
}

function normalizeServiceManagerService(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const name = normalizePublicId(value.name || value.id || value.serviceId || value.service_id);
  if (!name) {
    return null;
  }
  const serviceRef = normalizeServiceManagerRef(value.serviceRef || value.service_ref || `service-manager://services/${name}`);
  if (!serviceRef) {
    return null;
  }
  const url = normalizeUrlLike(value.url || value.openUrl || value.open_url);
  return {
    id: name,
    name,
    title: normalizeString(value.title || value.name || name) || name,
    role: normalizeString(value.role),
    port: normalizeFiniteNumber(value.port, null),
    url,
    serviceRef,
    health: normalizeHealth(value.health),
    controls: normalizeControls(value.controls),
    repairActionRef: normalizeServiceManagerRef(value.repairActionRef || value.repair_action_ref),
  };
}

function normalizeSmallphoneControlEntry(value, serviceNames = []) {
  const control = isPlainObject(value) ? value : null;
  const serviceNameValues = Array.isArray(control?.serviceNames || control?.service_names)
    ? (control.serviceNames || control.service_names)
    : serviceNames;
  const normalizedNames = serviceNameValues.map(normalizePublicId).filter(Boolean);
  if (!control && !normalizedNames.length) {
    return null;
  }
  const type = normalizeString(control?.type || "service-control");
  if (type !== "service-control" || !normalizedNames.length) {
    return null;
  }
  return {
    type: "service-control",
    serviceNames: [...new Set(normalizedNames)].sort(),
  };
}

function normalizeAiLayer(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const intents = Array.isArray(value.intents)
    ? value.intents
        .filter(isPlainObject)
        .map((intent) => ({
          name: normalizePublicId(intent.name),
          target: normalizeString(intent.target),
        }))
        .filter((intent) => intent.name && intent.target)
    : [];
  return {
    visible: normalizeVisible(value.visible, value.enabled),
    summaryDoc: normalizeString(value.summaryDoc || value.summary_doc),
    capabilities: normalizeString(value.capabilities),
    intents,
  };
}

function createDynamicRegistryRecords(component) {
  const smallphoneApp = component.smallphoneApp || {};
  const url = normalizeUrlLike(smallphoneApp.entry?.url);
  if (!url) {
    return null;
  }
  const services = Array.isArray(component.serviceManager?.services) ? component.serviceManager.services : [];
  const primaryService = services[0] || null;
  const now = new Date().toISOString();
  return {
    app: {
      id: component.id,
      name: component.name || component.title,
      title: component.title || component.name || component.id,
      source: "component-registry",
      kind: component.kind || "app",
      entry: url,
      icon: smallphoneApp.icon || "",
      version: "",
      services,
      ...(primaryService ? { service: primaryService } : {}),
      createdAt: now,
      updatedAt: now,
    },
    appInstance: {
      id: `component-${component.id}`,
      appId: component.id,
      title: component.title || component.name || component.id,
      source: "component-registry",
      settings: {
        url,
        ...(primaryService?.name ? { serviceId: primaryService.name } : {}),
        ...(primaryService?.serviceRef ? { serviceRef: primaryService.serviceRef } : {}),
        ...(smallphoneApp.controlEntry ? { controlEntry: smallphoneApp.controlEntry } : {}),
      },
      state: {
        componentId: component.id,
        kind: component.kind || "app",
      },
      services,
      ...(primaryService ? { service: primaryService } : {}),
      createdAt: now,
      updatedAt: now,
    },
  };
}

function normalizeVisible(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["false", "0", "no", "off", "hidden"].includes(normalized)) return false;
      if (["true", "1", "yes", "on", "visible"].includes(normalized)) return true;
    }
  }
  return true;
}

function inferStaticAppId(id) {
  const normalized = normalizePublicId(id);
  const aliased = STATIC_APP_ALIASES[normalized] || normalized;
  return KNOWN_STATIC_APP_IDS.has(aliased) ? aliased : "";
}

function normalizeStaticAppId(value) {
  const id = normalizePublicId(value);
  if (!id) return "";
  return STATIC_APP_ALIASES[id] || id;
}

function normalizeHealth(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const type = normalizeString(value.type);
  const url = normalizeUrlLike(value.url);
  if (!type && !url) {
    return null;
  }
  return {
    type,
    url,
  };
}

function normalizeControls(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const controls = raw
    .map((control) => normalizeString(control).toLowerCase())
    .filter((control) => CONTROL_CAPABILITIES.has(control));
  return [...new Set(controls)];
}

function normalizeServiceManagerRef(value) {
  const raw = normalizeString(value);
  if (!raw || !raw.startsWith(SERVICE_MANAGER_REF_PREFIX)) {
    return "";
  }
  return raw.replace(/[\s"'<>`]/g, "");
}

function normalizeEntryType(value) {
  const type = normalizeString(value);
  if (type === "native-view" || type === "webview") {
    return type;
  }
  if (type === "native") {
    return "native-view";
  }
  return "";
}

function normalizeUrlLike(value) {
  const raw = normalizeString(value);
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "";
  }
}

function hasForbiddenManifestKey(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasForbiddenManifestKey);
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MANIFEST_KEYS.has(key)) {
      return true;
    }
    if (hasForbiddenManifestKey(child)) {
      return true;
    }
  }
  return false;
}

function normalizePublicId(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9:_-]/g, "-");
}

function normalizeFiniteNumber(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  DEFAULT_COMPONENTS_DIR,
  readComponentRegistry,
  normalizeComponentManifest,
};
