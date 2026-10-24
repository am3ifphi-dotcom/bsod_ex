/**
 * 自室 — 夜の部屋。モニターの光が主光源。
 * 高品質GLBプロップ + PBRテクスチャ + 生活感のある小物。
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { textures } from './textures';
import { placeProp, loadModel } from './assets';
import type { CollisionWorld } from '../core/collision';
import { lerp, clamp, damp } from '../core/utils';

export interface RoomLights {
  monitorPoint: THREE.PointLight;
  monitorRect: THREE.RectAreaLight;
  deskLamp: THREE.PointLight;
  ceiling: THREE.PointLight;
  moon: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
}

export class Room {
  readonly group = new THREE.Group();
  readonly lights: RoomLights;
  screenMesh!: THREE.Mesh;
  screenMat!: THREE.MeshBasicMaterial;
  private ceilingMesh!: THREE.Mesh;
  private clockHands: { hour: THREE.Object3D; min: THREE.Object3D; sec: THREE.Object3D } | null = null;
  private clockTime = 2 * 3600 + 17 * 60; // 02:17
  clockFrozen = false;
  private fanMixer: THREE.AnimationMixer | null = null;
  private fanRoot: THREE.Group | null = null;
  private floatFragments: THREE.Object3D[] = [];
  private monitorGlitch = 0; // 帰還後の残り火
  private elapsed = 0;
  /** 見るだけでよい対象の注視点 */
  lookTargets = new Map<string, THREE.Vector3>();

  constructor(private collision: CollisionWorld) {
    this.group.name = 'room';
    RectAreaLightUniformsLib.init();

    this.lights = {
      monitorPoint: new THREE.PointLight(0x4d8dff, 14, 9, 1.8),
      monitorRect: new THREE.RectAreaLight(0x3f7dff, 5.2, 1.15, 0.66),
      deskLamp: new THREE.PointLight(0xffd9a8, 3.2, 5, 1.9),
      ceiling: new THREE.PointLight(0xffe6c4, 0.0, 10, 1.6),
      moon: new THREE.DirectionalLight(0x8fb2ff, 0.55),
      ambient: new THREE.HemisphereLight(0x24324e, 0x0b0e16, 0.32),
    };

    this.build();
    void this.loadProps();
  }

  // ------------------------------------------------------------------
  private build(): void {
    const W = 6.2;
    const D = 5.4;
    const H = 2.72;

    // ---- 床(木) ----
    const woodMap = textures.wood.map.clone();
    woodMap.repeat.set(3, 2.6);
    woodMap.needsUpdate = true;
    const woodRough = textures.wood.roughnessMap?.clone();
    if (woodRough) {
      woodRough.repeat.set(3, 2.6);
      woodRough.needsUpdate = true;
    }
    const floorMat = new THREE.MeshStandardMaterial({
      map: woodMap,
      roughnessMap: woodRough ?? null,
      roughness: 0.72,
      metalness: 0.06,
      color: 0x9a8a78,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---- 壁(くすんだ塗装壁: 手続きノイズのアルベド) ----
    const wallTex = this.makeWallTexture();
    wallTex.repeat.set(2, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.94, metalness: 0.0, color: 0xb9b3ab });
    const wallMatDark = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, metalness: 0.0, color: 0x8e8981 });

    const mkWall = (w: number, h: number, x: number, y: number, z: number, ry: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    mkWall(W, H, 0, H / 2, -D / 2, 0, wallMat); // north(机側)
    mkWall(W, H, 0, H / 2, D / 2, Math.PI, wallMatDark); // south
    mkWall(D, H, -W / 2, H / 2, 0, Math.PI / 2, wallMatDark); // west
    mkWall(D, H, W / 2, H / 2, 0, -Math.PI / 2, wallMat); // east

    // 天井
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xcfc9c0, roughness: 0.98 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    ceil.receiveShadow = true;
    this.group.add(ceil);
    this.ceilingMesh = ceil;

    // 貼り付け(幅木)
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.8 });
    const mkSkirt = (w: number, x: number, z: number, ry: number): void => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.03), skirtMat);
      s.position.set(x, 0.06, z);
      s.rotation.y = ry;
      this.group.add(s);
    };
    mkSkirt(W, 0, -D / 2 + 0.02, 0);
    mkSkirt(W, 0, D / 2 - 0.02, 0);
    mkSkirt(D, -W / 2 + 0.02, 0, Math.PI / 2);
    mkSkirt(D, W / 2 - 0.02, 0, Math.PI / 2);

    // ---- 窓(北壁左): 夜景 + 窓枠 ----
    const winGroup = new THREE.Group();
    winGroup.position.set(-1.72, 1.52, -D / 2 + 0.06);
    const cityTex = textures.nightCityTexture();
    const cityMat = new THREE.MeshBasicMaterial({ map: cityTex, toneMapped: true });
    const cityPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.95), cityMat);
    cityPlane.position.z = -0.02;
    winGroup.add(cityPlane);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.6, metalness: 0.35 });
    const mkFrame = (w: number, h: number, x: number, y: number): void => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), frameMat);
      f.position.set(x, y, 0.03);
      f.castShadow = true;
      winGroup.add(f);
    };
    mkFrame(1.72, 0.07, 0, 0.52);
    mkFrame(1.72, 0.07, 0, -0.52);
    mkFrame(0.07, 1.1, -0.83, 0);
    mkFrame(0.07, 1.1, 0.83, 0);
    mkFrame(0.05, 1.05, 0, 0);
    this.group.add(winGroup);
    this.lookTargets.set('window', new THREE.Vector3(-1.72, 1.52, -D / 2 + 0.2));

    // カーテン
    const curtainMat = new THREE.MeshStandardMaterial({ color: 0x2b3348, roughness: 0.92, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const cg = new THREE.PlaneGeometry(0.62, 1.7, 8, 12);
      const pos = cg.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 9 + y * 1.2) * 0.045);
      }
      cg.computeVertexNormals();
      const c = new THREE.Mesh(cg, curtainMat);
      c.position.set(-1.72 + side * 1.08, 1.42, -D / 2 + 0.16);
      c.castShadow = true;
      this.group.add(c);
    }

    // ---- デスク(北壁右) ----
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x6b5240, roughness: 0.55, metalness: 0.08 });
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.05, 0.82), deskMat);
    deskTop.position.set(0.72, 0.755, -2.16);
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    this.group.add(deskTop);
    for (const [lx, lz] of [
      [-0.92, -0.32],
      [0.92, -0.32],
      [-0.92, 0.32],
      [0.92, 0.32],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.75, 0.055), new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.55 }));
      leg.position.set(0.72 + lx, 0.375, -2.16 + lz);
      leg.castShadow = true;
      this.group.add(leg);
    }
    this.collision.addBox(new THREE.Vector3(-0.31, 0, -2.57), new THREE.Vector3(1.75, 0.78, -1.75));

    // ---- モニター ----
    const monitorGroup = new THREE.Group();
    monitorGroup.position.set(0.72, 0.78, -2.42);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.42, metalness: 0.5 });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.2), standMat);
    stand.position.y = 0.02;
    monitorGroup.add(stand);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.05), standMat);
    neck.position.y = 0.16;
    monitorGroup.add(neck);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.68, 0.045), standMat);
    bezel.position.y = 0.52;
    bezel.castShadow = true;
    monitorGroup.add(bezel);
    // 画面(発光)
    this.screenMat = new THREE.MeshBasicMaterial({
      map: textures.bsodScreen(0, 0),
      toneMapped: true,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), this.screenMat);
    screen.position.set(0, 0.52, 0.028);
    monitorGroup.add(screen);
    this.screenMesh = screen;
    this.group.add(monitorGroup);
    this.lookTargets.set('pc', new THREE.Vector3(0.72, 1.3, -2.42));

    // モニターの光(主光源)
    this.lights.monitorPoint.position.set(0.72, 1.35, -2.0);
    this.lights.monitorRect.position.set(0.72, 1.3, -2.36);
    this.lights.monitorRect.lookAt(0.72, 1.1, -1.2);
    this.group.add(this.lights.monitorPoint, this.lights.monitorRect);

    // ---- キーボード / マウス / PCタワー ----
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.135), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.25 }));
    kb.position.set(0.62, 0.795, -2.06);
    kb.rotation.y = 0.04;
    kb.castShadow = true;
    this.group.add(kb);
    const mouse = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.065, 4, 8), new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.25 }));
    mouse.rotation.x = Math.PI / 2;
    mouse.position.set(1.03, 0.795, -2.04);
    this.group.add(mouse);

    const tower = new THREE.Group();
    tower.position.set(1.86, 0, -2.28);
    const towerBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.5), new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.45, metalness: 0.6 }));
    towerBody.position.y = 0.23;
    towerBody.castShadow = true;
    tower.add(towerBody);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.015, 0.015), new THREE.MeshBasicMaterial({ color: 0x58c8ff }));
    led.position.set(0.112, 0.38, -0.18);
    led.rotation.y = Math.PI / 2;
    tower.add(led);
    this.group.add(tower);
    this.collision.addBox(new THREE.Vector3(1.72, 0, -2.56), new THREE.Vector3(2.0, 0.46, -2.0));

    // ---- デスクラップ(可搬照明) ----
    const lampGroup = new THREE.Group();
    lampGroup.position.set(-0.18, 0.78, -2.3);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.025, 16), standMat);
    lampGroup.add(lampBase);
    const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), standMat);
    lampArm.position.set(0.02, 0.17, 0);
    lampArm.rotation.z = -0.25;
    lampGroup.add(lampArm);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.12, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x39404c, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide }));
    lampShade.position.set(0.075, 0.34, 0);
    lampShade.rotation.z = -0.9;
    lampGroup.add(lampShade);
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
    lampBulb.position.set(0.115, 0.325, 0);
    lampGroup.add(lampBulb);
    this.group.add(lampGroup);
    this.lights.deskLamp.position.set(-0.06, 1.12, -2.24);
    this.group.add(this.lights.deskLamp);

    // ---- ベッド(東側) ----
    const bedGroup = new THREE.Group();
    bedGroup.position.set(2.22, 0, -0.1);
    const bedFrameMat = new THREE.MeshStandardMaterial({ color: 0x4d3a2c, roughness: 0.7 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.3, 2.12), bedFrameMat);
    frame.position.y = 0.19;
    frame.castShadow = true;
    frame.receiveShadow = true;
    bedGroup.add(frame);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.18, 2.02), new THREE.MeshStandardMaterial({ color: 0xc9c2b6, roughness: 0.92 }));
    mattress.position.y = 0.43;
    mattress.castShadow = true;
    bedGroup.add(mattress);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.09, 1.35), new THREE.MeshStandardMaterial({ color: 0x35486b, roughness: 0.88 }));
    blanket.position.set(0, 0.55, 0.32);
    blanket.castShadow = true;
    bedGroup.add(blanket);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.11, 0.34), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.95 }));
    pillow.position.set(0, 0.585, -0.78);
    pillow.castShadow = true;
    bedGroup.add(pillow);
    this.group.add(bedGroup);
    this.collision.addBox(new THREE.Vector3(1.58, 0, -1.18), new THREE.Vector3(2.88, 0.62, 0.98));
    this.lookTargets.set('bed', new THREE.Vector3(2.22, 0.55, -0.1));

    // ---- 本棚(西側) ----
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x5a4634, roughness: 0.68 });
    const shelf = new THREE.Group();
    shelf.position.set(-2.72, 0, -0.6);
    const shelfBody = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.9, 1.3), shelfMat);
    shelfBody.position.y = 0.95;
    shelfBody.castShadow = true;
    shelfBody.receiveShadow = true;
    shelf.add(shelfBody);
    for (let i = 0; i < 4; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 1.22), shelfMat);
      board.position.set(0.01, 0.36 + i * 0.42, 0);
      shelf.add(board);
    }
    // 本(色違いの箱)
    const rng = (n: number): number => {
      const x = Math.sin(n * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 16; i++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.045 + rng(i) * 0.035, 0.2 + rng(i + 9) * 0.1, 0.16 + rng(i + 3) * 0.08),
        new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.05 + rng(i + 1) * 0.55, 0.32, 0.22 + rng(i + 2) * 0.2), roughness: 0.85 }),
      );
      const level = i % 3;
      book.position.set(0.02, 0.48 + level * 0.42, -0.5 + (i % 6) * 0.19 + rng(i + 5) * 0.04);
      book.rotation.y = rng(i + 7) * 0.2 - 0.1;
      book.castShadow = true;
      shelf.add(book);
    }
    this.group.add(shelf);
    this.collision.addBox(new THREE.Vector3(-2.94, 0, -1.28), new THREE.Vector3(-2.5, 1.9, 0.08));
    this.lookTargets.set('shelf', new THREE.Vector3(-2.6, 1.3, -0.6));

    // ---- ソファ(南側) ----
    // GLB(GlamVelvetSofa)で後置き。仮の脚のみここで。

    // ---- ラグ ----
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.7), new THREE.MeshStandardMaterial({ color: 0x39425c, roughness: 0.97 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.15, 0.008, 0.62);
    rug.receiveShadow = true;
    this.group.add(rug);

    // ---- ドア(南壁) ----
    const door = new THREE.Group();
    door.position.set(-1.86, 0, D / 2 - 0.045);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4b3a2c, roughness: 0.62 });
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.06, 0.05), doorMat);
    doorPanel.position.y = 1.03;
    doorPanel.castShadow = true;
    door.add(doorPanel);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 12), new THREE.MeshStandardMaterial({ color: 0x8c7a52, roughness: 0.35, metalness: 0.85 }));
    knob.position.set(0.32, 1.02, -0.05);
    door.add(knob);
    this.group.add(door);

    // ---- ポスター ----
    for (const [kind, x, y, ry] of [
      [0, -0.2, 1.85, 0],
      [1, 1.95, 1.75, -Math.PI / 2],
    ] as [number, number, number, number][]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.78), new THREE.MeshStandardMaterial({ map: textures.posterTexture(kind), roughness: 0.9 }));
      if (ry === 0) p.position.set(x, y, -D / 2 + 0.02);
      else p.position.set(W / 2 - 0.02, y, -1.5);
      p.rotation.y = ry;
      this.group.add(p);
    }

    // ---- 時計(南壁) ----
    const clockGroup = new THREE.Group();
    clockGroup.position.set(0.9, 2.12, D / 2 - 0.035);
    clockGroup.rotation.y = Math.PI;
    const clockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.035, 28), new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.5, metalness: 0.4 }));
    clockBody.rotation.x = Math.PI / 2;
    clockGroup.add(clockBody);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.145, 28), new THREE.MeshStandardMaterial({ map: textures.clockFace(), roughness: 0.85 }));
    face.position.z = -0.022;
    face.rotation.y = Math.PI;
    clockGroup.add(face);
    const handMat = new THREE.MeshBasicMaterial({ color: 0x141820 });
    const mkHand = (len: number, w: number, z: number): THREE.Object3D => {
      const pivot = new THREE.Object3D();
      const h = new THREE.Mesh(new THREE.PlaneGeometry(w, len), handMat);
      h.position.y = len / 2 - 0.015;
      h.rotation.y = Math.PI;
      pivot.add(h);
      pivot.position.z = z;
      clockGroup.add(pivot);
      return pivot;
    };
    this.clockHands = {
      hour: mkHand(0.07, 0.012, -0.028),
      min: mkHand(0.1, 0.009, -0.032),
      sec: mkHand(0.115, 0.005, -0.036),
    };
    this.group.add(clockGroup);

    // ---- 天井照明 ----
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.09, 20), new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.6 }));
    fixture.position.set(0, H - 0.05, 0.2);
    this.group.add(fixture);
    this.lights.ceiling.position.set(0, H - 0.25, 0.2);
    this.group.add(this.lights.ceiling);

    // ---- 月光/外光 ----
    this.lights.moon.position.set(-4, 6, -6);
    this.lights.moon.target.position.set(0, 0.8, 0);
    this.lights.moon.castShadow = true;
    this.lights.moon.shadow.mapSize.set(1024, 1024);
    this.lights.moon.shadow.camera.near = 0.5;
    this.lights.moon.shadow.camera.far = 20;
    this.lights.moon.shadow.camera.left = -6;
    this.lights.moon.shadow.camera.right = 6;
    this.lights.moon.shadow.camera.top = 6;
    this.lights.moon.shadow.camera.bottom = -6;
    this.lights.moon.shadow.bias = -0.0008;
    this.group.add(this.lights.moon, this.lights.moon.target);

    this.group.add(this.lights.ambient);

    // ---- 壁の衝突 ----
    const t = 0.2;
    this.collision.addBox(new THREE.Vector3(-W / 2 - t, 0, -D / 2 - t), new THREE.Vector3(W / 2 + t, H, -D / 2));
    this.collision.addBox(new THREE.Vector3(-W / 2 - t, 0, D / 2), new THREE.Vector3(W / 2 + t, H, D / 2 + t));
    this.collision.addBox(new THREE.Vector3(-W / 2 - t, 0, -D / 2 - t), new THREE.Vector3(-W / 2, H, D / 2 + t));
    this.collision.addBox(new THREE.Vector3(W / 2, 0, -D / 2 - t), new THREE.Vector3(W / 2 + t, H, D / 2 + t));
    // 天井(落下防止はしない: 部屋では飛べない)
    // ベッド・棚は上で衝突済み
  }

  private makeWallTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#b7b1a8';
    ctx.fillRect(0, 0, 256, 256);
    const img = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 11;
      img.data[i] = clamp(img.data[i] + n, 0, 255);
      img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
      img.data[i + 2] = clamp(img.data[i + 2] + n, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ------------------------------------------------------------------
  private async loadProps(): Promise<void> {
    const jobs: Promise<unknown>[] = [];

    // フライトヘルメット(棚上)
    jobs.push(
      placeProp(this.group, {
        url: 'models/FlightHelmet/FlightHelmet.gltf',
        position: new THREE.Vector3(-2.55, 1.22, -1.05),
        rotationY: 0.7,
        targetSize: 0.34,
      }),
    );
    // アンティークカメラ(棚)
    jobs.push(
      placeProp(this.group, {
        url: 'models/AntiqueCamera.glb',
        position: new THREE.Vector3(-2.55, 0.78, -0.25),
        rotationY: -0.5,
        targetSize: 0.22,
      }),
    );
    // ブームボックス(棚)
    jobs.push(
      placeProp(this.group, {
        url: 'models/BoomBox.glb',
        position: new THREE.Vector3(-2.52, 1.22, -0.2),
        rotationY: -Math.PI / 2 + 0.2,
        targetSize: 0.36,
      }),
    );
    // おもちゃの車(棚)
    jobs.push(
      placeProp(this.group, {
        url: 'models/ToyCar.glb',
        position: new THREE.Vector3(-2.55, 0.78, -0.95),
        rotationY: 1.2,
        targetSize: 0.17,
      }),
    );
    // 花瓶(棚上)
    jobs.push(
      placeProp(this.group, {
        url: 'models/GlassVaseFlowers.glb',
        position: new THREE.Vector3(-2.52, 1.64, -0.75),
        rotationY: 0.4,
        targetSize: 0.26,
      }),
    );
    // ろうそくホルダー(棚)
    jobs.push(
      placeProp(this.group, {
        url: 'models/GlassHurricaneCandleHolder.glb',
        position: new THREE.Vector3(-2.52, 1.64, -1.12),
        rotationY: 0.2,
        targetSize: 0.22,
      }),
    );
    // ダメージヘルメット(棚下)
    jobs.push(
      placeProp(this.group, {
        url: 'models/DamagedHelmet.glb',
        position: new THREE.Vector3(-2.52, 0.42, -0.62),
        rotationY: -0.8,
        targetSize: 0.26,
      }),
    );
    // スカル(棚の上——気味悪さ)
    jobs.push(
      placeProp(this.group, {
        url: 'models/ScatteringSkull.glb',
        position: new THREE.Vector3(-2.7, 1.96, -0.15),
        rotationY: 2.4,
        targetSize: 0.2,
      }),
    );
    this.lookTargets.set('skull', new THREE.Vector3(-2.7, 2.02, -0.15));

    // デスクまわり
    jobs.push(
      placeProp(this.group, {
        url: 'models/WaterBottle.glb',
        position: new THREE.Vector3(1.38, 0.78, -2.28),
        rotationY: 0.3,
        targetSize: 0.23,
      }),
    );
    jobs.push(
      placeProp(this.group, {
        url: 'models/ChronographWatch.glb',
        position: new THREE.Vector3(0.18, 0.785, -2.1),
        rotationY: -0.4,
        targetSize: 0.11,
      }),
    );
    jobs.push(
      placeProp(this.group, {
        url: 'models/SunglassesKhronos.glb',
        position: new THREE.Vector3(1.42, 0.785, -1.95),
        rotationY: 1.1,
        targetSize: 0.15,
      }),
    );
    jobs.push(
      placeProp(this.group, {
        url: 'models/IridescenceLamp.glb',
        position: new THREE.Vector3(-0.02, 0.78, -2.42),
        rotationY: 0.9,
        targetSize: 0.28,
      }),
    );

    // 椅子
    const chairJob = placeProp(this.group, {
      url: 'models/ChairDamaskPurplegold.glb',
      position: new THREE.Vector3(0.72, 0, -1.5),
      rotationY: Math.PI,
      targetSize: 1.05,
    });
    jobs.push(chairJob);
    this.collision.addBox(new THREE.Vector3(0.32, 0, -1.92), new THREE.Vector3(1.12, 0.52, -1.12));
    this.collision.addBox(new THREE.Vector3(0.32, 0.52, -1.22), new THREE.Vector3(1.12, 1.05, -1.12));

    // ソファ(南側)
    jobs.push(
      placeProp(this.group, {
        url: 'models/GlamVelvetSofa.glb',
        position: new THREE.Vector3(0.9, 0, 1.92),
        rotationY: Math.PI,
        targetSize: 1.85,
      }).then((m) => {
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        this.collision.addBox(
          new THREE.Vector3(box.min.x, 0, box.min.z),
          new THREE.Vector3(box.max.x, Math.min(1.0, box.max.y), box.max.z),
        );
        void size;
      }),
    );

    // 靴(ドア脇)
    jobs.push(
      placeProp(this.group, {
        url: 'models/MaterialsVariantsShoe.glb',
        position: new THREE.Vector3(-1.28, 0, 1.95),
        rotationY: 1.9,
        targetSize: 0.3,
      }),
    );

    // リングチェア(隅)
    jobs.push(
      placeProp(this.group, {
        url: 'models/SheenChair.glb',
        position: new THREE.Vector3(-2.15, 0, 1.55),
        rotationY: 0.9,
        targetSize: 0.95,
      }),
    );

    // 扇風機(ベッド脇のスツール上)
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.42, 18), new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.7 }));
    stool.position.set(2.2, 0.21, 1.18);
    stool.castShadow = true;
    this.group.add(stool);
    this.collision.addBox(new THREE.Vector3(2.0, 0, 0.98), new THREE.Vector3(2.4, 0.42, 1.38));

    const fanJob = loadModel('models/vintageDeskFan/vintageFan_animated.gltf').then((fan) => {
      fan.position.set(2.2, 0.42, 1.18);
      fan.rotation.y = -2.2;
      // normalize
      const box = new THREE.Box3().setFromObject(fan);
      const size = box.getSize(new THREE.Vector3());
      const s = 0.42 / Math.max(size.x, size.y, size.z);
      fan.scale.setScalar(s);
      this.group.add(fan);
      this.fanRoot = fan;
      const anims = fan.userData.animations as THREE.AnimationClip[];
      if (anims && anims.length) {
        this.fanMixer = new THREE.AnimationMixer(fan);
        for (const clip of anims) {
          this.fanMixer.clipAction(clip).play();
        }
      }
    });
    jobs.push(fanJob);

    await Promise.all(jobs);
  }

  // ------------------------------------------------------------------
  /** モニター画面の更新 (corruption 0..1, faceGrow 0..1) */
  updateScreen(corruption: number, faceGrow = 0, frame?: number): void {
    const f = frame ?? Math.floor(this.elapsed * 12);
    const tex = textures.bsodScreen(f, corruption, faceGrow);
    if (this.screenMat.map !== tex) {
      this.screenMat.map = tex;
      this.screenMat.needsUpdate = true;
    }
  }

  /** 帰還後の薄いグリッチ残り */
  setAfterglow(on: boolean): void {
    this.monitorGlitch = on ? 0.22 : 0;
    if (on) {
      this.lights.monitorPoint.color.set(0x3f6dff);
      this.lights.monitorPoint.intensity = 11;
    }
  }

  /** 天井の表示切替(落下帰還時: 上から自室へ入る) */
  setCeilingVisible(v: boolean): void {
    this.ceilingMesh.visible = v;
    this.lights.ceiling.visible = v;
  }

  /** 光の状態(場面に応じて) */
  setLighting(phase: 'normal' | 'dark' | 'after'): void {
    const L = this.lights;
    if (phase === 'normal') {
      L.monitorPoint.intensity = 14;
      L.monitorRect.intensity = 5.2;
      L.deskLamp.intensity = 3.2;
      L.ceiling.intensity = 0;
      L.moon.intensity = 0.55;
      L.ambient.intensity = 0.32;
    } else if (phase === 'dark') {
      L.monitorPoint.intensity = 6;
      L.monitorRect.intensity = 2.2;
      L.deskLamp.intensity = 0.4;
      L.ceiling.intensity = 0;
      L.moon.intensity = 0.12;
      L.ambient.intensity = 0.1;
    } else {
      L.monitorPoint.intensity = 12;
      L.monitorRect.intensity = 4.4;
      L.deskLamp.intensity = 2.6;
      L.ceiling.intensity = 5.5;
      L.moon.intensity = 0.5;
      L.ambient.intensity = 0.36;
    }
  }

  update(dt: number): void {
    this.elapsed += dt;
    if (this.fanMixer) this.fanMixer.update(dt * 0.65);

    // 時計
    if (this.clockHands && !this.clockFrozen) {
      this.clockTime += dt;
      const t = this.clockTime % 43200; // 12h
      const sec = (this.clockTime % 60) * (Math.PI * 2) / 60;
      const min = ((this.clockTime / 60) % 60) * (Math.PI * 2) / 60;
      const hour = (t / 3600) * (Math.PI * 2) / 12;
      this.clockHands.sec.rotation.z = -sec;
      this.clockHands.min.rotation.z = -min;
      this.clockHands.hour.rotation.z = -hour;
    }

    // モニターの微細な明滅(常時ごく弱く・安全)
    const flick = 1 + Math.sin(this.elapsed * 1.7) * 0.035 + Math.sin(this.elapsed * 5.3) * 0.02;
    this.lights.monitorPoint.intensity = damp(this.lights.monitorPoint.intensity, (this.lights.monitorPoint.intensity > 10 ? 14 : this.lights.monitorPoint.intensity) * flick, 2, dt);
    if (this.monitorGlitch > 0 && Math.random() < dt * 1.2) {
      this.updateScreen(this.monitorGlitch, 0);
    }
  }

  /** ポーズ(帰還時の静止)など */
  setClockTime(h: number, m: number): void {
    this.clockTime = h * 3600 + m * 60;
    this.clockFrozen = true;
    if (this.clockHands) {
      const sec = 0;
      const min = (m % 60) * (Math.PI * 2) / 60;
      const hour = ((h % 12) + m / 60) * (Math.PI * 2) / 12;
      this.clockHands.sec.rotation.z = -sec;
      this.clockHands.min.rotation.z = -min;
      this.clockHands.hour.rotation.z = -hour;
    }
  }

  reset(): void {
    this.clockFrozen = false;
    this.clockTime = 2 * 3600 + 17 * 60;
    this.monitorGlitch = 0;
    this.setLighting('normal');
    this.updateScreen(0, 0);
    // 帰還時の浮遊破片を消す
    for (const f of this.floatFragments) {
      this.group.remove(f);
    }
    this.floatFragments = [];
    // 時計を動かす
    if (this.clockHands) {
      this.clockHands.sec.rotation.z = 0;
      this.clockHands.min.rotation.z = 0;
      this.clockHands.hour.rotation.z = 0;
    }
  }

  /** 帰還後に残る小さな異変(浮遊する破片) */
  spawnAnomalies(): void {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x0a1a3e,
        emissive: 0x1c49b8,
        emissiveIntensity: 1.2,
        roughness: 0.35,
        metalness: 0.6,
      }),
    );
    frag.position.set(-1.9, 2.16, -1.85);
    this.group.add(frag);
    this.floatFragments.push(frag);
  }

  updateAnomalies(dt: number): void {
    for (const f of this.floatFragments) {
      f.rotation.x += dt * 0.12;
      f.rotation.y += dt * 0.17;
      f.position.y = 2.16 + Math.sin(this.elapsed * 0.6) * 0.045;
    }
  }
}

export { lerp };
