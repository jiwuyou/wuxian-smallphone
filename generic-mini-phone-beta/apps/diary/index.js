import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'diary',
  name: '日记本',
  shortName: '记',
  orbClass: 'orb-diary',
  views: {
    normal: 'diary',
    space2d: 'diary-room',
    space3d: 'diary-studio',
  },
  worldObject: {
    type: 'writing-desk',
    label: '日记桌',
    defaultPlacement: { mapId: 'home', x: 6, y: 6 },
    action: { type: 'openApp', appId: 'diary', view: 'normal' },
  },
};

export const defaultState = {};

export const template = `
  <section class="view app-workspace" data-view="diary">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Diary</p>
        <h2>日记本</h2>
      </div>
      <span class="app-view-pill" id="diary-count">0 篇</span>
    </div>
    <form class="journal-form" id="diary-form">
      <input type="text" id="diary-title" placeholder="标题，比如：今天的二维地图">
      <textarea id="diary-input" rows="4" placeholder="写下今天的想法、地图布局或应用入口设计..."></textarea>
      <button type="submit" class="soft-button small-button">写入日记</button>
    </form>
    <div class="stack-grid" id="diary-list"></div>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space diary-space-2d" data-view="diary-room" data-space-app="diary">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Diary Room</p>
        <h2>写作房间</h2>
      </div>
      <button class="secondary-button" data-app-normal="diary" type="button">日记本</button>
    </div>
    <div class="diary-room-board">
      <div class="writing-desk-scene">
        <div class="desk-lamp"></div>
        <div class="open-notebook">
          <span>今天的海风</span>
          <strong>把二维世界整理成可居住的地方。</strong>
        </div>
        <div class="ink-bottle"></div>
      </div>
      <div class="diary-shelf">
        <span>情绪</span><span>地图</span><span>记忆</span><span>草稿</span>
      </div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="diary" type="button">进入写作室</button>
    </div>
  </section>

  <section class="view app-space-view product-space diary-space-3d" data-view="diary-studio" data-space-app="diary">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Diary Studio</p>
        <h2>沉浸写作室</h2>
      </div>
      <button class="secondary-button" data-app-space2d="diary" type="button">回房间</button>
    </div>
    <div class="diary-studio-scene">
      <div class="studio-window"></div>
      <div class="studio-desk">
        <div class="paper-stack"></div>
        <div class="warm-keyboard"></div>
      </div>
      <div class="floating-page page-a"></div>
      <div class="floating-page page-b"></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="diary" type="button">打开日记</button>
    </div>
  </section>
`;

export function render({ state }) {
  const count = qs('#diary-count');
  const list = qs('#diary-list');
  if (!count || !list) return;

  count.textContent = `${state.journals.length} 篇`;
  list.innerHTML = state.journals.map((entry) => `
    <article class="journal-card">
      <strong>${escapeHtml(entry.title)}</strong>
      <span class="tag">${escapeHtml(entry.date)}</span>
      <p>${escapeHtml(entry.text)}</p>
    </article>
  `).join('');
}

export function bind({ state, saveState, refresh }) {
  const form = qs('#diary-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const titleInput = qs('#diary-title');
    const textInput = qs('#diary-input');
    const title = titleInput.value.trim();
    const text = textInput.value.trim();
    if (!title || !text) return;

    state.journals.unshift({
      title,
      text,
      date: '刚刚',
    });

    titleInput.value = '';
    textInput.value = '';
    saveState();
    refresh();
  });
}
