import { qs } from '../shared.js';

const canvasWidth = 320;
const canvasHeight = 480;
const storageKey = 'smallphone.airplaneShooterBestScore';

export const manifest = {
  id: 'airplane',
  name: '飞机大战',
  shortName: '机',
  orbClass: 'orb-airplane',
  views: {
    normal: 'airplane',
  },
};

export const defaultState = {
  airplane: {
    bestScore: 0,
  },
};

export const template = `
  <section class="view app-workspace airplane-workspace" data-view="airplane">
    <div class="app-view-topline airplane-topline">
      <div>
        <p class="eyebrow">Air Patrol</p>
        <h2>飞机大战</h2>
      </div>
      <span class="app-view-pill" id="airplane-best-score">最佳 0</span>
    </div>
    <div class="airplane-game-shell">
      <canvas id="airplane-canvas" width="320" height="480" aria-label="飞机大战小游戏"></canvas>
      <div class="airplane-hud">
        <span id="airplane-score">分数 0</span>
        <span id="airplane-lives">生命 3</span>
      </div>
      <div class="airplane-overlay" id="airplane-overlay">
        <strong>海风巡航</strong>
        <p>方向键 / WASD 移动，空格射击；手机上拖动飞机，点开始后会自动开火。</p>
        <button class="soft-button small-button" type="button" id="airplane-start-button">开始游戏</button>
      </div>
    </div>
    <div class="airplane-control-row" aria-label="飞机大战操作">
      <button class="secondary-button small-button" type="button" id="airplane-restart-button">重新开始</button>
      <p>躲开红色敌机，击中越多分越高。</p>
    </div>
  </section>
`;

const game = {
  initialized: false,
  running: false,
  over: false,
  score: 0,
  lives: 3,
  lastTime: 0,
  bulletTimer: 0,
  enemyTimer: 0,
  cloudTimer: 0,
  keys: new Set(),
  pointerActive: false,
  player: { x: canvasWidth / 2, y: canvasHeight - 52, r: 15 },
  bullets: [],
  enemies: [],
  clouds: [],
};

let context = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getBestScore(state) {
  const saved = Number(window.localStorage.getItem(storageKey));
  return Math.max(Number(state.airplane?.bestScore || 0), Number.isFinite(saved) ? saved : 0);
}

function setBestScore(state, score) {
  const bestScore = Math.max(getBestScore(state), score);
  state.airplane = {
    ...(state.airplane || {}),
    bestScore,
  };
  window.localStorage.setItem(storageKey, String(bestScore));
  return bestScore;
}

function resetGame() {
  game.running = true;
  game.over = false;
  game.score = 0;
  game.lives = 3;
  game.lastTime = performance.now();
  game.bulletTimer = 0;
  game.enemyTimer = 0;
  game.cloudTimer = 0;
  game.player = { x: canvasWidth / 2, y: canvasHeight - 52, r: 15 };
  game.bullets = [];
  game.enemies = [];
  game.clouds = [
    { x: 54, y: 80, size: 28, speed: 12 },
    { x: 230, y: 160, size: 36, speed: 9 },
  ];
  updateOverlay();
  updateHud();
  requestAnimationFrame(tick);
}

function updateHud() {
  const score = qs('#airplane-score');
  const lives = qs('#airplane-lives');
  const best = qs('#airplane-best-score');
  if (score) score.textContent = `分数 ${game.score}`;
  if (lives) lives.textContent = `生命 ${game.lives}`;
  if (best && context?.state) best.textContent = `最佳 ${getBestScore(context.state)}`;
}

function updateOverlay() {
  const overlay = qs('#airplane-overlay');
  if (!overlay) return;
  overlay.classList.toggle('airplane-overlay-hidden', game.running && !game.over);
  const title = overlay.querySelector('strong');
  const copy = overlay.querySelector('p');
  const button = qs('#airplane-start-button');
  if (game.over) {
    if (title) title.textContent = '巡航结束';
    if (copy) copy.textContent = `本次得分 ${game.score}。再来一局，把云层清得更亮一点。`;
    if (button) button.textContent = '再来一局';
  } else {
    if (title) title.textContent = '海风巡航';
    if (copy) copy.textContent = '方向键 / WASD 移动，空格射击；手机上拖动飞机，点开始后会自动开火。';
    if (button) button.textContent = '开始游戏';
  }
}

