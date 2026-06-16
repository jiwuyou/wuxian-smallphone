import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'files',
  name: '文件夹',
  shortName: '夹',
  orbClass: 'orb-files',
  views: {
    normal: 'files',
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
