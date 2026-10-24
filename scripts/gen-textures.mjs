#!/usr/bin/env node
/**
 * gen-textures.mjs — author the project's PBR texture sets procedurally.
 *
 * Why: every surface in the experience needs a real albedo / normal / roughness / AO set, but
 * the room and the glitch world are built from modular geometry we generate ourselves. Baking
 * these maps here keeps the repo self-contained, keeps licensing trivial (they are original
 * CC0 work), and gives us the exact "apartment in 1999" / "corroded control system" look we want.
 *
 * The generator is deterministic (fixed seeds) and seamless (all noise is periodic).
 * Output: public/assets/textures/t_<name>_{albedo,normal,rough,ao}.webp
 *
 * Usage: npm run textures [-- --only wood_floor]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'textures');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- noise ---- */
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407 % 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000000) / 1000000;
}
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);

/** Periodic value noise in [0,1]. `period` is in lattice cells so the tile wraps. */
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const wrap = (v) => ((v % period) + period) % period;
  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

function fbm(u, v, basePeriod, octaves, seed, gain = 0.5, lac = 2) {
  let sum = 0, amp = 1, norm = 0, p = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(u * p, v * p, p, seed + i * 131);
    norm += amp;
    amp *= gain;
    p *= lac;
  }
  return sum / norm;
}

/** Ridge/vein pattern useful for cracks and wood grain. */
function ridged(u, v, p, oct, seed) {
  const n = fbm(u, v, p, oct, seed);
  return 1 - Math.abs(n * 2 - 1);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ------------------------------------------------------------- image IO ---- */
async function writeWebp(name, width, height, rgb, quality = 86) {
  await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), {
    raw: { width, height, channels: 3 },
  }).webp({ quality, effort: 5 }).toFile(path.join(OUT, name));
}

/** Sobel normal map from a height field (values 0..1). Wraps at edges -> seamless. */
function normalFromHeight(h, w, strength) {
  const out = new Uint8Array(w * w * 3);
  const at = (x, y) => h[((y + w) % w) * w + ((x + w) % w)];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 3;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Cheap cavity AO: height compared with a 5-tap blur. */
function aoFromHeight(h, w, amount = 1.6) {
  const out = new Uint8Array(w * w * 3);
  const at = (x, y) => h[((y + w) % w) * w + ((x + w) % w)];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let avg = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) avg += at(x + i, y + j);
      avg /= 25;
      const hh = at(x, y);
      const ao = clamp01(1 - Math.max(0, avg - hh) * amount);
      const v = Math.round(60 + ao * 195);
      const idx = (y * w + x) * 3;
      out[idx] = v; out[idx + 1] = v; out[idx + 2] = v;
    }
  }
  return out;
}

function grain(w, seed, amount) {
  const out = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = (hash2(x, y, seed) - 0.5) * amount;
  return out;
}

