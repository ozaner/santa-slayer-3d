/**
 * Level construction.
 *
 * `LevelBuilder` is the little map-editor API the arenas are written against:
 * every call adds collision brushes and matching textured geometry at the same
 * time, so a level file reads as a list of solids rather than two parallel
 * worlds that can drift out of sync.
 */
import * as THREE from 'three';
import { World, SURFACE, v3, traceBox, makeTrace } from '../core/physics.js';
import {
  MAT, PALETTE, glowMat, emissiveMat, stdMat, mesh, shadowize,
} from '../render/materials.js';
import { mergeProp, mergeSubtree, countDrawables } from '../render/optimize.js';

/** Must stay below PM.stepHeight or the stairs are a wall. */
const MAX_STEP_RISE = 0.46;

/**
 * Box geometry whose UVs tile at a fixed world scale on every face, so a 40m
 * floor and a 2m crate show the same texture density.
 */
export function texturedBox(sx, sy, sz, uvScale = 4) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z; 4 verts each.
  const spans = [
    [sz, sy], [sz, sy],
    [sx, sz], [sx, sz],
    [sx, sy], [sx, sy],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * (su / uvScale), uv.getY(idx) * (sv / uvScale));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export class LevelBuilder {
  constructor(scene, { cellSize = 10 } = {}) {
    this.scene = scene;
    this.world = new World(cellSize);
    this.root = new THREE.Group();
    this.root.name = 'level';
    scene.add(this.root);

    this.playerSpawns = [];
    this.enemySpawns = [];
    this.pickups = [];
    this.jumpPads = [];
    this.lightAnchors = [];
    this.triggers = [];
    this.props = [];
    this.routePoints = [];
    this.flagpole = null;
    this.killY = -45;
    this.bounds = { min: new THREE.Vector3(), max: new THREE.Vector3() };
  }

  /** Solid box: collision brush + a visible mesh. */
  box(cx, cy, cz, sx, sy, sz, opts = {}) {
    const {
      material = MAT.snow, surface = SURFACE.NORMAL, collide = true,
      visible = true, uvScale = 4, receive = true, cast = true, rotY = 0,
    } = opts;
    if (collide) {
      if (rotY) {
        // Rotated solids get an axis-aligned bound for collision -- levels
        // avoid rotating anything the player has to move along precisely.
        const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
        const ex = sx * c + sz * s, ez = sx * s + sz * c;
        this.world.addBox(cx, cy, cz, ex, sy, ez, surface);
      } else {
        this.world.addBox(cx, cy, cz, sx, sy, sz, surface);
      }
    }
    if (visible) {
      const m = new THREE.Mesh(texturedBox(sx, sy, sz, uvScale), material);
      m.position.set(cx, cy, cz);
      m.rotation.y = rotY;
      m.castShadow = cast;
      m.receiveShadow = receive;
      this.root.add(m);
      return m;
    }
    return null;
  }

  /** Floor slab with its top surface at `y`. */
  floor(cx, cz, sx, sz, y = 0, opts = {}) {
    const thickness = opts.thickness ?? 2;
    return this.box(cx, y - thickness / 2, cz, sx, thickness, sz, { uvScale: 6, ...opts });
  }

  /** Wall running along X or Z, `y` is the base. */
  wall(cx, cz, sx, sz, h, y = 0, opts = {}) {
    return this.box(cx, y + h / 2, cz, sx, h, sz, opts);
  }

  /** Invisible clip brush -- blocks movement without drawing anything. */
  clip(cx, cy, cz, sx, sy, sz, surface = SURFACE.NORMAL) {
    this.world.addBox(cx, cy, cz, sx, sy, sz, surface);
  }

  /**
   * A staircase of real steps, so the movement code's step-up handles it.
   *
   * Takes explicit ground-level `from` and top-level `to` points as [x, z], because
   * a direction flag is too easy to get backwards -- the first version of this
   * built the watchtower stairs rising away from the tower, leaving the deck
   * unreachable. Make `to` overlap the platform you are joining.
   *
   * Throws if the steps are taller than the player can walk up.
   */
  stairs(from, to, width, height, steps, opts = {}) {
    const [x0, z0] = from;
    const [x1, z1] = to;
    const rise = height / steps;
    if (rise > MAX_STEP_RISE) {
      throw new Error(
        `Staircase from (${x0}, ${z0}) to (${x1}, ${z1}) has ${rise.toFixed(2)}m steps, `
        + `taller than the ${MAX_STEP_RISE}m the player can climb. Use more steps.`);
    }
    const dx = (x1 - x0) / steps;
    const dz = (z1 - z0) / steps;
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      this.box(
        x0 + dx * (i + 0.5), h / 2, z0 + dz * (i + 0.5),
        alongX ? Math.abs(dx) : width, h, alongX ? width : Math.abs(dz),
        { uvScale: 2, ...opts },
      );
    }
    // Register both ends as navigation waypoints. Deriving them from the
    // staircase itself means they can never drift out of sync with it.
    this.route(x0 - dx, 0, z0 - dz);
    this.route(x1 + dx, height, z1 + dz);
  }

  /**
   * A navigation waypoint. Enemies that stop making progress toward a player on
   * higher ground head for the most promising one of these instead of grinding
   * against a wall -- enough pathfinding to stop a wave deadlocking, without a
   * navmesh.
   */
  route(x, y, z) {
    this.routePoints.push({ x, y, z });
  }

  /** Attach a prop model; collects any light anchors it declares. */
  prop(obj, x, y, z, rotY = 0, scale = 1) {
    if (!obj) return null;
    obj.position.set(x, y, z);
    obj.rotation.y = rotY;
    if (scale !== 1) obj.scale.setScalar(scale);
    this.root.add(obj);
    this.props.push(obj);
    const anchors = obj.userData?.lightAnchors;
    if (Array.isArray(anchors)) for (const a of anchors) this.lightAnchors.push(a);
    // Props are built from dozens of primitives; bake the static ones down.
    mergeProp(obj);
    return obj;
  }

  /** A light with no prop attached (e.g. a fire pit glow). */
  light(x, y, z, cfg) {
    const a = new THREE.Object3D();
    a.position.set(x, y, z);
    a.userData.light = cfg;
    this.root.add(a);
    this.lightAnchors.push(a);
    return a;
  }

  spawn(x, y, z, yaw = 0) {
    this.playerSpawns.push({ pos: v3(x, y, z), yaw });
  }

  enemySpawn(x, y, z, tag = 'any') {
    this.enemySpawns.push({ pos: v3(x, y, z), tag });
  }

  pickup(kind, x, y, z) {
    this.pickups.push({ kind, x, y, z });
  }

  /** Candy-cane launcher: a trigger volume that flings the player upward. */
  jumpPad(x, y, z, { push = 15, forward = null, model = null, radius = 1.3 } = {}) {
    this.jumpPads.push({
      pos: new THREE.Vector3(x, y, z), push, forward, radius,
    });
    this.route(x, y, z);
    if (model) this.prop(model, x, y, z);
    return this.jumpPads[this.jumpPads.length - 1];
  }

  /** The level-exit flagpole, a nod to the original game's end-of-level pole. */
  setFlagpole(obj, x, y, z) {
    this.prop(obj, x, y, z);
    this.flagpole = { model: obj, pos: new THREE.Vector3(x, y, z), radius: 2.4, active: false };
    obj.visible = false;
    return this.flagpole;
  }

  finish() {
    const b = this.world.bounds;
    this.bounds.min.set(b.min.x, b.min.y, b.min.z);
    this.bounds.max.set(b.max.x, b.max.y, b.max.z);
    shadowize(this.root, true, true);
    // Batch the brush geometry too. Props were merged as they were added, so
    // protect them (and the flagpole and light anchors) from being flattened.
    const protect = new Set(this.props);
    for (const a of this.lightAnchors) protect.add(a);
    if (this.flagpole) protect.add(this.flagpole.model);
    this.drawablesBefore = countDrawables(this.root);
    mergeSubtree(this.root, protect);
    this.drawables = countDrawables(this.root);
    this.validate();
    return this;
  }

  /**
   * Catch the map-authoring mistake that is otherwise invisible until you play
   * it: a spawn point or pickup buried inside a solid. Throwing here is
   * deliberate -- a level that traps the player on spawn is not shippable, and
   * a silent nudge would just hide the bad coordinate.
   */
  validate() {
    const tr = makeTrace();
    const stuck = (x, y, z, r, h) => {
      const c = v3(x, y + h / 2, z);
      traceBox(this.world, c, c, v3(r, h / 2, r), null, tr);
      return tr.startSolid;
    };
    const bad = [];
    for (const s of this.playerSpawns) {
      if (stuck(s.pos.x, s.pos.y, s.pos.z, 0.38, 1.82)) {
        bad.push(`player spawn (${s.pos.x}, ${s.pos.y}, ${s.pos.z})`);
      }
    }
    for (const s of this.enemySpawns) {
      const r = s.tag === 'boss' ? 1.6 : 0.65;
      const h = s.tag === 'boss' ? 5.2 : 2.3;
      if (stuck(s.pos.x, s.pos.y, s.pos.z, r, h)) {
        bad.push(`enemy spawn [${s.tag}] (${s.pos.x}, ${s.pos.y}, ${s.pos.z})`);
      }
    }
    for (const p of this.pickups) {
      if (stuck(p.x, p.y, p.z, 0.35, 0.9)) bad.push(`pickup ${p.kind} (${p.x}, ${p.y}, ${p.z})`);
    }
    this.problems = bad;
    if (bad.length && !globalThis.__SS_LEVEL_AUDIT__) {
      throw new Error(
        `Level geometry error: ${bad.length} entity placement(s) are inside solid brushes:\n  `
        + bad.join('\n  ')
        + '\nMove them to open space.');
    }
    return this;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose?.();
    });
  }
}

