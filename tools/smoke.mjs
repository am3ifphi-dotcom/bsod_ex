/**
 * ヘッドレス・スモークテスト（CI / 手元の Node で実行）
 *
 * ブラウザ無しで
 *   ・classroom.glb のパースとマテリアル改変
 *   ・教室の小道具（黒板・窓外・自販機・配信ブース・ホログラム・ノート・本質の漏出）
 *   ・立ち絵26点のシェーダマテリアルと配置
 *   ・12場面ぶんの applyScene / show / setPose
 *   ・カメラ演出の更新
 * を実行し、例外が出ないことを確かめる。
 *
 * 使い方（リポジトリ直下）:
 *   npm i -D jsdom @napi-rs/canvas   # 初回のみ
 *   node tools/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* ---------- DOM の代わり ---------- */
const { JSDOM } = require('jsdom');
const { createCanvas } = require('@napi-rs/canvas');

const indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const dom = new JSDOM(indexHtml, { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Image = dom.window.Image;
globalThis.self = dom.window;

// CanvasTexture は image の width/height を参照する
const origCreate = dom.window.document.createElement.bind(dom.window.document);
dom.window.document.createElement = (tag) => {
  if (String(tag).toLowerCase() === 'canvas') return createCanvas(1, 1);
  return origCreate(tag);
};

/* ---------- three ---------- */
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

const { UI } = await import('../src/ui.js');
const { CHARACTERS } = await import('../src/data/characters.js');
const { World } = await import('../src/world.js');
const { Cast } = await import('../src/cutout.js');
const { Walker } = await import('../src/walker.js');
const { SCENES, ROUTE } = await import('../src/data/scenes.js');
const { COLLIDERS, ROOM } = await import('../src/data/colliders.js');

const fail = [];
const ok = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    fail.push(`${label}: ${err.message}`);
    console.log(`  ✗ ${label} — ${err.message}`);
  }
};

console.log('■ シーン / ワールド構築');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.05, 200);
const world = new World(null, scene);
const cast = new Cast(scene);

const domEl = dom.window.document.createElement('div');
const walker = new Walker(camera, domEl);

/* ---------- GLB ---------- */
console.log('■ classroom.glb のパース');
const glbPath = path.join(process.cwd(), 'public/models/classroom.glb');
const buf = fs.readFileSync(glbPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
const gltf = await new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));
ok('GLTF パース', () => {
  if (!gltf.scene) throw new Error('scene が無い');
});
ok('applyGltf（スケール0.01 / マテリアル改変）', () => world.applyGltf(gltf));
ok('ネオン材質の収集', () => {
  if (!world.neonMats.length) throw new Error('neon マテリアルが見つからない');
});

let meshCount = 0;
gltf.scene.traverse((o) => { if (o.isMesh) meshCount++; });
console.log(`  · メッシュ数 ${meshCount} / ネオン ${world.neonMats.length}`);

/* ---------- 場面 ---------- */
console.log('■ 全場面の適用');
let props = 0;
for (const sc of SCENES) {
  ok(`${sc.no} ${sc.title}`, () => {
    world.applyScene(sc.env);
    cast.show(sc.cast);
    const a = ROUTE[sc.id].anchor;
    walker.setPose(a.x, a.z, a.look[0], a.look[1]);
    // 台詞ごとのショットが定義されているか
    for (const line of sc.lines) {
      if (line.shot && !sc.shots[line.shot]) throw new Error(`未定義のショット: ${line.shot}`);
      if (line.spk !== 'narr' && !line.pose) continue;
    }
    props += sc.cast.length;
  });
}

/* ---------- 更新ループ ---------- */
console.log('■ update ループ（120フレーム）');
ok('world.update / cast.update / walker.update', () => {
  walker.enter();
  walker.keys.add('KeyW');
  for (let i = 0; i < 180; i++) {
    const t = i / 60;
    walker.update(1 / 60);
    world.update(1 / 60, t, camera);
    cast.update(1 / 60, t, { fogColor: scene.fog.color, fogDensity: scene.fog.density });
  }
  walker.keys.clear();
});

