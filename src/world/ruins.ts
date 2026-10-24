/**
 * ②崩壊した大型建築エリア
 * Khronos Sponza(Crytek・非商用制限付きライセンス)を再マテリアル化した中央建築 +
 * 階段・上階通路・手すりを持つ立体的な崩壊ホール(衝突付き)
 */
import * as THREE from 'three';
import { textures } from './textures';
import { applyGlitch } from '../fx/glitch';
import { placeProp, rematerializeVoid, loadModel } from './assets';
import { VOID_Y, wastelandHeight, type VoidContext } from './voidWorld';
import { mulberry32, lerp, clamp } from '../core/utils';

const RZ = -220; // エリア中心 z

export function buildRuins(ctx: VoidContext): void {
  const { group, collision, tickables } = ctx;

  // ---------------- Sponza(中央) ----------------
  void loadModel('models/Sponza/Sponza.gltf').then((sponza) => {
    const box = new THREE.Box3().setFromObject(sponza);
    const size = box.getSize(new THREE.Vector3());
    const s = 34 / Math.max(size.x, size.z);
    sponza.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(sponza);
    const center = box2.getCenter(new THREE.Vector3());
    const groundY = wastelandHeight(0, RZ) + VOID_Y;
    sponza.position.set(0 - center.x, groundY - box2.min.y, RZ - center.z);
    rematerializeVoid(sponza, { tint: new THREE.Color(0x2b62d8), emissiveBoost: 1.4 });
    group.add(sponza);
  });

  // ---------------- 立体ホール(東側) ----------------
  const hall = new THREE.Group();
  const hallX = 34;
  const groundY = wastelandHeight(hallX, RZ) + VOID_Y;

  const slabMat = new THREE.MeshStandardMaterial({
    map: textures.brick.map,
    roughnessMap: textures.brick.roughnessMap ?? null,
    color: 0x2f56b8,
    roughness: 0.88,
    metalness: 0.18,
    envMapIntensity: 1.1,
  });
  if (slabMat.map) {
    slabMat.map = slabMat.map.clone();
    (slabMat.map as THREE.Texture).repeat.set(4, 4);
    slabMat.map.needsUpdate = true;
  }
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x0d1c42,
    emissive: 0x2f6bff,
    emissiveIntensity: 1.1,
    roughness: 0.4,
    metalness: 0.6,
  });
  applyGlitch(edgeMat, { amp: 0.02, emissiveFlicker: 0.3 });

  const FLOOR_H = 5.2;
  const floors: number[] = [0, FLOOR_H, FLOOR_H * 2];

  // 各階のスラブ(L字に一部欠損)
  for (let f = 0; f < floors.length; f++) {
    const y = floors[f];
    // 主スラブ(3F は階段用の穴を開ける)
    const addSlabPiece = (px: number, pz: number, pw: number, pd: number): void => {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.4, pd), slabMat);
      slab.position.set(px, groundY + y + 0.2, pz);
      slab.receiveShadow = true;
      slab.castShadow = true;
      hall.add(slab);
      collision.addBoxCentered(px, groundY + y + 0.2, pz, pw, 0.4, pd);
    };
    if (f < 2) {
      addSlabPiece(hallX, RZ, 30, 24);
    } else {
      // 穴: x [hallX-10, hallX-6], z [RZ-11, RZ-2]
      addSlabPiece(hallX - 12.5, RZ, 5, 24);
      addSlabPiece(hallX + 4.5, RZ, 21, 24);
      addSlabPiece(hallX - 8, RZ - 11.5, 4, 1);
      addSlabPiece(hallX - 8, RZ + 5, 4, 14);
      // 穴の縁の手すり(落下防止)
      addRailings(hall, collision, [
        [hallX - 10, groundY + y + 0.4, RZ - 6.5, 9, Math.PI / 2, 0],
        [hallX - 6, groundY + y + 0.4, RZ - 6.5, 9, Math.PI / 2, 0],
        [hallX - 8, groundY + y + 0.4, RZ - 11, 4, 0, 0],
      ]);
    }

    // 吹き抜け(上の階は中央を空ける)
    if (f >= 1) {
      // 空洞を演出するパネル(描画のみ・衝突は周辺で)
      const voidPanel = new THREE.Mesh(new THREE.BoxGeometry(12, 0.52, 10), new THREE.MeshStandardMaterial({ color: 0x08122c, roughness: 0.9 }));
      voidPanel.position.set(hallX - 4, groundY + y + 0.21, RZ + 2);
      hall.add(voidPanel);
      // 吹き抜け縁の手すり
      addRailings(hall, collision, [
        [hallX - 10, groundY + y + 0.4, RZ - 3, 12, 0, 0],
        [hallX - 10, groundY + y + 0.4, RZ + 7, 12, 0, 0],
        [hallX - 10, groundY + y + 0.4, RZ + 2, 10, Math.PI / 2, 0],
        [hallX + 2, groundY + y + 0.4, RZ + 2, 10, Math.PI / 2, 0],
      ]);
    }

    // 外周手すり(2F の東側は高架橋の接続口なので開ける)
    const edgeRails: [number, number, number, number, number, number][] = [
      [hallX, groundY + y + 0.4, RZ - 12, 30, 0, 0],
      [hallX - 15, groundY + y + 0.4, RZ, 24, Math.PI / 2, 0],
    ];
    if (f !== 1) {
      edgeRails.push([hallX + 15, groundY + y + 0.4, RZ, 24, Math.PI / 2, 0]);
    } else {
      // 接続口の脇だけ短い手すり
      edgeRails.push([hallX + 15, groundY + y + 0.4, RZ - 9, 6, Math.PI / 2, 0]);
      edgeRails.push([hallX + 15, groundY + y + 0.4, RZ + 9, 6, Math.PI / 2, 0]);
    }
    addRailings(hall, collision, edgeRails);

    // 発光の床縁
    const edge = new THREE.Mesh(new THREE.BoxGeometry(30, 0.1, 0.16), edgeMat);
    edge.position.set(hallX, groundY + y + 0.42, RZ - 11.9);
    hall.add(edge);
  }

  // 柱
  for (let i = 0; i < 4; i++) {
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, FLOOR_H * 2 + 0.5, 1.1), slabMat);
      col.position.set(hallX + sx * 12, groundY + FLOOR_H + 0.25, RZ - 8 + i * 5.4);
      col.castShadow = true;
      hall.add(col);
      collision.addBoxCentered(hallX + sx * 12, groundY + FLOOR_H, RZ - 8 + i * 5.4, 1.1, FLOOR_H * 2, 1.1);
    }
  }

  // 階段(1F→2F は南側からスラブ縁へ / 2F→3F は北側から) — ステップアップ対応
  // スラブ上面 = groundY + y + 0.4。階段はその高さまで登り、スラブ縁(z=±12)で接続。
  const top1 = FLOOR_H + 0.4;
  const top2 = FLOOR_H * 2 + 0.4;
  const runN = 0.34 * Math.ceil(top1 / 0.26); // 階段の全長
  // 1F→2F: 南側の外から2Fスラブ縁へ
  buildStairs(hall, collision, hallX + 8, groundY, RZ + 12 + runN, 0, top1, -1);
  // 2F→3F: 2F床の上を登り、3Fスラブ縁へ(吹き抜けの上を通る立体動線)
  buildStairs(hall, collision, hallX - 8, groundY, RZ - 10, top1, top2, 1);

  // 崩れた壁の断片
  const rng = mulberry32(31337);
  for (let i = 0; i < 14; i++) {
    const w = 1.2 + rng() * 3.2;
    const h = 1 + rng() * 3.4;
    const d = 0.4 + rng() * 0.8;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), slabMat);
    const ang = rng() * Math.PI * 2;
    const rad = 16 + rng() * 12;
    const x = hallX + Math.cos(ang) * rad;
    const z = RZ + Math.sin(ang) * rad;
    const gy = wastelandHeight(x, z) + VOID_Y;
    wall.position.set(x, gy + h / 2, z);
    wall.rotation.y = rng() * Math.PI;
    wall.rotation.z = (rng() - 0.5) * 0.16;
    wall.castShadow = true;
    wall.receiveShadow = true;
    hall.add(wall);
    collision.addBoxCentered(x, gy + h / 2, z, w, h, d);
  }

  // エラー文字の侵食面(Sponza壁面に貼る破損UI)
  const uiVariants = [0, 1, 2, 3];
  for (let i = 0; i < 10; i++) {
    const tex = textures.brokenUI(i, uiVariants[i % 4]);
    const ui = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.66, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const ang = (i / 10) * Math.PI * 2;
    ui.position.set(Math.cos(ang) * 17, groundY + 3 + (i % 3) * 2.6, RZ + Math.sin(ang) * 14);
    ui.lookAt(hallX, ui.position.y, RZ);
    hall.add(ui);
    tickables.push((_dt, time) => {
      (ui.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(time * 0.7 + i) * 0.18;
    });
  }

  // 道(到着エリア側から) の発光縁
  for (let i = 0; i < 8; i++) {
    const z = lerp(-90, RZ + 20, i / 8);
    const x = Math.sin((i / 8) * 2.2) * 10;
    for (const side of [-1, 1]) {
      const gy = wastelandHeight(x + side * 8, z) + VOID_Y;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 3.2), edgeMat);
      marker.position.set(x + side * 8, gy + 0.12, z);
      hall.add(marker);
    }
  }

  // 中心構造物へ続く街道のマーカー
  for (let i = 0; i < 10; i++) {
    const z = lerp(RZ - 30, -370, i / 10);
    const gy = wastelandHeight(0, z) + VOID_Y;
    for (const side of [-1, 1]) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 3.6), edgeMat);
      marker.position.set(side * 7.5, gy + 0.12, z);
      hall.add(marker);
    }
  }

  // ---------------- 交通: Sponza→都市 の高架橋(立体) ----------------
  buildHighBridge(ctx);

  // ---------------- 高品質プロップ(再マテリアル化) ----------------
  void placeProp(hall, {
    url: 'models/TrafficCone.glb',
    position: new THREE.Vector3(hallX - 6, groundY, RZ + 9),
    rotationY: 0.6,
    targetSize: 0.62,
  }).then((m) => rematerializeVoid(m));
  void placeProp(hall, {
    url: 'models/Lantern.glb',
    position: new THREE.Vector3(hallX + 13, groundY + 5.7, RZ - 10),
    rotationY: 1.4,
    targetSize: 0.5,
  }).then((m) => rematerializeVoid(m));
  void placeProp(hall, {
    url: 'models/ScatteringSkull.glb',
    position: new THREE.Vector3(hallX - 3, groundY + 0.1, RZ - 6),
    rotationY: 2.1,
    targetSize: 0.34,
  }).then((m) => rematerializeVoid(m));

  group.add(hall);
}

