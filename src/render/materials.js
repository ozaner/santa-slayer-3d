/**
 * Shared palette, procedural textures and material/geometry helpers.
 *
 * Everything in Santa Slayer 3D is generated at runtime -- there are no image
 * or model files anywhere in the project. This module is the single source of
 * truth for colour and surface, so that a gingerbread wall and a gingerbread
 * enemy read as the same material.
 *
 * All builders are lazily evaluated and cached: calling `stdMat('snow')` a
 * thousand times returns one material, and spawning 200 enemies allocates one
 * set of geometries.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export { RoundedBoxGeometry };

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export const PALETTE = {
  // Santa
  santaRed: 0xc4162a,
  santaRedDark: 0x8e0f1e,
  santaFur: 0xf4f6fb,
  santaSkin: 0xf0c1a0,
  santaSkinShadow: 0xd9a084,
  santaBelt: 0x241c1a,
  santaBuckle: 0xf2c14e,
  santaBoot: 0x1a1412,

  // Gingerbread
  ginger: 0xb2703a,
  gingerDark: 0x7d4a22,
  gingerLight: 0xd39a5f,
  gingerBurnt: 0x5c3418,
  icing: 0xfbf7ef,
  icingBlue: 0xbfe4ff,
  gumdropRed: 0xe0324b,
  gumdropGreen: 0x33b06a,
  gumdropPurple: 0x8a4fd0,
  licorice: 0x201a20,

  // Candy
  candyRed: 0xe23b3b,
  candyWhite: 0xfdfaf5,
  candyGreen: 0x2fae63,
  mint: 0x9ff2d6,

  // World
  snow: 0xeef3fb,
  snowShadow: 0xb9c7de,
  ice: 0xa9d8ef,
  iceDeep: 0x4f93b8,
  night: 0x0a1230,
  nightHorizon: 0x2a3f7a,
  wood: 0x6b4a30,
  woodDark: 0x40291a,
  brick: 0x8f5a3c,
  metal: 0x9aa3b0,
  metalDark: 0x4a525e,
  gold: 0xf0c05a,
  pine: 0x1f6b45,
  pineDark: 0x144a2f,

  // Light / FX
  warmLight: 0xffbb66,
  coldLight: 0x8fbaff,
  auroraA: 0x35ffa8,
  auroraB: 0x6a5cff,
  fire: 0xff8a3c,
  blood: 0xd8342f, // "crumbs"
};

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value-noise field sampled with smoothstep interpolation. */
function valueNoiseField(size, rand) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return g;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function sampleField(field, size, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smoothstep(x - xi);
  const fy = smoothstep(y - yi);
  const x0 = ((xi % size) + size) % size;
  const y0 = ((yi % size) + size) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const a = field[y0 * size + x0];
  const b = field[y0 * size + x1];
  const c = field[y1 * size + x0];
  const d = field[y1 * size + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Tileable fractal noise sampler.
 * @returns {(x:number,y:number)=>number} value in 0..1 for uv in 0..1
 */
export function makeFbm({ seed = 1, octaves = 4, baseFreq = 4, gain = 0.5, lacunarity = 2 } = {}) {
  const rand = mulberry32(seed);
  const fields = [];
  for (let o = 0; o < octaves; o++) {
    const size = Math.max(2, Math.round(baseFreq * Math.pow(lacunarity, o)));
    fields.push({ size, field: valueNoiseField(size, rand) });
  }
  return (x, y) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (const { size, field } of fields) {
      sum += amp * sampleField(field, size, x * size, y * size);
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  };
}

/* ------------------------------------------------------------------ */
/* Canvas texture plumbing                                             */
/* ------------------------------------------------------------------ */

const textureCache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * Build (and cache) a CanvasTexture. `draw(ctx, size)` paints it.
 * `key` must be unique per visual result.
 */
export function canvasTexture(key, size, draw, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const cacheKey = `${key}|${size}|${repeat}|${srgb}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  textureCache.set(cacheKey, tex);
  return tex;
}

/**
 * Derive a tangent-space normal map from a grayscale height function.
 * `height(x, y)` takes pixel coords and returns 0..1.
 */
export function normalTexture(key, size, height, { repeat = 1, strength = 2 } = {}) {
  const cacheKey = `n:${key}|${size}|${repeat}|${strength}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = height(x, y);
  }
  const at = (x, y) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // normalize (-dx, -dy, 1)
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.NoColorSpace;
  textureCache.set(cacheKey, tex);
  return tex;
}

/** Grayscale roughness/AO style map from a height function. */
export function dataTexture(key, size, fn, { repeat = 1 } = {}) {
  const cacheKey = `d:${key}|${size}|${repeat}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(1, fn(x, y))) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.NoColorSpace;
  textureCache.set(cacheKey, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Named procedural surfaces                                           */
/* ------------------------------------------------------------------ */

function hexStr(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/** Mottled baked-dough colour + matching bumpy normal map. */
export const TEX = {
  gingerbread(repeat = 1) {
    const fbm = makeFbm({ seed: 7, octaves: 5, baseFreq: 6 });
    const crumb = makeFbm({ seed: 21, octaves: 3, baseFreq: 40 });
    return {
      map: canvasTexture(`ginger${repeat}`, 256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const base = new THREE.Color(PALETTE.ginger);
        const dark = new THREE.Color(PALETTE.gingerDark);
        const light = new THREE.Color(PALETTE.gingerLight);
        const c = new THREE.Color();
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const n = fbm(x / s, y / s);
            const k = crumb(x / s, y / s);
            c.copy(base);
            if (n < 0.45) c.lerp(dark, (0.45 - n) * 2.2);
            else c.lerp(light, (n - 0.45) * 1.6);
            c.multiplyScalar(0.86 + k * 0.28);
            const i = (y * s + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }, { repeat }),
      normalMap: normalTexture(`ginger${repeat}`, 256, (x, y) => {
        const s = 256;
        return crumb(x / s, y / s) * 0.6 + fbm(x / s, y / s) * 0.4;
      }, { repeat, strength: 3 }),
    };
  },

  /** Deep crushed velvet for Santa's coat. */
  velvet(colorHex, repeat = 1) {
    const fbm = makeFbm({ seed: 11, octaves: 4, baseFreq: 24 });
    const key = `velvet${colorHex}${repeat}`;
    return {
      map: canvasTexture(key, 256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const base = new THREE.Color(colorHex);
        const c = new THREE.Color();
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const n = fbm(x / s, y / s);
            // fine woven ribbing
            const weave = 0.5 + 0.5 * Math.sin(x * 1.7) * Math.sin(y * 1.7);
            c.copy(base).multiplyScalar(0.82 + n * 0.3 + weave * 0.05);
            const i = (y * s + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }, { repeat }),
      normalMap: normalTexture(key, 256, (x, y) => {
        const s = 256;
        return fbm(x / s, y / s) * 0.7 + 0.15 * (0.5 + 0.5 * Math.sin(x * 1.7) * Math.sin(y * 1.7));
      }, { repeat, strength: 1.4 }),
    };
  },

  /** Sparkly packed snow. */
  snow(repeat = 8) {
    const fbm = makeFbm({ seed: 3, octaves: 5, baseFreq: 5 });
    const grain = makeFbm({ seed: 31, octaves: 2, baseFreq: 64 });
    return {
      map: canvasTexture(`snow${repeat}`, 512, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const base = new THREE.Color(PALETTE.snow);
        const shade = new THREE.Color(PALETTE.snowShadow);
        const c = new THREE.Color();
        const rnd = mulberry32(99);
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const n = fbm(x / s, y / s);
            c.copy(base).lerp(shade, (1 - n) * 0.34);
            c.multiplyScalar(0.94 + grain(x / s, y / s) * 0.12);
            // occasional ice crystal sparkle
            if (rnd() > 0.9985) c.setRGB(1, 1, 1);
            const i = (y * s + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }, { repeat }),
      normalMap: normalTexture(`snow${repeat}`, 512, (x, y) => {
        const s = 512;
        return fbm(x / s, y / s) * 0.75 + grain(x / s, y / s) * 0.25;
      }, { repeat, strength: 2.2 }),
      roughnessMap: dataTexture(`snowr${repeat}`, 256, (x, y) => 0.62 + fbm(x / 256, y / 256) * 0.3, { repeat }),
    };
  },

  /** Diagonal candy-cane stripes. */
  candyStripe(a = PALETTE.candyWhite, b = PALETTE.candyRed, repeat = 1, bands = 8) {
    const key = `stripe${a}${b}${bands}${repeat}`;
    return {
      map: canvasTexture(key, 256, (ctx, s) => {
        ctx.fillStyle = hexStr(a);
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = hexStr(b);
        ctx.lineWidth = s / (bands * 2);
        ctx.lineCap = 'butt';
        for (let i = -bands; i < bands * 2; i++) {
          const o = (i * s) / bands;
          ctx.beginPath();
          ctx.moveTo(o, 0);
          ctx.lineTo(o + s, s);
          ctx.stroke();
        }
      }, { repeat }),
    };
  },

  /** Wrapping paper: coloured ground + repeating snowflake motif. */
  wrapping(bgHex, fgHex, seed = 1) {
    const key = `wrap${bgHex}${fgHex}${seed}`;
    return {
      map: canvasTexture(key, 256, (ctx, s) => {
        ctx.fillStyle = hexStr(bgHex);
        ctx.fillRect(0, 0, s, s);
        const rnd = mulberry32(seed * 977);
        const style = seed % 3;
        ctx.strokeStyle = hexStr(fgHex);
        ctx.fillStyle = hexStr(fgHex);
        if (style === 0) {
          // snowflakes
          for (let i = 0; i < 12; i++) {
            const cx = rnd() * s;
            const cy = rnd() * s;
            const r = 10 + rnd() * 14;
            ctx.lineWidth = 2.5;
            for (let a = 0; a < 6; a++) {
              const ang = (a / 6) * Math.PI * 2;
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(cx + Math.cos(ang) * r * 0.6, cy + Math.sin(ang) * r * 0.6);
              ctx.lineTo(cx + Math.cos(ang + 0.5) * r * 0.9, cy + Math.sin(ang + 0.5) * r * 0.9);
              ctx.stroke();
            }
          }
        } else if (style === 1) {
          // polka dots
          for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
              ctx.beginPath();
              ctx.arc((x + (y % 2) * 0.5) * (s / 6), y * (s / 6) + s / 12, s / 30, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          // vertical stripes
          ctx.lineWidth = s / 16;
          for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            ctx.moveTo((i + 0.5) * (s / 8), 0);
            ctx.lineTo((i + 0.5) * (s / 8), s);
            ctx.stroke();
          }
        }
      }),
    };
  },

  /** Weathered painted wood planks. */
  wood(colorHex = PALETTE.wood, repeat = 2, planks = 6) {
    const fbm = makeFbm({ seed: 5, octaves: 4, baseFreq: 8 });
    const key = `wood${colorHex}${repeat}${planks}`;
    const height = (x, y) => {
      const s = 256;
      const py = (y / s) * planks;
      const seam = Math.abs(py - Math.round(py));
      const grain = fbm(x / s, (y / s) * 0.25 + Math.floor(py) * 0.37);
      return seam < 0.04 ? 0.15 : 0.55 + grain * 0.45;
    };
    return {
      map: canvasTexture(key, 256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const base = new THREE.Color(colorHex);
        const c = new THREE.Color();
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const h = height(x, y);
            c.copy(base).multiplyScalar(0.45 + h * 0.8);
            const i = (y * s + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }, { repeat }),
      normalMap: normalTexture(key, 256, height, { repeat, strength: 2.5 }),
    };
  },

  /** Gingerbread-house wall: dough with piped icing seams. */
  gingerWall(repeat = 2) {
    const dough = makeFbm({ seed: 13, octaves: 4, baseFreq: 10 });
    const key = `gwall${repeat}`;
    const height = (x, y) => {
      const s = 256;
      const bx = (x / s) * 4 + (Math.floor((y / s) * 6) % 2) * 0.5;
      const by = (y / s) * 6;
      const sx = Math.abs(bx - Math.round(bx));
      const sy = Math.abs(by - Math.round(by));
      const seam = Math.min(sx, sy);
      if (seam < 0.05) return 0.95; // raised icing bead
      return 0.35 + dough(x / s, y / s) * 0.35;
    };
    return {
      map: canvasTexture(key, 256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const base = new THREE.Color(PALETTE.ginger);
        const dark = new THREE.Color(PALETTE.gingerDark);
        const ice = new THREE.Color(PALETTE.icing);
        const c = new THREE.Color();
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const h = height(x, y);
            if (h > 0.9) c.copy(ice);
            else c.copy(base).lerp(dark, 1 - dough(x / s, y / s));
            const i = (y * s + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }, { repeat }),
      normalMap: normalTexture(key, 256, height, { repeat, strength: 3.5 }),
    };
  },

  /** Brushed metal for the workshop / weapons. */
  metal(colorHex = PALETTE.metal, repeat = 1) {
    const fbm = makeFbm({ seed: 17, octaves: 3, baseFreq: 90 });
    const key = `metal${colorHex}${repeat}`;
    return {
      map: canvasTexture(key, 256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const base = new THREE.Color(colorHex);
        const c = new THREE.Color();
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const n = fbm(x / s, y / s);
            c.copy(base).multiplyScalar(0.85 + n * 0.3);
            const i = (y * s + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }, { repeat }),
      roughnessMap: dataTexture(`metalr${repeat}`, 256, (x, y) => 0.25 + fbm(x / 256, y / 256) * 0.45, { repeat }),
    };
  },

  /** Cracked lake ice. */
  ice(repeat = 4) {
    const fbm = makeFbm({ seed: 23, octaves: 4, baseFreq: 6 });
    const key = `ice${repeat}`;
    return {
      map: canvasTexture(key, 512, (ctx, s) => {
        const grad = ctx.createLinearGradient(0, 0, s, s);
        grad.addColorStop(0, hexStr(PALETTE.ice));
        grad.addColorStop(1, hexStr(PALETTE.iceDeep));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
        // frost swirls
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#ffffff';
        const rnd = mulberry32(41);
        for (let i = 0; i < 40; i++) {
          ctx.lineWidth = 1 + rnd() * 3;
          ctx.beginPath();
          let x = rnd() * s;
          let y = rnd() * s;
          ctx.moveTo(x, y);
          for (let j = 0; j < 8; j++) {
            x += (rnd() - 0.5) * 90;
            y += (rnd() - 0.5) * 90;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }, { repeat }),
      normalMap: normalTexture(`ice${repeat}`, 256, (x, y) => fbm(x / 256, y / 256), { repeat, strength: 1.2 }),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

const matCache = new Map();

/**
 * Cached MeshStandardMaterial factory.
 * `stdMat('key', { color, roughness, ... })` -- the key must be unique per
 * distinct set of params.
 */
export function stdMat(key, params = {}) {
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.0, ...params });
  matCache.set(key, m);
  return m;
}

export function physMat(key, params = {}) {
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0, ...params });
  matCache.set(key, m);
  return m;
}

/** Unlit emissive material used for lights, FX, tracers. */
export function glowMat(key, color, opacity = 1) {
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    toneMapped: false,
  });
  matCache.set(key, m);
  return m;
}

/** The standard library of surfaces, built on first use. */
export const MAT = {
  get gingerbread() {
    return stdMat('m_ginger', { ...TEX.gingerbread(1), color: 0xffffff, roughness: 0.85 });
  },
  get gingerbreadBurnt() {
    return stdMat('m_gingerBurnt', { ...TEX.gingerbread(1), color: 0x6f5040, roughness: 0.9 });
  },
  get gingerWall() {
    return stdMat('m_gwall', { ...TEX.gingerWall(2), roughness: 0.85 });
  },
  get icing() {
    return physMat('m_icing', {
      color: PALETTE.icing,
      roughness: 0.32,
      clearcoat: 0.6,
      clearcoatRoughness: 0.35,
      sheen: 0.4,
      sheenColor: 0xffffff,
    });
  },
  get santaCoat() {
    return stdMat('m_coat', { ...TEX.velvet(PALETTE.santaRed, 2), roughness: 0.72 });
  },
  get santaCoatDark() {
    return stdMat('m_coatd', { ...TEX.velvet(PALETTE.santaRedDark, 2), roughness: 0.75 });
  },
  get fur() {
    return physMat('m_fur', {
      color: PALETTE.santaFur,
      roughness: 0.95,
      sheen: 1.0,
      sheenRoughness: 0.9,
      sheenColor: 0xffffff,
    });
  },
  get skin() {
    return physMat('m_skin', {
      color: PALETTE.santaSkin,
      roughness: 0.62,
      sheen: 0.25,
      sheenColor: 0xffd9c0,
    });
  },
  get leather() {
    return stdMat('m_leather', { color: PALETTE.santaBelt, roughness: 0.55, metalness: 0.05 });
  },
  get gold() {
    return stdMat('m_gold', { color: PALETTE.gold, roughness: 0.28, metalness: 0.95 });
  },
  get steel() {
    return stdMat('m_steel', { ...TEX.metal(PALETTE.metal, 1), roughness: 0.4, metalness: 0.9 });
  },
  get steelDark() {
    return stdMat('m_steeld', { ...TEX.metal(PALETTE.metalDark, 1), roughness: 0.5, metalness: 0.85 });
  },
  get candy() {
    return physMat('m_candy', {
      ...TEX.candyStripe(PALETTE.candyWhite, PALETTE.candyRed, 1, 8),
      roughness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
  },
  get snow() {
    return stdMat('m_snow', { ...TEX.snow(16), color: 0xffffff, roughness: 0.85 });
  },
  get ice() {
    return physMat('m_ice', {
      ...TEX.ice(3),
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transmission: 0.15,
      thickness: 0.5,
      ior: 1.31,
    });
  },
  get wood() {
    return stdMat('m_wood', { ...TEX.wood(PALETTE.wood, 2), roughness: 0.85 });
  },
  get woodDark() {
    return stdMat('m_woodd', { ...TEX.wood(PALETTE.woodDark, 2), roughness: 0.88 });
  },
  get pine() {
    return stdMat('m_pine', { color: PALETTE.pine, roughness: 0.9, flatShading: true });
  },
  get licorice() {
    return physMat('m_licorice', { color: PALETTE.licorice, roughness: 0.35, clearcoat: 0.8 });
  },
};

/** Glossy candy in an arbitrary colour (gumdrops, buttons, gems). */
export function candyMat(colorHex) {
  return physMat(`candy_${colorHex}`, {
    color: colorHex,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    transmission: 0.25,
    thickness: 0.4,
    ior: 1.4,
  });
}

/** Emissive material for string lights, glowing eyes, muzzle heat. */
export function emissiveMat(key, colorHex, intensity = 2) {
  return stdMat(`em_${key}`, {
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: intensity,
    roughness: 0.4,
    toneMapped: true,
  });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const geoCache = new Map();

function cachedGeo(key, build) {
  if (geoCache.has(key)) return geoCache.get(key);
  const g = build();
  geoCache.set(key, g);
  return g;
}

export function roundedBox(w, h, d, r = 0.08, seg = 3) {
  return cachedGeo(`rb${w}_${h}_${d}_${r}_${seg}`, () =>
    new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 1e-4)));
}

export function box(w, h, d) {
  return cachedGeo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
}

export function sphere(r, ws = 20, hs = 14) {
  return cachedGeo(`s${r}_${ws}_${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

export function cylinder(rt, rb, h, seg = 16, open = false) {
  return cachedGeo(`c${rt}_${rb}_${h}_${seg}_${open}`, () =>
    new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}

export function cone(r, h, seg = 16) {
  return cachedGeo(`co${r}_${h}_${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

export function capsule(r, len, cap = 8, seg = 16) {
  return cachedGeo(`cap${r}_${len}_${cap}_${seg}`, () => new THREE.CapsuleGeometry(r, len, cap, seg));
}

export function torus(r, tube, rs = 10, ts = 24) {
  return cachedGeo(`t${r}_${tube}_${rs}_${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts));
}

/**
 * Lathe a 2D profile (array of [x, y]) around the Y axis.
 * Not cached -- profiles are unique per call site.
 */
export function lathe(profile, seg = 24) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y));
  return new THREE.LatheGeometry(pts, seg);
}

/** Smooth tube through a list of [x,y,z] points. */
export function tube(points, radius, tubularSeg = 24, radialSeg = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, tubularSeg, radius, radialSeg, closed);
}

