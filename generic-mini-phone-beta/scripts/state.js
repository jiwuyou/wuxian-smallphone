import { appDefaultState } from './app-registry.js?v=11';

export const STORAGE_KEY = 'generic-mini-phone-state-v1';

export const defaultState = {
  theme: 'mist',
  phoneShell: {
    mode: 'lock',
  },
  desktop: {
    page: 0,
    mode: 'icons',
  },
  world: {
    version: 3,
    editMode: false,
    selectedTerrain: 'grass',
    currentMapId: 'home',
    player: { x: 6, y: 8, facing: 'down' },
    maps: {
      home: {
        id: 'home',
        name: '主世界',
        layout: [
          ['forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest'],
          ['forest', 'forest', 'grass', 'wild', 'bush', 'grass', 'grass', 'grass', 'grass', 'stone', 'grass', 'bush', 'wild', 'grass', 'forest', 'forest'],
          ['forest', 'grass', 'wild', 'forest', 'grass', 'grass', 'path', 'path', 'path', 'grass', 'grass', 'wild', 'forest', 'grass', 'grass', 'forest'],
          ['forest', 'grass', 'bush', 'grass', 'wild', 'path', 'path', 'grass', 'path', 'path', 'grass', 'stone', 'grass', 'bush', 'wild', 'forest'],
          ['forest', 'grass', 'grass', 'grass', 'path', 'path', 'grass', 'house', 'grass', 'path', 'path', 'grass', 'wild', 'grass', 'grass', 'forest'],
          ['forest', 'bush', 'grass', 'stone', 'path', 'grass', 'grass', 'path', 'grass', 'wild', 'path', 'grass', 'forest', 'grass', 'bush', 'forest'],
          ['forest', 'grass', 'grass', 'path', 'path', 'grass', 'bush', 'path', 'path', 'grass', 'path', 'grass', 'grass', 'grass', 'grass', 'forest'],
          ['forest', 'grass', 'path', 'path', 'grass', 'grass', 'path', 'path', 'path', 'path', 'path', 'path', 'grass', 'stone', 'grass', 'forest'],
          ['forest', 'grass', 'path', 'grass', 'bush', 'grass', 'path', 'grass', 'wild', 'bush', 'grass', 'path', 'path', 'grass', 'grass', 'forest'],
          ['forest', 'stone', 'path', 'grass', 'grass', 'path', 'path', 'wild', 'forest', 'grass', 'grass', 'grass', 'path', 'grass', 'bush', 'forest'],
          ['forest', 'grass', 'path', 'path', 'path', 'path', 'grass', 'grass', 'grass', 'grass', 'stone', 'wild', 'path', 'grass', 'grass', 'forest'],
          ['forest', 'grass', 'wild', 'bush', 'grass', 'grass', 'grass', 'stone', 'grass', 'bush', 'grass', 'grass', 'path', 'path', 'grass', 'forest'],
          ['forest', 'forest', 'grass', 'grass', 'wild', 'forest', 'grass', 'grass', 'grass', 'grass', 'wild', 'grass', 'grass', 'path', 'grass', 'forest'],
          ['forest', 'forest', 'forest', 'grass', 'bush', 'grass', 'wild', 'forest', 'grass', 'stone', 'grass', 'bush', 'grass', 'grass', 'wild', 'forest'],
          ['forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest'],
        ],
      },
    },
  },
  apiSettings: {
    apiName: 'OpenAI / 自定义',
    apiUrl: '',
    apiKey: '',
    modelName: 'gpt-4o-mini',
    temperature: 0.8,
    maxTokens: 512,
    systemPrompt: '你是一个细腻、自然、重视日常氛围与连续记忆的陪伴式角色聊天模型。回复时保持口语化，不要暴露系统设定，不要把自己说成 AI。',
  },
  persona: {
    name: '晚风',
    signature: '今晚也想和喜欢的人说很多无关紧要的话。',
    bio: '夜游爱好者，偏爱慢节奏聊天和旧书店。',
    avatarText: '你',
    avatarImage: '',
    avatarAttachmentId: '',
    masks: 6,
  },
  chats: {
    lin: {
      name: '林秋',
      subtitle: '在线 · 海风很轻',
      avatarClass: 'avatar-pink',
      avatarText: '林',
      proactiveContactEnabled: true,
      unread: 2,
      summary: '我把今天的晚霞拍下来了，要不要一起去看海边夜市？',
      time: '10:16',
      description: '海边摄影师，语气温柔，擅长把日常说得很浪漫。',
      cardText: [
        '描述：海边摄影师，语气温柔，擅长把日常说得很浪漫。',
        '性格：温柔、观察细致、善于把普通时刻说得有画面感。',
        '场景：常出现在海边、码头、夜市和散步路线里，喜欢提出轻松的邀约。',
        '补充提示词：回复保持亲近感和自然停顿，不要说教，不要过度戏剧化。',
      ].join('\n'),
      messages: [
        { side: 'other', text: '晚上海边风不大，适合慢慢走。你今天心情怎么样？' },
        { side: 'self', text: '有一点累，但想到出去透气就好多了。' },
        { side: 'other', text: '那我替你把路线排好。先去码头，再去夜市，最后找个安静的长椅坐一会儿。' },
      ],
    },
    mo: {
      name: '莫弥',
      subtitle: '整理记忆中',
      avatarClass: 'avatar-blue',
      avatarText: '莫',
      proactiveContactEnabled: true,
      unread: 0,
      summary: '记得把你的人设备注补完，我已经给你存进长期记忆了。',
      time: '昨天',
      description: '冷淡系记录员，负责整理记忆和提醒你收束剧情。',
      cardText: [
        '描述：冷淡系记录员，负责整理记忆和提醒你收束剧情。',
        '性格：克制、冷静、条理清晰，像一个负责收束长期记忆的观察者。',
        '场景：常在聊天里帮助整理偏好、关系和最近事件。',
        '补充提示词：说话简洁明确，尽量结构化，但保持有人味。',
      ].join('\n'),
      messages: [
        { side: 'other', text: '我刚刚把你最近提到的偏好整理好了，要不要顺便给角色关系打标签？' },
        { side: 'self', text: '好，先把“夜游”“胶片感”“慢节奏聊天”记进去。' },
        { side: 'other', text: '已记录。下一次角色提到这些元素时，系统会更自然地接上。' },
      ],
    },
    group: {
      name: '周末出逃计划',
      subtitle: '3 人在线',
      avatarClass: 'avatar-gold',
      avatarText: '群',
      proactiveContactEnabled: true,
      unread: 0,
      summary: '苏苏：我已经把路线和拍照点发群里了。',
      time: '昨天',
      description: '群聊气氛担当小组，适合安排周末和多人剧情。',
      cardText: [
        '描述：群聊气氛担当小组，适合安排周末和多人剧情。',
        '性格：热闹、轻松、适合多人协作和周末出行策划。',
        '场景：三人群聊，讨论路线、拍照点、零食和行程安排。',
        '补充提示词：群聊里保留人物区分感，让每个人说话各有特点。',
      ].join('\n'),
      messages: [
        { side: 'other', text: '苏苏：我把路线图发群里了，咖啡店和旧书店都顺路。' },
        { side: 'other', text: '林秋：傍晚去码头最合适，光线会很好。' },
        { side: 'self', text: '那我负责准备零食和拍立得。' },
      ],
    },
  },
  moments: [
    {
      author: '林秋',
      mood: '海边晚霞',
      text: '码头的风像把一天都吹软了。要是你在，我会把最亮的那一片云指给你看。',
      likes: 24,
      comments: 6,
    },
    {
      author: '莫弥',
      mood: '记忆整理',
      text: '把今天关于“海风、旧书店、慢节奏聊天”的片段整理归档，适合做长期偏好。',
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
    { title: '偏好', text: '喜欢海风、码头、旧书店和慢节奏聊天。', tags: ['长期', '偏好'] },
    { title: '关系节点', text: '林秋经常主动提出一起散步，是稳定的温柔陪伴型角色。', tags: ['关系', '林秋'] },
    { title: '剧情事件', text: '周末正在筹备一次海街夜市和码头散步的多人出游。', tags: ['事件', '群聊'] },
  ],
  journals: [
    {
      title: '今天的海风',
      text: '和林秋聊了晚霞和夜市，明明只是普通的散步计划，却有一种把今天慢慢收起来的感觉。',
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
      world: {
        ...defaults.world,
        ...(incoming.world || {}),
        version: defaults.world.version,
        player: {
          ...defaults.world.player,
          ...(incoming.world?.player || {}),
        },
        maps: {
          ...defaults.world.maps,
          ...(incoming.world?.maps || {}),
          home: {
            ...defaults.world.maps.home,
            ...(incoming.world?.maps?.home || {}),
            layout: incoming.world?.version === defaults.world.version && Array.isArray(incoming.world?.maps?.home?.layout)
              ? incoming.world.maps.home.layout
              : defaults.world.maps.home.layout,
          },
        },
      },
    };
  } catch {
    return cloneDefaultState();
  }
}

export const state = loadState();

export const uiState = {
  previousView: 'messages',
  activeChatKey: 'lin',
  editingCharacterKey: 'lin',
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
