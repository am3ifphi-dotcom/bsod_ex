/**
 * プロシージャル・テクスチャ工場
 * -------------------------------------------------------------
 * 画像アセットを一切使わず、Canvas 2D で「古い教室」の素材を描く。
 * 色マップに加えて、同じ描画から法線マップ / 粗さマップも生成する。
 */
import * as THREE from 'three';

/* ---------------- ユーティリティ ---------------- */

/** 再現性のある乱数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h || w;
  return c;
}

const registry = [];

/** Canvas -> THREE.CanvasTexture */
export function toTexture(canvas, { repeat = [1, 1], srgb = true, seed = 0 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.userData.seed = seed;
  registry.push(t);
  return t;
}

/** レンダラ確定後に異方性フィルタを最大値へ */
export function applyAnisotropy(max) {
  for (const t of registry) t.anisotropy = Math.min(max, 16);
}

/** 明度から法線マップを復元（ソーベル風） */
export function normalFromCanvas(src, strength = 2.2) {
  const w = src.width;
  const h = src.height;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const s = sctx.getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const lum = (x, y) => {
    x = (x + w) % w;
    y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
      const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      d[i] = ((dx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** ざらつきノイズを重ねる */
function grain(ctx, w, h, amount, alpha, rnd) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] = alpha == null ? d[i + 3] : alpha;
  }
  ctx.putImageData(img, 0, 0);
}

/** 大きなシミ・ムラ */
function blotches(ctx, w, h, count, color, rMin, rMax, alpha, rnd) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rMin + rnd() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------- 木材 ---------------- */

/**
 * 板材テクスチャ。planks = 1枚のテクスチャに入る板の数。
 * @returns {{map, normalMap, roughnessMap}}
 */
export function woodMaterialTextures({
  size = 1024,
  planks = 8,
  base = [0x8a, 0x63, 0x3c],
  variance = 26,
  grainStrength = 0.5,
  knots = 5,
  scuffs = 26,
  seamDark = 0.42,
  seed = 1,
  horizontal = true,
} = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rough = makeCanvas(size);
  const rctx = rough.getContext('2d');

  const bw = horizontal ? size : size / planks;
  const bh = horizontal ? size / planks : size;

  for (let p = 0; p < planks; p++) {
    const x0 = horizontal ? 0 : p * bw;
    const y0 = horizontal ? p * bh : 0;
    const v = (rnd() - 0.5) * variance * 2;
    const r = Math.max(0, Math.min(255, base[0] + v));
    const g = Math.max(0, Math.min(255, base[1] + v * 0.92));
    const b = Math.max(0, Math.min(255, base[2] + v * 0.7));

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, horizontal ? size : bw, horizontal ? bh : size);
    ctx.clip();
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x0, y0, size, size);

    // 木目
    const lines = horizontal ? 90 : 90;
    for (let i = 0; i < lines; i++) {
      const t = rnd();
      const amp = 1.5 + rnd() * 7;
      const dark = rnd() < grainStrength;
      ctx.strokeStyle = dark
        ? `rgba(${(r * 0.62) | 0},${(g * 0.58) | 0},${(b * 0.5) | 0},${0.1 + rnd() * 0.22})`
        : `rgba(${Math.min(255, r * 1.22) | 0},${Math.min(255, g * 1.2) | 0},${
            Math.min(255, b * 1.14) | 0
          },${0.05 + rnd() * 0.14})`;
      ctx.lineWidth = 0.5 + rnd() * 1.8;
      ctx.beginPath();
      if (horizontal) {
        const yy = y0 + t * bh;
        ctx.moveTo(0, yy);
        for (let s = 0; s <= 6; s++) {
          const sx = (size / 6) * s;
          ctx.lineTo(sx, yy + Math.sin(s * 1.7 + t * 9) * amp * 0.35);
        }
      } else {
        const xx = x0 + t * bw;
        ctx.moveTo(xx, 0);
        for (let s = 0; s <= 6; s++) {
          const sy = (size / 6) * s;
          ctx.lineTo(xx + Math.sin(s * 1.7 + t * 9) * amp * 0.35, sy);
        }
      }
      ctx.stroke();
    }

    // 節
    const kk = horizontal ? knots : 2;
    for (let i = 0; i < kk; i++) {
      if (rnd() < 0.45) continue;
      const kx = horizontal ? rnd() * size : x0 + bw * (0.25 + rnd() * 0.5);
      const ky = horizontal ? y0 + bh * (0.2 + rnd() * 0.6) : rnd() * size;
      const kr = 3 + rnd() * 9;
      for (let ring = 4; ring >= 0; ring--) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * (1 + ring * 0.42), kr * (0.7 + ring * 0.3), rnd() * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${(r * 0.48) | 0},${(g * 0.42) | 0},${(b * 0.36) | 0},${
          0.3 - ring * 0.045
        })`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr * 0.5, kr * 0.36, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${(r * 0.36) | 0},${(g * 0.3) | 0},${(b * 0.26) | 0},0.75)`;
      ctx.fill();
    }

    // 磨耗・傷
    for (let i = 0; i < scuffs; i++) {
      const sx = rnd() * size;
      const sy = horizontal ? y0 + rnd() * bh : rnd() * size;
      const len = 6 + rnd() * 70;
      ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '255,246,226' : '40,26,14'},${0.03 + rnd() * 0.1})`;
      ctx.lineWidth = 0.6 + rnd() * 2.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + len, sy + (rnd() - 0.5) * 6);
      ctx.stroke();
    }
    ctx.restore();

    // 板の継ぎ目
    ctx.fillStyle = `rgba(28,18,10,${seamDark})`;
    if (horizontal) ctx.fillRect(0, y0, size, Math.max(1.4, size / 340));
    else ctx.fillRect(x0, 0, Math.max(1.4, size / 340), size);

    // 継ぎ目ハイライト（面取り）
    ctx.fillStyle = `rgba(255,236,200,0.07)`;
    if (horizontal) ctx.fillRect(0, y0 + 1.6, size, 1.2);
    else ctx.fillRect(x0 + 1.6, 0, 1.2, size);

    // 粗さマップ用（継ぎ目と節は少し粗く）
    rctx.fillStyle = `rgb(${150 + ((rnd() - 0.5) * 26) | 0},${150 + ((rnd() - 0.5) * 26) | 0},${
      150 + ((rnd() - 0.5) * 26) | 0
    })`;
    rctx.fillRect(x0, y0, horizontal ? size : bw, horizontal ? bh : size);
  }

  // 全体のムラ（日焼け・汚れ）
  blotches(ctx, size, size, 26, 'rgba(58,38,18,0.5)', size * 0.05, size * 0.3, 0.16, rnd);
  blotches(ctx, size, size, 14, 'rgba(255,232,190,0.4)', size * 0.06, size * 0.26, 0.1, rnd);
  grain(ctx, size, size, 16, null, rnd);

  const rc = rough;
  grain(rctx, size, size, 34, null, rnd);

  return {
    map: toTexture(c, { seed }),
    normalMap: toTexture(normalFromCanvas(c, 2.6), { srgb: false, seed }),
    roughnessMap: toTexture(rc, { srgb: false, seed }),
  };
}

/* ---------------- 壁（モルタル / 塗装） ---------------- */

export function plasterTextures({ size = 768, base = '#e6dcc2', seed = 7, stains = true } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // コテ跡
  for (let i = 0; i < 240; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 8 + rnd() * 60;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.25 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,252,240' : '150,138,112'},${0.02 + rnd() * 0.05})`;
    ctx.fill();
  }
  blotches(ctx, size, size, 30, 'rgba(120,104,74,0.55)', size * 0.04, size * 0.24, 0.1, rnd);
  if (stains) {
    // 下部の汚れ
    const g = ctx.createLinearGradient(0, size * 0.55, 0, size);
    g.addColorStop(0, 'rgba(96,80,54,0)');
    g.addColorStop(1, 'rgba(88,70,44,0.24)');
    ctx.fillStyle = g;
    ctx.fillRect(0, size * 0.55, size, size * 0.45);
  }
  // ひび割れ
  for (let i = 0; i < 7; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (rnd() - 0.5) * 34;
      y += rnd() * 26;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(96,82,58,${0.06 + rnd() * 0.1})`;
    ctx.lineWidth = 0.6 + rnd();
    ctx.stroke();
  }
  grain(ctx, size, size, 13, null, rnd);

  return {
    map: toTexture(c, { seed }),
    normalMap: toTexture(normalFromCanvas(c, 1.5), { srgb: false, seed }),
  };
}

/** 腰板・塗装面（つや消しペンキ） */
export function paintedTextures({ size = 512, base = '#7d8f6a', seed = 11, chips = true } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 200; i++) {
    ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.012 + rnd() * 0.03})`;
    ctx.lineWidth = 0.6 + rnd() * 3;
    ctx.beginPath();
    const y = rnd() * size;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + (rnd() - 0.5) * 12, size * 0.6, y + (rnd() - 0.5) * 12, size, y);
    ctx.stroke();
  }
  if (chips) {
    // ペイントの剥げ
    for (let i = 0; i < 42; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 1.5 + rnd() * 7;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const rr = r * (0.6 + rnd() * 0.7);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${120 + rnd() * 40},${100 + rnd() * 30},${78 + rnd() * 24},${
        0.15 + rnd() * 0.3
      })`;
      ctx.fill();
    }
  }
  blotches(ctx, size, size, 12, 'rgba(60,50,30,0.5)', size * 0.06, size * 0.3, 0.14, rnd);
  grain(ctx, size, size, 10, null, rnd);
  return {
    map: toTexture(c, { seed }),
    normalMap: toTexture(normalFromCanvas(c, 1.1), { srgb: false, seed }),
  };
}

/* ---------------- 黒板 ---------------- */

/** 1文字ずつ揺らして、チョークの手書き感を出す */
function chalkText(ctx, text, x, y, size, { color = 'rgba(240,242,230,0.86)', jitter = 0.055, align = 'left', letterSpacing = 0.06, font = 'mincho', weight = '500' } = {}) {
  const fam =
    font === 'mincho'
      ? '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'
      : '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';
  ctx.font = `${weight} ${size}px ${fam}`;
  ctx.textBaseline = 'alphabetic';
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + size * letterSpacing;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const rnd = rng(Math.floor(x * 31 + y * 17 + size));
  for (const ch of text) {
    const w = ctx.measureText(ch).width + size * letterSpacing;
    ctx.save();
    ctx.translate(cx + w * 0.42, y + (rnd() - 0.5) * size * jitter * 2.2);
    ctx.rotate((rnd() - 0.5) * jitter * 1.1);
    ctx.globalAlpha = 0.72 + rnd() * 0.28;
    ctx.fillStyle = color;
    // チョークのかすれ：2回ずらして描く
    ctx.fillText(ch, -w * 0.42, 0);
    ctx.globalAlpha *= 0.4;
    ctx.fillText(ch, -w * 0.42 + 0.7, 0.7);
    ctx.restore();
    cx += w;
  }
  return total;
}

/** 黒板（書き込み入り） */
export function chalkboardTextures({ size = 2048, seed = 21, aspect = 4 } = {}) {
  const rnd = rng(seed);
  const w = size;
  const h = Math.round(size / aspect);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');

  // 板色：深い緑
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1d3128');
  g.addColorStop(0.5, '#22382c');
  g.addColorStop(1, '#1a2c23');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 消し跡（大きなムラ）
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 30 + rnd() * 170;
    ctx.save();
    ctx.globalAlpha = 0.03 + rnd() * 0.07;
    ctx.translate(x, y);
    ctx.rotate((rnd() - 0.5) * 0.5);
    ctx.fillStyle = rnd() < 0.7 ? '#dfe6d6' : '#0e1a14';
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * (0.18 + rnd() * 0.25), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 細かいチョーク粉
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = `rgba(226,232,214,${0.012 + rnd() * 0.05})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.4, 1 + rnd() * 1.6);
  }
  // 傷
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(210,220,200,${0.02 + rnd() * 0.05})`;
    ctx.lineWidth = 0.6 + rnd();
    ctx.beginPath();
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 180, y + (rnd() - 0.5) * 40);
    ctx.stroke();
  }

  /* --- 書き込み --- */
  const S = h / 100; // 基準スケール

  // 日付・日直（右上）
  chalkText(ctx, '６月１４日（金）', w - 8 * S, 15 * S, 5.2 * S, { align: 'right' });
  chalkText(ctx, 'くもり　のち　はれ', w - 8 * S, 23 * S, 4.2 * S, {
    align: 'right',
    color: 'rgba(232,238,222,0.66)',
  });
  chalkText(ctx, '日直　さとう　・　たなか', w - 8 * S, 30.5 * S, 4.2 * S, {
    align: 'right',
    color: 'rgba(232,238,222,0.66)',
  });

  // 授業のめあて（左）
  chalkText(ctx, '算数　　わり算', 8 * S, 22 * S, 8.4 * S);
  ctx.strokeStyle = 'rgba(240,242,230,0.5)';
  ctx.lineWidth = 0.9 * S;
  ctx.beginPath();
  ctx.moveTo(8 * S, 25 * S);
  ctx.lineTo(46 * S, 25 * S);
  ctx.stroke();

  chalkText(ctx, '１４４　÷　１２　＝　１２', 10 * S, 42 * S, 6.2 * S, {
    color: 'rgba(246,240,214,0.9)',
  });
  chalkText(ctx, '３．１４　×　５　＝　１５．７', 10 * S, 55 * S, 6.2 * S, {
    color: 'rgba(246,240,214,0.9)',
  });
  chalkText(ctx, 'あまりは　どうする？', 12 * S, 68 * S, 4.6 * S, {
    color: 'rgba(240,200,150,0.8)',
  });

  // 連絡（右下）
  chalkText(ctx, '＜れんらく＞', w - 8 * S, 62 * S, 4.6 * S, { align: 'right' });
  chalkText(ctx, '・あしたは　たいそう服を　わすれない', w - 8 * S, 70 * S, 4.0 * S, {
    align: 'right',
    color: 'rgba(232,238,222,0.7)',
  });
  chalkText(ctx, '・こん虫かんさつは　こうてい集合', w - 8 * S, 77 * S, 4.0 * S, {
    align: 'right',
    color: 'rgba(232,238,222,0.7)',
  });

  // 半分消された落書き（左下）
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#eef2e6';
  ctx.lineWidth = 1.1 * S;
  ctx.beginPath();
  ctx.arc(30 * S, 87 * S, 6 * S, 0.2, Math.PI * 1.6);
  ctx.moveTo(27 * S, 85 * S);
  ctx.lineTo(28.6 * S, 86.4 * S);
  ctx.moveTo(33 * S, 85 * S);
  ctx.lineTo(31.4 * S, 86.4 * S);
  ctx.moveTo(27.5 * S, 90 * S);
  ctx.quadraticCurveTo(30 * S, 92.4 * S, 32.6 * S, 89.6 * S);
  ctx.stroke();
  ctx.restore();
  chalkText(ctx, 'だいすき', 41 * S, 90 * S, 3.6 * S, { color: 'rgba(240,242,230,0.28)' });

  // 消し残しの大きなムラ
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = '#e9efe0';
  ctx.beginPath();
  ctx.ellipse(w * 0.52, h * 0.5, w * 0.16, h * 0.3, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  grain(ctx, w, h, 8, null, rnd);

  return {
    map: toTexture(c, { seed }),
    roughnessMap: toTexture(c, { srgb: false, seed }),
    normalMap: toTexture(normalFromCanvas(c, 0.7), { srgb: false, seed }),
  };
}

/* ---------------- 紙・ポスター ---------------- */

function paperBase(ctx, w, h, color, rnd, aged = true) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    blotches(ctx, w, h, 1, `rgba(${140 + rnd() * 40},${120 + rnd() * 30},${86 + rnd() * 26},0.5)`, w * 0.02, w * 0.14, 0.08, rnd);
  }
  if (aged) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(150,120,70,0.16)');
    g.addColorStop(0.5, 'rgba(150,120,70,0)');
    g.addColorStop(1, 'rgba(120,92,52,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  grain(ctx, w, h, 9, null, rnd);
}

/** 時間割表 */
export function scheduleTexture({ size = 700, seed = 33 } = {}) {
  const rnd = rng(seed);
  const w = size;
  const h = Math.round(size * 1.28);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#efe6cd', rnd);

  const days = ['月', '火', '水', '木', '金'];
  const subs = [
    ['国語', '算数', '理科', '体育', '音楽'],
    ['算数', '国語', '社会', '図工', '国語'],
    ['理科', '社会', '国語', '算数', '家庭'],
    ['体育', '音楽', '算数', '国語', '理科'],
    ['道徳', '算数', '国語', '社会', '学活'],
  ];
  const cols = ['#d98f6a', '#7fa8c9', '#8fb87e', '#d9c06a', '#b48fc4', '#c9a07f'];

  const m = w * 0.07;
  const top = h * 0.16;
  const cw = (w - m * 2) / 6;
  const chh = (h - top - m * 1.1) / 6;
  const fam = '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';

  ctx.fillStyle = '#3d3524';
  ctx.font = `600 ${w * 0.062}px ${fam}`;
  ctx.textAlign = 'center';
  ctx.fillText('時　間　割', w / 2, h * 0.1);
  ctx.font = `500 ${w * 0.03}px ${fam}`;
  ctx.fillStyle = '#6b6046';
  ctx.fillText('五年二組', w / 2, h * 0.135);

  // 升目
  ctx.strokeStyle = 'rgba(90,78,54,0.5)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(m + i * cw, top);
    ctx.lineTo(m + i * cw, top + 6 * chh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m, top + i * chh);
    ctx.lineTo(m + 6 * cw, top + i * chh);
    ctx.stroke();
  }

  ctx.fillStyle = '#4a4030';
  ctx.font = `600 ${cw * 0.34}px ${fam}`;
  days.forEach((d, i) => ctx.fillText(d, m + cw * (i + 1.5), top + chh * 0.66));

  for (let p = 0; p < 5; p++) {
    ctx.font = `500 ${cw * 0.3}px ${fam}`;
    ctx.fillStyle = '#7a6c50';
    ctx.fillText(`${p + 1}`, m + cw * 0.5, top + chh * (p + 1.62));
    for (let d = 0; d < 5; d++) {
      const s = subs[d][p];
      const ci = (p * 3 + d * 2) % cols.length;
      ctx.fillStyle = cols[ci];
      ctx.globalAlpha = 0.22;
      ctx.fillRect(m + cw * (d + 1) + 2, top + chh * (p + 1) + 2, cw - 4, chh - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#463c28';
      ctx.font = `600 ${cw * 0.29}px ${fam}`;
      ctx.fillText(s, m + cw * (d + 1.5), top + chh * (p + 1.62));
    }
  }

  // 端の傷み・折り目
  ctx.strokeStyle = 'rgba(120,100,66,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.lineTo(w, h * 0.5);
  ctx.stroke();

  return { map: toTexture(c, { seed }) };
}

/** 子どもの絵（クレヨン風） */
export function drawingTexture({ size = 620, seed = 45, title = 'こうていの　え' } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size, Math.round(size * 0.78));
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  paperBase(ctx, w, h, '#f6f0dd', rnd, false);

  const crayon = (fn, color, lw = 7) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;
    fn();
    // クレヨンのざらつき
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = lw * 1.5;
    ctx.setLineDash([2, 4]);
    fn();
    ctx.restore();
  };

  // 空
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#bcd9ee';
  ctx.fillRect(w * 0.05, h * 0.08, w * 0.9, h * 0.45);
  ctx.restore();
  // 太陽
  crayon(() => {
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.2, w * 0.07, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.8 + Math.cos(a) * w * 0.09, h * 0.2 + Math.sin(a) * w * 0.09);
      ctx.lineTo(w * 0.8 + Math.cos(a) * w * 0.13, h * 0.2 + Math.sin(a) * w * 0.13);
      ctx.stroke();
    }
  }, '#f0a63c', 6);
  // 山
  crayon(() => {
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.53);
    ctx.lineTo(w * 0.3, h * 0.2);
    ctx.lineTo(w * 0.55, h * 0.53);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.4, h * 0.53);
    ctx.lineTo(w * 0.68, h * 0.26);
    ctx.lineTo(w * 0.96, h * 0.53);
    ctx.stroke();
  }, '#6f8f6a', 8);
  // 地面
  crayon(() => {
    ctx.beginPath();
    ctx.moveTo(w * 0.03, h * 0.62);
    ctx.lineTo(w * 0.97, h * 0.6);
    ctx.stroke();
  }, '#a5834f', 9);
  // 校舎
  crayon(() => {
    ctx.strokeRect(w * 0.12, h * 0.5, w * 0.34, h * 0.2);
    for (let i = 0; i < 4; i++) ctx.strokeRect(w * (0.15 + i * 0.075), h * 0.55, w * 0.045, h * 0.07);
  }, '#b06a52', 6);
  // 人
  crayon(() => {
    ctx.beginPath();
    ctx.arc(w * 0.66, h * 0.6, w * 0.035, 0, Math.PI * 2);
    ctx.moveTo(w * 0.66, h * 0.635);
    ctx.lineTo(w * 0.66, h * 0.74);
    ctx.moveTo(w * 0.62, h * 0.68);
    ctx.lineTo(w * 0.7, h * 0.66);
    ctx.moveTo(w * 0.66, h * 0.74);
    ctx.lineTo(w * 0.63, h * 0.82);
    ctx.moveTo(w * 0.66, h * 0.74);
    ctx.lineTo(w * 0.7, h * 0.82);
    ctx.stroke();
  }, '#4a5f8a', 5);
  // 花
  for (let i = 0; i < 7; i++) {
    const x = w * (0.08 + rnd() * 0.84);
    const y = h * (0.84 + rnd() * 0.1);
    crayon(() => {
      ctx.beginPath();
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
      }
      ctx.stroke();
    }, rnd() < 0.5 ? '#d9578a' : '#e8b23c', 3.5);
  }

  // 名前とタイトル
  const fam = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  ctx.fillStyle = '#4c4230';
  ctx.font = `500 ${h * 0.055}px ${fam}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, w * 0.06, h * 0.95);
  ctx.textAlign = 'right';
  ctx.font = `500 ${h * 0.05}px ${fam}`;
  ctx.fillText('たなか　みちこ', w * 0.95, h * 0.95);

  return { map: toTexture(c, { seed }) };
}

