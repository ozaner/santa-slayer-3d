/**
 * Level 1 -- The North Pole Village.
 *
 * An open snowy arena built for movement: a ring of gingerbread houses with
 * walkable roofs, rooftop bridges, a frozen pond that kills your friction, and
 * candy-cane jump pads that let a confident player spend most of the fight in
 * the air.
 */
import * as THREE from 'three';
import { SURFACE } from '../../core/physics.js';
import { LevelBuilder, buildFlagpole } from '../level.js';
import { MAT, PALETTE, stdMat, TEX } from '../../render/materials.js';
import {
  buildGingerHouse, buildPineTree, buildGiantChristmasTree, buildLampPost,
  buildCandyArch, buildJumpPad, buildCrate, buildSleigh, buildFence,
  buildSnowDrift, buildToySoldier,
} from '../../models/props.js';

const HOUSES = [
  { x: -26, z: -26, w: 13, d: 11, rot: 0.18, seed: 1 },
  { x: 26, z: -26, w: 12, d: 12, rot: -0.22, seed: 2 },
  { x: -26, z: 26, w: 12, d: 12, rot: -0.1, seed: 3 },
  { x: 26, z: 26, w: 14, d: 10, rot: 0.14, seed: 4 },
];

export function buildVillage(scene) {
  const B = new LevelBuilder(scene, { cellSize: 12 });
  const snow = MAT.snow;
  const ice = MAT.ice;

  /* ---------------- ground + perimeter ---------------- */
  B.floor(0, 0, 130, 130, 0, { material: snow, uvScale: 8 });

  // Snow cliffs boxing the arena in.
  const R = 56, H = 22;
  B.wall(0, -R, 130, 8, H, 0, { material: snow, uvScale: 8 });
  B.wall(0, R, 130, 8, H, 0, { material: snow, uvScale: 8 });
  B.wall(-R, 0, 8, 130, H, 0, { material: snow, uvScale: 8 });
  B.wall(R, 0, 8, 130, H, 0, { material: snow, uvScale: 8 });
  // Ceiling clip so a rocket jump cannot escape the level.
  B.clip(0, 46, 0, 130, 2, 130);

  /* ---------------- the frozen pond ---------------- */
  // Recessed basin: a shallow lip you step down into, then slick ice.
  B.floor(-32, 12, 26, 22, -0.35, { material: ice, uvScale: 9, surface: SURFACE.ICE });
  for (const [dx, dz, sx, sz] of [[0, -11.6, 27, 1.6], [0, 11.6, 27, 1.6], [-13.6, 0, 1.6, 24], [13.6, 0, 1.6, 24]]) {
    B.box(-32 + dx, 0.1, 12 + dz, sx, 0.7, sz, { material: snow, uvScale: 3 });
  }

  /* ---------------- the great tree ---------------- */
  const tree = buildGiantChristmasTree({ h: 21 });
  B.prop(tree, 0, 0, 0);
  // Trunk collision only -- the branches are cosmetic so the plaza stays open.
  B.clip(0, 10, 0, 2.2, 20, 2.2);
  // Octagonal plinth from overlapping slabs.
  for (let i = 0; i < 4; i++) {
    B.box(0, 0.35, 0, 13, 0.7, 6.5, { material: MAT.wood, uvScale: 3, rotY: (i / 4) * Math.PI });
  }
  B.light(0, 14, 0, { color: 0xffd18a, intensity: 6, distance: 40 });

  /* ---------------- houses + rooftops ---------------- */
  for (const h of HOUSES) {
    const house = buildGingerHouse({ w: h.w, d: h.d, h: 5, seed: h.seed });
    B.prop(house, h.x, 0, h.z, h.rot);
    const size = house.userData.size || { w: h.w, d: h.d, h: 5 };
    const roofY = house.userData.roofY ?? 8.2;
    const c = Math.abs(Math.cos(h.rot)), s = Math.abs(Math.sin(h.rot));
    const ex = size.w * c + size.d * s;
    const ez = size.w * s + size.d * c;
    // Walls, then a two-step approximation of the pitched roof.
    B.clip(h.x, size.h / 2, h.z, ex, size.h, ez);
    const rise = roofY - size.h;
    B.clip(h.x, size.h + rise * 0.25, h.z, ex * 0.98, rise * 0.5, ez * 0.98);
    B.clip(h.x, size.h + rise * 0.72, h.z, ex * 0.55, rise * 0.45, ez * 0.55);
    h.roofY = roofY;
    h.ex = ex; h.ez = ez;
  }

  // Rooftop bridges: candy-striped planks between neighbouring houses.
  const bridgeMat = stdMat('vl_bridge', { ...TEX.wood(PALETTE.wood, 3, 3), roughness: 0.8 });
  const BY = 5.6;
  B.box(0, BY, -26, 40, 0.5, 3.4, { material: bridgeMat, uvScale: 3 });
  B.box(0, BY, 26, 40, 0.5, 3.4, { material: bridgeMat, uvScale: 3 });
  B.box(-26, BY, 0, 3.4, 0.5, 40, { material: bridgeMat, uvScale: 3 });
  B.box(26, BY, 0, 3.4, 0.5, 40, { material: bridgeMat, uvScale: 3 });
  // Low railings so you feel the edge without being caged.
  for (const [x, z, sx, sz] of [[0, -26, 40, 0.28], [0, 26, 40, 0.28], [-26, 0, 0.28, 40], [26, 0, 0.28, 40]]) {
    const ox = sx > sz ? 0 : 1.75;
    const oz = sx > sz ? 1.75 : 0;
    B.box(x - ox, BY + 0.65, z - oz, sx, 0.8, sz, { material: MAT.candy, uvScale: 1.5 });
    B.box(x + ox, BY + 0.65, z + oz, sx, 0.8, sz, { material: MAT.candy, uvScale: 1.5 });
  }

  /* ---------------- the watchtower (rail spot) ---------------- */
  B.box(0, 3.5, -42, 14, 7, 10, { material: MAT.gingerWall, uvScale: 4 });
  B.box(0, 7.4, -42, 15.5, 0.8, 11.5, { material: MAT.wood, uvScale: 3 });
  B.stairs(0, -34, 6, 7.8, 8, 14, 'z', { material: MAT.wood, uvScale: 2 });
  for (const s of [-1, 1]) {
    B.prop(buildToySoldier({ h: 3.4 }), s * 5.5, 7.8, -37.5, Math.PI);
  }

  /* ---------------- crates + cover ---------------- */
  const crateSpots = [
    [8, 12, 0.3], [10.5, 13.5, 1.1], [9, 15.5, 0.7],
    [-12, -8, 0.2], [-14, -9.5, 0.9],
    [16, -12, 0.5], [18, -13, 0.1], [17, -14.5, 1.2],
    [-8, 34, 0.4], [-10, 35, 1.0],
    [36, 6, 0.6], [37.5, 8, 0.2],
    [-38, -18, 0.8], [-36, -20, 0.3],
  ];
  crateSpots.forEach(([x, z, rot], i) => {
    const s = 1.6;
    B.prop(buildCrate({ s, seed: i + 1 }), x, 0, z, rot);
    B.clip(x, s / 2, z, s * 1.05, s, s * 1.05);
  });
  // A stack you can hop up.
  B.prop(buildCrate({ s: 1.6, seed: 21 }), 10.5, 1.6, 13.5, 0.5);
  B.clip(10.5, 2.4, 13.5, 1.7, 1.6, 1.7);

  /* ---------------- jump pads ---------------- */
  const padSpots = [
    { x: -14, z: -14, push: 15.5 },
    { x: 14, z: 14, push: 15.5 },
    { x: -20, z: 26, push: 14 },
    { x: 20, z: -20, push: 14 },
    { x: -32, z: 12, push: 17 }, // out of the pond
  ];
  for (const p of padSpots) {
    const pad = buildJumpPad({ r: 1.35 });
    B.jumpPad(p.x, 0.05, p.z, { push: p.push, model: pad, radius: 1.7 });
  }

  /* ---------------- decoration ---------------- */
  for (const [x, z, r] of [[-44, 34, 0], [44, -38, 1], [-46, -34, 2], [42, 40, 3], [-4, -20, 4], [6, 44, 5]]) {
    B.prop(buildPineTree({ h: 8 + (r % 3) * 2.5, seed: r + 1 }), x, 0, z, r * 0.7);
    B.clip(x, 3, z, 1.2, 6, 1.2);
  }
  for (const [x, z, rot] of [[-12, 4, 0], [12, -4, 0], [4, 20, 0], [-20, -2, 0], [30, 18, 0.4], [-30, -30, 0.8]]) {
    B.prop(buildLampPost({ h: 5.5 }), x, 0, z, rot);
    B.clip(x, 2.75, z, 0.5, 5.5, 0.5);
  }
  B.prop(buildCandyArch({ w: 7, h: 5.5 }), 0, 0, -16, 0);
  B.prop(buildCandyArch({ w: 7, h: 5.5 }), 0, 0, 16, 0);
  B.prop(buildCandyArch({ w: 7, h: 5.5 }), -16, 0, 0, Math.PI / 2);
  B.prop(buildCandyArch({ w: 7, h: 5.5 }), 16, 0, 0, Math.PI / 2);
  for (const [x, z] of [[-3.5, -16], [3.5, -16], [-3.5, 16], [3.5, 16]]) B.clip(x, 2.5, z, 0.7, 5, 0.7);
  for (const [x, z] of [[-16, -3.5], [-16, 3.5], [16, -3.5], [16, 3.5]]) B.clip(x, 2.5, z, 0.7, 5, 0.7);

  B.prop(buildSleigh(), 34, 0, -30, -0.6);
  B.clip(34, 0.8, -30, 4, 1.6, 2.4);

  for (let i = 0; i < 7; i++) {
    B.prop(buildFence({ len: 8, seed: i + 1 }), -44 + i * 2, 0, 44 - i * 0.5, 0.1);
  }
  for (const [x, z, r, s] of [[-46, 6, 4, 1], [45, 22, 3.4, 2], [-20, 46, 5, 3], [24, -46, 4.4, 4], [-40, -46, 3.6, 5]]) {
    B.prop(buildSnowDrift({ r, seed: s }), x, 0, z);
  }

  /* ---------------- flagpole ---------------- */
  B.box(0, 0.5, 40, 9, 1, 9, { material: MAT.gingerWall, uvScale: 3 });
  B.setFlagpole(buildFlagpole(), 0, 1, 40);

  /* ---------------- spawns ---------------- */
  B.spawn(0, 0.2, 14, Math.PI);
  B.spawn(-18, 0.2, -8, -2.2);
  B.spawn(18, 0.2, 8, 1.1);
  B.spawn(0, 8.2, -42, 0);

  const ring = [
    [-40, -40], [40, -40], [-40, 40], [40, 40],
    [-14, -46], [0, 46], [-49, 1], [46, 0],
    [-30, 8], [30, -8], [12, 34], [-12, -34],
    [36, 26], [-36, -26], [22, -34], [-22, 34],
  ];
  for (const [x, z] of ring) B.enemySpawn(x, 0.4, z);
  // A couple of rooftop spawns so the high ground is never fully safe.
  B.enemySpawn(-26, 6.2, 0);
  B.enemySpawn(26, 6.2, 0);

  /* ---------------- pickups ---------------- */
  B.pickup('weapon_shotgun', -32, 0.2, 12);       // out on the ice
  B.pickup('weapon_launcher', 1.6, 6.3, -25.4);       // north bridge
  B.pickup('weapon_rail', 0, 8.2, -42);           // watchtower
  B.pickup('armor_large', 26, 6.3, 0);            // east bridge
  B.pickup('armor_small', -12, 0.2, -12);
  B.pickup('armor_small', 12, 0.2, 12);
  B.pickup('health_mega', 0, 6.3, 26);            // south bridge, exposed
  B.pickup('health_large', -26, 0.2, 8);
  B.pickup('health_large', 26, 0.2, -8);
  B.pickup('health_small', 8, 0.2, -18);
  B.pickup('health_small', -8, 0.2, 18);
  B.pickup('health_small', 34, 0.2, 34);
  B.pickup('health_small', -34, 0.2, -34);
  B.pickup('ammo_snowballs', 10, 0.2, 4);
  B.pickup('ammo_snowballs', -10, 0.2, -4);
  B.pickup('ammo_snowballs', -28.3, 0.2, 33);
  B.pickup('ammo_shells', -28, 0.2, 16);
  B.pickup('ammo_shells', 18.4, 0.2, 19.4);
  B.pickup('ammo_presents', 4, 6.3, -26);
  B.pickup('ammo_presents', -18.8, 0.2, -18.8);
  B.pickup('ammo_slugs', 4, 8.2, -42);
  B.pickup('ammo_slugs', 30, 0.2, -34);
  B.pickup('spirit', 0, 0.9, 5.2);                // at the tree's foot, wide open
  B.pickup('haste', -33.2, 0.1, 21.2);                // middle of the ice

  return B.finish();
}
