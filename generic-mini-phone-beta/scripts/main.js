import * as dom from './dom.js?v=14';
import {
  appModules,
  appSpaceTemplates,
  fetchDynamicAppRegistry,
  mergeStaticAndDynamicDesktopApps,
  registeredApps,
} from './app-registry.js?v=9';
import { cloneDefaultState, panelMeta, saveState, state, uiState } from './state.js?v=8';
import {
  buildServiceManagerDefinitions,
  createServiceFromDefinition,
  getManagedServiceTargets,
  mergeServiceManagerDefinitionWithStatus,
} from './service-manager-logic.js?v=1';
import { applyDesktopMode, bindWorld, renderWorld, renderWorldToolbar } from './world.js?v=3';

const DEFAULT_BACKEND_PORT = '3100';
const DEFAULT_BACKEND_BASE = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}/api`;
const BACKEND_STORAGE_KEY = 'smallphone.backendBase';
const AVATAR_CLASSES = ['avatar-pink', 'avatar-blue', 'avatar-gold', 'avatar-green'];
const DEFAULT_TIMEZONE = 'Etc/UTC';
const DEFAULT_WAIFU_DELAY_MS_PER_CHAR = 55;
const MIN_WAIFU_SEGMENT_DELAY_MS = 280;
const MAX_WAIFU_SEGMENT_DELAY_MS = 1400;
const WAIFU_DISPLAYED_KEY_LIMIT = 500;
const WAIFU_DISPLAYED_STORAGE_KEY = 'smallphone.waifuDisplayedMessages';
const RECENT_PERSISTED_ASSISTANT_WINDOW_MS = 60_000;
let backendEnabled = false;
let backendBase = DEFAULT_BACKEND_BASE;
let threadEventSource = null;
let threadEventSourceKey = '';
let characterCreateDraftKey = '';
let dynamicAppRegistry = { dynamicAppEntries: [] };
let dynamicRegistryStatus = {
  text: '后端未连接，使用内置 App。',
  isError: false,
  loading: false,
};
let serviceManagerSnapshot = { services: [] };
let serviceManagerStatus = {
  text: '后端未连接，服务管理不可用。',
  isError: false,
  loading: false,
};
const serviceManagerActionInflight = new Set();
let activeDynamicApp = null;
let characterRuntimeSettingsState = {
  threadId: '',
  phase: 'idle',
  available: false,
  project: '',
  reason: '',
  error: '',
  settings: null,
};
let characterRuntimeSettingsRequestId = 0;
let characterRuntimeSettingsSaving = false;
let waifuDisplayTimers = [];
const displayedWaifuMessageKeys = loadDisplayedWaifuMessageKeys();
const recentPersistedAssistantByThreadId = new Map();

const CORE_DESKTOP_APPS = [
  { id: 'messages', name: '消息', shortName: '聊', orbClass: 'orb-chat', target: 'messages', badge: 'unread' },
  { id: 'contacts', name: '联系人', shortName: '人', orbClass: 'orb-character', target: 'contacts' },
  { id: 'character', name: '角色', shortName: '角', orbClass: 'orb-world', panel: 'character' },
  { id: 'app-manager', name: 'App 管理', shortName: '管', orbClass: 'orb-app-manager', panel: 'app-manager' },
  { id: 'settings', name: '调试', shortName: '调', orbClass: 'orb-settings', panel: 'settings' },
  { id: 'permissions', name: '权限', shortName: '权', orbClass: 'orb-permission', panel: 'permissions' },
];

const CORE_DESKTOP_APP_ALIASES = [
  { backendId: 'chat', nativeId: 'messages' },
];

const DESKTOP_APPS_PER_PAGE = 8;
const SLASH_COMMANDS = [
  { command: '/help', label: '帮助' },
  { command: '/status', label: '状态' },
  { command: '/model', label: '模型' },
  { command: '/clear', label: '清空' },
  { command: '/new', label: '新会话' },
  { command: '/compact', label: '压缩' },
  { command: '/resume', label: '恢复' },
];
const slashCommandState = {
  open: false,
  activeIndex: 0,
  matches: SLASH_COMMANDS,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeApiBaseUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.endsWith('/chat/completions')) return raw;
  return `${raw.replace(/\/$/, '')}/chat/completions`;
}

function normalizeBackendBase(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const withoutSlash = raw.replace(/\/$/, '');
  if (withoutSlash.endsWith('/api')) return withoutSlash;
  if (withoutSlash.endsWith('/smallphone')) {
    return `${withoutSlash.slice(0, -'/smallphone'.length)}/api`;
  }
  return `${withoutSlash}/api`;
}

function getBackendCandidates() {
  const candidates = [];
  const params = new URLSearchParams(window.location.search);
  const queryBackend = normalizeBackendBase(params.get('backend'));
  const savedBackend = normalizeBackendBase(window.localStorage.getItem(BACKEND_STORAGE_KEY));
  const { protocol, hostname, origin, port } = window.location;

  if (queryBackend) candidates.push(queryBackend);
  if (savedBackend) candidates.push(savedBackend);

  if (protocol === 'http:' || protocol === 'https:') {
    if (port === DEFAULT_BACKEND_PORT) candidates.push(`${origin}/api`);
    if (hostname && hostname !== '127.0.0.1' && hostname !== 'localhost') {
      candidates.push(`http://${hostname}:${DEFAULT_BACKEND_PORT}/api`);
    }
    candidates.push(`http://127.0.0.1:${DEFAULT_BACKEND_PORT}/api`);
    candidates.push(`http://localhost:${DEFAULT_BACKEND_PORT}/api`);
  } else {
    candidates.push(DEFAULT_BACKEND_BASE);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function rememberBackendBase(url) {
  backendBase = url;
  window.localStorage.setItem(BACKEND_STORAGE_KEY, url);
}

function normalizeStandaloneUrl(value, fallback = 'http://127.0.0.1:4103/') {
  const raw = String(value || '').trim() || fallback;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function setStandaloneLaunch(configKey, path = '', fallback) {
  state.standaloneApps = {
    ...(state.standaloneApps || {}),
    [configKey]: {
      ...(state.standaloneApps?.[configKey] || {}),
      url: normalizeStandaloneUrl(state.standaloneApps?.[configKey]?.url, fallback),
      path,
    },
  };
  saveState();
}

function setLikeGirlLaunch(path = '') {
  setStandaloneLaunch('likeGirl', path, 'http://127.0.0.1:4103/');
}

function setLikeGirlCloneLaunch(path = '') {
  setStandaloneLaunch('likeGirlClone', path, 'http://127.0.0.1:4108/');
}

async function apiRequest(path, init = {}) {
  const response = await fetch(`${backendBase}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `请求失败：${response.status}`);
  }

  return response.json();
}

function replaceState(nextState) {
  const defaults = cloneDefaultState();
  const incoming = JSON.parse(JSON.stringify(nextState));
  const cloned = {
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
  Object.keys(state).forEach((key) => {
    delete state[key];
  });
  Object.assign(state, cloned);
  saveState();
}

function getChatEntries(source = state) {
  return Object.entries(source?.chats || {});
}

function resolvePreferredChatKey(chats, preferred = '') {
  if (preferred && chats?.[preferred]) return preferred;
  return Object.keys(chats || {})[0] || '';
}

function chooseAvatarClass(seed) {
  const text = String(seed || 'avatar');
  const hash = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_CLASSES[hash % AVATAR_CLASSES.length];
}

function formatRelativeThreadTime(iso) {
  const value = Date.parse(String(iso || ''));
  if (!Number.isFinite(value)) return '刚刚';
  const deltaMs = Date.now() - value;
  const deltaMinutes = Math.max(0, Math.floor(deltaMs / 60000));
  if (deltaMinutes < 1) return '刚刚';
  if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours} 小时前`;
  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays} 天前`;
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function cleanThreadSummary(value) {
  const raw = String(value || '').trim();
  if (!raw) return '还没有聊天内容。';
  const lastSegment = raw.split('|').map((item) => item.trim()).filter(Boolean).at(-1) || raw;
  return lastSegment.replace(/^(user|assistant|system)\s*:\s*/i, '').trim() || raw;
}

function buildChatSubtitle(contact, thread, relationshipState) {
  if (contact?.status === 'archived' || thread?.state === 'archived') return '已归档';
  if (relationshipState?.state) return relationshipState.state;
  const style = String(contact?.character?.style || '').trim();
  if (style) return style;
  return '在线';
}

function buildAvatarText(contact, character, title) {
  const avatar = String(character?.avatar || '').trim();
  if (avatar) return avatar.slice(0, 2);
  const name = String(contact?.displayName || character?.name || title || '').trim();
  return name.slice(0, 1) || '聊';
}

function resolveAvatarImageUrl(character, previousChat = null) {
  const raw = String(character?.avatarUrl || character?.avatarAttachment?.downloadUrl || previousChat?.avatarImage || '').trim();
  return attachmentDownloadUrl({ downloadUrl: raw });
}

function renderAvatar(chat, className = 'avatar') {
  const image = String(chat?.avatarImage || '').trim();
  const text = String(chat?.avatarText || chat?.name?.slice(0, 1) || '聊').slice(0, 2);
  const avatarClass = String(chat?.avatarClass || chooseAvatarClass(chat?.name || text)).trim();
  const fallback = `<span class="avatar-fallback">${escapeHtml(text)}</span>`;
  if (image) {
    return `<div class="${escapeHtml(className)} ${escapeHtml(avatarClass)} avatar-with-image"><img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.classList.remove('avatar-with-image')">${fallback}</div>`;
  }
  return `<div class="${escapeHtml(className)} ${escapeHtml(avatarClass)}">${fallback}</div>`;
}

function personaAvatarSource() {
  return {
    name: state.persona.name || '我的',
    avatarText: String(state.persona.avatarText || state.persona.name?.slice(0, 1) || '你').slice(0, 2),
    avatarClass: 'avatar-green',
    avatarImage: state.persona.avatarImage || '',
  };
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => normalizeMessageContent(item))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  if (content && typeof content === 'object') {
    return normalizeMessageContent(content.text || content.content || content.message || content.title);
  }
  return '';
}

function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function normalizeTimezone(value) {
  const raw = String(value || '').trim() || getBrowserTimezone();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function normalizeTimeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    enabled: normalizeRuntimeBoolean(source.enabled ?? source.injectCurrentTime ?? source.timeInjectionEnabled),
    timezone: normalizeTimezone(source.timezone || source.timeZone || source.tz),
  };
}

function normalizeWaifuSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const delay = Number(source.typingDelayMsPerChar ?? source.delayMsPerChar ?? source.typingDelay ?? DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
  return {
    enabled: normalizeRuntimeBoolean(source.enabled ?? source.textMode ?? source.waifuTextMode),
    removePunctuation: normalizeRuntimeBoolean(source.removePunctuation ?? source.stripPunctuation),
    typingDelayMsPerChar: Number.isFinite(delay)
      ? Math.min(160, Math.max(20, Math.round(delay)))
      : DEFAULT_WAIFU_DELAY_MS_PER_CHAR,
  };
}

function resolveChatTimeSettings(chat = null) {
  return normalizeTimeSettings(chat?.timeSettings || chat?.backend?.timeSettings || {});
}

function resolveChatWaifuSettings(chat = null) {
  return normalizeWaifuSettings(chat?.waifuTextSettings || chat?.textModeSettings || {});
}

function splitWaifuSegments(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  const matches = source.match(/[^。！？!?；;\n]+[。！？!?；;]*|[\n]+/g) || [source];
  const segments = matches
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length ? segments : [source];
}

function stripDisplayPunctuation(text) {
  return String(text || '').replace(/[。！？!?；;，,、.]+$/g, '').trim();
}

function getWaifuSegmentDelay(segment, settings) {
  const delayPerChar = Number(settings?.typingDelayMsPerChar || DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
  const computed = String(segment || '').length * delayPerChar;
  return Math.min(MAX_WAIFU_SEGMENT_DELAY_MS, Math.max(MIN_WAIFU_SEGMENT_DELAY_MS, computed));
}

function clearWaifuDisplayTimers() {
  waifuDisplayTimers.forEach((timer) => window.clearTimeout(timer));
  waifuDisplayTimers = [];
}

function loadDisplayedWaifuMessageKeys() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WAIFU_DISPLAYED_STORAGE_KEY) || '[]');
    return new Set((Array.isArray(parsed) ? parsed : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveDisplayedWaifuMessageKeys() {
  try {
    const keys = Array.from(displayedWaifuMessageKeys).slice(-WAIFU_DISPLAYED_KEY_LIMIT);
    displayedWaifuMessageKeys.clear();
    keys.forEach((key) => displayedWaifuMessageKeys.add(key));
    window.localStorage.setItem(WAIFU_DISPLAYED_STORAGE_KEY, JSON.stringify(keys));
  } catch {}
}

function buildWaifuMessageKey(chatKey, message) {
  return getWaifuMessageKeys(chatKey, message)[0] || '';
}

function getWaifuMessageKeys(chatKey, message) {
  const threadKey = String(chatKey || uiState.activeChatKey || 'chat').trim() || 'chat';
  const keys = [];
  const id = String(message?.id || '').trim();
  if (id) keys.push(`${threadKey}:id:${id}`);
  const streamId = String(message?.streamId || '').trim();
  if (streamId) keys.push(`${threadKey}:stream:${streamId}`);
  const text = String(message?.text || '').trim();
  const createdAt = String(message?.createdAt || '').trim();
  if (text && createdAt) keys.push(`${threadKey}:sig:${message?.side || 'other'}:${createdAt}:${text}`);
  return keys;
}

function hasDisplayedWaifuMessage(chatKey, message) {
  return getWaifuMessageKeys(chatKey, message).some((key) => displayedWaifuMessageKeys.has(key));
}

function hydrateWaifuDisplayState(messages, chat, chatKey) {
  const waifuEnabled = resolveChatWaifuSettings(chat).enabled;
  const previousByKey = new Map();
  (Array.isArray(chat?.messages) ? chat.messages : []).forEach((message) => {
    getWaifuMessageKeys(chatKey, message).forEach((key) => {
      if (key) previousByKey.set(key, message);
    });
  });

  const previousMessages = Array.isArray(chat?.messages) ? chat.messages : [];
  const sourceMessages = Array.isArray(messages) ? messages : [];
  return sourceMessages.map((message, index) => {
    const hydrated = { ...message };
    const key = buildWaifuMessageKey(chatKey, hydrated);
    if (key) hydrated.waifuMessageKey = key;
    let previous = getWaifuMessageKeys(chatKey, hydrated)
      .map((candidateKey) => previousByKey.get(candidateKey))
      .find(Boolean) || null;
    if (
      !previous
      && hydrated.side === 'other'
      && isLatestAssistantTextOccurrence(sourceMessages, index)
    ) {
      const previousTransientIndex = findCurrentAssistantCandidateIndex(
        { messages: previousMessages },
        hydrated.text,
        { transientOnly: true },
      );
      previous = previousTransientIndex >= 0 ? previousMessages[previousTransientIndex] : null;
    }
    const previousHasDisplayState = previous && Object.prototype.hasOwnProperty.call(previous, 'waifuDisplayPending');
    if (previousHasDisplayState) {
      hydrated.waifuDisplayPending = Boolean(previous.waifuDisplayPending);
    }
    const previousWasDisplayed = previous
      ? hasDisplayedWaifuMessage(chatKey, previous)
        || (previousHasDisplayState && previous.waifuDisplayPending === false)
      : false;
    if (previousWasDisplayed && hydrated.waifuMessageKey) {
      markWaifuMessageDisplayed(hydrated, chatKey);
      hydrated.waifuDisplayPending = false;
    } else if (hasDisplayedWaifuMessage(chatKey, hydrated)) {
      hydrated.waifuDisplayPending = false;
    } else if (
      waifuEnabled
      && hydrated.side === 'other'
      && !hydrated.streaming
      && getWaifuDisplaySegments(hydrated, chat).length > 1
      && (!previousHasDisplayState || previous.waifuDisplayPending === true)
    ) {
      hydrated.waifuDisplayPending = true;
    }
    return hydrated;
  });
}

function markWaifuMessageDisplayed(message, chatKey = uiState.activeChatKey) {
  const keys = getWaifuMessageKeys(chatKey, message);
  if (!keys.length) return;
  keys.forEach((key) => displayedWaifuMessageKeys.add(key));
  saveDisplayedWaifuMessageKeys();
}

function renderBubbleTextHtml(text) {
  const source = String(text || '');
  if (!source) return '';
  return `<div class="bubble-text">${escapeHtml(source).replaceAll('\n', '<br>')}</div>`;
}

function getWaifuDisplaySegments(message, chat) {
  const text = String(message?.text || '');
  if (!text) return [];
  const settings = resolveChatWaifuSettings(chat);
  if (message.side !== 'other' || message.streaming || !settings.enabled) return [];
  const segments = splitWaifuSegments(text);
  if (segments.length <= 1) return [];
  return segments.map((segment) => (
    settings.removePunctuation ? stripDisplayPunctuation(segment) : segment
  ));
}

function renderMessageTextHtml(message, chat) {
  const text = String(message?.text || '');
  if (!text) return '';
  const settings = resolveChatWaifuSettings(chat);
  if (message.side === 'other' && !message.streaming && settings.enabled) {
    return renderBubbleTextHtml(settings.removePunctuation ? stripDisplayPunctuation(text) : text);
  }
  return renderBubbleTextHtml(text);
}

function scheduleWaifuSegments(chat) {
  clearWaifuDisplayTimers();
  if (!chat || !resolveChatWaifuSettings(chat).enabled || !dom.chatThread) return;
  const settings = resolveChatWaifuSettings(chat);
  let maxDelay = 0;
  dom.chatThread.querySelectorAll('.chat-message-waifu-line[hidden], .bubble-message-waifu .bubble-segment[hidden]').forEach((segment) => {
    let delay = Number(segment.dataset?.waifuDelayMs);
    if (!Number.isFinite(delay) || delay < 0) {
      let previousText = '';
      let previous = segment.previousElementSibling;
      while (previous) {
        previousText = `${previous.textContent || ''}${previousText}`;
        previous = previous.previousElementSibling;
      }
      delay = getWaifuSegmentDelay(previousText || segment.textContent || '', settings);
    }
    maxDelay = Math.max(maxDelay, delay);
    const timer = window.setTimeout(() => {
      segment.hidden = false;
      dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
    }, delay);
    waifuDisplayTimers.push(timer);
  });
  if (maxDelay > 0) {
    const clearTimer = window.setTimeout(() => {
      let clearedPendingFlag = false;
      chat.messages?.forEach((message) => {
        if (message?.waifuDisplayPending) {
          message.waifuDisplayPending = false;
          markWaifuMessageDisplayed(message);
          clearedPendingFlag = true;
        }
      });
      if (clearedPendingFlag) saveState();
    }, maxDelay + 60);
    waifuDisplayTimers.push(clearTimer);
  }
}

function normalizeAttachmentList(items, fallbackKind = '') {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return {
          id: item,
          kind: fallbackKind,
          fileName: item.split('/').at(-1) || 'attachment',
          mimeType: '',
          size: 0,
          url: item,
          downloadUrl: '',
        };
      }
      const url = String(item.downloadUrl || item.url || item.href || '').trim();
      return {
        id: String(item.id || item.attachmentId || url || `att-${Math.random().toString(16).slice(2)}`).trim(),
        kind: String(item.kind || fallbackKind || '').trim(),
        fileName: String(item.fileName || item.file_name || item.name || 'attachment').trim(),
        mimeType: String(item.mimeType || item.mime_type || item.contentType || '').trim(),
        size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
        url,
        downloadUrl: String(item.downloadUrl || '').trim(),
      };
    })
    .filter(Boolean);
}

function normalizeMessageAttachments(message) {
  return [
    ...normalizeAttachmentList(message?.attachments),
    ...normalizeAttachmentList(message?.images, 'image'),
    ...normalizeAttachmentList(message?.files, 'file'),
  ];
}

function normalizeMessageActions(message) {
  const direct = Array.isArray(message?.actions) ? message.actions : [];
  const runtime = Array.isArray(message?.runtime?.actions) ? message.runtime.actions : [];
  return [...direct, ...runtime]
    .map((action) => {
      const key = String(action?.action || action?.key || action?.value || '').trim();
      if (!key) return null;
      return {
        action: key,
        label: String(action?.label || action?.text || key).trim(),
        replyCtx: String(action?.replyCtx || action?.reply_ctx || message?.runtime?.replyCtx || '').trim(),
        kind: String(action?.kind || 'button').trim(),
      };
    })
    .filter(Boolean);
}

function mapMessagesToChatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.role !== 'system')
    .map((message) => {
      const attachments = normalizeMessageAttachments(message);
      const actions = normalizeMessageActions(message);
      return {
        id: String(message.id || '').trim(),
        side: message.role === 'user' ? 'self' : 'other',
        text: normalizeMessageContent(message.content),
        createdAt: String(message.createdAt || message.created_at || '').trim(),
        attachments,
        actions,
        runtime: message.runtime || null,
      };
    })
    .filter((message) => message.text || message.attachments.length || message.actions.length);
}

function mapWorldbookEntriesToFrontendWorldbook(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    title: String(entry.name || '未命名词条').trim(),
    text: String(entry.content || '').trim(),
    tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag)).filter(Boolean) : [],
    keys: Array.isArray(entry.triggers?.keywords) ? entry.triggers.keywords.map((key) => String(key)).filter(Boolean) : [],
    enabled: entry.enabled !== false,
  }));
}

function buildReminderIndex(reminders) {
  const map = new Map();
  for (const reminder of Array.isArray(reminders) ? reminders : []) {
    const threadId = String(reminder.threadId || '').trim();
    if (!threadId) continue;
    if (!map.has(threadId)) map.set(threadId, []);
    map.get(threadId).push(reminder);
  }
  return map;
}

function findThreadScopedWorldbookEntry(entries, contactId, threadId) {
  return (Array.isArray(entries) ? entries : []).find((entry) => {
    const contactIds = Array.isArray(entry?.triggers?.contactIds) ? entry.triggers.contactIds : [];
    const threadIds = Array.isArray(entry?.triggers?.threadIds) ? entry.triggers.threadIds : [];
    return contactIds.includes(contactId) || threadIds.includes(threadId);
  }) || null;
}

function mapThreadToChat({ thread, contact, messages, reminders, worldbookEntries, previousChat }) {
  const relationshipState = thread?.relationshipState || contact?.relationshipState || null;
  const character = contact?.character || null;
  const scopedWorldbook = findThreadScopedWorldbookEntry(worldbookEntries, contact?.id, thread?.id);
  const timeSettings = normalizeTimeSettings(thread?.timeSettings || contact?.timeSettings || previousChat?.timeSettings || {});
  const waifuTextSettings = normalizeWaifuSettings(previousChat?.waifuTextSettings || {});
  const chatKey = String(thread?.id || '').trim();
  const mappedBackendMessages = Array.isArray(messages) && messages.length
    ? mapMessagesToChatMessages(messages)
    : null;
  const baseChatMessages = mappedBackendMessages
    ? hydrateWaifuDisplayState(
      mappedBackendMessages,
      previousChat ? { ...previousChat, waifuTextSettings } : { waifuTextSettings, messages: [] },
      chatKey,
    )
    : Array.isArray(previousChat?.messages)
      ? previousChat.messages
      : [];
  const chatMessages = baseChatMessages.filter((message) => !message?.pending);
  const pendingOutbox = Array.isArray(previousChat?.pendingOutbox) ? previousChat.pendingOutbox : [];
  const pendingMessages = pendingOutbox
    .map((item) => ({
      side: 'self',
      text: String(item?.text || '').trim(),
      attachments: normalizeAttachmentList(item?.attachmentMetas || []),
      actions: [],
      pending: true,
      pendingId: item?.id || '',
    }))
    .filter((message) => message.text || message.attachments.length);
  const threadSummary = cleanThreadSummary(thread?.summary);
  const latestMessageText = threadSummary || chatMessages.at(-1)?.text || (chatMessages.at(-1)?.attachments?.length ? '[附件]' : '');
  const previousDescription = String(previousChat?.description || '').trim();
  const fallbackDescription = previousDescription && previousDescription !== latestMessageText && previousDescription !== threadSummary
    ? previousDescription
    : '这个联系人正在通过 SmallPhone 后端提供回复。';

  return {
    name: String(contact?.displayName || thread?.title || character?.name || '未命名联系人').trim(),
    subtitle: buildChatSubtitle(contact, thread, relationshipState),
    avatarClass: chooseAvatarClass(thread?.id || contact?.id || character?.id),
    avatarText: buildAvatarText(contact, character, thread?.title),
    avatarImage: resolveAvatarImageUrl(character, previousChat),
    avatarAttachmentId: String(character?.avatarAttachmentId || previousChat?.avatarAttachmentId || '').trim(),
    proactiveContactEnabled: previousChat?.proactiveContactEnabled !== false,
    unread: Number(thread?.unreadCount || 0),
    summary: latestMessageText,
    time: formatRelativeThreadTime(thread?.updatedAt),
    description: String(character?.persona || fallbackDescription).trim(),
    roleLevel: normalizeRoleLevel(thread?.roleLevel || contact?.roleLevel || thread?.runtime?.roleLevel || previousChat?.roleLevel),
    agentType: normalizeAgentType(thread?.runtime?.agentType || previousChat?.agentType),
    waifuTextSettings,
    timeSettings,
    personality: String(character?.style || previousChat?.personality || '').trim(),
    scenario: String(relationshipState?.guidance?.join(' / ') || previousChat?.scenario || '').trim(),
    systemPrompt: String(scopedWorldbook?.content || previousChat?.systemPrompt || '').trim(),
    pendingOutbox,
    messages: [...chatMessages, ...pendingMessages],
    backend: {
      threadId: thread?.id || '',
      contactId: contact?.id || thread?.contactId || '',
      relationship: contact?.relationship || null,
      relationshipState: relationshipState || null,
      toolPolicy: character?.toolPolicy || null,
      permissionPolicy: character?.permissionPolicy || null,
      runtimeProject: thread?.runtime?.project || '',
      workspaceDir: thread?.runtime?.workspaceDir || '',
      workspaceScope: thread?.runtime?.workspaceScope || '',
      timeSettings,
    },
  };
}

function normalizeRoleLevel(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[-_\s]+/g, '');
  return text === 'admin' || text === 'administrator' || text === 'system' ? 'admin' : 'contact';
}

function normalizeAgentType(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[-_\s]+/g, '');
  if (text === 'codex') return 'codex';
  if (text === 'claudecode' || text === 'claude') return 'claudecode';
  return '';
}

function createLocalChatKey(name = 'contact') {
  const base = String(name || 'contact')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/[\u4e00-\u9fa5]/g, '') || 'contact';
  let key = base;
  let index = 2;
  while (state.chats[key]) {
    key = `${base}-${index}`;
    index += 1;
  }
  return key;
}

function createBlankChatDraft() {
  const key = createLocalChatKey('new-contact');
  return {
    key,
    chat: {
      name: '新联系人',
      subtitle: '刚刚创建',
      avatarClass: chooseAvatarClass(key),
      avatarText: '新',
      avatarImage: '',
      avatarAttachmentId: '',
      proactiveContactEnabled: true,
      unread: 0,
      summary: '新的 SmallPhone 独立窗口。',
      time: '刚刚',
      description: '新的私人联系人。',
      roleLevel: 'contact',
      agentType: '',
      waifuTextSettings: normalizeWaifuSettings({}),
      timeSettings: normalizeTimeSettings({ timezone: getBrowserTimezone() }),
      personality: '',
      scenario: '',
      systemPrompt: '',
      messages: [],
    },
  };
}

function mapBootstrapToFrontendState(snapshot, previousState = state) {
  const bootstrap = snapshot?.bootstrap || {};
  const threadList = Array.isArray(bootstrap.threads) ? bootstrap.threads : [];
  const contactList = Array.isArray(bootstrap.contacts) ? bootstrap.contacts : [];
  const worldbookEntries = Array.isArray(snapshot?.worldbookEntries) ? snapshot.worldbookEntries : [];
  const reminderIndex = buildReminderIndex(snapshot?.reminders || []);
  const messagesByThreadId = snapshot?.messagesByThreadId || {};
  const contactsById = new Map(contactList.map((contact) => [contact.id, contact]));
  const chats = Object.fromEntries(threadList.map((thread) => {
    const contact = contactsById.get(thread.contactId) || thread.contact || null;
    const previousChat = previousState?.chats?.[thread.id] || null;
    return [thread.id, mapThreadToChat({
      thread,
      contact,
      messages: messagesByThreadId[thread.id],
      reminders: reminderIndex.get(thread.id) || [],
      worldbookEntries,
      previousChat,
    })];
  }));

  return {
    ...previousState,
    chats,
    worldbook: mapWorldbookEntriesToFrontendWorldbook(worldbookEntries),
  };
}

async function loadBackendSnapshot(requester = apiRequest, options = {}) {
  const [bootstrap, worldbookEntries, reminders] = await Promise.all([
    requester('/bootstrap'),
    requester('/worldbook'),
    requester('/reminders'),
  ]);
  const messagesByThreadId = {};
  const preferredThreadId = String(options.messageThreadId || '').trim();
  if (preferredThreadId) {
    messagesByThreadId[preferredThreadId] = await requester(`/threads/${encodeURIComponent(preferredThreadId)}/messages`);
  }
  return {
    bootstrap,
    worldbookEntries,
    reminders,
    messagesByThreadId,
  };
}

function applyBackendSnapshot(snapshot, preferredChatKey = uiState.activeChatKey) {
  const nextState = mapBootstrapToFrontendState(snapshot, state);
  replaceState(nextState);
  const nextChatKey = resolvePreferredChatKey(nextState.chats, preferredChatKey);
  uiState.activeChatKey = nextChatKey;
  uiState.editingCharacterKey = resolvePreferredChatKey(nextState.chats, uiState.editingCharacterKey || nextChatKey) || nextChatKey;
  return nextChatKey;
}

async function bootstrapState() {
  for (const candidate of getBackendCandidates()) {
    try {
      backendBase = candidate;
      const snapshot = await loadBackendSnapshot(apiRequest);
      const bootstrap = snapshot.bootstrap || {};
      const preferredChatKey = resolvePreferredChatKey(
        Object.fromEntries((bootstrap.threads || []).map((thread) => [thread.id, thread])),
        uiState.activeChatKey,
      );
      if (preferredChatKey && !snapshot.messagesByThreadId[preferredChatKey]) {
        snapshot.messagesByThreadId[preferredChatKey] = await apiRequest(`/threads/${encodeURIComponent(preferredChatKey)}/messages`);
      }
      applyBackendSnapshot(snapshot, preferredChatKey);
      rememberBackendBase(candidate);
      backendEnabled = true;
      const runtimeID = String(bootstrap?.runtime?.id || '').trim() || 'unknown';
      setChatStatus(`后端已连接到 smallphone-app，runtime=${runtimeID}。`);
      return true;
    } catch {}
  }

  try {
    window.localStorage.removeItem(BACKEND_STORAGE_KEY);
  } catch {}

  backendBase = DEFAULT_BACKEND_BASE;
  backendEnabled = false;
  return false;
}

function disableBackendWithStatus(message) {
  backendEnabled = false;
  closeThreadEventStream();
  try {
    window.localStorage.removeItem(BACKEND_STORAGE_KEY);
  } catch {}
  if (message) {
    setChatStatus(message, true);
  }
}

async function requestBackend(path, init = {}) {
  const { preserveBackendOnError = false, ...requestInit } = init || {};
  try {
    return await apiRequest(path, requestInit);
  } catch (error) {
    if (!preserveBackendOnError) {
      disableBackendWithStatus(error instanceof Error ? `${error.message}，已回退本地模式。` : '后端请求失败，已回退本地模式。');
    }
    throw error;
  }
}

async function refreshBackendState(threadId = uiState.activeChatKey) {
  const key = String(threadId || '').trim();
  const previousMessages = key ? state.chats?.[key]?.messages : null;
  let previousAssistantIdentity = '';
  if (Array.isArray(previousMessages)) {
    for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
      const message = previousMessages[index];
      if (message?.side !== 'other') continue;
      const id = String(message?.id || '').trim();
      const createdAt = String(message?.createdAt || '').trim();
      if (id) {
        previousAssistantIdentity = `id:${id}`;
        break;
      }
      if (createdAt) {
        previousAssistantIdentity = `at:${createdAt}`;
        break;
      }
    }
  }
  const snapshot = await loadBackendSnapshot(requestBackend, { messageThreadId: key });
  const nextChatKey = applyBackendSnapshot(snapshot, key);
  const resolvedKey = state.chats?.[key] ? key : nextChatKey;
  const nextMessages = resolvedKey ? state.chats?.[resolvedKey]?.messages : null;
  if (resolvedKey && Array.isArray(nextMessages)) {
    for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
      const message = nextMessages[index];
      if (message?.side !== 'other') continue;
      const id = String(message?.id || '').trim();
      const createdAt = String(message?.createdAt || '').trim();
      const nextIdentity = id ? `id:${id}` : createdAt ? `at:${createdAt}` : '';
      if (!nextIdentity || nextIdentity === previousAssistantIdentity) break;
      rememberRecentPersistedAssistantIdentity(resolvedKey, message);
      break;
    }
  }
  return nextChatKey;
}

async function loadThreadMessages(threadId, { force = false, recordRecentAssistant = false } = {}) {
  const key = String(threadId || '').trim();
  const chat = state.chats?.[key];
  if (!backendEnabled || !chat) return [];
  if (!force && Array.isArray(chat.messages) && chat.messages.length) return chat.messages;
  const previousMessages = Array.isArray(chat.messages) ? chat.messages : [];
  let previousAssistantIdentity = '';
  if (recordRecentAssistant) {
    for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
      const message = previousMessages[index];
      if (message?.side !== 'other') continue;
      const id = String(message?.id || '').trim();
      const createdAt = String(message?.createdAt || '').trim();
      if (id) {
        previousAssistantIdentity = `id:${id}`;
        break;
      }
      if (createdAt) {
        previousAssistantIdentity = `at:${createdAt}`;
        break;
      }
    }
  }
  const messages = await requestBackend(`/threads/${encodeURIComponent(key)}/messages`);
  chat.messages = hydrateWaifuDisplayState(mapMessagesToChatMessages(messages), chat, key);
  if (chat.messages.length) {
    const last = chat.messages.at(-1);
    chat.summary = last.text || (last.attachments?.length ? '[附件]' : chat.summary);
  }
  if (recordRecentAssistant) {
    for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
      const message = chat.messages[index];
      if (message?.side !== 'other') continue;
      const id = String(message?.id || '').trim();
      const createdAt = String(message?.createdAt || '').trim();
      const nextIdentity = id ? `id:${id}` : createdAt ? `at:${createdAt}` : '';
      if (!nextIdentity || nextIdentity === previousAssistantIdentity) break;
      rememberRecentPersistedAssistantIdentity(key, message);
      break;
    }
  }
  saveState();
  return chat.messages;
}

async function syncCharacterEdits(threadId, chat) {
  const contactId = String(chat?.backend?.contactId || '').trim();
  if (!contactId) {
    saveState();
    return false;
  }
  const payload = {
    name: chat.name,
    displayName: chat.name,
    style: chat.personality || chat.subtitle || 'concise, private, mobile-native',
    persona: [chat.description, chat.scenario].filter(Boolean).join('\n\n') || chat.description || chat.name,
    worldbookContent: [chat.systemPrompt, chat.scenario, chat.description].filter(Boolean).join('\n\n') || chat.description || chat.name,
    threadSummary: chat.summary || chat.description || chat.name,
    roleLevel: normalizeRoleLevel(chat.roleLevel),
    agentType: normalizeAgentType(chat.agentType),
    agentMode: normalizeAgentPermissionMode(chat.agentMode, chat.agentType),
    avatar: String(chat.avatarText || chat.name.slice(0, 1) || '').trim(),
    avatarAttachmentId: String(chat.avatarAttachmentId || '').trim(),
    timeSettings: resolveChatTimeSettings(chat),
  };
  if (chat.backend?.relationship) payload.relationship = chat.backend.relationship;
  if (chat.backend?.relationshipState?.state) {
    payload.relationshipState = {
      state: chat.backend.relationshipState.state,
      intensity: Number(chat.backend.relationshipState.intensity ?? 0.5),
    };
  }
  if (Array.isArray(chat.backend?.toolPolicy?.allow)) {
    payload.toolPolicy = { allow: chat.backend.toolPolicy.allow };
  }
  await requestBackend(`/companions/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  await refreshBackendState(threadId);
  return true;
}

async function createBackendCompanion(chat) {
  const payload = buildCompanionPayload(chat);
  const created = await requestBackend('/companions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const threadId = String(created?.thread?.id || '').trim();
  await refreshBackendState(threadId || uiState.activeChatKey);
  return resolvePreferredChatKey(state.chats, threadId) || resolveChatKeyByBackendContactId(created?.contact?.id) || '';
}

function resolveChatKeyByBackendContactId(contactId) {
  const target = String(contactId || '').trim();
  if (!target) return '';
  return Object.entries(state.chats).find(([, chat]) => chat?.backend?.contactId === target)?.[0] || '';
}

function buildCompanionPayload(chat) {
  return {
    name: chat.name,
    displayName: chat.name,
    style: chat.personality || chat.subtitle || 'concise, private, mobile-native',
    persona: [chat.description, chat.scenario].filter(Boolean).join('\n\n') || chat.description || chat.name,
    worldbookContent: [chat.systemPrompt, chat.scenario, chat.description].filter(Boolean).join('\n\n') || chat.description || chat.name,
    threadSummary: chat.summary || chat.description || chat.name,
    roleLevel: normalizeRoleLevel(chat.roleLevel),
    agentType: normalizeAgentType(chat.agentType),
    agentMode: normalizeAgentPermissionMode(chat.agentMode, chat.agentType),
    avatar: String(chat.avatarText || chat.name.slice(0, 1) || '').trim(),
    avatarAttachmentId: String(chat.avatarAttachmentId || '').trim(),
    timeSettings: resolveChatTimeSettings(chat),
  };
}

function beginCreateContact() {
  discardUnsavedContactDraft();
  const draft = createBlankChatDraft();
  state.chats[draft.key] = draft.chat;
  characterCreateDraftKey = draft.key;
  uiState.editingCharacterKey = draft.key;
  uiState.activeChatKey = draft.key;
  openPanel('character');
  renderCharacterEditor();
  renderCharacterHighlight();
  renderMessages();
  renderContacts();
}

function discardUnsavedContactDraft() {
  if (!characterCreateDraftKey) return;
  const draft = state.chats[characterCreateDraftKey];
  if (draft && !draft.backend?.contactId) {
    delete state.chats[characterCreateDraftKey];
  }
  characterCreateDraftKey = '';
}

async function syncWorldbookEntry(entry) {
  const result = await requestBackend('/worldbook', {
    method: 'POST',
    body: JSON.stringify({
      name: entry.title,
      content: entry.text,
      enabled: entry.enabled !== false,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      triggers: {
        keywords: Array.isArray(entry.keys) ? entry.keys : [],
        contactIds: [],
        threadIds: [],
        requiresTags: [],
        excludesTags: [],
      },
      scope: 'global',
      type: 'lore',
      mode: 'always_on',
      priority: 50,
    }),
  });
  state.worldbook = mapWorldbookEntriesToFrontendWorldbook(result);
  saveState();
}

async function loadActivePermissions({ force = false } = {}) {
  const targetKey = resolvePermissionTargetChatKey();
  const chat = getPermissionTargetChat();
  const threadId = String(chat?.backend?.threadId || targetKey || '').trim();
  if (!backendEnabled || !threadId) {
    uiState.permissionSnapshot = null;
    return null;
  }
  if (!force && uiState.permissionSnapshot?.threadId === threadId) {
    return uiState.permissionSnapshot;
  }
  const snapshot = await requestBackend(`/threads/${encodeURIComponent(threadId)}/permissions`);
  uiState.permissionSnapshot = { ...snapshot, threadId };
  return uiState.permissionSnapshot;
}

async function saveActivePermissionMode(agentMode) {
  const targetKey = resolvePermissionTargetChatKey();
  const chat = getPermissionTargetChat();
  const threadId = String(chat?.backend?.threadId || targetKey || '').trim();
  if (!backendEnabled || !threadId || !agentMode) return;
  const snapshot = await requestBackend(`/threads/${encodeURIComponent(threadId)}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ agentMode, rules: uiState.permissionSnapshot?.rules || {} }),
  });
  uiState.permissionSnapshot = { ...snapshot, threadId };
  if (chat) chat.agentMode = snapshot.agentMode || agentMode;
  await refreshBackendState(threadId);
  renderAll();
}

