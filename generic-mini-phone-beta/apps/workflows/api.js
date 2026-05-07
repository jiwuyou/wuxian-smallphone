const BACKEND_STORAGE_KEY = 'smallphone.backendBase';
const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:3100/api';

export async function requestBackend(url, init = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...(init.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadThreadPromptBoard({ backendBase, threadId }) {
  const url = `${backendBase}/threads/${encodeURIComponent(threadId)}/prompt-board`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.modules)) return null;
  return payload;
}

export async function saveThreadPromptBoard({ backendBase, threadId, modules }) {
  const url = `${backendBase}/threads/${encodeURIComponent(threadId)}/prompt-board`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ modules: sanitizeModulesForPatch(modules) }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.modules)) return null;
  return payload;
}

export function sanitizeModulesForCompile(modules) {
  const list = Array.isArray(modules) ? modules : [];
  return list
    .map((m, index) => {
      const id = String(m?.id || '').trim();
      if (!id) return null;
      const enabled = m?.enabled !== false;
      const template = String(m?.template || '').replaceAll('\r\n', '\n');
      const order = Number.isFinite(Number(m?.order)) ? Number(m.order) : index + 1;
      const overrideRaw = typeof m?.contentOverride === 'string' ? m.contentOverride : '';
      const normalizedOverride = overrideRaw.replaceAll('\r\n', '\n');
      const contentOverride = normalizedOverride.trim() ? normalizedOverride : null;
      return { id, enabled, template, contentOverride, order };
    })
    .filter(Boolean);
}

function sanitizeModulesForPatch(modules) {
  const list = Array.isArray(modules) ? modules : [];
  return list
    .map((m, index) => {
      const id = String(m?.id || '').trim();
      if (!id) return null;
      const title = String(m?.title || '').trim();
      const description = String(m?.description || '').trim();
      const enabled = m?.enabled !== false;
      const template = String(m?.template || '').replaceAll('\r\n', '\n');
      const order = Number.isFinite(Number(m?.order)) ? Number(m.order) : index + 1;
      const overrideRaw = typeof m?.contentOverride === 'string' ? m.contentOverride : '';
      const normalizedOverride = overrideRaw.replaceAll('\r\n', '\n');
      const contentOverride = normalizedOverride.trim() ? normalizedOverride : null;
      return { id, title, description, enabled, template, contentOverride, order };
    })
    .filter(Boolean);
}

export function resolveBackendBase() {
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
