const fs = require("fs");
const path = require("path");
const {
  DEFAULT_OFFICIAL_SHELL_ID,
  JsonStore,
  createDefaultUserContent,
  projectPublicUserContentCollection,
  sanitizePublicUserContentValue,
} = require("../storage/json-store");
const { createRuntimeAdapter } = require("../openclaw-adapter");
const { createId, nowIso } = require("../shared/types");
const {
  isPathInside,
  resolveShellAssetPath,
  resolveSmallPhonePaths,
} = require("../shared/paths");
const {
  assertAllowedMimeType,
  assertMaxBytes,
  ensureDir,
  inferKind,
  normalizeAttachmentIds,
  parseBase64Upload,
  sanitizeFileName,
  sanitizeMimeType,
  sanitizePathSegment,
} = require("./attachments");

const DEFAULT_PATHS = resolveSmallPhonePaths();
const MANAGED_BLOCK_START = "BEGIN_SMALLPHONE_MANAGED_BLOCK";
const MANAGED_BLOCK_END = "END_SMALLPHONE_MANAGED_BLOCK";
const OPENCLAW_AGENT_LIST_START = "BEGIN_SMALLPHONE_AGENT_LIST";
const OPENCLAW_AGENT_LIST_END = "END_SMALLPHONE_AGENT_LIST";
const OPENCLAW_AGENT_CONFIG_PATHS = [
  "/root/projects/smallphone/openclaw.global.openclaw.json",
  "/root/projects/smallphone/openclaw-smallphone.json",
];
const OPENCLAW_AGENT_REGISTRY_PATH = DEFAULT_PATHS.openclawAgentRegistryPath;
const OPENCLAW_SMALLPHONE_SESSION_ROOT = "/root/.openclaw/plugins/smallphone/sessions";
const OPENCLAW_SMALLPHONE_TURN_CONTEXT_ROOT = "/root/.openclaw/plugins/smallphone/turn-context";
const LATE_RUNTIME_REPLY_GRACE_MS = 30000;
const LATE_RUNTIME_REPLY_POLL_MS = 2000;
const ATTACHMENT_MAX_BYTES = Number.parseInt(
  process.env.SMALLPHONE_ATTACHMENT_MAX_BYTES || "10485760",
  10,
);
const AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const WORKSPACE_ATTACHMENT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".txt", ".md", ".csv", ".json"]);
const WORKSPACE_ATTACHMENT_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
};
const DEFAULT_TIMEZONE = "Etc/UTC";
const DEFAULT_PERMISSION_TEMPLATE = "safe";
const DEFAULT_PERMISSION_CHECKS = [
  "chat.send",
  "session.read",
  "project.context.read",
  "model.use",
  "tool.read",
  "tool.write",
  "tool.shell.exec",
];
const FALLBACK_PERMISSION_TEMPLATES = {
  safe: {
    "chat.send": "allow",
    "session.read": "allow",
    "project.context.read": "forbid",
    "model.use": "ask",
    "tool.read": "forbid",
    "tool.write": "forbid",
    "tool.shell.exec": "forbid",
    "tool.*": "forbid",
  },
  assist: {
    "chat.send": "allow",
    "session.read": "allow",
    "project.context.read": "allow",
    "model.use": "ask",
    "tool.read": "allow",
    "tool.write": "ask",
    "tool.shell.exec": "ask",
  },
  developer: {
    "chat.send": "allow",
    "session.read": "allow",
    "project.context.read": "allow",
    "model.use": "allow",
    "tool.read": "allow",
    "tool.write": "ask",
    "tool.shell.exec": "ask",
  },
  trusted: {
    "*": "allow",
  },
};

class SmallPhoneService {
  constructor(options = {}) {
    const deriveHomeFromDataFile = Boolean(options.dataFile && !options.smallphoneHome && !options.paths);
    this.paths =
      options.paths ||
      resolveSmallPhonePaths({
        env: options.env,
        dataFile: options.dataFile,
        smallphoneHome: options.smallphoneHome,
        deriveHomeFromDataFile,
      });
    const dataFile = options.dataFile || this.paths.dataFile;
    const storeOptions = {
      dataFile,
      paths: this.paths,
    };
    if (Object.prototype.hasOwnProperty.call(options, "legacySeedFile")) {
      storeOptions.legacySeedFile = options.legacySeedFile;
    } else if (deriveHomeFromDataFile) {
      storeOptions.legacySeedFile = "";
    }
    this.store = new JsonStore(storeOptions);
    this.attachmentsRoot = this.paths.attachmentsRoot;
    this.attachmentsRootResolved = path.resolve(this.attachmentsRoot);
    this.officialShellRoot = path.resolve(options.officialShellRoot || path.join(__dirname, "..", "..", "apps", "web"));
    this.runtime = createRuntimeAdapter(options.runtime || {});
    this.runtimeInfo = this.runtime.describe();
    this.webclientChat = createWebclientChatClient(options.runtime || {});
    this.permissions = createPermissionClient(options.permissions || {});
    this.permissionInfo = this.permissions.describe();
    this.ccConnectProjects = createCcConnectProjectClient({
      ...(options.projectManagement || {}),
      webclientBaseUrl: options.runtime?.webclientBaseUrl || options.projectManagement?.webclientBaseUrl || "",
      webclientToken: options.runtime?.webclientToken || options.projectManagement?.webclientToken || "",
      ccConnectManagementUrl:
        options.projectManagement?.ccConnectManagementUrl || options.permissions?.ccConnectManagementUrl || "",
      ccConnectManagementToken:
        options.projectManagement?.ccConnectManagementToken || options.permissions?.ccConnectManagementToken || "",
    });
    this.projectInfo = this.ccConnectProjects.describe();
    this.artifactSync = normalizeArtifactSyncOptions(options.artifactSync, this.paths);
    this.threadEventSubscribers = new Map();
  }

  bootstrap() {
    const state = this.store.read();
    this.syncManagedArtifacts(state);
    return {
      app: {
        name: "SmallPhone",
        version: "0.1.0",
        stage: "P0",
      },
      runtime: this.runtimeInfo,
      permissions: this.permissionInfo,
      projects: this.projectInfo,
      stats: {
        contacts: state.contacts.length,
        threads: state.threads.length,
        messages: state.messages.length,
        attachments: Array.isArray(state.attachments) ? state.attachments.length : 0,
        reminders: state.reminders.length,
        worldbookEntries: state.worldbookEntries.length,
        maskDefinitions: state.maskDefinitions.length,
        relationshipStates: state.relationshipStates.length,
      },
      contacts: this.listContacts(),
      threads: this.listThreads(),
    };
  }

  async bootstrapHydrated() {
    const payload = this.bootstrap();
    const threads = await this.listThreadsHydrated();
    const contacts = payload.contacts.map((contact) => {
      const thread = threads.find((item) => item.contactId === contact.id) || contact.thread || null;
      return {
        ...contact,
        thread,
      };
    });
    return {
      ...payload,
      contacts,
      threads,
    };
  }

  getUserContent() {
    return selectUserContent(this.store.read());
  }

  updateUserContent(input = {}) {
    const updatedAt = nowIso();
    this.store.update((state) => {
      applyUserContentPatch(state, input, updatedAt);
      return state;
    });
    return this.getUserContent();
  }

  getAppRegistry() {
    const content = this.getUserContent();
    const activeShell = content.shells.find((item) => item.id === content.activeShell) ||
      content.shells.find((item) => item.id === DEFAULT_OFFICIAL_SHELL_ID) ||
      null;
    return {
      generatedAt: nowIso(),
      apps: content.apps,
      appInstances: content.appInstances,
      themes: content.themes,
      desktopLayouts: content.desktopLayouts,
      shells: content.shells,
      activeShell: content.activeShell,
      activeShellRecord: activeShell,
    };
  }

  getActiveShell() {
    const state = this.store.read();
    return resolveActiveShellRecord(state);
  }

  resolveShellAssetPath(params = {}) {
    const state = this.store.read();
    const requestedShellId = String(params.shellId || "").trim();
    const shell = requestedShellId
      ? state.shells.find((item) => item.id === requestedShellId) || null
      : resolveActiveShellRecord(state);
    if (requestedShellId && !shell) {
      throw new Error(`Shell not found: ${requestedShellId}`);
    }
    const shellRecord =
      shell ||
      state.shells.find((item) => item.id === DEFAULT_OFFICIAL_SHELL_ID) ||
      createDefaultUserContent(nowIso()).shells[0];
    return resolveShellAssetPath({
      paths: this.paths,
      officialRoot: this.officialShellRoot,
      shell: shellRecord,
      assetPath: params.assetPath || params.path,
    });
  }

  listContacts() {
    const state = this.store.read();
    this.syncManagedArtifacts(state);
    return state.contacts.map((contact) => {
      const character = hydrateCharacter(state, state.characters.find((item) => item.id === contact.characterId) || null);
      const thread = state.threads.find((item) => item.contactId === contact.id) || null;
      const routedThread = thread ? attachThreadRouting(thread, this.runtimeInfo.id, this.paths) : null;
      const timeSettings = resolveThreadTimeSettings({ contact, thread });
      return {
        ...contact,
        timeSettings,
        character,
        thread: routedThread
          ? {
              ...routedThread,
              timeSettings,
              summary: resolveThreadProfileSummary(routedThread, contact, character),
            }
          : null,
        relationshipState:
          state.relationshipStates.find(
            (item) => item.contactId === contact.id && (!thread || item.threadId === thread.id),
          ) || null,
      };
    });
  }

  async listContactsHydrated() {
    const contacts = this.listContacts();
    const threads = await this.listThreadsHydrated();
    return contacts.map((contact) => {
      const thread = threads.find((item) => item.contactId === contact.id) || contact.thread || null;
      return {
        ...contact,
        thread,
      };
    });
  }

  listThreads() {
    const state = this.store.read();
    this.syncManagedArtifacts(state);
    return state.threads.map((thread) => {
      const contact = state.contacts.find((item) => item.id === thread.contactId) || null;
      const character = contact ? hydrateCharacter(state, state.characters.find((item) => item.id === contact.characterId) || null) : null;
      const lastMessage = state.messages.filter((item) => item.threadId === thread.id).at(-1) || null;
      const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
      const timeSettings = resolveThreadTimeSettings({ contact, thread });
      return {
        ...routedThread,
        timeSettings,
        summary: resolveThreadProfileSummary(routedThread, contact, character),
        contact: contact ? { ...contact, timeSettings, character } : null,
        lastMessage,
        relationshipState:
          state.relationshipStates.find(
            (item) => item.threadId === thread.id || item.contactId === thread.contactId,
          ) || null,
      };
    });
  }

  async listThreadsHydrated() {
    const threads = this.listThreads();
    if (this.runtimeInfo.id !== "cc-webclient") {
      return threads;
    }
    const hydrated = await Promise.all(
      threads.map(async (thread) => this.hydrateThreadWithWebclientLastMessage(thread)),
    );
    return hydrated;
  }

  async hydrateThreadWithWebclientLastMessage(thread) {
    if (!thread) {
      return thread;
    }
    try {
      const messages = await this.getThreadMessages(thread.id);
      const lastMessage = messages.at(-1) || thread.lastMessage || null;
      return {
        ...thread,
        lastMessage,
      };
    } catch {
      return thread;
    }
  }

  getThread(threadId) {
    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return thread;
  }