function getAgentModeOptions(agentType) {
  if (normalizeAgentType(agentType) === 'claudecode') {
    return [
      { key: 'default', label: '默认 · 每次工具调用确认' },
      { key: 'acceptEdits', label: '接受编辑 · 自动允许文件编辑' },
      { key: 'plan', label: '计划模式 · 只规划不执行' },
      { key: 'auto', label: '自动模式 · Claude 判断何时确认' },
      { key: 'bypassPermissions', label: 'YOLO · 全部自动通过' },
      { key: 'dontAsk', label: '静默拒绝 · 未授权工具自动拒绝' },
    ];
  }
  return [
    { key: 'suggest', label: '建议 · 每次工具调用确认' },
    { key: 'auto-edit', label: '自动编辑 · 文件编辑自动通过' },
    { key: 'full-auto', label: '全自动 · 工作区沙箱内自动通过' },
    { key: 'yolo', label: 'YOLO · 跳过审批和沙箱' },
  ];
}

function normalizeRuntimeModeOptions(modes) {
  if (!Array.isArray(modes) || !modes.length) return null;
  return modes
    .map((mode) => {
      const key = String(mode?.key || '').trim();
      if (!key) return null;
      const name = mode.nameZh || mode.name || key;
      const description = mode.descriptionZh || mode.description || mode.descZh || mode.desc || '';
      return { key, label: description ? `${name} · ${description}` : name };
    })
    .filter(Boolean);
}

function normalizeAgentPermissionMode(value, agentType) {
  const modes = getAgentModeOptions(agentType);
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[\s_]+/g, '-');
  const aliases = {
    autoedit: 'auto-edit',
    fullauto: 'full-auto',
    bypasspermissions: 'bypassPermissions',
    bypass: 'bypassPermissions',
    yolo: normalizeAgentType(agentType) === 'claudecode' ? 'bypassPermissions' : 'yolo',
  };
  const candidate = aliases[normalized.replaceAll('-', '')] || aliases[normalized] || raw;
  const found = modes.find((mode) => mode.key === candidate || mode.key.toLowerCase() === normalized);
  return found?.key || modes[0]?.key || '';
}

function normalizeRuntimeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return false;
}

function parseRuntimeCommandList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return list
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeRuntimeProjectSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const mode = String(source.mode || source.agentMode || '').trim();
  return {
    mode,
    agentMode: String(source.agentMode || mode).trim(),
    workDir: String(source.workDir || '').trim(),
    showContextIndicator: source.showContextIndicator === undefined ? true : normalizeRuntimeBoolean(source.showContextIndicator),
    replyFooter: source.replyFooter === undefined ? true : normalizeRuntimeBoolean(source.replyFooter),
    adminFrom: String(source.adminFrom ?? '').trim(),
    disabledCommands: parseRuntimeCommandList(source.disabledCommands),
  };
}

function getCharacterRuntimeThreadId(chat = null, key = uiState.editingCharacterKey) {
  const source = chat || state.chats[key] || null;
  const threadId = String(source?.backend?.threadId || '').trim();
  if (threadId) return threadId;
  const contactId = String(source?.backend?.contactId || '').trim();
  return backendEnabled && contactId ? String(key || '').trim() : '';
}

function setCharacterRuntimeSettingsState(nextState) {
  characterRuntimeSettingsState = {
    threadId: '',
    phase: 'idle',
    available: false,
    project: '',
    reason: '',
    error: '',
    settings: null,
    ...nextState,
  };
}

function getLoadedCharacterRuntimeSettings(threadId = '') {
  const targetThreadId = String(threadId || '').trim();
  if (!targetThreadId || characterRuntimeSettingsState.threadId !== targetThreadId) return null;
  if (!characterRuntimeSettingsState.available || !characterRuntimeSettingsState.settings) return null;
  return characterRuntimeSettingsState.settings;
}

function getCharacterRuntimeControls() {
  return [
    dom.characterRuntimeReplyFooterToggle,
    dom.characterRuntimeContextIndicatorToggle,
    dom.characterRuntimeWorkDirInput,
    dom.characterRuntimeDisabledCommandsInput,
    dom.characterRuntimeAdminFromInput,
  ].filter(Boolean);
}

