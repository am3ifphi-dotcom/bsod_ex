// Authentic Windows 10/11 BSOD rendered on canvas.
// Madness comes from the *real* elements corrupting: the ":(" glyph itself,
// the % counter, the stop code, the QR code — nothing appears from nowhere.
function seededRand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const BLOCKS = '▓▒░█▚▞#%&@$?!/\\|<>*+=~';
function corruptStr(str, amt, seed) {
  if (amt <= 0) return str;
  const r = seededRand(seed); let out = '';
  for (const ch of str) { if (ch !== ' ' && r() < amt) out += BLOCKS[Math.floor(r() * BLOCKS.length)]; else out += ch; }
  return out;
}
export class BSODScreen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 768;
    this.ctx = this.canvas.getContext('2d');
    this.level = 0; this.mode = 'bsod'; // bsod | after | off
    this.flickerSeed = 0;
    this.draw(0, 0);
  }
  // face glyph zone in UV space (for raycast hover/click)
  faceUV() { const l = this.level; const grow = Math.min(0.35, l * 0.03); return { x0: 0.06 - grow * 0.3, x1: 0.40 + grow, y0: 0.52, y1: 0.92 }; }
  setLevel(l) { this.level = l; }
  draw(t = 0, time = 0) {
    const { ctx: c, canvas } = this; const W = canvas.width, H = canvas.height; const L = t;
    if (this.mode === 'off') { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); return; }
    if (this.mode === 'after') return this.drawAfter(time);
    // --- authentic base ---
    c.fillStyle = '#0078D7'; c.fillRect(0, 0, W, H);
    const rnd = seededRand(1234 + Math.floor(time * 2) + L * 77);
    // subtle vertical banding like a real LCD photo of BSOD
    c.fillStyle = 'rgba(255,255,255,0.025)';
    for (let x = 0; x < W; x += 4) if ((x / 4) % 2) c.fillRect(x, 0, 2, H);

    const faceScaleY = 1 + Math.min(0.55, L * 0.05);
    const faceScaleX = 1 + Math.min(0.3, L * 0.028);
    const jx = L >= 2 ? (rnd() - 0.5) * L * 1.6 : 0;
    const jy = L >= 2 ? (rnd() - 0.5) * L * 1.2 : 0;

    // ghost: the SAME glyph bleeding larger behind (from level 4) — glyph corruption, not a new creature
    if (L >= 4) {
      c.save(); c.globalAlpha = Math.min(0.16, (L - 3) * 0.03);
      c.fillStyle = '#bfe0ff'; c.font = `300 ${340 + L * 26}px "Segoe UI",sans-serif`;
      c.translate(90 + jx * 3, 420 + jy * 3); c.scale(1.4, 1.4 + L * 0.06); c.fillText(':(', 0, 0); c.restore();
    }
    // RGB split ghosts of the glyph
    const drawFace = (dx, dy, style, alpha) => {
      c.save(); c.globalAlpha = alpha; c.fillStyle = style;
      c.font = '300 215px "Segoe UI","Meiryo UI",sans-serif';
      c.translate(108 + dx + jx, 148 + dy + jy); c.scale(faceScaleX, faceScaleY);
      c.fillText(':(', 0, 150); c.restore();
    };
    if (L >= 2) { drawFace(-3 - L * 0.4, 0, '#ff2a4d', 0.55); drawFace(3 + L * 0.4, 0, '#27f6ff', 0.55); }
    drawFace(0, 0, '#ffffff', 1);
    // eyes elongate into drips at high corruption (still the glyph's own dots, stretched)
    if (L >= 7) {
      c.save(); c.fillStyle = 'rgba(230,245,255,0.85)';
      const drip = (L - 6) * 16 + Math.sin(time * 3) * 3;
      c.fillRect(128 + jx, 205 + jy, 13, drip); c.fillRect(196 + jx, 205 + jy, 13, drip * 0.8);
      c.restore();
    }

    // body text — authentic wording
    let line1 = "Your PC ran into a problem and needs to restart. We're";
    let line2 = "just collecting some error info, and then we'll restart for you.";
    if (L >= 8) { line1 = "Your PC ran into a problem and it is looking at you. We're"; line2 = "just collecting some error info. It is collecting you, too."; }
    if (L >= 10) { line1 = 'do not blink. do not look away from the face.'; line2 = 'it gets bigger every time you understand it.'; }
    c.fillStyle = '#fff'; c.font = '300 30px "Segoe UI","Meiryo UI",sans-serif';
    const corruptAmt = L >= 3 ? (L - 2) * 0.022 : 0;
    c.fillText(corruptStr(line1, corruptAmt, 11), 112 + jx * 0.5, 452);
    c.fillText(corruptStr(line2, corruptAmt, 23), 112 + jx * 0.5, 494);
    // duplicated offset copies (screen tearing echo)
    if (L >= 5) { c.save(); c.globalAlpha = 0.28; c.fillText(line1, 112 - L * 2, 452 + 3); c.restore(); }

    // percent counter — goes wrong
    let pct = '100% complete';
    if (L === 1) pct = '100% complete';
    else if (L === 2) pct = '103% complete';
    else if (L === 3) pct = '10̶0% complete';
    else if (L === 4) pct = '-7% complete';
    else if (L === 5) pct = '999% complete';
    else if (L === 6) pct = '0% complete. forever.';
    else if (L >= 7) pct = corruptStr('YOU ARE 100% COMPLETE', 0.08, 31);
    c.font = '300 30px "Segoe UI",sans-serif'; c.globalAlpha = 1;
    c.fillText(pct, 112, 552);

    // QR code (deterministic modules + finder patterns), scrambles with corruption
    const qx = 112, qy = 592, qs = 118, cell = qs / 21;
    c.fillStyle = '#fff'; c.fillRect(qx - 6, qy - 6, qs + 12, qs + 12);
    c.fillStyle = '#000';
    const qr = seededRand(999);
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
      const finder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      let on;
      if (finder) { const lx = x > 12 ? x - 13 : x, ly = y > 12 ? y - 13 : y; on = lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4); }
      else on = qr() > 0.52;
      if (L >= 5 && qr() < (L - 4) * 0.05) on = !on; // modules flip wrong
      if (on) c.fillRect(qx + x * cell, qy + y * cell, cell + 0.6, cell + 0.6);
    }
    if (L >= 9) { c.fillStyle = 'rgba(0,120,215,0.9)'; c.fillRect(qx + qs * 0.38, qy + qs * 0.38, qs * 0.24, qs * 0.24); c.fillStyle = '#fff'; c.fillRect(qx + qs * 0.46, qy + qs * 0.44, qs * 0.08, qs * 0.1); }

    // right of QR — authentic small print
    c.fillStyle = '#fff'; c.font = '300 17.5px "Segoe UI",sans-serif';
    let s1 = 'For more information, you can search online later for this error:';
    let s2 = 'CRITICAL_PROCESS_DIED';
    if (L >= 3) s2 = 'CR1TICAL_PR0CESS_D1ED';
    if (L >= 6) s2 = 'IT_SEES_YOU_DIED';
    if (L >= 9) { s1 = 'For more information, do not search. It will find you first:'; s2 = 'STOP_LOOKING_AT_IT'; }
    c.fillText(s1, 262, 634); c.fillText(s2, 262, 660);
    c.font = '300 16px "Segoe UI",sans-serif';
    c.fillText("If you call a support person, give them this info:", 262, 692);
    c.fillText(`Stop code: ${s2}`, 262, 716);

    // horizontal tear slices at mid+ corruption: shift strips of blue (screen peeling)
    if (L >= 4) {
      const tears = Math.min(7, L - 2);
      for (let i = 0; i < tears; i++) {
        const y = rnd() * H, h = 3 + rnd() * 16, off = (rnd() - 0.5) * (10 + L * 7);
        c.drawImage(canvas, 0, y, W, h, off, y, W, h);
        c.fillStyle = `rgba(160,210,255,${0.05 + rnd() * 0.08})`; c.fillRect(0, y, W, 1);
      }
    }
    // blue drips spilling downward from glyph (screen surface peeling)
    if (L >= 6) {
      c.fillStyle = 'rgba(190,225,255,0.5)';
      for (let i = 0; i < L - 4; i++) { const x = 100 + rnd() * 260; c.fillRect(x, 300, 2 + rnd() * 3, 40 + rnd() * 130); }
    }
    // scanlines + noise (cheap, only on redraw)
    c.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    if (L >= 2) { const n = seededRand(Math.floor(time * 9) + 5); c.fillStyle = 'rgba(255,255,255,0.16)'; for (let i = 0; i < L * 14; i++) c.fillRect(n() * W, n() * H, 2, 2); }
    // vignette
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,10,40,0.28)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  drawAfter(time) {
    const { ctx: c, canvas } = this; const W = canvas.width, H = canvas.height;
    c.fillStyle = '#04070d'; c.fillRect(0, 0, W, H);
    const blink = (Math.sin(time * 0.7) > 0.92) || (Math.sin(time * 13.7) > 0.995);
    c.font = '300 120px "Segoe UI",sans-serif';
    c.fillStyle = blink ? 'rgba(140,190,255,0.9)' : 'rgba(90,140,220,0.20)';
    c.fillText(':(', 96, 260);
    c.font = '20px Consolas,monospace'; c.fillStyle = 'rgba(150,190,255,0.55)';
    c.fillText('MEMORY.DMP ........ SAVED', 100, 420);
    c.fillText('YOU_ARE_AWAKE.DMP . SAVED', 100, 452);
    if (blink) { c.fillStyle = 'rgba(200,230,255,0.95)'; c.fillText('おかえり。', 100, 540); }
    c.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  }
}
export function makeTextSprite(text, { size = 44, color = '#a9ccff', glow = 'rgba(0,110,255,0.9)', font = '"Segoe UI",sans-serif', pad = 26 } = {}) {
  const cv = document.createElement('canvas'); const cx = cv.getContext('2d');
  cx.font = `300 ${size}px ${font}`;
  cv.width = Math.ceil(cx.measureText(text).width) + pad * 2; cv.height = size + pad * 2;
  const c2 = cv.getContext('2d'); c2.font = `300 ${size}px ${font}`; c2.textBaseline = 'middle';
  c2.shadowColor = glow; c2.shadowBlur = 18; c2.fillStyle = color; c2.fillText(text, pad, cv.height / 2);
  return { canvas: cv, aspect: cv.width / cv.height };
}
