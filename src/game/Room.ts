import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Assets } from '../core/assets';
import type { AudioEngine } from '../core/audio';
import { CollisionWorld } from '../core/collision';
import { makeMaterial, solid, emissive } from '../core/materials';
import { BSODScreen, makeCanvas, canvasTexture, makeTextTexture, makeErrorOverlayTexture } from '../core/textures';
import { RNG, clamp, lerp, damp } from '../core/util';
import type { Interactable } from './Player';

/* ------------------------------------------------------------------ *
 * 部屋の寸法 (1 unit = 1 m)。ここが唯一の layout 情報。
 * ------------------------------------------------------------------ */
export const ROOM = {
  x0: -2.7, x1: 2.7,
  z0: -2.4, z1: 2.4,
  h: 2.62,
  desk: { cx: 0.55, cz: -2.02, w: 2.35, d: 0.7, top: 0.745 },
  bed: { x0: -2.64, x1: -1.58, z0: -1.02, z1: 1.36, top: 0.52 },
  wardrobe: { x0: 1.22, x1: 2.58, z0: 2.1, z1: 2.39, h: 2.12 },
  door: { x0: -0.95, x1: -0.02, z: 2.38, h: 2.05 },
  window: { z0: -0.35, z1: 0.95, y0: 0.95, y1: 2.2, x: 2.69 },
};

/** モニター画面の中心 (Director の寄り/ポータル位置と共有) */
export const MON = new THREE.Vector3(0.55, 1.16, -2.075);

const TAU = Math.PI * 2;

type Prop = { obj: THREE.Object3D; base: THREE.Vector3; baseRot: THREE.Euler; spin: number; phase: number };

export class Room {
  group = new THREE.Group();
  collision = new CollisionWorld();
  interactables: Interactable[] = [];

  bsod = new BSODScreen(1280, 720);
  screenMesh!: THREE.Mesh;
  screenMat!: THREE.MeshStandardMaterial;
  screenLight!: THREE.PointLight;
  monitorSpot!: THREE.SpotLight;
  windowSpot!: THREE.SpotLight;
  flashlight!: THREE.SpotLight;
  deskLampLight!: THREE.PointLight;

  onPC?: () => void;
  onDoor?: () => void;
  onText?: (text: string, dur?: number) => void;

  private assets: Assets;
  private audio: AudioEngine;
  private scene: THREE.Scene;
  private rng = new RNG(20240607);

  private ceiling!: THREE.Mesh;
  private monitorGroup = new THREE.Group();
  private screenOn = false;
  private deskLampOn = false;
  private anomaly = false;
  private suction = 0;
  private glitch = 0;
  private clockHands: THREE.Object3D[] = [];
  private curtainL!: THREE.Mesh;
  private curtainR!: THREE.Mesh;
  private dust!: THREE.Points;
  private ghostFace!: THREE.Mesh;
  private ghostMat!: THREE.MeshBasicMaterial;
  private errorFrags: THREE.Mesh[] = [];
  private photo!: THREE.Object3D;
  private chair!: THREE.Object3D;
  private doorMesh!: THREE.Mesh;
  private posterB!: THREE.Mesh;
  private mug!: THREE.Object3D;
  private notes: THREE.Mesh[] = [];
  private suck: Prop[] = [];
  private vortex!: THREE.Mesh;
  private vortexMat!: THREE.MeshBasicMaterial;
  private underDoor!: THREE.Mesh;
  private time = 0;
  private lastBsodDraw = 0;
  private bsodStage = 0;
  private bsodProgress = 0;
  private bsodCorrupt = 0;
  private flicker = 0;
  private phone?: THREE.Object3D;
  private monitorTilt = 0;
  private built = false;

  constructor(scene: THREE.Scene, assets: Assets, audio: AudioEngine) {
    this.scene = scene;
    this.assets = assets;
    this.audio = audio;
  }

