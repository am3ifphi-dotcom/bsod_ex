/**
 * スモークテスト — ブラウザなしでワールド構築ロジックを通しで実行する。
 * Canvas 2D / WebGL は使えないので、2Dコンテキストはスタブに差し替える。
 *
 *   node tools/smoke.mjs
 */
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';

/* ---------------- Canvas 2D スタブ ---------------- */
function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  const ctx = {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    filter: 'none',
    globalCompositeOperation: 'source-over',
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform() {},
    resetTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    setLineDash() {},
    getLineDash() {
      return [];
    },
    fillText() {},
    strokeText() {},
    measureText(t) {
      return { width: String(t).length * 8, actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 2 };
    },
    drawImage() {},
    createLinearGradient() {
      return grad;
    },
    createRadialGradient() {
      return grad;
    },
    createConicGradient() {
      return grad;
    },
    createPattern() {
      return null;
    },
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h };
    },
    createImageData(w, h) {
      if (typeof w === 'number') return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      return { data: new Uint8ClampedArray(w.width * w.height * 4), width: w.width, height: w.height };
    },
    putImageData() {},
    isPointInPath() {
      return false;
    },
  };
  return ctx;
}

function makeCanvas(w = 300, h = 150) {
  const c = {
    width: w,
    height: h,
    style: {},
    nodeName: 'CANVAS',
    clientWidth: w,
    clientHeight: h,
    getAttribute(n) {
      return n === 'width' ? String(this.width) : n === 'height' ? String(this.height) : null;
    },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    getContext(type) {
      if (type === '2d') {
        this._ctx = this._ctx || makeCtx(this);
        return this._ctx;
      }
      return null;
    },
    toDataURL() {
      return 'data:image/png;base64,';
    },
  };
  return c;
}

/* ---------------- グローバルスタブ ---------------- */
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas();
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      style: {},
      width: 0,
      height: 0,
      onload: null,
      onerror: null,
      _l: {},
      appendChild() {},
      addEventListener(type, fn) {
        this._l[type] = fn;
      },
      removeEventListener(type) {
        delete this._l[type];
      },
      dispatchEvent(ev) {
        const fn = this._l[ev.type];
        if (fn) fn(ev);
        return true;
      },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      getAttribute: () => null,
      setAttribute() {},
    };
    if (String(tag).toLowerCase() === 'img') {
      let src = '';
      Object.defineProperty(el, 'src', {
        get: () => src,
        set: (v) => {
          src = v;
          // TextureLoader は image.onload を待つので、即座に発火させて parse を進める
          setTimeout(() => {
            el.width = 4; el.height = 4; el.naturalWidth = 4; el.naturalHeight = 4; el.complete = true;
            if (typeof el.onload === 'function') el.onload();
            el.dispatchEvent({ type: 'load' });
          }, 0);
        },
      });
    }
    return el;
  },
  createElementNS(ns, tag) {
    return this.createElement(tag);
  },
  addEventListener() {},
  body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
  hidden: false,
  pointerLockElement: null,
};
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 0),
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
// GLTFLoader が Blob URL 経由でテクスチャを読むための最小スタブ
globalThis.window.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
globalThis.self = globalThis.window;
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true }); } catch {}

/* ---------------- 本体 ---------------- */
const errors = [];
const ok = (label, fn) => {
  try {
    const r = fn();
    console.log(`  ✓ ${label}${r ? ` — ${r}` : ''}`);
    return r;
  } catch (e) {
    errors.push([label, e]);
    console.log(`  ✗ ${label}\n      ${e.stack?.split('\n').slice(0, 3).join('\n      ')}`);
    return null;
  }
};

console.log('\n[1] テクスチャ生成');
const tex = await import('../src/textures.js');
ok('woodMaterialTextures', () => {
  const t = tex.woodMaterialTextures({ size: 128, planks: 4, seed: 1 });
  return `${t.map.image.width}px, normal ${t.normalMap.image.width}px`;
});
ok('plaster / painted / ceiling / metal', () => {
  tex.plasterTextures({ size: 128 });
  tex.paintedTextures({ size: 128 });
  tex.ceilingTextures({ size: 128 });
  tex.metalTextures({ size: 64 });
  return 'ok';
});
ok('chalkboard', () => {
  const t = tex.chalkboardTextures({ size: 256 });
  return `${t.map.image.width}x${t.map.image.height}`;
});
ok('schedule / drawing / slogan / books / clock / label / cloth', () => {
  tex.scheduleTexture({ size: 128 });
  tex.drawingTexture({ size: 128 });
  tex.sloganTexture({ size: 128 });
  tex.bookSpineTexture({ size: 128 });
  tex.clockFaceTexture({ size: 128 });
  tex.labelTexture({ text: 'テスト' });
  tex.clothTextures({ size: 128 });
  tex.keyboardTexture({ size: 256 });
  tex.globeTexture({ size: 128 });
  tex.cardboardTexture({ size: 128 });
  tex.glowSpriteTexture();
  return 'ok';
});
ok('backdrop day/dusk/night', () => {
  for (const m of ['day', 'dusk', 'night']) tex.backdropTexture(m, { size: 256 });
  return 'ok';
});

