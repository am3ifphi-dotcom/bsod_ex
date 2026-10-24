/**
 * ③侵食された都市の残骸エリア
 * 街路・屋内・エラー文字/UI断片に侵食されたビル群(手順生成建築 + 高品質プロップ)
 * 「PCの記憶領域から食われた建築の断片」として再マテリアル化
 */
import * as THREE from 'three';
import { textures } from './textures';
import { applyGlitch } from '../fx/glitch';
import { placeProp, rematerializeVoid } from './assets';
import { VOID_Y, wastelandHeight, type VoidContext } from './voidWorld';
import { mulberry32, lerp, clamp } from '../core/utils';

const CX = 140;
const CZ = -220;

export function buildCity(ctx: VoidContext): void {
  const { group, collision, tickables } = ctx;
  const rng = mulberry32(60613);

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x0d1c42,
    emissive: 0x2f6bff,
    emissiveIntensity: 1.15,
    roughness: 0.42,
    metalness: 0.55,
  });
  applyGlitch(glowMat, { amp: 0.015, emissiveFlicker: 0.25 });

  // ---------------- 街路床 ----------------
  const streetMat = new THREE.MeshStandardMaterial({
    map: textures.rocky.map,
    color: 0x22408e,
    roughness: 0.92,
    metalness: 0.12,
  });
  const street = new THREE.Mesh(new THREE.PlaneGeometry(46, 150), streetMat);
  street.rotation.x = -Math.PI / 2;
  const streetY = wastelandHeight(CX, CZ) + VOID_Y;
  street.position.set(CX, streetY + 0.02, CZ - 30);
  street.receiveShadow = true;
  group.add(street);

  // 高架橋からの降り階段
  buildCityStairs(ctx);

  // ---------------- ビル群(侵食された都市) ----------------
  const winTexes = [textures.windowGrid(1), textures.windowGrid(2), textures.windowGrid(3), textures.windowGrid(4)];
  const buildings: { x: number; z: number; w: number; d: number; h: number }[] = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 7; i++) {
      const x = CX + (row === 0 ? -22 : 22) + (rng() - 0.5) * 6;
      const z = CZ - 8 - i * 19 + (rng() - 0.5) * 5;
      const w = 9 + rng() * 9;
      const d = 9 + rng() * 9;
      const h = 12 + rng() * 30;
      buildings.push({ x, z, w, d, h });
    }
  }

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const tex = winTexes[i % winTexes.length].clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, b.w / 8), Math.max(1, b.h / 9));
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0x18347c,
      emissiveIntensity: 0.85,
      color: 0x101f42,
      roughness: 0.72,
      metalness: 0.28,
    });
    applyGlitch(mat, { amp: 0.03, block: 0.2, emissiveFlicker: 0.22 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    const gy = wastelandHeight(b.x, b.z) + VOID_Y;
    mesh.position.set(b.x, gy + b.h / 2, b.z);
    // ねじれ(破損加工)
    mesh.rotation.y = (rng() - 0.5) * 0.22;
    mesh.rotation.z = (rng() - 0.5) * 0.05;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    collision.addBoxCentered(b.x, gy + b.h / 2, b.z, b.w, b.h, b.d);

    // 上部に浮く断裂パーツ
    if (i % 2 === 0) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.55, 1.4, b.d * 0.55), glowMat);
      cap.position.set(b.x + (rng() - 0.5) * 3, gy + b.h + 1.6 + rng() * 2.2, b.z + (rng() - 0.5) * 3);
      cap.rotation.y = rng() * Math.PI;
      group.add(cap);
      tickables.push((_dt, time) => {
        cap.position.y = gy + b.h + 1.6 + Math.sin(time * 0.3 + i) * 0.5 + (cap.userData.baseY ?? 0);
      });
    }
  }

  // ---------------- 街灯 ----------------
  for (let i = 0; i < 8; i++) {
    const z = CZ + 8 - i * 18;
    for (const side of [-1, 1]) {
      const x = CX + side * 13;
      const gy = wastelandHeight(x, z) + VOID_Y;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.6, 10), glowMat);
      pole.position.set(x, gy + 2.8, z);
      pole.castShadow = true;
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), glowMat);
      head.position.set(x - side * 0.5, gy + 5.5, z);
      group.add(head);
      const light = new THREE.PointLight(0x4d8dff, 22, 16, 1.8);
      light.position.set(x - side * 0.5, gy + 5.2, z);
      group.add(light);
    }
  }

  // ---------------- 破損UIのビルボード ----------------
  for (let i = 0; i < 6; i++) {
    const tex = textures.brokenUI(i + 10, i % 4);
    const w = 7 + rng() * 4;
    const bb = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.56),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const x = CX + (i % 2 === 0 ? -12 : 12);
    const z = CZ + 2 - i * 21;
    const gy = wastelandHeight(x, z) + VOID_Y;
    bb.position.set(x, gy + 7 + rng() * 6, z);
    bb.lookAt(CX, bb.position.y, z);
    group.add(bb);
    tickables.push((_dt, time) => {
      (bb.material as THREE.MeshBasicMaterial).opacity = 0.62 + Math.sin(time * 0.9 + i * 1.7) * 0.22;
    });
  }

  // ---------------- 屋内(開口のある店舗) ----------------
  buildShopInterior(ctx, CX - 14, CZ - 26);

  // ---------------- 高品質プロップ ----------------
  void placeProp(group, {
    url: 'models/TrafficCone.glb',
    position: new THREE.Vector3(CX + 4, wastelandHeight(CX + 4, CZ + 2) + VOID_Y, CZ + 2),
    rotationY: 1.2,
    targetSize: 0.62,
  }).then((m) => rematerializeVoid(m));
  void placeProp(group, {
    url: 'models/TrafficCone.glb',
    position: new THREE.Vector3(CX - 6, wastelandHeight(CX - 6, CZ - 12) + VOID_Y, CZ - 12),
    rotationY: 2.8,
    targetSize: 0.62,
  }).then((m) => rematerializeVoid(m));
  void placeProp(group, {
    url: 'models/BoomBox.glb',
    position: new THREE.Vector3(CX + 9, wastelandHeight(CX + 9, CZ + 6) + VOID_Y, CZ + 6),
    rotationY: 0.4,
    targetSize: 0.55,
  }).then((m) => rematerializeVoid(m));

  // ---------------- 深層へ続く地下入口(都市側) ----------------
  const stairDown = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 8), new THREE.MeshStandardMaterial({ color: 0x0a142e, roughness: 0.9 }));
  stairDown.position.set(CX - 20, streetY - 1.2, CZ - 88);
  stairDown.rotation.x = 0.28;
  group.add(stairDown);
}

