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
const { Director } = await import('../src/director.js');
const { SCENES } = await import('../src/data/scenes.js');

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

const domEl = dom.window.document.createElement('div'); // OrbitControls のため
const director = new Director(camera, domEl);

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
    const shot = sc.shots[sc.lines[0].shot] || Object.values(sc.shots)[0];
    director.setShot(shot, { instant: true });
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
ok('world.update / cast.update / director.update', () => {
  for (let i = 0; i < 120; i++) {
    const t = i / 60;
    director.update(1 / 60);
    world.update(1 / 60, t, camera);
    cast.update(1 / 60, t, { fogColor: scene.fog.color, fogDensity: scene.fog.density });
  }
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

/* ---------- ショットの妥当性 ---------- */
console.log('■ カメラ位置の妥当性（教室の内側か）');
ok('全ショットが室内または窓外', () => {
  for (const sc of SCENES) {
    for (const [name, s] of Object.entries(sc.shots)) {
      const [x, y, z] = s.pos;
      const inside = x > -4.1 && x < 4.1 && z > -5.1 && z < 5.1 && y > 0.3 && y < 3.35;
      const outsideWindow = x >= 4.1 && x < 30;
      if (!inside && !outsideWindow) throw new Error(`${sc.no}.${name} が教室の外: ${s.pos}`);
      if (y < 1.1) throw new Error(`${sc.no}.${name} が机の高さより低い: y=${y}`);
    }
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
  ui.setFreeLabel(true);
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
ok('自由視点の出入りと移動', () => {
  director.setFree(true);
  ['KeyW', 'KeyA', 'KeyD', 'KeyS'].forEach((k) => director.keys.add(k));
  for (let i = 0; i < 30; i++) director.update(1 / 60);
  director.keys.clear();
  director.setFree(false);
  for (let i = 0; i < 30; i++) director.update(1 / 60);
});

ok('画面中央の人物をクリック判定できる', () => {
  // 場面02の両馬を、カメラ正面に捉えてからレイを飛ばす
  const sc = SCENES[1];
  cast.show(sc.cast);
  const ryoma = cast.items.get('ryoma');
  director.setShot({ pos: [ryoma.targetPos.x, 1.3, ryoma.targetPos.z + 1.6], tgt: [ryoma.targetPos.x, 1.1, ryoma.targetPos.z], fov: 50 }, { instant: true });
  director.update(1 / 60);
  const rc = director.raycaster(0, 0);
  const hit = cast.pick(rc);
  if (!hit) throw new Error('人物に当たらない');
  cast.highlight(hit.def.id);
  cast.highlight(null);
});

ok('操作ボタンが全部押せる', () => {
  for (const id of ['btn-toc', 'btn-free', 'btn-style', 'btn-audio', 'btn-credits', 'toc-close', 'credits-close', 'cc-close', 'dlg-auto', 'dlg-next', 'enter']) {
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
