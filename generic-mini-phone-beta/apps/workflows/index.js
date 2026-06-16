import { escapeHtml, qs } from '../shared.js';
import {
  loadThreadPromptBoard,
  requestBackend,
  resolveBackendBase,
  sanitizeModulesForCompile,
  saveThreadPromptBoard,
} from './api.js?v=4';

const PROMPTBOARD_STORAGE_KEY = 'smallphone.promptBoard.drafts.v1';
const PROMPTBOARD_SELECTED_THREAD_KEY = 'smallphone.promptBoard.selectedThreadId';
const PROMPTBOARD_SELECTED_WORKFLOW_KEY = 'smallphone.promptBoard.selectedWorkflowKey';
const PROMPTBOARD_PREVIEW_TEXT_KEY = 'smallphone.promptBoard.previewText';

let promptBoardState = {
  phase: 'idle',
  workflows: [],
  threads: [],
  error: '',
  loadedAt: '',
  inflight: null,
  selectedThreadId: '',
  selectedWorkflowKey: '',
  previewText: '',
  modules: [],
  compile: {
    phase: 'idle',
    error: '',
    source: '',
    compiledAt: '',
    result: null,
  },
  editor: {
    open: false,
    moduleId: '',
  },
  ui: {
    showDisabledModules: false,
  },
  caches: {
    messagesByThreadId: new Map(),
    turnContextByThreadId: new Map(),
  },
};

let compileDebounceTimer = null;
let persistDebounceTimer = null;
let latestCompileRequestId = 0;
let latestModulesLoadRequestId = 0;
let pendingPersistSnapshot = null;

export const manifest = {
  id: 'workflows',
  name: '模块画板',
  shortName: '板',
  orbClass: 'orb-workflows',
  views: {
    normal: 'workflows',
  },
};

export const template = `
  <section class="view app-workspace promptboard-workspace" data-view="workflows">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Prompt Board</p>
        <h2>模块画板</h2>
      </div>
      <span class="app-view-pill" id="promptboard-status">未加载</span>
    </div>

    <div class="promptboard-actions">
      <button class="soft-button small-button" id="promptboard-refresh" type="button">同步</button>
      <select id="promptboard-thread" class="promptboard-select" aria-label="选择线程"></select>
      <button class="secondary-button" id="promptboard-add-module" type="button">新增模块</button>
      <button class="secondary-button" id="promptboard-compile" type="button">编译</button>
    </div>

    <div id="promptboard-meta" class="promptboard-meta">将发送到 21040 的最终文本由模块拼接而成；标题/说明不会被发送。</div>

    <details class="details-panel promptboard-details promptboard-preview-details" id="promptboard-preview-details">
      <summary>编译输入（本次 user 消息）</summary>
      <div class="details-panel-body">
        <textarea id="promptboard-preview-text" class="promptboard-preview-text" rows="4" spellcheck="false" placeholder="这条消息会参与动态上下文与最近对话编译。"></textarea>
      </div>
    </details>

    <div class="promptboard-preview-head">
      <div>
        <strong>合并预览（真实发送文本）</strong>
        <p class="promptboard-subtitle">这是最终发给 21040 的文本；颜色只用于标记模块边界，点击对应颜色段进入编辑。</p>
      </div>
      <span class="promptboard-pill" id="promptboard-source">local</span>
    </div>

    <div class="promptboard-sections" id="promptboard-sections"></div>

    <details class="details-panel promptboard-details" id="promptboard-details">
      <summary>复制纯文本</summary>
      <div class="details-panel-body">
        <textarea id="promptboard-final-text" class="promptboard-final-text" rows="10" spellcheck="false" readonly></textarea>
        <div class="promptboard-final-actions">
          <button class="secondary-button" id="promptboard-copy-final" type="button">复制最终文本</button>
        </div>
      </div>
    </details>

    <aside class="panel promptboard-module-panel" id="promptboard-module-panel" aria-hidden="true">
      <div class="panel-header">
        <button class="icon-button" id="promptboard-module-back" type="button">返回</button>
        <div>
          <p class="eyebrow panel-eyebrow">Module</p>
          <h2 id="promptboard-module-title">模块编辑</h2>
        </div>
        <button class="icon-button" id="promptboard-module-close" type="button">关闭</button>
      </div>
      <div class="promptboard-module-body" id="promptboard-module-body"></div>
    </aside>
  </section>
`;

export function render() {
  ensurePromptBoardLoaded();
  renderPromptBoard();
}

export function bind() {
  const refreshButton = qs('#promptboard-refresh');
  if (!refreshButton) return;

  refreshButton.addEventListener('click', () => {
    flushPersistDrafts();
    loadPromptBoard({ force: true });
  });

  const threadSelect = qs('#promptboard-thread');
  threadSelect?.addEventListener('change', () => {
    const next = String(threadSelect.value || '').trim();
    if (!next) return;
    void selectThread(next);
  });

  qs('#promptboard-compile')?.addEventListener('click', () => {
    scheduleCompile({ force: true });
  });

  qs('#promptboard-add-module')?.addEventListener('click', () => {
    addCustomModule();
  });

  qs('#promptboard-copy-final')?.addEventListener('click', async () => {
    const textarea = qs('#promptboard-final-text');
    if (!textarea) return;
    await copyToClipboard(textarea.value);
  });

  const sections = qs('#promptboard-sections');
  sections?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const disabledToggle = target.closest('[data-prompt-disabled-toggle]');
    if (disabledToggle) {
      event.preventDefault();
      promptBoardState = {
        ...promptBoardState,
        ui: {
          ...promptBoardState.ui,
          showDisabledModules: !promptBoardState.ui?.showDisabledModules,
        },
      };
      renderPromptBoard();
      return;
    }

    const toggle = target.closest('[data-prompt-toggle]');
    if (toggle) {
      const moduleId = String(toggle.getAttribute('data-prompt-toggle') || '').trim();
      if (!moduleId) return;
      event.preventDefault();
      toggleModuleEnabled(moduleId);
      return;
    }

    if (target.closest('textarea, input, select, a')) return;
    if (target.closest('button') && !target.closest('[data-prompt-module]')) return;
    const card = target.closest('[data-prompt-module]');
    if (!card) return;
    const moduleId = String(card.getAttribute('data-prompt-module') || '').trim();
    if (!moduleId) return;
    openModuleEditor(moduleId);
  });
  sections?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const moduleTrigger = target.closest('[data-prompt-module][role="button"]');
    if (!moduleTrigger) return;
    const moduleId = String(moduleTrigger.getAttribute('data-prompt-module') || '').trim();
    if (!moduleId) return;
    event.preventDefault();
    openModuleEditor(moduleId);
  });

  qs('#promptboard-preview-text')?.addEventListener('input', (event) => {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const value = String(textarea.value || '').replaceAll('\r\n', '\n');
    promptBoardState = { ...promptBoardState, previewText: value };
    window.localStorage.setItem(PROMPTBOARD_PREVIEW_TEXT_KEY, value);
    scheduleCompile();
    renderPromptBoard();
  });

  qs('#promptboard-module-back')?.addEventListener('click', () => {
    closeModuleEditor();
  });
  qs('#promptboard-module-close')?.addEventListener('click', () => {
    closeModuleEditor();
  });
}