function setRuntimeInputValue(input, value) {
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function syncCharacterAgentModeFromRuntimeSettings(settings, chat = null) {
  const mode = String(settings?.mode || settings?.agentMode || '').trim();
  if (!mode || !dom.characterAgentModeSelect) return;
  const agentType = dom.characterAgentTypeSelect?.value || chat?.agentType || '';
  const selectedMode = normalizeAgentPermissionMode(mode, agentType);
  const hasOption = Array.from(dom.characterAgentModeSelect.options || [])
    .some((option) => option.value === selectedMode);
  if (hasOption) {
    dom.characterAgentModeSelect.value = selectedMode;
  }
}

function renderCharacterRuntimeSettings({ preserveControlValues = false } = {}) {
  if (!dom.characterRuntimeStatus) return;
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  const isCreating = characterCreateDraftKey === uiState.editingCharacterKey;
  const threadId = getCharacterRuntimeThreadId(chat);
  const runtimeState = characterRuntimeSettingsState.threadId === threadId ? characterRuntimeSettingsState : null;
  const settings = runtimeState?.settings || null;
  const project = String(runtimeState?.project || chat?.backend?.runtimeProject || '').trim();
  let phase = runtimeState?.phase || 'idle';
  let statusText = '未加载';

  if (isCreating) {
    phase = 'creating';
    statusText = '创建后可用';
  } else if (!backendEnabled) {
    phase = 'unavailable';
    statusText = '后端未连接';
  } else if (!threadId) {
    phase = 'unavailable';
    statusText = '缺少 thread';
  } else if (phase === 'loading') {
    statusText = project ? `加载中 · ${project}` : '加载中';
  } else if (phase === 'available' && settings) {
    statusText = project ? `已加载 · ${project}` : '已加载';
  } else if (phase === 'error') {
    statusText = runtimeState?.error ? `错误 · ${runtimeState.error}` : '读取失败';
  } else if (phase === 'unavailable') {
    statusText = runtimeState?.reason || 'Runtime 项目不可用';
  }

  dom.characterRuntimeStatus.textContent = statusText;
  dom.characterRuntimeStatus.classList.toggle('runtime-status-ready', phase === 'available');
  dom.characterRuntimeStatus.classList.toggle('runtime-status-loading', phase === 'loading' || characterRuntimeSettingsSaving);
  dom.characterRuntimeStatus.classList.toggle('runtime-status-error', phase === 'error');
  dom.characterRuntimeStatus.classList.toggle('runtime-status-unavailable', phase === 'unavailable' || phase === 'creating');

  if (!preserveControlValues) {
    if (dom.characterRuntimeReplyFooterToggle) {
      dom.characterRuntimeReplyFooterToggle.checked = Boolean(settings?.replyFooter);
    }
    if (dom.characterRuntimeContextIndicatorToggle) {
      dom.characterRuntimeContextIndicatorToggle.checked = Boolean(settings?.showContextIndicator);
    }
    setRuntimeInputValue(dom.characterRuntimeWorkDirInput, settings?.workDir || chat?.backend?.workspaceDir || '');
    setRuntimeInputValue(dom.characterRuntimeDisabledCommandsInput, settings?.disabledCommands?.join(', ') || '');
    setRuntimeInputValue(dom.characterRuntimeAdminFromInput, settings?.adminFrom || '');
  }

  const runtimeControlsDisabled = characterRuntimeSettingsSaving
    || isCreating
    || phase === 'loading'
    || phase !== 'available'
    || !settings;
  getCharacterRuntimeControls().forEach((control) => {
    control.disabled = runtimeControlsDisabled;
  });
  if (dom.characterAgentModeSelect) {
    dom.characterAgentModeSelect.disabled = characterRuntimeSettingsSaving || isCreating || phase === 'loading';
  }
}

async function loadCharacterRuntimeSettingsForCurrent({ force = false } = {}) {
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  const isCreating = characterCreateDraftKey === uiState.editingCharacterKey;
  const threadId = getCharacterRuntimeThreadId(chat);
  const requestId = characterRuntimeSettingsRequestId + 1;

  if (isCreating) {
    characterRuntimeSettingsRequestId = requestId;
    setCharacterRuntimeSettingsState({
      threadId: '',
      phase: 'creating',
      reason: '创建联系人后可编辑 9840 Runtime。',
    });
    renderCharacterRuntimeSettings();
    return characterRuntimeSettingsState;
  }

  if (!backendEnabled || !threadId) {
    characterRuntimeSettingsRequestId = requestId;
    setCharacterRuntimeSettingsState({
      threadId,
      phase: 'unavailable',
      reason: backendEnabled ? '当前联系人缺少后端 thread。' : '后端未连接，无法读取 9840 Runtime。',
    });
    renderCharacterRuntimeSettings();
    return characterRuntimeSettingsState;
  }

  if (!force
    && characterRuntimeSettingsState.threadId === threadId
    && ['available', 'unavailable', 'error'].includes(characterRuntimeSettingsState.phase)) {
    renderCharacterRuntimeSettings();
    return characterRuntimeSettingsState;
  }

  characterRuntimeSettingsRequestId = requestId;
  const previousSettings = characterRuntimeSettingsState.threadId === threadId
    ? characterRuntimeSettingsState.settings
    : null;
  setCharacterRuntimeSettingsState({
    threadId,
    phase: 'loading',
    project: chat?.backend?.runtimeProject || '',
    settings: previousSettings,
  });
  renderCharacterRuntimeSettings();

  try {
    const result = await requestBackend(`/threads/${encodeURIComponent(threadId)}/runtime-project-settings`, {
      preserveBackendOnError: true,
    });
    if (characterRuntimeSettingsRequestId !== requestId) return null;

    if (result?.available && result?.settings) {
      const settings = normalizeRuntimeProjectSettings(result.settings);
      setCharacterRuntimeSettingsState({
        threadId,
        phase: 'available',
        available: true,
        project: String(result.project || chat?.backend?.runtimeProject || '').trim(),
        settings,
      });
      const currentChat = state.chats[uiState.editingCharacterKey] || chat;
      if (currentChat) {
        currentChat.agentMode = settings.agentMode || settings.mode || currentChat.agentMode;
      }
      syncCharacterAgentModeFromRuntimeSettings(settings, currentChat);
      renderCharacterRuntimeSettings();
      return characterRuntimeSettingsState;
    }

    setCharacterRuntimeSettingsState({
      threadId,
      phase: 'unavailable',
      project: String(result?.project || chat?.backend?.runtimeProject || '').trim(),
      reason: String(result?.reason || '9840 Runtime 项目不可用。').trim(),
      settings: null,
    });
    renderCharacterRuntimeSettings();
    return characterRuntimeSettingsState;
  } catch (error) {
    if (characterRuntimeSettingsRequestId !== requestId) return null;
    setCharacterRuntimeSettingsState({
      threadId,
      phase: 'error',
      project: chat?.backend?.runtimeProject || '',
      error: error instanceof Error ? error.message : String(error),
      settings: previousSettings,
    });
    renderCharacterRuntimeSettings();
    return characterRuntimeSettingsState;
  }
}

function buildCharacterRuntimeSettingsPayload(chat = null) {
  const threadId = getCharacterRuntimeThreadId(chat);
  const settings = getLoadedCharacterRuntimeSettings(threadId);
  const mode = String(dom.characterAgentModeSelect?.value || chat?.agentMode || '').trim();
  return {
    mode,
    workDir: dom.characterRuntimeWorkDirInput?.value.trim() || '',
    showContextIndicator: Boolean(dom.characterRuntimeContextIndicatorToggle?.checked),
    replyFooter: Boolean(dom.characterRuntimeReplyFooterToggle?.checked),
    adminFrom: dom.characterRuntimeAdminFromInput?.value.trim() || '',
    disabledCommands: parseRuntimeCommandList(dom.characterRuntimeDisabledCommandsInput?.value || ''),
  };
}

async function saveCharacterRuntimeSettingsIfAvailable(threadId, chat = null) {
  const targetThreadId = String(threadId || '').trim();
  if (!backendEnabled || !targetThreadId) return false;
  if (characterRuntimeSettingsState.threadId !== targetThreadId || !characterRuntimeSettingsState.available) {
    return false;
  }

  const payload = buildCharacterRuntimeSettingsPayload(chat);
  let preserveControlValues = true;
  characterRuntimeSettingsSaving = true;
  renderCharacterRuntimeSettings({ preserveControlValues: true });
  try {
    const result = await requestBackend(`/threads/${encodeURIComponent(targetThreadId)}/runtime-project-settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      preserveBackendOnError: true,
    });
    if (result?.available && result?.settings) {
      const settings = normalizeRuntimeProjectSettings(result.settings);
      preserveControlValues = false;
      setCharacterRuntimeSettingsState({
        threadId: targetThreadId,
        phase: 'available',
        available: true,
        project: String(result.project || characterRuntimeSettingsState.project || '').trim(),
        settings,
      });
      if (chat) chat.agentMode = settings.agentMode || settings.mode || chat.agentMode;
      syncCharacterAgentModeFromRuntimeSettings(settings, chat);
      return true;
    }

    preserveControlValues = false;
    setCharacterRuntimeSettingsState({
      threadId: targetThreadId,
      phase: 'unavailable',
      project: String(result?.project || characterRuntimeSettingsState.project || '').trim(),
      reason: String(result?.reason || '9840 Runtime 项目不可用。').trim(),
      settings: null,
    });
    return false;
  } catch (error) {
    setCharacterRuntimeSettingsState({
      threadId: targetThreadId,
      phase: 'error',
      project: characterRuntimeSettingsState.project || '',
      error: error instanceof Error ? error.message : String(error),
      settings: characterRuntimeSettingsState.settings,
    });
    throw error;
  } finally {
    characterRuntimeSettingsSaving = false;
    renderCharacterRuntimeSettings({ preserveControlValues });
  }
}

function renderAgentModeSelect(selectedMode = '', agentType = '', runtimeModes = null) {
  if (!dom.characterAgentModeSelect) return;
  const modes = normalizeRuntimeModeOptions(runtimeModes) || getAgentModeOptions(agentType);
  const selected = selectedMode || modes[0]?.key || '';
  dom.characterAgentModeSelect.innerHTML = modes
    .map((mode) => `<option value="${escapeHtml(mode.key)}" ${mode.key === selected ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`)
    .join('');
}

function renderCharacterAvatarPreview(chat = null) {
  if (!dom.characterAvatarPreview) return;
  const source = chat || state.chats[uiState.editingCharacterKey] || getFallbackChat();
  dom.characterAvatarPreview.innerHTML = renderAvatar(source, 'avatar large-avatar');
}

async function uploadCharacterAvatar(file) {
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  if (!chat || !file) return;
  if (!backendEnabled) {
    throw new Error('头像上传需要连接 smallphone-app 后端。');
  }
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('请选择图片文件。');
  }
  const data = await fileToBase64(file);
  const created = await requestBackend('/avatars', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name || 'avatar',
      mimeType: file.type || 'image/png',
      data,
    }),
  });
  chat.avatarAttachmentId = String(created.id || '').trim();
  chat.avatarImage = attachmentDownloadUrl(created);
  if (dom.characterAvatarTextInput) {
    chat.avatarText = dom.characterAvatarTextInput.value.trim().slice(0, 2) || chat.avatarText || chat.name.slice(0, 1);
  }
  saveState();
  renderCharacterAvatarPreview(chat);
  renderMessages();
  renderContacts();
  renderCharacterHighlight();
  renderChat();
  setChatStatus('头像已上传，保存角色后会同步到后端。');
}

function removeCharacterAvatarImage() {
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  if (!chat) return;
  chat.avatarAttachmentId = '';
  chat.avatarImage = '';
  saveState();
  renderCharacterAvatarPreview(chat);
  renderMessages();
  renderContacts();
  renderCharacterHighlight();
  renderChat();
}

function renderMyProfile() {
  if (dom.myAvatarPreview) dom.myAvatarPreview.innerHTML = renderAvatar(personaAvatarSource(), 'avatar large-avatar my-avatar');
  if (dom.myPreviewName) dom.myPreviewName.textContent = state.persona.name;
  if (dom.myPreviewSignature) dom.myPreviewSignature.textContent = state.persona.signature;
  if (dom.myAvatarTextInput) dom.myAvatarTextInput.value = String(state.persona.avatarText || state.persona.name.slice(0, 1) || '你').slice(0, 2);
  if (dom.myNameInput) dom.myNameInput.value = state.persona.name;
  if (dom.mySignatureInput) dom.mySignatureInput.value = state.persona.signature;
  if (dom.myBioInput) dom.myBioInput.value = state.persona.bio;
}

async function uploadMyAvatar(file) {
  if (!file) return;
  if (!backendEnabled) {
    throw new Error('头像上传需要连接 smallphone-app 后端。');
  }
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('请选择图片文件。');
  }
  const data = await fileToBase64(file);
  const created = await requestBackend('/avatars', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name || 'avatar',
      mimeType: file.type || 'image/png',
      data,
    }),
  });
  state.persona.avatarAttachmentId = String(created.id || '').trim();
  state.persona.avatarImage = attachmentDownloadUrl(created);
  state.persona.avatarText = dom.myAvatarTextInput?.value.trim().slice(0, 2) || state.persona.avatarText || state.persona.name.slice(0, 1) || '你';
  saveState();
  renderProfile();
  renderContacts();
  setChatStatus('个人头像已上传。');
}

function removeMyAvatarImage() {
  state.persona.avatarAttachmentId = '';
  state.persona.avatarImage = '';
  saveState();
  renderProfile();
  renderContacts();
}

function queueStateSync(statusMessage = '') {
  saveState();
  if (statusMessage) {
    setChatStatus(statusMessage);
  }
}

async function fetchPromptPreviewFromBackend(userInput = '') {
  if (!backendEnabled) return null;
  const chat = getActiveChat();
  const threadId = String(chat?.backend?.threadId || uiState.activeChatKey || '').trim();
  if (!threadId) return null;
  const payload = await requestBackend(`/threads/${encodeURIComponent(threadId)}/context-preview`, {
    method: 'POST',
    body: JSON.stringify({ text: userInput || '请预览当前上下文' }),
  });
  if (!dom.promptPreview) return payload;
  const recentMessages = Array.isArray(chat?.messages)
    ? chat.messages.slice(-6).map((message) => `${message.side === 'self' ? 'user' : 'assistant'}: ${message.text}`).join('\n')
    : '';
  dom.promptPreview.textContent = [
    '[Context Preview]',
    payload?.activeMask ? `Mask: ${payload.activeMask.id} (${Number(payload.activeMask.confidence || 0).toFixed(2)})` : 'Mask: none',
    payload?.relationshipState ? `Relationship: ${payload.relationshipState.id} (${Number(payload.relationshipState.intensity || 0).toFixed(2)})` : 'Relationship: none',
    '',
    '[Matched Worldbook]',
    Array.isArray(payload?.matchedWorldbookEntries)
      ? payload.matchedWorldbookEntries.map((entry) => `- ${entry.name}: ${entry.content}`).join('\n')
      : '',
    '',
    '[Reply Guidance]',
    Array.isArray(payload?.replyGuidance) ? payload.replyGuidance.map((item) => `- ${item}`).join('\n') : '',
    '',
    '[Recent Messages]',
    recentMessages,
  ].join('\n');
  return payload;
}

function getActiveChat() {
  const preferredKey = resolvePreferredChatKey(state.chats, uiState.activeChatKey);
  if (preferredKey && preferredKey !== uiState.activeChatKey) {
    uiState.activeChatKey = preferredKey;
  }
  return preferredKey ? state.chats[preferredKey] : null;
}

function resolvePermissionTargetChatKey() {
  const preferred = uiState.permissionTargetChatKey || uiState.activeChatKey;
  const key = resolvePreferredChatKey(state.chats, preferred);
  uiState.permissionTargetChatKey = key;
  return key;
}

function getPermissionTargetChat() {
  const key = resolvePermissionTargetChatKey();
  return key ? state.chats[key] : null;
}

function getFallbackChat() {
  return getActiveChat() || getChatEntries()[0]?.[1] || null;
}

function closeThreadEventStream() {
  if (threadEventSource) {
    threadEventSource.close();
    threadEventSource = null;
  }
  threadEventSourceKey = '';
}

function getThreadEventsUrl(threadId) {
  return `${backendBase}/threads/${encodeURIComponent(threadId)}/events`;
}

function subscribeThreadEvents(threadId) {
  const key = String(threadId || '').trim();
  if (!backendEnabled || !key || typeof EventSource === 'undefined') return;
  if (threadEventSource && threadEventSourceKey === key) return;
  closeThreadEventStream();
  threadEventSourceKey = key;
  threadEventSource = new EventSource(getThreadEventsUrl(key));
  threadEventSource.onmessage = (event) => {
    try {
      handleThreadStreamEvent(JSON.parse(event.data));
    } catch {}
  };
  threadEventSource.onerror = () => {
    setChatStatus('实时转发连接暂时不可用；完成后仍会刷新最终回复。', true);
  };
}

function getStreamingMessageIndex(chat) {
  if (!chat) return -1;
  return chat.messages.findIndex((message) => message.streaming === true);
}

function messageHasDisplayableContent(message) {
  return Boolean(
    String(message?.text || '').trim()
    || (Array.isArray(message?.attachments) && message.attachments.length)
    || (Array.isArray(message?.actions) && message.actions.length)
  );
}

function getLatestDisplayableMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageHasDisplayableContent(messages[index])) return index;
  }
  return -1;
}

function assistantCandidateTextMatches(message, text, { allowPrefix = false } = {}) {
  const candidateText = String(message?.text || '').trim();
  const incomingText = String(text || '').trim();
  if (!candidateText || !incomingText) return false;
  if (candidateText === incomingText) return true;
  return Boolean(
    allowPrefix
    && message?.streaming === true
    && (incomingText.startsWith(candidateText) || candidateText.startsWith(incomingText))
  );
}

function rememberRecentPersistedAssistantIdentity(threadId, message) {
  const key = String(threadId || '').trim();
  if (!key) return;
  const id = String(message?.id || '').trim();
  const createdAt = String(message?.createdAt || '').trim();
  if (!id && !createdAt) return;
  recentPersistedAssistantByThreadId.set(key, { id, createdAt, rememberedAtMs: Date.now() });
}

function findRecentPersistedAssistantCandidateIndex(chat, threadId, text) {
  const key = String(threadId || '').trim();
  if (!key) return -1;
  const hint = recentPersistedAssistantByThreadId.get(key);
  if (!hint) return -1;
  const rememberedAtMs = Number(hint.rememberedAtMs);
  if (!Number.isFinite(rememberedAtMs) || Date.now() - rememberedAtMs > RECENT_PERSISTED_ASSISTANT_WINDOW_MS) {
    recentPersistedAssistantByThreadId.delete(key);
    return -1;
  }
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  let index = -1;
  const hintedId = String(hint.id || '').trim();
  if (hintedId) {
    index = messages.findIndex((message) => message?.side === 'other' && String(message?.id || '').trim() === hintedId);
  }
  const hintedCreatedAt = String(hint.createdAt || '').trim();
  if (index < 0 && hintedCreatedAt) {
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
      const message = messages[cursor];
      if (message?.side !== 'other') continue;
      if (String(message?.createdAt || '').trim() !== hintedCreatedAt) continue;
      index = cursor;
      break;
    }
  }
  if (index < 0) return -1;
  if (index !== getLatestDisplayableMessageIndex(messages)) return -1;
  const candidate = messages[index];
  if (String(candidate?.text || '').trim() !== String(text || '').trim()) return -1;
  recentPersistedAssistantByThreadId.delete(key);
  return index;
}

function isCurrentAssistantCandidate(chat, index, text, options = {}) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const message = messages[index];
  if (!message || message.side !== 'other') return false;
  if (!assistantCandidateTextMatches(message, text, options)) return false;
  const hasTransientIdentity = !message.id && Boolean(message.streaming === true || String(message.streamId || '').trim());
  if (!hasTransientIdentity) return false;
  if (message.streaming === true) return true;
  return index === getLatestDisplayableMessageIndex(messages);
}

function findCurrentAssistantCandidateIndex(chat, text, options = {}) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isCurrentAssistantCandidate(chat, index, text, options)) return index;
  }
  return -1;
}

function isLatestAssistantTextOccurrence(messages, index) {
  const source = Array.isArray(messages) ? messages : [];
  const message = source[index];
  const text = String(message?.text || '').trim();
  if (!message || message.side !== 'other' || !text) return false;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const next = source[cursor];
    if (next?.side === 'other' && String(next.text || '').trim() === text) {
      return false;
    }
  }
  return true;
}

function upsertHydratedChatMessage(threadId, rawMessage) {
  const key = String(threadId || rawMessage?.threadId || '').trim();
  if (!key || !state.chats?.[key]) return;
  const mapped = mapMessagesToChatMessages([rawMessage])[0];
  if (!mapped) return;
  const chat = state.chats[key];
  const [hydratedMapped] = hydrateWaifuDisplayState([mapped], chat, key);
  const existingIndex = mapped.id
    ? chat.messages.findIndex((message) => message.id && message.id === mapped.id)
    : -1;
  const existingMessage = existingIndex >= 0 ? chat.messages[existingIndex] : null;
  const transientIndex = existingIndex < 0 && hydratedMapped.side === 'other'
    ? findCurrentAssistantCandidateIndex(chat, hydratedMapped.text, {
      transientOnly: true,
      allowPrefix: true,
    })
    : -1;
  const transientMessage = transientIndex >= 0 ? chat.messages[transientIndex] : null;
  const previousMessage = existingMessage || transientMessage;
  const previousHasDisplayState = previousMessage
    ? Object.prototype.hasOwnProperty.call(previousMessage, 'waifuDisplayPending')
    : false;
  const previousWasDisplayed = previousMessage
    ? hasDisplayedWaifuMessage(key, previousMessage)
      || (previousHasDisplayState && previousMessage.waifuDisplayPending === false)
    : false;
  if (
    hydratedMapped.side === 'other'
    && !hydratedMapped.streaming
    && hydratedMapped.waifuMessageKey
    && previousWasDisplayed
  ) {
    markWaifuMessageDisplayed(hydratedMapped, key);
    hydratedMapped.waifuDisplayPending = false;
  }
  if (
    hydratedMapped.side === 'other'
    && !hydratedMapped.streaming
    && resolveChatWaifuSettings(chat).enabled
    && !hasDisplayedWaifuMessage(key, hydratedMapped)
    && (!previousHasDisplayState || previousMessage?.streaming || previousMessage.waifuDisplayPending === true)
  ) {
    hydratedMapped.waifuDisplayPending = true;
  }
  if (existingIndex >= 0) {
    chat.messages[existingIndex] = hydratedMapped;
  } else {
    const pendingIndex = hydratedMapped.side === 'self'
      ? chat.messages.findIndex((message) => message.pending && message.text === hydratedMapped.text)
      : -1;
    const replaceIndex = pendingIndex >= 0
      ? pendingIndex
      : transientIndex >= 0
        ? transientIndex
        : -1;
    if (replaceIndex >= 0) {
      chat.messages[replaceIndex] = hydratedMapped;
    } else {
      chat.messages.push(hydratedMapped);
    }
  }
  if (hydratedMapped.side === 'other') {
    rememberRecentPersistedAssistantIdentity(key, hydratedMapped);
  }
  chat.summary = hydratedMapped.text || (hydratedMapped.attachments?.length ? '[附件]' : chat.summary);
  chat.time = '刚刚';
  saveState();
  if (uiState.activeChatKey === key) renderChat();
  renderMessages();
}

function updateStreamingAssistant(threadId, content, done = false) {
  const key = String(threadId || '').trim();
  const text = String(content || '').trim();
  if (!key || !text || !state.chats?.[key]) return;
  const chat = state.chats[key];
  const streamingIndex = getStreamingMessageIndex(chat);
  let message = streamingIndex >= 0 ? chat.messages[streamingIndex] : null;
  if (!message && done) {
    const transientIndex = findCurrentAssistantCandidateIndex(chat, text, { transientOnly: true });
    message = transientIndex >= 0 ? chat.messages[transientIndex] : null;
  }
  if (!message && done) {
    const persistedIndex = findRecentPersistedAssistantCandidateIndex(chat, key, text);
    message = persistedIndex >= 0 ? chat.messages[persistedIndex] : null;
  }
  if (!message) {
    message = {
      side: 'other',
      text,
      streaming: !done,
      streamId: `stream-${key}-${Date.now()}`,
    };
    chat.messages.push(message);
  } else {
    message.text = text;
    message.streaming = !done;
  }
  message.waifuMessageKey = buildWaifuMessageKey(key, message);
  const hasWaifuDisplayState = Object.prototype.hasOwnProperty.call(message, 'waifuDisplayPending');
  if (
    done
    && resolveChatWaifuSettings(chat).enabled
    && getWaifuDisplaySegments(message, chat).length > 1
    && !hasDisplayedWaifuMessage(key, message)
    && (!hasWaifuDisplayState || message.waifuDisplayPending === true)
  ) {
    message.waifuDisplayPending = true;
  } else if (done && hasDisplayedWaifuMessage(key, message)) {
    message.waifuDisplayPending = false;
  }
  chat.summary = text;
  chat.time = '刚刚';
  saveState();
  if (uiState.activeChatKey === key) {
    renderChat();
  }
  renderMessages();
}

function handleThreadStreamEvent(event) {
  const type = String(event?.type || '').trim();
  if (type === 'user.message' && event.message) {
    upsertHydratedChatMessage(event.threadId, event.message);
    return;
  }
  if (type === 'assistant.persisted' && event.message) {
    upsertHydratedChatMessage(event.threadId, event.message);
    setChatStatus('回复已落库。');
    return;
  }
  if (type === 'assistant.stream' || type === 'assistant.done') {
    updateStreamingAssistant(event.threadId, event.content || event.text, type !== 'assistant.stream');
    if (type === 'assistant.stream') {
      setChatStatus('正在实时接收回复...');
    }
    if (type === 'assistant.done') {
      setChatStatus('回复已接收完成，正在落库...');
    }
  }
}

async function openChat(chatKey) {
  const key = resolvePreferredChatKey(state.chats, String(chatKey || '').trim());
  if (!key || !state.chats[key]) return;
  uiState.activeChatKey = key;
  uiState.permissionSnapshot = null;
  state.chats[key].unread = 0;
  saveState();
  if (backendEnabled) {
    try {
      await loadThreadMessages(key, { force: true });
    } catch {}
    subscribeThreadEvents(key);
  }
  renderMessages();
  renderDesktopBadge();
  renderLockNotification();
  setPhoneShell('app');
  setActiveView('chat');
  renderChat();
}

function getRecentMemories(limit = 4) {
  return state.memories.slice(0, limit);
}

function matchWorldbookEntries(chat, userInput = '') {
  const haystack = [
    chat.name,
    chat.description,
    chat.personality || '',
    chat.scenario || '',
    userInput,
    ...chat.messages.slice(-8).map((message) => message.text),
  ].join('\n').toLowerCase();

  return state.worldbook.filter((entry) => {
    if (entry.enabled === false) return false;
    const keys = Array.isArray(entry.keys) ? entry.keys : [];
    if (!keys.length) return true;
    return keys.some((key) => haystack.includes(String(key).toLowerCase()));
  });
}

function buildPromptBundle(chat, userInput = '') {
  const memories = getRecentMemories();
  const worldbookEntries = matchWorldbookEntries(chat, userInput);
  const systemParts = [
    state.apiSettings.systemPrompt,
    `当前用户人设`,
    `名字：${state.persona.name}`,
    `签名：${state.persona.signature}`,
    `设定：${state.persona.bio}`,
    '',
    `当前角色卡`,
    `名字：${chat.name}`,
    `简介：${chat.description}`,
    `性格：${chat.personality || '未设置'}`,
    `场景：${chat.scenario || '未设置'}`,
    `补充提示词：${chat.systemPrompt || '无'}`,
  ];

  if (memories.length) {
    systemParts.push('', '长期记忆');
    memories.forEach((memory, index) => {
      systemParts.push(`${index + 1}. ${memory.title}：${memory.text}`);
    });
  }

  if (worldbookEntries.length) {
    systemParts.push('', '命中的世界书词条');
    worldbookEntries.forEach((entry, index) => {
      const keywords = Array.isArray(entry.keys) && entry.keys.length ? `（关键词：${entry.keys.join('、')}）` : '';
      systemParts.push(`${index + 1}. ${entry.title}${keywords}：${entry.text}`);
    });
  }

  systemParts.push('', '回复要求', `- 保持 ${chat.name} 的口吻`, '- 回复自然，不要复读系统内容', '- 优先延续当前关系和聊天氛围');

  const messages = [
    { role: 'system', content: systemParts.join('\n') },
    ...chat.messages.map((message) => ({
      role: message.side === 'self' ? 'user' : 'assistant',
      content: message.text,
    })),
  ];

  if (userInput) {
    messages.push({ role: 'user', content: userInput });
  }

  return {
    system: systemParts.join('\n'),
    messages,
  };
}

function updatePromptPreview(userInput = '') {
  const chat = getActiveChat();
  if (!chat || !dom.promptPreview) return;
  const bundle = buildPromptBundle(chat, userInput);
  dom.promptPreview.textContent = [
    '[System]',
    bundle.system,
    '',
    '[Recent Messages]',
    bundle.messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join('\n'),
  ].join('\n');
}

function setChatStatus(message, isError = false) {
  if (!dom.chatStatus) return;
  dom.chatStatus.textContent = message;
  dom.chatStatus.classList.toggle('chat-status-error', Boolean(isError));
}

function isSingleSlashRuntimeText(text) {
  const cleanText = String(text || '').trim();
  return cleanText.startsWith('/') && !cleanText.startsWith('//');
}

function getSlashCommandQuery(value) {
  const text = String(value || '');
  if (!text.startsWith('/') || text.startsWith('//')) return null;
  return text.slice(1).trimStart().toLowerCase();
}

function filterSlashCommands(value) {
  const query = getSlashCommandQuery(value);
  if (query === null) return [];
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((item) => {
    const command = item.command.toLowerCase();
    const label = item.label.toLowerCase();
    return command.includes(query) || command.slice(1).includes(query) || label.includes(query);
  });
}

function closeSlashCommandPalette() {
  slashCommandState.open = false;
  slashCommandState.activeIndex = 0;
  slashCommandState.matches = SLASH_COMMANDS;
  if (dom.slashCommandPalette) {
    dom.slashCommandPalette.hidden = true;
    dom.slashCommandPalette.innerHTML = '';
  }
  dom.chatInput?.setAttribute('aria-expanded', 'false');
  dom.chatInput?.removeAttribute('aria-activedescendant');
}

function submitSlashCommand(command) {
  const value = String(command || '').trim();
  if (!value || !dom.chatInput) return;
  dom.chatInput.value = value;
  dom.chatInput.focus();
  closeSlashCommandPalette();
  if (dom.chatForm?.requestSubmit) {
    dom.chatForm.requestSubmit();
    return;
  }
  dom.chatForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function renderSlashCommandPalette() {
  if (!dom.slashCommandPalette || !slashCommandState.open) {
    closeSlashCommandPalette();
    return;
  }

  const matches = slashCommandState.matches;
  dom.slashCommandPalette.hidden = false;
  dom.chatInput?.setAttribute('aria-expanded', 'true');

  if (!matches.length) {
    dom.chatInput?.removeAttribute('aria-activedescendant');
    dom.slashCommandPalette.innerHTML = '<div class="slash-command-empty">没有命令</div>';
    return;
  }

  slashCommandState.activeIndex = Math.max(0, Math.min(slashCommandState.activeIndex, matches.length - 1));
  dom.slashCommandPalette.innerHTML = matches.map((item, index) => {
    const active = index === slashCommandState.activeIndex;
    return `
      <button class="slash-command-option${active ? ' slash-command-option-active' : ''}" type="button" role="option" id="slash-command-${index}" aria-selected="${active ? 'true' : 'false'}" data-slash-command="${escapeHtml(item.command)}">
        <strong>${escapeHtml(item.command)}</strong>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `;
  }).join('');
  dom.chatInput?.setAttribute('aria-activedescendant', `slash-command-${slashCommandState.activeIndex}`);

  dom.slashCommandPalette.querySelectorAll('[data-slash-command]').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('click', () => {
      submitSlashCommand(button.dataset.slashCommand);
    });
  });
}

function updateSlashCommandPalette() {
  if (!dom.chatInput) return;
  const query = getSlashCommandQuery(dom.chatInput.value);
  if (query === null) {
    closeSlashCommandPalette();
    return;
  }

  slashCommandState.matches = filterSlashCommands(dom.chatInput.value);
  slashCommandState.activeIndex = Math.min(slashCommandState.activeIndex, Math.max(0, slashCommandState.matches.length - 1));
  slashCommandState.open = true;
  renderSlashCommandPalette();
}

function moveSlashCommandSelection(delta) {
  if (!slashCommandState.open || !slashCommandState.matches.length) return;
  const count = slashCommandState.matches.length;
  slashCommandState.activeIndex = (slashCommandState.activeIndex + delta + count) % count;
  renderSlashCommandPalette();
}

function prepareChatSubmit(rawText, hasAttachments) {
  const trimmedText = String(rawText || '').trim();
  const escapedSlash = trimmedText.startsWith('//');
  const text = escapedSlash ? trimmedText.slice(1) : trimmedText;
  const runtimePassThrough = !hasAttachments
    && Boolean(text)
    && !escapedSlash
    && (isSingleSlashRuntimeText(trimmedText) || Boolean(uiState.runtimePassThroughEnabled));

  return { text, runtimePassThrough };
}

function updateRuntimePassThroughToggle() {
  if (!dom.runtimePassThroughToggle) return;
  const enabled = Boolean(uiState.runtimePassThroughEnabled);
  const hasAttachments = Array.isArray(uiState.pendingAttachments) && uiState.pendingAttachments.length > 0;
  dom.runtimePassThroughToggle.classList.toggle('runtime-pass-through-active', enabled);
  dom.runtimePassThroughToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  dom.runtimePassThroughToggle.disabled = Boolean(uiState.isGenerating);
  dom.runtimePassThroughToggle.title = enabled
    ? (hasAttachments ? '肘击 AI：附件走普通模式' : '肘击 AI：开启')
    : '肘击 AI：关闭';
}

function getPendingOutbox(chat) {
  if (!chat) return [];
  if (!Array.isArray(chat.pendingOutbox)) chat.pendingOutbox = [];
  return chat.pendingOutbox;
}

function getPendingItemAttachmentIds(item) {
  return (Array.isArray(item?.attachments) ? item.attachments : [])
    .map((attachmentId) => String(attachmentId || '').trim())
    .filter(Boolean);
}

function getPendingSendItems(chat) {
  return getPendingOutbox(chat).filter((item) => {
    const text = String(item?.text || '').trim();
    return Boolean(text) || getPendingItemAttachmentIds(item).length > 0;
  });
}

function getPendingTexts(chat) {
  return getPendingSendItems(chat)
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean);
}

function getPendingAttachmentIds(chat) {
  return getPendingSendItems(chat).flatMap((item) => getPendingItemAttachmentIds(item));
}

function shouldUseRuntimePassThroughForFlush(chat) {
  const pendingItems = getPendingSendItems(chat);
  if (pendingItems.length !== 1) return false;
  const pendingItem = pendingItems[0];
  if (getPendingItemAttachmentIds(pendingItem).length) return false;
  const text = String(pendingItem?.text || '').trim();
  return Boolean(text && pendingItem?.runtimePassThrough && !text.startsWith('//'));
}

function formatBytes(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '未知大小';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentDownloadUrl(attachment) {
  const raw = String(attachment?.downloadUrl || attachment?.url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/apps/') || raw.startsWith('/attachments/')) {
    return `${backendBase}/webclient-attachments?url=${encodeURIComponent(raw)}`;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw.includes('/attachments/') || raw.includes('/apps/')
      ? `${backendBase}/webclient-attachments?url=${encodeURIComponent(raw)}`
      : raw;
  }
  if (raw.startsWith('/')) return `${backendBase}${raw.startsWith('/api/') ? raw.slice(4) : raw}`;
  return raw;
}

function renderAttachmentStrip() {
  if (!dom.attachmentStrip) return;
  const items = Array.isArray(uiState.pendingAttachments) ? uiState.pendingAttachments : [];
  dom.attachmentStrip.innerHTML = items.map((item) => `
    <button class="attachment-chip" type="button" data-remove-attachment="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.kind === 'image' ? '图片' : '文件')}</span>
      <strong>${escapeHtml(item.fileName || 'attachment')}</strong>
      <em>${escapeHtml(formatBytes(item.size))}</em>
    </button>
  `).join('');
  dom.attachmentStrip.querySelectorAll('[data-remove-attachment]').forEach((button) => {
    button.addEventListener('click', () => {
      uiState.pendingAttachments = items.filter((item) => item.id !== button.dataset.removeAttachment);
      renderAttachmentStrip();
      updateMagicWandState();
      updateRuntimePassThroughToggle();
    });
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('读取附件失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadChatAttachments(files) {
  const chat = getActiveChat();
  const threadId = String(chat?.backend?.threadId || uiState.activeChatKey || '').trim();
  if (!backendEnabled || !threadId) throw new Error('附件需要连接 smallphone-app 后端。');
  const list = Array.from(files || []);
  for (const file of list) {
    const data = await fileToBase64(file);
    const created = await requestBackend('/attachments', {
      method: 'POST',
      body: JSON.stringify({
        threadId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        data,
      }),
    });
    uiState.pendingAttachments.push(created);
  }
  renderAttachmentStrip();
  updateMagicWandState();
  updateRuntimePassThroughToggle();
}

function updateMagicWandState() {
  if (!dom.magicWandButton) return;
  const chat = getActiveChat();
  const textCount = getPendingTexts(chat).length;
  const attachmentCount = getPendingAttachmentIds(chat).length + (Array.isArray(uiState.pendingAttachments) ? uiState.pendingAttachments.length : 0);
  const count = textCount + attachmentCount;
  dom.magicWandButton.classList.toggle('magic-wand-ready', count > 0);
  dom.magicWandButton.disabled = uiState.isGenerating || count === 0;
  dom.magicWandButton.title = count > 0
    ? `魔法棒：送 ${textCount} 条消息 / ${attachmentCount} 个附件到后端`
    : '魔法棒：没有待送消息';
}

function queueLocalUserMessage(chat, text, options = {}) {
  const attachmentMetas = Array.isArray(uiState.pendingAttachments) ? [...uiState.pendingAttachments] : [];
  const attachmentIds = attachmentMetas.map((item) => String(item.id || '').trim()).filter(Boolean);
  const cleanText = String(text || '').trim();
  if (!cleanText && !attachmentIds.length) return null;
  const pendingItem = {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: cleanText,
    attachments: attachmentIds,
    attachmentMetas,
  };
  if (options.runtimePassThrough && !attachmentIds.length) {
    pendingItem.runtimePassThrough = true;
  }
  getPendingOutbox(chat).push(pendingItem);
  chat.messages.push({
    side: 'self',
    text: cleanText,
    attachments: attachmentMetas,
    actions: [],
    pending: true,
    pendingId: pendingItem.id,
  });
  uiState.pendingAttachments = [];
  chat.summary = cleanText || (attachmentIds.length ? '[附件]' : chat.summary);
  chat.time = '刚刚';
  renderAttachmentStrip();
  updateRuntimePassThroughToggle();
  return pendingItem;
}

async function flushPendingOutbox() {
  const chat = getActiveChat();
  if (!chat || uiState.isGenerating) return;
  if (!getPendingOutbox(chat).length && Array.isArray(uiState.pendingAttachments) && uiState.pendingAttachments.length) {
    queueLocalUserMessage(chat, '');
  }
  const pendingTexts = getPendingTexts(chat);
  const pendingAttachmentIds = getPendingAttachmentIds(chat);
  const runtimePassThrough = shouldUseRuntimePassThroughForFlush(chat);
  if (!pendingTexts.length && !pendingAttachmentIds.length) {
    setChatStatus('没有待送消息。');
    updateMagicWandState();
    updateRuntimePassThroughToggle();
    return;
  }

  const batchText = pendingTexts.join('\n');
  uiState.isGenerating = true;
  dom.chatInput.disabled = true;
  updateMagicWandState();
  updateRuntimePassThroughToggle();

  try {
    if (backendEnabled) {
      const threadId = String(chat.backend?.threadId || uiState.activeChatKey || '').trim();
      if (!threadId) throw new Error('当前聊天缺少 thread id，无法发送。');

      subscribeThreadEvents(threadId);
      setChatStatus(runtimePassThrough
        ? '正在肘击 AI，经由 smallphone-app 直送 runtime...'
        : `正在把 ${pendingTexts.length} 条待送消息 / ${pendingAttachmentIds.length} 个附件交给 smallphone-app...`);
      const requestBody = { text: batchText, attachments: pendingAttachmentIds };
      if (pendingTexts.length) requestBody.textParts = pendingTexts;
      if (runtimePassThrough) requestBody.runtimePassThrough = true;
      await requestBackend(`/threads/${encodeURIComponent(threadId)}/messages`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      chat.pendingOutbox = [];
      saveState();
      await refreshBackendState(threadId);
      await loadThreadMessages(threadId, { force: true, recordRecentAssistant: true });
      renderAll();
      setChatStatus('魔法棒已送达后端，并刷新了回复。');
      return;
    }

    chat.pendingOutbox = [];
    chat.messages.forEach((message) => {
      if (message.pending) message.pending = false;
    });
    saveState();
    renderChat();
    uiState.isGenerating = false;
    await generateAssistantReply(batchText);
  } catch (error) {
    setChatStatus(error instanceof Error ? error.message : '魔法棒发送失败', true);
  } finally {
    uiState.isGenerating = false;
    dom.chatInput.disabled = false;
    updateMagicWandState();
    updateRuntimePassThroughToggle();
  }
}

function buildFallbackReply(chat, userInput = '') {
  const relatedEntry = matchWorldbookEntries(chat, userInput)[0];
  const memory = getRecentMemories(1)[0];
  const snippets = [
    relatedEntry ? `想到${relatedEntry.title}这件事，${relatedEntry.text}` : '',
    memory ? `我也记得你之前提过：${memory.text}` : '',
    userInput ? `关于你刚才说的“${userInput}”，我想顺着这个感觉继续陪你聊。` : '如果继续说下去，我会先把这段气氛轻轻接住。',
  ].filter(Boolean);
  return snippets.join(' ');
}

async function generateAssistantReply(userInput = '', { continueOnly = false } = {}) {
  const chat = getActiveChat();
  if (!chat || uiState.isGenerating) return;
  if (backendEnabled) {
    setChatStatus('后端已连接，已禁用前端本地自动回复。', true);
    return;
  }

  uiState.isGenerating = true;
  dom.chatInput.disabled = true;
  setChatStatus('正在按角色卡、人设、世界书和记忆拼装上下文...');

  try {
    const bundle = buildPromptBundle(chat, continueOnly ? '' : userInput);
    const apiUrl = normalizeApiBaseUrl(state.apiSettings.apiUrl);
    const apiKey = String(state.apiSettings.apiKey || '').trim();
    let replyText = '';

    if (apiUrl && apiKey) {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: state.apiSettings.modelName || 'gpt-4o-mini',
          messages: bundle.messages,
          temperature: Number(state.apiSettings.temperature || 0.8),
          max_tokens: Number(state.apiSettings.maxTokens || 512),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`模型请求失败：${response.status} ${detail || response.statusText}`);
      }

      const data = await response.json();
      replyText = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!replyText) throw new Error('模型已返回响应，但没有文本内容');
    } else {
      replyText = buildFallbackReply(chat, userInput);
    }

    chat.messages.push({
      side: 'other',
      text: replyText,
      waifuDisplayPending: resolveChatWaifuSettings(chat).enabled,
    });
    chat.summary = replyText;
    chat.time = '刚刚';
    saveState();
    renderMessages();
    renderDesktopBadge();
    renderLockNotification();
    renderChat();
    updatePromptPreview();
    setChatStatus(apiUrl && apiKey ? '已通过 OpenAI 兼容接口生成回复。' : '当前未配置 API，已使用前端本地回退回复。');
  } catch (error) {
    setChatStatus(error instanceof Error ? error.message : '生成失败', true);
  } finally {
    uiState.isGenerating = false;
    dom.chatInput.disabled = false;
  }
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  dom.statusTime.textContent = `${hh}:${mm}`;
  dom.lockTime.textContent = `${hh}:${mm}`;
  dom.lockDate.textContent = `${weekdays[now.getDay()]} ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
}

function applyTheme() {
  document.body.dataset.theme = state.theme;
  const themeMap = {
    mist: '柔雾',
    night: '夜色',
    mint: '薄荷',
  };
  dom.themeLabel.textContent = themeMap[state.theme] || '柔雾';
}

function setActiveView(viewName) {
  let activeView = null;
  document.querySelectorAll('.view').forEach((view) => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle('view-active', isActive);
    if (isActive) activeView = view;
  });

  dom.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === viewName);
  });
  document.body.dataset.activeView = viewName;
  document.body.dataset.spatialView = activeView?.classList.contains('app-space-view') ? 'true' : 'false';
}

