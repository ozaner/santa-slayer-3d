/**
 * Entry point: input, menus, settings and the render loop.
 */
import * as THREE from 'three';
import { View } from './render/view.js';
import { Fx } from './render/fx.js';
import { Audio } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { Game } from './game/game.js';
import { LEVELS } from './game/levels/index.js';
import { buildGibs } from './models/gingerbread.js';
import { buildSanta } from './models/santa.js';
import { cloneRig } from './models/rig.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const DEFAULTS = { sens: 2.0, fov: 95, vol: 0.7, music: 0.4, quality: 'high', bob: 1 };
const settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem('santaslayer.settings');
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try { localStorage.setItem('santaslayer.settings', JSON.stringify(settings)); } catch { /* private mode */ }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const view = new View(canvas);
const fx = new Fx(view.scene);
const audio = new Audio();
const hud = new Hud();

const input = {
  forward: 0, right: 0, jump: false, crouch: false, fire: false,
  keys: new Set(),
};

const game = new Game({ view, fx, audio, hud, input });
addEventListener('resize', () => fx.setViewportHeight(canvas.clientHeight || innerHeight));
fx.setViewportHeight(canvas.clientHeight || innerHeight);

let uiState = 'loading';
let pointerLocked = false;

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

function setLoading(p, text) {
  $('loading-fill').style.width = Math.round(p * 100) + '%';
  if (text) $('loading-text').textContent = text;
}

/**
 * Yield long enough for the loading bar to paint. Backgrounded tabs stop
 * servicing requestAnimationFrame entirely, so race it against a timer --
 * otherwise tabbing away mid-load wedges the loader forever.
 */
async function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });
}

async function boot() {
  setLoading(0.05, 'BAKING GINGERBREAD…');
  await nextFrame();

  view.setQuality(settings.quality);
  view.setFov(settings.fov);
  game.viewBobEnabled = !!settings.bob;

  setLoading(0.2, 'CARVING SHARDS…');
  await nextFrame();
  const gibs = buildGibs();
  fx.initDebris(gibs.chunks, gibs.crumbMaterial);

  setLoading(0.35, 'FORGING WEAPONS…');
  await nextFrame();
  // Warm the weapon viewmodels so the first weapon switch does not hitch.
  for (const id of ['chaingun', 'shotgun', 'launcher', 'rail']) game.weapons._model(id);

  setLoading(0.55, 'LETTING IT SNOW…');
  await nextFrame();
  fx.createSnowfall({ count: settings.quality === 'low' ? 1100 : 2600, box: 64, speed: 2.4 });

  setLoading(0.75, 'DRESSING SANTA…');
  await nextFrame();
  buildMenuScene();

  setLoading(1, 'READY');
  await nextFrame();
  await new Promise((r) => setTimeout(r, 220));
  $('loading').classList.add('hidden');
  showScreen('menu');
}

/* ------------------------------------------------------------------ */
/* Menu backdrop: a slowly turning Santa                               */
/* ------------------------------------------------------------------ */

let menuScene = null;
let menuCamera = null;
let menuSanta = null;
const _menuSize = new THREE.Vector2();

function buildMenuScene() {
  menuScene = new THREE.Scene();
  // Framed as a character portrait: Santa fills the right third of a wide
  // screen, leaving the left for the menu panel. On narrow screens the panel
  // centres over him instead (see the media query in index.html).
  menuCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  menuCamera.position.set(0.75, 1.5, 3.9);
  menuCamera.lookAt(-1.05, 0.98, 0);

  menuSanta = cloneRig(buildSanta());
  menuSanta.position.set(0, 0, 0);
  menuScene.add(menuSanta);

  // Three-point lighting so the hero model actually reads.
  const key = new THREE.DirectionalLight(0xfff2e0, 3.2);
  key.position.set(3, 5, 5);
  menuScene.add(key);
  const rimA = new THREE.DirectionalLight(0x6aa8ff, 2.6);
  rimA.position.set(-4, 3, -4);
  menuScene.add(rimA);
  const rimB = new THREE.DirectionalLight(0xff8a4a, 1.6);
  rimB.position.set(4, 1.5, -4);
  menuScene.add(rimB);
  menuScene.add(new THREE.HemisphereLight(0x8fb8ff, 0x241a2a, 0.7));

  // A ground disc catching a soft blob shadow.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshBasicMaterial({ color: 0x0a0f22, transparent: true, opacity: 0.55 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.001;
  menuScene.add(disc);
}