function isGameViewActive() {
  return document.body.dataset.activeView === 'airplane';
}

function spawnBullet() {
  game.bullets.push({
    x: game.player.x,
    y: game.player.y - 18,
    speed: 360,
    r: 4,
  });
}

function spawnEnemy() {
  const size = 15 + Math.random() * 9;
  game.enemies.push({
    x: 24 + Math.random() * (canvasWidth - 48),
    y: -24,
    r: size,
    speed: 78 + Math.random() * 52 + Math.min(90, game.score * 1.6),
    sway: (Math.random() - 0.5) * 46,
    phase: Math.random() * Math.PI * 2,
  });
}

function spawnCloud() {
  game.clouds.push({
    x: Math.random() * canvasWidth,
    y: -30,
    size: 22 + Math.random() * 24,
    speed: 8 + Math.random() * 14,
  });
}

function movePlayer(dt) {
  const speed = 230;
  let dx = 0;
  let dy = 0;
  if (game.keys.has('arrowleft') || game.keys.has('a')) dx -= 1;
  if (game.keys.has('arrowright') || game.keys.has('d')) dx += 1;
  if (game.keys.has('arrowup') || game.keys.has('w')) dy -= 1;
  if (game.keys.has('arrowdown') || game.keys.has('s')) dy += 1;
  if (dx && dy) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }
  game.player.x = clamp(game.player.x + dx * speed * dt, 20, canvasWidth - 20);
  game.player.y = clamp(game.player.y + dy * speed * dt, 58, canvasHeight - 24);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateGame(dt) {
  movePlayer(dt);

  game.bulletTimer -= dt;
  if (game.bulletTimer <= 0) {
    spawnBullet();
    game.bulletTimer = 0.2;
  }

  game.enemyTimer -= dt;
  if (game.enemyTimer <= 0) {
    spawnEnemy();
    game.enemyTimer = Math.max(0.34, 0.88 - game.score * 0.012);
  }

  game.cloudTimer -= dt;
  if (game.cloudTimer <= 0) {
    spawnCloud();
    game.cloudTimer = 1.4;
  }

  game.bullets.forEach((bullet) => {
    bullet.y -= bullet.speed * dt;
  });
  game.enemies.forEach((enemy) => {
    enemy.phase += dt * 2.2;
    enemy.y += enemy.speed * dt;
    enemy.x += Math.sin(enemy.phase) * enemy.sway * dt;
  });
  game.clouds.forEach((cloud) => {
    cloud.y += cloud.speed * dt;
  });

  for (let enemyIndex = game.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
    const enemy = game.enemies[enemyIndex];
    let hit = false;
    for (let bulletIndex = game.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = game.bullets[bulletIndex];
      if (distance(enemy, bullet) < enemy.r + bullet.r) {
        game.bullets.splice(bulletIndex, 1);
        game.enemies.splice(enemyIndex, 1);
        game.score += 1;
        hit = true;
        break;
      }
    }
    if (hit) continue;
    if (distance(enemy, game.player) < enemy.r + game.player.r) {
      game.enemies.splice(enemyIndex, 1);
      game.lives -= 1;
      if (game.lives <= 0) endGame();
    } else if (enemy.y > canvasHeight + 32) {
      game.enemies.splice(enemyIndex, 1);
      game.lives -= 1;
      if (game.lives <= 0) endGame();
    }
  }

  game.bullets = game.bullets.filter((bullet) => bullet.y > -12);
  game.clouds = game.clouds.filter((cloud) => cloud.y < canvasHeight + 54);
  updateHud();
}

function endGame() {
  game.running = false;
  game.over = true;
  if (context?.state) {
    setBestScore(context.state, game.score);
    context.saveState?.();
  }
  updateHud();
  updateOverlay();
}

