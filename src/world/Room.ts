import * as THREE from 'three';
import type { AssetStore } from '../assets/Assets';
import type { MaterialLibrary } from '../assets/Materials';
import type { CollisionWorld } from '../core/Collision';
import { box, cable, dustMotes, poster, bookRow } from './Geo';
import { Rng } from '../core/math';

export interface RoomInteractable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: boolean;
  onInteract: () => void;
}

export interface RoomBuildResult {
  group: THREE.Group;
  interactables: RoomInteractable[];
  monitor: THREE.Object3D;
  screen: THREE.Mesh;
  screenCanvas: HTMLCanvasElement;
  screenTexture: THREE.CanvasTexture;
  lights: {
    screenArea: THREE.RectAreaLight;
    screenPoint: THREE.PointLight;
    lamp: THREE.SpotLight;
    lampPoint: THREE.PointLight;
    moon: THREE.DirectionalLight;
    clock: THREE.PointLight;
  };
  /** props that get vacuumed into the monitor during the swallow sequence */
  suctionProps: THREE.Object3D[];
  clockHands: { hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D };
  update(dt: number, time: number): void;
  setScreenMode(mode: ScreenMode): void;
  setAnomaly(level: number): void;
  setLamp(on: boolean): void;
  dispose(): void;
}

export type ScreenMode = 'desktop' | 'bsod' | 'face' | 'off' | 'glitch' | 'wake';

/** Room is authored around the origin: x ∈ [-2.6, 2.6], z ∈ [-2.2, 2.2], floor at y = 0. */
export const ROOM = {
  width: 5.2,
  depth: 4.4,
  height: 2.72,
  wallThickness: 0.16,
  deskPos: new THREE.Vector3(-0.42, 0.75, -1.76),
  deskSize: new THREE.Vector3(1.72, 0.045, 0.74),
  monitorPos: new THREE.Vector3(-0.42, 1.2, -1.98),
  monitorSize: new THREE.Vector3(0.66, 0.42, 0.03),
  start: new THREE.Vector3(0.55, 0, 1.35),
  startYaw: 0,
};

export class Room {
  readonly group = new THREE.Group();
  result!: RoomBuildResult;
  private screenMode: ScreenMode = 'desktop';
  private screenCtx: CanvasRenderingContext2D;
  private anomaly = 0;
  private lampOn = true;
  private flickerSeed = 0;
  private screenFlicker = 1;
  private rng = new Rng(4242);
  private motes: THREE.Points;
  private clockHands: { hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D };
  private lampLight: THREE.SpotLight;
  private lampPoint: THREE.PointLight;
  private lampBulbMat: THREE.MeshStandardMaterial;
  private screenMat: THREE.MeshBasicMaterial;
  private screenLight: THREE.RectAreaLight;
  private screenPoint: THREE.PointLight;
  private suction: THREE.Object3D[] = [];
  private wallMaterials: THREE.MeshStandardMaterial[] = [];
  private disposed = false;
  private clockFace!: THREE.Object3D;
  private lastSecond = -1;
  private anomalyProps: THREE.Group | null = null;
  private anomalyShards: THREE.Mesh[] = [];
  private anomalyOn = false;
  private chair: THREE.Object3D | null = null;

  static async create(store: AssetStore, mats: MaterialLibrary, collision: CollisionWorld): Promise<Room> {
    const room = new Room(store, mats, collision);
    await room.build();
    return room;
  }

  private constructor(
    private store: AssetStore,
    private mats: MaterialLibrary,
    private collision: CollisionWorld,
  ) {
    this.group.name = 'room';
    this.screenCtx = document.createElement('canvas').getContext('2d')!;
    this.motes = dustMotes(140, new THREE.Vector3(4.6, 2.4, 4.0), 12);
    // placeholder refs, assigned in build()
    this.clockHands = { hour: new THREE.Group(), minute: new THREE.Group(), second: new THREE.Group() };
    this.lampLight = new THREE.SpotLight();
    this.lampPoint = new THREE.PointLight();
    this.lampBulbMat = new THREE.MeshStandardMaterial();
    this.screenMat = new THREE.MeshBasicMaterial();
    this.screenLight = new THREE.RectAreaLight();
    this.screenPoint = new THREE.PointLight();
  }

  private add(obj: THREE.Object3D, parent: THREE.Object3D = this.group): void {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    parent.add(obj);
  }