function applyPhoneShell() {
  const mode = state.phoneShell?.mode || 'lock';
  document.body.dataset.shell = mode;
  if (mode !== 'app') {
    document.body.dataset.spatialView = 'false';
    document.body.dataset.activeView = '';
  }
  dom.lockScreen.classList.toggle('overlay-active', mode === 'lock');
  dom.desktopScreen.classList.toggle('overlay-active', mode === 'desktop');
  dom.lockScreen.setAttribute('aria-hidden', String(mode !== 'lock'));
  dom.desktopScreen.setAttribute('aria-hidden', String(mode !== 'desktop'));
  dom.appExitButton.classList.toggle('app-exit-visible', mode === 'app');
}

function getStaticDesktopAppEntries() {
  return [
    ...CORE_DESKTOP_APPS,
    ...registeredApps.map((app) => ({
      id: app.id,
      name: app.name,
      shortName: app.shortName,
      orbClass: app.orbClass,
      target: app.views.normal,
      manifest: app,
    })),
  ];
}

function getStaticDesktopAppIds() {
  return [
    ...getStaticDesktopAppEntries().map((app) => app.id),
    ...CORE_DESKTOP_APP_ALIASES.map((alias) => alias.backendId),
  ];
}

function getDesktopAppEntries() {
  return mergeStaticAndDynamicDesktopApps(
    getStaticDesktopAppEntries(),
    dynamicAppRegistry.dynamicAppEntries,
  );
}

function getDesktopPageCount() {
  return Math.max(1, Math.ceil(getDesktopAppEntries().length / DESKTOP_APPS_PER_PAGE));
}

function applyDesktopPage() {
  const maxPage = getDesktopPageCount() - 1;
  const page = Math.max(0, Math.min(maxPage, Number(state.desktop?.page || 0)));
  if (state.desktop.page !== page) state.desktop.page = page;
  dom.desktopPages.style.transform = `translateX(-${page * 100}%)`;
  document.querySelectorAll('[data-desktop-dot]').forEach((dot) => {
    dot.classList.toggle('desktop-dot-active', Number(dot.dataset.desktopDot) === page);
  });
}

function setDesktopPage(page) {
  state.desktop.page = Math.max(0, Math.min(getDesktopPageCount() - 1, page));
  saveState();
  applyDesktopPage();
}

function setPhoneShell(mode) {
  state.phoneShell.mode = mode;
  saveState();
  applyPhoneShell();
}

function openPanel(panelName) {
  if (!panelMeta[panelName]) return;
  dom.panelEyebrow.textContent = panelMeta[panelName].eyebrow;
  dom.panelTitle.textContent = panelMeta[panelName].title;

  dom.panelViews.forEach((view) => {
    view.classList.toggle('panel-view-active', view.dataset.panel === panelName);
  });

  dom.panel.classList.add('panel-open');
  dom.panel.setAttribute('aria-hidden', 'false');
  if (panelName === 'character') {
    renderCharacterEditor();
    void loadCharacterRuntimeSettingsForCurrent({ force: true });
  }
  if (panelName === 'permissions') {
    loadActivePermissions({ force: true })
      .then(() => renderPermissionPanel())
      .catch((error) => {
        uiState.permissionSnapshot = null;
        renderPermissionPanel(error instanceof Error ? error.message : String(error));
      });
  }
}

function closePanel() {
  dom.panel.classList.remove('panel-open');
  dom.panel.setAttribute('aria-hidden', 'true');
}

function getDynamicEntryKey(entry) {
  return String(entry?.instanceId || entry?.id || '').trim();
}

function getDynamicAppTitle(entry) {
  return String(entry?.name || entry?.title || entry?.instanceId || entry?.id || '动态 App').trim() || '动态 App';
}

function getDynamicAppHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function renderDynamicRegistryStatus() {
  if (dom.appRegistryStatus) {
    dom.appRegistryStatus.textContent = dynamicRegistryStatus.text;
    dom.appRegistryStatus.classList.toggle('registry-status-error', Boolean(dynamicRegistryStatus.isError));
  }
  if (dom.appRegistryRefreshButton) {
    dom.appRegistryRefreshButton.disabled = Boolean(dynamicRegistryStatus.loading);
    dom.appRegistryRefreshButton.textContent = dynamicRegistryStatus.loading ? '刷新中...' : '刷新 App 注册表';
  }
}

function setDynamicRegistryStatus(text, isError = false, loading = false) {
  dynamicRegistryStatus = { text, isError, loading };
  renderDynamicRegistryStatus();
}

function renderServiceManagerStatus() {
  if (dom.serviceManagerStatus) {
    dom.serviceManagerStatus.textContent = serviceManagerStatus.text;
    dom.serviceManagerStatus.classList.toggle('registry-status-error', Boolean(serviceManagerStatus.isError));
  }
  if (dom.serviceManagerRefreshButton) {
    dom.serviceManagerRefreshButton.disabled = Boolean(serviceManagerStatus.loading);
    dom.serviceManagerRefreshButton.textContent = serviceManagerStatus.loading ? '刷新中...' : '刷新服务状态';
  }
}

function setServiceManagerStatus(text, isError = false, loading = false) {
  serviceManagerStatus = { text, isError, loading };
  renderServiceManagerStatus();
}

function renderServiceManagerPanel() {
  renderServiceManagerStatus();
  if (!dom.serviceManagerList) return;

  const targets = getManagedServiceTargets({ serviceManagerSnapshot, dynamicAppRegistry });
  const snapshot = serviceManagerSnapshot || { services: [], byId: new Map() };

  dom.serviceManagerList.innerHTML = targets.map((target) => {
    const service = snapshot.byId?.get?.(target.serviceId) || null;
    const availability = service?.availability || '';
    const provider = service?.provider || '';
    const state = service?.state || '';
    const message = service?.message || '';
    const hasService = Boolean(service);
    const inflight = serviceManagerActionInflight.has(target.serviceId);
    const openDisabled = target.open?.kind === 'url' && !target.open.url;
    const actionDisabled = !backendEnabled || inflight;

    const pills = [
      availability ? `<span class="service-pill service-pill-strong">${escapeHtml(availability)}</span>` : '',
      provider ? `<span class="service-pill">${escapeHtml(provider)}</span>` : '',
    ].filter(Boolean).join('');

    const kindLabel = target.kind === 'standalone'
      ? 'standalone'
      : target.kind === 'dynamic'
        ? 'dynamic'
        : 'service-manager';
    const subtitleBits = [kindLabel, target.serviceId].filter(Boolean).join(' · ');

    return `
      <article class="service-card" data-service-card="${escapeHtml(target.serviceId)}">
        <div class="service-topline">
          <div>
            <strong>${escapeHtml(target.label)}</strong>
            <p>${escapeHtml(subtitleBits)}</p>
          </div>
          <span class="runtime-pill">${escapeHtml(state || (hasService ? 'unknown' : 'unavailable'))}</span>
        </div>
        <div class="service-pill-row">${pills || '<span class="service-pill">未返回服务状态</span>'}</div>
        ${message ? `<p>${escapeHtml(message)}</p>` : ''}
        <div class="service-actions">
          <button type="button" class="secondary-button small-button" data-service-action="refresh" data-service-id="${escapeHtml(target.serviceId)}" ${serviceManagerStatus.loading ? 'disabled' : ''}>刷新</button>
          <button type="button" class="secondary-button small-button" data-service-action="start" data-service-id="${escapeHtml(target.serviceId)}" ${actionDisabled ? 'disabled' : ''}>启动</button>
          <button type="button" class="secondary-button small-button" data-service-action="stop" data-service-id="${escapeHtml(target.serviceId)}" ${actionDisabled ? 'disabled' : ''}>停止</button>
          <button type="button" class="secondary-button small-button" data-service-action="restart" data-service-id="${escapeHtml(target.serviceId)}" ${actionDisabled ? 'disabled' : ''}>重启</button>
          <button type="button" class="soft-button small-button" data-service-action="open" data-service-id="${escapeHtml(target.serviceId)}" ${(openDisabled || inflight) ? 'disabled' : ''}>打开</button>
        </div>
      </article>
    `;
  }).join('');

  dom.serviceManagerList.querySelectorAll('[data-service-action][data-service-id]').forEach((button) => {
    const serviceId = button.dataset.serviceId;
    const action = button.dataset.serviceAction;
    if (!serviceId || !action) return;
    button.addEventListener('click', () => void handleServiceManagerAction(serviceId, action));
  });
}

function summarizeDynamicRegistry(registry) {
  const visibleCount = Array.isArray(registry?.dynamicAppEntries) ? registry.dynamicAppEntries.length : 0;
  if (visibleCount) return `已载入 ${visibleCount} 个动态 App。`;
  const instanceCount = Array.isArray(registry?.appInstances) ? registry.appInstances.length : 0;
  return instanceCount ? '注册表已同步，暂无可显示 App。' : '未发现动态 App。';
}

function setDynamicAppFrameStatus(message, isError = false) {
  if (!dom.dynamicAppStatus) return;
  dom.dynamicAppStatus.textContent = message;
  dom.dynamicAppStatus.classList.toggle('dynamic-app-status-error', Boolean(isError));
}

function showDynamicAppEmpty(message = '', isError = false) {
  if (!dom.dynamicAppEmpty) return;
  dom.dynamicAppEmpty.textContent = message;
  dom.dynamicAppEmpty.classList.toggle('dynamic-app-empty-visible', Boolean(message));
  dom.dynamicAppEmpty.classList.toggle('dynamic-app-empty-error', Boolean(isError));
}

function renderDynamicAppView(message = '', isError = false) {
  const entry = activeDynamicApp;
  const url = String(entry?.launchUrl || '').trim();
  const title = getDynamicAppTitle(entry);
  const appId = String(entry?.appId || 'Dynamic App').trim();
  const instanceId = getDynamicEntryKey(entry);

  if (dom.dynamicAppTitle) dom.dynamicAppTitle.textContent = title;
  if (dom.dynamicAppEyebrow) {
    dom.dynamicAppEyebrow.textContent = entry
      ? [appId, instanceId].filter(Boolean).join(' · ')
      : 'Dynamic App';
  }
  if (dom.dynamicAppFrame) dom.dynamicAppFrame.title = title;

  if (!entry) {
    if (dom.dynamicAppFrame) {
      dom.dynamicAppFrame.removeAttribute('src');
      delete dom.dynamicAppFrame.dataset.launchUrl;
    }
    setDynamicAppFrameStatus('未打开');
    showDynamicAppEmpty('选择桌面上的 App 图标后打开。');
    return;
  }

  if (!url) {
    if (dom.dynamicAppFrame) {
      dom.dynamicAppFrame.removeAttribute('src');
      delete dom.dynamicAppFrame.dataset.launchUrl;
    }
    setDynamicAppFrameStatus(message || '暂无入口', true);
    showDynamicAppEmpty(message || '这个 App 暂无可用入口。', true);
    return;
  }

  const host = getDynamicAppHost(url);
  setDynamicAppFrameStatus(message || (host ? `打开 ${host}` : '打开 App'), isError);
  showDynamicAppEmpty('');

  if (dom.dynamicAppFrame && dom.dynamicAppFrame.dataset.launchUrl !== url) {
    dom.dynamicAppFrame.dataset.launchUrl = url;
    dom.dynamicAppFrame.src = url;
    setDynamicAppFrameStatus(host ? `正在打开 ${host}` : '正在打开 App');
  }
}

function syncActiveDynamicAppAfterRegistryRefresh() {
  if (!activeDynamicApp) return;
  const activeKey = getDynamicEntryKey(activeDynamicApp);
  const nextEntry = (dynamicAppRegistry.dynamicAppEntries || [])
    .find((entry) => getDynamicEntryKey(entry) === activeKey);

  if (!nextEntry) {
    activeDynamicApp = {
      ...activeDynamicApp,
      launchUrl: '',
    };
    renderDynamicAppView('App 已从注册表移除。', true);
    return;
  }

  activeDynamicApp = nextEntry;
  renderDynamicAppView();
}

