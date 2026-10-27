// bsod.js — authentic Windows-style BSOD canvas + the face that grows out of ":("
// The mouth never "appears from nowhere": every stage is a morph of the original glyph.

const W = 1280, H = 720;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BsodScreen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'desktop';       // off | desktop | crash | face | static | aftermath
    this.corruption = 0;         // 0..1  (face morph stage)
    this.percent = 0;
    this.time = 0;
    this.cursor = { x: 0.5, y: 0.5 };  // uv of cursor over the screen (for eye tracking)
    this.noiseCanvas = this._makeNoise();
    this.dirty = true;
    this.lastDraw = 0;
    this.glitchTick = 0;
  }

  _makeNoise() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    const img = x.createImageData(256, 256);
    const rnd = mulberry32(1337);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (rnd() * 255) | 0;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  setMode(m) { this.mode = m; this.dirty = true; }
  setCorruption(c) { this.corruption = Math.max(0, Math.min(1, c)); this.dirty = true; }
  setCursor(u, v) {
    if (Math.abs(u - this.cursor.x) > 0.002 || Math.abs(v - this.cursor.y) > 0.002) {
      this.cursor.x = u; this.cursor.y = v; this.dirty = true;
    }
  }

  /** is (u,v) over the face / morph region? */
  hitFace(u, v) {
    const s = this.corruption;
    const cx = 0.17, cy = 0.29;
    const rx = 0.12 + s * 0.30, ry = 0.19 + s * 0.33;
    const dx = (u - cx) / rx, dy = (v - cy) / ry;
    return dx * dx + dy * dy < 1;
  }

  /** redraw if needed (throttled to ~30fps while animating) */
  tick(t) {
    this.time = t;
    const dt = Math.min(0.1, t - (this._lastTick || t));
    this._lastTick = t;
    if (this.mode === 'crash' || this.mode === 'face') {
      this.percent = Math.min(99, this.percent + dt * 0.55);
    }
    const animated =
      ((this.mode === 'face' || this.mode === 'crash') && this.corruption > 0.04) ||
      this.mode === 'static' || this.mode === 'aftermath';
    const wantFrame = t - this.lastDraw > 0.033;
    if (!this.dirty && !(animated && wantFrame)) return false;
    if (this.dirty || (animated && wantFrame)) {
      this.lastDraw = t;
      this.dirty = false;
      this._draw();
      return true;
    }
    return false;
  }

  _draw() {
    const ctx = this.ctx;
    const s = this.corruption;
    ctx.save();
    if (this.mode === 'off') {
      ctx.fillStyle = '#02040a';
      ctx.fillRect(0, 0, W, H);
    } else if (this.mode === 'desktop') {
      this._drawDesktop(ctx, false);
    } else if (this.mode === 'aftermath') {
      this._drawDesktop(ctx, true);
    } else if (this.mode === 'static') {
      this._drawStatic(ctx);
    } else {
      this._drawBsod(ctx, s);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- desktop
  _drawDesktop(ctx, aftermath) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0b2038');
    g.addColorStop(0.55, '#123055');
    g.addColorStop(1, '#07182c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // faint window-light shapes
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#9fd0ff';
    ctx.fillRect(W * 0.12, H * 0.18, W * 0.30, H * 0.42);
    ctx.fillRect(W * 0.52, H * 0.30, W * 0.22, H * 0.30);
    ctx.restore();
    // clock
    ctx.fillStyle = 'rgba(210,230,255,0.9)';
    ctx.font = '300 84px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(aftermath ? '3:33' : '23:47', W / 2, H * 0.42);
    ctx.font = '300 22px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(180,205,235,0.75)';
    ctx.fillText(aftermath ? 'Wednesday' : 'Tuesday', W / 2, H * 0.42 + 44);
    // taskbar glow
    const tg = ctx.createLinearGradient(0, H - 46, 0, H);
    tg.addColorStop(0, 'rgba(10,26,50,0)');
    tg.addColorStop(1, 'rgba(10,26,50,0.95)');
    ctx.fillStyle = tg;
    ctx.fillRect(0, H - 46, W, 46);
    if (aftermath) {
      // residual glitch scars
      const rnd = mulberry32((this.time * 7 | 0) + 91);
      if (rnd() < 0.5) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        for (let i = 0; i < 4; i++) {
          const y = rnd() * H, h = 1 + rnd() * 6;
          const dx = (rnd() - 0.5) * 90;
          ctx.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
        }
        ctx.restore();
      }
    }
    ctx.textAlign = 'left';
  }

  _drawStatic(ctx) {
    ctx.drawImage(this.noiseCanvas, 0, 0, W, H);
    ctx.fillStyle = 'rgba(20,80,160,0.22)';
    ctx.fillRect(0, 0, W, H);
  }

  // ----------------------------------------------------------------- bsod
  _drawBsod(ctx, s) {
    const t = this.time;
    const BG = '#0078D7';
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // ---- subtle screen shimmer (very light, keeps it "alive")
    const shim = 0.03 + 0.02 * Math.sin(t * 2.1);
    ctx.fillStyle = `rgba(255,255,255,${shim * s})`;
    ctx.fillRect(0, 0, W, H);

    const L = 132;                      // left margin
    const faceX = L + 60, faceY = 205;  // face anchor (glyph grows around this)
    const fontBase = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

    // dark halo grows behind face
    if (s > 0.12) {
      const rad = 120 + s * 520;
      const hg = ctx.createRadialGradient(faceX, faceY, 20, faceX, faceY, rad);
      hg.addColorStop(0, `rgba(0,18,44,${0.34 * s})`);
      hg.addColorStop(1, 'rgba(0,18,44,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(faceX - rad, faceY - rad, rad * 2, rad * 2);
    }

    // ---- message text (bends toward face as s grows)
    const msg1 = 'Your PC ran into a problem and needs to restart. We\'re';
    const msg2 = 'just collecting some error info, and then we\'ll restart for you.';
    const bodyX = L + 258;
    const bodyY = 150;
    ctx.font = `300 27px ${fontBase}`;
    ctx.fillStyle = '#ffffff';
    const bend = s * 0.9;
    this._bendText(ctx, msg1, bodyX, bodyY, faceX, faceY, bend);
    this._bendText(ctx, msg2, bodyX, bodyY + 42, faceX, faceY, bend);

    // ---- percent
    const pct = Math.min(99, Math.floor(this.percent));
    let pctStr = pct + '% complete';
    if (s > 0.35 && ((t * 3) | 0) % 4 === 0) {
      const hex = ((t * 7919) | 0).toString(16).toUpperCase().padStart(6, '0');
      pctStr = `0x${hex.slice(0, 4)}% complete`;
    }
    ctx.font = `300 27px ${fontBase}`;
    ctx.fillStyle = '#ffffff';
    this._bendText(ctx, pctStr, L + 258, 288, faceX, faceY, bend);

    // ---- the face itself (morphs out of the literal ":(" glyph)
    this._drawFace(ctx, faceX, faceY, s, t);

    // ---- bottom support block
    const qrX = L, qrY = 508, qrS = 112;
    this._drawQR(ctx, qrX, qrY, qrS, s, t);
    ctx.font = `300 21px ${fontBase}`;
    ctx.fillStyle = '#ffffff';
    const infoY = 522;
    const infoX = L + qrS + 34;
    const lines = [
      'For more information about this issue and possible fixes, visit',
      'https://www.windows.com/stopcode',
      'If you call a support person, give them this info:',
      'Stop code: CRITICAL_PROCESS_DIED',
    ];
    for (let i = 0; i < lines.length; i++) {
      const jitter = s > 0.4 && ((t * 5) | 0) % 7 === i ? (Math.random() - 0.5) * 8 * s : 0;
      ctx.fillText(lines[i], infoX + jitter, infoY + i * 31);
    }

    // ---- corruption overlays
    if (s > 0.05) this._tearRows(ctx, s, t);
    if (s > 0.5) this._glyphSwirl(ctx, s, t);
    if (s > 0.2) {
      // scanlines
      ctx.save();
      ctx.globalAlpha = 0.05 + s * 0.12;
      ctx.fillStyle = '#000';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.restore();
    }
  }

  _bendText(ctx, text, x, y, cx, cy, bend) {
    if (bend < 0.02) { ctx.fillText(text, x, y); return; }
    // progressive horizontal displacement toward the face center
    const per = ctx.measureText(text).width / text.length;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const px = x + i * per;
      const dx = cx - px, dy = cy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const pull = bend * 46 / (1 + d * 0.012);
      const off = Math.sign(dx) * pull * (0.55 + 0.45 * Math.sin(i * 12.9898 + this.time * 2.4));
      ctx.fillText(ch, px + off, y + (Math.random() - 0.5) * bend * 3);
    }
  }

  // ------------------------------------------------------------------ face
  _drawFace(ctx, cx, cy, s, t) {
    const fontBase = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    const size = 150 * (1 + s * 1.9);
    const rnd = mulberry32((t * 10 | 0) + 7);
    const sm = (a, b, v) => {
      const k = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };

    if (s < 0.04) {
      // pristine ":(" — the real glyph, nothing else
      ctx.font = `300 ${size}px ${fontBase}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(':(', cx - size * 0.32, cy + size * 0.36);
      return;
    }

    // jitter offset for the whole face
    const jx = (rnd() - 0.5) * 14 * s, jy = (rnd() - 0.5) * 10 * s;
    cx += jx; cy += jy;

    // crossfade: the glyph IS the face — it dissolves while the drawn face grows out of it
    const glyphAlpha = 1 - sm(0.10, 0.40, s);

    // RGB fringes early on
    if (s > 0.04 && glyphAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.5 * s * glyphAlpha;
      ctx.font = `300 ${size}px ${fontBase}`;
      ctx.fillStyle = '#ff3b6b';
      ctx.fillText(':(', cx - size * 0.32 - 6 * s, cy + size * 0.36);
      ctx.fillStyle = '#2bfff0';
      ctx.fillText(':(', cx - size * 0.32 + 6 * s, cy + size * 0.36);
      ctx.restore();
    }

    // the original glyph itself — fades out as the drawn face fades in
    if (glyphAlpha > 0.015) {
      ctx.save();
      ctx.globalAlpha = glyphAlpha;
      ctx.font = `300 ${size}px ${fontBase}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(':(', cx - size * 0.32, cy + size * 0.36);
      ctx.restore();
    }

    // ---- eye targets: the two dots of ":" migrate into side-by-side eyes
    const eLerp = Math.min(1, s * 1.45);
    const colonX = cx - size * 0.135, colonY = cy - size * 0.12; // original ":" column
    const dotR = size * (0.055 + s * 0.115);
    const eyeSep = size * 0.30;
    const eyeY = cy - size * 0.10;
    const lx = colonX + (cx - eyeSep - colonX) * eLerp;
    const ly = colonY - size * 0.14 + (eyeY - (colonY - size * 0.14)) * eLerp;
    const rx2 = colonX + (cx + eyeSep - colonX) * eLerp;
    const ry2 = colonY + size * 0.14 + (eyeY - (colonY + size * 0.14)) * eLerp;

    // mouth: the "(" arc, opening wider and wider (THE same glyph, morphing)
    const arcW = size * (0.42 + s * 0.52), arcH = size * (0.52 + s * 0.72);
    const mouthY = cy + size * (0.30 + s * 0.22);

    // ---- face contour: rough circle emerging from noise rings
    if (s > 0.3) {
      ctx.save();
      const R = size * (0.75 + s * 1.25);
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
        const n = 0.82 + 0.30 * Math.sin(a * 7 + t * 1.7) * Math.sin(a * 3 - t * 0.9) + (rnd() - 0.5) * 0.10;
        const px = cx + Math.cos(a) * R * n * 1.06;
        const py = cy + Math.sin(a) * R * n * 0.98;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const fg = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.15);
      fg.addColorStop(0, `rgba(2, 22, 52, ${0.72 * s})`);
      fg.addColorStop(0.72, `rgba(0, 30, 72, ${0.5 * s})`);
      fg.addColorStop(1, 'rgba(0, 40, 90, 0)');
      ctx.fillStyle = fg;
      ctx.fill();
      // rim of glyph fragments
      ctx.globalAlpha = 0.75 * s;
      ctx.font = `300 ${16 + s * 26}px ${fontBase}`;
      ctx.fillStyle = 'rgba(190,225,255,0.85)';
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = R * (1.02 + rnd() * 0.22);
        const frag = ['0x', ':(', 'FF', 'ERR', '::', 'NULL', '####', '7F', '0x00', '???'][(rnd() * 10) | 0];
        ctx.save();
        ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        ctx.rotate(a + Math.PI / 2 + Math.sin(t + i) * 0.3);
        ctx.fillText(frag, -10, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    // ---- eyes (fade in as the glyph's colon fades out)
    const eyeAlpha = sm(0.10, 0.34, s);
    if (eyeAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = eyeAlpha;
    for (const [ex, ey] of [[lx, ly], [rx2, ry2]]) {
      // socket
      const sg = ctx.createRadialGradient(ex, ey, dotR * 0.1, ex, ey, dotR * (2.2 + s * 1.6));
      sg.addColorStop(0, `rgba(2, 10, 26, ${0.55 + s * 0.4})`);
      sg.addColorStop(1, 'rgba(2, 10, 26, 0)');
      ctx.fillStyle = sg;
      ctx.fillRect(ex - dotR * 4, ey - dotR * 4, dotR * 8, dotR * 8);

      // eyeball
      const eg = ctx.createRadialGradient(ex - dotR * 0.25, ey - dotR * 0.3, dotR * 0.12, ex, ey, dotR);
      eg.addColorStop(0, s < 0.35 ? '#ffffff' : '#c9e6ff');
      eg.addColorStop(0.55, s < 0.35 ? '#e8f2ff' : '#2e77d8');
      eg.addColorStop(1, '#08264f');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, ey, dotR, 0, Math.PI * 2);
      ctx.fill();

      // pupil tracks the cursor
      const px = (this.cursor.x - 0.17) * 2, py = (this.cursor.y - 0.29) * 2;
      const pupilR = dotR * (s < 0.5 ? 0.42 : 0.30);
      ctx.fillStyle = '#02070f';
      ctx.beginPath();
      if (s < 0.55) {
        ctx.arc(ex + px * dotR * 0.5, ey + py * dotR * 0.5, pupilR, 0, Math.PI * 2);
      } else {
        // slit pupil
        const sx = ex + px * dotR * 0.45, sy = ey + py * dotR * 0.45;
        ctx.ellipse(sx, sy, pupilR * 0.42, pupilR * 1.9, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      if (s > 0.45) {
        ctx.strokeStyle = `rgba(120,200,255,${0.5 * s})`;
        ctx.lineWidth = dotR * 0.12;
        ctx.beginPath();
        ctx.arc(ex, ey, dotR * 1.12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    }

    // ---- mouth: the "(" itself, thickening, curving open, becoming the cavity
    ctx.save();
    ctx.globalAlpha = Math.max(sm(0.03, 0.15, s), 0.02);
    if (s < 0.3) {
      // still recognisably the frown arc, just heavier / wobbling
      ctx.lineWidth = 16 + s * 42;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      const start = Math.PI * (0.72 - s * 0.22), end = Math.PI * (0.28 + s * 0.22) + Math.PI;
      for (let a = start; a <= end; a += 0.05) {
        const wob = 1 + 0.06 * Math.sin(a * 9 + t * 3.2) * s;
        const px = cx + Math.cos(a) * arcW * wob;
        const py = mouthY + Math.sin(a) * arcH * wob * 0.72;
        if (a === start) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else {
      // open cavity — filled void that used to be the "(" interior
      const open = Math.min(1, (s - 0.3) / 0.7);
      ctx.beginPath();
      const steps = 42;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const a = Math.PI * (0.82 - 0.64 * open) + u * Math.PI * (0.36 + 1.28 * open);
        const wob = 1 + 0.16 * Math.sin(a * 11 + t * 2.6) * open + (rnd() - 0.5) * 0.07 * open;
        const px = cx + Math.cos(a) * arcW * wob * (1 + open * 0.35);
        const py = mouthY + Math.sin(a) * arcH * wob * (0.8 + open * 0.5);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const mg = ctx.createRadialGradient(cx, mouthY + arcH * 0.2, arcW * 0.05, cx, mouthY, arcW * 1.6);
      mg.addColorStop(0, '#000308');
      mg.addColorStop(0.7, '#01122c');
      mg.addColorStop(1, `rgba(10,60,120,${0.25 + open * 0.55})`);
      ctx.fillStyle = mg;
      ctx.fill();
      // rim
      ctx.lineWidth = 3 + open * 12;
      ctx.strokeStyle = `rgba(130,190,255,${0.35 + open * 0.5})`;
      ctx.stroke();
      // teeth — spikes growing from the same rim
      const teeth = 5 + Math.floor(open * 7);
      ctx.fillStyle = 'rgba(200,228,255,0.82)';
      for (let i = 0; i < teeth; i++) {
        const a = Math.PI * (0.86 - 0.7 * open) + (i + 0.5) / teeth * Math.PI * (0.28 + 1.44 * open);
        const bx = cx + Math.cos(a) * arcW * (1 + open * 0.35);
        const by = mouthY + Math.sin(a) * arcH * (0.8 + open * 0.5);
        const len = dotR * (0.6 + open * 1.7) * (0.7 + rnd() * 0.6);
        const tw = len * 0.34;
        const dirIn = Math.atan2(mouthY - by, cx - bx);
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(dirIn + (rnd() - 0.5) * 0.5);
        ctx.beginPath();
        ctx.moveTo(-tw, 0);
        ctx.lineTo(tw, 0);
        ctx.lineTo(0, len);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // glyph rain falling INTO the mouth
      if (open > 0.35) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - arcW * 1.4, mouthY - arcH * 0.2, arcW * 2.8, arcH * 1.8);
        ctx.clip();
        ctx.font = `300 ${13 + open * 16}px ${fontBase}`;
        ctx.fillStyle = `rgba(140,190,255,${open * 0.55})`;
        for (let i = 0; i < 22; i++) {
          const gx = cx + (rnd() - 0.5) * arcW * 2.4;
          const gy = mouthY + ((rnd() * 900 + t * 260 * (0.5 + rnd())) % (arcH * 1.7)) - arcH * 0.15;
          ctx.fillText(['0x0000', ':(', 'FFFF', 'NULL', '####', 'PAGE', '???', '0x7F'][(rnd() * 8) | 0], gx, gy);
        }
        ctx.restore();
      }
    }
    ctx.restore();

    // ghost of the original glyph inside the visage (the ancestry of the face)
    if (s > 0.5 && s < 0.98) {
      ctx.save();
      ctx.globalAlpha = 0.16 * (1 - s);
      ctx.font = `300 ${150}px ${fontBase}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(':(', cx - 48, cy + 55);
      ctx.restore();
    }
  }

  _tearRows(ctx, s, t) {
    const rnd = mulberry32((t * 31 | 0) + 5);
    const rows = Math.floor(2 + s * 14);
    ctx.save();
    for (let i = 0; i < rows; i++) {
      const y = rnd() * H;
      const h = 2 + rnd() * 18 * s;
      const dx = (rnd() - 0.5) * 120 * s;
      ctx.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
    }
    ctx.restore();
    if (s > 0.6 && rnd() < 0.3) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(this.noiseCanvas, (rnd() * 200) | 0, 0, W * 0.5, H, (rnd() * 200) | 0, 0, W * 0.5, H);
      ctx.restore();
    }
  }

  _glyphSwirl(ctx, s, t) {
    ctx.save();
    ctx.globalAlpha = 0.35 * (s - 0.5) * 2;
    const fontBase = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.font = `300 30px ${fontBase}`;
    const rnd = mulberry32((t * 17 | 0) + 3);
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2 + t * (0.15 + rnd() * 0.4);
      const r = 180 + rnd() * 620;
      const px = W * 0.5 + Math.cos(a) * r * 0.9;
      const py = H * 0.42 + Math.sin(a) * r * 0.55;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a + t * 0.6);
      ctx.fillStyle = ['rgba(200,230,255,0.8)', 'rgba(80,160,255,0.8)', 'rgba(10,40,90,0.8)'][(rnd() * 3) | 0];
      ctx.fillText(['0x', ':(', 'FF', 'ERR', 'NULL', '##', '::', 'WAKE?'][(rnd() * 8) | 0], -18, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------- QR
  _drawQR(ctx, x, y, size, s, t) {
    const n = 21, m = size / n;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - 6, size + 12, size + 12);
    ctx.fillStyle = '#000000';
    const rnd = mulberry32(424242);
    const isFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        let on;
        if (isFinder(r, c)) {
          const rr = r % (n - 7), cc = c % (n - 7);
          const lr = r >= n - 7 ? r - (n - 7) : r, lc = c >= n - 7 ? c - (n - 7) : c;
          const ed = Math.max(Math.abs(lr - 3), Math.abs(cc >= 7 ? c - (n - 4) : c - 3), Math.abs(lr - 3));
          on = ed !== 2 && (ed <= 2 || ed === 3 ? ed <= 3 && ed !== 2 : false);
          on = (Math.max(Math.abs(lr - 3), Math.abs(lc - 3)) !== 2) && Math.max(Math.abs(lr - 3), Math.abs(lc - 3)) <= 3;
        } else {
          on = rnd() < 0.48;
        }
        if (on) {
          let dx = 0;
          if (s > 0.5 && ((t * 9) | 0) % 5 === r % 5) dx = (Math.random() - 0.5) * 14 * s;
          ctx.fillRect(x + c * m + dx, y + r * m, m + 0.6, m + 0.6);
        }
      }
    }
    if (s > 0.75) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.canvas, x, y + 20, size, size * 0.3, x + 6, y + 20, size, size * 0.3);
      ctx.restore();
    }
  }
}