  private async build(): Promise<void> {
    const W = ROOM.width, D = ROOM.depth, H = ROOM.height, T = ROOM.wallThickness;
    const plaster = this.mats.get('plaster', 0.45);
    const floorMat = this.mats.get('woodFloor', 0.55);
    const darkWood = this.mats.get('woodDark', 1.1);
    const metal = this.mats.solid({ color: 0x2b2f36, roughness: 0.42, metalness: 0.85 });
    const blackPlastic = this.mats.solid({ color: 0x0c0d10, roughness: 0.62, metalness: 0.15 });
    this.wallMaterials.push(plaster);

    /* ---------------------------------------------------------------- shell */
    const floor = new THREE.Mesh(box(W, 0.16, D, { tiles: 0.55 }), floorMat);
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.collision.add({ min: [-W / 2, -0.4, -D / 2], max: [W / 2, 0, D / 2], tag: 'room-floor' });

    const ceiling = new THREE.Mesh(box(W, 0.14, D, { tiles: 0.4 }), this.mats.get('plaster', 0.4));
    ceiling.position.y = H + 0.07;
    ceiling.receiveShadow = true;
    this.group.add(ceiling);
    this.collision.add({ min: [-W / 2, H, -D / 2], max: [W / 2, H + 0.3, D / 2], tag: 'room-ceiling' });

    // back wall (-Z) and front wall (+Z) with a door opening in front
    const backWall = new THREE.Mesh(box(W, H, T, { tiles: 0.45 }), plaster);
    backWall.position.set(0, H / 2, -D / 2 - T / 2);
    this.group.add(backWall);
    this.collision.add({ min: [-W / 2, 0, -D / 2 - T], max: [W / 2, H, -D / 2], tag: 'room-wall' });

    const leftWall = new THREE.Mesh(box(T, H, D, { tiles: 0.45 }), plaster);
    leftWall.position.set(-W / 2 - T / 2, H / 2, 0);
    this.group.add(leftWall);
    this.collision.add({ min: [-W / 2 - T, 0, -D / 2], max: [-W / 2, H, D / 2], tag: 'room-wall' });

    // right wall with a window opening (x = +W/2), window centred at z = 0.5
    const windowW = 1.4, windowH = 1.28, windowY = 1.62, windowZ = 0.55;
    this.buildWallWithHole(
      W, H, D, T, new THREE.Vector3(windowW, windowH, 0), windowZ, windowY, plaster,
    );
    this.collision.add({ min: [W / 2, 0, -D / 2], max: [W / 2 + T, H, windowZ - windowW / 2], tag: 'room-wall' });
    this.collision.add({ min: [W / 2, 0, windowZ + windowW / 2], max: [W / 2 + T, H, D / 2], tag: 'room-wall' });
    this.collision.add({ min: [W / 2, 0, windowZ - windowW / 2], max: [W / 2 + T, windowY - windowH / 2, windowZ + windowW / 2], tag: 'room-wall' });
    this.collision.add({ min: [W / 2, windowY + windowH / 2, windowZ - windowW / 2], max: [W / 2 + T, H, windowZ + windowW / 2], tag: 'room-wall' });

    // front wall with door opening at x = -1.5
    const doorW = 0.94, doorH = 2.06, doorX = -1.5;
    const frontMat = plaster;
    const fSeg = (cx: number, cy: number, sw: number, sh: number) => {
      const seg = new THREE.Mesh(box(sw, sh, T, { tiles: 0.45 }), frontMat);
      seg.position.set(cx, cy, D / 2 + T / 2);
      this.group.add(seg);
    };
    fSeg((-W / 2 + (doorX - doorW / 2)) / 2, H / 2, doorX - doorW / 2 + W / 2, H);
    fSeg(((doorX + doorW / 2) + W / 2) / 2, H / 2, W / 2 - doorX - doorW / 2, H);
    fSeg(doorX, (doorH + H) / 2, doorW, H - doorH);
    this.collision.add({ min: [-W / 2, 0, D / 2], max: [doorX - doorW / 2, H, D / 2 + T], tag: 'room-wall' });
    this.collision.add({ min: [doorX - doorW / 2, 0, D / 2], max: [doorX + doorW / 2, doorH, D / 2 + T], tag: 'room-door' });
    this.collision.add({ min: [doorX + doorW / 2, 0, D / 2], max: [W / 2, H, D / 2 + T], tag: 'room-wall' });
    this.collision.add({ min: [doorX - doorW / 2, doorH, D / 2], max: [doorX + doorW / 2, H, D / 2 + T], tag: 'room-wall' });

    // door leaf (closed, slightly ajar look), frame and handle
    const door = new THREE.Mesh(box(doorW - 0.04, doorH - 0.03, 0.045, { tiles: 1.2 }), darkWood);
    door.position.set(doorX, doorH / 2, D / 2 - 0.03);
    this.add(door);
    const frameMat = this.mats.solid({ color: 0xb9b2a6, roughness: 0.8 });
    this.add(
      this.frameBoxes(doorX, doorH, doorW, D / 2 - 0.01, T, frameMat),
    );
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), metal);
    handle.position.set(doorX + doorW / 2 - 0.11, 1.02, D / 2 - 0.09);
    this.group.add(handle);

    // baseboards
    const baseMat = this.mats.solid({ color: 0xb8b2a4, roughness: 0.75 });
    const baseH = 0.085;
    const baseFront = new THREE.Mesh(box(W, baseH, 0.02, { tiles: 2 }), baseMat);
    baseFront.position.set(0, baseH / 2, D / 2 - 0.012);
    this.group.add(baseFront);
    const baseBack = baseFront.clone();
    baseBack.position.z = -D / 2 + 0.012;
    this.group.add(baseBack);
    const baseLeft = new THREE.Mesh(box(0.02, baseH, D, { tiles: 2 }), baseMat);
    baseLeft.position.set(-W / 2 + 0.012, baseH / 2, 0);
    this.group.add(baseLeft);
    const baseRight = baseLeft.clone();
    baseRight.position.x = W / 2 - 0.012;
    this.group.add(baseRight);

    /* ---------------------------------------------------------------- window */
    this.buildWindow(windowW, windowH, windowY, windowZ, W, D);

    /* ---------------------------------------------------------------- desk */
    const deskGroup = new THREE.Group();
    deskGroup.position.copy(ROOM.deskPos);
    const top = new THREE.Mesh(box(ROOM.deskSize.x, ROOM.deskSize.y, ROOM.deskSize.z, { tiles: 1.4 }), darkWood);
    top.castShadow = true;
    top.receiveShadow = true;
    deskGroup.add(top);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(box(0.05, 0.73, 0.05, { tiles: 3 }), metal);
        leg.position.set(sx * (ROOM.deskSize.x / 2 - 0.06), -0.385, sz * (ROOM.deskSize.z / 2 - 0.06));
        leg.castShadow = true;
        deskGroup.add(leg);
      }
    }
    const modesty = new THREE.Mesh(box(ROOM.deskSize.x - 0.16, 0.18, 0.03, { tiles: 1.5 }), darkWood);
    modesty.position.set(0, -0.28, ROOM.deskSize.z / 2 - 0.1);
    deskGroup.add(modesty);
    this.group.add(deskGroup);
    this.collision.add({
      min: [ROOM.deskPos.x - ROOM.deskSize.x / 2, 0, ROOM.deskPos.z - ROOM.deskSize.z / 2],
      max: [ROOM.deskPos.x + ROOM.deskSize.x / 2, ROOM.deskPos.y, ROOM.deskPos.z + ROOM.deskSize.z / 2],
      tag: 'desk',
    });
    this.suction.push(deskGroup);

    /* ------------------------------------------------------------- monitor */
    const monitor = new THREE.Group();
    monitor.position.copy(ROOM.monitorPos);
    monitor.rotation.y = -0.06;
    const bezel = new THREE.Mesh(box(ROOM.monitorSize.x + 0.03, ROOM.monitorSize.y + 0.03, 0.028, { tiles: 3 }), blackPlastic);
    bezel.castShadow = true;
    monitor.add(bezel);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 640;
    this.screenCtx = canvas.getContext('2d')!;
    const screenTexture = new THREE.CanvasTexture(canvas);
    screenTexture.colorSpace = THREE.SRGBColorSpace;
    screenTexture.anisotropy = 8;
    this.screenMat = new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.monitorSize.x, ROOM.monitorSize.y), this.screenMat);
    screen.position.z = 0.0165;
    screen.name = 'monitor-screen';
    monitor.add(screen);
    // stand
    const neck = new THREE.Mesh(box(0.05, 0.26, 0.06, { tiles: 3 }), blackPlastic);
    neck.position.set(0, -ROOM.monitorSize.y / 2 - 0.11, -0.03);
    monitor.add(neck);
    const foot = new THREE.Mesh(box(0.3, 0.018, 0.2, { tiles: 3 }), metal);
    foot.position.set(0, -ROOM.monitorSize.y / 2 - 0.24, 0.02);
    monitor.add(foot);
    this.group.add(monitor);
    this.suction.push(monitor);

    /* --------------------------------------------------- keyboard / mouse */
    const keyboard = new THREE.Group();
    const kbBase = new THREE.Mesh(box(0.42, 0.016, 0.14, { tiles: 2 }), blackPlastic);
    keyboard.add(kbBase);
    const keyMat = this.mats.solid({ color: 0x1b1d21, roughness: 0.55 });
    const keyGeo = new THREE.BoxGeometry(0.022, 0.008, 0.022);
    const keyInst = new THREE.InstancedMesh(keyGeo, keyMat, 15 * 5);
    let ki = 0;
    const km = new THREE.Matrix4();
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 15; col++) {
        km.makeTranslation(-0.19 + col * 0.027, 0.013, -0.05 + row * 0.025);
        keyInst.setMatrixAt(ki++, km);
      }
    }
    keyboard.add(keyInst);
    keyboard.position.set(-0.33, ROOM.deskPos.y + ROOM.deskSize.y / 2 + 0.008, -1.52);
    keyboard.rotation.y = 0.03;
    this.group.add(keyboard);
    this.suction.push(keyboard);

    const mouse = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.028, 0.05, 4, 10),
      this.mats.solid({ color: 0x14161a, roughness: 0.42, metalness: 0.3 }),
    );
    mouse.rotation.x = Math.PI / 2;
    mouse.rotation.z = 0.1;
    mouse.position.set(0.1, ROOM.deskPos.y + ROOM.deskSize.y / 2 + 0.028, -1.53);
    mouse.castShadow = true;
    this.group.add(mouse);
    this.suction.push(mouse);
    this.add(cable([
      new THREE.Vector3(0.1, ROOM.deskPos.y + 0.028, -1.53),
      new THREE.Vector3(0.16, ROOM.deskPos.y + 0.02, -1.62),
      new THREE.Vector3(0.08, ROOM.deskPos.y + 0.006, -1.78),
      new THREE.Vector3(-0.05, 0.02, -1.95),
      new THREE.Vector3(-0.1, 0.008, -2.02),
    ], 0.0045));

    /* ------------------------------------------------------------- PC tower */
    const pc = new THREE.Group();
    const pcCase = new THREE.Mesh(box(0.21, 0.46, 0.44, { tiles: 2.2 }), blackPlastic);
    pc.add(pcCase);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a1018, roughness: 0.08, metalness: 0, transmission: 0.55, thickness: 0.02,
        transparent: true, opacity: 0.75, emissive: 0x0a2b55, emissiveIntensity: 0.6,
      }),
    );
    glass.position.set(0.106, 0, 0);
    glass.rotation.y = Math.PI / 2;
    pc.add(glass);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x3fa9ff, toneMapped: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), ledMat);
    led.position.set(0.108, 0.2, 0.16);
    pc.add(led);
    const fanRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.008, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0x1a5cff, toneMapped: false }),
    );
    fanRing.position.set(0.108, -0.02, 0.02);
    fanRing.rotation.y = Math.PI / 2;
    pc.add(fanRing);
    const fanBlades = new THREE.Mesh(
      new THREE.CircleGeometry(0.062, 20),
      new THREE.MeshBasicMaterial({ color: 0x0b1e33, toneMapped: false }),
    );
    fanBlades.position.copy(fanRing.position);
    fanBlades.rotation.y = Math.PI / 2;
    pc.add(fanBlades);
    pc.position.set(0.5, 0.23, -1.95);
    this.group.add(pc);
    this.suction.push(pc);
    this.collision.add({ min: [0.38, 0, -2.17], max: [0.62, 0.46, -1.73], tag: 'pc-tower' });

    /* --------------------------------------------------------------- chair */
    const chair = await this.store.instantiate('sheenChair', {
      position: new THREE.Vector3(-0.28, 0, -0.92),
      rotationY: Math.PI + 0.42,
      name: 'desk-chair',
    });
    this.add(chair);
    this.suction.push(chair);
    this.collision.add({ min: [-0.72, 0, -1.32], max: [0.16, 0.79, -0.52], tag: 'chair' });

    /* ------------------------------------------------------------ desk items */
    const lamp = await this.store.instantiate('stainedGlassLamp', {
      position: new THREE.Vector3(-1.14, ROOM.deskPos.y + ROOM.deskSize.y / 2, -1.78),
      rotationY: 0.4,
    });
    this.add(lamp);
    this.suction.push(lamp);

    const bottle = await this.store.instantiate('waterBottle', {
      position: new THREE.Vector3(0.29, ROOM.deskPos.y + ROOM.deskSize.y / 2, -1.9),
      rotationY: 0.8,
    });
    this.add(bottle);
    this.suction.push(bottle);

    const cup = await this.store.instantiate('teacup', {
      position: new THREE.Vector3(0.16, ROOM.deskPos.y + ROOM.deskSize.y / 2, -1.55),
      rotationY: 2.1,
    });
    this.add(cup);
    this.suction.push(cup);

    // papers on the desk
    const paperMat = this.mats.get('paper', 2.2);
    const paperGeo = new THREE.PlaneGeometry(0.21, 0.297);
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(paperGeo, paperMat);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = this.rng.float(-0.5, 0.5);
      p.position.set(-0.82 + i * 0.06, ROOM.deskPos.y + ROOM.deskSize.y / 2 + 0.003 + i * 0.0015, -1.6 + i * 0.03);
      p.receiveShadow = true;
      this.group.add(p);
      this.suction.push(p);
    }

    // headphones
    const phones = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.009, 6, 20, Math.PI), blackPlastic);
    band.position.y = 0.02;
    phones.add(band);
    for (const s of [-1, 1]) {
      const cupMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.03, 16), blackPlastic);
      cupMesh.rotation.z = Math.PI / 2;
      cupMesh.position.set(s * 0.085, -0.01, 0);
      phones.add(cupMesh);
    }
    phones.position.set(-0.88, ROOM.deskPos.y + ROOM.deskSize.y / 2 + 0.05, -1.97);
    this.add(phones);
    this.suction.push(phones);

    /* ---------------------------------------------------------------- lamp light */
    this.lampLight = new THREE.SpotLight(0xffb070, 2.6, 4.6, 1.15, 0.55, 1.6);
    this.lampLight.position.set(-1.14, ROOM.deskPos.y + 0.62, -1.78);
    this.lampLight.target.position.set(-0.85, 0.3, -1.4);
    this.lampLight.castShadow = true;
    this.lampLight.shadow.mapSize.set(1024, 1024);
    this.lampLight.shadow.camera.near = 0.15;
    this.lampLight.shadow.camera.far = 6;
    this.lampLight.shadow.bias = -0.0008;
    this.lampLight.shadow.radius = 3;
    this.lampLight.shadow.normalBias = 0.02;
    this.group.add(this.lampLight, this.lampLight.target);

    this.lampPoint = new THREE.PointLight(0xff9a4d, 0.9, 3.2, 1.8);
    this.lampPoint.position.set(-1.14, ROOM.deskPos.y + 0.55, -1.78);
    this.group.add(this.lampPoint);

    this.lampBulbMat = new THREE.MeshStandardMaterial({
      color: 0xffd9a8, emissive: 0xffb066, emissiveIntensity: 3.2, roughness: 0.6,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), this.lampBulbMat);
    bulb.position.set(-1.14, ROOM.deskPos.y + 0.5, -1.78);
    this.group.add(bulb);

    /* ------------------------------------------------------------ screen light */
    this.screenLight = new THREE.RectAreaLight(0x5f8cff, 3.1, ROOM.monitorSize.x, ROOM.monitorSize.y);
    this.screenLight.position.set(ROOM.monitorPos.x, ROOM.monitorPos.y, ROOM.monitorPos.z + 0.05);
    this.screenLight.lookAt(ROOM.monitorPos.x, ROOM.monitorPos.y, ROOM.monitorPos.z + 2);
    this.group.add(this.screenLight);
    this.screenPoint = new THREE.PointLight(0x3d6ce0, 1.25, 4.6, 1.7);
    this.screenPoint.position.set(ROOM.monitorPos.x, ROOM.monitorPos.y - 0.05, ROOM.monitorPos.z + 0.55);
    this.group.add(this.screenPoint);

    /* --------------------------------------------------------------- moon light */
    const moon = new THREE.DirectionalLight(0x6b8fc9, 0.5);
    moon.position.set(7, 5.4, 4.6);
    moon.target.position.set(0.4, 0.8, 0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -4;
    moon.shadow.camera.right = 4;
    moon.shadow.camera.top = 4;
    moon.shadow.camera.bottom = -4;
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 22;
    moon.shadow.bias = -0.0012;
    moon.shadow.normalBias = 0.02;
    this.group.add(moon, moon.target);

    /* ------------------------------------------------------------------- bed */
    this.buildBed();

    /* ------------------------------------------------------- wardrobe / shelf */
    this.buildWardrobe();
    await this.buildShelf();

    /* ------------------------------------------------------------- nightstand */
    const ns = new THREE.Group();
    const nsTop = new THREE.Mesh(box(0.48, 0.035, 0.42, { tiles: 1.6 }), darkWood);
    nsTop.position.y = 0.52;
    ns.add(nsTop);
    const nsBody = new THREE.Mesh(box(0.44, 0.34, 0.38, { tiles: 1.8 }), darkWood);
    nsBody.position.y = 0.32;
    ns.add(nsBody);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const l = new THREE.Mesh(box(0.035, 0.15, 0.035, { tiles: 3 }), metal);
      l.position.set(sx * 0.19, 0.075, sz * 0.16);
      ns.add(l);
    }
    const drawer = new THREE.Mesh(box(0.4, 0.14, 0.012, { tiles: 2 }), this.mats.solid({ color: 0x3a2a1e, roughness: 0.6 }));
    drawer.position.set(0, 0.36, 0.197);
    ns.add(drawer);
    ns.position.set(2.12, 0, 1.55);
    this.add(ns);
    this.suction.push(ns);
    this.collision.add({ min: [1.82, 0, 1.28], max: [2.42, 0.54, 1.82], tag: 'nightstand' });

    // alarm clock on the nightstand
    const clock = new THREE.Group();
    const clockBody = new THREE.Mesh(box(0.16, 0.075, 0.06, { tiles: 3 }), blackPlastic);
    clock.add(clockBody);
    const clockFaceTex = this.mats.textTexture('clockface', (ctx, s) => {
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ff3b30';
      ctx.font = `bold ${s * 0.36}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('03:47', s / 2, s / 2);
    }, 256);
    const clockFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.06),
      new THREE.MeshBasicMaterial({ map: clockFaceTex, toneMapped: false }),
    );
    clockFace.position.z = 0.031;
    clock.add(clockFace);
    clock.position.set(2.09, 0.575, 1.5);
    clock.rotation.y = -0.5;
    this.group.add(clock);
    this.suction.push(clock);
    const clockLight = new THREE.PointLight(0xff2a1a, 0.16, 0.9, 2);
    clockLight.position.set(2.06, 0.58, 1.44);
    this.group.add(clockLight);

    /* ------------------------------------------------------------- wall clock */
    this.buildWallClock();

    /* ------------------------------------------------------------ rug / clutter */
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.7),
      this.mats.get('carpet', 1.6, { color: 0x6a6157 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.25, 0.004, 0.28);
    rug.receiveShadow = true;
    this.group.add(rug);
    this.suction.push(rug);

    // laundry basket + clothes
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.36, 12, 1, true), this.mats.get('fabric', 2.4));
    basket.position.set(-2.1, 0.18, 0.15);
    basket.material = new THREE.MeshStandardMaterial({ color: 0x6c6255, roughness: 0.95, side: THREE.DoubleSide });
    basket.castShadow = true;
    basket.receiveShadow = true;
    this.group.add(basket);
    this.suction.push(basket);
    const clothes = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(0.22 - i * 0.03, 10, 8),
        this.mats.solid({ color: [0x2d3540, 0x3f3a33, 0x24282e][i], roughness: 0.95 }),
      );
      c.scale.set(1.1, 0.35 + i * 0.1, 0.9);
      c.position.set(-2.05 + this.rng.float(-0.1, 0.1), 0.06 + i * 0.05, 0.35 + i * 0.08);
      c.castShadow = true;
      clothes.add(c);
    }
    this.group.add(clothes);
    this.suction.push(clothes);

    // slippers by the door
    for (const s of [-1, 1]) {
      const slipper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.14, 4, 10), this.mats.get('fabric', 4, { color: 0x555b62 }));
      slipper.rotation.z = Math.PI / 2;
      slipper.rotation.y = s * 0.2;
      slipper.scale.set(1, 0.55, 1.1);
      slipper.position.set(-1.15 + s * 0.16, 0.035, 1.55);
      slipper.castShadow = true;
      this.group.add(slipper);
    }

    // cardboard boxes in the corner
    const boxMat = this.mats.get('paper', 1.2, { color: 0xb08b5e });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(box(0.42 - i * 0.04, 0.3, 0.36, { tiles: 2 }), boxMat);
      b.position.set(-2.18 + i * 0.03, 0.15 + i * 0.3, -1.72 + i * 0.04);
      b.rotation.y = this.rng.float(-0.2, 0.2);
      this.add(b);
      this.suction.push(b);
    }

    // wall posters
    this.buildPosters();

    // dust
    this.group.add(this.motes);

    /* ------------------------------------------------ anomalies left behind */
    this.buildAnomalyProps();

    /* -------------------------------------------------------------- lights rig */
    this.lampOn = true;
    this.screenMode = 'desktop';
    this.drawScreen();
    this.updateClock(0);

    this.result = {
      group: this.group,
      interactables: [],
      monitor,
      screen: screen,
      screenCanvas: canvas,
      screenTexture,
      lights: {
        screenArea: this.screenLight,
        screenPoint: this.screenPoint,
        lamp: this.lampLight,
        lampPoint: this.lampPoint,
        moon,
        clock: clockLight,
      },
      suctionProps: this.suction,
      clockHands: this.clockHands,
      update: (dt, t) => this.update(dt, t),
      setScreenMode: (m) => this.setScreenMode(m),
      setAnomaly: (l) => this.setAnomaly(l),
      setLamp: (on) => this.setLamp(on),
      dispose: () => this.dispose(),
    };
  }

  /** Right wall built as four panels around the window opening. */
  private buildWallWithHole(
    W: number, H: number, D: number, T: number,
    win: THREE.Vector3, winZ: number, winY: number, mat: THREE.Material,
  ): void {
    const x = W / 2 + T / 2;
    const z0 = winZ - win.x / 2, z1 = winZ + win.x / 2;
    const y0 = winY - win.y / 2, y1 = winY + win.y / 2;
    const segs: [number, number, number, number][] = [
      [-D / 2, z0, 0, H],       // z0,z1,y0,y1
      [z1, D / 2, 0, H],
      [z0, z1, 0, y0],
      [z0, z1, y1, H],
    ];
    for (const [a, b, c, d] of segs) {
      const w = b - a;
      const h = d - c;
      if (w <= 0.001 || h <= 0.001) continue;
      const mesh = new THREE.Mesh(box(T, h, w, { tiles: 0.45 }), mat);
      mesh.position.set(x, (c + d) / 2, (a + b) / 2);
      this.group.add(mesh);
    }
    this.suction.push(...this.group.children.slice(-4));
  }

  private frameBoxes(
    x: number, h: number, w: number, z: number, T: number, mat: THREE.Material,
  ): THREE.Group {
    const g = new THREE.Group();
    const t = 0.05;
    const parts = [
      [0, h + t / 2, w + t * 2, t],
      [-w / 2 - t / 2, h / 2, t, h],
      [w / 2 + t / 2, h / 2, t, h],
    ];
    for (const [px, py, pw, ph] of parts) {
      const m = new THREE.Mesh(box(pw, ph, T + 0.02, { tiles: 2 }), mat);
      m.position.set(x + px, py, z);
      g.add(m);
    }
    return g;
  }

  private buildWindow(
    w: number, h: number, y: number, zc: number, W: number, D: number,
  ): void {
    const x = W / 2;
    const frameMat = this.mats.solid({ color: 0x9a9488, roughness: 0.72, metalness: 0.1 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x8fb6e8, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16,
      transmission: 0.6, thickness: 0.01, envMapIntensity: 1.4,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, h - 0.08), glassMat);
    glass.rotation.y = -Math.PI / 2;
    glass.position.set(x - 0.02, y, zc);
    this.group.add(glass);

    // frame: outer + mullions
    const t = 0.055;
    const addFrame = (fw: number, fh: number, fd: number, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(box(fd, fh, fw, { tiles: 2 }), frameMat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      this.group.add(m);
      this.suction.push(m);
    };
    addFrame(w, t, 0.09, x, y + h / 2, zc);
    addFrame(w, t, 0.09, x, y - h / 2, zc);
    addFrame(t, h, 0.09, x, y, zc - w / 2);
    addFrame(t, h, 0.09, x, y, zc + w / 2);
    addFrame(0.035, h - 0.1, 0.05, x - 0.01, y, zc);
    addFrame(w - 0.1, 0.035, 0.05, x - 0.01, y, zc);

    // sill
    const sill = new THREE.Mesh(box(0.22, 0.05, w + 0.18, { tiles: 1.6 }), this.mats.get('woodDark', 1.6));
    sill.position.set(x - 0.1, y - h / 2 - 0.03, zc);
    this.group.add(sill);
    this.suction.push(sill);
    this.collision.add({ min: [x - 0.22, y - h / 2 - 0.06, zc - w / 2 - 0.09], max: [x, y - h / 2 + 0.02, zc + w / 2 + 0.09], tag: 'sill' });

    // night city backdrop (drawn, not a flat image background: it sits behind real geometry)
    const cityTex = this.mats.textTexture('nightcity', (ctx, s) => {
      const grad = ctx.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, '#050912');
      grad.addColorStop(0.55, '#0a1626');
      grad.addColorStop(1, '#132238');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      // haze near horizon
      const hz = ctx.createRadialGradient(s * 0.5, s * 0.78, 10, s * 0.5, s * 0.78, s * 0.7);
      hz.addColorStop(0, 'rgba(70,110,160,0.22)');
      hz.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, s, s);
      const rng = new Rng(99);
      // distant towers
      for (let layer = 0; layer < 3; layer++) {
        const alpha = [0.45, 0.65, 0.9][layer];
        const base = s * (0.62 + layer * 0.09);
        let x = 0;
        while (x < s) {
          const bw = s * (0.03 + rng.float(0, 0.09));
          const bh = s * (0.1 + rng.float(0, 0.34)) * (1 - layer * 0.1);
          ctx.fillStyle = `rgba(${6 + layer * 4},${10 + layer * 5},${18 + layer * 7},${alpha})`;
          ctx.fillRect(x, base - bh, bw, bh + s);
          // windows
          for (let wy = base - bh + 8; wy < base - 4; wy += 9) {
            for (let wx = x + 3; wx < x + bw - 3; wx += 7) {
              if (rng.bool(0.16)) {
                ctx.fillStyle = rng.bool(0.7) ? 'rgba(255,205,140,0.55)' : 'rgba(150,200,255,0.4)';
                ctx.fillRect(wx, wy, 2.4, 2.2);
              }
            }
          }
          x += bw + s * 0.008;
        }
      }
      // rain streaks
      for (let i = 0; i < 220; i++) {
        ctx.strokeStyle = `rgba(160,190,230,${rng.float(0.03, 0.12)})`;
        ctx.lineWidth = rng.float(0.5, 1.4);
        const rx = rng.float(0, s), ry = rng.float(0, s);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + rng.float(10, 30));
        ctx.stroke();
      }
      // street glow
      const glow = ctx.createRadialGradient(s * 0.62, s * 0.92, 2, s * 0.62, s * 0.92, s * 0.35);
      glow.addColorStop(0, 'rgba(255,180,110,0.28)');
      glow.addColorStop(1, 'rgba(255,180,110,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, s, s);
    }, 1024);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 3.4, h + 3.0),
      new THREE.MeshBasicMaterial({ map: cityTex, toneMapped: false, color: 0xbfd6ff }),
    );
    backdrop.rotation.y = -Math.PI / 2;
    backdrop.position.set(x + 1.5, y + 0.1, zc);
    this.group.add(backdrop);

    // curtains
    const curtainMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const cw = 0.5;
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(cw, h + 0.5, 8, 6), curtainMat);
      const pos = curtain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        pos.setZ(i, Math.sin(px * 14) * 0.035 + Math.sin(py * 3) * 0.012);
      }
      curtain.geometry.computeVertexNormals();
      curtain.rotation.y = -Math.PI / 2;
      curtain.position.set(x - 0.16, y + 0.1, zc + s * (w / 2 + 0.18));
      curtain.castShadow = true;
      this.group.add(curtain);
      this.suction.push(curtain);
    }
    // curtain rod
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, w + 0.9, 8), frameMat);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(x - 0.16, y + h / 2 + 0.28, zc);
    this.group.add(rod);

    // vase with flowers on the sill
    this.store.instantiate('glassVase', {
      position: new THREE.Vector3(x - 0.12, y - h / 2, zc - 0.45),
      rotationY: -1.2,
      castShadow: true,
    }).then((v) => { this.group.add(v); this.suction.push(v); }).catch(() => {});
    void D;
  }

  private buildBed(): void {
    const bed = new THREE.Group();
    const W = 1.42, L = 2.0;
    const frameMat = this.mats.get('woodDark', 1.4);
    const mattressMat = this.mats.get('fabric', 1.1, { color: 0x8a8f96 });
    const base = new THREE.Mesh(box(W, 0.26, L, { tiles: 1.2 }), frameMat);
    base.position.y = 0.18;
    bed.add(base);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.22, L - 0.06, 3, 2, 6), mattressMat);
    mattress.position.y = 0.42;
    distortBox(mattress.geometry, 0.012);
    bed.add(mattress);
    // duvet
    const duvet = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.16, L * 0.72, 6, 2, 10), this.mats.get('fabric', 0.8, { color: 0x5b6470 }));
    duvet.position.set(0, 0.55, L * 0.12);
    distortBox(duvet.geometry, 0.03);
    bed.add(duvet);
    // pillows
    for (let i = 0; i < 2; i++) {
      const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), this.mats.get('paper', 2.4, { color: 0xcfd3d8 }));
      pillow.scale.set(1.1, 0.32, 0.7);
      pillow.position.set((i - 0.5) * 0.55, 0.55, -L / 2 + 0.34);
      pillow.rotation.z = (i - 0.5) * 0.1;
      bed.add(pillow);
    }
    // headboard
    const head = new THREE.Mesh(box(W, 0.85, 0.06, { tiles: 1.5 }), frameMat);
    head.position.set(0, 0.5, -L / 2 - 0.03);
    bed.add(head);
    // legs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(box(0.06, 0.12, 0.06, { tiles: 3 }), frameMat);
      leg.position.set(sx * (W / 2 - 0.08), 0.05, sz * (L / 2 - 0.1));
      bed.add(leg);
    }
    bed.position.set(1.72, 0, 0.35);
    this.add(bed);
    this.suction.push(bed);
    this.collision.add({ min: [0.98, 0, -0.7], max: [2.46, 0.66, 1.38], tag: 'bed' });

    // clothes on the bed, phone charger cable
    const shirt = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), this.mats.solid({ color: 0x394450, roughness: 0.95 }));
    shirt.scale.set(1.2, 0.22, 0.9);
    shirt.position.set(1.35, 0.66, 0.55);
    shirt.castShadow = true;
    this.group.add(shirt);
    this.suction.push(shirt);
    this.add(cable([
      new THREE.Vector3(2.1, 0.6, 1.4),
      new THREE.Vector3(1.9, 0.52, 1.1),
      new THREE.Vector3(1.7, 0.5, 0.8),
      new THREE.Vector3(1.5, 0.48, 0.66),
    ], 0.004));
  }

  private buildWardrobe(): void {
    const g = new THREE.Group();
    const wood = this.mats.get('woodDark', 1.2);
    const body = new THREE.Mesh(box(1.12, 2.0, 0.6, { tiles: 1.2 }), wood);
    body.position.y = 1.0;
    g.add(body);
    const doorMat = this.mats.get('woodDark', 1.4, { color: 0xd8cbb8 });
    for (const s of [-1, 1]) {
      const door = new THREE.Mesh(box(0.52, 1.92, 0.025, { tiles: 1.5 }), doorMat);
      door.position.set(s * 0.27, 1.02, 0.31);
      g.add(door);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), this.mats.solid({ color: 0xc8c2b6, metalness: 0.9, roughness: 0.3 }));
      handle.position.set(s * 0.06, 1.02, 0.335);
      g.add(handle);
    }
    g.position.set(-2.02, 0, 1.15);
    this.add(g);
    this.suction.push(g);
    this.collision.add({ min: [-2.6, 0, 0.85], max: [-1.46, 2.02, 1.45], tag: 'wardrobe' });

    // a framed photo on top
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.02), this.mats.solid({ color: 0x2a2a2c, roughness: 0.5 }));
    frame.position.set(-2.02, 2.11, 1.1);
    frame.rotation.y = 0.3;
    this.group.add(frame);
  }

  private async buildShelf(): Promise<void> {
    const g = new THREE.Group();
    const wood = this.mats.get('woodDark', 1.3);
    for (const y of [0.28, 0.72, 1.16, 1.6]) {
      const shelfBoard = new THREE.Mesh(box(1.5, 0.035, 0.32, { tiles: 1.6 }), wood);
      shelfBoard.position.set(0, y, 0);
      g.add(shelfBoard);
    }
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(box(0.04, 1.66, 0.32, { tiles: 1.6 }), wood);
      side.position.set(s * 0.75, 0.83, 0);
      g.add(side);
    }
    // backing panel
    const backPanel = new THREE.Mesh(box(1.5, 1.66, 0.015, { tiles: 1.4 }), this.mats.get('woodDark', 1.6, { color: 0x8a7c6a }));
    backPanel.position.set(0, 0.83, -0.15);
    g.add(backPanel);
    g.position.set(1.36, 0, -2.0);
    this.add(g);
    this.suction.push(g);
    this.collision.add({ min: [0.6, 0, -2.2], max: [2.12, 1.7, -1.84], tag: 'shelf' });

    // books on shelves
    for (let i = 0; i < 3; i++) {
      for (const inst of bookRow(9, 0.42, 0.22, 0.16, 11 + i)) {
        inst.position.set(0.92, [0.3, 0.74, 1.18][i], -2.0);
        inst.rotation.y = -Math.PI / 2;
        this.group.add(inst);
      }
    }
    // props on shelf
    const boombox = await this.store.instantiate('boombox', {
      position: new THREE.Vector3(1.82, 0.735, -2.0),
      rotationY: -Math.PI / 2 + 0.15,
      scale: 17,
    });
    this.add(boombox);
    this.suction.push(boombox);
    const toy = await this.store.instantiate('toyCar', {
      position: new THREE.Vector3(1.5, 0.735 + 0.002, -1.98),
      rotationY: -Math.PI / 2 - 0.3,
    });
    this.add(toy);
    this.suction.push(toy);
    const helmet = await this.store.instantiate('flightHelmet', {
      position: new THREE.Vector3(1.35, 1.17, -2.0),
      rotationY: 0.5,
      scale: 0.95,
    });
    this.add(helmet);
    this.suction.push(helmet);
  }

  private buildWallClock(): void {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.045, 28), this.mats.solid({ color: 0x2a2724, roughness: 0.55, metalness: 0.2 }));
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    const faceTex = this.mats.textTexture('wallclock', (ctx, s) => {
      ctx.fillStyle = '#e8e4dc';
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r0 = s * 0.4, r1 = s * 0.44;
        ctx.save();
        ctx.translate(s / 2, s / 2);
        ctx.rotate(a);
        ctx.fillRect(-s * 0.004, -r1, s * 0.008, r1 - r0);
        ctx.restore();
      }
      ctx.fillStyle = '#8a8378';
      ctx.font = `600 ${s * 0.1}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText('12', s / 2, s * 0.2);
    }, 512);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.178, 32), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.65 }));
    face.position.z = 0.024;
    g.add(face);
    const handMat = this.mats.solid({ color: 0x111111, roughness: 0.5 });
    const hour = new THREE.Mesh(box(0.012, 0.1, 0.006, { tiles: 1 }), handMat);
    hour.geometry.translate(0, 0.045, 0);
    const minute = new THREE.Mesh(box(0.009, 0.145, 0.005, { tiles: 1 }), handMat);
    minute.geometry.translate(0, 0.068, 0);
    const second = new THREE.Mesh(box(0.0045, 0.155, 0.004, { tiles: 1 }), this.mats.solid({ color: 0x9a2b22, roughness: 0.5 }));
    second.geometry.translate(0, 0.07, 0);
    for (const h of [hour, minute, second]) {
      h.position.z = 0.032;
      g.add(h);
    }
    const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), this.mats.solid({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 }));
    pivot.position.z = 0.036;
    g.add(pivot);
    g.position.set(1.35, 2.28, -2.14);
    g.rotation.y = 0;
    this.group.add(g);
    this.clockHands = { hour, minute, second };
    this.clockFace = g;
  }

  private buildPosters(): void {
    // poster 1: band / film poster above the desk
    const posterTex = this.mats.textTexture('poster1', (ctx, s) => {
      ctx.fillStyle = '#101318';
      ctx.fillRect(0, 0, s, s);
      const grad = ctx.createLinearGradient(0, 0, s, s);
      grad.addColorStop(0, 'rgba(60,110,180,0.6)');
      grad.addColorStop(1, 'rgba(10,10,14,0.9)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(210,230,255,0.85)';
      ctx.lineWidth = s * 0.012;
      ctx.beginPath();
      for (let i = 0; i < 60; i++) {
        const x = s * 0.1 + (i / 60) * s * 0.8;
        const y = s * 0.5 + Math.sin(i * 0.4) * s * 0.12 * Math.exp(-i * 0.02);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#e9eef7';
      ctx.font = `700 ${s * 0.11}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('SIGNAL', s / 2, s * 0.28);
      ctx.fillText('LOST', s / 2, s * 0.4);
      ctx.font = `400 ${s * 0.035}px Helvetica, Arial, sans-serif`;
      ctx.fillStyle = 'rgba(200,215,235,0.7)';
      ctx.fillText('NOCTURNE PICTURES', s / 2, s * 0.86);
    }, 512);
    const p1 = poster(0.46, 0.66, posterTex, this.mats.solid({ color: 0x1b1b1d, roughness: 0.6 }));
    p1.position.set(-1.4, 1.72, -2.18);
    this.group.add(p1);

    // poster 2: handwritten note / schedule with a sticky note
    const noteTex = this.mats.textTexture('note', (ctx, s) => {
      ctx.fillStyle = '#e5dfd2';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(90,110,140,0.35)';
      ctx.lineWidth = 1;
      for (let y = s * 0.12; y < s; y += s * 0.065) {
        ctx.beginPath(); ctx.moveTo(s * 0.06, y); ctx.lineTo(s * 0.94, y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,40,55,0.82)';
      ctx.font = `italic ${s * 0.055}px "Comic Sans MS", cursive, sans-serif`;
      const lines = ['if it happens again -', 'do NOT click it.', '', 'leave the room.', 'sleep.', 'try again tomorrow.'];
      lines.forEach((l, i) => ctx.fillText(l, s * 0.1, s * 0.2 + i * s * 0.1));
      ctx.fillStyle = '#d9c34a';
      ctx.fillRect(s * 0.55, s * 0.62, s * 0.3, s * 0.22);
      ctx.fillStyle = '#2a2a2a';
      ctx.font = `bold ${s * 0.035}px monospace`;
      ctx.fillText('WAKE', s * 0.6, s * 0.72);
      ctx.fillText('UP', s * 0.62, s * 0.775);
    }, 512);
    const p2 = poster(0.3, 0.4, noteTex, this.mats.solid({ color: 0xd8d2c4, roughness: 0.9 }));
    p2.position.set(-0.35, 1.7, -2.18);
    this.group.add(p2);

    // small shelf photo frames
    const photoTex = this.mats.textTexture('photo', (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, '#5d6a5a');
      g.addColorStop(1, '#20261f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(230,230,220,0.5)';
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.42, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(s * 0.3, s * 0.55, s * 0.4, s * 0.3);
    }, 256);
    const p3 = poster(0.16, 0.2, photoTex, this.mats.solid({ color: 0x2a2a2c, roughness: 0.5 }));
    p3.position.set(-2.12, 1.7, 0.6);
    p3.rotation.y = Math.PI / 2;
    this.group.add(p3);
  }

  private updateClock(t: number): void {
    void t;
    const now = new Date();
    const sec = now.getSeconds();
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;
    this.clockHands.second.rotation.z = -(sec / 60) * Math.PI * 2;
    this.clockHands.minute.rotation.z = -(min / 60) * Math.PI * 2;
    this.clockHands.hour.rotation.z = -(hr / 12) * Math.PI * 2;
  }

  update(dt: number, time: number): void {
    if (this.anomalyOn && this.anomalyShards.length) {
      for (const s of this.anomalyShards) {
        const ph = s.userData.phase as number;
        s.position.y = (s.userData.baseY as number) + Math.sin(time * 1.1 + ph) * 0.02;
        s.rotation.y += dt * 0.25;
        s.rotation.x += dt * 0.11;
      }
    }
    if (this.disposed) return;
    // clock hands
    if (Math.floor(time * 2) !== this.lastSecond) {
      this.updateClock(time);
      this.lastSecond = Math.floor(time * 2);
    }
    // monitor breathing / flicker
    const flicker = 1 + Math.sin(time * 2.1) * 0.012 + Math.sin(time * 13.7) * 0.006;
    this.screenFlicker = flicker;
    this.screenLight.intensity = (this.screenMode === 'off' ? 0.05 : 3.1) * flicker * (this.anomaly > 0 ? 0.8 : 1);
    this.screenPoint.intensity = (this.screenMode === 'off' ? 0.05 : 1.25) * flicker;
    this.screenMat.color.setScalar(this.screenMode === 'off' ? 0.06 : 1);

    // lamp flicker when the anomaly escalates
    if (this.anomaly > 0.4) {
      const n = Math.sin(time * 9.3) * Math.sin(time * 3.7) * Math.sin(time * 17.1);
      const dip = n > 0.55 ? 0.35 : 1;
      this.lampLight.intensity = (this.lampOn ? 2.6 : 0) * dip;
      this.lampPoint.intensity = (this.lampOn ? 0.9 : 0) * dip;
      this.lampBulbMat.emissiveIntensity = (this.lampOn ? 3.2 : 0) * dip;
    }

    // dust motes
    const mat = this.motes.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = time;
    mat.uniforms.uOpacity.value = 0.32 + Math.sin(time * 0.3) * 0.05;

    // subtle idle motion for the screen content (blinking cursor)
    if (this.screenMode === 'desktop') {
      const blink = Math.sin(time * 3.2) > 0;
      if (blink !== this.lastBlink) {
        this.lastBlink = blink;
        this.drawScreen();
      }
    }
    if (this.screenMode === 'bsod' || this.screenMode === 'glitch') {
      if (Math.floor(time * 8) !== this.lastGlitchFrame) {
        this.lastGlitchFrame = Math.floor(time * 8);
        if (Math.random() < 0.3) this.drawScreen();
      }
    }
    this.flickerSeed = time;
  }

  private lastBlink = false;
  private lastGlitchFrame = -1;

  setScreenMode(mode: ScreenMode): void {
    this.screenMode = mode;
    this.drawScreen();
  }

  setLamp(on: boolean): void {
    this.lampOn = on;
    this.lampLight.intensity = on ? 2.6 : 0;
    this.lampPoint.intensity = on ? 0.9 : 0;
    this.lampBulbMat.emissiveIntensity = on ? 3.2 : 0;
  }

  setAnomaly(level: number): void {
    this.anomaly = level;
  }

  /**
   * The bedroom the player comes back to is not the bedroom they left. These props only exist
   * after the fall, and they are subtle: a hairline crack above the desk, four shards of the
   * glitch world still hanging in the air, the chair turned to face the monitor, the poster
   * replaced with the word the monolith kept repeating.
   */
  setReturnAnomaly(on: boolean): void {
    this.anomalyOn = on;
    if (!this.anomalyProps) return;
    this.anomalyProps.visible = on;
    this.chair ??= this.group.getObjectByName('desk-chair') ?? null;
    if (this.chair) {
      this.chair.rotation.y = Math.PI + (on ? 0.12 : 0.42);
      this.chair.userData.returned = on;
    }
  }

  private buildAnomalyProps(): void {
    const g = new THREE.Group();
    g.name = 'room-anomalies';
    g.visible = false;

    // a crack in the plaster above the desk, drawn as an additive line texture
    const crackTex = this.mats.textTexture('return-crack', (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(150, 205, 255, 0.92)';
      ctx.lineWidth = 1.6;
      const pts: [number, number][] = [[s * 0.5, 0], [s * 0.47, s * 0.22], [s * 0.56, s * 0.38], [s * 0.5, s * 0.55], [s * 0.6, s * 0.7], [s * 0.53, s * 1.0]];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(110, 170, 255, 0.55)';
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.38);
      ctx.lineTo(s * 0.66, s * 0.47);
      ctx.lineTo(s * 0.72, s * 0.66);
      ctx.moveTo(s * 0.5, s * 0.55);
      ctx.lineTo(s * 0.36, s * 0.63);
      ctx.stroke();
    }, 256);
    const crack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 1.05),
      new THREE.MeshBasicMaterial({
        map: crackTex, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, opacity: 0.85,
      }),
    );
    crack.position.set(0.05, 1.72, -2.185);
    g.add(crack);

    // shards of the other world, still hanging over the keyboard
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x0b1830, roughness: 0.35, metalness: 0.55,
      emissive: 0x1b4f9c, emissiveIntensity: 1.4,
    });
    this.anomalyShards = [];
    const rng = new Rng(90210);
    for (let i = 0; i < 4; i++) {
      const s = rng.float(0.04, 0.11);
      const shard = new THREE.Mesh(new THREE.BoxGeometry(s, s * rng.float(0.3, 0.8), s * rng.float(0.6, 1.6)), shardMat);
      shard.position.set(-0.85 + i * 0.22, 1.02 + rng.float(0, 0.28), -1.62 + rng.float(-0.18, 0.12));
      shard.rotation.set(rng.float(0, 1), rng.float(0, 6), rng.float(0, 6));
      shard.userData.phase = rng.float(0, Math.PI * 2);
      shard.userData.baseY = shard.position.y;
      g.add(shard);
      this.anomalyShards.push(shard);
    }

    // the poster by the bed now says what the monolith said
    const wordTex = this.mats.textTexture('return-word', (ctx, s) => {
      ctx.fillStyle = '#03070f';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#7fb8ff';
      ctx.font = `bold ${s * 0.11}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 7; i++) {
        ctx.globalAlpha = 0.9 - i * 0.12;
        ctx.fillText('WAKE_UP', s / 2, s * 0.18 + i * s * 0.11);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(120, 180, 255, 0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
    }, 256);
    const word = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ map: wordTex, toneMapped: false }),
    );
    word.position.set(1.62, 1.72, -2.185);
    g.add(word);

    // a single wet footprint where the fall put the player down
    const foot = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x1d3f6e, transparent: true, opacity: 0.5, toneMapped: false }),
    );
    foot.rotation.x = -Math.PI / 2;
    foot.rotation.z = 0.4;
    foot.position.set(0.2, 0.006, 1.9);
    g.add(foot);

    this.anomalyProps = g;
    this.group.add(g);
  }

  /** Draw the monitor contents (desktop idle view or BSOD). */
  private drawScreen(): void {
    const ctx = this.screenCtx;
    const w = 1024, h = 640;
    ctx.save();
    if (this.screenMode === 'off') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      if (this.result) this.result.screenTexture.needsUpdate = true;
      return;
    }
    if (this.screenMode === 'desktop') {
      drawDesktop(ctx, w, h, Math.sin(this.flickerSeed * 3.2) > 0, this.anomaly);
    } else {
      drawBsod(ctx, w, h, this.screenMode === 'glitch' ? 1 : this.anomaly, this.screenMode);
    }
    ctx.restore();
    const tex = (this.result?.screenTexture) ?? (this.screenMat.map as THREE.CanvasTexture | null);
    if (tex) tex.needsUpdate = true;
    else if (this.screenMat.map) (this.screenMat.map as THREE.CanvasTexture).needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mm of mats) {
        const std = mm as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.normalMap?.dispose();
        std.roughnessMap?.dispose();
        std.aoMap?.dispose();
        mm.dispose();
      }
    });
  }
}

