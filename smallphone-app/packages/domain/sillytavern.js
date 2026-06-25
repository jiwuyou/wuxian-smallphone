const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CHECK_TIMEOUT_MS = 15000;
const SCRIPT_OUTPUT_LIMIT = 16000;
const DEFAULT_REPO_URL = "https://github.com/SillyTavern/SillyTavern.git";

function firstExistingPath(paths) {
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return paths.find(Boolean);
}

function getSillyTavernConfig(options = {}) {
  const env = options.env || process.env;
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const defaultInstallDir = firstExistingPath([
    path.resolve(repoRoot, "..", "sillytavern"),
    "/root/SillyTavern",
    "/root/.local/share/SillyTavern",
  ]);
  const installDir = path.resolve(
    options.installDir ||
      env.SMALLPHONE_SILLYTAVERN_DIR ||
      env.SILLYTAVERN_DIR ||
      defaultInstallDir,
  );
  const dataDir = path.resolve(
    options.dataDir ||
      env.SMALLPHONE_SILLYTAVERN_DATA_DIR ||
      env.SILLYTAVERN_DATA_DIR ||
      path.join(installDir, "data"),
  );
  const repoUrl = String(
    options.repoUrl ||
      env.SMALLPHONE_SILLYTAVERN_REPO_URL ||
      env.SILLYTAVERN_REPO_URL ||
      DEFAULT_REPO_URL,
  ).trim();
  const url = normalizeUrl(options.url || env.SMALLPHONE_SILLYTAVERN_URL || env.SILLYTAVERN_URL || "http://127.0.0.1:8000/");
  const serviceId = String(
    options.serviceId ||
      env.SMALLPHONE_SILLYTAVERN_SERVICE_ID ||
      env.SILLYTAVERN_SERVICE_ID ||
      "smallphone-sillytavern",
  ).trim();

  return {
    repoRoot,
    installDir,
    dataDir,
    repoUrl,
    url,
    serviceId,
    installScript: path.join(repoRoot, "scripts", "install-sillytavern.sh"),
  };
}

function getSillyTavernLocalStatus(options = {}) {
  const config = getSillyTavernConfig(options);
  return {
    ok: true,
    url: config.url,
    serviceId: config.serviceId,
    repoUrl: config.repoUrl,
    installDir: config.installDir,
    dataDir: config.dataDir,
    installed: fs.existsSync(path.join(config.installDir, "package.json")) ||
      fs.existsSync(path.join(config.installDir, "server.js")),
    dataExists: fs.existsSync(config.dataDir),
  };
}

async function checkSillyTavernGithubConnectivity(options = {}) {
  const config = getSillyTavernConfig(options);
  const runner = options.runner || runCommand;
  const timeoutMs = normalizePositiveInt(options.timeoutMs || process.env.SMALLPHONE_SILLYTAVERN_CHECK_TIMEOUT_MS, DEFAULT_CHECK_TIMEOUT_MS);
  const startedAt = Date.now();
  const result = await runner("git", ["ls-remote", "--heads", config.repoUrl], { timeoutMs });
  const parsed = parseGitLsRemoteOutput(result.output || "");
  const reachable = result.exitCode === 0 && !result.timedOut && parsed.ok;
  return {
    ok: reachable,
    reachable,
    repoUrl: config.repoUrl,
    command: "git ls-remote --heads",
    exitCode: result.exitCode,
    timedOut: Boolean(result.timedOut),
    branchCount: parsed.branchCount,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    error: reachable ? "" : (result.error || parsed.error || "GitHub repository is not reachable."),
  };
}

function parseGitLsRemoteOutput(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const branchLines = lines.filter((line) => /^[0-9a-f]{40}\s+refs\/heads\/[^\s]+$/i.test(line));
  return {
    ok: branchLines.length > 0,
    branchCount: branchLines.length,
    branches: branchLines.map((line) => line.replace(/^[0-9a-f]{40}\s+refs\/heads\//i, "")),
    error: branchLines.length ? "" : "No branches were returned by git ls-remote.",
  };
}

async function installSillyTavern(options = {}) {
  const config = getSillyTavernConfig(options);
  if (!fs.existsSync(config.installScript)) {
    return {
      ok: false,
      error: `Installer script not found: ${config.installScript}`,
      installDir: config.installDir,
      url: config.url,
    };
  }

  const timeoutMs = normalizePositiveInt(
    options.timeoutMs || process.env.SMALLPHONE_SILLYTAVERN_INSTALL_TIMEOUT_MS,
    DEFAULT_INSTALL_TIMEOUT_MS,
  );
  const result = await runCommand(config.installScript, [], {
    cwd: config.repoRoot,
    timeoutMs,
    env: {
      ...process.env,
      ...(options.envOverrides || {}),
      SMALLPHONE_SILLYTAVERN_DIR: config.installDir,
      SILLYTAVERN_DIR: config.installDir,
      SMALLPHONE_SILLYTAVERN_DATA_DIR: config.dataDir,
      SMALLPHONE_SILLYTAVERN_REPO_URL: config.repoUrl,
      SMALLPHONE_SILLYTAVERN_URL: config.url,
      SMALLPHONE_SILLYTAVERN_SERVICE_ID: config.serviceId,
    },
  });

  return {
    ok: result.exitCode === 0,
    installDir: config.installDir,
    dataDir: config.dataDir,
    repoUrl: config.repoUrl,
    url: config.url,
    serviceId: config.serviceId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    output: tailText(result.output, SCRIPT_OUTPUT_LIMIT),
    error: result.exitCode === 0 ? "" : (result.error || "SillyTavern install failed"),
  };
}

function resolveSillyTavernServiceRecord(services, configInput = {}) {
  const config = getSillyTavernConfig(configInput);
  const expectedIds = new Set([
    config.serviceId,
    "smallphone-sillytavern",
    "sillytavern",
    "silly-tavern",
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const expectedTags = new Set([
    "smallphone-app:sillytavern",
    "smallphone-app:silly-tavern",
    "smallphone-instance:sillytavern",
  ]);

  for (const service of Array.isArray(services) ? services : []) {
    const id = String(service?.id || "").trim();
    const name = String(service?.name || "").trim();
    if (expectedIds.has(id) || expectedIds.has(name)) return service;
    const tags = Array.isArray(service?.tags) ? service.tags : [];
    if (tags.some((tag) => expectedTags.has(String(tag || "").trim()))) return service;
  }
  return null;
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    const timeoutMs = normalizePositiveInt(options.timeoutMs, DEFAULT_CHECK_TIMEOUT_MS);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, timeoutMs);
    timer.unref();

    const append = (chunk) => {
      output = tailText(`${output}${chunk.toString("utf8")}`, SCRIPT_OUTPUT_LIMIT * 2);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut, output, error: error.message });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (Number.isFinite(Number(code)) ? Number(code) : 1),
        timedOut,
        signal,
        output,
        error: timedOut ? "GitHub connectivity check timed out." : "",
      });
    });
  });
}

function normalizeUrl(value) {
  const raw = String(value || "").trim() || "http://127.0.0.1:8000/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tailText(value, maxLength) {
  const text = String(value || "");
  const limit = Number.isFinite(Number(maxLength)) ? Number(maxLength) : SCRIPT_OUTPUT_LIMIT;
  return text.length > limit ? text.slice(text.length - limit) : text;
}

module.exports = {
  DEFAULT_REPO_URL,
  checkSillyTavernGithubConnectivity,
  getSillyTavernConfig,
  getSillyTavernLocalStatus,
  installSillyTavern,
  parseGitLsRemoteOutput,
  resolveSillyTavernServiceRecord,
};
