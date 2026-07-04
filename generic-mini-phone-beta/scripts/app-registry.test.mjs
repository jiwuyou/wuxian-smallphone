import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeDynamicAppRegistry,
  registeredApps,
  resolveDynamicAppEntryUrl,
  sanitizeDynamicAppLaunchUrl,
} from './app-registry.js';
import { bind as bindMessages, render as renderMessages, template as messagesTemplate } from '../apps/messages/index.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

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

test('messages is a registered static app', () => {
  assert.ok(registeredApps.find((app) => (
    app.id === 'messages' &&
    app.views?.normal === 'messages' &&
    app.badge === 'unread'
  )));
});

test('messages app owns message and chat views', () => {
  assert.equal(typeof renderMessages, 'function');
  assert.equal(typeof bindMessages, 'function');
  assert.match(messagesTemplate, /data-view="messages"/);
  assert.match(messagesTemplate, /id="message-list"/);
  assert.match(messagesTemplate, /data-view="chat"/);
  assert.match(messagesTemplate, /id="chat-form"/);
});

test('shell html does not hardcode messages primary dom', () => {
  const html = readFileSync(resolve(currentDir, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /data-view="messages"/);
  assert.doesNotMatch(html, /id="message-list"/);
  assert.doesNotMatch(html, /data-view="chat"/);
  assert.doesNotMatch(html, /id="chat-form"/);
  assert.match(html, /id="registered-app-views"/);
});

test('component registry consumes smallphoneApp for hidden static apps and dynamic webview apps', () => {
  const normalized = normalizeDynamicAppRegistry({
    components: [
      {
        id: 'messages',
        smallphoneApp: {
          visible: false,
          staticAppId: 'messages',
          entry: {
            type: 'native-view',
            view: 'messages',
          },
        },
      },
      {
        id: 'hermes-webui',
        title: 'Hermes',
        kind: 'ai-partner',
        smallphoneApp: {
          visible: true,
          entry: {
            type: 'webview',
            url: 'http://127.0.0.1:23084/',
          },
        },
        serviceManager: {
          services: [
            {
              id: 'hermes-webui',
              name: 'hermes-webui',
              serviceRef: 'service-manager://services/hermes-webui',
            },
          ],
        },
      },
      {
        id: 'legacy-menu-only',
        title: 'Legacy',
        menu: {
          entry: {
            type: 'webview',
            url: 'http://127.0.0.1:29999/',
          },
        },
      },
    ],
    apps: [
      {
        id: 'hermes-webui',
        title: 'Hermes',
        entry: 'http://127.0.0.1:23084/',
      },
    ],
    appInstances: [
      {
        id: 'component-hermes-webui',
        appId: 'hermes-webui',
        title: 'Hermes',
        settings: {
          url: 'http://127.0.0.1:23084/',
        },
      },
    ],
  });

  assert.deepEqual(normalized.staticAppControls.hiddenAppIds, ['messages']);
  assert.equal(normalized.components.find((component) => component.id === 'messages').visible, false);
  assert.equal(Boolean(normalized.components.find((component) => component.id === 'legacy-menu-only')), false);
  assert.equal(normalized.dynamicAppEntries.length, 1);
  assert.equal(normalized.dynamicAppEntries[0].appId, 'hermes-webui');
});

test('dynamic app launch urls reject cc-connect ports', () => {
  const payload = {
    apps: [
      {
        id: 'cc-webclient',
        title: 'cc webclient',
        entry: 'http://phone.test:21030/app/',
      },
      {
        id: 'cc-bridge',
        title: 'cc bridge',
        entry: 'http://phone.test:21010/',
      },
    ],
    appInstances: [
      {
        id: 'instance-cc-webclient',
        appId: 'cc-webclient',
        title: 'cc webclient',
        settings: {
          url: 'http://phone.test:21030/app/?token=secret',
        },
      },
      {
        id: 'instance-cc-bridge',
        appId: 'cc-bridge',
        title: 'cc bridge',
      },
    ],
  };

  const normalized = normalizeDynamicAppRegistry(payload);

  assert.equal(normalized.dynamicAppEntries.length, 0);
  for (const port of ['21010', '21020', '21030', '21040']) {
    assert.equal(resolveDynamicAppEntryUrl(`http://phone.test:${port}/app/`), '');
  }
});

test('dynamic app launch urls strip userinfo, sensitive query params, and hash', () => {
  const payload = {
    apps: [
      {
        id: 'tool-web',
        title: 'Tool Web',
        entry: 'https://user:password@app.example/tools/?view=main&token=secret&api_key=abc&safe=1#access_token=frag',
      },
    ],
    appInstances: [
      {
        id: 'instance-tool-web',
        appId: 'tool-web',
        title: 'Tool Web',
      },
    ],
  };

  const normalized = normalizeDynamicAppRegistry(payload);

  assert.equal(normalized.dynamicAppEntries.length, 1);
  assert.equal(
    normalized.dynamicAppEntries[0].launchUrl,
    'https://app.example/tools/?view=main&safe=1',
  );
  assert.equal(
    sanitizeDynamicAppLaunchUrl('https://user:pass@app.example/?auth=abc&q=ok#token=secret'),
    'https://app.example/?q=ok',
  );
  assert.equal(
    sanitizeDynamicAppLaunchUrl('https://app.example/?session_key=a&session-key=b&sessionKey=c&q=ok'),
    'https://app.example/?q=ok',
  );
});
