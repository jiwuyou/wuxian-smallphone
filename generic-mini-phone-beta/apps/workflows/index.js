import { escapeHtml, qs } from '../shared.js';

const BACKEND_STORAGE_KEY = 'smallphone.backendBase';
const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:3100/api';

let workflowState = {
  phase: 'idle',
  workflows: [],
  error: '',
  loadedAt: '',
  inflight: null,
};

export const manifest = {
  id: 'workflows',
  name: '工作流',
  shortName: '流',
  orbClass: 'orb-workflows',
  views: {
    normal: 'workflows',
    space2d: 'workflow-board',
    space3d: 'workflow-lab',
  },
  worldObject: {
    type: 'workflow-console',
    label: '工作流台',
    defaultPlacement: { mapId: 'home', x: 9, y: 6 },
    action: { type: 'openApp', appId: 'workflows', view: 'normal' },
  },
};

export const template = `
  <section class="view app-workspace workflows-workspace" data-view="workflows">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Workflows</p>
        <h2>工作流</h2>
      </div>
      <span class="app-view-pill" id="workflows-status">未加载</span>
    </div>
    <div class="workflows-actions">
      <button class="soft-button small-button" id="workflows-refresh" type="button">刷新</button>
      <span id="workflows-meta" class="workflows-meta">联系人表单与运行时输入规则。</span>
    </div>
    <div class="workflows-list" id="workflows-list"></div>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space workflows-space-2d" data-view="workflow-board" data-space-app="workflows">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Workflow Board</p>
        <h2>工作流台</h2>
      </div>
      <button class="secondary-button" data-app-normal="workflows" type="button">列表</button>
    </div>
    <div class="workflow-board-scene">
      <div class="workflow-node node-active">联系人</div>
      <div class="workflow-node">项目目录</div>
      <div class="workflow-node">用户人设</div>
      <div class="workflow-link link-a"></div>
      <div class="workflow-link link-b"></div>
      <div class="workflow-console-panel"><strong>3</strong><span>核心输入</span></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="workflows" type="button">进入运行室</button>
    </div>
  </section>

  <section class="view app-space-view product-space workflows-space-3d" data-view="workflow-lab" data-space-app="workflows">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Workflow Lab</p>
        <h2>运行室</h2>
      </div>
      <button class="secondary-button" data-app-space2d="workflows" type="button">回工作流台</button>
    </div>
    <div class="workflow-lab-scene">
      <div class="workflow-rack rack-left">Schema</div>
      <div class="workflow-rack rack-right">Runtime</div>
      <div class="workflow-orb">Flow</div>
      <div class="workflow-terminal"><strong>Default Contact</strong><span>workspace + contact persona + user persona</span></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="workflows" type="button">打开工作流</button>
    </div>
  </section>
`;

export function render() {
  ensureWorkflowsLoaded();
  renderWorkflowContent();
}

export function bind() {
  const refreshButton = qs('#workflows-refresh');
  if (!refreshButton) return;
  refreshButton.addEventListener('click', () => {
    loadWorkflows({ force: true });
  });
}

function renderWorkflowContent() {
  const status = qs('#workflows-status');
  const meta = qs('#workflows-meta');
  const list = qs('#workflows-list');
  if (!status || !meta || !list) return;

  const count = workflowState.workflows.length;
  if (workflowState.phase === 'loading') {
    status.textContent = '加载中';
    meta.textContent = '正在读取 SmallPhone 后端工作流。';
  } else if (workflowState.phase === 'error') {
    status.textContent = '加载失败';
    meta.textContent = workflowState.error || '无法连接后端。';
  } else if (workflowState.phase === 'loaded') {
    status.textContent = `${count} 个`;
    meta.textContent = workflowState.loadedAt ? `已同步 ${formatTime(workflowState.loadedAt)}` : '已同步';
  } else {
    status.textContent = '未加载';
    meta.textContent = '联系人表单与运行时输入规则。';
  }

  if (workflowState.phase === 'error') {
    list.innerHTML = `
      <article class="workflow-empty">
        <strong>无法加载工作流</strong>
        <p>${escapeHtml(workflowState.error || '请检查 SmallPhone 后端。')}</p>
      </article>
    `;
    return;
  }

  if (!count) {
    list.innerHTML = `
      <article class="workflow-empty">
        <strong>${workflowState.phase === 'loading' ? '正在加载' : '暂无工作流'}</strong>
        <p>工作流会决定联系人设置表单和运行时提示词输入。</p>
      </article>
    `;
    return;
  }

  list.innerHTML = workflowState.workflows.map(renderWorkflowCard).join('');
}

