/**
 * Quake-style player movement.
 *
 * This is a fairly faithful port of the Q3/CPMA movement model, converted from
 * Quake units to metres (1 qu = 0.025 m):
 *   - ground acceleration toward a clamped wish speed
 *   - air acceleration that is tiny head-on but large sideways, which is what
 *     makes strafe-jumping accelerate you past the ground speed cap
 *   - CPM air control, so holding W and swinging the mouse arcs you around
 *   - friction skipped on the frame you jump, so bunny-hopping keeps speed
 *
 * Pure numeric, no three.js, so it is exercised directly by `node --test`.
 */
import {
  v3, vset, vdot, vlen, vnorm, vcopy, clamp,
  stepSlideMove, groundTrace, traceBox, makeTrace, SURFACE,
} from './physics.js';

export const PM = {
  gravity: 22.0,
  maxSpeed: 8.4,          // ground speed cap (~336 qu/s)
  maxSpeedCrouch: 3.6,
  accelerate: 12.0,
  airAccelerate: 1.0,     // classic Q3 value: strafe jumping works
  strafeAccelerate: 70.0, // CPM sideways-only air accel
  airWishSpeed: 0.75,     // 30 qu/s -- the clamp that makes strafe jumping pay
  airControl: 120.0,      // CPM air control strength (m/s^2)
  friction: 6.0,
  stopSpeed: 2.0,
  jumpVelocity: 7.2,
  stepHeight: 0.5,
  radius: 0.38,
  height: 1.82,
  crouchHeight: 1.05,
  eyeHeight: 1.62,
  crouchEyeHeight: 0.86,
  iceFrictionScale: 0.12,
  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  maxFallSpeed: 60,
  // Landing damage: below this speed nothing happens.
  safeFallSpeed: 22,
  fatalFallSpeed: 42,
};

export function createPlayerState(spawn = v3(0, 0, 0)) {
  return {
    pos: vcopy(spawn),      // FEET position
    vel: v3(0, 0, 0),
    yaw: 0,                 // radians, 0 = looking down -Z
    pitch: 0,
    onGround: false,
    groundNormal: v3(0, 1, 0),
    groundSurface: SURFACE.NORMAL,
    crouching: false,
    wantsCrouch: false,
    height: PM.height,
    eye: PM.eyeHeight,
    lastGroundTime: 0,
    lastJumpPressTime: -10,
    jumpHeld: false,
    time: 0,
    // Diagnostics used by the HUD and tests.
    speed: 0,
    fallSpeed: 0,
    landedHard: 0,
    justJumped: false,
    justLanded: false,
    bhopChain: 0,
  };
}

const _half = v3();
const _centre = v3();
const _wish = v3();
const _fwd = v3();
const _right = v3();
const _tr = makeTrace();
const _gn = v3();

/** Half-extents of the player box at its current height. */
function halfExtents(st, out = _half) {
  return vset(out, PM.radius, st.height / 2, PM.radius);
}

/** Quake PM_Accelerate. */
function accelerate(vel, wishdir, wishspeed, accel, dt) {
  const currentSpeed = vdot(vel, wishdir);
  const addSpeed = wishspeed - currentSpeed;
  if (addSpeed <= 0) return;
  let accelSpeed = accel * dt * wishspeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;
  vel.x += wishdir.x * accelSpeed;
  vel.y += wishdir.y * accelSpeed;
  vel.z += wishdir.z * accelSpeed;
}

/** CPM PM_Aircontrol: steers horizontal velocity toward the wish direction. */
function airControl(vel, wishdir, wishspeed, dt, hasSideInput) {
  if (hasSideInput || wishspeed <= 0) return;
  const zspeed = vel.y;
  vel.y = 0;
  const speed = vlen(vel);
  if (speed < 1e-4) { vel.y = zspeed; return; }
  vel.x /= speed; vel.z /= speed;
  const dot = vel.x * wishdir.x + vel.z * wishdir.z;
  if (dot > 0) {
    const k = PM.airControl * dot * dot * dt;
    vel.x = vel.x * speed + wishdir.x * k;
    vel.z = vel.z * speed + wishdir.z * k;
    const l = Math.hypot(vel.x, vel.z);
    if (l > 1e-6) { vel.x = (vel.x / l) * speed; vel.z = (vel.z / l) * speed; }
  } else {
    vel.x *= speed; vel.z *= speed;
  }
  vel.y = zspeed;
}

