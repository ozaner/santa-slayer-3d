/**
 * Procedural gingerbread enemies for Santa Slayer 3D.
 *
 * Everything here is built from the shared library in ../render/materials.js --
 * no external assets, no loaders. The signature silhouette is a *flat cookie*:
 * every body part is a THREE.Shape run through `extrude()`, so the outline is a
 * genuine cookie-cutter profile. Raised icing is piped on top afterwards as
 * separate `tube()` meshes, which is what actually sells the look.
 *
 * Conventions
 *   - metres, Y up, characters face +Z, origin at the feet (y = 0 is ground)
 *   - facing +Z with +Y up means the character's RIGHT hand is at -X
 *   - limb pivots are THREE.Groups sitting exactly on the joint; the limb mesh
 *     hangs in -Y inside a nested "splay" group, so the engine can drive
 *     `pivot.rotation.x` as a shoulder/hip swing (rotation.x < 0 swings a limb
 *     toward +Z / forward, rotation.x > 0 swings it back)
 *   - ExtrudeGeometry emits two material groups (0 = cookie faces, 1 = extruded
 *     rim), so every slab takes `[doughFace, doughEdge]` and gets a baked,
 *     darker edge for free
 *   - no per-frame logic lives here; builders return static rigs plus handles
 */
import * as THREE from 'three';
import {
  PALETTE,
  MAT,
  TEX,
  stdMat,
  physMat,
  glowMat,
  canvasTexture,
  candyMat,
  emissiveMat,
  roundedBox,
  box,
  sphere,
  cylinder,
  cone,
  torus,
  lathe,
  tube,
  extrude,
  mesh,
  group,
  shadowize,
  mulberry32,
} from '../render/materials.js';

/* ------------------------------------------------------------------ */
/* Local geometry cache                                                */
/* ------------------------------------------------------------------ */

/**
 * Cookie slabs and icing squiggles are deterministic, so a hundred grunts share
 * one set of buffers. Keys are hand-written and unique per shape.
 */
const _geo = new Map();
function gbGeo(key, build) {
  let g = _geo.get(key);
  if (!g) {
    g = build();
    _geo.set(key, g);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Cookie-cutter outlines                                              */
/* ------------------------------------------------------------------ */

/** Step from corner `c` toward neighbour `p` by `r` (clamped to the span). */
function toward(c, p, r) {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(r, len * 0.45) / len;
  return [c[0] + dx * k, c[1] + dy * k];
}

/**
 * Round every corner of a closed polygon into an explicit point list.
 * `r` is a single radius or a per-corner array. Quadratic corners, sampled at
 * `seg` steps, so the vertex count stays predictable (no curve tessellation).
 */
function roundPts(pts, r, seg = 3) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const rr = Array.isArray(r) ? r[i] : r;
    if (!(rr > 1e-4)) {
      out.push([c[0], c[1]]);
      continue;
    }
    const a = toward(c, pts[(i - 1 + n) % n], rr);
    const b = toward(c, pts[(i + 1) % n], rr);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const u = 1 - t;
      out.push([
        u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      ]);
    }
  }
  return out;
}

/** Closed polyline -> THREE.Shape (straight segments only). */
function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/**
 * Hand-cut looking ellipse -- used for heads. A touch of deterministic jitter
 * keeps the edge from reading as a perfect CAD circle.
 */
function ellipsePts(cx, cy, rx, ry, n = 20, jitter = 0, seed = 3) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + (rnd() - 0.5) * 2 * jitter;
    pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
  }
  return pts;
}

/**
 * Flat cookie slab from a rounded outline, centred on z = 0.
 * NB: ExtrudeGeometry's bevel grows the outline outwards by `bevelSize`, so leg
 * profiles stop that far short of the ground and still land flush on it.
 */
function cookieGeo(key, pts, r, depth, { seg = 3, bevel } = {}) {
  const bv = bevel === undefined ? Math.min(0.02, depth * 0.2) : bevel;
  return gbGeo(key, () => {
    const g = extrude(shapeFrom(roundPts(pts, r, seg)), depth, bv);
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Half-thickness of a slab, i.e. where its front face sits in z. */
function halfT(depth, bevel) {
  return depth / 2 + (bevel === undefined ? Math.min(0.02, depth * 0.2) : bevel);
}

/* ------------------------------------------------------------------ */
/* Icing piping                                                        */
/* ------------------------------------------------------------------ */

function pipeGeo(key, pts, radius, tubSeg = 16, radSeg = 5) {
  return gbGeo(key, () => tube(pts, radius, tubSeg, radSeg, false));
}

/** A bead of piped icing following `pts`. */
function pipe(key, pts, radius, mat, tubSeg = 16, radSeg = 5) {
  return mesh(pipeGeo(key, pts, radius, tubSeg, radSeg), mat);
}

/** Smooth squiggle running across x0..x1 at height y, on the plane z. */
function squiggle(x0, x1, y, z, waves = 3, amp = 0.03) {
  const pts = [];
  const n = Math.max(4, Math.round(waves * 4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * waves * Math.PI * 2) * amp, z]);
  }
  return pts;
}

/** Sharp zigzag (collars, jagged trim). */
function zigzag(x0, x1, y, z, teeth = 5, amp = 0.035) {
  const pts = [];
  const n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y + (i % 2 ? amp : -amp), z]);
  }
  return pts;
}

/** Arc of icing (brows, cheeks, rims). */
function arcPts(cx, cy, z, rx, ry, a0, a1, n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]);
  }
  return pts;
}

