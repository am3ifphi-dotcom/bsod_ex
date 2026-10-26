import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Assets } from '../core/assets';
import { glitchUniforms } from '../core/glitch';
import { canvas, clamp, damp, mergeStatic, mulberry32, setShadowRecursive } from '../core/util';

export type Interactable = {
  id: string;
  label: string;
  position: THREE.Vector3;
  radius: number;
  enabled: () => boolean;
  use: () => void;
};

export type ScreenMode = 'off' | 'bsod' | 'epilogue';

const W = 6.6;
const D = 5.5;
const H = 2.62;
const HALF_W = W / 2;
const HALF_D = D / 2;

export class Room {
  group = new THREE.Group();
  assets: Assets;
  interactables: Interactable[] = [];
  colliders: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number }[] = [];

  screenMesh!: THREE.Mesh;
  screenCanvas!: HTMLCanvasElement;
  screenCtx!: CanvasRenderingContext2D;
  screenTexture!: THREE.CanvasTexture;
  screenMode: ScreenMode = 'off';
  screenStage = 0;
  faceRegion = { x0: 0.36, y0: 0.12, x1: 0.64, y1: 0.48 };

  monitorLight!: THREE.RectAreaLight;
  monitorSpill!: THREE.PointLight;
  rgbLight!: THREE.PointLight;
  lampLight!: THREE.SpotLight;
  moonLight!: THREE.SpotLight;
  ceilingLight!: THREE.PointLight;
  flashlight!: THREE.SpotLight;

  ceiling!: THREE.Mesh;
  clockHands: THREE.Object3D[] = [];
  clockStopped = false;
  fanBlades: THREE.Object3D[] = [];
  dust!: THREE.Points;
  curtains!: THREE.Group;
  helmet?: THREE.Object3D;
  epilogueGroup = new THREE.Group();
  anomalyShards!: THREE.Group;
  posters: THREE.Mesh[] = [];
  private monitorGlow = 0;
  private time = 0;
  private rnd = mulberry32(2024);
  private probeTarget?: THREE.WebGLCubeRenderTarget;
  private probeBaked = false;
  private epilogue = false;

  constructor(assets: Assets) {
    this.assets = assets;
    this.group.name = 'room';
  }

  addBox(
    parent: THREE.Object3D,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    opts: { collide?: boolean; ry?: number; rounded?: number; shadow?: boolean; name?: string } = {},
  ) {
    const geo =
      opts.rounded && opts.rounded > 0
        ? new RoundedBoxGeometry(sx, sy, sz, 2, opts.rounded)
        : new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    mesh.castShadow = opts.shadow ?? true;
    mesh.receiveShadow = true;
    mesh.name = opts.name ?? 'box';
    parent.add(mesh);
    if (opts.collide) {
      this.colliders.push({ cx: x, cy: y, cz: z, sx, sy, sz });
    }
    return mesh;
  }

  collider(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
    this.colliders.push({ cx, cy, cz, sx, sy, sz });
  }

  private plaster() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#8d939c';
    ctx.fillRect(0, 0, 512, 512);
    const img = ctx.getImageData(0, 0, 512, 512);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const n =
          Math.sin(x * 0.31) * Math.cos(y * 0.27) * 2.2 +
          Math.sin(x * 0.07 + y * 0.05) * 4.5 +
          (Math.random() - 0.5) * 3.2;
        const i = (y * 512 + x) * 4;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
    }
    ctx.putImageData(img, 0, 0);
    // faint large stains
    for (let i = 0; i < 26; i++) {
      const g = ctx.createRadialGradient(this.rnd() * 512, this.rnd() * 512, 2, this.rnd() * 512, this.rnd() * 512, 40 + this.rnd() * 160);
      g.addColorStop(0, 'rgba(38,42,50,0.22)');
      g.addColorStop(1, 'rgba(38,42,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(3, 2);
    tex.anisotropy = 4;
    return tex;
  }

  build() {
    RectAreaLightUniformsLib.init();
    const a = this.assets;
    const g = this.group;

    // ---------- shell ----------
    const wallTex = this.plaster();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6c7480, map: wallTex, roughness: 0.96, metalness: 0 });
    wallMat.bumpMap = wallTex;
    wallMat.bumpScale = 0.012;
    wallMat.envMapIntensity = 0.35;
    wallMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = glitchUniforms.uTime;
      shader.uniforms.uGlitch = glitchUniforms.uGlitch;
      shader.uniforms.uSeed = glitchUniforms.uSeed;
      shader.vertexShader = `uniform float uTime; uniform float uGlitch; uniform float uSeed;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float gg = uGlitch;
        if (gg > 0.001) {
          float cell = floor(position.y * 8.0 + position.x * 2.0);
          float h = fract(sin(cell * 91.7 + uSeed * 13.0) * 43758.5);
          transformed += normal * step(0.9 - gg * 0.3, h) * gg * 0.08;
        }`,
      );
      shader.fragmentShader = `uniform float uTime; uniform float uGlitch;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          if (uGlitch > 0.001) {
            float band = floor(vMapUv.y * 26.0 + uTime * 5.0);
            float h = fract(sin(band * 78.2) * 43758.5);
            if (h > 0.72) diffuseColor.rgb *= 0.55;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.3, 0.9), uGlitch * 0.22 * h);
          }
        #endif`,
      );
    };
    wallMat.customProgramCacheKey = () => 'room-wall';

    const floorMat = a.material('woodfloor', { repeat: [4, 3.4], color: 0x9b938a, roughness: 0.72, normalScale: 0.8 });
    floorMat.envMapIntensity = 0.55;
    this.addBox(g, floorMat, 0, -0.06, 0, W, 0.12, D, { collide: false });
    this.collider(0, -0.06, 0, W, 0.12, D);

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x50555e, roughness: 0.98, metalness: 0 });
    this.ceiling = this.addBox(g, ceilMat, 0, H, 0, W, 0.1, D);
    this.addBox(g, wallMat, 0, H / 2, -HALF_D, W, H, 0.14);
    this.collider(0, H / 2, -HALF_D, W, H, 0.14);
    this.addBox(g, wallMat, 0, H / 2, HALF_D, W, H, 0.14);
    this.collider(0, H / 2, HALF_D, W, H, 0.14);
    this.addBox(g, wallMat, -HALF_W, H / 2, 0, 0.14, H, D);
    this.collider(-HALF_W, H / 2, 0, 0.14, H, D);
    // right wall is split around the window opening (y 1.075..2.225, z -0.4..1.3)
    const winCenterZ = 0.45;
    const winW = 1.7;
    const winY = 1.65;
    const winH = 1.15;
    const lowH = winY - winH / 2;
    const highY = winY + winH / 2;
    this.addBox(g, wallMat, HALF_W, lowH / 2, 0, 0.14, lowH, D);
    this.addBox(g, wallMat, HALF_W, (highY + H) / 2, 0, 0.14, H - highY, D);
    const zA = -HALF_D;
    const zB = winCenterZ - winW / 2;
    const zC = winCenterZ + winW / 2;
    this.addBox(g, wallMat, HALF_W, (lowH + highY) / 2, (zA + zB) / 2, 0.14, winH, zB - zA);
    this.addBox(g, wallMat, HALF_W, (lowH + highY) / 2, (zC + HALF_D) / 2, 0.14, winH, HALF_D - zC);
    this.collider(HALF_W, H / 2, 0, 0.14, H, D);

    // baseboards
    const trimMat = a.plain(0x4a4d55, { roughness: 0.6 });
    this.addBox(g, trimMat, 0, 0.06, -HALF_D + 0.08, W, 0.12, 0.02);
    this.addBox(g, trimMat, 0, 0.06, HALF_D - 0.08, W, 0.12, 0.02);
    this.addBox(g, trimMat, -HALF_W + 0.08, 0.06, 0, 0.02, 0.12, D);
    this.addBox(g, trimMat, HALF_W - 0.08, 0.06, 0, 0.02, 0.12, D);

    // ---------- window + night view ----------
    this.buildWindow();
    this.buildDesk();
    this.buildPC();
    this.buildChair();
    this.buildBed();
    this.buildShelf();
    this.buildSofa();
    this.buildSmallProps();
    this.buildClock();
    this.buildPosters();
    this.buildLights();
    this.buildDust();
    this.buildEpilogueProps();

    // ---------- interactables ----------
    const pcPos = new THREE.Vector3(-0.15, 1.0, -2.28);
    this.interactables.push(
      {
        id: 'pc',
        label: 'PCを調べる',
        position: pcPos,
        radius: 2.3,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'window',
        label: '窓の外を見る',
        position: new THREE.Vector3(2.6, 1.6, 0.45),
        radius: 1.8,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'shelf',
        label: '棚を見る',
        position: new THREE.Vector3(-2.6, 1.3, -0.4),
        radius: 1.7,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'door',
        label: 'ドアを調べる',
        position: new THREE.Vector3(2.55, 1.1, 2.45),
        radius: 1.6,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'clock',
        label: '時計を見る',
        position: new THREE.Vector3(1.9, 1.95, -2.5),
        radius: 1.6,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'poster',
        label: 'ポスターを見る',
        position: new THREE.Vector3(-1.9, 1.75, -2.5),
        radius: 1.5,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'bed',
        label: 'ベッドを調べる',
        position: new THREE.Vector3(-2.1, 0.6, 0.8),
        radius: 1.5,
        enabled: () => true,
        use: () => {},
      },
      {
        id: 'mug',
        label: 'マグカップを調べる',
        position: new THREE.Vector3(0.55, 0.82, -2.1),
        radius: 1.2,
        enabled: () => true,
        use: () => {},
      },
    );
    // batch static meshes per material; hands, the screen, curtains, dust and the
    // epilogue shards stay independent because they animate at runtime
    if (!/nomerge=1/.test(location.search)) {
      mergeStatic(this.group, new Set<THREE.Object3D>([...this.clockHands, this.screenMesh, this.curtains, this.dust, this.epilogueGroup]), 3);
    }
    return this;
  }

  // ------------------------------------------------------------------ window
  private buildWindow() {
    const a = this.assets;
    const g = this.group;
    const frameMat = a.plain(0x2b2f38, { roughness: 0.5, metalness: 0.2 });
    const x = HALF_W - 0.08;
    const z = 0.45;
    const w = 1.7;
    const h = 1.15;
    const y = 1.65;
    // frame
    this.addBox(g, frameMat, x, y + h / 2 + 0.035, z, 0.1, 0.07, w + 0.14);
    this.addBox(g, frameMat, x, y - h / 2 - 0.035, z, 0.1, 0.07, w + 0.14);
    this.addBox(g, frameMat, x, y, z - w / 2 - 0.035, 0.1, h + 0.1, 0.07);
    this.addBox(g, frameMat, x, y, z + w / 2 + 0.035, 0.1, h + 0.1, 0.07);
    this.addBox(g, frameMat, x, y, z, 0.08, h, 0.035);
    this.addBox(g, frameMat, x, y, z, 0.08, 0.035, w);
    // glass (a very subtle reflective sheet)
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshPhysicalMaterial({
        color: 0x0c1220,
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.22,
        transmission: 0.0,
        side: THREE.DoubleSide,
      }),
    );
    glass.rotation.y = -Math.PI / 2;
    glass.position.set(x - 0.02, y, z);
    g.add(glass);

    // outside: a real, low-detail city block + night sky plane (not a backdrop image)
    const outside = new THREE.Group();
    outside.name = 'outside';
    const rnd = mulberry32(99);
    for (let i = 0; i < 26; i++) {
      const bw = 1.6 + rnd() * 3.4;
      const bh = 4 + rnd() * 14;
      const bd = 1.6 + rnd() * 3.4;
      const bx = x + 5 + rnd() * 34;
      const bz = z - 24 + rnd() * 48;
      const bm = new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.95, metalness: 0.05 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bm);
      b.position.set(bx, bh / 2 - 2, bz);
      outside.add(b);
      const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.09 + rnd() * 0.07, 0.5, 0.2 + rnd() * 0.4), toneMapped: false });
      const cols = Math.max(2, Math.floor(bd / 1.1));
      const rows = Math.max(3, Math.floor(bh / 2.0));
      for (let r = 0; r < rows; r++) {
        for (let c2 = 0; c2 < cols; c2++) {
          if (rnd() > 0.42) continue;
          const win = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), winMat);
          win.position.set(bx - bw / 2 - 0.01, 0.3 + r * 1.8 - 1, bz - bd / 2 + 0.55 + c2 * 1.05);
          win.rotation.y = Math.PI / 2;
          outside.add(win);
        }
      }
    }
    // moon glow card
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x8fa8d8, toneMapped: false, transparent: true, opacity: 0.5 }),
    );
    moon.position.set(x + 38, 16, z - 10);
    moon.rotation.y = -Math.PI / 2;
    outside.add(moon);
    g.add(outside);

    // curtains
    const curtainMat = a.material('fabric', { repeat: [2, 3], color: 0x59617a, roughness: 1, normalScale: 1.2 });
    curtainMat.side = THREE.DoubleSide;
    const curtains = new THREE.Group();
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(0.6, 1.9, 16, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        pos.setZ(i, Math.sin((px + 0.3) * 18) * 0.035);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, curtainMat);
      m.position.set(x - 0.12, y + 0.06, z + side * 1.08);
      m.rotation.y = -Math.PI / 2;
      m.castShadow = true;
      curtains.add(m);
    }
    // curtain rod
    this.addBox(g, frameMat, x - 0.12, 2.28, z, 0.04, 0.04, 2.9);
    g.add(curtains);
    this.curtains = curtains;
  }

  // -------------------------------------------------------------------- desk
  private buildDesk() {
    const a = this.assets;
    const g = this.group;
    const deskMat = a.material('wood', { repeat: [2, 2], color: 0x6b5947, roughness: 0.55, normalScale: 0.7 });
    const deskX = -0.15;
    const deskZ = -2.1;
    const deskW = 2.15;
    const deskD = 0.75;
    const deskH = 0.74;
    this.addBox(g, deskMat, deskX, deskH - 0.025, deskZ, deskW, 0.05, deskD, { collide: true, rounded: 0.012 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.addBox(g, deskMat, deskX + sx * (deskW / 2 - 0.06), (deskH - 0.05) / 2, deskZ + sz * (deskD / 2 - 0.06), 0.06, deskH - 0.05, 0.06);
      }
    }
    // cable tray / back board
    this.addBox(g, a.plain(0x2a2c31, { roughness: 0.7 }), deskX, 0.4, deskZ - deskD / 2 + 0.06, deskW - 0.2, 0.35, 0.03);
    // desk mat
    const matMat = a.material('fabric', { repeat: [1.2, 0.7], color: 0x1c1f26, roughness: 1 });
    this.addBox(g, matMat, deskX, deskH + 0.004, deskZ + 0.06, 1.15, 0.006, 0.42, { rounded: 0.002 });
    // monitor
    const monitor = new THREE.Group();
    monitor.position.set(deskX, deskH, deskZ - 0.05);
    const bezel = a.plain(0x111318, { roughness: 0.35, metalness: 0.25 });
    const monW = 0.72;
    const monH = 0.43;
    const monY = 0.31;
    this.addBox(monitor, bezel, 0, monY, 0, monW, monH, 0.025, { rounded: 0.006 });
    // screen
    const sc = canvas(1280, 720);
    this.screenCanvas = sc.canvas;
    this.screenCtx = sc.ctx;
    this.screenTexture = sc.texture;
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.anisotropy = 8;
    const screenMat = new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false });
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(monW - 0.028, monH - 0.032), screenMat);
    this.screenMesh.position.set(0, monY, 0.014);
    this.screenMesh.name = 'monitor-screen';
    monitor.add(this.screenMesh);
    // back bulge + stand
    this.addBox(monitor, bezel, 0, monY, -0.03, monW - 0.1, monH - 0.1, 0.03, { rounded: 0.008 });
    this.addBox(monitor, bezel, 0, 0.1, -0.02, 0.06, 0.26, 0.05);
    this.addBox(monitor, bezel, 0, 0.005, 0.02, 0.26, 0.012, 0.18, { rounded: 0.005 });
    // power LED
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color: 0x66aaff, toneMapped: false }));
    led.position.set(monW / 2 - 0.03, 0.11, 0.014);
    monitor.add(led);
    g.add(monitor);
    this.collider(deskX, monY + deskH, deskZ - 0.05, monW, monH, 0.12);
    this.drawScreen('off');

    // keyboard
    const kb = new THREE.Group();
    kb.position.set(deskX + 0.02, deskH + 0.012, deskZ + 0.24);
    kb.rotation.x = -0.03;
    this.addBox(kb, a.plain(0x15171c, { roughness: 0.55, metalness: 0.15 }), 0, 0, 0, 0.44, 0.018, 0.145, { rounded: 0.005 });
    const keyGeo = new RoundedBoxGeometry(0.0175, 0.008, 0.0175, 1, 0.002);
    const keyMat = a.plain(0x2c3039, { roughness: 0.5 });
    const keys = new THREE.InstancedMesh(keyGeo, keyMat, 15 * 5 + 6);
    let ki = 0;
    const m4 = new THREE.Matrix4();
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 15; c++) {
        m4.makeTranslation(-0.195 + c * 0.0195, 0.012, -0.05 + r * 0.0195);
        keys.setMatrixAt(ki++, m4);
      }
    }
    for (let c = 0; c < 6; c++) {
      m4.makeTranslation(-0.06 + c * 0.024, 0.012, 0.055);
      keys.setMatrixAt(ki++, m4);
    }
    keys.castShadow = true;
    kb.add(keys);
    g.add(kb);
    // mouse + pad
    const mouse = new THREE.Mesh(
      new RoundedBoxGeometry(0.062, 0.028, 0.105, 3, 0.014),
      a.plain(0x1a1c22, { roughness: 0.35, metalness: 0.2 }),
    );
    mouse.position.set(deskX + 0.42, deskH + 0.03, deskZ + 0.23);
    mouse.castShadow = true;
    g.add(mouse);
    this.addBox(g, a.material('fabric', { repeat: [1, 1], color: 0x101216, roughness: 1 }), deskX + 0.42, deskH + 0.006, deskZ + 0.23, 0.3, 0.005, 0.24, { rounded: 0.001 });
    // mug (turned wooden cup)
    this.buildMug(deskX + 0.73, deskH, deskZ - 0.02);
    // notebook + pen
    const nb = a.plain(0x8a8378, { roughness: 0.9 });
    this.addBox(g, nb, deskX - 0.66, deskH + 0.012, deskZ + 0.18, 0.18, 0.02, 0.24, { rounded: 0.003, ry: 0.1 });
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 8), a.plain(0x22252c, { roughness: 0.3, metalness: 0.4 }));
    pen.rotation.z = Math.PI / 2;
    pen.rotation.y = 0.4;
    pen.position.set(deskX - 0.62, deskH + 0.027, deskZ + 0.16);
    g.add(pen);
    // desk lamp (warm, off in the dark room)
    this.buildDeskLamp(deskX - 0.82, deskH, deskZ - 0.18);
  }

  private buildMug(x: number, y: number, z: number) {
    const a = this.assets;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(0.038 + Math.sin(t * Math.PI * 0.5) * 0.006, t * 0.1));
    }
    const mug = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), a.plain(0xcfc8bb, { roughness: 0.45 }));
    mug.position.set(x, y, z);
    mug.castShadow = true;
    mug.receiveShadow = true;
    this.group.add(mug);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 8, 18, Math.PI * 1.4), a.plain(0xcfc8bb, { roughness: 0.45 }));
    handle.position.set(x + 0.05, y + 0.055, z);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.z = -0.4;
    this.group.add(handle);
  }

  private buildDeskLamp(x: number, y: number, z: number) {
    const a = this.assets;
    const metal = a.plain(0x23262c, { roughness: 0.4, metalness: 0.7 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.018, 24), metal);
    base.position.set(x, y + 0.012, z);
    base.castShadow = true;
    this.group.add(base);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.34, 8), metal);
    arm1.position.set(x, y + 0.19, z - 0.02);
    arm1.rotation.x = 0.18;
    arm1.castShadow = true;
    this.group.add(arm1);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8), metal);
    arm2.position.set(x - 0.02, y + 0.38, z + 0.08);
    arm2.rotation.x = -0.9;
    arm2.castShadow = true;
    this.group.add(arm2);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.14, 24, 1, true), a.plain(0x2b2f36, { roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(x - 0.03, y + 0.49, z + 0.18);
    shade.rotation.x = -0.7;
    shade.castShadow = true;
    this.group.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }));
    bulb.position.set(x - 0.03, y + 0.455, z + 0.165);
    this.group.add(bulb);
    this.lampLight = new THREE.SpotLight(0xffc98a, 3.2, 4.2, 0.72, 0.55, 1.4);
    this.lampLight.position.set(x - 0.03, y + 0.45, z + 0.16);
    this.lampLight.target.position.set(x + 0.12, y + 0.02, z + 0.3);
    this.lampLight.castShadow = false;
    this.group.add(this.lampLight, this.lampLight.target);
  }

  // ---------------------------------------------------------------------- PC
  private buildPC() {
    const a = this.assets;
    const g = this.group;
    const pc = new THREE.Group();
    pc.position.set(1.22, 0, -2.25);
    const caseMat = a.plain(0x15171c, { roughness: 0.45, metalness: 0.55 });
    this.addBox(pc, caseMat, 0, 0.24, 0, 0.24, 0.48, 0.46, { rounded: 0.006, collide: false });
    // glass side (facing +x, towards the room) - physical glass with a slight tint
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1424, transparent: true, opacity: 0.32, roughness: 0.06, metalness: 0.0, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), glassMat);
    glass.rotation.y = Math.PI / 2;
    glass.position.set(0.121, 0.25, 0);
    pc.add(glass);
    // internals: GPU + fans, visible through the glass
    const gpu = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.09, 0.28, 2, 0.004), a.plain(0x1d2027, { roughness: 0.4, metalness: 0.6 }));
    gpu.position.set(-0.02, 0.18, 0.02);
    pc.add(gpu);
    const rgbMat = new THREE.MeshBasicMaterial({ color: 0x3f7bff, toneMapped: false });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.004, 6, 22), rgbMat);
      ring.position.set(0.001, 0.25, -0.14 + i * 0.13);
      ring.rotation.y = Math.PI / 2;
      pc.add(ring);
      const fan = new THREE.Mesh(new THREE.CircleGeometry(0.034, 18), new THREE.MeshBasicMaterial({ color: 0x0a1430 }));
      fan.position.set(0.0005, 0.25, -0.14 + i * 0.13);
      fan.rotation.y = -Math.PI / 2;
      pc.add(fan);
    }
    // front grille + power button
    for (let i = 0; i < 7; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.3, 0.002), a.plain(0x0a0b0e, { roughness: 0.8 }));
      vent.position.set(-0.06 + i * 0.02, 0.24, 0.231);
      pc.add(vent);
    }
    const pwr = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12), new THREE.MeshBasicMaterial({ color: 0x8fc0ff, toneMapped: false }));
    pwr.rotation.x = Math.PI / 2;
    pwr.position.set(0, 0.46, 0.232);
    pc.add(pwr);
    pc.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.add(pc);
    this.collider(1.22, 0.24, -2.25, 0.26, 0.5, 0.48);
    (this as any).pcGroup = pc;
    (this as any).rgbRingMat = rgbMat;

    // power strip + cable
    this.addBox(g, a.plain(0x20232a, { roughness: 0.7 }), 0.6, 0.02, -2.55, 0.3, 0.04, 0.08);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.1, 0.3, -2.4),
      new THREE.Vector3(0.85, 0.03, -2.45),
      new THREE.Vector3(0.7, 0.02, -2.5),
      new THREE.Vector3(0.62, 0.02, -2.58),
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.006, 6, false), a.plain(0x0c0d10, { roughness: 0.8 }));
    g.add(cable);
  }

  private buildChair() {
    const a = this.assets;
    const model = a.models.sheen_chair;
    if (model) {
      const chair = model.clone(true);
      chair.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(chair);
      const size = box.getSize(new THREE.Vector3());
      const scale = 0.98 / Math.max(size.y, 0.001);
      chair.scale.setScalar(scale);
      const box2 = new THREE.Box3().setFromObject(chair);
      chair.position.set(-0.15 - (box2.min.x + box2.max.x) / 2, -box2.min.y, -1.42 - (box2.min.z + box2.max.z) / 2);
      chair.rotation.y = Math.PI + 0.12;
      chair.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshPhysicalMaterial;
            if ((std as any)?.isMeshStandardMaterial || (std as any)?.isMeshPhysicalMaterial) {
              std.color.multiplyScalar(0.9);
              if ('sheen' in std && (std.sheen ?? 0) > 0) {
                std.color.setHex(0x2b3450);
                std.sheenColor = new THREE.Color(0x5f7398);
                std.sheenRoughness = 0.7;
                std.sheen = 0.6;
              }
            }
          }
        }
      });
      setShadowRecursive(chair, true, true);
      this.group.add(chair);
      const size2 = new THREE.Box3().setFromObject(chair).getSize(new THREE.Vector3());
      this.collider(-0.15, size2.y / 2, -1.42, size2.x * 0.9, size2.y, size2.z * 0.9);
    }
  }

  private buildBed() {
    const a = this.assets;
    const g = this.group;
    const bedFrame = a.material('wood', { repeat: [2, 2], color: 0x4a3a2d, roughness: 0.6 });
    const x = -2.25;
    const z = 0.65;
    this.addBox(g, bedFrame, x, 0.12, z, 1.35, 0.16, 2.05, { rounded: 0.01, collide: true });
    // headboard
    this.addBox(g, bedFrame, x, 0.45, z + 1.03, 1.35, 0.75, 0.06, { rounded: 0.015 });
    // mattress
    const mattress = a.material('fabric', { repeat: [2, 3], color: 0xb9b2a6, roughness: 1, normalScale: 1.2 });
    this.addBox(g, mattress, x, 0.28, z, 1.3, 0.22, 1.98, { rounded: 0.06, collide: true });
    // sheet/blanket with a soft wave
    const sheetGeo = new THREE.PlaneGeometry(1.35, 1.5, 24, 24);
    const pos = sheetGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      pos.setZ(i, Math.sin(px * 5 + 1.2) * 0.018 + Math.sin(py * 7.5) * 0.012 + Math.cos(px * 2.3 + py * 3.1) * 0.02);
    }
    sheetGeo.computeVertexNormals();
    const sheet = new THREE.Mesh(sheetGeo, a.material('fabric', { repeat: [2, 2], color: 0x46506b, roughness: 1 }));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set(x, 0.4, z - 0.15);
    sheet.castShadow = true;
    sheet.receiveShadow = true;
    g.add(sheet);
    // pillows
    const pillowMat = a.material('fabric', { repeat: [1, 1], color: 0xc3bdb2, roughness: 1, normalScale: 1.4 });
    for (const off of [-0.34, 0.34]) {
      const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.14, 0.34, 4, 0.06), pillowMat);
      pillow.position.set(x + off, 0.45, z + 0.78);
      pillow.rotation.y = off * 0.12;
      pillow.rotation.x = -0.08;
      pillow.castShadow = true;
      g.add(pillow);
    }
    // folded blanket at the foot
    const folded = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.1, 0.5, 3, 0.03), a.material('fabric', { repeat: [2, 1], color: 0x6b5a4a, roughness: 1 }));
    folded.position.set(x, 0.47, z - 0.72);
    folded.rotation.y = 0.05;
    folded.castShadow = true;
    g.add(folded);
  }

  private buildShelf() {
    const a = this.assets;
    const g = this.group;
    const shelfMat = a.material('wood', { repeat: [1, 2], color: 0x3c332b, roughness: 0.65 });
    const x = -HALF_W + 0.24;
    const z = -0.2;
    const w = 0.36;
    const h = 2.05;
    const d = 1.9;
    this.addBox(g, shelfMat, x, h / 2, z, w, h, d, { collide: true });
    for (let i = 0; i < 4; i++) {
      const shelfY = 0.32 + i * 0.48;
      this.addBox(g, shelfMat, x + 0.02, shelfY, z, w + 0.02, 0.03, d - 0.04);
      // books
      const count = 10 + Math.floor(this.rnd() * 8);
      let cursor = z - d / 2 + 0.08;
      for (let b = 0; b < count; b++) {
        const bw = 0.02 + this.rnd() * 0.035;
        const bh = 0.16 + this.rnd() * 0.1;
        const color = new THREE.Color().setHSL(this.rnd() * 0.6 + 0.02, 0.15 + this.rnd() * 0.5, 0.18 + this.rnd() * 0.35);
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.16 + this.rnd() * 0.08, bh, bw), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
        book.rotation.set(0, 0, this.rnd() < 0.15 ? 0.2 : 0);
        book.position.set(x + 0.02, shelfY + 0.015 + bh / 2, cursor + bw / 2);
        book.castShadow = true;
        book.receiveShadow = true;
        g.add(book);
        cursor += bw + 0.002;
        if (cursor > z + d / 2 - 0.1) break;
      }
    }
    // helmet collectible
    const helmet = a.models.helmet;
    if (helmet) {
      const h2 = helmet.clone(true);
      h2.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(h2);
      const s = 0.34 / Math.max(b.getSize(new THREE.Vector3()).x, 0.001);
      h2.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(h2);
      h2.position.set(x + 0.05 - (b2.min.x + b2.max.x) / 2, 0.74 - b2.min.y, z - 0.55 - (b2.min.z + b2.max.z) / 2);
      h2.rotation.y = Math.PI / 2 - 0.3;
      h2.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      g.add(h2);
      this.helmet = h2;
    }
    // vintage lantern on the shelf (CC0 Khronos model)
    const lantern = a.models.lantern;
    if (lantern) {
      const l = lantern.clone(true);
      l.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(l);
      const s = 0.3 / Math.max(b.getSize(new THREE.Vector3()).y, 0.001);
      l.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(l);
      l.position.set(x + 0.04 - (b2.min.x + b2.max.x) / 2, 1.24 - b2.min.y, z + 0.62 - (b2.min.z + b2.max.z) / 2);
      l.rotation.y = -Math.PI / 2;
      l.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      g.add(l);
    }
    // storage boxes on top
    this.addBox(g, a.plain(0x2c2a28, { roughness: 0.9 }), x, 2.12, z - 0.5, 0.3, 0.18, 0.35, { rounded: 0.006 });
  }

  private buildSofa() {
    const a = this.assets;
    const model = a.models.sofa;
    if (!model) return;
    const sofa = model.clone(true);
    sofa.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(sofa);
    const size = b.getSize(new THREE.Vector3());
    const s = 1.75 / Math.max(size.x, 0.001);
    sofa.scale.setScalar(s);
    const b2 = new THREE.Box3().setFromObject(sofa);
    sofa.position.set(0.85 - (b2.min.x + b2.max.x) / 2, -b2.min.y + 0.0, 2.2 - (b2.min.z + b2.max.z) / 2);
    sofa.rotation.y = Math.PI;
    sofa.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(sofa);
    const size2 = new THREE.Box3().setFromObject(sofa).getSize(new THREE.Vector3());
    this.collider(0.85, Math.min(0.5, size2.y / 2), 2.2, Math.min(size2.x, 2.0), Math.min(size2.y, 0.9), Math.min(size2.z, 1.1));
    // throw blanket / pillow
    const pillow = new THREE.Mesh(
      new RoundedBoxGeometry(0.42, 0.12, 0.3, 3, 0.05),
      a.material('fabric', { repeat: [1, 1], color: 0x2f3b5c, roughness: 1 }),
    );
    pillow.position.set(0.2, 0.52, 2.2);
    pillow.rotation.z = 0.1;
    pillow.castShadow = true;
    this.group.add(pillow);
  }

  private buildSmallProps() {
    const a = this.assets;
    const g = this.group;
    // rug
    const rugGeo = new THREE.PlaneGeometry(2.7, 1.95, 1, 1);
    const rugMat = a.material('fabric', { repeat: [2, 1.5], color: 0x3b3f52, roughness: 1, normalScale: 1.5 });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.3, 0.006, 0.35);
    rug.receiveShadow = true;
    g.add(rug);
    // rug border
    const borderMat = a.plain(0x22263a, { roughness: 1 });
    for (const [dx, dz, sx, sz] of [[0, -0.95, 2.7, 0.05], [0, 0.95, 2.7, 0.05], [-1.32, 0, 0.05, 1.95], [1.32, 0, 0.05, 1.95]]) {
      this.addBox(g, borderMat, 0.3 + dx, 0.008, 0.35 + dz, sx, 0.004, sz);
    }
    // slippers
    for (const off of [-0.06, 0.06]) {
      const slipper = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.05, 0.25, 2, 0.02), a.plain(0x2d3140, { roughness: 0.9 }));
      slipper.position.set(0.95 + off, 0.03, -0.2 + off * 2);
      slipper.rotation.y = 0.3;
      slipper.castShadow = true;
      g.add(slipper);
    }
    // trash bin
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.34, 20, 1, true), a.plain(0x22252c, { roughness: 0.65 }));
    bin.position.set(1.02, 0.17, -2.1);
    bin.castShadow = true;
    g.add(bin);
    // laundry pile
    for (let i = 0; i < 4; i++) {
      const cloth = new THREE.Mesh(
        new RoundedBoxGeometry(0.3 + this.rnd() * 0.2, 0.08 + this.rnd() * 0.06, 0.26, 2, 0.04),
        a.material('fabric', { repeat: [1, 1], color: i % 2 ? 0x5a5f6e : 0x3c4358, roughness: 1 }),
      );
      cloth.position.set(-2.4 + this.rnd() * 0.3, 0.05 + i * 0.05, 1.5 + this.rnd() * 0.2);
      cloth.rotation.y = this.rnd() * Math.PI;
      cloth.castShadow = true;
      g.add(cloth);
    }
    // wall poster board / notes on desk wall
    const noteMat = new THREE.MeshBasicMaterial({ color: 0xd8d2b8, toneMapped: false });
    for (let i = 0; i < 5; i++) {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), noteMat);
      note.position.set(-1.0 + i * 0.14, 1.55 + (i % 2) * 0.06, -HALF_D + 0.075);
      note.rotation.z = (this.rnd() - 0.5) * 0.2;
      g.add(note);
    }
    // door
    const doorMat = a.material('wood', { repeat: [1, 2], color: 0x5a4b3d, roughness: 0.7 });
    const door = this.addBox(g, doorMat, 2.55, 1.04, HALF_D - 0.09, 0.92, 2.04, 0.06);
    this.collider(2.55, 1.04, HALF_D - 0.09, 0.92, 2.04, 0.06);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), a.plain(0x9a8f78, { roughness: 0.35, metalness: 0.8 }));
    handle.position.set(2.18, 1.03, HALF_D - 0.15);
    g.add(handle);
    // ceiling light (off) — a bare pendant
    const pendant = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 24, 1, true), a.plain(0x2a2d33, { roughness: 0.6, side: THREE.DoubleSide }));
    pendant.position.set(0, H - 0.14, 0.2);
    pendant.rotation.x = Math.PI;
    g.add(pendant);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35, 6), a.plain(0x111214, { roughness: 0.8 }));
    cord.position.set(0, H - 0.17, 0.2);
    g.add(cord);
    // air conditioner
    this.addBox(g, a.plain(0xbfc1c4, { roughness: 0.55 }), 1.9, 2.28, -HALF_D + 0.18, 0.9, 0.3, 0.22, { rounded: 0.04 });
    // empty can on desk corner
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 18), a.plain(0x8c9099, { roughness: 0.3, metalness: 0.7 }));
    can.position.set(0.78, 0.8, -2.3);
    can.castShadow = true;
    g.add(can);
  }

  private buildClock() {
    const a = this.assets;
    const group = new THREE.Group();
    group.position.set(1.9, 1.95, -HALF_D + 0.1);
    const faceTex = canvas(512, 512);
    const ctx = faceTex.ctx;
    ctx.fillStyle = '#e9e6de';
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#26282e';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#26282e';
    ctx.font = '600 30px Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.fillText(String(i), 256 + Math.cos(ang) * 196, 256 + Math.sin(ang) * 196);
    }
    ctx.fillStyle = '#8b8f99';
    ctx.font = '20px Helvetica, Arial';
    ctx.fillText('SEIKO', 256, 340);
    faceTex.texture.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 40), new THREE.MeshBasicMaterial({ map: faceTex.texture }));
    face.position.z = 0.012;
    group.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.162, 0.012, 10, 40), a.plain(0x24262b, { roughness: 0.4, metalness: 0.3 }));
    group.add(rim);
    const handMat = new THREE.MeshBasicMaterial({ color: 0x1b1d22 });
    const hour = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.085, 0.002), handMat);
    hour.position.set(0, 0.035, 0.02);
    const min = new THREE.Mesh(new THREE.BoxGeometry(0.0045, 0.12, 0.002), handMat);
    min.position.set(0, 0.05, 0.022);
    const sec = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.135, 0.002), new THREE.MeshBasicMaterial({ color: 0xa03030 }));
    sec.position.set(0, 0.055, 0.024);
    group.add(hour, min, sec);
    this.clockHands = [hour, min, sec];
    this.group.add(group);
    group.rotation.y = 0;
  }

  private buildPosters() {
    const a = this.assets;
    const make = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = canvas(w, h);
      draw(c.ctx);
      c.texture.colorSpace = THREE.SRGBColorSpace;
      c.texture.anisotropy = 4;
      return new THREE.MeshStandardMaterial({ map: c.texture, roughness: 0.85, metalness: 0, emissive: 0x0a1020, emissiveIntensity: 0.25 });
    };
    const poster1 = make(512, 720, (ctx) => {
      const grd = ctx.createLinearGradient(0, 0, 0, 720);
      grd.addColorStop(0, '#08122c');
      grd.addColorStop(0.5, '#1b3c7a');
      grd.addColorStop(1, '#0b1020');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 512, 720);
      ctx.strokeStyle = 'rgba(180,210,255,0.75)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        ctx.beginPath();
        const y = 80 + i * 32;
        ctx.moveTo(40, y);
        for (let x = 40; x < 480; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 10);
        ctx.stroke();
      }
      ctx.fillStyle = '#eaf2ff';
      ctx.font = '300 86px Helvetica, Arial';
      ctx.fillText('SIGNAL', 46, 210);
      ctx.font = '700 86px Helvetica, Arial';
      ctx.fillText('LOST', 46, 290);
      ctx.font = '300 20px monospace';
      ctx.fillStyle = '#8fb4ff';
      ctx.fillText('A STUDY OF A BROKEN MEMORY', 46, 330);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(46, 370, 420, 300);
    });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.73), poster1);
    p1.position.set(-1.55, 1.72, -HALF_D + 0.075);
    this.group.add(p1);
    this.posters.push(p1);

    const poster2 = make(512, 640, (ctx) => {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, 512, 640);
      ctx.fillStyle = '#dfe7ff';
      ctx.font = '700 44px monospace';
      ctx.fillText(':(', 40, 120);
      ctx.font = '300 17px monospace';
      ctx.fillStyle = '#7f9bdd';
      const lines = ['YOUR PC RAN INTO A', 'PROBLEM AND NEEDS TO', 'RESTART.', '', 'STOP CODE:', 'CRITICAL_PROCESS_DIED'];
      lines.forEach((l, i) => ctx.fillText(l, 40, 180 + i * 30));
      ctx.strokeStyle = '#2a4a9e';
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 400 + i * 9);
        ctx.lineTo(512, 400 + i * 9);
        ctx.stroke();
      }
      ctx.fillStyle = '#4f7bff';
      ctx.fillRect(40, 560, 160, 6);
    });
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.57), poster2);
    p2.position.set(HALF_W - 0.08, 1.75, -0.9);
    p2.rotation.y = -Math.PI / 2;
    this.group.add(p2);
    this.posters.push(p2);

    // frames
    const frameMat = a.plain(0x181a1e, { roughness: 0.5, metalness: 0.2 });
    this.addBox(this.group, frameMat, -1.55, 2.1, -HALF_D + 0.07, 0.56, 0.03, 0.02);
    this.addBox(this.group, frameMat, -1.55, 1.34, -HALF_D + 0.07, 0.56, 0.03, 0.02);
  }

  private buildLights() {
    const a = this.assets;
    // base visibility: a very dim cold ambient so the corners still read
    const ambient = new THREE.AmbientLight(0x22304f, 0.55);
    this.group.add(ambient);
    const hemi = new THREE.HemisphereLight(0x2a3c66, 0x080a10, 0.5);
    this.group.add(hemi);
    // main light: the monitor (area light) + a soft spill point
    this.monitorLight = new THREE.RectAreaLight(0x6f9bff, 7.5, 0.66, 0.38);
    this.monitorLight.position.set(-0.15, 1.05, -2.03);
    this.monitorLight.lookAt(-0.15, 1.0, 0.6);
    this.group.add(this.monitorLight);
    this.monitorSpill = new THREE.PointLight(0x4d7dff, 3.2, 4.6, 1.7);
    this.monitorSpill.position.set(-0.15, 1.05, -1.92);
    this.group.add(this.monitorSpill);
    // RGB accent inside the case
    this.rgbLight = new THREE.PointLight(0x3f7bff, 1.6, 3.0, 2);
    this.rgbLight.position.set(1.15, 0.3, -2.05);
    this.group.add(this.rgbLight);
    // dim ceiling fill — off, just a whisper of ambient
    this.ceilingLight = new THREE.PointLight(0xffe2b8, 0.0, 6, 2);
    this.ceilingLight.position.set(0, 2.3, 0.2);
    this.group.add(this.ceilingLight);
    // moonlight / street lamp through the window
    this.moonLight = new THREE.SpotLight(0x8aa8e8, 9.0, 14, 0.7, 0.85, 1.5);
    this.moonLight.position.set(HALF_W + 0.8, 2.4, 1.4);
    this.moonLight.target.position.set(-0.4, 0, 0.2);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1024, 1024);
    this.moonLight.shadow.bias = -0.0018;
    this.moonLight.shadow.camera.near = 0.5;
    this.moonLight.shadow.camera.far = 16;
    this.moonLight.shadow.normalBias = 0.02;
    this.group.add(this.moonLight, this.moonLight.target);
    // phone flashlight (toggled with F), parented to the camera by Game
    this.flashlight = new THREE.SpotLight(0xdce8ff, 22, 16, 0.48, 0.6, 1.6);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.bias = -0.002;
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 18;
    this.flashlight.shadow.normalBias = 0.02;
    this.flashlight.visible = false;
  }

  private buildDust() {
    const count = 170;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = -1.6 + Math.random() * 3.2;
      pos[i * 3 + 1] = Math.random() * 1.9;
      pos[i * 3 + 2] = -2.4 + Math.random() * 3.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fc0ff,
      size: 0.0026,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.group.add(this.dust);
  }

  private buildEpilogueProps() {
    this.epilogueGroup.name = 'epilogue';
    this.epilogueGroup.visible = false;
    const shards = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.05, 0.12, 0.02);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x0a1a3a,
        emissive: 0x2a5bff,
        emissiveIntensity: 1.2,
        roughness: 0.2,
        metalness: 0.6,
      }));
      m.position.set(-0.15 + (Math.random() - 0.5) * 1.2, 1.4 + Math.random() * 0.8, -2.0 + (Math.random() - 0.5) * 0.8);
      shards.add(m);
    }
    this.anomalyShards = shards;
    this.epilogueGroup.add(shards);
    this.group.add(this.epilogueGroup);
  }

  // ------------------------------------------------------------------ screen
  drawScreen(mode: ScreenMode, progress = 0) {
    this.screenMode = mode;
    const ctx = this.screenCtx;
    const W2 = this.screenCanvas.width;
    const H2 = this.screenCanvas.height;
    ctx.clearRect(0, 0, W2, H2);

    if (mode === 'off') {
      ctx.fillStyle = '#020306';
      ctx.fillRect(0, 0, W2, H2);
      const grd = ctx.createLinearGradient(0, 0, W2, H2);
      grd.addColorStop(0, 'rgba(60,90,160,0.05)');
      grd.addColorStop(0.5, 'rgba(10,14,26,0.0)');
      grd.addColorStop(1, 'rgba(30,60,120,0.06)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W2, H2);
      // faint reflection of the room
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#9fb8ff';
      ctx.beginPath();
      ctx.ellipse(W2 * 0.7, H2 * 0.6, 180, 60, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.screenTexture.needsUpdate = true;
      return;
    }

    if (mode === 'bsod') {
      const blue = '#0a5bd6';
      ctx.fillStyle = blue;
      ctx.fillRect(0, 0, W2, H2);
      // subtle gradient + noise bands
      const grd = ctx.createLinearGradient(0, 0, 0, H2);
      grd.addColorStop(0, 'rgba(20,110,255,0.55)');
      grd.addColorStop(0.6, 'rgba(4,70,190,0.1)');
      grd.addColorStop(1, 'rgba(2,30,110,0.5)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W2, H2);
      for (let i = 0; i < 40; i++) {
        if (this.rnd() > 0.35) continue;
        ctx.fillStyle = `rgba(255,255,255,${0.02 + this.rnd() * 0.05})`;
        ctx.fillRect(0, this.rnd() * H2, W2, 1 + this.rnd() * 3);
      }

      const stage = progress;
      const jitter = stage > 1 ? stage * 3 : 0;
      const drawText = (text: string, x: number, y: number, font: string, alpha = 1, color = '#ffffff') => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.font = font;
        const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
        const jy = jitter ? (Math.random() - 0.5) * jitter * 0.4 : 0;
        if (stage >= 3 && Math.random() < 0.18) {
          ctx.fillStyle = 'rgba(255,60,90,0.75)';
          ctx.fillText(text, x + jx + 3, y + jy);
          ctx.fillStyle = 'rgba(90,255,220,0.6)';
          ctx.fillText(text, x + jx - 3, y + jy);
          ctx.fillStyle = color;
        }
        ctx.fillText(text, x + jx, y + jy);
        ctx.restore();
      };

      // giant smiley: the clickable region (faceRegion tracks this rect)
      const faceSize = 210 + stage * 14;
      const fx = W2 * 0.5;
      const fy = 200;
      drawText(':(', fx - faceSize * 0.5, fy + faceSize * 0.35, `${faceSize}px "Helvetica Neue", Arial, sans-serif`);
      this.faceRegion = { x0: 0.30, y0: 0.06, x1: 0.70, y1: 0.44 };

      drawText('Your PC ran into a problem and needs to restart.', 92, 380, '500 30px "Helvetica Neue", Arial, sans-serif');
      drawText("We're just collecting some error info, and then we'll restart for you.", 92, 424, '300 26px "Helvetica Neue", Arial, sans-serif', 0.9);
      drawText(`${Math.min(99, Math.floor(stage * 12))}% complete`, 92, 496, '300 28px "Helvetica Neue", Arial, sans-serif', 0.95);

      // QR-ish block
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(W2 - 190, H2 - 170, 120, 120);
      ctx.fillStyle = blue;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          if (Math.random() > 0.5) ctx.fillRect(W2 - 186 + x * 9.6, H2 - 166 + y * 9.6, 8, 8);
        }
      }
      ctx.restore();
      drawText('For more information about this issue and possible fixes, visit', 92, H2 - 130, '300 18px "Helvetica Neue", Arial, sans-serif', 0.75);
      drawText('https://windows.com/stopcode', 92, H2 - 102, '300 18px "Helvetica Neue", Arial, sans-serif', 0.75);
      drawText('Stop code: CRITICAL_PROCESS_DIED', 92, H2 - 52, '300 18px "Helvetica Neue", Arial, sans-serif', 0.9);

      if (stage >= 4) {
        // corruption grows into a face
        ctx.save();
        ctx.globalAlpha = clamp((stage - 4) / 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        const eyeY = fy - 40;
        const spread = 70 + stage * 10;
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(fx + dir * spread, eyeY, 26, 46 + stage * 6, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(fx, fy + 120, 60 + stage * 18, 0.1, Math.PI - 0.1);
        ctx.stroke();
        ctx.restore();
      }

      if (stage >= 2) {
        // horizontal tearing
        for (let i = 0; i < stage * 2; i++) {
          const y = Math.random() * H2;
          const h = 4 + Math.random() * 26;
          const dx = (Math.random() - 0.5) * stage * 26;
          const img = ctx.getImageData(0, y, W2, Math.min(h, H2 - y));
          ctx.putImageData(img, dx, y);
        }
      }
      if (stage >= 5) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 70; i++) ctx.fillRect(Math.random() * W2, Math.random() * H2, 2 + Math.random() * 60, 1 + Math.random() * 2);
        ctx.restore();
      }
    }

    if (mode === 'epilogue') {
      ctx.fillStyle = '#031027';
      ctx.fillRect(0, 0, W2, H2);
      const grd = ctx.createRadialGradient(W2 / 2, H2 / 2, 40, W2 / 2, H2 / 2, W2 * 0.7);
      grd.addColorStop(0, 'rgba(30,90,255,0.35)');
      grd.addColorStop(1, 'rgba(2,6,20,0.9)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W2, H2);
      ctx.fillStyle = '#eaf2ff';
      ctx.font = '300 120px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(':(', 90, 250);
      ctx.font = '300 26px monospace';
      ctx.fillStyle = '#9fbcff';
      ctx.fillText('wake_up?  [Y/N]', 94, 330);
      ctx.fillStyle = 'rgba(160,190,255,0.35)';
      ctx.font = '300 18px monospace';
      ctx.fillText('last saved state: 03:33:07', 94, 380);
      ctx.fillText('active process: you', 94, 408);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(120,170,255,${0.02 + Math.random() * 0.05})`;
        ctx.fillRect(0, Math.random() * H2, W2, 1);
      }
    }
    this.screenTexture.needsUpdate = true;
  }

  setEpilogue(on: boolean) {
    this.epilogue = on;
    this.epilogueGroup.visible = on;
    this.screenStage = 0;
    this.drawScreen(on ? 'epilogue' : 'off');
    this.monitorLight.color.set(on ? 0x3f79ff : 0x6f9bff);
    this.monitorSpill.color.set(on ? 0x2a5aff : 0x4d7dff);
    if (on) {
      this.clockStopped = true;
      this.clockHands[2].visible = false;
    } else {
      this.clockStopped = false;
      this.clockHands[2].visible = true;
    }
  }

  bakeProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene, envIntensity = 0.65) {
    if (this.probeBaked) return;
    const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 24, rt);
    cam.position.set(0, 1.5, 0.2);
    const prevEnv = scene.environment;
    scene.environment = null;
    scene.add(cam);
    cam.update(renderer, scene);
    scene.remove(cam);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromCubemap(rt.texture).texture;
    scene.environment = env;
    scene.environmentIntensity = envIntensity;
    this.probeBaked = true;
    this.probeTarget = rt;
    pmrem.dispose();
    if (prevEnv) prevEnv.dispose?.();
  }

  refreshScreen() {
    this.drawScreen(this.screenMode, this.screenStage);
  }

  setScreenStage(stage: number) {
    this.screenStage = stage;
    this.drawScreen('bsod', stage);
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    if (this.dust) this.dust.visible = camera.position.z > -1.5;
    this.time = time;
    // screen glow flicker, very subtle (well under 3Hz)
    this.monitorGlow = 0.92 + Math.sin(time * 2.1) * 0.03 + (Math.random() - 0.5) * 0.01;
    this.monitorLight.intensity = (this.epilogue ? 6.2 : 7.4) * this.monitorGlow;
    this.monitorSpill.intensity = (this.epilogue ? 2.6 : 3.1) * this.monitorGlow;
    this.monitorSpill.position.z = -1.92 + Math.sin(time * 0.4) * 0.01;

    // RGB cycle
    const rgbMat = (this as any).rgbRingMat as THREE.MeshBasicMaterial | undefined;
    if (rgbMat) rgbMat.color.setHSL((time * 0.03) % 1, 0.85, 0.55);
    this.rgbLight.color.setHSL((time * 0.03 + 0.55) % 1, 0.8, 0.55);
    this.rgbLight.intensity = 1.4 + Math.sin(time * 1.6) * 0.18;

    // clock
    if (!this.clockStopped) {
      const now = new Date();
      const sec = now.getSeconds() + now.getMilliseconds() / 1000;
      const min = now.getMinutes() + sec / 60;
      const hr = (now.getHours() % 12) + min / 60;
      this.clockHands[2].rotation.z = -(sec / 60) * Math.PI * 2;
      this.clockHands[1].rotation.z = -(min / 60) * Math.PI * 2;
      this.clockHands[0].rotation.z = -(hr / 12) * Math.PI * 2;
    } else {
      this.clockHands[2].visible = false;
      this.clockHands[1].rotation.z = -(3 / 60) * Math.PI * 2;
      this.clockHands[0].rotation.z = -(3 / 12) * Math.PI * 2;
    }

    // dust drifts in the monitor light
    if (this.dust) {
      const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 0.012 * (0.4 + (i % 7) / 7);
        let x = p.getX(i) + Math.sin(time * 0.2 + i) * dt * 0.004;
        if (y > 2.5) y = 0.02;
        p.setY(i, y);
        p.setX(i, x);
      }
      p.needsUpdate = true;
    }

    // curtains breathe gently
    if (this.curtains) {
      this.curtains.children.forEach((c, i) => {
        c.rotation.z = Math.sin(time * 0.35 + i) * 0.008;
      });
    }

    if (this.epilogue) {
      this.anomalyShards.children.forEach((m, i) => {
        const t = time + i * 0.7;
        m.position.y = 1.4 + Math.sin(t * 0.8) * 0.18 + (i % 3) * 0.14;
        m.rotation.x = t * 0.3;
        m.rotation.y = t * 0.45 + i;
      });
      this.monitorLight.intensity = 5.4 + Math.sin(time * 3.3) * 0.9;
    }
    // flashlight placement is done by the Game (camera space)
    void camera;
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose?.();
      }
    });
    this.probeTarget?.dispose();
    this.group.removeFromParent();
  }
}
