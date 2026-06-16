import { qs } from '../shared.js';

const defaultUrl = 'http://127.0.0.1:23008/';

export const manifest = {
  id: 'like-girl-clone',
  name: 'LikeGirl 分身',
  shortName: '分',
  orbClass: 'orb-like-girl-clone',
  views: {
    normal: 'like-girl-clone',
  },
};

export const defaultState = {};

export const template = `
  <section class="view like-girl-workspace" data-view="like-girl-clone">
    <iframe id="like-girl-clone-frame" title="LikeGirl 分身" loading="lazy"></iframe>
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
  const config = state?.standaloneApps?.likeGirlClone || {};
  return joinAppUrl(config.url || defaultUrl, config.path || '');
}

function openUrl(url) {
  const normalized = normalizeUrl(url);
  const frame = qs('#like-girl-clone-frame');
  if (frame) frame.src = normalized;
}

export function render({ state }) {
  openUrl(currentUrl(state));
}

export function bind() {}
