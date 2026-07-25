/**
 * Floating pickups: health, armour, ammo, weapons and the Christmas Spirit
 * powerup. Quake rules -- they bob, spin, glow, and respawn on a timer.
 */
import * as THREE from 'three';
import {
  MAT, PALETTE, candyMat, glowMat, emissiveMat, stdMat, physMat,
  sphere, cylinder, box, roundedBox, cone, torus, lathe, mesh, group, shadowize, TEX, mulberry32,
} from '../render/materials.js';
import { buildWeaponPickup } from '../models/weapons.js';
import { cloneRig } from '../models/rig.js';

export const PICKUP_KINDS = {
  health_small: { type: 'health', amount: 15, respawn: 18, halo: 0xff5a6a, label: 'Cookie' },
  health_large: { type: 'health', amount: 40, respawn: 32, halo: 0xff3a4a, label: 'Milk & Cookies' },
  health_mega: { type: 'health', amount: 100, overheal: true, respawn: 75, halo: 0xffd24a, label: 'Christmas Feast' },
  armor_small: { type: 'armor', amount: 25, respawn: 22, halo: 0x66d98a, label: 'Gumdrop Plate' },
  armor_large: { type: 'armor', amount: 75, respawn: 42, halo: 0x33e08a, label: 'Gingerbread Armour' },
  ammo_snowballs: { type: 'ammo', ammo: 'snowballs', amount: 75, respawn: 22, halo: 0xbfe4ff, label: 'Snowballs' },
  ammo_shells: { type: 'ammo', ammo: 'shells', amount: 10, respawn: 24, halo: 0xff8888, label: 'Peppermints' },
  ammo_presents: { type: 'ammo', ammo: 'presents', amount: 6, respawn: 28, halo: 0x88e8a8, label: 'Presents' },
  ammo_slugs: { type: 'ammo', ammo: 'slugs', amount: 5, respawn: 32, halo: 0x9ff2d6, label: 'Icicles' },
  weapon_shotgun: { type: 'weapon', weapon: 'shotgun', respawn: 30, halo: 0xff6b6b },
  weapon_launcher: { type: 'weapon', weapon: 'launcher', respawn: 35, halo: 0x66d98a },
  weapon_rail: { type: 'weapon', weapon: 'rail', respawn: 40, halo: 0x9ff2d6 },
  spirit: { type: 'powerup', power: 'spirit', duration: 22, respawn: 90, halo: 0xffd24a, label: 'CHRISTMAS SPIRIT' },
  haste: { type: 'powerup', power: 'haste', duration: 20, respawn: 80, halo: 0x8ad8ff, label: 'REINDEER HASTE' },
};

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

const protoCache = new Map();

function haloRing(color, r = 0.55) {
  const g = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.72, r, 32),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }),
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = 0.02;
  g.renderOrder = 4;
  return g;
}

function pillarGlow(color, h = 1.1, r = 0.42) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.25, h, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.055, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }),
  );
  m.position.y = h / 2;
  m.renderOrder = 3;
  return m;
}

function buildCookiePlate(big) {
  const g = new THREE.Group();
  const s = big ? 1.25 : 0.85;
  // Plate
  g.add(mesh(lathe([[0, 0], [0.34, 0.008], [0.36, 0.05], [0.33, 0.06], [0.3, 0.02], [0, 0.02]], 28),
    physMat('pk_plate', { color: 0xf2f4f8, roughness: 0.22, clearcoat: 0.7 }), { pos: [0, 0, 0], scale: s }));
  // Cookies
  const R = mulberry32(9);
  const cookieMat = stdMat('pk_cookie', { ...TEX.gingerbread(1), roughness: 0.85 });
  for (let i = 0; i < (big ? 4 : 2); i++) {
    const a = (i / (big ? 4 : 2)) * Math.PI * 2 + 0.4;
    const c = mesh(cylinder(0.11, 0.11, 0.035, 16), cookieMat,
      { pos: [Math.cos(a) * 0.13 * s, (0.07 + i * 0.012) * s, Math.sin(a) * 0.13 * s], scale: s });
    c.rotation.z = (R() - 0.5) * 0.3;
    g.add(c);
    // chocolate chips
    for (let j = 0; j < 4; j++) {
      const ca = R() * 6.28, cr = R() * 0.07;
      g.add(mesh(sphere(0.016, 8, 6), stdMat('pk_chip', { color: 0x3a2115, roughness: 0.5 }), {
        pos: [Math.cos(a) * 0.13 * s + Math.cos(ca) * cr * s,
          (0.09 + i * 0.012) * s, Math.sin(a) * 0.13 * s + Math.sin(ca) * cr * s],
        scale: s,
      }));
    }
  }
  if (big) {
    // Glass of milk
    const glass = mesh(cylinder(0.1, 0.085, 0.26, 20, true),
      physMat('pk_glass', {
        color: 0xffffff, roughness: 0.05, transmission: 0.9, thickness: 0.2,
        ior: 1.45, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      }), { pos: [0, 0.19, -0.02] });
    g.add(glass);
    g.add(mesh(cylinder(0.088, 0.08, 0.2, 18), stdMat('pk_milk', { color: 0xfdfcf7, roughness: 0.6 }),
      { pos: [0, 0.16, -0.02] }));
  }
  return g;
}

