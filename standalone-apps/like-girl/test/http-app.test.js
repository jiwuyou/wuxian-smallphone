'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dispatchLikeGirlRequest } = require('../src/http-app');

async function options() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallphone-like-girl-http-'));
  return {
    dbFile: path.join(dir, 'like-girl.sqlite'),
    photoUploadsDir: path.join(dir, 'uploads', 'photos'),
  };
}

function json(response) {
  return JSON.parse(String(response.body || '{}'));
}

async function loginAdmin(opts) {
  const response = await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/admin/login',
    body: JSON.stringify({ username: 'admin', password: 'loveww' }),
  }, opts);
  assert.equal(response.statusCode, 200);
  return response.headers['set-cookie'];
}

async function loginAdminSessionId(opts) {
  const response = await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/admin/login',
    body: JSON.stringify({ username: 'admin', password: 'loveww' }),
  }, opts);
  assert.equal(response.statusCode, 200);
  return json(response).session.id;
}

function multipartBody(boundary, parts) {
  const chunks = [];
  parts.forEach((part) => {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}\r\n`));
    if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    chunks.push(Buffer.from('\r\n'));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
    chunks.push(Buffer.from('\r\n'));
  });
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

test('dispatches health, bootstrap, and message routes', async () => {
  const opts = await options();
  assert.equal(json(await dispatchLikeGirlRequest({ method: 'GET', url: '/health' }, opts)).storage.type, 'sqlite');
  const boot = json(await dispatchLikeGirlRequest({ method: 'GET', url: '/api/bootstrap' }, opts));
  assert.equal(boot.profile.title, 'LikeGirl');
  const created = json(await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/messages',
    body: JSON.stringify({ name: 'HTTP', text: 'Created through API.' }),
  }, opts));
  assert.equal(created.message.name, 'HTTP');
  const messages = json(await dispatchLikeGirlRequest({ method: 'GET', url: '/api/messages' }, opts)).messages;
  assert.equal(messages.some((message) => message.id === created.message.id), true);
});

test('returns validation errors', async () => {
  const response = await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/messages',
    body: JSON.stringify({ name: 'Spam', text: '12345' }),
  }, await options());
  assert.equal(response.statusCode, 400);
  assert.equal(json(response).error.code, 'LIKE_GIRL_VALIDATION_ERROR');
});

test('protects admin APIs with login sessions and supports CRUD', async () => {
  const opts = await options();
  assert.equal((await dispatchLikeGirlRequest({ method: 'GET', url: '/api/admin/state' }, opts)).statusCode, 401);
  const cookie = await loginAdmin(opts);
  const created = json(await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/admin/articles',
    headers: { cookie },
    body: JSON.stringify({
      title: 'Admin article',
      author: 'Tester',
      text: 'Created in admin.',
      html: '<p>Created in <strong>admin</strong>.</p><video src="/uploads/photos/demo.mp4"></video>',
    }),
  }, opts)).article;
  assert.equal(created.title, 'Admin article');
  assert.match(created.html, /<strong>admin<\/strong>/);
  const publicArticle = json(await dispatchLikeGirlRequest({
    method: 'GET',
    url: `/api/articles/${created.id}`,
  }, opts)).article;
  assert.equal(publicArticle.text, 'Created in admin.');
  assert.match(publicArticle.html, /<video/);
  const updated = json(await dispatchLikeGirlRequest({
    method: 'PATCH',
    url: `/api/admin/articles/${created.id}`,
    headers: { cookie },
    body: JSON.stringify({ title: 'Updated article' }),
  }, opts)).article;
  assert.equal(updated.title, 'Updated article');
  const deleted = json(await dispatchLikeGirlRequest({
    method: 'DELETE',
    url: `/api/admin/articles/${created.id}`,
    headers: { cookie },
  }, opts)).article;
  assert.equal(deleted.id, created.id);
});

test('accepts explicit admin session token for embedded app login', async () => {
  const opts = await options();
  const sessionId = await loginAdminSessionId(opts);
  const response = await dispatchLikeGirlRequest({
    method: 'GET',
    url: '/api/admin/state',
    headers: { authorization: `Bearer ${sessionId}` },
  }, opts);
  assert.equal(response.statusCode, 200);
  assert.equal(json(response).admin.username, 'admin');
});

test('admin upload saves and serves photo files', async () => {
  const opts = await options();
  const cookie = await loginAdmin(opts);
  const uploaded = json(await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/admin/uploads/photos',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: 'pixel.png',
      contentType: 'image/png',
      data: Buffer.from('png-data').toString('base64'),
    }),
  }, opts)).upload;
  assert.match(uploaded.url, /^\/uploads\/photos\/.+\.png$/);
  const served = await dispatchLikeGirlRequest({ method: 'GET', url: uploaded.url }, opts);
  assert.equal(served.statusCode, 200);
  assert.equal(String(served.body), 'png-data');
});

test('admin upload accepts multipart FormData-style files', async () => {
  const opts = await options();
  const cookie = await loginAdmin(opts);
  const boundary = 'like-girl-boundary';
  const uploaded = json(await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/admin/uploads/photos',
    headers: {
      cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody(boundary, [{
      name: 'file',
      filename: 'form.png',
      contentType: 'image/png',
      value: Buffer.from('multipart-png-data'),
    }]),
  }, opts)).upload;
  assert.match(uploaded.url, /^\/uploads\/photos\/.+\.png$/);
  const served = await dispatchLikeGirlRequest({ method: 'GET', url: uploaded.url }, opts);
  assert.equal(String(served.body), 'multipart-png-data');
});

async function assertCollectionCrud(opts, cookie, collection, createPayload, patchPayload, responseKey) {
  const created = json(await dispatchLikeGirlRequest({
    method: 'POST',
    url: `/api/admin/${collection}`,
    headers: { cookie },
    body: JSON.stringify(createPayload),
  }, opts))[responseKey];
  assert.ok(created.id);
  const updated = json(await dispatchLikeGirlRequest({
    method: 'PATCH',
    url: `/api/admin/${collection}/${created.id}`,
    headers: { cookie },
    body: JSON.stringify(patchPayload),
  }, opts))[responseKey];
  Object.entries(patchPayload).forEach(([key, value]) => assert.equal(updated[key], value));
  const deleted = json(await dispatchLikeGirlRequest({
    method: 'DELETE',
    url: `/api/admin/${collection}/${created.id}`,
    headers: { cookie },
  }, opts))[responseKey];
  assert.equal(deleted.id, created.id);
}

test('admin CRUD covers photos, checklist, about, and message deletion', async () => {
  const opts = await options();
  const cookie = await loginAdmin(opts);
  await assertCollectionCrud(opts, cookie, 'photos', {
    title: 'Photo create',
    imageUrl: '/uploads/photos/create.png',
    caption: 'Caption create',
  }, {
    title: 'Photo update',
  }, 'photo');
  await assertCollectionCrud(opts, cookie, 'checklist', {
    title: 'Checklist create',
    done: false,
    imageUrl: '',
  }, {
    title: 'Checklist update',
    done: true,
  }, 'checklistItem');
  await assertCollectionCrud(opts, cookie, 'about', {
    title: 'About create',
    text: 'About text create',
    imageUrl: '',
  }, {
    text: 'About text update',
  }, 'about');
  const message = json(await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/admin/messages',
    headers: { cookie },
    body: JSON.stringify({ name: 'Admin', text: 'Delete this message.' }),
  }, opts)).message;
  const deleted = json(await dispatchLikeGirlRequest({
    method: 'DELETE',
    url: `/api/admin/messages/${message.id}`,
    headers: { cookie },
  }, opts)).message;
  assert.equal(deleted.id, message.id);
});

test('admin site settings preserve original-like profile fields', async () => {
  const opts = await options();
  const cookie = await loginAdmin(opts);
  const profile = json(await dispatchLikeGirlRequest({
    method: 'PUT',
    url: '/api/admin/site',
    headers: { cookie },
    body: JSON.stringify({
      title: 'Original fields',
      boy: 'Boy',
      girl: 'Girl',
      boyImage: '/uploads/photos/boy.png',
      girlImage: '/uploads/photos/girl.png',
      backgroundImage: '/uploads/photos/bg.png',
      cardLabels: { articles: 'Little', messages: 'Leaves', about: 'About', photos: 'Photos', checklist: 'List' },
      cardDescriptions: { articles: 'A', messages: 'M', about: 'O', photos: 'P', checklist: 'L' },
      customCss: '.hero{min-height:70svh;}',
      headHtml: '<meta name="like-girl-test" content="1">',
      footerHtml: '<strong>Footer</strong>',
      pjaxEnabled: true,
      blurEnabled: true,
    }),
  }, opts)).profile;
  assert.equal(profile.bgimg, '/uploads/photos/bg.png');
  assert.equal(profile.cardLabels.articles, 'Little');
  assert.equal(profile.cardDescriptions.checklist, 'L');
  assert.equal(profile.pjaxEnabled, true);
  assert.equal(profile.blurEnabled, true);
});

test('message settings apply latest limits and per-IP daily throttling', async () => {
  const opts = await options();
  const cookie = await loginAdmin(opts);
  await dispatchLikeGirlRequest({
    method: 'PUT',
    url: '/api/admin/message-settings',
    headers: { cookie },
    body: JSON.stringify({ latestLimit: 1, dailyLimitPerIp: 1 }),
  }, opts);
  assert.equal((await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/messages',
    headers: { 'x-forwarded-for': '203.0.113.10' },
    body: JSON.stringify({ name: 'A', text: 'first message' }),
  }, opts)).statusCode, 201);
  const throttled = await dispatchLikeGirlRequest({
    method: 'POST',
    url: '/api/messages',
    headers: { 'x-forwarded-for': '203.0.113.10' },
    body: JSON.stringify({ name: 'A', text: 'second message' }),
  }, opts);
  assert.equal(throttled.statusCode, 429);
  const messages = json(await dispatchLikeGirlRequest({ method: 'GET', url: '/api/messages' }, opts)).messages;
  assert.equal(messages.length, 1);
});
