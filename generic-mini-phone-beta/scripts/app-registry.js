import * as calendar from '../apps/calendar/index.js';
import * as weather from '../apps/weather/index.js';
import * as diary from '../apps/diary/index.js';
import * as files from '../apps/files/index.js';
import * as vocabulary from '../apps/vocabulary/index.js';

export const appModules = [
  calendar,
  weather,
  diary,
  files,
  vocabulary,
];

export const registeredApps = appModules.map((app) => app.manifest);

export const appDefaultState = appModules.reduce((merged, app) => ({
  ...merged,
  ...(app.defaultState || {}),
}), {});

function createSpace2dTemplate(app) {
  const { manifest } = app;
  return `
    <section class="view app-space-view app-space-2d" data-view="${manifest.views.space2d}" data-space-app="${manifest.id}">
      <div class="app-view-topline">
        <div>
          <p class="eyebrow">2D Space</p>
          <h2>${manifest.worldObject?.label || manifest.name}</h2>
        </div>
        <button class="secondary-button" data-app-normal="${manifest.id}" type="button">正常 UI</button>
      </div>
      <div class="space-map-2d">
        <div class="space-room-grid">
          <span class="space-prop prop-door" data-world-return="home">门</span>
          <span class="space-prop prop-core ${manifest.orbClass}">${manifest.shortName}</span>
          <span class="space-prop prop-console" data-app-normal="${manifest.id}">控</span>
          <span class="space-prop prop-portal" data-app-space3d="${manifest.id}">3D</span>
        </div>
      </div>
      <div class="space-actions">
        <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
        <button class="secondary-button" data-app-space3d="${manifest.id}" type="button">进入 3D 空间</button>
      </div>
    </section>
  `;
}

function createSpace3dTemplate(app) {
  const { manifest } = app;
  return `
    <section class="view app-space-view app-space-3d" data-view="${manifest.views.space3d}" data-space-app="${manifest.id}">
      <div class="app-view-topline">
        <div>
          <p class="eyebrow">3D Space</p>
          <h2>${manifest.name}空间</h2>
        </div>
        <button class="secondary-button" data-app-space2d="${manifest.id}" type="button">回 2D</button>
      </div>
      <div class="space-scene-3d">
        <div class="scene-floor"></div>
        <div class="scene-wall scene-wall-left"></div>
        <div class="scene-wall scene-wall-right"></div>
        <div class="scene-object ${manifest.orbClass}">${manifest.shortName}</div>
      </div>
      <div class="space-actions">
        <button class="secondary-button" data-world-return="home" type="button">回主世界</button>
        <button class="secondary-button" data-app-normal="${manifest.id}" type="button">打开正常 UI</button>
      </div>
    </section>
  `;
}

export const appSpaceTemplates = appModules.map((app) => (
  app.spaceTemplates || `${createSpace2dTemplate(app)}${createSpace3dTemplate(app)}`
)).join('');
