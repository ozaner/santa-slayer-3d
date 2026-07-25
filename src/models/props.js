/**
 * Procedural environment props for the North Pole arena.
 *
 * Every builder is a pure function of its options: same options in, same
 * geometry out. Nothing here runs at import time -- all material/texture
 * access happens inside function bodies because the canvas textures in
 * materials.js need `document`.
 *
 * Conventions:
 *   - metres, Y up
 *   - a prop's origin is the centre of its ground footprint at y = 0
 *     (exceptions are documented on the builder)
 *   - lights are never created here; emitters are marked with an empty
 *     Object3D named 'lightAnchor' pushed to g.userData.lightAnchors
 */
import * as THREE from 'three';
import {
  PALETTE,
  MAT,
  TEX,
  stdMat,
  physMat,
  glowMat,
  candyMat,
  emissiveMat,
  roundedBox,
  box,
  sphere,
  cylinder,
  cone,
  capsule,
  torus,
  lathe,
  tube,
  extrude,
  mesh,
  group,
  shadowize,
  makeFbm,
  mulberry32,
} from '../render/materials.js';

/* ------------------------------------------------------------------ */
/* Local helpers                                                       */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

/** Quantise a dimension so the cached geometry helpers actually hit. */
function q(v, step = 0.02) {
  return Math.round(v / step) * step;
}

function rr(rand, a, b) {
  return a + (b - a) * rand();
}

