const fs = require("fs");
const path = require("path");
const http = require("http");
const { Readable } = require("stream");
const { URL } = require("url");
const { applyCcConnectEnvDefaults } = require("./cc-connect-env");
const packageJson = require("../../package.json");

applyCcConnectEnvDefaults();

const { SmallPhoneService } = require("../../packages/domain/service");
const { isPathInside, resolveSmallPhonePaths } = require("../../packages/shared/paths");
const {
  checkApkReleaseManifest,
  readApkReleaseServerSettings,
  writeApkReleaseServerSettings,
} = require("../../packages/domain/apk-release");
const {
  checkSillyTavernGithubConnectivity,
  getSillyTavernConfig,
  getSillyTavernLocalStatus,
  installSillyTavern,
  resolveSillyTavernServiceRecord,
} = require("../../packages/domain/sillytavern");

const PORT = Number.parseInt(process.env.SMALLPHONE_PORT || "22000", 10);
const HOST = process.env.SMALLPHONE_HOST || "127.0.0.1";
const HOSTS = parseHostList(process.env.SMALLPHONE_HOSTS || HOST);
const WEB_ROOT = path.join(__dirname, "..", "web");
const SMALLPHONE_PATHS = resolveSmallPhonePaths({ env: process.env });
const TASK_WORKER_ENABLED = process.env.SMALLPHONE_TASK_WORKER_ENABLED !== "0";
const TASK_POLL_MS = Number.parseInt(process.env.SMALLPHONE_TASK_POLL_MS || "5000", 10);
const WEBCLIENT_POLL_INTERVAL_MS = process.env.SMALLPHONE_WEBCLIENT_POLL_INTERVAL_MS;
const WEBCLIENT_HISTORY_LIMIT = process.env.SMALLPHONE_WEBCLIENT_HISTORY_LIMIT;
const DATA_FILE = SMALLPHONE_PATHS.dataFile;
const SERVICE_MANAGER_URL = process.env.SMALLPHONE_SERVICE_MANAGER_URL || "http://127.0.0.1:20087";
const SERVICE_MANAGER_TIMEOUT_MS = process.env.SMALLPHONE_SERVICE_MANAGER_TIMEOUT_MS;
const SERVICE_MANAGER_TOKEN = process.env.SMALLPHONE_SERVICE_MANAGER_TOKEN || "";

