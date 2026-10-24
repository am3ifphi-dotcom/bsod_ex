// Procedural PBR texture library (albedo / normal / roughness).
// Everything is generated at runtime from noise, so the repository only ships
// code — no texture files.  Textures are cached by key.
import * as THREE from 'three';
import { RNG, canvasTexture, fbm, makeCanvas, normalFromHeight, noiseFill, ridged } from './utils';

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
}

const cache = new Map<string, PBRSet>();
const normCache = new Map<string, THREE.Texture>();

function gray(c: HTMLCanvasElement, srgb = false) {
  return canvasTexture(c, { srgb });
}

/** height canvas -> cached normal texture */
function normals(key: string, src: HTMLCanvasElement, strength = 2.0) {
  const hit = normCache.get(key);
  if (hit) return hit;
  const t = canvasTexture(normalFromHeight(src, strength), { srgb: false });
  normCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ wood
export function woodFloor(): PBRSet {
  const hit = cache.get('woodFloor');
  if (hit) return hit;
  const S = 1024;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#5a5a5a'; rctx.fillRect(0, 0, S, S);
  const rng = new RNG(77);
  const plankH = S / 8;
  for (let row = 0; row < 8; row++) {
    // stagger planks, 2 per row
    const split = rng.range(0.3, 0.7) * S;
    for (const [x0, x1] of [[0, split], [split, S]] as const) {
      const base = 58 + rng.range(-12, 16);
      ctx.fillStyle = `rgb(${base + 18},${base - 2},${base - 22})`;
      ctx.fillRect(x0, row * plankH, x1 - x0, plankH);
      // grain
      for (let g = 0; g < 90; g++) {
        const y = row * plankH + rng.range(2, plankH - 2);
        ctx.strokeStyle = `rgba(${base - 30},${base - 42},${base - 52},${rng.range(0.04, 0.16)})`;
        ctx.lineWidth = rng.range(0.6, 2.2);
        ctx.beginPath();
        let y2 = y;
        for (let x = x0; x < x1; x += 24) {
          y2 = y + Math.sin((x / x1) * 8 + g) * rng.range(0.4, 2.4);
          ctx.lineTo(x, y2);
        }
        ctx.stroke();
      }
      // knots
      if (rng.next() < 0.5) {
        const kx = rng.range(x0 + 30, x1 - 30), ky = row * plankH + rng.range(10, plankH - 10);
        for (let k = 0; k < 16; k++) {
          ctx.strokeStyle = `rgba(${base - 40},${base - 50},${base - 60},0.14)`;
          ctx.beginPath();
          ctx.ellipse(kx, ky, 3 + k * 1.5, 1.6 + k * 0.7, rng.range(0, 3), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // bevel highlight/shadow
      const grad = ctx.createLinearGradient(0, row * plankH, 0, (row + 1) * plankH);
      grad.addColorStop(0, 'rgba(255,235,210,0.06)');
      grad.addColorStop(0.06, 'rgba(0,0,0,0.0)');
      grad.addColorStop(0.94, 'rgba(0,0,0,0.12)');
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, row * plankH, x1 - x0, plankH);
      // height
      hctx.fillStyle = `rgb(${200},${200},${200})`;
      hctx.fillRect(x0 + 1, row * plankH + 1, x1 - x0 - 2, plankH - 2);
      hctx.fillStyle = '#5a5a5a';
      hctx.fillRect(x0, row * plankH, x1 - x0, 1.5);
      hctx.fillRect(x0, (row + 1) * plankH - 1.5, x1 - x0, 1.5);
      // roughness: varnish sheen with worn patches
      const rv = 70 + rng.range(-15, 20);
      rctx.fillStyle = `rgb(${rv},${rv},${rv})`;
      rctx.fillRect(x0, row * plankH, x1 - x0, plankH);
      for (let p = 0; p < 40; p++) {
        const px = rng.range(x0, x1), py = rng.range(row * plankH, (row + 1) * plankH);
        rctx.fillStyle = `rgba(150,150,150,${rng.range(0.03, 0.12)})`;
        rctx.beginPath();
        rctx.ellipse(px, py, rng.range(4, 40), rng.range(2, 12), rng.range(0, 3), 0, 7);
        rctx.fill();
      }
    }
  }
  noiseFill(ctx, S, S, 'rgba(0,0,0,0)', 0.12, 90);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [3, 3], aniso: 8 }),
    normalMap: normals('woodFloorN', hc, 1.6),
    roughnessMap: gray(rc),
  };
  set.normalMap.repeat.set(3, 3);
  set.roughnessMap.repeat.set(3, 3);
  cache.set('woodFloor', set);
  return set;
}