function buildFeast() {
  const g = new THREE.Group();
  // Golden dome cloche over a turkey-shaped roast
  g.add(mesh(lathe([[0, 0], [0.34, 0], [0.35, 0.04], [0.33, 0.05], [0, 0.05]], 28), MAT.gold));
  g.add(mesh(sphere(0.22, 20, 14), stdMat('pk_roast', { color: 0xc98a48, roughness: 0.55 }),
    { pos: [0, 0.16, 0], scale: [1.2, 0.8, 1] }));
  g.add(mesh(lathe([[0.3, 0], [0.31, 0.12], [0.24, 0.3], [0.1, 0.38], [0.04, 0.4], [0, 0.42]], 28),
    physMat('pk_cloche', {
      color: 0xffd98a, metalness: 0.9, roughness: 0.16, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide,
    }), { pos: [0, 0.05, 0] }));
  g.add(mesh(sphere(0.05, 12, 8), MAT.gold, { pos: [0, 0.48, 0] }));
  return g;
}

function buildArmorPickup(big) {
  const g = new THREE.Group();
  const s = big ? 1.15 : 0.82;
  // A gingerbread breastplate with gumdrop studs and icing filigree
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, -0.32);
  shape.bezierCurveTo(-0.36, 0.1, -0.28, 0.3, -0.12, 0.34);
  shape.lineTo(-0.05, 0.24);
  shape.lineTo(0.05, 0.24);
  shape.lineTo(0.12, 0.34);
  shape.bezierCurveTo(0.28, 0.3, 0.36, 0.1, 0.3, -0.32);
  shape.bezierCurveTo(0.16, -0.42, -0.16, -0.42, -0.3, -0.32);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 16,
  });
  const plate = mesh(geo, big ? MAT.gingerbread : MAT.gingerbreadBurnt, { pos: [0, 0.42 * s, 0], scale: s });
  g.add(plate);
  const studCols = [PALETTE.gumdropRed, PALETTE.gumdropGreen, PALETTE.gumdropPurple];
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + i * 0.25;
    g.add(mesh(sphere(0.045, 12, 9), candyMat(studCols[i % 3]),
      { pos: [Math.sin(a) * 0.2 * s, (0.42 + Math.cos(a) * 0.16) * s, 0.09 * s], scale: s }));
  }
  g.add(mesh(torus(0.24, 0.016, 8, 26), MAT.icing, { pos: [0, 0.42 * s, 0.06 * s], scale: s }));
  return g;
}

function buildAmmoBox(kind) {
  const g = new THREE.Group();
  const def = PICKUP_KINDS[kind];
  const col = def.halo;
  g.add(mesh(roundedBox(0.5, 0.34, 0.36, 0.04), MAT.wood, { pos: [0, 0.17, 0] }));
  g.add(mesh(roundedBox(0.52, 0.06, 0.38, 0.02), MAT.woodDark, { pos: [0, 0.35, 0] }));
  // Metal banding
  for (const x of [-0.2, 0.2]) {
    g.add(mesh(box(0.03, 0.36, 0.38), MAT.steelDark, { pos: [x, 0.18, 0] }));
  }
  // Contents peeking out of the lid
  if (def.ammo === 'snowballs') {
    const R = mulberry32(3);
    for (let i = 0; i < 7; i++) {
      g.add(mesh(sphere(0.075, 12, 9), MAT.snow,
        { pos: [(R() - 0.5) * 0.34, 0.4 + R() * 0.05, (R() - 0.5) * 0.24] }));
    }
  } else if (def.ammo === 'shells') {
    for (let i = 0; i < 5; i++) {
      g.add(mesh(cylinder(0.05, 0.05, 0.16, 14), MAT.candy,
        { pos: [-0.16 + i * 0.08, 0.44, 0], rot: [0.1, i * 0.4, 0] }));
    }
  } else if (def.ammo === 'presents') {
    const cols = [[0xc4162a, 0xf0c05a], [0x1f6b45, 0xfdfaf5], [0x2b4fa0, 0xf0c05a]];
    for (let i = 0; i < 3; i++) {
      const [bg, fg] = cols[i];
      g.add(mesh(roundedBox(0.17, 0.17, 0.17, 0.02),
        stdMat(`pk_wrap${i}`, { ...TEX.wrapping(bg, fg, i + 1), roughness: 0.55 }),
        { pos: [-0.14 + i * 0.14, 0.44, 0], rot: [0, i * 0.5, 0] }));
    }
  } else {
    for (let i = 0; i < 4; i++) {
      g.add(mesh(cone(0.045, 0.3, 8), MAT.ice, { pos: [-0.12 + i * 0.08, 0.46, 0], rot: [Math.PI, 0, 0.1] }));
    }
  }
  // Colour-coded glow strip
  g.add(mesh(box(0.44, 0.05, 0.02), emissiveMat(`pk_strip${kind}`, col, 3), { pos: [0, 0.12, 0.19] }));
  return g;
}