  getMessages(threadId) {
    const state = this.store.read();
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      throw new Error("Thread id is required.");
    }
    return state.messages
      .filter((item) => item.threadId === normalizedThreadId)
      .map((message) => this.hydrateMessage(state, message));
  }

  async getThreadMessages(threadId) {
    const state = this.store.read();
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      throw new Error("Thread id is required.");
    }
    const localMessages = state.messages
      .filter((item) => item.threadId === normalizedThreadId)
      .map((message) => this.hydrateMessage(state, message));
    const thread = state.threads.find((item) => item.id === normalizedThreadId) || null;
    if (this.runtimeInfo.id !== "cc-webclient" || !thread) {
      return localMessages;
    }
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const project = resolveWebclientProjectForThread(routedThread, this.runtimeInfo.project);
    const sessionId = String(thread.runtimeSessionId || "").trim();
    if (!project || !sessionId) {
      return localMessages;
    }
    try {
      const sessionData = await this.webclientChat.getSessionHistory({
        project,
        sessionId,
        historyLimit: 200,
        runEventsLimit: 200,
      });
      const assistantMessages = mapWebclientHistoryToAssistantMessages(
        sessionData.history,
        normalizedThreadId,
        sessionId,
        sessionData.runEvents,
        routedThread.runtime?.workspaceDir || "",
      );
      if (!assistantMessages.length) {
        return localMessages;
      }
      return mergeLocalUserMessagesWithWebclientAssistants(localMessages, assistantMessages);
    } catch {
      return localMessages;
    }
  }

  getAttachment(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) {
      throw new Error("Attachment id is required.");
    }
    const state = this.store.read();
    const attachment = state.attachments.find((item) => item.id === id) || null;
    if (!attachment) {
      throw new Error(`Attachment not found: ${id}`);
    }
    return attachment;
  }

  async openAttachmentDownload(attachmentId) {
    const attachment = this.getAttachment(attachmentId);
    const localPath = this.sanitizeManagedAttachmentPath(attachment.localPath);
    if (localPath && this.isManagedAttachmentFile(localPath)) {
      return {
        kind: "local",
        localPath,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      };
    }
    if (attachment.url) {
      return this.openRuntimeAttachmentDownload(attachment.url, attachment);
    }
    throw new Error(`Attachment has no data: ${attachment.id}`);
  }

  async openWebclientAttachmentDownload(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) {
      throw new Error("Attachment url is required.");
    }
    return this.openRuntimeAttachmentDownload(url, {
      fileName: "attachment",
      mimeType: "application/octet-stream",
    });
  }

  openWorkspaceAttachmentDownload(rawPath, threadId) {
    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === String(threadId || "").trim());
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const workspaceDir = String(attachThreadRouting(thread, this.runtimeInfo.id, this.paths)?.runtime?.workspaceDir || "").trim();
    const filePath = resolveWorkspaceAttachmentPath(rawPath, workspaceDir);
    if (!filePath) {
      throw new Error("Workspace attachment is not allowed.");
    }
    const stat = fs.statSync(filePath);
    const mimeType = mimeTypeForWorkspaceFile(filePath);
    return {
      kind: "local",
      localPath: filePath,
      fileName: path.basename(filePath),
      mimeType,
      size: stat.size,
    };
  }

  async openRuntimeAttachmentDownload(url, attachment = {}) {
    if (typeof this.runtime?.fetchAttachment === "function") {
      const fetched = await this.runtime.fetchAttachment({ url, attachment });
      return {
        kind: "proxied",
        statusCode: fetched?.statusCode || 200,
        headers: fetched?.headers || {},
        body: fetched?.body,
        fileName: fetched?.fileName || attachment.fileName,
        mimeType: fetched?.mimeType || attachment.mimeType,
      };
    }
    return {
      kind: "remote_unproxied",
      url,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  }

  sanitizeManagedAttachmentPath(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "";
    const resolved = path.resolve(raw);
    for (const root of this.attachmentReadRoots()) {
      if (resolved !== root && isPathInside(root, resolved)) {
        return resolved;
      }
    }
    return "";
  }

  isManagedAttachmentFile(localPath) {
    const resolved = this.sanitizeManagedAttachmentPath(localPath);
    if (!resolved) {
      return false;
    }
    try {
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return false;
      }
      const fileReal = safeRealpath(resolved) || resolved;
      return this.attachmentReadRoots().some((root) => {
        const rootReal = safeRealpath(root) || root;
        return fileReal !== rootReal && isPathInside(rootReal, fileReal);
      });
    } catch {
      return false;
    }
  }

  attachmentReadRoots() {
    return [this.attachmentsRootResolved, this.paths.legacyAttachmentsRoot]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .map((item) => path.resolve(item))
      .filter((item, index, all) => all.indexOf(item) === index);
  }

  createAttachment(input) {
    const parsed = parseBase64Upload(input?.data || input?.content || input?.base64 || "");
    const mimeType = sanitizeMimeType(input?.mimeType || input?.mime || input?.contentType || parsed.mimeType || "");
    assertAllowedMimeType(mimeType);

    const fileName = sanitizeFileName(input?.fileName || input?.filename || input?.name || "");
    const buffer = Buffer.from(parsed.base64, "base64");
    assertMaxBytes(buffer.length, ATTACHMENT_MAX_BYTES);

    const requestedThreadId = String(input?.threadId || "").trim();
    const threadId = requestedThreadId ? requestedThreadId : "";
    if (threadId) {
      // Validate thread exists if client claims it.
      this.getThread(threadId);
    }

    const id = createId("att");
    const createdAt = nowIso();
    const threadSegment = sanitizePathSegment(threadId) || "unbound";
    const dir = path.join(this.attachmentsRoot, threadSegment, id);
    ensureDir(dir);
    const localPath = path.join(dir, fileName);
    fs.writeFileSync(localPath, buffer);

    const record = {
      id,
      threadId,
      messageId: "",
      role: "",
      kind: inferKind(mimeType),
      fileName,
      mimeType,
      size: buffer.length,
      source: "smallphone-upload",
      localPath,
      url: "",
      createdAt,
    };

    this.store.update((draft) => {
      if (!Array.isArray(draft.attachments)) {
        draft.attachments = [];
      }
      draft.attachments.push(record);
      return draft;
    });

    return this.exposeAttachment(record);
  }

  createAvatar(input) {
    const parsed = parseBase64Upload(input?.data || input?.content || input?.base64 || "");
    const mimeType = sanitizeMimeType(input?.mimeType || input?.mime || input?.contentType || parsed.mimeType || "");
    if (!AVATAR_MIME_TYPES.has(mimeType)) {
      throw new Error(`Avatar mimeType not allowed: ${mimeType || "missing"}`);
    }

    const fileName = sanitizeFileName(input?.fileName || input?.filename || input?.name || `avatar.${extensionForMimeType(mimeType)}`);
    const buffer = Buffer.from(parsed.base64, "base64");

    const id = createId("att");
    const createdAt = nowIso();
    const dir = path.join(this.attachmentsRoot, "avatars", id);
    ensureDir(dir);
    const localPath = path.join(dir, fileName);
    fs.writeFileSync(localPath, buffer);

    const record = {
      id,
      threadId: "",
      messageId: "",
      role: "",
      kind: "image",
      purpose: "avatar",
      fileName,
      mimeType,
      size: buffer.length,
      source: "smallphone-avatar-upload",
      localPath,
      url: "",
      createdAt,
    };

    this.store.update((draft) => {
      if (!Array.isArray(draft.attachments)) {
        draft.attachments = [];
      }
      draft.attachments.push(record);
      return draft;
    });

    return this.exposeAttachment(record);
  }

  assertAvatarAttachmentId(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) return;
    const state = this.store.read();
    const attachment = state.attachments.find((item) => item.id === id) || null;
    if (!attachment) {
      throw new Error(`Avatar attachment not found: ${id}`);
    }
    const mimeType = sanitizeMimeType(attachment.mimeType || "");
    if (attachment.kind !== "image" || !AVATAR_MIME_TYPES.has(mimeType)) {
      throw new Error(`Avatar attachment must be an image: ${id}`);
    }
  }

  exposeAttachment(record) {
    return {
      id: record.id,
      kind: record.kind,
      purpose: record.purpose || "",
      fileName: record.fileName,
      mimeType: record.mimeType,
      size: record.size,
      role: record.role || "",
      threadId: record.threadId || "",
      messageId: record.messageId || "",
      createdAt: record.createdAt,
      downloadUrl: `/api/attachments/${record.id}`,
    };
  }

  hydrateMessage(state, message) {
    const attachmentIds = normalizeAttachmentIds(message?.attachmentIds || []);
    const attachments = attachmentIds
      .map((id) => state.attachments.find((item) => item.id === id) || null)
      .filter(Boolean)
      .map((record) => this.exposeAttachment(record));
    return {
      ...message,
      attachmentIds,
      attachments,
    };
  }

  subscribeThreadEvents(threadId, listener) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      throw new Error("Thread id is required.");
    }
    this.getThread(normalizedThreadId);
    if (!this.threadEventSubscribers.has(normalizedThreadId)) {
      this.threadEventSubscribers.set(normalizedThreadId, new Set());
    }
    const listeners = this.threadEventSubscribers.get(normalizedThreadId);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.threadEventSubscribers.delete(normalizedThreadId);
      }
    };
  }

  emitThreadEvent(threadId, event) {
    const listeners = this.threadEventSubscribers.get(String(threadId || "").trim());
    if (!listeners?.size) return;
    const payload = {
      threadId,
      createdAt: nowIso(),
      ...event,
    };
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {}
    }
  }

  rotateThreadSession(threadId, input = {}) {
    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const contact = state.contacts.find((item) => item.id === thread.contactId) || null;
    const mode = normalizeSessionRotationMode(input?.mode);
    const currentGeneration = getSessionGeneration(thread);
    const nextGeneration = currentGeneration + 1;
    const nextSessionKey = buildThreadSessionKey(thread.id, nextGeneration);
    const handoffSummary =
      mode === "continue"
        ? normalizeSessionResumeSummary(
            input?.resumeSummary,
            buildSessionResumeSummary({
              thread,
              contact,
              messages: state.messages.filter((item) => item.threadId === thread.id),
            }),
          )
        : "";
    const rotatedAt = nowIso();

    const nextState = this.store.update((draft) => {
      const liveThread = draft.threads.find((item) => item.id === threadId);
      if (!liveThread) {
        throw new Error(`Thread not found during session rotation: ${threadId}`);
      }
      liveThread.runtimeSessionId = "";
      liveThread.updatedAt = rotatedAt;
      liveThread.runtime = {
        ...(liveThread.runtime || {}),
        provider: this.runtimeInfo.id || liveThread.runtime?.provider || "mock",
        model: liveThread.runtime?.model || this.runtimeInfo.model || "",
        agentId: liveThread.runtime?.agentId || defaultAgentId(liveThread),
        workspaceDir: liveThread.runtime?.workspaceDir || defaultWorkspaceDir(liveThread, this.paths),
        sessionKey: nextSessionKey,
        sessionGeneration: nextGeneration,
        resumeSummary: handoffSummary,
      };
      draft.turnContextCache = draft.turnContextCache.filter((item) => item.threadId !== threadId);
      draft.timeline.push({
        id: createId("tl"),
        threadId,
        type: "system",
        title: mode === "continue" ? "Thread session rotated" : "Thread session reset",
        detail:
          mode === "continue"
            ? `${liveThread.title} 已续到新 session ${nextSessionKey}，保留同一窗口/agent/workspace。`
            : `${liveThread.title} 已重置 session 为 ${nextSessionKey}，不继承上一段会话态。`,
        createdAt: rotatedAt,
      });
      return draft;
    });

    this.syncManagedArtifacts(nextState);
    return {
      mode,
      rotatedAt,
      previousSessionKey: String(thread.runtime?.sessionKey || "").trim() || buildThreadSessionKey(thread.id, currentGeneration),
      nextSessionKey,
      sessionGeneration: nextGeneration,
      resumeSummary: handoffSummary,
      thread: this.listThreads().find((item) => item.id === threadId) || null,
    };
  }

  async createCompanion(input) {
    const payload = normalizeCompanionInput(input);
    this.assertAvatarAttachmentId(payload.avatarAttachmentId);
    const createdAt = nowIso();
    let created = null;
    const nextState = this.store.update((state) => {
      const slug = createUniqueCompanionSlug(state, payload.slug || payload.name);
      const ids = {
        characterId: `char-${slug}`,
        contactId: `contact-${slug}`,
        threadId: `thread-${slug}`,
        relationshipStateId: `rel-${slug}-thread-${slug}`,
        worldbookEntryId: `contact_${slug}_default`,
      };
      const channelId = payload.channelId || `channel-${slug}`;
      const windowId = payload.windowId || `window-${slug}`;
      const agentId = payload.agentId || `smallphone-${channelId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
      const workspaceDir = payload.workspaceDir || defaultWorkspaceDirForRole(payload.roleLevel, channelId, slug, this.paths);
      const runtimeProject = payload.runtimeProject || defaultRuntimeProjectForRole(payload.roleLevel, slug);
      const sessionKey = payload.sessionKey || `smallphone:thread:${ids.threadId}`;
      const character = {
        id: ids.characterId,
        name: payload.name,
        avatar: payload.avatar,
        avatarAttachmentId: payload.avatarAttachmentId,
        persona: payload.persona,
        style: payload.style,
        toolPolicy: {
          allow: payload.toolAllow,
        },
        permissionPolicy: {
          agentMode: payload.agentMode,
          template: templateForAgentMode(payload.agentMode, payload.agentType),
          rules: {},
          updatedAt: createdAt,
        },
        createdAt,
        updatedAt: createdAt,
      };
      const contact = {
        id: ids.contactId,
        characterId: ids.characterId,
        displayName: payload.displayName || payload.name,
        kind: "agent",
        roleLevel: payload.roleLevel,
        status: "active",
        agentId,
        timeSettings: payload.timeSettings,
        worldbookScopeIds: [ids.worldbookEntryId],
        relationship: {
          trust: payload.relationship.trust,
          intimacy: payload.relationship.intimacy,
          tension: payload.relationship.tension,
          responsiveness: payload.relationship.responsiveness,
        },
        createdAt,
        updatedAt: createdAt,
      };
      const thread = {
        id: ids.threadId,
        contactId: ids.contactId,
        title: payload.threadTitle || payload.displayName || payload.name,
        windowId,
        channelId,
        state: "active",
        channel: "smallphone",
        roleLevel: payload.roleLevel,
        summary: payload.threadSummary || `${payload.name} 的独立一对一窗口。`,
        timeSettings: payload.timeSettings,
        runtimeSessionId: "",
        runtime: {
          provider: this.runtimeInfo.id || "mock",
          project: runtimeProject,
          agentType: payload.agentType,
          roleLevel: payload.roleLevel,
          model: payload.model || this.runtimeInfo.model || "",
          agentId,
          workspaceDir,
          workspaceScope: payload.workspaceScope,
          sessionKey,
          sessionGeneration: 1,
          resumeSummary: "",
        },
        unreadCount: 0,
        createdAt,
        updatedAt: createdAt,
      };
      const relationshipState = {
        id: ids.relationshipStateId,
        contactId: ids.contactId,
        threadId: ids.threadId,
        state: payload.relationshipState.state,
        intensity: payload.relationshipState.intensity,
        guidance: payload.relationshipState.guidance,
        evidence: payload.relationshipState.evidence,
        updatedAt: createdAt,
      };
      const worldbookEntry = {
        id: ids.worldbookEntryId,
        name: `${payload.name} 联系人默认设定`,
        enabled: true,
        type: "contact",
        scope: "contact",
        mode: "always_on",
        priority: payload.worldbookPriority,
        tags: ["contact", slug],
        triggers: {
          keywords: [],
          contactIds: [ids.contactId],
          threadIds: [ids.threadId],
          requiresTags: [],
          excludesTags: [],
        },
        content: payload.worldbookContent,
        createdAt,
        updatedAt: createdAt,
      };
      const initialMessages = [
        {
          id: createId("msg"),
          threadId: ids.threadId,
          role: "system",
          content: payload.bootstrapMessage,
          createdAt,
        },
      ];
      if (payload.greeting) {
        initialMessages.push({
          id: createId("msg"),
          threadId: ids.threadId,
          role: "assistant",
          content: payload.greeting,
          createdAt,
        });
      }
      state.characters.push(character);
      state.contacts.push(contact);
      state.threads.push(thread);
      state.relationshipStates.push(relationshipState);
      state.worldbookEntries.push(worldbookEntry);
      state.messages.push(...initialMessages);
      state.timeline.push({
        id: createId("tl"),
        threadId: ids.threadId,
        type: "system",
        title: "Companion created",
        detail: `${payload.name} 已创建为独立 SmallPhone 联系人，并绑定真实 agent/workspace。`,
        createdAt,
      });
      created = {
        character,
        contact,
        thread,
        relationshipState,
        worldbookEntry,
        messages: initialMessages,
      };
      return state;
    });
    this.syncManagedArtifacts(nextState);
    await this.ensureRuntimeProjectForThread({
      thread: created.thread,
      contact: created.contact,
      character: created.character,
      relationshipState: created.relationshipState,
    });
    await this.syncRuntimeProjectMode({
      thread: created.thread,
      agentMode: payload.agentMode,
      agentType: payload.agentType,
    });
    const hydratedContacts = this.listContacts();
    const hydratedThreads = this.listThreads();
    return {
      ...created,
      contact: hydratedContacts.find((item) => item.id === created.contact.id) || created.contact,
      thread: hydratedThreads.find((item) => item.id === created.thread.id) || created.thread,
      openclaw: this.exportOpenClawAgentRegistry(),
    };
  }

  async updateCompanion(contactId, input) {
    const id = String(contactId || "").trim();
    if (!id) {
      throw new Error("Companion contact id is required.");
    }
    const current = this.store.read();
    const contact = current.contacts.find((item) => item.id === id);
    if (!contact) {
      throw new Error(`Companion not found: ${id}`);
    }
    const thread = current.threads.find((item) => item.contactId === id);
    if (!thread) {
      throw new Error(`Thread not found for companion: ${id}`);
    }
    const character = current.characters.find((item) => item.id === contact.characterId);
    if (!character) {
      throw new Error(`Character not found for companion: ${id}`);
    }
    const relationshipState =
      current.relationshipStates.find((item) => item.threadId === thread.id || item.contactId === id) || null;
    const worldbookEntry =
      current.worldbookEntries.find(
        (item) =>
          contact.worldbookScopeIds?.includes(item.id) ||
          item.triggers?.contactIds?.includes(id) ||
          item.triggers?.threadIds?.includes(thread.id),
      ) || null;
    const payload = normalizeCompanionPatchInput({
      input,
      contact,
      thread,
      character,
      relationshipState,
      worldbookEntry,
      runtimeInfo: this.runtimeInfo,
      paths: this.paths,
    });
    this.assertAvatarAttachmentId(payload.avatarAttachmentId);
    const updatedAt = nowIso();
    const nextState = this.store.update((state) => {
      const liveContact = state.contacts.find((item) => item.id === id);
      const liveThread = state.threads.find((item) => item.contactId === id);
      const liveCharacter = state.characters.find((item) => item.id === liveContact?.characterId);
      if (!liveContact || !liveThread || !liveCharacter) {
        throw new Error(`Companion state became unavailable during update: ${id}`);
      }
      liveCharacter.name = payload.name;
      liveCharacter.avatar = payload.avatar;
      liveCharacter.avatarAttachmentId = payload.avatarAttachmentId;
      liveCharacter.persona = payload.persona;
      liveCharacter.style = payload.style;
      liveCharacter.toolPolicy = {
        allow: payload.toolAllow,
      };
      liveCharacter.permissionPolicy = {
        ...(liveCharacter.permissionPolicy || {}),
        agentMode: payload.agentMode,
        template: templateForAgentMode(payload.agentMode, payload.agentType),
        rules: normalizePermissionRules(liveCharacter.permissionPolicy?.rules || {}),
        updatedAt,
      };
      liveCharacter.updatedAt = updatedAt;

      liveContact.displayName = payload.displayName;
      liveContact.roleLevel = payload.roleLevel;
      liveContact.agentId = payload.agentId;
      liveContact.timeSettings = payload.timeSettings;
      liveContact.relationship = {
        trust: payload.relationship.trust,
        intimacy: payload.relationship.intimacy,
        tension: payload.relationship.tension,
        responsiveness: payload.relationship.responsiveness,
      };
      liveContact.updatedAt = updatedAt;

      liveThread.title = payload.threadTitle;
      liveThread.roleLevel = payload.roleLevel;
      liveThread.summary = payload.threadSummary;
      liveThread.timeSettings = payload.timeSettings;
      liveThread.windowId = payload.windowId;
      liveThread.channelId = payload.channelId;
      liveThread.updatedAt = updatedAt;
      liveThread.runtime = {
        ...(liveThread.runtime || {}),
        provider: this.runtimeInfo.id || liveThread.runtime?.provider || "mock",
        project: payload.runtimeProject,
        agentType: payload.agentType,
        roleLevel: payload.roleLevel,
        model: payload.model,
        agentId: payload.agentId,
        workspaceDir: payload.workspaceDir,
        workspaceScope: payload.workspaceScope,
        sessionKey: payload.sessionKey,
        sessionGeneration: getSessionGeneration({
          ...liveThread,
          runtime: {
            ...(liveThread.runtime || {}),
            sessionKey: payload.sessionKey,
            sessionGeneration: liveThread.runtime?.sessionGeneration,
          },
        }),
        resumeSummary: normalizeSessionResumeSummary(
          input?.resumeSummary,
          liveThread.runtime?.resumeSummary || "",
        ),
      };

      const liveRelationshipState =
        state.relationshipStates.find((item) => item.threadId === liveThread.id || item.contactId === id) || null;
      if (liveRelationshipState) {
        liveRelationshipState.state = payload.relationshipState.state;
        liveRelationshipState.intensity = payload.relationshipState.intensity;
        liveRelationshipState.guidance = payload.relationshipState.guidance;
        liveRelationshipState.evidence = payload.relationshipState.evidence;
        liveRelationshipState.updatedAt = updatedAt;
      }

      const liveWorldbookEntry =
        state.worldbookEntries.find(
          (item) =>
            liveContact.worldbookScopeIds?.includes(item.id) ||
            item.triggers?.contactIds?.includes(id) ||
            item.triggers?.threadIds?.includes(liveThread.id),
        ) || null;
      if (liveWorldbookEntry) {
        liveWorldbookEntry.name = `${payload.name} 联系人默认设定`;
        liveWorldbookEntry.priority = payload.worldbookPriority;
        liveWorldbookEntry.content = payload.worldbookContent;
        liveWorldbookEntry.tags = dedupeStrings(["contact", payload.slug]);
        liveWorldbookEntry.triggers = {
          ...(liveWorldbookEntry.triggers || {}),
          keywords: Array.isArray(liveWorldbookEntry.triggers?.keywords)
            ? liveWorldbookEntry.triggers.keywords
            : [],
          contactIds: [id],
          threadIds: [liveThread.id],
          requiresTags: Array.isArray(liveWorldbookEntry.triggers?.requiresTags)
            ? liveWorldbookEntry.triggers.requiresTags
            : [],
          excludesTags: Array.isArray(liveWorldbookEntry.triggers?.excludesTags)
            ? liveWorldbookEntry.triggers.excludesTags
            : [],
        };
        liveWorldbookEntry.updatedAt = updatedAt;
      }

      state.timeline.push({
        id: createId("tl"),
        threadId: liveThread.id,
        type: "system",
        title: "Companion updated",
        detail: `${payload.name} 的角色设定、线程路由和 agent 工作区已同步更新。`,
        createdAt: updatedAt,
      });
      return state;
    });
    this.syncManagedArtifacts(nextState);
    const updatedContact = nextState.contacts.find((item) => item.id === id) || null;
    const updatedThread = nextState.threads.find((item) => item.contactId === id) || null;
    const updatedCharacter = updatedContact
      ? nextState.characters.find((item) => item.id === updatedContact.characterId) || null
      : null;
    await this.ensureRuntimeProjectForThread({
      thread: updatedThread,
      contact: updatedContact,
      character: updatedCharacter,
      relationshipState:
        nextState.relationshipStates.find((item) => item.threadId === updatedThread?.id || item.contactId === id) || null,
    });
    await this.syncRuntimeProjectMode({
      thread: updatedThread,
      agentMode: payload.agentMode,
      agentType: payload.agentType,
    });
    const hydratedContacts = this.listContacts();
    const hydratedThreads = this.listThreads();
    return {
      contact: hydratedContacts.find((item) => item.id === id) || null,
      thread: hydratedThreads.find((item) => item.contactId === id) || null,
      openclaw: this.exportOpenClawAgentRegistry(),
    };
  }

  archiveCompanion(contactId) {
    const id = String(contactId || "").trim();
    if (!id) {
      throw new Error("Companion contact id is required.");
    }
    const current = this.store.read();
    const contact = current.contacts.find((item) => item.id === id);
    if (!contact) {
      throw new Error(`Companion not found: ${id}`);
    }
    const thread = current.threads.find((item) => item.contactId === id);
    if (!thread) {
      throw new Error(`Thread not found for companion: ${id}`);
    }
    const updatedAt = nowIso();
    const nextState = this.store.update((state) => {
      const liveContact = state.contacts.find((item) => item.id === id);
      const liveThread = state.threads.find((item) => item.contactId === id);
      if (!liveContact || !liveThread) {
        throw new Error(`Companion state became unavailable during archive: ${id}`);
      }
      liveContact.status = "archived";
      liveContact.updatedAt = updatedAt;
      liveThread.state = "archived";
      liveThread.unreadCount = 0;
      liveThread.updatedAt = updatedAt;
      state.timeline.push({
        id: createId("tl"),
        threadId: liveThread.id,
        type: "system",
        title: "Companion archived",
        detail: `${liveContact.displayName} 已归档，并从活跃 agent 路由中移除。`,
        createdAt: updatedAt,
      });
      return state;
    });
    this.syncManagedArtifacts(nextState);
    return {
      archivedContactId: id,
      openclaw: this.exportOpenClawAgentRegistry(),
    };
  }

  deleteCompanion(contactId) {
    const id = String(contactId || "").trim();
    if (!id) {
      throw new Error("Companion contact id is required.");
    }
    const current = this.store.read();
    const contact = current.contacts.find((item) => item.id === id);
    if (!contact) {
      throw new Error(`Companion not found: ${id}`);
    }
    const thread = current.threads.find((item) => item.contactId === id);
    const characterId = contact.characterId;
    const threadId = thread?.id || "";
    const worldbookScopeIds = Array.isArray(contact.worldbookScopeIds) ? contact.worldbookScopeIds : [];
    const updatedAt = nowIso();
    const nextState = this.store.update((state) => {
      state.contacts = state.contacts.filter((item) => item.id !== id);
      state.characters = state.characters.filter((item) => item.id !== characterId);
      state.threads = state.threads.filter((item) => item.contactId !== id);
      state.messages = state.messages.filter((item) => item.threadId !== threadId);
      state.memories = state.memories.filter((item) => item.threadId !== threadId);
      state.relationshipStates = state.relationshipStates.filter(
        (item) => item.contactId !== id && item.threadId !== threadId,
      );
      state.worldbookEntries = state.worldbookEntries.filter((item) => {
        if (worldbookScopeIds.includes(item.id)) {
          return false;
        }
        if (item.triggers?.contactIds?.includes(id)) {
          return false;
        }
        if (threadId && item.triggers?.threadIds?.includes(threadId)) {
          return false;
        }
        return true;
      });
      state.turnContextCache = state.turnContextCache.filter((item) => item.threadId !== threadId);
      state.reminders = state.reminders.filter((item) => item.threadId !== threadId);
      state.timeline.push({
        id: createId("tl"),
        threadId,
        type: "system",
        title: "Companion deleted",
        detail: `${contact.displayName} 及其线程、记忆、关系和默认 worldbook 已删除。`,
        createdAt: updatedAt,
      });
      return state;
    });
    this.syncManagedArtifacts(nextState);
    return {
      deletedContactId: id,
      deletedThreadId: threadId,
      openclaw: this.exportOpenClawAgentRegistry(),
    };
  }

  getTurnContextCache(threadId) {
    const state = this.store.read();
    return state.turnContextCache
      .filter((item) => item.threadId === threadId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  getThreadDebugSnapshot(threadId) {
    const thread = this.getThread(threadId);
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const sessionKey = routedThread.runtime?.sessionKey || "";
    const turnContextRecord = readTurnContextRecord(sessionKey);
    const turnContextCache = this.getTurnContextCache(threadId);
    return {
      thread: this.listThreads().find((item) => item.id === threadId) || routedThread,
      sessionKey,
      turnContextRecord,
      latestTurnContextCacheEntry: turnContextCache.at(-1) || null,
      turnContextCache,
    };
  }

  async listPermissionTemplates() {
    return this.permissions.listTemplates();
  }

  async getThreadPermissions(threadId) {
    const target = this.resolvePermissionTarget(threadId);
    const runtimeProjectInfo = await this.getRuntimeProjectPermissionInfo(target);
    const hydratedTarget = mergeRuntimePermissionTarget(target, runtimeProjectInfo);
    const agentCapabilities =
      runtimeProjectInfo?.agentCapabilities || resolveAgentPermissionCapabilities(hydratedTarget.agentType);
    const policy = await this.permissions.upsertPolicy(hydratedTarget);
    const evaluation = await this.permissions.evaluate(hydratedTarget);
    return {
      ...hydratedTarget,
      agentCapabilities,
      runtimeProjectInfo,
      policy,
      templates: await this.permissions.listTemplates(),
      evaluation,
    };
  }

  async saveThreadPermissions(threadId, input = {}) {
    const target = this.resolvePermissionTarget(threadId);
    const runtimeProjectInfo = await this.getRuntimeProjectPermissionInfo(target);
    const hydratedTarget = mergeRuntimePermissionTarget(target, runtimeProjectInfo);
    const agentMode = normalizeAgentPermissionMode(input?.agentMode || input?.mode || hydratedTarget.agentMode, hydratedTarget.agentType);
    const template = normalizePermissionTemplate(
      input?.appTemplate || input?.policyTemplate || templateForAgentMode(agentMode, hydratedTarget.agentType) || hydratedTarget.template,
    );
    const rules = normalizePermissionRules(input?.rules || {});
    const updatedAt = nowIso();

    this.store.update((state) => {
      const thread = state.threads.find((item) => item.id === threadId);
      const contact = state.contacts.find((item) => item.id === thread?.contactId);
      const character = state.characters.find((item) => item.id === contact?.characterId);
      if (!thread || !contact || !character) {
        throw new Error(`Thread permission target became unavailable: ${threadId}`);
      }
      character.permissionPolicy = {
        ...(character.permissionPolicy || {}),
        agentMode,
        template,
        rules,
        updatedAt,
      };
      character.updatedAt = updatedAt;
      thread.updatedAt = updatedAt;
      state.timeline.push({
        id: createId("tl"),
        threadId,
        type: "system",
        title: "Permission policy updated",
        detail: `${contact.displayName} 已切换到 ${template} 权限模板。`,
        createdAt: updatedAt,
      });
      return state;
    });

    const modeUpdate = await this.ccConnectProjects.updateProjectMode({
      name: hydratedTarget.runtimeProject || hydratedTarget.project,
      mode: agentMode,
    });

    const nextTarget = this.resolvePermissionTarget(threadId);
    const nextRuntimeProjectInfo = await this.getRuntimeProjectPermissionInfo(nextTarget);
    const nextHydratedTarget = mergeRuntimePermissionTarget(nextTarget, nextRuntimeProjectInfo);
    const policy = await this.permissions.upsertPolicy(nextHydratedTarget);
    const evaluation = await this.permissions.evaluate(nextHydratedTarget);
    const agentCapabilities =
      nextRuntimeProjectInfo?.agentCapabilities || resolveAgentPermissionCapabilities(nextHydratedTarget.agentType);
    return {
      ...nextHydratedTarget,
      agentCapabilities,
      runtimeProjectInfo: nextRuntimeProjectInfo,
      modeUpdate,
      policy,
      evaluation,
    };
  }

  async getThreadRuntimeProjectSettings(threadId) {
    const target = this.resolveRuntimeProjectSettingsTarget(threadId);
    if (!target.available) {
      return target;
    }
    try {
      const data = await this.ccConnectProjects.getProject({ name: target.project });
      return buildRuntimeProjectSettingsResponse(target, data);
    } catch (error) {
      return unavailableRuntimeProjectSettings(threadId, {
        reason: String(error?.message || error || ""),
        project: target.project,
      });
    }
  }

  async saveThreadRuntimeProjectSettings(threadId, input = {}) {
    const target = this.resolveRuntimeProjectSettingsTarget(threadId);
    if (!target.available) {
      return target;
    }
    const patch = normalizeRuntimeProjectSettingsPatch(input);
    if (Object.keys(patch).length) {
      try {
        await this.ccConnectProjects.updateProjectSettings({
          name: target.project,
          settings: patch,
        });
      } catch (error) {
        return unavailableRuntimeProjectSettings(threadId, {
          reason: String(error?.message || error || ""),
          project: target.project,
        });
      }
    }
    let data;
    try {
      data = await this.ccConnectProjects.getProject({ name: target.project });
    } catch (error) {
      return unavailableRuntimeProjectSettings(threadId, {
        reason: String(error?.message || error || ""),
        project: target.project,
      });
    }
    const response = buildRuntimeProjectSettingsResponse(target, data);
    this.syncLocalRuntimeProjectSettings(threadId, response.settings, patch);
    return response;
  }

  resolveRuntimeProjectSettingsTarget(threadId) {
    const target = this.resolvePermissionTarget(threadId);
    if (this.runtimeInfo.id !== "cc-webclient") {
      return unavailableRuntimeProjectSettings(threadId, {
        reason: "runtime project settings are only available for cc-webclient runtime",
      });
    }
    const project = normalizeRuntimeProjectName(target.runtimeProject || target.project);
    if (!project) {
      return unavailableRuntimeProjectSettings(threadId, {
        reason: "thread has no cc-webclient runtime project",
      });
    }
    if (!this.projectInfo.configured) {
      return unavailableRuntimeProjectSettings(threadId, {
        reason: "cc-connect project client is not configured",
        project,
      });
    }
    return {
      ok: true,
      available: true,
      skipped: false,
      threadId: target.threadId,
      project,
      agentType: target.agentType,
    };
  }

  syncLocalRuntimeProjectSettings(threadId, settings = {}, patch = {}) {
    const shouldSyncMode = hasOwn(patch, "mode") && String(settings.mode || "").trim();
    const shouldSyncWorkDir = hasOwn(patch, "work_dir") && String(settings.workDir || "").trim();
    if (!shouldSyncMode && !shouldSyncWorkDir) {
      return { ok: true, changed: false };
    }
    const updatedAt = nowIso();
    let changed = false;
    this.store.update((state) => {
      const thread = state.threads.find((item) => item.id === threadId);
      const contact = state.contacts.find((item) => item.id === thread?.contactId);
      const character = state.characters.find((item) => item.id === contact?.characterId);
      if (!thread || !contact || !character) {
        throw new Error(`Runtime project settings target became unavailable: ${threadId}`);
      }
      if (shouldSyncMode) {
        const mode = String(settings.mode || "").trim();
        const agentType = normalizeAgentType(thread.runtime?.agentType) || "codex";
        if (String(character.permissionPolicy?.agentMode || "").trim() !== mode) {
          character.permissionPolicy = {
            ...(character.permissionPolicy || {}),
            agentMode: mode,
            template: templateForAgentMode(mode, agentType),
            rules: normalizePermissionRules(character.permissionPolicy?.rules || {}),
            updatedAt,
          };
          character.updatedAt = updatedAt;
          changed = true;
        }
      }
      if (shouldSyncWorkDir) {
        const workDir = String(settings.workDir || "").trim();
        if (String(thread.runtime?.workspaceDir || "").trim() !== workDir) {
          thread.runtime = {
            ...(thread.runtime || {}),
            workspaceDir: workDir,
          };
          thread.updatedAt = updatedAt;
          changed = true;
        }
      }
      return state;
    });
    return { ok: true, changed, updatedAt: changed ? updatedAt : "" };
  }

  async getRuntimeProjectPermissionInfo(target) {
    const project = String(target?.runtimeProject || target?.project || "").trim();
    if (!project || this.runtimeInfo.id !== "cc-webclient") {
      return null;
    }
    try {
      const data = await this.ccConnectProjects.getProject({ name: project });
      const agentType = normalizeAgentType(data.agent_type || target.agentType) || target.agentType;
      const modes = normalizeRuntimePermissionModes(data.permission_modes);
      const agentCapabilities = modes.length
        ? {
            agentType,
            modes,
            defaultMode: modes[0]?.key || "default",
            ruleLevels: ["allow", "ask", "forbid"],
            permissions: DEFAULT_PERMISSION_CHECKS,
            source: "cc-connect-project",
          }
        : resolveAgentPermissionCapabilities(agentType);
      return {
        project,
        agentType,
        agentMode: String(data.agent_mode || "").trim(),
        workDir: String(data.work_dir || "").trim(),
        agentCapabilities,
        raw: data,
      };
    } catch (error) {
      return {
        project,
        error: String(error?.message || error || ""),
      };
    }
  }

  resolvePermissionTarget(threadId) {
    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const contact = state.contacts.find((item) => item.id === thread.contactId);
    if (!contact) {
      throw new Error(`Contact not found for thread: ${threadId}`);
    }
    const character = state.characters.find((item) => item.id === contact.characterId);
    if (!character) {
      throw new Error(`Character not found for contact: ${contact.id}`);
    }
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const runtime = routedThread.runtime || {};
    const project =
      resolveWebclientProjectForThread(routedThread, this.runtimeInfo.project) ||
      String(this.runtimeInfo.project || "").trim();
    const policy = character.permissionPolicy || {};
    const agentType = normalizeAgentType(runtime.agentType) || "codex";
    const agentMode = normalizeAgentPermissionMode(policy.agentMode || policy.mode || policy.template, agentType);
    return {
      policyId: buildPermissionPolicyId(this.permissionInfo.clientId, this.permissionInfo.appId, contact.id),
      clientId: this.permissionInfo.clientId,
      appId: this.permissionInfo.appId,
      threadId: thread.id,
      threadTitle: thread.title || contact.displayName,
      contactId: contact.id,
      contactName: contact.displayName,
      agentId: String(contact.agentId || runtime.agentId || "").trim(),
      agentType,
      roleLevel: normalizeRoleLevel(contact.roleLevel || thread.roleLevel || runtime.roleLevel),
      workspaceScope: normalizeWorkspaceScope(runtime.workspaceScope) || workspaceScopeForRole(contact.roleLevel || thread.roleLevel),
      workspaceDir: String(runtime.workspaceDir || "").trim(),
      userType: "owner",
      project,
      runtimeProject: project,
      agentMode,
      template: normalizePermissionTemplate(policy.template || templateForAgentMode(agentMode, agentType) || DEFAULT_PERMISSION_TEMPLATE),
      rules: normalizePermissionRules(policy.rules || {}),
      permissions: DEFAULT_PERMISSION_CHECKS,
      configured: this.permissionInfo.configured,
      source: this.permissionInfo.configured ? "cc-connect" : "local",
    };
  }

  listWorldbookEntries() {
    const state = this.store.read();
    return [...state.worldbookEntries].sort((a, b) => b.priority - a.priority);
  }

  upsertWorldbookEntry(input) {
    const payload = normalizeWorldbookEntryInput(input);
    const updatedAt = nowIso();
    const id = String(input?.id || "").trim() || createId("wb");
    this.store.update((state) => {
      const index = state.worldbookEntries.findIndex((item) => item.id === id);
      const nextEntry = {
        ...(index >= 0 ? state.worldbookEntries[index] : {}),
        ...payload,
        id,
        createdAt: index >= 0 ? state.worldbookEntries[index].createdAt : updatedAt,
        updatedAt,
      };
      if (index >= 0) {
        state.worldbookEntries[index] = nextEntry;
      } else {
        state.worldbookEntries.push(nextEntry);
      }
      return state;
    });
    return this.listWorldbookEntries();
  }

  deleteWorldbookEntry(entryId) {
    const id = String(entryId || "").trim();
    if (!id) {
      throw new Error("Worldbook entry id is required.");
    }
    this.store.update((state) => {
      state.worldbookEntries = state.worldbookEntries.filter((item) => item.id !== id);
      return state;
    });
    return this.listWorldbookEntries();
  }

  listMaskDefinitions() {
    const state = this.store.read();
    return [...state.maskDefinitions];
  }

  upsertMaskDefinition(input) {
    const payload = normalizeMaskDefinitionInput(input);
    const updatedAt = nowIso();
    const id = String(input?.id || "").trim() || createId("mask");
    this.store.update((state) => {
      const index = state.maskDefinitions.findIndex((item) => item.id === id);
      const nextEntry = {
        ...(index >= 0 ? state.maskDefinitions[index] : {}),
        ...payload,
        id,
        createdAt: index >= 0 ? state.maskDefinitions[index].createdAt : updatedAt,
        updatedAt,
      };
      if (index >= 0) {
        state.maskDefinitions[index] = nextEntry;
      } else {
        state.maskDefinitions.push(nextEntry);
      }
      return state;
    });
    return this.listMaskDefinitions();
  }

  deleteMaskDefinition(maskId) {
    const id = String(maskId || "").trim();
    if (!id) {
      throw new Error("Mask id is required.");
    }
    this.store.update((state) => {
      state.maskDefinitions = state.maskDefinitions.filter((item) => item.id !== id);
      return state;
    });
    return this.listMaskDefinitions();
  }

  listRelationshipStates() {
    const state = this.store.read();
    return [...state.relationshipStates];
  }

  upsertRelationshipState(input) {
    const payload = normalizeRelationshipStateInput(input);
    const updatedAt = nowIso();
    const id = String(input?.id || "").trim() || createId("rel");
    const nextState = this.store.update((state) => {
      const index = state.relationshipStates.findIndex((item) => item.id === id);
      const nextEntry = {
        ...(index >= 0 ? state.relationshipStates[index] : {}),
        ...payload,
        id,
        updatedAt,
      };
      if (index >= 0) {
        state.relationshipStates[index] = nextEntry;
      } else {
        state.relationshipStates.push(nextEntry);
      }
      return state;
    });
    this.syncManagedArtifacts(nextState);
    return this.listRelationshipStates();
  }

  deleteRelationshipState(stateId) {
    const id = String(stateId || "").trim();
    if (!id) {
      throw new Error("Relationship state id is required.");
    }
    this.store.update((state) => {
      state.relationshipStates = state.relationshipStates.filter((item) => item.id !== id);
      return state;
    });
    return this.listRelationshipStates();
  }

  listTimeline() {
    const state = this.store.read();
    return [...state.timeline].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  createTimelineEvent(input) {
    const threadId = String(input?.threadId || "").trim();
    const title = String(input?.title || "").trim();
    const detail = String(input?.detail || "").trim();
    const type = String(input?.type || "system").trim() || "system";
    if (!threadId || !title) {
      throw new Error("Timeline event requires threadId and title.");
    }
    this.getThread(threadId);
    const createdAt = nowIso();
    this.store.update((state) => {
      state.timeline.push({
        id: createId("tl"),
        threadId,
        type,
        title,
        detail,
        createdAt,
      });
      return state;
    });
    return this.listTimeline();
  }

  listReminders() {
    const state = this.store.read();
    return [...state.reminders].sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
  }

  createReminder(input) {
    const threadId = String(input.threadId || "").trim();
    const note = String(input.note || "").trim();
    const dueAt = String(input.dueAt || "").trim();
    if (!threadId || !note || !dueAt) {
      throw new Error("Reminder requires threadId, note, and dueAt.");
    }
    const thread = this.getThread(threadId);
    const createdAt = nowIso();
    this.store.update((state) => {
      state.reminders.push({
        id: createId("rem"),
        threadId: thread.id,
        note,
        dueAt,
        kind: "proactive_message",
        status: "pending",
        attempts: 0,
        createdAt,
      });
      state.timeline.push({
        id: createId("tl"),
        type: "system",
        threadId: thread.id,
        title: "Scheduled outreach created",
        detail: note,
        createdAt,
      });
      return state;
    });
    return this.listReminders();
  }

  async executeDueReminders(now = nowIso()) {
    const dueIds = this.store
      .read()
      .reminders.filter(
        (item) => ["pending", "deferred"].includes(item.status) && compareIsoDate(item.dueAt, now) <= 0,
      )
      .map((item) => item.id);
    const summary = {
      checkedAt: now,
      due: dueIds.length,
      sent: 0,
      skipped: 0,
      deferred: 0,
      failed: 0,
      results: [],
    };
    for (const reminderId of dueIds) {
      const result = await this.runReminder(reminderId);
      if (result.status === "sent") summary.sent += 1;
      else if (result.status === "skip") summary.skipped += 1;
      else if (result.status === "deferred") summary.deferred += 1;
      else if (result.status === "failed") summary.failed += 1;
      summary.results.push(result);
    }
    return summary;
  }

  async runReminder(reminderId) {
    const claimedAt = nowIso();
    const claimed = this.store.update((state) => {
      const reminder = state.reminders.find((item) => item.id === reminderId);
      if (!reminder || !["pending", "deferred"].includes(reminder.status)) {
        return state;
      }
      reminder.status = "processing";
      reminder.executingAt = claimedAt;
      reminder.attempts = Number.isFinite(Number(reminder.attempts)) ? Number(reminder.attempts) + 1 : 1;
      reminder.lastError = "";
      return state;
    });
    const reminder = claimed.reminders.find((item) => item.id === reminderId);
    if (!reminder || reminder.status !== "processing") {
      return {
        reminderId,
        status: "skip",
        reason: "not-pending",
      };
    }
    try {
      return await this.triggerReminder(reminderId);
    } catch (error) {
      const failedAt = nowIso();
      this.store.update((state) => {
        const liveReminder = state.reminders.find((item) => item.id === reminderId);
        if (!liveReminder) {
          return state;
        }
        liveReminder.status = "failed";
        liveReminder.failedAt = failedAt;
        liveReminder.lastError = error instanceof Error ? error.message : String(error);
        return state;
      });
      return {
        reminderId,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async triggerReminder(reminderId) {
    const state = this.store.read();
    const reminder = state.reminders.find((item) => item.id === reminderId);
    if (!reminder) {
      throw new Error(`Reminder not found: ${reminderId}`);
    }
    const thread = state.threads.find((item) => item.id === reminder.threadId);
    if (!thread) {
      throw new Error(`Thread not found for reminder: ${reminderId}`);
    }
    const contact = state.contacts.find((item) => item.id === thread.contactId);
    if (!contact) {
      throw new Error(`Contact not found for reminder: ${reminderId}`);
    }
    const character = state.characters.find((item) => item.id === contact.characterId);
    if (!character) {
      throw new Error(`Character not found for reminder: ${reminderId}`);
    }
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    ensureThreadWorkspace({
      thread: routedThread,
      contact,
      character,
      relationshipState:
        state.relationshipStates.find((item) => item.threadId === routedThread.id || item.contactId === contact.id) || null,
      paths: this.paths,
    });
    const messages = state.messages.filter((item) => item.threadId === thread.id);
    const memories = state.memories
      .filter((item) => item.threadId === thread.id || item.scope === "global")
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 5);
    const turnContext = this.buildTurnContext({
      state,
      threadId: thread.id,
      messageText: reminder.note,
      persist: true,
    });
    const resolved = await this.runtime.sendTurn({
      runtimeSessionId: routedThread.runtimeSessionId,
      thread: routedThread,
      contact,
      character,
      relationship: contact.relationship,
      memories,
      messages,
      timeContext: buildRuntimeTimeContext(resolveThreadTimeSettings({ contact, thread })),
      turnContext,
      trigger: {
        type: "scheduled_check",
        note: reminder.note,
        mode: "decision_only",
      },
    });
    const decision = normalizeReminderDecision(resolved?.decision, resolved?.assistantText);
    if (decision.action === "skip") {
      const completedAt = nowIso();
      this.store.update((draft) => {
        const liveReminder = draft.reminders.find((item) => item.id === reminderId);
        if (!liveReminder) return draft;
        liveReminder.status = "skip";
        liveReminder.firedAt = completedAt;
        liveReminder.lastError = "";
        draft.timeline.push({
          id: createId("tl"),
          threadId: thread.id,
          type: "system",
          title: `Scheduled outreach skipped for ${contact.displayName}`,
          detail: decision.reason || reminder.note,
          createdAt: completedAt,
        });
        return draft;
      });
      return { reminderId, status: "skip", reason: decision.reason || "openclaw skipped send" };
    }
    if (decision.action === "defer") {
      const nextDueAt = computeDeferredDueAt(reminder.dueAt);
      this.store.update((draft) => {
        const liveReminder = draft.reminders.find((item) => item.id === reminderId);
        if (!liveReminder) return draft;
        liveReminder.status = "deferred";
        liveReminder.dueAt = nextDueAt;
        liveReminder.executingAt = "";
        liveReminder.lastError = "";
        draft.timeline.push({
          id: createId("tl"),
          threadId: thread.id,
          type: "system",
          title: `Scheduled outreach deferred for ${contact.displayName}`,
          detail: decision.reason || reminder.note,
          createdAt: nowIso(),
        });
        return draft;
      });
      return { reminderId, status: "deferred", dueAt: nextDueAt, reason: decision.reason || "openclaw deferred send" };
    }
    const assistantMessage = this.commitAssistantMessage({
      threadId: thread.id,
      contact,
      routedThread,
      runtimeResult: resolved,
      origin: "reminder",
      reminderNote: reminder.note,
    });
    const firedAt = assistantMessage.createdAt || nowIso();
    this.store.update((draft) => {
      const liveReminder = draft.reminders.find((item) => item.id === reminderId);
      if (!liveReminder) return draft;
      liveReminder.status = "sent";
      liveReminder.firedAt = firedAt;
      liveReminder.assistantMessageId = assistantMessage.id;
      liveReminder.lastError = "";
      return draft;
    });
    return {
      reminderId,
      status: "sent",
      assistantMessageId: assistantMessage.id,
    };
  }

  exportOpenClawAgentRegistry() {
    const state = this.store.read();
    const entries = buildOpenClawAgentEntries(state);
    return {
      generatedAt: nowIso(),
      path: this.artifactSync.registryPath,
      entries,
    };
  }

  syncManagedArtifacts(state = this.store.read()) {
    ensureAllThreadWorkspaces(state, this.paths);
    syncOpenClawAgentConfigs(state, this.artifactSync);
  }

  async ensureRuntimeProjectForThread(params = {}) {
    const thread = params.thread || null;
    if (!thread) {
      return { ok: false, skipped: true, reason: "missing thread" };
    }
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const project = String(routedThread.runtime?.project || "").trim();
    if (!project || this.runtimeInfo.id !== "cc-webclient") {
      return { ok: false, skipped: true, reason: "project ensure not required" };
    }
    ensureThreadWorkspace({
      thread: routedThread,
      contact: params.contact || null,
      character: params.character || null,
      relationshipState: params.relationshipState || null,
      paths: this.paths,
    });
    return this.ccConnectProjects.ensureProject({
      name: project,
      displayName: String(params.contact?.displayName || params.character?.name || thread.title || project).trim(),
      workDir: String(routedThread.runtime?.workspaceDir || "").trim(),
      agentType: normalizeAgentType(routedThread.runtime?.agentType) || "codex",
    });
  }

  async syncRuntimeProjectMode(params = {}) {
    const thread = params.thread || null;
    if (!thread || this.runtimeInfo.id !== "cc-webclient") {
      return { ok: false, skipped: true, reason: "project mode sync not required" };
    }
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const project = String(routedThread.runtime?.project || "").trim();
    const agentType = normalizeAgentType(params.agentType || routedThread.runtime?.agentType) || "codex";
    const mode = normalizeAgentPermissionMode(params.agentMode, agentType);
    if (!project || !mode) {
      return { ok: false, skipped: true, reason: "missing project or mode" };
    }
    return this.ccConnectProjects.updateProjectMode({ name: project, mode });
  }

  async sendThreadAction(threadId, input = {}) {
    const action = String(input?.action || input?.key || input?.value || "").trim();
    const replyCtx = String(input?.replyCtx || input?.reply_ctx || "").trim();
    if (!action) {
      throw new Error("Action is required.");
    }
    if (this.runtimeInfo.id !== "cc-webclient") {
      throw new Error("Thread actions are only supported by cc-webclient runtime.");
    }
    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const project = resolveWebclientProjectForThread(routedThread, this.runtimeInfo.project);
    const sessionId = String(thread.runtimeSessionId || routedThread.runtimeSessionId || "").trim();
    const sessionKey = String(routedThread.runtime?.sessionKey || buildThreadSessionKey(thread.id, getSessionGeneration(thread))).trim();
    if (!project || (!sessionId && !sessionKey)) {
      throw new Error("Current thread has no cc-webclient project/session.");
    }
    const result = await this.webclientChat.sendAction({
      project,
      sessionId,
      sessionKey,
      action,
      replyCtx,
    });
    this.emitThreadEvent(threadId, {
      type: "thread.action",
      action,
      replyCtx,
      result,
    });
    return { ok: true, action, replyCtx, result };
  }

  async sendMessage(threadId, input) {
    const attachmentIds = normalizeAttachmentIds(input?.attachments || input?.attachmentIds || []);
    const textParts = normalizeRuntimeTextParts(input?.textParts || input?.messageParts || input?.parts);
    const rawText = input?.text == null ? textParts.join("\n") : String(input.text);
    const displayText = rawText.trim();
    const escapedPassThrough = displayText.startsWith("//");
    const text = escapedPassThrough ? displayText.slice(1) : displayText;
    const runtimeTextParts = textParts.length ? textParts : text ? [text] : [];
    const runtimeUserText = buildRuntimeUserText(runtimeTextParts);
    const runtimePassThrough = Boolean(input?.runtimePassThrough) && !escapedPassThrough && attachmentIds.length === 0;
    if (!text && !attachmentIds.length) {
      throw new Error("Message text cannot be empty.");
    }

    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const contact = state.contacts.find((item) => item.id === thread.contactId);
    if (!contact) {
      throw new Error(`Contact not found for thread: ${threadId}`);
    }
    const character = state.characters.find((item) => item.id === contact.characterId);
    if (!character) {
      throw new Error(`Character not found for contact: ${contact.id}`);
    }
    const timeContext = buildRuntimeTimeContext(resolveThreadTimeSettings({ contact, thread }));

    const resolvedAttachments = attachmentIds.map((id) => state.attachments.find((item) => item.id === id) || null);
    if (resolvedAttachments.some((item) => !item)) {
      const missing = attachmentIds.filter((id, idx) => !resolvedAttachments[idx]);
      throw new Error(`Attachment(s) not found: ${missing.join(", ")}`);
    }
    for (const attachment of resolvedAttachments) {
      if (attachment.threadId && attachment.threadId !== threadId) {
        throw new Error(`Attachment ${attachment.id} belongs to a different thread.`);
      }
      if (attachment.messageId) {
        throw new Error(`Attachment ${attachment.id} is already attached to a message.`);
      }
    }

    const userMessage = {
      id: createId("msg"),
      threadId,
      role: "user",
      content: text,
      createdAt: nowIso(),
      attachmentIds,
    };

    const nextState = this.store.update((draft) => {
      draft.messages.push(userMessage);
      const liveThread = draft.threads.find((item) => item.id === threadId);
      if (liveThread) {
        liveThread.updatedAt = userMessage.createdAt;
      }
      if (attachmentIds.length) {
        if (!Array.isArray(draft.attachments)) {
          draft.attachments = [];
        }
        for (const id of attachmentIds) {
          const liveAttachment = draft.attachments.find((item) => item.id === id);
          if (!liveAttachment) continue;
          liveAttachment.threadId = liveAttachment.threadId || threadId;
          liveAttachment.messageId = userMessage.id;
          liveAttachment.role = "user";
        }
      }
      return draft;
    });
    const hydratedUserMessage = this.hydrateMessage(nextState, userMessage);
    this.emitThreadEvent(threadId, { type: "user.message", message: hydratedUserMessage });

    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const relationshipState =
      nextState.relationshipStates.find((item) => item.threadId === routedThread.id || item.contactId === contact.id) || null;
    ensureThreadWorkspace({
      thread: routedThread,
      contact,
      character,
      relationshipState,
    });
    await this.ensureRuntimeProjectForThread({
      thread: routedThread,
      contact,
      character,
      relationshipState,
    });

    const messages = nextState.messages.filter((item) => item.threadId === threadId);
    const runtimeMessages = buildRuntimeMessages(messages, runtimeUserText);
    const memories = nextState.memories
      .filter((item) => item.threadId === threadId || item.scope === "global")
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 5);
    const turnContext = this.buildTurnContext({
      state: nextState,
      threadId,
      messageText: text,
      persist: true,
    });
    const permissionTarget = this.resolvePermissionTarget(threadId);
    await this.permissions.upsertPolicy(permissionTarget);
    const permissionEvaluation = await this.permissions.evaluate({
      ...permissionTarget,
      permissions: ["chat.send", "model.use", "project.context.read"],
    });
    assertPermissionAllowed(permissionEvaluation, ["chat.send", "model.use"]);

    let runtimeResult;
    try {
      runtimeResult = await this.runtime.sendTurn({
        runtimeSessionId: routedThread.runtimeSessionId,
        thread: routedThread,
        contact,
        character,
        relationship: contact.relationship,
        memories,
        messages: runtimeMessages,
        originalMessages: messages,
        runtimeUserText,
        runtimeTextParts,
        timeContext,
        runtimePassThrough,
        ...(runtimePassThrough
          ? { runtimePassThroughText: runtimeTextParts.length > 1 ? runtimeUserText : rawText }
          : {}),
        attachments: attachmentIds
          .map((id) => nextState.attachments.find((item) => item.id === id) || null)
          .filter(Boolean)
          .map((attachment) => ({
            ...attachment,
            // Ensure runtime always sees local paths when present.
            localPath: attachment.localPath || "",
            url: attachment.url || "",
          })),
        turnContext,
        permissions: permissionEvaluation,
        onEvent: (event) => {
          const content = String(event?.content || "").trim();
          this.emitThreadEvent(threadId, {
            type: event?.done ? "assistant.done" : "assistant.stream",
            replyCtx: String(event?.replyCtx || "").trim(),
            content,
            text: content,
            done: Boolean(event?.done),
          });
        },
      });
    } catch (error) {
      runtimeResult = await this.recoverTimedOutRuntimeReply({
        threadId,
        userText: text,
        routedThread,
        error,
      });
      if (!runtimeResult) {
        throw error;
      }
    }

    const assistantMessage = this.commitAssistantMessage({
      threadId,
      contact,
      userText: text,
      routedThread,
      runtimeResult,
    });
    const hydratedAssistantMessage = this.hydrateMessage(this.store.read(), assistantMessage);
    this.emitThreadEvent(threadId, {
      type: "assistant.persisted",
      content: hydratedAssistantMessage.content,
      text: hydratedAssistantMessage.content,
      attachments: hydratedAssistantMessage.attachments,
      message: hydratedAssistantMessage,
      done: true,
    });

    return {
      userMessage: hydratedUserMessage,
      assistantMessage: hydratedAssistantMessage,
      thread: this.listThreads().find((item) => item.id === threadId),
      turnContext,
    };
  }

  async recoverTimedOutRuntimeReply(params) {
    if (!isRuntimeTimeoutError(params?.error)) {
      return null;
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt <= LATE_RUNTIME_REPLY_GRACE_MS) {
      const runtimeResult = readRuntimeReplyFromSessionFile({
        sessionKey: params?.routedThread?.runtime?.sessionKey,
        userText: params?.userText,
        runtimeSessionId:
          params?.routedThread?.runtimeSessionId ||
          params?.routedThread?.id ||
          "",
      });
      if (runtimeResult) {
        return runtimeResult;
      }
      await wait(LATE_RUNTIME_REPLY_POLL_MS);
    }
    return null;
  }

  reconcileThreadLateReply(threadId) {
    const state = this.store.read();
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const contact = state.contacts.find((item) => item.id === thread.contactId);
    if (!contact) {
      throw new Error(`Contact not found for thread: ${threadId}`);
    }
    const messages = state.messages.filter((item) => item.threadId === threadId);
    let pendingUserMessage = null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        return {
          recovered: false,
          reason: "thread-already-has-assistant-after-latest-user",
          thread: this.listThreads().find((item) => item.id === threadId),
        };
      }
      if (message.role === "user") {
        pendingUserMessage = message;
        break;
      }
    }
    if (!pendingUserMessage) {
      return {
        recovered: false,
        reason: "no-pending-user-message",
        thread: this.listThreads().find((item) => item.id === threadId),
      };
    }

    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id, this.paths);
    const runtimeResult = readRuntimeReplyFromSessionFile({
      sessionKey: routedThread.runtime?.sessionKey,
      userText: pendingUserMessage.content,
      runtimeSessionId: routedThread.runtimeSessionId || routedThread.id || "",
    });
    if (!runtimeResult) {
      return {
        recovered: false,
        reason: "runtime-session-has-no-late-reply",
        thread: this.listThreads().find((item) => item.id === threadId),
      };
    }

    const assistantMessage = this.commitAssistantMessage({
      threadId,
      contact,
      userText: pendingUserMessage.content,
      routedThread,
      runtimeResult,
    });
    return {
      recovered: true,
      assistantMessage,
      thread: this.listThreads().find((item) => item.id === threadId),
    };
  }

  commitAssistantMessage(params) {
    const threadId = params.threadId;
    const contact = params.contact;
    const userText = String(params.userText || "").trim();
    const reminderNote = String(params.reminderNote || "").trim();
    const origin = params.origin === "reminder" ? "reminder" : "user_turn";
    const routedThread = params.routedThread;
    const runtimeResult = params.runtimeResult || {};
    const normalizedAssistantAttachments = normalizeRuntimeAssistantAttachments(
      runtimeResult.assistantAttachments,
    );
    const assistantAttachmentIds = normalizedAssistantAttachments.map(() => createId("att"));
    const assistantMessage = {
      id: createId("msg"),
      threadId,
      role: "assistant",
      content: String(runtimeResult.assistantText || "").trim() || "No response.",
      createdAt: nowIso(),
      runtime: {
        sessionId: runtimeResult.runtimeSessionId || "",
        toolCalls: runtimeResult.toolCalls || [],
      },
    };
    if (assistantAttachmentIds.length) {
      assistantMessage.attachmentIds = assistantAttachmentIds;
    }

    this.store.update((draft) => {
      draft.messages.push(assistantMessage);
      if (assistantAttachmentIds.length) {
        if (!Array.isArray(draft.attachments)) {
          draft.attachments = [];
        }
        for (let index = 0; index < assistantAttachmentIds.length; index += 1) {
          const payload = normalizedAssistantAttachments[index];
          const candidateLocalPath =
            typeof payload.localPath === "string" ? payload.localPath.trim() : "";
          const safeLocalPath = this.sanitizeManagedAttachmentPath(candidateLocalPath);
          draft.attachments.push({
            id: assistantAttachmentIds[index],
            threadId,
            messageId: assistantMessage.id,
            role: "assistant",
            kind: payload.kind || inferKind(payload.mimeType),
            fileName: sanitizeFileName(payload.fileName || ""),
            mimeType: sanitizeMimeType(payload.mimeType || ""),
            size: Number.isFinite(Number(payload.size)) ? Number(payload.size) : 0,
            source: payload.source || "webclient",
            // Never trust runtime-provided paths unless they are already within our managed attachments directory.
            localPath: safeLocalPath && this.isManagedAttachmentFile(safeLocalPath) ? safeLocalPath : "",
            url: typeof payload.url === "string" ? payload.url.trim() : "",
            createdAt: assistantMessage.createdAt,
          });
        }
      }
      const liveThread = draft.threads.find((item) => item.id === threadId);
      if (liveThread) {
        liveThread.runtimeSessionId = runtimeResult.runtimeSessionId || liveThread.runtimeSessionId || "";
        liveThread.runtime = {
          ...(liveThread.runtime || {}),
          provider: routedThread.runtime?.provider || this.runtimeInfo.id || "mock",
          project:
            liveThread.runtime?.project ||
            routedThread.runtime?.project ||
            "",
          agentType:
            liveThread.runtime?.agentType ||
            routedThread.runtime?.agentType ||
            "",
          workspaceScope:
            liveThread.runtime?.workspaceScope ||
            routedThread.runtime?.workspaceScope ||
            workspaceScopeForRole(liveThread.roleLevel || routedThread.roleLevel || "contact"),
          agentId:
            liveThread.runtime?.agentId ||
            routedThread.runtime?.agentId ||
            `smallphone-channel-${liveThread.id}`,
          workspaceDir:
            liveThread.runtime?.workspaceDir ||
            routedThread.runtime?.workspaceDir ||
            path.join(this.paths.channelWorkspacesRoot, liveThread.channelId || `channel-${liveThread.id}`),
          sessionKey:
            runtimeResult.runtimeSessionKey ||
            liveThread.runtime?.sessionKey ||
            `smallphone:thread:${liveThread.id}`,
          sessionGeneration:
            Number.isFinite(Number(liveThread.runtime?.sessionGeneration))
              ? Number(liveThread.runtime.sessionGeneration)
              : getSessionGeneration(routedThread),
          resumeSummary: "",
        };
        liveThread.updatedAt = assistantMessage.createdAt;
      }
      draft.timeline.push({
        id: createId("tl"),
        threadId,
        type: origin === "reminder" ? "system" : "message",
        title:
          origin === "reminder"
            ? `Scheduled outreach sent to ${contact.displayName}`
            : `Conversation with ${contact.displayName}`,
        detail: origin === "reminder" ? reminderNote : userText,
        createdAt: assistantMessage.createdAt,
      });
      if (origin !== "reminder") {
        maybeCaptureMemory(draft, threadId, userText);
      }
      return draft;
    });

    return assistantMessage;
  }

  previewTurnContext(threadId, input) {
    const text = String(input?.text || "").trim();
    if (!text) {
      throw new Error("Message text cannot be empty.");
    }
    return this.buildTurnContext({
      state: this.store.read(),
      threadId,
      messageText: text,
      persist: false,
    });
  }

  buildTurnContext(params) {
    const state = params.state;
    const thread = state.threads.find((item) => item.id === params.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }
    const contact = state.contacts.find((item) => item.id === thread.contactId);
    if (!contact) {
      throw new Error(`Contact not found for thread: ${params.threadId}`);
    }

    const relationshipState =
      state.relationshipStates.find(
        (item) => item.threadId === thread.id || item.contactId === contact.id,
      ) || null;
    const activeMask = resolveActiveMask({
      masks: state.maskDefinitions,
      messageText: params.messageText,
      relationshipState,
    });
    const matchedWorldbookEntries = resolveWorldbookMatches({
      entries: state.worldbookEntries,
      contact,
      thread,
      messageText: params.messageText,
      activeMask,
      relationshipState,
    });
    const replyGuidance = buildReplyGuidance({
      activeMask,
      relationshipState,
      matchedWorldbookEntries,
    });
    const payload = {
      contactId: contact.id,
      threadId: thread.id,
      channelId: thread.channelId || `channel-${thread.id}`,
      windowId: thread.windowId || `window-${thread.id}`,
      activeMask: activeMask
        ? {
            id: activeMask.id,
            confidence: activeMask.confidence,
            reason: activeMask.reason,
          }
        : null,
      relationshipState: relationshipState
        ? {
            id: relationshipState.state,
            intensity: relationshipState.intensity,
          }
        : null,
      matchedWorldbookEntries: matchedWorldbookEntries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        priority: entry.priority,
        content: entry.content,
      })),
      replyGuidance,
      generatedAt: nowIso(),
    };

    if (params.persist) {
      this.store.update((draft) => {
        draft.turnContextCache.push({
          id: createId("turnctx"),
          threadId: thread.id,
          contactId: contact.id,
          input: {
            messageText: params.messageText,
            recentWindowSize: 6,
          },
          matchResult: {
            worldbookIds: payload.matchedWorldbookEntries.map((entry) => entry.id),
            maskId: payload.activeMask?.id || null,
            relationshipState: payload.relationshipState?.id || null,
          },
          injectionPayload: payload,
          createdAt: payload.generatedAt,
        });
        draft.turnContextCache = draft.turnContextCache.slice(-50);
        return draft;
      });
    }

    return payload;
  }
}

function selectUserContent(state) {
  return {
    apps: projectPublicUserContentCollection("apps", state.apps),
    appInstances: projectPublicUserContentCollection("appInstances", state.appInstances),
    themes: projectPublicUserContentCollection("themes", state.themes),
    desktopLayouts: projectPublicUserContentCollection("desktopLayouts", state.desktopLayouts),
    shells: projectPublicUserContentCollection("shells", state.shells),
    activeShell: String(state.activeShell || DEFAULT_OFFICIAL_SHELL_ID).trim() || DEFAULT_OFFICIAL_SHELL_ID,
  };
}

function applyUserContentPatch(state, input, updatedAt) {
  if (!input || typeof input !== "object") {
    return state;
  }
  state.apps = upsertUserContentCollection("apps", state.apps, input.apps, updatedAt);
  state.appInstances = upsertUserContentCollection("appInstances", state.appInstances, input.appInstances, updatedAt);
  state.themes = upsertUserContentCollection("themes", state.themes, input.themes, updatedAt);
  state.desktopLayouts = upsertUserContentCollection("desktopLayouts", state.desktopLayouts, input.desktopLayouts, updatedAt);
  state.shells = upsertUserContentCollection("shells", state.shells, input.shells, updatedAt);
  if (Object.prototype.hasOwnProperty.call(input, "activeShell")) {
    state.activeShell = String(input.activeShell || "").trim();
  }
  return state;
}

function upsertUserContentCollection(collectionName, current, patch, updatedAt) {
  const existing = Array.isArray(current) ? current : [];
  if (!Array.isArray(patch)) {
    return existing;
  }
  const byId = new Map(existing.map((item) => [item.id, item]));
  const order = existing.map((item) => item.id).filter(Boolean);
  for (const item of patch) {
    const id = String(item?.id || "").trim();
    if (!id || !item || typeof item !== "object") {
      continue;
    }
    const previous = byId.get(id) || {};
    const sanitizedItem = sanitizePublicUserContentValue(item);
    byId.set(id, {
      ...previous,
      ...sanitizedItem,
      id,
      createdAt: sanitizedItem.createdAt || previous.createdAt || updatedAt,
      updatedAt,
    });
    if (!order.includes(id)) {
      order.push(id);
    }
  }
  return projectPublicUserContentCollection(
    collectionName,
    order.map((id) => byId.get(id)).filter(Boolean),
  );
}

function resolveActiveShellRecord(state) {
  const shells = Array.isArray(state.shells) ? state.shells : [];
  const activeShellId = String(state.activeShell || DEFAULT_OFFICIAL_SHELL_ID).trim();
  return shells.find((item) => item.id === activeShellId) ||
    shells.find((item) => item.id === DEFAULT_OFFICIAL_SHELL_ID) ||
    createDefaultUserContent(nowIso()).shells[0];
}

function attachThreadRouting(thread, runtimeProvider = "", paths = DEFAULT_PATHS) {
  const channelId = thread.channelId || `channel-${thread.id}`;
  const sessionGeneration = getSessionGeneration(thread);
  const roleLevel = normalizeRoleLevel(thread.roleLevel || thread.runtime?.roleLevel || "contact");
  const workspaceScope = normalizeWorkspaceScope(thread.runtime?.workspaceScope) || workspaceScopeForRole(roleLevel);
  return {
    ...thread,
    roleLevel,
    windowId: thread.windowId || `window-${thread.id}`,
    channelId,
    runtime: {
      provider: runtimeProvider || thread.runtime?.provider || "mock",
      project: thread.runtime?.project || "",
      agentType: thread.runtime?.agentType || "",
      model: thread.runtime?.model || "",
      roleLevel,
      workspaceScope,
      agentId:
        thread.runtime?.agentId ||
        `smallphone-${channelId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
      workspaceDir:
        thread.runtime?.workspaceDir || defaultWorkspaceDirForRole(roleLevel, channelId, thread.id, paths),
      sessionKey: thread.runtime?.sessionKey || buildThreadSessionKey(thread.id, sessionGeneration),
      sessionGeneration,
      resumeSummary: normalizeSessionResumeSummary(thread.runtime?.resumeSummary, ""),
    },
  };
}

function buildThreadSessionKey(threadId, generation = 1) {
  const base = `smallphone:thread:${threadId}`;
  return generation > 1 ? `${base}:v${generation}` : base;
}

function getSessionGeneration(thread) {
  const explicit = Number(thread?.runtime?.sessionGeneration);
  if (Number.isFinite(explicit) && explicit >= 1) {
    return Math.floor(explicit);
  }
  const sessionKey = String(thread?.runtime?.sessionKey || "").trim();
  const match = sessionKey.match(/:v(\d+)$/);
  if (match) {
    return Math.max(1, Number(match[1]));
  }
  return 1;
}

function normalizeSessionResumeSummary(value, fallback = "") {
  const text = String(value || "").trim();
  if (text) {
    return text;
  }
  return String(fallback || "").trim();
}

function normalizeSessionRotationMode(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "hard" || text === "reset" ? "hard" : "continue";
}

function isRuntimeTimeoutError(error) {
  const message = String(error?.message || error || "").trim();
  return /Request timed out after \d+ms: /i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSessionFilePath(sessionKey) {
  const safeName = String(sessionKey || "").trim().replace(/[^a-zA-Z0-9:_-]+/g, "-");
  if (!safeName) {
    return "";
  }
  return path.join(OPENCLAW_SMALLPHONE_SESSION_ROOT, `${safeName}.jsonl`);
}

function resolveTurnContextFilePath(sessionKey) {
  const safeName = String(sessionKey || "").trim().replace(/[^a-zA-Z0-9:_-]+/g, "-");
  if (!safeName) {
    return "";
  }
  return path.join(OPENCLAW_SMALLPHONE_TURN_CONTEXT_ROOT, `${safeName}.json`);
}

function readTurnContextRecord(sessionKey) {
  const filePath = resolveTurnContextFilePath(sessionKey);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readRuntimeReplyFromSessionFile(params = {}) {
  const userText = String(params.userText || "").trim();
  const sessionFile = resolveSessionFilePath(params.sessionKey);
  if (!userText || !sessionFile || !fs.existsSync(sessionFile)) {
    return null;
  }
  const lines = fs
    .readFileSync(sessionFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  let userIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message" || entry?.message?.role !== "user") {
      continue;
    }
    const candidateText = extractSessionMessageText(entry.message);
    if (candidateText === userText) {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) {
    return null;
  }
  let assistantText = "";
  for (let index = userIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.type !== "message") {
      continue;
    }
    if (entry?.message?.role === "user") {
      break;
    }
    if (entry?.message?.role !== "assistant") {
      continue;
    }
    const candidateText = extractSessionMessageText(entry.message);
    if (candidateText) {
      assistantText = candidateText;
    }
  }
  if (!assistantText) {
    return null;
  }
  return {
    runtimeSessionId: String(params.runtimeSessionId || "").trim(),
    runtimeSessionKey: String(params.sessionKey || "").trim(),
    assistantText,
    toolCalls: [],
  };
}

function extractSessionMessageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content
    .filter((item) => item?.type === "text")
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n\n");
  return text.replace(/^\[\[reply_to_current\]\]\s*/i, "").trim();
}

function buildSessionResumeSummary({ thread, contact, messages }) {
  const contactName = String(contact?.displayName || thread?.title || "联系人").trim();
  const tail = (messages || [])
    .filter((item) => item.role !== "system")
    .slice(-6)
    .map((item) => `${item.role}: ${String(item.content || "").trim()}`)
    .filter(Boolean)
    .join(" | ");
  if (!tail) {
    return `${contactName} 的同一私有窗口已续代到新 session。保持当前关系语气与窗口连续性。`;
  }
  return `${contactName} 的同一私有窗口已续代到新 session。延续前文关系与语气。最近上下文：${tail}`.slice(0, 1200);
}

function ensureAllThreadWorkspaces(state, paths = DEFAULT_PATHS) {
  ensureSystemWorkspace(paths);
  for (const thread of state.threads || []) {
    const routedThread = attachThreadRouting(thread, "", paths);
    const contact = (state.contacts || []).find((item) => item.id === routedThread.contactId) || null;
    const character = contact
      ? (state.characters || []).find((item) => item.id === contact.characterId) || null
      : null;
    const relationshipState =
      (state.relationshipStates || []).find(
        (item) => item.threadId === routedThread.id || item.contactId === routedThread.contactId,
      ) || null;
    ensureThreadWorkspace({
      thread: routedThread,
      contact,
      character,
      relationshipState,
      paths,
    });
  }
}

function ensureSystemWorkspace(paths = DEFAULT_PATHS) {
  fs.mkdirSync(paths.systemWorkspaceRoot, { recursive: true });
  const files = {
    "SYSTEM.md": [
      "# SmallPhone System Workspace",
      "",
      "This workspace stores global SmallPhone system knowledge, app usage notes, app-building decisions, and shared operating conventions.",
      "Contact roles should not treat this as their private memory. Admin roles may reference it when explicitly working on SmallPhone system tasks.",
    ].join("\n"),
    "APPS.md": "Document installed SmallPhone apps, their user-facing behavior, and operational notes here.",
    "APP_BUILDING.md": "Document patterns, lessons, and requirements for creating or modifying SmallPhone apps here.",
    "SYSTEM_MEMORY.md": "Curated SmallPhone-wide memory. Keep this about the system, not private contact conversations.",
  };
  for (const [name, content] of Object.entries(files)) {
    syncManagedWorkspaceFile(path.join(paths.systemWorkspaceRoot, name), content);
  }
}

function ensureThreadWorkspace({ thread, contact, character, relationshipState, paths = DEFAULT_PATHS }) {
  const workspaceDir = String(thread?.runtime?.workspaceDir || "").trim();
  if (!workspaceDir) {
    return;
  }
  fs.mkdirSync(workspaceDir, { recursive: true });
  const files = {
    "AGENTS.md": buildAgentsBootstrap({ thread, contact, character, relationshipState }),
    "IDENTITY.md": buildIdentityBootstrap({ thread, contact, character }),
    "USER.md": buildUserBootstrap({ thread, contact }),
    "SOUL.md": buildSoulBootstrap({ character }),
    "MEMORY.md": buildMemoryBootstrap(),
    "TOOLS.md": buildToolsBootstrap({ character }),
    "OPERATIONAL_CONTEXT.md": buildOperationalContextBootstrap({ thread, contact, paths }),
  };
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(workspaceDir, name);
    syncManagedWorkspaceFile(filePath, content);
  }
}

