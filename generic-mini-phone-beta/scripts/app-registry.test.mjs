import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDynamicAppRegistry, registeredApps } from './app-registry.js';

test('app-registry normalization preserves safe service metadata for dynamic apps', () => {
  const payload = {
    generatedAt: '2026-05-06T00:00:00.000Z',
    apps: [
      {
        id: 'svc-example',
        name: 'Example Service',
        title: 'Example Service Title',
        source: 'service-manager',
        kind: 'service',
        entry: '/example/',
        icon: 'https://example.invalid/icon.png',
        version: '1.2.3',
        service: { id: 'svc-example', state: 'running', tags: ['smallphone-app:svc-example'] },
        services: ['svc-fallback'],
      },
    ],
    appInstances: [
      {
        id: 'instance-svc-example',
        appId: 'svc-example',
        title: 'Example Instance',
        source: 'service-manager',
        entry: '/example/',
        settings: {
          url: 'http://127.0.0.1:4321/example/',
        },
        service: { id: 'svc-example', state: 'running' },
        services: [{ serviceId: 'svc-fallback', state: 'stopped' }],
      },
    ],
  };

  const normalized = normalizeDynamicAppRegistry(payload);
  assert.equal(normalized.generatedAt, '2026-05-06T00:00:00.000Z');

  assert.equal(normalized.apps.length, 1);
  const app = normalized.apps[0];
  assert.equal(app.id, 'svc-example');
  assert.equal(app.name, 'Example Service');
  assert.equal(app.title, 'Example Service Title');
  assert.equal(app.source, 'service-manager');
  assert.equal(app.kind, 'service');
  assert.equal(app.entry, '/example/');
  assert.equal(app.icon, 'https://example.invalid/icon.png');
  assert.equal(app.version, '1.2.3');
  assert.ok(app.service && typeof app.service === 'object');
  assert.equal(app.service.id, 'svc-example');
  assert.equal(app.service.state, 'running');
  assert.ok(Array.isArray(app.services));
  assert.equal(app.services[0]?.id, 'svc-fallback');

  assert.equal(normalized.appInstances.length, 1);
  const instance = normalized.appInstances[0];
  assert.equal(instance.id, 'instance-svc-example');
  assert.equal(instance.appId, 'svc-example');
  assert.equal(instance.title, 'Example Instance');
  assert.equal(instance.source, 'service-manager');
  assert.equal(instance.entry, '/example/');
  assert.equal(instance.settingsUrl, 'http://127.0.0.1:4321/example/');
  assert.ok(instance.service && typeof instance.service === 'object');
  assert.equal(instance.service.id, 'svc-example');
  assert.equal(instance.service.state, 'running');
  assert.ok(Array.isArray(instance.services));
  assert.equal(instance.services[0]?.id, 'svc-fallback');

  assert.equal(normalized.dynamicAppEntries.length, 1);
  const entry = normalized.dynamicAppEntries[0];
  assert.equal(entry.id, 'instance-svc-example');
  assert.equal(entry.instanceId, 'instance-svc-example');
  assert.equal(entry.appId, 'svc-example');
  assert.equal(entry.source, 'service-manager');
  assert.equal(entry.icon, 'https://example.invalid/icon.png');
  assert.equal(entry.version, '1.2.3');
  assert.equal(entry.launchUrl, 'http://127.0.0.1:4321/example/');
  assert.ok(entry.service && typeof entry.service === 'object');
  assert.equal(entry.service.id, 'svc-example');
  assert.ok(Array.isArray(entry.services));
  assert.equal(entry.services[0]?.id, 'svc-fallback');
});

test('workflows is a static bundled app, not a broken dynamic iframe entry', () => {
  assert.ok(registeredApps.find((app) => app.id === 'workflows' && app.views?.normal === 'workflows'));

  const normalized = normalizeDynamicAppRegistry({
    apps: [
      {
        id: 'workflows',
        title: '工作流',
        entry: '/apps/workflows',
      },
    ],
    appInstances: [
      {
        id: 'instance-workflows',
        appId: 'workflows',
        title: '工作流',
      },
    ],
  });

  assert.equal(normalized.dynamicAppEntries.length, 0);
});