function renderPromptBoard() {
  const status = qs('#promptboard-status');
  const meta = qs('#promptboard-meta');
  const threadSelect = qs('#promptboard-thread');
  const sections = qs('#promptboard-sections');
  const source = qs('#promptboard-source');
  const finalTextArea = qs('#promptboard-final-text');
  const previewTextArea = qs('#promptboard-preview-text');
  if (!status || !meta || !threadSelect || !sections || !source || !finalTextArea || !previewTextArea) return;

  const workflowKey = promptBoardState.selectedWorkflowKey;
  const moduleCount = promptBoardState.modules.length;
  const thread = getSelectedThread();
  const fixtureMode = promptBoardState.phase === 'fixture';

  if (promptBoardState.phase === 'loading') {
    status.textContent = '加载中';
    meta.textContent = '正在读取 SmallPhone 后端（线程 + 联系人工作流）。';
  } else if (fixtureMode) {
    status.textContent = '本地演示';
    meta.textContent = promptBoardState.error
      ? `后端不可用：${promptBoardState.error}（已切换本地演示数据）`
      : '后端不可用，已切换本地演示数据。';
  } else if (promptBoardState.phase === 'error') {
    status.textContent = '加载失败';
    meta.textContent = promptBoardState.error || '无法连接后端。';
  } else if (promptBoardState.phase === 'loaded') {
    status.textContent = `${moduleCount} 模块`;
    meta.textContent = promptBoardState.loadedAt ? `已同步 ${formatTime(promptBoardState.loadedAt)}` : '已同步';
  } else {
    status.textContent = '未加载';
    meta.textContent = '将发送到 21040 的最终文本由模块拼接而成；标题/说明不会被发送。';
  }

  const threads = Array.isArray(promptBoardState.threads) ? promptBoardState.threads : [];
  threadSelect.innerHTML = threads.length
    ? threads.map((item) => renderThreadOption(item, promptBoardState.selectedThreadId)).join('')
    : '<option value="">无可用线程</option>';
  threadSelect.disabled = !threads.length;

  const compile = promptBoardState.compile || {};
  if (compile.phase === 'compiling') {
    source.textContent = 'compiling';
  } else if (compile.source) {
    source.textContent = compile.source;
  } else {
    source.textContent = fixtureMode ? 'fixture' : 'local';
  }

  const compiled = compile.result;
  sections.innerHTML = renderPromptBoardPreview(compiled);

  if (document.activeElement !== finalTextArea) {
    finalTextArea.value = compiled?.finalText || '';
  }

  if (document.activeElement !== previewTextArea) {
    previewTextArea.value = promptBoardState.previewText || inferPreviewText(thread);
  }

  if (promptBoardState.editor.open) {
    renderModuleEditor();
  }

  const panel = qs('#promptboard-module-panel');
  if (panel) {
    if (promptBoardState.editor.open) {
      panel.classList.add('panel-open');
      panel.setAttribute('aria-hidden', 'false');
    } else {
      panel.classList.remove('panel-open');
      panel.setAttribute('aria-hidden', 'true');
    }
  }
}

