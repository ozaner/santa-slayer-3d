/**
 * Santa -- the player character.
 *
 * Three builders live here:
 *   buildSanta()      third-person hero rig, 1.85 tall, feet at y=0, facing +Z
 *   buildSantaArms()  first-person viewmodel arms, reaching toward -Z
 *   buildSantaSack()  the toy sack prop / ammo pickup base
 *
 * Everything is procedural and built from ../render/materials.js. No geometry
 * or material is created at module scope: the canvas textures need `document`,
 * so all work happens inside the exported builders.
 *
 * Rigging convention: every limb is a THREE.Group pivot sitting at the joint
 * with its geometry hanging in -Y, so `armL.rotation.x = -0.5` swings the arm
 * forward. Each pivot holds one child "pose" group carrying the rest pose
 * (splay, droop), which keeps the engine's animated rotations additive rather
 * than clobbering the sculpted stance.
 */
import * as THREE from 'three';
import {
  PALETTE,
  MAT,
  TEX,
  stdMat,
  physMat,
  glowMat,
  roundedBox,
  sphere,
  cylinder,
  capsule,
  torus,
  lathe,
  tube,
  extrude,
  mergeGeos,
  mesh,
  group,
  shadowize,
  makeFbm,
  mulberry32,
} from '../render/materials.js';

/* ------------------------------------------------------------------ */
/* Local materials (all keys prefixed sa_, all lazily built)           */
/* ------------------------------------------------------------------ */

const M = {
  boot: () =>
    physMat('sa_boot', {
      color: PALETTE.santaBoot,
      roughness: 0.42,
      clearcoat: 0.5,
      clearcoatRoughness: 0.45,
    }),
  sole: () => stdMat('sa_sole', { color: 0x0d0a09, roughness: 0.92 }),
  glove: () =>
    physMat('sa_glove', {
      color: 0x2b211d,
      roughness: 0.55,
      clearcoat: 0.3,
      clearcoatRoughness: 0.5,
    }),
  belt: () =>
    stdMat('sa_belt', {
      color: PALETTE.santaBelt,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide,
    }),
  goldDeep: () => stdMat('sa_goldDeep', { color: 0xc9992f, roughness: 0.34, metalness: 0.95 }),
  nose: () =>
    physMat('sa_nose', {
      color: 0xe8a184,
      roughness: 0.5,
      sheen: 0.4,
      sheenColor: 0xffc9b4,
    }),
  cheek: () =>
    physMat('sa_cheek', {
      color: 0xdd8b78,
      roughness: 0.55,
      sheen: 0.6,
      sheenColor: 0xffb3a2,
    }),
  skinShade: () => physMat('sa_skinShade', { color: PALETTE.santaSkinShadow, roughness: 0.66 }),
  eye: () =>
    physMat('sa_eye', {
      color: 0x120f10,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    }),
  glint: () => glowMat('sa_glint', 0xffffff),
  mouth: () => stdMat('sa_mouth', { color: 0x5e2320, roughness: 0.6 }),
  burlap: () => stdMat('sa_burlap', { ...TEX.velvet(0x9d7f56, 6), roughness: 0.97, metalness: 0 }),
  burlapDark: () => stdMat('sa_burlapDark', { ...TEX.velvet(0x7c6341, 6), roughness: 0.97 }),
  rope: () => stdMat('sa_rope', { ...TEX.velvet(0xc4a06a, 10), roughness: 0.92 }),
  wrapA: () =>
    stdMat('sa_wrapA', { ...TEX.wrapping(PALETTE.gumdropGreen, PALETTE.icing, 1), roughness: 0.55 }),
  wrapB: () =>
    stdMat('sa_wrapB', { ...TEX.wrapping(PALETTE.gumdropPurple, PALETTE.gold, 2), roughness: 0.55 }),
  wrapC: () =>
    stdMat('sa_wrapC', { ...TEX.wrapping(PALETTE.candyRed, PALETTE.candyWhite, 3), roughness: 0.55 }),
  ribbon: () =>
    physMat('sa_ribbon', {
      color: PALETTE.gold,
      roughness: 0.3,
      metalness: 0.15,
      sheen: 0.8,
      sheenColor: 0xfff0c0,
    }),
};

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const _v = () => new THREE.Vector3();

/**
 * Merge a list of jittered spheres into ONE mesh -- the workhorse behind the
 * beard, brows, moustache, pom-pom and every fur trim. A blob cluster reads as
 * soft organic volume where a cone or a box reads as programmer art.
 *
 * Each blob: { p:[x,y,z], r, s:[sx,sy,sz], rot:[x,y,z] }. The unit sphere is
 * cached once and the radius rides in the scale, so this costs one geometry.
 */
