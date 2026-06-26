const fs = require("fs");
const path = require("path");
const { resolveSmallPhonePaths } = require("../shared/paths");

const DEFAULT_APK_RELEASE_CHANNEL = "stable";
const DEFAULT_MANIFEST_TIMEOUT_MS = 10000;
const SETTINGS_KIND = "openhouseai.settings";

function readApkReleaseServerSettings(options = {}) {
  const { document, settingsFile } = readOpenHouseAiSettingsDocument(options);
  return {
    settings: normalizeApkReleaseServerSettings(extractApkReleaseSettings(document), {
      allowEmptyBaseUrl: true,
      allowEmptyUpdatedAt: true,
    }),
    settingsFile,
  };
}

function writeApkReleaseServerSettings(input = {}, options = {}) {
  const { document, settingsFile } = readOpenHouseAiSettingsDocument(options);
  const current = extractApkReleaseSettings(document);
  const patch = extractApkReleaseSettings(input);
  const updatedAt = String(options.now || new Date().toISOString());
  const settings = normalizeApkReleaseServerSettings(mergeDefined(current, patch, { updatedAt }), {
    allowEmptyBaseUrl: true,
  });
  const nextDocument = {
    ...document,
    schemaVersion: Number.isInteger(Number(document.schemaVersion)) ? Number(document.schemaVersion) : 1,
    kind: typeof document.kind === "string" && document.kind.trim() ? document.kind : SETTINGS_KIND,
    releaseServerBaseUrl: settings.releaseServerBaseUrl,
    channel: settings.channel,
    updatedAt: settings.updatedAt,
  };

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");

  return {
    settings,
    settingsFile,
  };
}