function pick(rand, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

/**
 * Mark a light emitter. The engine collects these and decides which ones
 * actually get a THREE.PointLight this frame.
 */
function addLightAnchor(g, pos, light) {
  const o = new THREE.Object3D();
  o.name = 'lightAnchor';
  o.position.set(pos[0], pos[1], pos[2]);
  o.userData.light = light;
  if (!g.userData.lightAnchors) g.userData.lightAnchors = [];
  g.userData.lightAnchors.push(o);
  g.add(o);
  return o;
}

/** Unlit glow, cached per colour + opacity. */
function glow(colorHex, opacity = 1) {
  return glowMat(`pr_glow_${colorHex.toString(16)}_${opacity}`, colorHex, opacity);
}

/** Additive, double sided, non-depth-writing glow for light volumes. */
function volumeGlow(key, colorHex, opacity) {
  const m = glowMat(key, colorHex, opacity);
  m.side = THREE.DoubleSide;
  m.depthWrite = false;
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  return m;
}

/* --- prop-local surfaces (all lazy, all `pr_` prefixed) ------------- */

function matCandyPole() {
  return physMat('pr_candyPole', {
    ...TEX.candyStripe(PALETTE.candyWhite, PALETTE.candyRed, 3, 10),
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
}

function matCandyMint() {
  return physMat('pr_candyMint', {
    ...TEX.candyStripe(PALETTE.candyWhite, PALETTE.candyGreen, 3, 10),
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
}

function matIron() {
  return stdMat('pr_iron', {
    ...TEX.metal(0x23262d, 1),
    roughness: 0.55,
    metalness: 0.75,
  });
}

function matBrick() {
  return stdMat('pr_brick', {
    ...TEX.gingerWall(3),
    color: 0xd98f74,
    roughness: 0.92,
  });
}

function matLacquer() {
  return physMat('pr_lacquer', {
    color: PALETTE.santaRed,
    roughness: 0.13,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

function matLacquerDark() {
  return physMat('pr_lacquerDark', {
    color: PALETTE.santaRedDark,
    roughness: 0.2,
    clearcoat: 0.8,
  });
}

function matRubber() {
  return stdMat('pr_rubber', { color: 0x24262a, roughness: 0.96, metalness: 0.05 });
}

function matStencil() {
  return stdMat('pr_stencil', { color: PALETTE.icing, roughness: 0.9 });
}

function matLampGlass() {
  return physMat('pr_lampGlass', {
    color: 0xfff2d2,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.85,
    thickness: 0.25,
    ior: 1.4,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
  });
}

/** A small wrapped present. Used by the sleigh, the conveyor and scenery. */
function makeGift(w, h, d, seed = 1) {
  const rand = mulberry32((seed * 7919 + 13) >>> 0);
  const bg = pick(rand, [
    PALETTE.gumdropRed,
    PALETTE.gumdropGreen,
    PALETTE.gumdropPurple,
    PALETTE.icingBlue,
    PALETTE.candyRed,
  ]);
  const fg = pick(rand, [PALETTE.gold, PALETTE.icing, PALETTE.candyWhite]);
  const style = 1 + Math.floor(rand() * 3);
  const paper = stdMat(`pr_wrap_${bg}_${fg}_${style}`, {
    ...TEX.wrapping(bg, fg, style),
    roughness: 0.62,
  });
  const ribbon = stdMat(`pr_ribbon_${fg}`, { color: fg, roughness: 0.32, metalness: 0.25 });

  const W = q(w);
  const H = q(h);
  const D = q(d);
  const g = group([], { name: 'gift' });
  g.add(mesh(roundedBox(W, H, D, 0.02, 1), paper, { pos: [0, H / 2, 0] }));
  // cross ribbons
  g.add(mesh(box(q(W * 0.14), q(H + 0.02), q(D + 0.02)), ribbon, { pos: [0, H / 2, 0] }));
  g.add(mesh(box(q(W + 0.02), q(H + 0.02), q(D * 0.14)), ribbon, { pos: [0, H / 2, 0] }));
  // bow
  const loop = torus(q(W * 0.17), q(W * 0.05), 5, 10);
  g.add(mesh(loop, ribbon, { pos: [-W * 0.16, H + W * 0.03, 0], rot: [Math.PI / 2, 0, 0.5] }));
  g.add(mesh(loop, ribbon, { pos: [W * 0.16, H + W * 0.03, 0], rot: [Math.PI / 2, 0, -0.5] }));
  g.add(mesh(sphere(q(W * 0.07), 8, 6), ribbon, { pos: [0, H + W * 0.04, 0] }));
  return g;
}

/* ------------------------------------------------------------------ */
/* 1. Gingerbread house                                                */
/* ------------------------------------------------------------------ */

/**
 * A gingerbread house you can fight around and stand on.
 * Origin: centre of the ground footprint.
 * userData.size = { w, d, h } (h = wall height), userData.roofY = ridge peak Y.
 */
export function buildGingerHouse({ w = 6, d = 6, h = 4, seed = 1, roofColor } = {}) {
  const rand = mulberry32((seed * 2654435761) >>> 0 || 1);
  const g = group([], { name: 'gingerHouse' });

  const over = 0.34; // eave / rake overhang
  const roofRise = q(h * rr(rand, 0.6, 0.82) + w * 0.1);
  const halfSpan = w / 2 + over;
  const slopeLen = Math.hypot(halfSpan, roofRise);
  const pitch = Math.atan2(roofRise, halfSpan);
  const ridgeY = h + roofRise;
  const spanZ = d + over * 2;

  const wall = MAT.gingerWall;
  const icing = MAT.icing;
  const shingleMat = roofColor
    ? stdMat(`pr_shingle_${roofColor}`, { ...TEX.gingerbread(1), color: roofColor, roughness: 0.8 })
    : MAT.gingerbread;
  const shingleBase = MAT.gingerbreadBurnt;
  const gumColors = [PALETTE.gumdropRed, PALETTE.gumdropGreen, PALETTE.gumdropPurple, PALETTE.icingBlue];

  /* --- walls ------------------------------------------------------- */
  g.add(mesh(roundedBox(q(w), q(h), q(d), 0.1, 1), wall, { pos: [0, h / 2, 0] }));

  // piped icing beads down every corner
  const bead = cylinder(0.07, 0.07, q(h), 8);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(bead, icing, { pos: [sx * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03)] }));
    }
  }
  // icing skirting along the base of the two long walls
  for (const sz of [-1, 1]) {
    g.add(mesh(box(q(w + 0.06), 0.12, 0.1), icing, { pos: [0, 0.09, sz * (d / 2 + 0.02)] }));
  }

  /* --- gable ends --------------------------------------------------- */
  const gable = new THREE.Shape();
  gable.moveTo(-w / 2, 0);
  gable.lineTo(w / 2, 0);
  gable.lineTo(0, roofRise);
  gable.closePath();
  const gableGeo = extrude(gable, 0.32, 0.03);
  g.add(mesh(gableGeo, wall, { pos: [0, h, d / 2 - 0.32] }));
  g.add(mesh(gableGeo, wall, { pos: [0, h, -d / 2] }));

  // a round attic window in the front gable
  g.add(mesh(cylinder(0.34, 0.34, 0.1, 12), icing, {
    pos: [0, h + roofRise * 0.42, d / 2 - 0.02],
    rot: [Math.PI / 2, 0, 0],
  }));
  g.add(mesh(cylinder(0.24, 0.24, 0.14, 12), emissiveMat('pr_winWarm', 0xffc879, 1.5), {
    pos: [0, h + roofRise * 0.42, d / 2 - 0.03],
    rot: [Math.PI / 2, 0, 0],
  }));

  /* --- roof: cookie shingles in offset rows ------------------------- */
  // row/column counts are capped so a big house stays inside the tri budget
  const rows = Math.min(8, Math.max(3, Math.round(slopeLen / 0.6)));
  const step = slopeLen / rows;
  const cols = Math.min(7, Math.max(3, Math.round(spanZ / 1.0)));
  const sw = spanZ / cols;
  const shGeo = roundedBox(q(step * 1.5), 0.09, q(sw * 0.94), 0.05, 1);
  const rowBead = box(0.07, 0.07, q(spanZ));

  for (const s of [1, -1]) {
    const side = group([], { pos: [0, ridgeY, 0], rot: [0, 0, -s * pitch] });

    // solid deck so nothing shows through the shingle gaps
    side.add(mesh(box(q(slopeLen), 0.12, q(spanZ)), shingleBase, {
      pos: [(s * slopeLen) / 2, -0.06, 0],
    }));

    for (let r0 = 0; r0 < rows; r0++) {
      const t = (r0 + 0.5) * step;
      const off = (r0 % 2) * 0.5;
      for (let c = -1; c <= cols; c++) {
        // even rows fill the span exactly, odd rows overhang half a shingle
        // at BOTH rake edges -- which is how a real shingled course reads
        const z = -spanZ / 2 + (c + 0.5 + off) * sw;
        if (z < -spanZ / 2 - sw * 0.05 || z > spanZ / 2 + sw * 0.05) continue;
        side.add(mesh(shGeo, shingleMat, {
          pos: [s * t, rr(rand, -0.006, 0.012), z],
          rot: [0, rr(rand, -0.035, 0.035), 0],
        }));
      }
      // piped icing bead along the lower lip of the row
      side.add(mesh(rowBead, icing, { pos: [s * (t + step * 0.6), 0.055, 0] }));
    }

    /* snow shell: a slightly larger white cap over the upper slope */
    const capLen = slopeLen * rr(rand, 0.55, 0.68);
    side.add(mesh(roundedBox(q(capLen), 0.17, q(spanZ * 0.99), 0.08, 1), MAT.snow, {
      pos: [(s * capLen) / 2, 0.11, 0],
    }));
    // lumpy melt edge so the snow line is not a straight cut
    for (let i = 0; i < 6; i++) {
      const r = q(rr(rand, 0.16, 0.3));
      side.add(mesh(sphere(r, 8, 6), MAT.snow, {
        pos: [s * (capLen + rr(rand, -0.12, 0.22)), 0.08, -spanZ / 2 + ((i + 0.5) / 6) * spanZ],
        scale: [1, 0.55, 1.1],
      }));
    }
    g.add(side);

    /* --- piped icing drip along the eave --------------------------- */
    const pts = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const z = -spanZ / 2 + (i / n) * spanZ;
      const sag = 0.1 + 0.19 * Math.pow(Math.sin(i * 1.27 + seed * 0.9 + (s > 0 ? 0 : 1.1)), 2);
      pts.push([s * (halfSpan - 0.02), h - 0.05 - sag, z]);
    }
    g.add(mesh(tube(pts, 0.075, 44, 6), icing));
  }

  /* --- ridge cap + gumdrops ----------------------------------------- */
  g.add(mesh(capsule(0.13, q(spanZ - 0.3), 5, 10), icing, {
    pos: [0, ridgeY - 0.01, 0],
    rot: [Math.PI / 2, 0, 0],
  }));
  const gumN = Math.max(3, Math.round(d / 0.62));
  for (let i = 0; i < gumN; i++) {
    const z = -d / 2 + ((i + 0.5) / gumN) * d;
    g.add(mesh(sphere(0.15, 10, 8), candyMat(gumColors[(i + seed) % gumColors.length]), {
      pos: [0, ridgeY + 0.14, z],
      scale: [1, 0.85, 1],
    }));
  }
  // snow settled along the ridge
  g.add(mesh(capsule(0.11, q(spanZ - 1.0), 5, 8), MAT.snow, {
    pos: [0, ridgeY + 0.13, 0],
    rot: [Math.PI / 2, 0, 0],
    scale: [1.1, 1, 0.7],
  }));

  /* --- chimney ------------------------------------------------------ */
  const csx = rand() > 0.5 ? 1 : -1;
  const cx = csx * w * 0.24;
  const cz = q(rr(rand, -d * 0.28, d * 0.05));
  const yRoof = ridgeY - (Math.abs(cx) / halfSpan) * roofRise;
  const chTop = ridgeY + rr(rand, 0.7, 1.1);
  const chH = q(chTop - (yRoof - 0.6));
  g.add(mesh(box(0.72, chH, 0.72), matBrick(), { pos: [cx, yRoof - 0.6 + chH / 2, cz] }));
  g.add(mesh(box(0.88, 0.13, 0.88), icing, { pos: [cx, chTop + 0.06, cz] }));
  g.add(mesh(box(0.46, 0.1, 0.46), MAT.licorice, { pos: [cx, chTop + 0.1, cz] }));
  g.add(mesh(sphere(0.42, 10, 8), MAT.snow, {
    pos: [cx, chTop + 0.08, cz],
    scale: [1.05, 0.32, 1.05],
  }));

  /* --- windows ------------------------------------------------------ */
  const pane = emissiveMat('pr_winWarm', 0xffc879, 1.5);
  function addWindow(x, y, z, ry, ww, wh) {
    const win = group([], { pos: [x, y, z], rot: [0, ry, 0], name: 'window' });
    win.add(mesh(box(q(ww), q(wh), 0.08), pane, { pos: [0, 0, -0.02] }));
    win.add(mesh(box(q(ww + 0.18), 0.1, 0.12), icing, { pos: [0, wh / 2 + 0.05, 0.02] }));
    win.add(mesh(box(q(ww + 0.28), 0.13, 0.2), icing, { pos: [0, -wh / 2 - 0.06, 0.04] }));
    for (const sx of [-1, 1]) {
      win.add(mesh(box(0.1, q(wh + 0.1), 0.12), icing, { pos: [sx * (ww / 2 + 0.05), 0, 0.02] }));
    }
    win.add(mesh(box(0.06, q(wh), 0.1), icing, { pos: [0, 0, 0.03] }));
    win.add(mesh(box(q(ww), 0.06, 0.1), icing, { pos: [0, 0, 0.03] }));
    // snow on the sill
    win.add(mesh(sphere(q(ww * 0.5), 8, 6), MAT.snow, {
      pos: [0, -wh / 2 - 0.09, 0.06],
      scale: [1, 0.3, 0.5],
    }));
    g.add(win);
  }

  const winW = Math.min(1.1, w * 0.2);
  const winH = Math.min(1.2, h * 0.34);
  const winY = h * 0.58;
  addWindow(-w * 0.3, winY, d / 2 + 0.01, 0, winW, winH);
  if (rand() > 0.4) addWindow(w * 0.3, winY, d / 2 + 0.01, 0, winW, winH);
  const sideSign = rand() > 0.5 ? 1 : -1;
  addWindow(sideSign * (w / 2 + 0.01), winY, q(rr(rand, -d * 0.25, d * 0.25)), (sideSign * Math.PI) / 2, winW, winH);

  addLightAnchor(g, [0, winY, d / 2 + 0.9], {
    color: PALETTE.warmLight,
    intensity: 2.2,
    distance: 12,
  });

  /* --- candy-cane door ---------------------------------------------- */
  const dh = Math.min(2.3, h * 0.64);
  const dw = 1.12;
  const doorZ = d / 2;
  g.add(mesh(roundedBox(q(dw), q(dh), 0.12, 0.04, 1), MAT.gingerbreadBurnt, {
    pos: [0, dh / 2, doorZ - 0.02],
  }));
  for (const dy of [0.32, 0.62]) {
    g.add(mesh(box(q(dw * 0.78), 0.06, 0.06), icing, { pos: [0, dh * dy, doorZ + 0.05] }));
  }
  g.add(mesh(sphere(0.08, 8, 6), MAT.gold, { pos: [dw * 0.32, dh * 0.47, doorZ + 0.09] }));

  const cane = matCandyPole();
  for (const sx of [-1, 1]) {
    g.add(mesh(cylinder(0.09, 0.09, q(dh), 10), cane, {
      pos: [sx * (dw / 2 + 0.09), dh / 2, doorZ + 0.07],
    }));
  }
  const archPts = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI - (i / 10) * Math.PI;
    archPts.push([Math.cos(a) * (dw / 2 + 0.09), dh + Math.sin(a) * 0.3, doorZ + 0.07]);
  }
  g.add(mesh(tube(archPts, 0.09, 26, 6), cane));
  g.add(mesh(sphere(0.14, 10, 8), candyMat(PALETTE.gumdropGreen), { pos: [0, dh + 0.42, doorZ + 0.07] }));

  // snow banked against the front of the house
  for (let i = 0; i < 4; i++) {
    const r = q(rr(rand, 0.4, 0.8));
    g.add(mesh(sphere(r, 10, 6), MAT.snow, {
      pos: [rr(rand, -w * 0.45, w * 0.45), 0.02, d / 2 + rr(rand, -0.05, 0.25)],
      scale: [1.3, 0.34, 0.9],
    }));
  }

  g.userData.size = { w, d, h };
  g.userData.roofY = ridgeY;
  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 2. Pine tree                                                        */
/* ------------------------------------------------------------------ */

/**
 * A snow-laden conifer. Origin at the centre of the trunk on the ground.
 */
export function buildPineTree({ h = 7, seed = 1, snowy = true } = {}) {
  const rand = mulberry32((seed * 40503 + 7) >>> 0 || 1);
  const g = group([], { name: 'pineTree' });

  const trunkR = q(h * 0.028);
  const trunkH = q(h * 0.36);
  g.add(mesh(cylinder(q(trunkR * 0.75), q(trunkR * 1.35), trunkH, 8), MAT.woodDark, {
    pos: [0, trunkH / 2, 0],
  }));

  const tiers = 4 + Math.floor(rand() * 3); // 4..6
  const baseY = h * 0.17;
  const topY = h;
  const rBase = h * 0.2 * rr(rand, 0.9, 1.14);

  for (let i = 0; i < tiers; i++) {
    const frac = tiers > 1 ? i / (tiers - 1) : 1;
    const yBase = baseY + frac * (topY - baseY) * 0.66;
    const ch = q((topY - yBase) * (frac >= 1 ? 1 : 0.56 + 0.22 * frac));
    const r = q(rBase * (1 - frac * 0.68) * rr(rand, 0.94, 1.06));
    g.add(mesh(cone(r, ch, 12), MAT.pine, {
      pos: [rr(rand, -0.03, 0.03) * h * 0.02, yBase + ch / 2, rr(rand, -0.03, 0.03) * h * 0.02],
      rot: [0, rand() * TAU, rr(rand, -0.025, 0.025)],
      scale: [rr(rand, 0.95, 1.06), 1, rr(rand, 0.95, 1.06)],
    }));

    if (snowy) {
      const sr = q(r * 0.72);
      const sh = q(ch * 0.62);
      g.add(mesh(cone(sr, sh, 10), MAT.snow, {
        pos: [0, yBase + ch + 0.05 - sh / 2, 0],
        rot: [0, rand() * TAU, 0],
      }));
    }
  }

  if (snowy) {
    // a little skirt of snow round the roots
    for (let i = 0; i < 3; i++) {
      const r = q(rr(rand, 0.22, 0.42) * (h / 7));
      const a = rand() * TAU;
      g.add(mesh(sphere(r, 8, 6), MAT.snow, {
        pos: [Math.cos(a) * trunkR * 2.6, 0.02, Math.sin(a) * trunkR * 2.6],
        scale: [1.2, 0.36, 1.2],
      }));
    }
  }

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 3. Giant Christmas tree (arena centrepiece)                         */
/* ------------------------------------------------------------------ */

/**
 * The hero of the level: a huge decorated fir with a spiral of glowing
 * baubles, tinsel helices and a star on top.
 * userData.parts = { star, baubles: [...] }
 */
export function buildGiantChristmasTree({ h = 18 } = {}) {
  const rand = mulberry32(90210);
  const g = group([], { name: 'giantChristmasTree' });

  /* --- trunk -------------------------------------------------------- */
  const trunkR = q(h * 0.035);
  const trunkH = q(h * 0.2);
  g.add(mesh(cylinder(q(trunkR * 0.8), q(trunkR * 1.4), trunkH, 14), MAT.woodDark, {
    pos: [0, trunkH / 2, 0],
  }));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const rr0 = q(trunkR * rr(rand, 0.42, 0.62));
    g.add(mesh(cone(rr0, q(h * 0.09), 7), MAT.woodDark, {
      pos: [Math.cos(a) * trunkR * 1.15, h * 0.04, Math.sin(a) * trunkR * 1.15],
      rot: [Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22],
    }));
  }

  /* --- foliage ------------------------------------------------------ */
  const baseY = h * 0.13;
  const topY = h * 0.97;
  const rBase = h * 0.29;
  const rAt = (y) =>
    Math.max(0.08, rBase * (1 - Math.min(1, Math.max(0, (y - baseY) / (topY - baseY)))));

  const tiers = 9;
  for (let i = 0; i < tiers; i++) {
    const frac = i / (tiers - 1);
    const yBase = baseY + frac * (topY - baseY) * 0.72;
    const ch = q((topY - yBase) * (frac >= 1 ? 1 : 0.62 + 0.2 * frac));
    const r = q(rAt(yBase) * rr(rand, 0.98, 1.06));
    g.add(mesh(cone(r, ch, 16), MAT.pine, {
      pos: [0, yBase + ch / 2, 0],
      rot: [0, rand() * TAU, rr(rand, -0.015, 0.015)],
      scale: [rr(rand, 0.97, 1.04), 1, rr(rand, 0.97, 1.04)],
    }));
    g.add(mesh(cone(q(r * 0.66), q(ch * 0.55), 12), MAT.snow, {
      pos: [0, yBase + ch + 0.08 - ch * 0.275, 0],
      rot: [0, rand() * TAU, 0],
    }));
  }

  /* --- spiral string of glowing baubles ----------------------------- */
  const baubles = [];
  const N = 96;
  const turns = 7;
  const bGeo = sphere(q(h * 0.012), 8, 6);
  const bColors = [
    PALETTE.gumdropRed,
    PALETTE.gold,
    PALETTE.icingBlue,
    PALETTE.gumdropGreen,
    PALETTE.gumdropPurple,
  ];
  const yLo = baseY + h * 0.06;
  const yHi = topY - h * 0.06;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = yLo + t * (yHi - yLo);
    const a = 0.4 + t * turns * TAU;
    const rad = rAt(y) * 1.03 + h * 0.006;
    const m = mesh(bGeo, glow(bColors[i % bColors.length]), {
      pos: [Math.cos(a) * rad, y, Math.sin(a) * rad],
      name: 'bauble',
    });
    baubles.push(m);
    g.add(m);
  }

  /* --- tinsel garlands ---------------------------------------------- */
  const tinsels = [
    { phase: 0, color: PALETTE.gold, turns: 5 },
    { phase: Math.PI, color: PALETTE.icingBlue, turns: 4 },
  ];
  for (const tn of tinsels) {
    const pts = [];
    const M = 80;
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      const y = baseY + h * 0.1 + t * (topY - baseY - h * 0.22);
      const a = tn.phase + t * tn.turns * TAU;
      const rad = rAt(y) * 1.09 + h * 0.008;
      const droop = h * 0.012 * Math.pow(Math.sin(t * tn.turns * TAU * 1.5), 2);
      pts.push([Math.cos(a) * rad, y - droop, Math.sin(a) * rad]);
    }
    g.add(mesh(tube(pts, q(h * 0.008), 150, 5), stdMat(`pr_tinsel_${tn.color}`, {
      color: tn.color,
      roughness: 0.24,
      metalness: 0.8,
      emissive: tn.color,
      emissiveIntensity: 0.22,
    })));
  }

  /* --- star on top --------------------------------------------------- */
  const R = h * 0.075;
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : R * 0.44;
    const a = -Math.PI / 2 + (i / 10) * TAU;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) starShape.moveTo(x, y);
    else starShape.lineTo(x, y);
  }
  starShape.closePath();
  const starY = h + R * 0.7;
  const starDepth = q(R * 0.22);
  const star = mesh(extrude(starShape, starDepth, q(R * 0.07)), emissiveMat('pr_star', 0xffd77a, 3.4), {
    pos: [0, starY, -starDepth / 2],
    name: 'star',
  });
  g.add(star);
  const halo = mesh(sphere(q(R * 1.7), 12, 10), volumeGlow('pr_starHalo', 0xffe6a8, 0.15), {
    pos: [0, starY, 0],
    cast: false,
    receive: false,
    name: 'starHalo',
  });
  g.add(halo);
  g.add(mesh(cylinder(q(R * 0.09), q(R * 0.14), q(R * 0.9), 8), MAT.gold, {
    pos: [0, starY - R * 1.1, 0],
  }));

  /* --- presents under the tree --------------------------------------- */
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.7;
    const rad = rBase * rr(rand, 0.45, 0.72);
    const s = h * rr(rand, 0.026, 0.042);
    const gift = makeGift(s * 1.5, s, s * 1.2, 300 + i);
    gift.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    gift.rotation.y = rand() * TAU;
    g.add(gift);
  }

  /* --- light anchors -------------------------------------------------- */
  addLightAnchor(g, [0, starY, 0], { color: 0xffe0a0, intensity: 4, distance: 30 });
  const trunkLights = [
    { y: 0.28, a: 0.6, color: PALETTE.warmLight },
    { y: 0.52, a: 2.7, color: PALETTE.coldLight },
    { y: 0.76, a: 4.6, color: PALETTE.warmLight },
  ];
  for (const tl of trunkLights) {
    const y = h * tl.y;
    addLightAnchor(g, [Math.cos(tl.a) * rAt(y) * 0.6, y, Math.sin(tl.a) * rAt(y) * 0.6], {
      color: tl.color,
      intensity: 1.8,
      distance: 16,
    });
  }

  g.userData.parts = { star, baubles };
  shadowize(g);
  halo.castShadow = false;
  halo.receiveShadow = false;
  return g;
}

