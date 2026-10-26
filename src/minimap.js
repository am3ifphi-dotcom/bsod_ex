/**
 * 見取り図（ミニマップ）
 */
import { ROOM as R } from './materials.js';
import { WIN_SPANS, DOOR } from './room.js';

const PAD = 12;
const DEFAULT_BOUNDS = { x0: R.X0 - 1.4, x1: R.X1 + 0.3, z0: R.Z0 - 0.3, z1: R.Z1 + 0.3 };

export class Minimap {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = Number(canvas.getAttribute('width')) || 190;
    this.cssH = Number(canvas.getAttribute('height')) || 170;
    this.fragments = opts.fragments || [];
    this.colliders = opts.colliders || null;
    this.B = opts.bounds ? {
      x0: opts.bounds.x0 - 0.6, x1: opts.bounds.x1 + 0.6,
      z0: opts.bounds.z0 - 0.6, z1: opts.bounds.z1 + 0.6,
    } : DEFAULT_BOUNDS;
    this.mode = opts.mode || 'procedural';
    this.resize();
    this.enabled = true;
    this._acc = 0;
    this.time = 0;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const d = this.dpr;
    this.cv.width = Math.round(this.cssW * d);
    this.cv.height = Math.round(this.cssH * d);
    this.cv.style.width = `${this.cssW}px`;
    this.cv.style.height = `${this.cssH}px`;
    this.w = this.cv.width;
    this.h = this.cv.height;
    const sx = (this.w - PAD * 2 * d) / (this.B.x1 - this.B.x0);
    const sy = (this.h - PAD * 2 * d) / (this.B.z1 - this.B.z0);
    this.s = Math.min(sx, sy);
    this.ox = (this.w - (this.B.x1 - this.B.x0) * this.s) / 2;
    this.oy = (this.h - (this.B.z1 - this.B.z0) * this.s) / 2;
  }

  px(x) {
    return this.ox + (x - this.B.x0) * this.s;
  }
  py(z) {
    return this.oy + (z - this.B.z0) * this.s;
  }

  update(dt, player) {
    if (!this.enabled) return;
    this.time += dt;
    this._acc += dt;
    if (this._acc < 0.05) return;
    this._acc = 0;
    this.draw(player);
  }

  draw(player) {
    const c = this.ctx;
    const d = this.dpr;
    c.clearRect(0, 0, this.w, this.h);

    c.save();
    // 部屋
    c.lineWidth = 1.6 * d;
    c.strokeStyle = 'rgba(233,181,99,0.5)';
    c.fillStyle = 'rgba(120,96,60,0.12)';
    c.beginPath();
    const rb = this.mode === 'glb'
      ? { x0: this.B.x0 + 0.6, x1: this.B.x1 - 0.6, z0: this.B.z0 + 0.6, z1: this.B.z1 - 0.6 }
      : { x0: R.X0, x1: R.X1, z0: R.Z0, z1: R.Z1 };
    c.rect(this.px(rb.x0), this.py(rb.z0), (rb.x1 - rb.x0) * this.s, (rb.z1 - rb.z0) * this.s);
    c.fill();
    c.stroke();

    if (this.mode !== 'glb') {
      // 廊下
      c.fillStyle = 'rgba(120,96,60,0.08)';
      c.beginPath();
      c.rect(this.px(R.X0 - 1.15), this.py(DOOR.z0), 1.15 * this.s, (DOOR.z1 - DOOR.z0) * this.s);
      c.fill();
      c.stroke();

      // 窓
      c.strokeStyle = 'rgba(150,200,230,0.85)';
      c.lineWidth = 2.6 * d;
      for (const w of WIN_SPANS) {
        c.beginPath();
        c.moveTo(this.px(R.X1), this.py(w.z0 + 0.05));
        c.lineTo(this.px(R.X1), this.py(w.z1 - 0.05));
        c.stroke();
      }
      // ドア開口
      c.strokeStyle = 'rgba(233,181,99,0.9)';
      c.beginPath();
      c.moveTo(this.px(R.X0), this.py(DOOR.z0 + 0.03));
      c.lineTo(this.px(R.X0), this.py(DOOR.z1 - 0.03));
      c.stroke();
    }

    // 家具＝実コライダーをそのまま描く（レイアウト変更しても自動で追従）
    if (this.colliders) {
      const SKIP = /^(front|back|left|window|corr|door)/;
      for (const b of this.colliders.items) {
        if (SKIP.test(b.tag)) continue;
        const w = b.x1 - b.x0;
        const h = b.z1 - b.z0;
        const desk = b.tag === 'desk';
        c.fillStyle = desk ? 'rgba(214,182,132,0.5)' : 'rgba(190,160,110,0.42)';
        c.fillRect(this.px(b.x0), this.py(b.z0), w * this.s, h * this.s);
      }
    }

    // 黒板
    c.strokeStyle = 'rgba(120,180,140,0.9)';
    c.lineWidth = 3 * d;
    c.beginPath();
    if (this.mode === 'glb') {
      c.moveTo(this.px(rb.x0 + 0.8), this.py(rb.z0 + 0.25));
      c.lineTo(this.px(rb.x1 - 0.8), this.py(rb.z0 + 0.25));
    } else {
      c.moveTo(this.px(-2.6), this.py(R.Z0));
      c.lineTo(this.px(2.6), this.py(R.Z0));
    }
    c.stroke();

    // 記憶のかけら
    for (const f of this.fragments) {
      const x = this.px(f.pos[0]);
      const y = this.py(f.pos[2]);
      if (f.collected) {
        c.fillStyle = 'rgba(233,181,99,0.2)';
        c.beginPath();
        c.arc(x, y, 1.9 * d, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      const pulse = 0.6 + Math.sin(this.time * 3 + f.phase) * 0.4;
      c.fillStyle = `rgba(255,206,132,${0.5 + pulse * 0.5})`;
      c.beginPath();
      c.moveTo(x, y - 4 * d);
      c.lineTo(x + 3.4 * d, y);
      c.lineTo(x, y + 4 * d);
      c.lineTo(x - 3.4 * d, y);
      c.closePath();
      c.fill();
      c.strokeStyle = `rgba(255,236,190,${0.22 * pulse})`;
      c.lineWidth = 1 * d;
      c.beginPath();
      c.arc(x, y, (5 + pulse * 4) * d, 0, Math.PI * 2);
      c.stroke();
    }

    // プレイヤー
    const px = this.px(player.pos.x);
    const py = this.py(player.pos.z);
    const ang = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw));
    const grad = c.createRadialGradient(px, py, 0, px, py, 32 * d);
    grad.addColorStop(0, 'rgba(255,238,200,0.3)');
    grad.addColorStop(1, 'rgba(255,238,200,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(px, py);
    c.arc(px, py, 32 * d, ang - 0.55, ang + 0.55);
    c.closePath();
    c.fill();

    c.fillStyle = '#ffe9bd';
    c.beginPath();
    c.moveTo(px + Math.cos(ang) * 6.5 * d, py + Math.sin(ang) * 6.5 * d);
    c.lineTo(px + Math.cos(ang + 2.4) * 4.6 * d, py + Math.sin(ang + 2.4) * 4.6 * d);
    c.lineTo(px + Math.cos(ang - 2.4) * 4.6 * d, py + Math.sin(ang - 2.4) * 4.6 * d);
    c.closePath();
    c.fill();
    c.restore();
  }
}
