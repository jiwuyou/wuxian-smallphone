'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { LikeGirlValidationError, bootstrap, createMessage, getArticle, normalizeState } = require('../src/domain');
const { cloneSeedState } = require('../src/seed-data');

test('normalizes and bootstraps seed state', () => {
  const data = bootstrap(normalizeState(cloneSeedState()));
  assert.equal(data.profile.title, 'LikeGirl');
  assert.equal(data.articles.length > 0, true);
  assert.equal(data.photos.length > 0, true);
});

test('gets article by id and rejects missing articles', () => {
  const state = normalizeState(cloneSeedState());
  assert.equal(getArticle(state, 'little-001').title, '今天也要认真记录');
  assert.throws(() => getArticle(state, 'missing'), /记录不存在/);
});

test('normalizes admin article html separately from escaped summaries', () => {
  const state = normalizeState({
    articles: [{
      id: 'html-1',
      title: 'HTML body',
      author: 'Admin',
      html: '<p>Hello <strong>media</strong></p><img src="/uploads/photos/a.png">',
    }],
  });
  const article = getArticle(state, 'html-1');
  assert.equal(article.text, 'Hello media');
  assert.match(article.html, /<img/);
});

test('validates message input', () => {
  const state = normalizeState(cloneSeedState());
  assert.throws(() => createMessage(state, { name: 'A', text: '123456' }), LikeGirlValidationError);
  assert.throws(() => createMessage(state, { name: 'A', text: '垃圾内容' }), LikeGirlValidationError);
  const message = createMessage(state, { name: 'A', text: 'hello' }, { id: 'm1', now: '2026-05-04T00:00:00.000Z' });
  assert.equal(message.id, 'm1');
});

test('bootstrap applies message latest limit', () => {
  const state = normalizeState(cloneSeedState());
  state.messageSettings.latestLimit = 1;
  state.messages.unshift({ id: 'm2', name: 'A', qq: '', text: 'newest', createdAt: '2026-05-05T00:00:00.000Z' });
  assert.equal(bootstrap(state).messages.length, 1);
  assert.equal(bootstrap(state).messages[0].id, 'm2');
});

test('normalizes original LikeGirl message setting aliases', () => {
  const state = normalizeState({
    ...cloneSeedState(),
    messageSettings: { jiequ: 2, lanjiezf: '广告 赌博' },
  });
  assert.equal(bootstrap(state).messages.length <= 2, true);
  assert.throws(() => createMessage(state, { name: 'A', text: '这里有广告' }), LikeGirlValidationError);
});
