import * as THREE from 'three';
import type { Assets } from '../core/assets';
import type { AudioEngine } from '../core/audio';
import { CollisionWorld } from '../core/collision';
import { makeMaterial, solid, emissive, patchGlitch, glitchUniforms } from '../core/materials';
import {
  makeFaceTexture, makeGlyphAtlas, makeErrorOverlayTexture, makeTextTexture,
  makeBrokenUITexture,
} from '../core/textures';
import type { Interactable } from './Player';
import { RNG, clamp, fbm2, noise2, smoothstep, deg } from '../core/util';

/* 異世界のレイアウト (1 unit = 1 m / 北 = -z) */
export const WORLD = {
  arrival: new THREE.Vector3(0, 0, 104),
  architecture: new THREE.Vector3(0, 0, 22),
  cityWest: new THREE.Vector3(-62, 0, 20),
  cityEast: new THREE.Vector3(62, 0, 20),
  deep: new THREE.Vector3(-2, -12, 20),
  monolith: new THREE.Vector3(0, 0, -96),
  gate: new THREE.Vector3(0, 58, 104),
  size: 420,
};

type Chunk = { mesh: THREE.Object3D; base: THREE.Vector3; amp: number; speed: number; phase: number; rot: THREE.Vector3 };

/**
 * BSOD グリッチ世界。
 *  A 青い荒野 (到着) → B 崩壊した大型建築 → C 侵食された都市 (東西) → D 深層 → E 中心構造物
 * すべて歩いて連結され、ロード画面や暗転を挟まない。
 */
export class World {
  group = new THREE.Group();
  collision = new CollisionWorld();
  interactables: Interactable[] = [];
  onText?: (text: string, duration?: number) => void;
  onConsoleHint?: () => void;
  onSecret?: () => void;
  chamberCenter = new THREE.Vector3(0, 2.4, -96);

  private chunks: Chunk[] = [];
  private debris!: THREE.InstancedMesh;
  private debrisData: { base: THREE.Vector3; rot: THREE.Euler; amp: number; phase: number }[] = [];
  private glyphField!: THREE.InstancedMesh;
  private glyphData: { base: THREE.Vector3; speed: number; phase: number; scale: number }[] = [];
  private rings: THREE.Object3D[] = [];
  private beams: THREE.Mesh[] = [];
  private uiPanels: THREE.Mesh[] = [];
  private glyphAtlas = makeGlyphAtlas(512);
  private skyMat?: THREE.ShaderMaterial;
  private chamberLight?: THREE.PointLight;
  private revealed = false;
  private rng = new RNG(20240601);

  constructor(private scene: THREE.Scene, private assets: Assets, private audio: AudioEngine) {}

  /* ================= 地形 ================= */
  terrainHeight(x: number, z: number) {
    let h = fbm2(x * 0.011, z * 0.011, 4) * 5.4 + fbm2(x * 0.045, z * 0.045, 3) * 0.7;
    const flat = Math.max(
      smoothstep(34, 16, Math.hypot(x - WORLD.arrival.x, z - WORLD.arrival.z)),
      smoothstep(32, 16, Math.hypot(x - WORLD.monolith.x, z - WORLD.monolith.z)),
      smoothstep(46, 26, Math.hypot(x - WORLD.architecture.x, z - WORLD.architecture.z)),
      smoothstep(34, 18, Math.hypot(x - WORLD.cityWest.x, z - WORLD.cityWest.z)),
      smoothstep(34, 18, Math.hypot(x - WORLD.cityEast.x, z - WORLD.cityEast.z)),
      smoothstep(70, 20, Math.hypot(x, z - 22)),
    );
    h *= 1 - flat * 0.96;
    // 建築物の足元は地下まで掘り下げる (1F スラブと地下の天井が覆い隠す)
    const AB = WORLD.architecture;
    const dIn = Math.min(18 - Math.abs(x - AB.x), 18 - Math.abs(z - AB.z));
    const insideB = smoothstep(0, 2.6, dIn);
    h = h * (1 - insideB) + (-16.5) * insideB;
    // 中心構造物の土台 (高さ 0.4) と地面を面一にする
    const dMono = Math.hypot(x - WORLD.monolith.x, z - WORLD.monolith.z);
    h = h * (1 - smoothstep(44, 30, dMono)) + 0.4 * smoothstep(44, 30, dMono);
    const rim = smoothstep(150, 198, Math.hypot(x * 0.95, z));
    h -= rim * 52;
    return h;
  }