/** Toothy grin: sawtooth riding a shallow sagging arc. */
function grinPts(cx, cy, z, halfW, sag, teeth = 6) {
  const pts = [];
  const n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const dip = Math.sin(Math.PI * t) * sag;
    const saw = (i % 2 ? 1 : -1) * sag * 0.5;
    pts.push([cx - halfW + 2 * halfW * t, cy - dip + saw, z]);
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Small shared parts                                                  */
/* ------------------------------------------------------------------ */

/** Glossy eye that sits proud of the cookie, with a bloom-catching glint. */
function eyeDot(pos, r, mat, glintCol = 0xfff4dc) {
  return group(
    [
      mesh(sphere(r, 12, 10), mat, { scale: [1, 1, 0.7] }),
      mesh(sphere(r * 0.32, 6, 5), glowMat('gb_glint', glintCol), {
        pos: [-r * 0.3, r * 0.34, r * 0.62],
      }),
    ],
    { pos }
  );
}

/** Squashed gumdrop button / candy stud. */
function gumdrop(pos, r, colorHex, squash = 0.62) {
  return mesh(sphere(r, 12, 9), candyMat(colorHex), { pos, scale: [1, 1, squash] });
}

/** Toasted dough variants (all `gb_` prefixed so no cache-key collisions). */
function doughToast() {
  return stdMat('gb_toast', { ...TEX.gingerbread(1), color: 0x9d6d43, roughness: 0.88 });
}
function doughDense() {
  return stdMat('gb_dense', { ...TEX.gingerbread(1), color: 0x8a5c33, roughness: 0.8 });
}
function doughGolem() {
  return stdMat('gb_golem', { ...TEX.gingerbread(1), color: 0xc08a52, roughness: 0.9 });
}

/* ------------------------------------------------------------------ */
/* 1. Grunt -- the basic gingerbread man                               */
/* ------------------------------------------------------------------ */

const GRUNT_TORSO = [
  [0.2, -0.07],
  [0.235, 0.16],
  [0.285, 0.4],
  [0.15, 0.47],
  [0.1, 0.53],
  [-0.1, 0.53],
  [-0.15, 0.47],
  [-0.285, 0.4],
  [-0.235, 0.16],
  [-0.2, -0.07],
];
const GRUNT_TORSO_R = [0.09, 0.1, 0.09, 0.05, 0.04, 0.04, 0.05, 0.09, 0.1, 0.09];

const GRUNT_ARM = [
  [0.085, 0.08],
  [0.108, -0.16],
  [0.118, -0.33],
  [0.1, -0.47],
  [-0.1, -0.47],
  [-0.118, -0.33],
  [-0.108, -0.16],
  [-0.085, 0.08],
];
const GRUNT_ARM_R = [0.07, 0.05, 0.05, 0.075, 0.075, 0.05, 0.05, 0.07];

const GRUNT_LEG = [
  [0.115, 0.07],
  [0.125, -0.3],
  [0.152, -0.56],
  [0.135, -0.636],
  [-0.135, -0.636],
  [-0.152, -0.56],
  [-0.125, -0.3],
  [-0.115, 0.07],
];
const GRUNT_LEG_R = [0.07, 0.05, 0.05, 0.06, 0.06, 0.05, 0.05, 0.07];

/**
 * "gbNormal": the melee rusher. 1.7 units tall, collision radius 0.42.
 * Plain cookie, white icing, gumdrop buttons, licorice eyes, angry brow.
 */
export function buildGrunt({ scale = 1 } = {}) {
  const D = 0.11;
  const BV = 0.015;
  const HT = halfT(D, BV);
  const zF = HT + 0.006;
  const zB = -zF;
  const dough = [MAT.gingerbread, MAT.gingerbreadBurnt];
  const ice = MAT.icing;
  const hipY = 0.66;

  /* ---- torso ---- */
  const torso = group([], { pos: [0, hipY, 0], name: 'torso' });
  const lean = group([], { rot: [0.13, 0, 0] }); // permanent hunch, engine adds on top
  torso.add(lean);
  lean.add(mesh(cookieGeo('gr_torso', GRUNT_TORSO, GRUNT_TORSO_R, D, { bevel: BV }), dough));

  // zigzag collar, both faces
  for (const z of [zF, zB]) {
    lean.add(pipe(`gr_collar${z > 0 ? 'F' : 'B'}`, zigzag(-0.185, 0.185, 0.435, z, 5, 0.028), 0.021, ice, 22, 5));
  }
  // gumdrop buttons down the chest
  lean.add(gumdrop([0, 0.3, HT * 0.6], 0.055, PALETTE.gumdropRed));
  lean.add(gumdrop([0, 0.17, HT * 0.6], 0.055, PALETTE.gumdropGreen));
  lean.add(gumdrop([0, 0.04, HT * 0.6], 0.055, PALETTE.gumdropPurple));
  // waist squiggle
  lean.add(pipe('gr_waist', squiggle(-0.19, 0.19, 0.0, zF, 2.5, 0.026), 0.019, ice, 20, 5));

  /* ---- head ---- */
  const head = group([], { pos: [0, 0.5, 0], name: 'head' });
  lean.add(head);
  const HC = 0.27; // head centre above the neck pivot
  head.add(mesh(cookieGeo('gr_head', ellipsePts(0, HC, 0.3, 0.275, 20, 0.035, 9), 0, D, { seg: 1, bevel: BV }), dough));

  const eyeMat = MAT.licorice;
  head.add(eyeDot([-0.115, HC + 0.075, HT], 0.05, eyeMat));
  head.add(eyeDot([0.115, HC + 0.075, HT], 0.05, eyeMat));
  // angry brows: inner ends dive toward the nose
  head.add(pipe('gr_browR', [[-0.205, HC + 0.2, zF], [-0.14, HC + 0.175, zF], [-0.05, HC + 0.115, zF]], 0.021, ice, 10, 5));
  head.add(pipe('gr_browL', [[0.205, HC + 0.2, zF], [0.14, HC + 0.175, zF], [0.05, HC + 0.115, zF]], 0.021, ice, 10, 5));
  // toothy grin
  head.add(pipe('gr_grin', grinPts(0, HC - 0.11, zF, 0.135, 0.045, 6), 0.018, ice, 26, 5));
  // little icing cheeks
  head.add(pipe('gr_cheekR', arcPts(-0.2, HC - 0.03, zF, 0.045, 0.045, -1.1, 1.1, 6), 0.014, ice, 8, 4));
  head.add(pipe('gr_cheekL', arcPts(0.2, HC - 0.03, zF, 0.045, 0.045, 2.05, 4.25, 6), 0.014, ice, 8, 4));

  /* ---- arms ---- */
  const armPivot = (side) => {
    // side: -1 = character's right (-X), +1 = character's left (+X)
    const pivot = group([], { pos: [0.255 * side, 0.385, 0], name: side < 0 ? 'armR' : 'armL' });
    const splay = group([], { rot: [-0.1, 0, 0.5 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('gr_arm', GRUNT_ARM, GRUNT_ARM_R, D, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`gr_cuff${z > 0 ? 'F' : 'B'}`, squiggle(-0.1, 0.1, -0.315, z, 1.5, 0.028), 0.019, ice, 14, 5));
    }
    return { pivot, splay };
  };
  const aR = armPivot(-1);
  const aL = armPivot(1);
  lean.add(aR.pivot, aL.pivot);

  /* ---- right palm anchor ---- */
  const handR = group([], { pos: [0, -0.42, 0.02], name: 'handR' });
  aR.splay.add(handR);

  /* ---- legs ---- */
  const legPivot = (side) => {
    const pivot = group([], { pos: [0.135 * side, hipY, 0], name: side < 0 ? 'legR' : 'legL' });
    const splay = group([], { rot: [0, 0, 0.07 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('gr_leg', GRUNT_LEG, GRUNT_LEG_R, D, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`gr_ankle${z > 0 ? 'F' : 'B'}`, squiggle(-0.115, 0.115, -0.5, z, 1.5, 0.03), 0.019, ice, 14, 5));
    }
    return pivot;
  };
  const legR = legPivot(-1);
  const legL = legPivot(1);

  const g = group([torso, legR, legL], { name: 'gingerGrunt' });
  g.scale.setScalar(scale);
  g.userData.parts = { torso, head, armL: aL.pivot, armR: aR.pivot, legL, legR, handR };
  g.userData.height = 1.7 * scale;
  g.userData.radius = 0.42 * scale;
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 2. Sword gingerbread -- the fast attacker                           */
/* ------------------------------------------------------------------ */

/**
 * Tube whose cross-section shrinks along its length. Rebuilds the ring centres
 * from the same CatmullRom curve TubeGeometry used, then pulls each ring in.
 */
function taperedTube(key, points, radius, tubSeg, radSeg, taper, flatten = 1) {
  return gbGeo(key, () => {
    const g = tube(points, radius, tubSeg, radSeg, false);
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false);
    const pos = g.attributes.position;
    const c = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i <= tubSeg; i++) {
      const k = taper(i / tubSeg);
      curve.getPointAt(i / tubSeg, c);
      for (let j = 0; j <= radSeg; j++) {
        const idx = i * (radSeg + 1) + j;
        v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
        pos.setXYZ(idx, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    if (flatten !== 1) g.scale(flatten, 1, 1); // blade curve lives in the YZ plane
    g.computeVertexNormals();
    return g;
  });
}

/** Peppermint-striped candy glass. */
function caneMat() {
  return physMat('gb_cane', {
    ...TEX.candyStripe(PALETTE.candyWhite, PALETTE.candyRed, 3, 8),
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

function redIcing() {
  return physMat('gb_redicing', {
    color: PALETTE.gumdropRed,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.3,
  });
}

const SABRE_CURVE = [
  [0, 0.06, 0],
  [0, 0.24, 0.012],
  [0, 0.42, 0.055],
  [0, 0.58, 0.13],
  [0, 0.71, 0.235],
];

/**
 * A candy-cane sabre: curved striped blade, sharpened tip, gold guard and a
 * licorice ribbon spiralling down the grip. Authored blade-up along +Y with the
 * grip below the origin, so it can be dropped straight into a palm anchor.
 */
function buildCandyCaneSabre() {
  const cane = caneMat();
  const lic = MAT.licorice;
  const g = group([], { name: 'candyCaneSabre' });

  // blade -- tapers to 40% and is flattened to a proper blade section
  g.add(mesh(taperedTube('sb_blade', SABRE_CURVE, 0.052, 30, 6, (t) => 1 - 0.6 * Math.pow(t, 1.3), 0.42), cane));
  // sharpened tip, aligned with the final tangent
  g.add(mesh(cone(0.031, 0.15, 8), cane, { pos: [0, 0.755, 0.283], rot: [0.74, 0, 0], scale: [0.45, 1, 1] }));
  // false edge highlight running along the spine
  g.add(
    mesh(
      taperedTube('sb_edge', SABRE_CURVE.map(([x, y, z]) => [x, y + 0.012, z + 0.026]), 0.014, 24, 4, (t) => 1 - 0.7 * t),
      MAT.icing
    )
  );

  // guard + grip
  g.add(mesh(torus(0.075, 0.016, 6, 16), MAT.gold, { pos: [0, 0.045, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.55, 1] }));
  g.add(mesh(cylinder(0.036, 0.03, 0.055, 12), MAT.gold, { pos: [0, 0.03, 0] }));
  g.add(mesh(cylinder(0.03, 0.034, 0.2, 10), lic, { pos: [0, -0.1, 0] }));
  // licorice ribbon spiralling round the grip
  const wrap = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const a = t * Math.PI * 2 * 3.2;
    wrap.push([Math.cos(a) * 0.036, -0.008 - t * 0.185, Math.sin(a) * 0.036]);
  }
  g.add(mesh(gbGeo('sb_wrap', () => tube(wrap, 0.011, 40, 5, false)), lic));
  // pommel
  g.add(mesh(sphere(0.045, 12, 9), candyMat(PALETTE.gumdropRed), { pos: [0, -0.212, 0] }));
  return g;
}

const SW_TORSO = [
  [0.17, -0.08],
  [0.205, 0.14],
  [0.275, 0.36],
  [0.29, 0.44],
  [0.135, 0.45],
  [0.095, 0.52],
  [-0.095, 0.52],
  [-0.135, 0.45],
  [-0.29, 0.44],
  [-0.275, 0.36],
  [-0.205, 0.14],
  [-0.17, -0.08],
];
const SW_TORSO_R = [0.06, 0.07, 0.03, 0.02, 0.03, 0.03, 0.03, 0.03, 0.02, 0.03, 0.07, 0.06];

const SW_ARM = [
  [0.075, 0.08],
  [0.092, -0.18],
  [0.104, -0.37],
  [0.088, -0.5],
  [-0.088, -0.5],
  [-0.104, -0.37],
  [-0.092, -0.18],
  [-0.075, 0.08],
];
const SW_ARM_R = [0.05, 0.03, 0.03, 0.055, 0.055, 0.03, 0.03, 0.05];

const SW_LEG = [
  [0.1, 0.07],
  [0.108, -0.32],
  [0.142, -0.62],
  [0.122, -0.698],
  [-0.122, -0.698],
  [-0.142, -0.62],
  [-0.108, -0.32],
  [-0.1, 0.07],
];
const SW_LEG_R = [0.05, 0.03, 0.025, 0.04, 0.04, 0.025, 0.03, 0.05];

/**
 * "gbSword": lean, angular, scorched at the edges, war-painted, and already
 * holding a candy-cane sabre in his right hand. 1.75 tall, radius 0.4.
 */
export function buildSwordGB({ scale = 1 } = {}) {
  const D = 0.105;
  const BV = 0.014;
  const HT = halfT(D, BV);
  const zF = HT + 0.006;
  const zB = -zF;
  const dough = [doughToast(), MAT.gingerbreadBurnt];
  const ice = MAT.icing;
  const war = redIcing();
  const hipY = 0.72;

  /* ---- torso ---- */
  const torso = group([], { pos: [0, hipY, 0], name: 'torso' });
  const lean = group([], { rot: [0.1, 0, 0] });
  torso.add(lean);
  lean.add(mesh(cookieGeo('sw_torso', SW_TORSO, SW_TORSO_R, D, { bevel: BV }), dough));
  for (const z of [zF, zB]) {
    lean.add(pipe(`sw_collar${z > 0 ? 'F' : 'B'}`, zigzag(-0.17, 0.17, 0.415, z, 6, 0.03), 0.018, ice, 24, 5));
  }
  // crossed bandolier of red icing
  lean.add(pipe('sw_baldricA', [[-0.23, 0.4, zF], [-0.05, 0.24, zF], [0.16, 0.02, zF]], 0.02, war, 14, 5));
  lean.add(pipe('sw_baldricB', [[0.23, 0.4, zF], [0.05, 0.24, zF], [-0.16, 0.02, zF]], 0.02, war, 14, 5));
  lean.add(gumdrop([0, 0.22, HT * 0.6], 0.05, PALETTE.gumdropRed));

  /* ---- head ---- */
  const head = group([], { pos: [0, 0.465, 0], name: 'head' });
  lean.add(head);
  const HC = 0.28;
  head.add(mesh(cookieGeo('sw_head', ellipsePts(0, HC, 0.275, 0.28, 20, 0.045, 17), 0, D, { seg: 1, bevel: BV }), dough));

  head.add(eyeDot([-0.105, HC + 0.08, HT], 0.045, MAT.licorice, 0xffd0a0));
  head.add(eyeDot([0.105, HC + 0.08, HT], 0.045, MAT.licorice, 0xffd0a0));
  // hard slanted brows
  head.add(pipe('sw_browR', [[-0.195, HC + 0.215, zF], [-0.04, HC + 0.115, zF]], 0.02, ice, 8, 5));
  head.add(pipe('sw_browL', [[0.195, HC + 0.215, zF], [0.04, HC + 0.115, zF]], 0.02, ice, 8, 5));
  // war paint: three raked stripes down each cheek
  for (let i = 0; i < 3; i++) {
    const x = 0.09 + i * 0.062;
    const top = HC + 0.03 - i * 0.02;
    head.add(pipe(`sw_warR${i}`, [[-x - 0.02, top, zF], [-x + 0.03, top - 0.19, zF]], 0.016, war, 8, 4));
    head.add(pipe(`sw_warL${i}`, [[x + 0.02, top, zF], [x - 0.03, top - 0.19, zF]], 0.016, war, 8, 4));
  }
  head.add(pipe('sw_grin', grinPts(0, HC - 0.115, zF, 0.115, 0.05, 5), 0.017, ice, 22, 5));

  /* ---- arms ---- */
  const armPivot = (side) => {
    const pivot = group([], { pos: [0.25 * side, 0.375, 0], name: side < 0 ? 'armR' : 'armL' });
    const splay = group([], { rot: [-0.14, 0, 0.44 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('sw_arm', SW_ARM, SW_ARM_R, D, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`sw_cuff${z > 0 ? 'F' : 'B'}`, squiggle(-0.09, 0.09, -0.35, z, 1.5, 0.026), 0.017, ice, 14, 5));
    }
    return { pivot, splay };
  };
  const aR = armPivot(-1);
  const aL = armPivot(1);
  lean.add(aR.pivot, aL.pivot);

  /* ---- sabre in the right palm ---- */
  const handR = group([], { pos: [0, -0.45, 0.02], name: 'handR' });
  aR.splay.add(handR);
  const weapon = buildCandyCaneSabre();
  weapon.rotation.set(-0.35, 0, -0.5); // point it out and forward from the fist
  handR.add(weapon);

  /* ---- legs ---- */
  const legPivot = (side) => {
    const pivot = group([], { pos: [0.125 * side, hipY, 0], name: side < 0 ? 'legR' : 'legL' });
    const splay = group([], { rot: [0, 0, 0.06 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('sw_leg', SW_LEG, SW_LEG_R, D, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`sw_ankle${z > 0 ? 'F' : 'B'}`, squiggle(-0.1, 0.1, -0.55, z, 1.5, 0.028), 0.017, ice, 14, 5));
    }
    return pivot;
  };
  const legR = legPivot(-1);
  const legL = legPivot(1);

  const g = group([torso, legR, legL], { name: 'gingerSword' });
  g.scale.setScalar(scale);
  g.userData.parts = { torso, head, armL: aL.pivot, armR: aR.pivot, legL, legR, handR, weapon };
  g.userData.height = 1.75 * scale;
  g.userData.radius = 0.4 * scale;
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 3. Shield gingerbread -- the tank                                   */
/* ------------------------------------------------------------------ */

/**
 * A genuine peppermint swirl painted into a canvas: six red arms spiralling out
 * of the centre, each stroked segment-by-segment so the arm widens with radius.
 * Cylinder cap UVs are radial, so this lands on the shield face perfectly.
 */
function peppermintMat() {
  return physMat('gb_peppermint', {
    map: canvasTexture('gb_swirl', 512, (ctx, s) => {
      const R = s / 2;
      ctx.fillStyle = '#fdfaf5';
      ctx.fillRect(0, 0, s, s);
      const arms = 6;
      const turns = 0.62;
      const steps = 90;
      ctx.strokeStyle = '#e23b3b';
      ctx.lineCap = 'round';
      for (let a = 0; a < arms; a++) {
        const base = (a / arms) * Math.PI * 2;
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps;
          const t1 = (i + 1) / steps;
          const a0 = base + t0 * turns * Math.PI * 2;
          const a1 = base + t1 * turns * Math.PI * 2;
          ctx.lineWidth = 5 + t0 * s * 0.085;
          ctx.beginPath();
          ctx.moveTo(R + Math.cos(a0) * t0 * R, R + Math.sin(a0) * t0 * R);
          ctx.lineTo(R + Math.cos(a1) * t1 * R, R + Math.sin(a1) * t1 * R);
          ctx.stroke();
        }
      }
      // white centre pip and an outer band, like a real starlight mint
      ctx.fillStyle = '#fdfaf5';
      ctx.beginPath();
      ctx.arc(R, R, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fdfaf5';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.arc(R, R, R - s * 0.025, 0, Math.PI * 2);
      ctx.stroke();
    }),
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
}

/**
 * The peppermint shield: ~1.0 across, swirl on both faces, gold rim, icing boss,
 * gumdrop studs and a licorice grip bar on the back. Faces its own local +Z.
 */
function buildPeppermintShield() {
  const swirl = peppermintMat();
  const g = group([], { name: 'shield' });

  // disc: side / +Z cap / -Z cap  ->  gold rim, swirl, swirl
  g.add(mesh(cylinder(0.5, 0.5, 0.11, 40), [MAT.gold, swirl, swirl], { rot: [Math.PI / 2, 0, 0] }));
  // raised gold rim
  g.add(mesh(torus(0.5, 0.055, 8, 40), MAT.gold));
  // icing boss dome on the front
  g.add(
    mesh(
      lathe([[0.001, 0], [0.07, 0.006], [0.115, 0.03], [0.13, 0.07], [0.1, 0.115], [0.001, 0.135]], 20),
      MAT.icing,
      { pos: [0, 0, 0.05], rot: [Math.PI / 2, 0, 0] }
    )
  );
  // icing rosette around the boss
  const ring = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 0.21 + Math.sin(a * 8) * 0.022;
    ring.push([Math.cos(a) * r, Math.sin(a) * r, 0.062]);
  }
  g.add(mesh(gbGeo('sh_rosette', () => tube(ring, 0.022, 56, 5, true)), MAT.icing));
  // gumdrop studs around the rim
  const studCols = [PALETTE.gumdropRed, PALETTE.gumdropGreen, PALETTE.gumdropPurple];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    g.add(
      mesh(sphere(0.05, 12, 9), candyMat(studCols[i % 3]), {
        pos: [Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.055],
        scale: [1, 1, 0.7],
      })
    );
  }
  // grip bar on the back
  g.add(mesh(torus(0.16, 0.03, 6, 14), MAT.licorice, { pos: [0, 0, -0.08], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.3] }));
  g.add(mesh(cylinder(0.028, 0.028, 0.34, 8), MAT.licorice, { pos: [0, 0, -0.11], rot: [0, 0, Math.PI / 2] }));
  return g;
}

const SH_TORSO = [
  [0.28, -0.1],
  [0.31, 0.16],
  [0.35, 0.42],
  [0.185, 0.5],
  [0.115, 0.58],
  [-0.115, 0.58],
  [-0.185, 0.5],
  [-0.35, 0.42],
  [-0.31, 0.16],
  [-0.28, -0.1],
];
const SH_TORSO_R = [0.1, 0.12, 0.1, 0.06, 0.05, 0.05, 0.06, 0.1, 0.12, 0.1];

const SH_ARM = [
  [0.115, 0.1],
  [0.135, -0.18],
  [0.145, -0.36],
  [0.125, -0.52],
  [-0.125, -0.52],
  [-0.145, -0.36],
  [-0.135, -0.18],
  [-0.115, 0.1],
];
const SH_ARM_R = [0.085, 0.06, 0.06, 0.085, 0.085, 0.06, 0.06, 0.085];

const SH_LEG = [
  [0.15, 0.08],
  [0.16, -0.34],
  [0.19, -0.62],
  [0.168, -0.708],
  [-0.168, -0.708],
  [-0.19, -0.62],
  [-0.16, -0.34],
  [-0.15, 0.08],
];
const SH_LEG_R = [0.08, 0.06, 0.05, 0.07, 0.07, 0.05, 0.06, 0.08];

/**
 * "gbShield": the tank. 1.9 tall, radius 0.5, thick dark dough, and a giant
 * peppermint shield locked up in front of him in the LEFT hand.
 */
export function buildShieldGB({ scale = 1 } = {}) {
  const D = 0.17;
  const BV = 0.022;
  const HT = halfT(D, BV);
  const zF = HT + 0.007;
  const zB = -zF;
  const dough = [doughDense(), MAT.gingerbreadBurnt];
  const ice = MAT.icing;
  const hipY = 0.74;

  /* ---- torso ---- */
  const torso = group([], { pos: [0, hipY, 0], name: 'torso' });
  const lean = group([], { rot: [0.12, 0, 0] });
  torso.add(lean);
  lean.add(mesh(cookieGeo('sh_torso', SH_TORSO, SH_TORSO_R, D, { bevel: BV }), dough));
  for (const z of [zF, zB]) {
    lean.add(pipe(`sh_collar${z > 0 ? 'F' : 'B'}`, zigzag(-0.24, 0.24, 0.455, z, 7, 0.034), 0.024, ice, 30, 5));
    lean.add(pipe(`sh_belt${z > 0 ? 'F' : 'B'}`, squiggle(-0.27, 0.27, 0.02, z, 3, 0.03), 0.024, ice, 26, 5));
  }
  // heavy gumdrop rivets across the chest
  for (const x of [-0.14, 0, 0.14]) lean.add(gumdrop([x, 0.3, HT * 0.6], 0.062, PALETTE.gumdropGreen));
  lean.add(gumdrop([0, 0.16, HT * 0.6], 0.062, PALETTE.gumdropRed));

  /* ---- head ---- */
  const head = group([], { pos: [0, 0.55, 0], name: 'head' });
  lean.add(head);
  const HC = 0.31;
  head.add(mesh(cookieGeo('sh_head', ellipsePts(0, HC, 0.33, 0.31, 22, 0.03, 5), 0, D, { seg: 1, bevel: BV }), dough));
  head.add(eyeDot([-0.125, HC + 0.08, HT], 0.055, MAT.licorice));
  head.add(eyeDot([0.125, HC + 0.08, HT], 0.055, MAT.licorice));
  head.add(pipe('sh_browR', [[-0.235, HC + 0.235, zF], [-0.135, HC + 0.185, zF], [-0.05, HC + 0.125, zF]], 0.024, ice, 10, 5));
  head.add(pipe('sh_browL', [[0.235, HC + 0.235, zF], [0.135, HC + 0.185, zF], [0.05, HC + 0.125, zF]], 0.024, ice, 10, 5));
  head.add(pipe('sh_grin', grinPts(0, HC - 0.125, zF, 0.15, 0.05, 7), 0.02, ice, 28, 5));
  // icing helmet band across the brow
  head.add(pipe('sh_band', arcPts(0, HC, zF - 0.002, 0.315, 0.295, 0.28, Math.PI - 0.28, 14), 0.028, ice, 20, 5));

  /* ---- arms ---- */
  const armPivot = (side, splayRot) => {
    const pivot = group([], { pos: [0.325 * side, 0.4, 0], name: side < 0 ? 'armR' : 'armL' });
    const splay = group([], { rot: splayRot });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('sh_arm', SH_ARM, SH_ARM_R, D, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`sh_cuff${z > 0 ? 'F' : 'B'}`, squiggle(-0.125, 0.125, -0.37, z, 1.5, 0.032), 0.022, ice, 16, 5));
    }
    return { pivot, splay };
  };
  const aR = armPivot(-1, [-0.12, 0, -0.48]);
  const aL = armPivot(1, [-0.78, 0, 0.16]); // shield arm: raised and drawn across
  lean.add(aR.pivot, aL.pivot);

  const handR = group([], { pos: [0, -0.47, 0.03], name: 'handR' });
  aR.splay.add(handR);
  const handL = group([], { pos: [0, -0.47, 0.03], name: 'handL' });
  aL.splay.add(handL);

  /* ---- shield: cancel every parent rotation so it truly faces +Z ---- */
  const shield = buildPeppermintShield();
  handL.add(shield);
  const q = new THREE.Quaternion();
  handL.getWorldQuaternion(q);
  shield.quaternion.copy(q.invert());
  shield.rotateY(-0.14); // a little cant reads better than a flat billboard
  shield.rotateX(0.06);
  shield.position.set(-0.24, 0.16, 0.2);

  /* ---- legs ---- */
  const legPivot = (side) => {
    const pivot = group([], { pos: [0.17 * side, hipY, 0], name: side < 0 ? 'legR' : 'legL' });
    const splay = group([], { rot: [0, 0, 0.05 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('sh_leg', SH_LEG, SH_LEG_R, D, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`sh_ankle${z > 0 ? 'F' : 'B'}`, squiggle(-0.14, 0.14, -0.56, z, 1.5, 0.034), 0.022, ice, 16, 5));
    }
    return pivot;
  };
  const legR = legPivot(-1);
  const legL = legPivot(1);

  const g = group([torso, legR, legL], { name: 'gingerShield' });
  g.scale.setScalar(scale);
  g.userData.parts = { torso, head, armL: aL.pivot, armR: aR.pivot, legL, legR, handR, handL, shield };
  g.userData.height = 1.9 * scale;
  g.userData.radius = 0.5 * scale;
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 4. Snowman brute -- ranged heavy                                    */
/* ------------------------------------------------------------------ */

function coalMat() {
  return physMat('gb_coal', { color: 0x14110f, roughness: 0.62, clearcoat: 0.35 });
}
function feltMat() {
  return stdMat('gb_felt', { color: 0x16131b, roughness: 0.96, side: THREE.DoubleSide });
}
function carrotMat() {
  return stdMat('gb_carrot', { color: 0xe8761f, roughness: 0.55 });
}
function scarfMat() {
  return stdMat('gb_scarf', {
    ...TEX.candyStripe(PALETTE.candyRed, PALETTE.candyWhite, 5, 5),
    roughness: 0.92,
  });
}

/** Lumpy coal nugget. */
function coal(pos, r) {
  return mesh(sphere(r, 8, 6), coalMat(), { pos, scale: [1, 0.88, 0.8] });
}

/** A stick arm: kinked twig with a three-way fork at the far end. */
function twigArm(key) {
  const g = group([]);
  const spine = [
    [0, 0.02, 0],
    [0.03, -0.2, 0.015],
    [0.005, -0.42, 0.035],
    [0.045, -0.64, 0.02],
  ];
  g.add(mesh(taperedTube(`${key}_spine`, spine, 0.05, 26, 5, (t) => 1 - 0.42 * t), MAT.woodDark));
  const tip = [0.045, -0.64, 0.02];
  const forks = [
    [[0.16, -0.78, -0.03], [0.24, -0.86, -0.05]],
    [[0.07, -0.82, 0.09], [0.09, -0.95, 0.16]],
    [[-0.05, -0.78, 0.0], [-0.13, -0.9, -0.02]],
  ];
  forks.forEach((f, i) => {
    g.add(mesh(taperedTube(`${key}_fork${i}`, [tip, f[0], f[1]], 0.028, 12, 4, (t) => 1 - 0.6 * t), MAT.woodDark));
  });
  return g;
}

/**
 * The three-ball snowman: coal face, real carrot nose, battered top hat, a
 * knitted scarf that wraps and trails, and twig arms. 2.3 tall, radius 0.65.
 * No legs -- the bottom ball is the base -- so `userData.noLegs` is set and the
 * leg pivots are empty groups that satisfy the rig contract.
 */
export function buildSnowmanBrute({ scale = 1 } = {}) {
  const snow = MAT.snow;
  const g = group([], { name: 'snowmanBrute' });

  /* ---- base ball (static, not part of the animated torso) ---- */
  g.add(mesh(sphere(0.62, 22, 16), snow, { pos: [0, 0.6, 0], scale: [1, 0.95, 1] }));
  // packed drift where he meets the ground
  g.add(mesh(cone(0.72, 0.26, 20), snow, { pos: [0, 0.13, 0] }));

  /* ---- torso: middle ball, pivoting at the waist ---- */
  const torso = group([], { pos: [0, 0.94, 0], name: 'torso' });
  g.add(torso);
  const lean = group([], { rot: [0.06, 0, 0] });
  torso.add(lean);
  lean.add(mesh(sphere(0.47, 20, 14), snow, { pos: [0, 0.3, 0], scale: [1, 0.97, 1] }));
  // snow lump hiding the ball seam
  lean.add(mesh(sphere(0.4, 12, 8), snow, { pos: [0, -0.03, 0], scale: [1, 0.42, 1] }));
  // coal buttons
  lean.add(coal([0, 0.52, 0.44], 0.062));
  lean.add(coal([0, 0.31, 0.47], 0.066));
  lean.add(coal([0, 0.1, 0.44], 0.062));

  /* ---- head ---- */
  const head = group([], { pos: [0, 0.58, 0], name: 'head' });
  lean.add(head);
  const HY = 0.24; // head-ball centre above the neck pivot
  head.add(mesh(sphere(0.34, 20, 14), snow, { pos: [0, HY, 0] }));

  // coal eyes with a cold glint
  for (const sx of [-1, 1]) {
    head.add(
      group(
        [
          mesh(sphere(0.055, 10, 8), coalMat(), { scale: [1, 1, 0.85] }),
          mesh(sphere(0.017, 6, 5), glowMat('gb_glintCold', 0xdff2ff), { pos: [-0.016, 0.019, 0.05] }),
        ],
        { pos: [0.115 * sx, HY + 0.09, 0.3] }
      )
    );
  }
  // coal mouth, curved into a scowl
  for (let i = 0; i < 6; i++) {
    const t = i / 5 - 0.5;
    head.add(coal([t * 0.3, HY - 0.13 + Math.abs(t) * 0.11, 0.31 - Math.abs(t) * 0.08], 0.032));
  }
  // carrot nose + spiral groove
  head.add(mesh(cone(0.078, 0.36, 10), carrotMat(), { pos: [0, HY - 0.01, 0.42], rot: [Math.PI / 2, 0, 0] }));
  const groove = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const a = t * Math.PI * 2 * 3.5;
    const r = 0.079 * (1 - t * 0.92);
    groove.push([Math.cos(a) * r, HY - 0.01 + Math.sin(a) * r, 0.25 + t * 0.33]);
  }
  head.add(mesh(gbGeo('sn_groove', () => tube(groove, 0.011, 40, 4, false)), stdMat('gb_carrotDark', { color: 0xb2540f, roughness: 0.6 })));

  // battered top hat
  const hat = group([], { pos: [0, HY + 0.19, 0], rot: [0.1, 0.2, 0.05] });
  head.add(hat);
  hat.add(
    mesh(
      lathe(
        [
          [0.001, 0],
          [0.24, 0.005],
          [0.4, 0.018],
          [0.41, 0.042],
          [0.24, 0.05],
          [0.235, 0.12],
          [0.245, 0.225],
          [0.225, 0.26],
          [0.19, 0.272],
          [0.001, 0.274],
        ],
        22
      ),
      feltMat(),
      { pos: [0, -0.02, 0] }
    )
  );
  // hat band in candy stripe
  hat.add(mesh(torus(0.245, 0.028, 6, 22), scarfMat(), { pos: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0] }));
  // a sprig of holly on the band
  hat.add(mesh(sphere(0.035, 8, 6), candyMat(PALETTE.gumdropRed), { pos: [0.2, 0.1, 0.16] }));
  hat.add(mesh(sphere(0.03, 8, 6), candyMat(PALETTE.gumdropRed), { pos: [0.24, 0.09, 0.11] }));

  /* ---- scarf: wraps the neck twice, then trails off the back ---- */
  const wrap = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const a = t * Math.PI * 2 * 1.45 + 0.6;
    const r = 0.335 - t * 0.02;
    wrap.push([Math.cos(a) * r, 0.02 - t * 0.05, Math.sin(a) * r]);
  }
  wrap.push([-0.28, -0.06, -0.3], [-0.36, -0.3, -0.42], [-0.3, -0.55, -0.5], [-0.38, -0.78, -0.42]);
  lean.add(mesh(gbGeo('sn_scarf', () => tube(wrap, 0.075, 64, 7, false)), scarfMat()));
  // fringe on the trailing end
  for (let i = 0; i < 4; i++) {
    const x = -0.42 + i * 0.055;
    lean.add(
      mesh(
        gbGeo(`sn_fringe${i}`, () => tube([[x, -0.79, -0.42], [x - 0.01, -0.87, -0.44], [x + 0.01, -0.94, -0.43]], 0.014, 10, 4, false)),
        scarfMat()
      )
    );
  }

  /* ---- twig arms ---- */
  const armPivot = (side) => {
    const pivot = group([], { pos: [0.42 * side, 0.44, 0], name: side < 0 ? 'armR' : 'armL' });
    const splay = group([], { rot: [-0.1, 0, 0.82 * side] });
    pivot.add(splay);
    splay.add(twigArm(side < 0 ? 'sn_armR' : 'sn_armL'));
    return { pivot, splay };
  };
  const aR = armPivot(-1);
  const aL = armPivot(1);
  lean.add(aR.pivot, aL.pivot);

  // he throws snowballs from here
  const handR = group([], { pos: [0.03, -0.68, 0.03], name: 'handR' });
  aR.splay.add(handR);

  /* ---- no legs: empty pivots at the base keep the rig contract honest ---- */
  const legR = group([], { pos: [-0.2, 0.12, 0], name: 'legR' });
  const legL = group([], { pos: [0.2, 0.12, 0], name: 'legL' });
  g.add(legR, legL);

  g.scale.setScalar(scale);
  g.userData.parts = { torso, head, armL: aL.pivot, armR: aR.pivot, legL, legR, handR };
  g.userData.noLegs = true;
  g.userData.height = 2.3 * scale;
  g.userData.radius = 0.65 * scale;
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 5. Ginger Golem -- the boss                                         */
/* ------------------------------------------------------------------ */

/** Jagged fracture polyline from a to b, with deterministic lateral wander. */
function crackPts(seed, a, b, z, n = 6, jag = 0.12) {
  const rnd = mulberry32(seed);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const o = i === 0 || i === n ? 0 : (rnd() - 0.5) * 2 * jag;
    pts.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o, z]);
  }
  return pts;
}

/** Dark inset fracture strip: sunk into the dough so only a sliver shows. */
function crack(key, seed, a, b, surfaceZ, width = 0.035, n = 6, jag = 0.1) {
  return mesh(
    pipeGeo(key, crackPts(seed, a, b, surfaceZ - width * 0.55, n, jag), width, 12, 4),
    MAT.licorice
  );
}

const GO_TORSO = [
  [0.62, -0.25],
  [0.72, 0.5],
  [0.88, 1.3],
  [1.14, 1.8],
  [1.02, 2.06],
  [0.5, 2.12],
  [0.3, 2.26],
  [-0.3, 2.26],
  [-0.5, 2.12],
  [-1.02, 2.06],
  [-1.14, 1.8],
  [-0.88, 1.3],
  [-0.72, 0.5],
  [-0.62, -0.25],
];
const GO_TORSO_R = [0.18, 0.2, 0.16, 0.1, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.1, 0.16, 0.2, 0.18];

const GO_HEAD = [
  [0.3, -0.5],
  [0.52, -0.36],
  [0.58, 0.08],
  [0.44, 0.42],
  [0.16, 0.54],
  [-0.16, 0.54],
  [-0.44, 0.42],
  [-0.58, 0.08],
  [-0.52, -0.36],
  [-0.3, -0.5],
];
const GO_HEAD_R = [0.12, 0.1, 0.1, 0.08, 0.1, 0.1, 0.08, 0.1, 0.1, 0.12];

const GO_ARM = [
  [0.26, 0.3],
  [0.33, -0.4],
  [0.31, -1.0],
  [0.27, -1.44],
  [-0.27, -1.44],
  [-0.31, -1.0],
  [-0.33, -0.4],
  [-0.26, 0.3],
];
const GO_ARM_R = [0.2, 0.12, 0.12, 0.14, 0.14, 0.12, 0.12, 0.2];

const GO_LEG = [
  [0.34, 0.3],
  [0.37, -0.6],
  [0.43, -1.48],
  [0.52, -1.75],
  [0.47, -1.83],
  [-0.47, -1.83],
  [-0.52, -1.75],
  [-0.43, -1.48],
  [-0.37, -0.6],
  [-0.34, 0.3],
];
const GO_LEG_R = [0.16, 0.12, 0.1, 0.1, 0.09, 0.09, 0.1, 0.1, 0.12, 0.16];

/**
 * THE BOSS. 5.2 tall, radius 1.6. Same cookie language, scaled to a monolith:
 * wide shoulders, tiny head, oversized fists, licorice fractures inset into the
 * dough, candy shrapnel driven into the shoulders, and two burning eyes exposed
 * as `parts.eyes` so the engine can pulse them.
 */
export function buildGingerGolem({ scale = 1 } = {}) {
  const D = 0.42;
  const BV = 0.05;
  const HT = halfT(D, BV);
  const zF = HT + 0.012;
  const zB = -zF;
  const dough = [doughGolem(), MAT.gingerbreadBurnt];
  const ice = MAT.icing;
  const hipY = 1.9;

  /* ---- torso ---- */
  const torso = group([], { pos: [0, hipY, 0], name: 'torso' });
  const lean = group([], { rot: [0.09, 0, 0] });
  torso.add(lean);
  lean.add(mesh(cookieGeo('go_torso', GO_TORSO, GO_TORSO_R, D, { bevel: BV }), dough));

  // fracture network across the slab, front and back
  const fr = [
    [[-0.55, 2.0], [0.15, 1.1]],
    [[0.15, 1.1], [0.72, 0.42]],
    [[0.15, 1.1], [-0.28, 0.2]],
    [[0.62, 1.62], [0.2, 1.28]],
    [[-0.66, 0.7], [-0.3, -0.15]],
  ];
  fr.forEach((seg, i) => {
    lean.add(crack(`go_crkF${i}`, 100 + i, seg[0], seg[1], zF - 0.006, 0.05, 7, 0.11));
    lean.add(crack(`go_crkB${i}`, 200 + i, [-seg[0][0], seg[0][1]], [-seg[1][0], seg[1][1]], -zF + 0.006, 0.05, 7, 0.11));
  });

  // heavy icing yoke over the shoulders + belt of icing across the gut
  for (const z of [zF, zB]) {
    lean.add(pipe(`go_yoke${z > 0 ? 'F' : 'B'}`, zigzag(-0.86, 0.86, 1.93, z, 9, 0.09), 0.055, ice, 30, 5));
    lean.add(pipe(`go_belt${z > 0 ? 'F' : 'B'}`, squiggle(-0.7, 0.7, 0.28, z, 3, 0.08), 0.055, ice, 26, 5));
  }
  // huge gumdrops set into the chest
  lean.add(gumdrop([0, 1.42, HT * 0.7], 0.17, PALETTE.gumdropRed, 0.55));
  lean.add(gumdrop([-0.42, 1.02, HT * 0.7], 0.13, PALETTE.gumdropGreen, 0.55));
  lean.add(gumdrop([0.42, 1.02, HT * 0.7], 0.13, PALETTE.gumdropPurple, 0.55));

  /* ---- shoulder armour: candy-cane shrapnel + gumdrop rivets ---- */
  const pauldron = (sx) => {
    const p = group([], { pos: [0.98 * sx, 1.9, 0] });
    for (let i = 0; i < 3; i++) {
      p.add(
        mesh(cone(0.12, 0.5, 7), caneMat(), {
          pos: [0.08 * sx, 0.14 + i * 0.03, -0.22 + i * 0.22],
          rot: [0.18 - i * 0.16, 0, -(0.45 + i * 0.16) * sx],
        })
      );
    }
    p.add(gumdrop([0.02 * sx, 0.02, HT * 0.8], 0.11, PALETTE.gumdropPurple, 0.6));
    p.add(gumdrop([0.02 * sx, 0.02, -HT * 0.8], 0.11, PALETTE.gumdropGreen, 0.6));
    p.add(mesh(sphere(0.09, 10, 8), candyMat(PALETTE.gumdropRed), { pos: [0.16 * sx, -0.22, 0.0] }));
    return p;
  };
  lean.add(pauldron(-1), pauldron(1));

  /* ---- head ---- */
  const head = group([], { pos: [0, 2.15, 0], name: 'head' });
  lean.add(head);
  const tilt = group([], { rot: [0.16, 0, 0] }); // brow-forward, looking down at you
  head.add(tilt);
  const HC = 0.58;
  tilt.add(mesh(cookieGeo('go_head', GO_HEAD, GO_HEAD_R, D * 0.86, { bevel: BV }), dough).translateY(HC));

  const eyeMat = emissiveMat('gb_bosseye', 0xff5a1e, 4);
  const eyes = [];
  for (const sx of [-1, 1]) {
    tilt.add(
      mesh(sphere(0.17, 12, 10), MAT.licorice, {
        pos: [0.24 * sx, HC + 0.12, HT * 0.78],
        scale: [1.3, 1, 0.5],
      })
    );
    const eye = mesh(sphere(0.1, 14, 12), eyeMat, {
      pos: [0.24 * sx, HC + 0.12, HT * 0.86],
      scale: [1.15, 1, 0.8],
    });
    eyes.push(eye);
    tilt.add(eye);
    // furnace light leaking out of the fractures below each eye
    tilt.add(
      mesh(
        pipeGeo(`go_glow${sx}`, crackPts(31 + sx, [0.24 * sx, HC + 0.02], [0.34 * sx, HC - 0.34], HT * 0.8, 5, 0.05), 0.022, 12, 4),
        eyeMat
      )
    );
  }
  // heavy scowling brow of icing
  tilt.add(pipe('go_browR', [[-0.46, HC + 0.4, zF], [-0.26, HC + 0.32, zF], [-0.08, HC + 0.2, zF]], 0.05, ice, 12, 5));
  tilt.add(pipe('go_browL', [[0.46, HC + 0.4, zF], [0.26, HC + 0.32, zF], [0.08, HC + 0.2, zF]], 0.05, ice, 12, 5));
  // jagged icing grin, big enough to read across the arena
  tilt.add(pipe('go_grin', grinPts(0, HC - 0.2, zF, 0.34, 0.12, 8), 0.045, ice, 28, 5));
  // cracked skull
  tilt.add(crack('go_crkH0', 301, [-0.2, HC + 0.5], [0.12, HC - 0.1], zF - 0.006, 0.045, 6, 0.09));
  tilt.add(crack('go_crkH1', 302, [0.4, HC + 0.36], [0.18, HC + 0.08], zF - 0.006, 0.04, 5, 0.07));

  /* ---- arms + fists ---- */
  const armPivot = (side) => {
    const pivot = group([], { pos: [1.02 * side, 1.85, 0], name: side < 0 ? 'armR' : 'armL' });
    const splay = group([], { rot: [-0.14, 0, 0.34 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('go_arm', GO_ARM, GO_ARM_R, D * 0.92, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`go_cuff${z > 0 ? 'F' : 'B'}`, squiggle(-0.28, 0.28, -1.16, z, 1.5, 0.075), 0.045, ice, 16, 5));
    }
    splay.add(crack('go_crkA', 401, [-0.18, -0.2], [0.16, -0.9], zF - 0.006, 0.04, 6, 0.08));
    // oversized fist
    splay.add(mesh(roundedBox(0.72, 0.66, 0.54, 0.16, 2), doughGolem(), { pos: [0, -1.72, 0.02] }));
    splay.add(mesh(roundedBox(0.74, 0.16, 0.56, 0.07, 2), MAT.gingerbreadBurnt, { pos: [0, -1.5, 0.02] }));
    for (let k = 0; k < 3; k++) {
      splay.add(gumdrop([-0.22 + k * 0.22, -1.9, 0.3], 0.075, PALETTE.gumdropRed, 0.8));
    }
    return { pivot, splay };
  };
  const aR = armPivot(-1);
  const aL = armPivot(1);
  lean.add(aR.pivot, aL.pivot);

  const handR = group([], { pos: [0, -1.72, 0.32], name: 'handR' });
  aR.splay.add(handR);

  /* ---- legs ---- */
  const legPivot = (side) => {
    const pivot = group([], { pos: [0.42 * side, hipY, 0], name: side < 0 ? 'legR' : 'legL' });
    const splay = group([], { rot: [0, 0, 0.05 * side] });
    pivot.add(splay);
    splay.add(mesh(cookieGeo('go_leg', GO_LEG, GO_LEG_R, D * 0.96, { bevel: BV }), dough));
    for (const z of [zF, zB]) {
      splay.add(pipe(`go_ankle${z > 0 ? 'F' : 'B'}`, squiggle(-0.38, 0.38, -1.5, z, 1.5, 0.085), 0.048, ice, 18, 5));
    }
    splay.add(crack('go_crkL', 501, [0.2, -0.3], [-0.16, -1.1], zF - 0.006, 0.042, 6, 0.09));
    return pivot;
  };
  const legR = legPivot(-1);
  const legL = legPivot(1);

  const g = group([torso, legR, legL], { name: 'gingerGolem' });
  g.scale.setScalar(scale);
  g.userData.parts = { torso, head, armL: aL.pivot, armR: aR.pivot, legL, legR, handR, eyes };
  g.userData.height = 5.2 * scale;
  g.userData.radius = 1.6 * scale;
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 6. Gibs -- cookie shrapnel                                          */
/* ------------------------------------------------------------------ */

/**
 * Displace vertices while keeping the mesh watertight: duplicated corner
 * vertices (BoxGeometry has 24) share one offset, keyed by their position.
 */
function jitterVerts(geo, rnd, amt) {
  const pos = geo.attributes.position;
  const seen = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)}|${v.y.toFixed(4)}|${v.z.toFixed(4)}`;
    let o = seen.get(key);
    if (!o) {
      o = [(rnd() - 0.5) * 2 * amt, (rnd() - 0.5) * 2 * amt, (rnd() - 0.5) * 2 * amt];
      seen.set(key, o);
    }
    pos.setXYZ(i, v.x + o[0], v.y + o[1], v.z + o[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

let _gibs = null;

/**
 * Death-explosion debris: seven irregular cookie shards (0.08 - 0.25 units) and
 * the crumb material to render them with. Built once and shared.
 */
export function buildGibs() {
  if (_gibs) return _gibs;
  const rnd = mulberry32(0xc0ff33);
  const chunks = [];

  // flat cookie shards -- cloned from the cached helper so the cache stays clean
  const slabs = [
    [0.18, 0.14, 0.06],
    [0.15, 0.11, 0.05],
    [0.12, 0.13, 0.045],
    [0.09, 0.075, 0.04],
  ];
  for (const [w, h, d] of slabs) {
    chunks.push(jitterVerts(box(w, h, d).clone(), rnd, Math.min(w, h) * 0.22));
  }
  // chunkier broken-off lumps
  for (const r of [0.11, 0.09, 0.06]) {
    chunks.push(jitterVerts(new THREE.TetrahedronGeometry(r, 0), rnd, r * 0.35));
  }

  const crumbMaterial = stdMat('gb_crumb', {
    ...TEX.gingerbread(2),
    color: 0xdcb083,
    roughness: 0.92,
    flatShading: true,
  });

  _gibs = { chunks, crumbMaterial };
  return _gibs;
}
