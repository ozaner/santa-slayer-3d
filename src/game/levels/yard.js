/**
 * Level 3 -- The Sleigh Yard. Boss arena.
 *
 * A wide frozen amphitheatre with a raised outer ring. There is nowhere to hide
 * from the Golem, only places to keep moving through, and every weapon is on
 * the floor from the start.
 */
import * as THREE from 'three';
import { SURFACE } from '../../core/physics.js';
import { LevelBuilder, buildFlagpole } from '../level.js';
import { MAT, PALETTE, stdMat, TEX } from '../../render/materials.js';
import {
  buildPineTree, buildLampPost, buildCandyArch, buildJumpPad, buildCrate,
  buildSleigh, buildSnowDrift, buildToySoldier, buildGingerHouse,
} from '../../models/props.js';

export function buildYard(scene) {
  const B = new LevelBuilder(scene, { cellSize: 12 });

  /* ---------------- the bowl ---------------- */
  B.floor(0, 0, 110, 110, 0, { material: MAT.snow, uvScale: 9 });
  // Central frozen rink -- sits proud of the snow so it is the surface you
  // actually skate on, with a low kerb around it.
  B.floor(0, 0, 46, 46, 0.12, { material: MAT.ice, uvScale: 10, surface: SURFACE.ICE, thickness: 0.6 });

  // Raised outer ring, reachable by ramp stairs at four points.
  const RY = 3.4;
  for (const [x, z, sx, sz] of [[0, -34, 96, 22], [0, 34, 96, 22], [-37, 0, 22, 48], [37, 0, 22, 48]]) {
    B.box(x, RY / 2, z, sx, RY, sz, { material: MAT.gingerWall, uvScale: 5 });
  }
  B.stairs(0, -22, 9, 3.6, 6, 7, 'z', { material: MAT.wood, uvScale: 2 });
  B.stairs(0, 16, 9, 3.6, 6, 7, 'z', { material: MAT.wood, uvScale: 2 });
  B.stairs(-22, 0, 9, 3.6, 6, 7, 'x', { material: MAT.wood, uvScale: 2 });
  B.stairs(16, 0, 9, 3.6, 6, 7, 'x', { material: MAT.wood, uvScale: 2 });

  // Perimeter cliffs
  const R = 55, H = 26;
  B.wall(0, -R, 116, 8, H, 0, { material: MAT.snow, uvScale: 8 });
  B.wall(0, R, 116, 8, H, 0, { material: MAT.snow, uvScale: 8 });
  B.wall(-R, 0, 8, 116, H, 0, { material: MAT.snow, uvScale: 8 });
  B.wall(R, 0, 8, 116, H, 0, { material: MAT.snow, uvScale: 8 });
  B.clip(0, 50, 0, 116, 2, 116);

  /* ---------------- pillars to break line of sight ---------------- */
  for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
    B.box(x, 3, z, 3.2, 6, 3.2, { material: MAT.gingerWall, uvScale: 3 });
    B.box(x, 6.3, z, 4.2, 0.7, 4.2, { material: MAT.icing, uvScale: 2 });
  }

  /* ---------------- props ---------------- */
  B.prop(buildSleigh(), 0, RY, -30, 0);
  B.clip(0, RY + 0.8, -30, 4.2, 1.6, 2.4);
  const house = buildGingerHouse({ w: 12, d: 10, h: 5, seed: 7 });
  B.prop(house, -34, RY, 30, 0.5);
  B.clip(-34, RY + 2.5, 30, 12, 5, 11);

  for (const [x, z, s] of [[-46, -44, 1], [46, -44, 2], [-46, 44, 3], [46, 44, 4], [-30, -46, 5], [30, 46, 6]]) {
    B.prop(buildPineTree({ h: 10, seed: s }), x, 0, z);
    B.clip(x, 4, z, 1.3, 8, 1.3);
  }
  for (const [x, z] of [[-24, -24], [24, -24], [-24, 24], [24, 24], [0, -40], [0, 40]]) {
    B.prop(buildLampPost({ h: 6 }), x, x === 0 ? RY : 0, z);
    B.clip(x, 3, z, 0.5, 6, 0.5);
  }
  B.prop(buildCandyArch({ w: 9, h: 7 }), 0, RY, -44, 0);
  B.prop(buildCandyArch({ w: 9, h: 7 }), 0, RY, 44, 0);
  for (const [x, z, r, s] of [[-50, 10, 5, 1], [50, -10, 4.5, 2], [-14, 48, 4, 3], [18, -48, 5, 4]]) {
    B.prop(buildSnowDrift({ r, seed: s }), x, 0, z);
  }
  for (const [x, z, rot] of [[-8, -34, 0], [8, -34, 0]]) {
    B.prop(buildToySoldier({ h: 4 }), x, RY, z, 0);
    B.clip(x, RY + 2, z, 1.2, 4, 1.2);
  }
  const crates = [[-20, -30], [-17, -30], [20, 30], [23, 30], [-30, 10], [30, -10]];
  crates.forEach(([x, z], i) => {
    B.prop(buildCrate({ s: 1.7, seed: i + 1 }), x, RY, z, i * 0.5);
    B.clip(x, RY + 0.85, z, 1.8, 1.7, 1.8);
  });

  /* ---------------- jump pads: the escape valves ---------------- */
  for (const [x, z, push] of [[-19, 0, 16], [19, 0, 16], [0, -19, 16], [0, 19, 16]]) {
    B.jumpPad(x, 0.05, z, { push, model: buildJumpPad({ r: 1.4 }), radius: 1.8 });
  }

  /* ---------------- flagpole ---------------- */
  B.setFlagpole(buildFlagpole(), 0, RY, 34);

  /* ---------------- spawns ---------------- */
  // Clear of the ramp stairs at z=16..22 and the pillars at (+-15, +-15).
  B.spawn(0, 0.2, 9, Math.PI);
  B.spawn(-9, 0.2, 9, 2.4);
  B.spawn(9, 0.2, -9, -0.7);

  B.enemySpawn(0, 0.4, -14, 'boss');
  for (const [x, z] of [
    [-40, -40], [40, -40], [-40, 40], [40, 40],
    [0, -46], [0, 46], [-46, 0], [46, 0],
    [-30, 20], [30, -20], [20, 34], [-20, -34],
  ]) B.enemySpawn(x, RY + 0.4, z);

  /* ---------------- pickups: everything, right away ---------------- */
  B.pickup('weapon_shotgun', -8, 0.2, 8);
  B.pickup('weapon_launcher', 8, 0.2, 8);
  B.pickup('weapon_rail', 0, RY + 0.2, 30);
  B.pickup('armor_large', -34, RY + 0.2, -14);
  B.pickup('armor_large', 34, RY + 0.2, 14);
  B.pickup('health_mega', 2, RY + 0.2, -40);
  B.pickup('health_large', -22, 0.2, -22);
  B.pickup('health_large', 22, 0.2, 22);
  B.pickup('health_large', -22, 0.2, 22);
  B.pickup('health_large', 22, 0.2, -22);
  B.pickup('health_small', -40, RY + 0.2, 0);
  B.pickup('health_small', 40, RY + 0.2, 0);
  B.pickup('ammo_snowballs', -12, 0.2, 0);
  B.pickup('ammo_snowballs', 12, 0.2, 0);
  B.pickup('ammo_shells', -8, 0.2, -8);
  B.pickup('ammo_shells', -27, RY + 0.2, 30);
  B.pickup('ammo_presents', 8, 0.2, -8);
  B.pickup('ammo_presents', 0, RY + 0.2, 44);
  B.pickup('ammo_presents', 0, RY + 0.2, -44);
  B.pickup('ammo_slugs', 30, RY + 0.2, 30);
  B.pickup('ammo_slugs', -30, RY + 0.2, -30);
  B.pickup('spirit', 0, 0.2, 0);
  B.pickup('haste', 0, RY + 0.2, 14);

  return B.finish();
}