/* ------------------------------------------------------------------ */
/* 4. Victorian lamp post                                              */
/* ------------------------------------------------------------------ */

/** Wrought-iron lamp post. Origin at the centre of the base on the ground. */
export function buildLampPost({ h = 5 } = {}) {
  const g = group([], { name: 'lampPost' });
  const iron = matIron();
  const k = h / 5; // scale everything off the nominal 5 m post

  /* --- fluted base -------------------------------------------------- */
  const baseH = 1.0 * k;
  const baseR = 0.38 * k;
  const profile = [
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.09],
    [0.78, 0.15],
    [0.72, 0.3],
    [0.65, 0.34],
    [0.79, 0.39],
    [0.74, 0.45],
    [0.52, 0.53],
    [0.41, 0.72],
    [0.34, 1.0],
  ].map(([x, y]) => [x * baseR, y * baseH]);
  g.add(mesh(lathe(profile, 20), iron, { pos: [0, 0, 0] }));
  // flutes
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    g.add(mesh(cylinder(q(0.028 * k), q(0.028 * k), q(baseH * 0.3), 6), iron, {
      pos: [Math.cos(a) * baseR * 0.66, baseH * 0.34, Math.sin(a) * baseR * 0.66],
    }));
  }

  /* --- tapering pole ------------------------------------------------- */
  const poleH = q(h * 0.62);
  const poleTop = baseH + poleH;
  g.add(mesh(cylinder(q(0.045 * k), q(0.085 * k), poleH, 12), iron, {
    pos: [0, baseH + poleH / 2, 0],
  }));
  for (const t of [0.18, 0.62]) {
    g.add(mesh(torus(q(0.075 * k), q(0.026 * k), 5, 12), iron, {
      pos: [0, baseH + poleH * t, 0],
      rot: [Math.PI / 2, 0, 0],
    }));
  }

  /* --- curved crossarm ------------------------------------------------ */
  const reach = 0.86 * k;
  const armPts = [
    [0, poleTop - 0.35 * k, 0],
    [0.05 * k, poleTop + 0.06 * k, 0],
    [0.3 * k, poleTop + 0.34 * k, 0],
    [0.62 * k, poleTop + 0.4 * k, 0],
    [reach, poleTop + 0.24 * k, 0],
    [reach, poleTop + 0.06 * k, 0],
  ];
  g.add(mesh(tube(armPts, q(0.05 * k), 28, 6), iron));
  // decorative scroll under the arm
  g.add(mesh(torus(q(0.16 * k), q(0.028 * k), 5, 14), iron, {
    pos: [0.26 * k, poleTop + 0.02 * k, 0],
  }));

  /* --- lantern head --------------------------------------------------- */
  const lanTop = poleTop + 0.06 * k;
  const cageH = 0.62 * k;
  const rTop = 0.17 * k;
  const rBot = 0.25 * k;
  const lantern = group([], { pos: [reach, lanTop - cageH / 2 - 0.16 * k, 0], name: 'lantern' });

  lantern.add(mesh(cylinder(q(rTop), q(rBot), q(cageH), 4, true), matLampGlass(), {
    rot: [0, Math.PI / 4, 0],
  }));
  // 4 dark frame ribs
  const tilt = Math.atan2(rBot - rTop, cageH);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const rMid = (rTop + rBot) / 2;
    lantern.add(mesh(box(q(0.05 * k), q(cageH * 1.02), q(0.05 * k)), iron, {
      pos: [Math.cos(a) * rMid, 0, Math.sin(a) * rMid],
      rot: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt],
    }));
  }
  // top crown + bottom collar
  lantern.add(mesh(cone(q(rTop * 1.7), q(0.26 * k), 4), iron, {
    pos: [0, cageH / 2 + 0.12 * k, 0],
    rot: [0, Math.PI / 4, 0],
  }));
  lantern.add(mesh(cylinder(q(rBot * 1.12), q(rBot * 1.12), q(0.07 * k), 4), iron, {
    pos: [0, -cageH / 2 - 0.02 * k, 0],
    rot: [0, Math.PI / 4, 0],
  }));
  lantern.add(mesh(cone(q(rBot * 0.55), q(0.18 * k), 4), iron, {
    pos: [0, -cageH / 2 - 0.13 * k, 0],
    rot: [Math.PI, Math.PI / 4, 0],
  }));
  // finial
  lantern.add(mesh(sphere(q(0.06 * k), 8, 6), iron, { pos: [0, cageH / 2 + 0.28 * k, 0] }));
  lantern.add(mesh(cone(q(0.03 * k), q(0.14 * k), 6), iron, { pos: [0, cageH / 2 + 0.38 * k, 0] }));
  // glowing core
  lantern.add(mesh(sphere(q(0.11 * k), 10, 8), glow(0xffd9a0), { pos: [0, -0.02 * k, 0] }));
  const halo = mesh(sphere(q(0.26 * k), 10, 8), volumeGlow('pr_lampHalo', PALETTE.warmLight, 0.18), {
    pos: [0, -0.02 * k, 0],
    cast: false,
    receive: false,
  });
  lantern.add(halo);
  // snow on the crown
  lantern.add(mesh(sphere(q(rTop * 1.5), 8, 6), MAT.snow, {
    pos: [0, cageH / 2 + 0.2 * k, 0],
    scale: [1, 0.34, 1],
  }));
  g.add(lantern);

  addLightAnchor(g, [reach, lanTop - cageH / 2 - 0.18 * k, 0], {
    color: PALETTE.warmLight,
    intensity: 2.4,
    distance: 14,
  });

  shadowize(g);
  halo.castShadow = false;
  halo.receiveShadow = false;
  return g;
}

