import { appDefaultState } from './app-registry.js?v=21';

export const STORAGE_KEY = 'generic-mini-phone-state-v1';

export const defaultState = {
  theme: 'mist',
  phoneShell: {
    mode: 'desktop',
  },
  desktop: {
    page: 0,
  },
  apiSettings: {
    apiName: 'OpenAI / 自定义',
    apiUrl: '',
    apiKey: '',
    modelName: 'gpt-4o-mini',
    temperature: 0.8,
    maxTokens: 512,
    systemPrompt: '',
  },
  persona: {
    name: '我',
    signature: '用 SmallPhone 管理 AI、应用和日常任务。',
    bio: 'SmallPhone 用户，主要通过消息和应用入口完成安装、维护、创作和自动化。',
    avatarText: '你',
    avatarImage: '',
    avatarAttachmentId: '',
    masks: 6,
  },
  chats: {
    claude: {
      name: 'Claude Code',
      subtitle: '代码与项目维护',
      avatarClass: 'avatar-pink',
      avatarText: 'C',
      proactiveContactEnabled: false,
      unread: 0,
      summary: 'Claude Code',
      time: '',
      description: 'Claude Code',
      roleLevel: 'admin',
      agentType: 'claudecode',
      project: 'smallphone-claude',
      agentMode: 'default',
      messages: [],
    },
    opencode: {
      name: 'OpenCode',
      subtitle: '开放式 Agent 工作流',
      avatarClass: 'avatar-blue',
      avatarText: 'O',
      proactiveContactEnabled: false,
      unread: 0,
      summary: 'OpenCode',
      time: '',
      description: 'OpenCode',
      roleLevel: 'admin',
      agentType: 'opencode',
      project: 'smallphone-opencode',
      agentMode: 'suggest',
      messages: [],
    },
    codex: {
      name: 'Codex',
      subtitle: '代码、脚本与快速修复',
      avatarClass: 'avatar-gold',
      avatarText: 'X',
      proactiveContactEnabled: false,
      unread: 0,
      summary: 'Codex',
      time: '',
      description: 'Codex',
      roleLevel: 'admin',
      agentType: 'codex',
      project: 'smallphone-codex',
      agentMode: 'suggest',
      messages: [],
    },
  },
  moments: [
    {
      author: 'SmallPhone',
      mood: '默认联系人',
      text: '已准备 Claude Code、OpenCode、Codex 三个默认 Agent 入口，可以直接从消息页开始使用。',
      likes: 24,
      comments: 6,
    },
    {
      author: 'SmallPhone',
      mood: '应用控制',
      text: 'AI 聊天会逐步连接应用安装、服务管理、日志诊断和浏览器操作。',
      likes: 12,
      comments: 2,
    },
  ],
  forumPosts: [
    {
      title: '海街夜游专区',
      text: '今晚码头风大吗？有人更新夜市摊位和适合散步的路线吗？',
      replies: 26,
      favorites: 13,
      tag: '热帖',
    },
    {
      title: '角色关系研究',
      text: '如何让群聊中的角色关系推进更自然？哪些互动适合写进长期记忆？',
      replies: 9,
      favorites: 5,
      tag: '新帖',
    },
  ],
  memories: [
    { title: '默认 Agent', text: 'Claude Code、OpenCode、Codex 是默认消息联系人。', tags: ['默认', 'Agent'] },
    { title: '产品方向', text: 'SmallPhone 以应用和服务控制为核心，AI 聊天是操作入口。', tags: ['产品', 'SmallPhone'] },
    { title: '维护入口', text: '安装、修复运行栈、日志诊断和服务启停应尽量通过可见按钮或消息完成。', tags: ['维护', '服务'] },
  ],
  journals: [
    {
      title: '默认体验',
      text: '打开 SmallPhone 后，用户可以直接找 Claude Code、OpenCode 或 Codex 处理任务。',
      date: '今天',
    },
  ],
  ...appDefaultState,
};

export const panelMeta = {
  settings: { eyebrow: '设置', title: '系统设置' },
  'app-manager': { eyebrow: '应用', title: '应用与服务' },
  character: { eyebrow: '角色', title: '角色与运行设置' },
  permissions: { eyebrow: '权限', title: '运行权限' },
  imports: { eyebrow: '导入', title: '导入资料' },
  persona: { eyebrow: '我的', title: '我的资料' },
};

