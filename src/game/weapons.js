/**
 * The arsenal: definitions, firing, ammo, projectiles and the first-person
 * viewmodel rig (bob, sway, recoil, switch animation, muzzle flashes).
 */
import * as THREE from 'three';
import { traceRay, makeTrace, v3 } from '../core/physics.js';
import { rayCapsule, splashFalloff } from './combat.js';
import {
  buildPresentLauncher, buildPeppermintShotgun, buildIcicleRail,
  buildSnowballGun, buildPresentProjectile,
} from '../models/weapons.js';
import { PALETTE, glowMat, sphere } from '../render/materials.js';
import { cloneRig, readVec } from '../models/rig.js';

export const AMMO = {
  snowballs: { max: 400, name: 'Snowballs', color: 0xd8f2ff },
  shells: { max: 60, name: 'Peppermints', color: 0xff6b6b },
  presents: { max: 40, name: 'Presents', color: 0x66d98a },
  slugs: { max: 30, name: 'Icicles', color: 0x9ff2d6 },
};

export const WEAPONS = [
  {
    id: 'chaingun',
    name: 'BLIZZARD CANNON',
    slot: 1,
    ammoType: 'snowballs',
    kind: 'hitscan',
    fireRate: 0.075,
    damage: 8,
    pellets: 1,
    spread: 0.026,
    range: 220,
    knockback: 0.35,
    headshotMult: 1.7,
    tracerColor: 0xdff3ff,
    spins: true,
    recoil: { pos: 0.014, rot: 0.016, kickUp: 0.0032 },
    flash: { color: 0xbfe4ff, intensity: 4.5, range: 7, life: 0.06 },
    build: buildSnowballGun,
    pickupColor: 0xbfe4ff,
    startAmmo: 90,
  },
  {
    id: 'shotgun',
    name: 'PEPPERMINT TWIN-BORE',
    slot: 2,
    ammoType: 'shells',
    kind: 'hitscan',
    fireRate: 0.78,
    damage: 8.5,
    pellets: 12,
    spread: 0.088,
    range: 70,
    knockback: 2.6,
    headshotMult: 1.4,
    tracerColor: 0xffd9d9,
    recoil: { pos: 0.075, rot: 0.14, kickUp: 0.022 },
    flash: { color: 0xffc9a0, intensity: 14, range: 12, life: 0.09 },
    build: buildPeppermintShotgun,
    pickupColor: 0xff6b6b,
    startAmmo: 12,
  },
  {
    id: 'launcher',
    name: 'PRESENT LAUNCHER',
    slot: 3,
    ammoType: 'presents',
    kind: 'projectile',
    fireRate: 0.86,
    projectileSpeed: 32,
    directDamage: 52,
    splashDamage: 88,
    splashRadius: 4.4,
    selfDamageScale: 0.32,
    knockbackScale: 12,
    selfKnockback: 17.5, // jump + rocket clears a village rooftop
    recoil: { pos: 0.06, rot: 0.1, kickUp: 0.018 },
    flash: { color: 0xffb257, intensity: 12, range: 12, life: 0.1 },
    build: buildPresentLauncher,
    pickupColor: 0x66d98a,
    startAmmo: 8,
  },
  {
    id: 'rail',
    name: 'ICICLE RAIL',
    slot: 4,
    ammoType: 'slugs',
    kind: 'rail',
    fireRate: 1.3,
    damage: 110,
    range: 320,
    knockback: 3.5,
    headshotMult: 1.5,
    pierce: 3,
    tracerColor: 0x9ff2d6,
    recoil: { pos: 0.055, rot: 0.08, kickUp: 0.026 },
    flash: { color: 0x9ff2d6, intensity: 16, range: 14, life: 0.14 },
    build: buildIcicleRail,
    pickupColor: 0x9ff2d6,
    startAmmo: 6,
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

const _ro = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _end = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _capA = new THREE.Vector3();
const _capB = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tr = makeTrace();
const _pv = v3();
const _pe = v3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
/** Reused result of a single shot trace -- consumed before the next call. */
const _shotResult = { enemy: null, dist: 0, worldHit: false, normal: null, end: new THREE.Vector3() };

/** Viewmodel framing, in view-camera space. See WeaponSystem._frame. */
export const VM = {
  targetHeight: 0.26, // world height the weapon should occupy
  maxDepth: 0.5,      // longest a weapon may be after scaling
  frontZ: -0.78,      // z of the muzzle end
  right: 0.30,        // x of the weapon's centre (well clear of the crosshair)
  down: -0.155,       // y of the weapon's centre
  yaw: 0.15,          // toe inward so the barrel reads in silhouette
  pitch: -0.02,
};

/* ------------------------------------------------------------------ */
/* Projectiles                                                         */
/* ------------------------------------------------------------------ */

export class ProjectileSystem {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.list = [];
    this.presentProto = null;
    this.snowballGeo = null;
  }

  _presentMesh() {
    if (!this.presentProto) this.presentProto = buildPresentProjectile();
    return cloneRig(this.presentProto);
  }

  spawnPresent(pos, dir, owner = 'player', def = WEAPON_BY_ID.launcher) {
    const mesh = this._presentMesh();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    // Borrow a light from the fixed pool rather than creating one: adding a
    // light to the scene changes three's light counts and recompiles every
    // shader, which cost multiple seconds per rocket.
    const proj = {
      kind: 'present', mesh, owner, def,
      vel: dir.clone().multiplyScalar(def.projectileSpeed),
      spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, 6),
      life: 0, maxLife: 6, radius: 0.16, gravity: 0,
    };
    this.ctx.fx.acquireProjLight(proj, 0xffb257, 3.2, 9);
    this.list.push(proj);
    return mesh;
  }

  spawnSnowball(pos, dir, speed, damage) {
    if (!this.snowballGeo) this.snowballGeo = sphere(0.22, 14, 10);
    const mesh = new THREE.Mesh(this.snowballGeo, glowMat('proj_snowball', 0xeaf6ff));
    mesh.position.copy(pos);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.list.push({
      kind: 'snowball', mesh, owner: 'enemy', damage,
      vel: dir.clone().multiplyScalar(speed),
      spin: new THREE.Vector3(3, 5, 2),
      life: 0, maxLife: 6, radius: 0.22, gravity: 9,
    });
    return mesh;
  }

  update(dt) {
    const { world, fx } = this.ctx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life += dt;
      if (p.gravity) p.vel.y -= p.gravity * dt;

      _ro.copy(p.mesh.position);
      _end.copy(_ro).addScaledVector(p.vel, dt);

      // World collision.
      _pv.x = _ro.x; _pv.y = _ro.y; _pv.z = _ro.z;
      _pe.x = _end.x; _pe.y = _end.y; _pe.z = _end.z;
      traceRay(world, _pv, _pe, null, _tr);

      // Entity collision along the same segment.
      let entHit = null;
      let entT = Infinity;
      const segLen = _ro.distanceTo(_end);
      if (segLen > 1e-6) {
        _rd.copy(_end).sub(_ro).divideScalar(segLen);
        if (p.owner === 'player') {
          for (const e of this.ctx.enemies.list) {
            if (!e.alive) continue;
            _capA.set(e.pos.x, e.pos.y + e.radius, e.pos.z);
            _capB.set(e.pos.x, e.pos.y + e.height - e.radius, e.pos.z);
            const t = rayCapsule(_ro, _rd, _capA, _capB, e.radius + p.radius);
            if (t >= 0 && t <= segLen && t < entT) { entT = t; entHit = e; }
          }
        } else {
          const pl = this.ctx.player;
          _capA.set(pl.pos.x, pl.pos.y + 0.4, pl.pos.z);
          _capB.set(pl.pos.x, pl.pos.y + pl.height - 0.4, pl.pos.z);
          const t = rayCapsule(_ro, _rd, _capA, _capB, 0.42 + p.radius);
          if (t >= 0 && t <= segLen) { entT = t; entHit = 'player'; }
        }
      }

      const worldT = _tr.hit ? _tr.fraction * segLen : Infinity;

      if (entHit && entT <= worldT) {
        _hitPoint.copy(_ro).addScaledVector(_rd, entT);
        this._detonate(p, _hitPoint, entHit);
        this._remove(i);
        continue;
      }
      if (_tr.hit) {
        _hitPoint.set(_tr.end.x, _tr.end.y, _tr.end.z);
        this._detonate(p, _hitPoint, null, _tr.normal);
        this._remove(i);
        continue;
      }

      p.mesh.position.copy(_end);
      for (const l of fx.projLights) if (l.owner === p) l.light.position.copy(_end);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;

      // Sparkle trail
      if (p.kind === 'present' && Math.random() < 0.75) {
        fx.particle({
          add: true,
          x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z,
          vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2,
          life: 0.32, size: 2.4, endSize: 0.2,
          color: Math.random() > 0.5 ? 0xffc46b : 0xff7a4a, alpha: 0.9, endAlpha: 0, drag: 2,
        });
      } else if (p.kind === 'snowball' && Math.random() < 0.5) {
        fx.particle({
          x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z,
          vx: 0, vy: 0, vz: 0, life: 0.3, size: 1.5, endSize: 0.2,
          color: 0xffffff, alpha: 0.7, endAlpha: 0, drag: 1,
        });
      }

      if (p.life > p.maxLife) {
        this._detonate(p, p.mesh.position, null);
        this._remove(i);
      }
    }
  }

  _remove(i) {
    const p = this.list[i];
    this.ctx.fx.releaseProjLight(p);
    this.scene.remove(p.mesh);
    this.list.splice(i, 1);
  }

  _detonate(p, point, directTarget, normal = null) {
    const { fx, audio, enemies, game } = this.ctx;
    if (p.kind === 'present') {
      const def = p.def;
      fx.explosion(point, { scale: 1, color: 0xffb04a });
      audio?.play('explode', point);
      let touched = 0;
      if (directTarget && directTarget !== 'player') {
        touched += enemies.damage(directTarget, def.directDamage, point, p.vel, { source: 'launcher' });
      }
      // Splash on every enemy in radius.
      for (const e of enemies.list) {
        if (!e.alive) continue;
        _tmp.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
        const d = _tmp.distanceTo(point);
        const k = splashFalloff(d, def.splashRadius);
        if (k <= 0) continue;
        const dmg = def.splashDamage * k;
        _tmp.sub(point).normalize().multiplyScalar(def.knockbackScale * k);
        _tmp.y += def.knockbackScale * k * 0.5;
        touched += enemies.damage(e, dmg, point, _tmp, { source: 'launcher', splash: true });
      }
      if (touched > 0) game?.hitMarker();
      // Splash on the player -- this is what makes rocket jumping work.
      game?.splashPlayer(point, def);
      if (normal) fx.decal(point, normal, 1.5 + Math.random() * 0.6, 0.7);
    } else if (p.kind === 'snowball') {
      fx.frostBurst(point, normal || { x: 0, y: 1, z: 0 }, { scale: 1.1 });
      audio?.play('snowhit', point);
      if (directTarget === 'player') game?.hurtPlayer(p.damage, point, 'snowball');
    }
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Weapon system + viewmodel                                           */
/* ------------------------------------------------------------------ */

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    ctx.viewScene.add(this.root);

    this.models = {};
    this.state = {};
    for (const def of WEAPONS) {
      this.state[def.id] = { have: def.id === 'chaingun', ammo: 0 };
    }
    this.ammo = { snowballs: 60, shells: 0, presents: 0, slugs: 0 };

    this.current = null;
    this.currentDef = null;
    this.cooldown = 0;
    this.switchT = 1;     // 0 = fully lowered, 1 = fully raised
    this.switchTarget = null;
    this.bobT = 0;
    this.spin = 0;
    this.spinSpeed = 0;
    this.recoilPos = new THREE.Vector3();
    this.recoilRot = new THREE.Vector3();
    this.swayTarget = new THREE.Vector2();
    this.sway = new THREE.Vector2();
    this.landDip = 0;
    this.fireHeld = false;
    this.shotsFired = 0;
    this.lastMuzzlePos = new THREE.Vector3();
    this.viewKick = new THREE.Vector2(); // fed back into the camera

    this.selectWeapon('chaingun', true);
  }

  _model(id) {
    if (!this.models[id]) {
      const def = WEAPON_BY_ID[id];
      const g = def.build();
      g.visible = false;
      // Viewmodels are rendered by a dedicated camera; keep them off the
      // world shadow pass entirely.
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
      this.root.add(g);
      this.models[id] = g;
    }
    return this.models[id];
  }

  has(id) { return this.state[id]?.have; }

  giveWeapon(id) {
    const s = this.state[id];
    if (!s) return false;
    const isNew = !s.have;
    s.have = true;
    const def = WEAPON_BY_ID[id];
    this.giveAmmo(def.ammoType, def.startAmmo);
    if (isNew) this.selectWeapon(id);
    return isNew;
  }

  giveAmmo(type, n) {
    if (!(type in this.ammo)) return 0;
    const before = this.ammo[type];
    this.ammo[type] = Math.min(AMMO[type].max, before + n);
    return this.ammo[type] - before;
  }

  ammoFor(id) {
    const def = WEAPON_BY_ID[id];
    return this.ammo[def.ammoType];
  }

  selectWeapon(id, instant = false) {
    if (!this.state[id]?.have) return false;
    if (this.currentDef?.id === id && !instant) return false;
    if (instant) {
      this._finishSwitch(id);
      this.switchT = 1;
      this.switchTarget = null;
    } else {
      this.switchTarget = id;
    }
    return true;
  }

  /**
   * Frame a viewmodel from its own bounding box rather than a hand-tuned
   * offset, so all four weapons sit at a consistent on-screen size no matter
   * how they were modelled: normalise the height, cap the depth so a long
   * weapon cannot reach the near plane, then anchor the muzzle end.
   */
  _frame(model) {
    if (model.userData.framed) return model.userData.framed;
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(model);
    const size = bbox.getSize(new THREE.Vector3());
    const centre = bbox.getCenter(new THREE.Vector3());

    let s = VM.targetHeight / Math.max(size.y, 1e-4);
    if (size.z * s > VM.maxDepth) s = VM.maxDepth / Math.max(size.z, 1e-4);

    const framed = {
      scale: s,
      offset: new THREE.Vector3(
        VM.right - centre.x * s,
        VM.down - centre.y * s,
        VM.frontZ - bbox.min.z * s,
      ),
    };
    model.userData.framed = framed;
    return framed;
  }

  _finishSwitch(id) {
    if (this.current) this.current.visible = false;
    this.currentDef = WEAPON_BY_ID[id];
    this.current = this._model(id);
    this.current.visible = true;
    this.spinSpeed = 0;
    const framed = this._frame(this.current);
    this.current.scale.setScalar(framed.scale);
    this.baseOffset = framed.offset;
  }

  cycle(dir) {
    const owned = WEAPONS.filter((w) => this.state[w.id].have);
    if (owned.length < 2) return;
    const idx = owned.findIndex((w) => w.id === (this.switchTarget || this.currentDef.id));
    const next = owned[(idx + dir + owned.length) % owned.length];
    this.selectWeapon(next.id);
  }

  selectBySlot(slot) {
    const def = WEAPONS.find((w) => w.slot === slot);
    if (def) this.selectWeapon(def.id);
  }

  /** Best weapon the player can currently fire -- used on pickup + respawn. */
  autoSwitchIfEmpty() {
    if (this.ammoFor(this.currentDef.id) > 0) return;
    for (let i = WEAPONS.length - 1; i >= 0; i--) {
      const w = WEAPONS[i];
      if (this.state[w.id].have && this.ammo[w.ammoType] > 0) { this.selectWeapon(w.id); return; }
    }
  }

  /* ---------------- firing ---------------- */

  tryFire(camera, player) {
    const def = this.currentDef;
    if (!def || this.cooldown > 0 || this.switchTarget) return false;
    if (this.ammo[def.ammoType] <= 0) {
      this.ctx.audio?.play('dryfire');
      this.cooldown = 0.28;
      this.autoSwitchIfEmpty();
      return false;
    }
    this.ammo[def.ammoType]--;
    this.cooldown = def.fireRate;
    this.shotsFired++;

    // Muzzle position in world space (the viewmodel lives in view space, so we
    // rebuild the world muzzle from the camera).
    const muzzle = this.current.userData.parts?.muzzle;
    _muzzleWorld.set(0, 0, 0);
    if (muzzle) {
      muzzle.getWorldPosition(_muzzleWorld);
      // Transform from view-space into world space.
      _muzzleWorld.applyMatrix4(camera.matrixWorld);
    } else {
      camera.getWorldPosition(_muzzleWorld);
    }
    this.lastMuzzlePos.copy(_muzzleWorld);

    camera.getWorldDirection(_rd);
    _ro.set(player.pos.x, player.pos.y + player.eye, player.pos.z);

    if (def.kind === 'hitscan') this._fireHitscan(def, _ro, _rd, camera);
    else if (def.kind === 'rail') this._fireRail(def, _ro, _rd);
    else if (def.kind === 'projectile') this._fireProjectile(def, _ro, _rd);

    // Recoil + view kick
    this.recoilPos.z += def.recoil.pos;
    this.recoilPos.y += def.recoil.pos * 0.35;
    this.recoilRot.x -= def.recoil.rot;
    this.recoilRot.z += (Math.random() - 0.5) * def.recoil.rot * 0.5;
    this.viewKick.y += def.recoil.kickUp * (0.7 + Math.random() * 0.6);
    this.viewKick.x += (Math.random() - 0.5) * def.recoil.kickUp * 0.6;

    const f = def.flash;
    this.ctx.fx.flash(_muzzleWorld, { color: f.color, intensity: f.intensity, range: f.range, life: f.life });
    this._muzzleSmoke(def);
    this.ctx.audio?.play(def.id === 'chaingun' ? 'chaingun' : def.id, null);
    if (def.spins) this.spinSpeed = 34;
    return true;
  }

  _muzzleSmoke(def) {
    const fx = this.ctx.fx;
    const n = def.kind === 'hitscan' && def.pellets > 4 ? 10 : 5;
    for (let i = 0; i < n; i++) {
      fx.particle({
        add: i % 2 === 0,
        x: this.lastMuzzlePos.x, y: this.lastMuzzlePos.y, z: this.lastMuzzlePos.z,
        vx: (Math.random() - 0.5) * 2.2 + _rd.x * 4,
        vy: (Math.random() - 0.5) * 2.2 + _rd.y * 4 + 0.6,
        vz: (Math.random() - 0.5) * 2.2 + _rd.z * 4,
        life: 0.16 + Math.random() * 0.28,
        size: 2.2 + Math.random() * 3.4, endSize: 5,
        color: i % 2 === 0 ? def.flash.color : 0x6a6d75,
        alpha: 0.75, endAlpha: 0, drag: 3.4, gravity: 1.4,
      });
    }
  }

  _spreadDir(dir, spread, out) {
    out.copy(dir);
    if (spread > 0) {
      // Uniform disc around the aim axis.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      _tmp.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.95) _tmp.set(1, 0, 0);
      _right.crossVectors(dir, _tmp).normalize();
      _up.crossVectors(_right, dir).normalize();
      out.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    return out;
  }

  _traceShot(origin, dir, range, ignore = null) {
    const { world, enemies } = this.ctx;
    _pv.x = origin.x; _pv.y = origin.y; _pv.z = origin.z;
    _pe.x = origin.x + dir.x * range;
    _pe.y = origin.y + dir.y * range;
    _pe.z = origin.z + dir.z * range;
    traceRay(world, _pv, _pe, null, _tr);
    const worldDist = _tr.hit ? _tr.fraction * range : range;

    let best = null;
    let bestT = worldDist;
    for (const e of enemies.list) {
      if (!e.alive || e === ignore) continue;
      if (ignore && Array.isArray(ignore) && ignore.includes(e)) continue;
      _capA.set(e.pos.x, e.pos.y + e.radius, e.pos.z);
      _capB.set(e.pos.x, e.pos.y + e.height - e.radius, e.pos.z);
      const t = rayCapsule(origin, dir, _capA, _capB, e.radius);
      if (t >= 0 && t < bestT) { bestT = t; best = e; }
    }
    if (best) _shotResult.end.copy(origin).addScaledVector(dir, bestT);
    else _shotResult.end.set(
      _tr.hit ? _tr.end.x : _pe.x,
      _tr.hit ? _tr.end.y : _pe.y,
      _tr.hit ? _tr.end.z : _pe.z);
    _shotResult.enemy = best;
    _shotResult.dist = bestT;
    _shotResult.worldHit = !best && _tr.hit;
    _shotResult.normal = _tr.normal;
    return _shotResult;
  }

  _fireHitscan(def, origin, dir, camera) {
    const { fx, enemies } = this.ctx;
    const d = new THREE.Vector3();
    let anyHit = false;
    for (let i = 0; i < def.pellets; i++) {
      this._spreadDir(dir, def.spread, d);
      const hit = this._traceShot(origin, d, def.range);
      if (hit.enemy) {
        const headY = hit.enemy.pos.y + hit.enemy.height * 0.78;
        const head = hit.end.y > headY;
        let dmg = def.damage * (head ? def.headshotMult : 1);
        _tmp.copy(d).multiplyScalar(def.knockback);
        const applied = enemies.damage(hit.enemy, dmg, hit.end, _tmp, { source: def.id, head });
        if (applied > 0) anyHit = true;
      } else if (hit.worldHit) {
        fx.impact(hit.end, hit.normal, { color: 0xd9d2c4, decal: def.pellets < 4 || Math.random() < 0.3, scale: 0.8 });
      }
      // Tracers: one per pellet looks noisy for the shotgun, so thin them out.
      if (def.pellets === 1 || i % 3 === 0) {
        fx.tracer(this.lastMuzzlePos, hit.end, def.tracerColor, def.pellets === 1 ? 0.05 : 0.09);
      }
    }
    if (anyHit) this.ctx.game?.hitMarker(def.id);
  }

  _fireRail(def, origin, dir) {
    const { fx, enemies } = this.ctx;
    const pierced = [];
    let remaining = def.pierce;
    const start = origin.clone();
    // _traceShot reuses one result object, so keep our own copy of the end.
    const finalEnd = new THREE.Vector3();
    for (let i = 0; i < def.pierce + 1; i++) {
      const hit = this._traceShot(start, dir, def.range, pierced);
      finalEnd.copy(hit.end);
      if (hit.enemy) {
        const headY = hit.enemy.pos.y + hit.enemy.height * 0.78;
        const head = hit.end.y > headY;
        _tmp.copy(dir).multiplyScalar(def.knockback);
        enemies.damage(hit.enemy, def.damage * (head ? def.headshotMult : 1), hit.end, _tmp,
          { source: 'rail', head });
        this.ctx.game?.hitMarker('rail');
        pierced.push(hit.enemy);
        remaining--;
        start.copy(hit.end).addScaledVector(dir, 0.05);
        if (remaining < 0) break;
        continue;
      }
      if (hit.worldHit) {
        fx.impact(hit.end, hit.normal, { color: 0xbfe4ff, scale: 1.6 });
        fx.frostBurst(hit.end, hit.normal, { scale: 1.5 });
        fx.decal(hit.end, hit.normal, 0.9, 0.5, 0x2a4a5c);
      }
      break;
    }
    fx.railBeam(this.lastMuzzlePos, finalEnd, def.tracerColor, 0.6);
  }

  _fireProjectile(def, origin, dir) {
    // Spawn slightly forward so the present is not born inside the player.
    _tmp.copy(origin).addScaledVector(dir, 0.7);
    this.ctx.projectiles.spawnPresent(_tmp, dir, 'player', def);
  }

  /* ---------------- per-frame ---------------- */

  update(dt, input, player, camera) {
    const def = this.currentDef;
    this.cooldown = Math.max(0, this.cooldown - dt);

    /* switch animation */
    if (this.switchTarget) {
      this.switchT -= dt * 7;
      if (this.switchT <= 0) {
        this.switchT = 0;
        this._finishSwitch(this.switchTarget);
        this.switchTarget = null;
        this.ctx.audio?.play('switch');
      }
    } else if (this.switchT < 1) {
      this.switchT = Math.min(1, this.switchT + dt * 6);
    }

    /* firing */
    if (input.fire && this.switchT >= 1) {
      const auto = def.kind === 'hitscan' && def.pellets === 1;
      if (auto || !this.fireHeld) this.tryFire(camera, player);
    }
    this.fireHeld = input.fire;

    /* spin down the chaingun barrels */
    if (def?.spins) {
      const target = input.fire && this.ammo[def.ammoType] > 0 ? 34 : 0;
      this.spinSpeed += (target - this.spinSpeed) * Math.min(1, dt * (target > this.spinSpeed ? 8 : 2.2));
      this.spin += this.spinSpeed * dt;
      const moving = this.current?.userData.parts?.moving;
      if (moving) moving.rotation.z = this.spin;
    }

    /* recoil spring */
    this.recoilPos.multiplyScalar(Math.max(0, 1 - dt * 13));
    this.recoilRot.multiplyScalar(Math.max(0, 1 - dt * 12));
    this.viewKick.multiplyScalar(Math.max(0, 1 - dt * 7));

    /* sway from mouse movement */
    this.swayTarget.x += (0 - this.swayTarget.x) * Math.min(1, dt * 6);
    this.swayTarget.y += (0 - this.swayTarget.y) * Math.min(1, dt * 6);
    this.sway.lerp(this.swayTarget, Math.min(1, dt * 9));

    /* bob */
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const grounded = player.onGround;
    if (grounded) this.bobT += dt * Math.min(speed, 12) * 1.5;
    const bobAmt = Math.min(speed / 8.4, 1.6) * (grounded ? 1 : 0.15);
    const bobX = Math.cos(this.bobT) * 0.014 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobT)) * -0.018 * bobAmt;

    /* landing dip */
    if (player.justLanded) this.landDip = Math.min(0.09, player.fallSpeed * 0.006);
    this.landDip *= Math.max(0, 1 - dt * 8);

    if (this.current && this.baseOffset) {
      const lower = (1 - this.switchT) * 0.42;
      this.current.position.set(
        this.baseOffset.x + bobX + this.sway.x - this.recoilPos.x,
        this.baseOffset.y + bobY + this.sway.y - lower - this.landDip - this.recoilPos.y * 0.4,
        this.baseOffset.z + this.recoilPos.z,
      );
      this.current.rotation.set(
        VM.pitch + this.recoilRot.x - this.sway.y * 1.4 - lower * 0.5,
        VM.yaw + this.recoilRot.y - this.sway.x * 1.6,
        this.recoilRot.z + this.sway.x * 0.9 + bobX * 1.5,
      );
    }
  }

  /** Feed mouse deltas in so the gun lags behind the view. */
  addLook(dx, dy) {
    this.swayTarget.x = THREE.MathUtils.clamp(this.swayTarget.x - dx * 0.02, -0.055, 0.055);
    this.swayTarget.y = THREE.MathUtils.clamp(this.swayTarget.y + dy * 0.02, -0.05, 0.05);
  }

  resetForLevel() {
    this.cooldown = 0;
    this.recoilPos.set(0, 0, 0);
    this.recoilRot.set(0, 0, 0);
    this.viewKick.set(0, 0);
  }
}
