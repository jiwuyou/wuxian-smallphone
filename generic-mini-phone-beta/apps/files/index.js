import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'files',
  name: '文件夹',
  shortName: '夹',
  orbClass: 'orb-files',
  views: {
    normal: 'files',
    space2d: 'file-warehouse',
    space3d: 'file-stacks',
  },
  worldObject: {
    type: 'archive-crate',
    label: '文件仓库',
    defaultPlacement: { mapId: 'home', x: 11, y: 7 },
    action: { type: 'openApp', appId: 'files', view: 'normal' },
  },
};

export const defaultState = {
  files: [
    { name: '地图草稿', type: 'folder', count: 8, updated: '今天', accent: 'green' },
    { name: '角色资料', type: 'folder', count: 12, updated: '昨天', accent: 'purple' },
    { name: '角色设定备份.json', type: 'file', count: 1, updated: '4 月 24 日', accent: 'blue' },
    { name: '待整理截图', type: 'folder', count: 31, updated: '4 月 21 日', accent: 'gold' },
  ],
};

export const template = `
  <section class="view app-workspace" data-view="files">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Files</p>
        <h2>文件夹</h2>
      </div>
      <span class="app-view-pill" id="files-count">0 项</span>
    </div>
    <form class="inline-form app-inline-form" id="files-form">
      <input type="text" id="files-name" placeholder="新文件夹或文件名">
      <button type="submit" class="soft-button small-button">新建</button>
    </form>
    <div class="file-grid" id="files-list"></div>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space files-space-2d" data-view="file-warehouse" data-space-app="files">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">File Warehouse</p>
        <h2>档案仓库</h2>
      </div>
      <button class="secondary-button" data-app-normal="files" type="button">文件列表</button>
    </div>
    <div class="file-warehouse-board">
      <div class="warehouse-aisle">
        <div class="archive-rack rack-left"><span>地图</span><span>角色</span><span>截图</span></div>
        <div class="archive-cart"><strong>4</strong><span>最近项目</span></div>
        <div class="archive-rack rack-right"><span>JSON</span><span>备份</span><span>素材</span></div>
      </div>
      <div class="warehouse-index">
        <span>地图草稿</span><span>角色资料</span><span>角色设定备份</span>
      </div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="files" type="button">进入立体档案库</button>
    </div>
  </section>

  <section class="view app-space-view product-space files-space-3d" data-view="file-stacks" data-space-app="files">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">File Stacks</p>
        <h2>立体档案库</h2>
      </div>
      <button class="secondary-button" data-app-space2d="files" type="button">回仓库</button>
    </div>
    <div class="file-stacks-scene">
      <div class="stack-lane"></div>
      <div class="file-column column-a"></div>
      <div class="file-column column-b"></div>
      <div class="file-column column-c"></div>
      <div class="archive-terminal"><strong>31</strong><span>待整理截图</span></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="files" type="button">打开文件夹</button>
    </div>
  </section>
`;

export function render({ state }) {
  const count = qs('#files-count');
  const list = qs('#files-list');
  if (!count || !list) return;

  count.textContent = `${state.files.length} 项`;
  list.innerHTML = state.files.map((file) => `
    <button class="file-tile" type="button">
      <span class="file-mark file-mark-${escapeHtml(file.accent)}">${file.type === 'folder' ? '夹' : '文'}</span>
      <strong>${escapeHtml(file.name)}</strong>
      <p>${file.type === 'folder' ? `${file.count} 项` : '文件'} · ${escapeHtml(file.updated)}</p>
    </button>
  `).join('');
}

export function bind({ state, saveState, refresh }) {
  const form = qs('#files-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const nameInput = qs('#files-name');
    const name = nameInput.value.trim();
    if (!name) return;

    state.files.unshift({
      name,
      type: name.includes('.') ? 'file' : 'folder',
      count: name.includes('.') ? 1 : 0,
      updated: '刚刚',
      accent: 'green',
    });

    nameInput.value = '';
    saveState();
    refresh();
  });
}
