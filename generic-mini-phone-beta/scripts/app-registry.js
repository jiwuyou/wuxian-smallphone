import * as calendar from '../apps/calendar/index.js';
import * as weather from '../apps/weather/index.js';
import * as diary from '../apps/diary/index.js';
import * as files from '../apps/files/index.js';
import * as vocabulary from '../apps/vocabulary/index.js';
import * as airplane from '../apps/airplane/index.js';
import * as likeGirl from '../apps/like-girl/index.js';
import * as likeGirlClone from '../apps/like-girl-clone/index.js';
import * as messages from '../apps/messages/index.js';
import * as sillytavern from '../apps/sillytavern/index.js';
import * as workflows from '../apps/workflows/index.js?v=6';

export const appModules = [
  messages,
  calendar,
  weather,
  diary,
  files,
  vocabulary,
  airplane,
  likeGirl,
  likeGirlClone,
  sillytavern,
  workflows,
];

export const registeredApps = appModules.map((app) => ({
  ...app.manifest,
  views: {
    normal: app.manifest?.views?.normal,
  },
}));

export const appDefaultState = appModules.reduce((merged, app) => ({
  ...merged,
  ...(app.defaultState || {}),
}), {});

export const DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN = 'http://127.0.0.1:22000';
export const APP_REGISTRY_API_PATH = '/api/app-registry';

const DYNAMIC_APP_ORB_CLASSES = [
  'orb-chat',
  'orb-calendar',
  'orb-weather',
  'orb-diary',
  'orb-files',
  'orb-vocabulary',
  'orb-airplane',
  'orb-workflows',
  'orb-app-manager',
  'orb-character',
];
const STATIC_APP_ALIASES = {
  chat: 'messages',
};
const BLOCKED_DYNAMIC_APP_PORTS = new Set(['21010', '21020', '21030', '21040']);
const SENSITIVE_QUERY_NAMES = new Set([
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'clientsecret',
  'key',
  'password',
  'passwd',
  'pwd',
  'secret',
  'session',
  'sessionid',
  'sid',
  'jwt',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePublicId(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9:_-]/g, '-');
}

function normalizeServiceMeta(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const id = normalizeString(value);
    return id ? { id } : null;
  }
  if (!isPlainObject(value)) return null;
  const output = { ...value };
  const candidateId = typeof output.id === 'string'
    ? output.id
    : (typeof output.serviceId === 'string' ? output.serviceId : '');
  const normalizedId = normalizeString(candidateId);
  if (normalizedId) output.id = normalizedId;
  return output;
}

function normalizeServiceMetaList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeServiceMeta).filter(Boolean);
  }
  const single = normalizeServiceMeta(value);
  return single ? [single] : [];
}