export function woodDesk(tint = '#4a3524'): PBRSet {
  const key = 'woodDesk' + tint;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  noiseFill(ctx, S, S, tint, 0.22, 8);
  const rng = new RNG(313);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(${20 + rng.range(0, 40)},${14 + rng.range(0, 26)},${8 + rng.range(0, 16)},${rng.range(0.05, 0.2)})`;
    ctx.lineWidth = rng.range(0.5, 2.4);
    ctx.beginPath();
    const y = rng.range(0, S);
    let yy = y;
    for (let x = 0; x <= S; x += 16) {
      yy = y + Math.sin(x * 0.02 + i) * rng.range(0.5, 3.5);
      ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#3c3c3c'; rctx.fillRect(0, 0, S, S);
  noiseFill(rctx, S, S, 'rgba(0,0,0,0)', 0.35, 20);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [1, 1] }),
    normalMap: normals(key + 'N', hc, 0.8),
    roughnessMap: gray(rc),
  };
  cache.set(key, set);
  return set;
}

// ---------------------------------------------------------------- plaster
export function plaster(color = '#cdc6bb'): PBRSet {
  const key = 'plaster' + color;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  noiseFill(ctx, S, S, color, 0.16, 14);
  noiseFill(ctx, S, S, 'rgba(0,0,0,0)', 0.1, 60);
  const rng = new RNG(9);
  // subtle scuffs + water stains
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(20, 110);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(120,110,95,${rng.range(0.02, 0.07)})`);
    g.addColorStop(1, 'rgba(120,110,95,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  noiseFill(hctx, S, S, 'rgba(0,0,0,0)', 0.5, 40);
  rctx.fillStyle = '#e8e8e8'; rctx.fillRect(0, 0, S, S);
  noiseFill(rctx, S, S, 'rgba(0,0,0,0)', 0.25, 30);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [2, 2] }),
    normalMap: normals(key + 'N', hc, 0.55),
    roughnessMap: gray(rc),
  };
  set.normalMap.repeat.set(2, 2);
  set.roughnessMap.repeat.set(2, 2);
  cache.set(key, set);
  return set;
}

