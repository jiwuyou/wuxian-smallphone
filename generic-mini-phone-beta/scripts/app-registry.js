import * as calendar from '../apps/calendar/index.js';
import * as weather from '../apps/weather/index.js';
import * as diary from '../apps/diary/index.js';
import * as files from '../apps/files/index.js';
import * as vocabulary from '../apps/vocabulary/index.js';
import * as likeGirl from '../apps/like-girl/index.js';
import * as likeGirlClone from '../apps/like-girl-clone/index.js';

export const appModules = [
  calendar,
  weather,
  diary,
  files,
  vocabulary,
  likeGirl,
  likeGirlClone,
];

export const registeredApps = appModules.map((app) => app.manifest);

export const appDefaultState = appModules.reduce((merged, app) => ({
  ...merged,
  ...(app.defaultState || {}),
}), {});

export const DEFAULT_DYNAMIC_APP_BACKEND_ORIGIN = 'http://127.0.0.1:3100';
export const APP_REGISTRY_API_PATH = '/api/app-registry';

const DYNAMIC_APP_ORB_CLASSES = [
  'orb-chat',
  'orb-world',
  'orb-calendar',
  'orb-weather',
  'orb-diary',
  'orb-files',
  'orb-vocabulary',
  'orb-app-manager',
  'orb-character',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePublicId(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9:_-]/g, '-');
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
  };
}

function normalizeRegistryInstance(instance) {
  if (!isPlainObject(instance)) return null;
  const id = normalizePublicId(instance.id);
  if (!id) return null;

  const settings = isPlainObject(instance.settings) ? instance.settings : {};
  return {
    id,
    appId: normalizePublicId(instance.appId || instance.app_id),
    title: normalizeString(instance.title || instance.name || id),
    source: normalizeString(instance.source),
    entry: normalizeString(instance.entry),
    settingsUrl: normalizeString(settings.url),
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
    const resolved = new URL(raw, backendBase);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return '';
    return resolved.href;
  } catch {
    return '';
  }
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

function createSpace2dTemplate(app) {
  const { manifest } = app;
  return `
    <section class="view app-space-view app-space-2d" data-view="${manifest.views.space2d}" data-space-app="${manifest.id}">
      <div class="app-view-topline">
        <div>
          <p class="eyebrow">2D Space</p>
          <h2>${manifest.worldObject?.label || manifest.name}</h2>
        </div>
        <button class="secondary-button" data-app-normal="${manifest.id}" type="button">正常 UI</button>
      </div>
      <div class="space-map-2d">
        <div class="space-room-grid">
          <span class="space-prop prop-door" data-world-return="home">门</span>
          <span class="space-prop prop-core ${manifest.orbClass}">${manifest.shortName}</span>
          <span class="space-prop prop-console" data-app-normal="${manifest.id}">控</span>
          <span class="space-prop prop-portal" data-app-space3d="${manifest.id}">3D</span>
        </div>
      </div>
      <div class="space-actions">
        <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
        <button class="secondary-button" data-app-space3d="${manifest.id}" type="button">进入 3D 空间</button>
      </div>
    </section>
  `;
}

function createSpace3dTemplate(app) {
  const { manifest } = app;
  return `
    <section class="view app-space-view app-space-3d" data-view="${manifest.views.space3d}" data-space-app="${manifest.id}">
      <div class="app-view-topline">
        <div>
          <p class="eyebrow">3D Space</p>
          <h2>${manifest.name}空间</h2>
        </div>
        <button class="secondary-button" data-app-space2d="${manifest.id}" type="button">回 2D</button>
      </div>
      <div class="space-scene-3d">
        <div class="scene-floor"></div>
        <div class="scene-wall scene-wall-left"></div>
        <div class="scene-wall scene-wall-right"></div>
        <div class="scene-object ${manifest.orbClass}">${manifest.shortName}</div>
      </div>
      <div class="space-actions">
        <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
        <button class="secondary-button" data-app-normal="${manifest.id}" type="button">打开正常 UI</button>
      </div>
    </section>
  `;
}

export const appSpaceTemplates = appModules.map((app) => (
  app.spaceTemplates || `${createSpace2dTemplate(app)}${createSpace3dTemplate(app)}`
)).join('');