/** Extrude a 2D shape (THREE.Shape) with bevel. */
export function extrude(shape, depth, bevel = 0.02) {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
}

/** Merge geometries that already carry their own transforms. */
export function mergeGeos(geos) {
  return BufferGeometryUtils.mergeGeometries(geos, false);
}

/** Build a mesh, position/rotate/scale it in one call. */
export function mesh(geo, material, { pos, rot, scale, name, cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale !== undefined) {
    if (typeof scale === 'number') m.scale.setScalar(scale);
    else m.scale.set(scale[0], scale[1], scale[2]);
  }
  if (name) m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Group with children, positioned. */
export function group(children = [], { pos, rot, scale, name } = {}) {
  const g = new THREE.Group();
  for (const c of children) if (c) g.add(c);
  if (pos) g.position.set(pos[0], pos[1], pos[2]);
  if (rot) g.rotation.set(rot[0], rot[1], rot[2]);
  if (scale !== undefined) {
    if (typeof scale === 'number') g.scale.setScalar(scale);
    else g.scale.set(scale[0], scale[1], scale[2]);
  }
  if (name) g.name = name;
  return g;
}

/** Force shadow flags on an entire subtree. */
export function shadowize(root, cast = true, receive = true) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return root;
}

/** Release GPU resources for a subtree (geometry/material caches excluded). */
export function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) {
      if (o.geometry && !geoCache.has(o.geometry.uuid)) o.geometry.dispose?.();
    }
  });
}