function renderThreadOption(thread, selectedId) {
  const id = String(thread?.id || '').trim();
  const title = String(thread?.title || thread?.summary || id).trim() || id;
  const contactName = String(thread?.contact?.displayName || '').trim();
  const label = contactName ? `${contactName} · ${title}` : title;
  return `<option value="${escapeHtml(id)}"${id === selectedId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderPromptBoardPreview(compiled) {
  const modules = Array.isArray(promptBoardState.modules) ? promptBoardState.modules : [];
  if (!modules.length) {
    return `
      <article class="promptboard-empty">
        <strong>没有模块</strong>
        <p>当前工作流没有 promptBoard/modules，已用内置模块模板填充。</p>
      </article>
    `;
  }

  const enabledModules = modules.filter((module) => module?.enabled !== false);
  const disabledModules = modules.filter((module) => module?.enabled === false);
  const body = enabledModules.length
    ? renderMergedPreview(enabledModules, compiled)
    : `
      <article class="promptboard-empty">
        <strong>没有启用的模块</strong>
        <p>打开底部的未启用模块列表，启用至少一个模块后会生成合并预览。</p>
      </article>
    `;

  return `
    <div class="prompt-preview-canvas" aria-label="合并预览">
      ${body}
    </div>
    ${renderDisabledModuleDrawer(disabledModules, compiled)}
  `;
}

function renderMergedPreview(enabledModules, compiled) {
  const segments = enabledModules
    .map((module, index) => renderMergedSegment(module, compiled, index))
    .filter(Boolean);

  if (!segments.length) {
    return `
      <article class="promptboard-empty">
        <strong>没有可预览文本</strong>
        <p>启用模块均为空文本，暂时不会生成发送内容。</p>
      </article>
    `;
  }

  // Important: do not indent inside the preview container; it uses `white-space: pre-wrap`.
  // Separators must be real plain-text newlines (not spacer elements) to match final text.
  return `<div class="prompt-merged-preview" aria-label="纯文本合并预览">${segments.join('\n\n')}</div>`;
}

function renderMergedSegment(module, compiled, index) {
  const id = String(module?.id || '').trim();
  const title = String(module?.title || id).trim() || id;
  const displayText = getCompiledModuleText(module, compiled);
  const usingOverride = Boolean(String(module?.contentOverride || '').trim());
  const colorClass = `prompt-preview-color-${Math.abs(index) % 8}`;

  // Render as continuous pure text with inline color highlighting (no card frame / no title label).
  const normalizedText = String(displayText || '').replaceAll('\r\n', '\n');
  if (!normalizedText.trim()) return '';

  const hint = usingOverride ? '已改写' : '';
  const tooltip = [title, id, hint].filter(Boolean).join(' · ');

  return `<span class="prompt-merged-segment ${colorClass}" data-prompt-module="${escapeHtml(id)}" tabindex="0" role="button" title="${escapeHtml(tooltip)}"><span class="prompt-merged-text">${escapeHtml(normalizedText)}</span></span>`;
}

function renderDisabledModuleDrawer(disabledModules, compiled) {
  const count = disabledModules.length;
  const open = Boolean(promptBoardState.ui?.showDisabledModules);
  if (!count) {
    return `
      <div class="promptboard-disabled-drawer">
        <span class="promptboard-disabled-empty">没有未启用的模块</span>
      </div>
    `;
  }

  return `
    <div class="promptboard-disabled-drawer${open ? ' promptboard-disabled-drawer-open' : ''}">
      <button class="secondary-button promptboard-disabled-toggle" data-prompt-disabled-toggle type="button" aria-expanded="${open ? 'true' : 'false'}">
        ${open ? '收起未启用模块' : `展开全部（${count} 个未启用）`}
      </button>
      ${open ? `
        <div class="promptboard-disabled-list">
          ${disabledModules.map((module, index) => renderDisabledModule(module, compiled, index)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderDisabledModule(module, compiled, index) {
  const id = String(module?.id || '').trim();
  const title = String(module?.title || id).trim() || id;
  const description = String(module?.description || '').trim();
  const displayText = getCompiledModuleText(module, compiled);
  const colorClass = `prompt-preview-color-${Math.abs(index) % 8}`;

  return `
    <article class="prompt-disabled-card ${colorClass}" data-prompt-module="${escapeHtml(id)}">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(description || '停用后不会进入发送文本。')}</p>
      </div>
      <pre>${escapeHtml(displayText || module?.template || '空模块')}</pre>
      <button class="prompt-segment-toggle" data-prompt-toggle="${escapeHtml(id)}" type="button" aria-pressed="false">启用</button>
    </article>
  `;
}

function getCompiledModuleText(module, compiled) {
  const id = String(module?.id || '').trim();
  if (!id) return '';

  const override = String(module?.contentOverride || '').replaceAll('\r\n', '\n');
  if (override.trim()) return override.trim();

  const section = findCompiledSection(compiled?.sections, id);
  const sectionText = getSectionText(section);
  if (sectionText) return sectionText;

  const traceSection = findCompiledSection(compiled?.trace?.sections, id);
  const traceSectionText = getSectionText(traceSection);
  if (traceSectionText) return traceSectionText;

  const trace = compiled?.traceByModuleId?.[id] || null;
  const traceText = getSectionText(trace);
  if (traceText) return traceText;

  const traceListItem = findCompiledSection(Array.isArray(compiled?.trace) ? compiled.trace : [], id);
  const traceListText = getSectionText(traceListItem);
  return traceListText || '';
}

function findCompiledSection(list, moduleId) {
  const id = String(moduleId || '').trim();
  if (!id || !Array.isArray(list)) return null;
  return list.find((item) => {
    const candidate = String(item?.moduleId || item?.module_id || item?.id || item?.module?.id || '').trim();
    return candidate === id;
  }) || null;
}

function getSectionText(section) {
  if (!section || typeof section !== 'object') return '';
  const value = typeof section.text === 'string'
    ? section.text
    : typeof section.content === 'string'
      ? section.content
      : typeof section.output === 'string'
        ? section.output
        : '';
  return String(value || '').replaceAll('\r\n', '\n');
}

function ensurePromptBoardLoaded() {
  if (promptBoardState.phase === 'idle') {
    loadPromptBoard();
  }
}

async function loadPromptBoard({ force = false } = {}) {
  if (promptBoardState.inflight && !force) return promptBoardState.inflight;
  if (!force && (promptBoardState.phase === 'loaded' || promptBoardState.phase === 'fixture')) return [];

  promptBoardState = {
    ...promptBoardState,
    phase: 'loading',
    error: '',
  };
  renderPromptBoard();

  const backendBase = resolveBackendBase();
  const inflight = Promise.all([
    requestBackend(`${backendBase}/contact-workflows`),
    requestBackend(`${backendBase}/threads`),
  ])
    .then(async ([workflowPayload, threadPayload]) => {
      const workflows = normalizeWorkflowList(workflowPayload);
      const threads = normalizeThreadList(threadPayload);
      promptBoardState = {
        ...promptBoardState,
        phase: 'loaded',
        workflows,
        threads,
        error: '',
        loadedAt: new Date().toISOString(),
        inflight: null,
      };

      hydrateSelectionFromStorage();
      applyDefaultSelection();
      await loadModulesForSelection({ backendBase });
      scheduleCompile({ force: true });
      renderPromptBoard();
      return { workflows, threads };
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const fixture = createFixtureSnapshot();
      promptBoardState = {
        ...promptBoardState,
        phase: 'fixture',
        workflows: fixture.workflows,
        threads: fixture.threads,
        selectedThreadId: fixture.threads[0]?.id || '',
        selectedWorkflowKey: fixture.workflowKey,
        previewText: fixture.previewText,
        modules: fixture.modules,
        compile: {
          phase: 'idle',
          error: '',
          source: '',
          compiledAt: '',
          result: null,
        },
        error: message,
        loadedAt: new Date().toISOString(),
        inflight: null,
      };
      scheduleCompile({ force: true });
      renderPromptBoard();
      return fixture;
    });

  promptBoardState.inflight = inflight;
  return inflight;
}

function hydrateSelectionFromStorage() {
  const storedThreadId = String(window.localStorage.getItem(PROMPTBOARD_SELECTED_THREAD_KEY) || '').trim();
  const storedWorkflowKey = String(window.localStorage.getItem(PROMPTBOARD_SELECTED_WORKFLOW_KEY) || '').trim();
  const storedPreviewText = String(window.localStorage.getItem(PROMPTBOARD_PREVIEW_TEXT_KEY) || '').trim();
  promptBoardState = {
    ...promptBoardState,
    selectedThreadId: storedThreadId || promptBoardState.selectedThreadId,
    selectedWorkflowKey: storedWorkflowKey || promptBoardState.selectedWorkflowKey,
    previewText: storedPreviewText || promptBoardState.previewText,
  };
}

function applyDefaultSelection() {
  const threads = promptBoardState.threads || [];
  const workflows = promptBoardState.workflows || [];
  const threadExists = threads.some((t) => String(t?.id || '') === promptBoardState.selectedThreadId);
  const selectedThreadId = threadExists ? promptBoardState.selectedThreadId : String(threads[0]?.id || '').trim();

  const thread = threads.find((t) => String(t?.id || '') === selectedThreadId) || null;
  const workflowKeyFromThread = thread ? workflowKeyFromThreadRef(thread) : '';
  const workflowExists = workflows.some((wf) => workflowKeyFromWorkflow(wf) === (workflowKeyFromThread || promptBoardState.selectedWorkflowKey));

  const selectedWorkflowKey = workflowExists
    ? (workflowKeyFromThread || promptBoardState.selectedWorkflowKey)
    : workflowKeyFromWorkflow(workflows[0]);

  const previewText = promptBoardState.previewText || inferPreviewText(thread);

  promptBoardState = {
    ...promptBoardState,
    selectedThreadId,
    selectedWorkflowKey,
    previewText,
  };

  window.localStorage.setItem(PROMPTBOARD_SELECTED_THREAD_KEY, selectedThreadId);
  window.localStorage.setItem(PROMPTBOARD_SELECTED_WORKFLOW_KEY, selectedWorkflowKey);
  window.localStorage.setItem(PROMPTBOARD_PREVIEW_TEXT_KEY, previewText);
}

function inferPreviewText(thread) {
  const draft = String(thread?.draft?.text || '').trim();
  if (draft) return draft;
  const lastUser = thread?.lastMessage?.role === 'user' ? String(thread?.lastMessage?.content || '').trim() : '';
  return lastUser || '你好';
}

async function selectThread(threadId) {
  const next = String(threadId || '').trim();
  if (!next || next === promptBoardState.selectedThreadId) return;
  flushPersistDrafts();
  promptBoardState = {
    ...promptBoardState,
    selectedThreadId: next,
  };
  window.localStorage.setItem(PROMPTBOARD_SELECTED_THREAD_KEY, next);

  const thread = getSelectedThread();
  const nextWorkflowKey = workflowKeyFromThreadRef(thread);
  if (nextWorkflowKey) {
    promptBoardState = {
      ...promptBoardState,
      selectedWorkflowKey: nextWorkflowKey,
    };
    window.localStorage.setItem(PROMPTBOARD_SELECTED_WORKFLOW_KEY, nextWorkflowKey);
  }
  if (!promptBoardState.previewText) {
    const previewText = inferPreviewText(thread);
    promptBoardState = { ...promptBoardState, previewText };
    window.localStorage.setItem(PROMPTBOARD_PREVIEW_TEXT_KEY, previewText);
  }
  await loadModulesForSelection({ backendBase: resolveBackendBase() });
  scheduleCompile({ force: true });
  renderPromptBoard();
}

async function loadModulesForSelection({ backendBase } = {}) {
  const thread = getSelectedThread();
  if (!thread) {
    promptBoardState = {
      ...promptBoardState,
      modules: normalizeModuleList(createDefaultModules()),
    };
    return;
  }

  const resolvedBackendBase = String(backendBase || resolveBackendBase() || '').trim();
  const threadId = String(thread.id || '').trim();
  if (!resolvedBackendBase || !threadId) return;

  const requestId = ++latestModulesLoadRequestId;

  let backendPayload = null;
  try {
    backendPayload = await loadThreadPromptBoard({ backendBase: resolvedBackendBase, threadId });
  } catch {
    backendPayload = null;
  }

  if (requestId !== latestModulesLoadRequestId) return;

  if (backendPayload && Array.isArray(backendPayload.modules)) {
    const workflowKey = promptBoardState.selectedWorkflowKey || workflowKeyFromThreadRef(thread);
    promptBoardState = {
      ...promptBoardState,
      selectedWorkflowKey: workflowKey,
      modules: normalizeModuleList(backendPayload.modules),
    };
    return;
  }

  // Backend unavailable for prompt-board; fall back to local drafts/workflow defaults.
  const workflow = getSelectedWorkflow();
  const workflowKey = promptBoardState.selectedWorkflowKey || workflowKeyFromWorkflow(workflow);
  const persisted = loadPromptBoardDrafts();
  const stored = persisted?.workflows?.[workflowKey]?.modules;
  const fromWorkflow = extractPromptBoardModules(workflow);
  const modules = normalizeModuleList(stored || fromWorkflow || createDefaultModules());
  promptBoardState = {
    ...promptBoardState,
    selectedWorkflowKey: workflowKey,
    modules,
  };
}

function scheduleCompile({ force = false } = {}) {
  if (compileDebounceTimer) {
    window.clearTimeout(compileDebounceTimer);
    compileDebounceTimer = null;
  }
  if (force) {
    compilePromptBoard();
    return;
  }
  compileDebounceTimer = window.setTimeout(() => compilePromptBoard(), 320);
}

function schedulePersistDrafts() {
  if (persistDebounceTimer) {
    window.clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  const threadId = String(getSelectedThread()?.id || '').trim();
  if (!threadId) return;
  const modules = promptBoardState.modules;
  const workflowKey = promptBoardState.selectedWorkflowKey;
  pendingPersistSnapshot = { threadId, modules, workflowKey };
  persistDebounceTimer = window.setTimeout(() => {
    const snapshot = pendingPersistSnapshot;
    pendingPersistSnapshot = null;
    void persistPromptBoardDrafts(snapshot || { threadId, modules, workflowKey });
  }, 400);
}

async function persistPromptBoardDrafts({ threadId, modules, workflowKey }) {
  const targetThreadId = String(threadId || '').trim();
  if (!targetThreadId) return;

  const backendBase = resolveBackendBase();
  const moduleSnapshot = Array.isArray(modules) ? modules : promptBoardState.modules;

  let saved = null;
  try {
    saved = await saveThreadPromptBoard({
      backendBase,
      threadId: targetThreadId,
      modules: moduleSnapshot,
    });
  } catch {
    saved = null;
  }

  if (saved && Array.isArray(saved.modules)) {
    // Only apply the server-normalized modules to the current view if we're still on that thread.
    if (String(getSelectedThread()?.id || '') === targetThreadId) {
      promptBoardState = {
        ...promptBoardState,
        modules: normalizeModuleList(saved.modules),
      };
      renderPromptBoard();
    }
    return;
  }

  // Backend unavailable: persist local draft (fallback only).
  const localWorkflowKey = String(workflowKey || promptBoardState.selectedWorkflowKey || '').trim();
  if (!localWorkflowKey) return;
  const drafts = loadPromptBoardDrafts() || { version: 1, workflows: {} };
  drafts.workflows = drafts.workflows && typeof drafts.workflows === 'object' ? drafts.workflows : {};
  drafts.workflows[localWorkflowKey] = {
    modules: moduleSnapshot
      .map((m) => ({
        id: String(m?.id || '').trim(),
        title: String(m?.title || '').trim(),
        description: String(m?.description || '').trim(),
        enabled: m?.enabled !== false,
        order: Number.isFinite(Number(m?.order)) ? Number(m.order) : undefined,
        kind: String(m?.kind || 'template').trim() || 'template',
        template: String(m?.template || '').replaceAll('\r\n', '\n'),
        contentOverride: String(m?.contentOverride || ''),
        fields: normalizeModuleFields(m?.fields),
        workflow: normalizeModuleWorkflow(m?.workflow),
      }))
      .filter((m) => m.id),
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(PROMPTBOARD_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore
  }
}

function flushPersistDrafts() {
  if (!persistDebounceTimer) return;
  window.clearTimeout(persistDebounceTimer);
  persistDebounceTimer = null;
  const snapshot = pendingPersistSnapshot;
  pendingPersistSnapshot = null;
  if (snapshot) {
    void persistPromptBoardDrafts(snapshot);
  }
}

function loadPromptBoardDrafts() {
  try {
    const raw = window.localStorage.getItem(PROMPTBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function compilePromptBoard() {
  const thread = getSelectedThread();
  const workflowKey = promptBoardState.selectedWorkflowKey;
  const modules = promptBoardState.modules;
  if (!thread || !workflowKey || !modules.length) {
    promptBoardState = {
      ...promptBoardState,
      compile: {
        ...promptBoardState.compile,
        phase: 'idle',
        error: '',
        source: promptBoardState.phase === 'fixture' ? 'fixture' : 'local',
        result: null,
      },
    };
    renderPromptBoard();
    return;
  }

  const requestId = ++latestCompileRequestId;
  promptBoardState = {
    ...promptBoardState,
    compile: {
      ...promptBoardState.compile,
      phase: 'compiling',
      error: '',
      source: '',
    },
  };
  renderPromptBoard();

  const backendBase = resolveBackendBase();
  const previewText = String(promptBoardState.previewText || inferPreviewText(thread) || '你好').trim() || '你好';

  let backendResult = null;
  try {
    backendResult = await tryBackendCompile({
      backendBase,
      threadId: thread.id,
      workflowKey,
      modules,
      previewText,
    });
  } catch {
    backendResult = null;
  }

  if (requestId !== latestCompileRequestId) return;

  if (backendResult) {
    promptBoardState = {
      ...promptBoardState,
      compile: {
        phase: 'compiled',
        error: '',
        source: 'backend',
        compiledAt: new Date().toISOString(),
        result: backendResult,
      },
    };
    renderPromptBoard();
    return;
  }

  let messages = [];
  let turnContext = null;
  if (promptBoardState.phase === 'fixture') {
    messages = Array.isArray(thread.messages) ? thread.messages : [];
    turnContext = thread.turnContext && typeof thread.turnContext === 'object' ? thread.turnContext : null;
  } else {
    try {
      messages = await ensureThreadMessages({ backendBase, threadId: thread.id });
    } catch {
      messages = [];
    }
    try {
      turnContext = await ensureThreadTurnContext({ backendBase, threadId: thread.id, previewText });
    } catch {
      turnContext = null;
    }
  }

  if (requestId !== latestCompileRequestId) return;

  const localResult = compileLocally({
    modules,
    thread,
    previewText,
    messages,
    turnContext,
  });

  promptBoardState = {
    ...promptBoardState,
    compile: {
      phase: 'compiled',
      error: '',
      source: promptBoardState.phase === 'fixture' ? 'fixture' : 'local',
      compiledAt: new Date().toISOString(),
      result: localResult,
    },
  };
  renderPromptBoard();
}

async function tryBackendCompile({ backendBase, threadId, modules, previewText }) {
  const url = `${backendBase}/threads/${encodeURIComponent(threadId)}/prompt-board/compile`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text: previewText, modules: sanitizeModulesForCompile(buildModulesForCompile(modules)) }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') return null;
  const compiled = payload && typeof payload.compiled === 'object' && payload.compiled ? payload.compiled : payload;
  if (!compiled || typeof compiled !== 'object') return null;
  if (typeof compiled.finalText !== 'string') return null;
  if (!Array.isArray(compiled.sections)) return null;
  return normalizeCompileResult(compiled);
}

async function ensureThreadMessages({ backendBase, threadId }) {
  const cached = promptBoardState.caches.messagesByThreadId.get(threadId);
  if (Array.isArray(cached)) return cached;
  const payload = await requestBackend(`${backendBase}/threads/${encodeURIComponent(threadId)}/messages`);
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.messages) ? payload.messages : [];
  const normalized = list
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: String(m.id || '').trim(),
      role: String(m.role || '').trim(),
      content: String(m.content || '').trim(),
      createdAt: String(m.createdAt || '').trim(),
    }))
    .filter((m) => m.role && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'));
  promptBoardState.caches.messagesByThreadId.set(threadId, normalized);
  return normalized;
}

async function ensureThreadTurnContext({ backendBase, threadId, previewText }) {
  const cacheKey = `${threadId}:${previewText}`;
  const cached = promptBoardState.caches.turnContextByThreadId.get(cacheKey);
  if (cached) return cached;
  const payload = await requestBackend(`${backendBase}/threads/${encodeURIComponent(threadId)}/context-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: previewText }),
  });
  promptBoardState.caches.turnContextByThreadId.set(cacheKey, payload);
  return payload;
}