function buildCityStairs(ctx: VoidContext): void {
  const { group, collision } = ctx;
  const mat = new THREE.MeshStandardMaterial({
    map: textures.rocky.map,
    color: 0x2a4ca8,
    roughness: 0.85,
    metalness: 0.2,
  });
  // 橋(x=49+seg9 → ≈121) → 街路へ降りる階段
  const startX = 121;
  const steps = 30;
  const gy = wastelandHeight(startX + 12, CZ) + VOID_Y;
  const topY = wastelandHeight(34, CZ) + VOID_Y + 5.6; // 橋上面(2Fスラブ高)
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const x = startX + t * 12;
    const y = lerp(topY, gy, t);
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 0.38), mat);
    step.position.set(x, y - 0.14, CZ);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
    collision.addBoxCentered(x, y - 0.14, CZ, 3.6, 0.28, 0.38);
    if (i % 4 === 0) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), mat);
      rail.position.set(x, y + 0.42, CZ - 1.85);
      group.add(rail);
    }
  }
  collision.addBox(new THREE.Vector3(startX, gy, CZ - 2.1), new THREE.Vector3(startX + 12, topY, CZ - 1.7), false);
  collision.addBox(new THREE.Vector3(startX, gy, CZ + 1.7), new THREE.Vector3(startX + 12, topY, CZ + 2.1), false);
}

