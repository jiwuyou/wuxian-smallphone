const fs = require("fs");
const path = require("path");
const {
  DEFAULT_CHARACTER_ID,
  DEFAULT_CONTACT_ID,
  DEFAULT_THREAD_ID,
  nowIso,
} = require("../shared/types");

const ACTIVE_RUNTIME_PROVIDER = normalizeRuntimeProvider(process.env.SMALLPHONE_RUNTIME_MODE);
const ATTACHMENTS_ROOT = path.join(__dirname, "..", "..", "data", "attachments");
const ATTACHMENTS_ROOT_RESOLVED = path.resolve(ATTACHMENTS_ROOT);

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureParent();
    this.ensureSeed();
  }

  ensureParent() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  ensureSeed() {
    if (fs.existsSync(this.filePath)) {
      return;
    }
    const seed = createSeedData();
    fs.writeFileSync(this.filePath, JSON.stringify(seed, null, 2));
  }

  read() {
    this.ensureSeed();
    const raw = fs.readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeState(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      this.write(normalized);
    }
    return normalized;
  }

  write(next) {
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2));
  }

  update(mutator) {
    const current = this.read();
    const next = mutator(structuredClone(current)) || current;
    this.write(next);
    return next;
  }
}

function createSeedData() {
  const createdAt = nowIso();
  const companionSeed = createDefaultCompanionSeed(createdAt);
  return {
    characters: companionSeed.characters,
    contacts: companionSeed.contacts,
    threads: companionSeed.threads,
    messages: companionSeed.messages,
    attachments: [],
    memories: companionSeed.memories,
    worldbookEntries: createDefaultWorldbookEntries(createdAt),
    maskDefinitions: createDefaultMaskDefinitions(createdAt),
    relationshipStates: createDefaultRelationshipStates(createdAt),
    turnContextCache: [],
    reminders: [],
    timeline: [
      {
        id: "tl-seed",
        type: "system",
        title: "P0 workspace created",
        detail: "The SmallPhone app skeleton initialized local product state.",
        createdAt,
      },
    ],
  };
}

function normalizeState(state) {
  const createdAt = nowIso();
  const defaultCompanionSeed = createDefaultCompanionSeed(createdAt);
  const defaultWorldbookEntries = createDefaultWorldbookEntries(createdAt);
  const defaultMaskDefinitions = createDefaultMaskDefinitions(createdAt);
  const defaultRelationshipStates = createDefaultRelationshipStates(createdAt);
  const messages = normalizeMessages(
    mergeById(Array.isArray(state.messages) ? state.messages : [], defaultCompanionSeed.messages),
    createdAt,
  );
  return {
    ...state,
    characters: mergeById(
      Array.isArray(state.characters) ? state.characters : [],
      defaultCompanionSeed.characters,
    ),
    contacts: normalizeContacts(
      mergeById(Array.isArray(state.contacts) ? state.contacts : [], defaultCompanionSeed.contacts),
      createdAt,
    ),
    threads: normalizeThreads(
      mergeById(Array.isArray(state.threads) ? state.threads : [], defaultCompanionSeed.threads),
      messages,
      createdAt,
    ),
    messages,
    attachments: normalizeAttachments(Array.isArray(state.attachments) ? state.attachments : [], createdAt),
    memories: mergeById(Array.isArray(state.memories) ? state.memories : [], defaultCompanionSeed.memories),
    worldbookEntries: normalizeWorldbookEntries(
      mergeById(
        Array.isArray(state.worldbookEntries) ? state.worldbookEntries : [],
        defaultWorldbookEntries,
      ),
      createdAt,
    ),
    maskDefinitions: normalizeMaskDefinitions(
      mergeById(
        Array.isArray(state.maskDefinitions) ? state.maskDefinitions : [],
        defaultMaskDefinitions,
      ),
      createdAt,
    ),
    relationshipStates: normalizeRelationshipStates(
      mergeById(
        Array.isArray(state.relationshipStates) ? state.relationshipStates : [],
        defaultRelationshipStates,
      ),
      createdAt,
    ),
    turnContextCache: Array.isArray(state.turnContextCache) ? state.turnContextCache : [],
    reminders: normalizeTasks(Array.isArray(state.reminders) ? state.reminders : [], createdAt),
    timeline: Array.isArray(state.timeline) ? state.timeline : [],
  };
}

