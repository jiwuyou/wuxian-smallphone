import { qs } from '../shared.js';

const defaultUrl = 'http://127.0.0.1:23003/';

export const manifest = {
  id: 'like-girl',
  name: 'LikeGirl',
  shortName: '恋',
  orbClass: 'orb-like-girl',
  views: {
    normal: 'like-girl',
  },
};

export const defaultState = {};

export const template = `
  <section class="view like-girl-workspace" data-view="like-girl">
    <iframe id="like-girl-frame" title="LikeGirl" loading="lazy"></iframe>
  </section>
`;

function normalizeUrl(value) {
  const raw = String(value || '').trim() || defaultUrl;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function joinAppUrl(baseUrl, path) {
  const base = normalizeUrl(baseUrl);
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}${suffix}` : base;
}

function currentUrl(state) {
  const config = state?.standaloneApps?.likeGirl || {};
  return joinAppUrl(config.url || defaultUrl, config.path || '');
}

function openUrl(url) {
  const normalized = normalizeUrl(url);
  const frame = qs('#like-girl-frame');
  if (frame) frame.src = normalized;
}

export function render({ state }) {
  openUrl(currentUrl(state));
}

export function bind() {}
