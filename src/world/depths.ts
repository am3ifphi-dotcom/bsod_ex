/**
 * ④深層エリア — 配線とブロックノイズが露出した閉鎖空間
 * 都市/崩壊建築から続く廊下で接続。狭く、暗く、青い血管状の光。
 * 各室の壁はドア開口付き(歩行可能・衝突判定あり)。
 */
import * as THREE from 'three';
import { textures } from './textures';
import { applyGlitch } from '../fx/glitch';
import { placeProp, rematerializeVoid } from './assets';
import { VOID_Y, wastelandHeight, type VoidContext } from './voidWorld';
import { mulberry32 } from '../core/utils';

const DX = -150;
const DZ = -230;

export function buildDepths(ctx: VoidContext): void {
  const { group, collision, tickables } = ctx;
  const gy = wastelandHeight(DX, DZ) + VOID_Y - 2;

  const wallMat = new THREE.MeshStandardMaterial({
    map: textures.blockNoise(1),
    color: 0x24407e,
    roughness: 0.86,
    metalness: 0.22,
    emissive: 0x10224e,
    emissiveIntensity: 0.55,
  });
  applyGlitch(wallMat, { amp: 0.025, block: 0.25, emissiveFlicker: 0.3 });
  const veinMat = new THREE.MeshBasicMaterial({ color: 0x3f7dff });

  /** 壁(ドア開口付き): axis 'x' は x に沿った壁(厚み z) */
  const mkWall = (
    cx: number,
    cz: number,
    w: number,
    h: number,
    axis: 'x' | 'z',
    door: { width: number; height: number } | null,
  ): void => {
    const t = 0.5;
    const seg = (sx: number, sz: number, sw: number, sd: number, sy: number, sh: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), wallMat);
      m.position.set(sx, gy + sy + sh / 2, sz);
      m.receiveShadow = true;
      m.castShadow = true;
      group.add(m);
      collision.addBoxCentered(sx, gy + sy + sh / 2, sz, sw, sh, sd);
    };
    if (!door) {
      seg(cx, cz, axis === 'x' ? w : t, axis === 'x' ? t : w, 0, h);
      return;
    }
    const dw = door.width;
    const dh = door.height;
    const side = (w - dw) / 2;
    if (axis === 'x') {
      // 左右の柱間壁
      seg(cx - dw / 2 - side / 2, cz, side, t, 0, h);
      seg(cx + dw / 2 + side / 2, cz, side, t, 0, h);
      // リンテル
      seg(cx, cz, dw, t, dh, h - dh);
    } else {
      seg(cx, cz - dw / 2 - side / 2, t, side, 0, h);
      seg(cx, cz + dw / 2 + side / 2, t, side, 0, h);
      seg(cx, cz, t, dw, dh, h - dh);
    }
    // ドア枠の発光
    const glowW = axis === 'x' ? dw : 0.12;
    const glowD = axis === 'x' ? 0.12 : dw;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(glowW, 0.1, glowD), veinMat);
    glow.position.set(cx, gy + dh + 0.05, cz);
    group.add(glow);
  };

  /** 室(床・天井・4壁、指定辺にドア) */
  const mkRoom = (
    cx: number,
    cz: number,
    w: number,
    d: number,
    h: number,
    doors: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {},
  ): void => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), wallMat);
    floor.position.set(cx, gy + 0.2, cz);
    floor.receiveShadow = true;
    group.add(floor);
    collision.addBoxCentered(cx, gy + 0.2, cz, w, 0.4, d);

    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), wallMat);
    ceil.position.set(cx, gy + h, cz);
    group.add(ceil);
    collision.addBoxCentered(cx, gy + h, cz, w, 0.4, d);

    const doorSpec = { width: 3.2, height: 3.0 };
    mkWall(cx, cz - d / 2, w, h, 'x', doors.n ? doorSpec : null);
    mkWall(cx, cz + d / 2, w, h, 'x', doors.s ? doorSpec : null);
    mkWall(cx - w / 2, cz, d, h, 'z', doors.w ? doorSpec : null);
    mkWall(cx + w / 2, cz, d, h, 'z', doors.e ? doorSpec : null);
  };

  // 大広間 + 3つの廊下(壁同士が接する位置に配置し、ドアで連結)
  mkRoom(DX, DZ, 26, 24, 6.5, { e: true, w: true, n: true });
  mkRoom(DX + 24.35, DZ, 22, 8, 4.2, { w: true, e: true }); // 東廊下 → 外へ出られる
  mkRoom(DX - 22.35, DZ, 18, 8, 4.2, { e: true, w: true }); // 西廊下(盲端側 + 外へ)
  mkRoom(DX, DZ - 23.35, 8, 22, 4.2, { s: true, n: true }); // 北廊下

  // ---------------- 配線(チューブ) ----------------
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0x0c1a3c,
    emissive: 0x1c44a8,
    emissiveIntensity: 0.8,
    roughness: 0.5,
    metalness: 0.55,
  });
  const rng = mulberry32(9001);
  for (let i = 0; i < 12; i++) {
    const points: THREE.Vector3[] = [];
    const x0 = DX - 12 + rng() * 24;
    const z0 = DZ - 12 + rng() * 24;
    for (let s = 0; s < 5; s++) {
      points.push(new THREE.Vector3(
        x0 + (rng() - 0.5) * 10,
        gy + 6.5 - 0.8 - rng() * 1.6,
        z0 + s * 3.2 - 6 + (rng() - 0.5) * 4,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.07 + rng() * 0.09, 6, false), cableMat);
    group.add(tube);
  }

  // 発光の血管(床)
  for (let i = 0; i < 26; i++) {
    const vein = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1.4 + rng() * 2.2), veinMat);
    vein.position.set(DX - 11 + rng() * 22, gy + 0.42, DZ - 11 + rng() * 22);
    vein.rotation.y = rng() * Math.PI;
    group.add(vein);
    if (i % 3 === 0) {
      const light = new THREE.PointLight(0x3f7dff, 5, 7, 1.9);
      light.position.copy(vein.position).setY(gy + 0.9);
      group.add(light);
    }
  }

  // ---------------- ブロックノイズの柱 ----------------
  for (let i = 0; i < 10; i++) {
    const h = 1.2 + rng() * 4;
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.1), wallMat);
    col.position.set(DX - 10 + rng() * 20, gy + h / 2, DZ - 10 + rng() * 20);
    col.castShadow = true;
    group.add(col);
    collision.addBoxCentered(col.position.x, col.position.y, col.position.z, 1.1, h, 1.1);
  }

  // ---------------- オブジェクト(遺物) ----------------
  void placeProp(group, {
    url: 'models/ScatteringSkull.glb',
    position: new THREE.Vector3(DX + 2, gy + 0.45, DZ - 4),
    rotationY: 1.2,
    targetSize: 0.42,
  }).then((m) => rematerializeVoid(m, { emissiveBoost: 1.8 }));

  void placeProp(group, {
    url: 'models/DamagedHelmet.glb',
    position: new THREE.Vector3(DX - 5, gy + 0.42, DZ + 5),
    rotationY: 2.2,
    targetSize: 0.45,
  }).then((m) => rematerializeVoid(m));

  // ---------------- 深層の手掛かり(破損UI) ----------------
  const hintTex = textures.brokenUI(31, 2);
  const hint = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 2.0),
    new THREE.MeshBasicMaterial({ map: hintTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  hint.position.set(DX, gy + 2.2, DZ - 11.6);
  group.add(hint);
  const hintLight = new THREE.PointLight(0x4d8dff, 12, 10, 1.8);
  hintLight.position.set(DX, gy + 2.4, DZ - 10);
  group.add(hintLight);
  tickables.push((_dt, time) => {
    (hint.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(time * 0.8) * 0.18;
  });

  // ---------------- 出入口の表示(発光) ----------------
  const exitGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.6),
    new THREE.MeshBasicMaterial({ color: 0x2244aa, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  exitGlow.position.set(DX + 35.5, gy + 1.9, DZ);
  exitGlow.rotation.y = Math.PI / 2;
  group.add(exitGlow);
}
