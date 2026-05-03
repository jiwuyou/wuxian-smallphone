import * as dom from './dom.js?v=3';
import { appModules, appSpaceTemplates, registeredApps } from './app-registry.js?v=3';
import { cloneDefaultState, panelMeta, saveState, state, uiState } from './state.js?v=3';
import { applyDesktopMode, bindWorld, renderWorld, renderWorldToolbar } from './world.js?v=3';

const DEFAULT_BACKEND_PORT = '3100';
const DEFAULT_BACKEND_BASE = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}/api`;
const BACKEND_STORAGE_KEY = 'smallphone.backendBase';
const AVATAR_CLASSES = ['avatar-pink', 'avatar-blue', 'avatar-gold', 'avatar-green'];
let backendEnabled = false;
let backendBase = DEFAULT_BACKEND_BASE;
let threadEventSource = null;
let threadEventSourceKey = '';
let characterCreateDraftKey = '';

const CORE_DESKTOP_APPS = [
  { id: 'messages', name: '消息', shortName: '聊', orbClass: 'orb-chat', target: 'messages', badge: 'unread' },
  { id: 'contacts', name: '联系人', shortName: '人', orbClass: 'orb-character', target: 'contacts' },
  { id: 'character', name: '角色', shortName: '角', orbClass: 'orb-world', panel: 'character' },
  { id: 'settings', name: '调试', shortName: '调', orbClass: 'orb-settings', panel: 'settings' },
  { id: 'permissions', name: '权限', shortName: '权', orbClass: 'orb-permission', panel: 'permissions' },
];

const DESKTOP_APPS_PER_PAGE = 8;

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

function mapMessagesToChatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.role !== 'system')
    .map((message) => ({
      side: message.role === 'user' ? 'self' : 'other',
      text: normalizeMessageContent(message.content),
    }))
    .filter((message) => message.text);
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
  const baseChatMessages = Array.isArray(messages) && messages.length
    ? mapMessagesToChatMessages(messages)
    : Array.isArray(previousChat?.messages)
      ? previousChat.messages
      : [];
  const chatMessages = baseChatMessages.filter((message) => !message?.pending);
  const pendingOutbox = Array.isArray(previousChat?.pendingOutbox) ? previousChat.pendingOutbox : [];
  const pendingMessages = pendingOutbox
    .map((item) => ({
      side: 'self',
      text: String(item?.text || '').trim(),
      pending: true,
      pendingId: item?.id || '',
    }))
    .filter((message) => message.text);
  const latestMessageText = chatMessages.at(-1)?.text || cleanThreadSummary(thread?.summary);
  const previousDescription = String(previousChat?.description || '').trim();
  const threadSummary = cleanThreadSummary(thread?.summary);
  const fallbackDescription = previousDescription && previousDescription !== latestMessageText && previousDescription !== threadSummary
    ? previousDescription
    : '这个联系人正在通过 SmallPhone 后端提供回复。';

  return {
    name: String(contact?.displayName || thread?.title || character?.name || '未命名联系人').trim(),
    subtitle: buildChatSubtitle(contact, thread, relationshipState),
    avatarClass: chooseAvatarClass(thread?.id || contact?.id || character?.id),
    avatarText: buildAvatarText(contact, character, thread?.title),
    proactiveContactEnabled: previousChat?.proactiveContactEnabled !== false,
    unread: Number(thread?.unreadCount || 0),
    summary: latestMessageText,
    time: formatRelativeThreadTime(thread?.updatedAt),
    description: String(character?.persona || fallbackDescription).trim(),
    roleLevel: normalizeRoleLevel(thread?.roleLevel || contact?.roleLevel || thread?.runtime?.roleLevel || previousChat?.roleLevel),
    agentType: normalizeAgentType(thread?.runtime?.agentType || previousChat?.agentType),
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
      proactiveContactEnabled: true,
      unread: 0,
      summary: '新的 SmallPhone 独立窗口。',
      time: '刚刚',
      description: '新的私人联系人。',
      roleLevel: 'contact',
      agentType: '',
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
  try {
    return await apiRequest(path, init);
  } catch (error) {
    disableBackendWithStatus(error instanceof Error ? `${error.message}，已回退本地模式。` : '后端请求失败，已回退本地模式。');
    throw error;
  }
}

async function refreshBackendState(threadId = uiState.activeChatKey) {
  const snapshot = await loadBackendSnapshot(requestBackend, { messageThreadId: threadId });
  return applyBackendSnapshot(snapshot, threadId);
}

async function loadThreadMessages(threadId, { force = false } = {}) {
  const key = String(threadId || '').trim();
  const chat = state.chats?.[key];
  if (!backendEnabled || !chat) return [];
  if (!force && Array.isArray(chat.messages) && chat.messages.length) return chat.messages;
  const messages = await requestBackend(`/threads/${encodeURIComponent(key)}/messages`);
  chat.messages = mapMessagesToChatMessages(messages);
  if (chat.messages.length) {
    chat.summary = chat.messages.at(-1).text;
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
  const chat = getActiveChat();
  const threadId = String(chat?.backend?.threadId || uiState.activeChatKey || '').trim();
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

async function saveActivePermissionTemplate(template) {
  const chat = getActiveChat();
  const threadId = String(chat?.backend?.threadId || uiState.activeChatKey || '').trim();
  if (!backendEnabled || !threadId || !template) return;
  const snapshot = await requestBackend(`/threads/${encodeURIComponent(threadId)}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ template }),
  });
  uiState.permissionSnapshot = { ...snapshot, threadId };
  await refreshBackendState(threadId);
  renderAll();
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

