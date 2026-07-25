/**
 * Game orchestration: the loop, the camera, waves, player state and the glue
 * between every subsystem.
 */
import * as THREE from 'three';
import { SURFACE, v3, vdistSq, traceRay, makeTrace } from '../core/physics.js';
import { PM, createPlayerState, playerMove, applyImpulse, fallDamage } from '../core/pmove.js';
import { WeaponSystem, ProjectileSystem, WEAPONS, WEAPON_BY_ID, AMMO } from './weapons.js';
import { EnemyManager, ENEMY_TYPES } from './enemies.js';
import { PickupManager, PICKUP_KINDS } from './pickups.js';
import { animateFlagpole } from './level.js';
import { applyArmor, splashFalloff } from './combat.js';
import { LEVELS } from './levels/index.js';
import { buildSanta } from '../models/santa.js';
import { cloneRig } from '../models/rig.js';
import { createSky, bakeEnvironment } from '../render/sky.js';

const MAX_HEALTH = 100;
const MAX_OVERHEAL = 200;
const MAX_ARMOR = 200;
const FIXED_DT = 1 / 120;

const _fwd = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tr = makeTrace();
const _pa = v3();
const _pb = v3();

export class Game {
  constructor({ view, fx, audio, hud, input }) {
    this.view = view;
    this.fx = fx;
    this.audio = audio;
    this.hud = hud;
    this.input = input;

    this.scene = view.scene;
    this.state = 'menu'; // menu | playing | paused | dead | victory
    this.levelIndex = 0;
    this.level = null;
    this.world = null;
    this.levelTitle = '';

    this.player = createPlayerState(v3(0, 2, 0));
    this.health = MAX_HEALTH;
    this.armor = 0;
    this.alive = true;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.startTime = 0;
    this.elapsed = 0;
    this.deaths = 0;
    this.hurtFlash = 0;
    this.healFlash = 0;
    this.deathT = 0;
    this.deathCause = '';
    this.powerups = [];
    this.crosshairHostile = false;
    this.dt = 0;

    this.wave = 0;
    this.totalWaves = 0;
    this.waveState = 'idle'; // idle | spawning | fighting | break | cleared
    this.waveTimer = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.enemiesRemaining = 0;
    this.mode = 'waves';
    this.boss = null;
    this.bossName = '';

    // Camera shake / kick
    this.shake = 0;
    this.shakeT = 0;
    this.viewKick = new THREE.Vector2();
    this.camRoll = 0;
    this.bobPhase = 0;
    this.stepPhase = 0;
    this.viewBobEnabled = true;

    this.sky = createSky();
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(0x18244a, 0.006);

    const ctx = {
      scene: this.scene,
      viewScene: view.viewScene,
      world: null,
      fx, audio,
      game: this,
      player: this.player,
      enemies: null,
      projectiles: null,
    };
    this.ctx = ctx;

    this.enemies = new EnemyManager(ctx);
    ctx.enemies = this.enemies;
    this.projectiles = new ProjectileSystem(this.scene, ctx);
    ctx.projectiles = this.projectiles;
    this.pickups = new PickupManager(ctx);
    this.weapons = new WeaponSystem(ctx);

    this.enemies.onKill = (e, meta) => this.onEnemyKilled(e, meta);

    // Third-person Santa, used for the death camera and the menu.
    this.santa = null;
    this.santaTime = 0;

    this.accum = 0;
    this.time = 0;
  }

  /* ================= level lifecycle ================= */

  get levelCount() { return LEVELS.length; }

  /**
   * Build everything that would otherwise be built lazily mid-fight. Enemy
   * prototypes paint canvas textures and merge geometry; the rocket clones a
   * model. Doing that on the first shield gingerbread of wave three is a
   * visible hitch, so it happens on the loading screen instead.
   */
  prewarm() {
    for (const type of Object.keys(ENEMY_TYPES)) this.enemies._proto(type);
    this.projectiles._presentMesh();
    this._santaProto();
  }