const service = new SmallPhoneService({
  dataFile: DATA_FILE,
  paths: SMALLPHONE_PATHS,
  officialShellRoot: WEB_ROOT,
  runtime: {
    mode: process.env.SMALLPHONE_RUNTIME_MODE || "mock",
    command: process.env.SMALLPHONE_OPENCLAW_COMMAND || process.execPath,
    entry: process.env.SMALLPHONE_OPENCLAW_ENTRY || "",
    agentId: process.env.SMALLPHONE_OPENCLAW_AGENT_ID || "main",
    model: process.env.SMALLPHONE_OPENCLAW_MODEL || "",
    timeoutMs: process.env.SMALLPHONE_OPENCLAW_TIMEOUT_MS || "120000",
    openaiApiKey: process.env.SMALLPHONE_OPENCLAW_OPENAI_API_KEY || "",
    openaiBaseUrl: process.env.SMALLPHONE_OPENAI_BASE_URL || "",
    openaiModel: process.env.SMALLPHONE_OPENAI_MODEL || "",
    openaiReasoningEffort: process.env.SMALLPHONE_OPENAI_REASONING_EFFORT || "",
    baseUrl: process.env.SMALLPHONE_OPENCLAW_HTTP_URL || "",
    token: process.env.SMALLPHONE_OPENCLAW_HTTP_TOKEN || "",
    webclientBaseUrl: process.env.SMALLPHONE_WEBCLIENT_BASE_URL || "",
    webclientToken: process.env.SMALLPHONE_WEBCLIENT_TOKEN || "",
    webclientAppId: process.env.SMALLPHONE_WEBCLIENT_APP_ID || "",
    pollIntervalMs: WEBCLIENT_POLL_INTERVAL_MS ? Number.parseInt(WEBCLIENT_POLL_INTERVAL_MS, 10) : undefined,
    historyLimit: WEBCLIENT_HISTORY_LIMIT ? Number.parseInt(WEBCLIENT_HISTORY_LIMIT, 10) : undefined,
    ccConnectWsUrl: process.env.SMALLPHONE_CCCONNECT_WS_URL || "",
    ccConnectToken: process.env.SMALLPHONE_CCCONNECT_TOKEN || "",
    ccConnectProject: process.env.SMALLPHONE_CCCONNECT_PROJECT || "",
    ccConnectPlatform: process.env.SMALLPHONE_CCCONNECT_PLATFORM || "",
  },
  permissions: {
    ccConnectManagementUrl: process.env.SMALLPHONE_CCCONNECT_MANAGEMENT_URL || "",
    ccConnectManagementToken: process.env.SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN || "",
    clientId: process.env.SMALLPHONE_CLIENT_ID || "smallphone",
    appId: process.env.SMALLPHONE_APP_ID || "chat",
  },
  serviceManager: {
    baseUrl: SERVICE_MANAGER_URL,
    token: SERVICE_MANAGER_TOKEN,
    timeoutMs: SERVICE_MANAGER_TIMEOUT_MS || "",
  },
});

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseHostList(value) {
  const hosts = String(value || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return [...new Set(hosts.length ? hosts : ["127.0.0.1"])];
}

function createAppServer() {
  return http.createServer(handleRequest);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if ((req.method || "GET") === "GET" && url.pathname === "/health") {
      return sendHealth(res);
    }
    if (url.pathname.startsWith("/api/")) {
      setCorsHeaders(req, res);
      if ((req.method || "GET") === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      await handleApi(req, res, url);
      return;
    }
    if ((req.method || "GET") === "GET" && url.pathname.startsWith("/shells/")) {
      serveShellAsset(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    const status =
      Number.isFinite(Number(error?.statusCode)) && Number(error.statusCode) >= 400 && Number(error.statusCode) < 600
        ? Number(error.statusCode)
        : Number.isFinite(Number(error?.status)) && Number(error.status) >= 400 && Number(error.status) < 600
          ? Number(error.status)
          : 500;
    sendJson(res, status, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const listenHost of HOSTS) {
  const server = createAppServer();
  server.listen(PORT, listenHost, () => {
    console.log(`[smallphone] listening on http://${listenHost}:${PORT}`);
  });
}

process.on("SIGTERM", () => {
  process.exit(0);
});

if (TASK_WORKER_ENABLED) {
  setInterval(async () => {
    try {
      const summary = await service.executeDueReminders();
      if (summary.due || summary.sent || summary.skipped || summary.deferred || summary.failed) {
        console.log(`[smallphone] scheduled tasks checked due=${summary.due} sent=${summary.sent} skipped=${summary.skipped} deferred=${summary.deferred} failed=${summary.failed}`);
      }
    } catch (error) {
      console.error("[smallphone] scheduled task worker failed", error);
    }
  }, TASK_POLL_MS).unref();
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    return sendHealth(res);
  }
  if (method === "GET" && url.pathname === "/api/bootstrap") {
    return sendJson(res, 200, await service.bootstrapHydrated());
  }
  if (method === "GET" && url.pathname === "/api/user-content") {
    return sendJson(res, 200, service.getUserContent());
  }
  if (method === "PUT" && url.pathname === "/api/user-content") {
    const body = await readJson(req);
    return sendJson(res, 200, service.updateUserContent(body));
  }
  if (method === "GET" && url.pathname === "/api/app-registry") {
    return sendJson(res, 200, await service.getAppRegistry({ includeServiceManager: true }));
  }
  if (method === "GET" && url.pathname === "/api/menu-overrides") {
    return sendJson(res, 200, service.getMenuOverrides());
  }
  if (method === "PUT" && url.pathname === "/api/menu-overrides") {
    const body = await readJson(req);
    return sendJson(res, 200, service.updateMenuOverrides(body));
  }
  if (method === "GET" && url.pathname === "/api/components") {
    return sendJson(res, 200, service.getComponents());
  }
  if (method === "GET" && url.pathname === "/api/ai-capabilities") {
    return sendJson(res, 200, service.getAiCapabilities());
  }
  if (method === "GET" && url.pathname === "/api/workflows") {
    return sendJson(res, 200, service.listWorkflows());
  }
  if (method === "GET" && url.pathname === "/api/contact-workflows") {
    return sendJson(res, 200, service.listContactWorkflows());
  }

  if (method === "GET" && url.pathname === "/api/service-manager/health") {
    return sendJson(res, 200, await service.getServiceManagerHealth());
  }
  if (method === "GET" && url.pathname === "/api/service-manager/services") {
    return sendJson(res, 200, await service.listServiceManagerServices());
  }
  if (method === "GET" && url.pathname === "/api/apk-release/server") {
    return sendJson(res, 200, {
      ok: true,
      ...readApkReleaseServerSettings({ paths: SMALLPHONE_PATHS }),
    });
  }
  if (method === "PUT" && url.pathname === "/api/apk-release/server") {
    const body = await readJson(req);
    return sendJson(res, 200, {
      ok: true,
      ...writeApkReleaseServerSettings(body, { paths: SMALLPHONE_PATHS }),
    });
  }
  if (method === "POST" && url.pathname === "/api/apk-release/check") {
    const body = await readJson(req);
    return sendJson(res, 200, await checkApkReleaseManifest({
      paths: SMALLPHONE_PATHS,
      settings: body,
      timeoutMs: process.env.SMALLPHONE_APK_RELEASE_TIMEOUT_MS || "",
    }));
  }
  const serviceStatusMatch = url.pathname.match(/^\/api\/service-manager\/services\/([^/]+)\/status$/);
  if (method === "GET" && serviceStatusMatch) {
    return sendJson(res, 200, await service.getServiceManagerServiceStatus(serviceStatusMatch[1]));
  }
  const serviceLogsMatch = url.pathname.match(/^\/api\/service-manager\/services\/([^/]+)\/logs$/);
  if (method === "GET" && serviceLogsMatch) {
    const limit = url.searchParams.get("limit") || "";
    return sendJson(res, 200, await service.getServiceManagerServiceLogs(serviceLogsMatch[1], { limit }));
  }
  const serviceActionMatch = url.pathname.match(/^\/api\/service-manager\/services\/([^/]+)\/(start|stop|restart|repair)$/);
  if (method === "POST" && serviceActionMatch) {
    return sendJson(res, 200, await service.runServiceManagerServiceAction(serviceActionMatch[1], serviceActionMatch[2]));
  }

  if (url.pathname === "/api/sillytavern/status" && method === "GET") {
    return sendJson(res, 200, await getSillyTavernStatusPayload());
  }
  if (url.pathname === "/api/sillytavern/github-status" && method === "GET") {
    return sendJson(res, 200, await checkSillyTavernGithubConnectivity());
  }
  if (url.pathname === "/api/sillytavern/install" && method === "POST") {
    await readJson(req);
    return sendJson(res, 200, await installSillyTavern());
  }
  if (url.pathname === "/api/sillytavern/logs" && method === "GET") {
    const limit = url.searchParams.get("limit") || "300";
    const target = await getSillyTavernServiceTarget();
    if (!target.serviceRecord?.id) {
      return sendJson(res, 200, {
        ok: false,
        serviceManager: target.serviceManager,
        service: null,
        logs: null,
        error: target.error || "SillyTavern service is not registered.",
      });
    }
    return sendJson(res, 200, await service.getServiceManagerServiceLogs(target.serviceRecord.id, { limit }));
  }
  const sillyTavernActionMatch = url.pathname.match(/^\/api\/sillytavern\/(start|stop|restart|repair)$/);
  if (sillyTavernActionMatch && method === "POST") {
    const target = await getSillyTavernServiceTarget();
    if (!target.serviceRecord?.id) {
      return sendJson(res, 200, {
        ok: false,
        serviceManager: target.serviceManager,
        service: null,
        action: sillyTavernActionMatch[1],
        error: target.error || "SillyTavern service is not registered.",
      });
    }
    return sendJson(res, 200, await service.runServiceManagerServiceAction(target.serviceRecord.id, sillyTavernActionMatch[1]));
  }
  if (method === "POST" && url.pathname === "/api/attachments") {
    const body = await readJsonWithLimit(req, ATTACHMENT_UPLOAD_MAX_JSON_BYTES);
    const created = service.createAttachment(body);
    return sendJson(res, 200, created);
  }
  if (method === "POST" && url.pathname === "/api/avatars") {
    const body = await readJson(req);
    const created = service.createAvatar(body);
    return sendJson(res, 200, created);
  }
  if (method === "GET" && url.pathname === "/api/webclient-attachments") {
    const rawUrl = url.searchParams.get("url") || "";
    const download = await service.openWebclientAttachmentDownload(rawUrl);
    return serveProxiedAttachment(res, download);
  }
  const workspaceAttachmentMatch = url.pathname.match(/^\/api\/workspace-attachments\/([^/]+)$/);
  if (workspaceAttachmentMatch && method === "GET") {
    const rawPath = url.searchParams.get("path") || "";
    const download = service.openWorkspaceAttachmentDownload(rawPath, workspaceAttachmentMatch[1]);
    return serveWorkspaceAttachment(res, download);
  }
  const attachmentDetailMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
  if (attachmentDetailMatch && method === "GET") {
    const attachmentId = attachmentDetailMatch[1];
    const download = await service.openAttachmentDownload(attachmentId);
    if (download.kind === "local") {
      return serveLocalAttachment(res, download);
    }
    if (download.kind === "proxied") {
      return serveProxiedAttachment(res, download);
    }
    sendJson(res, 502, { error: "Remote attachment is not proxyable by this runtime." });
    return;
  }
  if (method === "GET" && url.pathname === "/api/contacts") {
    return sendJson(res, 200, await service.listContactsHydrated());
  }
  if (method === "GET" && url.pathname === "/api/openclaw/agents") {
    return sendJson(res, 200, service.exportOpenClawAgentRegistry());
  }
  if (method === "POST" && url.pathname === "/api/companions") {
    const body = await readJson(req);
    return sendJson(res, 200, await service.createCompanion(body));
  }
  const companionDetailMatch = url.pathname.match(/^\/api\/companions\/([^/]+)$/);
  if (companionDetailMatch && (method === "PUT" || method === "PATCH")) {
    const body = await readJson(req);
    return sendJson(res, 200, await service.updateCompanion(companionDetailMatch[1], body));
  }
  const companionArchiveMatch = url.pathname.match(/^\/api\/companions\/([^/]+)\/archive$/);
  if (companionArchiveMatch && method === "POST") {
    return sendJson(res, 200, service.archiveCompanion(companionArchiveMatch[1]));
  }
  if (companionDetailMatch && method === "DELETE") {
    return sendJson(res, 200, service.deleteCompanion(companionDetailMatch[1]));
  }
  if (method === "GET" && url.pathname === "/api/threads") {
    return sendJson(res, 200, await service.listThreadsHydrated());
  }
  if (method === "GET" && url.pathname === "/api/reminders") {
    return sendJson(res, 200, service.listReminders());
  }
  if (method === "GET" && url.pathname === "/api/proactive-tasks") {
    return sendJson(res, 200, service.listReminders());
  }
  if (method === "GET" && url.pathname === "/api/worldbook") {
    return sendJson(res, 200, service.listWorldbookEntries());
  }
  if (method === "POST" && url.pathname === "/api/worldbook") {
    const body = await readJson(req);
    return sendJson(res, 200, service.upsertWorldbookEntry(body));
  }
  if (method === "GET" && url.pathname === "/api/masks") {
    return sendJson(res, 200, service.listMaskDefinitions());
  }
  if (method === "POST" && url.pathname === "/api/masks") {
    const body = await readJson(req);
    return sendJson(res, 200, service.upsertMaskDefinition(body));
  }
  if (method === "GET" && url.pathname === "/api/relationships") {
    return sendJson(res, 200, service.listRelationshipStates());
  }
  if (method === "GET" && url.pathname === "/api/permissions/templates") {
    return sendJson(res, 200, await service.listPermissionTemplates());
  }
  if (method === "POST" && url.pathname === "/api/relationships") {
    const body = await readJson(req);
    return sendJson(res, 200, service.upsertRelationshipState(body));
  }
  if (method === "POST" && url.pathname === "/api/reminders") {
    const body = await readJson(req);
    return sendJson(res, 200, service.createReminder(body));
  }
  if (method === "POST" && url.pathname === "/api/proactive-tasks") {
    const body = await readJson(req);
    return sendJson(res, 200, service.createReminder(body));
  }
  if (method === "POST" && url.pathname === "/api/reminders/run-due") {
    return sendJson(res, 200, await service.executeDueReminders());
  }
  if (method === "POST" && url.pathname === "/api/proactive-tasks/run-due") {
    return sendJson(res, 200, await service.executeDueReminders());
  }
  if (method === "GET" && url.pathname === "/api/timeline") {
    return sendJson(res, 200, service.listTimeline());
  }
  if (method === "POST" && url.pathname === "/api/timeline") {
    const body = await readJson(req);
    return sendJson(res, 200, service.createTimelineEvent(body));
  }

  const reminderFireMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)\/fire$/);
  if (reminderFireMatch && method === "POST") {
    return sendJson(res, 200, await service.runReminder(reminderFireMatch[1]));
  }

  const proactiveTaskFireMatch = url.pathname.match(/^\/api\/proactive-tasks\/([^/]+)\/fire$/);
  if (proactiveTaskFireMatch && method === "POST") {
    return sendJson(res, 200, await service.runReminder(proactiveTaskFireMatch[1]));
  }

  const threadMessageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (threadMessageMatch && method === "GET") {
    return sendJson(res, 200, await service.getThreadMessages(threadMessageMatch[1]));
  }
  if (threadMessageMatch && method === "POST") {
    const body = await readJson(req);
    const result = await service.sendMessage(threadMessageMatch[1], body);
    return sendJson(res, 200, result);
  }

  const threadActionMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/actions$/);
  if (threadActionMatch && method === "POST") {
    const body = await readJson(req);
    const result = await service.sendThreadAction(threadActionMatch[1], body);
    return sendJson(res, 200, result);
  }

  const threadEventsMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/events$/);
  if (threadEventsMatch && method === "GET") {
    return openThreadEventStream(req, res, threadEventsMatch[1]);
  }

  const threadSessionRotateMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/session\/rotate$/);
  if (threadSessionRotateMatch && method === "POST") {
    const body = await readJson(req);
    return sendJson(res, 200, service.rotateThreadSession(threadSessionRotateMatch[1], body));
  }

  const threadSessionResetMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/session\/reset$/);
  if (threadSessionResetMatch && method === "POST") {
    const body = await readJson(req);
    return sendJson(res, 200, service.rotateThreadSession(threadSessionResetMatch[1], { ...body, mode: "hard" }));
  }

  const threadLateReplyRecoverMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/session\/recover-late-reply$/);
  if (threadLateReplyRecoverMatch && method === "POST") {
    return sendJson(res, 200, service.reconcileThreadLateReply(threadLateReplyRecoverMatch[1]));
  }

  const threadContextMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/context-preview$/);
  if (threadContextMatch && method === "POST") {
    const body = await readJson(req);
    return sendJson(res, 200, service.previewTurnContext(threadContextMatch[1], body));
  }

  const threadPromptBoardMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/prompt-board$/);
  if (threadPromptBoardMatch && method === "GET") {
    return sendJson(res, 200, service.getThreadPromptBoard(threadPromptBoardMatch[1]));
  }
  if (threadPromptBoardMatch && method === "PATCH") {
    const body = await readJson(req);
    return sendJson(res, 200, service.saveThreadPromptBoard(threadPromptBoardMatch[1], body));
  }

  const threadPromptBoardCompileMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/prompt-board\/compile$/);
  if (threadPromptBoardCompileMatch && method === "POST") {
    const body = await readJson(req);
    return sendJson(res, 200, await service.previewThreadPromptBoard(threadPromptBoardCompileMatch[1], body));
  }

  const threadTurnContextCacheMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/turn-context-cache$/);
  if (threadTurnContextCacheMatch && method === "GET") {
    return sendJson(res, 200, service.getTurnContextCache(threadTurnContextCacheMatch[1]));
  }

  const threadDebugMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/debug$/);
  if (threadDebugMatch && method === "GET") {
    return sendJson(res, 200, service.getThreadDebugSnapshot(threadDebugMatch[1]));
  }

  const threadPermissionsMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/permissions$/);
  if (threadPermissionsMatch && method === "GET") {
    return sendJson(res, 200, await service.getThreadPermissions(threadPermissionsMatch[1]));
  }
  if (threadPermissionsMatch && method === "POST") {
    const body = await readJson(req);
    return sendJson(res, 200, await service.saveThreadPermissions(threadPermissionsMatch[1], body));
  }

  const threadRuntimeProjectSettingsMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/runtime-project-settings$/);
  if (threadRuntimeProjectSettingsMatch && method === "GET") {
    return sendJson(res, 200, await service.getThreadRuntimeProjectSettings(threadRuntimeProjectSettingsMatch[1]));
  }
  if (threadRuntimeProjectSettingsMatch && method === "PATCH") {
    const body = await readJson(req);
    return sendJson(res, 200, await service.saveThreadRuntimeProjectSettings(threadRuntimeProjectSettingsMatch[1], body));
  }

  const worldbookDetailMatch = url.pathname.match(/^\/api\/worldbook\/([^/]+)$/);
  if (worldbookDetailMatch && method === "DELETE") {
    return sendJson(res, 200, service.deleteWorldbookEntry(worldbookDetailMatch[1]));
  }

  const maskDetailMatch = url.pathname.match(/^\/api\/masks\/([^/]+)$/);
  if (maskDetailMatch && method === "DELETE") {
    return sendJson(res, 200, service.deleteMaskDefinition(maskDetailMatch[1]));
  }

  const relationshipDetailMatch = url.pathname.match(/^\/api\/relationships\/([^/]+)$/);
  if (relationshipDetailMatch && method === "DELETE") {
    return sendJson(res, 200, service.deleteRelationshipState(relationshipDetailMatch[1]));
  }

  sendJson(res, 404, { error: `Route not found: ${method} ${url.pathname}` });
}