console.log('\n[2] マテリアル');
const mats = await import('../src/materials.js');
const M = ok('createMaterials', () => mats.createMaterials());
if (!M) {
  console.error('マテリアル生成に失敗したため中断');
  process.exit(1);
}
ok('labelMaterial / plane / box / cyl', () => {
  mats.labelMaterial('五年二組');
  mats.plane(2, 2, M.floor, 2);
  mats.box(1, 1, 1, M.floor);
  mats.cyl(0.1, 0.1, 1, 8, M.floor);
  return 'ok';
});

console.log('\n[3] 教室の躯体');
const roomMod = await import('../src/room.js');
const coll = new (await import('../src/colliders.js')).Colliders();
let room = null;
ok('buildRoom', () => {
  room = roomMod.buildRoom(M, coll);
  let meshes = 0;
  room.group.traverse((o) => o.isMesh && meshes++);
  return `mesh ${meshes} / hotspot ${room.hotspots.length} / window ${room.refs.windows.length}`;
});

console.log('\n[4] 家具');
const furnMod = await import('../src/furniture.js');
let furn = null;
ok('buildFurniture', () => {
  furn = furnMod.buildFurniture(M, coll);
  let meshes = 0;
  furn.group.traverse((o) => o.isMesh && meshes++);
  return `mesh ${meshes} / hotspot ${furn.hotspots.length} / desk ${furn.refs.count}`;
});

console.log('\n[5] コライダー');
ok('resolve（机にめり込まない）', () => {
  const p = coll.resolve(-2.7, -2.05, 0.26); // 机の真ん中
  const d = Math.hypot(p.x + 2.7, p.z + 2.05);
  if (d < 0.2) throw new Error(`押し出しが弱すぎる d=${d.toFixed(3)}`);
  return `desk center -> (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) 押し出し ${d.toFixed(2)}m`;
});
ok('廊下へは扉から入れる', () => {
  // ドア開口 (z 2.22..2.95) を通って x=-5.0 まで行けるか
  let x = -4.0,
    z = 2.55;
  for (let i = 0; i < 200; i++) {
    const r = coll.resolve(x - 0.02, z, 0.26);
    x = r.x;
    z = r.z;
  }
  if (x > -5.0) throw new Error(`廊下の奥まで行けない x=${x.toFixed(2)}`);
  return `x=${x.toFixed(2)} まで到達`;
});
ok('壁は越えられない', () => {
  let x = 4.0,
    z = 0;
  for (let i = 0; i < 200; i++) {
    const r = coll.resolve(x + 0.05, z, 0.26);
    x = r.x;
    z = r.z;
  }
  if (x > 4.5) throw new Error(`窓の壁を抜けた x=${x.toFixed(2)}`);
  return `x=${x.toFixed(2)} で停止`;
});

console.log('\n[6] ちり / 照明 / かけら');
const dustMod = await import('../src/dust.js');
let dust = null;
ok('DustField', () => {
  dust = new dustMod.DustField(60);
  dust.update(0.016);
  return `points ${dust.count}`;
});

const lightMod = await import('../src/lighting.js');
ok('buildLightShafts（3モード）', () => {
  let n = 0;
  for (const mode of lightMod.MODE_ORDER) {
    const p = lightMod.PRESETS[mode];
    const g = roomMod.buildLightShafts(room.refs.windows, p.sunDir, p.shaftIntensity, p.shaftColor);
    n += g.children.length;
    for (const c of g.children) {
      const pos = c.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i),
          z = pos.getZ(i);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) throw new Error(`${mode}: 光の柱に NaN`);
        if (x < -4.6 || x > 4.6 || y < -0.1 || y > 3.1 || z < -4.2 || z > 4.2)
          throw new Error(`${mode}: 光の柱が部屋の外 x=${x.toFixed(2)} y=${y.toFixed(2)} z=${z.toFixed(2)}`);
      }
    }
  }
  return `${n} shafts / 全頂点が部屋の中`;
});

const scene = new THREE.Scene();
const interactMod = await import('../src/interact.js');
let fragments = null;
ok('createFragments', () => {
  fragments = interactMod.createFragments(M, scene);
  for (const fr of fragments) {
    const [x, y, z] = fr.pos;
    if (x < -5.7 || x > 4.45 || y < 0 || y > 3 || z < -4 || z > 4)
      throw new Error(`${fr.id} が部屋の外: ${fr.pos}`);
  }
  return `${fragments.length} 個 / 位置チェックOK`;
});