export const uiMeta = {
  contactCategories: [
    { key: 'all', label: '全部' },
    { key: 'unread', label: '未读' },
    { key: 'groups', label: '群聊' },
    { key: 'characters', label: '角色' },
  ],
  permissionModeLabels: {
    suggest: { title: '建议', description: '每次工具调用确认' },
    'auto-edit': { title: '自动编辑', description: '文件编辑自动通过' },
    'full-auto': { title: '全自动', description: '工作区内自动通过' },
    yolo: { title: '完全自动模式（高风险）', description: '跳过审批与沙箱' },
    default: { title: '默认', description: '每次工具调用确认' },
    acceptEdits: { title: '接受编辑', description: '自动允许文件编辑' },
    plan: { title: '计划模式', description: '只规划不执行' },
    auto: { title: '自动模式', description: '自动判断何时确认' },
    bypassPermissions: { title: '完全自动模式（高风险）', description: '全部自动通过' },
    dontAsk: { title: '静默拒绝', description: '未授权工具自动拒绝' },
  },
};

export function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const LEGACY_TOP_LEVEL_KEYS = new Set([
  // Older versions stored a global worldbook in localStorage. We no longer support it.
  'worldbook',
  // The beta shell no longer ships the old spatial desktop.
  'world',
]);

const LEGACY_CHAT_KEYS = new Set([
  // Deprecated per-chat role-card fields. We intentionally do not migrate them into cardText.
  'personality',
  'scenario',
  'systemPrompt',
  'system_prompt',
  'worldbookContent',
  'worldbook_content',
  // Legacy role-card fields commonly carried over from imports.
  'first_mes',
  'firstMes',
  'firstMessage',
  'greeting',
  'mes_example',
  'mesExample',
  'example_dialogue',
  'exampleDialogue',
  'post_history_instructions',
  'postHistoryInstructions',
  'creator_notes',
  'creatorNotes',
  'alternate_greetings',
  'alternateGreetings',
  'character_book',
  'characterBook',
  // Legacy card wrappers.
  'roleCard',
  'role_card',
  'characterCard',
  'character_card',
  // Some older states may have stored worldbook blobs at the per-chat level.
  'worldbook',
  // Some imported character-card payloads wrap the entire card under a `data` key.
  'data',
]);

function stripLegacyKeys(record, keys) {
  if (!isPlainRecord(record)) return record;
  let mutated = false;
  const next = { ...record };
  for (const key of keys) {
    if (key in next) {
      delete next[key];
      mutated = true;
    }
  }
  return mutated ? next : record;
}

function sanitizeLoadedState(incoming) {
  if (!isPlainRecord(incoming)) return {};

  const sanitized = stripLegacyKeys(incoming, LEGACY_TOP_LEVEL_KEYS);

  if (!('chats' in sanitized)) return sanitized;
  if (!isPlainRecord(sanitized.chats)) return sanitized;

  const chats = sanitized.chats;
  let changed = false;
  const nextChats = { ...chats };

  for (const [chatKey, chat] of Object.entries(chats)) {
    if (!isPlainRecord(chat)) continue;
    const cleaned = stripLegacyKeys(chat, LEGACY_CHAT_KEYS);
    if (cleaned !== chat) {
      nextChats[chatKey] = cleaned;
      changed = true;
    }
  }

  if (!changed) return sanitized;
  return { ...sanitized, chats: nextChats };
}

export function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return cloneDefaultState();
    const defaults = cloneDefaultState();
    const incoming = sanitizeLoadedState(JSON.parse(stored));
    return {
      ...defaults,
      ...incoming,
      desktop: {
        ...defaults.desktop,
        ...(incoming.desktop || {}),
      },
    };
  } catch {
    return cloneDefaultState();
  }
}

export const state = loadState();

export const uiState = {
  previousView: '',
  activeChatKey: 'claude',
  editingCharacterKey: 'claude',
  desktopTouchStartX: 0,
  desktopTouchStartY: 0,
  isGenerating: false,
  permissionSnapshot: null,
  permissionTargetChatKey: '',
  contactFilter: 'all',
  pendingAttachments: [],
};

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeLoadedState(state)));
}
