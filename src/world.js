import * as THREE from 'three';

/**
 * 3D の世界そのもの。
 *  - 島（岩・装飾・リング・ビーコン）をモデル数だけ生成
 *  - 空・海・星はシェーダ/ポイントで軽量に
 *  - サムネイルは HTML 側で重ねるので、ここではテクスチャを一切読み込まない
 */

export const SEA_LEVEL = 0;

export const PALETTES = {
  all: {
    skyTop: '#05080f',
    skyBottom: '#193a52',
    seaDeep: '#03070f',
    seaHorizon: '#0d2433',
    rock: '#26384d',
    fog: '#071019',
    accent: '#6ef0d0',
  },
  nature: {
    skyTop: '#04100e',
    skyBottom: '#1d4a3c',
    seaDeep: '#03130f',
    seaHorizon: '#0d3327',
    rock: '#264226',
    fog: '#06150f',
    accent: '#7df7b8',
  },
  architecture: {
    skyTop: '#100c09',
    skyBottom: '#4a3623',
    seaDeep: '#0d0805',
    seaHorizon: '#2a1c0f',
    rock: '#443529',
    fog: '#130d08',
    accent: '#ffc06b',
  },
  vehicle: {
    skyTop: '#050a18',
    skyBottom: '#1c3760',
    seaDeep: '#040918',
    seaHorizon: '#0f223f',
    rock: '#27354f',
    fog: '#060c1a',
    accent: '#7db8ff',
  },
  art: {
    skyTop: '#100a19',
    skyBottom: '#3a2350',
    seaDeep: '#090612',
    seaHorizon: '#22102f',
    rock: '#33243f',
    fog: '#0f0817',
    accent: '#d79dff',
  },
  science: {
    skyTop: '#03101a',
    skyBottom: '#134050',
    seaDeep: '#02101a',
    seaHorizon: '#0a2a38',
    rock: '#1e3c4a',
    fog: '#04121a',
    accent: '#6ee7ff',
  },
};

const LAYOUT = [
  [18, 0, 8],
  [-22, 0, 24],
  [34, 0, 34],
  [-6, 0, 42],
  [46, 0, -6],
  [10, 0, -28],
  [-34, 0, -18],
  [-48, 0, 12],
  [24, 0, 66],
  [-40, 0, 62],
  [64, 0, 46],
  [-2, 0, 88],
];

const G = {
  rock: new THREE.ConeGeometry(3.5, 4.2, 7, 2),
  rockSmall: new THREE.ConeGeometry(1.1, 2.6, 5, 1),
  top: new THREE.CylinderGeometry(3.7, 3.35, 0.55, 9, 1),
  topLip: new THREE.TorusGeometry(3.55, 0.1, 4, 22),
  ring: new THREE.TorusGeometry(4.6, 0.035, 4, 48),
  ringInner: new THREE.TorusGeometry(3.15, 0.02, 3, 40),
  focusRing: new THREE.RingGeometry(4.5, 4.66, 64),
  beam: new THREE.CylinderGeometry(0.045, 0.16, 16, 6, 1, true),
  shard: new THREE.OctahedronGeometry(0.3, 0),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  ico: new THREE.IcosahedronGeometry(1.15, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 9),
  cone: new THREE.ConeGeometry(1, 1, 8),
  torusKnot: new THREE.TorusKnotGeometry(0.9, 0.28, 64, 8),
  plane: new THREE.PlaneGeometry(1, 1),
};

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

