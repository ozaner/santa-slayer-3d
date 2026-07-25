/**
 * Procedural first-person weapon viewmodels.
 *
 * These four guns live in the bottom-right of the screen for the entire game,
 * so they get more silhouette work than anything else in the project: lathed
 * barrels and muzzles, rounded and bevelled bodies, and no raw 90 degree edge
 * anywhere.
 *
 * Conventions shared with the engine:
 *   - metres, Y up, and the barrel aims down -Z (the direction a three.js
 *     camera looks), so a viewmodel can be parented straight to the camera.
 *   - the origin sits at the grip, roughly inside the player's fist.
 *   - every builder returns a THREE.Group carrying
 *       userData.parts      = { muzzle, body, moving, grip }
 *       userData.viewOffset = Vector3, suggested offset from the camera
 *   - models are static. Recoil, spin, break-open and bob are the engine's job
 *     via the exposed part handles.
 *
 * Nothing runs at module scope: every texture in materials.js is painted onto
 * a canvas, so all MAT/TEX access happens inside a builder call.
 */
import * as THREE from 'three';
import {
  PALETTE,
  MAT,
  TEX,
  stdMat,
  physMat,
  glowMat,
  emissiveMat,
  candyMat,
  canvasTexture,
  mulberry32,
  roundedBox,
  sphere,
  cylinder,
  cone,
  torus,
  capsule,
  lathe,
  tube,
  mesh,
  group,
  shadowize,
} from '../render/materials.js';

/* ------------------------------------------------------------------ */
/* Local conventions                                                   */
/* ------------------------------------------------------------------ */

/**
 * Rotation that takes a +Y aligned primitive (lathe, cylinder, cone, capsule)
 * and aims it down -Z. Lathe profiles are therefore authored as
 * `[radius, distanceForwardFromTheMeshOrigin]`.
 */
const AIM = -Math.PI / 2;

/** Torus geometry is born in the XY plane (hole along Z) -- flat on the floor. */
const LIE_FLAT = Math.PI / 2;

/* ------------------------------------------------------------------ */
/* Weapon-only materials (all keys prefixed wp_)                       */
/* ------------------------------------------------------------------ */