  /* ================================================================ *
   * 構築
   * ================================================================ */
  async build() {
    const A = this.assets;
    const [floorMat, wallMat, ceilMat, deskMat, plankMat, metalMat, fabricMat] = await Promise.all([
      makeMaterial(A, 'floor_wood', { repeat: [3, 3], roughness: 0.62, metalness: 0.02, normalScale: 0.7 }),
      makeMaterial(A, 'wall_plaster', { repeat: [2, 1.4], roughness: 0.95, metalness: 0.0, color: 0xb9b2a4 }),
      makeMaterial(A, 'ceiling_plaster', { repeat: [2, 2], roughness: 1, metalness: 0, color: 0x8f8c85 }),
      makeMaterial(A, 'desk_wood', { repeat: [2, 1], roughness: 0.5, metalness: 0.04, normalScale: 0.6 }),
      makeMaterial(A, 'wood_planks', { repeat: [2, 1], roughness: 0.8, metalness: 0.02, color: 0x6a5440 }),
      makeMaterial(A, 'metal', { repeat: [1, 1], roughness: 0.35, metalness: 0.92, color: 0x2c3138 }),
      solid(0x2b3340, { roughness: 0.95, metalness: 0.02 }),
    ]);

    const W = ROOM.x1 - ROOM.x0;
    const D = ROOM.z1 - ROOM.z0;
    const cx = (ROOM.x0 + ROOM.x1) / 2;
    const cz = (ROOM.z0 + ROOM.z1) / 2;

    /* ---------- 床 / 壁 / 天井 ---------- */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    this.ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.position.y = ROOM.h;
    this.ceiling.receiveShadow = true;
    this.group.add(this.ceiling);

    const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    wall(W, ROOM.h, cx, ROOM.h / 2, ROOM.z0, 0);            // 奥 (モニター側)
    wall(W, ROOM.h, cx, ROOM.h / 2, ROOM.z1, Math.PI);      // 手前 (ドア側)
    wall(D, ROOM.h, ROOM.x0, ROOM.h / 2, cz, Math.PI / 2);  // 左
    wall(D, ROOM.h, ROOM.x1, ROOM.h / 2, cz, -Math.PI / 2); // 右 (窓)

    // skirting (巾木)
    const skirtMat = solid(0x4a4740, { roughness: 0.7 });
    for (const [w, x, z, ry] of [[W, cx, ROOM.z0 + 0.012, 0], [W, cx, ROOM.z1 - 0.012, Math.PI], [D, ROOM.x0 + 0.012, cz, Math.PI / 2], [D, ROOM.x1 - 0.012, cz, -Math.PI / 2]] as const) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.075, 0.024), skirtMat);
      s.position.set(x, 0.0375, z);
      s.rotation.y = ry;
      s.receiveShadow = true;
      this.group.add(s);
    }

    /* ---------- コリジョン ---------- */
    this.collision.addPlatform(ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z1, 0);
    const t = 0.4;
    this.collision.addBlocker(ROOM.x0 - t, ROOM.x0 + 0.02, ROOM.z0 - t, ROOM.z1 + t, -1, 4);
    this.collision.addBlocker(ROOM.x1 - 0.02, ROOM.x1 + t, ROOM.z0 - t, ROOM.z1 + t, -1, 4);
    this.collision.addBlocker(ROOM.x0 - t, ROOM.x1 + t, ROOM.z0 - t, ROOM.z0 + 0.02, -1, 4);
    this.collision.addBlocker(ROOM.x0 - t, ROOM.x1 + t, ROOM.z1 - 0.02, ROOM.z1 + t, -1, 4);

    /* ---------- 机 ---------- */
    const desk = new THREE.Group();
    const dTop = new THREE.Mesh(new RoundedBoxGeometry(ROOM.desk.w, 0.045, ROOM.desk.d, 2, 0.008), deskMat);
    dTop.position.set(ROOM.desk.cx, ROOM.desk.top - 0.0225, ROOM.desk.cz);
    dTop.castShadow = true; dTop.receiveShadow = true;
    desk.add(dTop);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, ROOM.desk.top, 0.05), metalMat);
      leg.position.set(ROOM.desk.cx + sx * (ROOM.desk.w / 2 - 0.06), ROOM.desk.top / 2, ROOM.desk.cz + ROOM.desk.d / 2 - 0.06);
      leg.castShadow = true;
      desk.add(leg);
      const leg2 = leg.clone();
      leg2.position.z = ROOM.desk.cz - ROOM.desk.d / 2 + 0.06;
      desk.add(leg2);
    }
    // 天板下の配線トレイ
    const tray = new THREE.Mesh(new THREE.BoxGeometry(ROOM.desk.w - 0.3, 0.03, 0.14), metalMat);
    tray.position.set(ROOM.desk.cx, ROOM.desk.top - 0.13, ROOM.desk.cz - 0.1);
    desk.add(tray);
    this.group.add(desk);
    this.collision.addBlocker(ROOM.desk.cx - ROOM.desk.w / 2, ROOM.desk.cx + ROOM.desk.w / 2, ROOM.z0 + 0.02, ROOM.desk.cz + ROOM.desk.d / 2, 0, ROOM.desk.top);

    /* ---------- モニター ---------- */
    this.monitorGroup.position.set(MON.x, 0, 0);
    const bezelMat = solid(0x14171c, { roughness: 0.55, metalness: 0.35 });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.19, 12), bezelMat);
    stand.position.set(0, ROOM.desk.top + 0.095, MON.z);
    stand.castShadow = true;
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.016, 0.17, 2, 0.006), bezelMat);
    foot.position.set(0, ROOM.desk.top + 0.008, MON.z);
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.40, 0.03, 3, 0.008), bezelMat);
    panel.position.set(0, MON.y, MON.z - 0.018);
    panel.castShadow = true;

    this.screenMat = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      roughness: 0.28,
      metalness: 0.0,
      emissive: 0xffffff,
      emissiveMap: this.bsod.texture,
      emissiveIntensity: 0,
      envMapIntensity: 0.4,
    });
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.615, 0.345), this.screenMat);
    this.screenMesh.position.set(0, MON.y, MON.z + 0.0015);
    this.screenMesh.name = 'screen';
    this.monitorGroup.add(stand, foot, panel, this.screenMesh);

    // ベゼルの汚れ (指紋っぽい反射)
    const smudge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.33),
      new THREE.MeshBasicMaterial({
        map: makeErrorOverlayTexture(256, 0.05, new RNG(31)),
        transparent: true, opacity: 0.08, depthWrite: false,
      }),
    );
    smudge.position.set(0, MON.y, MON.z + 0.0035);
    this.monitorGroup.add(smudge);

    // 付箋 (モニター枠)
    const noteCols = [0xffe680, 0xb6f0c8, 0xffc9d4];
    for (let i = 0; i < 3; i++) {
      const n = new THREE.Mesh(
        new THREE.PlaneGeometry(0.045, 0.045),
        new THREE.MeshStandardMaterial({ color: noteCols[i], roughness: 0.9, emissive: noteCols[i], emissiveIntensity: 0.08, side: THREE.DoubleSide }),
      );
      n.position.set(-0.34 + i * 0.052, MON.y - 0.215, MON.z + 0.004);
      n.rotation.z = this.rng.range(-0.12, 0.12);
      this.notes.push(n);
      this.monitorGroup.add(n);
    }
    // 配線 (モニター裏から床へ)
    const cablePts = [
      new THREE.Vector3(0.02, MON.y - 0.2, MON.z - 0.03),
      new THREE.Vector3(0.04, ROOM.desk.top - 0.2, MON.z - 0.12),
      new THREE.Vector3(-0.2, 0.25, ROOM.z0 + 0.12),
      new THREE.Vector3(-0.55, 0.02, ROOM.z0 + 0.15),
    ];
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 24, 0.007, 6, false),
      solid(0x0d0f12, { roughness: 0.85 }),
    );
    cable.castShadow = true;
    this.monitorGroup.add(cable);
    this.group.add(this.monitorGroup);

    /* ---------- 画面の光 ---------- */
    this.screenLight = new THREE.PointLight(0x4b9dff, 0.6, 7.5, 2);
    this.screenLight.position.set(MON.x, MON.y - 0.02, MON.z + 0.18);
    this.group.add(this.screenLight);

    this.monitorSpot = new THREE.SpotLight(0x7bbcff, 6.5, 6.2, Math.PI * 0.44, 0.85, 1.6);
    this.monitorSpot.position.set(MON.x, MON.y + 0.02, MON.z + 0.1);
    this.monitorSpot.target.position.set(MON.x - 1.1, 0.15, MON.z + 2.1);
    this.monitorSpot.castShadow = true;
    this.monitorSpot.shadow.mapSize.set(1024, 1024);
    this.monitorSpot.shadow.bias = -0.0012;
    this.monitorSpot.shadow.camera.near = 0.2;
    this.monitorSpot.shadow.camera.far = 8;
    this.group.add(this.monitorSpot, this.monitorSpot.target);

    /* ---------- 椅子 ---------- */
    const chairModel = await this.assets.instance('chair', { targetHeight: 0.86, rotateY: Math.PI });
    chairModel.position.set(0.5, 0, -1.28);
    chairModel.rotation.y = Math.PI + 0.22;
    this.chair = chairModel;
    this.group.add(chairModel);
    this.collision.addBlocker(0.16, 0.84, -1.62, -0.94, 0, 0.9);

    // 椅子にかけた上着
    const hoodie = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.5, 0.16, 3, 0.05), solid(0x2f3a4a, { roughness: 1 }));
    hoodie.position.set(0.5, 0.86, -1.06);
    hoodie.rotation.set(0.24, 0.1, 0.05);
    hoodie.castShadow = true;
    this.group.add(hoodie);

    /* ---------- ベッド ---------- */
    const bedFrame = solid(0x3b2f26, { roughness: 0.72, metalness: 0.04 });
    const bed = new THREE.Mesh(new RoundedBoxGeometry(ROOM.bed.x1 - ROOM.bed.x0, 0.34, ROOM.bed.z1 - ROOM.bed.z0, 2, 0.02), bedFrame);
    bed.position.set((ROOM.bed.x0 + ROOM.bed.x1) / 2, 0.19, (ROOM.bed.z0 + ROOM.bed.z1) / 2);
    bed.castShadow = true; bed.receiveShadow = true;
    this.group.add(bed);
    const mattress = new THREE.Mesh(
      new RoundedBoxGeometry(ROOM.bed.x1 - ROOM.bed.x0 - 0.06, 0.16, ROOM.bed.z1 - ROOM.bed.z0 - 0.06, 3, 0.05),
      solid(0xcfc6b6, { roughness: 0.95 }),
    );
    mattress.position.set((ROOM.bed.x0 + ROOM.bed.x1) / 2, 0.42, (ROOM.bed.z0 + ROOM.bed.z1) / 2);
    mattress.castShadow = true; mattress.receiveShadow = true;
    this.group.add(mattress);
    const duvet = new THREE.Mesh(
      new RoundedBoxGeometry(ROOM.bed.x1 - ROOM.bed.x0 - 0.04, 0.13, 1.5, 3, 0.06),
      solid(0x445a70, { roughness: 1 }),
    );
    duvet.position.set((ROOM.bed.x0 + ROOM.bed.x1) / 2 + 0.01, 0.5, ROOM.bed.z0 + 1.02);
    duvet.rotation.y = 0.05;
    duvet.castShadow = true;
    this.group.add(duvet);
    const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.14, 0.34, 3, 0.06), solid(0xd8d2c4, { roughness: 1 }));
    pillow.position.set((ROOM.bed.x0 + ROOM.bed.x1) / 2, 0.56, ROOM.bed.z0 + 0.3);
    pillow.rotation.y = -0.08;
    pillow.castShadow = true;
    this.group.add(pillow);
    this.collision.addBlocker(ROOM.bed.x0, ROOM.bed.x1, ROOM.bed.z0, ROOM.bed.z1, 0, 0.6);

    // ベッド脇のサイドテーブル
    const nightstand = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.46, 0.36, 2, 0.01), plankMat);
    nightstand.position.set(-1.35, 0.23, -1.5);
    nightstand.castShadow = true; nightstand.receiveShadow = true;
    this.group.add(nightstand);
    this.collision.addBlocker(-1.55, -1.15, -1.68, -1.32, 0, 0.5);

    // 目覚まし時計 (サイドテーブル) — 赤い数字
    const clockCanvas = makeCanvas(256, 128);
    const cc = clockCanvas.ctx;
    cc.fillStyle = '#060708'; cc.fillRect(0, 0, 256, 128);
    cc.fillStyle = '#ff2a1e'; cc.font = '700 74px ui-monospace, monospace'; cc.textAlign = 'center';
    cc.shadowColor = '#ff2a1e'; cc.shadowBlur = 22;
    cc.fillText('3:07', 128, 92);
    const redClockMat = new THREE.MeshStandardMaterial({
      map: canvasTexture(clockCanvas.c, true), emissive: 0xff2a1e, emissiveIntensity: 0.6,
      emissiveMap: canvasTexture(clockCanvas.c, true), roughness: 0.6,
    });
    const redClock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.07), redClockMat);
    redClock.position.set(-1.35, 0.51, -1.48);
    redClock.rotation.y = 0.5;
    this.group.add(redClock);

    /* ---------- 窓 ---------- */
    const winZ = (ROOM.window.z0 + ROOM.window.z1) / 2;
    const winH = ROOM.window.y1 - ROOM.window.y0;
    const frameMat = solid(0xd8d4c8, { roughness: 0.8 });
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.window.z1 - ROOM.window.z0, winH),
      new THREE.MeshPhysicalMaterial({ color: 0x0a1420, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.22, envMapIntensity: 1.2 }),
    );
    glass.position.set(ROOM.x1 - 0.012, (ROOM.window.y0 + ROOM.window.y1) / 2, winZ);
    glass.rotation.y = -Math.PI / 2;
    this.group.add(glass);

    for (const [w, h, y, z] of [
      [0.06, winH, (ROOM.window.y0 + ROOM.window.y1) / 2, ROOM.window.z0],
      [0.06, winH, (ROOM.window.y0 + ROOM.window.y1) / 2, ROOM.window.z1],
      [ROOM.window.z1 - ROOM.window.z0, 0.06, ROOM.window.y0, winZ],
      [ROOM.window.z1 - ROOM.window.z0, 0.06, ROOM.window.y1, winZ],
      [0.05, winH, (ROOM.window.y0 + ROOM.window.y1) / 2, winZ],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, w), frameMat);
      bar.position.set(ROOM.x1 - 0.03, y, z);
      bar.castShadow = true;
      this.group.add(bar);
    }
    // 窓台
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, ROOM.window.z1 - ROOM.window.z0 + 0.16), frameMat);
    sill.position.set(ROOM.x1 - 0.1, ROOM.window.y0 - 0.02, winZ);
    sill.castShadow = true;
    this.group.add(sill);

    // カーテン
    const curtainMat = solid(0x323a48, { roughness: 1, metalness: 0 });
    this.curtainL = new THREE.Mesh(new THREE.PlaneGeometry(0.62, winH + 0.3, 8, 1), curtainMat);
    this.curtainL.position.set(ROOM.x1 - 0.075, (ROOM.window.y0 + ROOM.window.y1) / 2 + 0.12, ROOM.window.z0 - 0.18);
    this.curtainL.rotation.y = -Math.PI / 2;
    this.curtainL.castShadow = true;
    this.curtainR = new THREE.Mesh(new THREE.PlaneGeometry(0.55, winH + 0.3, 8, 1), curtainMat);
    this.curtainR.position.set(ROOM.x1 - 0.075, (ROOM.window.y0 + ROOM.window.y1) / 2 + 0.12, ROOM.window.z1 + 0.14);
    this.curtainR.rotation.y = -Math.PI / 2;
    this.curtainR.castShadow = true;
    this.group.add(this.curtainL, this.curtainR);

    // 窓の外の街 (発光する板)
    const cityFallback = this.makeCityTexture();
    const city = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 12),
      new THREE.MeshBasicMaterial({ map: cityFallback, toneMapped: true }),
    );
    city.position.set(ROOM.x1 + 7.5, 3.2, winZ);
    city.rotation.y = -Math.PI / 2;
    this.group.add(city);
    // 外の街灯の光
    this.windowSpot = new THREE.SpotLight(0x6f8fbf, 2.6, 9, Math.PI * 0.34, 0.9, 1.6);
    this.windowSpot.position.set(ROOM.x1 - 0.1, ROOM.window.y1, winZ);
    this.windowSpot.target.position.set(-0.4, 0.2, winZ - 0.6);
    this.windowSpot.castShadow = true;
    this.windowSpot.shadow.mapSize.set(1024, 1024);
    this.windowSpot.shadow.bias = -0.0015;
    this.group.add(this.windowSpot, this.windowSpot.target);

    /* ---------- クローゼット / ドア ---------- */
    const wardrobe = new THREE.Mesh(
      new RoundedBoxGeometry(ROOM.wardrobe.x1 - ROOM.wardrobe.x0, ROOM.wardrobe.h, ROOM.wardrobe.z1 - ROOM.wardrobe.z0, 2, 0.012),
      plankMat,
    );
    wardrobe.position.set((ROOM.wardrobe.x0 + ROOM.wardrobe.x1) / 2, ROOM.wardrobe.h / 2, (ROOM.wardrobe.z0 + ROOM.wardrobe.z1) / 2);
    wardrobe.castShadow = true; wardrobe.receiveShadow = true;
    this.group.add(wardrobe);
    this.collision.addBlocker(ROOM.wardrobe.x0, ROOM.wardrobe.x1, ROOM.wardrobe.z0, ROOM.wardrobe.z1, 0, ROOM.wardrobe.h);
    for (const x of [ROOM.wardrobe.x0 + 0.2, (ROOM.wardrobe.x0 + ROOM.wardrobe.x1) / 2]) {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), metalMat);
      handle.position.set(x + 0.18, 1.05, ROOM.wardrobe.z0 - 0.012);
      handle.rotation.z = Math.PI / 2;
      this.group.add(handle);
    }

    const doorW = ROOM.door.x1 - ROOM.door.x0;
    const doorCx = (ROOM.door.x0 + ROOM.door.x1) / 2;
    const doorMat = solid(0x6b5a48, { roughness: 0.8, metalness: 0.02 });
    this.doorMesh = new THREE.Mesh(new RoundedBoxGeometry(doorW, ROOM.door.h, 0.055, 2, 0.006), doorMat);
    this.doorMesh.position.set(doorCx, ROOM.door.h / 2, ROOM.door.z - 0.06);
    this.doorMesh.castShadow = true;
    this.group.add(this.doorMesh);
    const doorHandle = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), metalMat);
    doorHandle.position.set(ROOM.door.x1 - 0.12, 1.02, ROOM.door.z - 0.1);
    this.group.add(doorHandle);
    // ドア下の隙間から漏れる光 (帰還後に灯す)
    this.underDoor = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW - 0.06, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x8fc4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.underDoor.position.set(doorCx, 0.012, ROOM.door.z - 0.09);
    this.underDoor.rotation.x = -Math.PI / 2;
    this.group.add(this.underDoor);

    /* ---------- 机の上 ---------- */
    const kbMat = solid(0x191b1f, { roughness: 0.7, metalness: 0.1 });
    const kb = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.022, 0.15, 2, 0.004), kbMat);
    kb.position.set(0.42, ROOM.desk.top + 0.011, -1.84);
    kb.rotation.y = 0.04;
    kb.castShadow = true;
    this.group.add(kb);
    // キーキャップ (instancing)
    const keyGeo = new THREE.BoxGeometry(0.026, 0.008, 0.026);
    const keyMat = solid(0x23262b, { roughness: 0.9 });
    const keys = new THREE.InstancedMesh(keyGeo, keyMat, 15 * 4);
    const m4 = new THREE.Matrix4();
    let ki = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 15; c++) {
        m4.makeTranslation(0.42 - 0.205 + c * 0.0295, ROOM.desk.top + 0.024, -1.905 + r * 0.032);
        keys.setMatrixAt(ki++, m4);
      }
    }
    keys.castShadow = true;
    this.group.add(keys);

    const mouse = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.028, 0.1, 3, 0.014), solid(0x1c1e22, { roughness: 0.55, metalness: 0.2 }));
    mouse.position.set(0.78, ROOM.desk.top + 0.014, -1.82);
    mouse.castShadow = true;
    this.group.add(mouse);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.24), solid(0x14171c, { roughness: 1 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0.78, ROOM.desk.top + 0.001, -1.83);
    this.group.add(pad);

    // スピーカー
    for (const sx of [-0.02, 1.06]) {
      const sp = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.2, 0.14, 2, 0.01), solid(0x141619, { roughness: 0.8 }));
      sp.position.set(sx, ROOM.desk.top + 0.1, -2.16);
      sp.castShadow = true;
      this.group.add(sp);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), solid(0x2a2d33, { roughness: 1 }));
      cone.position.set(sx, ROOM.desk.top + 0.08, -2.088);
      this.group.add(cone);
    }

    // マグカップ (円柱 + 取っ手)
    this.mug = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.095, 16, 1, true), solid(0xd9d2c4, { roughness: 0.5, side: THREE.DoubleSide }));
    cup.position.y = 0.047;
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.038, 16), solid(0x241811, { roughness: 0.35 }));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.082;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, 8, 12, Math.PI * 1.3), solid(0xd9d2c4, { roughness: 0.5 }));
    handle.position.set(0.045, 0.05, 0);
    handle.rotation.z = Math.PI * 0.35;
    (this.mug as THREE.Group).add(cup, coffee, handle);
    (this.mug as THREE.Group).position.set(1.05, ROOM.desk.top, -1.98);
    (this.mug as THREE.Group).rotation.y = 0.4;
    this.group.add(this.mug);

    // ノート + ペン
    const noteBook = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.012, 0.29), solid(0xe8e2d2, { roughness: 0.95 }));
    noteBook.position.set(-0.2, ROOM.desk.top + 0.006, -1.9);
    noteBook.rotation.y = -0.12;
    noteBook.castShadow = true;
    this.group.add(noteBook);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0035, 0.14, 8), solid(0x111318, { roughness: 0.4, metalness: 0.4 }));
    pen.rotation.set(Math.PI / 2, 0, 0.9);
    pen.position.set(-0.12, ROOM.desk.top + 0.014, -1.82);
    this.group.add(pen);

    // 水筒 (水筒モデル)
    const bottle = await this.assets.instance('bottle', { targetHeight: 0.24 });
    bottle.position.set(1.28, ROOM.desk.top, -2.1);
    this.group.add(bottle);

    // 机の上の小物: おもちゃの車
    const toy = await this.assets.instance('toycar', { targetHeight: 0.055, rotateY: 0.6 });
    toy.position.set(1.4, ROOM.desk.top + 0.002, -1.86);
    this.group.add(toy);

    // ヘッドホン (机の端)
    const hp = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 8, 24, Math.PI), solid(0x181a1e, { roughness: 0.6 }));
    band.rotation.x = Math.PI / 2;
    band.rotation.z = Math.PI;
    const cupGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.026, 16);
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(cupGeo, solid(0x181a1e, { roughness: 0.55, metalness: 0.15 }));
      c.position.set(s * 0.085, -0.02, 0);
      c.rotation.z = Math.PI / 2;
      hp.add(c);
    }
    hp.add(band);
    hp.position.set(-0.4, ROOM.desk.top + 0.03, -1.98);
    hp.rotation.y = 0.5;
    this.group.add(hp);

    /* ---------- 壁の棚 + 本 ---------- */
    const shelf = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.035, 0.22, 2, 0.005), plankMat);
    shelf.position.set(-1.55, 1.62, ROOM.z0 + 0.13);
    shelf.castShadow = true; shelf.receiveShadow = true;
    this.group.add(shelf);
    for (const bx of [-2.2, -0.92]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.2), metalMat);
      bracket.position.set(bx, 1.53, ROOM.z0 + 0.13);
      this.group.add(bracket);
    }
    const bookCols = [0x7a3b34, 0x2f4a63, 0x8a7a4f, 0x354a3a, 0x5a4a6a, 0x9a6a45];
    for (let i = 0; i < 9; i++) {
      const h = this.rng.range(0.16, 0.25);
      const w = this.rng.range(0.022, 0.045);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, this.rng.range(0.14, 0.19)), solid(bookCols[i % bookCols.length], { roughness: 0.85 }));
      b.position.set(-2.2 + i * 0.055, 1.64 + h / 2, ROOM.z0 + 0.14);
      b.rotation.z = i === 8 ? -0.28 : 0;
      b.castShadow = true;
      this.group.add(b);
    }
    // 花瓶 (棚の上)
    const vase = await this.assets.instance('vase', { targetHeight: 0.22 });
    vase.position.set(-1.1, 1.64, ROOM.z0 + 0.15);
    this.group.add(vase);
    // 炭鉢 (青く光る残り火)
    const coals = await this.assets.instance('coals', { targetHeight: 0.12 });
    coals.position.set(-0.75, 1.64, ROOM.z0 + 0.15);
    this.group.add(coals);

    /* ---------- 観葉植物 / フロアランプ ---------- */
    const plant = await this.assets.instance('plant', { targetHeight: 0.95 });
    plant.position.set(2.25, 0, -1.45);
    this.group.add(plant);
    this.collision.addBlocker(2.05, 2.45, -1.65, -1.25, 0, 0.9);

    const lamp = await this.assets.instance('lantern', { targetHeight: 1.25, rotateY: 0.4 });
    lamp.position.set(-2.28, 0, 1.92);
    this.group.add(lamp);
    this.collision.addBlocker(-2.5, -2.06, 1.7, 2.14, 0, 1.2);
    this.deskLampLight = new THREE.PointLight(0xffb46a, 0, 4.5, 2);
    this.deskLampLight.position.set(-2.28, 1.1, 1.92);
    this.group.add(this.deskLampLight);

    /* ---------- ポスター / 写真 / 時計 ---------- */
    const posterA = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.86),
      new THREE.MeshStandardMaterial({ map: this.makePosterTexture(0), roughness: 0.85 }),
    );
    posterA.position.set(ROOM.x0 + 0.014, 1.78, 0.55);
    posterA.rotation.y = Math.PI / 2;
    posterA.rotation.z = 0.015;
    this.group.add(posterA);

    this.posterB = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.7),
      new THREE.MeshStandardMaterial({ map: this.makePosterTexture(1), roughness: 0.85 }),
    );
    this.posterB.position.set(-1.9, 1.76, ROOM.z0 + 0.014);
    this.posterB.rotation.z = -0.02;
    this.group.add(this.posterB);

    this.photo = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.014), solid(0x1b1a19, { roughness: 0.6 }));
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.11), new THREE.MeshStandardMaterial({ map: this.makePhotoTexture(), roughness: 0.6, emissive: 0x223344, emissiveIntensity: 0.15 }));
    photo.position.z = 0.008;
    (this.photo as THREE.Group).add(frame, photo);
    (this.photo as THREE.Group).position.set(1.62, ROOM.desk.top + 0.1, -2.28);
    (this.photo as THREE.Group).rotation.set(-0.08, 0.35, 0.02);
    this.group.add(this.photo);

    // 壁時計
    const clockGroup = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), new THREE.MeshStandardMaterial({ map: this.makeClockFace(), roughness: 0.7 }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.132, 0.012, 8, 32), solid(0x1d1c1b, { roughness: 0.6 }));
    clockGroup.add(face, rim);
    const handMat = solid(0x101010, { roughness: 0.6 });
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.004), handMat);
    hourHand.geometry.translate(0, 0.03, 0);
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.088, 0.004), handMat);
    minHand.geometry.translate(0, 0.044, 0);
    const secHand = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.1, 0.003), solid(0xb03a2e, { roughness: 0.5 }));
    secHand.geometry.translate(0, 0.05, 0);
    hourHand.position.z = 0.006; minHand.position.z = 0.008; secHand.position.z = 0.01;
    clockGroup.add(hourHand, minHand, secHand);
    clockGroup.position.set(-1.0, 2.06, ROOM.z0 + 0.02);
    this.group.add(clockGroup);
    this.clockHands = [hourHand, minHand, secHand];

    /* ---------- ラグ / ゴミ箱 / 散らかったもの ---------- */
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.7), solid(0x2f3a44, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.1, 0.004, 0.5);
    rug.receiveShadow = true;
    this.group.add(rug);
    const rugTrim = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.0, 4), solid(0x000000));
    rugTrim.visible = false;
    this.group.add(rugTrim);

    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.34, 16, 1, true), solid(0x3b4048, { roughness: 0.8, side: THREE.DoubleSide }));
    bin.position.set(-0.55, 0.17, -1.62);
    bin.castShadow = true;
    this.group.add(bin);
    for (let i = 0; i < 4; i++) {
      const paper = new THREE.Mesh(new THREE.IcosahedronGeometry(this.rng.range(0.035, 0.055), 0), solid(0xd8d2c2, { roughness: 1, flatShading: true }));
      paper.position.set(-0.55 + this.rng.range(-0.06, 0.06), 0.33 + this.rng.range(0, 0.05), -1.62 + this.rng.range(-0.06, 0.06));
      paper.rotation.set(this.rng.range(0, 3), this.rng.range(0, 3), 0);
      paper.castShadow = true;
      this.group.add(paper);
    }
    // 床に落ちた服
    const shirt = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.06, 0.42, 2, 0.03), solid(0x574034, { roughness: 1 }));
    shirt.position.set(-0.95, 0.035, 1.75);
    shirt.rotation.y = 0.5;
    shirt.castShadow = true;
    this.group.add(shirt);
    const socks = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.1, 4, 8), solid(0x545a63, { roughness: 1 }));
    socks.position.set(-0.72, 0.03, 1.9);
    socks.rotation.z = Math.PI / 2;
    socks.castShadow = true;
    this.group.add(socks);

    // ダンボール + 教科書の山
    const boxMat = solid(0x8a6f4e, { roughness: 0.95 });
    const carton = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.36, 0.4, 2, 0.01), boxMat);
    carton.position.set(2.3, 0.18, 1.86);
    carton.rotation.y = -0.2;
    carton.castShadow = true; carton.receiveShadow = true;
    this.group.add(carton);
    this.collision.addBlocker(2.05, 2.55, 1.64, 2.1, 0, 0.4);
    for (let i = 0; i < 4; i++) {
      const bk = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.17), solid(bookCols[(i + 2) % bookCols.length], { roughness: 0.9 }));
      bk.position.set(0.05 + this.rng.range(-0.02, 0.02), 0.018 + i * 0.036, 1.98);
      bk.rotation.y = this.rng.range(-0.2, 0.2);
      bk.castShadow = true;
      this.group.add(bk);
    }

    // スマホ (机の端)
    const phone = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.008, 0.15, 2, 0.006), solid(0x0a0b0d, { roughness: 0.35, metalness: 0.5 }));
    phone.position.set(0.02, ROOM.desk.top + 0.008, -1.78);
    phone.rotation.y = -0.35;
    this.group.add(phone);
    const phoneScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.066, 0.135),
      new THREE.MeshStandardMaterial({ color: 0x0b1420, emissive: 0x1b3550, emissiveIntensity: 0.4, roughness: 0.3 }),
    );
    phoneScreen.rotation.x = -Math.PI / 2;
    phoneScreen.position.set(0.02, ROOM.desk.top + 0.0125, -1.78);
    phoneScreen.rotation.z = -0.35;
    this.group.add(phoneScreen);
    this.phone = phone;

    /* ---------- 照明 ---------- */
    const hemi = new THREE.HemisphereLight(0x243247, 0x05070a, 0.32);
    this.group.add(hemi);
    // 天井の電球 (消えている)
    const bulbFixture = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 16), solid(0x2a2b2e, { roughness: 0.8 }));
    bulbFixture.position.set(cx, ROOM.h - 0.03, cz + 0.2);
    this.group.add(bulbFixture);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshStandardMaterial({ color: 0x1a1c20, emissive: 0x000000, emissiveIntensity: 0 }));
    bulb.position.set(cx, ROOM.h - 0.08, cz + 0.2);
    this.group.add(bulb);

    /* ---------- 演出用オブジェクト ---------- */
    // 帰還後に見える、画面の中の顔の残像
    this.ghostMat = new THREE.MeshBasicMaterial({
      map: makeTextTexture(':(', { width: 512, height: 256, font: 'bold 190px system-ui, sans-serif', color: '#eaf6ff', glow: 18 }),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.ghostFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), this.ghostMat);
    this.ghostFace.position.set(0, MON.y, MON.z + 0.004);
    this.monitorGroup.add(this.ghostFace);

    // グリッチ時に画面から漏れ出る断片
    for (let i = 0; i < 14; i++) {
      const tex = makeErrorOverlayTexture(128, 0.25, new RNG(100 + i));
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(this.rng.range(0.05, 0.24), this.rng.range(0.02, 0.07)),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      f.position.set(MON.x + this.rng.range(-0.5, 0.5), MON.y + this.rng.range(-0.3, 0.3), MON.z + this.rng.range(0.02, 0.6));
      f.rotation.z = this.rng.range(-0.4, 0.4);
      this.errorFrags.push(f);
      this.group.add(f);
    }

    // 吸引の渦
    this.vortexMat = new THREE.MeshBasicMaterial({
      map: this.makeVortexTexture(), transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.vortex = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.75), this.vortexMat);
    this.vortex.position.set(MON.x, MON.y, MON.z + 0.05);
    this.group.add(this.vortex);

    // 吸い込まれる小物の登録
    const register = (obj: THREE.Object3D, spin: number) => {
      this.suck.push({ obj, base: obj.position.clone(), baseRot: obj.rotation.clone(), spin, phase: this.rng.range(0, TAU) });
    };
    register(this.mug!, 3.2);
    register(bottle, 2.4);
    register(toy, 4.1);
    register(hp, 3.5);
    register(noteBook, 2.9);
    register(pen, 3.8);
    register(this.notes[0], 2.1);
    register(this.notes[1], 2.7);
    register(this.photo, 1.8);

    // 空中の塵
    const n = 420;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.rng.range(ROOM.x0 + 0.1, ROOM.x1 - 0.1);
      pos[i * 3 + 1] = this.rng.range(0.1, ROOM.h - 0.1);
      pos[i * 3 + 2] = this.rng.range(ROOM.z0 + 0.1, ROOM.z1 - 0.1);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0x9fc2e8, size: 0.006, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.group.add(this.dust);

    /* ---------- インタラクト ---------- */
    const say = (txt: string, dur = 6500) => this.onText?.(txt, dur);
    const add = (it: Interactable) => this.interactables.push(it);

    add({
      id: 'pc',
      point: new THREE.Vector3(MON.x, MON.y, MON.z + 0.1),
      radius: 2.6,
      label: () => (this.anomaly ? 'モニターに触れる' : 'PC を調べる'),
      onUse: () => this.onPC?.(),
      maxAngle: Math.PI * 0.55,
    });
    add({
      id: 'note',
      point: new THREE.Vector3(-0.2, ROOM.desk.top + 0.03, -1.9),
      radius: 2.0,
      label: 'ノートを読む',
      onUse: () => say(this.anomaly
        ? '同じ文字が、何度も上から書かれている。\n「戻ってこないで」\n「戻ってこないで」\n「戻ってこないで」'
        : '走り書き。\n「03:07 — 画面の中に、こっちを見ているものがある」\n「:( をクリックしたら、たぶん終わる」'),
      maxAngle: Math.PI * 0.5,
    });
    add({
      id: 'mug',
      point: new THREE.Vector3(1.05, ROOM.desk.top + 0.08, -1.98),
      radius: 1.8,
      label: 'マグカップ',
      onUse: () => say(this.anomaly ? '中身は、まだ温かい。' : '冷めきったコーヒー。\n飲もうとは思えない。'),
      maxAngle: Math.PI * 0.45,
    });
    add({
      id: 'window',
      point: new THREE.Vector3(ROOM.x1 - 0.1, 1.5, 0.3),
      radius: 2.4,
      label: '窓の外を見る',
      onUse: () => say('向かいのビルの窓が、ひとつだけ点いている。\nカーテンの隙間から、誰かがこちらを見ている気がする。'),
      maxAngle: Math.PI * 0.5,
    });
    add({
      id: 'poster',
      point: new THREE.Vector3(-1.9, 1.76, ROOM.z0 + 0.05),
      radius: 2.0,
      label: 'ポスターを見る',
      onUse: () => say('古いゲームのポスター。\nどの作品か思い出せない。'),
      maxAngle: Math.PI * 0.5,
    });
    add({
      id: 'photo',
      point: new THREE.Vector3(1.62, ROOM.desk.top + 0.12, -2.26),
      radius: 1.9,
      label: '写真立てを見る',
      onUse: () => say(this.anomaly
        ? '写真の顔が、こちらを向いている。\n元の写真は、こんな構図じゃなかった。'
        : '家族写真。\n中央の人物の顔だけ、露光が飛んでいる。'),
      maxAngle: Math.PI * 0.45,
    });
    add({
      id: 'door',
      point: new THREE.Vector3(-0.5, 1.1, ROOM.z1 - 0.1),
      radius: 1.9,
      label: 'ドアを開ける',
      onUse: () => {
        this.onDoor?.();
        say(this.anomaly ? 'ノブは回る。\nでも、廊下はない。' : 'ノブは回るが、開かない。\n外から何かが押さえている。');
      },
      maxAngle: Math.PI * 0.45,
    });
    add({
      id: 'clock',
      point: new THREE.Vector3(-1.0, 2.02, ROOM.z0 + 0.1),
      radius: 2.1,
      label: '時計を見る',
      onUse: () => say(this.anomaly ? '針がすべて 3:07 を指している。\n秒針だけ、少しずつ逆に動く。' : '3:07。\n秒針の音が妙に大きい。'),
      maxAngle: Math.PI * 0.4,
    });
    add({
      id: 'lamp',
      point: new THREE.Vector3(-2.28, 1.0, 1.92),
      radius: 1.7,
      label: () => (this.deskLampOn ? 'ランプを消す' : 'ランプを点ける'),
      onUse: () => {
        this.deskLampOn = !this.deskLampOn;
        this.audio.uiTick(0.35);
        this.deskLampLight.intensity = this.deskLampOn ? 1.6 : 0;
        say(this.deskLampOn ? '暖かい光が、床に丸を作った。' : 'また、モニターの青だけになった。', 2500);
      },
      maxAngle: Math.PI * 0.4,
    });
    add({
      id: 'books',
      point: new THREE.Vector3(-1.55, 1.7, ROOM.z0 + 0.12),
      radius: 2.0,
      label: '本棚を眺める',
      onUse: () => say('背表紙の文字が、半分ほど読めない。\n「MEMORY」「MEMORY」「MEMORY」…'),
      maxAngle: Math.PI * 0.45,
    });

    this.screenOff();
    this.built = true;
  }

  /* ================================================================ *
   * 手続きテクスチャ
   * ================================================================ */
  private makeCityTexture() {
    const { c, ctx } = makeCanvas(1024, 512);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#050a12');
    g.addColorStop(0.55, '#0a1524');
    g.addColorStop(1, '#060a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    const rng = new RNG(88);
    for (let layer = 0; layer < 3; layer++) {
      const base = 250 + layer * 80;
      let x = -20;
      while (x < 1024) {
        const w = rng.range(40, 110);
        const h = rng.range(60, 190) * (1 - layer * 0.22);
        ctx.fillStyle = `rgba(${8 + layer * 6},${12 + layer * 8},${20 + layer * 12},1)`;
        ctx.fillRect(x, base - h, w, h + 200);
        // 窓明かり
        for (let wy = base - h + 8; wy < base + 100; wy += 12) {
          for (let wx = x + 6; wx < x + w - 6; wx += 10) {
            if (rng.next() > 0.86) {
              ctx.fillStyle = rng.next() > 0.7 ? 'rgba(255,208,140,0.75)' : 'rgba(150,200,255,0.55)';
              ctx.fillRect(wx, wy, 3, 4);
            }
          }
        }
        x += w + rng.range(4, 18);
      }
    }
    // ぼんやりした街灯
    for (let i = 0; i < 12; i++) {
      const x = rng.range(0, 1024), y = rng.range(180, 340);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 46);
      rg.addColorStop(0, 'rgba(255,190,120,0.22)');
      rg.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - 46, y - 46, 92, 92);
    }
    return canvasTexture(c, true);
  }

  private makePosterTexture(kind: number) {
    const { c, ctx } = makeCanvas(512, 720);
    if (kind === 0) {
      const g = ctx.createLinearGradient(0, 0, 512, 720);
      g.addColorStop(0, '#101a2c');
      g.addColorStop(1, '#1d3149');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 720);
      ctx.strokeStyle = 'rgba(160,200,255,0.75)';
      ctx.lineWidth = 6;
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(256, 300, 40 + i * 26, 0, Math.PI * 2);
        ctx.globalAlpha = 0.10 + i * 0.05;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#dce9ff';
      ctx.font = '700 74px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO SIGNAL', 256, 330);
      ctx.font = '400 26px ui-monospace, monospace';
      ctx.fillText('A FILM ABOUT WAITING', 256, 372);
      ctx.strokeStyle = 'rgba(220,233,255,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(30, 30, 452, 660);
    } else {
      ctx.fillStyle = '#e8e2d4'; ctx.fillRect(0, 0, 512, 720);
      ctx.fillStyle = '#12161c';
      ctx.font = '700 96px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('STILL', 256, 250);
      ctx.fillText('HERE', 256, 350);
      ctx.font = '400 24px ui-monospace, monospace';
      ctx.fillStyle = '#3b4653';
      ctx.fillText('MEMORY INTERFACE / 03:07', 256, 420);
      ctx.strokeStyle = '#12161c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(256, 560, 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(256, 560, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      for (let i = 0; i < 700; i++) ctx.fillRect(this.rng.range(0, 512), this.rng.range(0, 720), 2, 2);
    }
    return canvasTexture(c, true);
  }

  private makePhotoTexture() {
    const { c, ctx } = makeCanvas(256, 180);
    const g = ctx.createLinearGradient(0, 0, 0, 180);
    g.addColorStop(0, '#6d6a5e'); g.addColorStop(1, '#2b2b28');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 180);
    ctx.fillStyle = '#1a1a18';
    for (let i = 0; i < 3; i++) {
      const x = 60 + i * 66;
      ctx.beginPath();
      ctx.arc(x, 92, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 22, 112, 44, 60);
    }
    const rg = ctx.createRadialGradient(140, 92, 4, 140, 92, 40);
    rg.addColorStop(0, 'rgba(255,255,255,0.85)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(90, 40, 110, 110);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 500; i++) ctx.fillRect(this.rng.range(0, 256), this.rng.range(0, 180), 1.5, 1.5);
    return canvasTexture(c, true);
  }

  private makeClockFace() {
    const { c, ctx } = makeCanvas(256, 256);
    ctx.fillStyle = '#e6dfd0';
    ctx.beginPath(); ctx.arc(128, 128, 126, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#22242a';
    ctx.lineWidth = 3;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const r0 = i % 5 === 0 ? 96 : 110;
      ctx.beginPath();
      ctx.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
      ctx.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a2c31';
    ctx.font = '600 26px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [n, a] of [[12, -Math.PI / 2], [3, 0], [6, Math.PI / 2], [9, Math.PI]] as const) {
      ctx.fillText(String(n), 128 + Math.cos(a) * 80, 128 + Math.sin(a) * 80);
    }
    return canvasTexture(c, true);
  }

  private makeVortexTexture() {
    const { c, ctx } = makeCanvas(512, 512);
    const g = ctx.createRadialGradient(256, 256, 10, 256, 256, 250);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.25, 'rgba(140,200,255,0.55)');
    g.addColorStop(0.7, 'rgba(40,110,200,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(220,240,255,0.5)';
    for (let i = 0; i < 26; i++) {
      const r = 30 + i * 8;
      ctx.lineWidth = 2 + (i % 3);
      ctx.beginPath();
      ctx.arc(256, 256, r, i * 0.4, i * 0.4 + 1.6);
      ctx.stroke();
    }
    return canvasTexture(c, true);
  }

  /* ================================================================ *
   * 状態制御 (Director から呼ばれる)
   * ================================================================ */
  showBSOD(stage = 0, progress = 0, corruption = 0, faceScale = 1) {
    this.bsodStage = stage;
    this.bsodProgress = progress;
    this.bsodCorrupt = corruption;
    this.screenOn = true;
    this.lastBsodDraw = 0;
    this.bsod.draw({ stage, progress, corruption, faceScale, seed: 300 + stage, time: performance.now() / 1000 });
    this.screenMat.emissiveIntensity = 1.35;
    this.screenMat.color.setHex(0x0a1522);
    this.screenLight.intensity = Math.max(this.screenLight.intensity, 3.0);
  }

  screenOff() {
    this.screenOn = false;
    this.screenMat.emissiveIntensity = 0;
    this.screenMat.color.setHex(0x05070a);
    if (this.screenLight) this.screenLight.intensity = 0.55;
    if (this.monitorSpot) this.monitorSpot.intensity = 1.1;
  }

  setGlitch(v: number) {
    this.glitch = clamp(v, 0, 1);
  }

  setAnomaly(on: boolean) {
    this.anomaly = on;
    if (!on) {
      this.photo.rotation.set(-0.08, 0.35, 0.02);
      this.chair.rotation.y = Math.PI + 0.22;
      this.posterB.rotation.z = -0.02;
      this.underDoor && ((this.underDoor.material as THREE.MeshBasicMaterial).opacity = 0);
      this.ghostMat.opacity = 0;
      return;
    }
    // 小さな違和感
    this.chair.rotation.y = Math.PI + 0.9;
    this.photo.rotation.set(1.35, 0.35, 0.02);
    this.posterB.rotation.z = 0.09;
    (this.underDoor.material as THREE.MeshBasicMaterial).opacity = 0.5;
    this.screenOn = false;
    this.screenMat.emissiveIntensity = 0;
  }

  setCeilingVisible(v: boolean) { this.ceiling.visible = v; }

  /** 1.0 で机の上がモニターへ吸い込まれる */
  setSuction(v: number) {
    this.suction = clamp(v, 0, 1);
    if (this.suction <= 0.001) {
      for (const p of this.suck) {
        p.obj.position.copy(p.base);
        p.obj.rotation.copy(p.baseRot);
      }
    }
  }

  reset() {
    this.setGlitch(0);
    this.setAnomaly(false);
    this.setSuction(0);
    this.setCeilingVisible(true);
    this.deskLampOn = false;
    if (this.deskLampLight) this.deskLampLight.intensity = 0;
    this.screenOff();
    this.bsodStage = 0; this.bsodProgress = 0; this.bsodCorrupt = 0;
    this.bsod.draw({ stage: 0, progress: 0, corruption: 0, faceScale: 1, seed: 1, time: 0 });
    for (const h of this.clockHands) h.rotation.z = 0;
    if (this.flashlight) this.flashlight.intensity = 0;
    this.screenMat.emissiveIntensity = 0;
    this.vortexMat.opacity = 0;
    for (const f of this.errorFrags) (f.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  setFlashlight(on: boolean) {
    if (!this.flashlight) return;
    this.flashlight.intensity = on ? 7 : 0;
    this.flashlight.visible = on;
  }

  /* ================================================================ *
   * 毎フレーム
   * ================================================================ */
  update(dt: number, t: number, camera: THREE.Camera, torch = false, titleIdle = false) {
    if (!this.built) return;
    this.time = t;

    // 時計
    if (this.clockHands.length) {
      const now = new Date();
      const sec = this.anomaly ? (3 * 60 + 7) + Math.sin(t * 0.6) * 0.2 : now.getSeconds();
      const min = this.anomaly ? 7 : now.getMinutes();
      const hour = this.anomaly ? 3 : now.getHours() % 12;
      this.clockHands[0].rotation.z = -((hour + min / 60) / 12) * TAU;
      this.clockHands[1].rotation.z = -((min + sec / 60) / 60) * TAU;
      this.clockHands[2].rotation.z = -(sec / 60) * TAU;
    }

    // 画面の明滅 (1 秒 2 回以下) + 常時のゆらぎ
    const base = this.screenOn ? 1.35 + this.bsodStage * 0.12 : 0;
    const flick = 1 + Math.sin(t * 2.2) * 0.012 + (this.glitch > 0.1 ? Math.sin(t * 6.1) * 0.06 * this.glitch : 0);
    if (this.screenOn) this.screenMat.emissiveIntensity = base * flick;
    this.screenLight.intensity = (this.screenOn ? 3.2 + this.bsodStage * 0.55 : 0.45) * flick * (1 + this.suction * 1.6);
    this.screenLight.color.setHSL(0.58, 0.85, 0.55 + Math.sin(t * 0.3) * 0.01);
    this.monitorSpot.intensity = (this.screenOn ? 6.2 : 1.0) * flick * (1 + this.suction);

    // グリッチの断片
    const activeFrags = Math.round(this.glitch * this.errorFrags.length);
    this.errorFrags.forEach((f, i) => {
      const m = f.material as THREE.MeshBasicMaterial;
      const on = i < activeFrags;
      m.opacity = damp(m.opacity, on ? 0.35 + Math.sin(t * 9 + i) * 0.15 : 0, 8, dt);
      if (on) {
        f.position.y += dt * 0.06;
        f.position.x += Math.sin(t * 3 + i) * dt * 0.03;
        f.rotation.z += dt * 0.2 * (i % 2 ? 1 : -1);
        if (f.position.y > MON.y + 0.6) f.position.y = MON.y - 0.5;
      }
    });

    // モニターの傾き + 付箋のはためき
    this.monitorTilt = damp(this.monitorTilt, this.glitch * 0.02 * Math.sin(t * 2.4), 4, dt);
    this.monitorGroup.rotation.z = this.monitorTilt;
    this.notes.forEach((n, i) => { n.rotation.z = Math.sin(t * 1.3 + i) * 0.03 + (i - 1) * 0.02; });

    // カーテンの揺れ
    const sway = Math.sin(t * 0.7) * 0.004 + this.suction * 0.02;
    this.curtainL.rotation.y = -Math.PI / 2 + sway;
    this.curtainR.rotation.y = -Math.PI / 2 - sway * 0.7;

    // 埃
    if (this.dust) {
      const arr = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i += 3) {
        const y = arr.getY(i) + dt * 0.012;
        arr.setY(i, y > ROOM.h - 0.05 ? 0.08 : y);
        arr.setX(i, arr.getX(i) + Math.sin(t * 0.4 + i) * dt * 0.02);
      }
      arr.needsUpdate = true;
      (this.dust.material as THREE.PointsMaterial).opacity = 0.22 + (this.screenOn ? 0.3 : 0.05);
    }

    // 吸引
    if (this.suction > 0.001) {
      this.vortexMat.opacity = this.suction * 0.9;
      this.vortex.rotation.z += dt * (0.6 + this.suction * 3);
      this.vortex.scale.setScalar(1 + Math.sin(t * 3) * 0.05 * this.suction);
      const target = new THREE.Vector3(MON.x, MON.y, MON.z);
      for (const p of this.suck) {
        const k = clamp(this.suction * 1.3 - p.phase * 0.06, 0, 1);
        const ease = k * k;
        const drift = new THREE.Vector3(
          Math.sin(t * 1.7 + p.phase) * 0.35,
          Math.cos(t * 1.3 + p.phase) * 0.25,
          Math.sin(t * 1.1 + p.phase) * 0.3,
        ).multiplyScalar(ease);
        p.obj.position.lerpVectors(p.base, target, ease).add(drift);
        p.obj.rotation.x = p.baseRot.x + t * p.spin * ease;
        p.obj.rotation.y = p.baseRot.y + t * p.spin * 0.7 * ease;
        p.obj.rotation.z = p.baseRot.z + t * p.spin * 0.4 * ease;
      }
    }

    // 帰還後の残像
    if (this.ghostMat.opacity > 0.001 || this.anomaly) {
      const o = 0.18 + Math.sin(t * 1.2) * 0.07;
      this.ghostMat.opacity = damp(this.ghostMat.opacity, this.anomaly ? o : 0, 1.5, dt);
      this.screenMat.emissiveIntensity = Math.max(this.screenMat.emissiveIntensity, this.anomaly ? 0.35 : 0);
      this.screenLight.intensity = Math.max(this.screenLight.intensity, 0.7 + o);
    }

    // フラッシュライト
    if (torch) {
      if (!this.flashlight) {
        const l = new THREE.SpotLight(0xdfefff, 9, 12, Math.PI * 0.22, 0.55, 1.5);
        l.castShadow = true;
        l.shadow.mapSize.set(512, 512);
        l.shadow.bias = -0.002;
        this.group.add(l, l.target);
        this.flashlight = l;
      }
      this.flashlight.intensity = 9;
      this.flashlight.position.copy(camera.position);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      this.flashlight.target.position.copy(camera.position).addScaledVector(dir, 6);
      this.flashlight.target.updateMatrixWorld();
    }

    // タイトル画面でゆっくり揺らぐ光
    if (titleIdle) {
      this.screenLight.intensity = 1.2 + Math.sin(t * 0.7) * 0.15;
      this.screenMat.emissiveIntensity = 0.45;
    }

    // BSOD の再描画 (進行中のアニメーション・クリック後)
    if (this.screenOn && this.bsodStage > 0) {
      const interval = 0.42;
      if (t - this.lastBsodDraw > interval) {
        this.lastBsodDraw = t;
        this.bsodProgress = clamp(this.bsodProgress + 0.9, 0, 100);
        this.bsod.draw({
          stage: this.bsodStage,
          progress: this.bsodProgress,
          corruption: this.bsodCorrupt,
          faceScale: 1 + this.bsodStage * 0.1,
          seed: 300 + Math.floor(t * 3),
          time: t,
        });
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat?.dispose();
      }
    });
  }
}

/* lerp はグローバルに使うので参照を維持 */
void lerp;