// ------------------------------------------------------------------
function addRailings(
  parent: THREE.Object3D,
  collision: import('../core/collision').CollisionWorld,
  specs: [number, number, number, number, number, number][],
): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x12244e,
    emissive: 0x1c3f8e,
    emissiveIntensity: 0.7,
    roughness: 0.42,
    metalness: 0.7,
  });
  for (const [x, y, z, len, ry] of specs) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    // 手すり横棒
    for (const hy of [0.55, 1.02]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), mat);
      bar.position.y = hy;
      bar.castShadow = true;
      g.add(bar);
    }
    // 縦ポスト
    const posts = Math.max(2, Math.floor(len / 2.2));
    for (let i = 0; i <= posts; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), mat);
      post.position.set(-len / 2 + (i / posts) * len, 0.52, 0);
      g.add(post);
    }
    parent.add(g);
    // 衝突: 薄い壁(歩行不可)
    const halfLen = len / 2;
    if (Math.abs(ry) < 0.1) {
      collision.addBox(new THREE.Vector3(x - halfLen, y, z - 0.06), new THREE.Vector3(x + halfLen, y + 1.1, z + 0.06), false);
    } else {
      collision.addBox(new THREE.Vector3(x - 0.06, y, z - halfLen), new THREE.Vector3(x + 0.06, y + 1.1, z + halfLen), false);
    }
  }
}