// --------------------------------------------------------------- concrete
export function concrete(dark = false): PBRSet {
  const key = 'concrete' + (dark ? 'd' : '');
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  const base = dark ? '#3a4257' : '#8c93a3';
  noiseFill(ctx, S, S, base, 0.3, 10);
  noiseFill(ctx, S, S, 'rgba(0,0,0,0)', 0.25, 55);
  const rng = new RNG(451);
  // aggregate speckles
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(0.4, 1.8);
    ctx.fillStyle = `rgba(${rng.range(30, 220)},${rng.range(30, 220)},${rng.range(40, 230)},${rng.range(0.03, 0.14)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // cracks
  for (let i = 0; i < 9; i++) {
    let x = rng.range(0, S), y = rng.range(0, S);
    ctx.strokeStyle = `rgba(20,24,34,${rng.range(0.15, 0.4)})`;
    ctx.lineWidth = rng.range(0.6, 1.8);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 26; k++) {
      x += rng.range(-16, 16); y += rng.range(-16, 16);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  noiseFill(hctx, S, S, 'rgba(0,0,0,0)', 0.55, 24);
  rctx.fillStyle = dark ? '#c8c8c8' : '#d2d2d2'; rctx.fillRect(0, 0, S, S);
  noiseFill(rctx, S, S, 'rgba(0,0,0,0)', 0.3, 18);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [4, 4] }),
    normalMap: normals(key + 'N', hc, 1.2),
    roughnessMap: gray(rc),
  };
  set.normalMap.repeat.set(4, 4);
  set.roughnessMap.repeat.set(4, 4);
  cache.set(key, set);
  return set;
}

// ------------------------------------------------------------------- sand
export function sand(): PBRSet {
  const hit = cache.get('sand');
  if (hit) return hit;
  const S = 512;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  noiseFill(ctx, S, S, '#2a3550', 0.35, 6);
  noiseFill(ctx, S, S, 'rgba(0,0,0,0)', 0.2, 48);
  const rng = new RNG(1201);
  for (let i = 0; i < 7000; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    ctx.fillStyle = `rgba(${rng.range(40, 130)},${rng.range(70, 160)},${rng.range(120, 240)},${rng.range(0.02, 0.1)})`;
    ctx.fillRect(x, y, rng.range(0.5, 1.6), rng.range(0.5, 1.6));
  }
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  noiseFill(hctx, S, S, 'rgba(0,0,0,0)', 0.7, 70);
  rctx.fillStyle = '#f0f0f0'; rctx.fillRect(0, 0, S, S);
  noiseFill(rctx, S, S, 'rgba(0,0,0,0)', 0.18, 90);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [26, 26] }),
    normalMap: normals('sandN', hc, 1.1),
    roughnessMap: gray(rc),
  };
  set.normalMap.repeat.set(26, 26);
  set.roughnessMap.repeat.set(26, 26);
  cache.set('sand', set);
  return set;
}

// ----------------------------------------------------------------- fabric
export function fabric(color = '#2b3550'): PBRSet {
  const key = 'fabric' + color;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  noiseFill(ctx, S, S, color, 0.2, 40);
  const rng = new RNG(88);
  // weave
  for (let y = 0; y < S; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.01, 0.05)})`;
    ctx.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 3) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.02, 0.07)})`;
    ctx.fillRect(x, 0, 1, S);
  }
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    hctx.fillStyle = y % 4 === 0 ? '#a0a0a0' : '#606060';
    hctx.fillRect(0, y, S, 1);
  }
  rctx.fillStyle = '#dcdcdc'; rctx.fillRect(0, 0, S, S);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [3, 3] }),
    normalMap: normals(key + 'N', hc, 1.4),
    roughnessMap: gray(rc),
  };
  set.normalMap.repeat.set(3, 3);
  set.roughnessMap.repeat.set(3, 3);
  cache.set(key, set);
  return set;
}

// ------------------------------------------------------------------ metal
export function metal(base = '#6a7282'): PBRSet {
  const key = 'metal' + base;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const { c, ctx } = makeCanvas(S, S);
  const { c: rc, ctx: rctx } = makeCanvas(S, S);
  const rng = new RNG(5150);
  noiseFill(ctx, S, S, base, 0.18, 30);
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    ctx.strokeStyle = `rgba(${rng.range(180, 255)},${rng.range(180, 255)},${rng.range(190, 255)},${rng.range(0.02, 0.1)})`;
    ctx.lineWidth = rng.range(0.4, 1.1);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-14, 14), y + rng.range(-3, 3)); ctx.stroke();
  }
  rctx.fillStyle = '#6a6a6a'; rctx.fillRect(0, 0, S, S);
  noiseFill(rctx, S, S, 'rgba(0,0,0,0)', 0.4, 26);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [1, 1] }),
    normalMap: normals(key + 'N', c, 0.35),
    roughnessMap: gray(rc),
  };
  cache.set(key, set);
  return set;
}

// -------------------------------------------------------------------- rug
export function rug(): PBRSet {
  const hit = cache.get('rug');
  if (hit) return hit;
  const S = 512;
  const { c, ctx } = makeCanvas(S, S);
  const { c: hc, ctx: hctx } = makeCanvas(S, S);
  noiseFill(ctx, S, S, '#232c44', 0.3, 20);
  const rng = new RNG(606);
  // geometric border pattern
  ctx.strokeStyle = 'rgba(140,170,220,0.22)';
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 2 + i;
    ctx.strokeRect(18 + i * 9, 18 + i * 9, S - 36 - i * 18, S - 36 - i * 18);
  }
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(${rng.range(40, 110)},${rng.range(60, 140)},${rng.range(100, 210)},${rng.range(0.02, 0.09)})`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(2, 40), rng.range(1, 3));
  }
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  noiseFill(hctx, S, S, 'rgba(0,0,0,0)', 0.6, 120);
  const set: PBRSet = {
    map: canvasTexture(c, { repeat: [1, 1] }),
    normalMap: normals('rugN', hc, 1.6),
    roughnessMap: gray(hc),
  };
  cache.set('rug', set);
  return set;
}