function compileLocally({ modules, thread, previewText, messages, turnContext }) {
  const context = buildCompileContext({ thread, previewText, messages, turnContext });
  const traceByModuleId = {};
  const sections = [];

  for (const module of modules) {
    const id = String(module?.id || '').trim();
    if (!id) continue;
    const enabled = module?.enabled !== false;
    const template = renderModuleFieldPlaceholders(
      String(module?.template || '').replaceAll('\r\n', '\n'),
      module,
    );
    const override = typeof module?.contentOverride === 'string' ? module.contentOverride : '';

    let text = '';
    let usedVariables = [];
    let mode = 'template';

    if (!enabled) {
      mode = 'disabled';
    } else if (override && override.trim()) {
      mode = 'override';
      text = override.replaceAll('\r\n', '\n');
    } else if (template) {
      const rendered = renderTemplate(template, buildModuleCompileContext(context, module));
      text = rendered.text;
      usedVariables = rendered.usedVariables;
    }

    text = String(text || '').replaceAll('\r\n', '\n');
    const normalizedText = enabled ? text.trim() : '';

    const section = {
      moduleId: id,
      title: String(module?.title || '').trim() || id,
      description: String(module?.description || '').trim(),
      enabled,
      text: normalizedText,
    };
    sections.push(section);
    traceByModuleId[id] = {
      moduleId: id,
      enabled,
      mode,
      template,
      text: normalizedText,
      usedVariables,
      warnings: buildTemplateWarnings(usedVariables, context),
    };
  }

  const finalText = sections
    .filter((s) => s.enabled && s.text)
    .map((s) => s.text)
    .join('\n\n')
    .trim();

  return normalizeCompileResult({
    sections,
    finalText,
    trace: Object.values(traceByModuleId),
    traceByModuleId,
  });
}