function blobCluster(list, material, seg = 9, rings = 6) {
  const geos = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const b of list) {
    const g = sphere(1, seg, rings).clone();
    const s = b.s || [1, 1, 1];
    const r = b.r === undefined ? 1 : b.r;
    e.set(...(b.rot || [0, 0, 0]));
    q.setFromEuler(e);
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(b.p[0], b.p[1], b.p[2]),
        q,
        new THREE.Vector3(s[0] * r, s[1] * r, s[2] * r),
      ),
    );
    geos.push(g);
  }
  return mesh(mergeGeos(geos), material);
}

/**
 * A ring of fur: a torus core (lying in the XZ plane, axis +Y) wrapped in
 * clumps so the silhouette is fluffy instead of a smooth doughnut.
 * Returns a group -- rotate it to face another axis.
 */
function furRing(r, t, count, seed, { squash = 0.85, wobble = 0.7 } = {}) {
  const rnd = mulberry32(seed);
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const rr = r + (rnd() - 0.5) * t * wobble;
    const br = t * (1.02 + rnd() * 0.55);
    list.push({
      p: [Math.cos(a) * rr, (rnd() - 0.5) * t * 0.9, Math.sin(a) * rr],
      r: br,
      s: [1, squash, 1],
    });
  }
  return group([
    mesh(torus(r, t, 5, Math.min(20, Math.max(12, count * 2))), MAT.fur, {
      rot: [Math.PI / 2, 0, 0],
    }),
    blobCluster(list, MAT.fur, 7, 5),
  ]);
}

/** Open tapered frustum spanning two points -- used for the floppy hat. */
function taperedSegment(a, b, rA, rB, material, seg = 18) {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const dir = _v().set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = Math.max(1e-3, dir.length());
  const m = mesh(cylinder(rB, rA, len, seg, true), material);
  m.position.copy(va).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return m;
}

/** A limb bone: a Y-aligned capsule centred at `y` below its joint pivot. */
function bone(r, len, y, material, { scale, z = 0, x = 0, seg = 10 } = {}) {
  return mesh(capsule(r, len, 4, seg), material, { pos: [x, y, z], scale });
}

/** Pivot group + inner pose group. Returns [pivot, pose]. */
function jointPivot(pos, poseRot, name) {
  const pose = group([], { rot: poseRot });
  const pivot = group([pose], { pos, name });
  return [pivot, pose];
}

/* ------------------------------------------------------------------ */
/* Santa -- skeleton layout (world metres, feet at y = 0)              */
/* ------------------------------------------------------------------ */

const HIP_Y = 0.80; // hip pivot
const TORSO_Y = 0.94; // waist pivot -- torso group origin
const SHOULDER_Y = 1.30; // shoulder pivot
const HEAD_Y = 1.34; // head group origin (base of the skull / jaw)

/**
 * Chamfered-rectangle sub-path for the belt buckle. Straight chamfers rather
 * than arcs: the extrude bevel rounds them off anyway, at a fraction of the
 * triangles a curved corner would cost.
 */
function roundRectPath(p, w, h, r) {
  const x = w / 2;
  const y = h / 2;
  p.moveTo(-x + r, -y);
  p.lineTo(x - r, -y);
  p.lineTo(x, -y + r);
  p.lineTo(x, y - r);
  p.lineTo(x - r, y);
  p.lineTo(-x + r, y);
  p.lineTo(-x, y - r);
  p.lineTo(-x, -y + r);
  p.lineTo(-x + r, -y);
  return p;
}

/* ------------------------------------------------------------------ */
/* Legs and boots                                                      */
/* ------------------------------------------------------------------ */

/** One black boot, origin on the ground, toe pointing +Z. */
function buildBoot(seed) {
  const shaft = lathe(
    [
      [0.001, 0.1],
      [0.086, 0.105],
      [0.094, 0.145],
      [0.089, 0.225],
      [0.094, 0.3],
      [0.106, 0.345],
      [0.098, 0.362],
      [0.001, 0.366],
    ],
    16,
  );
  const cuff = furRing(0.108, 0.042, 6, seed, { squash: 0.9 });
  cuff.position.y = 0.336;
  return group([
    mesh(roundedBox(0.158, 0.05, 0.335, 0.022, 1), M.sole(), { pos: [0, 0.024, 0.05] }),
    mesh(roundedBox(0.147, 0.125, 0.3, 0.055, 2), M.boot(), { pos: [0, 0.093, 0.045] }),
    mesh(sphere(1, 10, 8), M.boot(), { pos: [0, 0.082, 0.165], scale: [0.071, 0.056, 0.05] }),
    mesh(shaft, M.boot()),
    cuff,
  ]);
}