/* ------------------------------------------------------------------ */
/* The flagpole                                                        */
/* ------------------------------------------------------------------ */

/**
 * End-of-level flagpole. Inert until the last wave dies, then it lights up and
 * the player touches it to finish, exactly like sliding down the pole in the
 * 2D original.
 */
export function buildFlagpole() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 16), MAT.steelDark, { pos: [0, 0.25, 0] }));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 9, 14), MAT.steel, { pos: [0, 4.9, 0] }));
  const ballMat = stdMat('fp_ball', {
    color: 0xffe9a8, emissive: 0xffc24a, emissiveIntensity: 3, roughness: 0.2, metalness: 0.7,
  });
  const ball = mesh(new THREE.SphereGeometry(0.4, 20, 14), ballMat, { pos: [0, 9.6, 0] });
  g.add(ball);

  // Banner
  const flagMat = stdMat('fp_flag', {
    color: PALETTE.santaRed, emissive: PALETTE.santaRed, emissiveIntensity: 0.5,
    roughness: 0.7, side: THREE.DoubleSide,
  });
  const flagGeo = new THREE.PlaneGeometry(2.2, 1.4, 12, 6);
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(1.15, 8.4, 0);
  flag.castShadow = true;
  g.add(flag);

  // Star on the banner
  g.add(mesh(new THREE.RingGeometry(0.22, 0.36, 5), glowMat('fp_star', 0xffe9a8),
    { pos: [1.15, 8.4, 0.03], cast: false, receive: false }));

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 9.6, 0);
  anchor.userData.light = { color: 0xffc24a, intensity: 12, distance: 26 };
  g.add(anchor);
  g.userData.lightAnchors = [anchor];
  g.userData.parts = { ball, flag };
  g.userData.flagGeo = null;
  shadowize(g, true, true);
  return g;
}

/** Wave the flag and bob the finial. Called every frame while it is active. */
export function animateFlagpole(fp, t) {
  const parts = fp.model.userData.parts;
  if (!parts) return;
  const { ball, flag } = parts;
  if (ball) {
    ball.position.y = 9.6 + Math.sin(t * 2) * 0.1;
    ball.rotation.y = t * 1.5;
  }
  if (flag) {
    const pos = flag.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const k = (x + 1.1) / 2.2;
      pos.setZ(i, Math.sin(t * 4 + k * 6 + y * 1.5) * 0.22 * k * k);
    }
    pos.needsUpdate = true;
    flag.geometry.computeVertexNormals();
  }
}