function normalizeCompileResult(payload) {
  const rawSections = Array.isArray(payload?.sections) ? payload.sections : [];
  const sections = rawSections.map((section) => {
    if (!section || typeof section !== 'object') return section;
    const text = typeof section.text === 'string'
      ? section.text
      : typeof section.content === 'string'
        ? section.content
        : typeof section.output === 'string'
          ? section.output
          : '';
    return {
      ...section,
      text: String(text || '').replaceAll('\r\n', '\n').trim(),
    };
  });
  const trace = payload?.trace ?? [];
  const traceByModuleId = payload?.traceByModuleId && typeof payload.traceByModuleId === 'object'
    ? payload.traceByModuleId
    : Object.fromEntries(
      sections
        .map((section) => {
          const moduleId = String(section?.moduleId || section?.id || '').trim();
          if (!moduleId) return null;
          const text = typeof section?.text === 'string' ? section.text : typeof section?.content === 'string' ? section.content : '';
          const mode = String(section?.mode || section?.source || '').trim();
          const enabled = section?.enabled !== false;
          return [
            moduleId,
            {
              moduleId,
              enabled,
              mode,
              template: typeof section?.template === 'string' ? section.template : '',
              text: String(text || '').replaceAll('\r\n', '\n'),
              warnings: Array.isArray(section?.warnings) ? section.warnings : [],
            },
          ];
        })
        .filter(Boolean),
    );
  return {
    sections,
    finalText: sections
      .filter((section) => section?.enabled !== false && String(section?.text || '').trim())
      .map((section) => String(section.text || '').replaceAll('\r\n', '\n').trim())
      .join('\n\n')
      .trim(),
    trace,
    traceByModuleId,
  };
}

function buildCompileContext({ thread, previewText, messages, turnContext }) {
  const contact = thread?.contact || null;
  const character = contact?.character || null;
  const workflowInput =
    (thread?.workflowInput && typeof thread.workflowInput === 'object' && !Array.isArray(thread.workflowInput))
      ? thread.workflowInput
      : (contact?.workflowInput && typeof contact.workflowInput === 'object' && !Array.isArray(contact.workflowInput))
        ? contact.workflowInput
        : (character?.workflowInput && typeof character.workflowInput === 'object' && !Array.isArray(character.workflowInput))
          ? character.workflowInput
          : {};
  const userPersona = String(workflowInput?.userPersona || '').trim();
  const relationship = contact?.relationship && typeof contact.relationship === 'object' ? contact.relationship : {};
  const trust = Number.isFinite(Number(relationship?.trust)) ? Number(relationship.trust) : 0;
  const intimacy = Number.isFinite(Number(relationship?.intimacy)) ? Number(relationship.intimacy) : 0;
  const tension = Number.isFinite(Number(relationship?.tension)) ? Number(relationship.tension) : 0;

  const timeContext = buildTimeContext(thread);
  const recentBlock = buildRecentConversationBlock(messages, previewText);
  const turnContextBlock = buildTurnContextBlock(turnContext);

  const relationshipLine = `Relationship: trust=${trust.toFixed(2)}, intimacy=${intimacy.toFixed(2)}, tension=${tension.toFixed(2)}`;

  return {
    thread,
    contact,
    character,
    workflowInput,
    userPersona,
    relationship: {
      trust,
      intimacy,
      tension,
      trustFixed: trust.toFixed(2),
      intimacyFixed: intimacy.toFixed(2),
      tensionFixed: tension.toFixed(2),
      line: relationshipLine,
    },
    timeContext,
    turnContext,
    turnContextBlock,
    recentConversation: {
      block: recentBlock,
    },
    preview: {
      userMessage: previewText,
    },
  };
}

function buildTimeContext(thread) {
  const tz = String(thread?.timeSettings?.timezone || 'Etc/UTC').trim() || 'Etc/UTC';
  const locale = String(thread?.timeSettings?.locale || 'zh-CN').trim() || 'zh-CN';
  const now = new Date();
  let local = '';
  try {
    local = now.toLocaleString(locale, {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    local = now.toISOString();
  }
  return {
    timezone: tz,
    locale,
    nowIso: now.toISOString(),
    block: `Time: ${local} (timezone=${tz})`,
  };
}

function buildRecentConversationBlock(messages, previewText) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-8) : [];
  if (!list.length) return '';
  let latestUserIndex = -1;
  for (let idx = list.length - 1; idx >= 0; idx -= 1) {
    if (list[idx]?.role === 'user') {
      latestUserIndex = idx;
      break;
    }
  }
  return list
    .map((item, idx) => `${item.role}: ${idx === latestUserIndex && previewText ? previewText : item.content}`)
    .join('\n');
}

function buildTurnContextBlock(turnContext) {
  if (!turnContext || typeof turnContext !== 'object') return '';
  const lines = ['Dynamic SmallPhone context:'];
  if (turnContext.activeMask?.id) {
    lines.push(`- Active mask: ${turnContext.activeMask.id} (${Number(turnContext.activeMask.confidence || 0).toFixed(2)})`);
  }
  if (turnContext.relationshipState?.id) {
    lines.push(`- Relationship state: ${turnContext.relationshipState.id} (${Number(turnContext.relationshipState.intensity || 0).toFixed(2)})`);
  }
  if (Array.isArray(turnContext.matchedWorldbookEntries) && turnContext.matchedWorldbookEntries.length) {
    lines.push('- Matched worldbook:');
    for (const entry of turnContext.matchedWorldbookEntries) {
      lines.push(`  - ${entry.name || entry.id}: ${entry.content}`);
    }
  }
  if (Array.isArray(turnContext.replyGuidance) && turnContext.replyGuidance.length) {
    lines.push('- Reply guidance:');
    for (const guidance of turnContext.replyGuidance) {
      lines.push(`  - ${guidance}`);
    }
  }
  return lines.join('\n');
}

function renderTemplate(template, context) {
  const used = [];
  const text = String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const path = String(key || '').trim();
    if (!path) return '';
    used.push(path);
    const value = getByPath(context, path);
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
  return { text, usedVariables: [...new Set(used)] };
}

function buildModulesForCompile(modules) {
  const list = Array.isArray(modules) ? modules : [];
  return list
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      ...m,
      fields: buildModuleFieldsForCompile(m.fields),
    }));
}

function buildModuleFieldsForCompile(fields) {
  return normalizeModuleFields(fields).map((field) => {
    const sourceType = String(field?.sourceType || 'manual').trim();
    if (sourceType === 'query') return field;
    return { ...field, resolvedValue: resolveMappedFieldValue(field) };
  });
}