/**
 * Leg pivot at the hip with everything hanging in -Y.
 * @param {number} sx +1 = Santa's left (+X, since he faces +Z), -1 = right
 */
function buildLeg(sx, seed) {
  const [pivot, pose] = jointPivot(
    [0.132 * sx, HIP_Y, 0],
    [0.015, 0, -0.035 * sx],
    sx > 0 ? 'legL' : 'legR',
  );
  // hip and knee balls are buried under the coat / boot cuff, so they stay cheap
  const trouser = MAT.santaCoatDark;
  pose.add(mesh(sphere(1, 8, 6), trouser, { pos: [0, -0.01, 0], scale: [0.116, 0.125, 0.116] }));
  pose.add(bone(0.1, 0.2, -0.17, trouser, { scale: [1, 1, 0.97] }));
  pose.add(mesh(sphere(1, 8, 6), trouser, { pos: [0, -0.4, 0.004], scale: 0.093 }));
  pose.add(bone(0.087, 0.17, -0.47, trouser, { z: 0.004 }));
  const boot = buildBoot(seed);
  boot.position.set(0, -HIP_Y, 0);
  pose.add(boot);
  return pivot;
}

/* ------------------------------------------------------------------ */
/* Torso: coat barrel, belt, buckle, trim                              */
/* ------------------------------------------------------------------ */

/**
 * The coat body. Origin is the waist (TORSO_Y); the whole lathed barrel plus
 * belt lives inside the returned `belly` group so the engine can jiggle it.
 */
function buildTorsoShell() {
  // [radius, y] bottom -> top, in torso-local space.
  const coat = lathe(
    [
      [0.001, -0.3],
      [0.19, -0.305],
      [0.293, -0.288],
      [0.318, -0.234],
      [0.307, -0.15],
      [0.297, -0.06],
      [0.291, 0.02],
      [0.301, 0.085],
      [0.335, 0.16],
      [0.344, 0.222],
      [0.328, 0.29],
      [0.291, 0.35],
      [0.257, 0.4],
      [0.204, 0.444],
      [0.134, 0.472],
      [0.091, 0.487],
      [0.001, 0.492],
    ],
    24,
  );

  const belt = mesh(
    lathe(
      [
        [0.322, -0.07],
        [0.334, -0.042],
        [0.336, 0.03],
        [0.324, 0.068],
      ],
      26,
    ),
    M.belt(),
    { pos: [0, 0.02, 0] },
  );

  // Buckle: a real bevelled frame with a hole punched through it.
  const frame = new THREE.Shape();
  roundRectPath(frame, 0.118, 0.1, 0.026);
  const hole = new THREE.Path();
  roundRectPath(hole, 0.074, 0.058, 0.016);
  frame.holes.push(hole);
  const buckle = group(
    [
      mesh(extrude(frame, 0.026, 0.008), MAT.gold),
      mesh(roundedBox(0.015, 0.104, 0.018, 0.006, 1), M.goldDeep(), { pos: [0, 0, 0.03] }),
    ],
    { pos: [0, 0.02, 0.315] },
  );

  // White fur placket running the full height of the coat front.
  const placket = mesh(
    tube(
      [
        [0, 0.478, 0.118],
        [0, 0.44, 0.198],
        [0, 0.4, 0.252],
        [0, 0.35, 0.286],
        [0, 0.29, 0.322],
        [0, 0.222, 0.338],
        [0, 0.16, 0.33],
        [0, 0.085, 0.296],
        [0, 0.02, 0.287],
        [0, -0.06, 0.292],
        [0, -0.15, 0.302],
        [0, -0.234, 0.313],
        [0, -0.288, 0.288],
        [0, -0.303, 0.22],
      ],
      0.032,
      22,
      6,
    ),
    MAT.fur,
  );

  const buttonGeo = lathe(
    [
      [0.001, 0],
      [0.03, 0.002],
      [0.034, 0.011],
      [0.03, 0.021],
      [0.014, 0.027],
      [0.001, 0.028],
    ],
    12,
  );
  // z values put each button's base on the placket surface (centreline + tube
  // radius) so the domes read proud of the fur instead of sinking into it.
  const buttons = group([
    mesh(buttonGeo, MAT.licorice, { pos: [0, 0.4, 0.268], rot: [Math.PI / 2, 0, 0] }),
    mesh(buttonGeo, MAT.licorice, { pos: [0, 0.3, 0.334], rot: [Math.PI / 2, 0, 0] }),
    mesh(buttonGeo, MAT.licorice, { pos: [0, -0.12, 0.317], rot: [Math.PI / 2, 0, 0] }),
    mesh(buttonGeo, MAT.licorice, { pos: [0, -0.222, 0.33], rot: [Math.PI / 2, 0, 0] }),
  ]);

  const hem = furRing(0.303, 0.05, 12, 4131, { squash: 0.95 });
  hem.position.y = -0.293;

  const belly = group([mesh(coat, MAT.santaCoat), belt, buckle, placket, buttons, hem], {
    name: 'belly',
  });
  return belly;
}

