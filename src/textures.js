// textures.js — external PBR textures (GitHub-fetched / Poly Haven) with
// fully procedural canvas fallbacks. The game runs identically if every
// external file is missing; external files only raise fidelity.
// Priority: textures/polyhaven/*  >  textures/ext/*  >  procedural canvas.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL || './';
const loader = new THREE.TextureLoader();

function tryLoad(url, { srgb = true, rx = 1, ry = 1 } = {}) {
  return new Promise(res => {
    loader.load(BASE + url, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
      t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, () => res(null));
  });
}
const cloneTex = (t, rx, ry) => { if (!t) return null; const c = t.clone(); c.needsUpdate = true; c.repeat.set(rx, ry); return c; };

/* ---------------- procedural canvas helpers ---------------- */
function canvasTex(w, h, draw, { srgb = true, rx = 1, ry = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const R = (a, b) => a + Math.random() * (b - a);
function grain(g, w, h, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255 | 0;
    g.fillStyle = light ? `rgba(255,255,255,${alpha * Math.random()})` : `rgba(${v},${v},${v},${alpha * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, R(1, 2.4), R(1, 2.4));
  }
}
function procWoodFloor() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, w, h);
    const plankH = h / 6;
    for (let p = 0; p < 6; p++) {
      const y = p * plankH, tone = R(-14, 14);
      g.fillStyle = `rgb(${107 + tone},${74 + tone * .7},${46 + tone * .5})`; g.fillRect(0, y, w, plankH);
      for (let i = 0; i < 46; i++) { // grain streaks
        g.strokeStyle = `rgba(40,24,10,${R(.05, .22)})`; g.lineWidth = R(.6, 1.8); g.beginPath();
        const gy = y + Math.random() * plankH; g.moveTo(0, gy);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, gy + Math.sin(x * .02 + p) * 2 + R(-1, 1));
        g.stroke();
      }
      g.fillStyle = 'rgba(20,12,5,.85)'; g.fillRect(0, y, w, 2);
      g.fillRect(((p * 197) % w), y, 2, plankH);
    }
    grain(g, w, h, 2600, .06);
  });
}
function procPlaster() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8b2a6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const x = Math.random() * w, y = Math.random() * h, r = R(20, 130);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); const v = R(-9, 9);
      gr.addColorStop(0, `rgba(${184 + v},${178 + v},${166 + v},.5)`); gr.addColorStop(1, 'rgba(184,178,166,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    grain(g, w, h, 9000, .05); grain(g, w, h, 3000, .04, true);
  });
}
function procFabric(base = '#4a5568') {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      g.fillStyle = `rgba(${Math.random() > .5 ? '255,255,255' : '0,0,0'},${R(.02, .09)})`;
      g.fillRect(x + ((y / 3 | 0) % 2), y, 2, 1.4);
    }
  });
}
function procConcrete() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8d9299'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { const x = Math.random() * w, y = Math.random() * h, r = R(14, 90);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); const dk = Math.random() > .5;
      gr.addColorStop(0, dk ? 'rgba(60,64,70,.20)' : 'rgba(200,205,210,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    grain(g, w, h, 12000, .07);
    g.strokeStyle = 'rgba(40,42,46,.5)'; g.lineWidth = 2; // panel seams
    g.strokeRect(1, 1, w - 2, h - 2); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  });
}
function procMetal() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5c646e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { g.strokeStyle = `rgba(255,255,255,${R(.02, .07)})`; const y = Math.random() * h;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + R(-2, 2)); g.stroke(); }
    grain(g, w, h, 1500, .05);
  });
}
function procGroundBlue() { // wasteland fallback: cracked blue slabs
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#0d3d8f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${20 + R(0, 40)|0},${80 + R(0, 60)|0},${180 + R(0, 60)|0},${R(.05, .2)})`;
      g.fillRect(Math.random() * w, Math.random() * h, R(6, 60), R(4, 30)); }
    g.strokeStyle = 'rgba(160,210,255,.55)';
    for (let i = 0; i < 26; i++) { g.lineWidth = R(.6, 2); g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y);
      for (let s = 0; s < 7; s++) { x += R(-46, 46); y += R(-46, 46); g.lineTo(x, y); } g.stroke(); }
    grain(g, w, h, 5000, .06, true);
  });
}
/** A wall panel of error text. stableWord (optional) is drawn clean & bright. */
export function makeErrorTextTexture({ w = 1024, h = 512, bg = '#0a4fc0', fg = '#dceeff', stableWord = null, lines = null, big = false } = {}) {
  const POOL = ['STOP CODE: MEMORY_MANAGEMENT','0x0000001A 0xFFFFF800 0x0000FACE','PAGE_FAULT_IN_NONPAGED_AREA','例外: アクセス違反 (0xC0000005)','KERNEL_DATA_INPAGE_ERROR','dump failed. no one is listening.','セグメント 0x3F は応答しません','ntoskrnl.exe +0x3F5A0','IRQL_NOT_LESS_OR_EQUAL','the room you left is not the room','collecting error info ... 47%','このプロセスは終了できません','BAD_POOL_HEADER 0x19','まだ ここに いますか','SYSTEM_SERVICE_EXCEPTION','file not found: /home/you','CRITICAL_PROCESS_DIED','0x00000133 DPC_WATCHDOG_VIOLATION','夢のプロセスが応答を停止しました','UNEXPECTED_KERNEL_MODE_TRAP','segmentation fault (core dumped)','please do not turn off your —','WHEA_UNCORRECTABLE_ERROR','0xDEADB0D1 0x0000FACE 0xFEEDC0DE'];
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const fs = big ? 34 : 21; g.font = `${fs}px Consolas,monospace`; g.textBaseline = 'top';
    const rows = lines || Array.from({ length: Math.floor(h / (fs * 1.55)) }, () => POOL[Math.random() * POOL.length | 0]);
    rows.forEach((ln, i) => {
      const y = 14 + i * fs * 1.55; if (y > h - fs) return;
      const corrupted = Math.random() < .4;
      g.fillStyle = corrupted ? 'rgba(170,205,245,.55)' : fg;
      let s = ln;
      if (corrupted) s = s.split('').map(c => Math.random() < .07 ? '�▚░▒'[Math.random() * 4 | 0] : c).join('');
      g.fillText(s, 18 + (corrupted ? R(-4, 6) : 0), y);
      if (Math.random() < .25) { g.fillStyle = 'rgba(0,20,60,.35)'; g.fillRect(R(0, w * .6), y, R(30, 220), fs); }
    });
    if (big) { g.globalAlpha = .55; rows.forEach((ln, i) => { const y = 14 + i * fs * 1.55; if (y > h - fs) return;
        g.fillStyle = fg; g.fillText(ln, w * .54, y + (i % 2) * 7); }); g.globalAlpha = 1; }
    if (stableWord) { // the one clean word, dead centre, softly glowing
      g.font = `300 ${big ? 150 : 96}px "Segoe UI",sans-serif`; g.textAlign = 'center';
      g.shadowColor = 'rgba(160,215,255,.95)'; g.shadowBlur = 34; g.fillStyle = '#ffffff';
      g.fillText(stableWord, w / 2, h / 2 - (big ? 78 : 52)); g.shadowBlur = 0; g.textAlign = 'left';
    }
    grain(g, w, h, 1200, .05, true);
  });
}
export function makeFacadeTexture({ w = 512, h = 1024 } = {}) { // corrupted city building
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#123a75'; g.fillRect(0, 0, w, h); grain(g, w, h, 4000, .05);
    const cols = 6, rows = 14, cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + 9, y = r * ch + 10, lit = Math.random();
      if (lit < .3) { g.fillStyle = 'rgba(190,225,255,.95)'; }
      else if (lit < .42) { g.fillStyle = 'rgba(120,180,250,.5)'; }
      else g.fillStyle = 'rgba(4,14,34,.9)';
      g.fillRect(x, y, cw - 18, ch - 20);
      if (Math.random() < .08) { g.fillStyle = '#fff'; g.font = '15px Consolas,monospace'; g.fillText('ERR', x + 3, y + 4); }
    }
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(2,8,22,.55)'; g.fillRect(0, Math.random() * h, w, R(3, 16)); } // tear bands
  });
}
export function makeBlockNoiseTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#06295e'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      const v = Math.random();
      g.fillStyle = v < .12 ? '#7db8ff' : v < .3 ? '#0d4cb0' : v < .55 ? '#093a85' : '#06295e';
      if (Math.random() < .8) g.fillRect(x, y, 16, 16);
    }
    grain(g, w, h, 2000, .07, true);
  });
}
export function makeCircuitTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#04204a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(110,185,255,.8)'; g.lineWidth = 2;
    for (let i = 0; i < 42; i++) { let x = (Math.random() * 16 | 0) * 32, y = (Math.random() * 16 | 0) * 32;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 5; s++) { if (Math.random() < .5) x += (R(-4, 4) | 0) * 32; else y += (R(-4, 4) | 0) * 32; g.lineTo(x, y); }
      g.stroke(); g.fillStyle = '#bfe0ff'; g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
  });
}
export function makeFaceTexture({ w = 512, h = 512, mouthOpen = 0 } = {}) { // the :( glyph face
  return canvasTex(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#eaf4ff'; g.font = `300 ${h * .62}px "Segoe UI",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(140,200,255,.9)'; g.shadowBlur = 26;
    g.fillText(':(', w / 2, h / 2);
  });
}

