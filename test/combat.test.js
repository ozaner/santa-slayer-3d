import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rayCapsule, raySphere, rayAabb, applyArmor, splashFalloff, inFrontCone } from '../src/game/combat.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('ray hits a capsule dead centre at the expected distance', () => {
  const t = rayCapsule(V(0, 1, -10), V(0, 0, 1), V(0, 0, 0), V(0, 1.8, 0), 0.4);
  assert.ok(t > 0, 'should hit');
  assert.ok(Math.abs(t - 9.6) < 0.05, `expected ~9.6, got ${t}`);
});

test('ray misses a capsule it passes beside', () => {
  const t = rayCapsule(V(3, 1, -10), V(0, 0, 1), V(0, 0, 0), V(0, 1.8, 0), 0.4);
  assert.equal(t, -1);
});

test('ray hits the rounded cap above a capsule', () => {
  const t = rayCapsule(V(0, 2.0, -10), V(0, 0, 1), V(0, 0, 0), V(0, 1.8, 0), 0.4);
  assert.ok(t > 0, 'should hit the top cap');
});

test('ray misses above the cap', () => {
  const t = rayCapsule(V(0, 2.5, -10), V(0, 0, 1), V(0, 0, 0), V(0, 1.8, 0), 0.4);
  assert.equal(t, -1);
});

test('ray fired from inside a capsule reports an immediate hit', () => {
  const t = rayCapsule(V(0, 0.9, 0), V(0, 0, 1), V(0, 0, 0), V(0, 1.8, 0), 0.4);
  assert.ok(t >= 0, `expected a hit, got ${t}`);
});

test('a ray pointing away from a capsule does not hit it', () => {
  const t = rayCapsule(V(0, 1, -10), V(0, 0, -1), V(0, 0, 0), V(0, 1.8, 0), 0.4);
  assert.equal(t, -1);
});

test('ray/sphere and ray/box basics', () => {
  assert.ok(Math.abs(raySphere(V(0, 0, -5), V(0, 0, 1), V(0, 0, 0), 1) - 4) < 1e-6);
  assert.equal(raySphere(V(0, 5, -5), V(0, 0, 1), V(0, 0, 0), 1), -1);
  assert.ok(Math.abs(rayAabb(V(0, 0, -5), V(0, 0, 1), V(-1, -1, -1), V(1, 1, 1)) - 4) < 1e-6);
  assert.equal(rayAabb(V(0, 9, -5), V(0, 0, 1), V(-1, -1, -1), V(1, 1, 1)), -1);
});

test('armour soaks two thirds of the damage until it runs out', () => {
  const a = applyArmor(100, 100, 30);
  assert.equal(a.absorbed, 19);
  assert.equal(a.health, 100 - 11);
  assert.equal(a.armor, 81);

  const b = applyArmor(100, 5, 30);
  assert.equal(b.armor, 0);
  assert.equal(b.absorbed, 5);
  assert.equal(b.health, 75);

  const c = applyArmor(100, 0, 30);
  assert.equal(c.health, 70);
});

test('splash damage falls off to nothing at the radius edge', () => {
  assert.equal(splashFalloff(0, 4), 1);
  assert.equal(splashFalloff(4, 4), 0);
  assert.equal(splashFalloff(9, 4), 0);
  assert.ok(splashFalloff(1, 4) > splashFalloff(3, 4));
});

test('front cone identifies attacks from the front but not the back', () => {
  const pos = V(0, 0, 0);
  // Facing +Z (yaw 0 => forward is (sin0, cos0) = (0, 1))
  assert.equal(inFrontCone(pos, 0, V(0, 0, 5), 70), true);
  assert.equal(inFrontCone(pos, 0, V(0, 0, -5), 70), false);
  assert.equal(inFrontCone(pos, 0, V(5, 0, 0), 70), false);
  assert.equal(inFrontCone(pos, 0, V(2, 0, 5), 70), true);
});