/* ------------------------------------------------------------------ */
/* Arms, gloves                                                        */
/* ------------------------------------------------------------------ */

/** A black mitten-glove with a defined thumb. Palm sits at the origin. */
function buildGlove(sx) {
  const g = group([
    mesh(sphere(1, 10, 8), M.glove(), { pos: [0, -0.035, 0.008], scale: [0.056, 0.078, 0.05] }),
    mesh(capsule(0.023, 0.036, 4, 8), M.glove(), {
      pos: [0.046 * sx, -0.028, 0.022],
      rot: [0.35, 0, -0.55 * sx],
    }),
    mesh(sphere(1, 10, 8), M.glove(), { pos: [0, -0.095, 0.022], scale: [0.05, 0.036, 0.045] }),
  ]);
  return g;
}

/**
 * Arm pivot at the shoulder, geometry hanging in -Y.
 * @param {number} sx +1 = Santa's left (+X), -1 = right
 * @returns {{pivot: THREE.Group, hand: THREE.Group}}
 */
function buildArm(sx, seed) {
  // NB: the pivot lives inside the torso group, so the shoulder height is
  // expressed relative to the waist.
  const [pivot, pose] = jointPivot(
    [0.288 * sx, SHOULDER_Y - TORSO_Y, 0.012],
    [0.05, 0, 0.14 * sx],
    sx > 0 ? 'armL' : 'armR',
  );
  const coat = MAT.santaCoat;
  pose.add(mesh(sphere(1, 10, 8), coat, { pos: [0, -0.015, 0], scale: [0.108, 0.11, 0.108] }));
  pose.add(bone(0.089, 0.14, -0.155, coat, { scale: [1, 1, 0.98] }));
  pose.add(mesh(sphere(1, 8, 6), coat, { pos: [0, -0.268, 0], scale: 0.083 }));
  pose.add(bone(0.081, 0.13, -0.355, coat));
  const cuff = furRing(0.088, 0.04, 7, seed, { squash: 0.95 });
  cuff.position.y = -0.452;
  pose.add(cuff);

  const glove = buildGlove(sx);
  glove.position.set(0, -0.478, 0.006);
  pose.add(glove);

  const hand = group([], { pos: [0, -0.53, 0.03], name: sx > 0 ? 'handL' : 'handR' });
  pose.add(hand);
  return { pivot, hand };
}

/* ------------------------------------------------------------------ */
/* Head and face                                                       */
/* ------------------------------------------------------------------ */