function renderMenu(t, dt) {
  if (!menuSanta) return;
  menuSanta.rotation.y = Math.sin(t * 0.28) * 0.7 + 0.25;
  const parts = menuSanta.userData.parts || {};
  // Idle breathing and a lazy weapon-hand sway.
  if (parts.torso) parts.torso.rotation.z = Math.sin(t * 0.9) * 0.02;
  if (parts.head) {
    parts.head.rotation.y = Math.sin(t * 0.42) * 0.22;
    parts.head.rotation.x = Math.sin(t * 0.6) * 0.05;
  }
  if (parts.armR) parts.armR.rotation.x = -0.1 + Math.sin(t * 0.75) * 0.07;
  if (parts.armL) parts.armL.rotation.x = -0.1 + Math.sin(t * 0.75 + 1.2) * 0.07;
  if (parts.hat) parts.hat.rotation.z = Math.sin(t * 1.1) * 0.05;

  // Take the aspect from the renderer's own drawing buffer -- the DOM size can
  // be 0 while the canvas is offscreen, which would make this NaN.
  view.renderer.getSize(_menuSize);
  menuCamera.aspect = Math.max(0.1, _menuSize.x) / Math.max(0.1, _menuSize.y);
  menuCamera.updateProjectionMatrix();

  const r = view.renderer;
  r.setRenderTarget(null);
  r.setClearColor(0x05070f, 1);
  r.clear();
  r.render(menuScene, menuCamera);
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

const SCREENS = ['menu', 'levels', 'settings', 'pause', 'gameover', 'victory'];

function showScreen(name) {
  uiState = name;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  hud.show(name === null || name === 'hud');
  if (name && name !== 'hud') document.exitPointerLock?.();
}

function enterGame() {
  uiState = 'hud';
  for (const s of SCREENS) $(s).classList.add('hidden');
  hud.show(true);
  canvas.requestPointerLock?.();
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch', ShiftLeft: 'crouch',
};

function refreshMoveAxes() {
  const k = input.keys;
  input.forward = (k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0);
  input.right = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
  input.jump = k.has('jump');
  input.crouch = k.has('crouch');
}

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (uiState === 'hud') pauseGame();
    else if (uiState === 'pause') resumeGame();
    else if (uiState === 'settings' || uiState === 'levels') showScreen(settingsReturn);
    return;
  }
  if (e.repeat) return;

  if (uiState === 'hud') {
    const m = KEYMAP[e.code];
    if (m) { e.preventDefault(); input.keys.add(m); refreshMoveAxes(); return; }
    if (e.code >= 'Digit1' && e.code <= 'Digit4') {
      game.weapons.selectBySlot(Number(e.code.slice(5)));
      return;
    }
    if (e.code === 'KeyQ') { game.weapons.cycle(-1); return; }
    if (e.code === 'KeyE') { game.weapons.cycle(1); return; }
    if (e.code === 'KeyR') { game.weapons.autoSwitchIfEmpty(); return; }
  }
  if (uiState === 'gameover' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    retry();
  }
  if (uiState === 'victory' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    nextLevel();
  }
});

addEventListener('keyup', (e) => {
  const m = KEYMAP[e.code];
  if (m) { input.keys.delete(m); refreshMoveAxes(); }
});

addEventListener('blur', () => {
  input.keys.clear();
  refreshMoveAxes();
  input.fire = false;
  if (uiState === 'hud') pauseGame();
});

canvas.addEventListener('mousedown', (e) => {
  if (uiState !== 'hud') return;
  if (e.button === 0) input.fire = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });

canvas.addEventListener('click', () => {
  if (uiState === 'hud' && !pointerLocked) canvas.requestPointerLock?.();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && uiState === 'hud' && game.state === 'playing') pauseGame();
});

addEventListener('mousemove', (e) => {
  if (!pointerLocked || uiState !== 'hud') return;
  game.addLook(e.movementX, e.movementY, settings.sens);
});

