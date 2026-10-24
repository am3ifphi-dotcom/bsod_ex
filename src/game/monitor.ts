// The in-game BSOD monitor: a canvas-backed CRT that corrupts over clicks.
import * as THREE from 'three';
import { RNG, makeCanvas } from '../core/utils';

const W = 1024, H = 576;

export const MAX_STAGE = 5;
/** [clicks needed to reach stage 1,2,3,4,5] */
export const STAGE_CLICKS = [3, 7, 12, 18, 25];

const LINES = [
  ':(',
  '',
  'Your PC ran into a problem and needs to restart.',
  "We're just collecting some error info, and then we'll restart for you.",
  '',
  '0% complete',
  '',
  'For more information about this issue and possible fixes, visit',
  'https://support.example.com/stopcode',
  '',
  'If you call a support person, give them this info:',
  'Stop code: CRITICAL_PROCESS_DIED',
];

const CORRUPT = [
  'Stop code: MEMORY_MANAGEMENT_FAILURE_0x0000001A',
  'IRQL_NOT_LESS_OR_EQUAL   at 0xFFFFF8041A3C',
  'SYSTEM_THREAD_EXCEPTION_NOT_HANDLED',
  'ATTEMPTED_EXECUTE_OF_NOEXECUTE_MEMORY',
  'You are being read. 0x00 0xFF 0x00 0xFF 0x00',
  'STACK_OVERFLOW: \u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591',
  'too many rooms in the memory. delete a room? [Y/n]',
  'wake_up() returned -1',
  '0xDEADFACE 0xDEADFACE 0xDEADFACE',
  'PAGE_FAULT_IN_NONPAGED_AREA  (face.sys)',
];