/** Eyes, brows, nose, cheeks -- everything above the beard line. */
function buildFace() {
  const parts = [];
  const skin = MAT.skin;

  parts.push(mesh(cylinder(0.086, 0.098, 0.13, 14), skin, { pos: [0, -0.045, 0.004] }));
  parts.push(mesh(sphere(1, 18, 13), skin, { pos: [0, 0.185, 0], scale: [0.152, 0.157, 0.148] }));
  parts.push(mesh(sphere(1, 12, 9), skin, { pos: [0, 0.105, 0.014], scale: [0.132, 0.1, 0.128] }));

  // ears
  for (const sx of [1, -1]) {
    parts.push(
      mesh(sphere(1, 10, 8), skin, {
        pos: [0.147 * sx, 0.185, -0.008],
        scale: [0.022, 0.042, 0.032],
      }),
    );
  }

  // bulbous nose, lathed and turned to face +Z
  const nose = lathe(
    [
      [0.001, 0],
      [0.042, 0.004],
      [0.05, 0.018],
      [0.052, 0.038],
      [0.046, 0.058],
      [0.03, 0.072],
      [0.001, 0.078],
    ],
    18,
  );
  parts.push(mesh(nose, M.nose(), { pos: [0, 0.172, 0.106], rot: [Math.PI / 2, 0, 0] }));
  for (const sx of [1, -1]) {
    parts.push(
      mesh(sphere(1, 8, 6), M.skinShade(), {
        pos: [0.023 * sx, 0.158, 0.15],
        scale: [0.013, 0.011, 0.012],
      }),
    );
    // rosy cheeks
    parts.push(
      mesh(sphere(1, 10, 8), M.cheek(), {
        pos: [0.089 * sx, 0.15, 0.093],
        scale: [0.055, 0.045, 0.042],
      }),
    );
    // eye, lid, and the specular twinkle
    parts.push(
      mesh(sphere(1, 10, 8), M.eye(), {
        pos: [0.058 * sx, 0.222, 0.112],
        scale: [0.026, 0.025, 0.022],
      }),
    );
    parts.push(
      mesh(sphere(1, 10, 8), skin, {
        pos: [0.058 * sx, 0.241, 0.104],
        scale: [0.034, 0.022, 0.028],
      }),
    );
    parts.push(
      mesh(sphere(1, 8, 6), M.glint(), {
        pos: [0.058 * sx + 0.009 * sx, 0.231, 0.132],
        scale: 0.0075,
      }),
    );
  }

  // hint of a smile, mostly veiled by the moustache
  parts.push(
    mesh(sphere(1, 10, 8), M.mouth(), { pos: [0, 0.108, 0.128], scale: [0.033, 0.014, 0.02] }),
  );

  // thick fur eyebrows
  const brows = [];
  const rnd = mulberry32(60724);
  for (const sx of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      brows.push({
        p: [
          sx * (0.03 + t * 0.072),
          0.255 + Math.sin(t * 2.2) * 0.012 - t * 0.012 + (rnd() - 0.5) * 0.006,
          0.122 - t * 0.03,
        ],
        r: 0.024 * (0.92 + rnd() * 0.3),
        s: [1.5, 0.78, 0.85],
        rot: [0, 0, -sx * (0.25 + t * 0.35)],
      });
    }
  }
  parts.push(blobCluster(brows, MAT.fur, 8, 6));

  // moustache: two swept wings under the nose
  const stache = [];
  for (const sx of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      stache.push({
        p: [
          sx * (0.016 + t * 0.09),
          0.142 - t * t * 0.055 + (rnd() - 0.5) * 0.008,
          0.128 - t * 0.055 + (rnd() - 0.5) * 0.006,
        ],
        r: 0.04 * (1 - t * 0.28) * (0.9 + rnd() * 0.25),
        s: [1.15, 0.95, 1],
        rot: [0, 0, -sx * t * 0.5],
      });
    }
  }
  parts.push(blobCluster(stache, MAT.fur, 8, 6));

  return parts;
}

/**
 * The beard: seven rings of overlapping fur blobs wrapped around the jaw and
 * tapering to a point at mid-chest. Deterministic jitter (mulberry32) keeps it
 * organic without being random between runs. The top ring leaves the face open.
 */
function buildBeard() {
  const rows = [
    { y: 0.13, R: 0.15, a0: 0.72, a1: 1.55, n: 6, br: 0.05 },
    { y: 0.06, R: 0.156, a0: 0.3, a1: 1.55, n: 7, br: 0.058 },
    { y: 0.0, R: 0.152, a0: 0.0, a1: 1.5, n: 7, br: 0.062 },
    { y: -0.06, R: 0.142, a0: 0.0, a1: 1.4, n: 6, br: 0.062 },
    { y: -0.12, R: 0.12, a0: 0.0, a1: 1.3, n: 5, br: 0.06 },
    { y: -0.18, R: 0.09, a0: 0.0, a1: 1.2, n: 4, br: 0.056 },
    { y: -0.23, R: 0.055, a0: 0.0, a1: 1.1, n: 3, br: 0.05 },
  ];
  const rnd = mulberry32(20251224);
  const list = [];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0 : (i / (row.n - 1)) * 2 - 1;
      const sign = t < 0 ? -1 : 1;
      const a = sign * (row.a0 + Math.abs(t) * (row.a1 - row.a0)) + (rnd() - 0.5) * 0.1;
      const R = row.R + (rnd() - 0.5) * 0.018;
      list.push({
        p: [Math.sin(a) * R, row.y + (rnd() - 0.5) * 0.02, Math.cos(a) * R * 1.06 + 0.008],
        r: row.br * (0.85 + rnd() * 0.34),
        s: [1, 1.05, 1],
        rot: [0, a, 0],
      });
    }
  }
  // the tip
  list.push({ p: [0.004, -0.272, 0.028], r: 0.046, s: [0.9, 1.25, 0.9] });
  return group([blobCluster(list, MAT.fur, 8, 6)], { name: 'beard' });
}

/**
 * The floppy hat: a tapering cone bent along a curve (five frusta with sphere
 * joints so the bend stays watertight), a fur band and a fur pom-pom.
 * Tops out at about y = 1.85 in world space.
 */