addEventListener('wheel', (e) => {
  if (uiState !== 'hud') return;
  game.weapons.cycle(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

addEventListener('contextmenu', (e) => { if (uiState === 'hud') e.preventDefault(); });

/* ------------------------------------------------------------------ */
/* Flow                                                                */
/* ------------------------------------------------------------------ */

let settingsReturn = 'menu';

function startLevel(index) {
  audio.init();
  const fade = $('fade');
  fade.classList.add('on');
  setTimeout(() => {
    game.loadLevel(index);
    game.state = 'playing';
    game.startTime = performance.now();
    enterGame();
    hud.centerMessage(LEVELS[index].title, LEVELS[index].subtitle, '#ffd24a', 3000);
    audio.startMusic();
    fade.classList.remove('on');
  }, 380);
}

function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  input.keys.clear();
  refreshMoveAxes();
  input.fire = false;
  showScreen('pause');
}

function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  enterGame();
}

function retry() {
  const fade = $('fade');
  fade.classList.add('on');
  setTimeout(() => {
    game.restartLevel();
    enterGame();
    audio.startMusic();
    fade.classList.remove('on');
  }, 380);
}

function nextLevel() {
  const next = game.levelIndex + 1;
  if (next >= LEVELS.length) {
    showCredits();
    return;
  }
  startLevel(next);
}

function showCredits() {
  $('victory-title').textContent = 'CHRISTMAS IS SAVED';
  $('victory-sub').textContent = 'Every gingerbread man in the North Pole is crumbs. Well done.';
  $('btn-next').textContent = 'BACK TO MENU';
  $('btn-next').onclick = () => { showScreen('menu'); resetVictoryButton(); };
  showScreen('victory');
}

function resetVictoryButton() {
  $('btn-next').textContent = 'NEXT LEVEL';
  $('btn-next').onclick = nextLevel;
}

game.onDeath = () => {
  setTimeout(() => {
    if (game.state !== 'dead') return;
    $('death-cause').textContent = deathLine(game.deathCause);
    $('death-stats').innerHTML = statCells([
      ['KILLS', game.kills],
      ['SCORE', game.score.toLocaleString()],
      ['WAVE', `${game.wave}/${game.totalWaves}`],
      ['ACCURACY', game.accuracy + '%'],
    ]);
    showScreen('gameover');
  }, 2400);
};

game.onVictory = () => {
  const secs = Math.floor(game.elapsed);
  $('victory-title').textContent = 'LEVEL CLEAR';
  $('victory-sub').textContent = LEVELS[game.levelIndex].id === 'yard'
    ? 'The Golem is a pile of crumbs.'
    : 'The village is safe. For now.';
  $('victory-stats').innerHTML = statCells([
    ['KILLS', game.kills],
    ['SCORE', game.score.toLocaleString()],
    ['TIME', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['ACCURACY', game.accuracy + '%'],
    ['DEATHS', game.deaths],
  ]);
  resetVictoryButton();
  if (game.levelIndex + 1 >= LEVELS.length) {
    $('btn-next').textContent = 'FINISH';
    $('btn-next').onclick = showCredits;
  }
  setTimeout(() => showScreen('victory'), 1300);
};

function statCells(pairs) {
  return pairs.map(([k, v]) => `<div class="cell"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

function deathLine(cause) {
  const lines = {
    grunt: 'A gingerbread grunt got its hands on you.',
    sword: 'Filleted by a candy-cane sabre.',
    shield: 'Flattened by a gumdrop bulwark.',
    snowman: 'Buried under a barrage of snowballs.',
    golem: 'The Golem stepped on you.',
    snowball: 'Buried under a barrage of snowballs.',
    'rocket jump': 'You rocket-jumped straight into the afterlife.',
    'the abyss': 'You fell off the edge of Christmas.',
    'a nasty landing': 'Terminal velocity is not a gift.',
    'the freezing water': 'Frozen solid.',
  };
  return lines[cause] || 'The gingerbread got you.';
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

$('btn-play').onclick = () => startLevel(0);
$('btn-levels').onclick = () => { settingsReturn = 'menu'; buildLevelList(); showScreen('levels'); };
$('btn-levels-back').onclick = () => showScreen('menu');
$('btn-settings').onclick = () => { settingsReturn = 'menu'; showScreen('settings'); };
$('btn-pause-settings').onclick = () => { settingsReturn = 'pause'; showScreen('settings'); };
$('btn-settings-back').onclick = () => showScreen(settingsReturn);
$('btn-resume').onclick = resumeGame;
$('btn-restart').onclick = retry;
$('btn-quit').onclick = () => { game.state = 'menu'; game.unloadLevel(); audio.stopMusic(); showScreen('menu'); };
$('btn-retry').onclick = retry;
$('btn-death-quit').onclick = () => { game.state = 'menu'; game.unloadLevel(); audio.stopMusic(); showScreen('menu'); };
$('btn-next').onclick = nextLevel;
$('btn-victory-quit').onclick = () => { game.state = 'menu'; game.unloadLevel(); audio.stopMusic(); showScreen('menu'); };

function buildLevelList() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' primary' : '');
    b.innerHTML = `${l.title}<div style="font-size:11px;letter-spacing:.1em;opacity:.6;font-weight:600;margin-top:5px">${l.subtitle}</div>`;
    b.onclick = () => startLevel(i);
    list.appendChild(b);
  });
}

/* ------------------------------------------------------------------ */
/* Settings wiring                                                     */
/* ------------------------------------------------------------------ */

function bindRange(id, valId, key, fmt, apply) {
  const el = $(id);
  el.value = settings[key];
  $(valId).textContent = fmt(settings[key]);
  el.oninput = () => {
    settings[key] = Number(el.value);
    $(valId).textContent = fmt(settings[key]);
    apply?.(settings[key]);
    saveSettings();
  };
}

bindRange('set-sens', 'val-sens', 'sens', (v) => v.toFixed(1));
bindRange('set-fov', 'val-fov', 'fov', (v) => String(Math.round(v)), (v) => view.setFov(v));
bindRange('set-vol', 'val-vol', 'vol', (v) => Math.round(v * 100) + '%',
  () => audio.setVolume(settings.vol, 0.85, settings.music));
bindRange('set-music', 'val-music', 'music', (v) => Math.round(v * 100) + '%',
  () => audio.setVolume(settings.vol, 0.85, settings.music));

for (const b of $('set-quality').querySelectorAll('button')) {
  b.classList.toggle('on', b.dataset.q === settings.quality);
  b.onclick = () => {
    settings.quality = b.dataset.q;
    for (const o of $('set-quality').querySelectorAll('button')) o.classList.toggle('on', o === b);
    view.setQuality(settings.quality);
    saveSettings();
  };
}
for (const b of $('set-bob').querySelectorAll('button')) {
  b.classList.toggle('on', Number(b.dataset.b) === settings.bob);
  b.onclick = () => {
    settings.bob = Number(b.dataset.b);
    for (const o of $('set-bob').querySelectorAll('button')) o.classList.toggle('on', o === b);
    game.viewBobEnabled = !!settings.bob;
    saveSettings();
  };
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

let last = performance.now();
let frames = 0;
let fpsTime = 0;
game.fps = 0;
const _fwdTmp = new THREE.Vector3();

/** One simulation + render step. Separated from rAF so it can be driven. */
function tick(dt, t) {
  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) { game.fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }

  if (uiState === 'loading') return;

  if (game.state === 'menu' || (!game.level && game.state !== 'playing')) {
    renderMenu(t, dt);
    return;
  }

  game.update(dt);

  const cam = view.camera;
  cam.getWorldDirection(_fwdTmp);
  audio.setListener(cam.position, _fwdTmp);

  view.render(t);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt, now / 1000);
}

/**
 * Debug/automation handle. Exposed deliberately: it is how the game gets
 * driven and screenshotted from a browser console or a test script.
 */
window.SS = {
  game, view, fx, audio, hud, input, settings, THREE, LEVELS,
  tick,
  startLevel, pauseGame, resumeGame, showScreen,
  get uiState() { return uiState; },
  set uiState(v) { uiState = v; },
  /** Run `n` steps of fixed dt without waiting for rAF. */
  run(n = 60, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      last += dt * 1000;
      tick(dt, last / 1000);
    }
  },
  /** Simulate without rendering -- much faster for logic-only assertions. */
  sim(n = 60, dt = 1 / 60) {
    for (let i = 0; i < n; i++) game.update(dt);
  },
  /** Capture the canvas to /shots/<name>.png via the dev-server endpoint. */
  async shot(name) {
    tick(1 / 60, performance.now() / 1000); // render fresh in this same task
    const data = canvas.toDataURL('image/png');
    const res = await fetch('/__shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    return res.json();
  },
};

requestAnimationFrame(frame);
boot();
