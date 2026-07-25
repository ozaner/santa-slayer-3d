import test from 'node:test';
import assert from 'node:assert/strict';
import { World, v3, SURFACE } from '../src/core/physics.js';
import { PM, createPlayerState, playerMove, applyImpulse, fallDamage } from '../src/core/pmove.js';

const DT = 1 / 120;
const NO = { forward: 0, right: 0, jump: false, crouch: false };

function arena(surface = SURFACE.NORMAL) {
  const w = new World(8);
  w.addBrush(v3(-60, -2, -60), v3(60, 0, 60), surface);
  return w;
}

function sim(w, st, cmd, seconds, hook) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (hook) hook(st, i);
    playerMove(w, st, typeof cmd === 'function' ? cmd(st, i) : cmd, DT);
  }
  return st;
}

test('player falls and comes to rest on the floor', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 6, 0));
  sim(w, st, NO, 3);
  assert.ok(st.onGround, 'should be on the ground');
  assert.ok(Math.abs(st.pos.y) < 0.05, `feet should be at y=0, got ${st.pos.y}`);
  assert.ok(Math.abs(st.vel.y) < 0.01);
});

test('player accelerates to roughly the ground speed cap and no further', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, { ...NO, forward: 1 }, 4);
  assert.ok(st.speed > PM.maxSpeed * 0.97, `too slow: ${st.speed}`);
  assert.ok(st.speed < PM.maxSpeed * 1.02, `exceeded ground cap: ${st.speed}`);
});

test('player stops when input is released', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, { ...NO, forward: 1 }, 2);
  sim(w, st, NO, 2);
  assert.ok(st.speed < 0.2, `should have stopped, speed=${st.speed}`);
});

test('jump reaches a sane height and returns to the ground', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, NO, 0.5);
  let peak = 0;
  sim(w, st, (s, i) => ({ ...NO, jump: i < 4 }), 1.5, (s) => { peak = Math.max(peak, s.pos.y); });
  const expected = (PM.jumpVelocity ** 2) / (2 * PM.gravity);
  assert.ok(Math.abs(peak - expected) < 0.25, `peak ${peak} vs expected ${expected}`);
  assert.ok(st.onGround, 'should have landed again');
});

test('strafe jumping accelerates past the ground speed cap', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  // Build up to walking speed first.
  sim(w, st, { ...NO, forward: 1 }, 1.5);
  const groundSpeed = st.speed;

  // Classic strafe jump: hold jump + strafe right, sweep the view smoothly.
  let t = 0;
  sim(w, st, () => ({ ...NO, right: 1, jump: true }), 6, (s) => {
    t += DT;
    s.yaw -= 1.35 * DT; // turn into the strafe
  });
  assert.ok(st.speed > groundSpeed * 1.4,
    `strafe jumping should gain speed: ${groundSpeed.toFixed(2)} -> ${st.speed.toFixed(2)}`);
});

test('bunny hopping preserves speed instead of bleeding it off', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, { ...NO, forward: 1 }, 2);
  const before = st.speed;
  // Hold jump and forward: friction must be skipped on the jump frames.
  sim(w, st, { ...NO, forward: 1, jump: true }, 3);
  assert.ok(st.speed > before * 0.95, `bhop bled speed: ${before} -> ${st.speed}`);
  assert.ok(st.bhopChain > 2, `should have chained hops, got ${st.bhopChain}`);
});

test('ice is slippery: you keep gliding after releasing the keys', () => {
  const normal = arena(SURFACE.NORMAL);
  const ice = arena(SURFACE.ICE);
  const a = createPlayerState(v3(0, 0.01, 0));
  const b = createPlayerState(v3(0, 0.01, 0));
  sim(normal, a, { ...NO, forward: 1 }, 3);
  sim(ice, b, { ...NO, forward: 1 }, 3);
  sim(normal, a, NO, 0.6);
  sim(ice, b, NO, 0.6);
  assert.ok(b.speed > a.speed + 2, `ice should glide: ice=${b.speed} normal=${a.speed}`);
});

test('the player cannot walk through a wall', () => {
  const w = arena();
  w.addBrush(v3(3, 0, -20), v3(4, 5, 20));
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, { ...NO, forward: 0 }, 0.1);
  st.yaw = -Math.PI / 2; // face +X
  sim(w, st, { ...NO, forward: 1 }, 4);
  assert.ok(st.pos.x < 3, `walked through the wall: x=${st.pos.x}`);
  assert.ok(st.pos.x > 2.3, `should be up against it: x=${st.pos.x}`);
});

test('rocket-jump impulse launches the player upward', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, NO, 0.3);
  applyImpulse(st, 0, 11, 0);
  let peak = 0;
  sim(w, st, NO, 2.5, (s) => { peak = Math.max(peak, s.pos.y); });
  assert.ok(peak > 2.0, `rocket jump should go high, peak=${peak}`);
});

test('crouching lowers the eye height and the speed cap', () => {
  const w = arena();
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, { ...NO, forward: 1, crouch: true }, 3);
  assert.ok(st.crouching);
  assert.ok(st.eye < PM.eyeHeight);
  assert.ok(st.speed < PM.maxSpeedCrouch * 1.05, `crouch speed=${st.speed}`);
});

test('a player under a low ceiling cannot stand up', () => {
  const w = arena();
  w.addBrush(v3(-3, 1.2, -3), v3(3, 2.2, 3)); // ceiling 1.2m above the floor
  const st = createPlayerState(v3(0, 0.01, 0));
  sim(w, st, { ...NO, crouch: true }, 0.5);
  assert.ok(st.crouching);
  sim(w, st, NO, 0.5);
  assert.ok(st.crouching, 'should still be stuck crouching under the ceiling');
});

test('fall damage scales with impact speed', () => {
  assert.equal(fallDamage(10), 0);
  assert.ok(fallDamage(30) > 0);
  assert.equal(fallDamage(100), 100);
  assert.ok(fallDamage(30) < fallDamage(38));
});

test('stepping up a 40cm ledge works while running', () => {
  const w = arena();
  w.addBrush(v3(3, 0, -55), v3(55, 0.4, 55)); // wide platform, no far edge to fall off
  const st = createPlayerState(v3(0, 0.01, 0));
  st.yaw = -Math.PI / 2; // face +X
  sim(w, st, { ...NO, forward: 1 }, 1.5);
  assert.ok(st.pos.x > 4, `should have run up onto the ledge: x=${st.pos.x}`);
  assert.ok(Math.abs(st.pos.y - 0.4) < 0.06, `should be standing on it: y=${st.pos.y}`);
});

test('simulation is stable at a low frame rate', () => {
  const w = arena();
  // Box the arena in so "ran off the edge" cannot masquerade as a physics bug.
  w.addBrush(v3(3, 0, -60), v3(4, 5, 60));
  w.addBrush(v3(-60, 0, -22), v3(60, 6, -20));
  const st = createPlayerState(v3(0, 3, 0));
  for (let i = 0; i < 200; i++) {
    playerMove(w, st, { ...NO, forward: 1, jump: i % 20 === 0 }, 1 / 20);
  }
  assert.ok(Number.isFinite(st.pos.x) && Number.isFinite(st.pos.y) && Number.isFinite(st.pos.z));
  assert.ok(st.pos.y > -1, `fell through the floor: y=${st.pos.y}`);
  assert.ok(st.pos.z > -21, `tunnelled through the far wall at low fps: z=${st.pos.z}`);
});