async function refreshDynamicAppRegistry({ manual = false } = {}) {
  if (dynamicRegistryStatus.loading) return false;
  setDynamicRegistryStatus('正在刷新 App 注册表...', false, true);

  if (!backendEnabled && manual) {
    try {
      await bootstrapState();
    } catch {}
  }

  if (!backendEnabled) {
    dynamicAppRegistry = { dynamicAppEntries: [] };
    setDynamicRegistryStatus('后端未连接，使用内置 App。');
    renderDesktopApps();
    renderDesktopBadge();
    syncActiveDynamicAppAfterRegistryRefresh();
    renderServiceManagerPanel();
    return false;
  }

  try {
    dynamicAppRegistry = await fetchDynamicAppRegistry({
      apiBase: backendBase,
      staticAppIds: getStaticDesktopAppIds(),
    });
    setDynamicRegistryStatus(summarizeDynamicRegistry(dynamicAppRegistry));
    renderDesktopApps();
    renderDesktopBadge();
    syncActiveDynamicAppAfterRegistryRefresh();
    renderServiceManagerPanel();
    return true;
  } catch {
    const hasExistingEntries = Boolean(dynamicAppRegistry.dynamicAppEntries?.length);
    setDynamicRegistryStatus(
      hasExistingEntries ? '注册表刷新失败，保留当前图标。' : '注册表刷新失败，使用内置 App。',
      true,
    );
    if (!hasExistingEntries) {
      dynamicAppRegistry = { dynamicAppEntries: [] };
      renderDesktopApps();
      renderDesktopBadge();
      renderServiceManagerPanel();
    }
    return false;
  }
}

async function fetchServiceManagerHealth() {
  return requestBackend('/service-manager/health', { preserveBackendOnError: true });
}

async function fetchServiceManagerServices() {
  return requestBackend('/service-manager/services', { preserveBackendOnError: true });
}

async function fetchServiceManagerServiceStatus(serviceId) {
  const normalizedId = String(serviceId || '').trim();
  if (!normalizedId) throw new Error('缺少 serviceId');
  return requestBackend(`/service-manager/services/${encodeURIComponent(normalizedId)}/status`, {
    preserveBackendOnError: true,
  });
}

async function refreshServiceManagerSnapshot({ manual = false } = {}) {
  if (serviceManagerStatus.loading) return false;
  setServiceManagerStatus('正在刷新服务状态...', false, true);

  if (!backendEnabled && manual) {
    try {
      await bootstrapState();
    } catch {}
  }

  if (!backendEnabled) {
    serviceManagerSnapshot = { services: [], byId: new Map() };
    setServiceManagerStatus('后端未连接，服务管理不可用。');
    renderServiceManagerPanel();
    return false;
  }

  try {
	    await fetchServiceManagerHealth();
    const payload = await fetchServiceManagerServices();
    const definitions = buildServiceManagerDefinitions(payload);

    const statusResults = await Promise.allSettled(definitions.map(async (def) => {
      const statusPayload = await fetchServiceManagerServiceStatus(def.id);
      return mergeServiceManagerDefinitionWithStatus(def, statusPayload);
	    }));

    const services = statusResults
      .map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const error = result.reason instanceof Error ? result.reason.message : 'status unavailable';
        return createServiceFromDefinition(definitions[index], {
          state: 'unknown',
          message: error,
          raw: { error },
        });
      })
      .filter(Boolean);

    serviceManagerSnapshot = {
      services,
      byId: new Map(services.map((service) => [service.id, service])),
      definitions,
    };

    const count = definitions.length;
    setServiceManagerStatus(count ? `已载入 ${count} 个服务。` : '服务管理可用，但未返回服务列表。');
    renderServiceManagerPanel();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务状态刷新失败';
    setServiceManagerStatus(`服务状态刷新失败：${message}`, true);
    renderServiceManagerPanel();
    return false;
  }
}

async function callServiceManagerAction(serviceId, action) {
  const normalizedId = String(serviceId || '').trim();
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!normalizedId) throw new Error('缺少 serviceId');
  if (!normalizedAction) throw new Error('缺少 action');

  if (!['start', 'stop', 'restart'].includes(normalizedAction)) {
    throw new Error(`不支持的服务操作：${normalizedAction}`);
  }

  return requestBackend(`/service-manager/services/${encodeURIComponent(normalizedId)}/${normalizedAction}`, {
    method: 'POST',
    preserveBackendOnError: true,
  });
}

function openServiceTarget(target) {
  const open = target?.open || null;
  if (!open || typeof open !== 'object') return;

  if (open.kind === 'static-app') {
    if (open.appId === 'like-girl') setLikeGirlLaunch(open.path || '');
    if (open.appId === 'like-girl-clone') setLikeGirlCloneLaunch(open.path || '');
    closePanel();
    setPhoneShell('app');
    setActiveView(open.appId);
    refreshRegisteredApps();
    return;
  }

  if (open.kind === 'dynamic-entry') {
    const instanceId = String(open.instanceId || '').trim();
    const entry = (dynamicAppRegistry.dynamicAppEntries || []).find((item) => (
      String(item?.instanceId || item?.id || '').trim() === instanceId
    )) || null;
    if (entry) {
      openDynamicApp(entry);
    } else {
      setServiceManagerStatus('未找到对应动态 App。', true);
      renderServiceManagerPanel();
    }
    return;
  }

  if (open.kind === 'url') {
    const url = String(open.url || '').trim();
    if (!url) return;
    openDynamicApp({
      id: `service:${target.serviceId}`,
      instanceId: `service:${target.serviceId}`,
      appId: 'service',
      name: target.label || target.serviceId,
      title: target.label || target.serviceId,
      launchUrl: url,
      launchSource: 'service.url',
      dynamic: true,
    });
  }
}

async function handleServiceManagerAction(serviceId, action) {
  const normalizedId = String(serviceId || '').trim();
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!normalizedId || !normalizedAction) return;

  if (normalizedAction === 'open') {
    const target = getManagedServiceTargets({ serviceManagerSnapshot, dynamicAppRegistry })
      .find((item) => item.serviceId === normalizedId) || null;
    if (!target) {
      setServiceManagerStatus(`无法打开：未知服务 ${normalizedId}`, true);
      return;
    }
    openServiceTarget(target);
    return;
  }

  if (normalizedAction === 'refresh') {
    await refreshServiceManagerSnapshot({ manual: true });
    return;
  }

  if (!backendEnabled) {
    setServiceManagerStatus('后端未连接，无法操作服务。', true);
    return;
  }

  if (serviceManagerActionInflight.has(normalizedId)) return;
  serviceManagerActionInflight.add(normalizedId);
  renderServiceManagerPanel();

  try {
    await callServiceManagerAction(normalizedId, normalizedAction);
    await refreshServiceManagerSnapshot({ manual: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务操作失败';
    setServiceManagerStatus(`服务操作失败：${message}`, true);
    renderServiceManagerPanel();
  } finally {
    serviceManagerActionInflight.delete(normalizedId);
    renderServiceManagerPanel();
  }
}

function openDynamicApp(entry) {
  activeDynamicApp = entry || null;
  uiState.previousView = 'dynamic-app';
  closePanel();
  setPhoneShell('app');
  renderDynamicAppView();
  setActiveView('dynamic-app');
}

function openDesktopApp(entry) {
  if (entry.dynamic) {
    openDynamicApp(entry);
    return;
  }

  if (entry.panel) {
    setPhoneShell('app');
    openPanel(entry.panel);
    return;
  }

  if (!entry.target) return;
  if (entry.id === 'like-girl') setLikeGirlLaunch('');
  if (entry.id === 'like-girl-clone') setLikeGirlCloneLaunch('');
  uiState.previousView = entry.target;
  closePanel();
  setPhoneShell('app');
  setActiveView(entry.target);
}

function openAppSpace(app, mode = 'space2d') {
  const viewName = app.views?.[mode] || app.views?.space2d || app.views?.normal;
  if (!viewName) return;
  closePanel();
  setPhoneShell('app');
  setActiveView(viewName);
}

function openAppNormal(appId) {
  const app = registeredApps.find((item) => item.id === appId);
  if (!app?.views?.normal) return;
  closePanel();
  setPhoneShell('app');
  setActiveView(app.views.normal);
}

function returnToWorld() {
  closePanel();
  setPhoneShell('desktop');
  state.desktop.mode = 'world';
  saveState();
  applyDesktopMode({ state, dom });
}

function renderDesktopApps() {
  const apps = getDesktopAppEntries();
  const pages = [];

  for (let index = 0; index < apps.length; index += DESKTOP_APPS_PER_PAGE) {
    pages.push(apps.slice(index, index + DESKTOP_APPS_PER_PAGE));
  }

  dom.desktopPages.innerHTML = pages.map((pageApps, pageIndex) => `
    <section class="desktop-page ios-grid" data-desktop-page="${pageIndex}">
      ${pageApps.map((app) => `
        <button class="app-icon" data-app-id="${escapeHtml(app.id)}">
          ${app.badge === 'unread' ? '<span class="app-badge chat-badge" id="desktop-unread">0</span>' : ''}
          <span class="icon-orb ${escapeHtml(app.orbClass)}">${escapeHtml(app.shortName)}</span>
          <strong>${escapeHtml(app.name)}</strong>
        </button>
      `).join('')}
      ${Array.from({ length: DESKTOP_APPS_PER_PAGE - pageApps.length }, () => '<span class="app-icon app-icon-placeholder" aria-hidden="true"></span>').join('')}
    </section>
  `).join('');

  dom.desktopPagination.innerHTML = pages.map((_, pageIndex) => `
    <span class="desktop-dot" data-desktop-dot="${pageIndex}"></span>
  `).join('');

  dom.desktopPages.querySelectorAll('[data-app-id]').forEach((button) => {
    const entry = apps.find((app) => app.id === button.dataset.appId);
    if (!entry) return;
    button.addEventListener('click', () => openDesktopApp(entry));
  });

  dom.desktopPagination.querySelectorAll('[data-desktop-dot]').forEach((dot) => {
    dot.addEventListener('click', () => {
      setDesktopPage(Number(dot.dataset.desktopDot));
    });
  });

  applyDesktopPage();
}

function mountRegisteredAppViews() {
  if (!dom.registeredAppViews) return;
  dom.registeredAppViews.innerHTML = `${appModules.map((app) => app.template || '').join('')}${appSpaceTemplates}`;
}

function refreshRegisteredApps() {
  const context = {
    state,
    saveState,
    refresh: renderAll,
  };
  appModules.forEach((app) => {
    app.render?.(context);
  });
}

function refreshWorld() {
  applyDesktopMode({ state, dom });
  renderWorldToolbar({ state, saveState, dom, apps: registeredApps, openAppSpace });
  renderWorld({ state, saveState, dom, apps: registeredApps, openAppSpace });
}

function bindRegisteredApps() {
  const context = {
    state,
    saveState,
    refresh: renderAll,
  };
  appModules.forEach((app) => {
    app.bind?.(context);
  });

  document.querySelectorAll('[data-app-normal]').forEach((button) => {
    button.addEventListener('click', () => openAppNormal(button.dataset.appNormal));
  });

  document.querySelectorAll('[data-app-space2d]').forEach((button) => {
    button.addEventListener('click', () => {
      const app = registeredApps.find((item) => item.id === button.dataset.appSpace2d);
      if (app) openAppSpace(app, 'space2d');
    });
  });

  document.querySelectorAll('[data-app-space3d]').forEach((button) => {
    button.addEventListener('click', () => {
      const app = registeredApps.find((item) => item.id === button.dataset.appSpace3d);
      if (app) openAppSpace(app, 'space3d');
    });
  });

  document.querySelectorAll('[data-world-return]').forEach((button) => {
    button.addEventListener('click', returnToWorld);
  });
}

function renderMessages() {
  dom.messageList.innerHTML = '';

  Object.entries(state.chats).forEach(([key, chat]) => {
    const button = document.createElement('button');
    button.className = 'message-item';
    button.dataset.openChat = key;
    button.innerHTML = `
      ${renderAvatar(chat)}
      <div class="message-meta">
        <div class="message-topline">
          <strong>${chat.name}</strong>
          <span>${chat.time}</span>
        </div>
        <p>${escapeHtml(chat.summary)}</p>
      </div>
      ${chat.unread ? `<span class="badge">${chat.unread}</span>` : ''}
    `;
    button.addEventListener('click', () => {
      void openChat(key);
    });
    dom.messageList.appendChild(button);
  });
}

function renderContacts() {
  dom.contactList.innerHTML = '';

  Object.entries(state.chats).forEach(([key, chat]) => {
    const item = document.createElement('article');
    item.className = 'contact-item';
    item.innerHTML = `
      ${renderAvatar(chat)}
      <div class="contact-meta">
        <strong>${escapeHtml(chat.name)}</strong>
        <p class="contact-copy">${escapeHtml(chat.description)}</p>
      </div>
    `;
    item.addEventListener('click', () => {
      uiState.editingCharacterKey = key;
      openPanel('character');
      renderCharacterEditor();
    });
    dom.contactList.appendChild(item);
  });

  const self = document.createElement('article');
  self.className = 'contact-item';
  self.innerHTML = `
    ${renderAvatar(personaAvatarSource())}
    <div class="contact-meta">
      <strong>我的人设</strong>
      <p class="contact-copy">${state.persona.bio}</p>
    </div>
  `;
  dom.contactList.appendChild(self);
}

function renderCharacterHighlight() {
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  if (!chat) {
    dom.characterHighlight.innerHTML = '';
    return;
  }
  dom.characterHighlight.innerHTML = `
    <div class="character-detail-top">
      ${renderAvatar(chat)}
      <div>
        <p class="eyebrow">角色详情</p>
        <strong>${escapeHtml(chat.name)}</strong>
        <p class="contact-copy">${escapeHtml(chat.description)}</p>
      </div>
    </div>
    <div class="detail-copy">
      <p><strong>性格：</strong>${escapeHtml(chat.personality || '未设置')}</p>
      <p><strong>场景：</strong>${escapeHtml(chat.scenario || '未设置')}</p>
      <p><strong>主动联系：</strong>${chat.proactiveContactEnabled !== false ? '已开启' : '已关闭'}</p>
    </div>
    <div class="character-detail-actions">
      <button class="secondary-button" id="character-open-chat">打开聊天</button>
      <button class="secondary-button" id="character-edit-button">编辑角色</button>
    </div>
  `;

  dom.characterHighlight.querySelector('#character-open-chat').addEventListener('click', () => {
    uiState.previousView = 'contacts';
    void openChat(uiState.editingCharacterKey);
  });

  dom.characterHighlight.querySelector('#character-edit-button').addEventListener('click', () => {
    openPanel('character');
    renderCharacterEditor();
  });
}

function renderMessageAttachments(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (!attachments.length) return '';
  return `<div class="bubble-attachments">${attachments.map((attachment) => {
    const url = attachmentDownloadUrl(attachment);
    const label = escapeHtml(attachment.fileName || 'attachment');
    const mime = String(attachment.mimeType || '').toLowerCase();
    const isImage = attachment.kind === 'image' || mime.startsWith('image/');
    if (isImage && url) {
      return `<a class="bubble-image-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img class="bubble-image" src="${escapeHtml(url)}" alt="${label}"></a>`;
    }
    return `<a class="bubble-file" href="${escapeHtml(url || '#')}" target="_blank" rel="noreferrer"><span>${isImage ? '图片' : '文件'}</span><strong>${label}</strong><em>${escapeHtml(formatBytes(attachment.size))}</em></a>`;
  }).join('')}</div>`;
}

function renderMessageActions(message) {
  const actions = Array.isArray(message?.actions) ? message.actions : [];
  if (!actions.length) return '';
  return `<div class="approval-card"><p>需要操作确认</p><div class="approval-actions">${actions.map((action) => `
    <button type="button" data-thread-action="${escapeHtml(action.action)}" data-reply-ctx="${escapeHtml(action.replyCtx || '')}">${escapeHtml(action.label || action.action)}</button>
  `).join('')}</div></div>`;
}

function bindMessageActions(container) {
  container.querySelectorAll('[data-thread-action]').forEach((button) => {
    button.addEventListener('click', () => {
      void submitThreadAction(button.dataset.threadAction || '', button.dataset.replyCtx || '');
    });
  });
}

function appendChatMessageRow(message, chat, options = {}) {
  const side = message.side === 'self' ? 'self' : 'other';
  const row = document.createElement('div');
  row.className = ['chat-message-row', `chat-message-${side}`, options.rowClass || ''].filter(Boolean).join(' ');
  if (options.hidden) row.hidden = true;
  if (Number.isFinite(options.waifuDelayMs)) row.dataset.waifuDelayMs = String(options.waifuDelayMs);
  if (Number.isInteger(options.waifuSegmentIndex)) row.dataset.waifuSegment = String(options.waifuSegmentIndex);

  const bubble = document.createElement('div');
  bubble.className = [
    `bubble bubble-${side}`,
    message.pending ? 'bubble-pending' : '',
    message.streaming ? 'bubble-streaming' : '',
    options.bubbleClass || '',
  ].filter(Boolean).join(' ');
  bubble.innerHTML = [
    options.textHtml ?? renderMessageTextHtml(message, chat),
    options.includeAttachments === false ? '' : renderMessageAttachments(message),
    options.includeActions === false ? '' : renderMessageActions(message),
  ].filter(Boolean).join('');
  bindMessageActions(bubble);

  if (side === 'other') row.innerHTML = renderAvatar(chat, 'avatar chat-avatar');
  row.appendChild(bubble);
  if (side === 'self') row.insertAdjacentHTML('beforeend', renderAvatar(personaAvatarSource(), 'avatar chat-avatar'));
  dom.chatThread.appendChild(row);
}

async function submitThreadAction(action, replyCtx = '') {
  const chat = getActiveChat();
  const threadId = String(chat?.backend?.threadId || uiState.activeChatKey || '').trim();
  if (!backendEnabled || !threadId || !action) return;
  uiState.isGenerating = true;
  updateMagicWandState();
  try {
    setChatStatus('正在提交命令审批...');
    await requestBackend(`/threads/${encodeURIComponent(threadId)}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, replyCtx }),
    });
    setChatStatus('审批已提交，正在刷新会话。');
    window.setTimeout(() => {
      loadThreadMessages(threadId, { force: true, recordRecentAssistant: true })
        .then(() => renderAll())
        .catch((error) => setChatStatus(error instanceof Error ? error.message : '审批后刷新失败', true));
    }, 1200);
  } catch (error) {
    setChatStatus(error instanceof Error ? error.message : '审批提交失败', true);
  } finally {
    uiState.isGenerating = false;
    updateMagicWandState();
  }
}

function renderChat() {
  const chat = getActiveChat();
  if (!chat) {
    dom.chatTitle.textContent = '暂无聊天';
    dom.chatSubtitle.textContent = '';
    if (dom.chatHeaderAvatar) dom.chatHeaderAvatar.innerHTML = '';
    dom.chatThread.innerHTML = '';
    clearWaifuDisplayTimers();
    updatePromptPreview();
    renderAttachmentStrip();
    updateRuntimePassThroughToggle();
    return;
  }
  dom.chatTitle.textContent = chat.name;
  dom.chatSubtitle.textContent = chat.subtitle;
  if (dom.chatHeaderAvatar) dom.chatHeaderAvatar.innerHTML = renderAvatar(chat, 'avatar');
  clearWaifuDisplayTimers();
  dom.chatThread.innerHTML = '';
  const waifuSettings = resolveChatWaifuSettings(chat);

  chat.messages.forEach((message) => {
    const waifuSegments = getWaifuDisplaySegments(message, chat);
    if (waifuSegments.length) {
      let previousSegmentText = '';
      waifuSegments.forEach((segmentText, index) => {
        const isLastSegment = index === waifuSegments.length - 1;
        appendChatMessageRow(message, chat, {
          rowClass: 'chat-message-waifu-line',
          bubbleClass: 'bubble-message-waifu',
          textHtml: renderBubbleTextHtml(segmentText),
          includeAttachments: isLastSegment,
          includeActions: isLastSegment,
          hidden: message.waifuDisplayPending === true && index > 0,
          waifuDelayMs: index > 0
            ? getWaifuSegmentDelay(previousSegmentText || segmentText, waifuSettings)
            : 0,
          waifuSegmentIndex: index,
        });
        previousSegmentText = `${previousSegmentText}${segmentText}`;
      });
      return;
    }
    appendChatMessageRow(message, chat);
  });

  updatePromptPreview();
  renderAttachmentStrip();
  updateMagicWandState();
  updateRuntimePassThroughToggle();

  requestAnimationFrame(() => {
    scheduleWaifuSegments(chat);
    dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
  });
}

