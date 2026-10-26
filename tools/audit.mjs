/**
 * 形状監査 — 「壁にめり込んでいる／床より下／天井より上」メッシュを洗い出す。
 * ブラウザで見られない環境なので、数値で粗を探すために使う。
 *
 *   node tools/audit.mjs
 */
import './stub.mjs';
import * as THREE from 'three';
import { ROOM as R } from '../src/materials.js';
import { buildWorld } from '../src/world.js';

const scene = new THREE.Scene();
const renderer = {
  capabilities: { getMaxAnisotropy: () => 4, isWebGL2: true },
  getPixelRatio: () => 1,
  shadowMap: { enabled: false, type: 0 },
  setSize() {},
  setPixelRatio() {},
  render() {},
  domElement: globalThis.document.createElement('canvas'),
  info: { render: {} },
};

const world = await buildWorld({ scene, renderer, onProgress: () => {} });
scene.updateMatrixWorld(true);

const WALL_T = 0.19; // 壁の外側に行ってよい量（窓台・背板など）
const box = new THREE.Box3();
const issues = [];

/** 壁・床・天井・外の背景などは除外 */
function skip(o) {
  if (o.userData && o.userData.shell) return true;
  if (o.type === 'Points' || o.type === 'Sprite' || o.type === 'Line') return true;
  if (o.isMesh) {
    const m = o.material;
    if (m && (m.transparent || m.depthWrite === false || m.blending === THREE.AdditiveBlending)) return true;
  }
  let p = o;
  while (p) {
    if (p.name === 'outside' || p.name === 'shafts' || p.name === 'backdrop') return true;
    p = p.parent;
  }
  return false;
}

function label(o) {
  const chain = [];
  let p = o;
  while (p && p !== scene) {
    const q = p.position;
    const tag = p.name || p.type;
    chain.unshift(`${tag}@(${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)})`);
    p = p.parent;
  }
  return chain.slice(-3).join(' > ');
}

scene.traverse((o) => {
  if (!o.isMesh || skip(o)) return;
  box.setFromObject(o);
  if (box.isEmpty() || !isFinite(box.min.x)) return;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const out = [];

  // 右壁（窓側）x = X1
  if (cx < R.X1 && box.max.x > R.X1 + WALL_T) out.push(`右壁+${(box.max.x - R.X1).toFixed(3)}`);
  // 左壁 x = X0（廊下のくぼみ z∈[DOOR.z0-0.05, DOOR.z1+0.05] は除く）
  const inCorridorZ = cz > 1.75 && cz < 3.05;
  if (!inCorridorZ && cx > R.X0 && box.min.x < R.X0 - WALL_T) out.push(`左壁+${(R.X0 - box.min.x).toFixed(3)}`);
  // 前壁（黒板側）z = Z0
  if (cz > R.Z0 && box.min.z < R.Z0 - WALL_T) out.push(`前壁+${(R.Z0 - box.min.z).toFixed(3)}`);
  // 後壁 z = Z1
  if (cz < R.Z1 && box.max.z > R.Z1 + WALL_T) out.push(`後壁+${(box.max.z - R.Z1).toFixed(3)}`);
  // 床
  if (box.min.y < -0.02) out.push(`床下${(-box.min.y).toFixed(3)}`);
  // 天井
  if (box.max.y > R.H + 0.02) out.push(`天井超${(box.max.y - R.H).toFixed(3)}`);

  if (out.length) {
    issues.push({
      where: out.join(' / '),
      what: label(o),
      box: `[${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}]→[${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)}]`,
      depth: Math.max(...out.map((s) => parseFloat(s.replace(/^\D+/, '')))),
    });
  }
});

issues.sort((a, b) => b.depth - a.depth);
console.log(`\n壁・床・天井をはみ出しているメッシュ: ${issues.length} 件\n`);
for (const it of issues.slice(0, 40)) {
  console.log(`  ${it.depth.toFixed(3)}m  ${it.where.padEnd(22)} ${it.what.padEnd(28)} ${it.box}`);
}

// 統計
let meshes = 0;
scene.traverse((o) => {
  if (o.isMesh) meshes++;
});
console.log(`\nメッシュ総数 ${meshes} / コライダー ${world.colliders.count} / ホットスポット ${world.hotspots.length} / かけら ${world.fragments.length}`);