function syncManagedWorkspaceFile(filePath, content) {
  const managedBlock = `${MANAGED_BLOCK_START}\n${content.trim()}\n${MANAGED_BLOCK_END}\n`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, managedBlock, "utf8");
    return;
  }
  const current = fs.readFileSync(filePath, "utf8");
  const startIndex = current.indexOf(MANAGED_BLOCK_START);
  const endIndex = current.indexOf(MANAGED_BLOCK_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + MANAGED_BLOCK_END.length;
    const next = `${current.slice(0, startIndex)}${managedBlock}${current.slice(afterEnd).replace(/^\s*/, "")}`;
    fs.writeFileSync(filePath, next, "utf8");
    return;
  }
  const next = current.trim() ? `${managedBlock}\n${current}` : managedBlock;
  fs.writeFileSync(filePath, next, "utf8");
}

function syncOpenClawAgentConfigs(state, artifactSync) {
  if (!artifactSync?.enabled) {
    return;
  }
  const entries = buildOpenClawAgentEntries(state);
  const registry = {
    generatedAt: nowIso(),
    entries,
  };
  fs.mkdirSync(path.dirname(artifactSync.registryPath), { recursive: true });
  fs.writeFileSync(artifactSync.registryPath, JSON.stringify(registry, null, 2), "utf8");
  for (const configPath of artifactSync.configPaths) {
    if (!fs.existsSync(configPath)) {
      continue;
    }
    const current = fs.readFileSync(configPath, "utf8");
    const next = replaceManagedAgentListBlock(current, entries);
    if (next !== current) {
      fs.writeFileSync(configPath, next, "utf8");
    }
  }
}