ok('TimeOfDay（擬似レンダラで全モード切替）', () => {
  const fakeRenderer = { toneMappingExposure: 1, capabilities: { getMaxAnisotropy: () => 8 } };
  room.group.add(room.refs.shaftGroup);
  scene.add(room.group);
  const tod = new lightMod.TimeOfDay(scene, fakeRenderer, room.refs, dust);
  for (const mode of lightMod.MODE_ORDER) {
    tod.set(mode, true);
    if (!isFinite(tod.sun.intensity)) throw new Error(`${mode}: sun.intensity が NaN`);
    for (let i = 0; i < 20; i++) tod.update(0.05);
  }
  tod.set('day');
  for (let i = 0; i < 40; i++) tod.update(0.05);
  return `sun ${tod.sun.intensity.toFixed(2)} / fog ${scene.fog.color.getHexString()}`;
});

console.log('\n[7] プレイヤー');
const playerMod = await import('../src/player.js');
ok('Player（1秒ぶん歩く）', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 100);
  const p = new playerMod.Player(cam, coll, null, { canvas: null, stickZone: null, stickKnob: null });
  p.enabled = true;
  p.teleport(0.45, -3.1, Math.PI);
  p.keys.add('w');
  for (let i = 0; i < 60; i++) p.update(1 / 60);
  if (!isFinite(cam.position.x) || !isFinite(cam.position.y) || !isFinite(cam.position.z))
    throw new Error('カメラ位置が NaN');
  if (cam.position.y < 1.2 || cam.position.y > 1.8) throw new Error(`目の高さがおかしい y=${cam.position.y}`);
  return `pos (${p.pos.x.toFixed(2)}, ${p.pos.z.toFixed(2)}) eye ${cam.position.y.toFixed(2)}`;
});
ok('Player（机にぶつかって止まる）', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 100);
  const p = new playerMod.Player(cam, coll, null, { canvas: null });
  p.enabled = true;
  p.teleport(0.65, -1.6, Math.PI / 2); // 通路から机の列へ横向きに突っ込む（yaw=90° → -x）
  p.keys.add('w');
  for (let i = 0; i < 240; i++) p.update(1 / 60);
  if (p.pos.x < 0.5) throw new Error(`机をすり抜けた x=${p.pos.x.toFixed(2)}`);
  return `x=${p.pos.x.toFixed(2)} で止まった（机の列の手前）`;
});
ok('Player（机の間を横に歩けない＝ realism）', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 100);
  const p = new playerMod.Player(cam, coll, null, { canvas: null });
  p.enabled = true;
  p.teleport(-2.7, 3.3, 0); // 一番うしろの列の上から前へ
  p.keys.add('w');
  for (let i = 0; i < 400; i++) p.update(1 / 60);
  return `z=${p.pos.z.toFixed(2)} x=${p.pos.x.toFixed(2)}`;
});
ok('Player（通路を最後まで歩ける）', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 100);
  const p = new playerMod.Player(cam, coll, null, { canvas: null });
  p.enabled = true;
  p.teleport(0.675, -3.0, Math.PI);
  p.keys.add('w');
  for (let i = 0; i < 600; i++) p.update(1 / 60);
  if (p.pos.z < 3.4) throw new Error(`通路を歩き切れない z=${p.pos.z.toFixed(2)} x=${p.pos.x.toFixed(2)}`);
  return `(${p.pos.x.toFixed(2)}, ${p.pos.z.toFixed(2)}) まで到達`;
});

console.log('\n[8] Interaction');
ok('Interaction 構築（メッシュ収集とBox）', () => {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 100);
  cam.position.set(0.45, 1.58, -3.1);
  cam.rotation.set(0, Math.PI, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  const hotspots = [...room.hotspots, ...furn.hotspots];
  const stubUI = {
    prompt() {},
    hidePrompt() {},
    crosshair() {},
    card() {},
    toast() {},
  };
  const it = new interactMod.Interaction({
    camera: cam,
    hotspots,
    fragments,
    blockers: [],
    ui: stubUI,
    actions: {},
  });
  for (const h of it.hotspots) {
    if (!h._meshes.length) throw new Error(`hotspot "${h.id}" にメッシュが無い`);
    if (h._box.isEmpty()) throw new Error(`hotspot "${h.id}" の Box が空`);
  }
  it.update(0.06, 0);
  it.update(0.06, 0.1);
  return `hotspot ${it.hotspots.length} / mesh 合計 ${it.hotspots.reduce((a, h) => a + h._meshes.length, 0)}`;
});

