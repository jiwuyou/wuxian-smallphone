const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CC_CONNECT_CONFIG_FILE = "/root/.smallphoneai/cc-connect.toml";
const OPENHOUSE_CC_CONNECT_CONFIG_FILE = "/root/smallphoneai-repos/openhouse-connect/config.smallphoneai.toml";
const LEGACY_CC_CONNECT_CONFIG_FILE = "/root/.cc-connect/config.toml";
const CC_CONNECT_DAEMON_FILE = "/root/.cc-connect/daemon.json";

function applyCcConnectEnvDefaults(env = process.env) {
  if (!env.SMALLPHONE_RUNTIME_MODE) {
    env.SMALLPHONE_RUNTIME_MODE = "cc-connect";
  }
  if (!env.SMALLPHONE_HOME) {
    env.SMALLPHONE_HOME = path.join(resolveSmallphoneRoot(), "smallphone-home");
  }
  if (!env.SMALLPHONE_HOST) {
    env.SMALLPHONE_HOST = "127.0.0.1";
  }
  if (!env.SMALLPHONE_HOSTS) {
    env.SMALLPHONE_HOSTS = ["127.0.0.1", findTailscaleIp()].filter(Boolean).join(",");
  }

  const mode = normalizeMode(env.SMALLPHONE_RUNTIME_MODE);
  if (mode !== "cc-webclient" && mode !== "cc-connect") return;

  const configFile = env.CC_CONNECT_CONFIG_FILE || DEFAULT_CC_CONNECT_CONFIG_FILE;
  const config = readCcConnectConfig(configFile);
  if (!config) return;

  if (mode === "cc-webclient") {
    applyCcWebclientDefaults(env, config);
    return;
  }
  applyCcBridgeDefaults(env, config);
}

function applyCcWebclientDefaults(env, config) {
  const webclient = config.webclient || {};
  const management = config.management || {};
  const projectName = env.SMALLPHONE_CCCONNECT_PROJECT || findSmallphoneProject(config.projects);
  const webclientPort = normalizeText(webclient.port) || "21040";
  const webclientToken = normalizeText(webclient.token);
  const managementPort = normalizeText(management.port) || "21020";
  const managementToken = normalizeText(management.token);

  setDefault(env, "SMALLPHONE_WEBCLIENT_BASE_URL", `http://127.0.0.1:${webclientPort}`);
  setDefault(env, "SMALLPHONE_WEBCLIENT_TOKEN", webclientToken);
  setDefault(env, "SMALLPHONE_WEBCLIENT_APP_ID", "smallphone");
  setDefault(env, "SMALLPHONE_CCCONNECT_PROJECT", projectName);
  setDefault(env, "SMALLPHONE_CCCONNECT_PLATFORM", "smallphone");
  setDefault(env, "SMALLPHONE_CCCONNECT_MANAGEMENT_URL", `http://127.0.0.1:${managementPort}`);
  setDefault(env, "SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN", managementToken);
}

function applyCcBridgeDefaults(env, config) {
  const bridge = config.bridge || {};
  const management = config.management || {};
  const projectName = env.SMALLPHONE_CCCONNECT_PROJECT || findSmallphoneProject(config.projects);
  const bridgePort = normalizeText(bridge.port) || "21010";
  const bridgePath = normalizeText(bridge.path) || "/bridge/ws";
  const bridgeToken = normalizeText(bridge.token);
  const managementPort = normalizeText(management.port) || "21020";
  const managementToken = normalizeText(management.token);

  setDefault(env, "SMALLPHONE_CCCONNECT_WS_URL", `ws://127.0.0.1:${bridgePort}${bridgePath}`);
  setDefault(env, "SMALLPHONE_CCCONNECT_TOKEN", bridgeToken);
  setDefault(env, "SMALLPHONE_CCCONNECT_PROJECT", projectName);
  setDefault(env, "SMALLPHONE_CCCONNECT_PLATFORM", "smallphone");
  setDefault(env, "SMALLPHONE_CCCONNECT_MANAGEMENT_URL", `http://127.0.0.1:${managementPort}`);
  setDefault(env, "SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN", managementToken);
}

function readCcConnectConfig(configFile) {
  const candidates = buildCcConnectConfigCandidates(configFile);
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      return parseMinimalToml(fs.readFileSync(candidate, "utf8"));
    } catch {}
  }
  return null;
}

function buildCcConnectConfigCandidates(configFile) {
  const explicit = normalizeText(configFile);
  const candidates = [
    explicit,
    DEFAULT_CC_CONNECT_CONFIG_FILE,
    OPENHOUSE_CC_CONNECT_CONFIG_FILE,
    LEGACY_CC_CONNECT_CONFIG_FILE,
    resolveDaemonConfigFile(),
    path.join(os.homedir(), "cc-connect", "config.toml"),
    path.join(resolveSmallphoneRoot(), "cc-connect", "config.toml"),
  ]
    .filter(Boolean)
    .map((item) => path.resolve(item));
  return [...new Set(candidates)];
}