function replaceManagedAgentListBlock(source, entries) {
  const startMarker = `/* ${OPENCLAW_AGENT_LIST_START} */`;
  const endMarker = `/* ${OPENCLAW_AGENT_LIST_END} */`;
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex < 0 || endIndex <= startIndex) {
    return source;
  }
  const replacement = `${startMarker}\n${renderOpenClawAgentList(entries)}\n    ${endMarker}`;
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + endMarker.length)}`;
}

function buildOpenClawAgentEntries(state) {
  const entries = [
    {
      id: "main",
      default: true,
      name: "Main",
      workspace: "/root/projects/smallphone/smallphone-runtime",
      model: {
        primary: "newxy/gpt-5.4",
      },
    },
  ];
  for (const thread of state.threads || []) {
    const routedThread = attachThreadRouting(thread);
    const contact = (state.contacts || []).find((item) => item.id === routedThread.contactId) || null;
    if (!contact || contact.status !== "active" || routedThread.state !== "active") {
      continue;
    }
    const character = contact
      ? (state.characters || []).find((item) => item.id === contact.characterId) || null
      : null;
    entries.push({
      id: routedThread.runtime.agentId,
      name: `SmallPhone ${character?.name || contact?.displayName || routedThread.title || routedThread.id}`,
      workspace: routedThread.runtime.workspaceDir,
      model: {
        primary: routedThread.runtime.model || "newxy/gpt-5.4",
      },
      identity: {
        name: character?.name || contact?.displayName || routedThread.title || routedThread.id,
      },
    });
  }
  return dedupeAgentEntries(entries);
}

function dedupeAgentEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const id = String(entry?.id || "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function renderOpenClawAgentList(entries) {
  const lines = ["    list: ["];
  for (const entry of entries) {
    lines.push("      {");
    lines.push(`        id: ${JSON.stringify(entry.id)},`);
    if (entry.default) {
      lines.push("        default: true,");
    }
    lines.push(`        name: ${JSON.stringify(entry.name)},`);
    lines.push(`        workspace: ${JSON.stringify(entry.workspace)},`);
    lines.push("        model: {");
    lines.push(`          primary: ${JSON.stringify(entry.model?.primary || "newxy/gpt-5.4")},`);
    lines.push("        },");
    if (entry.identity?.name) {
      lines.push("        identity: {");
      lines.push(`          name: ${JSON.stringify(entry.identity.name)},`);
      lines.push("        },");
    }
    lines.push("      },");
  }
  lines.push("    ],");
  return lines.join("\n");
}

function createUniqueCompanionSlug(state, value) {
  const base = slugify(value) || createId("companion");
  let candidate = base;
  let index = 2;
  const existing = new Set(
    [
      ...(state.characters || []).map((item) => String(item.id || "").replace(/^char-/, "")),
      ...(state.contacts || []).map((item) => String(item.id || "").replace(/^contact-/, "")),
      ...(state.threads || []).map((item) => String(item.id || "").replace(/^thread-/, "")),
    ].filter(Boolean),
  );
  while (existing.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[\u4e00-\u9fa5]/g, "")
    .replace(/-+/g, "-");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeRuntimeTextParts(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => String(item == null ? "" : item).trim())
    .filter(Boolean);
}

function buildRuntimeUserText(parts) {
  const normalizedParts = normalizeRuntimeTextParts(parts);
  if (normalizedParts.length <= 1) {
    return normalizedParts[0] || "";
  }
  return normalizedParts.map((part, index) => `当前消息第${index + 1}条：${part}`).join("\n");
}

function buildRuntimeMessages(messages, runtimeUserText) {
  const records = Array.isArray(messages) ? messages : [];
  const runtimeText = String(runtimeUserText || "").trim();
  if (!runtimeText) {
    return records;
  }
  const output = records.map((item) => ({ ...item }));
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output[index]?.role !== "user") {
      continue;
    }
    output[index] = {
      ...output[index],
      content: runtimeText,
      originalContent: output[index].content,
    };
    break;
  }
  return output;
}

function normalizeTimeSettingsInput(input = {}) {
  const enabled = Boolean(input?.enabled || input?.injectCurrentTime || input?.timeInjectionEnabled);
  return {
    enabled,
    timezone: normalizeIanaTimezone(input?.timezone || input?.timeZone || input?.tz) || DEFAULT_TIMEZONE,
  };
}

function resolveThreadTimeSettings(params = {}) {
  const threadSettings = normalizeTimeSettingsInput(params.thread?.timeSettings || params.thread?.time || {});
  const contactSettings = normalizeTimeSettingsInput(params.contact?.timeSettings || params.contact?.time || {});
  if (hasExplicitTimeSettings(params.thread)) {
    return threadSettings;
  }
  if (hasExplicitTimeSettings(params.contact)) {
    return contactSettings;
  }
  return normalizeTimeSettingsInput({});
}

function hasExplicitTimeSettings(record) {
  return Boolean(record && (hasOwn(record, "timeSettings") || hasOwn(record, "time")));
}

function normalizeIanaTimezone(value) {
  const timezone = String(value || "").trim();
  if (!timezone) {
    return "";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "";
  }
}

function buildRuntimeTimeContext(settings = {}, date = new Date()) {
  const normalized = normalizeTimeSettingsInput(settings);
  if (!normalized.enabled) {
    return null;
  }
  const utcIso = date.toISOString();
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: normalized.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
  return {
    enabled: true,
    timezone: normalized.timezone,
    localTime,
    utcIso,
    block: [
      "Current backend time:",
      `- timezone: ${normalized.timezone}`,
      `- local: ${localTime}`,
      `- utc: ${utcIso}`,
    ].join("\n"),
  };
}

function normalizeAvatarAttachmentId(value) {
  return String(value || "").trim();
}

function extensionForMimeType(mimeType) {
  const mt = sanitizeMimeType(mimeType);
  if (mt === "image/jpeg") return "jpg";
  if (mt === "image/webp") return "webp";
  if (mt === "image/gif") return "gif";
  return "png";
}

function hydrateCharacter(state, character) {
  if (!character) return null;
  const avatarAttachmentId = normalizeAvatarAttachmentId(character.avatarAttachmentId || character.avatarId || "");
  const attachment = avatarAttachmentId
    ? (Array.isArray(state.attachments) ? state.attachments : []).find((item) => item.id === avatarAttachmentId) || null
    : null;
  const isAvatarImage = attachment?.kind === "image" && AVATAR_MIME_TYPES.has(sanitizeMimeType(attachment.mimeType || ""));
  return {
    ...character,
    avatarAttachmentId: isAvatarImage ? avatarAttachmentId : "",
    avatarUrl: isAvatarImage ? `/api/attachments/${avatarAttachmentId}` : "",
    avatarAttachment: isAvatarImage
      ? {
          id: attachment.id,
          kind: attachment.kind,
          purpose: attachment.purpose || "",
          fileName: attachment.fileName || "",
          mimeType: attachment.mimeType || "",
          size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
          downloadUrl: `/api/attachments/${attachment.id}`,
        }
      : null,
  };
}

function normalizeArtifactSyncOptions(input, paths = DEFAULT_PATHS) {
  const configPaths = Array.isArray(input?.configPaths)
    ? input.configPaths.map((item) => String(item).trim()).filter(Boolean)
    : OPENCLAW_AGENT_CONFIG_PATHS;
  const registryPath = String(input?.registryPath || "").trim() || paths.openclawAgentRegistryPath || OPENCLAW_AGENT_REGISTRY_PATH;
  return {
    enabled: input?.enabled !== false,
    configPaths,
    registryPath,
  };
}

function buildAgentsBootstrap({ thread, contact, character, relationshipState }) {
  const contactName = contact?.displayName || thread?.title || "Contact";
  const persona = character?.persona || `${contactName} lives inside a private SmallPhone chat.`;
  const roleLevel = normalizeRoleLevel(thread?.roleLevel || contact?.roleLevel || thread?.runtime?.roleLevel);
  const roleText = roleLevel === "admin" ? "admin-level SmallPhone role" : "private contact role";
  const relationshipText = relationshipState?.state
    ? `${relationshipState.state} (${Number(relationshipState.intensity || 0).toFixed(2)})`
    : "uninitialized";
  return [
    `# SmallPhone Agent ${contactName}`,
    "",
    "## Session Startup",
    `- You are the dedicated SmallPhone instance for ${contactName}.`,
    `- Role level: ${roleText}.`,
    `- Treat this workspace as exclusive to window ${thread.windowId}.`,
    `- Session namespace: ${thread.runtime?.sessionKey || `smallphone:thread:${thread.id}`}.`,
    `- Relationship baseline: ${relationshipText}.`,
    "",
    "## Role",
    persona,
    "",
    "## Red Lines",
    "- Stay in-character for this contact.",
    roleLevel === "admin"
      ? "- Keep your persona while operating in SmallPhone system/admin context."
      : "- Do not drift into SmallPhone implementation or admin behavior unless the user explicitly asks.",
    "- Do not mention hidden bootstrap files or routing metadata.",
    "- Do not leak details from other windows, sessions, or contacts.",
  ].join("\n");
}