/* ------------------------------------------------------------------ */
/* 5. Candy-cane archway                                               */
/* ------------------------------------------------------------------ */

/** Origin at the centre of the ground span, arch spans along X. */
export function buildCandyArch({ w = 6, h = 5 } = {}) {
  const g = group([], { name: 'candyArch' });
  const cane = matCandyPole();
  const mint = matCandyMint();
  const icing = MAT.icing;

  const r = w / 2;
  const springY = Math.max(h * 0.3, h - r);
  const colR = q(Math.min(0.38, w * 0.06));

  for (const sx of [-1, 1]) {
    g.add(mesh(cylinder(q(colR * 1.35), q(colR * 1.6), 0.28, 14), icing, { pos: [sx * r, 0.14, 0] }));
    g.add(mesh(cylinder(colR, colR, q(springY), 16), cane, { pos: [sx * r, springY / 2, 0] }));
    g.add(mesh(cylinder(q(colR * 1.04), q(colR * 1.04), q(springY * 0.1), 16), mint, {
      pos: [sx * r, springY * 0.45, 0],
    }));
    for (const ty of [0.1, 0.62, 0.96]) {
      g.add(mesh(torus(q(colR * 1.06), 0.06, 5, 18), icing, {
        pos: [sx * r, springY * ty, 0],
        rot: [Math.PI / 2, 0, 0],
      }));
    }
  }

  /* --- semicircular arch --------------------------------------------- */
  const pts = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI - (i / N) * Math.PI;
    pts.push([Math.cos(a) * r, springY + Math.sin(a) * r, 0]);
  }
  g.add(mesh(tube(pts, q(colR * 0.94), 44, 12), cane));

  /* --- gumdrops + snow ------------------------------------------------ */
  const gums = [PALETTE.gumdropRed, PALETTE.gumdropGreen, PALETTE.gumdropPurple, PALETTE.icingBlue];
  for (let i = 1; i < 6; i++) {
    const a = Math.PI - (i / 6) * Math.PI;
    const rad = r + colR * 0.9;
    g.add(mesh(sphere(q(colR * 0.5), 10, 8), candyMat(gums[i % gums.length]), {
      pos: [Math.cos(a) * rad, springY + Math.sin(a) * rad, 0],
      scale: [1, 0.9, 1],
    }));
  }
  g.add(mesh(sphere(q(colR * 0.95), 12, 10), candyMat(PALETTE.gumdropPurple), {
    pos: [0, springY + r + colR * 1.1, 0],
    scale: [1, 0.92, 1],
  }));
  // snow along the crown of the arch
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.28 + (i / 4) * 0.44);
    const rad = r + colR * 0.75;
    g.add(mesh(sphere(q(colR * 0.62), 8, 6), MAT.snow, {
      pos: [Math.cos(a) * rad, springY + Math.sin(a) * rad, 0],
      scale: [1.2, 0.42, 1.25],
    }));
  }

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 6. Jump pad                                                         */
/* ------------------------------------------------------------------ */

/** userData.parts = { pad, cone, chevrons } */
export function buildJumpPad({ r = 1.2 } = {}) {
  const g = group([], { name: 'jumpPad' });
  const R = q(r);
  const drumH = 0.3;

  g.add(mesh(cylinder(R, q(R * 1.08), drumH, 24), MAT.steelDark, { pos: [0, drumH / 2, 0] }));
  g.add(mesh(torus(q(R * 0.99), 0.06, 6, 28), MAT.steel, {
    pos: [0, drumH, 0],
    rot: [Math.PI / 2, 0, 0],
  }));

  const pad = mesh(
    cylinder(q(R * 0.86), q(R * 0.9), 0.16, 24),
    physMat('pr_padRed', {
      color: PALETTE.candyRed,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    }),
    { pos: [0, drumH + 0.08, 0], name: 'jumpPadTop' },
  );
  g.add(pad);
  g.add(mesh(torus(q(R * 0.52), 0.035, 5, 22), MAT.gold, {
    pos: [0, drumH + 0.17, 0],
    rot: [Math.PI / 2, 0, 0],
  }));

  /* --- rim chevrons ---------------------------------------------------- */
  const chevrons = [];
  const chevMat = glow(PALETTE.auroraA);
  const bar = box(0.06, q(R * 0.22), 0.05);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const c = group([], {
      pos: [Math.cos(a) * R * 1.02, drumH * 0.52, Math.sin(a) * R * 1.02],
      rot: [0, Math.PI / 2 - a, 0],
      name: 'chevron',
    });
    c.add(mesh(bar, chevMat, { pos: [-R * 0.075, 0, 0], rot: [0, 0, 0.62] }));
    c.add(mesh(bar, chevMat, { pos: [R * 0.075, 0, 0], rot: [0, 0, -0.62] }));
    chevrons.push(c);
    g.add(c);
  }

  /* --- rising cone of light -------------------------------------------- */
  const coneH = q(R * 2.8);
  const coneMesh = mesh(cone(q(R * 0.8), coneH, 20), volumeGlow('pr_jumpCone', PALETTE.auroraA, 0.25), {
    pos: [0, drumH + 0.16 + coneH / 2, 0],
    rot: [Math.PI, 0, 0],
    cast: false,
    receive: false,
    name: 'jumpPadCone',
  });
  g.add(coneMesh);

  addLightAnchor(g, [0, drumH + 0.55, 0], {
    color: PALETTE.auroraA,
    intensity: 2.2,
    distance: 10,
  });

  g.userData.parts = { pad, cone: coneMesh, chevrons };
  shadowize(g);
  coneMesh.castShadow = false;
  coneMesh.receiveShadow = false;
  return g;
}

