const TERRAIN_TYPES = [
  { id: 'wild', label: '未开垦' },
  { id: 'grass', label: '草地' },
  { id: 'forest', label: '树林' },
  { id: 'house', label: '木屋' },
  { id: 'path', label: '小路' },
  { id: 'stone', label: '石头' },
  { id: 'bush', label: '草丛' },
];

const TERRAIN_LABELS = Object.fromEntries(TERRAIN_TYPES.map((terrain) => [terrain.id, terrain.label]));
const BLOCKING_TERRAINS = new Set(['forest', 'house', 'stone']);
const MOVE_DELTAS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const objectColors = {
  calendar: '#e05263',
  weather: '#2f80ed',
  diary: '#4f8f6a',
  files: '#d6992f',
  vocabulary: '#5c6bc0',
  airplane: '#2378ff',
};

const paintSession = {
  active: false,
  lastTileKey: '',
};

function getHomeMap(state) {
  return state.world?.maps?.home;
}

function getLayout(map) {
  if (Array.isArray(map?.layout) && map.layout.length) return map.layout;
  return [['grass']];
}

function getMapWidth(map) {
  return getLayout(map)[0]?.length || 1;
}

function getMapHeight(map) {
  return getLayout(map).length || 1;
}

function getTerrain(map, x, y) {
  return getLayout(map)[y]?.[x] || 'grass';
}

function setTerrain(map, x, y, terrain) {
  if (!Array.isArray(map.layout?.[y])) return;
  map.layout[y][x] = terrain;
}

function isInsideMap(map, x, y) {
  return x >= 0 && y >= 0 && x < getMapWidth(map) && y < getMapHeight(map);
}

function getAppAt(apps, x, y) {
  return apps.find((app) => {
    const placement = app.worldObject?.defaultPlacement;
    return placement?.mapId === 'home' && placement.x === x && placement.y === y;
  }) || null;
}

function getNearbyApp(apps, player) {
  return apps.find((app) => {
    const placement = app.worldObject?.defaultPlacement;
    if (placement?.mapId !== 'home') return false;
    const distance = Math.abs(placement.x - player.x) + Math.abs(placement.y - player.y);
    return distance <= 1;
  }) || null;
}

function getRenderMetrics(canvas, map, player) {
  const ratio = window.devicePixelRatio || 1;
  const tileSize = Math.round(Math.max(48 * ratio, Math.min(canvas.width, canvas.height) / 7));
  return {
    tileSize,
    offsetX: Math.round(canvas.width / 2 - (player.x + 0.5) * tileSize),
    offsetY: Math.round(canvas.height * 0.56 - (player.y + 0.5) * tileSize),
  };
}

function getCanvasPoint(canvas, event, map, player) {
  const rect = canvas.getBoundingClientRect();
  const { tileSize, offsetX, offsetY } = getRenderMetrics(canvas, map, player);
  const x = Math.floor(((event.clientX - rect.left) * (canvas.width / rect.width) - offsetX) / tileSize);
  const y = Math.floor(((event.clientY - rect.top) * (canvas.height / rect.height) - offsetY) / tileSize);
  return { x, y };
}

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawGrass(ctx, x, y, size, variant) {
  ctx.fillStyle = variant % 2 ? '#7ebf6f' : '#86c978';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(35, 83, 45, 0.16)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i += 1) {
    const gx = x + 8 + ((variant * 13 + i * 17) % Math.max(12, size - 16));
    const gy = y + 9 + ((variant * 19 + i * 11) % Math.max(12, size - 18));
    ctx.beginPath();
    ctx.moveTo(gx, gy + 7);
    ctx.lineTo(gx + 3, gy);
    ctx.lineTo(gx + 7, gy + 7);
    ctx.stroke();
  }
}

