/**
 * Level 2 -- Santa's Workshop.
 *
 * Tight, warm and vertical: a two-storey toy factory of catwalks, conveyors and
 * crate stacks. Corridors and sightlines are short, so the shotgun and the
 * launcher come into their own and the rail is a reward for holding a catwalk.
 */
import * as THREE from 'three';
import { SURFACE } from '../../core/physics.js';
import { LevelBuilder, buildFlagpole } from '../level.js';
import { MAT, PALETTE, stdMat, emissiveMat, TEX, mesh } from '../../render/materials.js';
import {
  buildWorkbench, buildConveyor, buildCrate, buildToySoldier, buildPineTree,
  buildJumpPad, buildIcicleCluster, buildLampPost,
} from '../../models/props.js';

export function buildWorkshop(scene) {
  const B = new LevelBuilder(scene, { cellSize: 10 });

  const floorMat = stdMat('ws_floor', { ...TEX.wood(0x5a4230, 4, 8), roughness: 0.72 });
  const wallMat = stdMat('ws_wall', { ...TEX.gingerWall(3), roughness: 0.85 });
  const steel = MAT.steelDark;

  const W = 78, D = 62, H = 17;

  /* ---------------- shell ---------------- */
  B.floor(0, 0, W, D, 0, { material: floorMat, uvScale: 5 });
  B.box(0, H + 1, 0, W, 2, D, { material: MAT.woodDark, uvScale: 6, cast: false }); // ceiling
  B.wall(0, -D / 2, W, 3, H, 0, { material: wallMat, uvScale: 5 });
  B.wall(0, D / 2, W, 3, H, 0, { material: wallMat, uvScale: 5 });
  B.wall(-W / 2, 0, 3, D, H, 0, { material: wallMat, uvScale: 5 });
  B.wall(W / 2, 0, 3, D, H, 0, { material: wallMat, uvScale: 5 });

  // Roof trusses (decor + a little shadow interest)
  for (let i = -3; i <= 3; i++) {
    B.box(i * 11, H - 0.4, 0, 0.5, 0.8, D - 4, { material: MAT.woodDark, uvScale: 3, collide: false });
  }
  // Warm hanging lamps
  for (const [x, z] of [[-24, -16], [0, -16], [24, -16], [-24, 16], [0, 16], [24, 16], [0, 0]]) {
    B.box(x, H - 1.6, z, 1.6, 0.35, 1.6, { material: emissiveMat('ws_lamp', 0xffbb66, 2.4), uvScale: 1, collide: false, cast: false });
    B.light(x, H - 2.2, z, { color: 0xffb066, intensity: 9, distance: 26 });
  }

  /* ---------------- upper catwalk ring ---------------- */
  const CY = 7.2;
  const catMat = stdMat('ws_grate', { ...TEX.metal(0x6b7280, 4), roughness: 0.62, metalness: 0.7 });
  const ring = [
    [0, -24, 62, 5], [0, 24, 62, 5],
    [-29, 0, 5, 43], [29, 0, 5, 43],
  ];
  for (const [x, z, sx, sz] of ring) {
    B.box(x, CY, z, sx, 0.5, sz, { material: catMat, uvScale: 2.5 });
    // Railings
    if (sx > sz) {
      B.box(x, CY + 0.75, z - sz / 2 + 0.12, sx, 1, 0.16, { material: steel, uvScale: 2 });
      B.box(x, CY + 0.75, z + sz / 2 - 0.12, sx, 1, 0.16, { material: steel, uvScale: 2 });
    } else {
      B.box(x - sx / 2 + 0.12, CY + 0.75, z, 0.16, 1, sz, { material: steel, uvScale: 2 });
      B.box(x + sx / 2 - 0.12, CY + 0.75, z, 0.16, 1, sz, { material: steel, uvScale: 2 });
    }
  }
  // Support columns
  for (const [x, z] of [[-29, -24], [29, -24], [-29, 24], [29, 24], [0, -24], [0, 24]]) {
    B.box(x, CY / 2, z, 0.8, CY, 0.8, { material: steel, uvScale: 2 });
  }

  // Stairs up to the catwalk, both ends.
  B.stairs(-34, -18, 5, 7.4, 9, 15, 'z', { material: catMat, uvScale: 2 });
  B.stairs(34, 4, 5, 7.4, 9, 15, 'z', { material: catMat, uvScale: 2 });

  /* ---------------- central assembly platform ---------------- */
  B.box(0, 1.6, 0, 20, 3.2, 14, { material: steel, uvScale: 3 });
  B.box(0, 3.4, 0, 21, 0.4, 15, { material: catMat, uvScale: 3 });
  B.stairs(-13, -3, 6, 3.6, 5, 7, 'x', { material: catMat, uvScale: 2 });
  B.stairs(13, -3, 6, 3.6, 5, 7, 'x', { material: catMat, uvScale: 2 });
  for (let i = 0; i < 3; i++) {
    const cv = buildConveyor({ len: 16 });
    B.prop(cv, 0, 3.6, -4 + i * 4);
    B.clip(0, 4.1, -4 + i * 4, 16, 1, 1.6);
  }

  /* ---------------- workbenches and crates ---------------- */
  const benches = [[-22, -8, 0], [-22, 8, 0], [22, -8, Math.PI], [22, 8, Math.PI], [-8, -20, 1.57], [8, 20, 1.57]];
  benches.forEach(([x, z, r], i) => {
    B.prop(buildWorkbench({ w: 4, seed: i + 1 }), x, 0, z, r);
    B.clip(x, 0.55, z, r > 1 ? 1.6 : 4.2, 1.1, r > 1 ? 4.2 : 1.6);
  });

  const stacks = [
    [-14, -26, 2], [-14, -26, 2, 1], [-11, -26, 2],
    [14, 26, 2], [14, 26, 2, 1], [17, 26, 2],
    [-33, 22, 2], [33, -22, 2], [-33, -6, 2], [33, 6, 2],
    [6, -28, 2], [-6, 28, 2],
  ];
  stacks.forEach((s, i) => {
    const [x, z, size, level = 0] = s;
    const y = level * 1.7;
    B.prop(buildCrate({ s: 1.7, seed: i + 3 }), x, y, z, (i % 4) * 0.4);
    B.clip(x, y + 0.85, z, 1.8, 1.7, 1.8);
  });

  /* ---------------- jump pads ---------------- */
  for (const [x, z, push] of [[-20, 20, 15], [20, -20, 15], [0, -30, 14.5], [0, 30, 14.5]]) {
    B.jumpPad(x, 0.05, z, { push, model: buildJumpPad({ r: 1.3 }), radius: 1.7 });
  }

  /* ---------------- decor ---------------- */
  for (const [x, z, r] of [[-36, -28, 0], [36, -28, 0], [-36, 28, Math.PI], [36, 28, Math.PI]]) {
    B.prop(buildToySoldier({ h: 3.6 }), x, 0, z, r);
    B.clip(x, 1.8, z, 1.1, 3.6, 1.1);
  }
  for (const [x, z] of [[-30, -30], [30, 30]]) {
    B.prop(buildPineTree({ h: 6, seed: 9 }), x, 0, z);
    B.clip(x, 3, z, 1.1, 6, 1.1);
  }
  for (let i = 0; i < 8; i++) {
    B.prop(buildIcicleCluster({ n: 5, seed: i + 1 }), -30 + i * 9, H - 2.2, i % 2 ? -29 : 29);
  }

  /* ---------------- flagpole ---------------- */
  B.box(0, 0.4, 0, 0, 0, 0, { collide: false, visible: false });
  B.setFlagpole(buildFlagpole(), 0, 3.8, 0);

  /* ---------------- spawns ---------------- */
  B.spawn(-32, 0.2, -24, 0.9);
  B.spawn(32, 0.2, 24, -2.3);
  B.spawn(0, 4, 10, Math.PI);
  B.spawn(-32, 7.7, 20, 0.4);

  for (const [x, z] of [
    [-34, -28], [34, -28], [-34, 28], [34, 28],
    [0, -28], [0, 28], [-34, 0], [34, 0],
    [-20, -20], [20, 20], [20, -28], [-20, 28],
    [-24, 12], [24, -12],
  ]) B.enemySpawn(x, 0.4, z);
  B.enemySpawn(-29, 7.9, -24);
  B.enemySpawn(29, 7.9, 24);

  /* ---------------- pickups ---------------- */
  B.pickup('weapon_shotgun', -22, 0.3, 20);
  B.pickup('weapon_launcher', 0, 4, 1.8);
  B.pickup('weapon_rail', 29, 7.9, 0);
  B.pickup('armor_large', -29, 7.9, 0);
  B.pickup('armor_small', -14, 0.3, -10);
  B.pickup('armor_small', 14, 0.3, 10);
  B.pickup('health_mega', 0, 7.9, -24);
  B.pickup('health_large', -33, 0.3, 14);
  B.pickup('health_large', 33, 0.3, -14);
  B.pickup('health_small', 8, 0.3, -26);
  B.pickup('health_small', -8, 0.3, 26);
  B.pickup('ammo_snowballs', -18, 0.3, 0);
  B.pickup('ammo_snowballs', 19.6, 0.3, 0);
  B.pickup('ammo_shells', -26, 0.3, 22);
  B.pickup('ammo_shells', 7, 4, 5.6);
  B.pickup('ammo_presents', 0, 4, -2.2);
  B.pickup('ammo_presents', -30, 7.9, 20);
  B.pickup('ammo_slugs', 29, 7.9, 6);
  B.pickup('ammo_slugs', 31.4, 0.3, -28.6);
  B.pickup('spirit', 0, 7.9, 24);
  B.pickup('haste', -20, 0.3, -28);

  return B.finish();
}