/** 標語ポスター */
export function sloganTexture({
  size = 560,
  seed = 55,
  title = '手をあらおう',
  body = ['そとから　かえったら', 'ごはんの　まえに', 'きれいな　てで'],
  accent = '#4f8a6a',
} = {}) {
  const rnd = rng(seed);
  const w = size;
  const h = Math.round(size * 1.34);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  paperBase(ctx, w, h, '#f2ecdb', rnd);
  const fam = '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 6;
  ctx.strokeRect(w * 0.05, h * 0.035, w * 0.9, h * 0.93);
  ctx.globalAlpha = 1;

  // 見出し
  ctx.fillStyle = accent;
  ctx.font = `700 ${w * 0.13}px ${fam}`;
  ctx.textAlign = 'center';
  ctx.fillText(title, w / 2, h * 0.17);

  // 手と石けんのイラスト
  ctx.save();
  ctx.translate(w / 2, h * 0.36);
  ctx.strokeStyle = '#4a4030';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-40, 60);
  ctx.quadraticCurveTo(-52, 10, -30, -18);
  ctx.lineTo(-26, -50);
  ctx.moveTo(-14, -22);
  ctx.lineTo(-12, -58);
  ctx.moveTo(0, -22);
  ctx.lineTo(2, -60);
  ctx.moveTo(14, -20);
  ctx.lineTo(18, -52);
  ctx.moveTo(28, -8);
  ctx.lineTo(44, -26);
  ctx.moveTo(-40, 60);
  ctx.quadraticCurveTo(10, 76, 40, 40);
  ctx.stroke();
  ctx.fillStyle = 'rgba(150,200,230,0.55)';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(-40 + rnd() * 90, -60 + rnd() * 120, 4 + rnd() * 11, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 本文
  ctx.fillStyle = '#4a4030';
  ctx.font = `600 ${w * 0.072}px ${fam}`;
  body.forEach((line, i) => ctx.fillText(line, w / 2, h * (0.62 + i * 0.1)));

  ctx.font = `500 ${w * 0.045}px ${fam}`;
  ctx.fillStyle = '#8a7c5c';
  ctx.fillText('保健委員会', w / 2, h * 0.93);

  return { map: toTexture(c, { seed }) };
}

