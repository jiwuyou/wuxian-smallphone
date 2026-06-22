import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'messages',
  name: '消息',
  shortName: '聊',
  orbClass: 'orb-chat',
  badge: 'unread',
  views: {
    normal: 'messages',
  },
};

export const template = `
  <section class="view messages-workspace" data-view="messages" data-component-app-id="messages">
    <div class="section-title-row">
      <h2>消息</h2>
      <button class="ghost-button" id="mark-read-button" type="button">全部已读</button>
    </div>

    <section class="message-overview" id="message-overview" data-message-overview>
      <div>
        <p class="eyebrow">桌面应用</p>
        <strong id="message-overview-title" data-message-overview-title>最近联系人</strong>
        <p id="message-overview-subtitle" data-message-overview-subtitle>从桌面进入消息后，继续最近的 AI 联系人对话。</p>
      </div>
      <span class="message-overview-badge" id="message-overview-badge" data-message-overview-badge>未读</span>
    </section>

    <div class="list-card message-list" id="message-list"></div>
  </section>

  <section class="view chat-view" data-view="chat" data-component-app-id="messages">
    <div class="chat-header">
      <button class="icon-button" data-back type="button">返回</button>
      <div id="chat-header-avatar"></div>
      <div>
        <strong id="chat-title">林秋</strong>
        <p id="chat-subtitle">随聊 · 在线 · 海风很轻</p>
      </div>
    </div>

    <div class="chat-date">今天</div>
    <div class="chat-thread" id="chat-thread"></div>

    <div class="attachment-strip" id="attachment-strip"></div>
    <div class="chat-status" id="chat-status">可以直接发送消息；离线时会使用本地演示回复。</div>

    <form class="input-bar" id="chat-form">
      <input id="chat-attachment-input" type="file" multiple hidden>
      <button type="button" class="attachment-button" id="attachment-button" aria-label="添加图片或文件" title="添加图片或文件">+</button>
      <div class="chat-input-shell">
        <div class="slash-command-palette" id="slash-command-palette" role="listbox" aria-label="Slash commands" hidden></div>
        <input id="chat-input" type="text" placeholder="发一条消息..." autocomplete="off" aria-controls="slash-command-palette">
      </div>
      <button type="button" class="runtime-pass-through-toggle" id="runtime-pass-through-toggle" aria-pressed="false" title="肘击 AI：关闭">肘击 AI</button>
      <button type="button" class="magic-wand-button" id="magic-wand-button" aria-label="魔法棒：送到后端" title="魔法棒：送到后端">✦</button>
      <button type="submit" class="send-button">发送</button>
    </form>
  </section>
`;

let isBound = false;

function getElements() {
  return {
    messageList: qs('#message-list'),
    messageOverviewTitle: qs('#message-overview-title'),
    messageOverviewSubtitle: qs('#message-overview-subtitle'),
    messageOverviewBadge: qs('#message-overview-badge'),
    chatHeaderAvatar: qs('#chat-header-avatar'),
    chatTitle: qs('#chat-title'),
    chatSubtitle: qs('#chat-subtitle'),
    chatThread: qs('#chat-thread'),
    chatStatus: qs('#chat-status'),
    chatForm: qs('#chat-form'),
    chatInput: qs('#chat-input'),
    chatInputShell: qs('.chat-input-shell'),
    slashCommandPalette: qs('#slash-command-palette'),
    runtimePassThroughToggle: qs('#runtime-pass-through-toggle'),
    attachmentButton: qs('#attachment-button'),
    chatAttachmentInput: qs('#chat-attachment-input'),
    attachmentStrip: qs('#attachment-strip'),
    magicWandButton: qs('#magic-wand-button'),
    backButton: qs('[data-back]'),
    markReadButton: qs('#mark-read-button'),
  };
}

function getBackendEnabled(context) {
  return typeof context.backendEnabled === 'function'
    ? Boolean(context.backendEnabled())
    : Boolean(context.backendEnabled);
}