  private buildTerrain() {
    const size = WORLD.size;
    const seg = 160;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.terrainHeight(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.assets.texSet('ground').then((set) => {
      if (!set.albedo) return;
      const mk = (t: THREE.Texture | null) => {
        if (!t) return null;
        const c = t.clone(); c.needsUpdate = true;
        c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(70, 70);
        return c;
      };
      const orm = mk(set.orm);
      const mat = new THREE.MeshStandardMaterial({
        map: mk(set.albedo), normalMap: mk(set.normal), aoMap: orm, roughnessMap: orm, metalnessMap: orm,
        color: 0x6b8cb5, roughness: 0.92, metalness: 0.85, envMapIntensity: 0.45,
        emissive: new THREE.Color(0x08192c), emissiveIntensity: 0.6,
      });
      patchGlitch(mat, 0.14);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
    // 建築物の内部は床スラブ (と階段) が歩行面を受け持つ。地形を持ち込むと
    // 階段穴が地形で埋まってしまうため、フットプリント内では地形を無効化する。
    const AB = WORLD.architecture;
    // マップ外縁 (地形の落ち込みに入れないための不可視境界)
    const R = 158;
    this.collision.addBlocker(-R - 4, -R, -R - 4, R + 4, -80, 60);
    this.collision.addBlocker(R, R + 4, -R - 4, R + 4, -80, 60);
    this.collision.addBlocker(-R - 4, R + 4, -R - 4, -R, -80, 60);
    this.collision.addBlocker(-R - 4, R + 4, R, R + 4, -80, 60);
    this.collision.terrain = (x, z) => {
      if (x > AB.x - 18.2 && x < AB.x + 18.2 && z > AB.z - 18.2 && z < AB.z + 18.2) return -Infinity;
      return this.terrainHeight(x, z);
    };
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 low  = vec3(0.016, 0.052, 0.098);
          vec3 mid  = vec3(0.024, 0.098, 0.190);
          vec3 high = vec3(0.004, 0.010, 0.026);
          vec3 col = mix(low, mid, smoothstep(0.46, 0.62, h));
          col = mix(col, high, smoothstep(0.62, 0.96, h));
          float band = sin(h * 140.0 + uTime * 0.12) * 0.5 + 0.5;
          col += vec3(0.008, 0.028, 0.055) * band * smoothstep(0.12, 0.6, h);
          vec2 g = floor(vDir.xz * 260.0);
          col += vec3(0.7, 0.85, 1.0) * step(0.9987, hash(g)) * smoothstep(0.2, 0.8, h) * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(620, 32, 24), mat);
    sky.frustumCulled = false;
    this.group.add(sky);
    this.skyMat = mat;
  }

  /* ================= ビルド ================= */
  async build() {
    this.buildSky();
    this.buildTerrain();
    this.buildLights();
    await this.buildArrival();
    await this.buildArchitecture();
    await this.buildCity();
    this.buildDeep();
    this.buildMonolith();
    this.buildDebris();
    this.buildGlyphRain();
    this.buildPathMarkers();
    this.buildConsoleHints();
  }

  private buildLights() {
    this.group.add(new THREE.HemisphereLight(0x3d7099, 0x03070d, 0.6));
    const moon = new THREE.DirectionalLight(0xa4cdf5, 1.5);
    moon.position.set(-90, 130, 70);
    this.group.add(moon);
    const fill = new THREE.DirectionalLight(0x1d4f8a, 0.8);
    fill.position.set(70, 40, -120);
    this.group.add(fill);
  }

  /* ---------------- 共通ヘルパ ---------------- */
  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, opts: { shadow?: boolean; block?: boolean; ry?: number } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = opts.ry ?? 0;
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    this.group.add(m);
    if (opts.block) this.collision.addBlocker(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y, y + h);
    return m;
  }

  /** 階段 (rise が負なら下り) */
  private stair(x: number, z0: number, dz: number, count: number, rise: number, run: number, width: number, y0: number, mat: THREE.Material, railing = true) {
    for (let i = 0; i < count; i++) {
      const z = z0 + dz * i * run;
      const y = y0 + (i + 1) * rise;
      const m = new THREE.Mesh(new THREE.BoxGeometry(width, Math.abs(rise) + 0.06, run + 0.02), mat);
      m.position.set(x, y - rise / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.collision.addPlatform(x - width / 2, x + width / 2, z - run, z + run, y);
    }
    if (railing) {
      const len = count * run;
      for (const side of [-width / 2 - 0.05, width / 2 + 0.05]) {
        this.collision.addBlocker(
          x + side - 0.08, x + side + 0.08,
          Math.min(z0, z0 + dz * len) - 0.3, Math.max(z0, z0 + dz * len) + 0.3,
          Math.min(y0, y0 + count * rise), Math.max(y0, y0 + count * rise) + 1.1,
        );
      }
    }
  }

  /* ---------------- A: 青い荒野 (到着) ---------------- */
  private async buildArrival() {
    const A = WORLD.arrival;
    const rockMat = await makeMaterial(this.assets, 'rock', { repeat: [1, 1], pole: 0.9, roughness: 0.9, metalness: 0.6, emissive: 0x0a2040, emissiveIntensity: 0.8 });

    // 台座
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 1.4, 9), new THREE.MeshStandardMaterial({ color: 0x2f4d70, roughness: 0.8, metalness: 0.4, flatShading: true }));
    plaza.position.set(A.x, -0.6, A.z);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    this.collision.addPlatform(A.x - 8.6, A.x + 8.6, A.z - 8.6, A.z + 8.6, 0.12);

    // 空に開いた「:(」— ここから落ちてきた
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: makeFaceTexture(1024), transparent: true, opacity: 0.9, color: 0xbcd8ff,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
    face.scale.setScalar(46);
    face.position.copy(WORLD.gate);
    face.rotation.x = Math.PI / 2;
    face.rotation.z = Math.PI;
    this.group.add(face);
    const gateLight = new THREE.PointLight(0x9cc8ff, 30, 150, 2);
    gateLight.position.copy(WORLD.gate).add(new THREE.Vector3(0, -4, 0));
    this.group.add(gateLight);

    // 浮遊する岩塊
    const rng = new RNG(1234);
    const islandGeo = new THREE.IcosahedronGeometry(1, 1);
    const p = islandGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      const n = noise2(v.x * 2.2 + 5, v.z * 2.2 + 1) * 0.45 + noise2(v.y * 3.1, v.x * 3.1) * 0.2;
      v.multiplyScalar(0.75 + n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    islandGeo.computeVertexNormals();
    const islands = new THREE.InstancedMesh(islandGeo, rockMat, 42);
    islands.receiveShadow = true;
    const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    for (let i = 0; i < 42; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = rng.range(18, 116);
      const x = A.x + Math.cos(ang) * rad;
      const z = A.z + Math.sin(ang) * rad * 0.85 - 20;
      const y = rng.range(-4, 34) + (rad > 55 ? rng.range(0, 22) : 0);
      const s = rng.range(1.2, 7);
      e.set(rng.range(-0.4, 0.4), rng.range(0, 6.28), rng.range(-0.4, 0.4));
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * rng.range(0.5, 1.3), s));
      islands.setMatrixAt(i, m4);
    }
    islands.instanceMatrix.needsUpdate = true;
    this.group.add(islands);