function renderModuleFieldPlaceholders(template, module) {
  const values = moduleFieldValues(module?.fields);
  return String(template || '').replace(/\{\{\s*(fields|vars|app)\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_, _scope, key) => {
    const id = normalizeFieldId(key);
    return values[id] == null ? '' : String(values[id]);
  });
}

function moduleFieldValues(fields) {
  const values = {};
  for (const field of normalizeModuleFields(fields)) {
    values[field.id] = field.resolvedValue != null
      ? String(field.resolvedValue).replaceAll('\r\n', '\n')
      : resolveMappedFieldValue(field);
  }
  return values;
}

function resolveMappedFieldValue(field) {
  const fallback = String(field?.value || '').replaceAll('\r\n', '\n');
  const sourceType = String(field?.sourceType || 'manual').trim();
  const source = String(field?.source || '').trim();
  if (!source || sourceType === 'manual') return fallback;

  if (sourceType === 'dom') {
    return readDomSourceValue(source, field?.attribute) ?? fallback;
  }
  if (sourceType === 'iframe') {
    return readIframeSourceValue(source, field?.attribute) ?? fallback;
  }
  if (sourceType === 'localStorage') {
    return readLocalStorageSourceValue(source, field?.path) ?? fallback;
  }
  if (sourceType === 'window') {
    return stringifyMappedValue(getByPath(window, source)) || fallback;
  }
  if (sourceType === 'query') {
    return fallback;
  }
  return fallback;
}

function readIframeSourceValue(selector, attribute) {
  const frame = document.querySelector('#dynamic-app-frame');
  if (!(frame instanceof HTMLIFrameElement)) return null;
  try {
    const doc = frame.contentDocument;
    if (!doc) return null;
    const element = doc.querySelector(selector);
    if (!element) return null;
    const attr = String(attribute || '').trim();
    if (attr) {
      const value = element.getAttribute(attr);
      return value == null ? null : value;
    }
    if ('value' in element) return String(element.value || '').replaceAll('\r\n', '\n');
    return String(element.textContent || '').trim();
  } catch {
    return null;
  }
}

function readDomSourceValue(selector, attribute) {
  let element = null;
  try {
    element = document.querySelector(selector);
  } catch {
    element = null;
  }
  if (!element) return null;
  const attr = String(attribute || '').trim();
  if (attr) {
    const value = element.getAttribute(attr);
    return value == null ? null : value;
  }
  if ('value' in element) return String(element.value || '').replaceAll('\r\n', '\n');
  return String(element.textContent || '').trim();
}

function readLocalStorageSourceValue(key, path) {
  const raw = window.localStorage.getItem(String(key || '').trim());
  if (raw == null) return null;
  const propertyPath = String(path || '').trim();
  if (!propertyPath) return raw;
  try {
    const parsed = JSON.parse(raw);
    return stringifyMappedValue(getByPath(parsed, propertyPath));
  } catch {
    return null;
  }
}

function stringifyMappedValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.replaceAll('\r\n', '\n');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildModuleCompileContext(context, module) {
  return {
    ...context,
    fields: moduleFieldValues(module?.fields),
    vars: moduleFieldValues(module?.fields),
    app: moduleFieldValues(module?.fields),
    module: {
      id: String(module?.id || '').trim(),
      title: String(module?.title || '').trim(),
      description: String(module?.description || '').trim(),
      kind: String(module?.kind || 'template').trim() || 'template',
      workflow: normalizeModuleWorkflow(module?.workflow),
    },
  };
}

function getByPath(root, path) {
  const parts = String(path || '').split('.').map((p) => p.trim()).filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function createUniqueModuleId(existingIds) {
  const used = existingIds instanceof Set ? existingIds : new Set();
  const base = `custom-${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function buildTemplateWarnings(usedVariables, context) {
  const warnings = [];
  for (const variable of usedVariables || []) {
    const v = getByPath(context, variable);
    if (v == null || v === '') {
      warnings.push(`未解析变量：{{${variable}}}`);
    }
  }
  return warnings.slice(0, 6);
}

function setModuleContentOverride(moduleId, text) {
  const id = String(moduleId || '').trim();
  if (!id) return;
  promptBoardState = {
    ...promptBoardState,
    modules: promptBoardState.modules.map((m) => (String(m?.id || '') === id ? { ...m, contentOverride: text } : m)),
  };
  schedulePersistDrafts();
  scheduleCompile();
}

function toggleModuleEnabled(moduleId) {
  const id = String(moduleId || '').trim();
  if (!id) return;
  promptBoardState = {
    ...promptBoardState,
    modules: promptBoardState.modules.map((m) => {
      if (String(m?.id || '') !== id) return m;
      return { ...m, enabled: m?.enabled === false };
    }),
  };
  schedulePersistDrafts();
  scheduleCompile({ force: true });
  renderPromptBoard();
}

function addCustomModule() {
  const existingIds = new Set((promptBoardState.modules || []).map((m) => String(m?.id || '').trim()));
  const id = createUniqueModuleId(existingIds);
  const order = Math.max(0, ...promptBoardState.modules.map((m) => Number(m?.order || 0)).filter(Number.isFinite)) + 1;
  const module = {
    id,
    title: '自定义模块',
    description: '并行上下文块；变量可从任意 App 的字段、localStorage 或 window 状态映射过来。',
    enabled: true,
    order,
    kind: 'custom',
    template: '{{fields.content}}',
    contentOverride: '',
    fields: [
      {
        id: 'content',
        label: '内容',
        type: 'textarea',
        value: '',
        placeholder: '可手填，也可改成从 App 字段映射。',
        sourceType: 'manual',
        source: '',
        attribute: '',
        path: '',
      },
    ],
    workflow: {
      mode: 'parallel',
      nodeType: 'context.block',
      inputs: [],
      outputs: ['context.block'],
    },
  };
  promptBoardState = {
    ...promptBoardState,
    modules: normalizeModuleList([...promptBoardState.modules, module]),
    editor: { open: true, moduleId: id },
  };
  schedulePersistDrafts();
  scheduleCompile({ force: true });
  renderPromptBoard();
}

function openModuleEditor(moduleId) {
  const id = String(moduleId || '').trim();
  if (!id) return;
  promptBoardState = {
    ...promptBoardState,
    editor: {
      open: true,
      moduleId: id,
    },
  };
  renderModuleEditor();
  renderPromptBoard();
}

function closeModuleEditor() {
  promptBoardState = {
    ...promptBoardState,
    editor: { open: false, moduleId: '' },
  };
  renderPromptBoard();
}

function renderModuleEditor() {
  const container = qs('#promptboard-module-body');
  const title = qs('#promptboard-module-title');
  if (!container || !title) return;
  const module = promptBoardState.modules.find((m) => String(m?.id || '') === promptBoardState.editor.moduleId) || null;
  if (!module) {
    container.innerHTML = `
      <article class="promptboard-empty">
        <strong>模块不存在</strong>
        <p>该模块可能已被删除。</p>
      </article>
    `;
    title.textContent = '模块编辑';
    return;
  }

  const compiledTrace = promptBoardState.compile.result?.traceByModuleId?.[module.id] || null;
  const traceWarnings = Array.isArray(compiledTrace?.warnings) ? compiledTrace.warnings : [];
  const traceMode = String(compiledTrace?.mode || '').trim();
  const traceText = typeof compiledTrace?.text === 'string' ? compiledTrace.text : '';
  const moduleKind = String(module.kind || 'template').trim() || 'template';
  const moduleWorkflow = normalizeModuleWorkflow(module.workflow);

  title.textContent = module.title || module.id;

  container.innerHTML = `
    <div class="promptboard-module-hint">
      <span class="promptboard-chip">标题/说明不会发送到 21040</span>
      <span class="promptboard-chip promptboard-chip-mono">${escapeHtml(module.id)}</span>
      <span class="promptboard-chip">${escapeHtml(moduleKind)}</span>
      <span class="promptboard-chip">${escapeHtml(moduleWorkflow.mode)}</span>
      ${traceMode ? `<span class="promptboard-chip">${escapeHtml(traceMode)}</span>` : ''}
    </div>

    <form class="settings-form promptboard-module-form" id="promptboard-module-form">
      <label>
        <span>标题（不发送）</span>
        <input type="text" id="promptboard-edit-title" value="${escapeHtml(module.title || '')}" maxlength="40" placeholder="模块标题">
      </label>
      <label>
        <span>说明（不发送）</span>
        <textarea id="promptboard-edit-description" rows="3" placeholder="写给自己看的模块说明...">${escapeHtml(module.description || '')}</textarea>
      </label>
      <label class="toggle-row">
        <input type="checkbox" id="promptboard-edit-enabled"${module.enabled !== false ? ' checked' : ''}>
        <span>启用该模块</span>
      </label>
      <label>
        <span>模板（会被编译成发送内容）</span>
        <textarea id="promptboard-edit-template" rows="6" spellcheck="false" placeholder="例如：Character: {{character.name}}">${escapeHtml(module.template || '')}</textarea>
      </label>
      <details class="details-panel promptboard-fields-panel" open>
        <summary>变量映射</summary>
        <div class="details-panel-body">
          <div class="promptboard-fields-list" id="promptboard-fields-list">
            ${renderModuleFieldRows(module.fields)}
          </div>
          <button class="secondary-button promptboard-add-field" id="promptboard-add-field" type="button">添加变量</button>
        </div>
      </details>
      <details class="details-panel promptboard-workflow-panel">
        <summary>工作流兼容</summary>
        <div class="details-panel-body">
          <label>
            <span>执行模式</span>
            <select id="promptboard-edit-workflow-mode">
              <option value="parallel"${moduleWorkflow.mode === 'parallel' ? ' selected' : ''}>并行模块</option>
              <option value="serial"${moduleWorkflow.mode === 'serial' ? ' selected' : ''}>串行步骤（预留）</option>
            </select>
          </label>
          <label>
            <span>节点类型</span>
            <input type="text" id="promptboard-edit-workflow-node" value="${escapeHtml(moduleWorkflow.nodeType)}" placeholder="context.block">
          </label>
        </div>
      </details>
      <label>
        <span>最终内容覆盖（直接发送，优先级高于模板）</span>
        <textarea id="promptboard-edit-override" rows="5" spellcheck="false" placeholder="留空表示按模板编译。">${escapeHtml(module.contentOverride || '')}</textarea>
      </label>

      <details class="details-panel promptboard-trace-details">
        <summary>本次编译结果与追踪</summary>
        <div class="details-panel-body">
          <textarea class="promptboard-trace-text" rows="8" spellcheck="false" readonly>${escapeHtml(traceText)}</textarea>
          ${traceWarnings.length ? `
            <div class="promptboard-trace-warnings">
              ${traceWarnings.map((w) => `<p>${escapeHtml(w)}</p>`).join('')}
            </div>
          ` : '<p class="promptboard-trace-muted">未发现未解析变量。</p>'}
        </div>
      </details>

      <div class="promptboard-module-actions">
        <button class="secondary-button" id="promptboard-module-apply" type="submit">应用</button>
        <button class="ghost-button" id="promptboard-module-reset-override" type="button">清空覆盖</button>
      </div>
    </form>
  `;

  const form = qs('#promptboard-module-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    applyModuleEditorChanges(module.id);
  });
  qs('#promptboard-add-field')?.addEventListener('click', () => {
    appendModuleFieldRow();
  });
  qs('#promptboard-fields-list')?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const remove = target.closest('[data-prompt-field-remove]');
    if (!remove) return;
    const row = remove.closest('[data-prompt-field-row]');
    row?.remove();
  });
  qs('#promptboard-module-reset-override')?.addEventListener('click', () => {
    const override = qs('#promptboard-edit-override');
    if (override) override.value = '';
    applyModuleEditorChanges(module.id);
  });
}

function applyModuleEditorChanges(moduleId) {
  const id = String(moduleId || '').trim();
  const title = qs('#promptboard-edit-title');
  const description = qs('#promptboard-edit-description');
  const enabled = qs('#promptboard-edit-enabled');
  const template = qs('#promptboard-edit-template');
  const override = qs('#promptboard-edit-override');
  const workflowMode = qs('#promptboard-edit-workflow-mode');
  const workflowNode = qs('#promptboard-edit-workflow-node');
  if (!id || !title || !description || !enabled || !template || !override) return;

  const currentModule = promptBoardState.modules.find((m) => String(m?.id || '') === id) || null;
  const previousWorkflow =
    currentModule && currentModule.workflow && typeof currentModule.workflow === 'object' && !Array.isArray(currentModule.workflow)
      ? currentModule.workflow
      : null;
  const nextWorkflow = normalizeModuleWorkflow({
    ...(previousWorkflow || {}),
    mode: String(workflowMode?.value || previousWorkflow?.mode || 'parallel'),
    nodeType: String(workflowNode?.value || previousWorkflow?.nodeType || previousWorkflow?.node_type || 'context.block'),
  });

  const next = {
    title: String(title.value || '').trim(),
    description: String(description.value || '').trim(),
    enabled: Boolean(enabled.checked),
    kind: String(currentModule?.kind || 'custom').trim() || 'custom',
    template: String(template.value || '').replaceAll('\r\n', '\n'),
    contentOverride: String(override.value || '').replaceAll('\r\n', '\n'),
    fields: readModuleFieldsFromEditor(),
    workflow: nextWorkflow,
  };

  promptBoardState = {
    ...promptBoardState,
    modules: promptBoardState.modules.map((m) => (String(m?.id || '') === id ? { ...m, ...next } : m)),
  };
  schedulePersistDrafts();
  scheduleCompile({ force: true });
  renderModuleEditor();
  renderPromptBoard();
}

function renderModuleFieldRows(fields) {
  const normalized = normalizeModuleFields(fields);
  const rows = normalized.length
    ? normalized
    : [{ id: 'content', label: '内容', type: 'textarea', value: '', placeholder: '手填默认值，或改成从 App 字段映射。', sourceType: 'manual' }];
  return rows.map((field, index) => renderModuleFieldRow(field, index)).join('');
}

function renderModuleFieldRow(field, index) {
  const id = String(field?.id || `field${index + 1}`).trim();
  const type = String(field?.type || 'textarea') === 'text' ? 'text' : 'textarea';
  const label = String(field?.label || id).trim();
  const value = String(field?.value || '').replaceAll('\r\n', '\n');
  const placeholder = String(field?.placeholder || '').trim();
  const sourceType = String(field?.sourceType || 'manual').trim() || 'manual';
  const source = String(field?.source || '').trim();
  const attribute = String(field?.attribute || '').trim();
  const path = String(field?.path || '').trim();
  return `
    <article class="promptboard-field-row" data-prompt-field-row>
      <div class="promptboard-field-grid">
        <label>
          <span>变量名</span>
          <input type="text" data-field-id value="${escapeHtml(id)}" placeholder="content">
        </label>
        <label>
          <span>标签</span>
          <input type="text" data-field-label value="${escapeHtml(label)}" placeholder="内容">
        </label>
        <label>
          <span>类型</span>
          <select data-field-type>
            <option value="textarea"${type === 'textarea' ? ' selected' : ''}>多行</option>
            <option value="text"${type === 'text' ? ' selected' : ''}>单行</option>
          </select>
        </label>
      </div>
      <div class="promptboard-field-grid">
        <label>
          <span>来源</span>
          <select data-field-source-type>
            <option value="manual"${sourceType === 'manual' ? ' selected' : ''}>手填默认值</option>
            <option value="dom"${sourceType === 'dom' ? ' selected' : ''}>页面字段 / DOM</option>
            <option value="iframe"${sourceType === 'iframe' ? ' selected' : ''}>动态 App iframe</option>
            <option value="localStorage"${sourceType === 'localStorage' ? ' selected' : ''}>localStorage</option>
            <option value="window"${sourceType === 'window' ? ' selected' : ''}>window 路径</option>
            <option value="query"${sourceType === 'query' ? ' selected' : ''}>查询 URL / API</option>
          </select>
        </label>
        <label>
          <span>选择器 / Key / 路径 / URL</span>
          <input type="text" data-field-source value="${escapeHtml(source)}" placeholder="#app-input 或 /api/value">
        </label>
        <label>
          <span>属性 / JSON 路径</span>
          <input type="text" data-field-attribute value="${escapeHtml(attribute || path)}" placeholder="value / data-x / profile.name">
        </label>
      </div>
      ${sourceType === 'query' ? `
        <p class="promptboard-field-hint">query 类型不会在前端发起请求；这里只保存 URL/配置与默认值，编译时由后端解析并注入模板。</p>
      ` : ''}
      <label>
        <span>默认值 · 模板变量 {{fields.${escapeHtml(id)}}} / {{app.${escapeHtml(id)}}}</span>
        <textarea data-field-value rows="4" spellcheck="false" placeholder="${escapeHtml(placeholder || '映射失败时使用这里的默认值。')}">${escapeHtml(value)}</textarea>
      </label>
      <div class="promptboard-field-actions">
        <button class="ghost-button" data-prompt-field-remove type="button">移除字段</button>
      </div>
    </article>
  `;
}

function appendModuleFieldRow() {
  const list = qs('#promptboard-fields-list');
  if (!list) return;
  const used = new Set(readModuleFieldsFromEditor().map((field) => field.id));
  let index = used.size + 1;
  let id = `field${index}`;
  while (used.has(id)) {
    index += 1;
    id = `field${index}`;
  }
  list.insertAdjacentHTML('beforeend', renderModuleFieldRow({
    id,
    label: `字段 ${index}`,
    type: 'textarea',
    value: '',
    placeholder: '',
    sourceType: 'manual',
    source: '',
    attribute: '',
    path: '',
  }, index - 1));
}

function readModuleFieldsFromEditor() {
  const rows = Array.from(document.querySelectorAll('[data-prompt-field-row]'));
  const seen = new Set();
  return rows
    .map((row, index) => {
      if (!(row instanceof HTMLElement)) return null;
      const idInput = row.querySelector('[data-field-id]');
      const labelInput = row.querySelector('[data-field-label]');
      const typeInput = row.querySelector('[data-field-type]');
      const valueInput = row.querySelector('[data-field-value]');
      const sourceTypeInput = row.querySelector('[data-field-source-type]');
      const sourceInput = row.querySelector('[data-field-source]');
      const attributeInput = row.querySelector('[data-field-attribute]');
      const id = normalizeFieldId(idInput?.value || `field${index + 1}`);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: String(labelInput?.value || id).trim(),
        type: String(typeInput?.value || 'textarea') === 'text' ? 'text' : 'textarea',
        value: String(valueInput?.value || '').replaceAll('\r\n', '\n'),
        placeholder: String(valueInput?.getAttribute('placeholder') || '').trim(),
        sourceType: String(sourceTypeInput?.value || 'manual').trim() || 'manual',
        source: String(sourceInput?.value || '').trim(),
        attribute: String(attributeInput?.value || '').trim(),
        path: String(attributeInput?.value || '').trim(),
      };
    })
    .filter(Boolean);
}

function cssEscape(value) {
  const raw = String(value || '');
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(raw);
  }
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeThreadList(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.threads) ? payload.threads : [];
  return list.filter((item) => item && typeof item === 'object' && item.id);
}

function normalizeWorkflowList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.workflows)
      ? payload.workflows
      : [];
  return list.filter((item) => item && typeof item === 'object' && item.id);
}

function workflowKeyFromWorkflow(workflow) {
  if (!workflow) return '';
  const id = String(workflow.id || '').trim();
  const version = Number.isFinite(Number(workflow.version)) ? Number(workflow.version) : '';
  return id ? `${id}@${version || ''}` : '';
}

function workflowKeyFromThreadRef(thread) {
  const id = String(thread?.workflowId || thread?.workflow?.id || '').trim();
  const versionRaw = thread?.workflowVersion ?? thread?.workflow?.version;
  const version = Number.isFinite(Number(versionRaw)) ? Number(versionRaw) : '';
  return id ? `${id}@${version || ''}` : '';
}

function getSelectedThread() {
  const id = String(promptBoardState.selectedThreadId || '').trim();
  return (promptBoardState.threads || []).find((t) => String(t?.id || '') === id) || (promptBoardState.threads || [])[0] || null;
}

function getSelectedWorkflow() {
  const key = String(promptBoardState.selectedWorkflowKey || '').trim();
  const workflows = promptBoardState.workflows || [];
  if (!key) return workflows[0] || null;
  const byKey = workflows.find((wf) => workflowKeyFromWorkflow(wf) === key);
  if (byKey) return byKey;
  const id = key.split('@')[0];
  return workflows.find((wf) => String(wf?.id || '') === id) || workflows[0] || null;
}

function normalizeModuleList(modules) {
  const list = Array.isArray(modules) ? modules : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const contentOverride =
      typeof item.contentOverride === 'string'
        ? item.contentOverride
        : (typeof item.outputOverride === 'string' ? item.outputOverride : '');
    out.push({
      id,
      title: String(item.title || '').trim(),
      description: String(item.description || '').trim(),
      enabled: item.enabled !== false,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : undefined,
      kind: String(item.kind || 'template').trim() || 'template',
      template: String(item.template || '').replaceAll('\r\n', '\n'),
      contentOverride,
      fields: normalizeModuleFields(item.fields),
      workflow: normalizeModuleWorkflow(item.workflow),
    });
  }
  return out;
}

function normalizeModuleFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const seen = new Set();
  return list
    .map((field, index) => {
      if (!field || typeof field !== 'object') return null;
      const id = normalizeFieldId(field.id || `field${index + 1}`);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: String(field.label || id).trim(),
        type: String(field.type || 'textarea').trim() === 'text' ? 'text' : 'textarea',
        value: String(field.value || '').replaceAll('\r\n', '\n'),
        placeholder: String(field.placeholder || '').trim(),
        sourceType: String(field.sourceType || field.source_type || 'manual').trim() || 'manual',
        source: String(field.source || '').trim(),
        attribute: String(field.attribute || '').trim(),
        path: String(field.path || '').trim(),
      };
    })
    .filter(Boolean);
}

function normalizeFieldId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function normalizeModuleWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return { mode: 'parallel', nodeType: 'context.block', inputs: [], outputs: ['context.block'] };
  }
  const mode = String(workflow.mode || 'parallel').trim();
  const nodeType = String(workflow.nodeType || workflow.node_type || 'context.block').trim();
  return {
    mode: mode === 'serial' ? 'serial' : 'parallel',
    nodeType: nodeType || 'context.block',
    inputs: Array.isArray(workflow.inputs) ? workflow.inputs.map((v) => String(v || '').trim()).filter(Boolean) : [],
    outputs: Array.isArray(workflow.outputs) && workflow.outputs.length
      ? workflow.outputs.map((v) => String(v || '').trim()).filter(Boolean)
      : ['context.block'],
  };
}

function extractPromptBoardModules(workflow) {
  if (!workflow || typeof workflow !== 'object') return null;
  const promptBoard = workflow.promptBoard || workflow.prompt_board || workflow.promptboard || null;
  if (Array.isArray(promptBoard?.modules)) return promptBoard.modules;
  if (Array.isArray(workflow.modules)) return workflow.modules;
  return null;
}

function createDefaultModules() {
  return [
    {
      id: 'header',
      title: '头部',
      description: '固定开头，用于标识 SmallPhone turn。',
      enabled: true,
      template: 'SmallPhone turn',
    },
    {
      id: 'character',
      title: '角色名称',
      description: '会被发送；用于让模型明确当前角色。',
      enabled: true,
      template: 'Character: {{character.name}}',
    },
    {
      id: 'persona',
      title: '角色 Persona',
      description: '会被发送；来自联系人角色设定。',
      enabled: true,
      template: 'Persona: {{character.persona}}',
    },
    {
      id: 'userPersona',
      title: '用户 Persona',
      description: '会被发送；来自 workflowInput.userPersona（可为空）。',
      enabled: true,
      template: 'User persona: {{userPersona}}',
    },
    {
      id: 'contact',
      title: '联系人信息',
      description: '会被发送；显示联系人名。',
      enabled: true,
      template: 'Contact: {{contact.displayName}}',
    },
    {
      id: 'thread',
      title: '线程信息',
      description: '会被发送；显示线程标题。',
      enabled: true,
      template: 'Thread: {{thread.title}}',
    },
    {
      id: 'relationship',
      title: '关系值',
      description: '会被发送；trust/intimacy/tension 的数值快照。',
      enabled: true,
      template: '{{relationship.line}}',
    },
    {
      id: 'timeContext',
      title: '时间上下文',
      description: '会被发送；本地生成的时间块（后端可替换）。',
      enabled: true,
      template: '{{timeContext.block}}',
    },
    {
      id: 'turnContext',
      title: '动态上下文',
      description: '会被发送；来自 /context-preview 的世界书、mask、引导等。',
      enabled: true,
      template: '{{turnContextBlock}}',
    },
    {
      id: 'recentHeader',
      title: '最近对话标题',
      description: '会被发送；最近对话区块标题。',
      enabled: true,
      template: 'Recent conversation:',
    },
    {
      id: 'recent',
      title: '最近对话',
      description: '会被发送；最后 8 条 user/assistant 对话，含本次预览消息。',
      enabled: true,
      template: '{{recentConversation.block}}',
    },
    {
      id: 'closing',
      title: '收尾指令',
      description: '会被发送；决定回复风格（简洁、具体）。',
      enabled: true,
      template: 'Reply as the contact inside a small-phone chat. Be concise and concrete.',
    },
  ];
}

function createFixtureSnapshot() {
  const workflow = {
    id: 'smallphone.default.contact',
    version: 1,
    name: 'Default Contact',
    description: 'Fixture workflow',
    promptBoard: { modules: createDefaultModules() },
  };
  const thread = {
    id: 'fixture-thread',
    title: '演示线程',
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowInput: {
      userPersona: '你是晚风，喜欢慢节奏聊天与夜色散步。',
    },
    timeSettings: { timezone: 'Etc/UTC', locale: 'zh-CN' },
    contact: {
      id: 'fixture-contact',
      displayName: '林秋',
      relationship: { trust: 0.62, intimacy: 0.55, tension: 0.12 },
      character: {
        id: 'fixture-character',
        name: '林秋',
        persona: '海边摄影师，语气温柔，擅长把日常说得很浪漫。',
      },
    },
    lastMessage: { role: 'user', content: '今晚去海边走走吗？' },
    messages: [
      { id: 'fx-msg-1', role: 'user', content: '你今天拍到什么好看的云了吗？', createdAt: '' },
      { id: 'fx-msg-2', role: 'assistant', content: '有一团像棉花糖的云，边缘被夕阳染得发粉。我一看就想到你。', createdAt: '' },
      { id: 'fx-msg-3', role: 'user', content: '听起来很温柔。今晚去海边走走吗？', createdAt: '' },
    ],
  };
  const workflowKey = workflowKeyFromWorkflow(workflow);
  return {
    workflows: [workflow],
    threads: [thread],
    workflowKey,
    previewText: '今晚去海边走走吗？',
    modules: createDefaultModules(),
  };
}

async function copyToClipboard(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', 'true');
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore
    } finally {
      textarea.remove();
    }
  }
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