/* ------------------------------------------------------------------ */
/* 7. Toy crate                                                        */
/* ------------------------------------------------------------------ */

export function buildCrate({ s = 1.2, seed = 1 } = {}) {
  const rand = mulberry32((seed * 15485863 + 3) >>> 0 || 1);
  const g = group([], { name: 'crate' });
  const S = q(s);
  const half = S / 2;
  const plankT = q(S * 0.05);

  g.add(mesh(roundedBox(q(S * 0.96), q(S * 0.96), q(S * 0.96), 0.03, 1), MAT.woodDark, {
    pos: [0, half, 0],
  }));

  /* --- planked sides --------------------------------------------------- */
  const plank = box(q(S * 0.92), q(S * 0.26), plankT);
  for (let i = 0; i < 4; i++) {
    const face = group([], { rot: [0, (i * Math.PI) / 2, 0] });
    for (let p = 0; p < 3; p++) {
      face.add(mesh(plank, MAT.wood, {
        pos: [0, S * ((p + 0.5) / 3), q(half + plankT * 0.45)],
        rot: [rr(rand, -0.012, 0.012), 0, rr(rand, -0.006, 0.006)],
      }));
    }
    g.add(face);
  }
  // lid
  g.add(mesh(box(q(S * 0.99), q(S * 0.07), q(S * 0.99)), MAT.wood, { pos: [0, S - S * 0.02, 0] }));

  /* --- corner brackets + rivets ---------------------------------------- */
  const strapX = box(q(S * 0.17), q(S * 0.94), 0.028);
  const strapZ = box(0.028, q(S * 0.94), q(S * 0.17));
  const rivet = cylinder(q(S * 0.022), q(S * 0.022), 0.03, 6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(strapX, MAT.steelDark, {
        pos: [sx * (half - S * 0.085), half, sz * (half + plankT * 0.9)],
      }));
      g.add(mesh(strapZ, MAT.steelDark, {
        pos: [sx * (half + plankT * 0.9), half, sz * (half - S * 0.085)],
      }));
      for (const ry of [0.16, 0.5, 0.84]) {
        g.add(mesh(rivet, MAT.steel, {
          pos: [sx * (half - S * 0.085), S * ry, sz * (half + plankT * 1.1)],
          rot: [Math.PI / 2, 0, 0],
        }));
        g.add(mesh(rivet, MAT.steel, {
          pos: [sx * (half + plankT * 1.1), S * ry, sz * (half - S * 0.085)],
          rot: [0, 0, Math.PI / 2],
        }));
      }
    }
  }

  /* --- stencil on the lid ---------------------------------------------- */
  const stencil = group([], {
    pos: [0, S + 0.012, 0],
    rot: [0, rr(rand, -0.25, 0.25), 0],
    name: 'stencil',
  });
  const stMat = matStencil();
  const arm = box(q(S * 0.5), 0.02, q(S * 0.06));
  if (rand() > 0.5) {
    // snowflake: three crossed arms with barbs
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      stencil.add(mesh(arm, stMat, { rot: [0, a, 0] }));
      for (const sgn of [-1, 1]) {
        for (const t of [0.24, 0.38]) {
          stencil.add(mesh(box(q(S * 0.14), 0.02, q(S * 0.05)), stMat, {
            pos: [Math.cos(a) * S * t * sgn, 0, -Math.sin(a) * S * t * sgn],
            rot: [0, a + sgn * 0.9, 0],
          }));
        }
      }
    }
  } else {
    // five-point star
    for (let i = 0; i < 5; i++) {
      stencil.add(mesh(box(q(S * 0.42), 0.02, q(S * 0.07)), stMat, {
        pos: [Math.cos((i / 5) * TAU) * S * 0.11, 0, -Math.sin((i / 5) * TAU) * S * 0.11],
        rot: [0, (i / 5) * TAU, 0],
      }));
    }
  }
  g.add(stencil);

  // worn: a couple of chipped corners picked out in bare dark wood
  for (let i = 0; i < 2; i++) {
    g.add(mesh(box(q(S * 0.12), q(S * 0.1), q(S * 0.12)), MAT.woodDark, {
      pos: [rr(rand, -half, half) * 0.8, S * rr(rand, 0.1, 0.9), (rand() > 0.5 ? 1 : -1) * half],
      rot: [rand(), rand(), rand()],
    }));
  }

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 8. Santa's sleigh (hero prop)                                       */
/* ------------------------------------------------------------------ */

