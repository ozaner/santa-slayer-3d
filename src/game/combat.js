/**
 * Shared hit-detection maths: rays against capsules, spheres and boxes, plus
 * the damage bookkeeping used by both the player and the enemies.
 *
 * All of it is allocation-free -- these run once per pellet per enemy per shot.
 */
import * as THREE from 'three';

const _ab = new THREE.Vector3();
const _ao = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _dp = new THREE.Vector3();

/**
 * Ray vs capsule (segment a->b, radius r).
 * Returns the distance along `rd` (which must be normalised) or -1 for a miss.
 */
export function rayCapsule(ro, rd, a, b, r) {
  _ab.subVectors(b, a);
  _ao.subVectors(ro, a);
  const abab = _ab.dot(_ab);
  if (abab < 1e-9) return raySphere(ro, rd, a, r);

  const m = _ab.dot(rd) / abab;   // how fast the projection slides per unit t
  const n = _ab.dot(_ao) / abab;  // where the origin projects onto the axis

  // Components perpendicular to the axis.
  _rp.copy(rd).addScaledVector(_ab, -m);
  _dp.copy(_ao).addScaledVector(_ab, -n);

  const A = _rp.dot(_rp);
  const B = 2 * _dp.dot(_rp);
  const C = _dp.dot(_dp) - r * r;

  let best = -1;
  if (A > 1e-9) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t0 = (-B - sq) / (2 * A);
      const t1 = (-B + sq) / (2 * A);
      for (let i = 0; i < 2; i++) {
        const t = i === 0 ? t0 : t1;
        if (t < 0) continue;
        const y = n + t * m;
        if (y >= 0 && y <= 1 && (best < 0 || t < best)) best = t;
      }
    }
  } else if (C <= 0) {
    // Ray runs parallel to the axis and starts inside the tube.
    best = 0;
  }

  // Hemispherical caps.
  const ta = raySphere(ro, rd, a, r);
  if (ta >= 0 && (best < 0 || ta < best)) best = ta;
  const tb = raySphere(ro, rd, b, r);
  if (tb >= 0 && (best < 0 || tb < best)) best = tb;
  return best;
}

export function raySphere(ro, rd, c, r) {
  _ao.subVectors(ro, c);
  const b = _ao.dot(rd);
  const cc = _ao.dot(_ao) - r * r;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t < 0 ? -1 : t;
}

/** Ray vs axis-aligned box (min/max Vector3). Returns t or -1. */
export function rayAabb(ro, rd, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const ax = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
    const d = rd[ax];
    if (Math.abs(d) < 1e-9) {
      if (ro[ax] < min[ax] || ro[ax] > max[ax]) return -1;
    } else {
      const inv = 1 / d;
      let t1 = (min[ax] - ro[ax]) * inv;
      let t2 = (max[ax] - ro[ax]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/**
 * Quake armour model: armour soaks two thirds of incoming damage while it
 * lasts. Returns the new health/armour and how much the armour ate.
 */
export function applyArmor(health, armor, damage) {
  if (armor <= 0) return { health: health - damage, armor: 0, absorbed: 0 };
  let toArmor = Math.floor(damage * 0.66);
  if (toArmor > armor) toArmor = armor;
  const toHealth = damage - toArmor;
  return { health: health - toHealth, armor: armor - toArmor, absorbed: toArmor };
}

/** Splash falloff: full at the centre, zero at the edge, quadratic between. */
export function splashFalloff(dist, radius) {
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  return t * t;
}

/**
 * True when `point` lies inside a cone of `coneDeg` in front of an entity at
 * `entPos` facing `entYaw`. Drives the shield gingerbread's frontal block.
 */
export function inFrontCone(entPos, entYaw, point, coneDeg) {
  const fx = Math.sin(entYaw);
  const fz = Math.cos(entYaw);
  const dx = point.x - entPos.x;
  const dz = point.z - entPos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return true;
  return (dx / len) * fx + (dz / len) * fz > Math.cos((coneDeg * Math.PI) / 180);
}