function jitter(geometry, amount, seed) {
  const position = geometry.attributes.position;
  let s = seed || 1;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const k = 1 + (rand() - 0.5) * amount;
    position.setXYZ(i, x * k, y + (rand() - 0.5) * amount * 0.9, z * k);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function glowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uGlow;
  uniform vec3 uGlowDir;
  varying vec3 vPos;
  void main() {
    vec3 dir = normalize(vPos);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBottom, uTop, pow(h, 0.85));
    float glow = pow(max(dot(dir, normalize(uGlowDir)), 0.0), 8.0);
    col += uGlow * glow * 0.55;
    float band = smoothstep(0.46, 0.52, h) * (1.0 - smoothstep(0.52, 0.62, h));
    col += uGlow * band * 0.07;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SEA_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SEA_FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uHorizon;
  uniform vec3 uAccent;
  uniform float uTime;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xz;
    float dist = length(p);
    float wave = sin(p.x * 0.18 + uTime * 0.55) * sin(p.y * 0.15 - uTime * 0.42);
    float wave2 = sin((p.x + p.y) * 0.42 - uTime * 0.9);
    float shimmer = smoothstep(0.72, 1.0, wave * 0.6 + wave2 * 0.4);

    vec3 col = mix(uDeep, uHorizon, smoothstep(0.0, 180.0, dist));
    col += uAccent * shimmer * 0.10 * smoothstep(150.0, 0.0, dist);

    float grid = max(
      smoothstep(0.965, 1.0, abs(sin(p.x * 0.25))),
      smoothstep(0.965, 1.0, abs(sin(p.y * 0.25)))
    );
    col += uAccent * grid * 0.035 * (1.0 - smoothstep(0.0, 130.0, dist));

    float alpha = (1.0 - smoothstep(150.0, 300.0, dist)) * 0.92;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.paletteId = 'all';
    this.palette = PALETTES.all;
    this.theme = { from: { ...this.palette }, to: { ...this.palette }, t: 1, current: { ...this.palette } };
    this.quality = 'high';
    this.islands = [];
    this.islandGroups = [];
    this.focusIndex = -1;
    this.visited = new Set();
    this.time = 0;
    this.glowTex = glowTexture();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setClearColor(0x05080f, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x071019, 0.0055);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 1400);
    this.camera.position.set(0, 10, 42);

    this._buildLights();
    this._buildSky();
    this._buildSea();
    this._buildStars();
    this._buildDust();

    this.composer = null;
    this.bloom = null;
    this.postFxRequested = false;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.resize();
  }

  /* ───────────────────── setup ───────────────────── */

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x0a1420, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xbcd8ff, 1.25);
    this.sun.position.set(38, 62, 24);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x6ef0d0, 0.45);
    this.rim.position.set(-40, 10, -30);
    this.scene.add(this.rim);

    this.focusLight = new THREE.PointLight(0x6ef0d0, 0, 26, 2);
    this.scene.add(this.focusLight);
  }

  _buildSky() {
    this.skyUniforms = {
      uTop: { value: new THREE.Color(this.palette.skyTop) },
      uBottom: { value: new THREE.Color(this.palette.skyBottom) },
      uGlow: { value: new THREE.Color(this.palette.accent) },
      uGlowDir: { value: new THREE.Vector3(-0.35, 0.12, -0.9) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), material);
    this.scene.add(this.sky);
  }

  _buildSea() {
    this.seaUniforms = {
      uDeep: { value: new THREE.Color(this.palette.seaDeep) },
      uHorizon: { value: new THREE.Color(this.palette.seaHorizon) },
      uAccent: { value: new THREE.Color(this.palette.accent) },
      uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(720, 720, 1, 1), material);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = SEA_LEVEL;
    this.sea.renderOrder = -1;
    this.scene.add(this.sea);
  }

  _buildStars() {
    const count = 760;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const y = Math.random() * 0.9 + 0.06;
      const r = 430;
      const horizontal = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(theta) * horizontal * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = Math.sin(theta) * horizontal * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xd6ebff,
      size: 2.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.scene.add(this.stars);
  }

  _buildDust() {
    const count = 520;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 190;
      positions[i * 3 + 1] = 1 + Math.random() * 44;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 190;
      speeds[i] = 0.3 + Math.random() * 1.1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustSpeeds = speeds;
    this.dustMaterial = new THREE.PointsMaterial({
      color: 0xbfe6ff,
      size: 0.42,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      map: this.glowTex,
    });
    this.dust = new THREE.Points(geometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  /** 高画質モード用のブルーム。読み込み失敗時は静かに通常描画へ戻す。 */
  async enablePostFx() {
    if (this.postFxRequested) return Boolean(this.composer);
    this.postFxRequested = true;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);

      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const composer = new EffectComposer(this.renderer);
      composer.setPixelRatio(this.renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.72, 0.72);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      this.bloom = bloom;
      this.composer = composer;
      return true;
    } catch (error) {
      this.composer = null;
      return false;
    }
  }

  disablePostFx() {
    if (this.bloom) this.bloom.enabled = false;
  }

  /* ───────────────────── islands ───────────────────── */

  clear() {
    for (const entry of this.islands) {
      this.scene.remove(entry.root);
      entry.root.traverse((obj) => {
        if (obj.isMesh || obj.isPoints) {
          // ジオメトリは共有インスタンスなので破棄しない（マテリアルだけ解放）
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats) {
              mat.dispose?.();
            }
          }
        }
      });
    }
    this.islands = [];
    this.islandGroups = [];
    this.focusIndex = -1;
    this.focusLight.intensity = 0;
  }

  build(models) {
    this.clear();

    models.forEach((model, index) => {
      const [x, , z] = LAYOUT[index % LAYOUT.length];
      const y = 6.5 + Math.sin(index * 1.7) * 2.4 + (index % 3) * 1.2;
      const entry = this._makeIsland(model, index);
      entry.home.set(x, y, z);
      entry.root.position.copy(entry.home);
      entry.phase = (index * 0.77) % (Math.PI * 2);
      entry.distance = Infinity;
      this.scene.add(entry.root);
      this.islands.push(entry);
      this.islandGroups.push(entry.root);
    });

    this.raycaster.far = 140;
    return this.islands;
  }

  _makeIsland(model, index) {
    const seed = (model.seed || 7) + index * 13;
    const accent = new THREE.Color().setHSL((model.hue % 360) / 360, 0.62, 0.62);
    const rockBase = new THREE.Color(this.palette.rock).lerp(accent, 0.18);

    const root = new THREE.Group();
    root.userData.index = index;
    root.userData.island = true;

    const rockGeo = jitter(G.rock.clone(), 0.22, seed + 3);
    const rockMat = new THREE.MeshStandardMaterial({
      color: rockBase,
      roughness: 0.94,
      metalness: 0.06,
      flatShading: true,
    });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.rotation.x = Math.PI;
    rock.position.y = -2.1;
    root.add(rock);

    const topMat = new THREE.MeshStandardMaterial({
      color: rockBase.clone().lerp(new THREE.Color('#000000'), 0.18),
      roughness: 0.82,
      metalness: 0.12,
      flatShading: true,
    });
    const top = new THREE.Mesh(G.top, topMat);
    top.position.y = -0.1;
    root.add(top);

    // 岩から落ちる小石
    const debrisMat = new THREE.MeshStandardMaterial({
      color: rockBase.clone().lerp(accent, 0.3),
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(G.rockSmall, debrisMat);
      const a = (i / 3) * Math.PI * 2 + seed;
      d.position.set(Math.cos(a) * (2.8 + i * 0.4), -4.6 - i * 1.15, Math.sin(a) * (2.8 + i * 0.4));
      d.scale.setScalar(0.55 + i * 0.12);
      root.add(d);
    }

    // 上部の光
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: accent,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(9);
    glow.position.y = 0.7;
    root.add(glow);

    // ビーコン
    const beamMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const beam = new THREE.Mesh(G.beam, beamMat);
    beam.position.y = 8;
    root.add(beam);

    // 装飾
    const decor = new THREE.Group();
    this._buildDecor(decor, model.kind, accent, seed);
    decor.position.y = 0.2;
    root.add(decor);

    // 回転リング
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const ring = new THREE.Mesh(G.ring, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    root.add(ring);

    const ring2 = new THREE.Mesh(G.ringInner, ringMat.clone());
    ring2.material.opacity = 0.22;
    ring2.rotation.x = Math.PI / 2.35;
    ring2.rotation.z = 0.4;
    ring2.position.y = 1.1;
    root.add(ring2);

    // フォーカスリング（普段は透明）
    const focusMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.palette.accent),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    const focusRing = new THREE.Mesh(G.focusRing, focusMat);
    focusRing.rotation.x = -Math.PI / 2;
    focusRing.position.y = -0.35;
    root.add(focusRing);

    // 周回する欠片
    const shardMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.5,
    });
    const shards = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(G.shard, shardMat);
      s.scale.setScalar(0.8 + i * 0.35);
      shards.add(s);
    }
    root.add(shards);

    return {
      index,
      model,
      root,
      decor,
      ring,
      ring2,
      glow,
      beam,
      shards,
      focusRing,
      focusMat,
      rockMat,
      topMat,
      debrisMat,
      accent,
      rockBase,
      home: new THREE.Vector3(),
      phase: 0,
      distance: Infinity,
      visited: false,
      hover: 0,
      appearance: 0,
      scale: 1,
    };
  }

  _buildDecor(group, kind, accent, seed) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x93a6bd, roughness: 0.35, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.7, metalness: 0.35 });
    const emissive = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.35,
      roughness: 0.4,
      metalness: 0.2,
    });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2f7a5a, roughness: 0.85, metalness: 0.05, flatShading: true });

    const rand = (() => {
      let s = (seed % 2147483647) || 12345;
      return () => {
        s = (s * 48271) % 2147483647;
        return s / 2147483647;
      };
    })();

    switch (kind) {
      case 'nature': {
        const trunk = new THREE.Mesh(G.cyl, new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 }));
        trunk.scale.set(0.5, 3.4, 0.5);
        trunk.position.y = 1.7;
        group.add(trunk);
        for (let i = 0; i < 4; i++) {
          const crown = new THREE.Mesh(G.ico, leaf.clone());
          crown.material.color = new THREE.Color().setHSL(0.33 + rand() * 0.09, 0.42, 0.3 + rand() * 0.12);
          const a = rand() * Math.PI * 2;
          const r = 0.5 + rand() * 1.4;
          crown.position.set(Math.cos(a) * r, 3.2 + rand() * 1.5, Math.sin(a) * r);
          crown.scale.setScalar(0.7 + rand() * 0.65);
          group.add(crown);
        }
        const stone = new THREE.Mesh(G.dodeca, dark);
        stone.scale.set(1.1, 2.1, 1.1);
        stone.position.set(-1.7, 1.1, 0.9);
        group.add(stone);
        break;
      }
      case 'architecture': {
        const base = new THREE.Mesh(G.box, dark);
        base.scale.set(4.4, 1.1, 3.6);
        base.position.y = 0.7;
        group.add(base);
        const tower = new THREE.Mesh(G.box, metal);
        tower.scale.set(1.5, 4.6, 1.5);
        tower.position.set(0.9, 3.5, -0.4);
        group.add(tower);
        const block = new THREE.Mesh(G.box, dark);
        block.scale.set(2.1, 2.2, 1.8);
        block.position.set(-1.3, 2.2, 0.6);
        group.add(block);
        const spire = new THREE.Mesh(G.cone, emissive);
        spire.scale.set(0.6, 2.2, 0.6);
        spire.position.set(0.9, 6.9, -0.4);
        group.add(spire);
        for (let i = 0; i < 4; i++) {
          const win = new THREE.Mesh(G.box, emissive);
          win.scale.set(0.95, 0.12, 0.12);
          win.position.set(0.9, 2.4 + i * 1.05, 0.36);
          group.add(win);
        }
        break;
      }
      case 'vehicle': {
        const hull = new THREE.Mesh(G.cyl, metal);
        hull.scale.set(0.6, 3.2, 0.6);
        hull.rotation.z = Math.PI / 2;
        hull.position.y = 2.6;
        hull.rotation.y = 0.25;
        group.add(hull);
        const nose = new THREE.Mesh(G.cone, metal);
        nose.scale.set(0.6, 1.2, 0.6);
        nose.rotation.z = -Math.PI / 2;
        nose.position.set(2.2, 2.6, 0);
        group.add(nose);
        const wingMat = new THREE.MeshStandardMaterial({
          color: 0x2c3e57,
          roughness: 0.5,
          metalness: 0.6,
          side: THREE.DoubleSide,
        });
        const wing = new THREE.Mesh(G.box, wingMat);
        wing.scale.set(1.5, 0.1, 3.4);
        wing.position.set(-0.4, 2.55, 0);
        group.add(wing);
        const canopy = new THREE.Mesh(G.sphere, emissive);
        canopy.scale.set(0.55, 0.45, 0.55);
        canopy.position.set(0.6, 3.1, 0);
        group.add(canopy);
        const thruster = new THREE.Mesh(G.ringInner, emissive);
        thruster.rotation.y = Math.PI / 2;
        thruster.position.set(-1.7, 2.6, 0);
        thruster.scale.setScalar(1.1);
        group.add(thruster);
        break;
      }
      case 'science': {
        const core = new THREE.Mesh(G.ico, emissive);
        core.scale.setScalar(1.5);
        core.position.y = 3;
        group.add(core);
        const cage = new THREE.Mesh(G.ico, new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.35 }));
        cage.scale.setScalar(2.35);
        cage.position.y = 3;
        group.add(cage);
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(G.ringInner, emissive);
          ring.rotation.x = Math.PI / 2 + (i ? 0.7 : 0);
          ring.rotation.z = i * 1.2;
          ring.position.y = 3;
          ring.scale.setScalar(1.3 + i * 0.35);
          group.add(ring);
        }
        const mast = new THREE.Mesh(G.cyl, metal);
        mast.scale.set(0.14, 2.6, 0.14);
        mast.position.set(-1.8, 1.3, 1.2);
        group.add(mast);
        const dish = new THREE.Mesh(G.sphere, metal);
        dish.scale.set(0.85, 0.22, 0.85);
        dish.position.set(-1.8, 2.7, 1.2);
        group.add(dish);
        const panel = new THREE.Mesh(G.box, new THREE.MeshStandardMaterial({ color: 0x1b3a58, roughness: 0.3, metalness: 0.7 }));
        panel.scale.set(2.2, 0.08, 1.4);
        panel.position.set(1.9, 1.2, 1.1);
        panel.rotation.z = -0.2;
        group.add(panel);
        break;
      }
      case 'art':
      default: {
        const pedestal = new THREE.Mesh(G.cyl, dark);
        pedestal.scale.set(1.5, 0.9, 1.5);
        pedestal.position.y = 0.9;
        group.add(pedestal);
        const sculpture = new THREE.Mesh(G.torusKnot, emissive);
        sculpture.position.y = 3.4;
        sculpture.scale.setScalar(1.15);
        sculpture.rotation.x = 0.4;
        group.add(sculpture);
        for (let i = 0; i < 3; i++) {
          const gem = new THREE.Mesh(G.ico, metal);
          const a = (i / 3) * Math.PI * 2;
          gem.position.set(Math.cos(a) * 2.1, 2.4 + i * 0.7, Math.sin(a) * 2.1);
          gem.scale.setScalar(0.38 + i * 0.1);
          group.add(gem);
        }
        const halo = new THREE.Mesh(G.ringInner, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 }));
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 5;
        halo.scale.setScalar(1.4);
        group.add(halo);
        break;
      }
    }

    group.userData.accent = accent;
    group.userData.emissive = emissive;
    return group;
  }

  /* ───────────────────── theme / quality ───────────────────── */

  setPalette(id, instant = false) {
    const next = PALETTES[id] || PALETTES.all;
    this.paletteId = id;
    this.palette = next;
    this.theme.from = { ...this.theme.current };
    this.theme.to = { ...next };
    this.theme.t = instant ? 1 : 0;
    if (instant) {
      this.theme.current = { ...next };
      this._applyThemeTarget(1);
    }
  }

  _applyThemeTarget(alpha) {
    const from = this.theme.from;
    const to = this.theme.to;
    const lerp = (key, target) => {
      const a = new THREE.Color(from[key] || to[key]);
      const b = new THREE.Color(to[key]);
      target.copy(a).lerp(b, alpha);
    };
    lerp('skyTop', this.skyUniforms.uTop.value);
    lerp('skyBottom', this.skyUniforms.uBottom.value);
    lerp('seaDeep', this.seaUniforms.uDeep.value);
    lerp('seaHorizon', this.seaUniforms.uHorizon.value);
    lerp('accent', this.skyUniforms.uGlow.value);
    lerp('accent', this.seaUniforms.uAccent.value);
    lerp('fog', this.scene.fog.color);
    this.rim.color.copy(this.skyUniforms.uGlow.value);

    const rockTarget = new THREE.Color(to.rock);
    for (const entry of this.islands) {
      entry.rockBase.copy(rockTarget).lerp(entry.accent, 0.2);
      entry.rockMat.color.copy(entry.rockBase);
      entry.topMat.color.copy(entry.rockBase).multiplyScalar(0.8);
      entry.debrisMat.color.copy(entry.rockBase).lerp(entry.accent, 0.3);
      entry.focusMat.color.copy(this.skyUniforms.uGlow.value);
    }
    this.focusLight.color.copy(this.skyUniforms.uGlow.value);
  }

  setQuality(quality) {
    this.quality = quality;
    const high = quality === 'high';
    this.renderer.shadowMap.enabled = false;
    this.starMaterial.size = high ? 2.4 : 1.9;
    this.stars.visible = true;
    this.sea.visible = true;
    this.sky.material.wireframe = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    if (this.dust) this.dustMaterial.opacity = high ? 0.4 : 0.24;
    if (this.bloom) this.bloom.enabled = high;
    this._syncComposer();
    this.scene.fog.density = high ? 0.0055 : 0.0072;
  }

  setResolutionScale(scale) {
    const base = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
    this.renderer.setPixelRatio(Math.max(0.65, base * scale));
    this._syncComposer();
  }

  _syncComposer() {
    if (!this.composer) return;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    if (this.bloom) this.bloom.setSize(size.x, size.y);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this._syncComposer();
  }

  /* ───────────────────── per frame ───────────────────── */

  update(dt, cameraPosition) {
    this.time += dt;
    const t = this.time;

    // テーマの補間
    if (this.theme.t < 1) {
      this.theme.t = Math.min(1, this.theme.t + dt / 1.1);
      const e = this.theme.t * this.theme.t * (3 - 2 * this.theme.t);
      this._applyThemeTarget(e);
      this.theme.current = {
        skyTop: '#' + this.skyUniforms.uTop.value.getHexString(),
        skyBottom: '#' + this.skyUniforms.uBottom.value.getHexString(),
        seaDeep: '#' + this.seaUniforms.uDeep.value.getHexString(),
        seaHorizon: '#' + this.seaUniforms.uHorizon.value.getHexString(),
        rock: '#' + this.theme.to.rock,
        fog: '#' + this.scene.fog.color.getHexString(),
        accent: '#' + this.skyUniforms.uGlow.value.getHexString(),
      };
    }

    this.seaUniforms.uTime.value = t;

    if (this.dust) {
      const positions = this.dust.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        let y = positions.getY(i) + this.dustSpeeds[i] * dt;
        if (y > 46) y = 1;
        positions.setY(i, y);
        positions.setX(i, positions.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.35);
      }
      positions.needsUpdate = true;
      this.dust.material.opacity = 0.28 + Math.sin(t * 0.8) * 0.06;
    }
    this.stars.rotation.y = t * 0.006;
    this.sky.position.copy(cameraPosition);

    for (const entry of this.islands) {
      const bob = Math.sin(t * 0.55 + entry.phase) * 0.35;
      entry.root.position.y = entry.home.y + bob;
      entry.ring.rotation.z = t * 0.18 + entry.phase;
      entry.ring2.rotation.z = -t * 0.26 + entry.phase;
      entry.focusRing.rotation.z = t * 0.5;
      entry.glow.material.opacity = 0.32 + Math.sin(t * 1.4 + entry.phase) * 0.08;
      entry.decor.rotation.y = Math.sin(t * 0.22 + entry.phase) * 0.18;
      entry.beam.material.opacity = 0.1 + Math.sin(t * 0.9 + entry.phase) * 0.04;

      entry.shards.children.forEach((shard, i) => {
        const a = t * (0.45 + i * 0.13) + entry.phase + (i / 3) * Math.PI * 2;
        const r = 5.2 + i * 0.55;
        shard.position.set(Math.cos(a) * r, 1.4 + Math.sin(a * 1.7 + i) * 1.5, Math.sin(a) * r);
        shard.rotation.set(a * 1.7, a * 1.2, 0);
      });

      // ホバーアニメーション
      const target = entry === this.islands[this.focusIndex] ? 1 : 0;
      entry.hover += (target - entry.hover) * Math.min(1, dt * 6);
      entry.focusMat.opacity = entry.hover * 0.55;
      entry.root.scale.setScalar(1 + entry.hover * 0.055);
      entry.glow.scale.setScalar(9 + entry.hover * 4);
      entry.ring.material.opacity = 0.3 + entry.hover * 0.3;
    }

    if (this.focusIndex >= 0) {
      const entry = this.islands[this.focusIndex];
      this.focusLight.position.copy(entry.root.position).add(new THREE.Vector3(0, 3, 0));
      this.focusLight.intensity = 46 * entry.hover;
    } else {
      this.focusLight.intensity = 0;
    }
  }

  render() {
    if (this.composer && this.bloom && this.bloom.enabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setBloomEnabled(enabled) {
    if (this.bloom) this.bloom.enabled = enabled;
  }

  /** 島のスクリーン座標と距離。HTML ビルボード用。 */
  project(entry, width, height) {
    const pos = entry.root.position.clone();
    pos.y += 6.4;
    const vector = pos.clone().project(this.camera);
    const distance = this.camera.position.distanceTo(entry.root.position);
    const behind = vector.z > 1 || vector.z < -1;
    return {
      x: (vector.x * 0.5 + 0.5) * width,
      y: (-vector.y * 0.5 + 0.5) * height,
      visible: !behind && vector.z < 1,
      distance,
    };
  }

  setFocus(index) {
    this.focusIndex = index;
    this.islands.forEach((entry, i) => {
      if (i === index) entry.visited = true;
    });
    if (index >= 0) this.visited.add(index);
  }

  markVisited(index) {
    this.visited.add(index);
    if (this.islands[index]) this.islands[index].visited = true;
  }

  getIslandAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.islandGroups, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && node.userData.index === undefined) node = node.parent;
      if (node && node.userData.index !== undefined) {
        return this.islands[node.userData.index];
      }
    }
    return null;
  }

  dispose() {
    this.clear();
    this.glowTex.dispose();
    this.renderer.dispose();
  }
}
