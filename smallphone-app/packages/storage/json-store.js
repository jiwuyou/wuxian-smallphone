const fs = require("fs");
const path = require("path");
const {
  DEFAULT_CHARACTER_ID,
  DEFAULT_CONTACT_ID,
  DEFAULT_THREAD_ID,
  nowIso,
} = require("../shared/types");
const { resolveSmallPhonePaths } = require("../shared/paths");

const ACTIVE_RUNTIME_PROVIDER = normalizeRuntimeProvider(process.env.SMALLPHONE_RUNTIME_MODE);
const DEFAULT_PATHS = resolveSmallPhonePaths();
const DEFAULT_OFFICIAL_SHELL_ID = "official";
const DEFAULT_THEME_ID = "default";
const DEFAULT_DESKTOP_LAYOUT_ID = "default";
const DEFAULT_APP_INSTANCE_ID = "instance-chat";

class JsonStore {
  constructor(filePathOrOptions, options = {}) {
    const inputOptions =
      filePathOrOptions && typeof filePathOrOptions === "object"
        ? filePathOrOptions
        : {
            ...options,
            dataFile: filePathOrOptions,
          };
    this.paths =
      inputOptions.paths ||
      resolveSmallPhonePaths({
        env: inputOptions.env,
        dataFile: inputOptions.dataFile,
        smallphoneHome: inputOptions.smallphoneHome,
        deriveHomeFromDataFile: inputOptions.deriveHomeFromDataFile,
      });
    this.filePath = path.resolve(inputOptions.dataFile || this.paths.dataFile);
    this.legacySeedFile = Object.prototype.hasOwnProperty.call(inputOptions, "legacySeedFile")
      ? String(inputOptions.legacySeedFile || "").trim()
      : String(this.paths.legacyRuntimeFile || "").trim();
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
    if (this.legacySeedFile && path.resolve(this.legacySeedFile) !== this.filePath && fs.existsSync(this.legacySeedFile)) {
      fs.copyFileSync(this.legacySeedFile, this.filePath);
      return;
    }
    const seed = createSeedData(this.paths);
    fs.writeFileSync(this.filePath, JSON.stringify(seed, null, 2));
  }