async function checkApkReleaseManifest(options = {}) {
  const base = readApkReleaseServerSettings(options).settings;
  const patch = options.settings ? extractApkReleaseSettings(options.settings) : {};
  const settings = normalizeApkReleaseServerSettings(mergeDefined(base, patch), {
    allowEmptyBaseUrl: false,
  });
  const manifestUrls = buildApkReleaseManifestUrls(settings);
  const checkedAt = String(options.now || new Date().toISOString());
  const attempts = [];

  for (const manifestUrl of manifestUrls) {
    const fetched = await fetchReleaseManifestJson(manifestUrl, options);
    if (!fetched.ok) {
      attempts.push({
        manifestUrl,
        ok: false,
        statusCode: fetched.statusCode || 0,
        error: fetched.error,
      });
      continue;
    }

    try {
      const release = normalizeApkReleaseManifest(fetched.manifest, {
        channel: settings.channel,
        manifestUrl,
        releaseServerBaseUrl: settings.releaseServerBaseUrl,
      });
      return {
        ok: true,
        settings,
        checkedAt,
        manifestUrl,
        release,
        attempts: [
          ...attempts,
          {
            manifestUrl,
            ok: true,
            statusCode: fetched.statusCode || 200,
          },
        ],
      };
    } catch (error) {
      attempts.push({
        manifestUrl,
        ok: false,
        statusCode: fetched.statusCode || 200,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: false,
    settings,
    checkedAt,
    manifestUrl: manifestUrls[0] || "",
    attempts,
    error: attempts.length
      ? attempts[attempts.length - 1].error || "No valid APK release manifest found."
      : "No APK release manifest URL could be resolved.",
  };
}

function normalizeApkReleaseServerSettings(input = {}, options = {}) {
  const source = isPlainObject(input?.settings) ? input.settings : input;
  const releaseServerBaseUrl = normalizeReleaseServerBaseUrl(
    firstDefined(
      source?.releaseServerBaseUrl,
      source?.release_server_base_url,
      source?.baseUrl,
      source?.base_url,
      source?.url,
      "",
    ),
    { allowEmpty: options.allowEmptyBaseUrl !== false },
  );
  const channel = normalizeReleaseChannel(
    firstDefined(source?.channel, source?.releaseChannel, source?.release_channel, DEFAULT_APK_RELEASE_CHANNEL),
  );
  const updatedAt = String(firstDefined(source?.updatedAt, source?.updated_at, "") || "").trim();
  if (!updatedAt && options.allowEmptyUpdatedAt === false) {
    throw createApkReleaseError("APK release settings require updatedAt.", 400, "ERR_APK_RELEASE_UPDATED_AT_REQUIRED");
  }
  return {
    releaseServerBaseUrl,
    channel,
    updatedAt,
  };
}

function buildApkReleaseManifestUrls(input = {}) {
  const settings = normalizeApkReleaseServerSettings(input, { allowEmptyBaseUrl: false });
  const baseUrl = new URL(settings.releaseServerBaseUrl);
  if (baseUrl.pathname.toLowerCase().endsWith(".json")) {
    return [baseUrl.toString()];
  }

  const channel = encodeURIComponent(settings.channel);
  const baseHref = settings.releaseServerBaseUrl.endsWith("/")
    ? settings.releaseServerBaseUrl
    : `${settings.releaseServerBaseUrl}/`;
  const baseLeaf = path.posix.basename(baseUrl.pathname.replace(/\/+$/, ""));
  const releaseRootRelativePaths = [
    `${channel}/manifest.json`,
    `manifest-${channel}.json`,
    `manifest.json`,
    `release-manifest.json`,
  ];
  const serverRootRelativePaths = [
    `apk-release/${channel}/manifest.json`,
    `releases/${channel}/manifest.json`,
    `${channel}/manifest.json`,
    `manifest-${channel}.json`,
    `manifest.json`,
    `release-manifest.json`,
  ];
  const relativePaths = ["apk-release", "releases"].includes(baseLeaf)
    ? releaseRootRelativePaths
    : serverRootRelativePaths;
  const candidates = relativePaths.map((relativePath) => {
    const url = new URL(relativePath, baseHref);
    if (path.posix.basename(relativePath).includes("manifest.json") && !relativePath.includes(`${channel}/`)) {
      url.searchParams.set("channel", settings.channel);
    }
    return url.toString();
  });

  return [...new Set(candidates)];
}

function normalizeApkReleaseManifest(manifest, context = {}) {
  if (!isPlainObject(manifest)) {
    throw createApkReleaseError("Release manifest must be a JSON object.", 422, "ERR_APK_RELEASE_MANIFEST_OBJECT");
  }

  const schemaVersion = Number(requiredField(manifest, "schemaVersion"));
  if (!Number.isInteger(schemaVersion) || schemaVersion !== 1) {
    throw createApkReleaseError(
      "Release manifest requires schemaVersion 1.",
      422,
      "ERR_APK_RELEASE_SCHEMA_VERSION",
    );
  }

  const versionCodeRaw = requiredField(manifest, "latestVersionCode");
  const versionCode = Number(versionCodeRaw);
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw createApkReleaseError(
      "Release manifest requires a positive integer latestVersionCode.",
      422,
      "ERR_APK_RELEASE_VERSION_CODE",
    );
  }
  const latestVersionName = normalizeRequiredString(requiredField(manifest, "latestVersionName"), "latestVersionName");
  if (!latestVersionName) {
    throw createApkReleaseError("Release manifest requires latestVersionName.", 422, "ERR_APK_RELEASE_VERSION_NAME");
  }

  const packageName = normalizeRequiredString(requiredField(manifest, "packageName"), "packageName");
  const channel = normalizeRequiredString(requiredField(manifest, "channel"), "channel");
  const requestedChannel = normalizeReleaseChannel(context.channel || DEFAULT_APK_RELEASE_CHANNEL);
  if (channel !== requestedChannel) {
    throw createApkReleaseError(
      `Release manifest does not contain channel "${requestedChannel}".`,
      422,
      "ERR_APK_RELEASE_CHANNEL_MISSING",
    );
  }

  const apkUrlRaw = normalizeRequiredString(requiredField(manifest, "apkUrl"), "apkUrl");
  const apkUrl = normalizeApkUrl(apkUrlRaw, context);

  const apkSha256 = normalizeRequiredSha256(requiredField(manifest, "apkSha256"));
  const apkSizeBytes = normalizeRequiredSizeBytes(requiredField(manifest, "apkSizeBytes"));
  const signingCertificateSha256 = normalizeOptionalSha256(optionalField(manifest, "signingCertificateSha256"));
  const fileName = normalizeApkFileName(optionalField(manifest, "apkFileName"), apkUrl);
  const warnings = [];
  if (fileName && !fileName.toLowerCase().endsWith(".apk")) {
    warnings.push("APK URL path does not end in .apk.");
  }

  return {
    schemaVersion,
    channel,
    packageName,
    latestVersionCode: versionCode,
    latestVersionName,
    apkUrl,
    apkSha256,
    apkSizeBytes,
    signingCertificateSha256,
    runtimePayloadVersion: String(optionalField(manifest, "runtimePayloadVersion") || "").trim(),
    forceUpdate: normalizeOptionalBoolean(optionalField(manifest, "forceUpdate")),
    fileName,
    publishedAt: String(optionalField(manifest, "publishedAt") || "").trim(),
    releaseNotes: String(optionalField(manifest, "releaseNotes") || "").trim(),
    versionCode,
    versionName: latestVersionName,
    sizeBytes: apkSizeBytes,
    warnings,
  };
}

function readOpenHouseAiSettingsDocument(options = {}) {
  const settingsFile = resolveOpenHouseAiSettingsFile(options);
  if (!fs.existsSync(settingsFile)) {
    return {
      document: {},
      settingsFile,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  } catch (error) {
    throw createApkReleaseError(
      `OpenHouseAI settings file is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      500,
      "ERR_OPENHOUSEAI_SETTINGS_JSON",
    );
  }
  if (!isPlainObject(parsed)) {
    throw createApkReleaseError(
      "OpenHouseAI settings file must contain a JSON object.",
      500,
      "ERR_OPENHOUSEAI_SETTINGS_OBJECT",
    );
  }
  return {
    document: parsed,
    settingsFile,
  };
}

function resolveOpenHouseAiSettingsFile(options = {}) {
  if (options.settingsFile) {
    return path.resolve(String(options.settingsFile));
  }
  const paths = options.paths || resolveSmallPhonePaths(options);
  return path.resolve(paths.openhouseAiSettingsFile || path.join(paths.smallphoneHome, "openhouseai-settings.json"));
}

function extractApkReleaseSettings(input = {}) {
  const source = isPlainObject(input?.settings)
    ? input.settings
    : isPlainObject(input)
      ? input
      : {};
  const nested = isPlainObject(source.apkRelease)
    ? source.apkRelease
    : isPlainObject(source.apk_release)
      ? source.apk_release
      : {};
  return {
    releaseServerBaseUrl: firstDefined(
      source.releaseServerBaseUrl,
      source.release_server_base_url,
      source.baseUrl,
      source.base_url,
      nested.releaseServerBaseUrl,
      nested.release_server_base_url,
      nested.baseUrl,
      nested.base_url,
      nested.url,
    ),
    channel: firstDefined(
      source.channel,
      source.releaseChannel,
      source.release_channel,
      nested.channel,
      nested.releaseChannel,
      nested.release_channel,
    ),
    updatedAt: firstDefined(source.updatedAt, source.updated_at, nested.updatedAt, nested.updated_at),
  };
}

function requiredField(source, fieldName) {
  if (!isPlainObject(source) || !Object.prototype.hasOwnProperty.call(source, fieldName)) {
    throw createApkReleaseError(
      `Release manifest requires ${fieldName}.`,
      422,
      `ERR_APK_RELEASE_${fieldName.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_REQUIRED`,
    );
  }
  const value = source[fieldName];
  if (value == null || value === "") {
    throw createApkReleaseError(
      `Release manifest requires ${fieldName}.`,
      422,
      `ERR_APK_RELEASE_${fieldName.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_REQUIRED`,
    );
  }
  return value;
}

function optionalField(source, fieldName) {
  if (!isPlainObject(source) || !Object.prototype.hasOwnProperty.call(source, fieldName)) {
    return undefined;
  }
  return source[fieldName];
}

function normalizeRequiredString(value, fieldName) {
  const normalized = String(value == null ? "" : value).trim();
  if (!normalized) {
    throw createApkReleaseError(`Release manifest requires ${fieldName}.`, 422, "ERR_APK_RELEASE_STRING_REQUIRED");
  }
  return normalized;
}

function normalizeReleaseServerBaseUrl(value, options = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (options.allowEmpty) return "";
    throw createApkReleaseError(
      "APK release server base URL is required.",
      400,
      "ERR_APK_RELEASE_SERVER_REQUIRED",
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw createApkReleaseError(
      "APK release server base URL must be an absolute http(s) URL.",
      400,
      "ERR_APK_RELEASE_SERVER_URL",
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw createApkReleaseError(
      "APK release server base URL must use http or https.",
      400,
      "ERR_APK_RELEASE_SERVER_PROTOCOL",
    );
  }
  url.hash = "";
  const normalized = url.toString();
  if (url.pathname === "/" && !url.search) {
    return url.origin;
  }
  return normalized.replace(/\/+$/, "");
}

function normalizeReleaseChannel(value) {
  const raw = String(value || DEFAULT_APK_RELEASE_CHANNEL).trim() || DEFAULT_APK_RELEASE_CHANNEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw)) {
    throw createApkReleaseError(
      "APK release channel must use only letters, numbers, dot, underscore, or dash.",
      400,
      "ERR_APK_RELEASE_CHANNEL",
    );
  }
  return raw;
}

async function fetchReleaseManifestJson(manifestUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw createApkReleaseError("No fetch implementation is available.", 500, "ERR_APK_RELEASE_FETCH_UNAVAILABLE");
  }
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : DEFAULT_MANIFEST_TIMEOUT_MS;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
      controller.abort();
    }, timeoutMs)
    : null;
  timer?.unref?.();

  let response;
  try {
    response = await fetchImpl(manifestUrl, {
      headers: { accept: "application/json" },
      signal: controller?.signal,
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      error: error?.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const statusCode = Number(response?.status || 0);
  if (!response?.ok) {
    return {
      ok: false,
      statusCode,
      error: `HTTP ${statusCode || "error"} while fetching manifest.`,
    };
  }

  try {
    const manifest = typeof response.json === "function"
      ? await response.json()
      : JSON.parse(await response.text());
    return {
      ok: true,
      statusCode,
      manifest,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode,
      error: `Manifest response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function selectReleaseManifestRecord(manifest, channel) {
  const normalizedChannel = normalizeReleaseChannel(channel || manifest.channel || DEFAULT_APK_RELEASE_CHANNEL);
  const candidates = [];
  if (isPlainObject(manifest.channels?.[normalizedChannel])) {
    candidates.push({ channel: normalizedChannel, ...manifest.channels[normalizedChannel] });
  }
  if (Array.isArray(manifest.channels)) {
    candidates.push(...manifest.channels.filter(isPlainObject));
  }
  if (Array.isArray(manifest.releases)) {
    candidates.push(...manifest.releases.filter(isPlainObject));
  }
  if (isPlainObject(manifest.release)) {
    candidates.push(manifest.release);
  }
  if (isPlainObject(manifest.latest)) {
    candidates.push(manifest.latest);
  }
  if (isPlainObject(manifest[normalizedChannel])) {
    candidates.push({ channel: normalizedChannel, ...manifest[normalizedChannel] });
  }
  if (!candidates.length) {
    candidates.push(manifest);
  }

  const exact = candidates.find((item) => String(item.channel || "").trim() === normalizedChannel);
  if (exact) return exact;

  if (candidates.some((item) => String(item.channel || "").trim())) {
    throw createApkReleaseError(
      `Release manifest does not contain channel "${normalizedChannel}".`,
      422,
      "ERR_APK_RELEASE_CHANNEL_MISSING",
    );
  }

  return candidates[0];
}

function normalizeApkUrl(value, context = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim(), context.manifestUrl || context.releaseServerBaseUrl);
  } catch {
    throw createApkReleaseError("Release manifest APK URL is not a valid URL.", 422, "ERR_APK_RELEASE_APK_URL_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw createApkReleaseError("Release manifest APK URL must use http or https.", 422, "ERR_APK_RELEASE_APK_URL_PROTOCOL");
  }
  url.hash = "";
  return url.toString();
}

function normalizeOptionalSha256(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw createApkReleaseError("Release manifest apkSha256 must be a 64 character hex string.", 422, "ERR_APK_RELEASE_SHA256");
  }
  return raw.toLowerCase();
}

function normalizeRequiredSha256(value) {
  const normalized = normalizeOptionalSha256(value);
  if (!normalized) {
    throw createApkReleaseError("Release manifest requires apkSha256.", 422, "ERR_APK_RELEASE_SHA256_REQUIRED");
  }
  return normalized;
}

function normalizeRequiredSizeBytes(value) {
  if (value == null || value === "") {
    throw createApkReleaseError("Release manifest requires apkSizeBytes.", 422, "ERR_APK_RELEASE_SIZE_REQUIRED");
  }
  const size = Number(value);
  if (!Number.isInteger(size) || size <= 0) {
    throw createApkReleaseError("Release manifest apkSizeBytes must be a positive integer.", 422, "ERR_APK_RELEASE_SIZE");
  }
  return size;
}

function normalizeOptionalBoolean(value) {
  if (value === true || value === false) return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return false;
  if (["true", "1", "yes"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  throw createApkReleaseError("Release manifest forceUpdate must be a boolean.", 422, "ERR_APK_RELEASE_FORCE_UPDATE");
}

function normalizeApkFileName(value, apkUrl) {
  const fromUrl = (() => {
    try {
      return path.basename(new URL(apkUrl).pathname);
    } catch {
      return "";
    }
  })();
  const raw = String(value || fromUrl || "").trim();
  if (!raw) return "";
  if (raw.includes("/") || raw.includes("\\") || raw.includes("\0") || /[\r\n\t]/.test(raw)) {
    throw createApkReleaseError("Release manifest APK fileName must be a plain file name.", 422, "ERR_APK_RELEASE_FILENAME");
  }
  return raw.slice(0, 160);
}

function firstValueAtPaths(sources, paths) {
  for (const source of sources) {
    for (const keyPath of paths) {
      const value = readPath(source, keyPath);
      if (value != null && value !== "" && typeof value !== "object") {
        return value;
      }
    }
  }
  return undefined;
}

function firstStringAtPaths(sources, paths) {
  const value = firstValueAtPaths(sources, paths);
  return value == null ? "" : String(value).trim();
}

function readPath(source, keyPath) {
  if (!isPlainObject(source)) return undefined;
  const parts = String(keyPath).split(".");
  let cursor = source;
  for (const part of parts) {
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function mergeDefined(...objects) {
  const output = {};
  for (const object of objects) {
    if (!isPlainObject(object)) continue;
    for (const [key, value] of Object.entries(object)) {
      if (value !== undefined) output[key] = value;
    }
  }
  return output;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createApkReleaseError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  DEFAULT_APK_RELEASE_CHANNEL,
  buildApkReleaseManifestUrls,
  checkApkReleaseManifest,
  normalizeApkReleaseManifest,
  normalizeApkReleaseServerSettings,
  readApkReleaseServerSettings,
  resolveOpenHouseAiSettingsFile,
  writeApkReleaseServerSettings,
};