/* ---------------- material library ---------------- */
export async function initMaterials(onProgress = () => {}) {
  const jobs = [
    ['phWoodD', 'textures/polyhaven/wood_floor_deck/diff.jpg', {}],
    ['phWoodN', 'textures/polyhaven/wood_floor_deck/nor.jpg', { srgb: false }],
    ['phWoodR', 'textures/polyhaven/wood_floor_deck/rough.jpg', { srgb: false }],
    ['woodD', 'textures/ext/hardwood2_diffuse.jpg', {}],
    ['woodB', 'textures/ext/hardwood2_bump.jpg', { srgb: false }],
    ['woodR', 'textures/ext/hardwood2_roughness.jpg', { srgb: false }],
    ['brickD', 'textures/ext/brick_diffuse.jpg', {}],
    ['brickB', 'textures/ext/brick_bump.jpg', { srgb: false }],
    ['brickR', 'textures/ext/brick_roughness.jpg', { srgb: false }],
    ['checkD', 'textures/ext/FloorsCheckerboard_S_Diffuse.jpg', {}],
    ['checkN', 'textures/ext/FloorsCheckerboard_S_Normal.jpg', { srgb: false }],
    ['iceD', 'textures/ext/Ice002_1K-JPG_Color.jpg', {}],
    ['iceN', 'textures/ext/Ice002_1K-JPG_NormalGL.jpg', { srgb: false }],
    ['iceR', 'textures/ext/Ice002_1K-JPG_Roughness.jpg', { srgb: false }],
  ];
  const T = {}; let done = 0;
  await Promise.all(jobs.map(async ([k, u, o]) => { T[k] = await tryLoad(u, o); onProgress(++done / jobs.length); }));
  const woodD = T.phWoodD || T.woodD || procWoodFloor();
  const woodN = T.phWoodN, woodB = T.phWoodN ? null : T.woodB, woodR = T.phWoodR || T.woodR;
  const std = o => new THREE.MeshStandardMaterial(o);
  const M = {
    // --- room ---
    roomFloor: std({ map: cloneTex(woodD, 2.2, 1.7), normalMap: cloneTex(woodN, 2.2, 1.7), bumpMap: cloneTex(woodB, 2.2, 1.7), bumpScale: .6, roughnessMap: cloneTex(woodR, 2.2, 1.7), roughness: .85, color: 0xb99f83 }),
    deskWood: std({ map: cloneTex(woodD, 1.1, .55), bumpMap: cloneTex(woodB, 1.1, .55), bumpScale: .3, roughness: .62, color: 0x8a6f52 }),
    wallPlaster: std({ map: (() => { const t = procPlaster(); t.repeat.set(2.4, 1.3); return t; })(), roughness: .95, color: 0xcfc9bc }),
    ceiling: std({ color: 0xb9b4a8, roughness: .97 }),
    fabricDark: std({ map: procFabric('#39424f'), roughness: 1 }),
    fabricBed: std({ map: procFabric('#5a6577'), roughness: 1 }),
    pillow: std({ map: procFabric('#9aa3ad'), roughness: 1 }),
    rug: std({ map: procFabric('#4e3f46'), roughness: 1 }),
    plasticBlack: std({ color: 0x14161a, roughness: .55, metalness: .15 }),
    plasticGrey: std({ color: 0x3a3f46, roughness: .6, metalness: .1 }),
    metalDark: std({ map: procMetal(), color: 0x9aa2ac, roughness: .42, metalness: .85 }),
    pcCase: std({ color: 0x101216, roughness: .38, metalness: .5 }),
    glassDark: std({ color: 0x0a141f, roughness: .08, metalness: .4 }),
    paper: std({ color: 0xd8d4c8, roughness: .95 }),
    cardboard: std({ color: 0x8a6f4d, roughness: .95 }),
    ledBlue: new THREE.MeshStandardMaterial({ color: 0x0a1a33, emissive: 0x2f8bff, emissiveIntensity: 3 }),
    ledAmber: new THREE.MeshStandardMaterial({ color: 0x1a0f04, emissive: 0xff9a2f, emissiveIntensity: 2 }),
    // --- BSOD world ---
    wasteGround: T.iceD ? std({ map: cloneTex(T.iceD, 11, 15), normalMap: cloneTex(T.iceN, 11, 15), roughnessMap: cloneTex(T.iceR, 11, 15), roughness: .9, color: 0x5f93d8, emissive: 0x0a2c66, emissiveIntensity: .35 })
      : std({ map: (() => { const t = procGroundBlue(); t.repeat.set(14, 18); return t; })(), roughness: .9, emissive: 0x0a2c66, emissiveIntensity: .3 }),
    checkerFloor: T.checkD ? std({ map: cloneTex(T.checkD, 10, 10), normalMap: cloneTex(T.checkN, 10, 10), roughness: .55, color: 0x7ea6d4, emissive: 0x081f47, emissiveIntensity: .4 })
      : std({ map: procConcrete(), color: 0x6f97c8, roughness: .7 }),
    concreteBlue: std({ map: (() => { const t = procConcrete(); t.repeat.set(2, 2); return t; })(), color: 0x6d96cc, roughness: .92, emissive: 0x051a3d, emissiveIntensity: .48 }),
    brickBlue: T.brickD ? std({ map: cloneTex(T.brickD, 3, 2), bumpMap: cloneTex(T.brickB, 3, 2), bumpScale: 1.2, roughnessMap: cloneTex(T.brickR, 3, 2), color: 0x5f83b5, roughness: .95, emissive: 0x041636, emissiveIntensity: .4 })
      : std({ map: procConcrete(), color: 0x557fb4, roughness: .95 }),
    bsodPanel: new THREE.MeshStandardMaterial({ color: 0x0a2c66, emissive: 0x0a64d8, emissiveIntensity: 1.15, roughness: .6 }),
    bsodBright: new THREE.MeshStandardMaterial({ color: 0x0a3d8f, emissive: 0x2f8bff, emissiveIntensity: 2.2, roughness: .5 }),
    whiteGlow: new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0xdceeff, emissiveIntensity: 2.4, roughness: .4 }),
    shard: std({ color: 0x2b6fd4, emissive: 0x0d4cb0, emissiveIntensity: .8, roughness: .35, metalness: .25, flatShading: true }),
    shardDark: std({ color: 0x0b2c60, emissive: 0x07245c, emissiveIntensity: .5, roughness: .8, flatShading: true }),
    wire: new THREE.MeshBasicMaterial({ color: 0x8fc6ff, wireframe: true, transparent: true, opacity: .5 }),
    monolithFar: std({ color: 0x16407e, emissive: 0x14407e, emissiveIntensity: .72, roughness: 1, flatShading: true }),
    blockNoise: std({ map: makeBlockNoiseTexture(), roughness: .85, emissive: 0x0a2c66, emissiveIntensity: .55, emissiveMap: null }),
    circuit: std({ map: makeCircuitTexture(), roughness: .7, emissive: 0x0a3d8f, emissiveIntensity: .8, emissiveMap: makeCircuitTexture() }),
    cableMat: std({ color: 0x0d1c33, roughness: .5, metalness: .4, emissive: 0x0a2c66, emissiveIntensity: .4 }),
    errorPanelA: null, errorPanelB: null, facadeA: null, facadeB: null, wakeWall: null, faceMat: null,
  };
  const ep = (opts) => { const t = makeErrorTextTexture(opts); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.12, roughness: .7, color: 0x223044 }); };
  M.errorPanelA = ep({});
  M.errorPanelB = ep({ bg: '#083a85' });
  M.wakeWall = ep({ w: 2048, h: 1024, stableWord: 'WAKE_UP', big: true, bg: '#0a4fc0' });
  const fac = () => { const t = makeFacadeTexture({}); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xbfd9ff, emissiveMap: t, emissiveIntensity: .7, roughness: .9, color: 0x36455c }); };
  M.facadeA = fac(); M.facadeB = fac();
  const faceT = makeFaceTexture({});
  M.faceMat = new THREE.MeshBasicMaterial({ map: faceT, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  M._extLoaded = { wood: !!T.woodD, polyhavenWood: !!T.phWoodD, brick: !!T.brickD, checker: !!T.checkD, ice: !!T.iceD };
  return M;
}
export { canvasTex, tryLoad, BASE };