/** 背表紙1冊ぶん（厚い本・バインダー用） */
export function bookSpineOne({ w = 128, h = 288, color = '#7a4a3a', title = '図鑑', seed = 61 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.32)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(0,0,0,0.24)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(240,228,196,0.82)';
  ctx.fillRect(0, h * 0.12, w, h * 0.014);
  ctx.fillRect(0, h * 0.86, w, h * 0.014);
  const fam = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  ctx.save();
  ctx.translate(w / 2, h * 0.5);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(246,238,214,0.92)';
  ctx.font = `600 ${Math.min(w * 0.42, h * 0.075)}px ${fam}`;
  ctx.fillText(title, 0, 0);
  ctx.restore();
  grain(ctx, w, h, 16, null, rnd);
  return { map: toTexture(c, { seed }) };
}

/** 本の背表紙（棚の詰め込み用） */
export function bookSpineTexture({ size = 512, seed = 67, count = 14 } = {}) {
  const rnd = rng(seed);
  const w = size;
  const h = Math.round(size * 0.6);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(0, 0, w, h);
  const fam = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  const titles = ['昆虫記', '図鑑', '日本地図', 'ことわざ', '算数', '国語', '理科', '小説', '伝記', '漫画', '詩集', '歴史', '工作', '料理'];
  const hues = ['#8c4a3c', '#3f5f7a', '#5f7a44', '#a07a34', '#6a4a7a', '#2f6a63', '#9a5a2a', '#4a4a6a'];
  let x = 4;
  for (let i = 0; i < count && x < w - 10; i++) {
    const bw = 14 + rnd() * 34;
    const bh = h * (0.72 + rnd() * 0.26);
    const y = h - bh;
    ctx.fillStyle = hues[(rnd() * hues.length) | 0];
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + bw - 3, y, 3, bh);
    ctx.fillStyle = 'rgba(255,240,210,0.82)';
    ctx.fillRect(x + 2, y + bh * 0.14, bw - 4, 2);
    ctx.fillRect(x + 2, y + bh * 0.8, bw - 4, 2);
    if (bw > 20) {
      ctx.save();
      ctx.translate(x + bw / 2, y + bh * 0.5);
      ctx.rotate(Math.PI / 2);
      ctx.font = `500 ${Math.min(bw * 0.42, 15)}px ${fam}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(250,242,222,0.9)';
      ctx.fillText(titles[i % titles.length], 0, 0);
      ctx.restore();
    }
    x += bw + 2 + rnd() * 5;
  }
  grain(ctx, w, h, 14, null, rnd);
  return { map: toTexture(c, { seed }) };
}

/* ---------------- 時計の文字盤 ---------------- */

export function clockFaceTexture({ size = 512, seed = 77 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const w = size;
  const cx = w / 2;
  paperBase(ctx, w, w, '#f4eeda', rnd);
  const fam = '"Hiragino Sans","Yu Gothic",sans-serif';

  ctx.strokeStyle = '#4b4331';
  ctx.lineWidth = w * 0.012;
  ctx.beginPath();
  ctx.arc(cx, cx, w * 0.44, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const r1 = w * (major ? 0.375 : 0.405);
    const r2 = w * 0.425;
    ctx.strokeStyle = major ? '#3d3524' : 'rgba(70,60,42,0.55)';
    ctx.lineWidth = w * (major ? 0.014 : 0.006);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cx + Math.sin(a) * r2);
    ctx.stroke();
  }
  ctx.fillStyle = '#3d3524';
  ctx.font = `600 ${w * 0.085}px ${fam}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(`${i}`, cx + Math.cos(a) * w * 0.31, cx + Math.sin(a) * w * 0.31 + w * 0.005);
  }
  ctx.font = `500 ${w * 0.038}px ${fam}`;
  ctx.fillStyle = '#8a7c5c';
  ctx.fillText('SEIKO', cx, cx + w * 0.16);

  return { map: toTexture(c, { seed }) };
}

