function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeListValue(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.services)) return value.services;
  if (Array.isArray(value.items)) return value.items;
  if (value.services && typeof value.services === 'object') {
    return Object.entries(value.services).map(([key, item]) => (
      item && typeof item === 'object' ? { id: key, ...item } : { id: key, value: item }
    ));
  }
  if (value.items && typeof value.items === 'object') {
    return Object.entries(value.items).map(([key, item]) => (
      item && typeof item === 'object' ? { id: key, ...item } : { id: key, value: item }
    ));
  }
  return [];
}

function normalizeTags(raw) {
  if (Array.isArray(raw.tags)) {
    return raw.tags.map((tag) => normalizeString(tag)).filter(Boolean);
  }
  if (Array.isArray(raw.spec?.tags)) {
    return raw.spec.tags.map((tag) => normalizeString(tag)).filter(Boolean);
  }
  return [];
}

export function normalizeServiceManagerList(payload) {
  return normalizeListValue(payload);
}

export function normalizeServiceManagerService(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeString(raw.id || raw.serviceId || raw.service_id || raw.name || '');
  if (!id) return null;

  return {
    id,
    name: normalizeString(raw.name || raw.title || ''),
    description: normalizeString(raw.description || ''),
    tags: normalizeTags(raw),
    availability: normalizeString(raw.availability || raw.available || raw.status || ''),
    provider: normalizeString(raw.provider || raw.backend || ''),
    state: normalizeString(raw.state || raw.phase || ''),
    message: normalizeString(raw.message || raw.detail || raw.reason || ''),
    url: normalizeString(raw.url || raw.openUrl || raw.open_url || ''),
    raw,
  };
}

export function buildServiceManagerDefinitions(payload) {
  return normalizeServiceManagerList(payload)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const service = normalizeServiceManagerService(raw);
      const id = normalizeString(raw.id || raw.serviceId || raw.service_id || raw.name || service?.id || '');
      if (!id) return null;
      return {
        id,
        name: normalizeString(raw.name || raw.title || raw.label || service?.name || id) || id,
        description: normalizeString(raw.description || service?.description || ''),
        tags: Array.isArray(service?.tags) ? service.tags : [],
        provider: normalizeString(raw.provider || raw.backend || service?.provider || ''),
        url: normalizeString(raw.url || raw.openUrl || raw.open_url || service?.url || ''),
        raw,
      };
    })
    .filter(Boolean);
}

export function mergeServiceManagerDefinitionWithStatus(definition, statusPayload) {
  const def = isPlainObject(definition) ? definition : {};
  const statusObject = isPlainObject(statusPayload?.service) ? statusPayload.service : statusPayload;
  const serviceObject = isPlainObject(statusObject) ? statusObject : {};
  const statusTags = Array.isArray(serviceObject.tags)
    ? serviceObject.tags.map((tag) => normalizeString(tag)).filter(Boolean)
    : Array.isArray(serviceObject.spec?.tags)
      ? serviceObject.spec.tags.map((tag) => normalizeString(tag)).filter(Boolean)
      : [];
  const mergedTags = statusTags.length ? statusTags : (Array.isArray(def.tags) ? def.tags : []);
  const normalized = normalizeServiceManagerService({
    ...serviceObject,
    id: def.id,
    name: normalizeString(serviceObject.name || serviceObject.title || def.name || ''),
    description: normalizeString(serviceObject.description || def.description || ''),
    tags: mergedTags,
    provider: normalizeString(serviceObject.provider || serviceObject.backend || def.provider || ''),
    url: normalizeString(serviceObject.url || serviceObject.openUrl || serviceObject.open_url || def.url || ''),
  });

  return normalized || {
    id: normalizeString(def.id),
    name: normalizeString(def.name || def.id),
    description: normalizeString(def.description || ''),
    tags: mergedTags,
    availability: '',
    provider: normalizeString(def.provider || ''),
    state: '',
    message: '',
    url: normalizeString(def.url || ''),
    raw: statusPayload,
  };
}

export function createServiceManagerSnapshot(definitions = [], services = []) {
  const normalizedDefinitions = Array.isArray(definitions) ? definitions.filter(Boolean) : [];
  const normalizedServices = normalizeServiceManagerList(services)
    .map(normalizeServiceManagerService)
    .filter(Boolean);
  return {
    definitions: normalizedDefinitions,
    services: normalizedServices,
    byId: new Map(normalizedServices.map((service) => [service.id, service])),
  };
}

export function createServiceFromDefinition(definition, overrides = {}) {
  const def = isPlainObject(definition) ? definition : {};
  return {
    id: normalizeString(overrides.id || def.id),
    name: normalizeString(overrides.name || def.name || def.id),
    description: normalizeString(overrides.description || def.description || ''),
    tags: Array.isArray(overrides.tags)
      ? overrides.tags.map((tag) => normalizeString(tag)).filter(Boolean)
      : (Array.isArray(def.tags) ? def.tags : []),
    availability: normalizeString(overrides.availability || ''),
    provider: normalizeString(overrides.provider || def.provider || ''),
    state: normalizeString(overrides.state || ''),
    message: normalizeString(overrides.message || ''),
    url: normalizeString(overrides.url || def.url || ''),
    raw: overrides.raw || def.raw || def,
  };
}

export function resolveManagedServiceId(meta) {
  if (!meta || typeof meta !== 'object') return '';
  return normalizeString(meta.id || meta.serviceId || meta.service_id || '');
}