async function getSillyTavernStatusPayload() {
  const local = getSillyTavernLocalStatus();
  const target = await getSillyTavernServiceTarget();
  let status = null;
  if (target.serviceRecord?.id) {
    status = await service.getServiceManagerServiceStatus(target.serviceRecord.id);
  }
  return {
    ...local,
    serviceManager: target.serviceManager,
    service: status?.service || target.serviceRecord || null,
    registered: Boolean(target.serviceRecord?.id),
    error: target.error || status?.error || "",
  };
}

async function getSillyTavernServiceTarget() {
  const config = getSillyTavernConfig();
  const lookup = await service.listServiceManagerServices();
  const serviceManager = lookup?.serviceManager || { available: false, configured: false };
  const services = Array.isArray(lookup?.services) ? lookup.services : [];
  const serviceRecord = resolveSillyTavernServiceRecord(services, config);
  return {
    serviceManager,
    serviceRecord,
    error: lookup?.error || "",
  };
}

function serveLocalAttachment(res, download) {
  const filePath = path.resolve(download.localPath);
  if (!isManagedAttachmentFile(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }
  const mimeType = String(download.mimeType || "").trim() || "application/octet-stream";
  const fileName = sanitizeHeaderFileName(download.fileName || path.basename(filePath));
  const disposition = mimeType.startsWith("image/") ? "inline" : "attachment";
  res.writeHead(200, {
    "content-type": mimeType,
    "content-disposition": `${disposition}; filename=\"${fileName}\"`,
    "cache-control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveWorkspaceAttachment(res, download) {
  const filePath = path.resolve(download.localPath);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    sendText(res, 404, "Not found");
    return;
  }
  const mimeType = String(download.mimeType || "").trim() || "application/octet-stream";
  const fileName = sanitizeHeaderFileName(download.fileName || path.basename(filePath));
  const disposition = mimeType.startsWith("image/") ? "inline" : "attachment";
  res.writeHead(200, {
    "content-type": mimeType,
    "content-length": stat.size,
    "content-disposition": `${disposition}; filename=\"${fileName}\"`,
  });
  fs.createReadStream(filePath).pipe(res);
}

function isManagedAttachmentFile(filePath) {
  return service.isManagedAttachmentFile(filePath);
}

function safeRealpath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return "";
  }
}