function drawPlane(ctx, x, y, scale, color = '#ffffff') {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -22 * scale);
  ctx.lineTo(12 * scale, 12 * scale);
  ctx.lineTo(4 * scale, 8 * scale);
  ctx.lineTo(0, 22 * scale);
  ctx.lineTo(-4 * scale, 8 * scale);
  ctx.lineTo(-12 * scale, 12 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(80, 140, 255, 0.86)';
  ctx.beginPath();
  ctx.ellipse(0, -6 * scale, 4.8 * scale, 8 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, enemy) {
  drawPlane(ctx, enemy.x, enemy.y, 0.78, '#ff5f7f');
  ctx.fillStyle = 'rgba(255, 214, 102, 0.9)';
  ctx.beginPath();
  ctx.arc(enemy.x, enemy.y + 14, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloud(ctx, cloud) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.arc(cloud.x, cloud.y, cloud.size * 0.5, 0, Math.PI * 2);
  ctx.arc(cloud.x + cloud.size * 0.36, cloud.y + 4, cloud.size * 0.38, 0, Math.PI * 2);
  ctx.arc(cloud.x - cloud.size * 0.34, cloud.y + 5, cloud.size * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  const canvas = qs('#airplane-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  gradient.addColorStop(0, '#16295f');
  gradient.addColorStop(0.55, '#2d7bd6');
  gradient.addColorStop(1, '#90d8ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  for (let i = 0; i < 16; i += 1) {
    const y = (i * 44 + performance.now() * 0.018) % canvasHeight;
    ctx.fillRect((i * 53) % canvasWidth, y, 2, 16);
  }

  game.clouds.forEach((cloud) => drawCloud(ctx, cloud));

  ctx.fillStyle = '#ffe86f';
  game.bullets.forEach((bullet) => {
    ctx.fillRect(bullet.x - 2, bullet.y - 10, 4, 14);
  });

  game.enemies.forEach((enemy) => drawEnemy(ctx, enemy));
  drawPlane(ctx, game.player.x, game.player.y, 1, '#ffffff');
}

function tick(now) {
  if (!isGameViewActive()) {
    game.running = false;
    updateOverlay();
    return;
  }
  const dt = Math.min(0.033, (now - game.lastTime) / 1000 || 0);
  game.lastTime = now;
  if (game.running) updateGame(dt);
  draw();
  if (game.running) requestAnimationFrame(tick);
}

function updatePointerPosition(event) {
  const canvas = qs('#airplane-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvasWidth / rect.width);
  const y = (event.clientY - rect.top) * (canvasHeight / rect.height);
  game.player.x = clamp(x, 20, canvasWidth - 20);
  game.player.y = clamp(y, 58, canvasHeight - 24);
}

function bindControls() {
  if (game.initialized) return;
  game.initialized = true;

  document.addEventListener('keydown', (event) => {
    if (!isGameViewActive()) return;
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', ' '].includes(key)) {
      event.preventDefault();
    }
    if (key === ' ' && game.running) spawnBullet();
    game.keys.add(key);
  });

  document.addEventListener('keyup', (event) => {
    game.keys.delete(event.key.toLowerCase());
  });

  const canvas = qs('#airplane-canvas');
  canvas?.addEventListener('pointerdown', (event) => {
    game.pointerActive = true;
    canvas.setPointerCapture?.(event.pointerId);
    updatePointerPosition(event);
  });
  canvas?.addEventListener('pointermove', (event) => {
    if (!game.pointerActive) return;
    updatePointerPosition(event);
  });
  canvas?.addEventListener('pointerup', () => {
    game.pointerActive = false;
  });
  canvas?.addEventListener('pointercancel', () => {
    game.pointerActive = false;
  });
}

export function render({ state, saveState }) {
  context = { state, saveState };
  setBestScore(state, Number(state.airplane?.bestScore || 0));
  updateHud();
  updateOverlay();
  draw();
}

export function bind(nextContext) {
  context = nextContext;
  bindControls();
  qs('#airplane-start-button')?.addEventListener('click', resetGame);
  qs('#airplane-restart-button')?.addEventListener('click', resetGame);
}