export function resolveManagedServiceUrl(meta) {
  if (!meta || typeof meta !== 'object') return '';
  return normalizeString(meta.url || meta.openUrl || meta.open_url || '');
}

export function resolveServiceMetasForAppId(appId, { serviceManagerSnapshot = {}, dynamicAppRegistry = {} } = {}) {
  const normalizedAppId = normalizeString(appId);
  if (!normalizedAppId) return [];

  const metas = [];
  const pushMeta = (meta) => {
    const serviceId = resolveManagedServiceId(meta);
    if (!serviceId) return;
    if (metas.some((existing) => resolveManagedServiceId(existing) === serviceId)) return;
    metas.push(meta);
  };

  const services = Array.isArray(serviceManagerSnapshot?.services) ? serviceManagerSnapshot.services : [];
  for (const service of services) {
    const tags = Array.isArray(service?.tags) ? service.tags : [];
    if (tags.includes(`smallphone-app:${normalizedAppId}`) || tags.includes(`smallphone-instance:${normalizedAppId}`)) {
      pushMeta(service);
    }
  }

  const instances = Array.isArray(dynamicAppRegistry?.appInstances) ? dynamicAppRegistry.appInstances : [];
  for (const instance of instances) {
    const instanceId = normalizeString(instance?.id || '');
    const instanceAppId = normalizeString(instance?.appId || '');
    if (instanceId !== normalizedAppId && instanceAppId !== normalizedAppId) continue;
    pushMeta(instance?.service);
    (Array.isArray(instance?.services) ? instance.services : []).forEach(pushMeta);
  }

  const apps = Array.isArray(dynamicAppRegistry?.apps) ? dynamicAppRegistry.apps : [];
  const app = apps.find((item) => normalizeString(item?.id || '') === normalizedAppId) || null;
  if (app) {
    pushMeta(app?.service);
    (Array.isArray(app?.services) ? app.services : []).forEach(pushMeta);
  }

  return metas;
}

export function getManagedServiceTargets({ serviceManagerSnapshot = {}, dynamicAppRegistry = {} } = {}) {
  const targets = [];
  const pushUnique = (target) => {
    if (!target?.serviceId) return;
    if (targets.some((existing) => existing.serviceId === target.serviceId)) return;
    targets.push(target);
  };

  const likeGirlMetas = resolveServiceMetasForAppId('like-girl', { serviceManagerSnapshot, dynamicAppRegistry });
  const likeGirlServiceIds = likeGirlMetas.length
    ? likeGirlMetas.map((meta) => resolveManagedServiceId(meta)).filter(Boolean)
    : ['like-girl'];
  likeGirlServiceIds.forEach((serviceId) => {
    pushUnique({
      key: `standalone:like-girl:${serviceId}`,
      kind: 'standalone',
      label: 'LikeGirl',
      serviceId,
      meta: likeGirlMetas.find((meta) => resolveManagedServiceId(meta) === serviceId) || null,
      open: { kind: 'static-app', appId: 'like-girl', path: '' },
    });
  });

  const likeGirlCloneMetas = resolveServiceMetasForAppId('like-girl-clone', { serviceManagerSnapshot, dynamicAppRegistry });
  const likeGirlCloneServiceIds = likeGirlCloneMetas.length
    ? likeGirlCloneMetas.map((meta) => resolveManagedServiceId(meta)).filter(Boolean)
    : ['like-girl-clone'];
  likeGirlCloneServiceIds.forEach((serviceId) => {
    pushUnique({
      key: `standalone:like-girl-clone:${serviceId}`,
      kind: 'standalone',
      label: 'LikeGirl 分身',
      serviceId,
      meta: likeGirlCloneMetas.find((meta) => resolveManagedServiceId(meta) === serviceId) || null,
      open: { kind: 'static-app', appId: 'like-girl-clone', path: '' },
    });
  });

  const instances = Array.isArray(dynamicAppRegistry?.appInstances) ? dynamicAppRegistry.appInstances : [];
  const entries = Array.isArray(dynamicAppRegistry?.dynamicAppEntries) ? dynamicAppRegistry.dynamicAppEntries : [];

  for (const instance of instances) {
    const entry = entries.find((item) => normalizeString(item?.instanceId || item?.id || '') === normalizeString(instance?.id || '')) || null;
    const metas = [
      instance?.service,
      ...(Array.isArray(instance?.services) ? instance.services : []),
    ].filter(Boolean);

    for (const meta of metas) {
      const serviceId = resolveManagedServiceId(meta);
      if (!serviceId) continue;
      pushUnique({
        key: `dynamic:${serviceId}`,
        kind: 'dynamic',
        label: normalizeString(instance?.title || instance?.id || serviceId) || serviceId,
        serviceId,
        meta,
        open: entry?.launchUrl
          ? { kind: 'dynamic-entry', instanceId: normalizeString(entry.instanceId || entry.id || '') }
          : { kind: 'url', url: resolveManagedServiceUrl(meta) },
      });
    }
  }

  const services = Array.isArray(serviceManagerSnapshot?.services) ? serviceManagerSnapshot.services : [];
  for (const service of services) {
    const serviceId = normalizeString(service?.id || '');
    if (!serviceId) continue;
    pushUnique({
      key: `service-manager:${serviceId}`,
      kind: 'service-manager',
      label: normalizeString(service?.name || serviceId) || serviceId,
      serviceId,
      meta: service.raw || service,
      open: { kind: 'url', url: resolveManagedServiceUrl(service) },
    });
  }

  return targets;
}
