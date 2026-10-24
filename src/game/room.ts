// The bedroom: a 4.2 x 3.6 x 2.6 m room lit by a monitor, a desk lamp and
// moonlight through a window.  Everything here is 1 unit = 1 metre.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { AssetLoader } from '../core/assets';
import { Physics } from '../core/physics';
import { MonitorScreen } from './monitor';
import { concrete, fabric, metal, plaster, rug, woodDesk, woodFloor, citySkyline } from '../core/textures';
import { RNG, clamp, makeCanvas, canvasTexture, textTexture } from '../core/utils';

export interface Interactable {
  id: string;
  label: string;
  position: THREE.Vector3;
  radius: number;
  enabled: boolean;
  onUse: () => void;
}

export class Room {
  group = new THREE.Group();
  screen!: THREE.Mesh;
  screenMat!: THREE.MeshBasicMaterial;
  monitorScreen: MonitorScreen;
  monitorLight!: THREE.RectAreaLight;
  monitorSpill!: THREE.PointLight;
  lamp!: THREE.SpotLight;
  lampBulb!: THREE.Mesh;
  moon!: THREE.SpotLight;
  blinds: THREE.InstancedMesh | null = null;
  interactables: Interactable[] = [];
  envTexture: THREE.Texture | null = null;

  private assets: AssetLoader;
  private physics: Physics;
  private rng = new RNG(20240524);
  private monitorPos = new THREE.Vector3(0, 1.15, -1.5);
  private screenSize = new THREE.Vector2(0.62, 0.35);
  private blindsOpen = 0.35;
  private lampOn = true;
  private flickerT = 0;
  private powerOn = true;
  private epilogue = false;
  private cityPlane!: THREE.Mesh;
  private clockHands = new THREE.Group();
  private pcLed!: THREE.Mesh;
  private pcLedLight!: THREE.PointLight;
  private dust: THREE.Points | null = null;
  private fanSpeed = 1;
  private roomBuilt = false;

  constructor(assets: AssetLoader, physics: Physics) {
    this.assets = assets;
    this.physics = physics;
    this.monitorScreen = new MonitorScreen();
    this.group.name = 'room';
    RectAreaLightUniformsLib.init();
  }

  // ------------------------------------------------------------------ build
  build() {
    if (this.roomBuilt) return;
    this.roomBuilt = true;
    this.buildShell();
    this.buildFurniture();
    this.buildDesk();
    this.buildPc();
    this.buildDecor();
    this.buildGlTFProps();
    this.buildLights();
    this.buildColliders();
    this.buildInteractables();
    this.buildDust();
  }

  private box(
    w: number, h: number, d: number, mat: THREE.Material | THREE.Material[],
    x: number, y: number, z: number, rounded = 0,
  ) {
    const geo = rounded > 0 ? new RoundedBoxGeometry(w, h, d, 2, rounded) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private pbrMaterial(set: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture },
    opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return new THREE.MeshStandardMaterial({
      map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
      roughness: 1, metalness: 0, envMapIntensity: 0.55, ...opts,
    });
  }

