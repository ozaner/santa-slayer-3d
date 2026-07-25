/**
 * Pooled particle, tracer, decal and debris effects.
 *
 * Everything is preallocated: one THREE.Points for all particles, one
 * LineSegments for all tracers, a fixed ring of decal quads and a small pool of
 * flash lights. Nothing allocates during combat.
 */
import * as THREE from 'three';
import { PALETTE, mulberry32 } from './materials.js';

const PARTICLE_VERT = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is in "decimetres-ish" game units; uScale converts to pixels for the
  // current viewport height. Clamped so a particle spawned in the player's face
  // cannot swallow the screen.
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.05), 1.0, 130.0);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */`
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.02, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}
`;

const MAX_PARTICLES = 3000;
const MAX_TRACERS = 64;
const MAX_DECALS = 96;
const MAX_DEBRIS = 120;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _forwardZ = new THREE.Vector3(0, 0, 1);

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.rand = mulberry32(1234);

    /* ---------- particles ---------- */
    const pgeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 4);
    this.pSize = new Float32Array(MAX_PARTICLES);
    pgeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pgeo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 4));
    pgeo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    pgeo.setDrawRange(0, 0);
    pgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.sizeUniform = { value: 8 };
    this.pMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uScale: this.sizeUniform },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: true,
    });
    this.pMatAdd = this.pMat.clone();
    this.pMatAdd.uniforms.uScale = this.sizeUniform;
    this.pMatAdd.blending = THREE.AdditiveBlending;
    this.setViewportHeight(window.innerHeight);

    this.points = new THREE.Points(pgeo, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);

    // Additive layer for sparks/fire drawn on top.
    const ageo = pgeo.clone();
    this.aPos = ageo.attributes.position.array;
    this.aCol = ageo.attributes.aColor.array;
    this.aSize = ageo.attributes.aSize.array;
    ageo.setDrawRange(0, 0);
    ageo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.pointsAdd = new THREE.Points(ageo, this.pMatAdd);
    this.pointsAdd.frustumCulled = false;
    this.pointsAdd.renderOrder = 11;
    scene.add(this.pointsAdd);

    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false, add: false,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, endSize: 0,
        r: 1, g: 1, b: 1, a: 1, endA: 0,
        gravity: 0, drag: 0.1, floor: -1e9, bounce: 0,
      });
    }
    this.pCursor = 0;

    /* ---------- tracers ---------- */
    const tgeo = new THREE.BufferGeometry();
    this.tPos = new Float32Array(MAX_TRACERS * 6);
    this.tCol = new Float32Array(MAX_TRACERS * 6);
    tgeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    tgeo.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3));
    tgeo.setDrawRange(0, 0);
    tgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.tracerMesh = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 12;
    scene.add(this.tracerMesh);
    this.tracers = [];

    /* ---------- rail beams (tube meshes, richer than a line) ----------
     * Pooled rather than allocated per shot: a fresh material has to be
     * compiled the first time it is drawn, which stalled the first rail shot.
     */
    this.beams = [];
    this.beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.beamGeo.rotateX(Math.PI / 2); // aim down +Z
    this.beamPool = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({
        color: 0x9ff2d6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      }));
      m.visible = false;
      m.renderOrder = 12;
      m.frustumCulled = false;
      scene.add(m);
      this.beamPool.push({ mesh: m, life: 0, maxLife: 1, active: false });
    }
    this.beamCursor = 0;

    /* ---------- decals ---------- */
    this.decals = [];
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalPool = [];
    const scorchTex = makeScorchTexture();
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({
        map: scorchTex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        opacity: 0, toneMapped: true, color: 0xffffff,
      }));
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.decalPool.push(m);
    }
    this.decalCursor = 0;

    /* ---------- debris (cookie chunks) ---------- */
    this.debris = [];
    this.debrisPool = [];
    this.debrisCursor = 0;
    this.debrisReady = false;

    /* ---------- flash lights ----------
     * Borrowed from the View's fixed pool. Toggling a light's `visible` (or
     * adding one) changes three's light counts and recompiles every shader in
     * the scene, so these are only ever faded to intensity 0.
     */
    this.flashes = [];
    this.projLights = [];
    this.flashCursor = 0;

    /* ---------- shockwave shells ---------- */
    this.shells = [];
    const shellGeo = new THREE.SphereGeometry(1, 20, 12);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
        color: 0xffd18a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.BackSide, toneMapped: false,
      }));
      m.visible = false;
      m.renderOrder = 9;
      scene.add(m);
      this.shells.push({ mesh: m, life: 0, maxLife: 1, from: 0, to: 1 });
    }
    this.shellCursor = 0;

    /* ---------- snowfall ---------- */
    this.snow = null;
  }

  /**
   * Hand the effects system its share of the renderer's fixed light pool.
   * The first few become flash lights, the rest follow live projectiles.
   */
  useLights(lights) {
    this.flashes = [];
    this.projLights = [];
    lights.forEach((l, i) => {
      l.intensity = 0;
      if (i < lights.length - 2) this.flashes.push({ light: l, life: 0, maxLife: 1, peak: 0 });
      else this.projLights.push({ light: l, owner: null });
    });
    this.flashCursor = 0;
  }

  /** Borrow a light to follow a projectile. Returns null if all are busy. */
  acquireProjLight(owner, color, intensity, distance) {
    for (const p of this.projLights) {
      if (p.owner) continue;
      p.owner = owner;
      p.light.color.set(color);
      p.light.intensity = intensity;
      p.light.distance = distance;
      return p;
    }
    return null;
  }

  releaseProjLight(owner) {
    for (const p of this.projLights) {
      if (p.owner === owner) { p.owner = null; p.light.intensity = 0; }
    }
  }

  /** Keep particle sizes resolution independent. */
  setViewportHeight(h) {
    this.sizeUniform.value = 8 * (h / 720);
  }

  /** Cookie-shard debris needs the enemy model module, so it is injected. */
  initDebris(chunkGeos, material) {
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const g = chunkGeos[i % chunkGeos.length];
      const m = new THREE.Mesh(g, material);
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      this.scene.add(m);
      this.debrisPool.push(m);
      this.debris.push({ mesh: m, active: false, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, av: new THREE.Vector3(), floor: 0 });
    }
    this.debrisReady = true;
  }

  /* ================= spawners ================= */

  _nextParticle() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const idx = (this.pCursor + i) % MAX_PARTICLES;
      if (!this.particles[idx].active) {
        this.pCursor = (idx + 1) % MAX_PARTICLES;
        return this.particles[idx];
      }
    }
    // Everything is busy: steal the oldest slot.
    const p = this.particles[this.pCursor];
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    return p;
  }

  particle(opts) {
    const p = this._nextParticle();
    p.active = true;
    p.add = !!opts.add;
    p.x = opts.x; p.y = opts.y; p.z = opts.z;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0; p.vz = opts.vz || 0;
    p.life = 0;
    p.maxLife = opts.life ?? 1;
    p.size = opts.size ?? 6;
    p.endSize = opts.endSize ?? p.size * 0.2;
    const c = opts.color instanceof THREE.Color ? opts.color : new THREE.Color(opts.color ?? 0xffffff);
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.a = opts.alpha ?? 1;
    p.endA = opts.endAlpha ?? 0;
    p.gravity = opts.gravity ?? 0;
    p.drag = opts.drag ?? 0.6;
    p.floor = opts.floor ?? -1e9;
    p.bounce = opts.bounce ?? 0;
    return p;
  }

  /** Big festive explosion: fireball, ribbons, sparks, smoke, light, shell. */
  explosion(pos, { scale = 1, color = 0xffb04a, ribbons = true } = {}) {
    const R = this.rand;
    // Fireball core
    for (let i = 0; i < 26; i++) {
      const s = R() * 2 - 1, t = R() * Math.PI * 2, u = Math.sqrt(1 - s * s);
      const sp = (2 + R() * 7) * scale;
      this.particle({
        add: true,
        x: pos.x, y: pos.y, z: pos.z,
        vx: u * Math.cos(t) * sp, vy: s * sp + 1.5, vz: u * Math.sin(t) * sp,
        life: 0.28 + R() * 0.3, size: (5.5 + R() * 4.5) * scale, endSize: 1.4 * scale,
        color: i % 3 === 0 ? 0xfff0c0 : color, alpha: 1, endAlpha: 0,
        gravity: -2, drag: 3.2,
      });
    }
    // Smoke puffs
    for (let i = 0; i < 14; i++) {
      const t = R() * Math.PI * 2;
      const sp = (1 + R() * 3) * scale;
      this.particle({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(t) * sp, vy: 1 + R() * 2.5, vz: Math.sin(t) * sp,
        life: 0.9 + R() * 0.8, size: (6 + R() * 6) * scale, endSize: (15 + R() * 9) * scale,
        color: 0x54575e, alpha: 0.5, endAlpha: 0,
        gravity: 1.1, drag: 1.4,
      });
    }
    // Sparks
    for (let i = 0; i < 30; i++) {
      const s = R() * 2 - 1, t = R() * Math.PI * 2, u = Math.sqrt(1 - s * s);
      const sp = (6 + R() * 16) * scale;
      this.particle({
        add: true,
        x: pos.x, y: pos.y, z: pos.z,
        vx: u * Math.cos(t) * sp, vy: s * sp + 3, vz: u * Math.sin(t) * sp,
        life: 0.5 + R() * 0.7, size: 1.1 + R() * 1.1, endSize: 0.25,
        color: R() > 0.5 ? 0xffe9a8 : 0xff8a3c, alpha: 1, endAlpha: 0,
        gravity: -13, drag: 0.35, floor: pos.y - 3, bounce: 0.3,
      });
    }
    // Shredded wrapping-paper ribbons: the signature of a present exploding.
    if (ribbons) {
      const cols = [PALETTE.candyRed, PALETTE.candyGreen, PALETTE.gold, PALETTE.icingBlue, PALETTE.candyWhite];
      for (let i = 0; i < 24; i++) {
        const s = R() * 2 - 1, t = R() * Math.PI * 2, u = Math.sqrt(1 - s * s);
        const sp = (4 + R() * 11) * scale;
        this.particle({
          x: pos.x, y: pos.y, z: pos.z,
          vx: u * Math.cos(t) * sp, vy: s * sp + 5, vz: u * Math.sin(t) * sp,
          life: 1.4 + R() * 1.4, size: 1.8 + R() * 1.6, endSize: 1.3,
          color: cols[(R() * cols.length) | 0], alpha: 1, endAlpha: 0,
          gravity: -9, drag: 1.6, floor: pos.y - 4, bounce: 0.25,
        });
      }
    }
    this.flash(pos, { color: 0xffb257, intensity: 26 * scale, life: 0.32, range: 22 * scale });
    this.shell(pos, { from: 0.4 * scale, to: 4.6 * scale, life: 0.28, color: 0xffd18a, opacity: 0.55 });
  }

  /** Puff of snow/frost. */
  frostBurst(pos, normal, { scale = 1, color = 0xd8f2ff } = {}) {
    const R = this.rand;
    for (let i = 0; i < 16; i++) {
      const sp = (1.5 + R() * 5) * scale;
      this.particle({
        add: true,
        x: pos.x, y: pos.y, z: pos.z,
        vx: (normal.x + (R() - 0.5)) * sp, vy: (normal.y + (R() - 0.5)) * sp + 1, vz: (normal.z + (R() - 0.5)) * sp,
        life: 0.35 + R() * 0.5, size: (2 + R() * 2.6) * scale, endSize: 0.5,
        color, alpha: 0.95, endAlpha: 0, gravity: -4, drag: 2.2,
      });
    }
  }

  /** Cookie crumbs when a gingerbread takes a hit. */
  crumbs(pos, normal, { count = 12, scale = 1 } = {}) {
    const R = this.rand;
    for (let i = 0; i < count; i++) {
      const sp = 2 + R() * 6;
      this.particle({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (normal.x + (R() - 0.5) * 1.2) * sp,
        vy: (normal.y + (R() - 0.5) * 1.2) * sp + 2,
        vz: (normal.z + (R() - 0.5) * 1.2) * sp,
        life: 0.5 + R() * 0.6, size: (1.1 + R() * 1.3) * scale, endSize: 0.6,
        color: R() > 0.35 ? PALETTE.ginger : (R() > 0.5 ? PALETTE.gingerDark : PALETTE.icing),
        alpha: 1, endAlpha: 0, gravity: -16, drag: 0.9,
      });
    }
  }

  /** Impact on world geometry: dust + a scorch decal. */
  impact(pos, normal, { color = 0xd9d2c4, decal = true, scale = 1 } = {}) {
    const R = this.rand;
    for (let i = 0; i < 9; i++) {
      const sp = 1 + R() * 4;
      this.particle({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (normal.x + (R() - 0.5)) * sp, vy: (normal.y + (R() - 0.5)) * sp + 0.6, vz: (normal.z + (R() - 0.5)) * sp,
        life: 0.3 + R() * 0.4, size: (1.3 + R() * 1.8) * scale, endSize: 0.5,
        color, alpha: 0.75, endAlpha: 0, gravity: -6, drag: 2.5,
      });
    }
    if (decal) this.decal(pos, normal, 0.4 + R() * 0.25, 0.55);
  }

  decal(pos, normal, size, opacity = 0.8, color = 0x000000) {
    const m = this.decalPool[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decalPool.length;
    m.visible = true;
    m.position.set(pos.x + normal.x * 0.012, pos.y + normal.y * 0.012, pos.z + normal.z * 0.012);
    _v.set(normal.x, normal.y, normal.z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v);
    m.rotateZ(this.rand() * Math.PI * 2);
    m.scale.setScalar(size);
    m.material.opacity = opacity;
    m.material.color.set(color);
    const rec = { mesh: m, life: 0, maxLife: 14, start: opacity };
    this.decals.push(rec);
    if (this.decals.length > MAX_DECALS) this.decals.shift();
  }

  tracer(from, to, color = 0xfff0c0, life = 0.06) {
    this.tracers.push({
      x1: from.x, y1: from.y, z1: from.z,
      x2: to.x, y2: to.y, z2: to.z,
      r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255,
      life: 0, maxLife: life,
    });
    if (this.tracers.length > MAX_TRACERS) this.tracers.shift();
  }

  /** Fat glowing rail beam with a spiral of frost particles along it. */
  railBeam(from, to, color = 0x9ff2d6, life = 0.55) {
    const b = this.beamPool[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beamPool.length;
    const mesh = b.mesh;
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    mesh.position.set(from.x, from.y, from.z);
    _v.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
    mesh.quaternion.setFromUnitVectors(_forwardZ, _v);
    mesh.scale.set(1, 1, dist);
    mesh.material.color.set(color);
    mesh.material.opacity = 0.9;
    mesh.visible = true;
    b.life = 0;
    b.maxLife = life;
    b.active = true;

    // Helix of frost motes along the beam.
    const steps = Math.min(46, Math.max(8, Math.floor(dist * 2.2)));
    const R = this.rand;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const ang = t * 22;
      const px = from.x + (to.x - from.x) * t;
      const py = from.y + (to.y - from.y) * t;
      const pz = from.z + (to.z - from.z) * t;
      this.particle({
        add: true,
        x: px + Math.cos(ang) * 0.12, y: py + Math.sin(ang) * 0.12, z: pz,
        vx: (R() - 0.5) * 0.6, vy: (R() - 0.5) * 0.6 + 0.3, vz: (R() - 0.5) * 0.6,
        life: 0.4 + R() * 0.5, size: 1.3 + R() * 1.3, endSize: 0,
        color, alpha: 0.9, endAlpha: 0, gravity: 0.4, drag: 1.1,
      });
    }
  }

  flash(pos, { color = 0xffaa44, intensity = 12, life = 0.12, range = 14 } = {}) {
    if (!this.flashes.length) return;
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.light.color.set(color);
    f.light.distance = range;
    f.light.position.set(pos.x, pos.y, pos.z);
    f.life = 0;
    f.maxLife = life;
    f.peak = intensity;
  }

  shell(pos, { from = 0.3, to = 4, life = 0.3, color = 0xffd18a, opacity = 0.5 } = {}) {
    const s = this.shells[this.shellCursor];
    this.shellCursor = (this.shellCursor + 1) % this.shells.length;
    s.mesh.position.set(pos.x, pos.y, pos.z);
    s.mesh.visible = true;
    s.mesh.material.color.set(color);
    s.from = from; s.to = to; s.life = 0; s.maxLife = life; s.opacity = opacity;
  }

  /** Fling cookie shards from a dying enemy. */
  gib(pos, count = 8, force = 9, floorY = 0) {
    if (!this.debrisReady) return;
    const R = this.rand;
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
      d.active = true;
      d.life = 0;
      d.maxLife = 4 + R() * 2;
      d.floor = floorY;
      d.mesh.visible = true;
      d.mesh.position.set(pos.x + (R() - 0.5) * 0.3, pos.y + R() * 0.9, pos.z + (R() - 0.5) * 0.3);
      d.mesh.rotation.set(R() * 6.28, R() * 6.28, R() * 6.28);
      const s = R() * 2 - 1, t = R() * Math.PI * 2, u = Math.sqrt(1 - s * s);
      const sp = force * (0.4 + R() * 0.9);
      d.vx = u * Math.cos(t) * sp;
      d.vy = Math.abs(s) * sp * 0.7 + 3;
      d.vz = u * Math.sin(t) * sp;
      d.av.set((R() - 0.5) * 18, (R() - 0.5) * 18, (R() - 0.5) * 18);
      d.mesh.scale.setScalar(0.7 + R() * 0.8);
    }
  }

  /* ---------- snowfall ---------- */

  createSnowfall({ count = 2600, box = 60, speed = 2.2 } = {}) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 4);
    const size = new Float32Array(count);
    const R = mulberry32(4242);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (R() - 0.5) * box;
      pos[i * 3 + 1] = R() * box * 0.7;
      pos[i * 3 + 2] = (R() - 0.5) * box;
      const b = 0.62 + R() * 0.22;
      col[i * 4] = b; col[i * 4 + 1] = b; col[i * 4 + 2] = b * 1.05;
      col[i * 4 + 3] = 0.22 + R() * 0.38;
      size[i] = 0.7 + R() * 1.5;
      phase[i] = R() * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Points(geo, this.pMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.scene.add(mesh);
    this.snow = { mesh, pos, phase, count, box, speed, geo };
    return mesh;
  }

  updateSnow(dt, camPos) {
    const s = this.snow;
    if (!s) return;
    const { pos, phase, count, box } = s;
    const half = box / 2;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3 + 1] -= (s.speed * (0.5 + (i % 7) * 0.12)) * dt;
      pos[i3] += Math.sin(this.time * 0.7 + phase[i]) * 0.32 * dt;
      pos[i3 + 2] += Math.cos(this.time * 0.55 + phase[i] * 1.3) * 0.32 * dt;
      // Wrap around the camera so the volume follows the player.
      let dx = pos[i3] - camPos.x;
      let dy = pos[i3 + 1] - camPos.y;
      let dz = pos[i3 + 2] - camPos.z;
      if (dy < -half * 0.5) { pos[i3 + 1] = camPos.y + half * 0.85; dy = half * 0.85; }
      if (dx > half) pos[i3] -= box; else if (dx < -half) pos[i3] += box;
      if (dz > half) pos[i3 + 2] -= box; else if (dz < -half) pos[i3 + 2] += box;
    }
    s.geo.attributes.position.needsUpdate = true;
  }

  /* ================= update ================= */

  update(dt, camPos) {
    this.time += dt;
    let n = 0, na = 0;
    const P = this.particles;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = P[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; continue; }
      const t = p.life / p.maxLife;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag; p.vz *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        if (p.bounce > 0 && Math.abs(p.vy) > 0.4) {
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.6; p.vz *= 0.6;
        } else { p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; }
      }
      const size = p.size + (p.endSize - p.size) * t;
      const alpha = p.a + (p.endA - p.a) * t;
      if (p.add) {
        const i3 = na * 3, i4 = na * 4;
        this.aPos[i3] = p.x; this.aPos[i3 + 1] = p.y; this.aPos[i3 + 2] = p.z;
        this.aCol[i4] = p.r; this.aCol[i4 + 1] = p.g; this.aCol[i4 + 2] = p.b; this.aCol[i4 + 3] = alpha;
        this.aSize[na] = size;
        na++;
      } else {
        const i3 = n * 3, i4 = n * 4;
        this.pPos[i3] = p.x; this.pPos[i3 + 1] = p.y; this.pPos[i3 + 2] = p.z;
        this.pCol[i4] = p.r; this.pCol[i4 + 1] = p.g; this.pCol[i4 + 2] = p.b; this.pCol[i4 + 3] = alpha;
        this.pSize[n] = size;
        n++;
      }
    }
    const pg = this.points.geometry;
    pg.setDrawRange(0, n);
    pg.attributes.position.needsUpdate = true;
    pg.attributes.aColor.needsUpdate = true;
    pg.attributes.aSize.needsUpdate = true;
    const ag = this.pointsAdd.geometry;
    ag.setDrawRange(0, na);
    ag.attributes.position.needsUpdate = true;
    ag.attributes.aColor.needsUpdate = true;
    ag.attributes.aSize.needsUpdate = true;

    /* tracers */
    let tn = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life += dt;
      if (t.life >= t.maxLife) { this.tracers.splice(i, 1); continue; }
    }
    for (const t of this.tracers) {
      if (tn >= MAX_TRACERS) break;
      const k = 1 - t.life / t.maxLife;
      const i6 = tn * 6;
      this.tPos[i6] = t.x1; this.tPos[i6 + 1] = t.y1; this.tPos[i6 + 2] = t.z1;
      this.tPos[i6 + 3] = t.x2; this.tPos[i6 + 4] = t.y2; this.tPos[i6 + 5] = t.z2;
      this.tCol[i6] = t.r * k; this.tCol[i6 + 1] = t.g * k; this.tCol[i6 + 2] = t.b * k;
      this.tCol[i6 + 3] = t.r * k * 0.3; this.tCol[i6 + 4] = t.g * k * 0.3; this.tCol[i6 + 5] = t.b * k * 0.3;
      tn++;
    }
    const tg = this.tracerMesh.geometry;
    tg.setDrawRange(0, tn * 2);
    tg.attributes.position.needsUpdate = true;
    tg.attributes.color.needsUpdate = true;

    /* beams */
    for (const b of this.beamPool) {
      if (!b.active) continue;
      b.life += dt;
      const k = 1 - b.life / b.maxLife;
      if (k <= 0) { b.active = false; b.mesh.visible = false; continue; }
      b.mesh.material.opacity = k * 0.9;
      const s = 0.35 + k * 0.9;
      b.mesh.scale.x = s;
      b.mesh.scale.y = s;
    }

    /* decals */
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life += dt;
      if (d.life >= d.maxLife) {
        d.mesh.visible = false;
        this.decals.splice(i, 1);
        continue;
      }
      const k = d.life / d.maxLife;
      d.mesh.material.opacity = d.start * (1 - Math.max(0, (k - 0.6) / 0.4));
    }

    /* debris */
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      d.life += dt;
      if (d.life >= d.maxLife) { d.active = false; d.mesh.visible = false; continue; }
      d.vy -= 20 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      if (d.mesh.position.y < d.floor + 0.05) {
        d.mesh.position.y = d.floor + 0.05;
        if (Math.abs(d.vy) > 1) { d.vy = -d.vy * 0.32; d.vx *= 0.55; d.vz *= 0.55; d.av.multiplyScalar(0.5); }
        else { d.vy = 0; d.vx *= 0.85; d.vz *= 0.85; d.av.multiplyScalar(0.85); }
      }
      d.mesh.rotation.x += d.av.x * dt;
      d.mesh.rotation.y += d.av.y * dt;
      d.mesh.rotation.z += d.av.z * dt;
      const fade = d.life / d.maxLife;
      if (fade > 0.8) d.mesh.scale.setScalar(Math.max(0.01, (1 - (fade - 0.8) / 0.2)));
    }

    /* flashes -- faded to zero, never hidden */
    for (const f of this.flashes) {
      if (f.peak <= 0) continue;
      f.life += dt;
      if (f.life >= f.maxLife) { f.light.intensity = 0; f.peak = 0; continue; }
      const k = 1 - f.life / f.maxLife;
      f.light.intensity = f.peak * k * k;
    }

    /* shockwave shells */
    for (const s of this.shells) {
      if (!s.mesh.visible) continue;
      s.life += dt;
      if (s.life >= s.maxLife) { s.mesh.visible = false; continue; }
      const k = s.life / s.maxLife;
      s.mesh.scale.setScalar(s.from + (s.to - s.from) * (1 - (1 - k) * (1 - k)));
      s.mesh.material.opacity = s.opacity * (1 - k);
    }

    if (camPos) this.updateSnow(dt, camPos);
  }

  clearTransient() {
    for (const p of this.particles) p.active = false;
    this.tracers.length = 0;
    for (const b of this.beamPool) { b.active = false; b.mesh.visible = false; }
    for (const d of this.decals) d.mesh.visible = false;
    this.decals.length = 0;
    for (const d of this.debris) { d.active = false; d.mesh.visible = false; }
    for (const f of this.flashes) { f.light.intensity = 0; f.peak = 0; }
    for (const p of this.projLights) { p.owner = null; p.light.intensity = 0; }
    for (const s of this.shells) s.mesh.visible = false;
  }
}

function makeScorchTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // ragged edge
  const R = mulberry32(7);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2;
    const r = size * (0.3 + R() * 0.22);
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, size * (0.05 + R() * 0.11), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