function renderMoments() {
  const targets = [dom.momentsList, dom.momentsMainList].filter(Boolean);
  targets.forEach((target) => {
    target.innerHTML = '';

    state.moments.forEach((moment) => {
      const card = document.createElement('article');
      card.className = 'moment-card';
      card.innerHTML = `
        <div class="moment-topline">
          <strong>${moment.author}</strong>
          <span class="tag">${moment.mood}</span>
        </div>
        <p class="moment-meta">${moment.text}</p>
        <div class="moment-actions">
          <span>点赞 ${moment.likes}</span>
          <span>评论 ${moment.comments}</span>
        </div>
      `;
      target.appendChild(card);
    });
  });
}

function submitMoment(value) {
  const text = value.trim();
  if (!text) return false;

  state.moments.unshift({
    author: state.persona.name,
    mood: '刚刚',
    text,
    likes: 0,
    comments: 0,
  });

  saveState();
  queueStateSync();
  renderMoments();
  return true;
}

function renderForumPosts() {
  dom.forumList.innerHTML = '';

  state.forumPosts.forEach((post) => {
    const card = document.createElement('article');
    card.className = 'moment-card';
    card.innerHTML = `
      <div class="moment-topline">
        <strong>${post.title}</strong>
        <span class="tag">${post.tag}</span>
      </div>
      <p class="moment-meta">${post.text}</p>
      <div class="moment-actions">
        <span>回复 ${post.replies}</span>
        <span>收藏 ${post.favorites}</span>
      </div>
    `;
    dom.forumList.appendChild(card);
  });
}

function renderMemories() {
  dom.memoryList.innerHTML = '';

  state.memories.forEach((memory) => {
    const card = document.createElement('article');
    card.className = 'memory-card';
    card.innerHTML = `
      <strong>${memory.title}</strong>
      <p>${memory.text}</p>
      <div class="tag-row">${memory.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>
    `;
    dom.memoryList.appendChild(card);
  });
}

function renderWorldbook() {
  dom.worldbookList.innerHTML = '';

  state.worldbook.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'world-card';
    const keywords = Array.isArray(entry.keys) && entry.keys.length
      ? `<div class="tag-row">${entry.keys.map((key) => `<span class="tag">${escapeHtml(key)}</span>`).join('')}</div>`
      : '';
    card.innerHTML = `
      <strong>${escapeHtml(entry.title)}</strong>
      <p>${escapeHtml(entry.text)}</p>
      ${keywords}
      <div class="tag-row">${entry.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>
    `;
    dom.worldbookList.appendChild(card);
  });
}

function renderJournals() {
  dom.journalList.innerHTML = '';

  state.journals.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'journal-card';
    card.innerHTML = `
      <strong>${entry.title}</strong>
      <span class="tag">${entry.date}</span>
      <p>${entry.text}</p>
    `;
    dom.journalList.appendChild(card);
  });
}

function renderProfile() {
  if (dom.profileName) dom.profileName.textContent = state.persona.name;
  if (dom.profileSignature) dom.profileSignature.textContent = state.persona.signature;
  if (dom.desktopGreeting) dom.desktopGreeting.textContent = `晚上好，${state.persona.name}`;
  if (dom.desktopWeather) dom.desktopWeather.textContent = '晴 23°C · 海边风轻';
  if (dom.personaCount) dom.personaCount.textContent = state.persona.masks;
  if (dom.memoryCount) dom.memoryCount.textContent = state.memories.length;
  if (dom.journalCount) dom.journalCount.textContent = state.journals.length;
  if (dom.personaPreviewName) dom.personaPreviewName.textContent = state.persona.name;
  if (dom.personaPreviewBio) dom.personaPreviewBio.textContent = state.persona.bio;

  if (dom.themeSelect) dom.themeSelect.value = state.theme;
  if (dom.apiNameInput) dom.apiNameInput.value = state.apiSettings.apiName;
  if (dom.apiUrlInput) dom.apiUrlInput.value = state.apiSettings.apiUrl;
  if (dom.apiKeyInput) dom.apiKeyInput.value = state.apiSettings.apiKey;
  if (dom.modelNameInput) dom.modelNameInput.value = state.apiSettings.modelName;
  if (dom.temperatureInput) dom.temperatureInput.value = state.apiSettings.temperature;
  if (dom.maxTokensInput) dom.maxTokensInput.value = state.apiSettings.maxTokens;
  if (dom.systemPromptInput) dom.systemPromptInput.value = state.apiSettings.systemPrompt;
  if (dom.likeGirlServiceUrlInput) dom.likeGirlServiceUrlInput.value = state.standaloneApps?.likeGirl?.url || 'http://127.0.0.1:4103/';
  if (dom.likeGirlCloneServiceUrlInput) dom.likeGirlCloneServiceUrlInput.value = state.standaloneApps?.likeGirlClone?.url || 'http://127.0.0.1:4108/';

  if (dom.personaNameInput) dom.personaNameInput.value = state.persona.name;
  if (dom.personaSignatureInput) dom.personaSignatureInput.value = state.persona.signature;
  if (dom.personaBioInput) dom.personaBioInput.value = state.persona.bio;
  renderMyProfile();
}

function renderDesktopBadge() {
  const badge = document.querySelector('#desktop-unread');
  if (!badge) return;
  const unreadCount = Object.values(state.chats).reduce((sum, chat) => sum + (chat.unread || 0), 0);
  badge.textContent = unreadCount;
  badge.style.display = unreadCount ? 'grid' : 'none';
}

function renderLockNotification() {
  const chat = Object.values(state.chats).find((entry) => entry.unread) || getFallbackChat();
  if (!chat) {
    dom.lockNoticeTitle.textContent = 'SmallPhone';
    dom.lockNoticeText.textContent = '暂无新消息';
    return;
  }
  dom.lockNoticeTitle.textContent = chat.name;
  dom.lockNoticeText.textContent = chat.summary;
}

function renderCharacterEditor() {
  const chatEntries = Object.entries(state.chats);
  dom.characterSelect.innerHTML = chatEntries
    .map(([key, chat]) => `<option value="${key}">${chat.name}</option>`)
    .join('');
  const editingKey = resolvePreferredChatKey(state.chats, uiState.editingCharacterKey);
  if (editingKey && editingKey !== uiState.editingCharacterKey) {
    uiState.editingCharacterKey = editingKey;
  }
  dom.characterSelect.value = uiState.editingCharacterKey;

  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  if (!chat) return;
  const waifuSettings = resolveChatWaifuSettings(chat);
  const timeSettings = resolveChatTimeSettings(chat);
  dom.characterNameInput.value = chat.name;
  if (dom.characterAvatarTextInput) dom.characterAvatarTextInput.value = String(chat.avatarText || chat.name.slice(0, 1) || '').slice(0, 2);
  renderCharacterAvatarPreview(chat);
  dom.characterDescriptionInput.value = chat.description;
  if (dom.characterRoleLevelSelect) dom.characterRoleLevelSelect.value = normalizeRoleLevel(chat.roleLevel);
  if (dom.characterAgentTypeSelect) dom.characterAgentTypeSelect.value = normalizeAgentType(chat.agentType);
  const runtimeThreadId = getCharacterRuntimeThreadId(chat);
  const runtimeSettings = getLoadedCharacterRuntimeSettings(runtimeThreadId);
  const permissionSnapshot = uiState.permissionSnapshot?.threadId === (chat.backend?.threadId || uiState.editingCharacterKey)
    ? uiState.permissionSnapshot
    : null;
  renderAgentModeSelect(
    runtimeSettings?.mode || runtimeSettings?.agentMode || permissionSnapshot?.agentMode || chat.agentMode || chat.backend?.permissionPolicy?.agentMode || '',
    permissionSnapshot?.agentType || chat.agentType,
    permissionSnapshot?.agentCapabilities?.modes,
  );
  dom.characterSubtitleInput.value = chat.subtitle;
  dom.characterSummaryInput.value = chat.summary;
  dom.characterPersonalityInput.value = chat.personality || '';
  dom.characterScenarioInput.value = chat.scenario || '';
  dom.characterSystemPromptInput.value = chat.systemPrompt || '';
  dom.characterProactiveToggle.checked = chat.proactiveContactEnabled !== false;
  if (dom.characterWaifuTextModeToggle) dom.characterWaifuTextModeToggle.checked = waifuSettings.enabled;
  if (dom.characterWaifuRemovePunctuationToggle) dom.characterWaifuRemovePunctuationToggle.checked = waifuSettings.removePunctuation;
  if (dom.characterWaifuDelayInput) dom.characterWaifuDelayInput.value = String(waifuSettings.typingDelayMsPerChar);
  if (dom.characterWaifuDelayValue) dom.characterWaifuDelayValue.textContent = `${waifuSettings.typingDelayMsPerChar} ms/字`;
  if (dom.characterTimeInjectionToggle) dom.characterTimeInjectionToggle.checked = timeSettings.enabled;
  if (dom.characterTimezoneInput) dom.characterTimezoneInput.value = timeSettings.timezone;
  dom.characterPreviewName.textContent = chat.name;
  dom.characterPreviewDescription.textContent = chat.description;
  if (dom.characterSubmitButton) {
    dom.characterSubmitButton.textContent = characterCreateDraftKey === uiState.editingCharacterKey ? '创建联系人' : '保存角色';
  }
  renderCharacterRuntimeSettings();
}

dom.characterAgentTypeSelect?.addEventListener('change', () => {
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  renderAgentModeSelect('', dom.characterAgentTypeSelect.value || chat?.agentType || 'codex');
  renderCharacterRuntimeSettings();
});

dom.characterWaifuDelayInput?.addEventListener('input', () => {
  const value = Number(dom.characterWaifuDelayInput.value || DEFAULT_WAIFU_DELAY_MS_PER_CHAR);
  if (dom.characterWaifuDelayValue) dom.characterWaifuDelayValue.textContent = `${value} ms/字`;
});

dom.characterAvatarTextInput?.addEventListener('input', () => {
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  if (!chat) return;
  chat.avatarText = dom.characterAvatarTextInput.value.trim().slice(0, 2) || chat.name.slice(0, 1) || '聊';
  renderCharacterAvatarPreview(chat);
});

dom.characterAvatarUploadButton?.addEventListener('click', () => {
  if (!backendEnabled) {
    setChatStatus('头像上传需要连接 smallphone-app 后端。', true);
    return;
  }
  dom.characterAvatarFileInput?.click();
});

dom.characterAvatarRemoveButton?.addEventListener('click', () => {
  removeCharacterAvatarImage();
  setChatStatus('头像图片已移除，保存角色后会同步到后端。');
});

dom.characterAvatarFileInput?.addEventListener('change', () => {
  const file = dom.characterAvatarFileInput.files?.[0] || null;
  dom.characterAvatarFileInput.value = '';
  if (!file) return;
  uploadCharacterAvatar(file).catch((error) => {
    setChatStatus(error instanceof Error ? error.message : '头像上传失败', true);
  });
});

dom.myAvatarTextInput?.addEventListener('input', () => {
  state.persona.avatarText = dom.myAvatarTextInput.value.trim().slice(0, 2) || state.persona.name.slice(0, 1) || '你';
  renderMyProfile();
});

dom.myAvatarUploadButton?.addEventListener('click', () => {
  if (!backendEnabled) {
    setChatStatus('头像上传需要连接 smallphone-app 后端。', true);
    return;
  }
  dom.myAvatarFileInput?.click();
});

dom.myAvatarRemoveButton?.addEventListener('click', () => {
  removeMyAvatarImage();
  setChatStatus('个人头像图片已移除。');
});

dom.myAvatarFileInput?.addEventListener('change', () => {
  const file = dom.myAvatarFileInput.files?.[0] || null;
  dom.myAvatarFileInput.value = '';
  if (!file) return;
  uploadMyAvatar(file).catch((error) => {
    setChatStatus(error instanceof Error ? error.message : '头像上传失败', true);
  });
});

dom.permissionContactSelect?.addEventListener('change', () => {
  uiState.permissionTargetChatKey = dom.permissionContactSelect.value;
  uiState.permissionSnapshot = null;
  renderPermissionPanel();
  loadActivePermissions({ force: true })
    .then(() => renderPermissionPanel())
    .catch((error) => {
      uiState.permissionSnapshot = null;
      renderPermissionPanel(error instanceof Error ? error.message : String(error));
    });
});

function renderPermissionContactSelect() {
  if (!dom.permissionContactSelect) return;
  const selectedKey = resolvePermissionTargetChatKey();
  dom.permissionContactSelect.innerHTML = getChatEntries()
    .map(([key, chat]) => {
      const threadId = String(chat?.backend?.threadId || key || '').trim();
      const label = chat?.name || key;
      const project = chat?.backend?.runtimeProject || chat?.backend?.project || threadId;
      return `<option value="${escapeHtml(key)}" ${key === selectedKey ? 'selected' : ''}>${escapeHtml(label)} · ${escapeHtml(project)}</option>`;
    })
    .join('');
}


function renderPermissionPanel(errorMessage = '') {
  renderPermissionContactSelect();
  if (!dom.permissionTemplateGrid || !dom.permissionDecisionStack) return;
  const targetKey = resolvePermissionTargetChatKey();
  const chat = getPermissionTargetChat();
  const snapshot = uiState.permissionSnapshot;
  if (!backendEnabled) {
    dom.permissionPanelSummary.textContent = '当前为本地前端模式，权限需要连接 smallphone-app 后端。';
    dom.permissionPanelSource.textContent = 'local';
    dom.permissionTemplateGrid.innerHTML = '';
    dom.permissionDecisionStack.innerHTML = '';
    return;
  }
  if (errorMessage) {
    dom.permissionPanelSummary.textContent = errorMessage;
    dom.permissionPanelSource.textContent = 'error';
    dom.permissionTemplateGrid.innerHTML = '';
    dom.permissionDecisionStack.innerHTML = '';
    return;
  }
  if (!chat || !snapshot) {
    dom.permissionPanelSummary.textContent = '打开权限面板后会读取当前联系人的权限。';
    dom.permissionPanelSource.textContent = 'loading';
    dom.permissionTemplateGrid.innerHTML = '';
    dom.permissionDecisionStack.innerHTML = '';
    return;
  }

  const capabilities = snapshot.agentCapabilities || {};
  const modes = normalizeRuntimeModeOptions(capabilities.modes) || getAgentModeOptions(snapshot.agentType || chat.agentType);
  const currentMode = snapshot.agentMode || chat.agentMode || modes[0]?.key || '';
  dom.permissionPanelSummary.textContent = `${snapshot.contactName || chat.name} · agent=${snapshot.agentType || chat.agentType || 'codex'} · project=${snapshot.runtimeProject || snapshot.project || ''}`;
  dom.permissionPanelSource.textContent = capabilities.source === 'cc-connect-project'
    ? 'cc-connect project'
    : snapshot.evaluation?.remote_error
      ? 'local fallback'
      : snapshot.configured
        ? 'cc-connect'
        : 'local';
  dom.permissionTemplateGrid.innerHTML = modes
    .map((mode) => {
      const [title, description] = String(mode.label || mode.key).split(' · ');
      return `
        <button class="permission-mode ${mode.key === currentMode ? 'permission-mode-active' : ''}" data-permission-mode="${escapeHtml(mode.key)}" type="button">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(description || '')}</span>
        </button>
      `;
    })
    .join('');
  dom.permissionTemplateGrid.querySelectorAll('[data-permission-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      saveActivePermissionMode(button.dataset.permissionMode).catch((error) => {
        renderPermissionPanel(error instanceof Error ? error.message : String(error));
      });
    });
  });

  const decisions = Object.values(snapshot.evaluation?.decisions || {});
  dom.permissionDecisionStack.innerHTML = decisions.length
    ? decisions.map((decision) => `
        <article class="permission-decision permission-${escapeHtml(decision.level || 'ask')}">
          <div>
            <strong>${escapeHtml(decision.permission)}</strong>
            <span>source: ${escapeHtml(decision.source || '-')}</span>
          </div>
          <em>${escapeHtml(decision.level || 'ask')}</em>
        </article>
      `).join('')
    : '<article class="info-card">暂无权限评估。</article>';
}

function setImportResult(message, isError = false) {
  dom.importResult.textContent = message;
  dom.importResult.style.color = isError ? '#c94a6a' : '';
}

function readImportSource() {
  const text = dom.importJsonInput.value.trim();
  if (text) return Promise.resolve(text);

  const file = dom.importFileInput.files?.[0];
  if (!file) throw new Error('请先粘贴 JSON 或选择导入文件');

  return file.text();
}

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message) => {
      if (typeof message === 'string') {
        return { side: 'other', text: message };
      }

      const text = String(message.text || message.mes || message.content || '').trim();
      if (!text) return null;

      const name = String(message.name || '').trim();
      const isUser = message.side === 'self' || message.is_user === true || name === state.persona.name || name === 'user';
      return {
        side: isUser ? 'self' : 'other',
        text,
      };
    })
    .filter(Boolean);
}

function importCharacter(payload) {
  const data = payload.data || payload;
  const name = String(data.name || data.character_name || '').trim();
  if (!name) throw new Error('角色卡缺少名称');

  const key = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-|-$/g, '') || `char-${Date.now()}`;
  const firstLine = String(data.first_mes || data.greeting || data.firstMessage || '').trim();
  const description = String(data.description || data.personality || data.scenario || '已导入角色').trim();
  const mesExample = String(data.mes_example || data.example_dialogue || '').trim();
  const avatarImage = normalizeImportedAvatarImage(data.avatarImage || data.avatar_image || data.extensions?.avatarImage || data.extensions?.avatar_image);

  state.chats[key] = {
    name,
    subtitle: '已导入角色',
    avatarClass: 'avatar-pink',
    avatarText: name.slice(0, 1),
    avatarImage,
    avatarAttachmentId: '',
    proactiveContactEnabled: true,
    unread: 0,
    summary: firstLine || description.slice(0, 34) || '已导入角色卡',
    time: '刚刚',
    description,
    roleLevel: 'contact',
    agentType: '',
    personality: String(data.personality || '').trim(),
    scenario: String(data.scenario || '').trim(),
    systemPrompt: String(data.system_prompt || data.systemPrompt || '').trim(),
    messages: normalizeChatMessages([
      firstLine ? { text: firstLine } : null,
      mesExample ? { text: mesExample } : null,
    ].filter(Boolean)),
  };

  uiState.activeChatKey = key;
  uiState.editingCharacterKey = key;
}

function normalizeImportedAvatarImage(value) {
  const raw = String(value || '').trim();
  return raw.startsWith('data:image/') ? raw : '';
}

function importWorldbook(payload, mode) {
  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload.worldbook)
        ? payload.worldbook
        : [];

  if (!entries.length) throw new Error('世界书内容为空');

  const mappedEntries = entries.map((entry, index) => ({
    title: String(entry.title || entry.key || entry.name || `词条 ${index + 1}`).trim(),
    text: String(entry.text || entry.content || entry.comment || '').trim() || '已导入世界书词条',
    tags: Array.isArray(entry.tags) && entry.tags.length ? entry.tags.map((tag) => String(tag)) : ['导入'],
    keys: Array.isArray(entry.key)
      ? entry.key.map((item) => String(item))
      : Array.isArray(entry.keys)
        ? entry.keys.map((item) => String(item))
        : String(entry.key || '').split(',').map((item) => item.trim()).filter(Boolean),
    enabled: entry.enabled !== false,
  }));

  state.worldbook = mode === 'append' ? [...state.worldbook, ...mappedEntries] : mappedEntries;
}