function renderWorkflowCard(workflow) {
  const schema = normalizeSchema(workflow.contactConfigSchema);
  const properties = schema?.properties && typeof schema.properties === 'object' ? Object.entries(schema.properties) : [];
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  const rules = Array.isArray(workflow.rules) ? workflow.rules : [];
  return `
    <article class="workflow-app-card">
      <div class="workflow-card-top">
        <div>
          <strong>${escapeHtml(workflow.name || workflow.title || workflow.id)}</strong>
          <p>${escapeHtml(workflow.id)}${workflow.version ? ` · v${escapeHtml(workflow.version)}` : ''}</p>
        </div>
        <span>${properties.length} 字段</span>
      </div>
      ${workflow.description ? `<p class="workflow-description">${escapeHtml(workflow.description)}</p>` : ''}
      <div class="workflow-field-list">
        ${properties.map(([key, field]) => renderFieldRow(key, field, required.has(String(key)))).join('')}
      </div>
      ${rules.length ? `
        <div class="workflow-rule-list">
          ${rules.map((rule) => `
            <span>${escapeHtml(rule.id || rule.to || 'rule')}</span>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `;
}

function renderFieldRow(key, field, required) {
  const schema = normalizeSchema(field) || {};
  const title = schema.title || schema.name || key;
  const type = Array.isArray(schema.enum) ? 'enum' : schema.type || 'string';
  return `
    <div class="workflow-field-row">
      <span>${escapeHtml(title)}${required ? ' *' : ''}</span>
      <em>${escapeHtml(key)} · ${escapeHtml(type)}</em>
    </div>
  `;
}

function ensureWorkflowsLoaded() {
  if (workflowState.phase === 'idle') {
    loadWorkflows();
  }
}

async function loadWorkflows({ force = false } = {}) {
  if (workflowState.inflight && !force) return workflowState.inflight;
  if (!force && workflowState.phase === 'loaded') return workflowState.workflows;

  workflowState = {
    ...workflowState,
    phase: 'loading',
    error: '',
  };
  renderWorkflowContent();

  workflowState.inflight = fetch(`${resolveBackendBase()}/contact-workflows`, {
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      workflowState = {
        phase: 'loaded',
        workflows: normalizeWorkflowList(payload),
        error: '',
        loadedAt: new Date().toISOString(),
        inflight: null,
      };
      renderWorkflowContent();
      return workflowState.workflows;
    })
    .catch((error) => {
      workflowState = {
        ...workflowState,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
        inflight: null,
      };
      renderWorkflowContent();
      return [];
    });

  return workflowState.inflight;
}

function resolveBackendBase() {
  const saved = normalizeApiBase(window.localStorage.getItem(BACKEND_STORAGE_KEY));
  if (saved) return saved;

  const { protocol, hostname } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && hostname && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return `http://${hostname}:3100/api`;
  }
  return DEFAULT_BACKEND_BASE;
}

function normalizeApiBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutSlash = raw.replace(/\/+$/, '');
  return withoutSlash.endsWith('/api') ? withoutSlash : `${withoutSlash}/api`;
}

function normalizeWorkflowList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.workflows)
      ? payload.workflows
      : [];
  return list.filter((item) => item && typeof item === 'object' && item.id);
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
  if (schema.schema && typeof schema.schema === 'object') return schema.schema;
  if (schema.jsonSchema && typeof schema.jsonSchema === 'object') return schema.jsonSchema;
  return schema;
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
