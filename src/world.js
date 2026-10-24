// world.js — the BSOD glitch world: five seamlessly connected areas
// (arrival wasteland / collapsed grand architecture / corrupted city /
// deep layer / central spire). Static boxes are merged per-material;
// collision is analytic (grounds/ramps/AABB walls) registered alongside.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { makeErrorTextTexture } from './textures.js';

export const WO = new THREE.Vector3(0, 0, -800); // world offset (room lives at origin)
export const WORLD_SPAWN = new THREE.Vector3(0, .42, 2).add(WO);
export const SPIRE_POS = new THREE.Vector3(0, 2, -386).add(WO);
export const WAKE_POS = new THREE.Vector3(0, 1.6, -374).add(WO);

const FRAGMENT_TEXTS = [
  '断片 0x01 — 「起きたら、まず時計を見ろ。針が進んでいたら、まだ夢の中だ」',
  '断片 0x02 — 「この世界のどこかに、壊れていない言葉がひとつだけ残っている」',
  '断片 0x03 — 「コンソールはまだ生きている。キーは… [C] …ノイズに埋もれて読めない」',
  '断片 0x04 — 「青い画面は出口じゃない。あれは“口”だ」',
  '断片 0x05 — 「MEM://CONSOLE への接続を確認。コマンドは大文字小文字を区別しない」',
  '断片 0x06 — 「壊れた文字の中で、ひとつだけ安定して読める言葉を探せ」',
  '断片 0x07 — 「ありがとう。もう帰っていい。…本当に帰れるかは、別の話だけど」',
];

