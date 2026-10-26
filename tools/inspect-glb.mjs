/**
 * GLB 内蔵ビューア（Node 版）— src/glb-collide.js の結果を見やすく出す。
 *
 *   node tools/inspect-glb.mjs public/models/classroom.glb
 */
import { readFileSync } from 'node:fs';
import { analyzeGLB, makeTransform } from '../src/glb-collide.js';

const file = process.argv[2] || 'public/models/classroom.glb';
const buf = readFileSync(file);
const a = analyzeGLB(buf, { cell: 0.1 });
const T = makeTransform(a);

console.log(`file      : ${file} (${(buf.length / 1048576).toFixed(1)} MB)`);
console.log(`triangles : ${a.triangles}`);
console.log(`units/m   : ${a.unitsPerMeter.toFixed(3)}  (${a.scaleReason || '既定'})  → 1u = ${(100 / a.unitsPerMeter).toFixed(1)}cm`);

const room = T.rect(a.grid.floorLo[0], a.grid.floorLo[1], a.grid.floorHi[0], a.grid.floorHi[1]);
console.log(`room(m)   : x[${room.x0.toFixed(2)},${room.x1.toFixed(2)}] z[${room.z0.toFixed(2)},${room.z1.toFixed(2)}]  = ${(room.x1 - room.x0).toFixed(2)} x ${(room.z1 - room.z0).toFixed(2)} m`);

/* --- 世界空間の ASCII 占有マップ --- */
const g = a.grid;
const COLS = 96, ROWS = Math.round(COLS * (room.z1 - room.z0) / (room.x1 - room.x0));
const cwx = (room.x1 - room.x0) / COLS, cwz = (room.z1 - room.z0) / ROWS;
// world cell → model cell: model x = (world z)/k + mcx ... 逆変換
const k = T.k;
const mcx = (g.floorLo[0] + g.floorHi[0]) / 2;
const mcz = (g.floorLo[1] + g.floorHi[1]) / 2;
const modelCell = (wx, wz) => {
  // world → model（rotY=-90° の逆）: model_x = wz/k + mcx ; model_z = -wx/k + mcz
  const mx = wz / k + mcx;
  const mz = -wx / k + mcz;
  const gx = Math.floor((mx - g.floorLo[0]) / g.cell);
  const gz = Math.floor((mz - g.floorLo[1]) / g.cell);
  if (gx < 0 || gz < 0 || gx >= g.W || gz >= g.H) return -1;
  return gz * g.W + gx;
};
console.log(`\n=== 上から（世界座標, # = 腰〜胸に実体, . = 床, 1マス=${cwx.toFixed(2)}x${cwz.toFixed(2)}m） ===`);
for (let r = 0; r < ROWS; r++) {
  const wz = room.z0 + (r + 0.5) * cwz;
  let line = '';
  for (let c = 0; c < COLS; c++) {
    const wx = room.x0 + (c + 0.5) * cwx;
    let ob = 0, fl = 0, tot = 0;
    for (let dz = 0; dz < 2; dz++)
      for (let dx = 0; dx < 2; dx++) {
        const gi = modelCell(wx + (dx - 0.5) * cwx * 0.5, wz + (dz - 0.5) * cwz * 0.5);
        if (gi < 0) continue;
        tot++;
        ob += g.obstacle[gi];
        fl += g.floorM[gi];
      }
    if (!tot) line += ' ';
    else if (ob / tot > 0.3) line += '#';
    else if (fl / tot > 0.3) line += '.';
    else line += ':';
  }
  console.log('|' + line + '|');
}

/* --- 連結成分の箱（世界メートル） --- */
const boxes = a.rawBoxes.map((b) => ({ ...T.rect(b.mx0, b.mz0, b.mx1, b.mz1), cells: b.cells }))
  .sort((x, y) => y.cells - x.cells);
console.log(`\n=== 実体の塊 ${boxes.length} 個（cells 順） ===`);
for (const b of boxes.slice(0, 40)) {
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const kind = w < 1.1 && d < 1.1 ? 'desk?' : w > 2.5 || d > 2.5 ? 'wall/shelf?' : 'mid';
  console.log(`  ${String(b.cells).padStart(5)} cells  ${w.toFixed(2)} x ${d.toFixed(2)} m  x[${b.x0.toFixed(2)},${b.x1.toFixed(2)}] z[${b.z0.toFixed(2)},${b.z1.toFixed(2)}]  ${kind}`);
}

/* --- クラスタ（世界メートル） --- */
console.log('\n=== マテリアルクラスタ（tris 順, 世界m） ===');
const cl = Object.entries(a.clusters).sort((x, y) => y[1].tris - x[1].tris);
for (const [name, e] of cl.slice(0, 24)) {
  const r = T.rect(e.mx0, e.mz0, e.mx1, e.mz1);
  console.log(`  ${String(e.tris).padStart(7)}  ${name.padEnd(20)} y[${T.y(e.my0).toFixed(2)},${T.y(e.my1).toFixed(2)}] x[${r.x0.toFixed(2)},${r.x1.toFixed(2)}] z[${r.z0.toFixed(2)},${r.z1.toFixed(2)}]`);
}