export class MonitorScreen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  stage = 0;
  clicks = 0;
  /** 0..1 overall corruption used by other systems */
  corruption = 0;
  private dirty = true;
  private rng = new RNG(777);
  private t = 0;
  private drawTimer = 0;
  private glitchSeed = 1;
  private faceOpen = 0;
  private percent = 0;
  private lastStage = -1;

  // ":( " hot-spot in canvas pixels (kept in sync with draw())
  private faceRect = { x: 96, y: 150, w: 520, h: 470 };

  constructor() {
    const { c, ctx } = makeCanvas(W, H);
    this.canvas = c;
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.draw();
  }

  reset() {
    this.stage = 0; this.clicks = 0; this.corruption = 0; this.faceOpen = 0;
    this.percent = 0; this.lastStage = -1; this.dirty = true; this.draw();
  }

  /** Register a click on the screen; returns the new stage (or -1 for a miss). */
  click(u: number, v: number): number {
    if (!this.hitFace(u, v)) return -1;
    this.clicks++;
    let s = 0;
    for (let i = 0; i < STAGE_CLICKS.length; i++) if (this.clicks >= STAGE_CLICKS[i]) s = i + 1;
    this.stage = s;
    this.corruption = Math.min(1, this.clicks / STAGE_CLICKS[STAGE_CLICKS.length - 1]);
    this.glitchSeed = this.rng.next() * 1000;
    this.dirty = true;
    this.draw();
    return this.stage;
  }

  hitFace(u: number, v: number) {
    const x = u * W, y = v * H;
    const r = this.faceRect;
    // generous margin at low stages, tight and "correct" once corrupted
    const m = 26;
    return x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m;
  }

  update(dt: number) {
    this.t += dt;
    if (this.stage >= MAX_STAGE) this.faceOpen = Math.min(1, this.faceOpen + dt * 0.55);
    // animate corruption at a modest rate; static stages cost nothing
    if (this.stage > 0 || this.faceOpen > 0) {
      this.drawTimer += dt;
      const interval = this.stage >= 4 ? 1 / 22 : 1 / 10;
      if (this.drawTimer >= interval) {
        this.drawTimer = 0;
        this.percent = Math.min(99, this.percent + (this.stage >= 2 ? 0.55 : 0.12));
        this.draw();
      }
    }
  }

  private draw() {
    const ctx = this.ctx;
    const st = this.stage;
    const rng = new RNG(Math.floor(this.glitchSeed * 13 + st * 977));
    if (st !== this.lastStage) {
      this.lastStage = st;
      this.dirty = true;
    }

    // ---- background: authentic-ish BSOD blue with vertical gradient
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a52b8');
    g.addColorStop(0.55, '#0a4ea8');
    g.addColorStop(1, '#093f8c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ---- face glyph (kept large so the hot-spot is generous)
    const faceSize = 128 + st * 14 + Math.sin(this.t * 1.4) * (st >= 3 ? 10 : 2);
    ctx.fillStyle = '#f2f6ff';
    ctx.font = `300 ${faceSize}px 'Segoe UI', 'Hiragino Sans', 'Helvetica Neue', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(':(', 96, 150 - st * 3);
    this.faceRect = { x: 96, y: 150 - st * 3, w: faceSize * 2.1, h: faceSize * 1.05 };

    // ---- body text
    const bodySize = 26;
    ctx.font = `400 ${bodySize}px 'Segoe UI', 'Hiragino Sans', 'Helvetica Neue', sans-serif`;
    const top = 178;
    const lh = 40;
    let yy = top;
    for (let i = 1; i < LINES.length; i++) {
      const line = i === 5 ? `${Math.floor(this.percent)}% complete` : LINES[i];
      ctx.fillText(line, 96, yy);
      yy += lh;
    }

    // ---- stage corruption
    if (st >= 1) {
      // text jitter: re-draw random characters offset
      ctx.save();
      for (let i = 0; i < 12 * st; i++) {
        const x = rng.range(80, W - 200);
        const y = rng.range(150, H - 60);
        ctx.globalAlpha = rng.range(0.2, 0.8);
        ctx.fillStyle = rng.next() < 0.8 ? '#eaf2ff' : '#66a8ff';
        ctx.font = `${rng.range(12, 26)}px monospace`;
        const ch = String.fromCharCode(33 + Math.floor(rng.next() * 90));
        ctx.fillText(ch, x, y);
      }
      ctx.restore();
    }

    if (st >= 2) {
      // scanlines + band shift
      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = `rgba(0, 20, 60, ${0.06 + rng.range(0, 0.05)})`;
        ctx.fillRect(0, y, W, 1);
      }
      const bands = 4 + st * 3;
      for (let i = 0; i < bands; i++) {
        const by = rng.range(0, H), bh = rng.range(4, 40);
        const dx = rng.range(-40, 40) * (st / 5);
        try {
          ctx.drawImage(this.canvas, 0, by, W, bh, dx, by, W, bh);
        } catch { /* canvas source == target: ignore */ }
      }
    }

    if (st >= 3) {
      // RGB channel split (redrawn with offset and blending)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(this.canvas, -5 - st, 0);
      ctx.globalAlpha = 0.28;
      ctx.drawImage(this.canvas, 5 + st, 0);
      ctx.restore();

      // corrupted status text crawling up from the bottom
      ctx.save();
      ctx.font = '400 20px ui-monospace, Consolas, monospace';
      const n = 3 + st * 2;
      for (let i = 0; i < n; i++) {
        const line = CORRUPT[Math.floor(rng.next() * CORRUPT.length)];
        ctx.fillStyle = `rgba(230,240,255,${rng.range(0.35, 0.9)})`;
        ctx.fillText(line, 96, H - 70 - i * 26 - (st - 3) * 4);
      }
      ctx.restore();

      // broken window frames drawn on the screen
      for (let i = 0; i < st - 2; i++) {
        const x = rng.range(60, W - 260), y = rng.range(60, H - 160);
        const w = rng.range(120, 320), h = rng.range(60, 150);
        ctx.strokeStyle = `rgba(200,225,255,${rng.range(0.2, 0.5)})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, y, w, 18);
        ctx.fillStyle = 'rgba(220,238,255,0.55)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText('0x000000EA  FATAL_STRUCTURE', x + 6, y + 13);
      }
    }

    if (st >= 4) {
      // the face begins to take over: eyes and a widening mouth
      const cx = W * 0.5, cy = H * 0.52;
      const scale = 1 + (st - 4) * 0.55 + this.faceOpen * 1.6;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.5 + 0.4 * this.faceOpen;
      ctx.fillStyle = '#f4f8ff';
      // eyes
      ctx.beginPath();
      ctx.ellipse(-150, -90, 26, 44, 0, 0, Math.PI * 2);
      ctx.ellipse(150, -90, 26, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      // mouth
      const open = 24 + this.faceOpen * 190;
      ctx.beginPath();
      ctx.ellipse(0, 110, 60 + this.faceOpen * 190, open, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(2, 10, 32, ${0.85})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,246,255,0.85)';
      ctx.lineWidth = 6;
      ctx.stroke();
      // teeth
      ctx.fillStyle = '#eef4ff';
      const teeth = 9;
      for (let i = 0; i < teeth; i++) {
        const a = (i / (teeth - 1)) * Math.PI;
        const tx = Math.cos(a) * (60 + this.faceOpen * 180);
        const ty = 110 - Math.sin(a) * (open * 0.92);
        ctx.fillRect(tx - 5, ty - 10, 10, 20);
      }
      ctx.restore();

      // dark vignette so the maw reads as a hole
      const vg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62);
      vg.addColorStop(0, 'rgba(0,6,22,0)');
      vg.addColorStop(1, `rgba(0,4,16,${0.55 + this.faceOpen * 0.4})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    if (st >= 5) {
      // full corruption: heavy noise blocks
      for (let i = 0; i < 120; i++) {
        const x = rng.range(0, W), y = rng.range(0, H);
        const w = rng.range(2, 60), h = rng.range(2, 22);
        ctx.fillStyle = rng.next() < 0.5
          ? `rgba(255,255,255,${rng.range(0.03, 0.18)})`
          : `rgba(4,20,60,${rng.range(0.1, 0.4)})`;
        ctx.fillRect(x, y, w, h);
      }
    }

    // ---- CRT curvature hint: darker edges
    const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,8,26,0.45)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  get faceOpenAmount() { return this.faceOpen; }
}
