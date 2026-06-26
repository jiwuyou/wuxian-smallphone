const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_COMPONENTS_DIR = path.join(os.homedir(), ".config", "openhouseai", "components.d");
const DEFAULT_MENU_OVERRIDES_FILE = path.join(os.homedir(), ".config", "openhouseai", "menu-overrides.json");
const DEFAULT_CONTROLLED_BROWSER_URL = "http://127.0.0.1:23080/";
const DEFAULT_HERMES_URL = "http://127.0.0.1:23084/";
const DEFAULT_CLOUDCLI_URL = "http://127.0.0.1:23083/";
const SERVICE_MANAGER_REF_PREFIX = "service-manager://";
const FORBIDDEN_MANIFEST_KEYS = new Set(["command", "shell", "script", "args"]);
const DEFAULT_HOME_TARGET = "hermes-webui";
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
  const overridesFile = resolveMenuOverridesFile(options);
  const errors = [];
  const byId = new Map();

  for (const component of defaultComponentManifests(options)) {
    if (!component?.id) continue;
    byId.set(component.id, {
      ...component,
      source: "builtin",
      protected: true,
    });
  }

  for (const filePath of listRegistryFiles(dir, errors)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const component = normalizeComponentManifest(parsed, { sourcePath: filePath });
      if (component) {
        const previous = byId.get(component.id) || null;
        if (previous?.protected) {
          byId.set(component.id, mergeProtectedBuiltinComponent(previous, component));
        } else {
          byId.set(component.id, {
            ...component,
            source: "extension",
          });
        }
      }
    } catch (error) {
      errors.push({
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const overrides = readMenuOverrides(overridesFile, errors);
  const components = [...byId.values()].map((component) => applyComponentOverride(component, overrides)).sort((a, b) => {
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

  const menuRegistry = buildFinalMenuRegistry(components, {
    overrides,
    sourceDir: dir,
    overridesFile,
  });

  return {
    sourceDir: dir,
    overridesFile,
    generatedAt: new Date().toISOString(),
    components,
    apps,
    appInstances,
    menuRegistry,
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

function resolveMenuOverridesFile(options = {}) {
  return String(
    options.menuOverridesFile ||
      options.userMenuOverridesFile ||
      options.env?.SMALLPHONE_MENU_OVERRIDES_FILE ||
      process.env.SMALLPHONE_MENU_OVERRIDES_FILE ||
      DEFAULT_MENU_OVERRIDES_FILE,
  ).trim() || DEFAULT_MENU_OVERRIDES_FILE;
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

function readMenuOverrides(filePath, errors) {
  const empty = {
    sourceFile: filePath,
    homeTarget: "",
    favorites: new Set(),
    hidden: new Set(),
    items: new Map(),
  };

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      errors.push({ file: filePath, error: "menu override file must be a JSON object" });
      return empty;
    }
    const items = new Map();
    const itemSource = isPlainObject(parsed.items)
      ? parsed.items
      : isPlainObject(parsed.components)
        ? parsed.components
        : {};
    for (const [rawId, rawOverride] of Object.entries(itemSource)) {
      const id = normalizePublicId(rawId);
      if (!id || !isPlainObject(rawOverride)) continue;
      if (hasForbiddenManifestKey(rawOverride)) {
        errors.push({ file: filePath, error: `menu override for ${id} contains forbidden executable keys` });
        continue;
      }
      items.set(id, rawOverride);
    }
    for (const rawOverride of Array.isArray(parsed.entries) ? parsed.entries : []) {
      if (!isPlainObject(rawOverride)) continue;
      const id = normalizePublicId(rawOverride.id || rawOverride.componentId || rawOverride.component_id);
      if (!id || hasForbiddenManifestKey(rawOverride)) {
        if (id) errors.push({ file: filePath, error: `menu override for ${id} contains forbidden executable keys` });
        continue;
      }
      items.set(id, rawOverride);
    }
    return {
      sourceFile: filePath,
      homeTarget: normalizePublicId(parsed.homeTarget || parsed.home_target || parsed.defaultHome || parsed.default_home || parsed.home),
      favorites: new Set(normalizeIdList(parsed.favorites || parsed.favoriteIds || parsed.favorite_ids)),
      hidden: new Set(normalizeIdList(parsed.hidden || parsed.hiddenIds || parsed.hidden_ids)),
      items,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return empty;
    }
    errors.push({
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}

function readMenuOverridesDocument(options = {}) {
  const filePath = resolveMenuOverridesFile(options);
  const errors = [];
  const overrides = readMenuOverrides(filePath, errors);
  return {
    schemaVersion: 1,
    sourceFile: filePath,
    homeTarget: overrides.homeTarget,
    favorites: [...overrides.favorites].sort(),
    hidden: [...overrides.hidden].sort(),
    items: Object.fromEntries([...overrides.items.entries()].sort(([a], [b]) => a.localeCompare(b))),
    errors,
  };
}

function writeMenuOverridesDocument(input = {}, options = {}) {
  const filePath = resolveMenuOverridesFile(options);
  const current = readRawMenuOverridesFile(filePath);
  const next = normalizeMenuOverridesDocument({
    ...current,
    ...input,
    items: mergeOverrideItems(current.items, input.items),
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
  return readMenuOverridesDocument({ ...options, menuOverridesFile: filePath });
}

function readRawMenuOverridesFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    return {};
  }
}

function mergeOverrideItems(current, patch) {
  const merged = isPlainObject(current) ? { ...current } : {};
  if (!isPlainObject(patch)) {
    return merged;
  }
  for (const [rawId, rawItem] of Object.entries(patch)) {
    const id = normalizePublicId(rawId);
    if (!id || !isPlainObject(rawItem)) continue;
    merged[id] = {
      ...(isPlainObject(merged[id]) ? merged[id] : {}),
      ...rawItem,
    };
  }
  return merged;
}

function normalizeMenuOverridesDocument(input = {}) {
  const doc = {
    schemaVersion: 1,
    homeTarget: normalizePublicId(input.homeTarget || input.home_target || input.defaultHome || input.default_home || input.home),
    favorites: [...new Set(normalizeIdList(input.favorites || input.favoriteIds || input.favorite_ids))].sort(),
    hidden: [...new Set(normalizeIdList(input.hidden || input.hiddenIds || input.hidden_ids))].sort(),
    items: {},
  };

  const items = isPlainObject(input.items) ? input.items : {};
  for (const [rawId, rawItem] of Object.entries(items)) {
    const id = normalizePublicId(rawId);
    const item = normalizeMenuOverrideItem(rawItem, id);
    if (id && item) {
      doc.items[id] = item;
    }
  }
  return doc;
}

function normalizeMenuOverrideItem(rawItem, id) {
  if (!isPlainObject(rawItem) || hasForbiddenManifestKey(rawItem)) return null;
  const item = {};
  for (const key of ["title", "name", "description", "section", "icon"]) {
    const value = normalizeString(rawItem[key]);
    if (value) item[key] = value;
  }
  const url = normalizeUrlLike(rawItem.url || rawItem.href || rawItem.uri);
  if (url) item.url = url;
  const controlEntry = normalizeMenuOverrideControlEntry(rawItem.controlEntry || rawItem.control_entry);
  if (controlEntry) item.controlEntry = controlEntry;
  const order = normalizeFiniteNumber(rawItem.order, null);
  if (order !== null) item.order = order;
  for (const key of ["visible", "favorite", "home", "hidden", "pinned"]) {
    if (Object.prototype.hasOwnProperty.call(rawItem, key)) {
      item[key] = normalizeBoolean(rawItem[key], false);
    }
  }
  if (isPlainObject(rawItem.shellMenu)) {
    const shellMenu = normalizeShellMenu(rawItem.shellMenu);
    if (shellMenu) item.shellMenu = shellMenu;
  }
  if (isPlainObject(rawItem.smallphoneApp)) {
    const smallphoneApp = normalizeSmallphoneApp(rawItem.smallphoneApp, id);
    if (smallphoneApp) item.smallphoneApp = smallphoneApp;
  }
  return item;
}

function mergeProtectedBuiltinComponent(builtin, extension) {
  const merged = {
    ...builtin,
    ...extension,
    id: builtin.id,
    source: "builtin+extension",
    protected: true,
    sourcePath: extension.sourcePath || builtin.sourcePath,
  };

  if (builtin.id === "cloudcli") {
    merged.title = builtin.title;
    merged.name = builtin.name;
  }

  merged.shellMenu = mergeMenuLayerPreservingBuiltinVisibility(builtin.shellMenu, extension.shellMenu);
  merged.smallphoneApp = mergeMenuLayerPreservingBuiltinVisibility(builtin.smallphoneApp, extension.smallphoneApp);
  merged.serviceManager = mergeServiceManagerLayer(builtin.serviceManager, extension.serviceManager);
  merged.ai = extension.ai || builtin.ai || null;
  merged.visible = merged.smallphoneApp?.visible !== false;
  merged.section = merged.smallphoneApp?.section || builtin.section;
  merged.order = merged.smallphoneApp?.order ?? builtin.order;
  merged.staticAppId = merged.smallphoneApp?.staticAppId || builtin.staticAppId || "";
  merged.entry = merged.smallphoneApp?.entry || builtin.entry;
  merged.icon = merged.smallphoneApp?.icon || builtin.icon || "";
  merged.services = merged.serviceManager?.services || [];
  merged.aiDocs = merged.ai?.summaryDoc || builtin.aiDocs || "";
  merged.capabilities = merged.ai?.capabilities || builtin.capabilities || "";
  return merged;
}

function mergeMenuLayerPreservingBuiltinVisibility(builtinLayer, extensionLayer) {
  if (!isPlainObject(extensionLayer)) {
    return builtinLayer || null;
  }
  if (!isPlainObject(builtinLayer)) {
    return extensionLayer;
  }
  const merged = {
    ...builtinLayer,
    ...extensionLayer,
  };
  if (builtinLayer.visible !== false && extensionLayer.visible === false) {
    merged.visible = true;
  }
  if (isPlainObject(builtinLayer.entry) || isPlainObject(extensionLayer.entry)) {
    merged.entry = {
      ...(builtinLayer.entry || {}),
      ...(extensionLayer.entry || {}),
    };
  }
  if (isPlainObject(builtinLayer.controlEntry) || isPlainObject(extensionLayer.controlEntry)) {
    merged.controlEntry = {
      ...(builtinLayer.controlEntry || {}),
      ...(extensionLayer.controlEntry || {}),
    };
  }
  return merged;
}

function mergeServiceManagerLayer(builtinLayer, extensionLayer) {
  const builtinServices = Array.isArray(builtinLayer?.services) ? builtinLayer.services : [];
  const extensionServices = Array.isArray(extensionLayer?.services) ? extensionLayer.services : [];
  const byName = new Map();
  for (const service of builtinServices) {
    if (service?.name) byName.set(service.name, service);
  }
  for (const service of extensionServices) {
    if (service?.name) byName.set(service.name, service);
  }
  const services = [...byName.values()];
  return {
    required: Boolean(builtinLayer?.required || extensionLayer?.required || services.length),
    services,
  };
}

function applyComponentOverride(component, overrides) {
  const item = overrides.items.get(component.id) || {};
  const favorite = normalizeBoolean(item.favorite ?? item.pinned, overrides.favorites.has(component.id));
  const hiddenByUser = overrides.hidden.has(component.id) || normalizeBoolean(item.hidden, false);
  const visibleOverride = Object.prototype.hasOwnProperty.call(item, "visible")
    ? normalizeBoolean(item.visible, component.visible !== false)
    : null;
  const userVisible = hiddenByUser ? false : visibleOverride === null ? component.visible !== false : visibleOverride;
  const home = normalizeBoolean(item.home, false) || overrides.homeTarget === component.id;

  const patched = {
    ...component,
    title: normalizeString(item.title) || component.title,
    name: normalizeString(item.name) || normalizeString(item.title) || component.name,
    description: normalizeString(item.description) || component.description,
    icon: normalizeString(item.icon) || component.icon,
  };

  if (isPlainObject(item.shellMenu)) {
    const shellMenu = normalizeShellMenu(item.shellMenu);
    if (shellMenu) {
      patched.shellMenu = {
        ...(patched.shellMenu || {}),
        ...shellMenu,
      };
    }
  }
  if (isPlainObject(item.smallphoneApp)) {
    const smallphoneApp = normalizeSmallphoneApp(item.smallphoneApp, component.id);
    if (smallphoneApp) {
      patched.smallphoneApp = {
        ...(patched.smallphoneApp || {}),
        ...smallphoneApp,
      };
    }
  }
  const overrideUrl = normalizeUrlLike(item.url || item.href || item.uri);
  const overrideControlEntry = normalizeMenuOverrideControlEntry(item.controlEntry || item.control_entry);
  if (overrideUrl || overrideControlEntry) {
    patched.shellMenu = {
      ...(patched.shellMenu || {}),
    };
    if (overrideUrl) {
      patched.shellMenu.entry = { type: "webview", url: overrideUrl };
    }
    if (overrideControlEntry) {
      patched.shellMenu.controlEntry = overrideControlEntry;
    }
  }

  const overrideSection = normalizeString(item.section);
  const overrideOrder = normalizeFiniteNumber(item.order, null);
  if (overrideSection) {
    patched.section = overrideSection;
    if (patched.smallphoneApp) patched.smallphoneApp.section = overrideSection;
    if (patched.shellMenu) patched.shellMenu.section = overrideSection;
  }
  if (overrideOrder !== null) {
    patched.order = overrideOrder;
    if (patched.smallphoneApp) patched.smallphoneApp.order = overrideOrder;
    if (patched.shellMenu) patched.shellMenu.order = overrideOrder;
  }
  if (visibleOverride !== null || hiddenByUser) {
    patched.visible = userVisible;
    if (patched.smallphoneApp) patched.smallphoneApp.visible = userVisible;
    if (patched.shellMenu) patched.shellMenu.visible = userVisible;
  }

  patched.menu = {
    favorite,
    home,
    hiddenByUser,
    userVisible,
    protected: Boolean(component.protected),
    source: component.source || "",
  };
  return patched;
}

function defaultComponentManifests(options = {}) {
  const controlledBrowserUrl = String(
    options.controlledBrowserUrl ||
      options.env?.SMALLPHONE_CONTROLLED_BROWSER_URL ||
      process.env.SMALLPHONE_CONTROLLED_BROWSER_URL ||
      DEFAULT_CONTROLLED_BROWSER_URL,
  ).trim();
  const hermesUrl = ensureTrailingSlash(String(
    options.hermesUrl ||
      options.env?.SMALLPHONE_HERMES_WEBUI_URL ||
      process.env.SMALLPHONE_HERMES_WEBUI_URL ||
      DEFAULT_HERMES_URL,
  ).trim());
  const cloudcliUrl = ensureTrailingSlash(String(
    options.cloudcliUrl ||
      options.env?.SMALLPHONE_CLOUDCLI_URL ||
      process.env.SMALLPHONE_CLOUDCLI_URL ||
      DEFAULT_CLOUDCLI_URL,
  ).trim());
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
        controlEntry: {
          type: "service-control",
          serviceNames: ["smallphone-frontend-beta", "smallphone-core"],
          serviceRefs: [
            "service-manager://services/smallphone-frontend-beta",
            "service-manager://services/smallphone-core",
          ],
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
        controlEntry: {
          type: "service-control",
          serviceNames: ["smallphone-frontend-beta", "smallphone-core"],
          serviceRefs: [
            "service-manager://services/smallphone-frontend-beta",
            "service-manager://services/smallphone-core",
          ],
        },
      },
      serviceManager: {
        required: true,
        services: [
          {
            name: "smallphone-frontend-beta",
            title: "SmallPhone Web",
            role: "web",
            port: 22082,
            url: "http://127.0.0.1:22082/",
            serviceRef: "service-manager://services/smallphone-frontend-beta",
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/smallphone-frontend-beta.repair",
          },
          {
            name: "smallphone-core",
            title: "SmallPhone Core",
            role: "api",
            port: 22000,
            url: "http://127.0.0.1:22000/",
            serviceRef: "service-manager://services/smallphone-core",
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/smallphone-core.repair",
          },
        ],
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
      id: "hermes-webui",
      title: "Hermes",
      description: "Hermes AI partner web console managed by OpenHouseAI.",
      kind: "ai-partner",
      shellMenu: {
        visible: true,
        section: "ai",
        order: 20,
        entry: {
          type: "webview",
          url: hermesUrl,
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["hermes-webui"],
          serviceRefs: ["service-manager://services/hermes-webui"],
        },
      },
      smallphoneApp: {
        visible: true,
        section: "ai",
        order: 20,
        icon: "sparkles",
        entry: {
          type: "webview",
          url: hermesUrl,
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["hermes-webui"],
          serviceRefs: ["service-manager://services/hermes-webui"],
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
            url: hermesUrl,
            serviceRef: "service-manager://services/hermes-webui",
            health: {
              type: "http",
              url: `${hermesUrl.replace(/\/$/, "")}/health`,
            },
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/hermes-webui.repair",
          },
        ],
      },
      ai: {
        visible: true,
        summaryDoc: "/root/.config/openhouseai/ai-docs/hermes-webui/openhouse.ai.md",
        capabilities: "/root/.config/openhouseai/ai-docs/hermes-webui/capabilities.json",
        intents: [
          { name: "open", target: "shellMenu.entry" },
          { name: "control", target: "shellMenu.controlEntry" },
          { name: "repair", target: "serviceManager.services.hermes-webui.repairActionRef" },
        ],
      },
    }),
    normalizeComponentManifest({
      schemaVersion: 1,
      id: "cloudcli",
      title: "CC/Codex",
      description: "Claude Code and Codex web console.",
      kind: "ai-partner",
      shellMenu: {
        visible: true,
        section: "ai",
        order: 30,
        entry: {
          type: "webview",
          url: cloudcliUrl,
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["cloudcli"],
          serviceRefs: ["service-manager://services/cloudcli"],
        },
      },
      smallphoneApp: {
        visible: true,
        section: "ai",
        order: 30,
        icon: "terminal",
        entry: {
          type: "webview",
          url: cloudcliUrl,
        },
        controlEntry: {
          type: "service-control",
          serviceNames: ["cloudcli"],
          serviceRefs: ["service-manager://services/cloudcli"],
        },
      },
      serviceManager: {
        required: true,
        services: [
          {
            name: "cloudcli",
            title: "CC/Codex",
            role: "web",
            port: 23083,
            url: cloudcliUrl,
            serviceRef: "service-manager://services/cloudcli",
            health: {
              type: "http",
              url: cloudcliUrl,
            },
            controls: ["status", "start", "stop", "restart", "logs", "repair"],
            repairActionRef: "service-manager://actions/cloudcli.repair",
          },
        ],
      },
      ai: {
        visible: true,
        summaryDoc: "/root/.config/openhouseai/ai-docs/cloudcli/openhouse.ai.md",
        capabilities: "/root/.config/openhouseai/ai-docs/cloudcli/capabilities.json",
        intents: [
          { name: "open", target: "shellMenu.entry" },
          { name: "control", target: "shellMenu.controlEntry" },
        ],
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

function buildFinalMenuRegistry(components, options = {}) {
  const allItems = [];
  for (const component of Array.isArray(components) ? components : []) {
    const item = createMenuRegistryItem(component);
    if (item) allItems.push(item);
  }

  const homeTarget = resolveHomeTarget(allItems, options.overrides);
  const items = allItems
    .map((item) => ({
      ...item,
      home: item.id === homeTarget,
      favorite: item.favorite || item.id === homeTarget,
    }))
    .sort(compareMenuItems);
  const quickEntries = items
    .filter((item) => item.visible && (item.home || item.favorite || item.section === "common"))
    .sort(compareQuickMenuItems);
  const serviceIndex = buildServiceIndex(items);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceDir: options.sourceDir || "",
    overridesFile: options.overridesFile || "",
    homeTarget,
    defaultHomeTarget: DEFAULT_HOME_TARGET,
    items,
    quickEntries,
    serviceIndex,
    aiReadable: {
      summary: "Use menuRegistry.items to open pages and service-manager refs to control services. Do not infer shell commands from titles.",
      endpoints: {
        registry: "/api/app-registry",
        components: "/api/components",
        capabilities: "/api/ai-capabilities",
        serviceManagerServices: "/api/service-manager/services",
      },
    },
  };
}

function createMenuRegistryItem(component) {
  if (!component?.id) return null;
  const shellMenu = component.shellMenu && typeof component.shellMenu === "object" ? component.shellMenu : null;
  const smallphoneApp = component.smallphoneApp && typeof component.smallphoneApp === "object" ? component.smallphoneApp : null;
  const preferredLayer = shellMenu?.entry?.url || shellMenu?.entry?.view ? shellMenu : smallphoneApp;
  const fallbackLayer = preferredLayer === shellMenu ? smallphoneApp : shellMenu;
  const entry = normalizeMenuEntry(preferredLayer?.entry) || normalizeMenuEntry(fallbackLayer?.entry);
  const controlEntry = normalizeFinalControlEntry(
    preferredLayer?.controlEntry || fallbackLayer?.controlEntry,
    component.serviceManager?.services || [],
  );
  const section = normalizeString(preferredLayer?.section || smallphoneApp?.section || shellMenu?.section || component.section || "apps") || "apps";
  const order = normalizeFiniteNumber(preferredLayer?.order ?? smallphoneApp?.order ?? shellMenu?.order ?? component.order, 100);
  const services = Array.isArray(component.serviceManager?.services) ? component.serviceManager.services : [];
  const serviceNames = services.map((service) => service.name).filter(Boolean);
  const protectedEntry = Boolean(component.protected);
  const defaultFavoriteIds = new Set(["hermes-webui", "messages", "cloudcli", "controlled-browser"]);
  const visible = component.menu?.userVisible !== false && (preferredLayer?.visible ?? component.visible) !== false;

  return {
    id: component.id,
    title: component.title || component.name || component.id,
    description: component.description || "",
    kind: component.kind || "app",
    source: component.source || "",
    protected: protectedEntry,
    visible,
    section,
    order,
    icon: component.icon || smallphoneApp?.icon || "",
    favorite: Boolean(component.menu?.favorite || defaultFavoriteIds.has(component.id)),
    home: Boolean(component.menu?.home),
    entry,
    controlEntry,
    serviceNames: [...new Set([...(controlEntry?.serviceNames || []), ...serviceNames])].sort(),
    serviceRefs: [...new Set([
      ...(controlEntry?.serviceRefs || []),
      ...services.map((service) => service.serviceRef).filter(Boolean),
    ])].sort(),
    services,
    ai: component.ai || null,
    smallphoneApp,
    shellMenu,
  };
}

function normalizeMenuEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const type = normalizeEntryType(entry.type || (entry.url ? "webview" : entry.view ? "native-view" : ""));
  const url = normalizeUrlLike(entry.url || entry.href || entry.uri);
  const view = normalizePublicId(entry.view || entry.nativeView || entry.native_view);
  if (type === "webview" && url) {
    return { type, url };
  }
  if (type === "native-view" && view) {
    return { type, view };
  }
  return null;
}

function normalizeFinalControlEntry(controlEntry, services = []) {
  const normalized = normalizeSmallphoneControlEntry(controlEntry, services.map((service) => service.name).filter(Boolean));
  const serviceRefs = normalizeServiceRefs(
    isPlainObject(controlEntry) ? controlEntry.serviceRefs || controlEntry.service_refs : [],
  );
  const fallbackRefs = services.map((service) => service.serviceRef).filter(Boolean);
  if (!normalized && !serviceRefs.length && !fallbackRefs.length) {
    return null;
  }
  return {
    type: "service-control",
    serviceNames: normalized?.serviceNames || services.map((service) => service.name).filter(Boolean),
    serviceRefs: [...new Set([...serviceRefs, ...fallbackRefs])].sort(),
  };
}

function resolveHomeTarget(items, overrides) {
  const visibleIds = new Set(items.filter((item) => item.visible).map((item) => item.id));
  const requested = normalizePublicId(overrides?.homeTarget);
  if (requested && visibleIds.has(requested)) return requested;
  const explicit = items.find((item) => item.visible && item.home);
  if (explicit) return explicit.id;
  if (visibleIds.has(DEFAULT_HOME_TARGET)) return DEFAULT_HOME_TARGET;
  return items.find((item) => item.visible)?.id || DEFAULT_HOME_TARGET;
}

function buildServiceIndex(items) {
  const out = {};
  for (const item of items) {
    const services = Array.isArray(item.services) ? item.services : [];
    const serviceByName = new Map(services.map((service) => [service.name, service]));
    for (const serviceName of item.serviceNames || []) {
      if (!serviceName) continue;
      const service = serviceByName.get(serviceName) || null;
      out[serviceName] = {
        componentId: item.id,
        title: item.title,
        serviceRef: service?.serviceRef || `service-manager://services/${serviceName}`,
        url: service?.url || item.entry?.url || "",
        controls: service?.controls?.length ? service.controls : ["status", "start", "stop", "restart", "logs", "repair"],
      };
    }
  }
  return out;
}

function compareQuickMenuItems(a, b) {
  if (a.home !== b.home) return a.home ? -1 : 1;
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  return compareMenuItems(a, b);
}

function compareMenuItems(a, b) {
  const sectionDelta = sectionRank(a.section) - sectionRank(b.section);
  if (sectionDelta) return sectionDelta;
  const orderDelta = Number(a.order || 0) - Number(b.order || 0);
  if (orderDelta) return orderDelta;
  return String(a.title || a.id).localeCompare(String(b.title || b.id));
}

function sectionRank(section) {
  const normalized = normalizeString(section);
  const ranks = {
    common: 0,
    ai: 10,
    smallphone: 20,
    desktop: 30,
    tools: 40,
    apps: 50,
  };
  return Object.prototype.hasOwnProperty.call(ranks, normalized) ? ranks[normalized] : 100;
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
  const serviceRefs = normalizeServiceRefs(control?.serviceRefs || control?.service_refs);
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
    ...(serviceRefs.length ? { serviceRefs } : {}),
  };
}

function normalizeMenuOverrideControlEntry(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const type = normalizeString(value.type || "service-control");
  if (type !== "service-control") {
    return null;
  }
  const serviceNames = [...new Set(normalizeIdList(value.serviceNames || value.service_names))].sort();
  const serviceRefs = normalizeServiceRefs(value.serviceRefs || value.service_refs);
  if (!serviceNames.length && !serviceRefs.length) {
    return null;
  }
  return {
    type: "service-control",
    ...(serviceNames.length ? { serviceNames } : {}),
    ...(serviceRefs.length ? { serviceRefs } : {}),
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
      menu: component.menu || null,
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
        menu: component.menu || null,
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

function normalizeServiceRefs(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.map(normalizeServiceManagerRef).filter(Boolean))].sort();
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

function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map(normalizePublicId).filter(Boolean);
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "visible", "favorite", "home"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "hidden"].includes(normalized)) return false;
  }
  return Boolean(fallback);
}

function ensureTrailingSlash(value) {
  const raw = normalizeUrlLike(value);
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
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
  DEFAULT_MENU_OVERRIDES_FILE,
  readComponentRegistry,
  readMenuOverridesDocument,
  writeMenuOverridesDocument,
  normalizeComponentManifest,
};
