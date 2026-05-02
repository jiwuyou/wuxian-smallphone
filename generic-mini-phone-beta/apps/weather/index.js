import { escapeHtml, qs } from '../shared.js';

export const manifest = {
  id: 'weather',
  name: '天气',
  shortName: '天',
  orbClass: 'orb-weather',
  views: {
    normal: 'weather',
    space2d: 'weather-station',
    space3d: 'weather-atrium',
  },
  worldObject: {
    type: 'weather-tower',
    label: '天气塔',
    defaultPlacement: { mapId: 'home', x: 10, y: 3 },
    action: { type: 'openApp', appId: 'weather', view: 'normal' },
  },
};

export const defaultState = {
  weather: {
    location: '海街',
    condition: '晴间多云',
    temperature: 23,
    high: 26,
    low: 18,
    wind: '东南风 2 级',
    humidity: 62,
    note: '傍晚适合散步，夜里风会稍微变凉。',
    forecast: [
      { day: '今天', condition: '晴', range: '18 / 26' },
      { day: '周一', condition: '多云', range: '17 / 24' },
      { day: '周二', condition: '小雨', range: '16 / 21' },
      { day: '周三', condition: '晴', range: '18 / 25' },
    ],
  },
};

export const template = `
  <section class="view app-workspace" data-view="weather">
    <div class="app-view-topline">
      <div>
        <p class="eyebrow">Weather</p>
        <h2>天气</h2>
      </div>
      <span class="app-view-pill" id="weather-location">海街</span>
    </div>
    <div class="weather-hero">
      <div>
        <span id="weather-condition">晴间多云</span>
        <strong id="weather-temperature">23°</strong>
      </div>
      <p id="weather-note">傍晚适合散步，夜里风会稍微变凉。</p>
    </div>
    <div class="weather-stats">
      <span id="weather-range">18° / 26°</span>
      <span id="weather-wind">东南风 2 级</span>
      <span id="weather-humidity">湿度 62%</span>
    </div>
    <div class="stack-grid" id="weather-forecast"></div>
  </section>
`;

export const spaceTemplates = `
  <section class="view app-space-view product-space weather-space-2d" data-view="weather-station" data-space-app="weather">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Weather Station</p>
        <h2>海街观测站</h2>
      </div>
      <button class="secondary-button" data-app-normal="weather" type="button">天气面板</button>
    </div>
    <div class="weather-station-board">
      <div class="weather-sky-dome">
        <span class="weather-sun"></span>
        <span class="weather-cloud cloud-a"></span>
        <span class="weather-cloud cloud-b"></span>
        <strong>23°</strong>
        <p>晴间多云</p>
      </div>
      <div class="weather-instruments">
        <div><strong>26°</strong><span>最高</span></div>
        <div><strong>18°</strong><span>最低</span></div>
        <div><strong>62%</strong><span>湿度</span></div>
        <div><strong>2 级</strong><span>东南风</span></div>
      </div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-space3d="weather" type="button">进入气象中庭</button>
    </div>
  </section>

  <section class="view app-space-view product-space weather-space-3d" data-view="weather-atrium" data-space-app="weather">
    <div class="space-topbar">
      <div>
        <p class="eyebrow">Weather Atrium</p>
        <h2>气象中庭</h2>
      </div>
      <button class="secondary-button" data-app-space2d="weather" type="button">回观测站</button>
    </div>
    <div class="weather-atrium-scene">
      <div class="glass-arc arc-left"></div>
      <div class="glass-arc arc-right"></div>
      <div class="floating-weather-orb">
        <strong>23°</strong>
        <span>海风轻</span>
      </div>
      <div class="rain-gauge"></div>
      <div class="wind-vane"></div>
    </div>
    <div class="space-actions">
      <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
      <button class="secondary-button" data-app-normal="weather" type="button">打开天气</button>
    </div>
  </section>
`;

export function render({ state }) {
  const weather = state.weather;
  const forecast = qs('#weather-forecast');
  if (!weather || !forecast) return;

  qs('#weather-location').textContent = weather.location;
  qs('#weather-condition').textContent = weather.condition;
  qs('#weather-temperature').textContent = `${weather.temperature}°`;
  qs('#weather-note').textContent = weather.note;
  qs('#weather-range').textContent = `${weather.low}° / ${weather.high}°`;
  qs('#weather-wind').textContent = weather.wind;
  qs('#weather-humidity').textContent = `湿度 ${weather.humidity}%`;
  forecast.innerHTML = weather.forecast.map((item) => `
    <article class="app-list-row weather-row">
      <strong>${escapeHtml(item.day)}</strong>
      <span>${escapeHtml(item.condition)}</span>
      <p>${escapeHtml(item.range)}°</p>
    </article>
  `).join('');
}
