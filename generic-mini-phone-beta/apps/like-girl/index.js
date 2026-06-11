import { qs } from '../shared.js';

const defaultUrl = 'http://127.0.0.1:23003/';

export const manifest = {
  id: 'like-girl',
  name: 'LikeGirl',
  shortName: '恋',
  orbClass: 'orb-like-girl',
  views: {
    normal: 'like-girl',
    space2d: 'like-girl-room',
    space3d: 'like-girl-space',
  },
  worldObject: {
    type: 'love-page',
    label: '恋爱主页',
    defaultPlacement: { mapId: 'home', x: 10, y: 8 },
    action: { type: 'openApp', appId: 'like-girl', view: 'normal' },
  },
};

export const defaultState = {};

export const template = `
  <section class="view like-girl-workspace" data-view="like-girl">
    <iframe id="like-girl-frame" title="LikeGirl" loading="lazy"></iframe>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space like-girl-space-2d" data-view="like-girl-room" data-space-app="like-girl">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">LikeGirl Room</p>
        <h2>恋爱主页</h2>
      </div>
      <button class="secondary-button" data-app-normal="like-girl" type="button">打开页面</button>
    </div>
    <div class="like-girl-room-board">
      <div class="like-girl-card-preview">
        <span>点点滴滴</span>
        <strong>相册、留言、清单和关于页面都由独立 SQLite 后端提供。</strong>
      </div>
      <div class="like-girl-photo-stack">
        <span></span><span></span><span></span>
      </div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="like-girl" type="button">进入空间</button>
    </div>
  </section>

  <section class="view app-space-view product-space like-girl-space-3d" data-view="like-girl-space" data-space-app="like-girl">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">LikeGirl Space</p>
        <h2>页面空间</h2>
      </div>
      <button class="secondary-button" data-app-space2d="like-girl" type="button">回房间</button>
    </div>
    <div class="like-girl-space-scene">
      <div class="like-girl-portal">恋</div>
      <div class="like-girl-orbit orbit-a"></div>
      <div class="like-girl-orbit orbit-b"></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="like-girl" type="button">打开应用</button>
    </div>
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
