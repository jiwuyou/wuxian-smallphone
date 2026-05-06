import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildServiceManagerDefinitions,
  createServiceFromDefinition,
  getManagedServiceTargets,
  mergeServiceManagerDefinitionWithStatus,
} from './service-manager-logic.js';

test('service-manager status merge preserves definition metadata when status payload is sparse', () => {
  const [definition] = buildServiceManagerDefinitions({
    services: [
      {
        id: 'svc-like-girl',
        name: 'smallphone-like-girl',
        description: 'LikeGirl standalone app',
        provider: 'process',
        tags: ['smallphone-app:like-girl', 'ports:4103'],
        url: 'http://127.0.0.1:4103/',
      },
    ],
  });

  const merged = mergeServiceManagerDefinitionWithStatus(definition, {
    service: {
      id: 'svc-like-girl',
      state: 'running',
      message: 'running',
      pid: 12345,
    },
  });

  assert.equal(merged.id, 'svc-like-girl');
  assert.equal(merged.name, 'smallphone-like-girl');
  assert.equal(merged.description, 'LikeGirl standalone app');
  assert.equal(merged.provider, 'process');
  assert.equal(merged.state, 'running');
  assert.deepEqual(merged.tags, ['smallphone-app:like-girl', 'ports:4103']);
  assert.equal(merged.url, 'http://127.0.0.1:4103/');
});

test('managed targets map LikeGirl apps to real service-manager IDs and dedupe raw service cards', () => {
  const serviceManagerSnapshot = {
    services: [
      {
        id: 'svc-like-girl',
        name: 'smallphone-like-girl',
        provider: 'process',
        state: 'running',
        tags: ['smallphone-app:like-girl', 'ports:4103'],
      },
      {
        id: 'svc-like-girl-clone',
        name: 'smallphone-like-girl-clone',
        provider: 'process',
        state: 'running',
        tags: ['smallphone-app:like-girl-clone', 'ports:4108'],
      },
    ],
    byId: new Map(),
  };

  const targets = getManagedServiceTargets({ serviceManagerSnapshot, dynamicAppRegistry: {} });
  const likeGirl = targets.find((target) => target.label === 'LikeGirl');
  const likeGirlClone = targets.find((target) => target.label === 'LikeGirl 分身');

  assert.equal(likeGirl?.serviceId, 'svc-like-girl');
  assert.equal(likeGirl?.kind, 'standalone');
  assert.equal(likeGirlClone?.serviceId, 'svc-like-girl-clone');
  assert.equal(likeGirlClone?.kind, 'standalone');
  assert.equal(targets.filter((target) => target.serviceId === 'svc-like-girl').length, 1);
  assert.equal(targets.filter((target) => target.serviceId === 'svc-like-girl-clone').length, 1);
  assert.equal(targets.some((target) => target.serviceId === 'like-girl'), false);
  assert.equal(targets.some((target) => target.serviceId === 'like-girl-clone'), false);
});

test('managed targets preserve real LikeGirl IDs when status fetch falls back to definitions only', () => {
  const definitions = buildServiceManagerDefinitions({
    services: [
      {
        id: 'svc-like-girl',
        name: 'smallphone-like-girl',
        provider: 'process',
        tags: ['smallphone-app:like-girl', 'ports:4103'],
      },
      {
        id: 'svc-like-girl-clone',
        name: 'smallphone-like-girl-clone',
        provider: 'process',
        tags: ['smallphone-app:like-girl-clone', 'ports:4108'],
      },
    ],
  });
  const serviceManagerSnapshot = {
    services: definitions.map((definition) => createServiceFromDefinition(definition, {
      state: 'unknown',
      message: 'status unavailable',
    })),
  };

  const targets = getManagedServiceTargets({ serviceManagerSnapshot, dynamicAppRegistry: {} });

  assert.equal(targets.find((target) => target.label === 'LikeGirl')?.serviceId, 'svc-like-girl');
  assert.equal(targets.find((target) => target.label === 'LikeGirl 分身')?.serviceId, 'svc-like-girl-clone');
  assert.equal(targets.some((target) => target.serviceId === 'like-girl'), false);
  assert.equal(targets.some((target) => target.serviceId === 'like-girl-clone'), false);
});