/** ~4.5 m long along X (nose at +X), ~1.8 m tall. Origin at ground centre. */
export function buildSleigh() {
  const g = group([], { name: 'sleigh' });
  const gold = MAT.gold;
  const lacquer = matLacquer();
  const lacquerDark = matLacquerDark();

  /* --- runners ------------------------------------------------------- */
  const runnerPts = [
    [-2.05, 0.3, 0],
    [-2.16, 0.11, 0],
    [-1.92, 0.05, 0],
    [-0.6, 0.045, 0],
    [0.9, 0.045, 0],
    [1.72, 0.07, 0],
    [2.16, 0.2, 0],
    [2.36, 0.56, 0],
    [2.2, 0.94, 0],
    [1.84, 1.0, 0],
    [1.72, 0.82, 0],
  ];
  for (const sz of [-1, 1]) {
    const pts = runnerPts.map(([x, y]) => [x, y, sz * 0.6]);
    g.add(mesh(tube(pts, 0.055, 60, 8), gold));
    // struts up to the hull
    for (const x of [-1.55, -0.35, 0.85, 1.5]) {
      g.add(mesh(cylinder(0.038, 0.045, 0.3, 8), gold, { pos: [x, 0.19, sz * 0.6] }));
    }
    g.add(mesh(torus(0.14, 0.026, 5, 14), gold, { pos: [0.25, 0.2, sz * 0.6], rot: [0, Math.PI / 2, 0] }));
  }

  /* --- hull: two extruded side panels + floor + end panels ----------- */
  const side = new THREE.Shape();
  side.moveTo(-1.85, 0.3);
  side.lineTo(1.55, 0.3);
  side.quadraticCurveTo(2.05, 0.32, 2.12, 0.72);
  side.quadraticCurveTo(2.2, 1.12, 1.78, 1.18);
  side.quadraticCurveTo(1.96, 0.92, 1.55, 0.86);
  side.lineTo(0.15, 0.82);
  side.lineTo(-0.55, 0.86);
  side.quadraticCurveTo(-1.34, 0.92, -1.58, 1.44);
  side.quadraticCurveTo(-1.76, 1.76, -2.12, 1.7);
  side.quadraticCurveTo(-1.96, 1.38, -2.0, 0.9);
  side.quadraticCurveTo(-2.0, 0.5, -1.85, 0.3);
  side.closePath();
  const sideGeo = extrude(side, 0.1, 0.02);
  g.add(mesh(sideGeo, lacquer, { pos: [0, 0, 0.55] }));
  g.add(mesh(sideGeo, lacquer, { pos: [0, 0, -0.65] }));

  g.add(mesh(box(3.5, 0.1, 1.14), lacquerDark, { pos: [-0.15, 0.35, 0] }));
  g.add(mesh(box(0.9, 0.08, 1.14), lacquerDark, { pos: [1.8, 0.71, 0], rot: [0, 0, 1.096] }));
  g.add(mesh(box(1.8, 0.09, 1.14), lacquerDark, { pos: [-1.32, 1.27, 0], rot: [0, 0, 2.63] }));

  /* --- gold rail along the gunwale ----------------------------------- */
  const railPts = [
    [1.78, 1.2, 0],
    [1.56, 0.92, 0],
    [0.15, 0.86, 0],
    [-0.55, 0.9, 0],
    [-1.34, 0.98, 0],
    [-1.56, 1.46, 0],
    [-2.1, 1.74, 0],
  ];
  for (const sz of [-1, 1]) {
    g.add(mesh(tube(railPts.map(([x, y]) => [x, y, sz * 0.62]), 0.042, 40, 6), gold));
  }

  /* --- filigree scrollwork on the side panels ------------------------ */
  for (const sz of [-1, 1]) {
    const z = sz * 0.664; // sits proud of the panel face at +-0.65
    for (const [x, y, r] of [
      [-1.0, 0.6, 0.2],
      [-0.2, 0.58, 0.15],
      [0.7, 0.6, 0.2],
      [1.35, 0.58, 0.13],
    ]) {
      g.add(mesh(torus(q(r), 0.022, 5, 16), gold, { pos: [x, y, z] }));
    }
    const curl = [
      [-1.55, 0.5, z],
      [-1.3, 0.68, z],
      [-1.05, 0.48, z],
      [-0.75, 0.66, z],
      [-0.5, 0.48, z],
    ];
    g.add(mesh(tube(curl, 0.02, 26, 6), gold));
    const curl2 = curl.map(([x, y]) => [x + 1.85, y, z]);
    g.add(mesh(tube(curl2, 0.02, 26, 6), gold));
  }

  /* --- bench with fur trim -------------------------------------------- */
  g.add(mesh(roundedBox(1.0, 0.18, 1.05, 0.07, 1), MAT.santaCoat, { pos: [0.6, 0.49, 0] }));
  g.add(mesh(roundedBox(0.14, 0.78, 1.0, 0.06, 1), MAT.santaCoat, {
    pos: [0.06, 0.96, 0],
    rot: [0, 0, 0.28],
  }));
  const trim = capsule(0.07, 0.94, 5, 10);
  g.add(mesh(trim, MAT.fur, { pos: [1.08, 0.52, 0], rot: [Math.PI / 2, 0, 0] }));
  g.add(mesh(trim, MAT.fur, { pos: [-0.06, 1.33, 0], rot: [Math.PI / 2, 0, 0] }));
  for (const sz of [-1, 1]) {
    g.add(mesh(capsule(0.055, 0.66, 4, 8), MAT.fur, {
      pos: [0.35, 0.94, sz * 0.5],
      rot: [0, 0, 0.28],
    }));
  }

  /* --- sleigh bells on the dash --------------------------------------- */
  for (let i = -1; i <= 1; i++) {
    g.add(mesh(sphere(0.07, 10, 8), gold, { pos: [1.9, 1.06, i * 0.32] }));
    g.add(mesh(cylinder(0.02, 0.02, 0.1, 6), MAT.leather, { pos: [1.9, 1.16, i * 0.32] }));
  }
  g.add(mesh(box(0.06, 0.05, 1.0), MAT.leather, { pos: [1.9, 1.2, 0] }));

  /* --- presents in the back -------------------------------------------- */
  const cargo = [
    [-1.35, 0.4, 0.24, 0.6],
    [-0.72, 0.4, -0.24, 0.55],
    [-1.15, 0.4, -0.3, 0.45],
    [-1.2, 0.85, 0.1, 0.42],
  ];
  cargo.forEach(([x, y, z, s], i) => {
    const gift = makeGift(s, s * 0.78, s * 0.86, 41 + i * 5);
    gift.position.set(x, y, z);
    gift.rotation.y = 0.4 * i;
    g.add(gift);
  });

  /* --- a dusting of snow ------------------------------------------------ */
  g.add(mesh(sphere(0.3, 8, 6), MAT.snow, { pos: [-1.75, 1.6, 0], scale: [1.3, 0.3, 2.2] }));
  g.add(mesh(sphere(0.2, 8, 6), MAT.snow, { pos: [1.9, 1.2, 0.52], scale: [1.1, 0.3, 0.9] }));

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 9. Picket fence                                                     */
/* ------------------------------------------------------------------ */

/** Runs along X, origin at the centre of the span on the ground. */
export function buildFence({ len = 6, seed = 1 } = {}) {
  const rand = mulberry32((seed * 22695477 + 11) >>> 0 || 1);
  const g = group([], { name: 'fence' });

  const pitchX = 0.34;
  const n = Math.max(2, Math.round(len / pitchX));
  const step = len / n;
  const pickH = 1.05;
  const pickGeo = box(0.1, q(pickH), 0.055);
  const tipGeo = cone(0.075, 0.17, 4);
  const snowTip = cone(0.062, 0.12, 6);

  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * step;
    if (i > 0 && i < n - 1 && rand() > 0.94) continue; // a missing picket here and there
    const lean = rr(rand, -0.035, 0.035);
    const hh = pickH * rr(rand, 0.95, 1.05);
    const p = group([], { pos: [x, 0, 0], rot: [0, rr(rand, -0.06, 0.06), lean] });
    p.add(mesh(pickGeo, MAT.wood, { pos: [0, hh / 2, 0], scale: [1, hh / pickH, 1] }));
    p.add(mesh(tipGeo, MAT.wood, { pos: [0, hh + 0.08, 0], rot: [0, Math.PI / 4, 0] }));
    p.add(mesh(snowTip, MAT.snow, { pos: [0, hh + 0.13, 0], rot: [0, rand() * TAU, 0] }));
    g.add(p);
  }

  // rails
  for (const ry of [0.34, 0.78]) {
    g.add(mesh(box(q(len), 0.09, 0.06), MAT.woodDark, { pos: [0, ry, -0.055] }));
  }
  // snow ridge along the top rail
  g.add(mesh(box(q(len), 0.05, 0.09), MAT.snow, { pos: [0, 0.84, -0.055] }));

  // end posts
  for (const sx of [-1, 1]) {
    const px = sx * (len / 2 + 0.09);
    g.add(mesh(box(0.16, 1.25, 0.16), MAT.woodDark, { pos: [px, 0.62, -0.02] }));
    g.add(mesh(cone(0.13, 0.2, 4), MAT.woodDark, { pos: [px, 1.34, -0.02], rot: [0, Math.PI / 4, 0] }));
    g.add(mesh(cone(0.11, 0.14, 6), MAT.snow, { pos: [px, 1.42, -0.02] }));
    g.add(mesh(sphere(0.34, 8, 6), MAT.snow, { pos: [px, 0.03, -0.02], scale: [1, 0.3, 1.3] }));
  }

  // drifted snow along the base
  for (let i = 0; i < Math.max(2, Math.round(len / 2)); i++) {
    const r = q(rr(rand, 0.3, 0.55));
    g.add(mesh(sphere(r, 8, 6), MAT.snow, {
      pos: [rr(rand, -len / 2, len / 2), 0.02, rr(rand, -0.12, 0.06)],
      scale: [1.5, 0.34, 0.9],
    }));
  }

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 10. Workshop bench                                                  */
/* ------------------------------------------------------------------ */

/** Bench runs along X, ~1 m deep. Origin at ground centre. */
export function buildWorkbench({ w = 3, seed = 1 } = {}) {
  const rand = mulberry32((seed * 1103515245 + 12345) >>> 0 || 1);
  const g = group([], { name: 'workbench' });
  const W = q(w);
  const depth = 1.0;
  const topY = 0.92;

  /* --- planked top ---------------------------------------------------- */
  const nPl = 4;
  const plW = depth / nPl;
  for (let i = 0; i < nPl; i++) {
    g.add(mesh(box(W, 0.07, q(plW * 0.95)), MAT.wood, {
      pos: [0, topY - 0.035, -depth / 2 + (i + 0.5) * plW],
      rot: [rr(rand, -0.005, 0.005), 0, 0],
    }));
  }
  // apron
  for (const sz of [-1, 1]) {
    g.add(mesh(box(q(W - 0.16), 0.14, 0.06), MAT.woodDark, {
      pos: [0, topY - 0.14, sz * (depth / 2 - 0.05)],
    }));
  }

  /* --- legs and stretchers -------------------------------------------- */
  const legH = q(topY - 0.07);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(box(0.12, legH, 0.12), MAT.woodDark, {
        pos: [sx * (W / 2 - 0.14), legH / 2, sz * (depth / 2 - 0.12)],
      }));
    }
    g.add(mesh(box(0.09, 0.09, q(depth - 0.3)), MAT.woodDark, {
      pos: [sx * (W / 2 - 0.14), 0.24, 0],
    }));
  }
  g.add(mesh(box(q(W - 0.3), 0.09, 0.09), MAT.woodDark, { pos: [0, 0.24, 0] }));

  /* --- vice ------------------------------------------------------------ */
  const vx = -W / 2 + 0.42;
  const vz = depth / 2 - 0.02;
  g.add(mesh(box(0.36, 0.24, 0.06), MAT.steelDark, { pos: [vx, topY - 0.1, vz + 0.06] }));
  g.add(mesh(box(0.36, 0.24, 0.06), MAT.steelDark, { pos: [vx, topY - 0.1, vz - 0.06] }));
  g.add(mesh(cylinder(0.035, 0.035, 0.34, 8), MAT.steel, {
    pos: [vx, topY - 0.1, vz + 0.16],
    rot: [Math.PI / 2, 0, 0],
  }));
  g.add(mesh(cylinder(0.022, 0.022, 0.3, 6), MAT.steel, {
    pos: [vx, topY - 0.1, vz + 0.3],
    rot: [0, 0, Math.PI / 2],
  }));
  for (const sx of [-1, 1]) {
    g.add(mesh(sphere(0.04, 8, 6), MAT.steel, { pos: [vx + sx * 0.15, topY - 0.1, vz + 0.3] }));
  }

  /* --- scattered tools -------------------------------------------------- */
  const hammer = group([], {
    pos: [rr(rand, -W * 0.1, W * 0.18), topY + 0.04, rr(rand, -0.3, 0.1)],
    rot: [0, rr(rand, -1.2, 1.2), 0],
    name: 'hammer',
  });
  hammer.add(mesh(cylinder(0.021, 0.024, 0.32, 8), MAT.wood, { rot: [0, 0, Math.PI / 2] }));
  hammer.add(mesh(box(0.07, 0.07, 0.15), MAT.steelDark, { pos: [0.19, 0, 0] }));
  hammer.add(mesh(cone(0.045, 0.09, 6), MAT.steelDark, { pos: [0.19, 0, -0.11], rot: [-Math.PI / 2, 0, 0] }));
  g.add(hammer);

  const saw = group([], {
    pos: [rr(rand, -W * 0.3, -W * 0.05), topY + 0.02, rr(rand, 0.05, 0.32)],
    rot: [0, rr(rand, -0.9, 0.9), 0],
    name: 'saw',
  });
  saw.add(mesh(box(0.52, 0.012, 0.14), MAT.steel, { pos: [0.1, 0, 0] }));
  for (let i = 0; i < 9; i++) {
    saw.add(mesh(box(0.03, 0.012, 0.03), MAT.steel, {
      pos: [-0.12 + i * 0.055, 0, 0.085],
      rot: [0, Math.PI / 4, 0],
    }));
  }
  saw.add(mesh(roundedBox(0.16, 0.05, 0.11, 0.03, 1), MAT.woodDark, { pos: [-0.24, 0, 0] }));
  g.add(saw);

  /* --- half-finished toys ------------------------------------------------ */
  // rocking horse silhouette
  const hs = new THREE.Shape();
  hs.moveTo(-0.36, 0.03);
  hs.quadraticCurveTo(0, -0.06, 0.36, 0.03);
  hs.lineTo(0.33, 0.1);
  hs.lineTo(0.24, 0.1);
  hs.lineTo(0.2, 0.34);
  hs.quadraticCurveTo(0.28, 0.46, 0.3, 0.58);
  hs.lineTo(0.46, 0.62);
  hs.lineTo(0.5, 0.72);
  hs.lineTo(0.34, 0.78);
  hs.lineTo(0.22, 0.7);
  hs.quadraticCurveTo(0.12, 0.62, 0.02, 0.56);
  hs.lineTo(-0.22, 0.52);
  hs.quadraticCurveTo(-0.34, 0.5, -0.3, 0.34);
  hs.lineTo(-0.26, 0.1);
  hs.lineTo(-0.33, 0.1);
  hs.closePath();
  const horse = group([], {
    pos: [W * 0.3, topY, -0.1],
    rot: [0, rr(rand, -0.4, 0.4), 0],
    scale: 0.62,
    name: 'rockingHorse',
  });
  horse.add(mesh(extrude(hs, 0.11, 0.02), MAT.wood, { pos: [0, 0, -0.055] }));
  horse.add(mesh(box(0.22, 0.05, 0.14), matLacquer(), { pos: [-0.06, 0.55, 0] }));
  horse.add(mesh(box(0.12, 0.16, 0.13), MAT.icing, { pos: [0.16, 0.7, 0], rot: [0, 0, 0.5] }));
  g.add(horse);

  // ball
  g.add(mesh(sphere(0.1, 12, 10), candyMat(PALETTE.gumdropGreen), {
    pos: [W * 0.12, topY + 0.1, 0.3],
  }));

  // stack of blocks
  const blockCols = [PALETTE.gumdropRed, PALETTE.icingBlue, PALETTE.gumdropGreen, PALETTE.gold];
  const nb = 3 + Math.floor(rand() * 2);
  const bx = -W * 0.34;
  for (let i = 0; i < nb; i++) {
    const c = blockCols[(i + seed) % blockCols.length];
    const b = group([], {
      pos: [bx + rr(rand, -0.03, 0.03), topY + 0.085 + i * 0.17, -0.28 + rr(rand, -0.03, 0.03)],
      rot: [0, rr(rand, -0.35, 0.35), 0],
      name: 'block',
    });
    b.add(mesh(roundedBox(0.16, 0.16, 0.16, 0.02, 1), stdMat(`pr_block_${c}`, { color: c, roughness: 0.5 }), {}));
    // letter implied by an inset square
    for (const [px, py, pz, rx, ry] of [
      [0, 0, 0.081, 0, 0],
      [0.081, 0, 0, 0, Math.PI / 2],
    ]) {
      b.add(mesh(box(0.1, 0.1, 0.008), MAT.icing, { pos: [px, py, pz], rot: [rx, ry, 0] }));
      b.add(mesh(box(0.055, 0.055, 0.012), stdMat(`pr_block_${c}`, { color: c, roughness: 0.5 }), {
        pos: [px * 1.02, py, pz * 1.02],
        rot: [rx, ry, 0],
      }));
    }
    g.add(b);
  }

  // wood shavings / offcuts
  for (let i = 0; i < 4; i++) {
    g.add(mesh(box(q(rr(rand, 0.08, 0.2)), 0.02, 0.05), MAT.wood, {
      pos: [rr(rand, -W / 2, W / 2), topY + 0.01, rr(rand, -depth / 2, depth / 2)],
      rot: [0, rand() * TAU, 0],
    }));
  }

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 11. Conveyor belt                                                   */
/* ------------------------------------------------------------------ */