function resolveDaemonConfigFile() {
  try {
    if (!fs.existsSync(CC_CONNECT_DAEMON_FILE)) return "";
    const daemon = JSON.parse(fs.readFileSync(CC_CONNECT_DAEMON_FILE, "utf8"));
    const workDir = normalizeText(daemon?.work_dir);
    if (!workDir) return "";
    return path.join(workDir, "config.toml");
  } catch {
    return "";
  }
}

function parseMinimalToml(source) {
  const config = {};
  let section = config;
  let arrayRoot = "";
  let arrayRootItem = null;

  String(source || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = stripTomlComment(line).trim();
      if (!trimmed) return;

      const tableArrayMatch = trimmed.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
      if (tableArrayMatch) {
        const key = tableArrayMatch[1];
        const parts = key.split(".").filter(Boolean);
        if (parts.length === 1) {
          if (!Array.isArray(config[key])) config[key] = [];
          section = {};
          config[key].push(section);
          arrayRoot = key;
          arrayRootItem = section;
          return;
        }
        const nestedParent = resolveArrayNestedParent(config, arrayRoot, arrayRootItem, parts.slice(0, -1));
        const leafKey = parts.at(-1);
        if (!nestedParent || !leafKey) return;
        if (!Array.isArray(nestedParent[leafKey])) nestedParent[leafKey] = [];
        section = {};
        nestedParent[leafKey].push(section);
        return;
      }

      const tableMatch = trimmed.match(/^\[([A-Za-z0-9_.-]+)\]$/);
      if (tableMatch) {
        const key = tableMatch[1];
        const parts = key.split(".").filter(Boolean);
        if (arrayRoot && parts[0] === arrayRoot && arrayRootItem) {
          section = ensureTable(arrayRootItem, parts.slice(1).join("."));
          return;
        }
        section = ensureTable(config, key);
        arrayRoot = "";
        arrayRootItem = null;
        return;
      }

      const keyValueMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
      if (!keyValueMatch) return;
      section[keyValueMatch[1]] = parseTomlScalar(keyValueMatch[2]);
    });

  return config;
}

function resolveArrayNestedParent(config, arrayRoot, arrayRootItem, parts) {
  if (arrayRoot && parts[0] === arrayRoot && arrayRootItem) {
    return parts.slice(1).reduce((table, key) => {
      if (!key) return table;
      if (!table[key] || typeof table[key] !== "object" || Array.isArray(table[key])) {
        table[key] = {};
      }
      return table[key];
    }, arrayRootItem);
  }
  return parts.reduce((table, key) => {
    if (!key) return table;
    if (!table[key] || typeof table[key] !== "object" || Array.isArray(table[key])) {
      table[key] = {};
    }
    return table[key];
  }, config);
}

function stripTomlComment(line) {
  let inQuote = false;
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quote = char;
      } else if (quote === char) {
        inQuote = false;
        quote = "";
      }
    }
    if (char === "#" && !inQuote) return line.slice(0, index);
  }
  return line;
}

function ensureTable(config, dottedKey) {
  return String(dottedKey || "")
    .split(".")
    .filter(Boolean)
    .reduce((table, key) => {
      if (!table[key] || typeof table[key] !== "object" || Array.isArray(table[key])) {
        table[key] = {};
      }
      return table[key];
    }, config);
}

function parseTomlScalar(value) {
  const raw = String(value || "").trim();
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).replace(/\\"/g, "\"").replace(/\\n/g, "\n");
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function findSmallphoneProject(projects) {
  const items = Array.isArray(projects) ? projects : [];
  const match = items.find((project) => {
    const name = normalizeText(project?.name);
    const displayName = normalizeText(project?.display_name);
    return displayName === "smallphone" || name.startsWith("smallphone");
  });
  return normalizeText(match?.name) || normalizeText(items[0]?.name);
}

function setDefault(env, key, value) {
  const normalized = normalizeText(value);
  if (!normalized || env[key]) return;
  env[key] = normalized;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeMode(value) {
  const mode = normalizeText(value).toLowerCase().replace(/_/g, "-");
  if (mode === "ccwebclient") return "cc-webclient";
  if (mode === "ccconnect") return "cc-connect";
  return mode;
}

function resolveSmallphoneRoot() {
  return path.resolve(__dirname, "../../../..");
}

function findTailscaleIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const items of Object.values(interfaces)) {
      for (const item of items || []) {
        const address = normalizeText(item?.address);
        if (item?.family === "IPv4" && address.startsWith("100.")) return address;
      }
    }
  } catch {
    return "";
  }
  return "";
}

module.exports = {
  applyCcConnectEnvDefaults,
  buildCcConnectConfigCandidates,
  parseMinimalToml,
};