function buildStairs(
  parent: THREE.Object3D,
  collision: import('../core/collision').CollisionWorld,
  x: number,
  y0: number,
  z: number,
  fromY: number,
  toY: number,
  dir: number,
  axis: 'x' | 'z' = 'z',
): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x27428c,
    roughness: 0.82,
    metalness: 0.22,
    emissive: 0x14306e,
    emissiveIntensity: 0.35,
  });
  const steps = Math.ceil((toY - fromY) / 0.26);
  const run = 0.34;
  const width = 2.6;
  const rise = (toY - fromY) / steps;
  for (let i = 0; i < steps; i++) {
    // 上面が y0 + fromY + (i+1)*rise になる高さの踏段
    const top = y0 + fromY + (i + 1) * rise;
    const off = (axis === 'z' ? z : x) + dir * i * run;
    const step =
      axis === 'z'
        ? new THREE.Mesh(new THREE.BoxGeometry(width, rise + 0.1, run + 0.02), mat)
        : new THREE.Mesh(new THREE.BoxGeometry(run + 0.02, rise + 0.1, width), mat);
    step.position.set(axis === 'z' ? x : off, top - (rise + 0.1) / 2, axis === 'z' ? off : z);
    step.receiveShadow = true;
    step.castShadow = true;
    parent.add(step);
    collision.addBox(
      new THREE.Vector3(
        axis === 'z' ? x - width / 2 : off - run / 2,
        top - rise - 0.1,
        axis === 'z' ? off - run / 2 : z - width / 2,
      ),
      new THREE.Vector3(
        axis === 'z' ? x + width / 2 : off + run / 2,
        top,
        axis === 'z' ? off + run / 2 : z + width / 2,
      ),
    );
    // 手すりポスト(階段側)
    if (i % 3 === 0) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), mat);
      rail.position.set(axis === 'z' ? x - width / 2 + 0.1 : off, top + 0.45, axis === 'z' ? off : z - width / 2 + 0.1);
      parent.add(rail);
    }
  }
  // 階段の手すり壁(片側) + 衝突
  const len = steps * run;
  const midY = y0 + fromY + (toY - fromY) / 2 + 0.5;
  const railWall =
    axis === 'z'
      ? new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, len), mat)
      : new THREE.Mesh(new THREE.BoxGeometry(len, 1.0, 0.12), mat);
  if (axis === 'z') {
    railWall.position.set(x - width / 2 + 0.06, midY, z + dir * len / 2);
    railWall.rotation.x = -dir * Math.atan2(toY - fromY, len);
  } else {
    railWall.position.set(z * 0 + x + dir * len / 2, midY, z - width / 2 + 0.06);
    railWall.rotation.z = dir * Math.atan2(toY - fromY, len);
  }
  parent.add(railWall);
  const zLo = Math.min(z, z + (axis === 'z' ? dir * len : 0));
  const zHi = Math.max(z, z + (axis === 'z' ? dir * len : 0));
  const xLo = Math.min(x, x + (axis === 'x' ? dir * len : 0));
  const xHi = Math.max(x, x + (axis === 'x' ? dir * len : 0));
  if (axis === 'z') {
    collision.addBox(new THREE.Vector3(x - width / 2, y0 + fromY, zLo), new THREE.Vector3(x - width / 2 + 0.14, y0 + toY + 0.4, zHi), false);
    collision.addBox(new THREE.Vector3(x + width / 2 - 0.14, y0 + fromY, zLo), new THREE.Vector3(x + width / 2, y0 + toY + 0.4, zHi), false);
  } else {
    collision.addBox(new THREE.Vector3(xLo, y0 + fromY, z - width / 2), new THREE.Vector3(xHi, y0 + toY + 0.4, z - width / 2 + 0.14), false);
    collision.addBox(new THREE.Vector3(xLo, y0 + fromY, z + width / 2 - 0.14), new THREE.Vector3(xHi, y0 + toY + 0.4, z + width / 2), false);
  }
}

