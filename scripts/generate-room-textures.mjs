/**
 * Room surface texture baker (v2).
 *
 * The bedroom GLB ships with a 512px flat-white wall map and a low-res blocky parquet strip,
 * which is why the room reads as untextured. This bakes proper seamless high-res plaster and
 * parquet maps plus matching normal maps with zero external dependencies: periodic value-noise
 * FBM, a hand-rolled PNG writer, sobel-derived normals.
 *
 * Run: node scripts/generate-room-textures.mjs
 * Out: public/textures/room/{wall_plaster,floor_parquet}_{diff,nrm}.png
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures', 'room');
const SIZE = 1024;
const N = SIZE * SIZE;

// ----------------------------------------------------------------------------- noise
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (t) => t * t * (3 - 2 * t);

/** Periodic value noise: lattice wraps every `period` cells, so the result tiles seamlessly. */
function noise(x, y, period, lattice) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const wrap = (n, p) => ((n % p) + p) % p;
  const x0 = wrap(xi, period);
  const y0 = wrap(yi, period);
  const x1 = wrap(xi + 1, period);
  const y1 = wrap(yi + 1, period);
  const a = lattice[y0 * period + x0];
  const b = lattice[y0 * period + x1];
  const c = lattice[y1 * period + x0];
  const d = lattice[y1 * period + x1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Reusable FBM sampler; lattices are built once per octave. */
function makeFbm(basePeriod, octaves, seed) {
  const rng = mulberry32(seed);
  const layers = [];
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const arr = new Float32Array(period * period);
    for (let i = 0; i < arr.length; i++) arr[i] = rng();
    layers.push({ period, arr });
    period *= 2;
  }
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (const l of layers) {
      sum += noise(x * l.period, y * l.period, l.period, l.arr) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

// ----------------------------------------------------------------------------- PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function writePng(path, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

/** 3x3 box blur (wrapping) — smooths height fields before normal derivation. */
function blur(src) {
  const out = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ((y + dy) + SIZE) % SIZE;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = ((x + dx) + SIZE) % SIZE;
          sum += src[yy * SIZE + xx];
        }
      }
      out[y * SIZE + x] = sum / 9;
    }
  }
  return out;
}