function buildShopInterior(ctx: VoidContext, x: number, z: number): void {
  const { group, collision, tickables } = ctx;
  const gy = wastelandHeight(x, z) + VOID_Y;
  const wallMat = new THREE.MeshStandardMaterial({
    map: textures.blockNoise(3),
    color: 0x2c4f9e,
    roughness: 0.85,
    metalness: 0.15,
    emissive: 0x142c66,
    emissiveIntensity: 0.4,
  });
  const W = 8;
  const D = 7;
  const H = 3.4;

  // 床
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), wallMat);
  floor.position.set(x, gy + 0.1, z);
  floor.receiveShadow = true;
  group.add(floor);
  collision.addBoxCentered(x, gy + 0.1, z, W, 0.2, D);
  // 壁(南側 = 開口)
  const mkWall = (w: number, h: number, px: number, py: number, pz: number, ry: number): void => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22), wallMat);
    wall.position.set(px, py, pz);
    wall.rotation.y = ry;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  };
  mkWall(W, H, x, gy + H / 2, z - D / 2, 0);
  mkWall(D, H, x - W / 2, gy + H / 2, z, Math.PI / 2);
  mkWall(D, H, x + W / 2, gy + H / 2, z, Math.PI / 2);
  // 天井
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), wallMat);
  ceil.position.set(x, gy + H + 0.1, z);
  group.add(ceil);
  collision.addBoxCentered(x, gy + H + 0.1, z, W, 0.2, D);
  // 衝突(壁)
  collision.addBoxCentered(x, gy + H / 2, z - D / 2, W, H, 0.22);
  collision.addBoxCentered(x - W / 2, gy + H / 2, z, 0.22, H, D);
  collision.addBoxCentered(x + W / 2, gy + H / 2, z, 0.22, H, D);

  // 棚と商品(生活感の残滓)
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x1a2c58, roughness: 0.7, metalness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 2.2), shelfMat);
    shelf.position.set(x - W / 2 + 0.7, gy + 0.9, z - 1.8 + i * 1.8);
    shelf.castShadow = true;
    group.add(shelf);
    collision.addBoxCentered(x - W / 2 + 0.7, gy + 0.9, z - 1.8 + i * 1.8, 0.5, 1.6, 2.2);
  }

  // 内部照明(青い蛍光灯)
  const strip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.18), new THREE.MeshBasicMaterial({ color: 0x9fc3ff }));
  strip.position.set(x, gy + H - 0.35, z);
  group.add(strip);
  const light = new THREE.PointLight(0x4d8dff, 16, 12, 1.7);
  light.position.set(x, gy + H - 0.6, z);
  group.add(light);
  tickables.push((_dt, time) => {
    // たまにちらつく(毎秒1回以下)
    light.intensity = 16 * (0.85 + 0.15 * Math.sin(time * 1.3)) * (Math.sin(time * 0.37) > -0.97 ? 1 : 0.45);
  });

  // 冷蔵庫(高品質プロップ)
  void placeProp(group, {
    url: 'models/CommercialRefrigerator.glb',
    position: new THREE.Vector3(x + W / 2 - 1.2, gy + 0.2, z - 1.6),
    rotationY: -Math.PI / 2,
    targetSize: 2.0,
  }).then((m) => {
    rematerializeVoid(m);
    collision.addBoxCentered(x + W / 2 - 1.2, gy + 1.2, z - 1.6, 1.1, 2.0, 1.2);
  });

  // 破損UI(店内モニター)
  const tex = textures.brokenUI(21, 1);
  const mon = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  mon.position.set(x - 1.2, gy + 1.9, z - D / 2 + 0.15);
  group.add(mon);
}

export { clamp, lerp, mulberry32 };
