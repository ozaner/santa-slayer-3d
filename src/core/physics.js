/**
 * Collision world and swept-AABB tracing.
 *
 * Deliberately dependency-free (no three.js) and purely numeric so the whole
 * thing runs under `node --test`. Anything with `.x/.y/.z` works as a vector,
 * which means THREE.Vector3 can be passed straight in.
 *
 * The world is a set of axis-aligned brushes in a uniform spatial hash. That
 * is all Quake-style movement really needs: box traces, plane clipping and
 * stair stepping.
 */

export const EPS = 1e-3;
/** How far we stay off a surface after a trace, to avoid re-colliding. */
export const SKIN = 0.008;

export const SURFACE = {
  NORMAL: 0,
  ICE: 1, // near-frictionless
  BOUNCE: 2, // trampoline snow
  HURT: 4, // damage volume
  NOCLIP_ENEMY: 8, // player-only clip (invisible enemy fences)
};

/* ------------------------------------------------------------------ */
/* Vector helpers (operate on {x,y,z})                                 */
/* ------------------------------------------------------------------ */

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vcopy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const vset = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; };
export const vadd = (o, a, b) => vset(o, a.x + b.x, a.y + b.y, a.z + b.z);
export const vsub = (o, a, b) => vset(o, a.x - b.x, a.y - b.y, a.z - b.z);
export const vscale = (o, a, s) => vset(o, a.x * s, a.y * s, a.z * s);
export const vmadd = (o, a, b, s) => vset(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a) => Math.hypot(a.x, a.y, a.z);
export const vlenSq = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vdistSq = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};
export function vnorm(o, a = o) {
  const l = vlen(a);
  if (l < 1e-9) return vset(o, 0, 0, 0);
  return vset(o, a.x / l, a.y / l, a.z / l);
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Slide a velocity along a plane, Quake style.
 * `overbounce` slightly over-corrects so we never creep into the plane.
 */
export function clipVelocity(out, vel, normal, overbounce = 1.001) {
  let backoff = vdot(vel, normal);
  backoff *= backoff < 0 ? overbounce : 1 / overbounce;
  return vset(out, vel.x - normal.x * backoff, vel.y - normal.y * backoff, vel.z - normal.z * backoff);
}

/* ------------------------------------------------------------------ */
/* Brushes and the spatial hash                                        */
/* ------------------------------------------------------------------ */

let brushId = 0;

export class Brush {
  constructor(min, max, surface = SURFACE.NORMAL, meta = null) {
    this.id = brushId++;
    this.min = vcopy(min);
    this.max = vcopy(max);
    this.surface = surface;
    this.meta = meta;
  }
  get center() {
    return v3((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
  }
}

export class World {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.brushes = [];
    this.grid = new Map();
    this.bounds = { min: v3(Infinity, Infinity, Infinity), max: v3(-Infinity, -Infinity, -Infinity) };
    this._mark = new Map(); // brush id -> query stamp
    this._stamp = 0;
  }

  /** Add a box brush from min/max corners. */
  addBrush(min, max, surface = SURFACE.NORMAL, meta = null) {
    const b = new Brush(min, max, surface, meta);
    this.brushes.push(b);
    this._index(b);
    const bd = this.bounds;
    bd.min.x = Math.min(bd.min.x, b.min.x); bd.min.y = Math.min(bd.min.y, b.min.y); bd.min.z = Math.min(bd.min.z, b.min.z);
    bd.max.x = Math.max(bd.max.x, b.max.x); bd.max.y = Math.max(bd.max.y, b.max.y); bd.max.z = Math.max(bd.max.z, b.max.z);
    return b;
  }

  /** Add a box brush from a centre + full size. */
  addBox(cx, cy, cz, sx, sy, sz, surface = SURFACE.NORMAL, meta = null) {
    return this.addBrush(
      v3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      v3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
      surface, meta,
    );
  }

  _key(ix, iy, iz) {
    return ix * 73856093 ^ iy * 19349663 ^ iz * 83492791;
  }

  _index(b) {
    const cs = this.cellSize;
    const x0 = Math.floor(b.min.x / cs), x1 = Math.floor(b.max.x / cs);
    const y0 = Math.floor(b.min.y / cs), y1 = Math.floor(b.max.y / cs);
    const z0 = Math.floor(b.min.z / cs), z1 = Math.floor(b.max.z / cs);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const k = this._key(x, y, z);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(b);
        }
      }
    }
  }

  /** Collect brushes overlapping an AABB. Results are deduplicated. */
  query(min, max, out = []) {
    out.length = 0;
    const cs = this.cellSize;
    const stamp = ++this._stamp;
    const x0 = Math.floor(min.x / cs), x1 = Math.floor(max.x / cs);
    const y0 = Math.floor(min.y / cs), y1 = Math.floor(max.y / cs);
    const z0 = Math.floor(min.z / cs), z1 = Math.floor(max.z / cs);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const list = this.grid.get(this._key(x, y, z));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (this._mark.get(b.id) === stamp) continue;
            this._mark.set(b.id, stamp);
            // exact AABB overlap test (the hash is conservative)
            if (b.max.x < min.x || b.min.x > max.x) continue;
            if (b.max.y < min.y || b.min.y > max.y) continue;
            if (b.max.z < min.z || b.min.z > max.z) continue;
            out.push(b);
          }
        }
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Traces                                                              */
/* ------------------------------------------------------------------ */