function buildPowerup(power) {
  const g = new THREE.Group();
  if (power === 'spirit') {
    // A radiant five-point star
    const shape = new THREE.Shape();
    const spikes = 5, outer = 0.34, inner = 0.15;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.09, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2,
    });
    geo.center();
    g.add(mesh(geo, stdMat('pk_star', {
      color: 0xffe9a8, emissive: 0xffc24a, emissiveIntensity: 2.6, roughness: 0.25, metalness: 0.6,
    }), { pos: [0, 0.55, 0] }));
  } else {
    // Reindeer haste: winged horseshoe of antlers
    g.add(mesh(torus(0.26, 0.05, 10, 26), stdMat('pk_haste', {
      color: 0xbfe4ff, emissive: 0x4aa8ff, emissiveIntensity: 2.4, roughness: 0.3, metalness: 0.4,
    }), { pos: [0, 0.55, 0], rot: [Math.PI / 2, 0, 0] }));
    for (const s of [-1, 1]) {
      g.add(mesh(cone(0.06, 0.34, 8), stdMat('pk_hastewing', {
        color: 0xeaf6ff, emissive: 0x88ccff, emissiveIntensity: 1.8, roughness: 0.4,
      }), { pos: [s * 0.3, 0.72, 0], rot: [0, 0, -s * 0.7] }));
    }
  }
  return g;
}

function buildPickupModel(kind) {
  if (protoCache.has(kind)) return protoCache.get(kind);
  const def = PICKUP_KINDS[kind];
  let inner;
  if (def.type === 'health') {
    inner = kind === 'health_mega' ? buildFeast() : buildCookiePlate(kind === 'health_large');
  } else if (def.type === 'armor') {
    inner = buildArmorPickup(kind === 'armor_large');
  } else if (def.type === 'ammo') {
    inner = buildAmmoBox(kind);
  } else if (def.type === 'weapon') {
    inner = buildWeaponPickup(def.weapon);
  } else {
    inner = buildPowerup(def.power);
  }
  shadowize(inner, true, false);
  const g = new THREE.Group();
  g.add(inner); // always children[0]
  g.add(haloRing(def.halo, def.type === 'weapon' ? 0.85 : 0.6));
  g.add(pillarGlow(def.halo, def.type === 'powerup' ? 1.1 : 0.75, def.type === 'weapon' ? 0.44 : 0.32));
  protoCache.set(kind, g);
  return g;
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

export class PickupManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.time = 0;
  }

  add(kind, x, y, z) {
    const def = PICKUP_KINDS[kind];
    if (!def) throw new Error(`unknown pickup: ${kind}`);
    const proto = buildPickupModel(kind);
    const model = cloneRig(proto); // sanitises userData so clone() is safe
    model.position.set(x, y, z);
    this.ctx.scene.add(model);
    const p = {
      kind, def, model,
      inner: model.children[0],
      pos: new THREE.Vector3(x, y, z),
      active: true, respawnT: 0,
      phase: Math.random() * 6.28,
      radius: def.type === 'weapon' ? 1.5 : 1.25,
    };
    this.list.push(p);
    return p;
  }

  update(dt, player) {
    this.time += dt;
    for (const p of this.list) {
      if (!p.active) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          p.active = true;
          p.model.visible = true;
          p.model.scale.setScalar(0.01);
          this.ctx.fx.flash(p.pos, { color: p.def.halo, intensity: 8, range: 7, life: 0.3 });
          this.ctx.audio?.play('respawn', p.pos);
        }
        continue;
      }

      // Idle animation
      const t = this.time + p.phase;
      if (p.inner) {
        p.inner.rotation.y = t * (p.def.type === 'powerup' ? 1.5 : 0.9);
        p.inner.position.y = Math.sin(t * 1.7) * 0.09;
      }
      if (p.model.scale.x < 1) p.model.scale.setScalar(Math.min(1, p.model.scale.x + dt * 4));

      // Pickup test (generous vertical range so it works while jumping)
      const dx = player.pos.x - p.pos.x;
      const dz = player.pos.z - p.pos.z;
      const dy = (player.pos.y + player.height * 0.5) - (p.pos.y + 0.7);
      if (dx * dx + dz * dz < p.radius * p.radius && Math.abs(dy) < 1.7) {
        if (this.ctx.game.tryCollect(p)) this._consume(p);
      }
    }
  }

  _consume(p) {
    p.active = false;
    p.model.visible = false;
    p.respawnT = p.def.respawn;
    this.ctx.fx.flash(p.pos, { color: p.def.halo, intensity: 12, range: 8, life: 0.25 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.ctx.fx.particle({
        add: true,
        x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z,
        vx: Math.cos(a) * 3, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 3,
        life: 0.5, size: 2.6, endSize: 0.2, color: p.def.halo, alpha: 1, endAlpha: 0, drag: 2.4,
      });
    }
  }

  clear() {
    for (const p of this.list) this.ctx.scene.remove(p.model);
    this.list.length = 0;
  }

  resetAll() {
    for (const p of this.list) {
      p.active = true;
      p.model.visible = true;
      p.model.scale.setScalar(1);
      p.respawnT = 0;
    }
  }
}