// --------------------------------------------------------- window skyline
export function citySkyline(): THREE.Texture {
  const hit = cache.get('skyline');
  if (hit) return hit.map;
  const W = 2048, H = 512;
  const { c, ctx } = makeCanvas(W, H);
  const rng = new RNG(2024);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#05080f');
  g.addColorStop(0.55, '#0a1222');
  g.addColorStop(1, '#131c30');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // distant buildings
  for (let layer = 0; layer < 3; layer++) {
    const alpha = 0.55 + layer * 0.18;
    let x = -40;
    while (x < W + 40) {
      const w = rng.range(30, 110);
      const h = rng.range(40, 200 + layer * 60);
      ctx.fillStyle = `rgba(${8 + layer * 4},${12 + layer * 6},${24 + layer * 8},${alpha})`;
      ctx.fillRect(x, H - h, w, h);
      // windows
      for (let wy = H - h + 8; wy < H - 6; wy += 9) {
        for (let wx = x + 5; wx < x + w - 5; wx += 8) {
          if (rng.next() < 0.16) {
            const warm = rng.next() < 0.6;
            ctx.fillStyle = warm
              ? `rgba(255,${180 + rng.range(0, 50)},${110 + rng.range(0, 60)},${rng.range(0.15, 0.6)})`
              : `rgba(${120 + rng.range(0, 80)},${180 + rng.range(0, 60)},255,${rng.range(0.1, 0.4)})`;
            ctx.fillRect(wx, wy, rng.range(2, 5), rng.range(2, 5));
          }
        }
      }
      x += w + rng.range(2, 16);
    }
  }
  // haze
  const hz = ctx.createLinearGradient(0, H * 0.5, 0, H);
  hz.addColorStop(0, 'rgba(20,40,80,0)');
  hz.addColorStop(1, 'rgba(30,50,90,0.5)');
  ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
  const t = canvasTexture(c, { repeat: [1, 1], wrap: THREE.ClampToEdgeWrapping });
  cache.set('skyline', { map: t, normalMap: t, roughnessMap: t });
  return t;
}

/** small emissive texture for PC front LEDs / rgbs */
export function ledStrip(): THREE.Texture {
  const W = 64, H = 8;
  const { c, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#1e5cff');
  g.addColorStop(0.5, '#7fd7ff');
  g.addColorStop(1, '#1e5cff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return canvasTexture(c, { repeat: [1, 1] });
}

export function disposeTextureCache() {
  cache.forEach((s) => { s.map.dispose(); s.normalMap.dispose(); s.roughnessMap.dispose(); });
  normCache.forEach((t) => t.dispose());
  cache.clear(); normCache.clear();
}

export { ridged, fbm };
