import * as THREE from 'three';

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas: c, ctx: c.getContext('2d') };
}

export function makeClockTexture() {
  return canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);
  });
}

export function drawClock(tex, text, color = '#7dffb0') {
  const ctx = tex.image.getContext ? tex.image.getContext('2d') : null;
  const c = tex.image;
  const g = c.getContext('2d');
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, c.width, c.height);
  g.font = 'bold 56px "Courier New", monospace';
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 14;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  tex.needsUpdate = true;
}

export function makeCrackTexture() {
  const { tex, ctx, canvas } = canvasTexture(512, 512, () => {});
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(4,8,16,0.9)';
  ctx.lineCap = 'round';
  function branch(x, y, ang, len, depth, width) {
    if (depth <= 0 || len < 8) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    const n = 1 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      branch(x2, y2, ang + (Math.random() - 0.5) * 1.4, len * (0.5 + Math.random() * 0.3), depth - 1, width * 0.7);
    }
  }
  branch(256, 60, Math.PI / 2 + (Math.random() - 0.5) * 0.3, 110, 6, 5);
  branch(256, 60, Math.PI / 2 - 0.7, 70, 4, 3);
  branch(256, 60, Math.PI / 2 + 0.8, 80, 4, 3);
  // 青い発光縁
  ctx.strokeStyle = 'rgba(80,170,255,0.35)';
  ctx.lineWidth = 1.5;
  branch(256, 60, Math.PI / 2, 110, 6, 1.5);
  tex.needsUpdate = true;
  return tex;
}

const ERR_WORDS = ['0x000000EF', 'PAGE_FAULT_IN_NONPAGED_AREA', 'IRQL_NOT_LESS_OR_EQUAL', 'KERNEL_PANIC',
  'CRITICAL_PROCESS_DIED', 'MEMORY_CORRUPTION', ':(', 'STACK_OVERFLOW', 'ACCESS_VIOLATION',
  'DEVICE_DESCRIPTOR_FAILED', 'WAKE_UP', 'THREAD_STUCK', 'FATAL_ERROR', '0xDEADBEEF', 'reboot…'];

export function makeErrorPanelTexture(seed = 0) {
  let s = seed || 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const { tex, ctx } = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = 'rgba(6,20,44,0.92)';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(90,180,255,0.7)';
    c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6);
    c.font = '16px "Courier New", monospace';
    let y = 30;
    for (let row = 0; row < 11; row++) {
      c.fillStyle = `rgba(${150 + rnd() * 80},${200 + rnd() * 55},255,${0.55 + rnd() * 0.4})`;
      let line = '';
      const words = 1 + ((rnd() * 3) | 0);
      for (let k = 0; k < words; k++) line += ERR_WORDS[(rnd() * ERR_WORDS.length) | 0] + '  ';
      c.fillText(line.slice(0, 52), 16, y);
      y += 20;
    }
  });
  return tex;
}