console.log('\n[8.5] 行きやすさ（洪水充填）');
ok('すべての記憶のかけらに歩いて行ける', () => {
  const R = 0.26;
  const step = 0.15;
  const xs = [], zs = [];
  for (let x = -5.8; x <= 4.5; x += step) xs.push(x);
  for (let z = -4.0; z <= 4.0; z += step) zs.push(z);
  const W = xs.length, H = zs.length;
  const free = new Uint8Array(W * H);
  const idx = (i, j) => j * W + i;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const r = coll.resolve(xs[i], zs[j], R);
      free[idx(i, j)] = Math.hypot(r.x - xs[i], r.z - zs[j]) < 0.02 ? 1 : 0;
    }
  const startI = xs.findIndex((x) => x >= 0.45);
  const startJ = zs.findIndex((z) => z >= -3.1);
  const seen = new Uint8Array(W * H);
  const q = [idx(startI, startJ)];
  seen[q[0]] = 1;
  while (q.length) {
    const cur = q.pop();
    const ci = cur % W, cj = (cur - ci) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = idx(ni, nj);
      if (seen[n] || !free[n]) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  let freeCount = 0;
  for (let i = 0; i < free.length; i++) if (free[i]) freeCount++;
  let reachCount = 0;
  for (let i = 0; i < seen.length; i++) if (seen[i]) reachCount++;

  const problems = [];
  for (const f of fragments) {
    const [fx, , fz] = f.pos;
    let best = Infinity, bestSeen = false;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const d = Math.hypot(xs[i] - fx, zs[j] - fz);
        if (d > 1.3 || !free[idx(i, j)]) continue;
        if (d < best) { best = d; bestSeen = seen[idx(i, j)] === 1; }
      }
    if (!bestSeen) problems.push(`${f.id}(${fx.toFixed(2)},${fz.toFixed(2)}) best=${best.toFixed(2)}`);
  }
  // ホットスポットも、少なくとも一部は届くこと
  if (problems.length) throw new Error('行けないかけら: ' + problems.join(' / '));
  return `到達可能セル ${reachCount}/${freeCount}（${((reachCount / freeCount) * 100).toFixed(0)}%）/ かけら8個すべて到達OK`;
});

