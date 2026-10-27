/**
 * 教室（classroom.glb）と、コードで組んだ小道具たち。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { asset } from './assets.js';
import {
  chalkTexture,
  holoTexture,
  vendingTexture,
  outdoorTexture,
  notebookTexture,
  a4Texture,
  petalTexture,
  signTexture,
  signTexture2,
} from './textures.js';

const MODEL_URL = asset('models/classroom.glb');

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.props = {};
    this.targets = {};
    this.time = 0;

    this.scene.fog = new THREE.FogExp2(0x0b0d10, 0.05);

    this.root = new THREE.Group();
    scene.add(this.root);

    this.buildLights();
    this.buildBoard();
    this.buildOutside();
    this.buildVending();
    this.buildBooth();
    this.buildHolo();
    this.buildNotebook();
    this.buildSigns();
    this.buildLeak();
    this.buildPetals();
  }

  /* ---------------------------------------------------------------- */
  /* 光                                                               */
  /* ---------------------------------------------------------------- */
  buildLights() {
    if (this.renderer) {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environment = this.envMap;
        this.scene.environmentIntensity = 0.35;
      } catch (err) {
        console.warn('environment map unavailable', err);
      }
    }

    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2b2318, 0.55);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe4c4, 2.0);
    this.sun.position.set(11, 7.5, -3.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 34;
    this.sun.shadow.camera.left = -9;
    this.sun.shadow.camera.right = 9;
    this.sun.shadow.camera.top = 8;
    this.sun.shadow.camera.bottom = -6;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sun.target.position.set(0, 0.8, 0);

    // 窓からの照り返し
    this.windowLight = new THREE.PointLight(0xfff0d8, 14, 16, 2);
    this.windowLight.position.set(3.4, 1.9, -2.4);
    this.scene.add(this.windowLight);

    this.windowLight2 = new THREE.PointLight(0xffe6c0, 10, 14, 2);
    this.windowLight2.position.set(3.4, 1.8, 2.2);
    this.scene.add(this.windowLight2);

    // 廊下からの冷たい光
    this.corridor = new THREE.PointLight(0xbcd4ff, 5, 12, 2);
    this.corridor.position.set(-3.6, 2.5, 2.2);
    this.scene.add(this.corridor);

    // 教室の拡散光
    this.roomFill = new THREE.PointLight(0xfff2e0, 8, 18, 2);
    this.roomFill.position.set(0, 3.0, 0.8);
    this.scene.add(this.roomFill);

    // 本質の発光
    this.essenceLight = new THREE.PointLight(0xffb35c, 6, 10, 2);
    this.essenceLight.position.set(0.5, 1.9, 3.6);
    this.scene.add(this.essenceLight);
  }

  /* ---------------------------------------------------------------- */
  /* GLB                                                              */
  /* ---------------------------------------------------------------- */
  async load(onProgress) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL, (ev) => {
      if (onProgress && ev.total) onProgress(ev.loaded / ev.total);
    });
    return this.applyGltf(gltf);
  }

  applyGltf(gltf) {
    const root = gltf.scene;
    root.scale.setScalar(0.01); // cm → m
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = false;
      o.frustumCulled = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        // 透過ガラスは重いので、単純な透明に置き換える
        if (m.transmission !== undefined && m.transmission > 0.001) {
          m.transmission = 0;
          m.transparent = true;
          m.opacity = 0.14;
          m.roughness = 0.06;
          m.metalness = 0.2;
          m.depthWrite = false;
          m.side = THREE.DoubleSide;
        }
        const n = (m.name || '').toLowerCase();
        if (n.includes('godray')) {
          m.transparent = true;
          m.opacity = 0.18;
          m.blending = THREE.AdditiveBlending;
          m.depthWrite = false;
          m.color = new THREE.Color('#ffe7c4');
          m.emissive = new THREE.Color('#ffd9a8');
          m.emissiveIntensity = 0.5;
        }
        if (n.includes('neon')) {
          m.emissive = new THREE.Color('#e9f7ff');
          m.emissiveIntensity = 2.4;
          m.toneMapped = false;
        }
        if (n.includes('glass')) {
          m.transparent = true;
          m.opacity = 0.1;
          m.depthWrite = false;
        }
        m.needsUpdate = true;
      });
    });
    this.room = root;
    this.root.add(root);
    // 明滅させるネオンだけ拾っておく
    this.neonMats = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.name && m.name.toLowerCase().includes('neon')) this.neonMats.push(m);
    });
    return root;
  }

  /* ---------------------------------------------------------------- */
  /* 黒板                                                             */
  /* ---------------------------------------------------------------- */
  buildBoard() {
    const geo = new THREE.PlaneGeometry(6.0, 1.69);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0.52, 1.625, 4.787);
    mesh.rotation.y = Math.PI;
    this.root.add(mesh);
    this.props.board = mesh;
    this.chalkCache = new Map();
    this.boardTarget = 0;
  }

  setChalk(kind) {
    if (!kind || kind === 'none') {
      this.boardTarget = 0;
      return;
    }
    this.boardTarget = 0.96;
    if (!this.chalkCache.has(kind)) this.chalkCache.set(kind, chalkTexture(kind));
    const tex = this.chalkCache.get(kind);
    if (this.props.board.material.map !== tex) {
      this.props.board.material.map = tex;
      this.props.board.material.needsUpdate = true;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 窓の外                                                           */
  /* ---------------------------------------------------------------- */
  buildOutside() {
    this.outsideCache = new Map();
    const geo = new THREE.PlaneGeometry(46, 23);
    const mat = new THREE.MeshBasicMaterial({ transparent: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    // 描いた地平線（テクスチャの 45.9% 地点）がちょうど目の高さ 1.6m に来るように置く
    mesh.position.set(17.5, 0.66, -1.5);
    mesh.rotation.y = -Math.PI / 2;
    this.root.add(mesh);
    this.props.outside = mesh;
  }

  setOutside(kind) {
    if (!this.outsideCache.has(kind)) this.outsideCache.set(kind, outdoorTexture(kind));
    this.props.outside.material.map = this.outsideCache.get(kind);
    this.props.outside.material.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- */
  /* 自販機                                                           */
  /* ---------------------------------------------------------------- */
  buildVending() {
    const g = new THREE.Group();
    g.position.set(-3.58, 0, 1.55);
    g.rotation.y = Math.PI / 2;

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.55, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.86, 0.6), bodyMat);
    body.position.y = 0.93;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    this.vendingCache = new Map();
    const faceTex = vendingTexture('normal');
    this.vendingCache.set('normal', faceTex);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      emissiveMap: faceTex,
      emissive: 0xffffff,
      emissiveIntensity: 0.5,
      roughness: 0.35,
      metalness: 0.1,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 1.72), faceMat);
    face.position.set(0, 0.99, 0.301);
    g.add(face);

    // 側面の発光
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.5 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.05), glowMat);
    glow.position.set(0, 1.83, 0.302);
    g.add(glow);

    // 取り出し口のフタ
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.16, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x0a0e11, roughness: 0.9 })
    );
    slot.position.set(0, 0.36, 0.3);
    g.add(slot);

    // コーンスープの缶
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0xffc247, emissive: 0xff9b2a, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.5 })
    );
    can.position.set(0, 0.36, 0.335);
    can.visible = false;
    can.castShadow = true;
    g.add(can);

    this.props.vending = { group: g, face, can, state: 'normal', faceTex };
    this.root.add(g);

    // 上に「北棟 1F」の小さな看板
    const signMat = new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, toneMapped: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), signMat);
    sign.position.set(-3.9, 2.35, 1.55);
    sign.rotation.y = Math.PI / 2;
    this.root.add(sign);
  }

  setVending(state = 'normal') {
    const v = this.props.vending;
    if (v.state === state) return;
    v.state = state;
    if (!this.vendingCache.has(state)) this.vendingCache.set(state, vendingTexture(state));
    const tex = this.vendingCache.get(state);
    v.face.material.map = tex;
    v.face.material.emissiveMap = tex;
    v.face.material.emissiveIntensity = state === 'returned' ? 0.85 : state === 'absent' ? 0.25 : 0.5;
    v.face.material.needsUpdate = true;
    if (state === 'returned') {
      v.can.visible = true;
      v.can.position.y = 1.2;
      v.dropT = 0;
    } else {
      v.can.visible = false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 配信ブース                                                       */
  /* ---------------------------------------------------------------- */
  buildBooth() {
    const g = new THREE.Group();
    g.position.set(0.55, 0.79, 3.42); // 教卓の天板の上
    g.rotation.y = Math.PI;           // 教室側（寺地のいる側）へ向ける

    // リングライト
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.018, 12, 40),
      new THREE.MeshStandardMaterial({ color: 0xfff6e2, emissive: 0xfff0d0, emissiveIntensity: 3.2, toneMapped: false })
    );
    ring.position.set(0, 0.52, -0.05);
    ring.rotation.x = 0.06;
    g.add(ring);
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.7 })
    );
    stand.position.set(0, 0.25, -0.05);
    g.add(stand);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.15, 0.03, 20),
      new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.8 })
    );
    base.position.set(0, 0.015, -0.05);
    g.add(base);

    // スマホ（三脚）
    const phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.15, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.35, metalness: 0.4 })
    );
    phone.position.set(0, 0.2, 0.16);
    phone.rotation.x = -0.18;
    g.add(phone);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.066, 0.135),
      new THREE.MeshBasicMaterial({ color: 0xa9e8ff, transparent: true, opacity: 0.85 })
    );
    screen.position.set(0, 0.2, 0.167);
    screen.rotation.x = -0.18;
    g.add(screen);
    const tripod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2d32 })
    );
    tripod.position.set(0, 0.08, 0.16);
    g.add(tripod);

    // A4用紙
    const a4Mat = new THREE.MeshStandardMaterial({
      map: a4Texture(),
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveMap: a4Texture(),
      emissiveIntensity: 0.12,
      side: THREE.DoubleSide,
    });
    const a4 = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), a4Mat);
    a4.position.set(-0.28, 0.005, 0.06);
    a4.rotation.x = -Math.PI / 2;
    a4.rotation.z = 0.2;
    g.add(a4);
    const a4b = a4.clone();
    a4b.position.set(0.26, 0.004, 0.12);
    a4b.rotation.z = -0.35;
    g.add(a4b);

    // 太いマジック
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.17, 10),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5 })
    );
    pen.position.set(-0.19, 0.02, 0.14);
    pen.rotation.z = Math.PI / 2;
    pen.rotation.y = 0.4;
    g.add(pen);

    // リングライトの実光
    const light = new THREE.PointLight(0xfff0d6, 3.2, 4.5, 2);
    light.position.set(0, 0.55, 0.02);
    g.add(light);

    g.visible = false;
    this.props.booth = g;
    this.root.add(g);
  }

  /* ---------------------------------------------------------------- */
  /* 掲示板ホログラム                                                 */
  /* ---------------------------------------------------------------- */
  buildHolo() {
    const group = new THREE.Group();
    group.position.set(-0.15, 1.86, 1.25);
    group.rotation.y = Math.PI + 0.06; // 教室の後ろ向き（生徒側から読める）

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: holoTexture([]) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float wob = sin(uv.y * 90.0 + uTime * 3.0) * 0.0018;
          vec4 c = texture2D(uMap, uv + vec2(wob, 0.0));
          float scan = 0.86 + 0.14 * sin(uv.y * 620.0 - uTime * 6.0);
          float flicker = 0.92 + 0.08 * sin(uTime * 21.0);
          float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x)
                     * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
          gl_FragColor = vec4(c.rgb * scan * flicker, c.a * uOpacity * (0.55 + 0.45 * edge));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 1.03), mat);
    group.add(panel);

    // 枠の発光ライン
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(1.78, 1.09),
      new THREE.MeshBasicMaterial({ color: 0x7cf6d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    frame.position.z = -0.002;
    group.add(frame);

    const light = new THREE.PointLight(0x7cf6d8, 0, 3.4, 2);
    light.position.set(0, 0, 0.2);
    group.add(light);

    group.visible = false;
    this.props.holo = { group, panel, frame, light, mat, target: 0 };
    this.root.add(group);
  }

  setHolo(posts) {
    const h = this.props.holo;
    if (!posts) {
      h.target = 0;
      return;
    }
    h.mat.uniforms.uMap.value = holoTexture(posts);
    h.mat.uniforms.uMap.value.needsUpdate = true;
    h.target = 1;
    h.group.visible = true;
  }

  /* ---------------------------------------------------------------- */
  /* 研究ノート                                                       */
  /* ---------------------------------------------------------------- */
  buildNotebook() {
    const g = new THREE.Group();
    g.position.set(1.94, 1.02, 0.62);
    g.rotation.y = 0.18;

    const mat = new THREE.MeshStandardMaterial({
      map: notebookTexture(),
      emissiveMap: notebookTexture(),
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const book = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.44), mat);
    book.rotation.x = -0.55;
    g.add(book);

    // 波紋（観測＝崩壊）
    const rings = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.163, 64),
        new THREE.MeshBasicMaterial({ color: 0xff8fb1, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      r.userData.phase = i / 3;
      rings.add(r);
    }
    rings.rotation.x = -0.55;
    rings.position.z = 0.01;
    g.add(rings);

    const light = new THREE.PointLight(0xff9ec0, 0, 2.4, 2);
    g.add(light);

    g.visible = false;
    this.props.notebook = { group: g, book, rings, light, target: 0, phase: 0 };
    this.root.add(g);
  }

  setNotebook(on) {
    const n = this.props.notebook;
    n.target = on ? 1 : 0;
    if (on) n.group.visible = true;
  }

  /* ---------------------------------------------------------------- */
  /* 壁のサイン                                                       */
  /* ---------------------------------------------------------------- */
  buildSigns() {
    const doorSign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.5),
      new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, toneMapped: false })
    );
    doorSign.position.set(-3.94, 2.55, 3.35);
    doorSign.rotation.y = Math.PI / 2;
    this.root.add(doorSign);

    const frontSign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.42),
      new THREE.MeshBasicMaterial({ map: signTexture2(), transparent: true, toneMapped: false, opacity: 0.9 })
    );
    frontSign.position.set(2.5, 2.78, 4.72);
    frontSign.rotation.y = Math.PI;
    this.root.add(frontSign);
  }

  /* ---------------------------------------------------------------- */
  /* 本質の漏出                                                       */
  /* ---------------------------------------------------------------- */
  buildLeak() {
    const group = new THREE.Group();
    group.position.set(0.3, 0, 3.9);

    const geo = new THREE.CylinderGeometry(0.45, 2.1, 3.3, 32, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0.3 },
        uColor: { value: new THREE.Color('#ffcf8a') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float v = vUv.y;
          float n = sin(v * 26.0 + uTime * 1.1) * 0.5 + 0.5;
          float n2 = sin(vUv.x * 40.0 - uTime * 2.2) * 0.5 + 0.5;
          float a = smoothstep(0.0, 0.55, v) * (1.0 - v * 0.55) * (0.28 + 0.34 * n * n2) * uStrength;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.y = 1.68;
    group.add(beam);
    this.root.add(group);
    this.props.leak = { group, mat, beam };

    // ✝ の粒
    const glyph = makeGlyphTexture();
    const count = 46;
    const inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.11, 0.11),
      new THREE.MeshBasicMaterial({ map: glyph, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      count
    );
    const seeds = [];
    for (let i = 0; i < count; i++) {
      seeds.push({
        x: (Math.random() - 0.5) * 2.4,
        z: (Math.random() - 0.5) * 2.0,
        y: Math.random() * 3.2,
        speed: 0.1 + Math.random() * 0.24,
        spin: (Math.random() - 0.5) * 2,
        size: 0.5 + Math.random() * 1.1,
        phase: Math.random() * 6.28,
      });
    }
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.props.glyphs = { inst, seeds, dummy: new THREE.Object3D() };
    this.root.add(inst);
  }

  /* ---------------------------------------------------------------- */
  /* 桜                                                               */
  /* ---------------------------------------------------------------- */
  buildPetals() {
    const tex = petalTexture();
    const count = 90;
    const inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.055, 0.055),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      count
    );
    const seeds = [];
    for (let i = 0; i < count; i++) {
      seeds.push({
        x: (Math.random() - 0.5) * 8,
        y: Math.random() * 4,
        z: (Math.random() - 0.5) * 9.5,
        speed: 0.18 + Math.random() * 0.35,
        sway: 0.3 + Math.random() * 0.9,
        phase: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 2.4,
      });
    }
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.visible = false;
    this.props.petals = { inst, seeds, dummy: new THREE.Object3D(), target: 0 };
    this.root.add(inst);
  }

  /* ---------------------------------------------------------------- */
  /* 場面の適用                                                       */
  /* ---------------------------------------------------------------- */
  applyScene(env) {
    const e = { ...env };

    this.setChalk(e.chalk);
    this.setOutside(e.outside || 'school');
    this.setVending(e.vending || 'normal');
    this.setHolo(e.holo);
    this.setNotebook(!!e.notebook);
    this.props.booth.visible = !!e.booth;

    this.targets.sun = (e.sun ?? 1) * 1.9;
    this.targets.hemi = e.amb ?? 0.55;
    this.targets.fog = e.fog ?? 0.05;
    this.targets.leak = e.leak ?? 0.3;
    this.targets.petals = e.petals ?? 0;
    this.targets.window = e.night ? 2.2 : 13;
    this.targets.fill = e.night ? 3.2 : 8;
    this.targets.env = e.night ? 0.14 : 0.34;

    this.night = !!e.night;
    this.sunColor = new THREE.Color(e.sunColor || (this.night ? '#8fa6d8' : '#ffe4c4'));
    this.extras = e.extras || null;

    if (e.extras === 'comments') this.spawnComments();
  }

  spawnComments() {
    const glyph = makeGlyphTexture();
    if (!this.props.comments) {
      const count = 18;
      const inst = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.17, 0.17),
        new THREE.MeshBasicMaterial({ map: glyph, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        count
      );
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.visible = false;
      this.root.add(inst);
      this.props.comments = { inst, items: [], dummy: new THREE.Object3D() };
    }
    const c = this.props.comments;
    c.inst.visible = true;
    c.items = [];
    for (let i = 0; i < 18; i++) {
      c.items.push({
        x: 0.55 + (Math.random() - 0.5) * 1.6,
        y: 0.9 + Math.random() * 1.6,
        z: 2.4 + Math.random() * 0.6,
        speed: 0.16 + Math.random() * 0.3,
        phase: Math.random() * 6.28,
        scale: 0.5 + Math.random(),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* 毎フレーム                                                       */
  /* ---------------------------------------------------------------- */
  update(dt, t, camera) {
    this.time = t;
    const k = 1 - Math.exp(-dt * 2.2);

    // 光の補間
    if (this.targets.sun !== undefined) this.sun.intensity += (this.targets.sun - this.sun.intensity) * k;
    if (this.sunColor) this.sun.color.lerp(this.sunColor, k);
    if (this.targets.hemi !== undefined) {
      this.hemi.intensity += (this.targets.hemi - this.hemi.intensity) * k;
      this.hemi.color.lerp(this.night ? new THREE.Color(0x9fb4e0) : new THREE.Color(0xdfe9ff), k);
    }
    if (this.targets.window !== undefined) {
      this.windowLight.intensity += (this.targets.window - this.windowLight.intensity) * k;
      this.windowLight2.intensity += (this.targets.window * 0.75 - this.windowLight2.intensity) * k;
    }
    if (this.targets.fill !== undefined) this.roomFill.intensity += (this.targets.fill - this.roomFill.intensity) * k;
    if (this.targets.env !== undefined) this.scene.environmentIntensity += (this.targets.env - this.scene.environmentIntensity) * k;

    // フォグ
    if (this.targets.fog !== undefined) {
      this.scene.fog.density += (this.targets.fog - this.scene.fog.density) * k;
    }
    this.scene.fog.color.lerp(this.night ? new THREE.Color(0x0a0c12) : new THREE.Color(0x121319), k);

    // 黒板
    const bm = this.props.board.material;
    bm.opacity += (this.boardTarget - bm.opacity) * (1 - Math.exp(-dt * 3));

    // ホログラム
    const h = this.props.holo;
    h.mat.uniforms.uTime.value = t;
    const ho = THREE.MathUtils.lerp(h.mat.uniforms.uOpacity.value, h.target, k);
    h.mat.uniforms.uOpacity.value = ho;
    h.frame.material.opacity = ho * 0.18;
    h.light.intensity = ho * 2.2;
    h.group.visible = ho > 0.01 || h.target > 0;
    h.group.position.y = 1.86 + Math.sin(t * 0.9) * 0.012;

    // ノート
    const n = this.props.notebook;
    n.phase += dt;
    n.vis = THREE.MathUtils.lerp(n.vis ?? 0, n.target, k);
    n.group.visible = n.vis > 0.02;
    const no = THREE.MathUtils.lerp(n.book.material.emissiveIntensity, n.target ? 0.5 : 0.0, k);
    n.book.material.emissiveIntensity = no;
    n.light.intensity = no * 3.4;
    n.group.position.y = 1.02 + Math.sin(t * 1.1) * 0.02;
    n.group.rotation.y = 0.18 + Math.sin(t * 0.4) * 0.05;
    for (const r of n.rings.children) {
      const p = (t * 0.4 + r.userData.phase) % 1;
      r.scale.setScalar(0.4 + p * 2.6);
      r.material.opacity = n.target ? (1 - p) * 0.4 : 0;
    }

    // 本質の漏出
    const leak = this.props.leak;
    leak.mat.uniforms.uTime.value = t;
    const strength = THREE.MathUtils.lerp(leak.mat.uniforms.uStrength.value, this.targets.leak ?? 0.3, k);
    leak.mat.uniforms.uStrength.value = strength;
    this.essenceLight.intensity = 2 + strength * 14 + Math.sin(t * 2.4) * 0.6;
    leak.group.rotation.y = Math.sin(t * 0.25) * 0.05;

    // ✝ の粒
    const gl = this.props.glyphs;
    gl.inst.visible = strength > 0.02;
    if (gl.inst.visible) {
      gl.seeds.forEach((s, i) => {
        const y = (s.y + t * s.speed) % 3.4;
        const d = gl.dummy;
        d.position.set(0.3 + s.x + Math.sin(t * 0.7 + s.phase) * 0.2, y, 3.9 + s.z * 0.7);
        d.rotation.set(0, 0, Math.sin(t * 0.9 + s.phase) * 0.6);
        d.scale.setScalar(s.size * (0.5 + strength));
        if (camera) d.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(t + s.phase) * 0.3));
        d.updateMatrix();
        gl.inst.setMatrixAt(i, d.matrix);
      });
      gl.inst.instanceMatrix.needsUpdate = true;
    }

    // コメント（草）
    if (this.props.comments) {
      const c = this.props.comments;
      c.items.forEach((it, i) => {
        const y = it.y + ((t * it.speed) % 1.8);
        const d = c.dummy;
        d.position.set(it.x + Math.sin(t * 0.8 + it.phase) * 0.1, y, it.z);
        d.scale.setScalar(it.scale * 0.8);
        if (camera) d.quaternion.copy(camera.quaternion);
        d.updateMatrix();
        c.inst.setMatrixAt(i, d.matrix);
      });
      c.inst.instanceMatrix.needsUpdate = true;
    }

    // 桜
    const p = this.props.petals;
    const pt = THREE.MathUtils.lerp(p.inst.visible ? 1 : 0, this.targets.petals ?? 0, k);
    p.inst.visible = pt > 0.02;
    p.inst.material.opacity = 0.95 * pt;
    if (p.inst.visible) {
      p.seeds.forEach((s, i) => {
        const y = ((s.y - t * s.speed) % 4 + 4) % 4;
        const d = p.dummy;
        d.position.set(s.x + Math.sin(t * s.sway + s.phase) * 0.5, y, s.z + Math.cos(t * s.sway * 0.7 + s.phase) * 0.3);
        d.rotation.set(t * s.spin, t * s.spin * 0.7, Math.sin(t + s.phase) * 1.2);
        d.scale.setScalar(0.7 + Math.sin(s.phase) * 0.3);
        d.updateMatrix();
        p.inst.setMatrixAt(i, d.matrix);
      });
      p.inst.instanceMatrix.needsUpdate = true;
    }

    // 自販機の缶
    const v = this.props.vending;
    if (v.can.visible && v.dropT !== undefined && v.dropT < 1) {
      v.dropT = Math.min(1, v.dropT + dt * 1.6);
      const e = 1 - Math.pow(1 - v.dropT, 3);
      v.can.position.y = 1.2 - e * 0.82;
      v.can.rotation.z = Math.sin(v.dropT * 12) * 0.2 * (1 - v.dropT);
    }

    // リングライトの明滅
    if (this.props.booth.visible) {
      this.props.booth.children[0].material.emissiveIntensity = 3.0 + Math.sin(t * 5.2) * 0.15;
    }

    // ネオンの明滅（夜）
    if (this.neonMats) {
      const flick = this.night ? 0.86 + Math.sin(t * 13) * 0.06 + Math.sin(t * 3.1) * 0.04 : 1;
      for (const m of this.neonMats) m.emissiveIntensity = 2.4 * flick;
    }
  }
}

/* ------------------------------------------------------------------ */
function makeGlyphTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  ctx.font = '600 96px "Hiragino Sans","Yu Gothic",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✝', S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