function renderMessageAttachments(message, context) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (!attachments.length) return '';
  return `<div class="bubble-attachments">${attachments.map((attachment) => {
    const url = context.attachmentDownloadUrl?.(attachment) || '';
    const label = escapeHtml(attachment.fileName || 'attachment');
    const mime = String(attachment.mimeType || '').toLowerCase();
    const isImage = attachment.kind === 'image' || mime.startsWith('image/');
    if (isImage && url) {
      return `<a class="bubble-image-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img class="bubble-image" src="${escapeHtml(url)}" alt="${label}"></a>`;
    }
    return `<a class="bubble-file" href="${escapeHtml(url || '#')}" target="_blank" rel="noreferrer"><span>${isImage ? '图片' : '文件'}</span><strong>${label}</strong><em>${escapeHtml(context.formatBytes?.(attachment.size) || '')}</em></a>`;
  }).join('')}</div>`;
}

function renderMessageActions(message, context) {
  const actions = Array.isArray(message?.actions) ? message.actions : [];
  if (!actions.length) return '';
  return `<div class="approval-card"><p>需要操作确认</p><div class="approval-actions">${actions.map((action) => `
    <button type="button" data-thread-action="${escapeHtml(action.action)}" data-reply-ctx="${escapeHtml(action.replyCtx || '')}">${escapeHtml(action.label || action.action)}</button>
  `).join('')}</div></div>`;
}

function bindMessageActions(container, context) {
  container.querySelectorAll('[data-thread-action]').forEach((button) => {
    button.addEventListener('click', () => {
      void context.submitThreadAction?.(button.dataset.threadAction || '', button.dataset.replyCtx || '');
    });
  });
}

function appendChatMessageRow(message, chat, context, elements, options = {}) {
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
    options.textHtml ?? context.renderMessageTextHtml?.(message, chat) ?? '',
    options.includeAttachments === false ? '' : renderMessageAttachments(message, context),
    options.includeActions === false ? '' : renderMessageActions(message, context),
  ].filter(Boolean).join('');
  bindMessageActions(bubble, context);

  if (side === 'other') row.innerHTML = context.renderAvatar?.(chat, 'avatar chat-avatar') || '';
  row.appendChild(bubble);
  if (side === 'self') {
    row.insertAdjacentHTML('beforeend', context.renderAvatar?.(context.personaAvatarSource?.(), 'avatar chat-avatar') || '');
  }
  elements.chatThread?.appendChild(row);
}

function renderMessages(context) {
  const elements = getElements();
  if (!elements.messageList) return;
  elements.messageList.innerHTML = '';

  const entries = Object.entries(context.state?.chats || {});
  const unreadTotal = entries.reduce((sum, [, chat]) => sum + Number(chat.unread || 0), 0);
  const latest = entries.find(([, chat]) => Number(chat.unread || 0) > 0) || entries[0];

  if (elements.messageOverviewTitle) {
    elements.messageOverviewTitle.textContent = latest?.[1]?.name
      ? `最近联系人：${latest[1].name}`
      : '最近联系人';
  }
  if (elements.messageOverviewSubtitle) {
    elements.messageOverviewSubtitle.textContent = latest?.[1]?.summary || '从桌面进入消息后，继续最近的 AI 联系人对话。';
  }
  if (elements.messageOverviewBadge) {
    elements.messageOverviewBadge.textContent = unreadTotal ? `${unreadTotal} 条未读` : '已读';
  }

  entries.forEach(([key, chat]) => {
    const button = document.createElement('button');
    button.className = 'message-item';
    button.dataset.openChat = key;
    button.type = 'button';
    button.innerHTML = `
      ${context.renderAvatar?.(chat) || ''}
      <div class="message-meta">
        <div class="message-topline">
          <strong>${escapeHtml(chat.name)}</strong>
          <span>${escapeHtml(chat.time || '')}</span>
        </div>
        <p>${escapeHtml(chat.summary)}</p>
      </div>
      ${chat.unread ? `<span class="badge">${escapeHtml(chat.unread)}</span>` : ''}
    `;
    button.addEventListener('click', () => {
      void context.openChat?.(key);
    });
    elements.messageList.appendChild(button);
  });
}

function renderChat(context) {
  const elements = getElements();
  if (!elements.chatThread || !elements.chatTitle || !elements.chatSubtitle) return;
  const chat = context.getActiveChat?.();
  if (!chat) {
    elements.chatTitle.textContent = '暂无聊天';
    elements.chatSubtitle.textContent = '';
    if (elements.chatHeaderAvatar) elements.chatHeaderAvatar.innerHTML = '';
    elements.chatThread.innerHTML = '';
    context.clearWaifuDisplayTimers?.();
    context.renderAttachmentStrip?.();
    context.updateRuntimePassThroughToggle?.();
    return;
  }

  elements.chatTitle.textContent = chat.name;
  elements.chatSubtitle.textContent = chat.subtitle;
  if (elements.chatHeaderAvatar) elements.chatHeaderAvatar.innerHTML = context.renderAvatar?.(chat, 'avatar') || '';
  context.clearWaifuDisplayTimers?.();
  elements.chatThread.innerHTML = '';
  const waifuSettings = context.resolveChatWaifuSettings?.(chat) || {};

  (Array.isArray(chat.messages) ? chat.messages : []).forEach((message) => {
    const waifuSegments = context.getWaifuDisplaySegments?.(message, chat) || [];
    if (waifuSegments.length) {
      let previousSegmentText = '';
      waifuSegments.forEach((segmentText, index) => {
        const isLastSegment = index === waifuSegments.length - 1;
        appendChatMessageRow(message, chat, context, elements, {
          rowClass: 'chat-message-waifu-line',
          bubbleClass: 'bubble-message-waifu',
          textHtml: context.renderBubbleTextHtml?.(segmentText) || '',
          includeAttachments: isLastSegment,
          includeActions: isLastSegment,
          hidden: message.waifuDisplayPending === true && index > 0,
          waifuDelayMs: index > 0
            ? context.getWaifuSegmentDelay?.(previousSegmentText || segmentText, waifuSettings)
            : 0,
          waifuSegmentIndex: index,
        });
        previousSegmentText = `${previousSegmentText}${segmentText}`;
      });
      return;
    }
    appendChatMessageRow(message, chat, context, elements);
  });

  context.renderAttachmentStrip?.();
  context.updateMagicWandState?.();
  context.updateRuntimePassThroughToggle?.();

  requestAnimationFrame(() => {
    context.scheduleWaifuSegments?.(chat);
    elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
  });
}

export function render(context) {
  renderMessages(context);
  renderChat(context);
}

function handleChatInputKeydown(event, context) {
  if (event.key === 'Escape' && context.isSlashCommandOpen?.()) {
    event.preventDefault();
    context.closeSlashCommandPalette?.();
    return;
  }

  if (!context.isSlashCommandOpen?.()) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    context.moveSlashCommandSelection?.(1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    context.moveSlashCommandSelection?.(-1);
    return;
  }

  if (event.key === 'Enter' && context.hasSlashCommandMatches?.()) {
    event.preventDefault();
    context.submitActiveSlashCommand?.();
  }
}

async function handleChatSubmit(event, context) {
  event.preventDefault();
  const elements = getElements();
  const hasAttachments = Array.isArray(context.uiState?.pendingAttachments) && context.uiState.pendingAttachments.length > 0;
  const { text: value, runtimePassThrough } = context.prepareChatSubmit?.(elements.chatInput?.value || '', hasAttachments) || {
    text: '',
    runtimePassThrough: false,
  };
  if (!value && !hasAttachments) return;

  const chat = context.getActiveChat?.();
  if (!chat) return;
  context.queueLocalUserMessage?.(chat, value, { runtimePassThrough });

  if (value && Array.isArray(context.state?.memories) && context.state.memories.length < 12) {
    context.state.memories.unshift({
      title: '聊天碎片',
      text: value,
      tags: ['新对话', chat.name],
    });
  }

  if (elements.chatInput) elements.chatInput.value = '';
  context.closeSlashCommandPalette?.();
  context.saveState?.();
  context.refresh?.();
  if (getBackendEnabled(context)) {
    context.setChatStatus?.(runtimePassThrough
      ? '正在通过 smallphone-app 肘击 AI...'
      : '正在发送到 smallphone-app 后端...');
    void context.flushPendingOutbox?.();
    return;
  }
  context.setChatStatus?.('已先放在前端。点魔法棒后生成回复。');
}

export function bind(context) {
  if (isBound) return;
  const elements = getElements();
  if (!elements.chatForm) return;
  isBound = true;

  elements.backButton?.addEventListener('click', () => {
    context.closeThreadEventStream?.();
    context.setActiveView?.(context.uiState?.previousView === 'contacts' ? 'contacts' : 'messages');
  });

  elements.markReadButton?.addEventListener('click', () => {
    Object.values(context.state?.chats || {}).forEach((chat) => {
      chat.unread = 0;
    });
    context.queueStateSync?.();
    renderMessages(context);
    context.renderDesktopBadge?.();
    context.renderLockNotification?.();
  });

  elements.attachmentButton?.addEventListener('click', () => {
    if (!getBackendEnabled(context)) {
      context.setChatStatus?.('附件需要连接 smallphone-app 后端。', true);
      return;
    }
    elements.chatAttachmentInput?.click();
  });

  elements.chatAttachmentInput?.addEventListener('change', () => {
    const files = elements.chatAttachmentInput.files;
    elements.chatAttachmentInput.value = '';
    if (!files?.length) return;
    context.uploadChatAttachments?.(files).catch((error) => {
      context.setChatStatus?.(error instanceof Error ? error.message : '附件上传失败', true);
    });
  });

  elements.magicWandButton?.addEventListener('click', () => {
    void context.flushPendingOutbox?.();
  });

  elements.chatInput?.addEventListener('input', () => {
    context.updateSlashCommandPalette?.();
  });

  elements.chatInput?.addEventListener('focus', () => {
    context.updateSlashCommandPalette?.();
  });

  elements.chatInput?.addEventListener('keydown', (event) => {
    handleChatInputKeydown(event, context);
  });

  document.addEventListener('click', (event) => {
    if (!context.isSlashCommandOpen?.()) return;
    if (getElements().chatInputShell?.contains(event.target)) return;
    context.closeSlashCommandPalette?.();
  });

  elements.runtimePassThroughToggle?.addEventListener('click', () => {
    context.uiState.runtimePassThroughEnabled = !context.uiState.runtimePassThroughEnabled;
    context.updateRuntimePassThroughToggle?.();
  });

  elements.chatForm.addEventListener('submit', (event) => {
    void handleChatSubmit(event, context);
  });
}
