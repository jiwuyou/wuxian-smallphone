const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const ACTIVE_ROOT = path.resolve(APP_ROOT, "..");
const LEGACY_DATA_ROOT = path.join(APP_ROOT, "data");
const DEFAULT_SMALLPHONE_HOME = path.resolve(ACTIVE_ROOT, "..", "smallphone-home");

function resolveSmallPhonePaths(options = {}) {
  const env = options.env || process.env;
  const explicitDataFile = String(options.dataFile || "").trim();
  const envDataFile = String(env.SMALLPHONE_DATA_FILE || "").trim();
  const dataFileCandidate = explicitDataFile || envDataFile;
  const explicitHome = String(options.smallphoneHome || env.SMALLPHONE_HOME || "").trim();
  const smallphoneHome = path.resolve(
    explicitHome || (options.deriveHomeFromDataFile && dataFileCandidate
      ? path.dirname(path.resolve(dataFileCandidate))
      : DEFAULT_SMALLPHONE_HOME),
  );
  const dataFile = path.resolve(dataFileCandidate || path.join(smallphoneHome, "runtime.json"));
  const legacyRuntimeFile = path.join(LEGACY_DATA_ROOT, "runtime.json");

  return {
    appRoot: APP_ROOT,
    activeRoot: ACTIVE_ROOT,
    smallphoneHome,
    dataFile,
    runtimeFile: dataFile,
    legacyDataRoot: LEGACY_DATA_ROOT,
    legacyRuntimeFile,
    legacyAttachmentsRoot: path.join(LEGACY_DATA_ROOT, "attachments"),
    attachmentsRoot: path.join(smallphoneHome, "attachments"),
    channelWorkspacesRoot: path.join(smallphoneHome, "channel-workspaces"),
    adminWorkspacesRoot: path.join(smallphoneHome, "admin-workspaces"),
    systemWorkspaceRoot: path.join(smallphoneHome, "system-workspace"),
    shellsRoot: path.join(smallphoneHome, "shells"),
    userAppsRoot: path.join(smallphoneHome, "apps"),
    themesRoot: path.join(smallphoneHome, "themes"),
    desktopLayoutsRoot: path.join(smallphoneHome, "desktop-layouts"),
    openclawAgentRegistryPath: path.join(smallphoneHome, "openclaw-agents.generated.json"),
  };
}

function assertSafePathSegment(value, label = "path segment") {
  const segment = String(value || "").trim();
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0")
  ) {
    const error = new Error(`Invalid ${label}.`);
    error.code = "ERR_SMALLPHONE_INVALID_PATH_SEGMENT";
    throw error;
  }
  return segment;
}

function isPathInside(root, candidate) {
  const resolvedRoot = path.resolve(String(root || ""));
  const resolvedCandidate = path.resolve(String(candidate || ""));
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePathInside(root, requestPath = "index.html") {
  const resolvedRoot = path.resolve(String(root || ""));
  const raw = String(requestPath || "index.html").replace(/\\/g, "/");
  if (raw.includes("\0")) {
    const error = new Error("Path contains an invalid character.");
    error.code = "ERR_SMALLPHONE_INVALID_PATH";
    throw error;
  }
  const relative = raw.replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(resolvedRoot, relative);
  if (!isPathInside(resolvedRoot, resolved)) {
    const error = new Error("Path escapes the allowed root.");
    error.code = "ERR_SMALLPHONE_PATH_TRAVERSAL";
    throw error;
  }
  return resolved;
}

function resolveUserShellAssetPath(options = {}) {
  const paths = options.paths || resolveSmallPhonePaths(options);
  const shellId = assertSafePathSegment(options.shellId, "shell id");
  const root = path.join(paths.shellsRoot, shellId);
  return {
    kind: "user",
    shellId,
    root,
    filePath: resolvePathInside(root, options.assetPath || "index.html"),
  };
}

function resolveOfficialShellAssetPath(options = {}) {
  const root = path.resolve(String(options.officialRoot || path.join(APP_ROOT, "apps", "web")));
  return {
    kind: "official",
    shellId: "official",
    root,
    filePath: resolvePathInside(root, options.assetPath || "index.html"),
  };
}

function resolveShellAssetPath(options = {}) {
  const shell = options.shell || {};
  const source = String(shell.source || shell.kind || "").trim().toLowerCase();
  if (source === "user") {
    return resolveUserShellAssetPath({
      paths: options.paths,
      shellId: shell.id,
      assetPath: options.assetPath || shell.entry || "index.html",
    });
  }
  return resolveOfficialShellAssetPath({
    officialRoot: options.officialRoot,
    assetPath: options.assetPath || shell.entry || "index.html",
  });
}

module.exports = {
  APP_ROOT,
  ACTIVE_ROOT,
  DEFAULT_SMALLPHONE_HOME,
  LEGACY_DATA_ROOT,
  assertSafePathSegment,
  isPathInside,
  resolveOfficialShellAssetPath,
  resolvePathInside,
  resolveShellAssetPath,
  resolveSmallPhonePaths,
  resolveUserShellAssetPath,
};
