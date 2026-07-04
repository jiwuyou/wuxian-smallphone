export const BACKEND_STORAGE_KEY = 'smallphone.backendBase';
export const DEFAULT_BACKEND_PORT = '22000';
export const DEFAULT_BACKEND_BASE = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}/api`;
const BLOCKED_CC_CONNECT_PORTS = new Set(['21010', '21020', '21030', '21040']);

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
      const kind = normalizeModuleKind(m?.kind);
      const fields = sanitizeModuleFieldsForCompile(m?.fields);
      const workflow = sanitizeModuleWorkflow(m?.workflow);
      return { id, enabled, template, contentOverride, order, kind, fields, workflow };
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
      const kind = normalizeModuleKind(m?.kind);
      const fields = sanitizeModuleFieldsForPatch(m?.fields);
      const workflow = sanitizeModuleWorkflow(m?.workflow);
      return { id, title, description, enabled, template, contentOverride, order, kind, fields, workflow };
    })
    .filter(Boolean);
}

function normalizeModuleKind(value) {
  const raw = String(value || '').trim();
  return raw || 'template';
}

function sanitizeModuleFieldsForPatch(fields) {
  const list = Array.isArray(fields) ? fields : [];
  return list
    .map((field) => {
      if (!field || typeof field !== 'object') return null;
      const id = String(field.id || '').trim();
      if (!id) return null;
      const sourceType = normalizeFieldSourceType(field.sourceType || field.source_type);
      return {
        id,
        label: String(field.label || id).trim(),
        type: String(field.type || 'textarea').trim() === 'text' ? 'text' : 'textarea',
        value: String(field.value || '').replaceAll('\r\n', '\n'),
        placeholder: String(field.placeholder || '').trim(),
        sourceType,
        source: String(field.source || '').trim(),
        attribute: String(field.attribute || '').trim(),
        path: String(field.path || '').trim(),
      };
    })
    .filter(Boolean);
}

function sanitizeModuleFieldsForCompile(fields) {
  const list = Array.isArray(fields) ? fields : [];
  return list
    .map((field) => {
      if (!field || typeof field !== 'object') return null;
      const id = String(field.id || '').trim();
      if (!id) return null;
      const sourceType = normalizeFieldSourceType(field.sourceType || field.source_type);
      const resolvedValue = field.resolvedValue == null ? undefined : String(field.resolvedValue || '').replaceAll('\r\n', '\n');
      return {
        id,
        label: String(field.label || id).trim(),
        type: String(field.type || 'textarea').trim() === 'text' ? 'text' : 'textarea',
        value: String(field.value || '').replaceAll('\r\n', '\n'),
        placeholder: String(field.placeholder || '').trim(),
        sourceType,
        source: String(field.source || '').trim(),
        attribute: String(field.attribute || '').trim(),
        path: String(field.path || '').trim(),
        // Important: query mappings are resolved by the backend; do not send resolvedValue.
        resolvedValue: sourceType === 'query' ? undefined : resolvedValue,
      };
    })
    .filter(Boolean);
}

function normalizeFieldSourceType(value) {
  const raw = String(value || '').trim();
  if (raw === 'dom' || raw === 'iframe' || raw === 'localStorage' || raw === 'window' || raw === 'query') return raw;
  return 'manual';
}

function sanitizeModuleWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return { mode: 'parallel', nodeType: 'context.block', inputs: [], outputs: ['context.block'] };
  }
  return {
    mode: String(workflow.mode || 'parallel').trim() || 'parallel',
    nodeType: String(workflow.nodeType || workflow.node_type || 'context.block').trim() || 'context.block',
    inputs: Array.isArray(workflow.inputs) ? workflow.inputs.map((v) => String(v || '').trim()).filter(Boolean) : [],
    outputs: Array.isArray(workflow.outputs) ? workflow.outputs.map((v) => String(v || '').trim()).filter(Boolean) : ['context.block'],
  };
}

export function resolveBackendBase() {
  const savedRaw = window.localStorage.getItem(BACKEND_STORAGE_KEY);
  const saved = normalizeCoreBackendBase(savedRaw);
  if (saved) return saved;
  if (savedRaw) {
    window.localStorage.removeItem(BACKEND_STORAGE_KEY);
  }

  const { protocol, hostname } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && hostname && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}/api`;
  }
  return DEFAULT_BACKEND_BASE;
}

export function normalizeCoreBackendBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(completeBackendUrl(raw));
  } catch {
    return '';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  if (BLOCKED_CC_CONNECT_PORTS.has(parsed.port)) return '';

  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';

  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path || path === '/') {
    parsed.pathname = '/api';
  } else if (path.endsWith('/api')) {
    parsed.pathname = path;
  } else if (path.endsWith('/smallphone')) {
    parsed.pathname = `${path.slice(0, -'/smallphone'.length) || ''}/api`;
  } else {
    parsed.pathname = `${path}/api`;
  }

  return parsed.toString().replace(/\/$/, '');
}

function completeBackendUrl(value) {
  const raw = String(value || '').trim();
  if (/^\/\//.test(raw)) {
    return `${getCurrentProtocol()}${raw}`;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith('/')) {
    return new URL(raw, getCurrentOrigin()).toString();
  }
  return `http://${raw}`;
}

function getCurrentProtocol() {
  const protocol = globalThis.window?.location?.protocol;
  return protocol === 'https:' ? 'https:' : 'http:';
}

function getCurrentOrigin() {
  const origin = globalThis.window?.location?.origin;
  return typeof origin === 'string' && origin ? origin : DEFAULT_BACKEND_BASE;
}
