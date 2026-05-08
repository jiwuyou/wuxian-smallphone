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