  read() {
    this.ensureSeed();
    const raw = fs.readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeState(parsed, this.paths);
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

function createSeedData(paths = DEFAULT_PATHS) {
  const createdAt = nowIso();
  const companionSeed = createDefaultCompanionSeed(createdAt, paths);
  const userContentSeed = createDefaultUserContent(createdAt);
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
    apps: userContentSeed.apps,
    appInstances: userContentSeed.appInstances,
    themes: userContentSeed.themes,
    desktopLayouts: userContentSeed.desktopLayouts,
    shells: userContentSeed.shells,
    activeShell: userContentSeed.activeShell,
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

function normalizeState(state, paths = DEFAULT_PATHS) {
  const createdAt = nowIso();
  const defaultCompanionSeed = createDefaultCompanionSeed(createdAt, paths);
  const defaultWorldbookEntries = createDefaultWorldbookEntries(createdAt);
  const defaultMaskDefinitions = createDefaultMaskDefinitions(createdAt);
  const defaultRelationshipStates = createDefaultRelationshipStates(createdAt);
  const defaultUserContent = createDefaultUserContent(createdAt);
  const messages = normalizeMessages(
    mergeById(Array.isArray(state.messages) ? state.messages : [], defaultCompanionSeed.messages),
    createdAt,
  );
  const apps = normalizeApps(
    mergeById(Array.isArray(state.apps) ? state.apps : [], defaultUserContent.apps),
    defaultUserContent.apps,
    createdAt,
  );
  const appInstances = normalizeAppInstances(
    mergeById(Array.isArray(state.appInstances) ? state.appInstances : [], defaultUserContent.appInstances),
    defaultUserContent.appInstances,
    createdAt,
  );
  const themes = normalizeThemes(
    mergeById(Array.isArray(state.themes) ? state.themes : [], defaultUserContent.themes),
    defaultUserContent.themes,
    createdAt,
  );
  const desktopLayouts = normalizeDesktopLayouts(
    mergeById(Array.isArray(state.desktopLayouts) ? state.desktopLayouts : [], defaultUserContent.desktopLayouts),
    defaultUserContent.desktopLayouts,
    createdAt,
  );
  const shells = normalizeShells(
    mergeById(Array.isArray(state.shells) ? state.shells : [], defaultUserContent.shells),
    defaultUserContent.shells,
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
      paths,
    ),
    messages,
    attachments: normalizeAttachments(Array.isArray(state.attachments) ? state.attachments : [], createdAt, paths),
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
    apps,
    appInstances,
    themes,
    desktopLayouts,
    shells,
    activeShell: normalizeActiveShell(state.activeShell, shells, defaultUserContent.activeShell),
    reminders: normalizeTasks(Array.isArray(state.reminders) ? state.reminders : [], createdAt),
    timeline: Array.isArray(state.timeline) ? state.timeline : [],
  };
}

function createDefaultCompanionSeed(createdAt, paths = DEFAULT_PATHS) {
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
          workspaceDir: path.join(paths.channelWorkspacesRoot, "channel-aki"),
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
          workspaceDir: path.join(paths.channelWorkspacesRoot, "channel-mira"),
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
          workspaceDir: path.join(paths.channelWorkspacesRoot, "channel-sora"),
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

function createDefaultUserContent(createdAt) {
  return {
    apps: [
      {
        id: "chat",
        name: "Chat",
        title: "Chat",
        source: "official",
        kind: "core",
        entry: "/apps/chat",
        icon: "message-circle",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    appInstances: [
      {
        id: DEFAULT_APP_INSTANCE_ID,
        appId: "chat",
        title: "Chat",
        source: "official",
        settings: {},
        state: {},
        createdAt,
        updatedAt: createdAt,
      },
    ],
    themes: [
      {
        id: DEFAULT_THEME_ID,
        name: "Default",
        source: "official",
        tokens: {},
        createdAt,
        updatedAt: createdAt,
      },
    ],
    desktopLayouts: [
      {
        id: DEFAULT_DESKTOP_LAYOUT_ID,
        name: "Default",
        source: "official",
        items: [
          {
            instanceId: DEFAULT_APP_INSTANCE_ID,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
          },
        ],
        createdAt,
        updatedAt: createdAt,
      },
    ],
    shells: [
      {
        id: DEFAULT_OFFICIAL_SHELL_ID,
        name: "Official Shell",
        source: "official",
        entry: "index.html",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    activeShell: DEFAULT_OFFICIAL_SHELL_ID,
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

function normalizeThreads(threads, messages, createdAt, paths = DEFAULT_PATHS) {
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
        workspaceDir: defaultWorkspaceDir(thread, paths),
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
        workspaceDir: thread.runtime?.workspaceDir || defaultWorkspaceDir(thread, paths),
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

function normalizeAttachments(attachments, createdAt, paths = DEFAULT_PATHS) {
  return attachments
    .filter((item) => item && typeof item.id === "string" && item.id.trim())
    .map((item) => ({
      ...item,
      id: String(item.id).trim(),
      threadId: typeof item.threadId === "string" ? item.threadId.trim() : "",
      messageId: typeof item.messageId === "string" ? item.messageId.trim() : "",
      role: typeof item.role === "string" ? item.role.trim().toLowerCase() : "",
      kind: typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "",
      purpose: typeof item.purpose === "string" ? item.purpose.trim().toLowerCase() : "",
      fileName: typeof item.fileName === "string" ? item.fileName.trim() : "",
      mimeType: typeof item.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "",
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      source: typeof item.source === "string" ? item.source.trim() : "",
      localPath: sanitizeManagedAttachmentPath(item.localPath, paths),
      url: typeof item.url === "string" ? item.url.trim() : "",
      createdAt: item.createdAt || createdAt,
    }));
}

function sanitizeManagedAttachmentPath(value, paths = DEFAULT_PATHS) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const resolved = path.resolve(raw);
  for (const root of attachmentReadRoots(paths)) {
    const relative = path.relative(root, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return resolved;
    }
  }
  return "";
}

function attachmentReadRoots(paths = DEFAULT_PATHS) {
  return [paths.attachmentsRoot, paths.legacyAttachmentsRoot]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .map((item) => path.resolve(item))
    .filter((item, index, all) => all.indexOf(item) === index);
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

function defaultWorkspaceDir(thread, paths = DEFAULT_PATHS) {
  const explicit =
    typeof thread.runtime?.workspaceDir === "string" ? thread.runtime.workspaceDir.trim() : "";
  if (explicit) return explicit;
  return path.join(paths.channelWorkspacesRoot, defaultChannelId(thread));
}

function normalizeApps(entries, defaults, createdAt) {
  return normalizeUserContentCollection(entries, defaults, createdAt, (entry, base) =>
    projectPublicUserContentRecord("apps", {
      id: String(entry.id || base.id || "").trim(),
      name: String(entry.name || entry.title || base.name || entry.id || "").trim(),
      title: String(entry.title || entry.name || base.title || base.name || entry.id || "").trim(),
      source: normalizeContentSource(entry.source || base.source),
      kind: String(entry.kind || base.kind || "app").trim(),
      entry: String(entry.entry || base.entry || "").trim(),
      icon: String(entry.icon || base.icon || "").trim(),
      version: String(entry.version || base.version || "").trim(),
      createdAt: entry.createdAt || base.createdAt || createdAt,
      updatedAt: entry.updatedAt || base.updatedAt || entry.createdAt || createdAt,
    }));
}

function normalizeAppInstances(entries, defaults, createdAt) {
  return normalizeUserContentCollection(entries, defaults, createdAt, (entry, base) =>
    projectPublicUserContentRecord("appInstances", {
      id: String(entry.id || base.id || "").trim(),
      appId: String(entry.appId || entry.app_id || base.appId || "").trim(),
      title: String(entry.title || entry.name || base.title || base.name || entry.id || "").trim(),
      source: normalizeContentSource(entry.source || base.source),
      settings: isPlainObject(entry.settings) ? entry.settings : isPlainObject(base.settings) ? base.settings : {},
      state: isPlainObject(entry.state) ? entry.state : isPlainObject(base.state) ? base.state : {},
      createdAt: entry.createdAt || base.createdAt || createdAt,
      updatedAt: entry.updatedAt || base.updatedAt || entry.createdAt || createdAt,
    }));
}

function normalizeThemes(entries, defaults, createdAt) {
  return normalizeUserContentCollection(entries, defaults, createdAt, (entry, base) =>
    projectPublicUserContentRecord("themes", {
      id: String(entry.id || base.id || "").trim(),
      name: String(entry.name || entry.title || base.name || entry.id || "").trim(),
      source: normalizeContentSource(entry.source || base.source),
      tokens: isPlainObject(entry.tokens) ? entry.tokens : isPlainObject(base.tokens) ? base.tokens : {},
      createdAt: entry.createdAt || base.createdAt || createdAt,
      updatedAt: entry.updatedAt || base.updatedAt || entry.createdAt || createdAt,
    }));
}

function normalizeDesktopLayouts(entries, defaults, createdAt) {
  return normalizeUserContentCollection(entries, defaults, createdAt, (entry, base) =>
    projectPublicUserContentRecord("desktopLayouts", {
      id: String(entry.id || base.id || "").trim(),
      name: String(entry.name || entry.title || base.name || entry.id || "").trim(),
      source: normalizeContentSource(entry.source || base.source),
      items: Array.isArray(entry.items) ? entry.items : Array.isArray(base.items) ? base.items : [],
      createdAt: entry.createdAt || base.createdAt || createdAt,
      updatedAt: entry.updatedAt || base.updatedAt || entry.createdAt || createdAt,
    }));
}

function normalizeShells(entries, defaults, createdAt) {
  return normalizeUserContentCollection(entries, defaults, createdAt, (entry, base) =>
    projectPublicUserContentRecord("shells", {
      id: String(entry.id || base.id || "").trim(),
      name: String(entry.name || entry.title || base.name || entry.id || "").trim(),
      source: normalizeContentSource(entry.source || base.source),
      entry: String(entry.entry || base.entry || "index.html").trim() || "index.html",
      createdAt: entry.createdAt || base.createdAt || createdAt,
      updatedAt: entry.updatedAt || base.updatedAt || entry.createdAt || createdAt,
    }));
}

function projectPublicUserContentCollection(collectionName, entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => projectPublicUserContentRecord(collectionName, entry))
    .filter((entry) => entry && entry.id);
}

function projectPublicUserContentRecord(collectionName, entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  switch (collectionName) {
    case "apps":
      return {
        id: normalizePublicString(entry.id),
        name: normalizePublicString(entry.name || entry.title || entry.id),
        title: normalizePublicString(entry.title || entry.name || entry.id),
        source: normalizePublicString(entry.source),
        kind: normalizePublicString(entry.kind),
        entry: normalizePublicString(entry.entry),
        icon: normalizePublicString(entry.icon),
        version: normalizePublicString(entry.version),
        createdAt: normalizePublicString(entry.createdAt),
        updatedAt: normalizePublicString(entry.updatedAt),
      };
    case "appInstances":
      return {
        id: normalizePublicString(entry.id),
        appId: normalizePublicString(entry.appId || entry.app_id),
        title: normalizePublicString(entry.title || entry.name || entry.id),
        source: normalizePublicString(entry.source),
        settings: sanitizePublicUserContentValue(isPlainObject(entry.settings) ? entry.settings : {}),
        state: sanitizePublicUserContentValue(isPlainObject(entry.state) ? entry.state : {}),
        createdAt: normalizePublicString(entry.createdAt),
        updatedAt: normalizePublicString(entry.updatedAt),
      };
    case "themes":
      return {
        id: normalizePublicString(entry.id),
        name: normalizePublicString(entry.name || entry.title || entry.id),
        source: normalizePublicString(entry.source),
        tokens: sanitizePublicUserContentValue(isPlainObject(entry.tokens) ? entry.tokens : {}),
        createdAt: normalizePublicString(entry.createdAt),
        updatedAt: normalizePublicString(entry.updatedAt),
      };
    case "desktopLayouts":
      return {
        id: normalizePublicString(entry.id),
        name: normalizePublicString(entry.name || entry.title || entry.id),
        source: normalizePublicString(entry.source),
        items: sanitizePublicUserContentValue(Array.isArray(entry.items) ? entry.items : []),
        createdAt: normalizePublicString(entry.createdAt),
        updatedAt: normalizePublicString(entry.updatedAt),
      };
    case "shells":
      return {
        id: normalizePublicString(entry.id),
        name: normalizePublicString(entry.name || entry.title || entry.id),
        source: normalizePublicString(entry.source),
        entry: normalizePublicString(entry.entry) || "index.html",
        createdAt: normalizePublicString(entry.createdAt),
        updatedAt: normalizePublicString(entry.updatedAt),
      };
    default:
      return null;
  }
}

function sanitizePublicUserContentValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicUserContentValue(item));
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveUserContentKey(key)) {
        continue;
      }
      output[key] = sanitizePublicUserContentValue(item);
    }
    return output;
  }
  return value;
}

function isSensitiveUserContentKey(key) {
  const normalized = String(key || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) {
    return false;
  }
  if (["token", "apikey", "secret", "password", "authorization", "credentials"].includes(normalized)) {
    return true;
  }
  return (
    normalized.endsWith("apikey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credentials") ||
    (normalized.endsWith("token") && normalized !== "tokens") ||
    normalized.startsWith("authorization")
  );
}

function normalizePublicString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeActiveShell(value, shells, fallbackId = DEFAULT_OFFICIAL_SHELL_ID) {
  const activeShell = String(value || "").trim();
  const shellList = Array.isArray(shells) ? shells : [];
  const shellIds = new Set(shellList.map((item) => item.id).filter(Boolean));
  if (activeShell && shellIds.has(activeShell)) {
    return activeShell;
  }
  return shellIds.has(fallbackId) ? fallbackId : (shellList[0]?.id || fallbackId);
}

function normalizeUserContentCollection(entries, defaults, createdAt, normalizer) {
  const defaultById = new Map((Array.isArray(defaults) ? defaults : []).map((item) => [item.id, item]));
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry.id === "string" && entry.id.trim())
    .map((entry) => {
      const id = String(entry.id).trim();
      if (seen.has(id)) {
        return null;
      }
      seen.add(id);
      return normalizer({ ...entry, id }, defaultById.get(id) || {}, createdAt);
    })
    .filter(Boolean);
}

function normalizeContentSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return source === "official" ? "official" : "user";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  DEFAULT_OFFICIAL_SHELL_ID,
  JsonStore,
  createDefaultUserContent,
  normalizeState,
  projectPublicUserContentCollection,
  projectPublicUserContentRecord,
  sanitizePublicUserContentValue,
};