/** Deep glossy enamel, the toy-workshop lacquer used on the launcher. */
function matEnamel(name, colorHex) {
  return physMat(`wp_enamel_${name}`, {
    color: colorHex,
    roughness: 0.22,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

/** Warm brushed brass for fittings, softer than the mirror of MAT.gold. */
function matBrass() {
  return stdMat('wp_brass', {
    ...TEX.metal(PALETTE.gold, 1),
    color: 0xffe6a8,
    roughness: 0.34,
    metalness: 0.95,
  });
}

/** Satin ribbon. */
function matRibbon(name, colorHex) {
  return physMat(`wp_ribbon_${name}`, {
    color: colorHex,
    roughness: 0.35,
    sheen: 1,
    sheenRoughness: 0.4,
    sheenColor: 0xffffff,
  });
}

/** Wrapping paper in an arbitrary colourway. */
function matWrap(name, bgHex, fgHex, seed) {
  return stdMat(`wp_wrap_${name}`, {
    ...TEX.wrapping(bgHex, fgHex, seed),
    roughness: 0.5,
    metalness: 0.03,
  });
}

/**
 * Candy-cane helix.
 *
 * TEX.candyStripe paints 45 degree stripes, so the helix pitch is decided
 * purely by the texture repeat -- and cylinders and tubes have transposed UV
 * layouts (cylinder: u around, v along; tube: u along, v around). Hence two
 * variants. The repeat that wraps is kept an exact multiple of the stripe
 * period so the seam is invisible.
 */
const _caneTex = { cyl: null, tube: null };

function caneTexture(kind) {
  if (!_caneTex[kind]) {
    const t = TEX.candyStripe(PALETTE.candyWhite, PALETTE.candyRed, 1, 6).map.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // cylinder: 9 stripes around (1.5 * 6), ~21 along -> roughly a 45 deg helix.
    // tube:     6 stripes around (1 * 6), 15 along.
    if (kind === 'cyl') t.repeat.set(1.5, 3.5);
    else t.repeat.set(2.5, 1);
    t.needsUpdate = true;
    _caneTex[kind] = t;
  }
  return _caneTex[kind];
}

function matCane(kind) {
  return physMat(`wp_cane_${kind}`, {
    map: caneTexture(kind),
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
}

/** Painted peppermint pinwheel, mapped onto a disc's end cap. */
function matPeppermint() {
  const map = canvasTexture('wp_peppermint', 256, (ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = '#fdfaf5';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#e23b3b';
    const arms = 6;
    for (let i = 0; i < arms; i++) {
      const a0 = (i / arms) * Math.PI * 2;
      ctx.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const r = t * c * 0.9;
        const a = a0 + t * 1.15;
        ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      for (let t = 1; t >= -0.0001; t -= 0.05) {
        const r = t * c * 0.9;
        const a = a0 + 0.46 + t * 1.15;
        ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#e23b3b';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  });
  return physMat('wp_peppermint', {
    map,
    roughness: 0.09,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
}

/** Thick blown glass for the snowball hopper. */
function matHopperGlass() {
  return physMat('wp_hopperglass', {
    color: 0xf0f8ff,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.92,
    thickness: 0.09,
    ior: 1.45,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
  });
}

/** Flat-shaded shard crystal, colder and sharper than MAT.ice. */
function matCrystal() {
  return physMat('wp_crystal', {
    color: PALETTE.ice,
    roughness: 0.04,
    metalness: 0,
    transmission: 0.85,
    thickness: 0.12,
    ior: 1.31,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    flatShading: true,
  });
}

/** Tinted optics glass for the rail scope. */
function matLens() {
  return physMat('wp_lensglass', {
    color: 0x9fe8ff,
    roughness: 0.03,
    metalness: 0,
    transmission: 0.8,
    thickness: 0.02,
    ior: 1.5,
  });
}

/** Soft additive halo used by pickups. */
function matHalo(name, colorHex, opacity) {
  const m = glowMat(`wp_halo_${name}`, colorHex, opacity);
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  return m;
}

/* ------------------------------------------------------------------ */
/* Small shared sub-assemblies                                         */
/* ------------------------------------------------------------------ */

/** A ring of rivet spheres around an axis running down -Z at (0, y). */
function rivetRing(count, ringR, dotR, mat, { y = 0, z = 0, phase = 0.3 } = {}) {
  const out = [];
  const geo = sphere(dotR, 8, 6);
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    out.push(mesh(geo, mat, { pos: [Math.cos(a) * ringR, y + Math.sin(a) * ringR, z] }));
  }
  return out;
}

/** A straight row of rivets along Z on a flat panel. */
function rivetRow(count, dotR, mat, [x, y, z0], stepZ) {
  const out = [];
  const geo = sphere(dotR, 8, 6);
  for (let i = 0; i < count; i++) out.push(mesh(geo, mat, { pos: [x, y, z0 + i * stepZ] }));
  return out;
}

/** Smooth swept trigger guard loop in the YZ plane. */
function triggerGuard(mat, { x = 0, top = 0.045, drop = -0.04, front = -0.02, back = 0.06, r = 0.0075 } = {}) {
  return mesh(
    tube(
      [
        [x, top, back],
        [x, top - 0.022, front + 0.012],
        [x, drop + 0.014, front],
        [x, drop, front + 0.03],
        [x, drop + 0.01, back - 0.016],
        [x, top - 0.014, back],
      ],
      r,
      26,
      6
    ),
    mat
  );
}

/** Grip block with moulded finger ridges, built around its own origin. */
function gripBlock(mat, { w = 0.052, h = 0.15, d = 0.064, ridgeMat, ridges = 3 } = {}) {
  const parts = [mesh(roundedBox(w, h, d, 0.022, 2), mat)];
  const rm = ridgeMat || mat;
  for (let i = 0; i < ridges; i++) {
    parts.push(
      mesh(cylinder(0.0075, 0.0075, w * 0.98, 8), rm, {
        pos: [0, -h * 0.1 - i * h * 0.19, -d * 0.42],
        rot: [0, 0, Math.PI / 2],
      })
    );
  }
  return group(parts);
}

/**
 * A wrapped present: paper cube, crossed ribbon bands, four-loop bow.
 * Returns { root, bow } so callers can animate the bow separately.
 */
function wrappedPresent(size, { name, bg, fg, seed, ribbonHex = PALETTE.gold, tails = false }) {
  const s = size;
  const paper = matWrap(name, bg, fg, seed);
  const ribbon = matRibbon(name, ribbonHex);
  const band = s * 0.2;

  const parts = [
    mesh(roundedBox(s, s, s, s * 0.1, 2), paper),
    mesh(roundedBox(band, s * 1.03, s * 1.03, s * 0.045, 1), ribbon),
    mesh(roundedBox(s * 1.03, s * 1.03, band, s * 0.045, 1), ribbon),
  ];

  const loopR = s * 0.2;
  const loopGeo = torus(loopR, s * 0.058, 6, 14);
  const bowParts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    bowParts.push(
      group([mesh(loopGeo, ribbon, { pos: [loopR * 0.85, loopR * 0.34, 0], scale: [1, 0.74, 1] })], {
        rot: [0, -a, 0],
      })
    );
  }
  bowParts.push(mesh(sphere(s * 0.105, 10, 8), ribbon, { pos: [0, s * 0.03, 0] }));
  if (tails) {
    for (let i = 0; i < 2; i++) {
      bowParts.push(
        mesh(roundedBox(s * 0.11, s * 0.03, s * 0.34, s * 0.012, 1), ribbon, {
          pos: [0, -s * 0.06, 0],
          rot: [-0.5, i === 0 ? 0.8 : -2.4, 0.2],
        })
      );
    }
  }
  const bow = group(bowParts, { pos: [0, s * 0.52, 0] });
  parts.push(bow);

  return { root: group(parts), bow };
}

/* ------------------------------------------------------------------ */
/* 1. Present launcher -- the rocket launcher                          */
/* ------------------------------------------------------------------ */

/**
 * A shoulder-mounted present cannon: enamelled red-and-green body, brass
 * blunderbuss bell, a top hopper with a gift sitting in it ready to drop.
 * `moving` is that gift -- the engine bobs it during reload.
 */
export function buildPresentLauncher() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const red = matEnamel('red', 0xcf2233);
  const green = matEnamel('green', 0x1f7a46);
  const brass = matBrass();
  const gold = MAT.gold;
  const steel = MAT.steel;

  const AXIS_Y = 0.115; // barrel centreline

  /* --- receiver ---------------------------------------------------- */
  body.add(mesh(roundedBox(0.126, 0.136, 0.3, 0.032, 3), red, { pos: [0, AXIS_Y, -0.09] }));
  for (const sx of [-1, 1]) {
    body.add(
      mesh(roundedBox(0.008, 0.094, 0.2, 0.01, 1), green, { pos: [sx * 0.064, AXIS_Y, -0.09] })
    );
    body.add(...rivetRow(4, 0.0075, brass, [sx * 0.07, AXIS_Y + 0.048, -0.17], 0.052));
    // gumdrop selector buttons, the only pure candy on this gun
    body.add(
      mesh(sphere(0.013, 10, 8), candyMat(PALETTE.gumdropPurple), {
        pos: [sx * 0.066, AXIS_Y - 0.04, -0.02],
        scale: [0.6, 1, 1],
      })
    );
  }
  // gold collars capping the receiver ends
  body.add(mesh(roundedBox(0.136, 0.146, 0.022, 0.008, 1), gold, { pos: [0, AXIS_Y, -0.226] }));
  body.add(mesh(roundedBox(0.136, 0.146, 0.022, 0.008, 1), gold, { pos: [0, AXIS_Y, 0.036] }));
  // piped icing bead along the top seam, stopping short of the hopper
  body.add(mesh(roundedBox(0.02, 0.014, 0.105, 0.007, 1), MAT.icing, { pos: [0, AXIS_Y + 0.07, -0.176] }));
  body.add(mesh(roundedBox(0.02, 0.014, 0.05, 0.007, 1), MAT.icing, { pos: [0, AXIS_Y + 0.07, 0.022] }));

  /* --- barrel ------------------------------------------------------ */
  const barrel = lathe(
    [
      [0.0, 0.0],
      [0.074, 0.0],
      [0.074, 0.016],
      [0.066, 0.026],
      [0.052, 0.032],
      [0.052, 0.086],
      [0.058, 0.096],
      [0.058, 0.108],
      [0.052, 0.118],
      [0.052, 0.174],
      [0.059, 0.186],
      [0.059, 0.198],
      [0.053, 0.208],
      [0.053, 0.232],
    ],
    26
  );
  body.add(mesh(barrel, steel, { pos: [0, AXIS_Y, -0.216], rot: [AIM, 0, 0] }));

  // flared blunderbuss horn: out along the outside, back down the bore
  const bell = lathe(
    [
      [0.053, 0.0],
      [0.056, 0.014],
      [0.068, 0.04],
      [0.086, 0.068],
      [0.108, 0.094],
      [0.126, 0.114],
      [0.136, 0.128],
      [0.139, 0.14],
      [0.132, 0.147],
      [0.123, 0.142],
      [0.107, 0.126],
      [0.086, 0.102],
      [0.068, 0.074],
      [0.052, 0.044],
      [0.046, 0.016],
      [0.045, 0.0],
    ],
    32
  );
  body.add(mesh(bell, gold, { pos: [0, AXIS_Y, -0.448], rot: [AIM, 0, 0] }));

  // brass rings + rivets down the tube
  for (const z of [-0.29, -0.37]) {
    body.add(mesh(torus(0.058, 0.0085, 8, 20), brass, { pos: [0, AXIS_Y, z] }));
    body.add(...rivetRing(6, 0.058, 0.0085, gold, { y: AXIS_Y, z: z + 0.016 }));
  }
  body.add(mesh(torus(0.056, 0.007, 8, 20), gold, { pos: [0, AXIS_Y, -0.44] }));

  // front sight blade
  body.add(mesh(roundedBox(0.012, 0.03, 0.014, 0.004, 1), gold, { pos: [0, AXIS_Y + 0.068, -0.33] }));

  /* --- hopper + the present it is holding -------------------------- */
  const hopper = group(
    [
      mesh(
        lathe(
          [
            [0.052, 0.0],
            [0.056, 0.012],
            [0.072, 0.07],
            [0.079, 0.084],
            [0.085, 0.093],
            [0.08, 0.101],
            [0.07, 0.09],
            [0.064, 0.076],
            [0.048, 0.016],
            [0.044, 0.0],
          ],
          24
        ),
        steel
      ),
      mesh(torus(0.083, 0.008, 6, 22), brass, { pos: [0, 0.094, 0], rot: [LIE_FLAT, 0, 0] }),
      mesh(torus(0.056, 0.008, 6, 20), brass, { pos: [0, 0.012, 0], rot: [LIE_FLAT, 0, 0] }),
    ],
    { pos: [0, AXIS_Y + 0.058, -0.06] }
  );
  body.add(hopper);

  const gift = wrappedPresent(0.086, {
    name: 'hopper',
    bg: PALETTE.candyGreen,
    fg: PALETTE.candyWhite,
    seed: 1,
    ribbonHex: PALETTE.candyRed,
  });
  // sits proud of the hopper rim so the whole gift reads, not just a lid
  gift.root.position.set(0, AXIS_Y + 0.145, -0.06);
  gift.root.rotation.set(0.12, 0.5, -0.08);
  body.add(gift.root);

  /* --- pilot light, on the side the player actually sees ----------- */
  body.add(
    mesh(cylinder(0.016, 0.019, 0.02, 14), brass, {
      pos: [-0.072, AXIS_Y + 0.012, -0.16],
      rot: [0, 0, Math.PI / 2],
    })
  );
  body.add(
    mesh(sphere(0.012, 10, 8), emissiveMat('wp_pilot', PALETTE.warmLight, 3), {
      pos: [-0.083, AXIS_Y + 0.012, -0.16],
    })
  );

  /* --- wooden stock ------------------------------------------------ */
  const stock = group(
    [
      mesh(roundedBox(0.088, 0.104, 0.15, 0.028, 2), MAT.wood, { pos: [0, 0, 0.07] }),
      mesh(roundedBox(0.07, 0.05, 0.07, 0.02, 1), MAT.wood, { pos: [0, 0.03, -0.01] }),
      mesh(roundedBox(0.094, 0.12, 0.018, 0.006, 1), MAT.licorice, { pos: [0, -0.006, 0.148] }),
      mesh(torus(0.012, 0.004, 6, 14), brass, { pos: [0, -0.05, 0.085], rot: [0, LIE_FLAT, 0] }),
    ],
    { pos: [0, AXIS_Y - 0.028, 0.036], rot: [0.12, 0, 0] }
  );
  body.add(stock);

  /* --- grip + trigger ---------------------------------------------- */
  const grip = gripBlock(MAT.leather, { w: 0.054, h: 0.152, d: 0.066, ridgeMat: MAT.licorice });
  grip.position.set(0, -0.032, 0.048);
  grip.rotation.set(0.2, 0, 0);
  body.add(grip);

  body.add(triggerGuard(brass, { top: 0.05, drop: -0.038, front: -0.024, back: 0.062 }));
  body.add(mesh(roundedBox(0.014, 0.05, 0.013, 0.005, 1), gold, { pos: [0, 0.008, 0.012], rot: [-0.3, 0, 0] }));

  /* --- muzzle handle ----------------------------------------------- */
  const muzzle = group([], { pos: [0, AXIS_Y, -0.6], name: 'muzzle' });
  body.add(muzzle);

  g.userData.parts = { muzzle, body, moving: gift.root, grip };
  g.userData.viewOffset = new THREE.Vector3(0.24, -0.24, -0.4);
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 2. Peppermint shotgun                                               */
/* ------------------------------------------------------------------ */

/**
 * Side-by-side candy-cane blaster with a real break action. `moving` is the
 * barrel assembly, pivoted on the brass hinge pin so the engine only has to
 * rotate it about X to crack it open.
 */
export function buildPeppermintShotgun() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const cane = matCane('cyl');
  const caneHook = matCane('tube');
  const brass = matBrass();
  const gold = MAT.gold;
  const dark = MAT.steelDark;

  const HINGE = [0, 0.052, -0.035];

  /* --- break-open assembly ----------------------------------------- */
  const brk = group([], { pos: HINGE, name: 'breakAction' });
  const BY = 0.055; // barrel axis, local to the hinge

  const muzzleCollar = lathe(
    [
      [0.0255, 0.0],
      [0.0305, 0.005],
      [0.0315, 0.016],
      [0.0285, 0.023],
      [0.0215, 0.021],
      [0.0215, 0.0],
    ],
    20
  );

  for (const sx of [-1, 1]) {
    const x = sx * 0.0315;
    brk.add(
      mesh(cylinder(0.0255, 0.0285, 0.4, 20), cane, { pos: [x, BY, -0.205], rot: [AIM, 0, 0] })
    );
    brk.add(mesh(muzzleCollar, gold, { pos: [x, BY, -0.405], rot: [AIM, 0, 0] }));
    brk.add(mesh(torus(0.0295, 0.005, 6, 18), brass, { pos: [x, BY, -0.14] }));
    // chambered shell heads: swallowed by the receiver when closed, on show
    // the moment the action swings open
    brk.add(mesh(cylinder(0.0265, 0.0265, 0.008, 18), brass, { pos: [x, BY, 0.025], rot: [AIM, 0, 0] }));
    brk.add(
      mesh(cylinder(0.012, 0.012, 0.006, 12), candyMat(PALETTE.candyRed), {
        pos: [x, BY, 0.03],
        rot: [AIM, 0, 0],
      })
    );
  }
  // solid rib joining the barrels + bead sight
  brk.add(mesh(roundedBox(0.064, 0.011, 0.39, 0.004, 1), dark, { pos: [0, BY + 0.028, -0.205] }));
  brk.add(mesh(roundedBox(0.05, 0.016, 0.39, 0.005, 1), dark, { pos: [0, BY - 0.012, -0.205] }));
  brk.add(mesh(sphere(0.0065, 8, 6), gold, { pos: [0, BY + 0.038, -0.385] }));
  // breech block
  brk.add(mesh(roundedBox(0.102, 0.09, 0.03, 0.012, 2), dark, { pos: [0, BY - 0.003, 0.0] }));
  brk.add(mesh(roundedBox(0.088, 0.076, 0.008, 0.004, 1), gold, { pos: [0, BY - 0.003, 0.017] }));
  // polished forend
  brk.add(mesh(roundedBox(0.086, 0.056, 0.15, 0.024, 2), MAT.wood, { pos: [0, BY - 0.052, -0.16] }));
  brk.add(mesh(roundedBox(0.09, 0.014, 0.026, 0.006, 1), brass, { pos: [0, BY - 0.052, -0.088] }));

  // candy-cane crook foregrip, hanging under the forend
  brk.add(
    mesh(
      tube(
        [
          [0, BY - 0.07, -0.115],
          [0, BY - 0.1, -0.135],
          [0, BY - 0.117, -0.176],
          [0, BY - 0.105, -0.216],
          [0, BY - 0.072, -0.229],
          [0, BY - 0.049, -0.212],
        ],
        0.016,
        30,
        8
      ),
      caneHook
    )
  );
  body.add(brk);

  /* --- receiver ---------------------------------------------------- */
  body.add(mesh(roundedBox(0.094, 0.098, 0.155, 0.024, 2), dark, { pos: [0, 0.062, 0.052] }));
  for (const sx of [-1, 1]) {
    body.add(mesh(roundedBox(0.006, 0.064, 0.118, 0.006, 1), gold, { pos: [sx * 0.047, 0.058, 0.052] }));
    body.add(mesh(sphere(0.0075, 8, 6), brass, { pos: [sx * 0.049, 0.092, 0.115] }));
    // exposed hammer spurs
    body.add(
      mesh(roundedBox(0.012, 0.032, 0.022, 0.006, 1), MAT.licorice, {
        pos: [sx * 0.024, 0.115, 0.108],
        rot: [-0.35, 0, 0],
      })
    );
  }
  // top lever
  body.add(mesh(roundedBox(0.017, 0.011, 0.058, 0.005, 1), gold, { pos: [0, 0.114, 0.05], rot: [0, 0.3, 0] }));
  body.add(mesh(sphere(0.011, 10, 8), brass, { pos: [0, 0.114, 0.024], scale: [1, 0.6, 1] }));

  // brass hinge pin, standing proud of the knuckle on both flanks
  body.add(
    mesh(cylinder(0.011, 0.011, 0.13, 16), brass, { pos: HINGE, rot: [0, 0, Math.PI / 2] })
  );
  for (const sx of [-1, 1]) {
    body.add(
      mesh(cylinder(0.014, 0.017, 0.008, 16), gold, {
        pos: [sx * 0.066, HINGE[1], HINGE[2]],
        rot: [0, 0, -sx * Math.PI / 2],
      })
    );
    // hinge yoke ears the pin runs through
    body.add(
      mesh(roundedBox(0.014, 0.05, 0.05, 0.014, 1), dark, { pos: [sx * 0.05, 0.056, -0.026] })
    );
  }

  /* --- stock, with a peppermint inlay in each flank ---------------- */
  const pep = matPeppermint();
  const stock = group(
    [
      mesh(roundedBox(0.078, 0.108, 0.17, 0.03, 2), MAT.wood, { pos: [0, 0, 0.085] }),
      mesh(roundedBox(0.052, 0.034, 0.12, 0.014, 1), MAT.wood, { pos: [0, 0.058, 0.06] }),
      mesh(roundedBox(0.084, 0.116, 0.018, 0.006, 1), MAT.licorice, { pos: [0, -0.004, 0.174] }),
      mesh(torus(0.012, 0.004, 6, 14), brass, { pos: [0, -0.052, 0.1], rot: [0, LIE_FLAT, 0] }),
    ],
    { pos: [0, 0.03, 0.115], rot: [0.11, 0, 0] }
  );
  for (const sx of [-1, 1]) {
    stock.add(
      mesh(cylinder(0.03, 0.03, 0.012, 24), pep, {
        pos: [sx * 0.036, 0.012, 0.072],
        rot: [0, 0, sx * Math.PI / 2],
      })
    );
    stock.add(
      mesh(torus(0.031, 0.005, 6, 20), brass, { pos: [sx * 0.037, 0.012, 0.072], rot: [0, LIE_FLAT, 0] })
    );
  }
  body.add(stock);

  /* --- grip + double triggers -------------------------------------- */
  const grip = gripBlock(MAT.woodDark, { w: 0.05, h: 0.142, d: 0.062, ridgeMat: MAT.licorice });
  grip.position.set(0, -0.03, 0.042);
  grip.rotation.set(0.19, 0, 0);
  body.add(grip);

  body.add(triggerGuard(brass, { top: 0.046, drop: -0.042, front: -0.028, back: 0.058 }));
  body.add(mesh(roundedBox(0.011, 0.046, 0.012, 0.004, 1), gold, { pos: [0, 0.006, 0.0], rot: [-0.32, 0, 0] }));
  body.add(mesh(roundedBox(0.011, 0.042, 0.012, 0.004, 1), gold, { pos: [0, 0.004, 0.026], rot: [-0.32, 0, 0] }));

  const muzzle = group([], { pos: [0, HINGE[1] + BY, -0.465], name: 'muzzle' });
  body.add(muzzle);

  g.userData.parts = { muzzle, body, moving: brk, grip };
  g.userData.viewOffset = new THREE.Vector3(0.2, -0.21, -0.34);
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 3. Icicle rail                                                      */
/* ------------------------------------------------------------------ */

/**
 * Precision-machined cold: a faceted icicle barrel in a dark steel frame,
 * three floating frost-ring accelerators, a cyan scope. `moving` is the ring
 * group, which shares the barrel axis so it can spin or pulse in place.
 */
export function buildIcicleRail() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const dark = MAT.steelDark;
  const steel = MAT.steel;
  const ice = MAT.ice;
  const crystal = matCrystal();
  const frost = emissiveMat('wp_frostring', 0x9ff2d6, 3);
  const coil = emissiveMat('wp_railcoil', PALETTE.mint, 2.2);
  const AXIS_Y = 0.108;

  /* --- frame ------------------------------------------------------- */
  body.add(mesh(roundedBox(0.056, 0.078, 0.3, 0.02, 3), dark, { pos: [0, AXIS_Y - 0.008, -0.01] }));
  for (const sx of [-1, 1]) {
    // machined side rails, overlapping the spine so they read as one billet
    body.add(mesh(roundedBox(0.013, 0.052, 0.33, 0.006, 1), dark, { pos: [sx * 0.032, AXIS_Y, -0.11] }));
    // frost vent glow slits
    body.add(mesh(roundedBox(0.004, 0.01, 0.07, 0.002, 1), coil, { pos: [sx * 0.029, AXIS_Y - 0.036, -0.05] }));
  }
  // cooling fins over the breech
  for (let i = 0; i < 4; i++) {
    body.add(
      mesh(roundedBox(0.062, 0.018, 0.008, 0.003, 1), steel, {
        pos: [0, AXIS_Y + 0.042, 0.03 + i * 0.022],
      })
    );
  }
  // trigger housing, tying the frame down to the grip
  body.add(mesh(roundedBox(0.042, 0.05, 0.115, 0.014, 1), dark, { pos: [0, 0.048, 0.012] }));
  // breech housing the icicle is chucked into
  body.add(
    mesh(
      lathe(
        [
          [0.0, 0.0],
          [0.05, 0.0],
          [0.05, 0.03],
          [0.043, 0.042],
          [0.043, 0.07],
          [0.036, 0.082],
          [0.036, 0.1],
          [0.03, 0.108],
        ],
        22
      ),
      steel,
      { pos: [0, AXIS_Y, -0.062], rot: [AIM, 0, 0] }
    )
  );
  body.add(mesh(torus(0.038, 0.007, 8, 20), coil, { pos: [0, AXIS_Y, -0.15] }));

  /* --- icicle barrel ----------------------------------------------- */
  body.add(
    mesh(
      lathe(
        [
          [0.0, 0.0],
          [0.036, 0.0],
          [0.034, 0.03],
          [0.037, 0.045],
          [0.03, 0.06],
          [0.029, 0.13],
          [0.032, 0.145],
          [0.026, 0.16],
          [0.024, 0.232],
          [0.026, 0.244],
          [0.02, 0.258],
          [0.019, 0.28],
        ],
        7
      ),
      ice,
      { pos: [0, AXIS_Y, -0.16], rot: [AIM, 0, 0] }
    )
  );
  body.add(mesh(cone(0.019, 0.12, 7), ice, { pos: [0, AXIS_Y, -0.5], rot: [AIM, 0, 0] }));
  // shards frozen around the chuck
  const shardRand = mulberry32(1701);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + shardRand() * 0.5;
    body.add(
      mesh(cone(0.011, 0.05 + shardRand() * 0.03, 5), crystal, {
        pos: [Math.cos(a) * 0.036, AXIS_Y + Math.sin(a) * 0.036, -0.185 - shardRand() * 0.03],
        rot: [AIM + (shardRand() - 0.5) * 0.5, 0, a],
      })
    );
  }

  /* --- floating frost rings ---------------------------------------- */
  const rings = group([], { pos: [0, AXIS_Y, -0.33], name: 'frostRings' });
  const ringSpec = [
    [0.053, 0.09, [0.14, 0, 0]],
    [0.045, 0.0, [0, 0.16, 0]],
    [0.059, -0.085, [-0.1, 0, 0.22]],
  ];
  for (const [r, z, rot] of ringSpec) {
    rings.add(mesh(torus(r, 0.0065, 8, 22), frost, { pos: [0, 0, z], rot }));
    rings.add(mesh(torus(r, 0.0022, 6, 22), MAT.icing, { pos: [0, 0, z], rot }));
  }
  body.add(rings);
  // stub arms that "hold" the rings, on the frame rather than the moving group
  for (const z of [-0.24, -0.33, -0.415]) {
    body.add(mesh(roundedBox(0.012, 0.03, 0.012, 0.004, 1), dark, { pos: [0, AXIS_Y - 0.05, z] }));
  }
  body.add(mesh(roundedBox(0.014, 0.014, 0.3, 0.005, 1), dark, { pos: [0, AXIS_Y - 0.058, -0.31] }));

  /* --- scope ------------------------------------------------------- */
  const scope = group(
    [
      mesh(cylinder(0.024, 0.026, 0.19, 20), dark, { pos: [0, 0, 0], rot: [AIM, 0, 0] }),
      mesh(cylinder(0.03, 0.03, 0.026, 20), dark, { pos: [0, 0, -0.088], rot: [AIM, 0, 0] }),
      mesh(cylinder(0.029, 0.029, 0.008, 20), matLens(), { pos: [0, 0, -0.101], rot: [AIM, 0, 0] }),
      mesh(cylinder(0.021, 0.021, 0.006, 20), emissiveMat('wp_scopelens', 0x6fe8ff, 3.2), {
        pos: [0, 0, 0.096],
        rot: [AIM, 0, 0],
      }),
      mesh(cylinder(0.013, 0.015, 0.018, 14), steel, { pos: [0, 0.03, -0.02] }),
      mesh(torus(0.027, 0.005, 6, 18), steel, { pos: [0, 0, 0.05] }),
    ],
    { pos: [0, AXIS_Y + 0.072, -0.1] }
  );
  body.add(scope);
  for (const z of [-0.03, -0.17]) {
    body.add(mesh(roundedBox(0.022, 0.05, 0.02, 0.006, 1), dark, { pos: [0, AXIS_Y + 0.045, z] }));
  }

  /* --- skeleton stock ---------------------------------------------- */
  const stock = group(
    [
      mesh(cylinder(0.009, 0.009, 0.115, 12), steel, { pos: [0, 0.026, 0.058], rot: [AIM, 0, 0] }),
      mesh(cylinder(0.009, 0.009, 0.115, 12), steel, { pos: [0, -0.026, 0.058], rot: [AIM, 0, 0] }),
      mesh(roundedBox(0.03, 0.12, 0.02, 0.008, 1), MAT.leather, { pos: [0, 0, 0.118] }),
      mesh(roundedBox(0.036, 0.028, 0.05, 0.01, 1), MAT.leather, { pos: [0, 0.05, 0.075] }),
    ],
    { pos: [0, AXIS_Y - 0.01, 0.105], rot: [0.06, 0, 0] }
  );
  body.add(stock);

  /* --- slim grip --------------------------------------------------- */
  const grip = gripBlock(MAT.leather, { w: 0.04, h: 0.135, d: 0.05, ridgeMat: MAT.licorice, ridges: 2 });
  grip.position.set(0, -0.036, 0.036);
  grip.rotation.set(0.24, 0, 0);
  body.add(grip);

  body.add(triggerGuard(steel, { top: 0.044, drop: -0.04, front: -0.024, back: 0.054, r: 0.006 }));
  body.add(mesh(roundedBox(0.009, 0.042, 0.011, 0.003, 1), steel, { pos: [0, 0.004, 0.006], rot: [-0.3, 0, 0] }));
  // magazine of ice cartridges
  body.add(mesh(roundedBox(0.036, 0.07, 0.05, 0.012, 1), dark, { pos: [0, 0.03, -0.055], rot: [0.12, 0, 0] }));
  body.add(mesh(roundedBox(0.02, 0.012, 0.036, 0.004, 1), coil, { pos: [0, 0.002, -0.058] }));

  const muzzle = group([], { pos: [0, AXIS_Y, -0.565], name: 'muzzle' });
  body.add(muzzle);

  g.userData.parts = { muzzle, body, moving: rings, grip };
  g.userData.viewOffset = new THREE.Vector3(0.17, -0.18, -0.3);
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 4. Snowball gun -- the chaingun                                     */
/* ------------------------------------------------------------------ */

/**
 * Five-barrel snowball minigun with a glass hopper drum and a hand crank.
 * `moving` is the barrel cluster; its local origin sits exactly on the spin
 * axis so the engine can just increment rotation.z.
 */
export function buildSnowballGun() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const dark = MAT.steelDark;
  const steel = MAT.steel;
  const brass = matBrass();
  const gold = MAT.gold;
  const AXIS_Y = 0.115;

  /* --- barrel cluster ---------------------------------------------- */
  const cluster = group([], { pos: [0, AXIS_Y, -0.21], name: 'barrelCluster' });
  const barrelCollar = lathe(
    [
      [0.021, 0.0],
      [0.026, 0.006],
      [0.026, 0.018],
      [0.022, 0.024],
      [0.016, 0.022],
      [0.016, 0.0],
    ],
    12
  );
  const oneBarrel = group([
    mesh(cylinder(0.019, 0.021, 0.3, 12), steel, { rot: [AIM, 0, 0] }),
    mesh(barrelCollar, gold, { pos: [0, 0, -0.15], rot: [AIM, 0, 0] }),
    mesh(torus(0.0225, 0.004, 6, 12), brass, { pos: [0, 0, 0.09] }),
  ]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const b = i === 0 ? oneBarrel : oneBarrel.clone();
    b.position.set(Math.cos(a) * 0.048, Math.sin(a) * 0.048, 0);
    cluster.add(b);
  }
  // spider plate at the tips, hub at the back, shaft down the middle
  cluster.add(mesh(torus(0.048, 0.013, 8, 20), dark, { pos: [0, 0, -0.13] }));
  cluster.add(
    mesh(
      lathe(
        [
          [0.0, 0.0],
          [0.062, 0.0],
          [0.066, 0.012],
          [0.062, 0.026],
          [0.03, 0.03],
        ],
        20
      ),
      dark,
      { pos: [0, 0, 0.16], rot: [AIM, 0, 0] }
    )
  );
  cluster.add(mesh(cylinder(0.014, 0.014, 0.3, 10), steel, { rot: [AIM, 0, 0] }));
  body.add(cluster);

  // static cowl wrapping the back of the cluster: the inner wall never comes
  // closer than 0.072 so the spinning barrels always clear it
  body.add(
    mesh(
      lathe(
        [
          [0.05, 0.0],
          [0.078, 0.014],
          [0.082, 0.048],
          [0.078, 0.082],
          [0.075, 0.096],
          [0.072, 0.096],
          [0.072, 0.05],
          [0.072, 0.012],
          [0.05, 0.002],
        ],
        24
      ),
      dark,
      { pos: [0, AXIS_Y, -0.055], rot: [AIM, 0, 0] }
    )
  );
  body.add(mesh(torus(0.081, 0.008, 6, 24), brass, { pos: [0, AXIS_Y, -0.104] }));
  body.add(...rivetRing(8, 0.079, 0.008, gold, { y: AXIS_Y, z: -0.085 }));

  /* --- receiver ---------------------------------------------------- */
  body.add(mesh(roundedBox(0.132, 0.14, 0.2, 0.03, 3), dark, { pos: [0, 0.1, 0.01] }));
  body.add(mesh(roundedBox(0.142, 0.03, 0.19, 0.01, 1), steel, { pos: [0, 0.038, 0.012] }));
  for (const sx of [-1, 1]) {
    body.add(...rivetRow(4, 0.008, gold, [sx * 0.068, 0.152, -0.06], 0.05));
    body.add(...rivetRow(4, 0.008, gold, [sx * 0.068, 0.062, -0.06], 0.05));
    body.add(mesh(roundedBox(0.006, 0.07, 0.1, 0.008, 1), steel, { pos: [sx * 0.069, 0.104, 0.015] }));
  }
  // ammo feed collar between drum and receiver
  body.add(mesh(cylinder(0.038, 0.05, 0.036, 16), steel, { pos: [0, 0.176, 0.005] }));
  body.add(mesh(torus(0.05, 0.007, 6, 20), brass, { pos: [0, 0.162, 0.005], rot: [LIE_FLAT, 0, 0] }));

  /* --- glass hopper drum full of snowballs -------------------------- */
  const drum = group([], { pos: [0, 0.19, 0.005], name: 'hopper' });
  drum.add(
    mesh(
      lathe(
        [
          [0.03, 0.0],
          [0.062, 0.014],
          [0.078, 0.04],
          [0.082, 0.075],
          [0.078, 0.11],
          [0.066, 0.134],
          [0.048, 0.145],
          [0.028, 0.15],
        ],
        28
      ),
      matHopperGlass()
    )
  );
  drum.add(mesh(torus(0.056, 0.009, 6, 24), brass, { pos: [0, 0.012, 0], rot: [LIE_FLAT, 0, 0] }));
  drum.add(mesh(torus(0.03, 0.008, 6, 20), brass, { pos: [0, 0.15, 0], rot: [LIE_FLAT, 0, 0] }));
  drum.add(mesh(cylinder(0.026, 0.03, 0.016, 16), gold, { pos: [0, 0.161, 0] }));
  drum.add(mesh(sphere(0.012, 10, 8), gold, { pos: [0, 0.174, 0] }));

  const rnd = mulberry32(90210);
  const ballGeos = [sphere(0.015, 10, 7), sphere(0.018, 10, 7), sphere(0.021, 10, 7)];
  for (let i = 0; i < 15; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.008 + rnd() * 0.036; // keeps every ball inside the glass
    drum.add(
      mesh(ballGeos[Math.floor(rnd() * 3)], MAT.snow, {
        pos: [Math.cos(a) * rr, 0.026 + rnd() * 0.082, Math.sin(a) * rr],
      })
    );
  }
  body.add(drum);

  /* --- hand crank on the visible flank ----------------------------- */
  const crank = group(
    [
      mesh(cylinder(0.02, 0.024, 0.03, 14), brass, { rot: [0, 0, -Math.PI / 2] }),
      mesh(cylinder(0.009, 0.009, 0.04, 10), steel, { pos: [-0.022, 0, 0], rot: [0, 0, Math.PI / 2] }),
      mesh(roundedBox(0.012, 0.075, 0.016, 0.005, 1), brass, { pos: [-0.038, 0.03, 0] }),
      mesh(capsule(0.013, 0.03, 5, 12), MAT.wood, { pos: [-0.046, 0.062, 0], rot: [0, 0, Math.PI / 2] }),
      mesh(torus(0.026, 0.005, 6, 18), gold, { pos: [-0.011, 0, 0], rot: [0, LIE_FLAT, 0] }),
    ],
    { pos: [-0.068, 0.088, 0.05] }
  );
  body.add(crank);

  /* --- chunky grip -------------------------------------------------- */
  const grip = gripBlock(MAT.leather, { w: 0.06, h: 0.155, d: 0.076, ridgeMat: MAT.licorice });
  grip.position.set(0, -0.03, 0.062);
  grip.rotation.set(0.17, 0, 0);
  body.add(grip);

  body.add(triggerGuard(steel, { top: 0.05, drop: -0.042, front: -0.012, back: 0.078, r: 0.008 }));
  body.add(mesh(roundedBox(0.014, 0.05, 0.014, 0.005, 1), gold, { pos: [0, 0.008, 0.026], rot: [-0.28, 0, 0] }));
  // carry handle over the receiver, behind the drum
  body.add(mesh(roundedBox(0.03, 0.014, 0.07, 0.006, 1), MAT.licorice, { pos: [0, 0.184, 0.088] }));
  body.add(mesh(roundedBox(0.024, 0.038, 0.016, 0.006, 1), dark, { pos: [0, 0.166, 0.062] }));

  const muzzle = group([], { pos: [0, AXIS_Y, -0.388], name: 'muzzle' });
  body.add(muzzle);

  g.userData.parts = { muzzle, body, moving: cluster, grip };
  g.userData.viewOffset = new THREE.Vector3(0.26, -0.27, -0.36);
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 5. The flying present                                               */
/* ------------------------------------------------------------------ */

/** The launcher's projectile: a bright wrapped gift, ~0.3 across, centred. */
export function buildPresentProjectile() {
  const g = new THREE.Group();
  const p = wrappedPresent(0.2, {
    name: 'rocket',
    bg: PALETTE.gumdropRed,
    fg: PALETTE.candyWhite,
    seed: 3,
    ribbonHex: PALETTE.gold,
    tails: true,
  });
  g.add(p.root);

  // gold corner caps so it reads as a solid object while tumbling
  const cap = matBrass();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.add(
        mesh(roundedBox(0.03, 0.03, 0.212, 0.008, 1), cap, { pos: [sx * 0.088, sy * 0.088, 0] })
      );
    }
  }

  g.userData.parts = { bow: p.bow };
  return shadowize(g);
}

/* ------------------------------------------------------------------ */
/* 6. Floating weapon pickups                                          */
/* ------------------------------------------------------------------ */

const PICKUP_SPEC = {
  launcher: { build: buildPresentLauncher, glow: PALETTE.fire },
  shotgun: { build: buildPeppermintShotgun, glow: PALETTE.candyRed },
  rail: { build: buildIcicleRail, glow: PALETTE.mint },
  chaingun: { build: buildSnowballGun, glow: PALETTE.coldLight },
};

/**
 * A 0.6x copy of a weapon, recentred on its own bounding box and canted so it
 * reads at a glance, floating over a colour-coded halo. The engine spins and
 * bobs the returned group as a whole.
 *
 * @param {'launcher'|'shotgun'|'rail'|'chaingun'} kind
 */
export function buildWeaponPickup(kind) {
  const spec = PICKUP_SPEC[kind];
  if (!spec) {
    throw new Error(
      `buildWeaponPickup: unknown kind "${kind}" -- expected launcher | shotgun | rail | chaingun`
    );
  }

  const g = new THREE.Group();

  const w = spec.build();
  w.scale.setScalar(0.6);
  w.rotation.set(0.16, -0.62, 0.34);
  w.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
  w.position.sub(centre);
  g.add(w);

  // halo: ring + soft floor disc + rising column
  const ring = mesh(torus(0.24, 0.016, 8, 32), matHalo(`${kind}_ring`, spec.glow, 0.75), {
    pos: [0, -0.17, 0],
    rot: [LIE_FLAT, 0, 0],
    cast: false,
  });
  const disc = mesh(cylinder(0.22, 0.22, 0.002, 32), matHalo(`${kind}_disc`, spec.glow, 0.16), {
    pos: [0, -0.172, 0],
    cast: false,
  });
  const column = mesh(
    cylinder(0.19, 0.235, 0.26, 24, true),
    matHalo(`${kind}_beam`, spec.glow, 0.08),
    { pos: [0, -0.045, 0], cast: false }
  );
  g.add(ring, disc, column);

  // a few drifting motes to sell the float
  let seed = 13;
  for (let i = 0; i < kind.length; i++) seed = (seed * 31 + kind.charCodeAt(i)) >>> 0;
  const rnd = mulberry32(seed);
  const moteMat = matHalo(`${kind}_mote`, spec.glow, 0.85);
  const moteGeo = sphere(0.011, 6, 5);
  const glows = [ring, disc, column];
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.14 + rnd() * 0.1;
    const mote = mesh(moteGeo, moteMat, {
      pos: [Math.cos(a) * r, -0.14 + rnd() * 0.22, Math.sin(a) * r],
      cast: false,
    });
    glows.push(mote);
    g.add(mote);
  }

  g.userData.kind = kind;
  g.userData.weapon = w;
  shadowize(g);
  // the glows are lights, not casters -- undo the blanket flag for those only
  for (const o of glows) o.castShadow = false;
  return g;
}