function serveProxiedAttachment(res, download) {
  const statusCode = Number.isFinite(Number(download.statusCode)) ? Number(download.statusCode) : 200;
  const headers = sanitizeProxyHeaders(download.headers || {});
  const mimeType = String(download.mimeType || headers["content-type"] || "").trim() || "application/octet-stream";
  const fileName = sanitizeHeaderFileName(download.fileName || "attachment");
  const disposition = mimeType.startsWith("image/") ? "inline" : "attachment";
  res.writeHead(statusCode, {
    ...headers,
    "content-type": mimeType,
    "content-disposition": `${disposition}; filename=\"${fileName}\"`,
  });

  const body = download.body;
  if (!body) {
    res.end();
    return;
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    res.end(body);
    return;
  }
  if (typeof body.pipe === "function") {
    body.pipe(res);
    return;
  }
  if (typeof body.getReader === "function") {
    Readable.fromWeb(body).pipe(res);
    return;
  }
  res.end();
}

function sanitizeProxyHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = String(key || "").toLowerCase();
    if (!name) continue;
    if (name === "set-cookie" || name === "cookie" || name === "authorization") continue;
    output[name] = value;
  }
  delete output["content-length"];
  delete output["content-encoding"];
  return output;
}

function sanitizeHeaderFileName(input) {
  const raw = String(input || "").trim() || "attachment";
  return raw.replace(/[/\\\\\\r\\n\\t\\0]/g, "_").slice(0, 160);
}