/* ------------------------------------------------------------ materials ---- */
/** Every recipe returns { albedo:Uint8Array, height:Float32Array, rough:Float32Array, normalStrength, aoAmount } */
const RECIPES = {
  wood_floor(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 7, 0.055);
    const rows = 5;                   // planks across the V axis -> long boards along U
    for (let y = 0; y < w; y++) {
      const v = y / w;
      const row = Math.floor(v * rows);
      const gv = fract(v * rows);     // 0..1 inside a board
      const endOffset = hash2(row, 1, 91);
      for (let x = 0; x < w; x++) {
        const u = x / w;
        // grain runs along the board; board-local frame keeps the pattern seamless
        const g = fbm(u * 0.75, gv * 0.35 + row * 0.17, 20, 5, 11 + row * 7);
        const vein = ridged(u * 0.5, gv * 0.25 + row * 0.31, 10, 5, 33 + row * 13);
        const tone = 0.62 + hash2(row, 3, 5) * 0.22;
        let r = 0.34 * tone + g * 0.20 + vein * 0.05 + n[y * w + x];
        let gg = 0.22 * tone + g * 0.15 + vein * 0.032 + n[y * w + x];
        let b = 0.13 * tone + g * 0.085 + n[y * w + x];
        // board edges (along U) and staggered end joints
        const edge = Math.min(gv, 1 - gv) < 0.005;
        const ju = fract(u + endOffset);
        const joint = ju < 0.004 || ju > 0.996;
        const gap = edge || joint;
        if (gap) { r *= 0.24; gg *= 0.22; b *= 0.2; }
        const i = y * w + x;
        albedo[i * 3] = clamp01(r) * 255;
        albedo[i * 3 + 1] = clamp01(gg) * 255;
        albedo[i * 3 + 2] = clamp01(b) * 255;
        height[i] = gap ? 0.06 : 0.58 + g * 0.24 + vein * 0.12;
        rough[i] = gap ? 0.6 : 0.3 + g * 0.32 + vein * 0.12;
      }
    }
    return { albedo, height, rough, normalStrength: 3.0, aoAmount: 1.3 };
  },

  wood_dark(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 17, 0.05);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const g = fbm(u, v, 18, 5, 71);
      const vn = ridged(u * 0.4, v, 9, 5, 23);
      const i = y * w + x;
      albedo[i * 3] = clamp01(0.16 + g * 0.12 + vn * 0.03 + n[i]) * 255;
      albedo[i * 3 + 1] = clamp01(0.105 + g * 0.085 + vn * 0.02 + n[i]) * 255;
      albedo[i * 3 + 2] = clamp01(0.065 + g * 0.055 + n[i]) * 255;
      height[i] = 0.55 + g * 0.35 + vn * 0.1;
      rough[i] = 0.42 + g * 0.3;
    }
    return { albedo, height, rough, normalStrength: 2.4, aoAmount: 0.9 };
  },

  plaster(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 27, 0.035);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const blotch = fbm(u, v, 5, 5, 301, 0.55);
      const fine = fbm(u, v, 48, 3, 302);
      const i = y * w + x;
      const base = 0.62 + blotch * 0.15 + fine * 0.05 + n[i];
      albedo[i * 3] = clamp01(base * 1.02) * 255;
      albedo[i * 3 + 1] = clamp01(base * 0.985) * 255;
      albedo[i * 3 + 2] = clamp01(base * 0.93) * 255;
      height[i] = 0.5 + fine * 0.35 + n[i] * 2.2;
      rough[i] = 0.82 + blotch * 0.12 - fine * 0.05;
    }
    return { albedo, height, rough, normalStrength: 1.1, aoAmount: 0.5 };
  },

  concrete(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 37, 0.07);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const cloud = fbm(u, v, 3, 5, 501);
      const pits = fbm(u, v, 90, 2, 502);
      const speck = hash2(x, y, 503) > 0.985 ? 0.18 : 0;
      const crack = Math.pow(ridged(u, v, 6, 5, 504), 26);
      const i = y * w + x;
      let base = 0.44 + (cloud - 0.5) * 0.13 + pits * 0.1 + n[i] + speck;
      base *= 1 - crack * 0.3;
      albedo[i * 3] = clamp01(base * 1.0) * 255;
      albedo[i * 3 + 1] = clamp01(base * 0.99) * 255;
      albedo[i * 3 + 2] = clamp01(base * 0.97) * 255;
      height[i] = 0.55 + pits * 0.45 - crack * 0.6 + n[i] * 1.6;
      rough[i] = 0.8 + (cloud - 0.5) * 0.14;
    }
    return { albedo, height, rough, normalStrength: 2.0, aoAmount: 1.5 };
  },

  concrete_dark(w) {
    const base = RECIPES.concrete(w);
    for (let i = 0; i < w * w * 3; i++) base.albedo[i] = Math.max(0, base.albedo[i] * 0.55);
    for (let i = 0; i < w * w; i++) base.rough[i] = clamp01(base.rough[i] + 0.05);
    return base;
  },

  metal_brushed(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 47, 0.03);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const streak = fbm(u * 0.06, v, 96, 3, 601);
      const smear = fbm(u, v, 8, 3, 602);
      const i = y * w + x;
      const base = 0.42 + streak * 0.16 + smear * 0.05 + n[i];
      albedo[i * 3] = clamp01(base) * 255;
      albedo[i * 3 + 1] = clamp01(base * 1.005) * 255;
      albedo[i * 3 + 2] = clamp01(base * 1.02) * 255;
      height[i] = 0.5 + streak * 0.15 + n[i] * 3;
      rough[i] = 0.24 + streak * 0.22 + smear * 0.12;
    }
    return { albedo, height, rough, normalStrength: 0.8, aoAmount: 0.4 };
  },

  metal_rust(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 57, 0.06);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const patch = fbm(u, v, 6, 6, 701);
      const flake = fbm(u, v, 28, 4, 702);
      const metal = clamp01((patch - 0.52) * 3.2);
      const i = y * w + x;
      const rustCol = [0.34 + flake * 0.28, 0.17 + flake * 0.14, 0.09 + flake * 0.06];
      const metalCol = [0.33 + n[i], 0.33 + n[i], 0.34 + n[i]];
      const c = mix3(rustCol, metalCol, metal);
      albedo[i * 3] = clamp01(c[0]) * 255;
      albedo[i * 3 + 1] = clamp01(c[1]) * 255;
      albedo[i * 3 + 2] = clamp01(c[2]) * 255;
      height[i] = 0.5 + (1 - metal) * flake * 0.5 + n[i] * 2;
      rough[i] = metal > 0.7 ? 0.3 + flake * 0.2 : 0.86;
    }
    return { albedo, height, rough, normalStrength: 2.6, aoAmount: 1.4 };
  },

  fabric(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 67, 0.02);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const weave = Math.sin(u * Math.PI * w / 3) * Math.sin(v * Math.PI * w / 3);
      const slub = fbm(u, v, 24, 4, 801);
      const i = y * w + x;
      const base = 0.13 + slub * 0.09 + weave * 0.015 + n[i];
      albedo[i * 3] = clamp01(base * 1.15) * 255;
      albedo[i * 3 + 1] = clamp01(base * 1.12) * 255;
      albedo[i * 3 + 2] = clamp01(base * 1.22) * 255;
      height[i] = 0.5 + weave * 0.22 + slub * 0.16 + n[i] * 3;
      rough[i] = 0.88 + slub * 0.08;
    }
    return { albedo, height, rough, normalStrength: 1.6, aoAmount: 1.0 };
  },

  carpet(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 77, 0.12);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const fibres = fbm(u, v, 96, 3, 901);
      const stain = fbm(u, v, 5, 4, 902);
      const i = y * w + x;
      const base = 0.17 + fibres * 0.12 + n[i] + stain * 0.03;
      albedo[i * 3] = clamp01(base) * 255;
      albedo[i * 3 + 1] = clamp01(base * 0.98) * 255;
      albedo[i * 3 + 2] = clamp01(base * 1.02) * 255;
      height[i] = 0.4 + fibres * 0.5;
      rough[i] = 0.95;
    }
    return { albedo, height, rough, normalStrength: 1.4, aoAmount: 1.0 };
  },

  paper(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 87, 0.03);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const fibre = fbm(u, v, 40, 4, 1001);
      const age = fbm(u, v, 4, 3, 1002);
      const i = y * w + x;
      const base = 0.82 + fibre * 0.08 + n[i] - age * 0.12;
      albedo[i * 3] = clamp01(base) * 255;
      albedo[i * 3 + 1] = clamp01(base * 0.975) * 255;
      albedo[i * 3 + 2] = clamp01(base * 0.90) * 255;
      height[i] = 0.5 + fibre * 0.3 + n[i] * 2;
      rough[i] = 0.8 + fibre * 0.12;
    }
    return { albedo, height, rough, normalStrength: 0.9, aoAmount: 0.4 };
  },

  asphalt(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 97, 0.14);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const aggregate = fbm(u, v, 80, 3, 1101);
      const patch = fbm(u, v, 6, 4, 1102);
      const crack = Math.pow(ridged(u, v, 5, 4, 1103), 12);
      const i = y * w + x;
      let base = 0.15 + aggregate * 0.13 + n[i] + patch * 0.05 - crack * 0.09;
      albedo[i * 3] = clamp01(base) * 255;
      albedo[i * 3 + 1] = clamp01(base * 1.01) * 255;
      albedo[i * 3 + 2] = clamp01(base * 1.03) * 255;
      height[i] = 0.5 + aggregate * 0.4 + n[i] * 4 - crack * 0.4;
      rough[i] = 0.86 + aggregate * 0.1;
    }
    return { albedo, height, rough, normalStrength: 1.8, aoAmount: 1.2 };
  },

  rubber(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 107, 0.04);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const scuff = fbm(u, v, 16, 3, 1201);
      const i = y * w + x;
      const base = 0.055 + scuff * 0.03 + n[i];
      albedo[i * 3] = clamp01(base) * 255;
      albedo[i * 3 + 1] = clamp01(base) * 255;
      albedo[i * 3 + 2] = clamp01(base * 1.05) * 255;
      height[i] = 0.5 + scuff * 0.2 + n[i] * 2;
      rough[i] = 0.7 + scuff * 0.2;
    }
    return { albedo, height, rough, normalStrength: 1.2, aoAmount: 0.8 };
  },

  tile(w) {
    const albedo = new Uint8Array(w * w * 3);
    const height = new Float32Array(w * w);
    const rough = new Float32Array(w * w);
    const n = grain(w, 117, 0.03);
    const grid = 4;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / w;
      const gu = fract(u * grid), gv = fract(v * grid);
      const edge = Math.min(gu, 1 - gu, gv, 1 - gv) < 0.012;
      const dirt = fbm(u, v, 8, 4, 1301);
      const i = y * w + x;
      const base = edge ? 0.18 : 0.66 + dirt * 0.09 + n[i];
      albedo[i * 3] = clamp01(base * 1.0) * 255;
      albedo[i * 3 + 1] = clamp01(base * 0.99) * 255;
      albedo[i * 3 + 2] = clamp01(base * 0.96) * 255;
      height[i] = edge ? 0.1 : 0.7 + dirt * 0.1;
      rough[i] = edge ? 0.8 : 0.22 + dirt * 0.18;
    }
    return { albedo, height, rough, normalStrength: 3.0, aoAmount: 1.2 };
  },
};