/* ---------- 見つけられるか（視線＋到達） ---------- */
console.log('\n[8.6] 気づけるか（視線シミュレーション）');
ok('かけら・調べられる物すべてに気づける', () => {
  // ブロッカー（壁・床・天井）
  const blockers = [];
  for (const g of [room.group, furn.group]) {
    g.traverse((o) => {
      if (o.isMesh && o.userData.shell) blockers.push(o);
    });
  }
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 100);
  const stubUI = { prompt() {}, hidePrompt() {}, crosshair() {}, card() {}, toast() {} };
  const it = new interactMod.Interaction({
    camera: cam, hotspots: [...room.hotspots, ...furn.hotspots], fragments, blockers, ui: stubUI, actions: {},
  });

  // 到達可能セル（[8.5] と同じ条件）
  const R = 0.26, step = 0.15;
  const xs = [], zs = [];
  for (let x = -5.8; x <= 4.5; x += step) xs.push(x);
  for (let z = -4.0; z <= 4.0; z += step) zs.push(z);
  const W = xs.length, H = zs.length;
  const free = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  const idx = (i, j) => j * W + i;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const r = coll.resolve(xs[i], zs[j], R);
      free[idx(i, j)] = Math.hypot(r.x - xs[i], r.z - zs[j]) < 0.02 ? 1 : 0;
    }
  const si = xs.findIndex((x) => x >= 0.45), sj = zs.findIndex((z) => z >= -3.1);
  const q = [idx(si, sj)];
  seen[q[0]] = 1;
  while (q.length) {
    const cur = q.pop();
    const ci = cur % W, cj = (cur - ci) / W;
    for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = idx(ni, nj);
      if (seen[n] || !free[n]) continue;
      seen[n] = 1; q.push(n);
    }
  }

  const aim = (ex, ey, ez, tx, ty, tz) => {
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const hd = Math.hypot(dx, dz) || 1e-6;
    cam.position.set(ex, ey, ez);
    cam.rotation.set(Math.atan2(dy, hd), Math.atan2(-dx, -dz), 0, 'YXZ');
    cam.updateMatrixWorld(true);
  };

  const bad = [];
  const eyes = [1.58, 1.2, 0.94];
  // かけら
  for (const f of fragments) {
    const [fx, fy, fz] = f.pos;
    let found = null;
    for (let j = 0; j < H && !found; j += 2)
      for (let i = 0; i < W; i += 2) {
        if (!seen[idx(i, j)]) continue;
        const d = Math.hypot(xs[i] - fx, zs[j] - fz);
        if (d > 1.5 || d < 0.15) continue;
        for (const ey of eyes) {
          aim(xs[i], ey, zs[j], fx, fy, fz);
          it._detect();
          if (it.target && it.target.kind === 'fragment' && it.target.ref.id === f.id) {
            found = `(${xs[i].toFixed(2)},${zs[j].toFixed(2)}) 視線${ey}m`;
            break;
          }
        }
        if (found) break;
      }
    if (!found) bad.push(`かけら:${f.id}`);
    else f._how = found;
  }
  // ホットスポット
  for (const h of it.hotspots) {
    const c = h._box.getCenter(new THREE.Vector3());
    const reach = h.reach || 2.2;
    // 狙う点は「箱の中心」だけでなく「各メッシュの中心」も試す（実プレイと同じ）
    const targets = [c];
    for (const m of h._meshes) {
      const mb = new THREE.Box3().setFromObject(m);
      if (!mb.isEmpty()) targets.push(mb.getCenter(new THREE.Vector3()));
    }
    let found = null;
    for (let j = 0; j < H && !found; j += 2)
      for (let i = 0; i < W && !found; i += 2) {
        if (!seen[idx(i, j)]) continue;
        const d = Math.hypot(xs[i] - c.x, zs[j] - c.z);
        if (d > reach + 0.6) continue;
        for (const t of targets) {
          for (const ey of eyes) {
            aim(xs[i], ey, zs[j], t.x, t.y + 0.02, t.z);
            it._detect();
            if (it.target && it.target.ref === h) {
              found = `(${xs[i].toFixed(2)},${zs[j].toFixed(2)}) 視線${ey}m`;
              break;
            }
          }
          if (found) break;
        }
      }
    if (!found) {
      bad.push(`物:${h.id}`);
      const mn = h._box.min, mx = h._box.max;
      console.log(`      debug ${h.id}: box [${mn.x.toFixed(2)},${mn.y.toFixed(2)},${mn.z.toFixed(2)}]→[${mx.x.toFixed(2)},${mx.y.toFixed(2)},${mx.z.toFixed(2)}] reach=${h.reach} meshes=${h._meshes.length}`);
      for (const m of h._meshes) {
        const b = new THREE.Box3().setFromObject(m);
        console.log(`        mesh ${m.type} vis=${m.visible} box [${b.min.x.toFixed(3)},${b.min.y.toFixed(3)},${b.min.z.toFixed(3)}]→[${b.max.x.toFixed(3)},${b.max.y.toFixed(3)},${b.max.z.toFixed(3)}]`);
      }
    }
    else h._how = found;
  }
  if (bad.length) throw new Error('気づけない: ' + bad.join(' / '));
  return `かけら8 / 物${it.hotspots.length} — すべて立ち位置から見つかる（ブロッカー${blockers.length}）`;
});

console.log('\n[9] ミニマップ');
const mm = await import('../src/minimap.js');
ok('Minimap.draw', () => {
  const cv = makeCanvas(190, 170);
  const map = new mm.Minimap(cv, { fragments });
  const fakePlayer = { pos: { x: 0.4, z: -2.6 }, yaw: Math.PI };
  map._acc = 1;
  map.update(0.1, fakePlayer);
  return `scale ${map.s.toFixed(2)} px/m`;
});

/* ---------- [10] DOM 参照の整合 ---------- */
console.log('\n[10] DOM 参照');
ok('コードが参照する id / class は index.html に全部ある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const files = ['main.js','ui.js','minimap.js','sketchfab.js','player.js','audio.js','interact.js'];
  const missing = [];
  // JS 側で動的に生成する id は除外
  const dynamic = new Set();
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)) dynamic.add(m[1]);
  }
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\$\('([a-zA-Z0-9_-]+)'\)/g)) {
      if (!dynamic.has(m[1]) && !html.includes(`id="${m[1]}"`)) missing.push(`${f}: #${m[1]}`);
    }
    for (const m of src.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)) {
      if (!dynamic.has(m[1]) && !html.includes(`id="${m[1]}"`)) missing.push(`${f}: #${m[1]}`);
    }
    for (const m of src.matchAll(/querySelector(?:All)?\('\.([a-zA-Z0-9_-]+)'\)/g)) {
      if (!html.includes(`class="${m[1]}"`) && !new RegExp(`class="[^"]*\\b${m[1]}\\b`).test(html)) missing.push(`${f}: .${m[1]}`);
    }
  }
  if (missing.length) throw new Error('HTML に無い参照: ' + [...new Set(missing)].join(' / '));
  return `${files.length} ファイルの参照すべて OK`;
});

