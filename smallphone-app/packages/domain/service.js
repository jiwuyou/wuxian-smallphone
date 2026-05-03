const fs = require("fs");
const path = require("path");
const { JsonStore } = require("../storage/json-store");
const { createRuntimeAdapter } = require("../openclaw-adapter");
const { createId, nowIso } = require("../shared/types");
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

const CHANNEL_WORKSPACES_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "channel-workspaces",
);
const MANAGED_BLOCK_START = "BEGIN_SMALLPHONE_MANAGED_BLOCK";
const MANAGED_BLOCK_END = "END_SMALLPHONE_MANAGED_BLOCK";
const OPENCLAW_AGENT_LIST_START = "BEGIN_SMALLPHONE_AGENT_LIST";
const OPENCLAW_AGENT_LIST_END = "END_SMALLPHONE_AGENT_LIST";
const OPENCLAW_AGENT_CONFIG_PATHS = [
  "/root/projects/smallphone/openclaw.global.openclaw.json",
  "/root/projects/smallphone/openclaw-smallphone.json",
];
const OPENCLAW_AGENT_REGISTRY_PATH = "/root/projects/smallphone/smallphone-active/smallphone-app/data/openclaw-agents.generated.json";
const OPENCLAW_SMALLPHONE_SESSION_ROOT = "/root/.openclaw/plugins/smallphone/sessions";
const OPENCLAW_SMALLPHONE_TURN_CONTEXT_ROOT = "/root/.openclaw/plugins/smallphone/turn-context";
const LATE_RUNTIME_REPLY_GRACE_MS = 30000;
const LATE_RUNTIME_REPLY_POLL_MS = 2000;
const ATTACHMENTS_ROOT = path.join(__dirname, "..", "..", "data", "attachments");
const ATTACHMENTS_ROOT_RESOLVED = path.resolve(ATTACHMENTS_ROOT);
const ATTACHMENT_MAX_BYTES = Number.parseInt(
  process.env.SMALLPHONE_ATTACHMENT_MAX_BYTES || "10485760",
  10,
);
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
    const dataFile = options.dataFile || path.join(__dirname, "..", "..", "data", "runtime.json");
    this.store = new JsonStore(dataFile);
    this.runtime = createRuntimeAdapter(options.runtime || {});
    this.runtimeInfo = this.runtime.describe();
    this.permissions = createPermissionClient(options.permissions || {});
    this.permissionInfo = this.permissions.describe();
    this.artifactSync = normalizeArtifactSyncOptions(options.artifactSync);
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

  listContacts() {
    const state = this.store.read();
    this.syncManagedArtifacts(state);
    return state.contacts.map((contact) => {
      const character = state.characters.find((item) => item.id === contact.characterId) || null;
      const thread = state.threads.find((item) => item.contactId === contact.id) || null;
      return {
        ...contact,
        character,
        thread: thread ? attachThreadRouting(thread, this.runtimeInfo.id) : null,
        relationshipState:
          state.relationshipStates.find(
            (item) => item.contactId === contact.id && (!thread || item.threadId === thread.id),
          ) || null,
      };
    });
  }

  listThreads() {
    const state = this.store.read();
    this.syncManagedArtifacts(state);
    return state.threads.map((thread) => {
      const contact = state.contacts.find((item) => item.id === thread.contactId) || null;
      const lastMessage = state.messages.filter((item) => item.threadId === thread.id).at(-1) || null;
      return {
        ...attachThreadRouting(thread, this.runtimeInfo.id),
        contact,
        lastMessage,
        relationshipState:
          state.relationshipStates.find(
            (item) => item.threadId === thread.id || item.contactId === thread.contactId,
          ) || null,
      };
    });
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
    const localPath = sanitizeManagedAttachmentPath(attachment.localPath);
    if (localPath && isManagedAttachmentFile(localPath)) {
      return {
        kind: "local",
        localPath,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      };
    }
    if (attachment.url) {
      if (typeof this.runtime?.fetchAttachment === "function") {
        const fetched = await this.runtime.fetchAttachment({ url: attachment.url, attachment });
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
        url: attachment.url,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      };
    }
    throw new Error(`Attachment has no data: ${attachment.id}`);
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
    const dir = path.join(ATTACHMENTS_ROOT, threadSegment, id);
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

  exposeAttachment(record) {
    return {
      id: record.id,
      kind: record.kind,
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
        workspaceDir: liveThread.runtime?.workspaceDir || defaultWorkspaceDir(liveThread),
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

  createCompanion(input) {
    const payload = normalizeCompanionInput(input);
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
      const workspaceDir = payload.workspaceDir || path.join(CHANNEL_WORKSPACES_ROOT, channelId);
      const sessionKey = payload.sessionKey || `smallphone:thread:${ids.threadId}`;
      const character = {
        id: ids.characterId,
        name: payload.name,
        avatar: payload.avatar,
        persona: payload.persona,
        style: payload.style,
        toolPolicy: {
          allow: payload.toolAllow,
        },
        createdAt,
        updatedAt: createdAt,
      };
      const contact = {
        id: ids.contactId,
        characterId: ids.characterId,
        displayName: payload.displayName || payload.name,
        kind: "agent",
        status: "active",
        agentId,
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
        summary: payload.threadSummary || `${payload.name} 的独立一对一窗口。`,
        runtimeSessionId: "",
        runtime: {
          provider: this.runtimeInfo.id || "mock",
          project: payload.runtimeProject,
          agentType: payload.agentType,
          model: payload.model || this.runtimeInfo.model || "",
          agentId,
          workspaceDir,
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
    const hydratedContacts = this.listContacts();
    const hydratedThreads = this.listThreads();
    return {
      ...created,
      contact: hydratedContacts.find((item) => item.id === created.contact.id) || created.contact,
      thread: hydratedThreads.find((item) => item.id === created.thread.id) || created.thread,
      openclaw: this.exportOpenClawAgentRegistry(),
    };
  }

  updateCompanion(contactId, input) {
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
    });
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
      liveCharacter.persona = payload.persona;
      liveCharacter.style = payload.style;
      liveCharacter.toolPolicy = {
        allow: payload.toolAllow,
      };
      liveCharacter.updatedAt = updatedAt;

      liveContact.displayName = payload.displayName;
      liveContact.agentId = payload.agentId;
      liveContact.relationship = {
        trust: payload.relationship.trust,
        intimacy: payload.relationship.intimacy,
        tension: payload.relationship.tension,
        responsiveness: payload.relationship.responsiveness,
      };
      liveContact.updatedAt = updatedAt;

      liveThread.title = payload.threadTitle;
      liveThread.summary = payload.threadSummary;
      liveThread.windowId = payload.windowId;
      liveThread.channelId = payload.channelId;
      liveThread.updatedAt = updatedAt;
      liveThread.runtime = {
        ...(liveThread.runtime || {}),
        provider: this.runtimeInfo.id || liveThread.runtime?.provider || "mock",
        project: payload.runtimeProject,
        agentType: payload.agentType,
        model: payload.model,
        agentId: payload.agentId,
        workspaceDir: payload.workspaceDir,
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
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id);
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
    const policy = await this.permissions.upsertPolicy(target);
    const evaluation = await this.permissions.evaluate(target);
    return {
      ...target,
      policy,
      templates: await this.permissions.listTemplates(),
      evaluation,
    };
  }

  async saveThreadPermissions(threadId, input = {}) {
    const target = this.resolvePermissionTarget(threadId);
    const template = normalizePermissionTemplate(input?.template || target.template);
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

    const nextTarget = this.resolvePermissionTarget(threadId);
    const policy = await this.permissions.upsertPolicy(nextTarget);
    const evaluation = await this.permissions.evaluate(nextTarget);
    return {
      ...nextTarget,
      policy,
      evaluation,
    };
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
    const policy = character.permissionPolicy || {};
    return {
      policyId: buildPermissionPolicyId(this.permissionInfo.clientId, this.permissionInfo.appId, contact.id),
      clientId: this.permissionInfo.clientId,
      appId: this.permissionInfo.appId,
      contactId: contact.id,
      contactName: contact.displayName,
      userType: "owner",
      project: this.runtimeInfo.project || "",
      template: normalizePermissionTemplate(policy.template || DEFAULT_PERMISSION_TEMPLATE),
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
    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id);
    ensureThreadWorkspace({
      thread: routedThread,
      contact,
      character,
      relationshipState:
        state.relationshipStates.find((item) => item.threadId === routedThread.id || item.contactId === contact.id) || null,
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
    ensureAllThreadWorkspaces(state);
    syncOpenClawAgentConfigs(state, this.artifactSync);
  }

  async sendMessage(threadId, input) {
    const text = String(input?.text || "").trim();
    const attachmentIds = normalizeAttachmentIds(input?.attachments || input?.attachmentIds || []);
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

    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id);
    ensureThreadWorkspace({
      thread: routedThread,
      contact,
      character,
      relationshipState:
        nextState.relationshipStates.find(
          (item) => item.threadId === routedThread.id || item.contactId === contact.id,
        ) || null,
    });

    const messages = nextState.messages.filter((item) => item.threadId === threadId);
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
        messages,
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

    const routedThread = attachThreadRouting(thread, this.runtimeInfo.id);
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
          const safeLocalPath = sanitizeManagedAttachmentPath(candidateLocalPath);
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
            localPath: safeLocalPath && isManagedAttachmentFile(safeLocalPath) ? safeLocalPath : "",
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
          agentId:
            liveThread.runtime?.agentId ||
            routedThread.runtime?.agentId ||
            `smallphone-channel-${liveThread.id}`,
          workspaceDir:
            liveThread.runtime?.workspaceDir ||
            routedThread.runtime?.workspaceDir ||
            path.join(CHANNEL_WORKSPACES_ROOT, liveThread.channelId || `channel-${liveThread.id}`),
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
        liveThread.summary = summarizeThread(draft.messages.filter((item) => item.threadId === threadId));
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

function attachThreadRouting(thread, runtimeProvider = "") {
  const channelId = thread.channelId || `channel-${thread.id}`;
  const sessionGeneration = getSessionGeneration(thread);
  return {
    ...thread,
    windowId: thread.windowId || `window-${thread.id}`,
    channelId,
    runtime: {
      provider: runtimeProvider || thread.runtime?.provider || "mock",
      project: thread.runtime?.project || "",
      agentType: thread.runtime?.agentType || "",
      model: thread.runtime?.model || "",
      agentId:
        thread.runtime?.agentId ||
        `smallphone-${channelId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
      workspaceDir:
        thread.runtime?.workspaceDir || path.join(CHANNEL_WORKSPACES_ROOT, channelId),
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

function ensureAllThreadWorkspaces(state) {
  for (const thread of state.threads || []) {
    const routedThread = attachThreadRouting(thread);
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
    });
  }
}

function ensureThreadWorkspace({ thread, contact, character, relationshipState }) {
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

function normalizeArtifactSyncOptions(input) {
  const configPaths = Array.isArray(input?.configPaths)
    ? input.configPaths.map((item) => String(item).trim()).filter(Boolean)
    : OPENCLAW_AGENT_CONFIG_PATHS;
  const registryPath = String(input?.registryPath || "").trim() || OPENCLAW_AGENT_REGISTRY_PATH;
  return {
    enabled: input?.enabled !== false,
    configPaths,
    registryPath,
  };
}

function buildAgentsBootstrap({ thread, contact, character, relationshipState }) {
  const contactName = contact?.displayName || thread?.title || "Contact";
  const persona = character?.persona || `${contactName} lives inside a private SmallPhone chat.`;
  const relationshipText = relationshipState?.state
    ? `${relationshipState.state} (${Number(relationshipState.intensity || 0).toFixed(2)})`
    : "uninitialized";
  return [
    `# SmallPhone Agent ${contactName}`,
    "",
    "## Session Startup",
    `- You are the dedicated SmallPhone instance for ${contactName}.`,
    `- Treat this workspace as exclusive to window ${thread.windowId}.`,
    `- Session namespace: ${thread.runtime?.sessionKey || `smallphone:thread:${thread.id}`}.`,
    `- Relationship baseline: ${relationshipText}.`,
    "",
    "## Role",
    persona,
    "",
    "## Red Lines",
    "- Stay in-character for this contact.",
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
  return [
    "The SmallPhone user is the owner of this private 1:1 channel.",
    `This workspace only serves ${contact?.displayName || thread?.title || "this contact"}.`,
    "Assume continuity with prior turns in this same thread only.",
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
  const relationship = normalizeRelationshipBaseline(input?.relationship);
  const relationshipState = normalizeCompanionRelationshipState(input?.relationshipState);
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
    relationship,
    relationshipState,
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
    agentType: normalizeAgentType(input?.agentType),
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
  const channelId = String(input?.channelId || "").trim() || String(thread.channelId || "").trim() || `channel-${slugify(name)}`;
  const windowId = String(input?.windowId || "").trim() || String(thread.windowId || "").trim() || `window-${slugify(name)}`;
  const agentId =
    String(input?.agentId || "").trim() ||
    String(thread.runtime?.agentId || "").trim() ||
    `smallphone-${channelId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
  const workspaceDir =
    String(input?.workspaceDir || "").trim() ||
    String(thread.runtime?.workspaceDir || "").trim() ||
    path.join(CHANNEL_WORKSPACES_ROOT, channelId);
  const sessionKey =
    String(input?.sessionKey || "").trim() ||
    String(thread.runtime?.sessionKey || "").trim() ||
    `smallphone:thread:${thread.id}`;
  const worldbookContent =
    String(input?.worldbookContent || "").trim() ||
    String(worldbookEntry.content || "").trim() ||
    `${displayName} 是一个独立联系人窗口。回复时保持私有连续性，不共享其他联系人的状态。`;
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
    relationship: normalizeRelationshipBaseline(input?.relationship || contact.relationship),
    relationshipState: normalizeCompanionRelationshipState(input?.relationshipState || relationshipState),
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
    runtimeProject:
      String(input?.runtimeProject || input?.project || "").trim() ||
      String(thread.runtime?.project || "").trim(),
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

function sanitizeManagedAttachmentPath(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const resolved = path.resolve(raw);
  const relative = path.relative(ATTACHMENTS_ROOT_RESOLVED, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  return resolved;
}

function isManagedAttachmentFile(localPath) {
  try {
    const stat = fs.lstatSync(localPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return false;
    }
    const rootReal = safeRealpath(ATTACHMENTS_ROOT_RESOLVED) || ATTACHMENTS_ROOT_RESOLVED;
    const fileReal = safeRealpath(localPath) || localPath;
    const relative = path.relative(rootReal, fileReal);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
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