/* ---------------- 外の景色（窓の向こう） ---------------- */

export function backdropTexture(mode = 'day', { size = 1600, seed = 91 } = {}) {
  const rnd = rng(seed + (mode === 'dusk' ? 500 : mode === 'night' ? 900 : 0));
  const w = size;
  const h = Math.round(size * 0.56);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');

  const P = {
    day: {
      skyTop: '#7fb0dd',
      skyMid: '#b9d7ea',
      skyLow: '#e6eeda',
      sun: null,
      far: '#9db3c4',
      mid: '#7d9c86',
      near: '#5d7f52',
      ground: '#c9b48d',
      groundDark: '#b09b76',
      cloud: 'rgba(255,255,255,0.9)',
      building: '#cbbfa6',
      tree: '#4d7040',
    },
    dusk: {
      skyTop: '#3f3f74',
      skyMid: '#c96a4a',
      skyLow: '#f0b46a',
      sun: '#fff0c0',
      far: '#6f5f7a',
      mid: '#54435a',
      near: '#3b2f42',
      ground: '#8a6a55',
      groundDark: '#6f5645',
      cloud: 'rgba(255,190,140,0.75)',
      building: '#4a3c48',
      tree: '#2f2a35',
    },
    night: {
      skyTop: '#080c1c',
      skyMid: '#14203a',
      skyLow: '#2b3a52',
      sun: null,
      far: '#1d2a3c',
      mid: '#16212e',
      near: '#101820',
      ground: '#242a2c',
      groundDark: '#1b2022',
      cloud: 'rgba(120,140,170,0.25)',
      building: '#1a2230',
      tree: '#101820',
    },
  }[mode];

  // 空
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.78);
  sky.addColorStop(0, P.skyTop);
  sky.addColorStop(0.55, P.skyMid);
  sky.addColorStop(1, P.skyLow);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 星（夜）
  if (mode === 'night') {
    for (let i = 0; i < 320; i++) {
      const y = rnd() * h * 0.55;
      ctx.fillStyle = `rgba(255,255,240,${0.15 + rnd() * 0.75})`;
      const s = rnd() < 0.9 ? 1 : 2;
      ctx.fillRect(rnd() * w, y, s, s);
    }
    // 月
    const mx = w * 0.76;
    const my = h * 0.18;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, w * 0.09);
    mg.addColorStop(0, 'rgba(255,252,230,0.95)');
    mg.addColorStop(0.28, 'rgba(240,240,215,0.5)');
    mg.addColorStop(1, 'rgba(200,215,240,0)');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(mx, my, w * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fdf9e6';
    ctx.beginPath();
    ctx.arc(mx, my, w * 0.024, 0, Math.PI * 2);
    ctx.fill();
  }

  // 夕日
  if (mode === 'dusk') {
    const sx = w * 0.3;
    const sy = h * 0.5;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.22);
    sg.addColorStop(0, 'rgba(255,246,214,0.98)');
    sg.addColorStop(0.18, 'rgba(255,206,130,0.6)');
    sg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, w * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  // 雲
  for (let i = 0; i < (mode === 'night' ? 5 : 12); i++) {
    const cx = rnd() * w;
    const cy = h * (0.06 + rnd() * 0.34);
    ctx.fillStyle = P.cloud;
    for (let j = 0; j < 7; j++) {
      ctx.beginPath();
      ctx.ellipse(
        cx + (rnd() - 0.5) * w * 0.12,
        cy + (rnd() - 0.5) * h * 0.03,
        w * (0.02 + rnd() * 0.05),
        h * (0.012 + rnd() * 0.026),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  // 遠い山
  const ridge = (color, baseY, amp, step) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    let y = baseY;
    for (let x = 0; x <= w; x += step) {
      y = baseY - Math.abs(Math.sin(x * 0.0035 + amp)) * amp - rnd() * amp * 0.18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  ridge(P.far, h * 0.62, h * 0.16, 8);
  ridge(P.mid, h * 0.7, h * 0.09, 10);

  // 校庭の地面
  const gg = ctx.createLinearGradient(0, h * 0.7, 0, h);
  gg.addColorStop(0, P.ground);
  gg.addColorStop(1, P.groundDark);
  ctx.fillStyle = gg;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);

  // 校舎（遠景）
  ctx.fillStyle = P.building;
  ctx.fillRect(w * 0.56, h * 0.55, w * 0.34, h * 0.19);
  ctx.fillStyle = mode === 'night' ? 'rgba(255,214,140,0.75)' : 'rgba(90,110,130,0.5)';
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 10; i++)
      ctx.fillRect(w * (0.575 + i * 0.032), h * (0.575 + r * 0.075), w * 0.02, h * 0.045);

  // 木
  for (let i = 0; i < 9; i++) {
    const tx = rnd() * w;
    const ty = h * (0.7 + rnd() * 0.1);
    const s = h * (0.1 + rnd() * 0.14);
    ctx.fillStyle = mode === 'night' ? '#0d1319' : '#6a5034';
    ctx.fillRect(tx - s * 0.05, ty - s * 0.35, s * 0.1, s * 0.42);
    ctx.fillStyle = P.tree;
    ctx.globalAlpha = 0.95;
    for (let j = 0; j < 5; j++) {
      ctx.beginPath();
      ctx.ellipse(
        tx + (rnd() - 0.5) * s * 0.5,
        ty - s * (0.4 + rnd() * 0.35),
        s * (0.22 + rnd() * 0.2),
        s * (0.18 + rnd() * 0.16),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // フェンス
  ctx.strokeStyle = mode === 'night' ? 'rgba(140,160,180,0.25)' : 'rgba(90,90,80,0.4)';
  ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, h * 0.86);
    ctx.lineTo(x, h * 0.94);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, h * 0.87);
  ctx.lineTo(w, h * 0.87);
  ctx.moveTo(0, h * 0.93);
  ctx.lineTo(w, h * 0.93);
  ctx.stroke();

  grain(ctx, w, h, 7, null, rnd);
  return { map: toTexture(c, { seed }) };
}

/* ---------------- その他 ---------------- */

/** 金属（すり傷入りの粗さマップ） */
export function metalTextures({ size = 256, seed = 101 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a9a98';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i++) {
    const y = rnd() * size;
    ctx.strokeStyle = `rgba(${rnd() < 0.5 ? 255 : 40},${rnd() < 0.5 ? 255 : 40},${
      rnd() < 0.5 ? 255 : 40
    },${0.02 + rnd() * 0.05})`;
    ctx.lineWidth = 0.4 + rnd();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (rnd() - 0.5) * 3);
    ctx.stroke();
  }
  return { roughnessMap: toTexture(c, { srgb: false, seed }) };
}

/** 天井（塗装＋シミ） */
export function ceilingTextures({ size = 512, seed = 111 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, size, 22, 'rgba(160,146,112,0.5)', size * 0.03, size * 0.2, 0.12, rnd);
  // 雨漏り跡
  for (let i = 0; i < 3; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    for (let r = 3; r > 0; r--) {
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.03 * r, size * 0.024 * r, rnd(), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150,128,88,${0.12 / r})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  grain(ctx, size, size, 8, null, rnd);
  return {
    map: toTexture(c, { seed }),
    normalMap: toTexture(normalFromCanvas(c, 0.8), { srgb: false, seed }),
  };
}

/** 机の天板（落書き入り） */
export function deskTopTextures({ size = 700, seed = 121, graffiti = true } = {}) {
  const rnd = rng(seed);
  const base = woodMaterialTextures({
    size,
    planks: 1,
    base: [0xa9, 0x80, 0x4e],
    variance: 14,
    grainStrength: 0.42,
    knots: 2,
    scuffs: 40,
    seamDark: 0,
    seed,
  });
  const w = size;
  const h = Math.round(size * 0.62);
  const c = base.map.image;
  const ctx = c.getContext('2d');

  // 角の摩耗
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(60,40,20,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (graffiti) {
    const fam = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
    const carve = (fn, lw = 2.2) => {
      ctx.save();
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(255,236,200,0.28)';
      ctx.translate(0.9, 1.1);
      fn();
      ctx.translate(-0.9, -1.1);
      ctx.strokeStyle = 'rgba(52,34,18,0.55)';
      fn();
      ctx.restore();
    };
    // 引っかき傷の落書き
    carve(() => {
      ctx.font = `500 ${h * 0.15}px ${fam}`;
      ctx.textAlign = 'left';
      ctx.strokeText('たけし', w * 0.1, h * 0.34);
      ctx.strokeText('＋', w * 0.36, h * 0.32);
      ctx.strokeText('みちこ', w * 0.44, h * 0.36);
    }, 1.8);
    carve(() => {
      // 落書きの顔
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.62, h * 0.13, 0.3, Math.PI * 1.75);
      ctx.moveTo(w * 0.74, h * 0.58);
      ctx.lineTo(w * 0.755, h * 0.6);
      ctx.moveTo(w * 0.82, h * 0.58);
      ctx.lineTo(w * 0.805, h * 0.6);
      ctx.stroke();
    }, 1.6);
    carve(() => {
      // 定規でつけたような線
      ctx.beginPath();
      ctx.moveTo(w * 0.12, h * 0.78);
      ctx.lineTo(w * 0.6, h * 0.72);
      ctx.stroke();
    }, 1.2);
    // ボールペンの落書き
    ctx.save();
    ctx.strokeStyle = 'rgba(40,60,140,0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const y = h * (0.5 + i * 0.06);
      ctx.moveTo(w * 0.16, y);
      ctx.bezierCurveTo(w * 0.3, y - 8, w * 0.42, y + 9, w * 0.56, y - 2);
    }
    ctx.stroke();
    ctx.restore();
    grain(ctx, w, h, 10, null, rnd);
  }

  base.map.needsUpdate = true;
  return base;
}

/** ラベル用：スプライトに使う小さなアイコン（記憶のかけら） */
export function glowSpriteTexture({ size = 256, color = '#ffd98a' } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, color);
  g.addColorStop(0.5, 'rgba(255,196,110,0.22)');
  g.addColorStop(1, 'rgba(255,180,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  registry.push(t);
  return t;
}

/** 札・プレート（クラス名、掃除用具、など） */
export function labelTexture({
  text = '五年二組',
  w = 512,
  h = 160,
  bg = '#efe7d2',
  fg = '#33291c',
  border = '#8a6a44',
  font = 'mincho',
  size = 0.52,
  seed = 141,
} = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 8, null, rnd);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = h * 0.045;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  }
  const fam =
    font === 'mincho'
      ? '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'
      : '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';
  ctx.fillStyle = fg;
  ctx.font = `600 ${h * size}px ${fam}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 手書き風に少しだけ揺らす
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rnd() - 0.5) * 0.012);
  ctx.fillText(text, 0, h * 0.02);
  ctx.restore();
  return { map: toTexture(c, { seed }) };
}

/** ざらついた布（カーテン・雑巾） */
export function clothTextures({ size = 512, base = '#e6dbc0', folds = 9, seed = 151 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size, Math.round(size * 0.7));
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < folds; i++) {
    const x = (i / folds) * w + rnd() * 8;
    const g = ctx.createLinearGradient(x, 0, x + w / folds, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.42, 'rgba(120,106,78,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0.1)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w / folds, h);
  }
  // 黄ばみ
  const gg = ctx.createLinearGradient(0, 0, 0, h);
  gg.addColorStop(0, 'rgba(150,124,80,0)');
  gg.addColorStop(1, 'rgba(140,112,68,0.22)');
  ctx.fillStyle = gg;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 12, null, rnd);
  return {
    map: toTexture(c, { seed }),
    normalMap: toTexture(normalFromCanvas(c, 1.4), { srgb: false, seed }),
  };
}

/** チョーク（白・黄・赤） */
export function chalkBoxTexture({ size = 256, seed = 131 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size, Math.round(size * 0.5));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(0, 0, c.width, c.height);
  grain(ctx, c.width, c.height, 20, null, rnd);
  return { map: toTexture(c, { seed }) };
}

/** ピアノの鍵盤 */
export function keyboardTexture({ size = 1024, seed = 161, octaves = 3 } = {}) {
  const rnd = rng(seed);
  const w = size;
  const h = Math.round(size * 0.16);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const whiteKeys = octaves * 7 + 1;
  const kw = w / whiteKeys;
  ctx.fillStyle = '#efe9d8';
  ctx.fillRect(0, 0, w, h);
  // 白鍵の境目と黄ばみ
  for (let i = 0; i <= whiteKeys; i++) {
    ctx.fillStyle = 'rgba(90,80,60,0.55)';
    ctx.fillRect(i * kw - 1, 0, 2, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(190,170,130,${0.05 + rnd() * 0.08})`);
    g.addColorStop(0.7, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(150,132,96,${0.08 + rnd() * 0.1})`);
    ctx.fillStyle = g;
    ctx.fillRect(i * kw, 0, kw, h);
  }
  // 黒鍵
  const pattern = [0, 1, 3, 4, 5]; // C D F G A の位置に黒鍵
  for (let o = 0; o < octaves; o++) {
    for (const p of pattern) {
      const i = o * 7 + p;
      const x = (i + 1) * kw - kw * 0.3;
      ctx.fillStyle = '#1d1a16';
      ctx.fillRect(x, 0, kw * 0.6, h * 0.62);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 1, 0, kw * 0.6 - 2, h * 0.08);
    }
  }
  grain(ctx, w, h, 8, null, rnd);
  return { map: toTexture(c, { seed }) };
}

/** 地球儀（簡易な海と陸） */
export function globeTexture({ size = 512, seed = 171 } = {}) {
  const rnd = rng(seed);
  const w = size;
  const h = size / 2;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#cfe0e6');
  g.addColorStop(0.12, '#4a7fa6');
  g.addColorStop(0.5, '#3d7199');
  g.addColorStop(0.88, '#4a7fa6');
  g.addColorStop(1, '#d6e4e8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 大陸っぽいブロブ
  const land = '#8aa05e';
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * w;
    const cy = h * (0.16 + rnd() * 0.68);
    const r = h * (0.06 + rnd() * 0.2);
    ctx.fillStyle = rnd() < 0.75 ? land : '#9aa86a';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.35) {
      const rr = r * (0.55 + rnd() * 0.75) * (1 + Math.cos(a * 2) * 0.2);
      const px = cx + Math.cos(a) * rr * 1.5;
      const py = cy + Math.sin(a) * rr * 0.75;
      a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 緯線・経線
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (h / 6) * i);
    ctx.lineTo(w, (h / 6) * i);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo((w / 12) * i, 0);
    ctx.lineTo((w / 12) * i, h);
    ctx.stroke();
  }
  grain(ctx, w, h, 8, null, rnd);
  return { map: toTexture(c, { seed }) };
}

/** 段ボール */
export function cardboardTexture({ size = 256, seed = 181 } = {}) {
  const rnd = rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c0a071';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 4) {
    ctx.fillStyle = `rgba(${150 + rnd() * 30},${120 + rnd() * 26},${80 + rnd() * 20},0.25)`;
    ctx.fillRect(i, 0, 2, size);
  }
  blotches(ctx, size, size, 10, 'rgba(110,86,52,0.6)', size * 0.05, size * 0.3, 0.12, rnd);
  grain(ctx, size, size, 16, null, rnd);
  return { map: toTexture(c, { seed }) };
}