function applyFriction(st, dt, frictionScale) {
  const vel = st.vel;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < 0.05) { vel.x = 0; vel.z = 0; return; }
  let drop = 0;
  if (st.onGround) {
    const control = speed < PM.stopSpeed ? PM.stopSpeed : speed;
    drop += control * PM.friction * frictionScale * dt;
  }
  let newSpeed = speed - drop;
  if (newSpeed < 0) newSpeed = 0;
  newSpeed /= speed;
  vel.x *= newSpeed; vel.y *= newSpeed; vel.z *= newSpeed;
}

/** Can the player stand up here? */
function canUncrouch(world, st) {
  vset(_half, PM.radius, PM.height / 2, PM.radius);
  vset(_centre, st.pos.x, st.pos.y + PM.height / 2, st.pos.z);
  vset(_wish, st.pos.x, st.pos.y + PM.height / 2, st.pos.z);
  traceBox(world, _centre, _wish, _half, null, _tr);
  return !_tr.startSolid;
}

/**
 * Advance the player one tick.
 *
 * @param world   physics World
 * @param st      player state from createPlayerState
 * @param cmd     {forward, right, jump, crouch} — forward/right in -1..1
 * @param dt      seconds
 * @param opts    {noclip, filter}
 */
export function playerMove(world, st, cmd, dt, opts = {}) {
  st.time += dt;
  st.justJumped = false;
  st.justLanded = false;
  st.landedHard = 0;

  const filter = opts.filter || null;

  /* ---- crouch ---- */
  st.wantsCrouch = !!cmd.crouch;
  const targetHeight = st.wantsCrouch ? PM.crouchHeight : PM.height;
  if (targetHeight < st.height) {
    st.height = targetHeight;
    st.crouching = true;
  } else if (targetHeight > st.height && canUncrouch(world, st)) {
    st.height = targetHeight;
    st.crouching = false;
  }
  st.eye = st.crouching ? PM.crouchEyeHeight : PM.eyeHeight;

  if (opts.noclip) {
    buildWishDir(st, cmd, _wish);
    const sp = 18;
    st.vel.x = _wish.x * sp;
    st.vel.z = _wish.z * sp;
    st.vel.y = (cmd.jump ? 1 : 0) * sp - (cmd.crouch ? 1 : 0) * sp;
    st.pos.x += st.vel.x * dt;
    st.pos.y += st.vel.y * dt;
    st.pos.z += st.vel.z * dt;
    st.onGround = false;
    st.speed = Math.hypot(st.vel.x, st.vel.z);
    return st;
  }

  /* ---- ground check ---- */
  halfExtents(st, _half);
  vset(_centre, st.pos.x, st.pos.y + st.height / 2, st.pos.z);
  const wasOnGround = st.onGround;
  groundTrace(world, _centre, _half, 0.08, filter, _tr);
  const foundGround = _tr.hit && _tr.normal.y > 0.7 && st.vel.y <= 0.6;
  st.onGround = foundGround;
  if (foundGround) {
    vset(st.groundNormal, _tr.normal.x, _tr.normal.y, _tr.normal.z);
    st.groundSurface = _tr.brush ? _tr.brush.surface : SURFACE.NORMAL;
    st.lastGroundTime = st.time;
    // Snap to the surface so we don't hover a skin-width above it.
    if (!wasOnGround) {
      st.fallSpeed = -st.vel.y;
      st.justLanded = true;
      if (st.fallSpeed > PM.safeFallSpeed) st.landedHard = st.fallSpeed;
    }
    st.pos.y = _tr.end.y - st.height / 2;
    if (st.vel.y < 0) st.vel.y = 0;
  } else {
    st.groundSurface = SURFACE.NORMAL;
  }

  /* ---- jump (with coyote time + input buffering) ---- */
  if (cmd.jump && !st.jumpHeld) st.lastJumpPressTime = st.time;
  st.jumpHeld = !!cmd.jump;

  const coyoteOk = st.onGround || (st.time - st.lastGroundTime) < PM.coyoteTime;
  // Holding jump auto-hops (that is what makes bunny-hopping feel good); a
  // recent press still fires if it landed slightly before touching down.
  const wantsJump = cmd.jump || (st.time - st.lastJumpPressTime) < PM.jumpBuffer;
  let jumped = false;
  if (wantsJump && coyoteOk) {
    st.vel.y = PM.jumpVelocity;
    st.onGround = false;
    st.lastGroundTime = -10;
    st.lastJumpPressTime = -10;
    st.justJumped = true;
    jumped = true;
    // Bunny-hop chain: landing and immediately jumping again keeps momentum.
    if (st.justLanded || wasOnGround) st.bhopChain++;
    if (st.bhopChain > 99) st.bhopChain = 99;
  }
  if (st.onGround && !jumped && Math.hypot(st.vel.x, st.vel.z) < 2) st.bhopChain = 0;

  /* ---- acceleration ---- */
  buildWishDir(st, cmd, _wish);
  let wishspeed = vlen(_wish);
  if (wishspeed > 1) { _wish.x /= wishspeed; _wish.z /= wishspeed; wishspeed = 1; }
  const maxSpeed = st.crouching ? PM.maxSpeedCrouch : PM.maxSpeed;
  wishspeed *= maxSpeed;

  if (st.onGround && !jumped) {
    const frictionScale = (st.groundSurface & SURFACE.ICE) ? PM.iceFrictionScale : 1;
    applyFriction(st, dt, frictionScale);
    const accel = (st.groundSurface & SURFACE.ICE) ? PM.accelerate * 0.25 : PM.accelerate;
    accelerate(st.vel, _wish, wishspeed, accel, dt);
    st.vel.y = Math.min(st.vel.y, 0);
  } else {
    // Airborne. Skipping friction here is what preserves bhop speed.
    const sideOnly = Math.abs(cmd.right) > 0.01 && Math.abs(cmd.forward) < 0.01;
    if (sideOnly) {
      accelerate(st.vel, _wish, Math.min(wishspeed, PM.airWishSpeed), PM.strafeAccelerate, dt);
    } else {
      accelerate(st.vel, _wish, wishspeed, PM.airAccelerate, dt);
    }
    airControl(st.vel, _wish, wishspeed, dt, Math.abs(cmd.right) > 0.01);
    st.vel.y -= PM.gravity * dt;
    if (st.vel.y < -PM.maxFallSpeed) st.vel.y = -PM.maxFallSpeed;
  }

  /* ---- move ---- */
  halfExtents(st, _half);
  vset(_centre, st.pos.x, st.pos.y + st.height / 2, st.pos.z);
  const blocked = stepSlideMove(world, _centre, st.vel, _half, dt, PM.stepHeight, st.onGround, filter);
  st.pos.x = _centre.x;
  st.pos.y = _centre.y - st.height / 2;
  st.pos.z = _centre.z;
  st.blocked = blocked;

  st.speed = Math.hypot(st.vel.x, st.vel.z);
  return st;
}

/** Wish direction in world space from the movement command and view yaw. */
export function buildWishDir(st, cmd, out) {
  const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
  // Forward is -Z at yaw 0 (three.js camera convention).
  vset(_fwd, -sy, 0, -cy);
  vset(_right, cy, 0, -sy);
  vset(out,
    _fwd.x * cmd.forward + _right.x * cmd.right,
    0,
    _fwd.z * cmd.forward + _right.z * cmd.right);
  return out;
}

/** Push the player (rocket jumps, jump pads, enemy knockback). */
export function applyImpulse(st, x, y, z) {
  st.vel.x += x;
  st.vel.y += y;
  st.vel.z += z;
  if (y > 0.5) {
    st.onGround = false;
    st.lastGroundTime = -10;
  }
}

/** Damage taken from a hard landing, Quake style. */
export function fallDamage(speed) {
  if (speed < PM.safeFallSpeed) return 0;
  if (speed >= PM.fatalFallSpeed) return 100;
  const t = (speed - PM.safeFallSpeed) / (PM.fatalFallSpeed - PM.safeFallSpeed);
  return Math.round(5 + t * 40);
}

export { vnorm, clamp };
