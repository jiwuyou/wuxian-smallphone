import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'diary',
  name: '备忘录',
  shortName: '备',
  orbClass: 'orb-diary',
  views: {
    normal: 'diary',
  },
};

export const defaultState = {};

let editingIndex = null;
let searchTerm = '';

export const template = `
  <section class="view app-workspace" data-view="diary">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Memo</p>
        <h2>备忘录</h2>
      </div>
      <span class="app-view-pill" id="diary-count">0 条</span>
    </div>
    <form class="journal-form" id="diary-form">
      <input type="text" id="diary-title" placeholder="标题">
      <textarea id="diary-input" rows="4" placeholder="写一条简短备忘..."></textarea>
      <button type="submit" class="soft-button small-button" id="diary-save">保存备忘</button>
      <button type="button" class="secondary-button small-button" id="diary-cancel" hidden>取消编辑</button>
    </form>
    <input type="search" id="diary-search" placeholder="搜索备忘">
    <div class="stack-grid" id="diary-list"></div>
  </section>
`;

function getMemos(state) {
  if (!Array.isArray(state.journals)) state.journals = [];
  return state.journals;
}

function getEntryDate(entry) {
  return entry.date || entry.updatedAt || entry.createdAt || '刚刚';
}

function resetForm() {
  editingIndex = null;
  const titleInput = qs('#diary-title');
  const textInput = qs('#diary-input');
  const saveButton = qs('#diary-save');
  const cancelButton = qs('#diary-cancel');
  if (titleInput) titleInput.value = '';
  if (textInput) textInput.value = '';
  if (saveButton) saveButton.textContent = '保存备忘';
  if (cancelButton) cancelButton.hidden = true;
}

export function render({ state }) {
  const count = qs('#diary-count');
  const list = qs('#diary-list');
  if (!count || !list) return;

  const memos = getMemos(state);
  const query = searchTerm.trim().toLocaleLowerCase();
  const visibleMemos = memos
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (!query) return true;
      return [entry.title, entry.text, getEntryDate(entry)]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query);
    });

  count.textContent = query ? `${visibleMemos.length}/${memos.length} 条` : `${memos.length} 条`;
  if (!visibleMemos.length) {
    list.innerHTML = `<article class="journal-card"><p>${query ? '没有匹配的备忘。' : '暂无备忘。'}</p></article>`;
    return;
  }

  list.innerHTML = visibleMemos.map(({ entry, index }) => `
    <article class="journal-card">
      <strong>${escapeHtml(entry.title)}</strong>
      <span class="tag">${escapeHtml(getEntryDate(entry))}</span>
      <p>${escapeHtml(entry.text)}</p>
      <button type="button" class="soft-button small-button" data-diary-edit="${index}">编辑</button>
      <button type="button" class="secondary-button small-button" data-diary-delete="${index}">删除</button>
    </article>
  `).join('');
}

export function bind({ state, saveState, refresh }) {
  const form = qs('#diary-form');
  if (!form) return;
  const list = qs('#diary-list');
  const searchInput = qs('#diary-search');
  const cancelButton = qs('#diary-cancel');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const memos = getMemos(state);
    const titleInput = qs('#diary-title');
    const textInput = qs('#diary-input');
    const title = titleInput.value.trim();
    const text = textInput.value.trim();
    if (!title || !text) return;

    if (editingIndex === null) {
      memos.unshift({
        title,
        text,
        date: '刚刚',
      });
    } else if (memos[editingIndex]) {
      memos[editingIndex] = {
        ...memos[editingIndex],
        title,
        text,
        date: memos[editingIndex].date || '刚刚',
      };
    }

    resetForm();
    saveState();
    refresh();
  });

  cancelButton?.addEventListener('click', resetForm);

  searchInput?.addEventListener('input', () => {
    searchTerm = searchInput.value;
    render({ state });
  });

  list?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const editButton = target?.closest('[data-diary-edit]');
    const deleteButton = target?.closest('[data-diary-delete]');
    const memos = getMemos(state);

    if (editButton) {
      const index = Number(editButton.dataset.diaryEdit);
      const entry = memos[index];
      if (!entry) return;
      editingIndex = index;
      qs('#diary-title').value = entry.title || '';
      qs('#diary-input').value = entry.text || '';
      qs('#diary-save').textContent = '更新备忘';
      qs('#diary-cancel').hidden = false;
      qs('#diary-title').focus();
      return;
    }

    if (deleteButton) {
      const index = Number(deleteButton.dataset.diaryDelete);
      if (!memos[index]) return;
      memos.splice(index, 1);
      if (editingIndex === index) resetForm();
      else if (editingIndex !== null && index < editingIndex) editingIndex -= 1;
      saveState();
      refresh();
    }
  });
}