function trimTrailingSlash(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function ensureTrailingSlash(value) {
  const normalized = normalizeString(value);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function getStaticAppId(app) {
  return normalizePublicId(app?.id || app?.manifest?.id);
}

function createStaticAppIdSet(staticApps = registeredApps, staticAppIds = []) {
  return new Set([
    ...(Array.isArray(staticApps) ? staticApps : []).map(getStaticAppId),
    ...(Array.isArray(staticAppIds) ? staticAppIds : []).map(normalizePublicId),
  ].filter(Boolean));
}

function hashString(value) {
  return Array.from(normalizeString(value)).reduce(
    (hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0,
    0,
  );
}

function pickDynamicOrbClass(seed) {
  return DYNAMIC_APP_ORB_CLASSES[hashString(seed) % DYNAMIC_APP_ORB_CLASSES.length];
}

function getShortName(value) {
  const normalized = normalizeString(value);
  return Array.from(normalized || 'App')[0] || 'A';
}

function normalizeRegistryApp(app) {
  if (!isPlainObject(app)) return null;
  const id = normalizePublicId(app.id);
  if (!id) return null;

  const name = normalizeString(app.name || app.title || id);
  const title = normalizeString(app.title || app.name || name || id);
  return {
    id,
    name,
    title,
    source: normalizeString(app.source),
    kind: normalizeString(app.kind || 'app'),
    entry: normalizeString(app.entry),
    icon: normalizeString(app.icon),
    version: normalizeString(app.version),
    service: normalizeServiceMeta(app.service || app.serviceManager || app.service_manager),
    services: normalizeServiceMetaList(app.services || app.serviceList || app.service_list),
  };
}

function normalizeRegistryComponent(component) {
  if (!isPlainObject(component)) return null;
  const id = normalizePublicId(component.id);
  if (!id) return null;
  const smallphoneApp = isPlainObject(component.smallphoneApp)
    ? component.smallphoneApp
    : (isPlainObject(component.smallphone_app) ? component.smallphone_app : null);
  if (!smallphoneApp) return null;
  const entry = isPlainObject(smallphoneApp.entry) ? smallphoneApp.entry : {};
  const serviceManager = isPlainObject(component.serviceManager)
    ? component.serviceManager
    : (isPlainObject(component.service_manager) ? component.service_manager : {});
  return {
    id,
    name: normalizeString(component.name || component.title || id),
    title: normalizeString(component.title || component.name || id),
    kind: normalizeString(component.kind || 'app'),
    source: normalizeString(component.source || 'component-registry'),
    visible: smallphoneApp.visible !== false,
    section: normalizeString(smallphoneApp.section || 'apps'),
    order: Number.isFinite(Number(smallphoneApp.order)) ? Number(smallphoneApp.order) : 100,
    staticAppId: normalizePublicId(
      smallphoneApp.staticAppId ||
        smallphoneApp.static_app_id ||
        smallphoneApp.appId ||
        smallphoneApp.app_id,
    ),
    entry: {
      type: normalizeString(entry.type),
      url: normalizeString(entry.url),
      view: normalizePublicId(entry.view),
    },
    controlEntry: isPlainObject(smallphoneApp.controlEntry || smallphoneApp.control_entry)
      ? (smallphoneApp.controlEntry || smallphoneApp.control_entry)
      : null,
    services: normalizeServiceMetaList(serviceManager.services),
    aiDocs: normalizeString(component.ai?.summaryDoc || component.ai?.summary_doc || component.aiDocs || component.ai_docs),
    capabilities: normalizeString(component.ai?.capabilities || component.capabilities),
  };
}

function normalizeStaticAppControls(registry) {
  const hiddenIds = new Set();
  const controls = isPlainObject(registry.staticAppControls) ? registry.staticAppControls : {};
  const configuredHiddenIds = Array.isArray(controls.hiddenAppIds)
    ? controls.hiddenAppIds
    : Array.isArray(controls.hidden_app_ids)
      ? controls.hidden_app_ids
      : [];

  configuredHiddenIds
    .map(normalizePublicId)
    .filter(Boolean)
    .forEach((id) => hiddenIds.add(STATIC_APP_ALIASES[id] || id));

  const components = Array.isArray(registry.components) ? registry.components : [];
  components
    .map(normalizeRegistryComponent)
    .filter((component) => component && component.visible === false)
    .forEach((component) => {
      const id = component.staticAppId || component.appId || component.id;
      if (id) hiddenIds.add(STATIC_APP_ALIASES[id] || id);
    });

  return {
    hiddenAppIds: [...hiddenIds].sort(),
  };
}

function normalizeRegistryInstance(instance) {
  if (!isPlainObject(instance)) return null;
  const id = normalizePublicId(instance.id);
  if (!id) return null;

  const settings = isPlainObject(instance.settings) ? instance.settings : {};
  const state = isPlainObject(instance.state) ? instance.state : {};
  const service = normalizeServiceMeta(
    instance.service ||
    instance.serviceManager ||
    instance.service_manager ||
    settings.service ||
    settings.serviceManager ||
    settings.service_manager ||
    state.service ||
    state.serviceManager ||
    state.service_manager,
  );
  const services = normalizeServiceMetaList(
    instance.services ||
    instance.serviceList ||
    instance.service_list ||
    settings.services ||
    settings.serviceList ||
    settings.service_list ||
    state.services ||
    state.serviceList ||
    state.service_list,
  );
  return {
    id,
    appId: normalizePublicId(instance.appId || instance.app_id),
    title: normalizeString(instance.title || instance.name || id),
    source: normalizeString(instance.source),
    entry: normalizeString(instance.entry),
    settingsUrl: normalizeString(settings.url),
    settings,
    state,
    service,
    services,
  };
}

function getDynamicAppLaunchCandidates(instance, app) {
  return [
    {
      source: 'instance.settings.url',
      value: normalizeString(instance?.settings?.url || instance?.settingsUrl),
    },
    { source: 'instance.entry', value: normalizeString(instance?.entry) },
    { source: 'app.entry', value: normalizeString(app?.entry) },
  ].filter((candidate) => candidate.value);
}

function resolveUrlAgainstBackend(value, backendBase) {
  const raw = normalizeString(value);
  if (!raw) return '';

  try {
    return sanitizeDynamicAppLaunchUrl(raw, backendBase);
  } catch {
    return '';
  }
}

function isSensitiveQueryName(name) {
  const normalized = normalizeString(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return false;
  return SENSITIVE_QUERY_NAMES.has(normalized)
    || normalized.endsWith('token')
    || normalized.endsWith('secret')
    || normalized.includes('session')
    || normalized.includes('password')
    || normalized.includes('authorization')
    || normalized.includes('apikey');
}

export function sanitizeDynamicAppLaunchUrl(value, backendBase = DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN) {
  const raw = normalizeString(value);
  if (!raw) return '';

  let resolved;
  try {
    resolved = new URL(raw, backendBase || DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN);
  } catch {
    return '';
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return '';
  if (BLOCKED_DYNAMIC_APP_PORTS.has(resolved.port)) return '';

  resolved.username = '';
  resolved.password = '';
  resolved.hash = '';

  const safeSearchParams = new URLSearchParams();
  for (const [key, valuePart] of resolved.searchParams.entries()) {
    if (isSensitiveQueryName(key)) continue;
    safeSearchParams.append(key, valuePart);
  }
  resolved.search = safeSearchParams.toString();

  return resolved.href;
}

function createDynamicDesktopAppEntry(instance, app, options = {}) {
  const launch = resolveDynamicAppLaunch(instance, app, options);
  if (!launch.url) return null;

  const name = normalizeString(instance.title || app?.title || app?.name || instance.id);
  const appId = normalizePublicId(instance.appId || app?.id);
  return {
    id: instance.id,
    instanceId: instance.id,
    appId,
    name,
    title: name,
    shortName: getShortName(name),
    orbClass: pickDynamicOrbClass(`${appId}:${instance.id}`),
    source: normalizeString(instance.source || app?.source),
    icon: normalizeString(app?.icon),
    version: normalizeString(app?.version),
    launchUrl: launch.url,
    launchSource: launch.source,
    dynamic: true,
    service: normalizeServiceMeta(instance?.service) || normalizeServiceMeta(app?.service),
    services: normalizeServiceMetaList([
      ...(Array.isArray(instance?.services) ? instance.services : []),
      ...(Array.isArray(app?.services) ? app.services : []),
    ]),
  };
}

export function resolveAppRegistryApiUrl(apiBase = '') {
  const raw = normalizeString(apiBase) || `${DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN}/api`;
  const withoutSlash = trimTrailingSlash(raw);
  if (withoutSlash.endsWith(APP_REGISTRY_API_PATH)) return withoutSlash;
  if (withoutSlash.endsWith('/app-registry')) return withoutSlash;
  if (withoutSlash.endsWith('/api')) return `${withoutSlash}/app-registry`;
  return `${withoutSlash}${APP_REGISTRY_API_PATH}`;
}

export function resolveDynamicAppBackendBase(backendBase = '') {
  const raw = normalizeString(backendBase) || DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN;

  try {
    const url = new URL(raw, DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN);
    const pathname = trimTrailingSlash(url.pathname);
    url.username = '';
    url.password = '';
    if (pathname.endsWith(APP_REGISTRY_API_PATH)) {
      url.pathname = pathname.slice(0, -APP_REGISTRY_API_PATH.length) || '/';
    } else if (pathname.endsWith('/api')) {
      url.pathname = pathname.slice(0, -'/api'.length) || '/';
    }
    url.search = '';
    url.hash = '';
    url.pathname = ensureTrailingSlash(url.pathname || '/');
    return url.href;
  } catch {
    return ensureTrailingSlash(DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN);
  }
}

export function resolveDynamicAppEntryUrl(entry, options = {}) {
  const backendBase = resolveDynamicAppBackendBase(
    options.backendBase || options.backendOrigin || options.baseUrl || options.apiBase,
  );
  return resolveUrlAgainstBackend(entry, backendBase);
}

export function resolveDynamicAppLaunch(instance, app, options = {}) {
  for (const candidate of getDynamicAppLaunchCandidates(instance, app)) {
    const url = resolveDynamicAppEntryUrl(candidate.value, options);
    if (url) {
      return {
        url,
        source: candidate.source,
      };
    }
  }

  return {
    url: '',
    source: '',
  };
}

export function isStaticBundledAppId(appId, staticApps = registeredApps) {
  return createStaticAppIdSet(staticApps).has(normalizePublicId(appId));
}

export function filterDynamicAppEntriesForStaticApps(dynamicEntries, staticApps = registeredApps) {
  const staticIds = createStaticAppIdSet(staticApps);
  return (Array.isArray(dynamicEntries) ? dynamicEntries : []).filter((entry) => {
    const id = normalizePublicId(entry?.id);
    const appId = normalizePublicId(entry?.appId);
    return id && !staticIds.has(id) && !staticIds.has(appId);
  });
}

export function mergeStaticAndDynamicDesktopApps(staticEntries = [], dynamicEntries = []) {
  const merged = [];
  const usedIds = new Set();

  for (const entry of Array.isArray(staticEntries) ? staticEntries : []) {
    const id = normalizePublicId(entry?.id);
    if (!id || usedIds.has(id)) continue;
    merged.push(entry);
    usedIds.add(id);
  }

  for (const entry of Array.isArray(dynamicEntries) ? dynamicEntries : []) {
    const id = normalizePublicId(entry?.id);
    const appId = normalizePublicId(entry?.appId);
    if (!id || usedIds.has(id) || (appId && usedIds.has(appId))) continue;
    merged.push(entry);
    usedIds.add(id);
  }

  return merged;
}

export function normalizeDynamicAppRegistry(payload, options = {}) {
  const registry = isPlainObject(payload) ? payload : {};
  const components = (Array.isArray(registry.components) ? registry.components : [])
    .map(normalizeRegistryComponent)
    .filter(Boolean);
  const staticAppControls = normalizeStaticAppControls(registry);
  const apps = (Array.isArray(registry.apps) ? registry.apps : [])
    .map(normalizeRegistryApp)
    .filter(Boolean);
  const appById = new Map(apps.map((app) => [app.id, app]));
  const appInstances = (Array.isArray(registry.appInstances) ? registry.appInstances : [])
    .map(normalizeRegistryInstance)
    .filter(Boolean);
  const staticIds = createStaticAppIdSet(options.staticApps || registeredApps, options.staticAppIds);

  const dynamicAppEntries = appInstances
    .map((instance) => createDynamicDesktopAppEntry(instance, appById.get(instance.appId), options))
    .filter((entry) => (
      entry &&
      !staticIds.has(normalizePublicId(entry.id)) &&
      !staticIds.has(normalizePublicId(entry.appId))
    ));

  return {
    generatedAt: normalizeString(registry.generatedAt),
    components,
    staticAppControls,
    apps,
    appInstances,
    dynamicAppEntries,
  };
}

export async function fetchAppRegistry(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    throw new Error('fetchAppRegistry requires a fetch implementation.');
  }

  const response = await fetchImpl(resolveAppRegistryApiUrl(options.apiBase || options.backendBase), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `App registry request failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchDynamicAppRegistry(options = {}) {
  const payload = await fetchAppRegistry(options);
  return normalizeDynamicAppRegistry(payload, options);
}