    // 破損したブート端末 (コンソールの存在を示す)
    const kiosk = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 0.35), solid(0x1b2c44, { roughness: 0.6, metalness: 0.5 }));
    shell.position.y = 1.05;
    kiosk.add(shell);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: makeTextTexture('C:\\>', { width: 512, height: 512, font: '600 180px ui-monospace, monospace', color: '#cfe8ff', glow: 30 }), color: 0x9fd0ff, transparent: true, opacity: 0.92 }));
    scr.position.set(0, 1.3, 0.19);
    kiosk.add(scr);
    kiosk.position.set(A.x + 7, 0, A.z - 11);
    kiosk.rotation.y = -0.45;
    this.group.add(kiosk);
    this.collision.addBlocker(A.x + 6.2, A.x + 7.8, A.z - 11.4, A.z - 10.6, 0, 2.2);
    this.interactables.push({
      id: 'kiosk', point: new THREE.Vector3(A.x + 7, 1.3, A.z - 10.6), radius: 3.4,
      label: '破損した端末を調べる',
      onUse: () => {
        this.onText?.('BOOT: MEMORY[0x1A00] 破損\nINTERFACE: OPERATOR_CONSOLE  (入力装置: [C])\n> 復元できる命令は 1 つだけ。名前は、もっと深くにある。', 9000);
        this.onConsoleHint?.();
      },
    });

    // 道しるべ
    for (let i = 0; i < 3; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.22), solid(0x2a4166, { roughness: 0.7 }));
      post.position.set(A.x + (i - 1) * 3.4, 1.6, A.z - 19 - i * 1.6);
      post.rotation.z = (i - 1) * 0.07;
      this.group.add(post);
      const arrow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1),
        new THREE.MeshBasicMaterial({ map: makeTextTexture('>>', { width: 512, height: 256, font: '700 150px ui-monospace, monospace', color: '#9fd6ff', glow: 24 }), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      arrow.position.set(A.x + (i - 1) * 3.4, 2.9, A.z - 19 - i * 1.6);
      arrow.rotation.y = -0.12;
      this.group.add(arrow);
    }
  }

  /* ---------------- B: 崩壊した大型建築 ---------------- */
  private async buildArchitecture() {
    const B = WORLD.architecture;
    const concrete = await makeMaterial(this.assets, 'concrete', { repeat: [2, 2], pole: 0.85, roughness: 0.9, metalness: 0.65 });
    const brick = await makeMaterial(this.assets, 'brick', { repeat: [3, 2], pole: 0.9, roughness: 0.95, metalness: 0.55 });
    const metal = await makeMaterial(this.assets, 'metal', { repeat: [2, 2], pole: 0.7, roughness: 0.5, metalness: 0.9 });

    const slab = (w: number, d: number, x: number, z: number, y: number, mat = concrete) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), mat);
      m.position.set(x, y - 0.25, z);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.collision.addPlatform(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y);
    };
    const wall = (w: number, h: number, d: number, x: number, y: number, z: number, mat = brick) => this.box(w, h, d, mat, x, y, z, { block: true });

    // 1F 床 (中央に吹き抜け + 深層への階段穴)
    slab(36, 8, B.x, B.z + 14, 0);          // 南 (入口側 z 30..38)
    slab(36, 10, B.x, B.z - 15, 0);         // 北 (z 2..12)
    slab(14, 20, B.x - 11, B.z, 0);         // 西 (x -18..-4)
    slab(14, 20, B.x + 11, B.z, 0);         // 東 (x 4..18)
    slab(36, 4, B.x, B.z + 8, 0);           // 南 (階段穴の手前 z 28..32)

    // 外壁 (南は入口、北は中心構造物へ続く通路の開口部)
    wall(15, 10, 0.8, B.x - 10.5, 0, B.z - 18);
    wall(15, 10, 0.8, B.x + 10.5, 0, B.z - 18);
    // 北の通路 (奥へ抜ける)
    for (const sx of [-1, 1]) {
      this.box(0.8, 5, 16, brick, B.x + sx * 3.4, 0, B.z - 26, { block: true });
    }
    const nroof = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.5, 16), concrete);
    nroof.position.set(B.x, 5, B.z - 26);
    nroof.castShadow = true;
    this.group.add(nroof);
    slab(7.6, 16, B.x, B.z - 26, 0);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0x8fc8ff, 6, 14, 2);
      l.position.set(B.x, 3.2, B.z - 20 - i * 4);
      this.group.add(l);
    }
    // 東西の外壁: 2F の橋が通る高さ (y 4.2..6.2 / z 18..22) に開口部を空ける
    for (const side of [-18, 18]) {
      wall(0.8, 4.2, 36, B.x + side, 0, B.z);       // 腰壁
      wall(0.8, 3.8, 36, B.x + side, 6.2, B.z);     // 上部
      wall(0.8, 2.0, 14, B.x + side, 4.2, B.z - 11); // 北側の見切り
      wall(0.8, 2.0, 18, B.x + side, 4.2, B.z + 9);  // 南側の見切り
    }
    wall(13, 10, 0.8, B.x - 11.5, 0, B.z + 18);
    wall(13, 10, 0.8, B.x + 11.5, 0, B.z + 18);
    wall(10, 3, 0.8, B.x, 7, B.z + 18);     // 入口の梁
    // 入口の床 (外へ少し伸びる)
    slab(10, 6, B.x, B.z + 21, 0);

    // 2F の U 字バルコニー (y 4.2)
    const y2 = 4.2;
    slab(8, 32, B.x - 14, B.z - 0, y2);     // 西 x -18..-10
    slab(8, 32, B.x + 14, B.z - 0, y2);     // 東 x 10..18
    slab(36, 8, B.x, B.z - 14, y2);         // 北 z 2..10
    // 3F のメザニン (y 8.4, 北側)
    const y3 = 8.4;
    slab(36, 10, B.x, B.z - 13, y3);

    // 柱
    for (const x of [-17, -9.5, 9.5, 17]) {
      for (const z of [-16, -4, 8, 14]) {
        this.box(1.0, 11.5, 1.0, concrete, B.x + x, 0, B.z + z, { block: true });
      }
    }
    // 梁
    for (let i = 0; i < 7; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(36, 0.4, 0.5), metal);
      beam.position.set(B.x, 11.4, B.z - 16 + i * 5.4);
      beam.rotation.z = Math.sin(i * 1.7) * 0.02;
      this.group.add(beam);
    }

    // 1F → 2F の階段 (東側、吹き抜けの中)
    this.stair(B.x + 6.5, B.z + 11, 1, 20, 0.21, 0.45, 2.6, 0, concrete);
    slab(3.0, 3.0, B.x + 8.6, B.z + 19.2, y2, concrete);  // 上がり口の踊り場
    // 2F 東バルコニーへの接続
    slab(3.2, 3.0, B.x + 11, B.z + 19.2, y2, concrete);

    // 2F → 3F の階段 (西側)
    this.stair(B.x - 14, B.z + 8, -1, 20, 0.21, 0.45, 2.6, y2, concrete);
    slab(12, 3.4, B.x - 12, B.z - 10.6, y3, concrete);

    // 手すり (吹き抜けの縁・バルコニー)
    const railing = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ang = Math.atan2(z1 - z0, x1 - x0);
      for (const yy of [1.02, 0.55]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), metal);
        bar.position.set((x0 + x1) / 2, y + yy, (z0 + z1) / 2);
        bar.rotation.y = -ang;
        this.group.add(bar);
      }
      const posts = Math.max(2, Math.floor(len / 1.5));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), metal);
        p.position.set(x0 + (x1 - x0) * t, y + 0.52, z0 + (z1 - z0) * t);
        this.group.add(p);
      }
      this.collision.addBlocker(
        Math.min(x0, x1) - 0.22, Math.max(x0, x1) + 0.22,
        Math.min(z0, z1) - 0.22, Math.max(z0, z1) + 0.22, y, y + 1.1,
      );
    };
    railing(B.x - 10, B.z - 10, B.x - 10, B.z + 16, y2);
    railing(B.x + 10, B.z - 10, B.x + 10, B.z + 16, y2);
    railing(B.x - 10, B.z - 10, B.x + 10, B.z - 10, y2);
    railing(B.x - 18, B.z - 8, B.x + 18, B.z - 8, y3);
    railing(B.x - 9, B.z - 8, B.x - 9, B.z + 10, y3);
    railing(B.x + 9, B.z - 8, B.x + 9, B.z + 10, y3);

    // 天井の開口部 (光の柱)
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3, 8, 26, 18, 1, true), beamMat);
    shaft.position.set(B.x + 1, 12, B.z - 2);
    this.group.add(shaft);
    this.beams.push(shaft);
    const bl = new THREE.PointLight(0x9fd0ff, 18, 46, 2);
    bl.position.set(B.x + 1, 9, B.z - 2);
    this.group.add(bl);

    // 侵食された UI 断片
    const uiTex = makeBrokenUITexture(512, 512, new RNG(31));
    const uiMat = new THREE.MeshBasicMaterial({ map: uiTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const rng = new RNG(77);
    for (let i = 0; i < 16; i++) {
      const w = rng.range(2, 5.5), h = rng.range(1.4, 3.4);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), uiMat);
      const onX = rng.next() > 0.5;
      if (onX) {
        panel.position.set(B.x + rng.sign() * 17.4, rng.range(2, 9), B.z + rng.range(-16, 16));
        panel.rotation.y = rng.sign() * Math.PI / 2;
      } else {
        panel.position.set(B.x + rng.range(-17, 17), rng.range(2, 9), B.z + rng.sign() * 17.4);
      }
      panel.rotation.z = rng.range(-0.05, 0.05);
      this.group.add(panel);
      this.uiPanels.push(panel);
    }

    // 記憶の断片 (glTF 家具)
    const fragments: { key: string; h: number; pos: [number, number, number]; ry?: number }[] = [
      { key: 'sofa', h: 1.0, pos: [B.x + 5.5, 5.1, B.z + 6], ry: 0.7 },
      { key: 'chair', h: 0.95, pos: [B.x - 6.5, 0.0, B.z + 8], ry: 2.2 },
      { key: 'bottle', h: 2.4, pos: [B.x - 2, 4.4, B.z - 6] },
      { key: 'vase', h: 1.5, pos: [B.x - 4, 8.6, B.z + 2] },
      { key: 'toycar', h: 1.3, pos: [B.x + 13, 8.6, B.z - 12], ry: 1.1 },
      { key: 'plant', h: 1.5, pos: [B.x - 13, 4.4, B.z - 12] },
      { key: 'lantern', h: 2.2, pos: [B.x + 15.5, 0, B.z - 14] },
    ];
    for (const f of fragments) {
      const obj = await this.assets.instance(f.key, { scale: this.assets.scaleFor(f.key, f.h), rotateY: f.ry ?? 0 });
      obj.position.set(...f.pos);
      this.bsodify(obj, 0.6);
      this.group.add(obj);
      const l = new THREE.PointLight(0x7fb6ff, 4.5, 18, 2);
      l.position.set(f.pos[0], f.pos[1] + 0.8, f.pos[2]);
      this.group.add(l);
      this.chunks.push({ mesh: obj, base: obj.position.clone(), amp: 0.32, speed: 0.35, phase: Math.random() * 6.28, rot: new THREE.Vector3(0.02, 0.05, 0.01) });
    }

    // 瓦礫
    const rubbleMat = await makeMaterial(this.assets, 'concrete', { repeat: [1, 1], pole: 1, color: 0x93a8be });
    const rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rubbleMat, 110);
    const rm = new THREE.Matrix4(); const rq = new THREE.Quaternion(); const re = new THREE.Euler();
    for (let i = 0; i < 110; i++) {
      const x = B.x + rng.range(-17, 17);
      const z = B.z + rng.range(-17, 17);
      re.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      rq.setFromEuler(re);
      const s = rng.range(0.2, 1.0);
      const y = (Math.abs(x - B.x) < 4 && Math.abs(z - B.z) < 10) ? -8 : 0.1;
      rm.compose(new THREE.Vector3(x, y, z), rq, new THREE.Vector3(s, s * 0.6, s));
      rubble.setMatrixAt(i, rm);
    }
    rubble.instanceMatrix.needsUpdate = true;
    rubble.castShadow = true; rubble.receiveShadow = true;
    this.group.add(rubble);

    // 北へ続く誘導路: 地面に沈んだ発光プレート + 淡い光柱
    const guide = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({
        map: makeTextTexture(':(', { width: 256, height: 256, font: '700 190px system-ui, sans-serif', color: '#bfe0ff', glow: 30 }),
        transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }),
      34,
    );
    const gm = new THREE.Matrix4();
    const gq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < 34; i++) {
      const z = B.z - 24 - i * 2.6;
      const x = Math.sin(i * 0.45) * 2.4;
      const y = this.terrainHeight(x, z) + 0.02;
      gm.compose(new THREE.Vector3(x, y, z), gq, new THREE.Vector3(1, 1, 1));
      guide.setMatrixAt(i, gm);
    }
    guide.instanceMatrix.needsUpdate = true;
    this.group.add(guide);
  }

  /* ---------------- C: 侵食された都市 ---------------- */
  private async buildCity() {
    const asphalt = await makeMaterial(this.assets, 'asphalt', { repeat: [8, 8], pole: 0.9, roughness: 0.92, metalness: 0.55 });
    const concrete = await makeMaterial(this.assets, 'concrete', { repeat: [2, 3], pole: 0.95, roughness: 0.9 });

    const cityBlock = async (center: THREE.Vector3, count: number, spread: number, seed: number) => {
      const r = new RNG(seed);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(spread * 2.2, 90), asphalt);
      road.rotation.x = -Math.PI / 2;
      road.position.set(center.x, 0.04, center.z);
      road.receiveShadow = true;
      this.group.add(road);

      for (let i = 0; i < count; i++) {
        const w = r.range(6, 13), d = r.range(6, 13), h = r.range(10, 44);
        const x = center.x + r.range(-spread, spread);
        const z = center.z + r.range(-40, 40);
        if (Math.abs(x - center.x) < 7) continue;
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concrete);
        body.position.y = h / 2;
        body.castShadow = true; body.receiveShadow = true;
        g.add(body);

        const winGeo = new THREE.PlaneGeometry(1.1, 1.6);
        const winMat = new THREE.MeshBasicMaterial({ color: 0x86c6ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const cols = Math.max(1, Math.floor(w / 2.2)), rows = Math.max(1, Math.floor(h / 3));
        const wins = new THREE.InstancedMesh(winGeo, winMat, cols * rows * 2);
        let wi = 0;
        const m4 = new THREE.Matrix4();
        for (let cx = 0; cx < cols; cx++) {
          for (let cy = 0; cy < rows; cy++) {
            if (r.next() > 0.5) continue;
            m4.makeTranslation(-w / 2 + 1.2 + cx * 2.2, 1.8 + cy * 3, d / 2 + 0.02);
            wins.setMatrixAt(wi++, m4);
            if (wi >= wins.count) break;
          }
          if (wi >= wins.count) break;
        }
        wins.count = wi;
        wins.instanceMatrix.needsUpdate = true;
        g.add(wins);

        g.position.set(x, 0, z);
        g.rotation.z = r.range(-0.12, 0.12);
        g.rotation.y = r.range(0, 6.28);
        this.group.add(g);
        this.collision.addBlocker(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h);

        if (r.next() > 0.4) {
          const tex = makeErrorOverlayTexture(512, 0.22, new RNG(seed + i));
          const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.8),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
          p.position.set(x, h * 0.45, z + d / 2 + 0.12);
          p.rotation.y = g.rotation.y;
          this.group.add(p);
        }
      }
      for (let i = 0; i < 4; i++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(r.range(1.5, 4), r.range(0.8, 2), r.range(2, 6)), concrete);
        box.position.set(center.x + r.range(-spread, spread), r.range(9, 28), center.z + r.range(-40, 40));
        box.rotation.set(r.range(0, 1), r.range(0, 6), r.range(0, 1));
        this.group.add(box);
        this.chunks.push({ mesh: box, base: box.position.clone(), amp: 0.5, speed: 0.2, phase: r.range(0, 6), rot: new THREE.Vector3(0.01, 0.02, 0.01) });
      }
    };

    await cityBlock(WORLD.cityWest, 16, 44, 411);
    await cityBlock(WORLD.cityEast, 16, 44, 733);

    // 建築 (2F) から都市への橋 (軸を揃えて衝突判定を単純化)
    const bridge = (x0: number, x1: number, z: number, y: number) => {
      const w = Math.abs(x1 - x0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 4), concrete);
      mesh.position.set((x0 + x1) / 2, y - 0.25, z);
      mesh.receiveShadow = true; mesh.castShadow = true;
      this.group.add(mesh);
      this.collision.addPlatform(Math.min(x0, x1), Math.max(x0, x1), z - 2, z + 2, y);
      for (const side of [-2.05, 2.05]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.08), solid(0x3a5675, { roughness: 0.5, metalness: 0.7 }));
        rail.position.set((x0 + x1) / 2, y + 1.0, z + side);
        this.group.add(rail);
        this.collision.addBlocker(Math.min(x0, x1), Math.max(x0, x1), z + side - 0.1, z + side + 0.1, y, y + 1.1);
      }
      // 支柱 (見た目のみ)
      for (let i = 0; i < 4; i++) {
        const px = Math.min(x0, x1) + (w * (i + 0.5)) / 4;
        const pier = new THREE.Mesh(new THREE.BoxGeometry(1.2, y, 1.2), concrete);
        pier.position.set(px, y / 2, z);
        this.group.add(pier);
      }
    };
    // 記憶の断片: 都市の上に漂うヘルメット
    for (const [key, pos, h] of [['helmet_flight', [WORLD.cityEast.x - 12, 12.5, WORLD.cityEast.z - 8], 2.2], ['helmet_scifi', [WORLD.cityWest.x + 9, 7.4, WORLD.cityWest.z + 12], 1.6]] as const) {
      const helm = await this.assets.instance(key, { targetHeight: h, rotateY: 0.8 });
      helm.position.set(pos[0], pos[1], pos[2]);
      this.bsodify(helm, 0.65);
      this.group.add(helm);
      const l = new THREE.PointLight(0x8fd0ff, 6, 16, 2);
      l.position.set(pos[0], pos[1] + 0.6, pos[2]);
      this.group.add(l);
      this.chunks.push({ mesh: helm, base: helm.position.clone(), amp: 0.28, speed: 0.42, phase: Math.random() * 6.28, rot: new THREE.Vector3(0.04, 0.06, 0.03) });
    }
    bridge(-18, -34, 20, 4.2);
    bridge(18, 34, 20, 4.2);
    // 橋の接続部の床 (都市側)
    this.collision.addPlatform(-40, -30, 8, 32, 4.2);
    this.collision.addPlatform(30, 40, 8, 32, 4.2);
  }

  /* ---------------- D: 深層 (建築の地下) ---------------- */
  private buildDeep() {
    const D = WORLD.deep;
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1520, roughness: 0.86, metalness: 0.55 });
    const wire = new THREE.MeshStandardMaterial({ color: 0x102636, roughness: 0.5, metalness: 0.85 });

    const floorY = -12;
    // 床
    const floor = new THREE.Mesh(new THREE.BoxGeometry(46, 0.6, 38), dark);
    floor.position.set(D.x, floorY - 0.3, D.z);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.collision.addPlatform(D.x - 23, D.x + 23, D.z - 19, D.z + 19, floorY);

    // 壁
    const walls: [number, number, number, number, number, number][] = [
      [46, 11, 0.8, D.x, floorY + 5.5, D.z - 19],
      [46, 11, 0.8, D.x, floorY + 5.5, D.z + 19],
      [0.8, 11, 38, D.x - 23, floorY + 5.5, D.z],
      [0.8, 11, 38, D.x + 23, floorY + 5.5, D.z],
    ];
    for (const [w, h, d, x, y, z] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), dark);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.group.add(m);
      this.collision.addBlocker(x - w / 2, x + w / 2, z - d / 2, z + d / 2, floorY, floorY + 11);
      this.collision.addBlocker(x - w / 2, x + w / 2, z - d / 2, z + d / 2, floorY, floorY + 11);
    }
    // 天井 (階段穴の周囲)
    const ceilY = -1.4;
    const ceilings: [number, number, number, number][] = [
      [46, 11, D.x, D.z - 13.5],
      [46, 11, D.x, D.z + 13.5],
      [17, 16, D.x - 14.5, D.z],
      [17, 16, D.x + 14.5, D.z],
    ];
    for (const [w, d, x, z] of ceilings) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), dark);
      m.position.set(x, ceilY, z);
      this.group.add(m);
    }

    // 建築 1F の吹き抜けから地下へ降りる二段の階段 (折り返し)
    const zTop = WORLD.architecture.z + 5.6;   // 27.6
    this.stair(D.x + 1.7, zTop, -1, 28, -0.21, 0.53, 2.8, 0, dark);
    // 踊り場 (折り返し)
    const landing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 2.2), dark);
    landing.position.set(D.x + 0.2, -6.1, WORLD.architecture.z - 8.1);
    landing.receiveShadow = true;
    this.group.add(landing);
    this.collision.addPlatform(D.x - 3.3, D.x + 3.7, WORLD.architecture.z - 9.2, WORLD.architecture.z - 7.0, -5.88);
    // 二段目 (南へ戻る)
    this.stair(D.x - 1.9, WORLD.architecture.z - 11.6, 1, 28, -0.215, 0.53, 2.8, -5.88, dark);
    // 踊り場の北側の手すり (落下防止)
    this.collision.addBlocker(D.x - 3.4, D.x + 3.8, WORLD.architecture.z - 10.4, WORLD.architecture.z - 10.0, -5.9, -4.8);
    // 二段の階段の間の仕切り (転落防止)
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 14), dark);
    divider.position.set(D.x - 2.1, -6, WORLD.architecture.z + 2.5);
    divider.receiveShadow = true;
    this.group.add(divider);
    this.collision.addBlocker(D.x - 2.55, D.x - 1.65, WORLD.architecture.z - 4.5, WORLD.architecture.z + 9.5, -12, 0);
    // 吹き抜けの縁の手すり (1F)
    for (const [x0, z0, x1, z1] of [[-4, 12, 4, 12], [-4, 12, -4, 28], [4, 12, 4, 28]] as const) {
      this.collision.addBlocker(Math.min(x0, x1) - 0.12, Math.max(x0, x1) + 0.12, Math.min(z0, z1) - 0.12, Math.max(z0, z1) + 0.12, 0, 1.05);
    }

    // 配線
    const rng = new RNG(4040);
    for (let i = 0; i < 22; i++) {
      const pts: THREE.Vector3[] = [];
      let p = new THREE.Vector3(D.x + rng.range(-20, 20), floorY + rng.range(0.3, 8), D.z + rng.range(-17, 17));
      for (let k = 0; k < 5; k++) {
        pts.push(p.clone());
        p = p.clone().add(new THREE.Vector3(rng.range(-6, 6), rng.range(-1.4, 1.4), rng.range(-6, 6)));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, rng.range(0.02, 0.07), 5, false), wire);
      this.group.add(tube);
    }

    // ブロックノイズ
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x04121e, roughness: 0.9, metalness: 0.3, emissive: 0x0a2c4c, emissiveIntensity: 0.55 }), 120);
    const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    for (let i = 0; i < 120; i++) {
      e.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      q.setFromEuler(e);
      const s = rng.range(0.3, 2.2);
      m4.compose(new THREE.Vector3(D.x + rng.range(-21, 21), floorY + rng.range(0.6, 9), D.z + rng.range(-17, 17)), q, new THREE.Vector3(s, s, s));
      blocks.setMatrixAt(i, m4);
    }
    blocks.instanceMatrix.needsUpdate = true;
    this.group.add(blocks);

    // 隠し部屋 (机 / モニター)
    const hx = D.x + 13, hz = D.z + 10;
    const hidden = new THREE.Group();
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), solid(0x24313f, { roughness: 0.7 }));
    desk.position.set(0, 0.74, 0);
    hidden.add(desk);
    for (const dx of [-1.1, 1.1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 0.9), solid(0x1a232e, { roughness: 0.6, metalness: 0.4 }));
      leg.position.set(dx, 0.37, 0);
      hidden.add(leg);
    }
    const mon = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.06), solid(0x0a0f16, { roughness: 0.4 }));
    mon.position.set(0, 1.2, -0.42);
    hidden.add(mon);
    const monFace = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.56),
      new THREE.MeshBasicMaterial({ map: makeTextTexture('NO CARRIER', { width: 512, height: 320, font: '600 48px ui-monospace, monospace', color: '#8fd4ff', glow: 20 }), color: 0x88c8ff, transparent: true, opacity: 0.9 }));
    monFace.position.set(0, 1.2, -0.38);
    hidden.add(monFace);
    const hl = new THREE.PointLight(0x6fb8ff, 9, 14, 2);
    hl.position.set(0, 1.5, -0.2);
    hidden.add(hl);
    hidden.position.set(hx, floorY, hz);
    hidden.rotation.y = Math.PI;
    this.group.add(hidden);
    this.collision.addBlocker(hx - 1.4, hx + 1.4, hz - 0.7, hz + 0.7, floorY, floorY + 1.0);
    const chair = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16), solid(0x1a2632, { roughness: 0.7 }));
    chair.position.set(hx, floorY + 0.45, hz - 1.2);
    this.group.add(chair);
    this.interactables.push({
      id: 'hidden_pc', point: new THREE.Vector3(hx, floorY + 1.2, hz - 0.6), radius: 2.6,
      label: '古い記録を読む',
      onUse: () => this.onText?.('最後のセッション: 03:07\n復元コマンド: 未入力\n—— 起動と同時に、この椅子は空になった。', 7500),
    });

    // 非常灯
    for (let i = 0; i < 4; i++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), emissive(0xff5a3c, 8));
      lamp.position.set(D.x - 15 + i * 10, floorY + 8.2, D.z - 17.5);
      this.group.add(lamp);
      const l = new THREE.PointLight(0xff5a3c, 4, 12, 2);
      l.position.copy(lamp.position);
      this.group.add(l);
    }
    // 足元の誘導灯
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0x4fa8ff, 3.2, 14, 2);
      l.position.set(D.x - 18 + i * 7, floorY + 1.2, D.z + 14);
      this.group.add(l);
    }
  }

  /* ---------------- E: 中心構造物 ---------------- */
  private buildMonolith() {
    const E = WORLD.monolith;
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x16324e, roughness: 0.42, metalness: 0.92, envMapIntensity: 0.9 });
    const glowMat = emissive(0x9fd6ff, 3.6);

    // 土台: 地形と面一の 1 段 (歩行面は terrain 側が与える)
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(36, 37.5, 1.2, 48), metalMat);
    plinth.position.set(E.x, -0.2, E.z);
    plinth.receiveShadow = true;
    this.group.add(plinth);
    // 同心円の発光ラインと外周の刻印
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(15 + i * 7, 15.25 + i * 7, 64), glowMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(E.x, 0.415, E.z);
      this.group.add(ring);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5),
        new THREE.MeshBasicMaterial({
          map: makeTextTexture(i % 2 ? 'MEMORY' : '0x0000001A', { width: 512, height: 128, font: '700 74px ui-monospace, monospace', color: '#cfe8ff', glow: 24 }),
          transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
      plate.rotation.x = -Math.PI / 2;
      plate.rotation.z = -a;
      plate.position.set(E.x + Math.cos(a) * 31, 0.42, E.z + Math.sin(a) * 31);
      this.group.add(plate);
    }

    for (let i = 0; i < 15; i++) {
      const s = 9.5 - i * 0.42;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(s, 1.6, s), metalMat);
      slab.position.set(E.x, 4.6 + i * 5.2, E.z);
      slab.rotation.y = i * 0.14;
      this.group.add(slab);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(s * 0.92, 0.08, s * 0.92), glowMat);
      seam.position.set(E.x, 4.6 + i * 5.2 + 0.85, E.z);
      seam.rotation.y = i * 0.14;
      this.group.add(seam);
    }
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(12 + i * 3.2, 0.16, 6, 64), glowMat);
      ring.position.set(E.x, 22 + i * 11, E.z);
      ring.rotation.x = Math.PI / 2;
      this.group.add(ring);
      this.rings.push(ring);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), emissive(0xd8ecff, 8));
    beacon.position.set(E.x, 88, E.z);
    this.group.add(beacon);
    const top = new THREE.PointLight(0xa8d8ff, 90, 240, 2);
    top.position.set(E.x, 88, E.z);
    this.group.add(top);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.6, 130, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    shaft.position.set(E.x, 152, E.z);
    this.group.add(shaft);

    // 内部の間
    const roomW = 20, roomD = 20, roomH = 9;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f2136, roughness: 0.7, metalness: 0.7, side: THREE.DoubleSide });
    const cf = new THREE.Mesh(new THREE.BoxGeometry(roomW, 0.4, roomD), wallMat);
    cf.position.set(E.x, 0.2, E.z);
    this.group.add(cf);
    this.collision.addPlatform(E.x - roomW / 2, E.x + roomW / 2, E.z - roomD / 2, E.z + roomD / 2, 0.4);
    const walls: [number, number, number, number, number, number][] = [
      [roomW, roomH, 0.6, E.x, roomH / 2, E.z - roomD / 2],
      [0.6, roomH, roomD, E.x - roomW / 2, roomH / 2, E.z],
      [0.6, roomH, roomD, E.x + roomW / 2, roomH / 2, E.z],
      [6, roomH, 0.6, E.x - 7, roomH / 2, E.z + roomD / 2],
      [6, roomH, 0.6, E.x + 7, roomH / 2, E.z + roomD / 2],
    ];
    for (const [w, h, d, x, y, z] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      this.group.add(m);
      this.collision.addBlocker(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, roomH);
    }
    const cc = new THREE.Mesh(new THREE.BoxGeometry(roomW, 0.5, roomD), wallMat);
    cc.position.set(E.x, roomH, E.z);
    this.group.add(cc);

    const wake = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.75),
      new THREE.MeshBasicMaterial({
        map: makeTextTexture('WAKE_UP', { width: 2048, height: 512, font: '700 300px ui-monospace, "SF Mono", Consolas, monospace', color: '#eaf6ff', glow: 60 }),
        transparent: true, color: 0xcfe8ff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
    wake.position.set(E.x, 4.8, E.z - roomD / 2 + 0.36);
    this.group.add(wake);
    this.chamberLight = new THREE.PointLight(0x9fd0ff, 24, 36, 2);
    this.chamberLight.position.set(E.x, 5.5, E.z - 4);
    this.group.add(this.chamberLight);
    this.chamberCenter.set(E.x, 2.4, E.z - 4);

    // 内部通路 (南から、土台の外まで伸びる)
    for (let i = 0; i < 12; i++) {
      const z = E.z + roomD / 2 + 1.6 + i * 2.2;
      for (const sx of [-4.2, 4.2]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 0.6), wallMat);
        w.position.set(E.x + sx, 3.5, z);
        this.group.add(w);
      }
      this.collision.addBlocker(E.x - 7.2, E.x - 1.2, z - 0.3, z + 0.3, 0, 7);
      this.collision.addBlocker(E.x + 1.2, E.x + 7.2, z - 0.3, z + 0.3, 0, 7);
      const f = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 2.4), wallMat);
      f.position.set(E.x, 0.2, z);
      this.group.add(f);
      this.collision.addPlatform(E.x - 3, E.x + 3, z - 1.2, z + 1.2, 0.4);
      const l = new THREE.PointLight(0x7fc0ff, 7, 18, 2);
      l.position.set(E.x, 4, z);
      this.group.add(l);
    }
    // 通路の屋根
    const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 28), wallMat);
    roof.position.set(E.x, 7, E.z + roomD / 2 + 14);
    this.group.add(roof);

    this.interactables.push({
      id: 'wake_text', point: new THREE.Vector3(E.x, 4.4, E.z - roomD / 2 + 1.6), radius: 12,
      label: '刻まれた文字を読む', maxAngle: Math.PI,
      onUse: () => {
        this.revealed = true;
        this.onText?.('世界の底に、命令がひとつだけ残されている。', 8000);
        this.onSecret?.();
        this.audio.wakeChord();
      },
    });
  }

  /* ---------------- 浮遊破片 / 文字 / 目印 ---------------- */
  private buildDebris() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1e3a58, roughness: 0.75, metalness: 0.7, emissive: 0x0d2f55, emissiveIntensity: 0.9 });
    const count = 480;
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
    const rng = new RNG(20241);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = rng.range(16, 180);
      const x = Math.cos(ang) * rad;
      const z = 60 - Math.sin(ang) * rad * 1.3;
      const y = rng.range(0.5, 55);
      const s = rng.range(0.05, 0.7);
      const e = new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * rng.range(0.4, 1), s * rng.range(0.6, 1.4)));
      this.debris.setMatrixAt(i, m4);
      this.debrisData.push({ base: new THREE.Vector3(x, y, z), rot: e, amp: rng.range(0.1, 0.9), phase: rng.range(0, 6.28) });
    }
    this.debris.instanceMatrix.needsUpdate = true;
    this.group.add(this.debris);
  }

  private buildGlyphRain() {
    const count = 600;
    const mat = new THREE.MeshBasicMaterial({
      map: this.glyphAtlas, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, color: 0xa8d4ff, fog: false,
    });
    this.glyphField = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.5), mat, count);
    const rng = new RNG(31337);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const x = rng.range(-110, 110);
      const z = rng.range(-130, 140);
      const y = rng.range(2, 48);
      m4.makeTranslation(x, y, z);
      this.glyphField.setMatrixAt(i, m4);
      this.glyphData.push({ base: new THREE.Vector3(x, y, z), speed: rng.range(0.4, 2.0), phase: rng.range(0, 6.28), scale: rng.range(0.6, 2.2) });
    }
    this.glyphField.instanceMatrix.needsUpdate = true;
    this.group.add(this.glyphField);
  }

  private buildPathMarkers() {
    const A = WORLD.arrival;
    const B = WORLD.architecture;
    const chevronMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const z = A.z - 16 - t * (A.z - B.z - 26);
      const x = Math.sin(t * 5.5) * 3.0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.8), chevronMat);
      m.position.set(x, 1.1 + Math.sin(t * 5) * 0.3, z);
      m.rotation.y = Math.PI;
      this.group.add(m);
      this.chunks.push({ mesh: m, base: m.position.clone(), amp: 0.18, speed: 0.7, phase: i * 0.6, rot: new THREE.Vector3() });
    }
  }

  private buildConsoleHints() {
    const hintMat = new THREE.MeshBasicMaterial({
      map: makeTextTexture('INPUT: [C]', { width: 768, height: 192, font: '600 88px ui-monospace, monospace', color: '#a8d6ff', glow: 24 }),
      transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    for (const p of [new THREE.Vector3(-14, 2.2, 12), new THREE.Vector3(16, 3.2, -14), new THREE.Vector3(0, 2.6, 58)]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), hintMat);
      m.position.copy(p);
      m.rotation.y = 0.4;
      this.group.add(m);
      this.uiPanels.push(m);
    }
  }

  private bsodify(root: THREE.Object3D, amount = 0.6) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const newMats = mats.map((base) => {
        const mat = (base as THREE.MeshStandardMaterial).clone();
        if (mat.color) mat.color.lerp(new THREE.Color(0x3f6ea8), amount * 0.8);
        mat.roughness = Math.min(1, (mat.roughness ?? 0.6) * 0.9 + 0.2);
        mat.metalness = Math.min(1, (mat.metalness ?? 0.1) + 0.3);
        mat.emissive = new THREE.Color(0x123a63);
        mat.emissiveIntensity = 0.55;
        mat.emissiveMap = mat.map ?? null;
        patchGlitch(mat, 0.5);
        return mat;
      });
      m.material = Array.isArray(m.material) ? newMats : newMats[0];
    });
  }

  /* ================= 更新 ================= */
  update(dt: number, t: number, camera: THREE.Camera) {
    glitchUniforms.uPlayer.value.copy(camera.position);
    for (const c of this.chunks) {
      c.mesh.position.y = c.base.y + Math.sin(t * c.speed + c.phase) * c.amp;
      if (c.rot.lengthSq() > 0) {
        c.mesh.rotation.x += c.rot.x * dt;
        c.mesh.rotation.y += c.rot.y * dt;
        c.mesh.rotation.z += c.rot.z * dt;
      }
    }
    if (this.debris) {
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const pos = new THREE.Vector3();
      for (let i = 0; i < this.debrisData.length; i++) {
        const d = this.debrisData[i];
        this.debris.getMatrixAt(i, m4);
        m4.decompose(pos, q, scale);
        q.setFromEuler(new THREE.Euler(d.rot.x + t * 0.02, d.rot.y + t * 0.03, d.rot.z));
        m4.compose(
          new THREE.Vector3(d.base.x + Math.cos(t * 0.17 + d.phase) * d.amp * 0.6, d.base.y + Math.sin(t * 0.25 + d.phase) * d.amp, d.base.z),
          q, scale,
        );
        this.debris.setMatrixAt(i, m4);
      }
      this.debris.instanceMatrix.needsUpdate = true;
    }
    if (this.glyphField) {
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < this.glyphData.length; i++) {
        const g = this.glyphData[i];
        let y = g.base.y - ((t * g.speed + g.phase * 10) % 60);
        if (y < 0.5) y += 59;
        q.setFromEuler(new THREE.Euler(0, Math.sin(t * 0.2 + g.phase) * 0.4, 0));
        m4.compose(new THREE.Vector3(g.base.x + Math.sin(t * 0.3 + g.phase) * 0.5, y, g.base.z), q, new THREE.Vector3(g.scale, g.scale, 1));
        this.glyphField.setMatrixAt(i, m4);
      }
      this.glyphField.instanceMatrix.needsUpdate = true;
    }
    this.rings.forEach((r, i) => {
      r.rotation.z = t * (0.05 + i * 0.02) * (i % 2 ? -1 : 1);
    });
    if (this.chamberLight) this.chamberLight.intensity = 20 + Math.sin(t * 0.9) * 8;
    glitchUniforms.uPulse.value = 0.5 + Math.sin(t * 0.9) * 0.5;
    this.beams.forEach((b, i) => {
      (b.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 0.5 + i) * 0.02;
    });
    this.uiPanels.forEach((p, i) => {
      const mat = p.material as THREE.MeshBasicMaterial;
      if (mat.userData.base === undefined) mat.userData.base = mat.opacity;
      mat.opacity = (mat.userData.base as number) * (0.85 + Math.sin(t * 0.7 + i * 1.7) * 0.15);
    });
    if (this.skyMat) this.skyMat.uniforms.uTime.value = t;
  }

  setGlitch(v: number) { glitchUniforms.uCorrupt.value = v * 0.5; }
  setSecretRevealed() { this.revealed = true; }
  get secretRevealed() { return this.revealed; }

  reset() {
    this.revealed = false;
    glitchUniforms.uCorrupt.value = 0;
    glitchUniforms.uGlitch.value = 0;
  }
}