  private buildShell() {
    const floorSet = woodFloor();
    const wallSet = plaster('#3b3f4c');
    const floorMat = this.pbrMaterial(floorSet, { envMapIntensity: 0.7 });
    const wallMat = this.pbrMaterial(wallSet);
    const ceilMat = this.pbrMaterial(plaster('#2b2e38'));
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.55, metalness: 0.1 });

    // floor
    const floor = this.box(4.2, 0.12, 3.6, floorMat, 0, -0.06, 0);
    floor.castShadow = false;
    // ceiling
    this.box(4.2, 0.12, 3.6, ceilMat, 0, 2.66, 0).castShadow = false;

    const T = 0.12;
    // back wall (desk side)
    this.box(4.2, 2.6, T, wallMat, 0, 1.3, -1.86);
    // front wall (door side)
    this.box(4.2, 2.6, T, wallMat, 0, 1.3, 1.86);
    // right wall
    this.box(T, 2.6, 3.6, wallMat, 2.16, 1.3, 0);

    // left wall with a window opening (z -0.72..0.92, y 0.95..2.06)
    const x = -2.16;
    this.box(T, 0.95, 3.6, wallMat, x, 0.475, 0);                 // under window
    this.box(T, 2.6 - 2.06, 3.6, wallMat, x, (2.06 + 2.6) / 2, 0); // above window
    this.box(T, 2.06 - 0.95, 3.6 - (0.92 + 1.8), wallMat, x, (0.95 + 2.06) / 2, (-1.8 + -0.72) / 2);
    this.box(T, 2.06 - 0.95, 1.8 - 0.92, wallMat, x, (0.95 + 2.06) / 2, (0.92 + 1.8) / 2);

    // baseboards
    const bb = (w: number, d: number, px: number, pz: number) => this.box(w, 0.1, d, trimMat, px, 0.05, pz);
    bb(4.2, 0.03, 0, -1.79); bb(4.2, 0.03, 0, 1.79);
    bb(0.03, 3.6, -2.09, 0); bb(0.03, 3.6, 2.09, 0);

    // --- window frame + glass + skyline
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.4, metalness: 0.35 });
    const wx = -2.14, wy = (0.95 + 2.06) / 2, wz = (0.92 - 0.72) / 2;
    const wW = 0.92 + 0.72, wH = 2.06 - 0.95;
    this.box(0.07, 0.07, wW, frameMat, wx, 0.95, wz);
    this.box(0.07, 0.07, wW, frameMat, wx, 2.06, wz);
    this.box(0.07, wH, 0.07, frameMat, wx, wy, -0.72);
    this.box(0.07, wH, 0.07, frameMat, wx, wy, 0.92);
    this.box(0.05, wH, 0.04, frameMat, wx, wy, wz);            // mullion
    this.box(0.05, 0.04, wW, frameMat, wx, wy - 0.15, wz);
    // sill
    this.box(0.22, 0.05, wW + 0.1, frameMat, -2.06, 0.94, wz);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fc0e8, transmission: 0.0, transparent: true, opacity: 0.12,
      roughness: 0.08, metalness: 0.0, side: THREE.DoubleSide, envMapIntensity: 1.2,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(wW, wH), glassMat);
    glass.rotation.y = Math.PI / 2;
    glass.position.set(wx, wy, wz);
    this.group.add(glass);

    // city outside
    const sky = citySkyline();
    const skyMat = new THREE.MeshBasicMaterial({ map: sky, color: new THREE.Color(0.55, 0.65, 0.9), toneMapped: false });
    this.cityPlane = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.2), skyMat);
    this.cityPlane.rotation.y = Math.PI / 2;
    this.cityPlane.position.set(-4.6, 1.5, 0.1);
    this.group.add(this.cityPlane);

    // blinds (instanced slats)
    const slatGeo = new THREE.BoxGeometry(0.03, 0.035, wW - 0.05);
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.85, metalness: 0.05 });
    const count = 26;
    this.blinds = new THREE.InstancedMesh(slatGeo, slatMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const y = 1.0 + i * 0.041;
      e.set(this.blindsOpen, 0, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(wx + 0.06, y, wz), q, new THREE.Vector3(1, 1, 1));
      this.blinds.setMatrixAt(i, m);
    }
    this.blinds.castShadow = true;
    this.group.add(this.blinds);

    // light shaft through the window (soft volumetric hint)
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x7fa4ff, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.9), shaftMat);
    shaft.position.set(-1.0, 1.55, 0.1);
    shaft.rotation.set(0, Math.PI / 2, -0.55);
    this.group.add(shaft);

    // door on the front wall
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2f333d, roughness: 0.7, metalness: 0.05 });
    this.box(0.95, 2.05, 0.06, doorMat, 1.05, 1.02, 1.78);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.28, metalness: 0.95 });
    this.box(0.05, 0.05, 0.13, handleMat, 1.42, 1.02, 1.72, 0.02);
    // poster above the desk
    this.buildPoster();
  }

  private buildPoster() {
    const { c, ctx } = makeCanvas(512, 720);
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#0a1b3a');
    g.addColorStop(1, '#050a16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 720);
    ctx.strokeStyle = 'rgba(120,170,255,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(26, 26, 460, 668);
    ctx.fillStyle = '#cfe2ff';
    ctx.font = '700 62px ui-monospace, monospace';
    ctx.fillText('NO', 60, 140);
    ctx.fillText('SIGNAL', 60, 212);
    ctx.font = '400 22px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(160,195,255,0.75)';
    const lines = ['the machine dreams of', 'a room you have never', 'left. 0x00 0xFF 0x00', '', 'build 0.0.7 — do not', 'power off'];
    lines.forEach((l, i) => ctx.fillText(l, 60, 290 + i * 38));
    // scanline texture
    for (let y = 0; y < 720; y += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, y, 512, 1);
    }
    const tex = canvasTexture(c, { srgb: true });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.73), mat);
    poster.position.set(-1.28, 1.86, -1.79);
    this.group.add(poster);

    // second poster: an error code chart
    const t2 = textTexture('0x000000EA\nTHREAD_STUCK\n0xC000021A\n0x0000007B\n0xDEADFA11',
      { w: 512, h: 512, size: 46, color: '#9fc4ff', bg: '#081226', lineHeight: 72, padding: 30 });
    const m2 = new THREE.MeshStandardMaterial({ map: t2, roughness: 0.9 });
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), m2);
    p2.position.set(-1.28, 1.12, -1.79);
    this.group.add(p2);

    // wall clock
    const clockFace = new THREE.MeshStandardMaterial({ color: 0xd9dde6, roughness: 0.5 });
    const clockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 32), clockFace);
    clockBody.rotation.x = Math.PI / 2;
    clockBody.position.set(1.25, 1.95, -1.8);
    clockBody.castShadow = true;
    this.group.add(clockBody);
    const handMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.6 });
    const hM = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.09, 0.008), handMat);
    hM.position.set(0, 0.045, 0.025);
    const minute = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.13, 0.006), handMat);
    minute.position.set(0, 0.065, 0.028);
    this.clockHands.add(hM, minute);
    this.clockHands.position.set(1.25, 1.95, -1.79);
    this.clockHands.rotation.z = -0.4;
    this.group.add(this.clockHands);
  }

  private buildFurniture() {
    // --- desk
    const deskSet = woodDesk('#4b3626');
    const deskMat = this.pbrMaterial(deskSet, { envMapIntensity: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.42, metalness: 0.85 });
    const top = this.box(1.66, 0.035, 0.72, deskMat, 0, 0.755, -1.44, 0.008);
    top.castShadow = true;
    // legs (metal frame)
    for (const [lx, lz] of [[-0.78, -1.72], [0.78, -1.72], [-0.78, -1.16], [0.78, -1.16]] as const) {
      this.box(0.035, 0.74, 0.035, metalMat, lx, 0.37, lz, 0.008);
    }
    this.box(1.58, 0.03, 0.03, metalMat, 0, 0.2, -1.68);
    // monitor riser shelf
    this.box(0.7, 0.02, 0.28, deskMat, 0, 0.78, -1.55);

    // --- bed along the right wall
    const bedMat = this.pbrMaterial(fabric('#20263a'), { envMapIntensity: 0.4 });
    const sheetMat = this.pbrMaterial(fabric('#2b3a5c'), { envMapIntensity: 0.4 });
    this.box(0.72, 0.26, 1.98, metalMat, 1.62, 0.19, 0.3, 0.02);       // frame
    this.box(0.7, 0.2, 1.94, sheetMat, 1.62, 0.4, 0.3, 0.06);          // mattress
    // duvet (uneven, folded back)
    const duvet = this.box(0.74, 0.13, 1.5, bedMat, 1.6, 0.55, 0.52, 0.07);
    duvet.rotation.z = 0.012;
    // pillows
    const p1 = this.box(0.5, 0.13, 0.32, sheetMat, 1.6, 0.6, -0.5, 0.06);
    p1.rotation.set(0.06, 0.12, -0.04);
    const p2 = this.box(0.42, 0.11, 0.28, sheetMat, 1.55, 0.58, -0.22, 0.05);
    p2.rotation.set(-0.03, -0.2, 0.05);
    // headboard
    this.box(0.12, 0.9, 2.0, deskMat, 2.02, 0.62, 0.3, 0.02);

    // --- wall shelf above the bed
    const shelfMat = this.pbrMaterial(woodDesk('#3a2c1f'), { envMapIntensity: 0.7 });
    this.box(0.26, 0.03, 1.5, shelfMat, 2.0, 1.5, 0.5);
    this.box(0.26, 0.03, 1.5, shelfMat, 2.0, 1.95, 0.5);
    // books (instanced), varied colours
    const bookGeo = new THREE.BoxGeometry(0.18, 1, 0.13);
    const bookMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: false });
    const books = new THREE.InstancedMesh(bookGeo, bookMat, 26);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const colors = [0x39506e, 0x5a3f3a, 0x2f4a3d, 0x6a5a3a, 0x3b3b52, 0x7a4a52, 0x445a68];
    const rng = this.rng;
    let bi = 0;
    for (const shelfY of [1.5, 1.95]) {
      let z = -0.18;
      while (z < 1.1 && bi < 26) {
        const h = rng.range(0.2, 0.29);
        const depth = rng.range(0.13, 0.2);
        q.setFromEuler(new THREE.Euler(0, rng.range(-0.1, 0.1), rng.range(-0.04, 0.04)));
        m4.compose(
          new THREE.Vector3(1.98, shelfY + 0.018 + h / 2, z),
          q,
          new THREE.Vector3(1, h, depth / 0.13),
        );
        books.setMatrixAt(bi, m4);
        books.setColorAt(bi, new THREE.Color(colors[bi % colors.length]).multiplyScalar(rng.range(0.7, 1.1)));
        bi++;
        z += depth + rng.range(0.008, 0.03);
      }
    }
    books.count = bi;
    books.castShadow = true;
    books.receiveShadow = true;
    books.instanceMatrix.needsUpdate = true;
    if (books.instanceColor) books.instanceColor.needsUpdate = true;
    this.group.add(books);

    // --- rug
    const rugSet = rug();
    const rugMat = new THREE.MeshStandardMaterial({
      map: rugSet.map, normalMap: rugSet.normalMap, roughnessMap: rugSet.roughnessMap, roughness: 1, envMapIntensity: 0.3,
    });
    const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), rugMat);
    rugMesh.rotation.x = -Math.PI / 2;
    rugMesh.position.set(0.05, 0.005, 0.35);
    rugMesh.receiveShadow = true;
    this.group.add(rugMesh);

    // --- laundry basket + clothes
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.9 });
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.42, 14, 1, true), basketMat);
    basket.position.set(-1.75, 0.21, 1.42);
    basket.castShadow = true; basket.receiveShadow = true;
    this.group.add(basket);
    const clothMat = this.pbrMaterial(fabric('#3a4152'));
    for (let i = 0; i < 3; i++) {
      const c = this.box(0.28, 0.06, 0.24, clothMat, -1.75 + rng.range(-0.04, 0.04), 0.3 + i * 0.045, 1.42, 0.03);
      c.rotation.y = rng.range(0, 3);
    }

    // --- slippers by the door
    const slipperMat = new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.95 });
    for (const sx of [0.45, 0.75]) {
      const s = this.box(0.11, 0.05, 0.26, slipperMat, sx, 0.03, 1.5, 0.02);
      s.rotation.y = rng.range(-0.12, 0.12);
    }
  }

  private buildDesk() {
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.38, metalness: 0.8 });
    const plasticMat = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.45, metalness: 0.25 });

    // --- monitor
    const monBody = this.box(0.66, 0.39, 0.035, plasticMat, this.monitorPos.x, this.monitorPos.y, -1.545, 0.012);
    monBody.castShadow = true;
    // stand
    const neck = this.box(0.07, 0.2, 0.05, plasticMat, 0, 0.88, -1.6, 0.012);
    void neck;
    this.box(0.26, 0.015, 0.16, metalMat, 0, 0.79, -1.59, 0.01);

    // screen (emissive plane just in front of the body)
    this.screenMat = new THREE.MeshBasicMaterial({
      map: this.monitorScreen.texture, toneMapped: true,
      color: new THREE.Color(0.85, 0.9, 1.0).multiplyScalar(1.6),
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(this.screenSize.x, this.screenSize.y), this.screenMat);
    this.screen.position.set(this.monitorPos.x, this.monitorPos.y, -1.524);
    this.screen.name = 'monitor-screen';
    this.group.add(this.screen);

    // keyboard with instanced keys
    const kbBody = this.box(0.44, 0.018, 0.15, plasticMat, 0, 0.782, -1.16, 0.006);
    kbBody.rotation.x = -0.03;
    const keyGeo = new THREE.BoxGeometry(0.021, 0.008, 0.021);
    const keyMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.7 });
    const keys = new THREE.InstancedMesh(keyGeo, keyMat, 15 * 5);
    const m4 = new THREE.Matrix4();
    let ki = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 15; col++) {
        m4.makeTranslation(-0.196 + col * 0.028, 0.7935, -1.208 + row * 0.024);
        keys.setMatrixAt(ki++, m4);
      }
    }
    keys.instanceMatrix.needsUpdate = true;
    keys.castShadow = false;
    this.group.add(keys);

    // mousepad + mouse
    const padMat = new THREE.MeshStandardMaterial({ color: 0x101520, roughness: 0.95 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.21), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0.36, 0.774, -1.14);
    pad.receiveShadow = true;
    this.group.add(pad);
    const mouse = this.box(0.06, 0.033, 0.1, plasticMat, 0.36, 0.79, -1.14, 0.018);
    void mouse;

    // mug with handle
    const mugMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ec, roughness: 0.35, metalness: 0.05 });
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.037, 0.1, 20, 1, false), mugMat);
    mug.position.set(-0.4, 0.828, -1.28);
    mug.castShadow = true; mug.receiveShadow = true;
    this.group.add(mug);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 14, Math.PI * 1.6), mugMat);
    handle.position.set(-0.36, 0.83, -1.28);
    handle.rotation.y = Math.PI / 2;
    this.group.add(handle);
    // coffee inside
    const coffee = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 18),
      new THREE.MeshStandardMaterial({ color: 0x1b0f08, roughness: 0.18, metalness: 0.2 }),
    );
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.set(-0.4, 0.874, -1.28);
    this.group.add(coffee);

    // papers with text
    const paperTex = textTexture(
      'MEMORY DUMP 0x0000EA\n\n00 41 42 43 44 45 46 47\nFF FF 00 00 EA EA 7B 7B\n\n[  ] do not read this\n[ x] wake up',
      { w: 512, h: 640, size: 26, color: '#20242c', bg: '#e6e2d6', lineHeight: 38, padding: 28, font: '400 26px ui-monospace, monospace' },
    );
    const paperMat = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.95 });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), paperMat);
    paper.rotation.set(-Math.PI / 2 + 0.03, 0.14, 0);
    paper.position.set(-0.16, 0.777, -1.16);
    this.group.add(paper);

    // pen
    const penMat = new THREE.MeshStandardMaterial({ color: 0x1d2530, roughness: 0.4, metalness: 0.4 });
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), penMat);
    pen.rotation.z = Math.PI / 2;
    pen.rotation.y = 0.3;
    pen.position.set(-0.1, 0.782, -1.07);
    this.group.add(pen);

    // cable from monitor to PC
    const cableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.1, 0.83, -1.6),
      new THREE.Vector3(0.3, 0.78, -1.68),
      new THREE.Vector3(0.62, 0.62, -1.72),
      new THREE.Vector3(0.86, 0.42, -1.7),
      new THREE.Vector3(0.95, 0.36, -1.55),
    ]);
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(cableCurve, 26, 0.006, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.8 }),
    );
    this.group.add(cable);
  }

  private buildPc() {
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.32, metalness: 0.55 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fc4ff, transparent: true, opacity: 0.18, roughness: 0.06, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.05,
    });
    // tower on the floor to the right of the desk
    this.box(0.22, 0.46, 0.46, caseMat, 1.02, 0.23, -1.5, 0.012);
    const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.4), glassMat);
    windowPane.position.set(0.905, 0.23, -1.5);
    windowPane.rotation.y = -Math.PI / 2;
    this.group.add(windowPane);

    // internals: GPU block, fan rings, RGB strip
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.5, metalness: 0.7 });
    this.box(0.16, 0.05, 0.26, innerMat, 1.02, 0.26, -1.5);
    this.box(0.14, 0.1, 0.1, innerMat, 1.02, 0.34, -1.62);
    const fanMat = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6 });
    for (const y of [0.36, 0.16]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.006, 6, 20), fanMat);
      ring.position.set(0.965, y, -1.38);
      ring.rotation.y = Math.PI / 2;
      this.group.add(ring);
      const blades = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 16),
        new THREE.MeshBasicMaterial({ color: 0x1b3a6b, transparent: true, opacity: 0.5, toneMapped: false }),
      );
      blades.position.set(0.967, y, -1.38);
      blades.rotation.y = Math.PI / 2;
      this.group.add(blades);
    }
    // RGB strip glowing through the side panel
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.4, 1.0).multiplyScalar(3.2), toneMapped: false });
    this.pcLed = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.4), ledMat);
    this.pcLed.position.set(0.905, 0.23, -1.66);
    this.pcLed.rotation.y = -Math.PI / 2;
    this.group.add(this.pcLed);

    // front I/O + power LED
    const powerLedMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.7, 1.0).multiplyScalar(2), toneMapped: false });
    const pled = new THREE.Mesh(new THREE.CircleGeometry(0.006, 10), powerLedMat);
    pled.position.set(1.02, 0.42, -1.27);
    this.group.add(pled);
  }

  private buildDecor() {
    // small framed photo above the bed
    const photoTex = textTexture('23:58', { w: 256, h: 256, size: 90, color: '#dbe7ff', bg: '#0b1020', align: 'center', padding: 40 });
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.6 }),
    );
    photo.position.set(2.09, 1.45, 1.42);
    photo.rotation.y = -Math.PI / 2;
    this.group.add(photo);

    // desk lamp (articulated arm with a warm bulb)
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.4, metalness: 0.7 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.02, 20), lampMat);
    base.position.set(-0.62, 0.78, -1.62);
    base.castShadow = true;
    this.group.add(base);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 8), lampMat);
    arm.position.set(-0.66, 0.98, -1.6);
    arm.rotation.z = 0.22;
    this.group.add(arm);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 8), lampMat);
    arm2.position.set(-0.44, 1.13, -1.5);
    arm2.rotation.set(0.5, 0, -1.05);
    this.group.add(arm2);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.11, 20, 1, true), lampMat);
    shade.position.set(-0.3, 1.16, -1.38);
    shade.rotation.set(0.9, 0, -0.5);
    shade.castShadow = false;
    this.group.add(shade);
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.78, 0.45).multiplyScalar(2.4), toneMapped: false });
    this.lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), bulbMat);
    this.lampBulb.position.set(-0.3, 1.13, -1.38);
    this.group.add(this.lampBulb);

    // power strip + phone on the bed
    const plastic = new THREE.MeshStandardMaterial({ color: 0x171a20, roughness: 0.6 });
    this.box(0.24, 0.03, 0.06, plastic, 0.6, 0.015, -1.7, 0.006);
    const phone = this.box(0.075, 0.008, 0.15, plastic, 1.68, 0.585, 0.12, 0.006);
    phone.rotation.y = 0.4;
    const phoneScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.066, 0.135),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.09), toneMapped: false }),
    );
    phoneScreen.rotation.set(-Math.PI / 2, 0.4, 0);
    phoneScreen.position.set(1.68, 0.5895, 0.12);
    this.group.add(phoneScreen);

    // headphones on the desk corner
    const hpMat = new THREE.MeshStandardMaterial({ color: 0x1c1f27, roughness: 0.6, metalness: 0.2 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.011, 8, 22, Math.PI), hpMat);
    band.position.set(0.62, 0.79, -1.62);
    band.rotation.set(0, 0.3, 0);
    this.group.add(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.026, 18), hpMat);
      cup.position.set(0.62 + Math.cos(0.3) * 0.075 * s, 0.782, -1.62 - Math.sin(0.3) * 0.075 * s);
      cup.rotation.z = Math.PI / 2;
      this.group.add(cup);
    }
  }

  private buildGlTFProps() {
    const A = this.assets;
    // chair (CC0 SheenChair) facing the desk
    if (A.has('SheenChair')) {
      const chair = A.clone('SheenChair');
      AssetLoader.fit(chair, 0.95, 'y');
      chair.position.set(0.05, 0, -0.9);
      chair.rotation.y = Math.PI;
      chair.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      chair.name = 'prop-chair';
      this.group.add(chair);
    }
    // plant near the window (CC BY 4.0)
    if (A.has('DiffuseTransmissionPlant')) {
      const plant = A.clone('DiffuseTransmissionPlant');
      AssetLoader.fit(plant, 0.82, 'y');
      plant.position.set(-1.72, 0, 0.05);
      plant.name = 'prop-plant';
      this.group.add(plant);
    }
    // water bottle on the desk (CC0)
    if (A.has('WaterBottle')) {
      const bottle = A.clone('WaterBottle');
      AssetLoader.fit(bottle, 0.25, 'y');
      bottle.position.set(0.52, 0.775, -1.32);
      this.group.add(bottle);
    }
    // vase with flowers on the shelf (CC0)
    if (A.has('GlassVaseFlowers')) {
      const vase = A.clone('GlassVaseFlowers');
      AssetLoader.fit(vase, 0.2, 'y');
      vase.position.set(2.0, 1.965, 1.3);
      this.group.add(vase);
    }
    // candle holder on the desk (CC BY 4.0)
    if (A.has('GlassHurricaneCandleHolder')) {
      const candle = A.clone('GlassHurricaneCandleHolder');
      AssetLoader.fit(candle, 0.28, 'y');
      candle.position.set(-0.66, 0.775, -1.1);
      this.group.add(candle);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(3), toneMapped: false }),
      );
      flame.position.set(-0.66, 0.98, -1.1);
      flame.scale.set(1, 1.8, 1);
      this.group.add(flame);
      const candleLight = new THREE.PointLight(0xffa04a, 0.55, 2.4, 2);
      candleLight.position.copy(flame.position);
      this.group.add(candleLight);
    }
    // wristwatch on the desk (CC BY 4.0)
    if (A.has('ChronographWatch')) {
      const watch = A.clone('ChronographWatch');
      AssetLoader.fit(watch, 0.065, 'max');
      watch.position.set(-0.06, 0.776, -1.02);
      watch.rotation.y = 0.6;
      this.group.add(watch);
    }
  }

  private buildLights() {
    // ambient lift + faint bounce from the window
    const hemi = new THREE.HemisphereLight(0x2a3a5c, 0x05060a, 0.35);
    this.group.add(hemi);

    // monitor: the key light
    this.monitorLight = new THREE.RectAreaLight(0x4f8cff, 5.2, this.screenSize.x, this.screenSize.y);
    this.monitorLight.position.set(this.monitorPos.x, this.monitorPos.y, -1.515);
    this.monitorLight.lookAt(new THREE.Vector3(this.monitorPos.x, this.monitorPos.y, 1));
    this.group.add(this.monitorLight);

    this.monitorSpill = new THREE.PointLight(0x3b74e0, 1.5, 4.2, 2);
    this.monitorSpill.position.set(0, 1.35, -1.05);
    this.monitorSpill.castShadow = false;
    this.group.add(this.monitorSpill);

    // desk lamp
    this.lamp = new THREE.SpotLight(0xffb070, 11, 4.6, 0.72, 0.62, 1.6);
    this.lamp.position.set(-0.3, 1.18, -1.38);
    this.lamp.target.position.set(-0.1, 0.78, -1.45);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.camera.near = 0.05;
    this.lamp.shadow.camera.far = 5;
    this.lamp.shadow.bias = -0.0012;
    this.lamp.shadow.normalBias = 0.02;
    this.group.add(this.lamp, this.lamp.target);

    // moonlight through the window (shadows on, tight frustum)
    this.moon = new THREE.SpotLight(0x9ab8ff, 16, 14, 0.78, 0.8, 1.4);
    this.moon.position.set(-4.4, 3.1, 0.4);
    this.moon.target.position.set(1.1, 0.4, 0.1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.camera.near = 0.5;
    this.moon.shadow.camera.far = 14;
    this.moon.shadow.bias = -0.0015;
    this.moon.shadow.normalBias = 0.03;
    this.group.add(this.moon, this.moon.target);

    // PC internals glow
    this.pcLedLight = new THREE.PointLight(0x2d63ff, 1.1, 2.6, 2);
    this.pcLedLight.position.set(0.92, 0.26, -1.5);
    this.group.add(this.pcLedLight);
  }

  private buildDust() {
    const count = 320;
    const pos = new Float32Array(count * 3);
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng.range(-2.0, 2.0);
      pos[i * 3 + 1] = rng.range(0.1, 2.5);
      pos[i * 3 + 2] = rng.range(-1.7, 1.7);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fc0ff, size: 0.006, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  private buildColliders() {
    const P = this.physics;
    // floor + ceiling
    P.addBoxStatic(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(2.1, 0.1, 1.8));
    P.addBoxStatic(new THREE.Vector3(0, 2.72, 0), new THREE.Vector3(2.1, 0.1, 1.8));
    // walls
    P.addBoxStatic(new THREE.Vector3(0, 1.3, -1.86), new THREE.Vector3(2.1, 1.3, 0.06));
    P.addBoxStatic(new THREE.Vector3(0, 1.3, 1.86), new THREE.Vector3(2.1, 1.3, 0.06));
    P.addBoxStatic(new THREE.Vector3(2.16, 1.3, 0), new THREE.Vector3(0.06, 1.3, 1.8));
    P.addBoxStatic(new THREE.Vector3(-2.16, 0.47, 0), new THREE.Vector3(0.06, 0.47, 1.8));
    P.addBoxStatic(new THREE.Vector3(-2.16, 2.33, 0), new THREE.Vector3(0.06, 0.27, 1.8));
    P.addBoxStatic(new THREE.Vector3(-2.16, 1.5, -1.26), new THREE.Vector3(0.06, 0.55, 0.54));
    P.addBoxStatic(new THREE.Vector3(-2.16, 1.5, 1.36), new THREE.Vector3(0.06, 0.55, 0.44));
    // desk
    P.addBoxStatic(new THREE.Vector3(0, 0.74, -1.44), new THREE.Vector3(0.83, 0.03, 0.36));
    P.addBoxStatic(new THREE.Vector3(-0.78, 0.37, -1.44), new THREE.Vector3(0.04, 0.37, 0.34));
    P.addBoxStatic(new THREE.Vector3(0.78, 0.37, -1.44), new THREE.Vector3(0.04, 0.37, 0.34));
    // bed
    P.addBoxStatic(new THREE.Vector3(1.62, 0.3, 0.3), new THREE.Vector3(0.37, 0.3, 1.0));
    // pc tower
    P.addBoxStatic(new THREE.Vector3(1.02, 0.23, -1.5), new THREE.Vector3(0.11, 0.23, 0.23));
    // chair (simple box so you cannot walk through it)
    P.addBoxStatic(new THREE.Vector3(0.05, 0.45, -0.9), new THREE.Vector3(0.32, 0.45, 0.32));
    // shelf
    P.addBoxStatic(new THREE.Vector3(2.0, 1.72, 0.5), new THREE.Vector3(0.14, 0.24, 0.76));
    // laundry basket, plant
    P.addBoxStatic(new THREE.Vector3(-1.75, 0.21, 1.42), new THREE.Vector3(0.2, 0.21, 0.2));
    P.addBoxStatic(new THREE.Vector3(-1.72, 0.35, 0.05), new THREE.Vector3(0.22, 0.35, 0.22));
  }

  private buildInteractables() {
    const I = this.interactables;
    I.push({
      id: 'pc', label: 'PCを調べる', position: new THREE.Vector3(0, 1.1, -1.35), radius: 2.3, enabled: true,
      onUse: () => { /* handled by Game */ },
    });
    I.push({
      id: 'lamp', label: 'デスクライトを切り替える', position: new THREE.Vector3(-0.35, 1.0, -1.4), radius: 1.7, enabled: true,
      onUse: () => this.toggleLamp(),
    });
    I.push({
      id: 'blinds', label: 'ブラインドを開ける', position: new THREE.Vector3(-1.9, 1.5, 0.1), radius: 1.7, enabled: true,
      onUse: () => this.toggleBlinds(),
    });
    I.push({
      id: 'poster', label: 'ポスターを読む', position: new THREE.Vector3(-1.28, 1.6, -1.7), radius: 1.6, enabled: true,
      onUse: () => { /* handled by Game via toast */ },
    });
    I.push({
      id: 'clock', label: '時計を見る', position: new THREE.Vector3(1.25, 1.95, -1.7), radius: 1.6, enabled: true,
      onUse: () => { /* handled by Game */ },
    });
    I.push({
      id: 'door', label: 'ドアを開ける', position: new THREE.Vector3(1.05, 1.0, 1.6), radius: 1.6, enabled: true,
      onUse: () => { /* handled by Game */ },
    });
  }

  toggleLamp() {
    this.lampOn = !this.lampOn;
    this.lamp.visible = this.lampOn;
    (this.lampBulb.material as THREE.MeshBasicMaterial).color.setRGB(
      this.lampOn ? 3.2 * 1.0 : 0.02, this.lampOn ? 3.2 * 0.78 : 0.02, this.lampOn ? 3.2 * 0.45 : 0.03,
    );
    return this.lampOn;
  }

  toggleBlinds() {
    this.blindsOpen = this.blindsOpen > 0.2 ? 0 : 0.9;
    this.updateBlinds();
    this.moon.intensity = this.blindsOpen > 0.2 ? 16 : 3.2;
    (this.cityPlane.material as THREE.MeshBasicMaterial).color.setScalar(this.blindsOpen > 0.2 ? 0.8 : 0.25);
    return this.blindsOpen > 0.2;
  }

  private updateBlinds() {
    if (!this.blinds) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const wW = 0.92 + 0.72;
    const wz = (0.92 - 0.72) / 2;
    for (let i = 0; i < this.blinds.count; i++) {
      const y = 1.0 + i * 0.041;
      if (this.blindsOpen < 0.2) {
        // closed: slats stack tightly at the top
        e.set(1.35, 0, 0);
        m.compose(new THREE.Vector3(-2.1, 1.98 + i * 0.006, wz), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
      } else {
        e.set(this.blindsOpen, 0, 0);
        m.compose(new THREE.Vector3(-2.1, y, wz), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
      }
      this.blinds.setMatrixAt(i, m);
    }
    this.blinds.instanceMatrix.needsUpdate = true;
    void wW;
  }

  // -------------------------------------------------------------- runtime
  setPower(on: boolean) {
    this.powerOn = on;
    this.screen.visible = on;
  }

  setEpilogue(on: boolean) {
    this.epilogue = on;
    if (on) {
      // small, consistent wrongness: chair turned, clock stopped, RGB dead
      const chair = this.group.getObjectByName('prop-chair');
      if (chair) chair.rotation.y = Math.PI + 0.9;
      this.clockHands.rotation.z = 0;
      (this.pcLed.material as THREE.MeshBasicMaterial).color.setRGB(0.02, 0.02, 0.03);
      this.pcLedLight.intensity = 0.05;
      this.fanSpeed = 0;
    }
  }

  update(dt: number, glitch: number) {
    this.flickerT += dt;
    this.monitorScreen.update(dt);

    // monitor flicker follows corruption
    const corr = this.monitorScreen.corruption;
    const flick = 1 - corr * 0.25 * (0.5 + 0.5 * Math.sin(this.flickerT * 9.3));
    this.monitorLight.intensity = (5.2 + corr * 1.5) * flick * (this.powerOn ? 1 : 0.02);
    this.monitorSpill.intensity = (1.5 + corr * 0.8) * flick * (this.powerOn ? 1 : 0.02);
    this.screenMat.color.setRGB(0.85 * flick, 0.9 * flick, 1.0);

    // keep the city slowly drifting: a hint that nothing outside is real
    this.cityPlane.position.z = 0.1 + Math.sin(this.flickerT * 0.03) * 0.15;

    // dust motes drifting in the monitor light
    if (this.dust) {
      const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const t = this.flickerT * (0.06 + (i % 7) * 0.01);
        pos.setY(i, pos.getY(i) + Math.sin(t * 3 + i) * 0.0006 + 0.00008);
        pos.setX(i, pos.getX(i) + Math.cos(t * 2.1 + i * 1.7) * 0.0009);
        if (pos.getY(i) > 2.55) pos.setY(i, 0.08);
      }
      pos.needsUpdate = true;
    }

    // PC fan / LED breathing
    const breathe = 0.8 + 0.2 * Math.sin(this.flickerT * 1.7);
    if (this.pcLedLight) this.pcLedLight.intensity = (this.epilogue ? 0.05 : 1.1) * breathe;

    // glitch shaking of small props (geometry-level, not just post)
    if (corr > 0.25) {
      const jitter = (corr - 0.25) * 0.006 * glitch;
      this.clockHands.position.x = 1.25 + Math.sin(this.flickerT * 40) * jitter;
      this.clockHands.position.y = 1.95 + Math.cos(this.flickerT * 33) * jitter;
    }

    if (this.fanSpeed > 0) {
      const ring = this.group.getObjectByName('prop-chair');
      void ring;
    }
  }

  /** One-shot reflection probe bake for the room (cheap IBL). */
  bakeEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(0.05, 12, rt);
    cam.position.set(0, 1.35, -0.2);
    const prevBg = scene.background;
    scene.background = null;
    cam.update(renderer, scene);
    scene.background = prevBg;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();
    const env = pmrem.fromCubemap(rt.texture).texture;
    this.envTexture = env;
    pmrem.dispose();
    rt.dispose();
    return env;
  }

  screenWorldPosition(out = new THREE.Vector3()) {
    return out.set(this.monitorPos.x, this.monitorPos.y, -1.524);
  }
  get screenNormal() { return new THREE.Vector3(0, 0, 1); }
  get screenWidth() { return this.screenSize.x; }
  get screenHeight() { return this.screenSize.y; }
  get isPowerOn() { return this.powerOn; }
  get lampIsOn() { return this.lampOn; }
  get blindsAreOpen() { return this.blindsOpen > 0.2; }
  get epilogueActive() { return this.epilogue; }

  /** Player start position + facing. */
  get spawn() { return { pos: new THREE.Vector3(0.35, 0.02, 1.25), yaw: 0.06 }; }
}