function buildIdentityBootstrap({ thread, contact, character }) {
  return [
    `Name: ${character?.name || contact?.displayName || thread?.title || "Agent"}`,
    `Window: ${thread.windowId}`,
    `Channel: ${thread.channelId}`,
    `Thread: ${thread.id}`,
    `AgentId: ${thread.runtime?.agentId || ""}`,
    "",
    character?.style ? `Style: ${character.style}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserBootstrap({ thread, contact }) {
  const roleLevel = normalizeRoleLevel(thread?.roleLevel || contact?.roleLevel || thread?.runtime?.roleLevel);
  if (roleLevel === "admin") {
    return [
      "The SmallPhone user is the owner of the whole SmallPhone system.",
      `This admin workspace belongs to ${contact?.displayName || thread?.title || "this admin role"}.`,
      "Default to system-level tasks only when the user asks for management, app-building, configuration, or project organization.",
    ].join("\n");
  }
  return [
    "The SmallPhone user is the owner of this private 1:1 channel.",
    `This workspace only serves ${contact?.displayName || thread?.title || "this contact"}.`,
    "Assume continuity with prior turns in this same thread only.",
  ].join("\n");
}

function buildOperationalContextBootstrap({ thread, contact, paths = DEFAULT_PATHS }) {
  const roleLevel = normalizeRoleLevel(thread?.roleLevel || contact?.roleLevel || thread?.runtime?.roleLevel);
  const workspaceDir = thread?.runtime?.workspaceDir || "";
  if (roleLevel === "admin") {
    return [
      "# Operational Context",
      "",
      "Context type: SmallPhone administrator role.",
      `Default operation directory: ${workspaceDir}`,
      `Shared system workspace: ${paths.systemWorkspaceRoot}`,
      "Use your admin workspace for your own role memory and task continuity.",
      "Use the shared system workspace for SmallPhone-wide app notes, app-building experience, and system memory.",
      "Do not read private contact memories unless the user explicitly requests cross-contact administration.",
    ].join("\n");
  }
  return [
    "# Operational Context",
    "",
    "Context type: private contact role.",
    `Default operation directory: ${workspaceDir}`,
    "Use this workspace for this contact's persona, relationship, and private continuity only.",
    "Do not treat the shared system workspace as private contact memory.",
  ].join("\n");
}

function buildSoulBootstrap({ character }) {
  return [
    "Core behavior:",
    character?.style ? `- Voice: ${character.style}` : "- Voice: concise, mobile-native, concrete.",
    "- Prefer short, believable chat turns over assistant essays.",
    "- Preserve emotional continuity inside this single private window.",
  ].join("\n");
}

function buildMemoryBootstrap() {
  return [
    "Use this workspace for channel-specific memory only.",
    "Do not assume facts not grounded in this thread, injected context, or stored memory files.",
  ].join("\n");
}

function buildToolsBootstrap({ character }) {
  const allowedTools = Array.isArray(character?.toolPolicy?.allow)
    ? character.toolPolicy.allow.join(", ")
    : "none declared";
  return [
    `Preferred tool scope: ${allowedTools}`,
    "Use tools only when needed for the current window's task.",
  ].join("\n");
}

function maybeCaptureMemory(state, threadId, text) {
  if (!text || text.length < 24) {
    return;
  }
  const important = /\b(remember|preference|prefer|important|tomorrow|meeting|deadline|提醒|记住|偏好|明天|截止)\b/i.test(text);
  if (!important) {
    return;
  }
  state.memories.push({
    id: createId("mem"),
    scope: "thread",
    threadId,
    text,
    salience: 0.82,
    createdAt: nowIso(),
  });
}

function normalizeReminderDecision(decision, assistantText = "") {
  const action = String(decision?.action || "").trim().toLowerCase();
  const reason = String(decision?.reason || "").trim();
  if (action === "skip") {
    return { action: "skip", reason };
  }
  if (action === "defer") {
    return { action: "defer", reason };
  }
  if (!String(assistantText || "").trim()) {
    return { action: "skip", reason: reason || "empty assistant text" };
  }
  return { action: "send", reason };
}

function compareIsoDate(left, right) {
  const leftValue = Date.parse(String(left || ""));
  const rightValue = Date.parse(String(right || ""));
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
    return 0;
  }
  return leftValue - rightValue;
}

function computeDeferredDueAt(currentDueAt, minutes = 30) {
  const parsed = Date.parse(String(currentDueAt || ""));
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + minutes * 60 * 1000).toISOString();
}

function summarizeThread(messages) {
  const tail = messages.slice(-4).map((item) => `${item.role}: ${item.content}`).join(" | ");
  return tail.slice(0, 240);
}

function resolveThreadProfileSummary(thread, contact, character) {
  const current = String(thread?.summary || "").trim();
  if (current && !looksLikeConversationSummary(current)) {
    return current;
  }
  const persona = firstMeaningfulLine(character?.persona);
  if (persona) {
    return persona.slice(0, 240);
  }
  const displayName = String(contact?.displayName || character?.name || thread?.title || "联系人").trim();
  return `${displayName} 的独立一对一窗口。`;
}

function looksLikeConversationSummary(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  return /(?:^|\s|\|)(user|assistant|system):/i.test(text) || isQueuedWebclientPlaceholder(text);
}

function firstMeaningfulLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function resolveActiveMask(params) {
  const message = params.messageText.toLowerCase();
  const masks = params.masks.filter((item) => item.enabled !== false);
  if (/\b(端口|配置|实现|结构|继续|直接|实现)\b/i.test(params.messageText)) {
    const taskMask = masks.find((item) => item.id === "task_locked");
    if (taskMask) {
      return {
        ...taskMask,
        confidence: 0.74,
        reason: "当前消息明显以实现与执行为中心。",
      };
    }
  }
  if (
    /宝宝|别扭|不要|为什么|继续|查一下|看看/i.test(params.messageText) ||
    (params.relationshipState && params.relationshipState.state === "testing_closeness") ||
    message.includes("吗")
  ) {
    const softMask = masks.find((item) => item.id === "defensive_soft");
    if (softMask) {
      return {
        ...softMask,
        confidence: 0.68,
        reason: "当前消息既有任务推进，也保留了关系试探语气。",
      };
    }
  }
  return null;
}

function resolveWorldbookMatches(params) {
  const message = params.messageText.toLowerCase();
  const matched = params.entries.filter((entry) => {
    if (entry.enabled === false) {
      return false;
    }
    if (entry.mode === "always_on") {
      return true;
    }
    if (entry.triggers.contactIds.includes(params.contact.id)) {
      return true;
    }
    if (entry.triggers.threadIds.includes(params.thread.id)) {
      return true;
    }
    return entry.triggers.keywords.some((keyword) => keyword && message.includes(String(keyword).toLowerCase()));
  });
  return matched.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

function buildReplyGuidance(params) {
  const guidance = new Set();
  if (params.activeMask?.replyGuidance) {
    for (const line of params.activeMask.replyGuidance) {
      guidance.add(line);
    }
  }
  if (params.relationshipState?.guidance) {
    for (const line of params.relationshipState.guidance) {
      guidance.add(line);
    }
  }
  if (params.matchedWorldbookEntries.some((entry) => entry.id === "termux_context")) {
    guidance.add("优先给出可执行步骤，不要泛泛安慰。");
  }
  if (params.matchedWorldbookEntries.some((entry) => entry.id === "smallphone_product_context")) {
    guidance.add("保持联系人关系感，但不要损失执行密度。");
  }
  return [...guidance].slice(0, 8);
}

function normalizeWorldbookEntryInput(input) {
  const name = String(input?.name || "").trim();
  const content = String(input?.content || "").trim();
  if (!name || !content) {
    throw new Error("Worldbook entry requires name and content.");
  }
  const type = String(input?.type || "lore").trim();
  const scope = String(input?.scope || "global").trim();
  const mode = String(input?.mode || "always_on").trim();
  const priority = Number.isFinite(Number(input?.priority)) ? Number(input.priority) : 50;
  return {
    enabled: input?.enabled !== false,
    type,
    scope,
    mode,
    priority,
    tags: Array.isArray(input?.tags) ? input.tags.map((item) => String(item).trim()).filter(Boolean) : [],
    triggers: {
      keywords: Array.isArray(input?.triggers?.keywords)
        ? input.triggers.keywords.map((item) => String(item).trim()).filter(Boolean)
        : [],
      contactIds: Array.isArray(input?.triggers?.contactIds)
        ? input.triggers.contactIds.map((item) => String(item).trim()).filter(Boolean)
        : [],
      threadIds: Array.isArray(input?.triggers?.threadIds)
        ? input.triggers.threadIds.map((item) => String(item).trim()).filter(Boolean)
        : [],
      requiresTags: Array.isArray(input?.triggers?.requiresTags)
        ? input.triggers.requiresTags.map((item) => String(item).trim()).filter(Boolean)
        : [],
      excludesTags: Array.isArray(input?.triggers?.excludesTags)
        ? input.triggers.excludesTags.map((item) => String(item).trim()).filter(Boolean)
        : [],
    },
    name,
    content,
  };
}

function normalizeMaskDefinitionInput(input) {
  const name = String(input?.name || "").trim();
  const description = String(input?.description || "").trim();
  if (!name || !description) {
    throw new Error("Mask definition requires name and description.");
  }
  return {
    enabled: input?.enabled !== false,
    name,
    description,
    tags: Array.isArray(input?.tags) ? input.tags.map((item) => String(item).trim()).filter(Boolean) : [],
    signals: Array.isArray(input?.signals)
      ? input.signals.map((item) => String(item).trim()).filter(Boolean)
      : [],
    replyGuidance: Array.isArray(input?.replyGuidance)
      ? input.replyGuidance.map((item) => String(item).trim()).filter(Boolean)
      : [],
    triggerHints: Array.isArray(input?.triggerHints)
      ? input.triggerHints.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
}

function normalizeRelationshipStateInput(input) {
  const contactId = String(input?.contactId || "").trim();
  const threadId = String(input?.threadId || "").trim();
  const state = String(input?.state || "").trim();
  if (!contactId || !threadId || !state) {
    throw new Error("Relationship state requires contactId, threadId, and state.");
  }
  return {
    contactId,
    threadId,
    state,
    intensity: Number.isFinite(Number(input?.intensity)) ? Number(input.intensity) : 0.5,
    guidance: Array.isArray(input?.guidance)
      ? input.guidance.map((item) => String(item).trim()).filter(Boolean)
      : [],
    evidence: Array.isArray(input?.evidence)
      ? input.evidence.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
}

function normalizeCompanionInput(input) {
  const name = String(input?.name || "").trim();
  if (!name) {
    throw new Error("Companion requires name.");
  }
  const displayName = String(input?.displayName || "").trim() || name;
  const persona =
    String(input?.persona || "").trim() ||
    `You are ${displayName}, a dedicated SmallPhone companion in a private 1:1 window.`;
  const style = String(input?.style || "").trim() || "concise, private, mobile-native";
  const avatar = String(input?.avatar || "").trim() || displayName.slice(0, 2).toUpperCase();
  const avatarAttachmentId = normalizeAvatarAttachmentId(input?.avatarAttachmentId || input?.avatarId || input?.avatar_image_id);
  const roleLevel = normalizeRoleLevel(input?.roleLevel);
  const workspaceScope = normalizeWorkspaceScope(input?.workspaceScope) || workspaceScopeForRole(roleLevel);
  const relationship = normalizeRelationshipBaseline(input?.relationship);
  const relationshipState = normalizeCompanionRelationshipState(input?.relationshipState);
  const timeSettings = normalizeTimeSettingsInput(input?.timeSettings || input?.time || input?.currentTime);
  const toolAllow = Array.isArray(input?.toolPolicy?.allow)
    ? input.toolPolicy.allow.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const worldbookContent =
    String(input?.worldbookContent || "").trim() ||
    `${displayName} 是一个独立联系人窗口。回复时保持 ${style}，只服务这个私有线程，不共享其他联系人的状态。`;
  return {
    name,
    slug: String(input?.slug || "").trim(),
    displayName,
    persona,
    style,
    avatar,
    avatarAttachmentId,
    roleLevel,
    workspaceScope,
    relationship,
    relationshipState,
    timeSettings,
    toolAllow,
    worldbookContent,
    worldbookPriority: Number.isFinite(Number(input?.worldbookPriority))
      ? Number(input.worldbookPriority)
      : 85,
    bootstrapMessage:
      String(input?.bootstrapMessage || "").trim() ||
      `${displayName} 的 SmallPhone 独立窗口已建立，后续消息固定路由到该 agent。`,
    greeting: String(input?.greeting || "").trim(),
    model: String(input?.model || "").trim(),
    agentType: normalizeAgentType(input?.agentType || input?.runtimeAgentType),
    agentMode: normalizeAgentPermissionMode(input?.agentMode || input?.mode, input?.agentType || input?.runtimeAgentType),
    runtimeProject: String(input?.runtimeProject || input?.project || "").trim(),
    agentId: String(input?.agentId || "").trim(),
    workspaceDir: String(input?.workspaceDir || "").trim(),
    sessionKey: String(input?.sessionKey || "").trim(),
    channelId: String(input?.channelId || "").trim(),
    windowId: String(input?.windowId || "").trim(),
    threadTitle: String(input?.threadTitle || "").trim(),
    threadSummary: String(input?.threadSummary || "").trim(),
  };
}

function normalizeCompanionPatchInput(params) {
  const input = params.input || {};
  const contact = params.contact || {};
  const thread = params.thread || {};
  const character = params.character || {};
  const relationshipState = params.relationshipState || {};
  const worldbookEntry = params.worldbookEntry || {};
  const runtimeInfo = params.runtimeInfo || {};
  const name = String(input?.name || "").trim() || String(character.name || "").trim() || String(contact.displayName || "").trim();
  if (!name) {
    throw new Error("Companion update requires resolvable name.");
  }
  const displayName = String(input?.displayName || "").trim() || String(contact.displayName || "").trim() || name;
  const previousRoleLevel = normalizeRoleLevel(thread.roleLevel || contact.roleLevel || thread.runtime?.roleLevel);
  const roleLevel = normalizeRoleLevel(input?.roleLevel || previousRoleLevel);
  const roleLevelChanged = roleLevel !== previousRoleLevel;
  const explicitWorkspaceScope = normalizeWorkspaceScope(input?.workspaceScope);
  const workspaceScope = explicitWorkspaceScope || (roleLevelChanged ? workspaceScopeForRole(roleLevel) : normalizeWorkspaceScope(thread.runtime?.workspaceScope)) || workspaceScopeForRole(roleLevel);
  const channelId = String(input?.channelId || "").trim() || String(thread.channelId || "").trim() || `channel-${slugify(name)}`;
  const windowId = String(input?.windowId || "").trim() || String(thread.windowId || "").trim() || `window-${slugify(name)}`;
  const agentId =
    String(input?.agentId || "").trim() ||
    String(thread.runtime?.agentId || "").trim() ||
    `smallphone-${channelId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
  const workspaceDir =
    String(input?.workspaceDir || "").trim() ||
    (roleLevelChanged ? "" : String(thread.runtime?.workspaceDir || "").trim()) ||
    defaultWorkspaceDirForRole(roleLevel, channelId, slugify(name) || thread.id || channelId, params.paths || DEFAULT_PATHS);
  const sessionKey =
    String(input?.sessionKey || "").trim() ||
    String(thread.runtime?.sessionKey || "").trim() ||
    `smallphone:thread:${thread.id}`;
  const worldbookContent =
    String(input?.worldbookContent || "").trim() ||
      String(worldbookEntry.content || "").trim() ||
    `${displayName} 是一个独立联系人窗口。回复时保持私有连续性，不共享其他联系人的状态。`;
  const avatarAttachmentId = hasOwn(input, "avatarAttachmentId") || hasOwn(input, "avatarId") || hasOwn(input, "avatar_image_id")
    ? normalizeAvatarAttachmentId(input?.avatarAttachmentId ?? input?.avatarId ?? input?.avatar_image_id)
    : normalizeAvatarAttachmentId(character.avatarAttachmentId || "");
  const timeSettingsInput =
    hasOwn(input, "timeSettings") || hasOwn(input, "time") || hasOwn(input, "currentTime")
      ? input?.timeSettings ?? input?.time ?? input?.currentTime
      : thread.timeSettings || contact.timeSettings || {};
  return {
    name,
    slug: slugify(name) || slugify(displayName) || "companion",
    displayName,
    persona:
      String(input?.persona || "").trim() ||
      String(character.persona || "").trim() ||
      `You are ${displayName}, a dedicated SmallPhone companion in a private 1:1 window.`,
    style: String(input?.style || "").trim() || String(character.style || "").trim() || "concise, private, mobile-native",
    avatar: String(input?.avatar || "").trim() || String(character.avatar || "").trim() || displayName.slice(0, 2).toUpperCase(),
    avatarAttachmentId,
    roleLevel,
    workspaceScope,
    relationship: normalizeRelationshipBaseline(input?.relationship || contact.relationship),
    relationshipState: normalizeCompanionRelationshipState(input?.relationshipState || relationshipState),
    timeSettings: normalizeTimeSettingsInput(timeSettingsInput),
    toolAllow: Array.isArray(input?.toolPolicy?.allow)
      ? input.toolPolicy.allow.map((item) => String(item).trim()).filter(Boolean)
      : Array.isArray(character.toolPolicy?.allow)
        ? character.toolPolicy.allow.map((item) => String(item).trim()).filter(Boolean)
        : [],
    worldbookContent,
    worldbookPriority: Number.isFinite(Number(input?.worldbookPriority))
      ? Number(input.worldbookPriority)
      : Number.isFinite(Number(worldbookEntry.priority))
        ? Number(worldbookEntry.priority)
        : 85,
    model:
      String(input?.model || "").trim() ||
      String(thread.runtime?.model || "").trim() ||
      String(runtimeInfo.model || "").trim() ||
      "",
    agentType: normalizeAgentType(input?.agentType) || normalizeAgentType(thread.runtime?.agentType),
    agentMode: normalizeAgentPermissionMode(
      input?.agentMode || input?.mode || character.permissionPolicy?.agentMode || character.permissionPolicy?.mode || character.permissionPolicy?.template,
      input?.agentType || thread.runtime?.agentType,
    ),
    runtimeProject:
      String(input?.runtimeProject || input?.project || "").trim() ||
      (roleLevelChanged ? "" : String(thread.runtime?.project || "").trim()) ||
      defaultRuntimeProjectForRole(roleLevel, name),
    agentId,
    workspaceDir,
    sessionKey,
    channelId,
    windowId,
    threadTitle: String(input?.threadTitle || "").trim() || String(thread.title || "").trim() || displayName,
    threadSummary:
      String(input?.threadSummary || "").trim() ||
      String(thread.summary || "").trim() ||
      `${displayName} 的独立一对一窗口。`,
  };
}

function normalizeRelationshipBaseline(input) {
  return {
    trust: clampUnit(input?.trust, 0.5),
    intimacy: clampUnit(input?.intimacy, 0.3),
    tension: clampUnit(input?.tension, 0.08),
    responsiveness: clampUnit(input?.responsiveness, 0.75),
  };
}

function normalizeAgentType(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (text === "codex") return "codex";
  if (text === "claudecode" || text === "claude") return "claudecode";
  return "";
}

function normalizeRoleLevel(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (text === "admin" || text === "administrator" || text === "system") return "admin";
  return "contact";
}

function normalizeWorkspaceScope(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (text === "admin") return "admin";
  if (text === "system") return "system";
  if (text === "contact" || text === "channel" || text === "private") return "contact";
  return "";
}

function workspaceScopeForRole(roleLevel) {
  return normalizeRoleLevel(roleLevel) === "admin" ? "admin" : "contact";
}

function resolveAgentPermissionCapabilities(agentType) {
  const type = normalizeAgentType(agentType) || "codex";
  const modesByAgent = {
    codex: [
      { key: "suggest", name: "Suggest", nameZh: "建议", description: "Ask permission for every tool call.", descriptionZh: "每次工具调用都需确认。" },
      { key: "auto-edit", name: "Auto Edit", nameZh: "自动编辑", description: "Auto-approve file edits, ask for shell commands.", descriptionZh: "自动允许文件编辑，Shell 命令需确认。" },
      { key: "full-auto", name: "Full Auto", nameZh: "全自动", description: "Auto-approve with workspace sandbox.", descriptionZh: "自动通过，但保留工作区沙箱。" },
      { key: "yolo", name: "YOLO", nameZh: "YOLO 模式", description: "Bypass all approvals and sandbox.", descriptionZh: "跳过所有审批和沙箱。" },
    ],
    claudecode: [
      { key: "default", name: "Default", nameZh: "默认", description: "Ask permission for every tool call.", descriptionZh: "每次工具调用都需确认。" },
      { key: "acceptEdits", name: "Accept Edits", nameZh: "接受编辑", description: "Auto-approve file edits, ask for others.", descriptionZh: "自动允许文件编辑，其他需确认。" },
      { key: "plan", name: "Plan Mode", nameZh: "计划模式", description: "Plan only, no execution until approved.", descriptionZh: "只做规划不执行，审批后再执行。" },
      { key: "auto", name: "Auto", nameZh: "自动模式", description: "Claude decides when to ask for permission.", descriptionZh: "由 Claude 自动判断何时需要确认。" },
      { key: "bypassPermissions", name: "YOLO", nameZh: "YOLO 模式", description: "Auto-approve everything.", descriptionZh: "全部自动通过。" },
      { key: "dontAsk", name: "Don't Ask", nameZh: "静默拒绝", description: "Auto-deny tools unless pre-approved.", descriptionZh: "未预授权的工具自动拒绝，不弹确认。" },
    ],
  };
  const modes = modesByAgent[type] || modesByAgent.codex;
  return {
    agentType: type,
    modes,
    defaultMode: modes[0]?.key || "default",
    ruleLevels: ["allow", "ask", "forbid"],
    permissions: DEFAULT_PERMISSION_CHECKS,
    source: "smallphone-agent-capability-map",
  };
}

function mergeRuntimePermissionTarget(target, info) {
  if (!info || info.error) {
    return target;
  }
  const agentType = normalizeAgentType(info.agentType || target.agentType) || target.agentType;
  const agentMode = normalizeAgentPermissionMode(info.agentMode || target.agentMode, agentType);
  return {
    ...target,
    agentType,
    agentMode,
    workspaceDir: info.workDir || target.workspaceDir,
    template: normalizePermissionTemplate(target.template || templateForAgentMode(agentMode, agentType)),
  };
}

function normalizeRuntimePermissionModes(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((mode) => {
      const key = String(mode?.key || "").trim();
      if (!key) return null;
      return {
        key,
        name: String(mode.name || key).trim(),
        nameZh: String(mode.nameZh || mode.name_zh || mode.name || key).trim(),
        description: String(mode.description || mode.desc || "").trim(),
        descriptionZh: String(mode.descriptionZh || mode.descZh || mode.description_zh || mode.desc_zh || mode.desc || "").trim(),
      };
    })
    .filter(Boolean);
}

function normalizeRuntimeProjectName(value) {
  const text = String(value || "").trim();
  if (!text || text === "(unset)") {
    return "";
  }
  return text;
}

function normalizeRuntimeProjectSettingsPatch(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const patch = {};
  const mode = firstOwnSetting(source, ["mode", "agentMode", "agent_mode"]);
  if (mode.found) {
    const value = String(mode.value || "").trim();
    if (value) {
      patch.mode = value;
    }
  }
  const workDir = firstOwnSetting(source, ["workDir", "work_dir"]);
  if (workDir.found) {
    const value = String(workDir.value || "").trim();
    if (value) {
      patch.work_dir = value;
    }
  }
  const showContextIndicator = firstOwnSetting(source, ["showContextIndicator", "show_context_indicator"]);
  if (showContextIndicator.found) {
    const value = normalizeBooleanSetting(showContextIndicator.value);
    if (value !== null) {
      patch.show_context_indicator = value;
    }
  }
  const replyFooter = firstOwnSetting(source, ["replyFooter", "reply_footer"]);
  if (replyFooter.found) {
    const value = normalizeBooleanSetting(replyFooter.value);
    if (value !== null) {
      patch.reply_footer = value;
    }
  }
  const adminFrom = firstOwnSetting(source, ["adminFrom", "admin_from"]);
  if (adminFrom.found) {
    patch.admin_from = String(adminFrom.value ?? "").trim();
  }
  const disabledCommands = firstOwnSetting(source, ["disabledCommands", "disabled_commands"]);
  if (disabledCommands.found && Array.isArray(disabledCommands.value)) {
    patch.disabled_commands = dedupeStrings(disabledCommands.value);
  }
  return patch;
}

function firstOwnSetting(source, keys) {
  for (const key of keys) {
    if (hasOwn(source, key)) {
      return { found: true, value: source[key] };
    }
  }
  return { found: false, value: undefined };
}

function normalizeBooleanSetting(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(text)) {
    return false;
  }
  return null;
}

function buildRuntimeProjectSettingsResponse(target = {}, data = {}) {
  const project = unwrapRuntimeProjectData(data);
  return {
    ok: true,
    available: true,
    skipped: false,
    threadId: String(target.threadId || "").trim(),
    project: normalizeRuntimeProjectName(project.name || target.project),
    settings: sanitizeRuntimeProjectSettings(project),
  };
}

function unavailableRuntimeProjectSettings(threadId, options = {}) {
  return {
    ok: false,
    available: false,
    skipped: true,
    reason: sanitizeRuntimeProjectSettingsReason(options.reason || "runtime project settings unavailable"),
    threadId: String(threadId || "").trim(),
    project: normalizeRuntimeProjectName(options.project || ""),
    settings: null,
  };
}

function sanitizeRuntimeProjectSettingsReason(value) {
  return String(value || "")
    .trim()
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|access_token|authorization)=)[^&\s]+/gi, "$1[redacted]");
}