function distortBox(geo: THREE.BufferGeometry, amount: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setY(i, y + Math.sin(x * 9 + z * 7) * amount * 0.5);
    pos.setZ(i, z + Math.sin(x * 5) * amount);
  }
  geo.computeVertexNormals();
}

export function drawDesktop(ctx: CanvasRenderingContext2D, w: number, h: number, cursorOn: boolean, anomaly: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a1220');
  g.addColorStop(1, '#05080f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // window chrome
  ctx.fillStyle = '#0d1726';
  ctx.fillRect(40, 60, w - 80, h - 140);
  ctx.strokeStyle = 'rgba(120,160,220,0.35)';
  ctx.strokeRect(40, 60, w - 80, h - 140);
  ctx.fillStyle = '#16233a';
  ctx.fillRect(40, 60, w - 80, 34);
  ctx.fillStyle = 'rgba(190,215,255,0.8)';
  ctx.font = '18px "Courier New", monospace';
  ctx.fillText('terminal — ~/save_state.log', 58, 84);
  const lines = [
    '> mount /dev/self',
    '  reading sectors .......... OK',
    '  integrity ............... 91.7%',
    '  anomalies ............... 3',
    '',
    '> cat notes.txt',
    '  "it keeps the same room.',
    '   it is not the same room."',
    '',
    '> _',
  ];
  ctx.font = '20px "Courier New", monospace';
  lines.forEach((line, i) => {
    ctx.fillStyle = i === lines.length - 1 ? 'rgba(140,200,255,0.95)' : 'rgba(150,180,215,0.62)';
    ctx.fillText(line, 64, 138 + i * 32);
  });
  if (cursorOn) {
    ctx.fillStyle = 'rgba(160,210,255,0.9)';
    ctx.fillRect(64 + ctx.measureText('> ').width, 138 + (lines.length - 1) * 32 - 16, 11, 20);
  }
  if (anomaly > 0) {
    ctx.fillStyle = `rgba(90,130,200,${0.05 * anomaly})`;
    ctx.fillRect(0, 0, w, h);
  }
  // taskbar
  ctx.fillStyle = 'rgba(8,14,24,0.9)';
  ctx.fillRect(0, h - 46, w, 46);
  ctx.fillStyle = 'rgba(120,170,240,0.55)';
  for (let i = 0; i < 5; i++) ctx.fillRect(24 + i * 46, h - 34, 26, 22);
  ctx.font = '16px "Courier New", monospace';
  ctx.fillStyle = 'rgba(140,170,210,0.5)';
  ctx.fillText('03:47', w - 90, h - 18);
}

export function drawBsod(
  ctx: CanvasRenderingContext2D, w: number, h: number, anomaly: number, mode: ScreenMode,
): void {
  ctx.fillStyle = '#0a4ea2';
  ctx.fillRect(0, 0, w, h);
  // subtle vignette/dither so the flat blue is not dead
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, 'rgba(30,110,210,0.35)');
  g.addColorStop(1, 'rgba(0,20,60,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#eaf3ff';
  ctx.textAlign = 'left';
  ctx.font = '300 96px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(':(', 92, 250);
  ctx.font = '400 30px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const lines = [
    'Your PC ran into a problem and needs to restart.',
    "We're just collecting some error info, and then we'll",
    'restart for you.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, 96, 320 + i * 42));
  ctx.font = '400 26px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = 'rgba(210,230,255,0.85)';
  ctx.fillText(mode === 'wake' ? 'WAKE_UP' : '47% complete', 96, 470);
  ctx.fillStyle = 'rgba(200,225,255,0.55)';
  ctx.font = '20px "Courier New", monospace';
  ctx.fillText('Stop code: CRITICAL_PROCESS_DIED', 96, 540);
  const ascii = '@#%&$*+=~^<>/\\|!?01';
  for (let i = 0; i < 220; i++) {
    const x = 560 + (i % 44) * 10;
    const y = 470 + Math.floor(i / 44) * 10;
    ctx.fillStyle = `rgba(235,245,255,${0.22 + Math.random() * 0.4})`;
    ctx.font = '9px monospace';
    ctx.fillText(ascii[Math.floor(Math.random() * ascii.length)], x, y);
  }
  if (anomaly > 0.05) {
    // tearing bands
    const bands = Math.floor(3 + anomaly * 12);
    for (let i = 0; i < bands; i++) {
      const y = Math.random() * h;
      const bh = 2 + Math.random() * 26 * anomaly;
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '220,240,255' : '8,30,80'},${0.15 + anomaly * 0.35})`;
      ctx.fillRect(0, y, w, bh);
    }
    if (anomaly > 0.5) {
      ctx.fillStyle = 'rgba(230,244,255,0.9)';
      ctx.font = '600 54px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PLEASE', w / 2 + (Math.random() - 0.5) * 20, h * 0.62);
      ctx.fillText('STOP', w / 2 + (Math.random() - 0.5) * 20, h * 0.74);
    }
  }
}