/** Runs along X, belt surface at y ~= 1.0. userData.parts = { belt, rollers } */
export function buildConveyor({ len = 8 } = {}) {
  const g = group([], { name: 'conveyor' });
  const beltY = 1.0;
  const halfL = len / 2;
  const width = 1.1;
  const rollR = 0.22;
  const axleY = beltY - rollR;
  const rubber = matRubber();
  const rollers = [];

  /* --- belt ------------------------------------------------------------ */
  const belt = mesh(box(q(len), 0.08, q(width)), rubber, {
    pos: [0, beltY - 0.04, 0],
    name: 'belt',
  });
  g.add(belt);
  g.add(mesh(box(q(len), 0.07, q(width)), rubber, { pos: [0, axleY - rollR + 0.035, 0] }));
  for (const sx of [-1, 1]) {
    g.add(mesh(cylinder(q(rollR), q(rollR), q(width), 20, true), rubber, {
      pos: [sx * (halfL - rollR), axleY, 0],
      rot: [Math.PI / 2, 0, 0],
    }));
  }

  /* --- rollers ---------------------------------------------------------- */
  for (const sx of [-1, 1]) {
    const r = mesh(cylinder(q(rollR * 0.8), q(rollR * 0.8), q(width + 0.22), 14), MAT.steel, {
      pos: [sx * (halfL - rollR), axleY, 0],
      rot: [Math.PI / 2, 0, 0],
      name: 'roller',
    });
    rollers.push(r);
    g.add(r);
    g.add(mesh(cylinder(0.05, 0.05, q(width + 0.42), 8), MAT.steelDark, {
      pos: [sx * (halfL - rollR), axleY, 0],
      rot: [Math.PI / 2, 0, 0],
    }));
  }
  const nIdle = Math.max(2, Math.round(len / 2.2));
  for (let i = 0; i < nIdle; i++) {
    const x = -halfL + rollR * 2 + ((i + 0.5) / nIdle) * (len - rollR * 4);
    const r = mesh(cylinder(0.09, 0.09, q(width + 0.16), 10), MAT.steel, {
      pos: [x, beltY - 0.14, 0],
      rot: [Math.PI / 2, 0, 0],
      name: 'roller',
    });
    rollers.push(r);
    g.add(r);
  }

  /* --- side frames + legs ------------------------------------------------ */
  for (const sz of [-1, 1]) {
    const z = sz * (width / 2 + 0.09);
    g.add(mesh(box(q(len + 0.24), 0.42, 0.09), MAT.steel, { pos: [0, axleY, z] }));
    g.add(mesh(box(q(len + 0.24), 0.07, 0.14), MAT.steelDark, { pos: [0, axleY + 0.24, z] }));
    for (let i = 0; i < 2; i++) {
      const x = (i === 0 ? -1 : 1) * (halfL - 0.7);
      const legH = q(axleY - 0.21);
      g.add(mesh(box(0.11, legH, 0.11), MAT.steelDark, { pos: [x, legH / 2, z] }));
      g.add(mesh(box(0.3, 0.05, 0.24), MAT.steelDark, { pos: [x, 0.025, z] }));
      g.add(mesh(box(q(Math.hypot(0.55, legH * 0.7)), 0.06, 0.06), MAT.steelDark, {
        pos: [x + (i === 0 ? 0.3 : -0.3), legH * 0.55, z],
        rot: [0, 0, (i === 0 ? -1 : 1) * Math.atan2(legH * 0.7, 0.55)],
      }));
    }
  }

  /* --- cargo -------------------------------------------------------------- */
  const nGifts = Math.max(2, Math.round(len / 2.6));
  for (let i = 0; i < nGifts; i++) {
    const x = -halfL + 0.8 + (i / Math.max(1, nGifts - 1)) * (len - 1.6);
    const gift = makeGift(0.46, 0.36, 0.42, 700 + i * 3);
    gift.position.set(x, beltY, (i % 2 === 0 ? 1 : -1) * 0.1);
    gift.rotation.y = 0.2 + i * 0.5;
    g.add(gift);
  }

  g.userData.parts = { belt, rollers };
  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 12. Toy soldier / nutcracker statue                                 */
/* ------------------------------------------------------------------ */

/** Stiff, symmetrical guard statue. Origin at the feet. */
export function buildToySoldier({ h = 3 } = {}) {
  const g = group([], { name: 'toySoldier' });
  const u = (f) => f * h; // fraction of total height
  const black = MAT.licorice;
  const gold = MAT.gold;
  const coat = MAT.santaCoat;
  const white = MAT.icing;

  /* --- boots and legs --------------------------------------------------- */
  for (const sx of [-1, 1]) {
    const x = sx * u(0.075);
    g.add(mesh(cylinder(q(u(0.072)), q(u(0.082)), q(u(0.14)), 10), black, { pos: [x, u(0.07), 0] }));
    g.add(mesh(roundedBox(q(u(0.13)), q(u(0.055)), q(u(0.17)), 0.02, 1), black, {
      pos: [x, u(0.028), u(0.045)],
    }));
    g.add(mesh(cylinder(q(u(0.058)), q(u(0.068)), q(u(0.3)), 10), black, { pos: [x, u(0.28), 0] }));
    g.add(mesh(torus(q(u(0.07)), q(u(0.012)), 5, 12), gold, {
      pos: [x, u(0.145), 0],
      rot: [Math.PI / 2, 0, 0],
    }));
  }

  /* --- tunic ------------------------------------------------------------- */
  const tunicY0 = u(0.42);
  const tunicH = u(0.29);
  g.add(mesh(cylinder(q(u(0.15)), q(u(0.16)), q(tunicH), 16), coat, {
    pos: [0, tunicY0 + tunicH / 2, 0],
  }));
  // coat tails
  g.add(mesh(cylinder(q(u(0.16)), q(u(0.155)), q(u(0.07)), 16), MAT.santaCoatDark, {
    pos: [0, tunicY0 + u(0.02), 0],
  }));
  // belt + buckle
  g.add(mesh(torus(q(u(0.155)), q(u(0.016)), 5, 18), gold, {
    pos: [0, tunicY0 + u(0.06), 0],
    rot: [Math.PI / 2, 0, 0],
  }));
  g.add(mesh(box(q(u(0.06)), q(u(0.05)), q(u(0.02))), gold, {
    pos: [0, tunicY0 + u(0.06), u(0.155)],
  }));
  // gold buttons, two rows
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      g.add(mesh(sphere(q(u(0.016)), 8, 6), gold, {
        pos: [sx * u(0.05), tunicY0 + u(0.12) + i * u(0.045), u(0.147)],
      }));
    }
  }
  // gold frogging across the chest
  for (let i = 0; i < 4; i++) {
    g.add(mesh(box(q(u(0.1)), q(u(0.012)), q(u(0.012))), gold, {
      pos: [0, tunicY0 + u(0.12) + i * u(0.045), u(0.15)],
    }));
  }

  /* --- arms, gloves, epaulettes ------------------------------------------ */
  const shoulderY = tunicY0 + tunicH;
  for (const sx of [-1, 1]) {
    const x = sx * u(0.168);
    g.add(mesh(cylinder(q(u(0.042)), q(u(0.046)), q(u(0.26)), 10), coat, { pos: [x, shoulderY - u(0.14), 0] }));
    g.add(mesh(sphere(q(u(0.05)), 10, 8), white, { pos: [x, shoulderY - u(0.28), 0] }));
    // epaulette + fringe
    g.add(mesh(cylinder(q(u(0.062)), q(u(0.055)), q(u(0.03)), 12), gold, { pos: [x, shoulderY - u(0.005), 0] }));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      g.add(mesh(cylinder(q(u(0.008)), q(u(0.008)), q(u(0.05)), 5), gold, {
        pos: [x + Math.cos(a) * u(0.05), shoulderY - u(0.04), Math.sin(a) * u(0.05)],
      }));
    }
  }

  /* --- collar and head ---------------------------------------------------- */
  g.add(mesh(cylinder(q(u(0.105)), q(u(0.125)), q(u(0.03)), 14), white, { pos: [0, shoulderY + u(0.012), 0] }));
  const headY = shoulderY + u(0.03);
  const headH = u(0.11);
  g.add(mesh(cylinder(q(u(0.095)), q(u(0.1)), q(headH), 14), MAT.skin, { pos: [0, headY + headH / 2, 0] }));
  // eyes, cheeks, moustache, jaw
  for (const sx of [-1, 1]) {
    g.add(mesh(sphere(q(u(0.013)), 8, 6), black, { pos: [sx * u(0.035), headY + u(0.075), u(0.09)] }));
    g.add(mesh(sphere(q(u(0.018)), 8, 6), candyMat(PALETTE.gumdropRed), {
      pos: [sx * u(0.062), headY + u(0.045), u(0.075)],
      scale: [1, 0.7, 0.5],
    }));
    g.add(mesh(capsule(q(u(0.011)), q(u(0.05)), 4, 8), white, {
      pos: [sx * u(0.033), headY + u(0.042), u(0.093)],
      rot: [0, 0, Math.PI / 2 + sx * 0.35],
    }));
  }
  g.add(mesh(box(q(u(0.075)), q(u(0.022)), q(u(0.02))), black, { pos: [0, headY + u(0.018), u(0.088)] }));

  /* --- busby hat ----------------------------------------------------------- */
  const hatY = headY + headH;
  const hatH = u(0.19);
  g.add(mesh(cylinder(q(u(0.115)), q(u(0.112)), q(hatH), 16), black, { pos: [0, hatY + hatH / 2, 0] }));
  g.add(mesh(cylinder(q(u(0.118)), q(u(0.118)), q(u(0.02)), 16), black, { pos: [0, hatY + u(0.005), 0] }));
  g.add(mesh(torus(q(u(0.115)), q(u(0.012)), 5, 16), gold, {
    pos: [0, hatY + u(0.04), 0],
    rot: [Math.PI / 2, 0, 0],
  }));
  g.add(mesh(cylinder(q(u(0.035)), q(u(0.035)), q(u(0.012)), 10), gold, {
    pos: [0, hatY + u(0.11), u(0.112)],
    rot: [Math.PI / 2, 0, 0],
  }));
  g.add(mesh(sphere(q(u(0.032)), 10, 8), candyMat(PALETTE.gumdropRed), { pos: [0, hatY + hatH + u(0.02), 0] }));
  g.add(mesh(cone(q(u(0.02)), q(u(0.07)), 8), candyMat(PALETTE.gumdropRed), { pos: [0, hatY + hatH + u(0.06), 0] }));

  /* --- musket held at the side ---------------------------------------------- */
  const mx = u(0.235);
  const musket = group([], { pos: [mx, 0, u(0.02)], rot: [0, 0, -0.06], name: 'musket' });
  musket.add(mesh(cylinder(q(u(0.014)), q(u(0.016)), q(u(0.5)), 8), MAT.steelDark, { pos: [0, u(0.36), 0] }));
  musket.add(mesh(roundedBox(q(u(0.045)), q(u(0.3)), q(u(0.05)), 0.02, 1), MAT.woodDark, { pos: [0, u(0.16), 0] }));
  musket.add(mesh(box(q(u(0.05)), q(u(0.07)), q(u(0.055))), MAT.woodDark, { pos: [0, u(0.03), 0] }));
  musket.add(mesh(cone(q(u(0.012)), q(u(0.14)), 6), MAT.steel, { pos: [0, u(0.68), 0] }));
  musket.add(mesh(torus(q(u(0.022)), q(u(0.008)), 4, 10), gold, {
    pos: [0, u(0.3), 0],
    rot: [Math.PI / 2, 0, 0],
  }));
  g.add(musket);

  /* --- snow on the shoulders and hat ------------------------------------------ */
  g.add(mesh(sphere(q(u(0.1)), 8, 6), MAT.snow, { pos: [0, hatY + hatH - u(0.005), 0], scale: [1.1, 0.28, 1.1] }));
  for (const sx of [-1, 1]) {
    g.add(mesh(sphere(q(u(0.055)), 8, 6), MAT.snow, {
      pos: [sx * u(0.168), shoulderY + u(0.02), 0],
      scale: [1, 0.3, 1],
    }));
  }

  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 13. Snow drift                                                      */