const SIZES = {
  wood_floor: 1024, wood_dark: 512, plaster: 1024, concrete: 1024, concrete_dark: 512,
  metal_brushed: 512, metal_rust: 512, fabric: 512, carpet: 512, paper: 512,
  asphalt: 1024, rubber: 256, tile: 512,
};

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
for (const [name, recipe] of Object.entries(RECIPES)) {
  if (only && only !== name) continue;
  const w = SIZES[name] || 512;
  const t0 = Date.now();
  const r = recipe(w);
  const rough = new Uint8Array(w * w * 3);
  for (let i = 0; i < w * w; i++) {
    const v = Math.round(clamp01(r.rough[i]) * 255);
    rough[i * 3] = v; rough[i * 3 + 1] = v; rough[i * 3 + 2] = v;
  }
  const normal = normalFromHeight(r.height, w, r.normalStrength);
  const ao = aoFromHeight(r.height, w, r.aoAmount);
  await Promise.all([
    writeWebp(`t_${name}_albedo.webp`, w, w, r.albedo),
    writeWebp(`t_${name}_normal.webp`, w, w, normal, 90),
    writeWebp(`t_${name}_rough.webp`, w, w, rough, 88),
    writeWebp(`t_${name}_ao.webp`, w, w, ao, 84),
  ]);
  console.log(`[tex] ${name} ${w}x${w} (${Date.now() - t0} ms)`);
}
console.log('[tex] done ->', path.relative(ROOT, OUT));