function normalFromHeight(height, strength) {
  const out = Buffer.alloc(N * 3);
  const at = (x, y) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 3;
      out[i] = Math.round(clamp01(-dx / len * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(clamp01(-dy / len * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(clamp01(1 / len * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/**
 * Normal maps are box-downsampled 2x. Tiling noise does not compress in PNG, and at 512² a 2.4 m
 * tile still gives ~4.7 mm per texel — far below what the eye resolves on a skirting board, at a
 * quarter of the transfer cost.
 */
function downsample2(rgb, size) {
  const half = size / 2;
  const out = Buffer.alloc(half * half * 3);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      for (let c = 0; c < 3; c++) {
        const i00 = ((y * 2) * size + x * 2) * 3 + c;
        const i10 = ((y * 2) * size + x * 2 + 1) * 3 + c;
        const i01 = ((y * 2 + 1) * size + x * 2) * 3 + c;
        const i11 = ((y * 2 + 1) * size + x * 2 + 1) * 3 + c;
        out[(y * half + x) * 3 + c] = Math.round((rgb[i00] + rgb[i10] + rgb[i01] + rgb[i11]) / 4);
      }
    }
  }
  return out;
}

function finish(name, diff, height, strength) {
  const smoothed = blur(blur(height));
  const bytes = writePng(resolve(OUT, `${name}_diff.png`), diff, SIZE, SIZE);
  const normal = downsample2(normalFromHeight(smoothed, strength), SIZE);
  const nbytes = writePng(resolve(OUT, `${name}_nrm.png`), normal, SIZE / 2, SIZE / 2);
  console.log(`${name}_diff.png ${(bytes / 1024).toFixed(0)} KB   ${name}_nrm.png ${(nbytes / 1024).toFixed(0)} KB`);
}

// ----------------------------------------------------------------------------- wall plaster
/**
 * Painted plaster. Everything here is either periodic noise or an integer-frequency sinusoid,
 * so the tile wraps without a luminance step — no vertical gradients (those belong in the shader,
 * where they can key off world height).
 */
function bakeWall() {
  const diff = Buffer.alloc(N * 3);
  const height = new Float32Array(N);

  const fMottle = makeFbm(4, 5, 101);
  const fRoller = makeFbm(96, 2, 202);
  const fPeel = makeFbm(64, 3, 404);
  const fGrain = makeFbm(200, 2, 505);
  const fWarp = makeFbm(6, 3, 909);
  const fPatch = makeFbm(5, 3, 1212);
  const fStain = makeFbm(3, 5, 303);
  const fDamp = makeFbm(3, 4, 353);
  const fMold = makeFbm(13, 3, 454);
  const fCrackA = makeFbm(9, 4, 606);
  const fCrackB = makeFbm(23, 4, 707);
  const fCrackMask = makeFbm(4, 3, 808);

  const TAU = Math.PI * 2;

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      const mottle = fMottle(u, v);
      const roller = fRoller(u, v);
      const peel = fPeel(u, v);
      const grain = fGrain(u, v);
      const warp = (fWarp(u, v) - 0.5) * 2.0;
      const patch = fPatch(u, v);
      const stain = fStain(u, v);

      // Base: warm bone-white plaster with broad cloudy mottling.
      let base = 0.655 + (mottle - 0.5) * 0.072;

      // Roller stipple + orange-peel micro relief.
      base += (roller - 0.5) * 0.028;
      base += (peel - 0.5) * 0.016;
      base += (grain - 0.5) * 0.008;

      // Roller pass bands: integer frequency in Y so they tile, warped so they are not rulers.
      const bands = Math.sin(TAU * 11 * v + warp * 3.1 + Math.sin(TAU * 3 * u) * 1.4);
      base += bands * 0.008;

      // Patched repairs: newer, slightly brighter, flatter paint over older wall.
      const patchZone = clamp01((patch - 0.60) / 0.10);
      const patchFace = clamp01((patch - 0.63) / 0.05);
      base = mix(base, 0.575 + (roller - 0.5) * 0.010 + bands * 0.003, patchFace);
      // A faint ridge where the repair was feathered out.
      const patchLip = clamp01(1 - Math.abs(patchZone - 0.45) / 0.12) * 0.35;
      base *= 1.0 - patchLip * 0.05;

      // Damp bloom + mold colonies.
      const damp = clamp01((fDamp(u, v) - 0.55) / 0.22);
      base = mix(base, base * 0.76, damp * 0.9);
      const moldZone = clamp01((fDamp(u, v) - 0.585) / 0.14);
      const mold = clamp01((fMold(u, v) - 0.615) / 0.13) * moldZone;
      base *= 1.0 - mold * 0.58;

      // Water damage: brown bloom with a darker tide line at its rim.
      const bloom = clamp01((stain - 0.545) / 0.15);
      const tide = clamp01((stain - 0.505) / 0.04) * (1 - bloom);
      base *= 1.0 - bloom * 0.20;
      base *= 1.0 - tide * 0.10;

      // Hairline cracks: ridged noise, masked into patches, with a light spalled lip.
      const ridA = 1 - Math.abs(2 * fCrackA(u, v) - 1);
      const ridB = 1 - Math.abs(2 * fCrackB(u, v) - 1);
      const crackMask = clamp01((fCrackMask(u, v) - 0.42) / 0.30);
      const cA = clamp01((ridA - 0.9905) / 0.0095) * crackMask;
      const cB = clamp01((ridB - 0.9935) / 0.0065) * crackMask * 0.8;
      const crack = clamp01(cA + cB);
      const lip = clamp01((ridA - 0.982) / 0.0085) * (1 - crack) * crackMask;
      base *= 1.0 - crack * 0.44;
      base += lip * 0.016;

      // Faint wallpaper join down the tile centre.
      const seam = Math.exp(-Math.pow((u - 0.5) * SIZE / 1.5, 2));
      base *= 1.0 - seam * 0.045;

      diff[i * 3] = Math.round(clamp01(base * 1.030 + mold * 0.003) * 255);
      diff[i * 3 + 1] = Math.round(clamp01(base * 0.995) * 255);
      diff[i * 3 + 2] = Math.round(clamp01(base * 0.930 + mold * 0.005) * 255);

      height[i] =
        (mottle - 0.5) * 0.16 +
        (roller - 0.5) * 0.10 +
        (peel - 0.5) * 0.42 +
        (grain - 0.5) * 0.05 +
        bands * 0.02 -
        patchLip * 0.12 -
        crack * 0.62 +
        lip * 0.12 -
        bloom * 0.02;
    }
  }
  return { diff, height };
}

// ----------------------------------------------------------------------------- parquet floor
function bakeFloor() {
  const diff = Buffer.alloc(N * 3);
  const height = new Float32Array(N);
  const grainField = new Float32Array(N);
  const fGrainWarp = makeFbm(5, 4, 909);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) grainField[y * SIZE + x] = fGrainWarp(x / SIZE, y / SIZE);
  }
  const fDust = makeFbm(48, 3, 1313);
  const fPolish = makeFbm(7, 3, 1717);

  const COLS = 11;
  const plankW = SIZE / COLS;
  const rng = mulberry32(0x5eed1234);

  // Per-column plank spans that exactly tile [0, SIZE) so joints never wrap badly.
  const columns = [];
  for (let c = 0; c < COLS; c++) {
    const count = 2 + Math.floor(rng() * 2);
    const weights = [];
    for (let k = 0; k < count; k++) weights.push(0.8 + rng() * 0.45);
    const total = weights.reduce((a, b) => a + b, 0);
    const lengths = weights.map((w) => Math.max(48, Math.round((w / total) * SIZE)));
    // Force the row of planks to close exactly on the tile boundary.
    const drift = lengths.reduce((a, b) => a + b, 0) - SIZE;
    lengths[lengths.length - 1] -= drift;
    const ends = [];
    let acc = 0;
    for (const len of lengths) ends.push((acc += len));
    const spans = [];
    for (let k = 0; k < count; k++) {
      spans.push({
        len: lengths[k],
        tint: 0.94 + rng() * 0.12,
        warm: rng(),
        knotU: 0.2 + rng() * 0.6,
        knotV: 0.18 + rng() * 0.64,
        knotR: 0.03 + rng() * 0.05,
        hasKnot: rng() > 0.4,
      });
      acc = 0;
    }
    columns.push({ spans, ends, top: Math.floor(rng() * SIZE), tint: 0.96 + rng() * 0.09, warm: rng() });
  }

  const findSpan = (column, y) => {
    const local = ((y - column.top) % SIZE + SIZE) % SIZE;
    const ends = column.ends;
    let k = 0;
    while (k < ends.length - 1 && local >= ends[k]) k++;
    const start = k === 0 ? 0 : ends[k - 1];
    return { span: column.spans[k], local: local - start };
  };

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;
      const colIdx = Math.min(COLS - 1, Math.floor(x / plankW));
      const column = columns[colIdx];
      const lx = (x - colIdx * plankW) / plankW;
      const { span, local } = findSpan(column, y);
      const ly = local / span.len;

      const warp = (grainField[i] - 0.5) * 2.0;
      const polish = fPolish(u, v);

      // Fine fibres running the length of the plank; warp bends them slowly along Y.
      const fibre = Math.sin((lx * 150 + warp * 9 + ly * 3.0) * Math.PI) * 0.5 + 0.5;
      const fibre2 = Math.sin((lx * 61 + warp * 4 + ly * 1.1) * Math.PI) * 0.5 + 0.5;
      // Soft cathedral figure: wide arcs that flare toward one side.
      const figure = Math.pow(Math.abs(Math.sin((lx * 2.6 + ly * 0.25 + warp * 0.5) * Math.PI)), 3.0);

      let base = 0.345 * span.tint * column.tint;
      base += fibre * 0.026 + fibre2 * 0.017;
      base *= 1.0 - figure * 0.10;
      // Warmth: some planks lean red, others lean ash-grey.
      const warm = span.warm * 0.6 + column.warm * 0.4;

      if (span.hasKnot) {
        const kdx = (lx - span.knotU) * 3.4;
        const kdy = ly - span.knotV;
        const kd = Math.hypot(kdx, kdy);
        if (kd < span.knotR) {
          const t = kd / span.knotR;
          const ring = Math.sin(kd * 260) * 0.5 + 0.5;
          base *= 1.0 - (1 - t) * (0.45 + ring * 0.3);
        } else if (kd < span.knotR * 2.4) {
          // Grain sweeps around the knot.
          const sweep = clamp01((span.knotR * 2.4 - kd) / (span.knotR * 1.4));
          base *= 1.0 - sweep * 0.06 * (Math.sin(kd * 120) * 0.5 + 0.5);
        }
      }

      // Foot-traffic polish in the middle of each plank, grime at the joints.
      const edgeL = Math.min(lx, 1 - lx) * plankW;
      const edgeV = Math.min(local, span.len - local);
      const edge = Math.min(edgeL, edgeV);
      const groove = clamp01((2.2 - edge) / 2.2);
      const lip = clamp01((5.5 - edge) / 3.0) * (1 - groove);
      base *= 1.0 - groove * 0.58;
      base += lip * 0.045;
      base *= 1.0 + (polish - 0.5) * 0.10 - clamp01(edge / 22) * 0.03;
      base *= 1.0 + (fDust(u, v) - 0.5) * 0.035;

      diff[i * 3] = Math.round(clamp01(base * (1.0 + warm * 0.16) + 0.010) * 255);
      diff[i * 3 + 1] = Math.round(clamp01(base * 0.96 + 0.006) * 255);
      diff[i * 3 + 2] = Math.round(clamp01(base * (0.80 - warm * 0.06)) * 255);

      height[i] = 0.5 + fibre * 0.20 + fibre2 * 0.06 - groove * 0.95 + lip * 0.25;
    }
  }
  return { diff, height };
}

