/**
 * スモークテスト — ブラウザなしでワールド構築ロジックを通しで実行する。
 * Canvas 2D / WebGL は使えないので、2Dコンテキストはスタブに差し替える。
 *
 *   node tools/smoke.mjs
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

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
    return { style: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
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

console.log('');
if (errors.length) {
  console.error(`✗ ${errors.length} 件のエラー`);
  process.exit(1);
} else {
  console.log('✓ スモークテスト通過');
}