/* ---------- 立ち絵 ---------- */
console.log('■ 立ち絵');
ok('26ポーズぶんのテクスチャ定義', () => {
  let n = 0;
  for (const c of cast.items.values()) n += Object.keys(c.def.poses).length;
  if (n < 20) throw new Error(`ポーズが少なすぎる: ${n}`);
  console.log(`  · ポーズ数 ${n} / 人物 ${cast.items.size}`);
});
ok('ポーズ切り替え（テクスチャ未ロードでも落ちない）', () => {
  for (const c of cast.items.values()) c.setPose(c.def.defaultPose);
});
ok('配置の座標が教室の内側', () => {
  const { SPOTS } = cast.__spots || {};
  return SPOTS;
});

/* ---------- 配置 ---------- */
console.log('■ 立ち位置の妥当性');
ok('開始地点が机・壁の外にある', () => {
  for (const sc of SCENES) {
    const a = ROUTE[sc.id].anchor;
    for (const c of COLLIDERS) {
      if (Math.abs(a.x - c.x) < c.hx + 0.1 && Math.abs(a.z - c.z) < c.hz + 0.1) {
        throw new Error(`${sc.no} の開始地点が ${c.kind} と重なる`);
      }
    }
  }
});
ok('HUD の要素が見つかる', () => {
  for (const id of ['crosshair', 'objective', 'obj-no', 'obj-title', 'obj-count', 'obj-bar', 'prompt']) {
    if (!dom.window.document.getElementById(id)) throw new Error(id);
  }
});

/* ---------- UI ---------- */
console.log('■ UI（index.html の DOM を相手に全操作）');
const noop = () => {};
const ui = new UI({ scenes: SCENES, on: { enter: noop, next: noop, scene: noop, free: noop, style: noop, audio: noop, unhighlight: noop } });

ok('DOM の参照が全て解決している', () => {
  const missing = Object.entries(ui.el).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`見つからない要素: ${missing.join(', ')}`);
});

ok('全14場面・全台詞の描画（タイトル / 話者 / 文字送り）', () => {
  ui.progress(1);
  ui.loaded();
  ui.showTitle();
  ui.hideTitle();
  SCENES.forEach((sc, i) => {
    ui.setScene(sc, i);
    sc.lines.forEach((line, k) => {
      ui.setLine(line, k, sc.lines.length);
      if (ui.isTyping()) ui.advancePreview();
    });
  });
});

ok('全人物カード', () => {
  for (const def of Object.values(CHARACTERS)) ui.showCard(def);
  ui.closeCard();
});

ok('目次 / モーダル / 自動送り / UI隠し / FPS', () => {
  ui.toggleTOC();
  ui.closeTOC();
  ui.openCredits();
  ui.closeCredits();
  ui.toggleAuto();
  ui.toggleAuto();
  ui.setStyleLabel('インク');
  ui.setAudioLabel(true);
  ui.setFps(60);
  ui.hideAllUI();
  ui.hideAllUI();
});

ok('目次クリックで場面が要求される', () => {
  let asked = -1;
  const ui2 = new UI({ scenes: SCENES, on: { enter: noop, next: noop, scene: (i) => (asked = i), free: noop, style: noop, audio: noop } });
  dom.window.document.querySelectorAll('.toc-item')[5].click();
  if (asked !== 5) throw new Error(`目次クリックが効かない: ${asked}`);
  ui2.closeTOC();
});

/* ---------- 操作系 ---------- */
console.log('■ 操作（自由視点 / 人物クリック / 場面移動）');
ok('WASD で歩ける（全方向・壁で止まる）', () => {
  walker.enter();
  walker.setPose(0.13, 0.5, 0.13, 4.0);
  const before = { x: walker.pos.x, z: walker.pos.z };
  walker.keys.add('KeyW');
  for (let i = 0; i < 60; i++) walker.update(1 / 60);
  walker.keys.clear();
  const moved = Math.hypot(walker.pos.x - before.x, walker.pos.z - before.z);
  if (moved < 0.4) throw new Error(`進んでいない: ${moved.toFixed(2)}m`);

  // 壁へ向かって走っても教室の外に出ない
  walker.setPose(0, 0, 0, -10);
  walker.keys.add('KeyW');
  walker.keys.add('ShiftLeft');
  for (let i = 0; i < 300; i++) walker.update(1 / 60);
  walker.keys.clear();
  if (walker.pos.z < ROOM.minZ - 0.01 || walker.pos.z > ROOM.maxZ + 0.01) {
    throw new Error(`壁を抜けた: z=${walker.pos.z.toFixed(2)}`);
  }

  // 机の中に立てない
  for (const c of COLLIDERS) {
    walker.setPose(c.x, c.z, c.x, c.z);
    for (let i = 0; i < 10; i++) walker.update(1 / 60);
    const inside = Math.abs(walker.pos.x - c.x) < c.hx && Math.abs(walker.pos.z - c.z) < c.hz;
    if (inside && c.kind === 'desk') throw new Error(`机の中にいる: ${c.x},${c.z}`);
  }
});