// ----------------------------------------------------------------------------- woven rug
/**
 * Hand-knotted wool rug. The GLB's own rug map is 606 bytes of flat colour, and because the rug
 * covers most of the floor it was single-handedly hiding the parquet. This bakes a real rug:
 * a stepped border, a field of small geometric medallions, a central lozenge, abrash (dye-lot
 * banding), pile weave and foot-traffic wear. It maps 1:1 across the mesh, so it is authored as
 * a complete design rather than a tile.
 */
function bakeRug() {
  const diff = Buffer.alloc(N * 3);
  const height = new Float32Array(N);
  const fWarp = makeFbm(6, 3, 4242);
  const fWear = makeFbm(3, 4, 5151);
  const fDust = makeFbm(96, 2, 6262);
  const fAbrash = makeFbm(2, 3, 7373);

  // Stepped lozenge / "gul" motif: returns 0..1 coverage for a diamond with stair-stepped sides.
  const gul = (dx, dy, r) => {
    const d = Math.abs(dx) + Math.abs(dy);
    if (d > r) return 0;
    const step = Math.floor(d / (r * 0.17)) % 2 === 0 ? 1 : 0.55;
    return step * (1 - Math.pow(d / r, 2.4));
  };

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // ---- weave: two thread systems crossing, with twill alternation
      const warpThread = Math.pow(Math.abs(Math.sin(u * 330 * Math.PI * 0.5)), 0.55);
      const weftThread = Math.pow(Math.abs(Math.sin(v * 330 * Math.PI * 0.5)), 0.55);
      const twill = Math.sin((u * 240 + v * 240) * Math.PI) > 0 ? 1 : 0;
      const thread = twill ? warpThread * 0.7 + weftThread * 0.3 : weftThread * 0.7 + warpThread * 0.3;
      const knot = 0.82 + thread * 0.38;

      // ---- palette (linear-ish sRGB values, deliberately desaturated for a cold room)
      const fieldC = [0.083, 0.096, 0.150];
      const accentC = [0.290, 0.132, 0.126];
      const sandC = [0.255, 0.235, 0.196];
      const borderC = [0.140, 0.100, 0.135];

      // ---- geometry of the design
      const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
      let col = fieldC.slice();
      let motifMask = 0;

      // Field medallions on an 6x5 grid inside the border.
      const fx = (u - 0.16) / 0.68;
      const fy = (v - 0.16) / 0.68;
      if (fx > 0 && fx < 1 && fy > 0 && fy < 1) {
        const gx = fx * 6;
        const gy = fy * 5;
        const cx = gx - Math.floor(gx) - 0.5;
        const cy = gy - Math.floor(gy) - 0.5;
        const alt = (Math.floor(gx) + Math.floor(gy)) % 2;
        const g = gul(cx, cy, alt === 0 ? 0.40 : 0.28);
        motifMask = g;
        if (g > 0.02) {
          const hot = alt === 0 ? accentC : sandC;
          col = [
            col[0] + (hot[0] - col[0]) * g * 0.85,
            col[1] + (hot[1] - col[1]) * g * 0.85,
            col[2] + (hot[2] - col[2]) * g * 0.85,
          ];
        }
      }

      // Central medallion, larger and with a pale core.
      const mdx = (u - 0.5) * 1.0;
      const mdy = (v - 0.5) * 1.0;
      const med = gul(mdx, mdy, 0.255);
      if (med > 0.02) {
        const core = gul(mdx, mdy, 0.095);
        col = [
          col[0] + (accentC[0] * 1.15 - col[0]) * med * 0.9,
          col[1] + (accentC[1] * 1.10 - col[1]) * med * 0.9,
          col[2] + (accentC[2] * 1.15 - col[2]) * med * 0.9,
        ];
        col = [
          col[0] + (sandC[0] * 1.2 - col[0]) * core * 0.9,
          col[1] + (sandC[1] * 1.2 - col[1]) * core * 0.9,
          col[2] + (sandC[2] * 1.2 - col[2]) * core * 0.9,
        ];
        motifMask = Math.max(motifMask, med);
      }

      // ---- border: three bands, the middle one carrying a repeating stepped cross.
      if (edge < 0.135) {
        const band = edge < 0.030 ? 0 : edge < 0.115 ? 1 : 2;
        if (band === 0) {
          col = [0.035, 0.038, 0.058];
        } else if (band === 1) {
          // One consistent motif rhythm around the whole perimeter.
          const verticalSide = u < 0.135 || u > 0.865;
          const along = verticalSide ? v : u;
          const across = verticalSide ? u : v;
          const s = Math.abs(Math.sin(along * 108 * Math.PI));
          const t = Math.abs(Math.sin(across * 108 * Math.PI));
          const cross = (s > 0.74 ? 1 : 0) * (t > 0.12 ? 1 : 0.3);
          const base = [0.098, 0.068, 0.094];
          col = [
            base[0] + cross * 0.10,
            base[1] + cross * 0.05,
            base[2] + cross * 0.05,
          ];
        } else {
          col = [0.052, 0.056, 0.082];
        }
        motifMask = Math.max(motifMask, band === 1 ? 0.6 : 0.25);
      }

      // ---- abrash banding + wear + dust
      const abrash = (fAbrash(u, v) - 0.5) * 0.10;
      const wear = clamp01((fWear(u, v) - 0.46) / 0.32);
      const dust = (fDust(u, v) - 0.5) * 0.05;

      // Pile height: motifs are knotted slightly higher than the ground.
      const pile = 0.55 + thread * 0.45 + motifMask * 0.35;

      const lift = 0.88 + thread * 0.34 + abrash + wear * 0.22 + dust * 0.5;
      diff[i * 3] = Math.round(clamp01(col[0] * lift * 1.04) * 255);
      diff[i * 3 + 1] = Math.round(clamp01(col[1] * lift * 1.0) * 255);
      diff[i * 3 + 2] = Math.round(clamp01(col[2] * lift * 1.10) * 255);

      height[i] = pile - wear * 0.35 + (fDust(u, v) - 0.5) * 0.12;
    }
  }
  return { diff, height };
}

mkdirSync(OUT, { recursive: true });
const wall = bakeWall();
finish('wall_plaster', wall.diff, wall.height, 9);
const floor = bakeFloor();
finish('floor_parquet', floor.diff, floor.height, 15);
const rug = bakeRug();
finish('rug_wool', rug.diff, rug.height, 34);
