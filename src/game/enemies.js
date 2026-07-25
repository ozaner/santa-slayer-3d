/**
 * Enemies: the gingerbread army.
 *
 * Each enemy is a capsule that walks the same collision world as the player
 * (gravity, stair stepping, wall sliding), steered by a small state machine.
 * Animation is entirely procedural -- limb pivots driven by gait phase, a hit
 * flash on the shared material via per-instance material clones, and ragdoll-ish
 * death by gibbing into cookie shards.
 */
import * as THREE from 'three';
import {
  v3, vset, stepSlideMove, groundTrace, traceRay, makeTrace, vdistSq,
} from '../core/physics.js';
import { inFrontCone } from './combat.js';
import {
  buildGrunt, buildSwordGB, buildShieldGB, buildSnowmanBrute, buildGingerGolem,
} from '../models/gingerbread.js';
import { cloneRig } from '../models/rig.js';
import { mergeRig } from '../render/optimize.js';

export const ENEMY_TYPES = {
  grunt: {
    id: 'grunt', name: 'Gingerbread Grunt',
    hp: 42, speed: 5.4, accel: 22, mass: 1,
    height: 1.7, radius: 0.42,
    attack: { kind: 'melee', damage: 11, range: 2.2, windup: 0.42, recover: 0.55, lunge: 5.5 },
    score: 100, build: buildGrunt, gibs: 8,
    sightRange: 90,
  },
  sword: {
    id: 'sword', name: 'Candy Cane Duelist',
    hp: 34, speed: 8.8, accel: 30, mass: 0.85,
    height: 1.75, radius: 0.4,
    attack: { kind: 'melee', damage: 21, range: 2.7, windup: 0.3, recover: 0.42, lunge: 13 },
    score: 150, build: buildSwordGB, gibs: 8,
    sightRange: 110, strafe: 0.55,
  },
  shield: {
    id: 'shield', name: 'Gumdrop Bulwark',
    hp: 115, speed: 3.5, accel: 14, mass: 2.2,
    height: 1.9, radius: 0.5,
    attack: { kind: 'melee', damage: 18, range: 2.5, windup: 0.6, recover: 0.7, lunge: 3 },
    block: { cone: 72, reduction: 0.12 },
    score: 200, build: buildShieldGB, gibs: 10,
    sightRange: 80,
  },
  snowman: {
    id: 'snowman', name: 'Frostbite Brute',
    hp: 85, speed: 2.9, accel: 12, mass: 2.6,
    height: 2.3, radius: 0.65,
    attack: { kind: 'ranged', damage: 16, range: 34, minRange: 9, windup: 0.75, recover: 1.5, projSpeed: 26 },
    score: 175, build: buildSnowmanBrute, gibs: 10, noLegs: true,
    sightRange: 120,
  },
  golem: {
    id: 'golem', name: 'THE GINGERBREAD GOLEM',
    hp: 2200, speed: 3.6, accel: 12, mass: 12,
    height: 5.2, radius: 1.6,
    attack: { kind: 'boss', damage: 34, range: 5.2, windup: 0.75, recover: 1.1, lunge: 8 },
    score: 3000, build: buildGingerGolem, gibs: 26,
    sightRange: 200, boss: true,
  },
};

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tr = makeTrace();
const _pa = v3();
const _pb = v3();
const _half = v3();
const _centre = v3();
const FLASH_COLOR = new THREE.Color(1.0, 0.42, 0.28);

let nextId = 1;

