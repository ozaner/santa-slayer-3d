import test from 'node:test';
import assert from 'node:assert/strict';
import {
  World, v3, traceBox, traceRay, slideMove, stepSlideMove, groundTrace,
  clipVelocity, vdot, SURFACE,
} from '../src/core/physics.js';

function floorWorld() {
  const w = new World(8);
  w.addBrush(v3(-50, -1, -50), v3(50, 0, 50)); // ground, top at y=0
  return w;
}

test('trace hits a floor from above with an up normal', () => {
  const w = floorWorld();
  const half = v3(0.4, 0.9, 0.4);
  const tr = traceBox(w, v3(0, 5, 0), v3(0, 0.5, 0), half);
  assert.equal(tr.hit, true);
  assert.ok(tr.normal.y > 0.99, `normal.y=${tr.normal.y}`);
  // Contact when the box bottom touches y=0 => centre y = 0.9
  assert.ok(Math.abs(tr.end.y - 0.9) < 0.02, `end.y=${tr.end.y}`);
});

test('trace misses when nothing is in the way', () => {
  const w = floorWorld();
  const tr = traceBox(w, v3(0, 5, 0), v3(0, 4, 0), v3(0.4, 0.9, 0.4));
  assert.equal(tr.hit, false);
  assert.equal(tr.fraction, 1);
  assert.equal(tr.end.y, 4);
});

test('trace reports startSolid when already inside a brush', () => {
  const w = floorWorld();
  const tr = traceBox(w, v3(0, -0.5, 0), v3(0, -0.4, 0), v3(0.1, 0.1, 0.1));
  assert.equal(tr.startSolid, true);
  assert.equal(tr.fraction, 0);
});

test('ray trace finds a wall and its normal', () => {
  const w = floorWorld();
  w.addBrush(v3(4, 0, -5), v3(5, 6, 5)); // wall, near face at x=4
  const tr = traceRay(w, v3(0, 2, 0), v3(10, 2, 0));
  assert.equal(tr.hit, true);
  assert.ok(Math.abs(tr.normal.x + 1) < 1e-6, `normal.x=${tr.normal.x}`);
  assert.ok(Math.abs(tr.end.x - 4) < 0.02, `end.x=${tr.end.x}`);
});

test('clipVelocity removes the component into the plane', () => {
  const out = v3();
  clipVelocity(out, v3(1, -1, 0), v3(0, 1, 0));
  assert.ok(Math.abs(out.y) < 0.01, `y=${out.y}`);
  assert.ok(Math.abs(out.x - 1) < 0.01);
});

test('slideMove slides along a wall instead of stopping dead', () => {
  const w = floorWorld();
  w.addBrush(v3(2, 0, -20), v3(3, 6, 20)); // wall facing -X at x=2
  const pos = v3(0, 1, 0);
  const vel = v3(10, 0, 6); // into the wall and along it
  slideMove(w, pos, vel, v3(0.4, 0.9, 0.4), 0.5);
  assert.ok(pos.x < 2, `should not pass wall, x=${pos.x}`);
  assert.ok(pos.z > 0.3, `should still slide along Z, z=${pos.z}`);
  assert.ok(Math.abs(vel.x) < 0.5, `x velocity killed, got ${vel.x}`);
  assert.ok(vel.z > 5, `z velocity preserved, got ${vel.z}`);
});

test('a fast box never tunnels through a thin wall', () => {
  const w = floorWorld();
  w.addBrush(v3(5, 0, -20), v3(5.2, 6, 20)); // 20cm thin wall
  const pos = v3(0, 1, 0);
  const vel = v3(400, 0, 0); // absurd speed
  slideMove(w, pos, vel, v3(0.4, 0.9, 0.4), 0.1);
  assert.ok(pos.x < 5, `tunnelled through: x=${pos.x}`);
});

test('stepSlideMove climbs a low step but not a high wall', () => {
  const w = floorWorld();
  w.addBrush(v3(2, 0, -20), v3(6, 0.4, 20)); // 40cm step
  const pos = v3(0, 0.91, 0); // centre of a 1.82 tall box resting on y=0
  const vel = v3(6, 0, 0);
  for (let i = 0; i < 60; i++) stepSlideMove(w, pos, vel, v3(0.4, 0.91, 0.4), 1 / 60, 0.5, true);
  assert.ok(pos.x > 2.5, `should have climbed onto the step, x=${pos.x}`);
  assert.ok(Math.abs(pos.y - (0.4 + 0.91)) < 0.05, `should be standing on the step, y=${pos.y}`);

  const w2 = floorWorld();
  w2.addBrush(v3(2, 0, -20), v3(6, 1.5, 20)); // 1.5m wall, too high
  const pos2 = v3(0, 0.91, 0);
  const vel2 = v3(6, 0, 0);
  for (let i = 0; i < 60; i++) stepSlideMove(w2, pos2, vel2, v3(0.4, 0.91, 0.4), 1 / 60, 0.5, true);
  assert.ok(pos2.x < 2, `should be blocked by the tall wall, x=${pos2.x}`);
});

test('groundTrace detects ground within the probe distance', () => {
  const w = floorWorld();
  const near = groundTrace(w, v3(0, 0.905, 0), v3(0.4, 0.9, 0.4), 0.08);
  assert.equal(near.hit, true);
  const far = groundTrace(w, v3(0, 3, 0), v3(0.4, 0.9, 0.4), 0.08);
  assert.equal(far.hit, false);
});

test('surface flags survive on the brush returned by a trace', () => {
  const w = new World(8);
  w.addBrush(v3(-10, -1, -10), v3(10, 0, 10), SURFACE.ICE);
  const tr = groundTrace(w, v3(0, 0.905, 0), v3(0.4, 0.9, 0.4), 0.08);
  assert.equal(tr.brush.surface, SURFACE.ICE);
});

test('spatial hash returns every overlapping brush exactly once', () => {
  const w = new World(4);
  // One long brush spanning many cells.
  w.addBrush(v3(-20, 0, -1), v3(20, 1, 1));
  const hits = w.query(v3(-20, -1, -2), v3(20, 2, 2));
  assert.equal(hits.length, 1);
});