export function buildWorld(M, col, lanternTemplate = null) {
  const g = new THREE.Group(); g.name = 'bsod-world'; g.position.copy(WO);
  const batches = new Map(); // material -> geometries[]
  const dummy = new THREE.Object3D();
  function batchBox(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    geo.applyMatrix4(dummy.matrix);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(geo);
  }
  function mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  }
  const G = (x0, x1, z0, z1, y, tag = '') => col.addGround({ x0: x0 + WO.x, x1: x1 + WO.x, z0: z0 + WO.z, z1: z1 + WO.z, y, tag });
  const WL = (x0, x1, z0, z1, y0 = -2, y1 = 60) => col.addWall({ x0: x0 + WO.x, x1: x1 + WO.x, z0: z0 + WO.z, z1: z1 + WO.z, y0, y1 });
  /** solid axis-aligned box + collision (wall always; ground on top when top=true) */
  function solid(mat, w, h, d, x, y, z, { top = true, wall = true } = {}) {
    batchBox(mat, w, h, d, x, y, z);
    if (wall) WL(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h / 2, y + h / 2);
    if (top) G(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + h / 2);
  }
  function groundPlane(mat, w, d, x, z, y = 0) {
    const m = mesh(new THREE.PlaneGeometry(w, d), mat, x, y, z, -Math.PI / 2, 0, 0, false);
    m.receiveShadow = true; G(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y); return m;
  }
  function panel(mat, w, h, x, y, z, ry = 0, rx = 0) {
    const m = mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z, rx, ry, 0, false); return m;
  }
  function stairsUp(x, zStart, dirZ, width, steps, stepH, stepD, mat, baseY = 0) {
    for (let i = 0; i < steps; i++) {
      const topY = baseY + (i + 1) * stepH, z = zStart + dirZ * (i + .5) * stepD;
      batchBox(mat, width, topY - baseY + .4, stepD, x, (topY + baseY - .4) / 2, z);
    }
    const zEnd = zStart + dirZ * steps * stepD;
    col.addGround({ x0: x - width / 2 + WO.x, x1: x + width / 2 + WO.x, z0: Math.min(zStart, zEnd) + WO.z, z1: Math.max(zStart, zEnd) + WO.z,
      ramp: { axis: 'z', a0: zStart + WO.z, a1: zEnd + WO.z, y0: baseY, y1: baseY + steps * stepH }, tag: 'stairs' });
    WL(x - width / 2 - .18, x - width / 2, Math.min(zStart, zEnd), Math.max(zStart, zEnd), baseY, baseY + steps * stepH + 1);
    WL(x + width / 2, x + width / 2 + .18, Math.min(zStart, zEnd), Math.max(zStart, zEnd), baseY, baseY + steps * stepH + 1);
    return { topY: baseY + steps * stepH, zEnd };
  }
  function railing(x0, z0, x1, z1, y) { // along a straight edge at floor height y
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 1.7));
    for (let i = 0; i <= n; i++) batchBox(M.metalDark, .07, 1.05, .07, x0 + (x1 - x0) * i / n, y + .52, z0 + (z1 - z0) * i / n);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    batchBox(M.bsodBright, .09, .07, len, (x0 + x1) / 2, y + 1.06, (z0 + z1) / 2, 0, ang, 0);
    batchBox(M.metalDark, .05, .05, len, (x0 + x1) / 2, y + .55, (z0 + z1) / 2, 0, ang, 0);
    WL(Math.min(x0, x1) - .09, Math.max(x0, x1) + .09, Math.min(z0, z1) - .09, Math.max(z0, z1) + .09, y, y + 1.15);
  }
  const areaLights = [];
  function areaLight(color, intensity, dist, x, y, z) {
    const L = new THREE.PointLight(color, 0, dist, 1.8); L.position.set(x, y, z); g.add(L);
    areaLights.push({ L, base: intensity, pos: new THREE.Vector3(x, y, z).add(WO), dist }); return L;
  }
  const fragments = [];
  function fragment(x, y, z, idx) {
    const m = mesh(new THREE.OctahedronGeometry(.21), M.whiteGlow, x, y, z, 0, 0, 0, false);
    const halo = mesh(new THREE.OctahedronGeometry(.34), new THREE.MeshBasicMaterial({ color: 0x6fb4ff, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false }), x, y, z, 0, 0, 0, false);
    fragments.push({ mesh: m, halo, pos: new THREE.Vector3(x, y, z).add(WO), baseY: y, idx, taken: false, text: FRAGMENT_TEXTS[idx] });
  }
  const blinkers = [];
  const hintPanels = [];

  /* ================= AREA 1 — arrival wasteland ================= */
  groundPlane(M.wasteGround, 92, 132, 0, -62, 0);
  solid(M.checkerFloor, 12, .4, 12, 0, .2, 0); // spawn platform (top y=.4)
  batchBox(M.bsodBright, 12, .07, .18, 0, .42, -5.9); batchBox(M.bsodBright, .18, .07, 12, -5.9, .42, 0); batchBox(M.bsodBright, .18, .07, 12, 5.9, .42, 0);
  // spawn arch: the "mouth" you fell out of
  solid(M.concreteBlue, .8, 5.4, .8, -3.4, 2.7, 4.6, { top: false }); solid(M.concreteBlue, .8, 5.4, .8, 3.4, 2.7, 4.6, { top: false });
  batchBox(M.concreteBlue, 7.6, .8, .8, 0, 5.6, 4.6);
  panel(M.faceMat, 3.4, 3.4, 0, 3.4, 4.15, Math.PI); // faint :( watching the spawn
  // scattered ruins
  const ruinPos = [[-14, -24, 3.4], [11, -30, 5], [-22, -44, 2.2], [18, -52, 6.4], [-8, -58, 1.6], [26, -70, 3.8], [-30, -66, 5.2], [7, -78, 2.6], [-16, -88, 4.4], [22, -96, 2], [-4, -104, 5.6], [14, -112, 3], [-26, -116, 2.4], [33, -34, 4]];
  ruinPos.forEach(([x, z, h], i) => {
    if (i % 3 === 2) { batchBox(M.concreteBlue, 1.1, h, 1.1, x, h / 2 - .4, z, .12, i, .07); WL(x - .7, x + .7, z - .7, z + .7, 0, h); }
    else solid(M.concreteBlue, 1.2, h, 1.2, x, h / 2 - .2, z, { top: false });
    batchBox(M.bsodPanel, 1.24, .16, 1.24, x, h - .2, z);
  });
  // standing error slabs
  [[-9, -36, .3], [15, -62, -.5], [-19, -76, .9], [6, -92, -.2], [-12, -110, .4], [24, -84, -1.1]].forEach(([x, z, ry], i) => {
    const p = panel(i % 2 ? M.errorPanelA : M.errorPanelB, 2.6, 3.6, x, 1.9, z, ry);
    p.material = p.material; batchBox(M.shardDark, 2.7, 3.8, .14, x - Math.sin(ry) * .09, 1.9, z - Math.cos(ry) * .09, 0, ry, 0);
    WL(x - 1.1, x + 1.1, z - 1.1, z + 1.1, 0, 3.7); hintPanels.push(p);
  });
  // large glowing waypoint panels guiding toward the architecture entrance
  [[-4, -48, .15], [2, -84, -.2], [-2, -114, .1]].forEach(([x, z, ry], i) => {
    panel(i % 2 ? M.errorPanelB : M.errorPanelA, 6.4, 3.8, x, 2.2, z, ry);
    batchBox(M.shardDark, 6.6, 4.4, .2, x - Math.sin(ry) * .14, 2.2, z - Math.cos(ry) * .14, 0, ry, 0);
    batchBox(M.bsodBright, 6.6, .14, .24, x, 4.35, z, 0, ry, 0);
    WL(x - 2.6, x + 2.6, z - .6, z + .6, 0, 4.2); });
  // rubble shards (static)
  for (let i = 0; i < 60; i++) { const x = (Math.random() - .5) * 84, z = -8 - Math.random() * 116, s = .3 + Math.random() * 1.5;
    batchBox(i % 4 ? M.shardDark : M.shard, s, s * .4, s * .7, x, s * .16, z, Math.random() * .6, Math.random() * 3, Math.random() * .6); }
  // west side ruin (fragment 0 + framed view of the spire)
  G(-41, -25, -96, -77, .02);
  solid(M.brickBlue, 16, 3.6, .5, -33, 1.8, -96, { top: false });
  solid(M.brickBlue, .5, 3.6, 19, -41, 1.8, -86.5, { top: false });
  solid(M.brickBlue, 6.5, 3.6, .5, -37.7, 1.8, -77, { top: false }); solid(M.brickBlue, 5.5, 2.1, .5, -27.8, 1.05, -77, { top: false });
  batchBox(M.brickBlue, 16, .4, 4, -33, 3.8, -94); // partial roof slab
  panel(M.errorPanelB, 5, 2.6, -33, 1.9, -95.7, 0);
  fragment(-38.5, 1.1, -92, 0);
  areaLight(0x4d94ff, 14, 26, -33, 3, -86);
  // wasteland boundary walls (with north opening toward architecture)
  WL(-46.4, -46, -128, 4); WL(46, 46.4, -128, 4); WL(-46, 46, 4, 4.4);
  WL(-46, -10, -128.4, -128); WL(6, 46, -128.4, -128);
  batchBox(M.bsodPanel, 92, .5, .3, 0, .25, 4); batchBox(M.bsodPanel, .3, .5, 132, -46, .25, -62); batchBox(M.bsodPanel, .3, .5, 132, 46, .25, -62);

  /* ================= AREA 2 — collapsed grand architecture ================= */
  groundPlane(M.checkerFloor, 40, 58, -4, -157, .01);
  const A2 = { x0: -24, x1: 16, z0: -186, z1: -128, wallH: 9.5 };
  // perimeter (south entrance gap x[-6,2], north exit gap x[-14,-6])
  solid(M.concreteBlue, 18, A2.wallH, .6, -15, A2.wallH / 2, -128, { top: false });
  solid(M.concreteBlue, 14, A2.wallH, .6, 9, A2.wallH / 2, -128, { top: false });
  solid(M.concreteBlue, 10, A2.wallH, .6, -19, A2.wallH / 2, -186, { top: false });
  solid(M.concreteBlue, 22, A2.wallH, .6, 5, A2.wallH / 2, -186, { top: false });
  solid(M.concreteBlue, .6, A2.wallH, 58, -24, A2.wallH / 2, -157, { top: false });
  solid(M.concreteBlue, .6, A2.wallH, 58, 16, A2.wallH / 2, -157, { top: false });
  // entrance & exit lintels with face glyphs
  batchBox(M.bsodPanel, 8.4, 2.2, .7, -2, 6.4, -128); panel(M.faceMat, 3, 3, -2, 4.2, -127.6, 0);
  batchBox(M.bsodPanel, 8.4, 2.2, .7, -10, 6.4, -186); panel(M.faceMat, 3, 3, -10, 4.2, -186.4, Math.PI);
  // columns
  [-16, 8].forEach(cx => [-140, -157, -174].forEach(cz => {
    solid(M.concreteBlue, 1.3, A2.wallH, 1.3, cx, A2.wallH / 2, cz, { top: false });
    batchBox(M.bsodBright, 1.36, .14, 1.36, cx, 4.4, cz); batchBox(M.bsodBright, 1.36, .14, 1.36, cx, 8.6, cz);
  }));
  // fallen column drums
  [[-6, -148], [0, -166], [-11, -172]].forEach(([x, z]) => { const c = mesh(new THREE.CylinderGeometry(.62, .62, 3.2, 12), M.concreteBlue, x, .62, z, Math.PI / 2, 0, Math.random()); WL(x - 1.5, x + 1.5, z - .8, z + .8, 0, 1.2); });
  // upper walkways: east (x 9.5..15.7) + north (z -185.7..-179.5) + west stub
  const WY = 4.4;
  solid(M.concreteBlue, 6.2, .35, 57, 12.6, WY - .175, -157.2);
  solid(M.concreteBlue, 39, .35, 6.2, -4.2, WY - .175, -182.6);
  solid(M.concreteBlue, 6.2, .35, 36, -20.9, WY - .175, -167.5);
  railing(9.6, -128.6, 9.6, -179.4, WY); railing(-17.9, -179.4, 9.6, -179.4, WY);
  railing(-17.9, -179.4, -17.9, -149.8, WY); railing(-23.8, -149.6, -17.9, -149.6, WY);
  railing(9.6, -128.6, 15.6, -128.6, WY);
  // stairs: east ground -> east walkway (ascend northward from z=-133)
  stairsUp(12.6, -133, -1, 4.6, 16, .275, .6, M.concreteBlue, 0);
  // stairs: west walkway -> ground (descend southward from z=-149.6 landing to z=-140)
  stairsUp(-20.9, -140, -1, 4.6, 16, .275, .6, M.concreteBlue, 0);
  // broken beams across the void (visual, high)
  batchBox(M.concreteBlue, 34, .7, 1, -4, 8.8, -148, 0, .06, .05);
  batchBox(M.concreteBlue, 30, .7, 1, -6, 9, -168, .1, -.12, -.2);
  batchBox(M.shardDark, 12, .5, .8, -2, 7.2, -158, .3, .7, .15);
  // giant face on north wall inside
  panel(M.faceMat, 17, 17, -4, 6.4, -185.6, 0);
  panel(M.errorPanelA, 9, 4.6, -23.6, 2.6, -160, Math.PI / 2);
  panel(M.errorPanelB, 9, 4.6, 15.6, 2.6, -152, -Math.PI / 2);
  // secret room on the north walkway (fragment 1 + console hint)
  solid(M.concreteBlue, .4, 3.2, 6, 8, WY + 1.6, -182.6, { top: false });
  solid(M.concreteBlue, 3.4, 3.2, .4, 13.9, WY + 1.6, -179.7, { top: false });
  solid(M.concreteBlue, 2.2, 3.2, .4, 9.1, WY + 1.6, -179.7, { top: false }); // door gap x[10.2,12.2]
  batchBox(M.concreteBlue, 7.6, .3, 6.2, 11.9, WY + 3.3, -182.6);
  fragment(13.8, WY + 1.05, -184.3, 1);
  const hintTex1 = makeErrorTextTexture({ lines: ['MEM://SHELL ... 接続待機中', 'input device: KEYBOARD [OK]', '>> press  [ C ]  to ␣␣␣␣␣␣', '�が応答しません 0xFACE', '…キーは、まだ生きている'] });
  const hint1 = new THREE.MeshStandardMaterial({ map: hintTex1, emissive: 0xffffff, emissiveMap: hintTex1, emissiveIntensity: .9, color: 0x223044 });
  panel(hint1, 3.4, 1.8, 8.25, WY + 1.6, -182.6, Math.PI / 2);
  areaLight(0x5ea0ff, 26, 44, -4, 7.5, -157); areaLight(0x4d94ff, 12, 24, 12, WY + 2.2, -182);

  /* ================= AREA 3 — corrupted city ================= */
  groundPlane(M.concreteBlue, 64, 78, -4, -224, .005);
  batchBox(M.bsodBright, .25, .03, 74, -10, .03, -224); batchBox(M.bsodBright, .25, .03, 74, 2, .03, -224); // street light strips (x centred -4)
  // buildings (facades) — street runs x[-10,2]
  const cityBuildings = [
    [-19, -196, 12, 20, 18], [-18, -216, 10, 15, 15], [-19, -236, 12, 24, 20], [-18, -254, 11, 17, 13],
    [11, -198, 10, 17, 15], [12, -238, 12, 26, 19], [11, -256, 10, 14, 12],
  ];
  cityBuildings.forEach(([x, z, w, h, d], i) => solid(i % 2 ? M.facadeA : M.facadeB, w, h, d, x, h / 2 - .3, z, { top: false }));
  // brick low-rises behind facades for skyline depth
  [[-30, -210, 34], [24, -224, 40], [-28, -246, 28], [26, -200, 22]].forEach(([x, z, h]) => solid(M.brickBlue, 14, h, 14, x, h / 2 - .3, z, { top: false }));
  // street boundary (west segments leave the alley mouth z[-247,-239.5] open)
  WL(-11.4, -11, -262, -247, 0, 30); WL(-11.4, -11, -239.5, -186, 0, 30);
  WL(3, 3.4, -262, -223.5, 0, 30); WL(3, 3.4, -217.6, -186, 0, 30); // east wall w/ shop door gap
  WL(-36, -8, -262.4, -262, 0, 30); WL(2, 28, -262.4, -262, 0, 30);  // north edge w/ deep-corridor mouth x[-8,2]
  // enterable ruined shop (east, x 3..13, z -230..-212)
  G(3, 13.4, -230, -212, .02);
  solid(M.brickBlue, .5, 4.6, 18, 13.2, 2.3, -221, { top: false });
  solid(M.brickBlue, 10.5, 4.6, .5, 8.2, 2.3, -230, { top: false }); solid(M.brickBlue, 10.5, 4.6, .5, 8.2, 2.3, -212, { top: false });
  batchBox(M.brickBlue, 10.5, .35, 18.5, 8.2, 4.75, -221);
  solid(M.brickBlue, .5, 4.6, 6.5, 3, 2.3, -226.8, { top: false }); solid(M.brickBlue, .5, 4.6, 5.5, 3, 2.3, -214.8, { top: false }); // door gap z[-223.5,-217.6]
  batchBox(M.brickBlue, .5, 1.4, 6, 3, 3.9, -220.6);
  panel(M.errorPanelA, 5.4, 1.1, 2.7, 3.9, -220.6, -Math.PI / 2); // shop sign
  solid(M.metalDark, .5, 1.9, 4.6, 5.4, .95, -222, { top: false }); // shelves
  solid(M.metalDark, .5, 1.9, 4.6, 5.4, .95, -215.5, { top: false });
  solid(M.concreteBlue, 2.6, 1.05, .8, 10.6, .52, -218, { top: false }); // counter
  panel(M.errorPanelB, 4.4, 2.4, 12.9, 2.1, -221, -Math.PI / 2);
  fragment(11.6, 1.15, -227.5, 2);
  areaLight(0x6fb4ff, 9, 18, 8, 3.4, -221);
  // west alley with crate climb (fragment 3) — mouth already open in the west street wall above
  G(-19.5, -11, -247, -239.5, .02);
  solid(M.brickBlue, .5, 7, 8, -19.5, 3.5, -243.2, { top: false });
  solid(M.brickBlue, 8.5, 7, .5, -15.2, 3.5, -247, { top: false }); solid(M.brickBlue, 8.5, 7, .5, -15.2, 3.5, -239.5, { top: false });
  solid(M.shardDark, 1.1, .55, 1.1, -17.2, .27, -241.4); solid(M.shardDark, 1.1, 1.1, 1.1, -18.2, .55, -242.6); solid(M.shard, 1.2, 1.62, 1.2, -18.6, .81, -244.6);
  fragment(-18.6, 2.35, -244.6, 3);
  panel(M.errorPanelA, 3.6, 2, -19.2, 2.6, -243.2, Math.PI / 2);
  // hanging signs + monorail
  [[-4, -204, .2], [-4, -232, -.35], [-4, -250, .5]].forEach(([x, z, rz]) => {
    const s = panel(M.errorPanelB, 7, 1.6, x, 6.8, z, Math.PI / 2); s.rotation.x = rz;
    batchBox(M.metalDark, .08, 2.6, .08, x - 2.6, 8.6, z); batchBox(M.metalDark, .08, 2.6, .08, x + 2.6, 8.6, z);
  });
  batchBox(M.concreteBlue, 1.2, .8, 76, -4, 10.4, -224); batchBox(M.bsodPanel, 1.3, .18, 76, -4, 9.9, -224);
  [-196, -220, -244].forEach(z => solid(M.concreteBlue, 1, 10, 1, -4, 5, z, { top: false }));
  // rubble on street
  for (let i = 0; i < 34; i++) { const x = -10 + Math.random() * 12, z = -190 - Math.random() * 68, s = .3 + Math.random() * 1.2;
    batchBox(M.shardDark, s, s * .5, s * .8, x, s * .2, z, Math.random() * .5, Math.random() * 3, Math.random() * .5); }
  // CC0 Lantern street lights (re-materialised) or procedural fallback posts
  const lampPos = [[-9.4, -198], [1.4, -210], [-9.4, -224], [1.4, -238], [-9.4, -252], [1.4, -258]];
  const lanterns = [];
  lampPos.forEach(([x, z], i) => {
    if (lanternTemplate) {
      const L = lanternTemplate.clone(true); L.position.set(x, 0, z); L.rotation.y = i * 1.3; 
      L.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true;
        o.material = o.material.clone();
        if (o.material.emissiveMap) { o.material.emissive = new THREE.Color(0x9fd0ff); o.material.emissiveIntensity = 1.9; }
        if (o.material.color) o.material.color.multiply(new THREE.Color(0x8fb0d8)); } });
      g.add(L); lanterns.push(L);
    } else {
      batchBox(M.metalDark, .14, 3.6, .14, x, 1.8, z);
      const lamp = mesh(new THREE.BoxGeometry(.4, .5, .4), M.bsodBright, x, 3.75, z, 0, i, 0, false); blinkers.push(lamp);
      batchBox(M.metalDark, .6, .08, .6, x, 4.05, z);
    }
    WL(x - .3, x + .3, z - .3, z + .3, 0, 3.4);
  });
  areaLight(0x5ea0ff, 16, 34, -4, 4.4, -210); areaLight(0x5ea0ff, 16, 34, -4, 4.4, -244);
  panel(M.faceMat, 9, 9, -25.4, 12, -236, Math.PI / 2); // watching face on a tower

  /* ================= AREA 4 — deep layer ================= */
  const deepFloor = groundPlane(M.circuit, 34, 62, -3, -292, .01);
  // corridor shell x[-8,2] (aligned with street centre -3), z[-322,-262]
  // west wall: two segments leaving a broken gap z[-315,-311] into the alcove (step-over rubble)
  solid(M.blockNoise, .6, 6, 7, -8.3, 3, -318.5, { top: false });
  solid(M.blockNoise, .6, 6, 49, -8.3, 3, -286.5, { top: false });
  batchBox(M.blockNoise, .6, 2.6, 4, -8.3, 4.7, -313); // lintel over the broken gap (visual)
  solid(M.shardDark, .6, .5, 4, -8.3, .25, -313);      // broken stub (steppable: top y=.5)
  // east wall: segments leave the server-chamber doorway z[-296,-288] open
  solid(M.blockNoise, .6, 6, 26, 2.3, 3, -275, { top: false });
  solid(M.blockNoise, .6, 6, 26, 2.3, 3, -309, { top: false });
  batchBox(M.blockNoise, .6, 2.4, 8, 2.3, 4.8, -292); // lintel over the doorway (visual)
  // server chamber east x[2,14] z[-304,-288]
  G(2, 14, -304, -288, .02);
  solid(M.blockNoise, .6, 6, 17, 14, 3, -296, { top: false });
  solid(M.blockNoise, 12, 6, .6, 8, 3, -304, { top: false }); solid(M.blockNoise, 12, 6, .6, 8, 3, -288, { top: false });
  batchBox(M.blockNoise, 12.6, .4, 17, 8, 6.2, -296);
  // corridor ceiling
  batchBox(M.blockNoise, 11.2, .4, 62, -3, 6.2, -292);
  // server racks
  const rackPos = [];
  for (let z = -270; z >= -316; z -= 5.5) { rackPos.push([-6.9, z, 0]); if (z % 11 === 0) rackPos.push([1.1, z - 2, 1]); }
  rackPos.push([11.5, -292, 1], [11.5, -300, 1], [5, -302.5, 0], [8.5, -302.5, 0]);
  rackPos.forEach(([x, z]) => { solid(M.circuit, .8, 2.3, 1.7, x, 1.15, z, { top: false });
    const b = mesh(new THREE.BoxGeometry(.1, .06, .1), M.bsodBright.clone(), x + .45, 1.9, z + .4, 0, 0, 0, false); blinkers.push(b); });
  // cables overhead (tubes)
  [[-266, -318, -5.5, 5.4], [-268, -316, -.5, 5.7], [-264, -320, -3, 5.1]].forEach(([z0, z1, x, y]) => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y, z0), new THREE.Vector3(x + 1.2, y - .7, (z0 + z1) / 2), new THREE.Vector3(x - .6, y - .2, z1)]);
    mesh(new THREE.TubeGeometry(curve, 32, .09, 7), M.cableMat, 0, 0, 0, 0, 0, 0, false);
  });
  const floorCable = new THREE.CatmullRomCurve3([new THREE.Vector3(-4, .06, -264), new THREE.Vector3(-1, .05, -288), new THREE.Vector3(-5, .06, -312), new THREE.Vector3(-3, .05, -321)]);
  mesh(new THREE.TubeGeometry(floorCable, 40, .05, 6), M.cableMat, 0, 0, 0, 0, 0, 0, false);
  fragment(12.2, 1.1, -296, 4);
  const hintTex2 = makeErrorTextTexture({ lines: ['MEM://CONSOLE v0.9.∞', 'guest@bsod:~> help', 'コマンド一覧は 壊れて い�す', '唯一 壊れていない 言葉を 入力せよ', '>> [ C ] ... コンソールを開�'] });
  const hint2 = new THREE.MeshStandardMaterial({ map: hintTex2, emissive: 0xffffff, emissiveMap: hintTex2, emissiveIntensity: .95, color: 0x223044 });
  panel(hint2, 4.6, 2.4, 13.6, 2.2, -296, -Math.PI / 2);
  // west alcove (fragment 5)
  G(-14, -8, -318, -308, .02);
  solid(M.blockNoise, .6, 6, 11, -14, 3, -313, { top: false });
  solid(M.blockNoise, 6, 6, .6, -11, 3, -318, { top: false }); solid(M.blockNoise, 6, 6, .6, -11, 3, -308, { top: false });
  solid(M.shard, 1.4, .5, 3.4, -8.6, .25, -313); // step-over rubble (ground top .5) bridging corridor <-> alcove
  G(-9.4, -7.8, -314.8, -311.2, .5);
  fragment(-12.8, 1.1, -313, 5);
  panel(M.errorPanelA, 4, 2.2, -13.6, 2.2, -313, Math.PI / 2);
  areaLight(0x3d7fe0, 8, 22, -3, 4.6, -282); areaLight(0x3d7fe0, 8, 22, -3, 4.6, -306); areaLight(0x5ea0ff, 10, 20, 8, 4, -296);
  // deep north exit frame
  batchBox(M.bsodPanel, 11, 1.2, .6, -3, 5.9, -322); solid(M.blockNoise, .6, 6, .6, -8.3, 3, -322, { top: false }); solid(M.blockNoise, .6, 6, .6, 2.3, 3, -322, { top: false });
  WL(-8.6, -7.2, -322.4, -322, 0, 6); WL(1.2, 2.6, -322.4, -322, 0, 6);

  /* ================= AREA 5 — central plaza & spire ================= */
  groundPlane(M.checkerFloor, 78, 78, 0, -360, .008);
  WL(-39.4, -39, -399, -322); WL(39, 39.4, -399, -322); WL(-39, 39, -399.4, -399);
  WL(-39, -8.6, -322.4, -322, 0, 8); WL(2.6, 39, -322.4, -322, 0, 8);
  // plaza pylons + light strips guiding to the spire
  for (let i = 0; i < 5; i++) { const z = -330 - i * 10;
    solid(M.concreteBlue, .7, 3.4 + i * .5, .7, -7.5, (3.4 + i * .5) / 2, z, { top: false });
    solid(M.concreteBlue, .7, 3.4 + i * .5, .7, 7.5, (3.4 + i * .5) / 2, z, { top: false });
    batchBox(M.bsodBright, .74, .14, .74, -7.5, 3.4 + i * .5, z); batchBox(M.bsodBright, .74, .14, .74, 7.5, 3.4 + i * .5, z); }
  batchBox(M.bsodBright, .3, .03, 52, 0, .03, -350);
  // side ruins on plaza
  [[-24, -342, 6], [26, -356, 8], [-28, -378, 5], [24, -390, 7]].forEach(([x, z, h]) => { solid(M.concreteBlue, 2, h, 2, x, h / 2 - .3, z, { top: false }); batchBox(M.wire ? M.concreteBlue : M.concreteBlue, 2.05, .3, 2.05, x, h - .3, z); });
  panel(M.errorPanelA, 8, 4.2, -24, 2.4, -340.9, 0); panel(M.errorPanelB, 8, 4.2, 26, 2.4, -357.9, 0);
  // spire platform (two steps)
  solid(M.checkerFloor, 20, .4, 20, 0, .2, -384);
  solid(M.checkerFloor, 15, .8, 15, 0, .4, -385.5);
  // the spire
  const spire = mesh(new THREE.CylinderGeometry(2.1, 4.8, 92, 4, 1), M.concreteBlue, 0, 46.8, -386, 0, Math.PI / 4, 0);
  WL(-3.6, 3.6, -389.6, -382.4, 0, 92);
  const spireTip = mesh(new THREE.OctahedronGeometry(2.6), M.bsodBright, 0, 95.5, -386, 0, 0, 0, false);
  // emissive seams up the spire
  [[-3.1, -389.1], [3.1, -389.1], [-3.1, -382.9], [3.1, -382.9]].forEach(([x, z]) => batchBox(M.bsodBright, .16, 80, .16, x, 42, z));
  panel(M.faceMat, 26, 26, 0, 58, -380.8, 0);
  panel(M.faceMat, 68, 68, 0, 100, -386, 0); // the sky-face: a landmark visible across the whole world
  // WAKE_UP wall at the spire's base (the secret)
  const wake = panel(M.wakeWall, 12.6, 6.3, 0, 3.9, -379.6, 0);
  batchBox(M.shardDark, 13, 6.7, .3, 0, 3.9, -379.85);
  WL(-6.5, 6.5, -380.1, -379.7, 0, 7.2);
  batchBox(M.bsodBright, 13, .16, .34, 0, 7.3, -379.85); batchBox(M.bsodBright, 13, .16, .34, 0, .5, -379.85);
  fragment(5.8, 1.9, -391.5, 6);
  // rings + beam
  const rings = [];
  [[11, 26, .4], [15, 41, -.3], [19, 57, .2]].forEach(([r, y, tilt]) => {
    const ring = mesh(new THREE.TorusGeometry(r, .17, 8, 72), M.bsodBright, 0, y, -386, Math.PI / 2 + tilt, 0, 0, false);
    rings.push(ring);
  });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x3d9bff, transparent: true, opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = mesh(new THREE.CylinderGeometry(1.7, 2.6, 240, 18, 1, true), beamMat, 0, 120, -386, 0, 0, 0, false);
  const beam2 = mesh(new THREE.CylinderGeometry(.7, 1.1, 240, 12, 1, true), beamMat.clone(), 0, 120, -386, 0, 0, 0, false); beam2.material.opacity = .22;
  const spireLight = new THREE.PointLight(0x6fb4ff, 60, 110, 1.7); spireLight.position.set(0, 7, -378); g.add(spireLight);
  areaLight(0x4d94ff, 18, 40, 0, 5, -348);

  /* ================= far scenery (real 3D, fog does the rest) ================= */
  const farRing = [[-120, -60, 70], [130, -90, 95], [-150, -190, 60], [150, -210, 80], [-110, -300, 88], [120, -330, 64], [-70, -440, 100], [80, -450, 74], [0, -480, 120], [-190, -120, 52], [195, -160, 58], [-60, 60, 66], [90, 40, 48]];
  farRing.forEach(([x, z, h], i) => { batchBox(i % 2 ? M.facadeA : M.monolithFar, 12 + (i % 4) * 5, h, 12 + (i % 3) * 6, x, h / 2 - 4, z, 0, i * .7, (i % 5 - 2) * .04); });
  // floating islands far above (visual only)
  for (let i = 0; i < 16; i++) { const x = (Math.random() - .5) * 320, z = 30 - Math.random() * 470, y = 26 + Math.random() * 60, s = 4 + Math.random() * 12;
    batchBox(M.monolithFar, s, s * .32, s * .7, x, y, z, Math.random() * .4, Math.random() * 3, Math.random() * .3); }

  /* ================= floating shards (instanced, animated) ================= */
  const SHARDS = 240;
  const shardMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), M.shard, SHARDS);
  shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shardMesh.frustumCulled = false;
  const shardData = [];
  for (let i = 0; i < SHARDS; i++) {
    const zone = Math.random();
    let x, y, z;
    if (zone < .45) { x = (Math.random() - .5) * 88; z = -6 - Math.random() * 118; y = 1.5 + Math.random() * 9; }
    else if (zone < .62) { x = -22 + Math.random() * 36; z = -130 - Math.random() * 52; y = 2 + Math.random() * 6.5; }
    else if (zone < .8) { x = -12 + Math.random() * 16; z = -190 - Math.random() * 68; y = 2 + Math.random() * 10; }
    else { x = (Math.random() - .5) * 70; z = -326 - Math.random() * 66; y = 2 + Math.random() * 16; }
    shardData.push({ x, y, z, s: .14 + Math.random() * .85, ph: Math.random() * 9, sp: .25 + Math.random() * .8, rot: Math.random() * 9 });
  }
  g.add(shardMesh);
  // orbiting shards around the spire
  const ORBIT = 64;
  const orbitMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), M.bsodBright, ORBIT);
  orbitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); orbitMesh.frustumCulled = false; g.add(orbitMesh);
  const orbitData = Array.from({ length: ORBIT }, (_, i) => ({ a: i / ORBIT * Math.PI * 2, r: 8.5 + Math.random() * 7, y: 3 + Math.random() * 46, s: .18 + Math.random() * .5, sp: .12 + Math.random() * .3 }));

  /* ================= dust / data motes ================= */
  const MOTES = 900;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3); const moteBase = [];
  for (let i = 0; i < MOTES; i++) { const x = (Math.random() - .5) * 120, y = Math.random() * 26, z = 10 - Math.random() * 420;
    moteBase.push([x, y, z, Math.random() * 9]); motePos.set([x, y, z], i * 3); }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0x9fd0ff, size: .14, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  motes.frustumCulled = false; g.add(motes);

  /* ================= sky dome ================= */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(880, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime;
      void main(){ float h = normalize(vP).y * .5 + .5;
        vec3 deep = vec3(.004,.02,.07); vec3 mid = vec3(.02,.10,.34); vec3 hor = vec3(.10,.32,.75);
        vec3 c = mix(hor, mid, smoothstep(.42,.62,h)); c = mix(c, deep, smoothstep(.6,.95,h));
        c += vec3(.10,.25,.55) * pow(1.0 - abs(normalize(vP).y), 6.0) * .8;
        float grid = step(.997, fract(atan(vP.z, vP.x) * 28.0)) * .05 + step(.996, fract(h * 90.0)) * .04;
        c += vec3(.4,.65,1.0) * grid;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.position.set(0, 0, -200); g.add(sky);

  /* ================= merge batches ================= */
  for (const [mat, geos] of batches) {
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    const m = new THREE.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
    geos.forEach(x => x.dispose());
  }
  batches.clear();

  /* ================= runtime ================= */
  let noiseTimer = 0;
  const refs = {
    group: g, fragments, spireTip, rings, beam, beam2, lanterns, hintPanels,
    spireLightPos: SPIRE_POS.clone(),
    areaAt(p) { const z = p.z - WO.z;
      if (z > -128) return 'waste'; if (z > -186) return 'arch'; if (z > -262) return 'city';
      if (z > -322) return 'deep'; return 'plaza'; },
    update(dt, t, playerPos, glitch01 = 0) {
      // floating shards
      for (let i = 0; i < SHARDS; i++) { const s = shardData[i];
        dummy.position.set(s.x, s.y + Math.sin(t * s.sp + s.ph) * .55, s.z);
        dummy.rotation.set(s.rot + t * .22 * s.sp, s.rot * 2 + t * .3 * s.sp, 0);
        const sc = s.s * (1 + glitch01 * .35 * Math.sin(t * 13 + s.ph * 7));
        dummy.scale.set(sc, sc * (1.6 + glitch01 * Math.sin(t * 9 + s.ph) * .5), sc);
        dummy.updateMatrix(); shardMesh.setMatrixAt(i, dummy.matrix); }
      shardMesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < ORBIT; i++) { const o = orbitData[i]; const a = o.a + t * o.sp;
        dummy.position.set(Math.cos(a) * o.r, o.y + Math.sin(t * .5 + i) * 1.2, -386 + Math.sin(a) * o.r);
        dummy.rotation.set(t * .6 + i, t * .4, 0); dummy.scale.setScalar(o.s); dummy.updateMatrix(); orbitMesh.setMatrixAt(i, dummy.matrix); }
      orbitMesh.instanceMatrix.needsUpdate = true;
      rings.forEach((r, i) => { r.rotation.z = t * (.05 + i * .03) * (i % 2 ? -1 : 1); r.position.y = [26, 41, 57][i] + Math.sin(t * .4 + i * 2) * .8; });
      spireTip.rotation.y = t * .4; spireTip.position.y = 95.5 + Math.sin(t * .7) * 1.1;
      beamMat.opacity = .11 + Math.sin(t * .8) * .03 + glitch01 * .12;
      fragments.forEach((f, i) => { if (f.taken) return;
        f.mesh.position.y = f.baseY + Math.sin(t * 1.6 + i * 1.7) * .12; f.halo.position.y = f.mesh.position.y;
        f.mesh.rotation.y = t * 1.4 + i; f.halo.rotation.y = -t * .9; f.halo.scale.setScalar(1 + Math.sin(t * 2.2 + i) * .15); });
      blinkers.forEach((b, i) => { const on = Math.sin(t * (1.1 + (i % 5) * .23) + i * 2.4) > -.2;
        if (b.material.emissiveIntensity !== undefined) b.material.emissiveIntensity = on ? 2.4 : .25; });
      noiseTimer -= dt;
      if (noiseTimer <= 0) { noiseTimer = .35 + Math.random() * .6; // block-noise data crawl (subtle, slow)
        if (M.blockNoise.map) { M.blockNoise.map.offset.set(Math.random() * .06, Math.random() * .06); } }
      // motes drift upward, wrap
      const arr = moteGeo.attributes.position.array;
      for (let i = 0; i < MOTES; i++) { const b = moteBase[i];
        arr[i * 3] = b[0] + Math.sin(t * .24 + b[3]) * 1.4;
        arr[i * 3 + 1] = ((b[1] + t * .55) % 26);
        arr[i * 3 + 2] = b[2] + Math.cos(t * .18 + b[3]) * 1.2; }
      moteGeo.attributes.position.needsUpdate = true;
      sky.material.uniforms.uTime.value = t;
      sky.position.x = playerPos.x - WO.x; sky.position.z = (playerPos.z - WO.z);
      // area lights: distance-culled intensity
      for (const a of areaLights) { const d = a.pos.distanceTo(playerPos);
        a.L.intensity = d < a.dist + 26 ? a.base * THREE.MathUtils.clamp(1 - (d - a.dist) / 26, 0, 1) : 0; }
      spireLight.intensity = 55 + Math.sin(t * 1.3) * 6;
    },
    reset() { fragments.forEach(f => { f.taken = false; f.mesh.visible = true; f.halo.visible = true; }); },
  };
  return refs;
}