export class Enemy {
  constructor(type, pos, opts = {}) {
    const def = ENEMY_TYPES[type];
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.pos = v3(pos.x, pos.y, pos.z);
    this.vel = v3(0, 0, 0);
    this.yaw = opts.yaw ?? 0;
    this.height = def.height;
    this.radius = def.radius;
    this.hpMax = Math.round(def.hp * (opts.hpScale ?? 1));
    this.hp = this.hpMax;
    this.speed = def.speed * (opts.speedScale ?? 1);
    this.alive = true;
    this.onGround = false;
    this.state = 'spawn';
    this.stateT = 0;
    this.attackT = 0;
    this.gaitPhase = Math.random() * 6.28;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeT = 0;
    this.hitFlash = 0;
    this.stagger = 0;
    this.spawnT = 0;
    this.jumpCooldown = 0;
    this.repathT = 0;
    this.avoid = 0;
    this.model = null;
    this.parts = null;
    this.materials = [];
    this.damageDealt = false;
    this.attackAnim = 0;
    this.deathT = 0;
    this.bossPhase = 0;
    this.summonCooldown = 8;
  }

  get eyeY() { return this.pos.y + this.height * 0.82; }
  get centreY() { return this.pos.y + this.height * 0.5; }
}

export class EnemyManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.protos = {};
    this.onKill = null;
    this.onDamage = null;
    this.totalKilled = 0;
  }

  _proto(type) {
    if (!this.protos[type]) {
      const model = ENEMY_TYPES[type].build();
      // Bake the rigidly-attached primitives down before this becomes the
      // template for every clone -- otherwise each enemy costs ~35 draw calls.
      mergeRig(model);
      this.protos[type] = model;
    }
    return this.protos[type];
  }

  spawn(type, pos, opts = {}) {
    const e = new Enemy(type, pos, opts);
    const model = cloneRig(this._proto(type));

    // Clone materials per enemy so the hit flash is individual.
    const mats = [];
    model.traverse((o) => {
      if (o.isMesh) {
        if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
        else o.material = o.material.clone();
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          if (m.emissive) { m.userData.baseEmissive = m.emissive.getHex(); mats.push(m); }
        }
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    e.materials = mats;
    e.model = model;
    e.parts = model.userData.parts || {};
    model.position.set(e.pos.x, e.pos.y, e.pos.z);
    model.rotation.y = e.yaw;
    this.ctx.scene.add(model);
    this.list.push(e);
    if (opts.silent !== true) this._spawnFx(e);
    return e;
  }

  _spawnFx(e) {
    const fx = this.ctx.fx;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = e.radius * (0.4 + Math.random());
      fx.particle({
        add: i % 3 === 0,
        x: e.pos.x + Math.cos(a) * r, y: e.pos.y + Math.random() * e.height, z: e.pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * 1.6, vy: 2 + Math.random() * 2.5, vz: Math.sin(a) * 1.6,
        life: 0.45 + Math.random() * 0.4, size: 2.2 + Math.random() * 2.6, endSize: 0.5,
        color: i % 3 === 0 ? 0xffd18a : 0xb2703a, alpha: 0.9, endAlpha: 0, drag: 2.2, gravity: -2,
      });
    }
    fx.flash({ x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, { color: 0xffa552, intensity: 8, range: 8, life: 0.25 });
  }

  /**
   * Apply damage. `point` is the world-space hit location, `push` the
   * knockback impulse. Returns the damage actually dealt (0 if fully blocked).
   */
  damage(e, amount, point, push, meta = {}) {
    if (!e.alive) return 0;
    let dmg = amount;
    let blocked = false;

    const block = e.def.block;
    if (block && point && inFrontCone(e.pos, e.yaw, point, block.cone)) {
      dmg *= block.reduction;
      blocked = true;
    }

    e.hp -= dmg;
    e.hitFlash = 1;
    if (!meta.splash) e.stagger = Math.max(e.stagger, blocked ? 0.06 : 0.12);

    const fx = this.ctx.fx;
    if (point) {
      _tmp.set(point.x, point.y, point.z);
      if (blocked) {
        // Sparks off the peppermint shield, plus a distinctive clang.
        _tmp2.set(Math.sin(e.yaw), 0.2, Math.cos(e.yaw));
        fx.impact(_tmp, _tmp2, { color: 0xffe6a8, decal: false, scale: 1.1 });
        this.ctx.audio?.play('block', _tmp);
      } else {
        _tmp2.set(-(push?.x ?? 0), 0.4, -(push?.z ?? 0));
        if (_tmp2.lengthSq() < 1e-4) _tmp2.set(0, 1, 0);
        _tmp2.normalize();
        fx.crumbs(_tmp, _tmp2, { count: meta.head ? 16 : 10 });
        if (meta.head) this.ctx.audio?.play('headshot', _tmp);
      }
    }

    if (push && !blocked) {
      const m = 1 / (e.def.mass || 1);
      e.vel.x += push.x * m;
      e.vel.y += Math.max(0, push.y) * m;
      e.vel.z += push.z * m;
    }

    this.onDamage?.(e, dmg, meta);

    if (e.hp <= 0) this.kill(e, meta);
    return blocked ? 0 : dmg;
  }

  kill(e, meta = {}) {
    if (!e.alive) return;
    e.alive = false;
    e.state = 'dead';
    e.deathT = 0;
    this.totalKilled++;
    const fx = this.ctx.fx;
    const centre = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
    fx.gib(centre, e.def.gibs, e.def.boss ? 16 : 9, e.pos.y);
    fx.crumbs(centre, { x: 0, y: 1, z: 0 }, { count: e.def.boss ? 60 : 24, scale: e.def.boss ? 2.4 : 1.3 });
    if (e.def.boss) {
      fx.explosion(centre, { scale: 3.2, color: 0xffb04a });
      this.ctx.audio?.play('bossdie', centre);
    } else {
      fx.flash(centre, { color: 0xd9a05a, intensity: 9, range: 9, life: 0.22 });
      this.ctx.audio?.play('gib', centre);
    }
    this.ctx.scene.remove(e.model);
    this.onKill?.(e, meta);
  }

  /** Nearest living enemy to a point, for target assists and the HUD. */
  nearest(pos, maxDist = Infinity) {
    let best = null, bestD = maxDist * maxDist;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = vdistSq(e.pos, pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  clear() {
    for (const e of this.list) if (e.model) this.ctx.scene.remove(e.model);
    this.list.length = 0;
  }

  /* ================= update ================= */

  update(dt, player) {
    const { world } = this.ctx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) { this.list.splice(i, 1); continue; }
      this._updateOne(e, dt, player, world);
    }
    this._updateShadowLod(dt, player);
  }

  /**
   * Only the nearest handful of enemies cast shadows. Every shadow caster is a
   * second draw call per mesh, and a gingerbread man twenty metres away
   * contributes a few pixels of shadow nobody will ever look at.
   */
  _updateShadowLod(dt, player) {
    this._lodT = (this._lodT ?? 0) - dt;
    if (this._lodT > 0) return;
    this._lodT = 0.25;

    const sorted = this.list.filter((e) => e.alive);
    sorted.sort((a, b) => vdistSq(a.pos, player.pos) - vdistSq(b.pos, player.pos));
    const budget = this.shadowBudget ?? 10;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const on = i < budget && vdistSq(e.pos, player.pos) < 40 * 40;
      if (e._shadowOn === on) continue;
      e._shadowOn = on;
      e.model.traverse((o) => { if (o.isMesh) o.castShadow = on; });
    }
  }

  _updateOne(e, dt, player, world) {
    e.stateT += dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
    e.stagger = Math.max(0, e.stagger - dt);
    e.jumpCooldown = Math.max(0, e.jumpCooldown - dt);

    const toPlayerX = player.pos.x - e.pos.x;
    const toPlayerZ = player.pos.z - e.pos.z;
    const distSq = toPlayerX * toPlayerX + toPlayerZ * toPlayerZ;
    const dist = Math.sqrt(distSq);
    const atk = e.def.attack;

    /* ---- state machine ---- */
    let wishX = 0, wishZ = 0;
    let wantFace = true;

    if (e.state === 'spawn') {
      if (e.stateT > 0.45) { e.state = 'chase'; e.stateT = 0; }
    } else if (e.state === 'chase') {
      const inRange = atk.kind === 'ranged'
        ? dist < atk.range && dist > atk.minRange
        : dist < atk.range;
      if (inRange && this._canSee(e, player)) {
        e.state = 'windup';
        e.stateT = 0;
        e.damageDealt = false;
        this.ctx.audio?.play(atk.kind === 'ranged' ? 'throwup' : 'swing', e.pos);
      } else {
        // Steer toward the player, offset by a strafe wobble so a pack does
        // not collapse into a single conga line.
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeT = 0.8 + Math.random() * 1.4; e.strafeDir *= -1; }

        const goal = this._navGoal(e, dt, player, dist);
        const gdx = goal.x - e.pos.x;
        const gdz = goal.z - e.pos.z;
        const glen = Math.hypot(gdx, gdz) || 1;
        const dx = gdx / glen, dz = gdz / glen;
        const strafe = goal.viaRoute ? 0 : (e.def.strafe ?? 0.18);
        wishX = dx - dz * strafe * e.strafeDir;
        wishZ = dz + dx * strafe * e.strafeDir;

        // Ranged types back off when the player closes in.
        if (atk.kind === 'ranged' && !goal.viaRoute && dist < atk.minRange) { wishX = -dx; wishZ = -dz; }
      }
    } else if (e.state === 'windup') {
      wantFace = true;
      e.attackAnim = Math.min(1, e.stateT / atk.windup);
      if (e.stateT >= atk.windup) {
        e.state = 'strike';
        e.stateT = 0;
        this._strike(e, player, atk);
      }
    } else if (e.state === 'strike') {
      e.attackAnim = 1 - Math.min(1, e.stateT / 0.14);
      if (e.stateT > 0.14) { e.state = 'recover'; e.stateT = 0; }
    } else if (e.state === 'recover') {
      e.attackAnim = 0;
      if (e.stateT >= atk.recover) { e.state = 'chase'; e.stateT = 0; }
    }

    /* ---- deadlock backstop ---- */
    // Without a navmesh, a player parked on certain rooftops is genuinely
    // unreachable, and a wave that can never end is far worse than any amount
    // of AI jank. The timer resets on every near-miss, so an enemy actually
    // engaging the player never trips it; one that has spent this long without
    // ever getting close relocates near the player, and after a few failures
    // crumbles so the wave can always complete.
    e.contactT = (e.contactT ?? 0) + dt;
    // True 3D distance: an enemy milling about directly *under* a rooftop is
    // horizontally on top of the player but has never actually threatened them.
    const contactDist = Math.hypot(toPlayerX, player.pos.y - e.pos.y, toPlayerZ);
    if (contactDist < atk.range + 0.5) e.contactT = 0;
    if (e.contactT > 25 && !e.def.boss) {
      e.contactT = 0;
      e.relocations = (e.relocations ?? 0) + 1;
      if (e.relocations > 3) { this.kill(e, { starved: true }); return; }
      this._relocateNear(e, player);
    }

    /* ---- boss extras ---- */
    if (e.def.boss) this._updateBoss(e, dt, player, dist);

    /* ---- steering: avoid walls, separate from the pack ---- */
    if (wishX || wishZ) {
      const l = Math.hypot(wishX, wishZ);
      wishX /= l; wishZ /= l;
      this._avoidWalls(e, wishX, wishZ, world);
      wishX = e._wx; wishZ = e._wz;
      this._separate(e, dt);
    }

    /* ---- physics ---- */
    const speed = e.stagger > 0 ? e.speed * 0.25 : (e.state === 'chase' || e.state === 'spawn' ? e.speed : e.speed * 0.16);
    const accel = e.def.accel;

    if (e.onGround) {
      // Friction
      const sp = Math.hypot(e.vel.x, e.vel.z);
      if (sp > 0.01) {
        const drop = Math.max(sp, 2) * 7 * dt;
        const k = Math.max(0, sp - drop) / sp;
        e.vel.x *= k; e.vel.z *= k;
      }
      // Accelerate toward the wish direction
      if (wishX || wishZ) {
        const cur = e.vel.x * wishX + e.vel.z * wishZ;
        const add = speed - cur;
        if (add > 0) {
          const a = Math.min(accel * dt * speed, add);
          e.vel.x += wishX * a;
          e.vel.z += wishZ * a;
        }
      }
      e.vel.y = Math.min(e.vel.y, 0);
    } else {
      // A little air control so they can cross gaps they were pushed over.
      if (wishX || wishZ) {
        const cur = e.vel.x * wishX + e.vel.z * wishZ;
        const add = speed - cur;
        if (add > 0) {
          const a = Math.min(2.2 * dt * speed, add);
          e.vel.x += wishX * a;
          e.vel.z += wishZ * a;
        }
      }
      e.vel.y -= 22 * dt;
      if (e.vel.y < -60) e.vel.y = -60;
    }

    // Ground probe
    vset(_half, e.radius, e.height / 2, e.radius);
    vset(_centre, e.pos.x, e.pos.y + e.height / 2, e.pos.z);
    groundTrace(world, _centre, _half, 0.1, null, _tr);
    const grounded = _tr.hit && _tr.normal.y > 0.7 && e.vel.y <= 0.6;
    e.onGround = grounded;
    if (grounded) {
      e.pos.y = _tr.end.y - e.height / 2;
      if (e.vel.y < 0) e.vel.y = 0;
      vset(_centre, e.pos.x, e.pos.y + e.height / 2, e.pos.z);
    }

    // Jump pads work for the gingerbread too. Without this, a player standing
    // on any pad-only rooftop is untouchable and the wave never ends -- and a
    // gingerbread man launched forty feet into the air is good television.
    if (grounded) this._checkJumpPad(e);

    // Hop over small obstacles / up to the player when stuck.
    if (grounded && e.jumpCooldown <= 0 && e.state === 'chase') {
      const wantHigher = player.pos.y - e.pos.y > 0.7 && dist < 9;
      const stuck = Math.hypot(e.vel.x, e.vel.z) < e.speed * 0.28 && (wishX || wishZ);
      if (wantHigher || stuck) {
        e.vel.y = 7.4;
        e.onGround = false;
        e.jumpCooldown = 0.9 + Math.random() * 0.5;
      }
    }

    stepSlideMove(world, _centre, e.vel, _half, dt, 0.55, e.onGround, null);
    e.pos.x = _centre.x;
    e.pos.y = _centre.y - e.height / 2;
    e.pos.z = _centre.z;

    // Fell out of the world.
    if (e.pos.y < -40) { this.kill(e, { fell: true }); return; }

    /* ---- facing ---- */
    if (wantFace && dist > 0.05) {
      const target = Math.atan2(toPlayerX, toPlayerZ);
      let d = target - e.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turnRate = e.state === 'windup' ? 3.5 : 7;
      e.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
    }

    this._animate(e, dt);
  }

  _strike(e, player, atk) {
    if (atk.kind === 'ranged') {
      _tmp.set(player.pos.x, player.pos.y + player.eye * 0.8, player.pos.z);
      _tmp2.set(e.pos.x, e.pos.y + e.height * 0.75, e.pos.z);
      const d = _tmp.clone().sub(_tmp2);
      const dist = d.length();
      d.normalize();
      // Lead the arc a little so a moving player still has to dodge.
      d.y += Math.min(0.42, dist * 0.011);
      d.normalize();
      this.ctx.projectiles.spawnSnowball(_tmp2, d, atk.projSpeed, atk.damage);
      this.ctx.audio?.play('throw', e.pos);
      return;
    }
    // Melee: lunge forward, then check the arc.
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    e.vel.x += fx * atk.lunge;
    e.vel.z += fz * atk.lunge;
    this.ctx.audio?.play('swing', e.pos);

    const dx = player.pos.x - e.pos.x;
    const dz = player.pos.z - e.pos.z;
    const dy = (player.pos.y + player.height * 0.5) - (e.pos.y + e.height * 0.5);
    const flat = Math.hypot(dx, dz);
    if (flat < atk.range + 0.6 && Math.abs(dy) < e.height * 0.9) {
      const inv = flat > 1e-4 ? 1 / flat : 0;
      if (dx * inv * fx + dz * inv * fz > 0.35) {
        this.ctx.game?.hurtPlayer(atk.damage, e.pos, e.type, {
          knockback: { x: fx * 6.5, y: 3.2, z: fz * 6.5 },
        });
      }
    }
  }

  _updateBoss(e, dt, player, dist) {
    const phase = e.hp / e.hpMax;
    e.bossPhase = phase < 0.33 ? 2 : phase < 0.66 ? 1 : 0;
    e.speed = e.def.speed * (1 + e.bossPhase * 0.3);
    e.summonCooldown -= dt;
    if (e.summonCooldown <= 0 && e.state === 'chase') {
      e.summonCooldown = 11 - e.bossPhase * 3;
      const n = 2 + e.bossPhase;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3.5 + Math.random() * 2.5;
        this.ctx.game?.spawnMinion({
          x: e.pos.x + Math.cos(a) * r,
          y: e.pos.y + 0.5,
          z: e.pos.z + Math.sin(a) * r,
        }, e.bossPhase >= 1 && Math.random() > 0.5 ? 'sword' : 'grunt');
      }
      this.ctx.audio?.play('summon', e.pos);
    }
    // Pulse the burning eyes with the phase.
    const eyes = e.parts?.eyes;
    if (eyes) {
      const k = 2.5 + e.bossPhase * 2 + Math.sin(e.stateT * 6) * 0.8;
      for (const m of eyes) {
        if (m?.material?.emissiveIntensity !== undefined) m.material.emissiveIntensity = k;
      }
    }
  }

  /** Move a hopelessly stuck enemy to the spawn point nearest the player. */
  _relocateNear(e, player) {
    const spawns = this.ctx.game?.level?.enemySpawns;
    if (!spawns?.length) return;
    let best = null, bestD = Infinity;
    for (const s of spawns) {
      if (s.tag === 'boss') continue;
      const d = Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z)
        + Math.abs(s.pos.y - player.pos.y) * 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return;
    e.pos.x = best.pos.x; e.pos.y = best.pos.y; e.pos.z = best.pos.z;
    e.vel.x = e.vel.y = e.vel.z = 0;
    e._route = null;
    e.stuckT = 0;
    e._bestDist = undefined;
    this._spawnFx(e);
  }

  _checkJumpPad(e) {
    const pads = this.ctx.game?.level?.jumpPads;
    if (!pads) return;
    e._padCool = Math.max(0, (e._padCool ?? 0) - 0.016);
    if (e._padCool > 0) return;
    for (const pad of pads) {
      const dx = e.pos.x - pad.pos.x;
      const dz = e.pos.z - pad.pos.z;
      const dy = e.pos.y - pad.pos.y;
      if (dx * dx + dz * dz < pad.radius * pad.radius && dy > -0.6 && dy < 1.6) {
        e.vel.y = pad.push;
        e.onGround = false;
        e._padCool = 0.5;
        this.ctx.audio?.play('jumppad', pad.pos);
        this.ctx.fx.flash(pad.pos, { color: 0x9ff2d6, intensity: 8, range: 8, life: 0.2 });
        return;
      }
    }
  }

  /**
   * Where this enemy should actually walk.
   *
   * Normally straight at the player. But when an enemy has stopped closing the
   * distance and the player is well above it -- camping a rooftop or the
   * watchtower -- it grinds against the wall below forever and the wave can
   * never finish. In that case pick the level waypoint that minimises
   * (distance to it + its distance to the player) and head there instead.
   */
  _navGoal(e, dt, player, dist) {
    const dy = player.pos.y - e.pos.y;

    // Progress means beating the closest we have ever got, not merely moving --
    // a pack milling about below a rooftop wobbles in and out by a metre
    // forever, which would reset a naive timer on every wobble. Only counted
    // while the player is meaningfully above us, so ordinary chasing (and a
    // player running away) is never mistaken for being stuck.
    if (dy <= 1.5) {
      e.stuckT = 0;
      e._bestDist = dist;
    } else if (e._bestDist === undefined || dist < e._bestDist - 0.35) {
      e._bestDist = dist;
      e.stuckT = 0;
    } else {
      e.stuckT = (e.stuckT ?? 0) + dt;
    }

    e._routeCooldown = Math.max(0, (e._routeCooldown ?? 0) - dt);

    if (e._route) {
      const rd = Math.hypot(e._route.x - e.pos.x, e._route.z - e.pos.z);
      e._routeT -= dt;
      if (rd < 2.0 || e._routeT <= 0 || dy < 1.2) {
        e._route = null;
        e.stuckT = 0;
        e._bestDist = undefined;
        // Commit to whatever the waypoint opened up (usually a staircase)
        // before being allowed to reroute, or it oscillates on the spot.
        e._routeCooldown = 3.5;
      } else {
        return { x: e._route.x, z: e._route.z, viaRoute: true };
      }
    }

    if (e.stuckT > 2.5 && dy > 1.5 && e._routeCooldown <= 0) {
      const points = this.ctx.game?.level?.routePoints;
      if (points && points.length) {
        let best = null, bestScore = Infinity;
        for (const r of points) {
          // Only waypoints this enemy can actually walk to from here. A
          // waypoint at the top of the stairs is useless while standing at
          // the bottom -- it has to go to the bottom one first.
          if (Math.abs(r.y - e.pos.y) > 1.8) continue;
          const toR = Math.hypot(r.x - e.pos.x, r.z - e.pos.z);
          if (toR < 3) continue; // already here; it did not help
          const rToP = Math.hypot(r.x - player.pos.x, r.z - player.pos.z)
            + Math.abs(r.y - player.pos.y) * 1.5;
          const score = toR + rToP;
          if (score < bestScore) { bestScore = score; best = r; }
        }
        if (best) {
          e._route = best;
          e._routeT = 9;
          return { x: best.x, z: best.z, viaRoute: true };
        }
      }
      e.stuckT = 0;
      e._routeCooldown = 2;
    }
    return { x: player.pos.x, z: player.pos.z, viaRoute: false };
  }

  /** Cheap wall avoidance: probe ahead, fan outward when blocked. */
  _avoidWalls(e, wx, wz, world) {
    const probe = 2.6;
    // Probe just above the step height, not at mid-body: at mid-body every
    // stair riser reads as a wall and the pack refuses to climb.
    const py = e.pos.y + 0.72;
    let bestX = wx, bestZ = wz;

    vset(_pa, e.pos.x, py, e.pos.z);
    vset(_pb, e.pos.x + wx * probe, py, e.pos.z + wz * probe);
    traceRay(world, _pa, _pb, null, _tr);
    if (_tr.hit && _tr.fraction < 0.98) {
      // Try fanned alternatives, nearest to the desired heading first.
      const angles = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6];
      let found = false;
      for (const a of angles) {
        const c = Math.cos(a), s = Math.sin(a);
        const nx = wx * c - wz * s;
        const nz = wx * s + wz * c;
        vset(_pb, e.pos.x + nx * probe, py, e.pos.z + nz * probe);
        traceRay(world, _pa, _pb, null, _tr);
        if (!_tr.hit || _tr.fraction > 0.9) { bestX = nx; bestZ = nz; found = true; break; }
      }
      if (!found) { bestX = wx; bestZ = wz; }
    }
    e._wx = bestX;
    e._wz = bestZ;
  }

  /** Push overlapping enemies apart so they do not stack into one blob. */
  _separate(e, dt) {
    let sx = 0, sz = 0, n = 0;
    for (const o of this.list) {
      if (o === e || !o.alive) continue;
      const dx = e.pos.x - o.pos.x;
      const dz = e.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const minD = e.radius + o.radius;
      if (d2 > minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const k = (minD - d) / minD;
      sx += (dx / d) * k;
      sz += (dz / d) * k;
      n++;
    }
    if (n) {
      const push = 9 * dt;
      e.vel.x += sx * push;
      e.vel.z += sz * push;
      e._wx += sx * 0.65;
      e._wz += sz * 0.65;
      const l = Math.hypot(e._wx, e._wz);
      if (l > 1e-4) { e._wx /= l; e._wz /= l; }
    }
  }

  _canSee(e, player) {
    vset(_pa, e.pos.x, e.eyeY, e.pos.z);
    vset(_pb, player.pos.x, player.pos.y + player.eye, player.pos.z);
    traceRay(this.ctx.world, _pa, _pb, null, _tr);
    return !_tr.hit;
  }

  /* ---------------- animation ---------------- */

  _animate(e, dt) {
    const m = e.model;
    const p = e.parts;
    if (!m) return;

    m.position.set(e.pos.x, e.pos.y, e.pos.z);
    m.rotation.y = e.yaw;

    const speed = Math.hypot(e.vel.x, e.vel.z);
    const moving = speed > 0.4;
    if (moving) e.gaitPhase += dt * (2.6 + speed * 1.5);

    const swing = moving ? Math.sin(e.gaitPhase) : 0;
    const swing2 = moving ? Math.sin(e.gaitPhase * 2) : 0;
    // Guard the divisor: a held-still enemy (speed 0) would otherwise make this
    // 0/0, and a single NaN here propagates through matrixWorld and makes the
    // entire model silently disappear.
    const amp = Math.min(1, speed / Math.max(e.speed, 0.01)) * 0.85;

    if (!e.def.noLegs && p.legL && p.legR) {
      p.legL.rotation.x = swing * amp;
      p.legR.rotation.x = -swing * amp;
    }

    // Arms: counter-swing while walking, raised during a windup.
    const atkPose = e.attackAnim || 0;
    if (p.armL) {
      p.armL.rotation.x = -swing * amp * 0.7 - atkPose * 0.35;
      p.armL.rotation.z = 0.12 + atkPose * 0.25;
    }
    if (p.armR) {
      p.armR.rotation.x = swing * amp * 0.7 - atkPose * 2.1;
      p.armR.rotation.z = -0.12 - atkPose * 0.4;
    }
    if (e.state === 'strike' && p.armR) {
      p.armR.rotation.x = 0.9;
    }

    // Body bob + attack lean.
    if (p.torso) {
      p.torso.position.y = (p.torso.userData.baseY ??= p.torso.position.y) + Math.abs(swing2) * 0.045 * amp;
      p.torso.rotation.x = atkPose * -0.18 + (e.state === 'strike' ? 0.22 : 0);
      p.torso.rotation.z = swing * 0.05 * amp;
    }
    if (p.head) {
      p.head.rotation.z = -swing * 0.06 * amp;
      p.head.rotation.x = (e.state === 'windup' ? -0.12 : 0);
    }

    // Shield stays braced toward the player.
    if (p.shield) {
      p.shield.rotation.y = Math.sin(e.stateT * 2) * 0.06;
      p.shield.position.z = (p.shield.userData.baseZ ??= p.shield.position.z) + atkPose * 0.15;
    }

    // Stagger shake.
    if (e.stagger > 0) {
      m.position.x += (Math.random() - 0.5) * e.stagger * 0.22;
      m.position.z += (Math.random() - 0.5) * e.stagger * 0.22;
    }

    // Hit flash: blend toward hot white, then back to each material's own
    // emissive (the boss's burning eyes must survive this).
    if (e.hitFlash > 0.001 || e._wasFlashing) {
      const k = e.hitFlash;
      for (const mat of e.materials) {
        const base = mat.userData.baseEmissive ?? 0;
        mat.emissive.setHex(base);
        if (k > 0) mat.emissive.lerp(FLASH_COLOR, k);
      }
      e._wasFlashing = e.hitFlash > 0.001;
    }
  }
}
