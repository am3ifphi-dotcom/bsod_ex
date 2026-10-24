import * as THREE from 'three';
import { RNG, clamp } from '../core/util';

/* ------------------------------------------------------------------ *
 * 手続き生成テクスチャ群 (Canvas2D)。外部画像に依存しないため
 * ライセンス問題がなく、すべて実行時に合成できる。
 * ------------------------------------------------------------------ */

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ *
 * BSOD 画面 (窓の Blue Screen 風 / 表示の破損段階付き)
 * ------------------------------------------------------------------ */
export type BSODOptions = {
  stage: number;        // 0..5 (クリック段階)
  progress: number;     // 0..100
  corruption: number;   // 0..1
  faceScale: number;    // " :( " の拡大率
  seed: number;
  time: number;
};

const KATA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const HEX = '0123456789ABCDEF';

export class BSODScreen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  private rng = new RNG(4242);
  lastDraw = 0;

  constructor(public w = 1280, public h = 720) {
    const { c, ctx } = makeCanvas(w, h);
    this.canvas = c;
    this.ctx = ctx;
    this.texture = canvasTexture(c, true);
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.draw({ stage: 0, progress: 0, corruption: 0, faceScale: 1, seed: 1, time: 0 });
  }

  draw(o: BSODOptions) {
    const { ctx, w, h } = this;
    const rng = new RNG(1000 + o.seed);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // --- 背景 (青) -------------------------------------------------
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0a66c2');
    g.addColorStop(0.45, '#0b6fd0');
    g.addColorStop(1, '#0752a8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 微妙なビネット
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.15, w / 2, h / 2, h * 0.85);
    vg.addColorStop(0, 'rgba(255,255,255,0.05)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const faceY = h * 0.30;
    const faceSize = h * 0.30 * o.faceScale;

    // --- " :( " -----------------------------------------------------
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${faceSize}px "Helvetica Neue", "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(':(' , cx, faceY);

    // --- 本文 ------------------------------------------------------
    const bodyY = faceY + faceSize * 0.62;
    const fs = Math.round(h * 0.031);
    ctx.font = `400 ${fs}px "Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText('問題が発生したため、PC を再起動する必要があります。', cx, bodyY);
    ctx.fillText('エラー情報を収集中です。自動的に再起動します。', cx, bodyY + fs * 1.7);

    const pct = `${Math.floor(o.progress)}% 完了`;
    ctx.fillText(pct, cx, bodyY + fs * 3.6);

    // --- 下部情報 ---------------------------------------------------
    const smallFs = Math.round(h * 0.019);
    ctx.font = `400 ${smallFs}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    const leftX = w * 0.10;
    let ly = h * 0.735;
    ctx.fillText('詳細については、次の URL にアクセスしてください。', leftX, ly); ly += smallFs * 1.8;
    ctx.fillText('https://aka.ms/stopcode', leftX, ly); ly += smallFs * 2.4;
    ctx.fillText('停止コード: MEMORY_MANAGEMENT_FAILURE', leftX, ly); ly += smallFs * 1.8;
    ctx.fillText('失敗した操作: PAGE_FAULT_IN_NONPAGED_AREA', leftX, ly); ly += smallFs * 1.8;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('0x0000001A (0x0000000000000000, 0x0000000000000001)', leftX, ly);

    // --- QR 風ブロック ---------------------------------------------
    const qr = h * 0.115;
    const qx = w * 0.10, qy = h * 0.86;
    if (qy + qr < h) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qx, qy, qr, qr);
      ctx.fillStyle = '#0b6fd0';
      const cell = qr / 21;
      for (let y = 0; y < 21; y++) {
        for (let x = 0; x < 21; x++) {
          const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
          let on = finder
            ? (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5) ||
               (x > 14 && x < 19 && y > 1 && y < 5) || (x > 1 && x < 5 && y > 14 && y < 19))
            : rng.next() > 0.52;
          if (on) ctx.fillRect(qx + x * cell, qy + y * cell, cell + 0.4, cell + 0.4);
        }
      }
    }

    // --- 走査線 + ノイズ -------------------------------------------
    ctx.globalAlpha = 0.05;
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 1;

    // 小さな明滅ダスト
    const dust = 220 + o.stage * 400;
    for (let i = 0; i < dust; i++) {
      const a = rng.range(0.02, 0.12);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 2));
    }

    // --- 破損 (クリック段階に応じて) -------------------------------
    const stage = clamp(o.stage, 0, 5);
    if (stage > 0) {
      const slices = 6 + stage * 14;
      for (let i = 0; i < slices; i++) {
        const sy = rng.range(0, h);
        const sh = rng.range(2, 10 + stage * 10);
        const dx = rng.range(-1, 1) * (8 + stage * 40);
        try {
          ctx.drawImage(this.canvas, 0, sy, w, sh, dx, sy, w, sh);
        } catch { /* 初回描画時は無視 */ }
      }
      // 色収差
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.10 + stage * 0.06;
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(-stage * 4, 0, w, h);
      ctx.fillStyle = '#ff0040';
      ctx.fillRect(stage * 4, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (stage >= 2) {
      // 文字が別グリフへ置換される
      const n = (stage - 1) * 30;
      ctx.font = `600 ${Math.round(h * 0.05)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const ch = rng.next() > 0.5
          ? KATA[Math.floor(rng.next() * KATA.length)]
          : HEX[Math.floor(rng.next() * HEX.length)];
        ctx.fillText(ch, rng.range(0, w), rng.range(0, h));
      }
    }
    if (stage >= 3) {
      // 黒い断裂
      for (let i = 0; i < stage * 3; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rng.range(0.5, 0.95).toFixed(2)})`;
        ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(w * 0.02, w * 0.6), rng.range(2, 20));
      }
    }
    if (stage >= 4) {
      // 白い光が画面を貫く
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < stage; i++) {
        const gg = ctx.createLinearGradient(0, rng.range(0, h), w, rng.range(0, h));
        gg.addColorStop(0, 'rgba(255,255,255,0)');
        gg.addColorStop(0.5, `rgba(220,240,255,${rng.range(0.1, 0.35).toFixed(2)})`);
        gg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 端末の物理的な縁 (映り込みを模した暗い縁取り)
    const edge = ctx.createLinearGradient(0, 0, w, h);
    edge.addColorStop(0, 'rgba(0,0,0,0.12)');
    edge.addColorStop(0.5, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
    this.texture.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ *
 * 巨大な " :( " の顔テクスチャ (異世界の門 / 口)
 * 白い発光線 + 内側が暗い開口部
 * ------------------------------------------------------------------ */
export function makeFaceTexture(size = 1024) {
  const { c, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;

  // 開口部 (口) の黒い穴: 楕円 + ぼかし
  const hole = ctx.createRadialGradient(cx, size * 0.68, size * 0.02, cx, size * 0.68, size * 0.30);
  hole.addColorStop(0, 'rgba(0,0,0,1)');
  hole.addColorStop(0.65, 'rgba(0,0,0,0.96)');
  hole.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.70, size * 0.26, size * 0.20, 0, 0, Math.PI * 2);
  ctx.fill();

  // ":" (2点)
  ctx.fillStyle = '#eaf3ff';
  for (const y of [0.30, 0.50]) {
    ctx.beginPath();
    ctx.arc(cx - size * 0.20, size * y, size * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
  // "("
  ctx.strokeStyle = '#eaf3ff';
  ctx.lineWidth = size * 0.034;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx + size * 0.17, size * 0.47, size * 0.30, -Math.PI * 0.62, Math.PI * 0.62);
  ctx.stroke();

  // 走査線 (顔に走るノイズ)
  ctx.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < size; y += 4) {
    if (Math.random() > 0.94) ctx.fillRect(0, y, size, 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  const t = canvasTexture(c, true);
  return t;
}

/* ------------------------------------------------------------------ *
 * 文字アトラス (異世界を漂うエラー文字 / 雨)
 * ------------------------------------------------------------------ */
export function makeGlyphAtlas(size = 512) {
  const cols = 8, rows = 8;
  const { c, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const chars = '!@#$%^&*()_+-=[]{}<>/\\|~`:;0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ'.split('');
  const cw = size / cols, ch = size / rows;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < cols * rows; i++) {
    const gx = (i % cols) * cw, gy = Math.floor(i / cols) * ch;
    const ch2 = chars[i % chars.length];
    ctx.fillStyle = '#000';
    ctx.fillRect(gx, gy, cw, ch);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${ch * 0.72}px ui-monospace, monospace`;
    ctx.fillText(ch2, gx + cw / 2, gy + ch / 2 + ch * 0.04);
  }
  const t = canvasTexture(c, false);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** 1文字だけを描いたテクスチャ (看板 / プロンプト用) */
export function makeTextTexture(text: string, opts: {
  width?: number; height?: number; font?: string; color?: string;
  bg?: string; glow?: number; align?: CanvasTextAlign;
} = {}) {
  const width = opts.width ?? 1024, height = opts.height ?? 256;
  const { c, ctx } = makeCanvas(width, height);
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, width, height); }
  else ctx.clearRect(0, 0, width, height);
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.font = opts.font ?? `700 ${Math.floor(height * 0.6)}px ui-monospace, "SF Mono", Consolas, monospace`;
  if (opts.glow) {
    ctx.shadowColor = opts.color ?? '#cfe6ff';
    ctx.shadowBlur = opts.glow;
  }
  ctx.fillStyle = opts.color ?? '#eaf4ff';
  const x = opts.align === 'left' ? width * 0.04 : width / 2;
  ctx.fillText(text, x, height / 2);
  return canvasTexture(c, true);
}

/* ------------------------------------------------------------------ *
 * ノイズ / スキャンライン / 放射グラデ
 * ------------------------------------------------------------------ */
export function makeNoiseTexture(size = 256, mono = true) {
  const { c, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.random() * 255;
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = mono ? v : Math.random() * 255;
    img.data[i * 4 + 2] = mono ? v : Math.random() * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTexture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeRadialTexture(size = 256, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const { c, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(c, true);
}

/** 異世界の床・壁に貼る「エラー文字で侵食された」オーバーレイ */
export function makeErrorOverlayTexture(size = 1024, density = 0.10, rng = new RNG(77)) {
  const { c, ctx } = makeCanvas(size, size);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, size);
  ctx.textBaseline = 'top';
  const words = [
    'MEMORY_MANAGEMENT', '0x0000001A', 'PAGE_FAULT', 'KERNEL_DATA_INPAGE',
    'SYSTEM_THREAD', 'STACK_OVERFLOW', 'ACCESS_VIOLATION', 'IRQL_NOT_LESS',
    'REGISTRY_ERROR', 'UNEXPECTED_KERNEL', 'EXCEPTION_NOT_HANDLED', 'BAD_POOL_HEADER',
    'CRITICAL_PROCESS_DIED', 'HAL_INITIALIZATION_FAILED', 'DRIVER_IRQL',
  ];
  const lines = Math.floor(size / 18);
  for (let i = 0; i < lines; i++) {
    if (rng.next() > density) continue;
    const y = i * 18 + rng.range(-3, 3);
    const x = rng.range(-size * 0.1, size * 0.7);
    const a = rng.range(0.05, 0.5);
    ctx.font = `${rng.range(9, 15).toFixed(0)}px ui-monospace, monospace`;
    ctx.fillStyle = `rgba(215,236,255,${a.toFixed(3)})`;
    ctx.fillText(rng.pick(words), x, y);
    if (rng.next() > 0.7) {
      ctx.fillStyle = `rgba(0,0,0,${(a * 1.2).toFixed(3)})`;
      ctx.fillRect(x, y + 12, rng.range(20, 220), 2);
    }
  }
  const t = canvasTexture(c, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 破損 UI パネル (剥がれたウィンドウ / コンソール断片) */
export function makeBrokenUITexture(w = 512, h = 512, rng = new RNG(9)) {
  const { c, ctx } = makeCanvas(w, h);
  ctx.fillStyle = 'rgba(6,26,52,0.92)';
  ctx.fillRect(0, 0, w, h);
  // タイトルバー
  ctx.fillStyle = 'rgba(160,205,255,0.85)';
  ctx.fillRect(0, 0, w, 26);
  ctx.fillStyle = '#06203c';
  ctx.font = '600 14px ui-monospace, monospace';
  ctx.fillText('C:\\SYSTEM\\MEMORY\\RECOVER.EXE', 8, 18);
  // ウィンドウ枠
  ctx.strokeStyle = 'rgba(150,200,255,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  // テキスト行
  ctx.font = '12px ui-monospace, monospace';
  for (let y = 44; y < h - 10; y += 15) {
    if (rng.next() > 0.72) continue;
    const len = rng.range(6, 58);
    let s = '';
    for (let i = 0; i < len; i++) s += HEX[Math.floor(rng.next() * 16)];
    ctx.fillStyle = `rgba(190,225,255,${rng.range(0.15, 0.8).toFixed(2)})`;
    ctx.fillText(`> ${s}`, 10 + rng.range(0, 20), y);
  }
  // 剥がれ
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.3, 0.95).toFixed(2)})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(4, 90), rng.range(1, 6));
  }
  return canvasTexture(c, true);
}

/* ------------------------------------------------------------------ *
 * トンネル内部 (画面から異世界へ抜ける通路 / 落下中のシャフト)
 * ------------------------------------------------------------------ */
export function makeTunnelTexture(w = 512, h = 1024, seed = 5, opts: { hue?: number; density?: number } = {}) {
  const { c, ctx } = makeCanvas(w, h);
  const rng = new RNG(seed);
  ctx.fillStyle = '#020a14';
  ctx.fillRect(0, 0, w, h);
  // 縦に流れる光の筋
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, w);
    const len = rng.range(20, 260);
    const y = rng.range(0, h);
    const a = rng.range(0.05, 0.5);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.4, `rgba(${140 + rng.range(0, 80)},${200 + rng.range(0, 50)},255,${a.toFixed(2)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, rng.range(1, 4), len);
  }
  // 文字の断片
  const chars = 'ABCDEF0123456789ｱｲｳｴｵｶｷｸｹｺ[]{}<>/#';
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(${170 + rng.range(0, 60)},${215 + rng.range(0, 30)},255,${rng.range(0.06, 0.4).toFixed(2)})`;
    ctx.font = `${rng.range(9, 22).toFixed(0)}px ui-monospace, monospace`;
    ctx.fillText(chars[Math.floor(rng.next() * chars.length)], rng.range(0, w), rng.range(0, h));
  }
  // 横方向のノイズバンド
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(200,235,255,${rng.range(0.02, 0.14).toFixed(3)})`;
    ctx.fillRect(0, rng.range(0, h), w, rng.range(1, 6));
  }
  const t = canvasTexture(c, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