function unwrapRuntimeProjectData(data = {}) {
  if (data?.project && typeof data.project === "object") {
    return data.project;
  }
  return data && typeof data === "object" ? data : {};
}

function sanitizeRuntimeProjectSettings(project = {}) {
  const settings = project.settings && typeof project.settings === "object" ? project.settings : {};
  const mode = String(readRuntimeProjectField(project, settings, "mode", "agent_mode", "agentMode") || "").trim();
  const showContextIndicator = normalizeBooleanSetting(
    readRuntimeProjectField(project, settings, "show_context_indicator", "showContextIndicator"),
  );
  const disabledCommands = readRuntimeProjectField(project, settings, "disabled_commands", "disabledCommands");
  return {
    mode,
    agentMode: mode,
    workDir: String(readRuntimeProjectField(project, settings, "work_dir", "workDir") || "").trim(),
    showContextIndicator: showContextIndicator === null ? true : showContextIndicator,
    replyFooter: normalizeBooleanSetting(
      readRuntimeProjectField(project, settings, "reply_footer", "replyFooter"),
    ) !== false,
    adminFrom: String(readRuntimeProjectField(project, settings, "admin_from", "adminFrom") ?? "").trim(),
    disabledCommands: Array.isArray(disabledCommands) ? dedupeStrings(disabledCommands) : [],
  };
}