  /**
   * Force every shader the level needs to compile now. Called once per level
   * load, with one of each enemy parked in front of the camera so their
   * materials are compiled too.
   */
  warmupShaders() {
    // Go through the real spawn and fire paths and then draw an actual composed
    // frame with the results in shot. renderer.compile() alone misses the
    // shadow-depth variants, which is what made the first rocket of a session
    // stall for over a tenth of a second. Runs behind the loading screen.
    const cam = this.view.camera;
    cam.position.set(this.player.pos.x, this.player.pos.y + PM.eyeHeight, this.player.pos.z);
    cam.rotation.set(0, this.player.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    cam.getWorldDirection(_fwd);

    _tmp.copy(cam.position).addScaledVector(_fwd, 7);
    const spot = { x: _tmp.x, y: Math.max(_tmp.y - 1.6, this.player.pos.y), z: _tmp.z };

    let i = 0;
    for (const type of Object.keys(ENEMY_TYPES)) {
      this.enemies.spawn(type, { x: spot.x + (i++ - 2) * 1.5, y: spot.y, z: spot.z }, { silent: true });
    }
    _tmp2.set(spot.x, spot.y + 1, spot.z);
    this.projectiles.spawnPresent(_tmp2, _fwd, 'player');
    // Every pooled effect has to be drawn at least once or its material is
    // still uncompiled the first time a weapon uses it.
    const up = { x: 0, y: 1, z: 0 };
    this.fx.railBeam(cam.position, _tmp2);
    this.fx.explosion(_tmp2, { scale: 1 });
    this.fx.impact(_tmp2, up, { decal: true });
    this.fx.frostBurst(_tmp2, up, {});
    this.fx.crumbs(_tmp2, up, {});
    this.fx.decal(_tmp2, up, 1, 0.5);
    this.fx.gib(_tmp2, 6, 5, spot.y);
    this.fx.tracer(cam.position, _tmp2);
    this.fx.shell(_tmp2, {});
    this.fx.update(1 / 60, cam.position);

    this.view.warmup();
    this.view.render(0);

    for (const e of this.enemies.list) this.scene.remove(e.model);
    this.enemies.list.length = 0;
    this.projectiles.clear();
    this.fx.clearTransient();
  }

  loadLevel(index, onProgress = null) {
    this.unloadLevel();
    const def = LEVELS[index];
    if (!def) throw new Error(`no level ${index}`);
    this.levelIndex = index;
    this.levelTitle = def.title;

    onProgress?.(0.15, 'CARVING THE ARENA…');
    const built = def.build(this.scene);
    this.level = built;
    this.world = built.world;
    this.ctx.world = built.world;

    onProgress?.(0.6, 'HANGING THE LIGHTS…');
    // Sky + environment
    Object.assign(this.sky.material.uniforms, {});
    const sky = def.sky || {};
    const u = this.sky.userData.uniforms;
    if (sky.zenith) u.uZenith.value.set(sky.zenith);
    if (sky.horizon) u.uHorizon.value.set(sky.horizon);
    if (sky.ground) u.uGround.value.set(sky.ground);
    if (sky.aurora !== undefined) u.uAurora.value = sky.aurora;
    this.sky.visible = def.indoor !== true;
    this.scene.fog = new THREE.FogExp2(def.fogColor ?? 0x18244a, def.fogDensity ?? 0.006);

    if (def.light) {
      this.view.hemi.color.set(def.light.hemiSky ?? 0x8fbaff);
      this.view.hemi.groundColor.set(def.light.hemiGround ?? 0x2b3050);
      this.view.hemi.intensity = def.light.hemi ?? 0.55;
      this.view.ambient.color.set(def.light.ambientColor ?? 0x46567f);
      this.view.ambient.intensity = def.light.ambient ?? 0.55;
      this.view.moon.color.set(def.light.sunColor ?? 0xbfd4ff);
      this.view.moon.intensity = def.light.sun ?? 1.5;
      if (def.light.sunPos) this.view.moon.position.set(...def.light.sunPos);
      this.view.fill.intensity = def.light.fill ?? 0.28;
    }

    // Shadow camera follows the arena size.
    const size = built.bounds.max.clone().sub(built.bounds.min);
    this.view.setShadowExtent(Math.min(90, Math.max(30, Math.max(size.x, size.z) * 0.55)));

    if (!this.envMap) {
      this.envMap = bakeEnvironment(this.view.renderer, this.sky);
    }
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = def.envIntensity ?? 0.55;

    onProgress?.(0.8, 'WAKING THE GINGERBREAD…');
    for (const p of built.pickups) this.pickups.add(p.kind, p.x, p.y, p.z);
    this.view.assignLights(built.lightAnchors, new THREE.Vector3(0, 0, 0));

    // Waves
    this.mode = def.mode || 'waves';
    this.waves = def.waves || [];
    this.totalWaves = this.waves.length;
    this.wave = 0;
    this.waveState = 'idle';
    this.waveTimer = 2.2;
    this.enemiesRemaining = 0;
    this.boss = null;

    this.respawnPlayer(true);
    this.weapons.resetForLevel();
    onProgress?.(0.95, 'COMPILING SHADERS…');
    this.warmupShaders();
    onProgress?.(1, 'READY');
    return built;
  }

  unloadLevel() {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clearTransient();
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
  }

  restartLevel() {
    const i = this.levelIndex;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.elapsed = 0;
    this.resetLoadout();
    this.loadLevel(i);
    this.state = 'playing';
  }

  resetLoadout() {
    for (const w of WEAPONS) this.weapons.state[w.id].have = w.id === 'chaingun';
    this.weapons.ammo = { snowballs: 90, shells: 0, presents: 0, slugs: 0 };
    this.weapons.selectWeapon('chaingun', true);
  }

  respawnPlayer(fullReset = false) {
    const spawns = this.level?.playerSpawns || [];
    const s = spawns.length
      ? spawns[Math.floor(Math.random() * spawns.length)]
      : { pos: v3(0, 3, 0), yaw: 0 };
    const p = this.player;
    p.pos.x = s.pos.x; p.pos.y = s.pos.y; p.pos.z = s.pos.z;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.onGround = false;
    p.height = PM.height;
    p.eye = PM.eyeHeight;
    p.crouching = false;
    p.bhopChain = 0;
    p.time = 0;
    this.health = MAX_HEALTH;
    this.armor = 0;
    this.alive = true;
    this.deathT = 0;
    this.hurtFlash = 0;
    this.powerups.length = 0;
    if (fullReset) this.resetLoadout();
    if (this.santa) { this.scene.remove(this.santa); this.santa = null; }
  }

  /* ================= waves ================= */

  _updateWaves(dt) {
    if (this.mode === 'boss') return this._updateBossMode(dt);

    if (this.waveState === 'idle') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this._startWave(0);
      return;
    }

    if (this.waveState === 'spawning' || this.waveState === 'fighting') {
      // Trickle the queue in so a wave arrives as a stream, not a wall.
      if (this.spawnQueue.length) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          const type = this.spawnQueue.shift();
          this._spawnAtPoint(type);
          this.spawnTimer = 0.28 + Math.random() * 0.25;
        }
      } else if (this.waveState === 'spawning') {
        this.waveState = 'fighting';
      }
      this.enemiesRemaining = this.enemies.aliveCount + this.spawnQueue.length;
      if (this.waveState === 'fighting' && this.enemiesRemaining === 0) {
        if (this.wave >= this.totalWaves) {
          this._allWavesCleared();
        } else {
          this.waveState = 'break';
          this.waveTimer = 6;
          this.hud.centerMessage('WAVE CLEAR', 'Catch your breath', '#9ff2d6', 1800);
          this.audio.play('wave');
          this.pickups.resetAll();
        }
      }
      return;
    }

    if (this.waveState === 'break') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this._startWave(this.wave);
    }
  }

  _startWave(index) {
    const w = this.waves[index];
    if (!w) return;
    this.wave = index + 1;
    this.waveState = 'spawning';
    this.spawnQueue = [];
    for (const [type, count] of Object.entries(w.enemies)) {
      for (let i = 0; i < count; i++) this.spawnQueue.push(type);
    }
    // Shuffle so the mix arrives interleaved.
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]];
    }
    this.spawnTimer = 0.35;
    this.enemiesRemaining = this.spawnQueue.length;
    this.hud.centerMessage(`WAVE ${this.wave}`, w.name || '', '#ffd24a', 1900);
    this.audio.play('wave');
  }

  _allWavesCleared() {
    this.waveState = 'cleared';
    const fp = this.level.flagpole;
    if (fp) {
      fp.active = true;
      fp.model.visible = true;
      fp.model.scale.setScalar(0.01);
      this.hud.centerMessage('THE WAY IS OPEN', 'Reach the flagpole', '#ffd24a', 3000);
      this.audio.play('flagpole');
      this.fx.flash(fp.pos, { color: 0xffc24a, intensity: 30, range: 30, life: 0.7 });
      this.view.assignLights(this.level.lightAnchors, _tmp.set(fp.pos.x, fp.pos.y, fp.pos.z));
    } else {
      this.completeLevel();
    }
  }

  _updateBossMode(dt) {
    if (this.waveState === 'idle') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveState = 'fighting';
        const sp = this.level.enemySpawns.find((s) => s.tag === 'boss') || this.level.enemySpawns[0];
        this.boss = this.enemies.spawn('golem', sp.pos);
        this.bossName = this.boss.def.name;
        this.hud.centerMessage('THE GOLEM AWAKENS', 'Do not let it reach you', '#ff5a2a', 2600);
        this.audio.play('summon', sp.pos);
        this.audio.setMusicIntensity(1);
      }
      return;
    }
    if (this.waveState === 'fighting' && this.boss && !this.boss.alive) {
      this.waveState = 'dying';
      this.waveTimer = 2.6;
      this.hud.centerMessage('THE GOLEM FALLS', '', '#ffd24a', 3000);
    } else if (this.waveState === 'dying') {
      // Driven by the game clock, not a wall-clock timer, so it stays in step
      // with pausing and with the fixed simulation.
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this._allWavesCleared();
    }
    this.enemiesRemaining = this.enemies.aliveCount;
  }

  /** Spawn at the point furthest from the player that the player cannot see. */
  _spawnAtPoint(type) {
    const pts = this.level.enemySpawns.filter((s) => s.tag === 'any' || s.tag === type);
    const pool = pts.length ? pts : this.level.enemySpawns;
    if (!pool.length) return null;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 7; i++) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      const d = Math.sqrt(vdistSq(s.pos, this.player.pos));
      // Prefer 14-40m away, and out of sight.
      let score = -Math.abs(d - 24);
      _pa.x = s.pos.x; _pa.y = s.pos.y + 1.2; _pa.z = s.pos.z;
      _pb.x = this.player.pos.x; _pb.y = this.player.pos.y + this.player.eye; _pb.z = this.player.pos.z;
      traceRay(this.world, _pa, _pb, null, _tr);
      if (_tr.hit) score += 22;
      if (d < 9) score -= 90;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    const scale = 1 + Math.max(0, this.wave - 1) * 0.055;
    return this.enemies.spawn(type, best.pos, {
      hpScale: scale,
      speedScale: 1 + Math.max(0, this.wave - 1) * 0.018,
      yaw: Math.random() * 6.28,
    });
  }

  spawnMinion(pos, type = 'grunt') {
    return this.enemies.spawn(type, pos, { yaw: Math.random() * 6.28 });
  }

  onEnemyKilled(e, meta) {
    this.kills++;
    this.comboTimer = 3.2;
    this.combo++;
    const mult = 1 + Math.min(this.combo - 1, 9) * 0.1;
    const points = Math.round(e.def.score * mult);
    this.score += points;
    if (this.combo === 5) this.hud.toast('RAMPAGE  x1.5', '#ff6b6b');
    if (this.combo === 10) this.hud.toast('GINGERBREAD GENOCIDE  x2', '#ff3a3a');
    if (meta?.head) this.hud.toast(`HEADSHOT  +${points}`, '#ffd24a');
    if (e.def.boss) this.score += 5000;
  }

  /* ================= player damage ================= */

  hurtPlayer(amount, sourcePos = null, cause = 'enemy', opts = {}) {
    if (!this.alive || this.state !== 'playing') return;
    if (this.godMode) return;
    const res = applyArmor(this.health, this.armor, amount);
    this.health = res.health;
    this.armor = res.armor;
    this.hurtFlash = Math.min(1, this.hurtFlash + Math.min(0.85, amount / 45));
    this.shake = Math.min(1.2, this.shake + amount / 60);
    this.audio.play('hurt', null);

    if (opts.knockback) {
      applyImpulse(this.player, opts.knockback.x, opts.knockback.y, opts.knockback.z);
    }
    if (sourcePos) {
      const dx = sourcePos.x - this.player.pos.x;
      const dz = sourcePos.z - this.player.pos.z;
      // Angle relative to the view direction, for the on-screen arrow.
      const a = Math.atan2(dx, dz) - this.player.yaw + Math.PI;
      this.hud.damageFrom(a);
    }
    if (this.health <= 0) this.killPlayer(cause);
  }

  /** Rocket splash on the player: the source of rocket jumps. */
  splashPlayer(point, def) {
    _tmp.set(this.player.pos.x, this.player.pos.y + this.player.height * 0.5, this.player.pos.z);
    const d = _tmp.distanceTo(point);
    const k = splashFalloff(d, def.splashRadius);
    if (k <= 0) return;

    // Knockback is full strength; self damage is heavily reduced so rocket
    // jumping is a tool rather than a punishment.
    _tmp.sub(point);
    if (_tmp.lengthSq() < 1e-6) _tmp.set(0, 1, 0);
    _tmp.normalize();
    const push = def.selfKnockback * k;
    applyImpulse(this.player, _tmp.x * push, Math.max(_tmp.y, 0.35) * push, _tmp.z * push);

    const dmg = def.splashDamage * k * def.selfDamageScale;
    if (dmg > 1 && !this.godMode) {
      const res = applyArmor(this.health, this.armor, dmg);
      this.health = res.health;
      this.armor = res.armor;
      this.hurtFlash = Math.min(1, this.hurtFlash + dmg / 90);
      this.shake = Math.min(1.2, this.shake + dmg / 70);
      if (this.health <= 0) this.killPlayer('rocket jump');
    }
  }

  killPlayer(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.deaths++;
    this.deathCause = cause;
    this.deathT = 0;
    this.state = 'dead';
    this.audio.play('die', null);
    this.audio.setMusicIntensity(0);
    this.shake = 1.2;

    // Drop a third-person Santa where the player fell.
    const s = cloneRig(this._santaProto());
    s.position.set(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    s.rotation.y = this.player.yaw + Math.PI;
    s.rotation.z = 0;
    this.scene.add(s);
    this.santa = s;
    this.santaFall = 0;
    this.onDeath?.();
  }

  _santaProto() {
    if (!this._santa) this._santa = buildSanta();
    return this._santa;
  }

  /* ================= pickups ================= */

  tryCollect(p) {
    const d = p.def;
    if (d.type === 'health') {
      const cap = d.overheal ? MAX_OVERHEAL : MAX_HEALTH;
      if (this.health >= cap) return false;
      this.health = Math.min(cap, this.health + d.amount);
      this.healFlash = 0.7;
      this.hud.toast(`+${d.amount} ${d.label}`, '#ff6b76');
      this.audio.play(d.overheal ? 'powerup' : 'pickup', null);
      return true;
    }
    if (d.type === 'armor') {
      if (this.armor >= MAX_ARMOR) return false;
      this.armor = Math.min(MAX_ARMOR, this.armor + d.amount);
      this.healFlash = 0.5;
      this.hud.toast(`+${d.amount} ${d.label}`, '#6be09a');
      this.audio.play('pickup', null);
      return true;
    }
    if (d.type === 'ammo') {
      const got = this.weapons.giveAmmo(d.ammo, d.amount);
      if (got <= 0) return false;
      this.hud.toast(`+${got} ${d.label}`, '#bfe4ff');
      this.audio.play('pickup', null);
      this.weapons.autoSwitchIfEmpty();
      return true;
    }
    if (d.type === 'weapon') {
      const def = WEAPON_BY_ID[d.weapon];
      const isNew = this.weapons.giveWeapon(d.weapon);
      if (!isNew && this.weapons.ammo[def.ammoType] >= AMMO[def.ammoType].max) return false;
      if (!isNew) this.weapons.giveAmmo(def.ammoType, def.startAmmo);
      this.hud.toast(isNew ? `PICKED UP: ${def.name}` : `+${def.startAmmo} ${AMMO[def.ammoType].name}`,
        '#' + def.pickupColor.toString(16).padStart(6, '0'));
      this.audio.play('weapon', null);
      if (isNew) this.hud.centerMessage(def.name, 'Acquired', '#' + def.pickupColor.toString(16).padStart(6, '0'), 1500);
      return true;
    }
    if (d.type === 'powerup') {
      const existing = this.powerups.find((x) => x.id === d.power);
      if (existing) existing.time = d.duration;
      else {
        this.powerups.push({
          id: d.power, label: d.label, time: d.duration,
          color: '#' + d.halo.toString(16).padStart(6, '0'),
        });
      }
      this.hud.centerMessage(d.label, '', '#' + d.halo.toString(16).padStart(6, '0'), 1800);
      this.audio.play('powerup', null);
      this.healFlash = 1;
      return true;
    }
    return false;
  }

  hasPower(id) { return this.powerups.some((p) => p.id === id); }

  hitMarker() {
    this.shotsHit++;
    this.hud.hitMarker();
    this.audio.play('hitmark', null);
  }

  /* ================= per-frame ================= */

  update(dtRaw) {
    this.dt = dtRaw;
    this.time += dtRaw;
    this.sky.userData.update(this.time);

    if (this.state === 'playing') {
      this.elapsed += dtRaw;
      this._simulate(dtRaw);
    } else if (this.state === 'dead') {
      this._simulateDead(dtRaw);
    }

    // Effects always tick so explosions finish while paused-to-dead.
    this.fx.update(dtRaw, this.view.camera.position);
    this._updateCamera(dtRaw);

    this.hurtFlash = Math.max(0, this.hurtFlash - dtRaw * 1.7);
    this.healFlash = Math.max(0, this.healFlash - dtRaw * 2.2);
    this.view.setHurt(this.hurtFlash);
    this.view.setHeal(this.healFlash);

    if (this.state === 'playing' || this.state === 'dead') this.hud.update(this);
  }

  _simulate(dt) {
    const p = this.player;
    const input = this.input;

    // Powerups
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pw = this.powerups[i];
      pw.time -= dt;
      if (pw.time <= 0) {
        this.hud.toast(`${pw.label} expired`, pw.color);
        this.powerups.splice(i, 1);
      }
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    /* ---- fixed-step movement ---- */
    const haste = this.hasPower('haste');
    this.accum += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accum >= FIXED_DT && steps < 12) {
      this.accum -= FIXED_DT;
      steps++;
      const cmd = {
        forward: input.forward,
        right: input.right,
        jump: input.jump,
        crouch: input.crouch,
      };
      const before = p.vel.y;
      if (haste) {
        PM.maxSpeed = 11.4;
        PM.accelerate = 15;
      } else {
        PM.maxSpeed = 8.4;
        PM.accelerate = 12;
      }
      playerMove(this.world, p, cmd, FIXED_DT, { noclip: this.noclip });

      if (p.justJumped) {
        this.audio.play('jump', null);
        this.weapons.landDip = Math.max(this.weapons.landDip, 0.012);
      }
      if (p.justLanded) {
        const power = Math.min(1.4, p.fallSpeed / 14);
        this.audio.play('land', null, { power });
        this.shake = Math.min(1, this.shake + power * 0.16);
        const dmg = fallDamage(p.fallSpeed);
        if (dmg > 0) this.hurtPlayer(dmg, null, 'a nasty landing');
      }
      this._checkJumpPads();
      this._checkHazards(FIXED_DT);
      // Footsteps
      if (p.onGround && p.speed > 1.5) {
        this.stepPhase += p.speed * FIXED_DT * 0.62;
        if (this.stepPhase > 1) { this.stepPhase -= 1; this.audio.play('step', null); }
      }
    }

    /* ---- world ---- */
    this.enemies.update(dt, p);
    this.projectiles.update(dt);
    this.pickups.update(dt, p);
    this.weapons.update(dt, {
      fire: input.fire && this.alive,
    }, p, this.view.camera);
    this.shotsFired = this.weapons.shotsFired;

    this._updateWaves(dt);
    this._checkFlagpole(dt);
    this._updateCrosshairTarget();

    // Music intensity tracks how much trouble the player is in.
    const threat = Math.min(1, this.enemies.aliveCount / 9) * 0.6
      + (1 - Math.min(1, this.health / 100)) * 0.4;
    this.audio.setMusicIntensity(this.mode === 'boss' ? 1 : threat);

    // Fell out of the world.
    if (p.pos.y < (this.level?.killY ?? -45)) {
      this.hurtPlayer(9999, null, 'the abyss');
    }
  }

  _simulateDead(dt) {
    this.deathT += dt;
    this.enemies.update(dt, this.player);
    this.projectiles.update(dt);
    if (this.santa) {
      // Topple over.
      this.santaFall = Math.min(1, this.santaFall + dt * 1.6);
      const k = 1 - (1 - this.santaFall) * (1 - this.santaFall);
      this.santa.rotation.x = -k * Math.PI * 0.5;
      this.santa.position.y = this.player.pos.y + Math.sin(k * Math.PI) * 0.15;
    }
  }

  _checkJumpPads() {
    const p = this.player;
    for (const pad of this.level.jumpPads) {
      const dx = p.pos.x - pad.pos.x;
      const dz = p.pos.z - pad.pos.z;
      const dy = p.pos.y - pad.pos.y;
      if (dx * dx + dz * dz < pad.radius * pad.radius && dy > -1.0 && dy < 2.0) {
        if (pad._cool > 0) continue;
        pad._cool = 0.3;
        p.vel.y = pad.push;
        if (pad.forward) {
          // A targeted pad *sets* the horizontal velocity (Quake's trigger_push
          // does the same) so the arc always lands where the level intends;
          // air control still lets you steer once you are up there.
          if (pad.target) {
            p.vel.x = pad.forward.x;
            p.vel.z = pad.forward.z;
          } else {
            p.vel.x += pad.forward.x;
            p.vel.z += pad.forward.z;
          }
        }
        p.onGround = false;
        p.lastGroundTime = -10;
        this.audio.play('jumppad', pad.pos);
        this.fx.flash(pad.pos, { color: 0x9ff2d6, intensity: 12, range: 10, life: 0.25 });
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          this.fx.particle({
            add: true,
            x: pad.pos.x + Math.cos(a) * 0.8, y: pad.pos.y + 0.2, z: pad.pos.z + Math.sin(a) * 0.8,
            vx: Math.cos(a) * 2, vy: 7 + Math.random() * 6, vz: Math.sin(a) * 2,
            life: 0.55, size: 2.8, endSize: 0.4, color: 0x9ff2d6, alpha: 1, endAlpha: 0, drag: 1.1,
          });
        }
      }
    }
    for (const pad of this.level.jumpPads) {
      if (pad._cool > 0) pad._cool -= FIXED_DT;
    }
  }

  _checkHazards(dt) {
    const p = this.player;
    if ((p.groundSurface & SURFACE.HURT) && p.onGround) {
      this._hazardT = (this._hazardT ?? 0) + dt;
      if (this._hazardT > 0.4) {
        this._hazardT = 0;
        this.hurtPlayer(12, null, 'the freezing water');
      }
    }
  }

  _checkFlagpole(dt) {
    const fp = this.level?.flagpole;
    if (!fp || !fp.active) return;
    animateFlagpole(fp, this.time);
    if (fp.model.scale.x < 1) fp.model.scale.setScalar(Math.min(1, fp.model.scale.x + dt * 1.6));
    const dx = this.player.pos.x - fp.pos.x;
    const dz = this.player.pos.z - fp.pos.z;
    const dy = this.player.pos.y - fp.pos.y;
    if (dx * dx + dz * dz < fp.radius * fp.radius && dy > -2 && dy < 11) {
      fp.active = false;
      this.completeLevel();
    }
  }

  _updateCrosshairTarget() {
    this.view.camera.getWorldDirection(_fwd);
    _tmp.set(this.player.pos.x, this.player.pos.y + this.player.eye, this.player.pos.z);
    let hostile = false;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      _tmp2.set(e.pos.x - _tmp.x, e.pos.y + e.height * 0.5 - _tmp.y, e.pos.z - _tmp.z);
      const d = _tmp2.length();
      if (d > 90) continue;
      _tmp2.divideScalar(d);
      if (_tmp2.dot(_fwd) > 1 - (e.radius / Math.max(d, 1)) * 0.9) { hostile = true; break; }
    }
    this.crosshairHostile = hostile;
  }

  completeLevel() {
    if (this.state !== 'playing') return;
    this.state = 'victory';
    this.audio.play('victory', null);
    this.audio.setMusicIntensity(0);
    this.onVictory?.();
  }

  /* ================= camera ================= */

  _updateCamera(dt) {
    const cam = this.view.camera;
    const p = this.player;

    if (this.state === 'dead') {
      // Slump to the ground, then orbit the fallen Santa.
      const k = Math.min(1, this.deathT / 1.1);
      const eye = PM.eyeHeight * (1 - k) + 0.5 * k;
      const orbit = Math.max(0, this.deathT - 1.1) * 0.35;
      const dist = Math.min(4.5, 0.2 + Math.max(0, this.deathT - 0.8) * 3.2);
      const a = p.yaw + orbit;
      cam.position.set(
        p.pos.x + Math.sin(a) * dist,
        p.pos.y + eye + Math.min(1.6, this.deathT * 1.1),
        p.pos.z + Math.cos(a) * dist,
      );
      cam.lookAt(p.pos.x, p.pos.y + 0.7, p.pos.z);
      this._applyShake(dt, cam);
      return;
    }

    // Recoil kick decays into the aim.
    this.viewKick.lerp(this.weapons.viewKick, Math.min(1, dt * 22));

    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (this.viewBobEnabled && p.onGround) this.bobPhase += dt * Math.min(speed, 13) * 1.35;
    const bobAmt = this.viewBobEnabled ? Math.min(speed / 8.4, 1.5) * (p.onGround ? 1 : 0.12) : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.035 * bobAmt;
    const bobX = Math.cos(this.bobPhase) * 0.022 * bobAmt;

    cam.position.set(p.pos.x + bobX, p.pos.y + p.eye + bobY, p.pos.z);

    // Roll into strafes, Quake style.
    const rightVec = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
    const lateral = p.vel.x * rightVec.x + p.vel.z * rightVec.z;
    const targetRoll = THREE.MathUtils.clamp(-lateral * 0.0055, -0.055, 0.055);
    this.camRoll += (targetRoll - this.camRoll) * Math.min(1, dt * 8);

    cam.rotation.order = 'YXZ';
    cam.rotation.y = p.yaw;
    cam.rotation.x = p.pitch + this.viewKick.y;
    cam.rotation.z = this.camRoll + this.viewKick.x * 0.4;

    // Speed FOV kick.
    const extra = THREE.MathUtils.clamp((speed - 8.4) * 0.95, 0, 16);
    this.view.applyFovBoost(extra);
    this.view.setAberration(Math.min(0.004, extra * 0.00022));

    this._applyShake(dt, cam);

    // Viewmodel camera stays at the origin; sync its FOV feel.
    this.view.viewCamera.position.set(0, 0, 0);
    this.view.viewCamera.rotation.set(0, 0, 0);
  }

  _applyShake(dt, cam) {
    if (this.shake <= 0.001) return;
    this.shakeT += dt * 42;
    const s = this.shake * this.shake * 0.16;
    cam.position.x += Math.sin(this.shakeT * 1.7) * s;
    cam.position.y += Math.sin(this.shakeT * 2.3 + 1.1) * s;
    cam.position.z += Math.sin(this.shakeT * 1.3 + 2.4) * s;
    cam.rotation.z += Math.sin(this.shakeT * 2.9) * s * 0.5;
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  /* ================= look input ================= */

  addLook(dx, dy, sens) {
    if (this.state !== 'playing' || !this.alive) return;
    const p = this.player;
    p.yaw -= dx * sens * 0.0011;
    p.pitch -= dy * sens * 0.0011;
    p.pitch = THREE.MathUtils.clamp(p.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    while (p.yaw > Math.PI) p.yaw -= Math.PI * 2;
    while (p.yaw < -Math.PI) p.yaw += Math.PI * 2;
    this.weapons.addLook(dx * sens * 0.0011, dy * sens * 0.0011);
  }

  get accuracy() {
    return this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
  }
}
