import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'vocabulary',
  name: '背单词',
  shortName: '词',
  orbClass: 'orb-vocabulary',
  views: {
    normal: 'vocabulary',
    space2d: 'word-garden',
    space3d: 'word-conservatory',
  },
  worldObject: {
    type: 'word-gate',
    label: '单词花园',
    defaultPlacement: { mapId: 'home', x: 13, y: 11 },
    action: { type: 'openApp', appId: 'vocabulary', view: 'normal' },
  },
};

export const defaultState = {
  vocabulary: [
    { word: 'cultivate', meaning: '开垦；培养', example: 'Cultivate a small map before expanding the world.', learned: false },
    { word: 'archive', meaning: '档案；归档', example: 'The memory app works like a quiet archive.', learned: true },
    { word: 'portal', meaning: '入口；传送门', example: 'Each object can become a portal to an app space.', learned: false },
    { word: 'terrain', meaning: '地形；地貌', example: 'Undefined terrain should feel editable, not empty.', learned: false },
  ],
};

export const template = `
  <section class="view app-workspace" data-view="vocabulary">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Vocabulary</p>
        <h2>背单词</h2>
      </div>
      <span class="app-view-pill" id="vocabulary-progress">0 / 0</span>
    </div>
    <form class="journal-form" id="vocabulary-form">
      <input type="text" id="vocabulary-word" placeholder="单词，比如：landmark">
      <input type="text" id="vocabulary-meaning" placeholder="释义，比如：地标">
      <textarea id="vocabulary-example" rows="3" placeholder="例句，比如：The mailbox is a landmark in the home map."></textarea>
      <button type="submit" class="soft-button small-button">加入词库</button>
    </form>
    <div class="stack-grid" id="vocabulary-list"></div>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space vocab-space-2d" data-view="word-garden" data-space-app="vocabulary">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Word Garden</p>
        <h2>单词花园</h2>
      </div>
      <button class="secondary-button" data-app-normal="vocabulary" type="button">词卡</button>
    </div>
    <div class="word-garden-board">
      <div class="word-plot plot-learned"><strong>archive</strong><span>已掌握</span></div>
      <div class="word-plot"><strong>cultivate</strong><span>开垦；培养</span></div>
      <div class="word-plot"><strong>portal</strong><span>入口</span></div>
      <div class="word-plot"><strong>terrain</strong><span>地形</span></div>
      <div class="garden-path"></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="vocabulary" type="button">进入温室</button>
    </div>
  </section>

  <section class="view app-space-view product-space vocab-space-3d" data-view="word-conservatory" data-space-app="vocabulary">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Word Conservatory</p>
        <h2>单词温室</h2>
      </div>
      <button class="secondary-button" data-app-space2d="vocabulary" type="button">回花园</button>
    </div>
    <div class="word-conservatory-scene">
      <div class="greenhouse-arch"></div>
      <div class="word-orb orb-a">portal</div>
      <div class="word-orb orb-b">terrain</div>
      <div class="word-orb orb-c">archive</div>
      <div class="study-podium"><strong>1 / 4</strong><span>已掌握</span></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="vocabulary" type="button">打开词卡</button>
    </div>
  </section>
`;

export function render({ state, saveState, refresh }) {
  const progress = qs('#vocabulary-progress');
  const list = qs('#vocabulary-list');
  if (!progress || !list) return;

  const learned = state.vocabulary.filter((item) => item.learned).length;
  progress.textContent = `${learned} / ${state.vocabulary.length}`;
  list.innerHTML = '';

  state.vocabulary.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = `vocabulary-card${item.learned ? ' vocabulary-card-learned' : ''}`;
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(item.word)}</strong>
        <p>${escapeHtml(item.meaning)}</p>
      </div>
      <p class="vocabulary-example">${escapeHtml(item.example)}</p>
      <button class="secondary-button" type="button">${item.learned ? '标为未会' : '我会了'}</button>
    `;
    card.querySelector('button').addEventListener('click', () => {
      state.vocabulary[index].learned = !state.vocabulary[index].learned;
      saveState();
      refresh();
    });
    list.appendChild(card);
  });
}

export function bind({ state, saveState, refresh }) {
  const form = qs('#vocabulary-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const wordInput = qs('#vocabulary-word');
    const meaningInput = qs('#vocabulary-meaning');
    const exampleInput = qs('#vocabulary-example');
    const word = wordInput.value.trim();
    const meaning = meaningInput.value.trim();
    const example = exampleInput.value.trim();
    if (!word || !meaning) return;

    state.vocabulary.unshift({
      word,
      meaning,
      example: example || `${word} is waiting for a better example.`,
      learned: false,
    });

    wordInput.value = '';
    meaningInput.value = '';
    exampleInput.value = '';
    saveState();
    refresh();
  });
}