/** 崩壊建築→都市の高架橋(歩行可能・手すり付き) */
function buildHighBridge(ctx: VoidContext): void {
  const { group, collision } = ctx;
  const mat = new THREE.MeshStandardMaterial({
    map: textures.rocky.map,
    color: 0x2a4ca8,
    roughness: 0.85,
    metalness: 0.2,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x0d1c42,
    emissive: 0x2f6bff,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    metalness: 0.5,
  });

  // 東へ伸びる橋: 2F スラブ上面(groundY+5.6)に直接接続する高架橋
  const hallGround = wastelandHeight(34, RZ) + VOID_Y;
  const bridgeY = hallGround + 5.3; // スラブ中心 = 上面 5.6 - 0.3
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const x = 53.1 + i * 8; // 東縁 x=49 から伸ばす
    const slab = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.6, 5.2), mat);
    slab.position.set(x, bridgeY, RZ);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    collision.addBoxCentered(x, bridgeY, RZ, 8.2, 0.6, 5.2);
    // 手すり
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.08, 0.08), glow);
      rail.position.set(x, bridgeY + 1.1, RZ + side * 2.5);
      group.add(rail);
      const rail2 = rail.clone();
      rail2.position.y = bridgeY + 0.62;
      group.add(rail2);
      collision.addBox(new THREE.Vector3(x - 4.1, bridgeY + 0.3, RZ + side * 2.5 - 0.07), new THREE.Vector3(x + 4.1, bridgeY + 1.2, RZ + side * 2.5 + 0.07), false);
    }
    // 橋脚
    if (i % 2 === 0) {
      const gy = wastelandHeight(x, RZ) + VOID_Y;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.2, bridgeY - gy, 1.2), mat);
      pier.position.set(x, gy + (bridgeY - gy) / 2, RZ);
      group.add(pier);
    }
  }

  // 橋は2Fスラブに直結(地面からの階段はホール内の1F→2F階段を使う)
}