function importChat(payload, mode) {
  const data = payload.data || payload;
  const messages = normalizeChatMessages(data.messages || data.chat || data.history || data);
  if (!messages.length) throw new Error('聊天记录为空');

  const characterName = String(data.character_name || data.character || data.name || '导入聊天').trim();
  const key = Object.entries(state.chats).find(([, chat]) => chat.name === characterName)?.[0]
    || `chat-${Date.now()}`;

  if (!state.chats[key]) {
    state.chats[key] = {
      name: characterName,
      subtitle: '已导入聊天',
      avatarClass: 'avatar-blue',
      avatarText: characterName.slice(0, 1) || '聊',
      proactiveContactEnabled: true,
      unread: 0,
      summary: messages[messages.length - 1]?.text || '已导入聊天记录',
      time: '刚刚',
      description: '由聊天记录导入生成',
      roleLevel: 'contact',
      agentType: '',
      messages,
    };
  } else {
    state.chats[key].messages = mode === 'append' ? [...state.chats[key].messages, ...messages] : messages;
    state.chats[key].summary = messages[messages.length - 1]?.text || state.chats[key].summary;
    state.chats[key].time = '刚刚';
  }

  uiState.activeChatKey = key;
}

function detectImportType(payload) {
  if (payload.character || payload.data?.character_book || payload.first_mes || payload.name) return 'character';
  if (payload.worldbook || payload.entries || Array.isArray(payload.entries)) return 'worldbook';
  if (payload.chat || payload.history || payload.messages || Array.isArray(payload)) return 'chat';
  throw new Error('无法自动识别导入类型');
}

function handleImport(type, mode, payload) {
  const importType = type === 'auto' ? detectImportType(payload) : type;

  if (payload.character && (type === 'auto' || type === 'character')) {
    importCharacter(payload.character);
  } else if (importType === 'character') {
    importCharacter(payload);
  }

  if (payload.worldbook && (type === 'auto' || type === 'worldbook')) {
    importWorldbook(payload.worldbook, mode);
  } else if (importType === 'worldbook') {
    importWorldbook(payload, mode);
  }

  if (payload.chat && (type === 'auto' || type === 'chat')) {
    importChat(payload.chat, mode);
  } else if (importType === 'chat') {
    importChat(payload, mode);
  }
}

function renderAll() {
  applyTheme();
  applyPhoneShell();
  renderDesktopApps();
  applyDesktopPage();
  refreshWorld();
  renderMessages();
  renderContacts();
  renderCharacterHighlight();
  renderChat();
  renderMoments();
  renderForumPosts();
  renderMemories();
  renderWorldbook();
  renderJournals();
  refreshRegisteredApps();
  renderDynamicRegistryStatus();
  renderServiceManagerPanel();
  renderDynamicAppView();
  renderProfile();
  renderDesktopBadge();
  renderLockNotification();
  renderCharacterEditor();
  renderPermissionPanel();
  updatePromptPreview();
  updateRuntimePassThroughToggle();
}

dom.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    uiState.previousView = tab.dataset.tab;
    closePanel();
    setPhoneShell('app');
    setActiveView(tab.dataset.tab);
  });
});

document.querySelectorAll('[data-panel-target]').forEach((button) => {
  button.addEventListener('click', () => {
    setPhoneShell('app');
    openPanel(button.dataset.panelTarget);
  });
});

document.querySelectorAll('[data-desktop-target]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.desktopTarget;
    if (!target) return;
    uiState.previousView = target;
    closePanel();
    setPhoneShell('app');
    setActiveView(target);
  });
});

document.querySelectorAll('[data-open-chat]').forEach((button) => {
  button.addEventListener('click', () => {
    void openChat(button.dataset.openChat);
  });
});

dom.closePanelButton.addEventListener('click', closePanel);
dom.panelBackButton.addEventListener('click', closePanel);

dom.unlockButton.addEventListener('click', () => {
  setPhoneShell('desktop');
});

if (dom.enterAppButton) {
  dom.enterAppButton.addEventListener('click', () => {
    setPhoneShell('app');
  });
}

dom.relockButton.addEventListener('click', () => {
  closeThreadEventStream();
  setPhoneShell('lock');
});

dom.appExitButton.addEventListener('click', () => {
  closeThreadEventStream();
  closePanel();
  setPhoneShell('desktop');
});

dom.dynamicAppFrame?.addEventListener('load', () => {
  const url = String(activeDynamicApp?.launchUrl || '').trim();
  if (!url) return;
  const host = getDynamicAppHost(url);
  setDynamicAppFrameStatus(host ? `已打开 ${host}` : '已打开');
  showDynamicAppEmpty('');
});

dom.dynamicAppFrame?.addEventListener('error', () => {
  setDynamicAppFrameStatus('无法加载 App', true);
  showDynamicAppEmpty('无法加载 App，请检查服务是否正在运行。', true);
});

[dom.desktopCameraApp, dom.dockCameraApp].filter(Boolean).forEach((button) => {
  button.addEventListener('click', () => {
    setPhoneShell('app');
    setActiveView('contacts');
  });
});

dom.desktopDots.forEach((dot) => {
  dot.addEventListener('click', () => {
    setDesktopPage(Number(dot.dataset.desktopDot));
  });
});

dom.desktopPages.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  uiState.desktopTouchStartX = touch.clientX;
  uiState.desktopTouchStartY = touch.clientY;
}, { passive: true });

dom.desktopPages.addEventListener('touchend', (event) => {
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - uiState.desktopTouchStartX;
  const deltaY = touch.clientY - uiState.desktopTouchStartY;

  if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
  setDesktopPage((state.desktop?.page || 0) + (deltaX < 0 ? 1 : -1));
}, { passive: true });

dom.backButton.addEventListener('click', () => {
  closeThreadEventStream();
  setActiveView(uiState.previousView === 'contacts' ? 'contacts' : 'messages');
});

dom.markReadButton.addEventListener('click', () => {
  Object.values(state.chats).forEach((chat) => {
    chat.unread = 0;
  });
  saveState();
  queueStateSync();
  renderMessages();
  renderDesktopBadge();
  renderLockNotification();
});

if (dom.attachmentButton) {
  dom.attachmentButton.addEventListener('click', () => {
    if (!backendEnabled) {
      setChatStatus('附件需要连接 smallphone-app 后端。', true);
      return;
    }
    dom.chatAttachmentInput?.click();
  });
}

if (dom.chatAttachmentInput) {
  dom.chatAttachmentInput.addEventListener('change', () => {
    const files = dom.chatAttachmentInput.files;
    dom.chatAttachmentInput.value = '';
    if (!files?.length) return;
    uploadChatAttachments(files).catch((error) => {
      setChatStatus(error instanceof Error ? error.message : '附件上传失败', true);
    });
  });
}

if (dom.magicWandButton) {
  dom.magicWandButton.addEventListener('click', () => {
    void flushPendingOutbox();
  });
}

dom.chatInput?.addEventListener('input', () => {
  updateSlashCommandPalette();
});

dom.chatInput?.addEventListener('focus', () => {
  updateSlashCommandPalette();
});

dom.chatInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && slashCommandState.open) {
    event.preventDefault();
    closeSlashCommandPalette();
    return;
  }

  if (!slashCommandState.open) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSlashCommandSelection(1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSlashCommandSelection(-1);
    return;
  }

  if (event.key === 'Enter' && slashCommandState.matches.length) {
    event.preventDefault();
    submitSlashCommand(slashCommandState.matches[slashCommandState.activeIndex]?.command);
  }
});

document.addEventListener('click', (event) => {
  if (!slashCommandState.open) return;
  if (dom.chatInputShell?.contains(event.target)) return;
  closeSlashCommandPalette();
});

dom.runtimePassThroughToggle?.addEventListener('click', () => {
  uiState.runtimePassThroughEnabled = !uiState.runtimePassThroughEnabled;
  updateRuntimePassThroughToggle();
});

dom.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const hasAttachments = Array.isArray(uiState.pendingAttachments) && uiState.pendingAttachments.length > 0;
  const { text: value, runtimePassThrough } = prepareChatSubmit(dom.chatInput.value, hasAttachments);
  if (!value && !hasAttachments) return;

  const chat = getActiveChat();
  if (!chat) return;
  queueLocalUserMessage(chat, value, { runtimePassThrough });

  if (value && state.memories.length < 12) {
    state.memories.unshift({
      title: '聊天碎片',
      text: value,
      tags: ['新对话', chat.name],
    });
  }

  dom.chatInput.value = '';
  closeSlashCommandPalette();
  saveState();
  renderAll();
  if (backendEnabled) {
    setChatStatus(runtimePassThrough
      ? '正在通过 smallphone-app 肘击 AI...'
      : '正在发送到 smallphone-app 后端...');
    void flushPendingOutbox();
    return;
  }
  setChatStatus('已先放在前端。点魔法棒后生成回复。');
});

dom.memoryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = dom.memoryInput.value.trim();
  if (!value) return;

  state.memories.unshift({
    title: '新增记忆',
    text: value,
    tags: ['手动添加', '长期'],
  });

  dom.memoryInput.value = '';
  saveState();
  queueStateSync('记忆已保存在前端本地。');
  renderMemories();
  renderProfile();
});

dom.momentsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!submitMoment(dom.momentsInput.value)) return;
  dom.momentsInput.value = '';
  if (dom.momentsMainInput) dom.momentsMainInput.value = '';
});

if (dom.momentsMainForm && dom.momentsMainInput) {
  dom.momentsMainForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!submitMoment(dom.momentsMainInput.value)) return;
    dom.momentsMainInput.value = '';
    dom.momentsInput.value = '';
  });
}

dom.forumForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = dom.forumTitle.value.trim();
  const text = dom.forumInput.value.trim();
  if (!title || !text) return;

  state.forumPosts.unshift({
    title,
    text,
    replies: 0,
    favorites: 0,
    tag: '新帖',
  });

  dom.forumTitle.value = '';
  dom.forumInput.value = '';
  saveState();
  queueStateSync();
  renderForumPosts();
});

dom.characterSelect.addEventListener('change', () => {
  const previousDraftKey = characterCreateDraftKey;
  uiState.editingCharacterKey = dom.characterSelect.value;
  if (previousDraftKey && previousDraftKey !== uiState.editingCharacterKey) {
    discardUnsavedContactDraft();
  }
  renderCharacterEditor();
  renderCharacterHighlight();
  void loadCharacterRuntimeSettingsForCurrent({ force: true });
  if (backendEnabled) {
    void loadThreadMessages(uiState.editingCharacterKey).then(() => {
      renderChat();
    }).catch(() => {});
  }
});

if (dom.addContactButton) {
  dom.addContactButton.addEventListener('click', () => {
    beginCreateContact();
  });
}

dom.characterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const chat = state.chats[uiState.editingCharacterKey] || getFallbackChat();
  if (!chat) return;
  const isCreating = characterCreateDraftKey === uiState.editingCharacterKey;
  const editingKey = String(chat.backend?.threadId || uiState.editingCharacterKey || '').trim() || uiState.editingCharacterKey;
  chat.name = dom.characterNameInput.value.trim() || chat.name;
  chat.description = dom.characterDescriptionInput.value.trim() || chat.description;
  chat.avatarText = dom.characterAvatarTextInput?.value.trim().slice(0, 2) || chat.name.slice(0, 1) || chat.avatarText || '新';
  chat.roleLevel = normalizeRoleLevel(dom.characterRoleLevelSelect?.value || chat.roleLevel);
  chat.agentType = normalizeAgentType(dom.characterAgentTypeSelect?.value || chat.agentType);
  chat.agentMode = normalizeAgentPermissionMode(dom.characterAgentModeSelect?.value || chat.agentMode, chat.agentType);
  chat.subtitle = dom.characterSubtitleInput.value.trim() || chat.subtitle;
  chat.summary = dom.characterSummaryInput.value.trim() || chat.summary;
  chat.personality = dom.characterPersonalityInput.value.trim();
  chat.scenario = dom.characterScenarioInput.value.trim();
  chat.systemPrompt = dom.characterSystemPromptInput.value.trim();
  chat.proactiveContactEnabled = dom.characterProactiveToggle.checked;
  chat.waifuTextSettings = normalizeWaifuSettings({
    enabled: dom.characterWaifuTextModeToggle?.checked,
    removePunctuation: dom.characterWaifuRemovePunctuationToggle?.checked,
    typingDelayMsPerChar: dom.characterWaifuDelayInput?.value,
  });
  chat.timeSettings = normalizeTimeSettings({
    enabled: dom.characterTimeInjectionToggle?.checked,
    timezone: dom.characterTimezoneInput?.value,
  });
  chat.backend = {
    ...(chat.backend || {}),
    timeSettings: chat.timeSettings,
  };
  saveState();
  try {
    if (backendEnabled) {
      if (isCreating) {
        const createdKey = await createBackendCompanion(chat);
        characterCreateDraftKey = '';
        uiState.activeChatKey = createdKey || resolvePreferredChatKey(state.chats, uiState.activeChatKey) || uiState.activeChatKey;
        uiState.editingCharacterKey = uiState.activeChatKey;
        await loadCharacterRuntimeSettingsForCurrent({ force: true });
        setChatStatus('联系人已创建，9840 Runtime 已刷新。');
      } else {
        const syncedCharacter = await syncCharacterEdits(editingKey, chat);
        if (syncedCharacter) {
          const savedRuntimeSettings = await saveCharacterRuntimeSettingsIfAvailable(editingKey, chat);
          await refreshBackendState(editingKey);
          if (savedRuntimeSettings) {
            await loadCharacterRuntimeSettingsForCurrent({ force: true });
          }
          setChatStatus(savedRuntimeSettings
            ? '角色卡和 9840 Runtime 已同步到 smallphone-app。'
            : '角色卡已同步到 smallphone-app，9840 Runtime 当前不可用。');
        } else {
          await loadCharacterRuntimeSettingsForCurrent({ force: true });
          setChatStatus('角色卡已保存，当前联系人还没有后端项目。');
        }
      }
    } else {
      characterCreateDraftKey = '';
      queueStateSync(isCreating ? '联系人已创建。' : '角色卡已保存。');
    }
    renderAll();
  } catch (error) {
    setChatStatus(error instanceof Error ? error.message : '角色或 9840 Runtime 同步失败', true);
  }
});

dom.journalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = dom.journalTitle.value.trim();
  const text = dom.journalInput.value.trim();
  if (!title || !text) return;

  state.journals.unshift({
    title,
    text,
    date: '刚刚',
  });

  dom.journalTitle.value = '';
  dom.journalInput.value = '';
  saveState();
  queueStateSync();
  renderJournals();
  renderProfile();
});

dom.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.theme = dom.themeSelect.value;
  state.apiSettings.apiName = dom.apiNameInput.value.trim() || 'OpenAI / 自定义';
  state.apiSettings.apiUrl = dom.apiUrlInput.value.trim();
  state.apiSettings.apiKey = dom.apiKeyInput.value.trim();
  state.apiSettings.modelName = dom.modelNameInput.value.trim() || 'gpt-4o-mini';
  state.apiSettings.temperature = Number(dom.temperatureInput.value || 0.8);
  state.apiSettings.maxTokens = Number(dom.maxTokensInput.value || 512);
  state.apiSettings.systemPrompt = dom.systemPromptInput.value.trim()
    || '你是一个细腻、自然、重视日常氛围与连续记忆的陪伴式角色聊天模型。回复时保持口语化，不要暴露系统设定，不要把自己说成 AI。';
  saveState();
  renderProfile();
  applyTheme();
  updatePromptPreview();
  queueStateSync('设置已保存。之后发送消息会按当前角色卡、人设、记忆和世界书拼装上下文。');
});

dom.appRegistryRefreshButton?.addEventListener('click', () => {
  void refreshDynamicAppRegistry({ manual: true });
});

dom.serviceManagerRefreshButton?.addEventListener('click', () => {
  void refreshServiceManagerSnapshot({ manual: true });
});

dom.appManagerForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = normalizeStandaloneUrl(dom.likeGirlServiceUrlInput?.value);
  const cloneUrl = normalizeStandaloneUrl(dom.likeGirlCloneServiceUrlInput?.value, 'http://127.0.0.1:4108/');
  state.standaloneApps = {
    ...(state.standaloneApps || {}),
    likeGirl: {
      ...(state.standaloneApps?.likeGirl || {}),
      url,
    },
    likeGirlClone: {
      ...(state.standaloneApps?.likeGirlClone || {}),
      url: cloneUrl,
    },
  };
  saveState();
  renderAll();
  queueStateSync('App 配置已保存。桌面 LikeGirl 和分身图标会直接使用对应服务地址。');
});

dom.likeGirlOpenPublicButton?.addEventListener('click', () => {
  setLikeGirlLaunch('');
  closePanel();
  setPhoneShell('app');
  setActiveView('like-girl');
  refreshRegisteredApps();
});

dom.likeGirlOpenAdminButton?.addEventListener('click', () => {
  setLikeGirlLaunch('admin');
  closePanel();
  setPhoneShell('app');
  setActiveView('like-girl');
  refreshRegisteredApps();
});

dom.likeGirlCloneOpenPublicButton?.addEventListener('click', () => {
  setLikeGirlCloneLaunch('');
  closePanel();
  setPhoneShell('app');
  setActiveView('like-girl-clone');
  refreshRegisteredApps();
});

dom.likeGirlCloneOpenAdminButton?.addEventListener('click', () => {
  setLikeGirlCloneLaunch('admin');
  closePanel();
  setPhoneShell('app');
  setActiveView('like-girl-clone');
  refreshRegisteredApps();
});

dom.importsForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const raw = await readImportSource();
    const payload = JSON.parse(raw);
    handleImport(dom.importTypeSelect.value, dom.importModeSelect.value, payload);
    saveState();
    renderAll();
    setImportResult(
      backendEnabled
        ? '导入完成；当前版本仍保留前端本地导入，不写入 smallphone-app。'
        : '导入完成，已同步到角色、世界书或聊天记录。',
    );
  } catch (error) {
    setImportResult(error instanceof Error ? error.message : '导入失败', true);
  }
});

dom.personaForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.persona.name = dom.personaNameInput.value.trim() || '晚风';
  state.persona.signature = dom.personaSignatureInput.value.trim() || '今晚也想和喜欢的人说很多无关紧要的话。';
  state.persona.bio = dom.personaBioInput.value.trim() || '夜游爱好者，偏爱慢节奏聊天和旧书店。';
  saveState();
  queueStateSync('人设已保存在前端本地。');
  renderProfile();
  renderContacts();
  updatePromptPreview();
});

dom.myProfileForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  state.persona.name = dom.myNameInput.value.trim() || '晚风';
  state.persona.signature = dom.mySignatureInput.value.trim() || '今晚也想和喜欢的人说很多无关紧要的话。';
  state.persona.bio = dom.myBioInput.value.trim() || '夜游爱好者，偏爱慢节奏聊天和旧书店。';
  state.persona.avatarText = dom.myAvatarTextInput?.value.trim().slice(0, 2) || state.persona.name.slice(0, 1) || '你';
  saveState();
  queueStateSync('个人资料已保存。');
  renderProfile();
  renderContacts();
  updatePromptPreview();
});

dom.worldbookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = dom.worldbookTitleInput.value.trim();
  const text = dom.worldbookTextInput.value.trim();
  const keys = dom.worldbookKeysInput.value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!title || !text) return;

  const entry = {
    title,
    text,
    keys,
    enabled: true,
    tags: ['手动新增'],
  };

  try {
    if (backendEnabled) {
      await syncWorldbookEntry(entry);
      setChatStatus('世界书已同步到 smallphone-app。');
    } else {
      state.worldbook.unshift(entry);
      saveState();
      queueStateSync('世界书已保存。');
    }
    dom.worldbookTitleInput.value = '';
    dom.worldbookKeysInput.value = '';
    dom.worldbookTextInput.value = '';
    renderWorldbook();
    updatePromptPreview();
  } catch (error) {
    setChatStatus(error instanceof Error ? error.message : '世界书同步失败', true);
  }
});

dom.chatInput.addEventListener('input', () => {
  updatePromptPreview(dom.chatInput.value.trim());
});

mountRegisteredAppViews();
bindRegisteredApps();
bindWorld({ state, saveState, dom, apps: registeredApps, openAppSpace });
updateClock();
window.setInterval(updateClock, 60 * 1000);
setActiveView('messages');

bootstrapState()
  .then(async () => {
    await refreshDynamicAppRegistry();
    await refreshServiceManagerSnapshot();
  })
  .finally(() => {
    renderAll();
    setChatStatus(
      backendEnabled
        ? '已连接小手机后端。角色、记忆、世界书和聊天会通过后端统一管理。'
        : '当前为纯前端模式。可直接编辑角色卡、世界书、记忆；配置 OpenAI 兼容接口后即可真实聊天。',
    );
  });