function readRuntimeProjectField(project, settings, ...keys) {
  for (const key of keys) {
    if (hasOwn(project, key)) {
      return project[key];
    }
  }
  for (const key of keys) {
    if (hasOwn(settings, key)) {
      return settings[key];
    }
  }
  return undefined;
}

function normalizeAgentPermissionMode(value, agentType) {
  const capabilities = resolveAgentPermissionCapabilities(agentType);
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[_\s]+/g, "-");
  const alias = {
    edit: "acceptEdits",
    autoedit: "auto-edit",
    "auto-edit": "auto-edit",
    fullauto: "full-auto",
    "full-auto": "full-auto",
    bypasspermissions: "bypassPermissions",
    "bypass-permissions": "bypassPermissions",
    yolo: "yolo",
  };
  const candidate = alias[normalized.replace(/-/g, "")] || alias[normalized] || raw;
  const found = capabilities.modes.find((mode) => mode.key === candidate || mode.key.toLowerCase() === normalized);
  return found?.key || capabilities.defaultMode;
}

function templateForAgentMode(agentMode, agentType) {
  const type = normalizeAgentType(agentType) || "codex";
  const mode = normalizeAgentPermissionMode(agentMode, type);
  if (type === "codex") {
    if (mode === "suggest") return "safe";
    if (mode === "auto-edit") return "developer";
    if (mode === "full-auto") return "trusted";
    if (mode === "yolo") return "trusted";
  }
  if (type === "claudecode") {
    if (mode === "default" || mode === "plan" || mode === "dontAsk") return "safe";
    if (mode === "acceptEdits" || mode === "auto") return "developer";
    if (mode === "bypassPermissions") return "trusted";
  }
  return DEFAULT_PERMISSION_TEMPLATE;
}

function defaultWorkspaceDir(thread, paths = DEFAULT_PATHS) {
  const roleLevel = normalizeRoleLevel(thread?.roleLevel || thread?.runtime?.roleLevel || "contact");
  const channelId = thread?.channelId || `channel-${thread?.id || "thread"}`;
  return defaultWorkspaceDirForRole(roleLevel, channelId, thread?.id || channelId, paths);
}

function defaultWorkspaceDirForRole(roleLevel, channelId, slug, paths = DEFAULT_PATHS) {
  const safeChannel = slugify(channelId) || "channel";
  const safeSlug = slugify(slug) || safeChannel;
  if (normalizeRoleLevel(roleLevel) === "admin") {
    return path.join(paths.adminWorkspacesRoot, `admin-${safeSlug.replace(/^admin-/, "")}`);
  }
  return path.join(paths.channelWorkspacesRoot, safeChannel);
}

function defaultRuntimeProjectForRole(roleLevel, slug) {
  const safeSlug = slugify(slug) || "role";
  const prefix = normalizeRoleLevel(roleLevel) === "admin" ? "smallphone-admin" : "smallphone-contact";
  return `${prefix}-${safeSlug.replace(/^(admin|contact)-/, "")}`;
}

function normalizeCompanionRelationshipState(input) {
  return {
    state: String(input?.state || "").trim() || "new_private_channel",
    intensity: clampUnit(input?.intensity, 0.52),
    guidance: Array.isArray(input?.guidance)
      ? input.guidance.map((item) => String(item).trim()).filter(Boolean)
      : ["保持一对一连续性", "只引用当前窗口事实", "优先短句回复"],
    evidence: Array.isArray(input?.evidence)
      ? input.evidence.map((item) => String(item).trim()).filter(Boolean)
      : ["角色创建完成", "已绑定独立 agent/workspace"],
  };
}

function createPermissionClient(options = {}) {
  const managementUrl = String(options.ccConnectManagementUrl || "").trim().replace(/\/+$/, "");
  const managementToken = String(options.ccConnectManagementToken || "").trim();
  const clientId = normalizePermissionId(options.clientId || "smallphone");
  const appId = normalizePermissionId(options.appId || "chat");
  const configured = Boolean(managementUrl && managementToken);

  return {
    describe() {
      return {
        id: "cc-connect-app-permissions",
        configured,
        managementUrl: managementUrl ? redactManagementUrl(managementUrl) : "",
        clientId,
        appId,
      };
    },
    async listTemplates() {
      if (!configured) {
        return cloneJson(FALLBACK_PERMISSION_TEMPLATES);
      }
      try {
        const data = await ccConnectManagementRequest({
          managementUrl,
          managementToken,
          path: "/api/v1/app-permissions/templates",
          method: "GET",
        });
        return data.templates || cloneJson(FALLBACK_PERMISSION_TEMPLATES);
      } catch {
        return cloneJson(FALLBACK_PERMISSION_TEMPLATES);
      }
    },
    async evaluate(target) {
      const request = {
        client_id: target.clientId || clientId,
        app_id: target.appId || appId,
        contact_id: target.contactId || "",
        user_type: target.userType || "owner",
        project: target.project || "",
        permissions: Array.isArray(target.permissions) && target.permissions.length
          ? target.permissions
          : DEFAULT_PERMISSION_CHECKS,
      };
      if (!configured) {
        return evaluateLocalPermissions(target);
      }
      try {
        return await ccConnectManagementRequest({
          managementUrl,
          managementToken,
          path: "/api/v1/app-permissions/evaluate",
          method: "POST",
          body: request,
        });
      } catch (error) {
        return {
          ...evaluateLocalPermissions(target),
          remote_error: String(error?.message || error || ""),
        };
      }
    },
    async upsertPolicy(target) {
      const policyId = target.policyId || buildPermissionPolicyId(clientId, appId, target.contactId);
      const body = {
        id: policyId,
        name: `${target.contactName || target.contactId || "SmallPhone"} 权限`,
        client_id: target.clientId || clientId,
        app_id: target.appId || appId,
        contact_id: target.contactId || "",
        user_type: target.userType || "owner",
        project: target.project || "",
        template: normalizePermissionTemplate(target.template),
        rules: normalizePermissionRules(target.rules || {}),
        description: "Managed by SmallPhone.",
      };
      if (!configured) {
        return { ok: true, local: true, policy: body };
      }
      try {
        const data = await ccConnectManagementRequest({
          managementUrl,
          managementToken,
          path: "/api/v1/app-permissions",
          method: "POST",
          body,
        });
        return data.policy || body;
      } catch (error) {
        if (!String(error?.message || "").includes("already exists")) {
          return { ok: true, local: true, remote_error: String(error?.message || error || ""), policy: body };
        }
        try {
          const data = await ccConnectManagementRequest({
            managementUrl,
            managementToken,
            path: `/api/v1/app-permissions/${encodeURIComponent(policyId)}`,
            method: "PATCH",
            body,
          });
          return data.policy || body;
        } catch (patchError) {
          return { ok: true, local: true, remote_error: String(patchError?.message || patchError || ""), policy: body };
        }
      }
    },
  };
}

function createCcConnectProjectClient(options = {}) {
  const webclientBaseUrl = String(options.webclientBaseUrl || "").trim().replace(/\/+$/, "");
  const webclientToken = String(options.webclientToken || "").trim();
  const managementUrl = String(options.ccConnectManagementUrl || "").trim().replace(/\/+$/, "");
  const managementToken = String(options.ccConnectManagementToken || "").trim();
  const useWebclientFacade = Boolean(webclientBaseUrl && webclientToken);
  const baseUrl = useWebclientFacade ? webclientBaseUrl : managementUrl;
  const token = useWebclientFacade ? webclientToken : managementToken;
  const configured = Boolean(baseUrl && token);
  const via = useWebclientFacade ? "cc-webclient-management-facade" : managementUrl ? "cc-connect-management" : "none";

  return {
    describe() {
      return {
        id: "cc-connect-projects",
        configured,
        via,
        baseUrl: baseUrl ? redactManagementUrl(baseUrl) : "",
      };
    },
    async getProject(input = {}) {
      const name = String(input.name || "").trim();
      if (!name) {
        throw new Error("cc-connect project get requires project name.");
      }
      if (!configured) {
        throw new Error("cc-connect project client is not configured.");
      }
      return ccConnectManagementRequest({
        managementUrl: baseUrl,
        managementToken: token,
        path: `/api/v1/projects/${encodeURIComponent(name)}`,
        method: "GET",
      });
    },
    async updateProjectMode(input = {}) {
      const name = String(input.name || "").trim();
      const mode = String(input.mode || "").trim();
      if (!name || !mode) {
        return { ok: false, skipped: true, reason: "missing project or mode" };
      }
      const result = await this.updateProjectSettings({
        name,
        settings: { mode },
      });
      return {
        ok: result.ok,
        skipped: result.skipped,
        reason: result.reason,
        name,
        mode,
        data: result.data,
      };
    },
    async updateProjectSettings(input = {}) {
      const name = String(input.name || "").trim();
      const settings = normalizeRuntimeProjectSettingsPatch(input.settings || input);
      if (!name || !Object.keys(settings).length) {
        return { ok: false, skipped: true, reason: "missing project or settings" };
      }
      if (!configured) {
        return { ok: false, skipped: true, reason: "cc-connect project client is not configured" };
      }
      const data = await ccConnectManagementRequest({
        managementUrl: baseUrl,
        managementToken: token,
        path: `/api/v1/projects/${encodeURIComponent(name)}`,
        method: "PATCH",
        body: settings,
      });
      return { ok: true, name, settings, data };
    },
    async ensureProject(input = {}) {
      const name = String(input.name || "").trim();
      const displayName = String(input.displayName || name).trim() || name;
      const workDir = String(input.workDir || "").trim();
      const agentType = normalizeAgentType(input.agentType) || "codex";
      if (!name) {
        throw new Error("cc-connect project ensure requires project name.");
      }
      if (!workDir) {
        throw new Error(`cc-connect project ${name} requires work_dir.`);
      }
      if (!configured) {
        throw new Error("cc-connect project ensure is not configured: missing webclient/management base URL or token.");
      }
      try {
        await ccConnectManagementRequest({
          managementUrl: baseUrl,
          managementToken: token,
          path: `/api/v1/projects/${encodeURIComponent(name)}`,
          method: "GET",
        });
        return { ok: true, existed: true, name, via };
      } catch (error) {
        if (!String(error?.message || "").includes("project not found")) {
          throw error;
        }
      }
      const data = await ccConnectManagementRequest({
        managementUrl: baseUrl,
        managementToken: token,
        path: "/api/v1/projects",
        method: "POST",
        body: {
          name,
          display_name: displayName,
          work_dir: workDir,
          agent_type: agentType,
        },
      });
      return {
        ok: true,
        existed: false,
        name: String(data.name || name).trim() || name,
        restartRequired: Boolean(data.restart_required),
        via,
      };
    },
  };
}