function drawWild(ctx, x, y, size, variant) {
  ctx.fillStyle = variant % 2 ? '#8bb168' : '#9fbc72';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(91, 75, 43, 0.18)';
  for (let i = 0; i < 7; i += 1) {
    const gx = x + 8 + ((variant * 11 + i * 19) % Math.max(12, size - 16));
    const gy = y + 8 + ((variant * 23 + i * 13) % Math.max(12, size - 16));
    ctx.beginPath();
    ctx.ellipse(gx, gy, 5, 2.2, (i % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(77, 58, 34, 0.24)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i += 1) {
    const sx = x + 12 + ((variant * 17 + i * 29) % Math.max(12, size - 24));
    const sy = y + 14 + ((variant * 31 + i * 23) % Math.max(12, size - 28));
    ctx.beginPath();
    ctx.moveTo(sx, sy + 8);
    ctx.lineTo(sx + 5, sy);
    ctx.lineTo(sx + 11, sy + 8);
    ctx.stroke();
  }
}

function drawPath(ctx, x, y, size, variant) {
  ctx.fillStyle = '#b8965c';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(255, 235, 178, 0.22)';
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.ellipse(
      x + ((variant * 17 + i * 23) % size),
      y + ((variant * 29 + i * 13) % size),
      2.4,
      1.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawForest(ctx, x, y, size, variant) {
  drawGrass(ctx, x, y, size, variant);
  const trunks = [
    [0.34, 0.58, 0.18],
    [0.64, 0.54, 0.2],
    [0.5, 0.34, 0.22],
  ];
  trunks.forEach(([cx, cy, scale], index) => {
    ctx.fillStyle = '#69462e';
    ctx.fillRect(x + size * cx - 3, y + size * cy + 6, 6, size * 0.18);
    ctx.fillStyle = index === 1 ? '#245c3a' : '#2f7044';
    ctx.beginPath();
    ctx.arc(x + size * cx, y + size * cy, size * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(172, 218, 135, 0.32)';
    ctx.beginPath();
    ctx.arc(x + size * cx - size * 0.05, y + size * cy - size * 0.06, size * scale * 0.34, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHouse(ctx, x, y, size) {
  drawGrass(ctx, x, y, size, 1);
  ctx.fillStyle = '#8b563b';
  drawRoundedRect(ctx, x + size * 0.2, y + size * 0.42, size * 0.6, size * 0.42, 8);
  ctx.fill();
  ctx.fillStyle = '#6c342d';
  ctx.beginPath();
  ctx.moveTo(x + size * 0.14, y + size * 0.46);
  ctx.lineTo(x + size * 0.5, y + size * 0.16);
  ctx.lineTo(x + size * 0.86, y + size * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f0c783';
  ctx.fillRect(x + size * 0.45, y + size * 0.61, size * 0.12, size * 0.23);
  ctx.fillStyle = '#d9e7ee';
  ctx.fillRect(x + size * 0.28, y + size * 0.55, size * 0.12, size * 0.1);
  ctx.fillRect(x + size * 0.62, y + size * 0.55, size * 0.12, size * 0.1);
}

function drawStone(ctx, x, y, size, variant) {
  drawGrass(ctx, x, y, size, variant);
  ctx.fillStyle = '#879098';
  ctx.beginPath();
  ctx.ellipse(x + size * 0.5, y + size * 0.58, size * 0.27, size * 0.2, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.beginPath();
  ctx.ellipse(x + size * 0.42, y + size * 0.5, size * 0.08, size * 0.04, -0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx, x, y, size, variant) {
  drawGrass(ctx, x, y, size, variant);
  ctx.fillStyle = '#3f8b50';
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.arc(x + size * (0.32 + i * 0.12), y + size * (0.58 - (i % 2) * 0.07), size * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(185, 228, 144, 0.42)';
  ctx.beginPath();
  ctx.arc(x + size * 0.39, y + size * 0.49, size * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

function drawTerrain(ctx, terrain, x, y, size, variant) {
  if (terrain === 'wild') drawWild(ctx, x, y, size, variant);
  else if (terrain === 'forest') drawForest(ctx, x, y, size, variant);
  else if (terrain === 'house') drawHouse(ctx, x, y, size);
  else if (terrain === 'path') drawPath(ctx, x, y, size, variant);
  else if (terrain === 'stone') drawStone(ctx, x, y, size, variant);
  else if (terrain === 'bush') drawBush(ctx, x, y, size, variant);
  else drawGrass(ctx, x, y, size, variant);
}

function drawObjectBadge(ctx, app, x, y, size) {
  const color = objectColors[app.id] || '#5c6bc0';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.beginPath();
  ctx.arc(x + size * 0.74, y + size * 0.22, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.max(10, size * 0.16)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(app.shortName, x + size * 0.74, y + size * 0.22);
}

function drawCalendarObject(ctx, x, y, size, color) {
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(x + size * 0.28, y + size * 0.56, size * 0.08, size * 0.26);
  ctx.fillRect(x + size * 0.64, y + size * 0.56, size * 0.08, size * 0.26);
  ctx.fillStyle = color;
  drawRoundedRect(ctx, x + size * 0.22, y + size * 0.28, size * 0.56, size * 0.36, size * 0.08);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillRect(x + size * 0.31, y + size * 0.39, size * 0.38, size * 0.05);
  ctx.fillRect(x + size * 0.31, y + size * 0.5, size * 0.28, size * 0.05);
}

function drawWeatherObject(ctx, x, y, size, color) {
  ctx.fillStyle = '#dfefff';
  drawRoundedRect(ctx, x + size * 0.42, y + size * 0.25, size * 0.16, size * 0.5, size * 0.06);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.25, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + size * 0.44, y + size * 0.22, size * 0.06, 0, Math.PI * 2);
  ctx.arc(x + size * 0.54, y + size * 0.22, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#637d90';
  ctx.fillRect(x + size * 0.36, y + size * 0.74, size * 0.28, size * 0.06);
}

function drawDiaryObject(ctx, x, y, size, color) {
  ctx.fillStyle = '#6b4a35';
  drawRoundedRect(ctx, x + size * 0.2, y + size * 0.6, size * 0.6, size * 0.14, size * 0.04);
  ctx.fill();
  ctx.fillStyle = color;
  drawRoundedRect(ctx, x + size * 0.28, y + size * 0.34, size * 0.44, size * 0.3, size * 0.06);
  ctx.fill();
  ctx.fillStyle = '#fff7dc';
  ctx.fillRect(x + size * 0.34, y + size * 0.4, size * 0.32, size * 0.05);
  ctx.fillRect(x + size * 0.34, y + size * 0.5, size * 0.22, size * 0.05);
  ctx.strokeStyle = '#f4d181';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.moveTo(x + size * 0.7, y + size * 0.26);
  ctx.lineTo(x + size * 0.82, y + size * 0.12);
  ctx.stroke();
}

function drawFilesObject(ctx, x, y, size, color) {
  ctx.fillStyle = '#855b35';
  drawRoundedRect(ctx, x + size * 0.24, y + size * 0.42, size * 0.52, size * 0.32, size * 0.06);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x + size * 0.24, y + size * 0.42, size * 0.52, size * 0.08);
  ctx.fillStyle = 'rgba(255, 244, 211, 0.9)';
  ctx.fillRect(x + size * 0.36, y + size * 0.54, size * 0.28, size * 0.08);
  ctx.strokeStyle = 'rgba(58, 37, 22, 0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + size * 0.24, y + size * 0.42, size * 0.52, size * 0.32);
}

function drawVocabularyObject(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.06);
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.48, size * 0.28, Math.PI * 0.95, Math.PI * 2.05);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
  drawRoundedRect(ctx, x + size * 0.28, y + size * 0.46, size * 0.44, size * 0.2, size * 0.06);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.max(10, size * 0.18)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Aa', x + size * 0.5, y + size * 0.56);
}

function drawAirplaneObject(ctx, x, y, size, color) {
  ctx.fillStyle = '#36465f';
  drawRoundedRect(ctx, x + size * 0.28, y + size * 0.58, size * 0.44, size * 0.18, size * 0.05);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.5, y + size * 0.22);
  ctx.lineTo(x + size * 0.68, y + size * 0.62);
  ctx.lineTo(x + size * 0.55, y + size * 0.56);
  ctx.lineTo(x + size * 0.5, y + size * 0.74);
  ctx.lineTo(x + size * 0.45, y + size * 0.56);
  ctx.lineTo(x + size * 0.32, y + size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
  ctx.beginPath();
  ctx.ellipse(x + size * 0.5, y + size * 0.42, size * 0.06, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawAppObject(ctx, app, x, y, size) {
  const color = objectColors[app.id] || '#5c6bc0';
  ctx.fillStyle = 'rgba(20, 28, 36, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + size * 0.5, y + size * 0.74, size * 0.22, size * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  const type = app.worldObject?.type;
  if (type === 'notice-board') drawCalendarObject(ctx, x, y, size, color);
  else if (type === 'weather-tower') drawWeatherObject(ctx, x, y, size, color);
  else if (type === 'writing-desk') drawDiaryObject(ctx, x, y, size, color);
  else if (type === 'archive-crate') drawFilesObject(ctx, x, y, size, color);
  else if (type === 'word-gate') drawVocabularyObject(ctx, x, y, size, color);
  else if (type === 'airplane-hangar') drawAirplaneObject(ctx, x, y, size, color);
  else {
    ctx.fillStyle = color;
    drawRoundedRect(ctx, x + size * 0.29, y + size * 0.24, size * 0.42, size * 0.42, 10);
    ctx.fill();
  }

  drawObjectBadge(ctx, app, x, y, size);
}

function drawPlayer(ctx, player, offsetX, offsetY, tileSize) {
  const x = offsetX + player.x * tileSize;
  const y = offsetY + player.y * tileSize;
  ctx.fillStyle = 'rgba(16, 24, 32, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + tileSize * 0.5, y + tileSize * 0.78, tileSize * 0.18, tileSize * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2e3146';
  ctx.beginPath();
  ctx.arc(x + tileSize * 0.5, y + tileSize * 0.46, tileSize * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd8bd';
  ctx.beginPath();
  ctx.arc(x + tileSize * 0.5, y + tileSize * 0.3, tileSize * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const direction = player.facing || 'down';
  const points = {
    down: [[0.5, 0.66], [0.43, 0.56], [0.57, 0.56]],
    up: [[0.5, 0.52], [0.43, 0.62], [0.57, 0.62]],
    left: [[0.4, 0.58], [0.52, 0.51], [0.52, 0.65]],
    right: [[0.6, 0.58], [0.48, 0.51], [0.48, 0.65]],
  }[direction];
  ctx.moveTo(x + tileSize * points[0][0], y + tileSize * points[0][1]);
  ctx.lineTo(x + tileSize * points[1][0], y + tileSize * points[1][1]);
  ctx.lineTo(x + tileSize * points[2][0], y + tileSize * points[2][1]);
  ctx.closePath();
  ctx.fill();
}

function drawWorldCanvas({ state, dom, apps }) {
  const canvas = dom.worldMap;
  const map = getHomeMap(state);
  if (!map || !(canvas instanceof HTMLCanvasElement)) return;

  resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext('2d');
  const width = getMapWidth(map);
  const height = getMapHeight(map);
  const { tileSize, offsetX, offsetY } = getRenderMetrics(canvas, map, state.world.player);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#5d9d61';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrain = getTerrain(map, x, y);
      const px = offsetX + x * tileSize;
      const py = offsetY + y * tileSize;
      if (px > canvas.width || py > canvas.height || px + tileSize < 0 || py + tileSize < 0) continue;
      drawTerrain(ctx, terrain, px, py, tileSize, x * 7 + y * 13);
      ctx.strokeStyle = 'rgba(40, 84, 44, 0.12)';
      ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
    }
  }

  apps.forEach((app) => {
    const placement = app.worldObject?.defaultPlacement;
    if (placement?.mapId !== 'home') return;
    drawAppObject(ctx, app, offsetX + placement.x * tileSize, offsetY + placement.y * tileSize, tileSize);
  });

  drawPlayer(ctx, state.world.player, offsetX, offsetY, tileSize);
}

function updateInspector({ state, dom, apps }) {
  const map = getHomeMap(state);
  const player = state.world.player;
  const terrain = getTerrain(map, player.x, player.y);
  const nearbyApp = getNearbyApp(apps, player);
  dom.worldInspector.textContent = nearbyApp
    ? `${TERRAIN_LABELS[terrain]} · 靠近 ${nearbyApp.worldObject?.label || nearbyApp.name}，按进入传送`
    : `${TERRAIN_LABELS[terrain]} · 玩家 (${player.x}, ${player.y})`;
}

function buildWorldTextState({ state, apps }) {
  const map = getHomeMap(state);
  const player = state.world.player;
  const nearbyApp = getNearbyApp(apps, player);
  return {
    coordinateSystem: 'tile grid, origin at top-left, x right, y down',
    shell: state.phoneShell?.mode || 'lock',
    desktopMode: state.desktop?.mode || 'world',
    activeView: document.querySelector('.view-active')?.dataset.view || '',
    map: {
      id: map?.id || 'home',
      width: map ? getMapWidth(map) : 0,
      height: map ? getMapHeight(map) : 0,
    },
    player: {
      x: player.x,
      y: player.y,
      facing: player.facing || 'down',
      terrain: map ? getTerrain(map, player.x, player.y) : '',
    },
    editMode: Boolean(state.world.editMode),
    selectedTerrain: state.world.selectedTerrain || 'grass',
    nearbyApp: nearbyApp ? {
      id: nearbyApp.id,
      name: nearbyApp.name,
      view2d: nearbyApp.views?.space2d || '',
      view3d: nearbyApp.views?.space3d || '',
    } : null,
    appObjects: apps.map((app) => ({
      id: app.id,
      label: app.worldObject?.label || app.name,
      x: app.worldObject?.defaultPlacement?.x,
      y: app.worldObject?.defaultPlacement?.y,
    })),
  };
}

export function applyDesktopMode({ state, dom }) {
  const mode = state.desktop?.mode || 'world';
  dom.desktopModeButtons.forEach((button) => {
    button.classList.toggle('desktop-mode-active', button.dataset.desktopMode === mode);
  });
  dom.worldBoard.classList.toggle('world-board-active', mode === 'world');
  dom.desktopScreen.classList.toggle('desktop-world-active', mode === 'world');
  dom.desktopScreen.classList.toggle('desktop-icons-active', mode === 'icons');
  dom.desktopPagesViewport.classList.toggle('desktop-pages-hidden', mode !== 'icons');
  dom.desktopPagination.classList.toggle('desktop-pages-hidden', mode !== 'icons');
}

export function setDesktopMode({ state, saveState, dom }, mode) {
  state.desktop.mode = mode;
  saveState();
  applyDesktopMode({ state, dom });
}

export function renderWorld({ state, dom, apps }) {
  drawWorldCanvas({ state, dom, apps });
  updateInspector({ state, dom, apps });
  window.render_game_to_text = () => JSON.stringify(buildWorldTextState({ state, apps }));
}

export function renderWorldToolbar({ state, saveState, dom }) {
  if (!dom.worldTerrainPalette || !dom.worldEditToggle) return;

  dom.worldBoard.classList.toggle('world-editing', Boolean(state.world.editMode));
  dom.worldEditToggle.classList.toggle('world-edit-active', Boolean(state.world.editMode));
  dom.worldEditToggle.textContent = state.world.editMode ? '完成' : '编辑';
  dom.worldTerrainPalette.innerHTML = TERRAIN_TYPES.map((terrain) => `
    <button class="terrain-swatch terrain-${terrain.id}${state.world.selectedTerrain === terrain.id ? ' terrain-swatch-active' : ''}" data-terrain="${terrain.id}" type="button">
      <span></span>${terrain.label}
    </button>
  `).join('');

  dom.worldTerrainPalette.querySelectorAll('[data-terrain]').forEach((button) => {
    button.addEventListener('click', () => {
      state.world.selectedTerrain = button.dataset.terrain;
      saveState();
      renderWorldToolbar({ state, saveState, dom });
    });
  });
}

function movePlayer({ state, saveState, dom, apps }, direction) {
  const map = getHomeMap(state);
  const delta = MOVE_DELTAS[direction];
  if (!map || !delta) return;

  const nextX = state.world.player.x + delta.x;
  const nextY = state.world.player.y + delta.y;
  state.world.player.facing = direction;

  if (isInsideMap(map, nextX, nextY) && !BLOCKING_TERRAINS.has(getTerrain(map, nextX, nextY))) {
    state.world.player.x = nextX;
    state.world.player.y = nextY;
  }

  saveState();
  renderWorld({ state, dom, apps });
}

function enterNearbyApp({ state, dom, apps, openAppSpace }) {
  const app = getNearbyApp(apps, state.world.player);
  if (app) {
    openAppSpace(app, 'space2d');
    return;
  }
  updateInspector({ state, dom, apps });
}

function handleCanvasClick({ state, saveState, dom, apps, openAppSpace }, event) {
  const map = getHomeMap(state);
  if (!map) return;
  const point = getCanvasPoint(dom.worldMap, event, map, state.world.player);
  if (!isInsideMap(map, point.x, point.y)) return;

  if (state.world.editMode) return;

  const app = getAppAt(apps, point.x, point.y);
  if (app) {
    openAppSpace(app, 'space2d');
    return;
  }

  dom.worldInspector.textContent = `${TERRAIN_LABELS[getTerrain(map, point.x, point.y)]} · (${point.x}, ${point.y})`;
}

function paintTerrainAtEvent({ state, saveState, dom, apps }, event) {
  const map = getHomeMap(state);
  if (!map) return false;
  const point = getCanvasPoint(dom.worldMap, event, map, state.world.player);
  if (!isInsideMap(map, point.x, point.y)) return false;

  const key = `${point.x}:${point.y}`;
  if (paintSession.lastTileKey === key) return true;

  paintSession.lastTileKey = key;
  setTerrain(map, point.x, point.y, state.world.selectedTerrain || 'grass');
  saveState();
  renderWorld({ state, dom, apps });
  dom.worldInspector.textContent = `${TERRAIN_LABELS[state.world.selectedTerrain] || '地块'} · 已填 (${point.x}, ${point.y})`;
  return true;
}

function stopPainting(event) {
  paintSession.active = false;
  paintSession.lastTileKey = '';
  if (event?.currentTarget?.releasePointerCapture && event.pointerId !== undefined) {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }
}

export function bindWorld({ state, saveState, dom, apps, openAppSpace }) {
  const context = { state, saveState, dom, apps, openAppSpace };
  window.render_game_to_text = () => JSON.stringify(buildWorldTextState({ state, apps }));
  window.advanceTime = () => renderWorld(context);

  dom.desktopModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setDesktopMode({ state, saveState, dom }, button.dataset.desktopMode);
      renderWorld(context);
    });
  });

  dom.worldEditToggle.addEventListener('click', () => {
    state.world.editMode = !state.world.editMode;
    saveState();
    renderWorldToolbar({ state, saveState, dom });
    renderWorld(context);
  });

  dom.worldMoveButtons.forEach((button) => {
    button.addEventListener('click', () => movePlayer(context, button.dataset.worldMove));
  });

  dom.worldEnterButton.addEventListener('click', () => enterNearbyApp(context));
  dom.worldMap.addEventListener('pointerdown', (event) => {
    if (!state.world.editMode) return;
    event.preventDefault();
    paintSession.active = true;
    paintSession.lastTileKey = '';
    dom.worldMap.setPointerCapture?.(event.pointerId);
    paintTerrainAtEvent(context, event);
  });
  dom.worldMap.addEventListener('pointermove', (event) => {
    if (!paintSession.active || !state.world.editMode) return;
    event.preventDefault();
    paintTerrainAtEvent(context, event);
  });
  dom.worldMap.addEventListener('pointerup', stopPainting);
  dom.worldMap.addEventListener('pointercancel', stopPainting);
  dom.worldMap.addEventListener('pointerleave', () => {
    if (paintSession.active) stopPainting();
  });
  dom.worldMap.addEventListener('click', (event) => handleCanvasClick(context, event));
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => renderWorld(context)).observe(dom.worldMap);
  } else {
    window.addEventListener('resize', () => renderWorld(context));
  }

  window.addEventListener('keydown', (event) => {
    if ((state.phoneShell?.mode || 'lock') !== 'desktop' || (state.desktop?.mode || 'world') !== 'world') return;
    const keyMap = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right',
    };
    if (keyMap[event.key]) {
      event.preventDefault();
      movePlayer(context, keyMap[event.key]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      enterNearbyApp(context);
    }
  });
}