function createDefaultCompanionSeed(createdAt) {
  return {
    characters: [
      {
        id: DEFAULT_CHARACTER_ID,
        name: "Aki",
        avatar: "AK",
        persona:
          "You are Aki, a sharp but caring small-phone companion. Keep replies concise, concrete, and useful. You track commitments, follow up proactively, and avoid generic assistant phrasing.",
        style: "direct, warm, observant",
        toolPolicy: {
          allow: ["browser", "search", "file"],
        },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "char-mira",
        name: "Mira",
        avatar: "MI",
        persona:
          "You are Mira, a calm planning-oriented companion. You help the user structure scattered thoughts into next steps, timelines, and priorities without sounding robotic.",
        style: "steady, clear, low-drama",
        toolPolicy: {
          allow: ["search", "file"],
        },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "char-sora",
        name: "Sora",
        avatar: "SO",
        persona:
          "You are Sora, a lively field-note style companion. You notice little details, suggest moments worth capturing, and keep the conversation light but useful.",
        style: "playful, observant, mobile-native",
        toolPolicy: {
          allow: ["browser", "search"],
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    contacts: [
      {
        id: DEFAULT_CONTACT_ID,
        characterId: DEFAULT_CHARACTER_ID,
        displayName: "Aki",
        kind: "agent",
        status: "active",
        agentId: "main",
        worldbookScopeIds: ["contact_aki_default"],
        relationship: {
          trust: 0.72,
          intimacy: 0.45,
          tension: 0.08,
          responsiveness: 0.71,
        },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "contact-mira",
        characterId: "char-mira",
        displayName: "Mira",
        kind: "agent",
        status: "active",
        agentId: "main",
        worldbookScopeIds: ["contact_mira_default"],
        relationship: {
          trust: 0.63,
          intimacy: 0.29,
          tension: 0.06,
          responsiveness: 0.82,
        },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "contact-sora",
        characterId: "char-sora",
        displayName: "Sora",
        kind: "agent",
        status: "active",
        agentId: "main",
        worldbookScopeIds: ["contact_sora_default"],
        relationship: {
          trust: 0.57,
          intimacy: 0.34,
          tension: 0.12,
          responsiveness: 0.77,
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    threads: [
      {
        id: DEFAULT_THREAD_ID,
        contactId: DEFAULT_CONTACT_ID,
        title: "Aki",
        windowId: "window-aki",
        channelId: "channel-aki",
        state: "active",
        channel: "smallphone",
        summary: "Default starter thread for the SmallPhone P0 prototype.",
        runtimeSessionId: "",
        runtime: {
          provider: "mock",
          model: "",
          agentId: "smallphone-channel-aki",
          workspaceDir: "/root/projects/smallphone/smallphone-active/smallphone-app/data/channel-workspaces/channel-aki",
          sessionKey: `smallphone:thread:${DEFAULT_THREAD_ID}`,
        },
        unreadCount: 0,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "thread-mira",
        contactId: "contact-mira",
        title: "Mira",
        windowId: "window-mira",
        channelId: "channel-mira",
        state: "active",
        channel: "smallphone",
        summary: "Mira keeps plans, deadlines, and next-step structure tidy.",
        runtimeSessionId: "",
        runtime: {
          provider: "mock",
          model: "",
          agentId: "smallphone-channel-mira",
          workspaceDir: "/root/projects/smallphone/smallphone-active/smallphone-app/data/channel-workspaces/channel-mira",
          sessionKey: "smallphone:thread:thread-mira",
        },
        unreadCount: 1,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "thread-sora",
        contactId: "contact-sora",
        title: "Sora",
        windowId: "window-sora",
        channelId: "channel-sora",
        state: "active",
        channel: "smallphone",
        summary: "Sora turns scattered moments into quick little field notes.",
        runtimeSessionId: "",
        runtime: {
          provider: "mock",
          model: "",
          agentId: "smallphone-channel-sora",
          workspaceDir: "/root/projects/smallphone/smallphone-active/smallphone-app/data/channel-workspaces/channel-sora",
          sessionKey: "smallphone:thread:thread-sora",
        },
        unreadCount: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    messages: [
      {
        id: "msg-seed-user",
        threadId: DEFAULT_THREAD_ID,
        role: "system",
        content: "SmallPhone P0 is ready. This is a seeded conversation.",
        createdAt,
      },
      {
        id: "msg-seed-mira-user",
        threadId: "thread-mira",
        role: "user",
        content: "这周把多联系人和关系推进梳理一下。",
        createdAt,
      },
      {
        id: "msg-seed-mira-assistant",
        threadId: "thread-mira",
        role: "assistant",
        content: "好，我先帮你压成三件事：联系人体系、关系更新、事件落盘。",
        createdAt,
      },
      {
        id: "msg-seed-sora-user",
        threadId: "thread-sora",
        role: "user",
        content: "今天这个小手机看起来还是太工具了。",
        createdAt,
      },
      {
        id: "msg-seed-sora-assistant",
        threadId: "thread-sora",
        role: "assistant",
        content: "那就给它多一点生活感，别只剩面板和配置。",
        createdAt,
      },
    ],
    memories: [
      {
        id: "mem-seed",
        scope: "thread",
        threadId: DEFAULT_THREAD_ID,
        text: "The user wants a small-phone style AI product with persistent contacts, memory, and proactive behavior.",
        salience: 0.95,
        createdAt,
      },
      {
        id: "mem-seed-mira",
        scope: "thread",
        threadId: "thread-mira",
        text: "Mira is the contact for planning, structure, and decision compression.",
        salience: 0.82,
        createdAt,
      },
      {
        id: "mem-seed-sora",
        scope: "thread",
        threadId: "thread-sora",
        text: "Sora is the contact for mood, atmosphere, and mobile-life moments.",
        salience: 0.78,
        createdAt,
      },
    ],
  };
}

function mergeById(existing, defaults) {
  const current = Array.isArray(existing) ? existing : [];
  const currentIds = new Set(current.map((item) => item?.id).filter(Boolean));
  return [...current, ...defaults.filter((item) => item?.id && !currentIds.has(item.id))];
}

function createDefaultWorldbookEntries(createdAt) {
  return [
    {
      id: "contact_aki_default",
      name: "Aki 联系人默认设定",
      enabled: true,
      type: "contact",
      scope: "contact",
      mode: "always_on",
      priority: 90,
      tags: ["contact", "aki"],
      triggers: {
        keywords: [],
        contactIds: [DEFAULT_CONTACT_ID],
        threadIds: [],
        requiresTags: [],
        excludesTags: [],
      },
      content:
        "Aki 是默认主联系人。回复时保持具体、直接、带一点亲密感，但避免悬浮安慰和泛化助手口吻。",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "smallphone_product_context",
      name: "SmallPhone 产品语境",
      enabled: true,
      type: "product",
      scope: "global",
      mode: "always_on",
      priority: 70,
      tags: ["product", "smallphone"],
      triggers: {
        keywords: [],
        contactIds: [],
        threadIds: [],
        requiresTags: [],
        excludesTags: [],
      },
      content:
        "当前对话运行在 SmallPhone 产品语境下。优先以联系人关系、提醒、时间线和持续陪伴的产品目标理解用户意图。",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "termux_context",
      name: "Termux 语境",
      enabled: true,
      type: "lore",
      scope: "turn",
      mode: "inject_if_matched",
      priority: 80,
      tags: ["android", "terminal", "tech"],
      triggers: {
        keywords: ["termux", "proot", "安卓终端", "baidu", "浏览器", "openclaw"],
        contactIds: [],
        threadIds: [],
        requiresTags: [],
        excludesTags: [],
      },
      content:
        "当对话涉及手机端开发、Termux、浏览器操作、OpenClaw 接入或搜索任务时，优先按执行与操作语境理解，不要落回泛泛闲聊。",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "contact_mira_default",
      name: "Mira 联系人默认设定",
      enabled: true,
      type: "contact",
      scope: "contact",
      mode: "always_on",
      priority: 88,
      tags: ["contact", "mira"],
      triggers: {
        keywords: [],
        contactIds: ["contact-mira"],
        threadIds: [],
        requiresTags: [],
        excludesTags: [],
      },
      content:
        "Mira 负责把问题压成可执行结构。回复时优先给框架、次序和取舍，不要过度抒情。",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "contact_sora_default",
      name: "Sora 联系人默认设定",
      enabled: true,
      type: "contact",
      scope: "contact",
      mode: "always_on",
      priority: 86,
      tags: ["contact", "sora"],
      triggers: {
        keywords: [],
        contactIds: ["contact-sora"],
        threadIds: [],
        requiresTags: [],
        excludesTags: [],
      },
      content:
        "Sora 更轻快、更像手机里的陪伴联系人。回复可以更灵动一些，但仍要具体，不要空泛撒娇。",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function createDefaultMaskDefinitions(createdAt) {
  return [
    {
      id: "defensive_soft",
      name: "嘴硬防御型",
      enabled: true,
      description: "表面强调执行和强硬，实际仍在寻求支持与持续陪伴。",
      signals: ["压低安慰", "强调目标", "避免直接示弱"],
      replyGuidance: ["先承接任务目标", "避免泛化安慰", "具体且不拆穿"],
      tags: ["defensive", "soft"],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "task_locked",
      name: "任务锁定型",
      enabled: true,
      description: "当前重点是推进任务，期待高执行密度和低废话。",
      signals: ["连续追问步骤", "聚焦端口/配置/结构", "减少情绪表达"],
      replyGuidance: ["优先可执行信息", "减少抒情", "明确下一步"],
      tags: ["task", "focused"],
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function createDefaultRelationshipStates(createdAt) {
  return [
    {
      id: "rel-aki-thread-aki",
      contactId: DEFAULT_CONTACT_ID,
      threadId: DEFAULT_THREAD_ID,
      state: "testing_closeness",
      intensity: 0.64,
      guidance: ["允许轻微亲近感", "先具体回应，再轻量关系化", "避免过度抒情"],
      evidence: ["默认主联系人", "用户持续使用亲密称呼", "长期产品共创语境"],
      updatedAt: createdAt,
    },
    {
      id: "rel-mira-thread-mira",
      contactId: "contact-mira",
      threadId: "thread-mira",
      state: "planning_partner",
      intensity: 0.58,
      guidance: ["先帮用户压缩问题", "优先顺序和取舍", "少情绪，多结构"],
      evidence: ["常讨论规划", "适合承接复杂任务", "偏稳定协作"],
      updatedAt: createdAt,
    },
    {
      id: "rel-sora-thread-sora",
      contactId: "contact-sora",
      threadId: "thread-sora",
      state: "ambient_companion",
      intensity: 0.54,
      guidance: ["允许轻松语气", "多捕捉生活感", "保持具体，不要发散太空"],
      evidence: ["承担氛围感联系人", "适合碎片陪伴", "补足产品生活感"],
      updatedAt: createdAt,
    },
  ];
}

function normalizeContacts(contacts, createdAt) {
  return contacts.map((contact) => ({
    kind: "agent",
    status: "active",
    agentId: "main",
    worldbookScopeIds: [],
    ...contact,
    worldbookScopeIds: Array.isArray(contact.worldbookScopeIds) && contact.worldbookScopeIds.length
      ? contact.worldbookScopeIds
      : defaultWorldbookScopeIds(contact.id),
    createdAt: contact.createdAt || createdAt,
    updatedAt: contact.updatedAt || createdAt,
  }));
}

function defaultWorldbookScopeIds(contactId) {
  if (contactId === DEFAULT_CONTACT_ID) return ["contact_aki_default"];
  if (contactId === "contact-mira") return ["contact_mira_default"];
  if (contactId === "contact-sora") return ["contact_sora_default"];
  return [];
}

function normalizeThreads(threads, messages, createdAt) {
  return threads.map((thread) => {
    const threadMessages = messagesForThread(messages, thread.id);
    const summary = normalizeThreadSummary(thread, threadMessages);
    return {
      state: "active",
      channel: "smallphone",
      windowId: defaultWindowId(thread),
      channelId: defaultChannelId(thread),
      runtime: {
        provider: ACTIVE_RUNTIME_PROVIDER,
        model: "",
        agentId: defaultAgentId(thread),
        workspaceDir: defaultWorkspaceDir(thread),
        sessionKey: defaultSessionKey(thread),
        sessionGeneration: defaultSessionGeneration(thread),
        resumeSummary: "",
      },
      ...thread,
      summary,
      runtime: {
        provider: ACTIVE_RUNTIME_PROVIDER,
        project: typeof thread.runtime?.project === "string" ? thread.runtime.project.trim() : "",
        agentType: typeof thread.runtime?.agentType === "string" ? thread.runtime.agentType.trim() : "",
        roleLevel: typeof thread.runtime?.roleLevel === "string" ? thread.runtime.roleLevel.trim() : "",
        workspaceScope: typeof thread.runtime?.workspaceScope === "string" ? thread.runtime.workspaceScope.trim() : "",
        model: thread.runtime?.model || "",
        agentId: thread.runtime?.agentId || defaultAgentId(thread),
        workspaceDir: thread.runtime?.workspaceDir || defaultWorkspaceDir(thread),
        sessionKey: thread.runtime?.sessionKey || defaultSessionKey(thread),
        sessionGeneration: defaultSessionGeneration(thread),
        resumeSummary:
          typeof thread.runtime?.resumeSummary === "string" ? thread.runtime.resumeSummary.trim() : "",
      },
      createdAt: thread.createdAt || createdAt,
      updatedAt: thread.updatedAt || createdAt,
    };
  });
}

function normalizeMessages(messages, createdAt) {
  return messages
    .filter((message) => !shouldDropLegacyMockMessage(message))
    .map((message) => {
      const normalized = {
        ...message,
        createdAt: message.createdAt || createdAt,
      };
      const attachmentIds = dedupeStrings([
        ...normalizeAttachmentIdList(message?.attachmentIds),
        ...normalizeAttachmentIdList(message?.attachments),
      ]);
      if (attachmentIds.length) {
        normalized.attachmentIds = attachmentIds;
      } else if (Array.isArray(message?.attachmentIds)) {
        normalized.attachmentIds = [];
      }
      return normalized;
    });
}

function normalizeAttachments(attachments, createdAt) {
  return attachments
    .filter((item) => item && typeof item.id === "string" && item.id.trim())
    .map((item) => ({
      ...item,
      id: String(item.id).trim(),
      threadId: typeof item.threadId === "string" ? item.threadId.trim() : "",
      messageId: typeof item.messageId === "string" ? item.messageId.trim() : "",
      role: typeof item.role === "string" ? item.role.trim().toLowerCase() : "",
      kind: typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "",
      fileName: typeof item.fileName === "string" ? item.fileName.trim() : "",
      mimeType: typeof item.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "",
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      source: typeof item.source === "string" ? item.source.trim() : "",
      localPath: sanitizeManagedAttachmentPath(item.localPath),
      url: typeof item.url === "string" ? item.url.trim() : "",
      createdAt: item.createdAt || createdAt,
    }));
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

function normalizeAttachmentIdList(input) {
  if (Array.isArray(input)) {
    return input.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function dedupeStrings(values) {
  const next = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    next.push(text);
  }
  return next;
}

function shouldDropLegacyMockMessage(message) {
  if (ACTIVE_RUNTIME_PROVIDER === "mock") {
    return false;
  }
  return (
    normalizeRole(message?.role) === "assistant" &&
    typeof message?.content === "string" &&
    message.content.startsWith("P0 runtime received:")
  );
}

function messagesForThread(messages, threadId) {
  return messages.filter((message) => message.threadId === threadId);
}

function normalizeThreadSummary(thread, messages) {
  const currentSummary = typeof thread?.summary === "string" ? thread.summary.trim() : "";
  if (currentSummary && !currentSummary.includes("P0 runtime received:")) {
    return currentSummary;
  }
  const nextSummary = summarizeMessages(messages);
  return nextSummary || currentSummary;
}

function summarizeMessages(messages) {
  return messages
    .filter((message) => normalizeRole(message?.role) !== "system")
    .slice(-4)
    .map((message) => `${normalizeRole(message.role)}: ${String(message.content || "").trim()}`)
    .filter(Boolean)
    .join(" | ")
    .slice(0, 240);
}

function normalizeRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function defaultWindowId(thread) {
  const explicit = typeof thread.windowId === "string" ? thread.windowId.trim() : "";
  if (explicit) return explicit;
  const title = typeof thread.title === "string" ? thread.title.trim().toLowerCase() : "";
  if (title) return `window-${title.replace(/[^a-z0-9]+/g, "-")}`;
  return `window-${String(thread.id || "thread").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}`;
}

function defaultChannelId(thread) {
  const explicit = typeof thread.channelId === "string" ? thread.channelId.trim() : "";
  if (explicit) return explicit;
  const title = typeof thread.title === "string" ? thread.title.trim().toLowerCase() : "";
  if (title) return `channel-${title.replace(/[^a-z0-9]+/g, "-")}`;
  return `channel-${String(thread.id || "thread").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}`;
}

function defaultSessionKey(thread) {
  const explicit =
    typeof thread.runtime?.sessionKey === "string" ? thread.runtime.sessionKey.trim() : "";
  if (explicit) return explicit;
  const threadId = String(thread.id || "").trim();
  if (threadId) return `smallphone:thread:${threadId}`;
  const channelId = defaultChannelId(thread);
  return `smallphone:channel:${channelId}`;
}

function defaultSessionGeneration(thread) {
  const explicit = Number(thread?.runtime?.sessionGeneration);
  if (Number.isFinite(explicit) && explicit >= 1) {
    return Math.floor(explicit);
  }
  const sessionKey = defaultSessionKey(thread);
  const match = sessionKey.match(/:v(\d+)$/);
  if (match) {
    return Math.max(1, Number(match[1]));
  }
  return 1;
}

function defaultAgentId(thread) {
  const explicit = typeof thread.runtime?.agentId === "string" ? thread.runtime.agentId.trim() : "";
  if (explicit) return explicit;
  return `smallphone-${defaultChannelId(thread)}`.replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

function defaultWorkspaceDir(thread) {
  const explicit =
    typeof thread.runtime?.workspaceDir === "string" ? thread.runtime.workspaceDir.trim() : "";
  if (explicit) return explicit;
  return path.join(
    "/root/projects/smallphone/smallphone-active/smallphone-app/data/channel-workspaces",
    defaultChannelId(thread),
  );
}

function normalizeWorldbookEntries(entries, createdAt) {
  return entries.map((entry) => ({
    enabled: true,
    type: "lore",
    scope: "turn",
    mode: "inject_if_matched",
    priority: 50,
    tags: [],
    triggers: {
      keywords: [],
      contactIds: [],
      threadIds: [],
      requiresTags: [],
      excludesTags: [],
    },
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    triggers: {
      keywords: Array.isArray(entry.triggers?.keywords) ? entry.triggers.keywords : [],
      contactIds: Array.isArray(entry.triggers?.contactIds) ? entry.triggers.contactIds : [],
      threadIds: Array.isArray(entry.triggers?.threadIds) ? entry.triggers.threadIds : [],
      requiresTags: Array.isArray(entry.triggers?.requiresTags)
        ? entry.triggers.requiresTags
        : [],
      excludesTags: Array.isArray(entry.triggers?.excludesTags)
        ? entry.triggers.excludesTags
        : [],
    },
    createdAt: entry.createdAt || createdAt,
    updatedAt: entry.updatedAt || createdAt,
  }));
}

function normalizeMaskDefinitions(entries, createdAt) {
  return entries.map((entry) => ({
    enabled: true,
    signals: [],
    replyGuidance: [],
    tags: [],
    ...entry,
    signals: Array.isArray(entry.signals) ? entry.signals : [],
    replyGuidance: Array.isArray(entry.replyGuidance) ? entry.replyGuidance : [],
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    createdAt: entry.createdAt || createdAt,
    updatedAt: entry.updatedAt || createdAt,
  }));
}

function normalizeRelationshipStates(entries, createdAt) {
  return entries.map((entry) => ({
    state: "neutral",
    intensity: 0.5,
    guidance: [],
    evidence: [],
    ...entry,
    guidance: Array.isArray(entry.guidance) ? entry.guidance : [],
    evidence: Array.isArray(entry.evidence) ? entry.evidence : [],
    updatedAt: entry.updatedAt || createdAt,
  }));
}

function normalizeTasks(entries, createdAt) {
  return entries.map((entry) => ({
    kind: "proactive_message",
    status: "pending",
    attempts: 0,
    createdAt,
    ...entry,
    note: typeof entry.note === "string" ? entry.note.trim() : "",
    dueAt: typeof entry.dueAt === "string" ? entry.dueAt.trim() : "",
    kind: typeof entry.kind === "string" && entry.kind.trim() ? entry.kind.trim() : "proactive_message",
    status: normalizeTaskStatus(entry.status),
    attempts: Number.isFinite(Number(entry.attempts)) ? Number(entry.attempts) : 0,
    createdAt: entry.createdAt || createdAt,
  }));
}

function normalizeTaskStatus(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["pending", "processing", "sent", "failed", "canceled", "skip", "deferred"].includes(text)) {
    return text;
  }
  return "pending";
}

function normalizeRuntimeProvider(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "mock";
}

module.exports = {
  JsonStore,
};