function serveStatic(req, res, url) {
  const candidate = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(WEB_ROOT, candidate);
  if (!filePath.startsWith(WEB_ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(filePath).pipe(res);
}

function serveShellAsset(req, res, url) {
  const match = url.pathname.match(/^\/shells\/([^/]+)\/?(.*)$/);
  if (!match) {
    sendText(res, 404, "Not found");
    return;
  }
  let shellId = "";
  let assetPath;
  try {
    shellId = decodeURIComponent(match[1] || "");
    assetPath = match[2] ? decodeURIComponent(match[2]) : undefined;
  } catch {
    sendText(res, 400, "Invalid path");
    return;
  }
  let asset;
  try {
    asset = service.resolveShellAssetPath({ shellId, assetPath });
  } catch {
    sendText(res, 403, "Forbidden");
    return;
  }
  serveResolvedStaticFile(res, asset.filePath, asset.root);
}

function serveResolvedStaticFile(res, filePath, root) {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (!isPathInside(resolvedRoot, resolvedFile) || resolvedFile === resolvedRoot) {
    sendText(res, 403, "Forbidden");
    return;
  }
  let stat;
  try {
    stat = fs.lstatSync(resolvedFile);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    sendText(res, 404, "Not found");
    return;
  }
  const rootReal = safeRealpath(resolvedRoot) || resolvedRoot;
  const fileReal = safeRealpath(resolvedFile) || resolvedFile;
  if (!isPathInside(rootReal, fileReal) || fileReal === rootReal) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const ext = path.extname(resolvedFile);
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(resolvedFile).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHealth(res) {
  return sendJson(res, 200, {
    ...service.getHealth(),
    version: packageJson.version,
  });
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function openThreadEventStream(req, res, threadId) {
  const unsubscribe = service.subscribeThreadEvents(threadId, (event) => {
    writeSse(res, event);
  });
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function readJsonWithLimit(req, maxBytes) {
  const limit = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`Payload too large (max ${limit} bytes).`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const ATTACHMENT_UPLOAD_MAX_JSON_BYTES = Number.parseInt(
  process.env.SMALLPHONE_ATTACHMENT_UPLOAD_MAX_JSON_BYTES || "20971520",
  10,
);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
