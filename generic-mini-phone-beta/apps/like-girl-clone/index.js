import { qs } from '../shared.js';

const defaultUrl = 'http://127.0.0.1:4108/';

export const manifest = {
  id: 'like-girl-clone',
  name: 'LikeGirl 分身',
  shortName: '分',
  orbClass: 'orb-like-girl-clone',
  views: {
    normal: 'like-girl-clone',
    space2d: 'like-girl-clone-room',
    space3d: 'like-girl-clone-space',
  },
  worldObject: {
    type: 'love-page-clone',
    label: '恋爱主页分身',
    defaultPlacement: { mapId: 'home', x: 11, y: 8 },
    action: { type: 'openApp', appId: 'like-girl-clone', view: 'normal' },
  },
};

export const defaultState = {};

export const template = `
  <section class="view like-girl-workspace" data-view="like-girl-clone">
    <iframe id="like-girl-clone-frame" title="LikeGirl 分身" loading="lazy"></iframe>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space like-girl-space-2d" data-view="like-girl-clone-room" data-space-app="like-girl-clone">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">LikeGirl Clone</p>
        <h2>恋爱主页分身</h2>
      </div>
      <button class="secondary-button" data-app-normal="like-girl-clone" type="button">打开分身</button>
    </div>
    <div class="like-girl-room-board">
      <div class="like-girl-card-preview">
        <span>独立实例</span>
        <strong>同一份源码，独立端口、独立 SQLite、独立上传文件和后台账号。</strong>
      </div>
      <div class="like-girl-photo-stack">
        <span></span><span></span><span></span>
      </div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="like-girl-clone" type="button">进入空间</button>
    </div>
  </section>

  <section class="view app-space-view product-space like-girl-space-3d" data-view="like-girl-clone-space" data-space-app="like-girl-clone">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Clone Space</p>
        <h2>分身空间</h2>
      </div>
      <button class="secondary-button" data-app-space2d="like-girl-clone" type="button">回房间</button>
    </div>
    <div class="like-girl-space-scene">
      <div class="like-girl-portal">分</div>
      <div class="like-girl-orbit orbit-a"></div>
      <div class="like-girl-orbit orbit-b"></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="like-girl-clone" type="button">打开分身</button>
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