/**
 * Result object reused by traces to keep the hot path allocation free when a
 * caller passes one in.
 */
export function makeTrace() {
  return {
    fraction: 1,
    end: v3(),
    normal: v3(),
    brush: null,
    startSolid: false,
    hit: false,
  };
}

const _qbuf = [];

/**
 * Swept AABB against the static world.
 *
 * @param {World} world
 * @param {{x,y,z}} start  centre of the moving box at t=0
 * @param {{x,y,z}} end    centre of the moving box at t=1
 * @param {{x,y,z}} half   half-extents of the moving box
 * @param {(b:Brush)=>boolean} [filter] return false to ignore a brush
 */
export function traceBox(world, start, end, half, filter = null, out = makeTrace()) {
  out.fraction = 1;
  out.brush = null;
  out.startSolid = false;
  out.hit = false;
  vset(out.normal, 0, 0, 0);
  vcopyInto(out.end, end);

  // Sweep bounds, expanded by the box half extents.
  const qmin = v3(
    Math.min(start.x, end.x) - half.x - 0.1,
    Math.min(start.y, end.y) - half.y - 0.1,
    Math.min(start.z, end.z) - half.z - 0.1,
  );
  const qmax = v3(
    Math.max(start.x, end.x) + half.x + 0.1,
    Math.max(start.y, end.y) + half.y + 0.1,
    Math.max(start.z, end.z) + half.z + 0.1,
  );
  const brushes = world.query(qmin, qmax, _qbuf);
  if (brushes.length === 0) return out;

  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;

  for (let i = 0; i < brushes.length; i++) {
    const b = brushes[i];
    if (filter && !filter(b)) continue;

    // Minkowski sum: expand the brush by the moving box, sweep a point.
    const minx = b.min.x - half.x, maxx = b.max.x + half.x;
    const miny = b.min.y - half.y, maxy = b.max.y + half.y;
    const minz = b.min.z - half.z, maxz = b.max.z + half.z;

    // Already inside?
    if (start.x > minx && start.x < maxx && start.y > miny && start.y < maxy && start.z > minz && start.z < maxz) {
      out.startSolid = true;
      out.hit = true;
      out.fraction = 0;
      out.brush = b;
      // Push out along the shallowest axis so callers can recover.
      const px = Math.min(start.x - minx, maxx - start.x);
      const py = Math.min(start.y - miny, maxy - start.y);
      const pz = Math.min(start.z - minz, maxz - start.z);
      if (py <= px && py <= pz) vset(out.normal, 0, start.y - (miny + maxy) / 2 > 0 ? 1 : -1, 0);
      else if (px <= pz) vset(out.normal, start.x - (minx + maxx) / 2 > 0 ? 1 : -1, 0, 0);
      else vset(out.normal, 0, 0, start.z - (minz + maxz) / 2 > 0 ? 1 : -1);
      vcopyInto(out.end, start);
      return out;
    }

    // Slab test.
    let tmin = 0, tmax = out.fraction;
    let nx = 0, ny = 0, nz = 0;

    // X
    if (Math.abs(dx) < 1e-12) {
      if (start.x <= minx || start.x >= maxx) continue;
    } else {
      const inv = 1 / dx;
      let t1 = (minx - start.x) * inv;
      let t2 = (maxx - start.x) * inv;
      let sign = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
      if (t1 >= tmin) { tmin = t1; nx = sign; ny = 0; nz = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Y
    if (Math.abs(dy) < 1e-12) {
      if (start.y <= miny || start.y >= maxy) continue;
    } else {
      const inv = 1 / dy;
      let t1 = (miny - start.y) * inv;
      let t2 = (maxy - start.y) * inv;
      let sign = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
      if (t1 >= tmin) { tmin = t1; nx = 0; ny = sign; nz = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Z
    if (Math.abs(dz) < 1e-12) {
      if (start.z <= minz || start.z >= maxz) continue;
    } else {
      const inv = 1 / dz;
      let t1 = (minz - start.z) * inv;
      let t2 = (maxz - start.z) * inv;
      let sign = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
      if (t1 >= tmin) { tmin = t1; ny = 0; nx = 0; nz = sign; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }

    if (tmin < out.fraction && tmin >= 0 && (nx || ny || nz)) {
      out.fraction = tmin;
      vset(out.normal, nx, ny, nz);
      out.brush = b;
      out.hit = true;
    }
  }

  if (out.hit && !out.startSolid) {
    // Back off along the surface normal so we rest just outside the plane.
    const f = Math.max(0, out.fraction);
    vset(out.end,
      start.x + dx * f + out.normal.x * SKIN,
      start.y + dy * f + out.normal.y * SKIN,
      start.z + dz * f + out.normal.z * SKIN);
  }
  return out;
}

function vcopyInto(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }

/** Point/ray trace against the world. Same result shape as traceBox. */
export function traceRay(world, start, end, filter = null, out = makeTrace()) {
  return traceBox(world, start, end, ZERO_HALF, filter, out);
}
const ZERO_HALF = v3(0, 0, 0);

/**
 * Quake's PM_SlideMove: move, clip against up to 5 planes, keep sliding.
 * Mutates `pos` and `vel`. Returns a bitmask: 1 = blocked by a wall,
 * 2 = blocked by a floor.
 */
const _planes = [v3(), v3(), v3(), v3(), v3()];
const _tr = makeTrace();
const _endPos = v3();
const _origVel = v3();
const _clipVel = v3();
const _cross = v3();

export function slideMove(world, pos, vel, half, dt, filter = null, groundNormalOut = null) {
  let blocked = 0;
  let numPlanes = 0;
  let timeLeft = dt;
  vcopyInto(_origVel, vel);

  for (let bump = 0; bump < 5; bump++) {
    if (timeLeft <= 0) break;
    vset(_endPos, pos.x + vel.x * timeLeft, pos.y + vel.y * timeLeft, pos.z + vel.z * timeLeft);
    traceBox(world, pos, _endPos, half, filter, _tr);

    if (_tr.startSolid) {
      // Nudge out of the wall and try again next frame rather than freezing.
      pos.x += _tr.normal.x * 0.05;
      pos.y += _tr.normal.y * 0.05;
      pos.z += _tr.normal.z * 0.05;
      blocked |= 1;
      break;
    }

    if (_tr.fraction > 0) {
      pos.x = _tr.end.x; pos.y = _tr.end.y; pos.z = _tr.end.z;
    }
    if (!_tr.hit) break;

    timeLeft -= timeLeft * _tr.fraction;

    if (_tr.normal.y > 0.7) {
      blocked |= 2;
      if (groundNormalOut) vcopyInto(groundNormalOut, _tr.normal);
    } else if (Math.abs(_tr.normal.y) < 0.7) {
      blocked |= 1;
    }

    if (numPlanes >= 5) { vset(vel, 0, 0, 0); break; }

    // Duplicate plane? nudge along it.
    let dup = false;
    for (let i = 0; i < numPlanes; i++) {
      if (vdot(_tr.normal, _planes[i]) > 0.99) {
        vmadd(vel, vel, _tr.normal, 1);
        dup = true;
        break;
      }
    }
    if (dup) continue;

    vcopyInto(_planes[numPlanes], _tr.normal);
    numPlanes++;

    // Try clipping against each plane in turn.
    let resolved = false;
    for (let i = 0; i < numPlanes; i++) {
      if (vdot(vel, _planes[i]) >= 0.1) continue;
      clipVelocity(_clipVel, vel, _planes[i]);
      // Does the clipped velocity now violate another plane?
      let ok = true;
      for (let j = 0; j < numPlanes; j++) {
        if (j === i) continue;
        if (vdot(_clipVel, _planes[j]) < 0) { ok = false; break; }
      }
      if (ok) {
        vcopyInto(vel, _clipVel);
        resolved = true;
        break;
      }
      // Slide along the crease of the two planes.
      for (let j = 0; j < numPlanes; j++) {
        if (j === i) continue;
        if (vdot(vel, _planes[j]) >= 0.1) continue;
        vset(_cross,
          _planes[i].y * _planes[j].z - _planes[i].z * _planes[j].y,
          _planes[i].z * _planes[j].x - _planes[i].x * _planes[j].z,
          _planes[i].x * _planes[j].y - _planes[i].y * _planes[j].x);
        vnorm(_cross);
        const d = vdot(_cross, vel);
        vscale(vel, _cross, d);
        resolved = true;
        break;
      }
      if (resolved) break;
    }
    if (!resolved) {
      vset(vel, 0, 0, 0);
      break;
    }
    // Never let clipping reverse the original direction (Quake anti-jitter).
    if (vdot(vel, _origVel) <= 0) {
      vset(vel, 0, 0, 0);
      break;
    }
  }
  return blocked;
}

/**
 * slideMove with stair stepping: if the plain slide is obstructed, try lifting
 * over the obstacle by `stepHeight` and sliding from there.
 */
const _downPos = v3();
const _downVel = v3();
const _upPos = v3();
const _upVel = v3();
const _stepTr = makeTrace();
const _tmp = v3();

export function stepSlideMove(world, pos, vel, half, dt, stepHeight, onGround, filter = null) {
  const startX = pos.x, startY = pos.y, startZ = pos.z;
  const startVX = vel.x, startVY = vel.y, startVZ = vel.z;

  const blocked = slideMove(world, pos, vel, half, dt, filter);
  if (!(blocked & 1)) return blocked;
  // Airborne and moving up: don't try to step, it feels wrong.
  if (!onGround && startVY > 0.1) return blocked;

  // Remember where the plain slide ended up.
  vset(_downPos, pos.x, pos.y, pos.z);
  vset(_downVel, vel.x, vel.y, vel.z);

  // Try again from stepHeight above.
  vset(_upPos, startX, startY, startZ);
  vset(_tmp, startX, startY + stepHeight, startZ);
  traceBox(world, _upPos, _tmp, half, filter, _stepTr);
  if (_stepTr.startSolid || _stepTr.fraction < 0.1) return blocked; // no headroom

  vset(_upPos, _stepTr.end.x, _stepTr.end.y, _stepTr.end.z);
  vset(_upVel, startVX, startVY, startVZ);
  slideMove(world, _upPos, _upVel, half, dt, filter);

  // Drop back down onto the step.
  vset(_tmp, _upPos.x, _upPos.y - stepHeight - 0.02, _upPos.z);
  traceBox(world, _upPos, _tmp, half, filter, _stepTr);
  if (!_stepTr.startSolid) {
    vset(_upPos, _stepTr.end.x, _stepTr.end.y, _stepTr.end.z);
  }
  // Only accept the stepped result if it got us further along.
  const downDist = (_downPos.x - startX) ** 2 + (_downPos.z - startZ) ** 2;
  const upDist = (_upPos.x - startX) ** 2 + (_upPos.z - startZ) ** 2;
  if (upDist > downDist) {
    pos.x = _upPos.x; pos.y = _upPos.y; pos.z = _upPos.z;
    vel.x = _upVel.x; vel.z = _upVel.z;
    // Preserve downward velocity so we don't get launched off steps.
    if (_stepTr.hit && _stepTr.normal.y > 0.7) vel.y = Math.max(vel.y, _upVel.y);
    else vel.y = _upVel.y;
    return blocked & ~1;
  }
  pos.x = _downPos.x; pos.y = _downPos.y; pos.z = _downPos.z;
  vel.x = _downVel.x; vel.y = _downVel.y; vel.z = _downVel.z;
  return blocked;
}

/** Is there solid ground within `dist` below the box? Returns the trace. */
export function groundTrace(world, pos, half, dist = 0.06, filter = null, out = makeTrace()) {
  const end = v3(pos.x, pos.y - dist, pos.z);
  return traceBox(world, pos, end, half, filter, out);
}
