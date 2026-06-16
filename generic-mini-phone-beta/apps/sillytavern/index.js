import { escapeHtml, qs } from '../shared.js';
import { resolveBackendBase } from '../workflows/api.js?v=4';

const defaultUrl = 'http://127.0.0.1:8000/';

let sillyState = {
  loading: false,
  status: null,
  logs: null,
  message: '',
  error: '',
};

export const manifest = {
  id: 'sillytavern',
  name: 'SillyTavern',
  shortName: 'ST',
  orbClass: 'orb-workflows',
  views: {
    normal: 'sillytavern',
  },
};

export const defaultState = {
  standaloneApps: {
    sillytavern: {
      url: defaultUrl,
      path: '',
    },
  },
};

export const template = `
  <section class="view app-workspace" data-view="sillytavern">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">SillyTavern</p>
        <h2>SillyTavern</h2>
      </div>
      <span class="app-view-pill" id="sillytavern-status-pill">未加载</span>
    </div>

    <div class="promptboard-actions">
      <button class="soft-button small-button" id="sillytavern-open" type="button">打开页面</button>
      <button class="secondary-button small-button" id="sillytavern-status-refresh" type="button">刷新状态</button>
      <button class="secondary-button small-button" data-sillytavern-action="github-status" type="button">检查 GitHub</button>
      <button class="secondary-button small-button" data-sillytavern-action="install" type="button">安装</button>
      <button class="secondary-button small-button" data-sillytavern-action="start" type="button">启动</button>
      <button class="secondary-button small-button" data-sillytavern-action="stop" type="button">停止</button>
      <button class="secondary-button small-button" data-sillytavern-action="restart" type="button">重启</button>
      <button class="secondary-button small-button" data-sillytavern-action="logs" type="button">日志</button>
    </div>

    <div class="promptboard-meta" id="sillytavern-message">等待后端状态。</div>

    <iframe id="sillytavern-frame" title="SillyTavern" loading="lazy" style="width:100%;min-height:360px;border:0;border-radius:8px;background:#fff;"></iframe>

    <details class="details-panel">
      <summary>运行信息</summary>
      <div class="details-panel-body" id="sillytavern-details"></div>
    </details>
  </section>
`;

function normalizeUrl(value) {
  const raw = String(value || '').trim() || defaultUrl;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function getLaunchUrl(state) {
  return normalizeUrl(
    state?.standaloneApps?.sillytavern?.url ||
      sillyState.status?.url ||
      defaultUrl,
  );
}

function setBusy(value) {
  sillyState = { ...sillyState, loading: Boolean(value) };
  renderSillyTavern();
}

async function requestSillyTavern(path, init = {}) {
  const base = resolveBackendBase();
  const response = await fetch(`${base}/sillytavern${path}`, {
    headers: { Accept: 'application/json', ...(init.headers || {}) },
    ...init,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload || {};
}

async function refreshStatus() {
  try {
    setBusy(true);
    const status = await requestSillyTavern('/status');
    sillyState = {
      ...sillyState,
      status,
      message: status.error || (status.registered ? '服务已连接。' : '服务未注册或 service-manager 不可用。'),
      error: status.error || '',
    };
  } catch (error) {
    sillyState = {
      ...sillyState,
      error: error instanceof Error ? error.message : '状态刷新失败',
      message: '',
    };
  } finally {
    setBusy(false);
  }
}

async function runAction(action) {
  try {
    setBusy(true);
    const payload = action === 'logs'
      ? await requestSillyTavern('/logs?limit=200')
      : action === 'github-status'
        ? await requestSillyTavern('/github-status')
        : await requestSillyTavern(`/${action}`, { method: 'POST' });
    if (action === 'logs') {
      sillyState = { ...sillyState, logs: payload.logs || payload, message: '日志已刷新。', error: payload.error || '' };
    } else if (action === 'github-status') {
      sillyState = {
        ...sillyState,
        message: payload.reachable ? `GitHub 可达，发现 ${payload.branchCount || 0} 个分支。` : (payload.error || 'GitHub 不可达。'),
        error: payload.reachable ? '' : (payload.error || 'GitHub 不可达。'),
      };
    } else {
      sillyState = { ...sillyState, message: payload.error || `${action} 已提交。`, error: payload.error || '' };
      await refreshStatus();
    }
  } catch (error) {
    sillyState = {
      ...sillyState,
      error: error instanceof Error ? error.message : `${action} 失败`,
    };
  } finally {
    setBusy(false);
  }
}

function renderSillyTavern() {
  const pill = qs('#sillytavern-status-pill');
  const message = qs('#sillytavern-message');
  const details = qs('#sillytavern-details');
  if (pill) {
    const state = sillyState.status?.service?.state || (sillyState.status?.installed ? 'installed' : 'unknown');
    pill.textContent = sillyState.loading ? '处理中' : state;
  }
  if (message) {
    message.textContent = sillyState.error || sillyState.message || '等待后端状态。';
  }
  if (details) {
    const status = sillyState.status || {};
    const logs = sillyState.logs?.entries || sillyState.logs?.lines || [];
    details.innerHTML = `
      <p><strong>URL</strong> ${escapeHtml(status.url || defaultUrl)}</p>
      <p><strong>服务</strong> ${escapeHtml(status.serviceId || 'smallphone-sillytavern')}</p>
      <p><strong>安装目录</strong> ${escapeHtml(status.installDir || '')}</p>
      <p><strong>数据目录</strong> ${escapeHtml(status.dataDir || '')}</p>
      <pre style="white-space:pre-wrap;max-height:220px;overflow:auto;">${escapeHtml(JSON.stringify(logs, null, 2))}</pre>
    `;
  }
  document.querySelectorAll('[data-sillytavern-action], #sillytavern-status-refresh').forEach((button) => {
    button.disabled = sillyState.loading;
  });
}

export function render({ state }) {
  const frame = qs('#sillytavern-frame');
  if (frame && !frame.src) frame.src = getLaunchUrl(state);
  renderSillyTavern();
  if (!sillyState.status && !sillyState.loading) {
    void refreshStatus();
  }
}

export function bind({ state }) {
  qs('#sillytavern-open')?.addEventListener('click', () => {
    const url = getLaunchUrl(state);
    const frame = qs('#sillytavern-frame');
    if (frame) frame.src = url;
    window.open(url, '_blank', 'noopener,noreferrer');
  });
  qs('#sillytavern-status-refresh')?.addEventListener('click', () => {
    void refreshStatus();
  });
  document.querySelectorAll('[data-sillytavern-action]').forEach((button) => {
    button.addEventListener('click', () => {
      void runAction(button.getAttribute('data-sillytavern-action') || '');
    });
  });
}