/* ------------------------------------------------------------------ */

/**
 * Wind-sculpted snow bank. Non-colliding decoration -- the underside is
 * flattened to y = 0 so it beds into the floor.
 */
export function buildSnowDrift({ r = 3, seed = 1 } = {}) {
  const g = group([], { name: 'snowDrift' });
  const rand = mulberry32((seed * 2246822519 + 17) >>> 0 || 1);
  const fbm = makeFbm({ seed: (seed * 37 + 5) >>> 0, octaves: 4, baseFreq: 3 });

  // unique geometry per drift: clone so the shared cache is never mutated
  const geo = sphere(1, 32, 16).clone();
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new THREE.Vector3();

  const height = r * rr(rand, 0.3, 0.46);
  const stretchX = rr(rand, 1.05, 1.4);
  const stretchZ = rr(rand, 0.7, 0.98);
  const shear = rr(rand, -0.35, 0.35);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u0 = uv.getX(i);
    const v0 = uv.getY(i);
    const wob = Math.sin(Math.PI * v0); // 0 at the poles: keeps the crest clean
    const k = 0.68 + fbm(u0, v0) * 0.78 * wob;
    let y = v.y * height * k;
    const x = v.x * r * stretchX * k;
    const z = v.z * r * stretchZ * k;
    if (y < 0) y = -0.02; // flatten the underside just below the floor
    pos.setXYZ(i, x + y * shear, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  g.add(mesh(geo, MAT.snow, { name: 'drift' }));
  g.userData.collide = false;
  g.userData.decoration = true;
  shadowize(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 14. Icicle cluster                                                  */
/* ------------------------------------------------------------------ */

/** Origin at the TOP -- these hang downward from an eave or ceiling. */
export function buildIcicleCluster({ n = 5, seed = 1 } = {}) {
  const rand = mulberry32((seed * 69069 + 5) >>> 0 || 1);
  const g = group([], { name: 'icicleCluster' });
  const ice = MAT.ice;
  const count = Math.max(1, Math.round(n));

  // frozen lip they grow from
  g.add(mesh(sphere(0.3, 10, 6), ice, { pos: [0, -0.02, 0], scale: [1.5, 0.14, 0.6] }));

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const x = (t - 0.5) * 0.7 + rr(rand, -0.05, 0.05);
    const z = rr(rand, -0.09, 0.09);
    const len = q(rr(rand, 0.28, 1.35));
    const rad = q(0.035 + len * rr(rand, 0.05, 0.085));
    g.add(mesh(cone(rad, len, 7), ice, {
      pos: [x, -len / 2 + 0.02, z],
      rot: [Math.PI, rand() * TAU, rr(rand, -0.07, 0.07)],
    }));
    g.add(mesh(sphere(q(rad * 1.3), 7, 5), ice, { pos: [x, -0.01, z], scale: [1, 0.5, 1] }));
  }

  shadowize(g);
  return g;
}

