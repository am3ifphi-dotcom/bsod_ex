/**
 * 自機中心・進行方向アップの小型レーダー。
 * Canvas 2D で毎フレーム描くが、320px の円に点を数個置くだけなので軽い。
 */

const RANGE = 145;

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.size = canvas.width;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.time = 0;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const target = Math.max(160, Math.round(rect.width * this.dpr));
    if (target !== this.canvas.width) {
      this.canvas.width = target;
      this.canvas.height = target;
      this.size = target;
    }
  }

  draw(islands, playerPos, yaw, focusIndex, visited, dt = 0.016, accent = '#6ef0d0') {
    this.time += dt;
    const ctx = this.ctx;
    const size = this.size;
    const c = size / 2;
    const radius = c - 6;
    const scale = radius / RANGE;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(c, c);

    // 背景
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    bg.addColorStop(0, 'rgba(10,20,36,0.72)');
    bg.addColorStop(1, 'rgba(5,10,20,0.5)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // 距離リング
    ctx.strokeStyle = 'rgba(150,195,255,0.12)';
    ctx.lineWidth = Math.max(1, size / 320);
    [0.33, 0.66, 1].forEach((k) => {
      ctx.beginPath();
      ctx.arc(0, 0, radius * k, 0, Math.PI * 2);
      ctx.stroke();
    });

    // スイープ
    const sweep = (this.time * 0.7) % (Math.PI * 2);
    const grad = ctx.createConicGradient?.(sweep - 0.7, 0, 0);
    if (grad) {
      grad.addColorStop(0, 'rgba(110,240,208,0)');
      grad.addColorStop(0.09, 'rgba(110,240,208,0.12)');
      grad.addColorStop(0.12, 'rgba(110,240,208,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 視界コーン
    ctx.fillStyle = 'rgba(180,230,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius * 0.95, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
    ctx.closePath();
    ctx.fill();

    // 島
    ctx.save();
    ctx.rotate(-yaw);
    for (const entry of islands) {
      const dx = entry.root.position.x - playerPos.x;
      const dz = entry.root.position.z - playerPos.z;
      const px = dx * scale;
      const py = dz * scale;
      if (Math.hypot(px, py) > radius - 4) continue;

      const isFocus = entry.index === focusIndex;
      const isVisited = visited.has(entry.index);
      const hue = entry.accent;

      ctx.beginPath();
      ctx.arc(px, py, isFocus ? size / 44 : size / 62, 0, Math.PI * 2);
      ctx.fillStyle = isFocus ? '#ffffff' : isVisited ? '#' + hue.getHexString() : 'rgba(170,205,245,0.45)';
      ctx.fill();

      if (isFocus) {
        ctx.beginPath();
        ctx.arc(px, py, size / 27, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, size / 220);
        ctx.stroke();
      } else if (isVisited) {
        ctx.beginPath();
        ctx.arc(px, py, size / 48, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(110,240,208,0.35)';
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.restore();
  }
}