function getStreamingMessage(chat) {
  if (!chat) return null;
  return chat.messages.find((message) => message.streaming === true) || null;
}

function updateStreamingAssistant(threadId, content, done = false) {
  const key = String(threadId || '').trim();
  const text = String(content || '').trim();
  if (!key || !text || !state.chats?.[key]) return;
  const chat = state.chats[key];
  let message = getStreamingMessage(chat);
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
  if (type === 'assistant.stream' || type === 'assistant.done' || type === 'assistant.persisted') {
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
      await loadThreadMessages(key);
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

function getPendingOutbox(chat) {
  if (!chat) return [];
  if (!Array.isArray(chat.pendingOutbox)) chat.pendingOutbox = [];
  return chat.pendingOutbox;
}

function getPendingTexts(chat) {
  return getPendingOutbox(chat)
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean);
}

function updateMagicWandState() {
  if (!dom.magicWandButton) return;
  const count = getPendingTexts(getActiveChat()).length;
  dom.magicWandButton.classList.toggle('magic-wand-ready', count > 0);
  dom.magicWandButton.disabled = uiState.isGenerating || count === 0;
  dom.magicWandButton.title = count > 0
    ? `魔法棒：送 ${count} 条到后端`
    : '魔法棒：没有待送消息';
}

function queueLocalUserMessage(chat, text) {
  const pendingItem = {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
  };
  getPendingOutbox(chat).push(pendingItem);
  chat.messages.push({ side: 'self', text, pending: true, pendingId: pendingItem.id });
  chat.summary = text;
  chat.time = '刚刚';
}

async function flushPendingOutbox() {
  const chat = getActiveChat();
  if (!chat || uiState.isGenerating) return;
  const pendingTexts = getPendingTexts(chat);
  if (!pendingTexts.length) {
    setChatStatus('没有待送消息。');
    updateMagicWandState();
    return;
  }

  const batchText = pendingTexts.join('\n');
  uiState.isGenerating = true;
  dom.chatInput.disabled = true;
  dom.continueGenerateButton.disabled = true;
  updateMagicWandState();

  try {
    if (backendEnabled) {
      const threadId = String(chat.backend?.threadId || uiState.activeChatKey || '').trim();
      if (!threadId) throw new Error('当前聊天缺少 thread id，无法发送。');

      subscribeThreadEvents(threadId);
      setChatStatus(`正在把 ${pendingTexts.length} 条待送消息交给 smallphone-app...`);
      await requestBackend(`/threads/${encodeURIComponent(threadId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: batchText }),
      });
      chat.pendingOutbox = [];
      saveState();
      await refreshBackendState(threadId);
      await loadThreadMessages(threadId, { force: true });
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
    dom.continueGenerateButton.disabled = false;
    updateMagicWandState();
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

  uiState.isGenerating = true;
  dom.chatInput.disabled = true;
  dom.continueGenerateButton.disabled = true;
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

    chat.messages.push({ side: 'other', text: replyText });
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
    dom.continueGenerateButton.disabled = false;
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
  document.body.dataset.spatialView = activeView?.classList.contains('app-space-view') ? 'true' : 'false';
}

function applyPhoneShell() {
  const mode = state.phoneShell?.mode || 'lock';
  document.body.dataset.shell = mode;
  if (mode !== 'app') document.body.dataset.spatialView = 'false';
  dom.lockScreen.classList.toggle('overlay-active', mode === 'lock');
  dom.desktopScreen.classList.toggle('overlay-active', mode === 'desktop');
  dom.lockScreen.setAttribute('aria-hidden', String(mode !== 'lock'));
  dom.desktopScreen.setAttribute('aria-hidden', String(mode !== 'desktop'));
  dom.appExitButton.classList.toggle('app-exit-visible', mode === 'app');
}

function getDesktopAppEntries() {
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

function openDesktopApp(entry) {
  if (entry.panel) {
    setPhoneShell('app');
    openPanel(entry.panel);
    return;
  }

  if (!entry.target) return;
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
      <div class="avatar ${chat.avatarClass}">${chat.avatarText}</div>
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
      <div class="avatar ${chat.avatarClass}">${chat.avatarText}</div>
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
    <div class="avatar avatar-green">你</div>
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
      <div class="avatar ${chat.avatarClass}">${chat.avatarText}</div>
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

function renderChat() {
  const chat = getActiveChat();
  if (!chat) {
    dom.chatTitle.textContent = '暂无聊天';
    dom.chatSubtitle.textContent = '';
    dom.chatThread.innerHTML = '';
    updatePromptPreview();
    return;
  }
  dom.chatTitle.textContent = chat.name;
  dom.chatSubtitle.textContent = chat.subtitle;
  dom.chatThread.innerHTML = '';

  chat.messages.forEach((message) => {
    const bubble = document.createElement('div');
    bubble.className = `bubble bubble-${message.side}${message.pending ? ' bubble-pending' : ''}${message.streaming ? ' bubble-streaming' : ''}`;
    bubble.textContent = message.text;
    dom.chatThread.appendChild(bubble);
  });

  updatePromptPreview();
  updateMagicWandState();

  requestAnimationFrame(() => {
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

  if (dom.personaNameInput) dom.personaNameInput.value = state.persona.name;
  if (dom.personaSignatureInput) dom.personaSignatureInput.value = state.persona.signature;
  if (dom.personaBioInput) dom.personaBioInput.value = state.persona.bio;
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
  dom.characterNameInput.value = chat.name;
  dom.characterDescriptionInput.value = chat.description;
  if (dom.characterRoleLevelSelect) dom.characterRoleLevelSelect.value = normalizeRoleLevel(chat.roleLevel);
  if (dom.characterAgentTypeSelect) dom.characterAgentTypeSelect.value = normalizeAgentType(chat.agentType);
  dom.characterSubtitleInput.value = chat.subtitle;
  dom.characterSummaryInput.value = chat.summary;
  dom.characterPersonalityInput.value = chat.personality || '';
  dom.characterScenarioInput.value = chat.scenario || '';
  dom.characterSystemPromptInput.value = chat.systemPrompt || '';
  dom.characterProactiveToggle.checked = chat.proactiveContactEnabled !== false;
  dom.characterPreviewName.textContent = chat.name;
  dom.characterPreviewDescription.textContent = chat.description;
  if (dom.characterSubmitButton) {
    dom.characterSubmitButton.textContent = characterCreateDraftKey === uiState.editingCharacterKey ? '创建联系人' : '保存角色';
  }
}

function renderPermissionPanel(errorMessage = '') {
  if (!dom.permissionTemplateGrid || !dom.permissionDecisionStack) return;
  const chat = getActiveChat();
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

  const templates = snapshot.templates || {};
  const currentTemplate = snapshot.template || 'safe';
  const labels = {
    safe: ['安全模式', '只允许聊天，项目上下文和工具默认关闭。'],
    assist: ['协助模式', '允许读取上下文和只读工具，写入与命令保持确认。'],
    developer: ['开发模式', '适合主人开发使用，写入和命令仍保持谨慎。'],
    trusted: ['完全信任', '全部权限放行，只适合私有可信联系人。'],
  };
  dom.permissionPanelSummary.textContent = `${snapshot.contactName || chat.name} · ${snapshot.appId || 'chat'} · ${snapshot.contactId || ''}`;
  dom.permissionPanelSource.textContent = snapshot.evaluation?.remote_error
    ? 'local fallback'
    : snapshot.configured
      ? 'cc-connect'
      : 'local';
  dom.permissionTemplateGrid.innerHTML = Object.keys(templates)
    .map((template) => {
      const [title, description] = labels[template] || [template, ''];
      return `
        <button class="permission-mode ${template === currentTemplate ? 'permission-mode-active' : ''}" data-permission-template="${escapeHtml(template)}" type="button">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(description)}</span>
        </button>
      `;
    })
    .join('');
  dom.permissionTemplateGrid.querySelectorAll('[data-permission-template]').forEach((button) => {
    button.addEventListener('click', () => {
      saveActivePermissionTemplate(button.dataset.permissionTemplate).catch((error) => {
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

  state.chats[key] = {
    name,
    subtitle: '已导入角色',
    avatarClass: 'avatar-pink',
    avatarText: name.slice(0, 1),
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
  renderProfile();
  renderDesktopBadge();
  renderLockNotification();
  renderCharacterEditor();
  renderPermissionPanel();
  updatePromptPreview();
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

document.querySelectorAll('[data-chat-shortcut]').forEach((button) => {
  button.addEventListener('click', () => {
    dom.chatInput.value = button.dataset.chatShortcut;
    dom.chatInput.focus();
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

dom.continueGenerateButton.addEventListener('click', () => {
  if (!getActiveChat()) return;
  if (backendEnabled) {
    setChatStatus('smallphone-app 暂不支持无输入继续生成，请先输入一条消息。', true);
    return;
  }
  generateAssistantReply('', { continueOnly: true });
});

if (dom.magicWandButton) {
  dom.magicWandButton.addEventListener('click', () => {
    void flushPendingOutbox();
  });
}

dom.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = dom.chatInput.value.trim();
  if (!value) return;

  const chat = getActiveChat();
  if (!chat) return;
  queueLocalUserMessage(chat, value);

  if (state.memories.length < 12) {
    state.memories.unshift({
      title: '聊天碎片',
      text: value,
      tags: ['新对话', chat.name],
    });
  }

  dom.chatInput.value = '';
  saveState();
  renderAll();
  setChatStatus(
    backendEnabled
      ? '已先放在前端。点魔法棒再送到后端。'
      : '已先放在前端。点魔法棒后生成回复。',
  );
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
  chat.avatarText = chat.name.slice(0, 1) || chat.avatarText || '新';
  chat.roleLevel = normalizeRoleLevel(dom.characterRoleLevelSelect?.value || chat.roleLevel);
  chat.agentType = normalizeAgentType(dom.characterAgentTypeSelect?.value || chat.agentType);
  chat.subtitle = dom.characterSubtitleInput.value.trim() || chat.subtitle;
  chat.summary = dom.characterSummaryInput.value.trim() || chat.summary;
  chat.personality = dom.characterPersonalityInput.value.trim();
  chat.scenario = dom.characterScenarioInput.value.trim();
  chat.systemPrompt = dom.characterSystemPromptInput.value.trim();
  chat.proactiveContactEnabled = dom.characterProactiveToggle.checked;
  saveState();
  try {
    if (backendEnabled) {
      if (isCreating) {
        const createdKey = await createBackendCompanion(chat);
        characterCreateDraftKey = '';
        uiState.activeChatKey = createdKey || resolvePreferredChatKey(state.chats, uiState.activeChatKey) || uiState.activeChatKey;
        uiState.editingCharacterKey = uiState.activeChatKey;
        setChatStatus('联系人已创建。');
      } else {
        await syncCharacterEdits(editingKey, chat);
        setChatStatus('角色卡已同步到 smallphone-app。');
      }
    } else {
      characterCreateDraftKey = '';
      queueStateSync(isCreating ? '联系人已创建。' : '角色卡已保存。');
    }
    renderAll();
  } catch (error) {
    setChatStatus(error instanceof Error ? error.message : '角色同步失败', true);
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

dom.promptPreviewButton.addEventListener('click', async () => {
  setPhoneShell('app');
  openPanel('settings');
  try {
    const preview = await fetchPromptPreviewFromBackend(dom.chatInput.value.trim());
    if (!preview) updatePromptPreview(dom.chatInput.value.trim());
  } catch {
    updatePromptPreview(dom.chatInput.value.trim());
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

bootstrapState().finally(() => {
  renderAll();
  setChatStatus(
    backendEnabled
      ? '已连接小手机后端。角色、记忆、世界书和聊天会通过后端统一管理。'
      : '当前为纯前端模式。可直接编辑角色卡、世界书、记忆；配置 OpenAI 兼容接口后即可真实聊天。',
  );
});