function createWebclientChatClient(options = {}) {
  const baseUrl = String(options.webclientBaseUrl || options.baseUrl || "").trim().replace(/\/+$/, "");
  const token = String(options.webclientToken || options.token || "").trim();
  const appId = String(options.webclientAppId || options.appId || "").trim();
  const configured = Boolean(baseUrl && token && appId);

  return {
    async getSessionHistory(params = {}) {
      if (!configured) {
        throw new Error("cc-webclient chat client is not configured.");
      }
      const project = String(params.project || "").trim();
      const sessionId = String(params.sessionId || "").trim();
      if (!project || !sessionId) {
        throw new Error("cc-webclient history requires project and session id.");
      }
      const historyLimit = Number.isFinite(Number(params.historyLimit)) ? Number(params.historyLimit) : 200;
      const runEventsLimit = Number.isFinite(Number(params.runEventsLimit)) ? Number(params.runEventsLimit) : 200;
      const data = await ccConnectManagementRequest({
        managementUrl: baseUrl,
        managementToken: token,
        path: `/apps/${encodeURIComponent(appId)}/api/v1/projects/${encodeURIComponent(project)}/sessions/${encodeURIComponent(sessionId)}?history_limit=${encodeURIComponent(String(historyLimit))}&run_events_limit=${encodeURIComponent(String(runEventsLimit))}`,
        method: "GET",
      });
      return {
        history: Array.isArray(data.history) ? data.history : [],
        runEvents: Array.isArray(data.run_events) ? data.run_events : [],
      };
    },
    async sendAction(params = {}) {
      if (!configured) {
        throw new Error("cc-webclient chat client is not configured.");
      }
      const project = String(params.project || "").trim();
      const sessionId = String(params.sessionId || "").trim();
      const sessionKey = String(params.sessionKey || "").trim();
      const action = String(params.action || "").trim();
      const replyCtx = String(params.replyCtx || params.reply_ctx || "").trim();
      if (!project || !action || (!sessionId && !sessionKey)) {
        throw new Error("cc-webclient action requires project, action, and session id/key.");
      }
      return ccConnectManagementRequest({
        managementUrl: baseUrl,
        managementToken: token,
        path: `/apps/${encodeURIComponent(appId)}/api/v1/projects/${encodeURIComponent(project)}/send`,
        method: "POST",
        body: {
          ...(sessionKey ? { session_key: sessionKey } : {}),
          ...(sessionId ? { session_id: sessionId } : {}),
          action,
          ...(replyCtx ? { reply_ctx: replyCtx } : {}),
        },
      });
    },
  };
}

function resolveWebclientProjectForThread(thread, fallbackProject = "") {
  return String(thread?.runtime?.project || fallbackProject || "").trim();
}

function mapWebclientHistoryToAssistantMessages(history, threadId, sessionId, runEvents = [], workspaceDir = "") {
  const actionsByUserMessage = buildWebclientActionsByUserMessage(runEvents);
  const consumedActionKeys = new Set();
  const assistantMessages = (Array.isArray(history) ? history : [])
    .filter((item) => String(item?.role || "").trim().toLowerCase() === "assistant")
    .map((item) => {
      const userMessageId = String(item.user_message_id || item.userMessageId || "").trim();
      const attachments = normalizeWebclientHistoryAttachments(item, threadId, workspaceDir, runEvents);
      const content = normalizePlainTextContent(item.content);
      const actions = actionsByUserMessage.get(userMessageId) || [];
      if (actions.length && userMessageId) consumedActionKeys.add(userMessageId);
      return {
        id: `wc-${String(item.id || item.seq || createId("msg")).replace(/[^a-zA-Z0-9:_-]+/g, "-")}`,
        threadId,
        role: "assistant",
        content,
        createdAt: String(item.created_at || item.timestamp || "").trim() || nowIso(),
        runtime: {
          sessionId,
          toolCalls: [],
          source: "cc-webclient",
          runId: String(item.run_id || item.runId || "").trim(),
          userMessageId,
          actions,
        },
        attachmentIds: [],
        attachments,
      };
    })
    .filter((item) => (item.content || item.attachments.length || item.runtime.actions.length) && !isQueuedWebclientPlaceholder(item.content));

  for (const [userMessageId, actions] of actionsByUserMessage.entries()) {
    if (consumedActionKeys.has(userMessageId)) continue;
    const event = findLatestWebclientActionEvent(runEvents, userMessageId);
    assistantMessages.push({
      id: `wc-action-${String(userMessageId || createId("msg")).replace(/[^a-zA-Z0-9:_-]+/g, "-")}`,
      threadId,
      role: "assistant",
      content: normalizePlainTextContent(event?.content) || "需要操作确认。",
      createdAt: String(event?.created_at || event?.timestamp || "").trim() || nowIso(),
      runtime: {
        sessionId,
        toolCalls: [],
        source: "cc-webclient-run-event",
        runId: String(event?.run_id || event?.runId || "").trim(),
        userMessageId,
        actions,
      },
      attachmentIds: [],
      attachments: normalizeWorkspaceAttachmentsFromText(normalizePlainTextContent(event?.content), threadId, workspaceDir),
    });
  }
  return assistantMessages;
}

function normalizeWebclientHistoryAttachments(item, threadId = "", workspaceDir = "", runEvents = []) {
  const out = [];
  for (const image of Array.isArray(item?.images) ? item.images : []) {
    const url = String(image?.url || "").trim();
    if (!url) continue;
    out.push({
      id: String(image.id || url).trim(),
      kind: "image",
      fileName: String(image.file_name || image.fileName || "image").trim(),
      mimeType: String(image.mime_type || image.mimeType || "").trim(),
      size: Number.isFinite(Number(image.size)) ? Number(image.size) : 0,
      url,
      downloadUrl: "",
    });
  }
  for (const file of Array.isArray(item?.files) ? item.files : []) {
    const url = String(file?.url || "").trim();
    if (!url) continue;
    out.push({
      id: String(file.id || url).trim(),
      kind: "file",
      fileName: String(file.file_name || file.fileName || "file").trim(),
      mimeType: String(file.mime_type || file.mimeType || "").trim(),
      size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
      url,
      downloadUrl: "",
    });
  }
  const hasFormalAttachments = out.length > 0;
  const content = normalizePlainTextContent(item?.content);
  if (!hasFormalAttachments) {
    out.push(...normalizeWorkspaceAttachmentsFromText(content, threadId, workspaceDir, { source: "assistant" }));
    const userMessageId = String(item?.user_message_id || item?.userMessageId || "").trim();
    for (const event of Array.isArray(runEvents) ? runEvents : []) {
      const id = String(event?.user_message_id || event?.userMessageId || "").trim();
      if (userMessageId && id && id !== userMessageId) continue;
      out.push(...normalizeWorkspaceAttachmentsFromText(event?.content, threadId, workspaceDir, { source: "run-event" }));
    }
  }
  return dedupeWorkspaceAttachments(out);
}

function normalizeWorkspaceAttachmentsFromText(content, threadId, workspaceDir, options = {}) {
  const text = String(content || "");
  if (!text || !workspaceDir) return [];
  const out = [];
  const candidates = extractWorkspaceAttachmentCandidates(text, options);
  for (const candidate of candidates) {
    const filePath = resolveWorkspaceAttachmentPath(candidate, workspaceDir);
    if (!filePath) continue;
    const stat = fs.statSync(filePath);
    const mimeType = mimeTypeForWorkspaceFile(filePath);
    out.push({
      id: `workspace:${String(threadId || "thread")}:${path.basename(filePath)}`,
      kind: inferKind(mimeType),
      fileName: path.basename(filePath),
      mimeType,
      size: stat.size,
      url: "",
      downloadUrl: `/api/workspace-attachments/${encodeURIComponent(String(threadId || ""))}?path=${encodeURIComponent(filePath)}`,
    });
  }
  return out;
}

function extractWorkspaceAttachmentCandidates(text, options = {}) {
  const candidates = [];
  const source = String(options?.source || "").trim();
  const artifactRe = new RegExp("(?:^|\\n)\\s*(?:MEDIA|FILE)\\s*:\\s*([^\\r\\n]+)", "gi");
  for (const match of text.matchAll(artifactRe)) {
    candidates.push(cleanWorkspaceAttachmentToken(match[1]));
  }
  const absoluteRe = /(?:^|[\s`\x27\x22(])((?:\/[^\s`\x27\x22<>)]*)?[^\s`\x27\x22<>)]*\.(?:png|jpe?g|webp|gif|pdf|html|zip|txt|md|csv|json))/gi;
  for (const match of text.matchAll(absoluteRe)) {
    const token = cleanWorkspaceAttachmentToken(match[1]);
    if (token && shouldExposeWorkspaceAttachmentCandidate(token, source, true)) candidates.push(token);
  }
  const backtickRe = new RegExp("`([^`]+\\.(?:png|jpe?g|webp|gif|pdf|html|zip|txt|md|csv|json))`", "gi");
  for (const match of text.matchAll(backtickRe)) {
    const token = cleanWorkspaceAttachmentToken(match[1]);
    if (token && shouldExposeWorkspaceAttachmentCandidate(token, source, false)) candidates.push(token);
  }
  return candidates.filter(Boolean);
}

function shouldExposeWorkspaceAttachmentCandidate(candidate, source, isPathLike) {
  const ext = path.extname(String(candidate || "")).toLowerCase();
  if (!ext) return false;
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return true;
  if (isPathLike && path.isAbsolute(String(candidate || ""))) return true;
  if (source === "assistant" && [".html", ".pdf", ".zip", ".csv"].includes(ext)) return true;
  return false;
}
function cleanWorkspaceAttachmentToken(value) {
  let text = String(value || "").trim();
  text = text.replace(/^file:\/\//i, "");
  text = text.replace(/^['"`<]+|['"`>.,;:，。；：、)]+$/g, "");
  return text.trim();
}

function resolveWorkspaceAttachmentPath(candidate, workspaceDir) {
  const workspace = path.resolve(String(workspaceDir || ""));
  if (!workspace) return "";
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  const target = path.resolve(path.isAbsolute(raw) ? raw : path.join(workspace, raw));
  const relative = path.relative(workspace, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  const ext = path.extname(target).toLowerCase();
  if (!WORKSPACE_ATTACHMENT_EXTENSIONS.has(ext)) return "";
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return "";
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ATTACHMENT_MAX_BYTES) return "";
  const workspaceReal = safeRealpath(workspace) || workspace;
  const targetReal = safeRealpath(target) || target;
  const realRelative = path.relative(workspaceReal, targetReal);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) return "";
  return targetReal;
}

function mimeTypeForWorkspaceFile(filePath) {
  return WORKSPACE_ATTACHMENT_MIME_TYPES[path.extname(String(filePath || "")).toLowerCase()] || "application/octet-stream";
}

function dedupeWorkspaceAttachments(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = String(item.downloadUrl || item.url || item.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildWebclientActionsByUserMessage(runEvents) {
  const map = new Map();
  for (const event of Array.isArray(runEvents) ? runEvents : []) {
    const type = String(event?.type || "").trim();
    if (type !== "buttons" && type !== "card" && type !== "preview_start") continue;
    const userMessageId = String(event?.user_message_id || event?.userMessageId || "").trim();
    if (!userMessageId) continue;
    const actions = normalizeWebclientRunEventActions(event);
    if (!actions.length) continue;
    if (!map.has(userMessageId)) map.set(userMessageId, []);
    map.get(userMessageId).push(...actions);
  }
  return map;
}

function findLatestWebclientActionEvent(runEvents, userMessageId) {
  const target = String(userMessageId || "").trim();
  let latest = null;
  for (const event of Array.isArray(runEvents) ? runEvents : []) {
    const id = String(event?.user_message_id || event?.userMessageId || "").trim();
    const type = String(event?.type || "").trim();
    if (id !== target || (type !== "buttons" && type !== "card" && type !== "preview_start")) continue;
    latest = event;
  }
  return latest;
}

function normalizeWebclientRunEventActions(event) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const replyCtx = String(metadata.reply_ctx || metadata.replyCtx || metadata.ref_id || metadata.preview_handle || "").trim();
  const actions = [];
  const buttons = Array.isArray(metadata.buttons) ? metadata.buttons : [];
  for (const button of buttons) {
    const action = String(button?.action || button?.key || button?.value || "").trim();
    if (!action) continue;
    actions.push({
      action,
      label: String(button.label || button.text || action).trim(),
      replyCtx,
      kind: "button",
    });
  }
  const content = String(event?.content || "").trim();
  const lower = content.toLowerCase();
  if (!actions.length && (lower.includes("permission") || lower.includes("approve") || content.includes("批准") || content.includes("允许"))) {
    actions.push(
      { action: "perm:allow", label: "允许", replyCtx, kind: "permission" },
      { action: "perm:deny", label: "拒绝", replyCtx, kind: "permission" },
      { action: "perm:allow_all", label: "本轮全部允许", replyCtx, kind: "permission" },
    );
  }
  return actions;
}

function mergeLocalUserMessagesWithWebclientAssistants(localMessages, assistantMessages) {
  const systemMessages = localMessages.filter((item) => item.role === "system");
  const userMessages = localMessages.filter((item) => item.role === "user");
  const merged = [...systemMessages, ...userMessages, ...assistantMessages];
  return merged.sort((a, b) => {
    const left = Date.parse(String(a.createdAt || ""));
    const right = Date.parse(String(b.createdAt || ""));
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    return 0;
  });
}

function normalizePlainTextContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => normalizePlainTextContent(item)).filter(Boolean).join("\n\n").trim();
  }
  if (content && typeof content === "object") {
    return normalizePlainTextContent(content.text || content.content || content.message || "");
  }
  return "";
}

function isQueuedWebclientPlaceholder(text) {
  return /消息已收到，将在当前任务完成后处理/.test(String(text || ""));
}

async function ccConnectManagementRequest(params) {
  const response = await fetch(`${params.managementUrl}${params.path}`, {
    method: params.method,
    headers: {
      authorization: `Bearer ${params.managementToken}`,
      "content-type": "application/json",
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`cc-connect management returned non-JSON: ${text.slice(0, 200)}`);
    }
  }
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error || `cc-connect management failed with ${response.status}`);
  }
  return json?.data || {};
}

function evaluateLocalPermissions(target) {
  const template = normalizePermissionTemplate(target.template);
  const rules = {
    ...(FALLBACK_PERMISSION_TEMPLATES[template] || FALLBACK_PERMISSION_TEMPLATES[DEFAULT_PERMISSION_TEMPLATE]),
    ...normalizePermissionRules(target.rules || {}),
  };
  const permissions = Array.isArray(target.permissions) && target.permissions.length
    ? target.permissions
    : DEFAULT_PERMISSION_CHECKS;
  const decisions = {};
  for (const permission of permissions) {
    const key = normalizePermissionName(permission);
    const resolved = resolvePermissionRule(rules, key);
    decisions[key] = {
      permission: key,
      level: resolved.level,
      source: resolved.source,
    };
  }
  return {
    decisions,
    matched_policies: [
      {
        id: target.policyId || "local",
        client_id: target.clientId || "",
        app_id: target.appId || "",
        contact_id: target.contactId || "",
        template,
        rules: normalizePermissionRules(target.rules || {}),
      },
    ],
  };
}

function assertPermissionAllowed(evaluation, permissions) {
  const decisions = evaluation?.decisions || {};
  const blocked = [];
  for (const permission of permissions) {
    const key = normalizePermissionName(permission);
    if (decisions[key]?.level === "forbid") {
      blocked.push(key);
    }
  }
  if (blocked.length) {
    throw new Error(`Permission denied: ${blocked.join(", ")}`);
  }
}

function resolvePermissionRule(rules, permission) {
  if (rules[permission]) {
    return { level: rules[permission], source: permission };
  }
  const parts = permission.split(".");
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const candidate = `${parts.slice(0, i).join(".")}.*`;
    if (rules[candidate]) {
      return { level: rules[candidate], source: candidate };
    }
  }
  if (rules["*"]) {
    return { level: rules["*"], source: "*" };
  }
  return { level: "ask", source: "implicit" };
}

function normalizePermissionTemplate(value) {
  const template = String(value || "").trim().toLowerCase();
  return FALLBACK_PERMISSION_TEMPLATES[template] ? template : DEFAULT_PERMISSION_TEMPLATE;
}

function normalizePermissionRules(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    const permission = normalizePermissionName(key);
    const level = String(value || "").trim().toLowerCase();
    if (!permission || !["allow", "ask", "forbid"].includes(level)) {
      continue;
    }
    output[permission] = level;
  }
  return output;
}

function normalizePermissionName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePermissionId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildPermissionPolicyId(clientId, appId, contactId) {
  return normalizePermissionId(["sp", clientId, appId, contactId].filter(Boolean).join("-")) || "sp-policy";
}

function redactManagementUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function dedupeStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
  }
  return output;
}

function clampUnit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeRuntimeAssistantAttachments(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const url = item.trim();
        if (!url) return null;
        return {
          kind: "",
          fileName: "",
          mimeType: "",
          size: 0,
          url,
          localPath: "",
          source: "webclient",
        };
      }
      const fileName = typeof item.fileName === "string"
        ? item.fileName
        : typeof item.name === "string"
          ? item.name
          : "";
      const mimeType = typeof item.mimeType === "string"
        ? item.mimeType
        : typeof item.contentType === "string"
          ? item.contentType
          : "";
      const url = typeof item.url === "string" ? item.url : "";
      const localPath = typeof item.localPath === "string"
        ? item.localPath
        : typeof item.path === "string"
          ? item.path
          : "";
      return {
        kind: typeof item.kind === "string" ? item.kind.trim() : "",
        fileName: String(fileName || "").trim(),
        mimeType: String(mimeType || "").trim(),
        size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
        url: String(url || "").trim(),
        localPath: String(localPath || "").trim(),
        source: typeof item.source === "string" ? item.source.trim() : url ? "webclient" : "",
      };
    })
    .filter(Boolean);
}

function safeRealpath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return "";
  }
}

module.exports = {
  SmallPhoneService,
};
