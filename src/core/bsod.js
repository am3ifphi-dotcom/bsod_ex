import * as THREE from 'three';

/**
 * The blue screen.
 *
 * It is not an image of a BSOD — it is a live canvas that follows the real
 * Windows 10 layout, and then deforms *out of its own typography*:
 * the ":" becomes two eyes, the "(" and ")" open into a mouth, the error
 * lines become teeth. Nothing appears from nowhere: the face is made of
 * the error screen itself.
 */
export class BSOD {
  constructor(w = 1920, h = 1080) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.base = document.createElement('canvas');
    this.base.width = w; this.base.height = h;
    this.bctx = this.base.getContext('2d');

    this.stage = 0;         // 0 = pristine, 1 = fully eaten
    this.standby = false;   // monitor is on, but only the backlight is alive
    this.hover = false;
    this.t = 0;
    this.fontReady = false;
    this.stopCode = 'CRITICAL_PROCESS_DIED';
    this.progress = 0;
    this.pupil = { x: 0, y: 0 };
    this.blink = 0;
    this._lastPercent = -1;
    this.faceRect = { x: 0, y: 0, w: 0, h: 0 };
    this._buildBase();
  }

  async loadFonts() {
    try {
      const faces = [
        new FontFace('Selawik', 'url(/fonts/selawkl.ttf)', { weight: '300' }),
        new FontFace('Selawik', 'url(/fonts/selawk.ttf)', { weight: '400' }),
        new FontFace('Selawik', 'url(/fonts/selawkb.ttf)', { weight: '700' }),
      ];
      for (const f of faces) await f.load();
      faces.forEach((f) => document.fonts.add(f));
      this.fontReady = true;
    } catch (e) {
      this.fontReady = false;
    }
    this._buildBase();
  }

  _font(weight, size) {
    return `${weight} ${size}px Selawik, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  }

  // ------------------------------------------------------------------ layout
  _layout() {
    const W = this.w, H = this.h;
    return {
      x: W * 0.088,
      faceSize: H * 0.2,
      faceY: H * 0.355,
      bodyY: H * 0.485,
      bodySize: H * 0.0325,
      lineH: H * 0.0475,
      smallSize: H * 0.0245,
      qrY: H * 0.705,
      qrSize: H * 0.155,
      W, H,
    };
  }

  _buildBase() {
    const c = this.bctx, L = this._layout();
    c.clearRect(0, 0, this.w, this.h);
    // Windows 10 blue
    const g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0a7bd8');
    g.addColorStop(0.55, '#0078d7');
    g.addColorStop(1, '#0066bd');
    c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);

    // very subtle panel light so the surface is not dead flat
    const rg = c.createRadialGradient(this.w * 0.5, this.h * 0.32, 0, this.w * 0.5, this.h * 0.32, this.h * 0.9);
    rg.addColorStop(0, 'rgba(120,190,255,0.10)');
    rg.addColorStop(1, 'rgba(0,40,90,0.22)');
    c.fillStyle = rg; c.fillRect(0, 0, this.w, this.h);

    c.textBaseline = 'alphabetic';
    c.fillStyle = '#ffffff';

    // ---- the sad face -------------------------------------------------
    c.font = this._font(300, L.faceSize);
    const faceText = ':(';
    const fm = c.measureText(faceText);
    this.faceRect = {
      x: L.x - 6, y: L.faceY - L.faceSize * 0.78,
      w: fm.width + 12, h: L.faceSize * 0.95,
    };
    c.fillText(faceText, L.x, L.faceY);

    // ---- main message -------------------------------------------------
    c.font = this._font(400, L.bodySize);
    const lines = [
      'Your PC ran into a problem and needs to restart. We\u2019re just',
      'collecting some error info, and then we\u2019ll restart for you.',
    ];
    lines.forEach((line, i) => c.fillText(line, L.x, L.bodyY + i * L.lineH));

    // ---- progress (redrawn live) -------------------------------------
    // ---- QR + stop code ----------------------------------------------
    const qx = L.x, qy = L.qrY;
    this._drawQR(c, qx, qy, L.qrSize);
    const tx = qx + L.qrSize + L.H * 0.028;
    c.font = this._font(400, L.smallSize);
    const qrLines = [
      'For more information on this issue and possible fixes, visit',
      'https://www.windows.com/stopcode',
      '',
      'If you call a support person, give them this info:',
      'Stop code: ' + this.stopCode,
    ];
    const smallLine = L.smallSize * 1.62;
    const startY = qy + L.smallSize * 0.9;
    qrLines.forEach((line, i) => {
      c.fillStyle = i === qrLines.length - 1 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.9)';
      c.fillText(line, tx, startY + i * smallLine);
    });

    // ---- hairline scan texture, baked once ----------------------------
    c.globalAlpha = 0.035;
    c.fillStyle = '#000';
    for (let y = 0; y < this.h; y += 3) c.fillRect(0, y, this.w, 1);
    c.globalAlpha = 1;

    // corner vignette (photographed monitor feel)
    const vg = c.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.28, this.w / 2, this.h / 2, this.h * 0.92);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,10,25,0.22)');
    c.fillStyle = vg; c.fillRect(0, 0, this.w, this.h);
  }

  _drawQR(c, x, y, size) {
    const n = 25, m = size / n;
    c.fillStyle = '#ffffff';
    c.fillRect(x - m, y - m, size + m * 2, size + m * 2);
    c.fillStyle = '#0078d7';
    // deterministic noise
    let seed = 0x2f6e2b1;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const finder = (i < 7 && j < 7) || (i >= n - 7 && j < 7) || (i < 7 && j >= n - 7);
        if (finder) continue;
        if (rnd() > 0.52) c.fillRect(x + i * m, y + j * m, m * 0.92, m * 0.92);
      }
    }
    // finder patterns
    const drawFinder = (fx, fy) => {
      c.fillStyle = '#0078d7';
      c.fillRect(fx, fy, m * 7, m * 7);
      c.fillStyle = '#ffffff';
      c.fillRect(fx + m, fy + m, m * 5, m * 5);
      c.fillStyle = '#0078d7';
      c.fillRect(fx + m * 2, fy + m * 2, m * 3, m * 3);
    };
    drawFinder(x, y);
    drawFinder(x + (n - 7) * m, y);
    drawFinder(x, y + (n - 7) * m);
  }

  // ------------------------------------------------------------------ update
  update(t, dt, { stage = 0, hover = false, out = 0, pupil = null } = {}) {
    this.t = t;
    this.stage = stage;
    this.hover = hover;
    if (pupil) { this.pupil.x = pupil.x; this.pupil.y = pupil.y; }
    this.blink = Math.max(0, this.blink - dt);
    if (Math.random() < dt * 0.13) this.blink = 0.14;

    // progress crawls, and jams when the screen is being eaten
    const jam = stage > 0.05 && Math.random() < 0.25;
    if (!jam) this.progress = Math.min(99, this.progress + dt * (stage > 0.1 ? 3.4 : 0.85));

    const c = this.ctx;
    const L = this._layout();

    c.save();
    c.clearRect(0, 0, this.w, this.h);
    if (this.standby) {
      // just the panel's blue backlight — painted once, then reused
      if (!this._standbyCanvas) {
        const sc = document.createElement('canvas');
        sc.width = this.w; sc.height = this.h;
        const sx = sc.getContext('2d');
        const g = sx.createLinearGradient(0, 0, 0, this.h);
        g.addColorStop(0, '#0b6fc4');
        g.addColorStop(0.5, '#0a5fae');
        g.addColorStop(1, '#074c92');
        sx.fillStyle = g; sx.fillRect(0, 0, this.w, this.h);
        const rg = sx.createRadialGradient(this.w * 0.3, this.h * 0.55, 0, this.w * 0.3, this.h * 0.55, this.h * 1.1);
        rg.addColorStop(0, 'rgba(90,170,240,0.20)');
        rg.addColorStop(1, 'rgba(0,20,50,0.35)');
        sx.fillStyle = rg; sx.fillRect(0, 0, this.w, this.h);
        this._standbyCanvas = sc;
      }
      c.drawImage(this._standbyCanvas, 0, 0);
      c.restore();
      this.texture.needsUpdate = true;
      return;
    }
    c.drawImage(this.base, 0, 0);

    // live progress line
    c.font = this._font(400, L.bodySize);
    c.fillStyle = '#ffffff';
    const pct = stage > 0.92 ? '100' : Math.floor(this.progress);
    c.fillText(`${pct}% complete`, L.x, L.bodyY + 2 * L.lineH * 1.12);

    // hover: thin selection frame around the face, like a focused UI element
    if (hover && stage < 0.9) {
      const f = this.faceRect;
      const pad = 18;
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 2;
      c.setLineDash([10, 7]);
      c.strokeRect(f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2);
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2);
    }

    if (stage > 0.001) this._corrupt(c, L, stage);

    c.restore();
    this.texture.needsUpdate = true;
  }

  // -------------------------------------------------------------- corruption
  /** Where the two glyph groups of " :( " actually sit — the face grows out of them. */
  _anchors(L) {
    const f = this.faceRect;
    const size = L.faceSize;
    return {
      eyeX: f.x + f.w * 0.20,
      eyeY: f.y + f.h * 0.50,
      mouthX: f.x + f.w * 0.72,
      mouthY: f.y + f.h * 0.54,
      size,
    };
  }

  _corrupt(c, L, s) {
    const W = this.w, H = this.h;
    const t = this.t;
    const A = this._anchors(L);

    // 1. the text itself is dragged toward the parenthesis (pristine source only,
    //    so the image never smears into noise)
    if (s > 0.22) {
      const rows = 44;
      const k = Math.min(1, (s - 0.22) / 0.5);
      for (let i = 0; i < rows; i++) {
        const y = (i / rows) * H;
        const d = Math.abs(y - A.mouthY) / (H * 0.55);
        const pull = Math.exp(-d * d * 2.0) * k * 64;
        const wob = Math.sin(t * 1.5 + i * 2.1) * 4 * k;
        c.drawImage(this.base, 0, y, W, H / rows, wob * 0.35, y - pull * 0.05, W, H / rows * 1.02);
      }
    }

    // 2. the mouth and eyes: made of the glyphs, drawn crisp on top of the mess
    if (s > 0.12) this._drawMouth(c, L, s, A);
    if (s > 0.2) this._drawEyes(c, L, s, A);

    // 3. error glyphs escaping the layout
    if (s > 0.45) {
      c.font = this._font(400, H * 0.019);
      const glyphs = ':(your pc ran into a problem 0x000000 STOP wake_up '.split('');
      const n = 40 * (s - 0.45) / 0.55;
      for (let i = 0; i < n; i++) {
        c.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.10})`;
        const gx = Math.random() * W;
        const gy = (Math.random() * H + t * (20 + Math.random() * 90)) % H;
        c.fillText(glyphs[(Math.random() * glyphs.length) | 0], gx, gy);
      }
    }

    // 4. a few horizontal tears, always sampled from the pristine image
    if (s > 0.1) {
      const slices = Math.floor(2 + s * 7);
      for (let i = 0; i < slices; i++) {
        const y = Math.random() * H;
        const h = 3 + Math.random() * (10 + s * 46);
        const dx = (Math.random() - 0.5) * (8 + s * 90);
        try { c.drawImage(this.base, 0, y, W, h, dx, y, W, h); } catch (e) {}
      }
    }

    // 5. white bloom / overexposure as it gets close
    if (s > 0.86) {
      c.fillStyle = `rgba(190,225,255,${(s - 0.86) * 1.6})`;
      c.fillRect(0, 0, W, H);
    }
    if (s > 0.96) {
      c.fillStyle = `rgba(255,255,255,${Math.min(1, (s - 0.96) * 10)})`;
      c.fillRect(0, 0, W, H);
    }
  }

  /** "(" and ")" open into a mouth; teeth grow from the inner edges. */
  _drawMouth(c, L, s, A) {
    const W = this.w, H = this.h, t = this.t;
    const grow = Math.min(1, (s - 0.1) / 0.72);
    const e = grow * grow * (3 - 2 * grow);
    // the mouth opens exactly where the "(" is, and grows outward from it
    const cx = A.mouthX + (W * 0.5 - A.mouthX) * e;
    const cy = A.mouthY + (H * 0.56 - A.mouthY) * e;
    const rx = H * (0.030 + 0.185 * e);
    const ry = H * (0.105 + 0.315 * e);
    const rot = -0.05 + Math.sin(t * 0.7) * 0.035 * e;

    // organic outline: a closed loop whose radius is modulated by noise, so the
    // opening reads as something tearing through the screen, not a vector oval
    const N = 72;
    const outline = (scale, wobAmp) => {
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const w1 = Math.sin(a * 3 + t * 0.9) * 0.5 + Math.sin(a * 7 - t * 1.7) * 0.28 + Math.sin(a * 13 + t * 2.6) * 0.14;
        const r = 1 + w1 * wobAmp + Math.sin(a * 23 + i * 1.7) * wobAmp * 0.35;
        const x = Math.cos(a) * rx * scale * r;
        const y = Math.sin(a) * ry * scale * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath();
    };

    c.save();
    c.translate(cx, cy);
    c.rotate(rot);

    // ink bleeding out of the glyph (shadowBlur is far cheaper than a canvas filter)
    c.save();
    c.shadowColor = 'rgba(0,4,10,0.9)';
    c.shadowBlur = H * 0.05;
    c.fillStyle = `rgba(0,4,10,${0.5 + 0.3 * e})`;
    outline(1.14, 0.1);
    c.fill();
    c.restore();

    // the wet lip, slightly brighter than the blue behind it
    const lip = c.createLinearGradient(-rx, -ry, rx, ry);
    lip.addColorStop(0, 'rgba(228,242,255,0.85)');
    lip.addColorStop(0.35, 'rgba(150,195,235,0.65)');
    lip.addColorStop(0.7, 'rgba(70,120,175,0.55)');
    lip.addColorStop(1, 'rgba(220,238,255,0.8)');
    c.strokeStyle = lip;
    c.lineWidth = H * (0.006 + 0.026 * e);
    c.lineJoin = 'round';
    outline(1, 0.055);
    c.stroke();

    // the throat: black, but never flat — a faint wet glow deep inside
    const throat = c.createRadialGradient(0, -ry * 0.15, ry * 0.05, 0, 0, ry * 1.02);
    throat.addColorStop(0, '#000000');
    throat.addColorStop(0.55, '#000306');
    throat.addColorStop(0.86, '#02080f');
    throat.addColorStop(1, '#04121e');
    c.fillStyle = throat;
    outline(0.965, 0.055);
    c.fill();
    c.save();
    c.clip();
    const wet = c.createRadialGradient(0, ry * 0.3, 0, 0, ry * 0.3, ry * 0.7);
    wet.addColorStop(0, `rgba(96,164,230,${0.10 + 0.10 * Math.sin(t * 1.3)})`);
    wet.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = wet;
    c.fillRect(-rx * 1.3, -ry * 1.3, rx * 2.6, ry * 2.6);
    // slow crawl of the error text inside the throat
    c.globalAlpha = 0.16 + 0.1 * e;
    c.fillStyle = '#cfe6ff';
    c.font = this._font(400, H * 0.012);
    const words = '0x0000000C CRITICAL_PROCESS_DIED 0% complete wake_up :( ';
    for (let i = 0; i < 26; i++) {
      const yy = ((i * 37 + t * (9 + i)) % (ry * 2.1)) - ry * 1.05;
      const xx = Math.sin(i * 2.3 + t * 0.4) * rx * 0.7;
      c.fillText(words.slice(0, 6 + (i % 14)), xx - rx * 0.3, yy);
    }
    c.globalAlpha = 1;
    c.restore();

    // teeth: uneven, some broken, some missing — grown from the lip
    const teeth = Math.max(7, Math.floor(9 + e * 21));
    const chatter = Math.sin(t * (5 + e * 11)) * (0.2 + e * 1.6);
    for (let row = 0; row < 2; row++) {
      const top = row === 0;
      for (let i = 0; i < teeth; i++) {
        if (((i * 7 + row * 3) % 11) === 0) continue;            // gaps
        const a = (i / teeth) * Math.PI * 2 + row * 0.11;
        const sgn = top ? -1 : 1;
        const wob = Math.sin(a * 5 + t * 2.2) * 0.05 * e;
        const px = Math.cos(a) * rx * (0.94 + wob);
        const py = Math.sin(a) * ry * (0.94 + wob);
        const len = H * (0.006 + 0.052 * e) * (0.45 + Math.abs(Math.sin(a * 3.1 + t * 0.7)) * 1.15) + chatter;
        const wid = (H * 0.006 + e * H * 0.016) * (0.5 + 0.7 * Math.abs(Math.cos(a * 2.3)));
        c.save();
        c.translate(px, py);
        c.rotate(Math.atan2(-py, -px) + Math.PI / 2 + Math.sin(a * 4 + t) * 0.12);
        c.beginPath();
        c.moveTo(-wid / 2, 0);
        c.lineTo(wid / 2, 0);
        c.lineTo(wid * 0.18 + Math.sin(a * 9) * wid * 0.12, sgn * len);
        c.closePath();
        const tg = c.createLinearGradient(0, 0, 0, sgn * len);
        tg.addColorStop(0, 'rgba(224,240,255,0.95)');
        tg.addColorStop(1, 'rgba(120,170,215,0.35)');
        c.fillStyle = tg;
        c.fill();
        c.restore();
      }
    }

    // ink running out of the bottom of the mouth and down the screen
    if (e > 0.3) {
      c.save();
      c.shadowColor = 'rgba(120,180,240,0.5)';
      c.shadowBlur = H * 0.008;
      c.strokeStyle = `rgba(2,6,12,${0.35 + 0.25 * e})`;
      c.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const wob2 = Math.sin(t * 0.6 + i * 2.1);
        const x0 = (i - 2.5) * rx * 0.22;
        const len = ry * (0.5 + 0.9 * Math.abs(wob2)) * e;
        c.lineWidth = H * 0.004 * (1 + Math.abs(wob2));
        c.beginPath();
        c.moveTo(x0, ry * 0.86);
        c.quadraticCurveTo(x0 + rx * 0.06, ry * 0.9 + len * 0.5, x0 + rx * 0.02, ry * 0.9 + len);
        c.stroke();
      }
      c.restore();
    }
    c.restore();
  }

  /** The ":" becomes two pupils that track the player. */
  _drawEyes(c, L, s, A) {
    const W = this.w, H = this.h, t = this.t;
    const e = Math.min(1, (s - 0.16) / 0.55);
    const cx = A.eyeX;
    const cy = A.eyeY - H * 0.02 * e;
    const dx = H * (0.012 + 0.055 * e);
    const rx = H * (0.016 + 0.042 * e);
    const ry = H * (0.020 + 0.062 * e);
    const blink = this.blink > 0 ? Math.max(0.06, Math.abs(Math.cos(this.blink * 40))) : 1;

    for (let i = 0; i < 2; i++) {
      const ex = cx + (i === 0 ? -dx : dx);
      c.save();
      c.translate(ex, cy);
      // sclera / socket is the dot of the colon, stretched
      c.beginPath(); c.ellipse(0, 0, rx * 1.12, ry * blink, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(2,8,16,0.98)'; c.fill();
      c.lineWidth = H * 0.0035 + e * H * 0.003;
      c.strokeStyle = 'rgba(180,220,250,0.5)';
      c.stroke();

      // iris
      const px = this.pupil.x * rx * 0.42;
      const py = this.pupil.y * ry * 0.35;
      const ir = rx * 0.52;
      const irGrad = c.createRadialGradient(px, py, ir * 0.1, px, py, ir);
      irGrad.addColorStop(0, 'rgba(170,215,255,0.95)');
      irGrad.addColorStop(0.7, 'rgba(40,90,140,0.85)');
      irGrad.addColorStop(1, 'rgba(0,10,20,0.1)');
      c.beginPath(); c.ellipse(px, py, ir, ir * (0.8 + 0.2 * blink), 0, 0, Math.PI * 2);
      c.fillStyle = irGrad; c.fill();
      // pupil
      c.beginPath(); c.ellipse(px, py, ir * 0.42, ir * 0.5, 0, 0, Math.PI * 2);
      c.fillStyle = '#000'; c.fill();
      // glint
      c.beginPath(); c.ellipse(px - ir * 0.2, py - ir * 0.25, ir * 0.12, ir * 0.12, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();

      // veins made of the error lines
      if (e > 0.35) {
        c.strokeStyle = `rgba(200,230,255,${0.16 + 0.12 * Math.sin(t * 2 + i)})`;
        c.lineWidth = H * 0.0018;
        for (let v = 0; v < 5; v++) {
          const a = Math.random() * Math.PI * 2;
          c.beginPath();
          c.moveTo(Math.cos(a) * rx * 0.3, Math.sin(a) * ry * 0.3);
          c.quadraticCurveTo(Math.cos(a + 0.6) * rx * 0.8, Math.sin(a + 0.6) * ry * 0.8,
            Math.cos(a + 0.2) * rx * 1.25, Math.sin(a + 0.2) * ry * 1.2);
          c.stroke();
        }
      }
      c.restore();
    }
  }

  /** UV hit test (0..1) against the sad face glyph — the clickable thing. */
  hitTest(uv) {
    const f = this.faceRect;
    const x = uv.x * this.w;
    const y = (1 - uv.y) * this.h; // canvas y is flipped vs UV
    const pad = 40;
    return x > f.x - pad && x < f.x + f.w + pad && y > f.y - pad && y < f.y + f.h + pad;
  }
}
