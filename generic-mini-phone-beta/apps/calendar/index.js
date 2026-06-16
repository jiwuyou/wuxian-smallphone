import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'calendar',
  name: '日历',
  shortName: '历',
  orbClass: 'orb-calendar',
  views: {
    normal: 'calendar',
  },
};

export const defaultState = {
  calendarEvents: [
    { date: '今天', time: '10:30', title: '整理 SmallPhone 地图需求', place: '主桌面', tone: 'work' },
    { date: '今天', time: '19:00', title: '海街散步', place: '码头', tone: 'life' },
    { date: '明天', time: '09:20', title: '检查 beta 前端', place: '工作区', tone: 'work' },
  ],
};

export const template = `
  <section class="view app-workspace" data-view="calendar">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Calendar</p>
        <h2>日历</h2>
      </div>
      <span class="app-view-pill">今天</span>
    </div>
    <div class="calendar-strip" id="calendar-strip"></div>
    <form class="inline-form app-inline-form" id="calendar-form">
      <input type="text" id="calendar-title" placeholder="新增日程，比如：整理地图格子类型">
      <input type="time" id="calendar-time" value="20:00">
      <button type="submit" class="soft-button small-button">添加</button>
    </form>
    <div class="stack-grid" id="calendar-list"></div>
  </section>
`;

export function render({ state }) {
  const strip = qs('#calendar-strip');
  const list = qs('#calendar-list');
  if (!strip || !list) return;

  const days = ['今天', '明天', '周二', '周三', '周四'];
  strip.innerHTML = days.map((day, index) => `
    <div class="calendar-day${index === 0 ? ' calendar-day-active' : ''}">
      <span>${day}</span>
      <strong>${index + 26}</strong>
    </div>
  `).join('');

  list.innerHTML = state.calendarEvents.map((event) => `
    <article class="app-list-row">
      <div class="app-row-time">
        <strong>${escapeHtml(event.time)}</strong>
        <span>${escapeHtml(event.date)}</span>
      </div>
      <div>
        <strong>${escapeHtml(event.title)}</strong>
        <p>${escapeHtml(event.place)}</p>
      </div>
    </article>
  `).join('');
}

export function bind({ state, saveState, refresh }) {
  const form = qs('#calendar-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const titleInput = qs('#calendar-title');
    const timeInput = qs('#calendar-time');
    const title = titleInput.value.trim();
    if (!title) return;

    state.calendarEvents.unshift({
      date: '今天',
      time: timeInput.value || '20:00',
      title,
      place: '个人地图',
      tone: 'work',
    });

    titleInput.value = '';
    saveState();
    refresh();
  });
}