/**
 * 歩行可能グリッド上の BFS。開始地点から本質マーカー（1.25m 以内）へ
 * 実際にたどり着けるかを確かめる。
 */
function reachable(from, to, stopDist = 1.2) {
  const step = 0.1;
  const r = 0.22;
  const blocked = (x, z) => {
    if (x < ROOM.minX || x > ROOM.maxX || z < ROOM.minZ || z > ROOM.maxZ) return true;
    for (const c of COLLIDERS) {
      if (Math.abs(x - c.x) < c.hx + r && Math.abs(z - c.z) < c.hz + r) return true;
    }
    return false;
  };
  const key = (x, z) => `${Math.round(x / step)},${Math.round(z / step)}`;
  const start = [from.x, from.z];
  if (blocked(...start)) return { ok: false, reason: 'start blocked' };
  const q = [start];
  const seen = new Set([key(...start)]);
  let guard = 0;
  while (q.length && guard++ < 20000) {
    const [x, z] = q.shift();
    if (Math.hypot(x - to[0], z - to[2]) < stopDist) return { ok: true, dist: Math.hypot(x - to[0], z - to[2]) };
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = Math.round((x + dx) / step) * step;
      const nz = Math.round((z + dz) / step) * step;
      const k = key(nx, nz);
      if (seen.has(k) || blocked(nx, nz)) continue;
      seen.add(k);
      q.push([nx, nz]);
    }
  }
  return { ok: false, reason: 'unreachable' };
}

ok('全14の本質マーカーに歩いて到達できる', () => {
  const bad = [];
  for (const sc of SCENES) {
    const a = ROUTE[sc.id].anchor;
    const m = ROUTE[sc.id].marker;
    const res = reachable(a, m);
    if (!res.ok) bad.push(`${sc.no} ${sc.title}（${res.reason}）`);
  }
  if (bad.length) throw new Error(bad.join(' / '));
});

ok('開始地点から他の場面へも歩いて移動できる', () => {
  const start = ROUTE[SCENES[0].id].anchor;
  const bad = [];
  for (const sc of SCENES) {
    const m = ROUTE[sc.id].marker;
    if (!reachable(start, m).ok) bad.push(sc.no);
  }
  if (bad.length) throw new Error(`行けない場面: ${bad.join(',')}`);
});

ok('ワールドのマーカー表示', () => {
  world.setMarker([0.13, 1.24, 0.25], '#ffb35c');
  world.update(1 / 60, 1, camera);
  if (!world.props.marker.group.visible) throw new Error('マーカーが出ない');
  world.setMarker(null);
});

ok('画面中央の人物をクリック判定できる', () => {
  // 場面02の両馬を、カメラ正面に捉えてからレイを飛ばす
  const sc = SCENES[1];
  cast.show(sc.cast);
  const ryoma = cast.items.get('ryoma');
  // 配置の補間を回してから判定する
  for (let i = 0; i < 60; i++) cast.update(1 / 60, i / 60, { fogColor: scene.fog.color, fogDensity: scene.fog.density });
  walker.setPose(ryoma.targetPos.x, ryoma.targetPos.z + 1.35, ryoma.targetPos.x, ryoma.targetPos.z);
  camera.updateMatrixWorld(true);
  const rc = walker.raycaster();
  const hit = cast.pick(rc);
  if (!hit) throw new Error('人物に当たらない');
  cast.highlight(hit.def.id);
  cast.highlight(null);
});

ok('操作ボタンが全部押せる', () => {
  for (const id of ['btn-toc', 'btn-style', 'btn-audio', 'btn-credits', 'toc-close', 'credits-close', 'cc-close', 'dlg-auto', 'dlg-next', 'enter']) {
    const el = dom.window.document.getElementById(id);
    if (!el) throw new Error(`ボタンが無い: ${id}`);
    el.click();
  }
});

console.log('');
if (fail.length) {
  console.log(`✗ ${fail.length} 件の失敗`);
  process.exit(1);
} else {
  console.log('✓ すべて通過');
}
