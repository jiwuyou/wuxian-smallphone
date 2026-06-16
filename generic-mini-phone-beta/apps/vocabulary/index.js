import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'vocabulary',
  name: '背单词',
  shortName: '词',
  orbClass: 'orb-vocabulary',
  views: {
    normal: 'vocabulary',
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