function buildHat() {
  const spine = [
    { p: [0, 0.235, -0.005], r: 0.156 },
    { p: [0.005, 0.335, -0.02], r: 0.128 },
    { p: [0.012, 0.42, -0.075], r: 0.092 },
    { p: [0.03, 0.455, -0.175], r: 0.058 },
    { p: [0.05, 0.41, -0.27], r: 0.032 },
    { p: [0.062, 0.345, -0.325], r: 0.02 },
  ];
  const cloth = MAT.santaCoat;
  const kids = [];
  for (let i = 0; i < spine.length - 1; i++) {
    kids.push(taperedSegment(spine[i].p, spine[i + 1].p, spine[i].r, spine[i + 1].r, cloth, 18));
  }
  for (let i = 1; i < spine.length; i++) {
    kids.push(mesh(sphere(1, 10, 7), cloth, { pos: spine[i].p, scale: spine[i].r * 0.995 }));
  }

  const band = furRing(0.152, 0.048, 11, 3141, { squash: 0.95 });
  band.position.set(0, 0.238, -0.004);
  kids.push(band);

  // pom-pom: a core sphere buried in a cluster of clumps
  const rnd = mulberry32(4242);
  const pom = [{ p: [0, 0, 0], r: 0.055 }];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const v = rnd();
    pom.push({
      p: [
        Math.cos(a) * 0.038,
        Math.sin(a * 1.7) * 0.036,
        Math.sin(a) * 0.038 * (0.7 + v * 0.6),
      ],
      r: 0.03 + rnd() * 0.018,
    });
  }
  const pomG = group([blobCluster(pom, MAT.fur, 9, 7)], { pos: [0.066, 0.318, -0.352] });
  kids.push(pomG);

  return group(kids, { name: 'hat' });
}

function buildHead() {
  const head = group(buildFace(), { pos: [0, HEAD_Y - TORSO_Y, 0], name: 'head' });
  const beard = buildBeard();
  const hat = buildHat();
  head.add(beard, hat);
  return { head, beard, hat };
}

/* ------------------------------------------------------------------ */
/* Export 1: the third-person hero                                     */
/* ------------------------------------------------------------------ */

/**
 * Full Santa Claus. 1.85 m tall (crown of the hat), feet at y = 0, facing +Z.
 *
 * userData.parts = { torso, head, hat, beard, armL, armR, legL, legR,
 *                    handL, handR, belly }
 * Limb pivots sit at the joints with geometry hanging in -Y, so setting
 * `parts.armL.rotation.x = -0.5` swings that arm forward.
 */
