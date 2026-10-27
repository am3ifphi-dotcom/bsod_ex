/**
 * 歩ける範囲。classroom.glb の実寸（cm→m）から起こした当たり判定。
 *   { x, z, hx, hz } … 中心と半径（XZ 平面の矩形）
 * 端の机・椅子は 4列×5行にまとめて、机の間の通路だけを歩けるようにしてある。
 */
export const ROOM = { minX: -3.78, maxX: 3.78, minZ: -4.5, maxZ: 4.55 };

const DESK_X = [-2.66, -0.84, 1.1, 2.78];
const DESK_Z = [-3.55, -2.18, -0.81, 0.56, 1.93];

const desks = [];
for (const x of DESK_X) {
  for (const z of DESK_Z) {
    desks.push({ x, z, hx: 0.46, hz: 0.42, kind: 'desk' });
  }
}

export const COLLIDERS = [
  ...desks,
  // 教卓
  { x: 0.02, z: 3.43, hx: 0.92, hz: 0.56, kind: 'teacherDesk' },
  // 黒板前の教壇（低いので当たりは緩め）
  { x: 0.5, z: 4.62, hx: 3.0, hz: 0.34, kind: 'podium' },
  // 後ろのロッカー群
  { x: 0.53, z: -4.78, hx: 2.2, hz: 0.26, kind: 'locker' },
  { x: -2.23, z: -4.7, hx: 0.95, hz: 0.28, kind: 'shelf' },
  // 窓際の大きい書庫
  { x: 2.8, z: -4.74, hx: 0.63, hz: 0.28, kind: 'cabinet' },
  // 自販機（コードで足した小道具）
  { x: -3.5, z: 1.55, hx: 0.34, hz: 0.42, kind: 'vending' },
];

/** よく使う立ち位置（探索の開始地点） */
export const SPAWNS = {
  door: { x: -3.25, z: 3.15 },
  frontLeft: { x: -2.9, z: 2.72 },
  frontCenter: { x: 0.2, z: 2.7 },
  frontRight: { x: 2.6, z: 2.7 },
  aisleLeft: { x: -1.75, z: 1.4 },
  aisleMid: { x: 0.13, z: 0.5 },
  aisleMidBack: { x: 0.13, z: -2.6 },
  aisleRight: { x: 1.94, z: -0.4 },
  aisleRightBack: { x: 1.94, z: -3.6 },
  windowSide: { x: 3.55, z: -0.6 },
  windowBack: { x: 3.55, z: -3.4 },
  corridor: { x: -3.5, z: 0.2 },
};