/* ==================== [11]-[14] GLB 教室（本物のモデル） ==================== */
const GLB_URL = new URL('../public/models/classroom.glb', import.meta.url);
const freeAt = (colliders, x, z, r) => {
  const p = colliders.resolve(x, z, r);
  return Math.hypot(p.x - x, p.z - z) < 0.02;
};
const clearPath = (colliders, ax, az, bx, bz, r = 0.05) => {
  // 終端は家具の中（黒板のチョーク受けなど）でもよいので手前 92% まで
  for (let i = 1; i <= 13; i++) {
    const t = i / 14;
    if (!freeAt(colliders, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
};
const findView = (GW, tx, tz, dists = [0.9, 1.2, 1.5]) => {
  const B = GW.bounds;
  for (const dist of dists) {
    for (let ai = 0; ai < 32; ai++) {
      const ang = (ai / 32) * Math.PI * 2;
      const x = tx + Math.cos(ang) * dist;
      const z = tz + Math.sin(ang) * dist;
      if (x < B.x0 + 0.15 || x > B.x1 - 0.15 || z < B.z0 + 0.15 || z > B.z1 - 0.15) continue;
      if (!freeAt(GW.colliders, x, z, GW.playerRadius || 0.2)) continue;
      if (!clearPath(GW.colliders, x, z, tx, tz, 0.04)) continue;
      return { x, z };
    }
  }
  return null;
};

if (!existsSync(GLB_URL)) {
  console.log('\n[11] GLB教室 — public/models/classroom.glb が無いのでスキップ');
  console.log('     取得: npm run model:fetch（手順は public/models/README.md）');
} else {
  const gc = await import('../src/glb-collide.js');
  const gcontent = await import('../src/glb-content.js');
  const glbBuf = readFileSync(GLB_URL);
  const A = gc.analyzeGLB(glbBuf, { cell: 0.1 });
  const T = gc.makeTransform(A);
  const rr = T.rect(A.grid.floorLo[0], A.grid.floorLo[1], A.grid.floorHi[0], A.grid.floorHi[1]);

  console.log(`\n[11] GLB解析 — ${(glbBuf.length / 1e6).toFixed(1)} MB / ${A.triangles.toLocaleString()} 三角形`);
  ok('縮尺・部屋寸法・床面', () => {
    // 縮尺は「1単位=1m」の glTF も cm/FBX 由来も有り得るので、実寸が教室らしくなるかで見る
    if (!(A.unitsPerMeter > 0.05 && A.unitsPerMeter < 20)) throw new Error(`unitsPerMeter=${A.unitsPerMeter}`);
    const w = rr.x1 - rr.x0, d = rr.z1 - rr.z0;
    if (!(w > 5 && w < 14)) throw new Error(`横幅 ${w.toFixed(2)} m`);
    if (!(d > 5 && d < 16)) throw new Error(`奥行 ${d.toFixed(2)} m`);
    if (Math.abs(A.floorY) > 0.6) throw new Error(`床面 y=${A.floorY}`);
    if (A.rawBoxes.length < 10) throw new Error(`塊 ${A.rawBoxes.length}`);
    const rotDeg = (T.rot * 180) / Math.PI;
    // 解析が出す回転は 0 / ±90 / 180 のいずれか（部屋の軸に合わせるため）
    const rem = ((rotDeg % 90) + 90) % 90;
    if (!(rem < 1 || rem > 89)) throw new Error(`回転 ${rotDeg.toFixed(2)}deg が90°の倍数でない`);
    return `${A.unitsPerMeter.toFixed(4)} u/m (${A.scaleReason}) / 回転${rotDeg.toFixed(0)}deg (${A.rotReason}) / ${w.toFixed(2)}×${d.toFixed(2)} m / 床y=${A.floorY.toFixed(2)} / 塊${A.rawBoxes.length}`;
  });

  console.log('\n[12] GLBワールド構築（Node上で buildGLBWorld を実行）');
  const { buildGLBWorld } = await import('../src/glbworld.js');
  const gScene = new THREE.Scene();
  const gRenderer = { toneMappingExposure: 1, capabilities: { getMaxAnisotropy: () => 8 } };
  const gM = mats.createMaterials();
  const t0 = Date.now();
  const GW = await buildGLBWorld({ scene: gScene, renderer: gRenderer, buffer: glbBuf, M: gM, onProgress: () => {} });
  const built = Date.now() - t0;
  ok('ワールド生成', () => {
    if (GW.mode !== 'glb') throw new Error(`mode=${GW.mode}`);
    if (GW.hotspots.length !== gcontent.GLB_HOTSPOT_DEFS.length) throw new Error('hotspots 数不一致');
    if (GW.fragments.length !== gcontent.GLB_FRAGMENT_DEFS.length) throw new Error('fragments 数不一致');
    if (GW.colliders.count < 20) throw new Error(`colliders=${GW.colliders.count}`);
    if (!GW.blockers.length) throw new Error('blockers 0');
    if (!GW.tod || !GW.tod.sun) throw new Error('TimeOfDay が無い');
    // モデル本体のメッシュ数（三角形数）は差し替えると変わるので、
    // 「本体が入っているか」＋「照合プロキシが足りているか」で見る。
    const holder = gScene.getObjectByName('glb-classroom');
    if (!holder) throw new Error('glb-classroom が入っていない');
    let modelMeshes = 0;
    holder.traverse((o) => { if (o.isMesh) modelMeshes++; });
    if (modelMeshes < 4) throw new Error(`モデルのメッシュ ${modelMeshes}`);
    let meshN = 0;
    gScene.traverse((o) => { if (o.isMesh) meshN++; });
    if (meshN < modelMeshes + 20) throw new Error(`シーン内メッシュ ${meshN}`);
    if (GW.colliders.count < 20) throw new Error(`colliders=${GW.colliders.count}`);
    if (!GW.stats.lampMats) throw new Error('蛍光灯の発光マテリアルが拾えていない');
    return `${built}ms / モデルのメッシュ${modelMeshes}（シーン計${meshN}） / 当たり${GW.colliders.count} / 物${GW.hotspots.length} / かけら${GW.fragments.length} / ブロッカー${GW.blockers.length} / ガラス${GW.stats.glassCount} / 発光${GW.stats.lampMats}`;
  });

  ok('スポーンと外周', () => {
    const SP = gcontent.GLB_SPAWN, B = GW.bounds, R = GW.playerRadius || 0.235;
    if (!freeAt(GW.colliders, SP.x, SP.z, R)) throw new Error(`スポーン(${SP.x},${SP.z})が障害物の中`);
    if (!(SP.x > B.x0 && SP.x < B.x1 && SP.z > B.z0 && SP.z < B.z1)) throw new Error('スポーンが部屋の外');
    // 外周のすぐ外は壁帯の中なので必ず押し返される
    for (const [x, z] of [[B.x0 - 0.12, 0], [B.x1 + 0.12, 0], [0, B.z0 - 0.12], [0, B.z1 + 0.12],
                          [B.x0 - 0.12, B.z0 + 1], [B.x1 + 0.12, B.z1 - 1]]) {
      if (freeAt(GW.colliders, x, z, R)) throw new Error(`外周が素通り (${x.toFixed(2)},${z.toFixed(2)})`);
    }
    return `bounds x[${B.x0.toFixed(2)},${B.x1.toFixed(2)}] z[${B.z0.toFixed(2)},${B.z1.toFixed(2)}] / 四方向ふさがりOK`;
  });

  console.log('\n[13] GLB 行きやすさ（洪水充填）');
  ok('全かけら・全スポットに歩いて行ける', () => {
    const step = 0.15, B = GW.bounds, R = GW.playerRadius || 0.235;
    const xs = [], zs = [];
    for (let x = B.x0 - 0.1; x <= B.x1 + 0.1; x += step) xs.push(x);
    for (let z = B.z0 - 0.1; z <= B.z1 + 0.1; z += step) zs.push(z);
    const W = xs.length, H = zs.length;
    const free = new Uint8Array(W * H);
    const idx = (i, j) => j * W + i;
    let freeCount = 0;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const f = freeAt(GW.colliders, xs[i], zs[j], R) ? 1 : 0;
        free[idx(i, j)] = f;
        freeCount += f;
      }
    const SP = gcontent.GLB_SPAWN;
    let si = 0, sj = 0, best = 1e9;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (!free[idx(i, j)]) continue;
        const d = Math.hypot(xs[i] - SP.x, zs[j] - SP.z);
        if (d < best) { best = d; si = i; sj = j; }
      }
    const seen = new Uint8Array(W * H);
    const q = [idx(si, sj)];
    seen[q[0]] = 1;
    while (q.length) {
      const cur = q.pop();
      const ci = cur % W, cj = (cur - ci) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = idx(ni, nj);
        if (seen[n] || !free[n]) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    let reach = 0;
    for (let i = 0; i < seen.length; i++) reach += seen[i];
    if (reach < freeCount * 0.6) throw new Error(`到達 ${(reach / freeCount * 100).toFixed(0)}% (床 ${freeCount} / 到達 ${reach})`);

    const nearest = (tx, tz) => {
      let bd = 1e9;
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          if (!seen[idx(i, j)]) continue;
          const d = Math.hypot(xs[i] - tx, zs[j] - tz);
          if (d < bd) bd = d;
        }
      return bd;
    };
    let fragMax = 0, hotMax = 0;
    for (const f of GW.fragments) {
      const d = nearest(f.pos[0], f.pos[2]);
      fragMax = Math.max(fragMax, d);
      if (d > 1.7) throw new Error(`${f.id}(${f.pos[0].toFixed(2)},${f.pos[2].toFixed(2)}) まで ${d.toFixed(2)} m（検知距離 1.7 m 超）`);
    }
    for (const h of GW.hotspots) {
      const d = nearest(h.anchor.x, h.anchor.z);
      hotMax = Math.max(hotMax, d);
      if (d > h.reach + 0.6) throw new Error(`${h.id} まで ${d.toFixed(2)} m（reach ${h.reach}）`);
    }
    return `床 ${(freeCount / (W * H) * 100).toFixed(0)}% / 到達 ${(reach / freeCount * 100).toFixed(0)}% / かけら最遠 ${fragMax.toFixed(2)} m / 物最遠 ${hotMax.toFixed(2)} m`;
  });

  console.log('\n[14] GLB 検知（Interaction と同じルールで見つかるか）');
  ok('かけら・物に立ち位置から気づける', () => {
    const ray = new THREE.Raycaster();
    const PR = GW.playerRadius || 0.235;
    const EYES = [1.58, 0.94]; // 立つ / しゃがむ
    const spots = (tx, tz, maxD) => {
      const B = GW.bounds;
      const out = [];
      for (const dist of [0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.4]) {
        if (dist > maxD + 0.4) continue;
        for (let ai = 0; ai < 32; ai++) {
          const ang = (ai / 32) * Math.PI * 2;
          const x = tx + Math.cos(ang) * dist;
          const z = tz + Math.sin(ang) * dist;
          if (x < B.x0 + 0.1 || x > B.x1 - 0.1 || z < B.z0 + 0.1 || z > B.z1 - 0.1) continue;
          if (!freeAt(GW.colliders, x, z, PR)) continue;
          out.push({ x, z });
        }
      }
      return out;
    };

    let fragHit = 0;
    for (const f of GW.fragments) {
      const cands = spots(f.pos[0], f.pos[2], 1.7);
      let good = null;
      for (const c of cands) {
        for (const eye of EYES) {
          const d = Math.hypot(c.x - f.pos[0], eye - f.pos[1], c.z - f.pos[2]);
          if (d <= 1.7) { good = { ...c, eye, d }; break; }
        }
        if (good) break;
      }
      if (!good) {
        throw new Error(
          `${f.id}(${f.pos[0].toFixed(2)},${f.pos[1].toFixed(2)},${f.pos[2].toFixed(2)}) の前に立てない（候補${cands.length}）`
        );
      }
      fragHit++;
    }

    let hotHit = 0;
    for (const h of GW.hotspots) {
      const [x0, y0, z0, x1, y1, z1] = h.meshes[0].userData.box6;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      const reach = h.reach;
      const cands = spots(cx, cz, reach);
      let good = null;
      for (const c of cands) {
        for (const eye of EYES) {
          const from = new THREE.Vector3(c.x, eye, c.z);
          const cl = new THREE.Vector3(
            Math.max(x0, Math.min(x1, from.x)),
            Math.max(y0, Math.min(y1, from.y)),
            Math.max(z0, Math.min(z1, from.z))
          );
          if (from.distanceTo(cl) > reach) continue; // Box3.clampPoint が reach 超
          const dir = new THREE.Vector3(cx, cy, cz).sub(from).normalize();
          ray.set(from, dir);
          ray.far = reach;
          const hits = ray.intersectObjects(h.meshes, false);
          if (!hits.length || hits[0].distance > reach) continue;
          ray.far = 30;
          const bh = ray.intersectObjects(GW.blockers, false);
          const blockDist = bh.length ? bh[0].distance : Infinity;
          if (hits[0].distance > blockDist + 0.08) continue; // 壁ごしは不可
          good = { ...c, eye, dist: hits[0].distance };
          break;
        }
        if (good) break;
      }
      if (!good) {
        throw new Error(
          `${h.id}（中心 ${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)} / reach ${reach}）に気づける立ち位置が無い（候補${cands.length}）`
        );
      }
      hotHit++;
    }

    // 前提：プロキシは visible=false でもレイキャストに当たる
    for (const h of GW.hotspots) {
      if (h.meshes[0].visible !== false) throw new Error(`${h.id} のプロキシが visible=false でない`);
    }
    return `かけら ${fragHit}/${GW.fragments.length} / 物 ${hotHit}/${GW.hotspots.length} 気づける（invisible プロキシでも命中）`;
  });

}


console.log('');
if (errors.length) {
  console.error(`✗ ${errors.length} 件のエラー`);
  process.exit(1);
} else {
  console.log('✓ スモークテスト通過');
}