export function buildSanta({ scale = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'santa';

  const legL = buildLeg(1, 8801);
  const legR = buildLeg(-1, 9902);
  g.add(legL, legR);

  const torso = group([], { pos: [0, TORSO_Y, 0], name: 'torso' });
  const belly = buildTorsoShell();
  torso.add(belly);

  const collar = furRing(0.132, 0.058, 12, 5150, { squash: 0.8 });
  collar.position.set(0, 0.462, 0.004);
  torso.add(collar);

  const armL = buildArm(1, 3311);
  const armR = buildArm(-1, 3312);
  torso.add(armL.pivot, armR.pivot);

  const { head, beard, hat } = buildHead();
  torso.add(head);
  g.add(torso);

  g.userData.parts = {
    torso,
    head,
    hat,
    beard,
    armL: armL.pivot,
    armR: armR.pivot,
    legL,
    legR,
    handL: armL.hand,
    handR: armR.hand,
    belly,
  };

  g.scale.setScalar(scale);
  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* Export 2: first-person viewmodel arms                               */
/* ------------------------------------------------------------------ */

/** Viewmodel glove: palm slab, four curled fingers, opposed thumb. */
function buildViewGlove(sx) {
  const g = M.glove();
  const kids = [
    mesh(roundedBox(0.118, 0.064, 0.135, 0.03, 2), g, { pos: [0, 0, -0.05] }),
    mesh(sphere(1, 10, 8), g, { pos: [0, -0.004, -0.11], scale: [0.058, 0.033, 0.036] }),
  ];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    kids.push(
      mesh(capsule(0.0185, 0.052, 4, 8), g, {
        pos: [(-0.042 + t * 0.084) * sx, -0.012, -0.112 - Math.sin(t * Math.PI) * 0.012],
        rot: [-1.92, 0, (0.12 - t * 0.24) * sx],
      }),
    );
  }
  kids.push(
    mesh(capsule(0.022, 0.055, 4, 8), g, {
      pos: [0.056 * sx, 0.004, -0.062],
      rot: [-1.35, 0, -0.62 * sx],
    }),
  );
  return group(kids);
}

/**
 * FPS arms. Origin sits at the camera; the forearms reach toward -Z, filling
 * the lower corners of a 75 degree view. Red velvet sleeve, fur cuff, black
 * glove. Weapons get parented to handL / handR.
 *
 * userData.parts = { armL, armR, handL, handR }
 */
export function buildSantaArms({ scale = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'santaArms';
  const parts = {};

  for (const sx of [-1, 1]) {
    const left = sx < 0; // camera looks down -Z, so the left arm sits at -X
    // yaw brings the hands in toward the middle of the screen, pitch lifts them
    const [pivot, pose] = jointPivot(
      [0.28 * sx, -0.25, 0],
      [0.13, 0.22 * sx, -0.06 * sx],
      left ? 'armL' : 'armR',
    );

    // sleeve, lathed then swung from +Y to -Z
    const sleeve = lathe(
      [
        [0.001, 0.02],
        [0.098, 0.03],
        [0.109, 0.075],
        [0.1, 0.17],
        [0.088, 0.28],
        [0.08, 0.35],
        [0.076, 0.382],
        [0.001, 0.386],
      ],
      20,
    );
    pose.add(mesh(sleeve, MAT.santaCoat, { rot: [-Math.PI / 2, 0, 0] }));

    // a darker seam along the top of the sleeve
    pose.add(
      mesh(
        tube(
          [
            [0, 0.09, -0.05],
            [0, 0.088, -0.17],
            [0, 0.078, -0.29],
            [0, 0.072, -0.37],
          ],
          0.011,
          10,
          6,
        ),
        MAT.santaCoatDark,
      ),
    );

    const cuff = furRing(0.084, 0.038, 9, left ? 7711 : 7712, { squash: 0.95 });
    cuff.position.set(0, 0, -0.378);
    cuff.rotation.x = Math.PI / 2;
    pose.add(cuff);

    const glove = buildViewGlove(sx);
    glove.position.set(0, -0.004, -0.4);
    pose.add(glove);

    const hand = group([], { pos: [0, -0.01, -0.47], name: left ? 'handL' : 'handR' });
    pose.add(hand);

    g.add(pivot);
    if (left) {
      parts.armL = pivot;
      parts.handL = hand;
    } else {
      parts.armR = pivot;
      parts.handR = hand;
    }
  }

  g.userData.parts = parts;
  g.scale.setScalar(scale);
  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* Export 3: the toy sack                                              */
/* ------------------------------------------------------------------ */

/** Wrapped box with crossed ribbon and a two-loop bow on top. */
function present(size, material, pos, rot) {
  const s = size;
  const kids = [
    mesh(roundedBox(s, s, s, s * 0.11, 2), material),
    mesh(roundedBox(s * 0.16, s * 1.03, s * 1.03, s * 0.02, 1), M.ribbon()),
    mesh(roundedBox(s * 1.03, s * 1.03, s * 0.16, s * 0.02, 1), M.ribbon()),
    mesh(torus(s * 0.17, s * 0.055, 5, 12), M.ribbon(), {
      pos: [-s * 0.17, s * 0.55, 0],
      rot: [Math.PI / 2, 0, 0.5],
    }),
    mesh(torus(s * 0.17, s * 0.055, 5, 12), M.ribbon(), {
      pos: [s * 0.17, s * 0.55, 0],
      rot: [Math.PI / 2, 0, -0.5],
    }),
  ];
  return group(kids, { pos, rot });
}

/**
 * Santa's toy sack: lumpy burlap (a sphere whose vertices are pushed around by
 * fbm noise, not merely squashed), cinched with a rope, presents spilling out
 * of the gathered mouth. Origin at the base, roughly 1.0 tall.
 */
export function buildSantaSack({ scale = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'santaSack';

  /* --- lumpy burlap body ------------------------------------------ */
  const R = 0.42;
  const profile = (h) => {
    if (h < 0.09) return 0.085 + (h / 0.09) * 0.235; // flared, flat-ish base
    if (h < 0.45) return 0.32 + ((h - 0.09) / 0.36) * 0.06; // belly
    if (h < 0.78) return 0.38 - ((h - 0.45) / 0.33) * 0.165; // shoulders
    return 0.215 - ((h - 0.78) / 0.22) * 0.105; // cinched neck
  };
  const fbm = makeFbm({ seed: 8421, octaves: 4, baseFreq: 3 });
  const geo = sphere(R, 26, 20).clone();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.min(1, Math.max(0, (v.y / R + 1) / 2));
    const rad = Math.hypot(v.x, v.z);
    const theta = Math.atan2(v.z, v.x);
    const n = fbm((theta / (Math.PI * 2) + 1) % 1, h * 0.85) - 0.5;
    const target = profile(h) * (1 + n * 0.28);
    if (rad > 1e-6) {
      v.x = (v.x / rad) * target;
      v.z = (v.z / rad) * target;
    }
    pos.setXYZ(i, v.x, 0.8 * Math.pow(h, 1.35) + n * 0.022 * Math.min(1, h * 6), v.z);
  }
  geo.computeVertexNormals();
  g.add(mesh(geo, M.burlap()));

  /* --- gathered mouth above the tie -------------------------------- */
  g.add(
    mesh(
      lathe(
        [
          [0.128, 0.702],
          [0.16, 0.78],
          [0.215, 0.86],
          [0.27, 0.945],
          [0.238, 0.95],
          [0.185, 0.875],
          [0.14, 0.795],
          [0.12, 0.715],
        ],
        22,
      ),
      M.burlapDark(),
    ),
  );

  /* --- rope tie ---------------------------------------------------- */
  const rope = M.rope();
  g.add(mesh(torus(0.162, 0.026, 6, 18), rope, { pos: [0, 0.715, 0], rot: [Math.PI / 2, 0, 0] }));
  g.add(mesh(sphere(1, 10, 8), rope, { pos: [0.02, 0.715, 0.166], scale: [0.05, 0.042, 0.04] }));
  g.add(
    mesh(
      tube(
        [
          [0.08, 0.7, 0.16],
          [0.17, 0.64, 0.18],
          [0.23, 0.55, 0.15],
          [0.235, 0.45, 0.1],
        ],
        0.017,
        16,
        6,
      ),
      rope,
    ),
  );
  g.add(
    mesh(
      tube(
        [
          [-0.02, 0.7, 0.17],
          [-0.05, 0.61, 0.22],
          [-0.02, 0.52, 0.25],
          [0.04, 0.47, 0.22],
        ],
        0.015,
        16,
        6,
      ),
      rope,
    ),
  );

  /* --- what's inside ----------------------------------------------- */
  g.add(present(0.16, M.wrapA(), [0.075, 0.93, 0.05], [0.28, 0.55, 0.2]));
  g.add(present(0.14, M.wrapB(), [-0.1, 0.915, -0.05], [-0.2, 0.95, -0.34]));
  g.add(present(0.115, M.wrapC(), [0.02, 0.9, -0.125], [0.42, 0.3, 0.18]));

  // striped drum with gold rims
  const drum = group(
    [
      mesh(cylinder(0.078, 0.078, 0.13, 18), MAT.candy),
      mesh(torus(0.078, 0.011, 6, 18), MAT.gold, { pos: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0] }),
      mesh(torus(0.078, 0.011, 6, 18), MAT.gold, { pos: [0, -0.06, 0], rot: [Math.PI / 2, 0, 0] }),
    ],
    { pos: [-0.105, 0.945, 0.095], rot: [0.4, 0, 0.55] },
  );
  g.add(drum);

  // candy cane hooked over the rim
  g.add(
    mesh(
      tube(
        [
          [0.145, 0.78, 0.02],
          [0.165, 0.87, 0.005],
          [0.175, 0.95, -0.01],
          [0.158, 1.005, -0.025],
          [0.115, 1.025, -0.03],
          [0.086, 1.0, -0.028],
          [0.09, 0.965, -0.024],
        ],
        0.019,
        26,
        7,
      ),
      MAT.candy,
    ),
  );

  // teddy peeking over the edge
  const plush = stdMat('sa_plush', { ...TEX.velvet(0x9a6a41, 4), roughness: 0.95 });
  g.add(
    group(
      [
        blobCluster(
          [
            { p: [0, 0, 0], r: 0.062 },
            { p: [-0.05, 0.048, -0.006], r: 0.026 },
            { p: [0.05, 0.048, -0.006], r: 0.026 },
          ],
          plush,
          10,
          8,
        ),
        mesh(sphere(1, 10, 8), M.skinShade(), {
          pos: [0, -0.018, 0.052],
          scale: [0.031, 0.024, 0.026],
        }),
        mesh(sphere(1, 8, 6), M.eye(), { pos: [0, -0.012, 0.078], scale: 0.011 }),
        mesh(sphere(1, 8, 6), M.eye(), { pos: [-0.03, 0.017, 0.052], scale: 0.009 }),
        mesh(sphere(1, 8, 6), M.eye(), { pos: [0.03, 0.017, 0.052], scale: 0.009 }),
      ],
      { pos: [-0.055, 0.955, 0.13], rot: [-0.15, -0.35, 0.1] },
    ),
  );

  g.scale.setScalar(scale);
  shadowize(g);
  return g;
}

