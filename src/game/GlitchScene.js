import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { instantiateModel, bakeStaticModel } from '../core/AssetManager.js';
import { makeErrorPanelTexture } from './textures.js';
import { rand, sranda, srand, smoothstep } from '../core/util.js';

const GROUND_SHADER = {
  uniforms: {
    uTime: { value: 0 },
    uCrack: { value: 0 },
    uConcrete: { value: null },
    uFogColor: { value: new THREE.Color(0x050a14) },
    uFogDensity: { value: 0.016 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position,1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform float uTime, uCrack;
    uniform sampler2D uConcrete;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec3 vWorld;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
      vec2 u=f*f*(3.-2.*f);
      return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
    }
    float crackLine(vec2 p, float seed){
      float v = 0.0;
      vec2 q = p;
      for(int i=0;i<5;i++){
        q += vec2(noise(q*2.0+seed)*1.8, noise(q*2.3-seed)*1.8);
        float l = abs(q.x + sin(q.y*1.6+seed)*0.7);
        v = max(v, smoothstep(0.12,0.0,l));
      }
      return v;
    }
    void main(){
      vec2 p = vWorld.xz;
      vec3 conc = texture2D(uConcrete, p*0.18).rgb * 0.5;
      vec2 g = abs(fract(p*0.5)-0.5);
      float grid = smoothstep(0.46,0.5,max(g.x,g.y));
      vec2 g2 = abs(fract(p*0.05)-0.5);
      float grid2 = smoothstep(0.48,0.5,max(g2.x,g2.y));
      vec3 col = conc * vec3(0.35,0.5,0.75) + vec3(0.02,0.12,0.3)*grid*0.7 + vec3(0.05,0.25,0.55)*grid2;
      // 中心への道しるべグリッド光
      float d = length(p);
      float pathPulse = 0.5 + 0.5*sin(d*0.35 - uTime*2.2);
      col += vec3(0.05,0.3,0.7) * pathPulse * smoothstep(40.0, 4.0, d) * 0.35;
      // 亀裂
      float cr = crackLine(p*0.12, 3.1) * uCrack + crackLine(p*0.22, 7.7) * uCrack * 0.6;
      col = mix(col, vec3(0.4,0.85,1.0), clamp(cr,0.0,1.0)*0.9);
      col += vec3(0.1,0.4,0.9)*cr*uCrack;
      // フォグ
      float dist = length(cameraPosition - vWorld);
      float fogF = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
      col = mix(col, uFogColor, clamp(fogF,0.0,1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class GlitchScene {
  constructor() {
    this.group = new THREE.Group();
    this.name = 'void';
    this.bounds = { minX: -102, maxX: 102, minZ: -102, maxZ: 102 };
    this.colliders = [];
    this.playerStart = { pos: new THREE.Vector3(0, 0.05, 68), yaw: Math.PI, pitch: 0 };
    this.discovered = false;
    this._burst = 0;
    this._nextGlitch = 4;
    this._glitchCb = null;
    this._collapsed = false;
    this.tiles = [];
    this.shaftRings = [];
    // 毎フレーム確保を避けるための再利用オブジェクト
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._wakeReveal = 0;
  }

  onGlitch(cb) { this._glitchCb = cb; }

  async load(assets) {
    this.assets = assets;
    const concrete = await assets.loadTexture('./textures/rough_concrete_diff_1k.jpg');
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    this._buildGround(concrete);
    this._buildShaft();
    await this._buildMonument(assets);
    this._buildDebris();
    await this._buildDistantStructures(assets);
    this._buildParticles();
    this._buildLights();
  }

  _buildGround(concrete) {
    // 外側リング(中央は落下タイルで塞がれ、崩壊時にシャフトが現れる)
    const geo = new THREE.RingGeometry(10.2, 170, 64, 1);
    geo.rotateX(-Math.PI / 2);
    this.groundMat = new THREE.ShaderMaterial({ ...GROUND_SHADER, side: THREE.DoubleSide });
    this.groundMat.uniforms.uConcrete.value = concrete;
    const ground = new THREE.Mesh(geo, this.groundMat);
    this.group.add(ground);

    // 中央の破壊可能タイル
    srand(42);
    const tileGeo = new THREE.BoxGeometry(3.9, 0.35, 3.9);
    const tileMat = new THREE.MeshStandardMaterial({
      map: concrete, color: 0x6f8fbf, roughness: 0.92, metalness: 0.1,
      emissive: 0x0a2a55, emissiveIntensity: 0.5,
    });
    const N = 5;
    for (let ix = 0; ix < N; ix++) {
      for (let iz = 0; iz < N; iz++) {
        const tile = new THREE.Mesh(tileGeo, tileMat.clone());
        tile.position.set((ix - (N - 1) / 2) * 4, -0.18, (iz - (N - 1) / 2) * 4);
        tile.userData.home = tile.position.clone();
        tile.userData.phase = sranda() * Math.PI * 2;
        tile.castShadow = false; tile.receiveShadow = true;
        this.group.add(tile);
        this.tiles.push(tile);
      }
    }
  }

  _buildShaft() {
    this.shaft = new THREE.Group();
    // 内壁
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x07182f, emissive: 0x0a3a7a, emissiveIntensity: 0.6,
      side: THREE.BackSide, roughness: 0.7,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 420, 24, 1, true), wallMat);
    wall.position.y = -210; // 上端を地面y=0に合わせ、縁が覗かないように
    this.shaft.add(wall);
    // グリッドリング
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x39a7ff, transparent: true, opacity: 0.75 });
    for (let y = 0; y >= -400; y -= 10) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.09, 8, 40), this.ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.shaft.add(ring);
      this.shaftRings.push(ring);
    }
    // 落下する破片
    this.shaftDebris = new THREE.Group();
    const dGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const dMat = new THREE.MeshBasicMaterial({ color: 0x2f7fd8 });
    for (let i = 0; i < 60; i++) {
      const d = new THREE.Mesh(dGeo, dMat);
      const a = rand(0, Math.PI * 2), r = rand(1, 7);
      d.position.set(Math.cos(a) * r, rand(-380, -5), Math.sin(a) * r);
      d.scale.setScalar(rand(0.3, 1.6));
      d.userData.spin = new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2));
      this.shaftDebris.add(d);
    }
    this.shaft.add(this.shaftDebris);
    this.shaft.visible = false;
    this.group.add(this.shaft);
  }

  async _buildMonument(assets) {
    const monument = new THREE.Group();

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 12.5, 0.8, 40),
      new THREE.MeshStandardMaterial({ color: 0x10243f, roughness: 0.8, metalness: 0.3, emissive: 0x0a2a55, emissiveIntensity: 0.4 })
    );
    platform.position.y = -0.4;
    monument.add(platform);

    // サーバーラックの輪
    const rackGLTF = await assets.loadGLB('./models/rack.glb');
    this.racks = [];
    const RACK_RING = 6;
    for (let i = 0; i < RACK_RING; i++) {
      const src = instantiateModel(rackGLTF, { targetHeight: 5.2, castShadow: false });
      const rack = bakeStaticModel(src);
      const a = (i / RACK_RING) * Math.PI * 2;
      rack.position.set(Math.cos(a) * 8.5, 0, Math.sin(a) * 8.5);
      rack.lookAt(0, 2.6, 0);
      rack.userData.homeY = 0;
      rack.userData.phase = i;
      monument.add(rack);
      this.racks.push(rack);
    }

    // Cray-1 が浮遊
    const crayGLTF = await assets.loadGLB('./models/cray.glb');
    this.cray = instantiateModel(crayGLTF, { targetSize: 5, castShadow: false });
    this.cray.position.y = 11;
    monument.add(this.cray);

    // 巨大リング
    this.bigRing = new THREE.Mesh(
      new THREE.TorusGeometry(7.5, 0.28, 16, 80),
      new THREE.MeshStandardMaterial({ color: 0x0a2a55, emissive: 0x2f8fff, emissiveIntensity: 1.6, roughness: 0.4 })
    );
    this.bigRing.position.y = 15;
    monument.add(this.bigRing);

    // 光の柱
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2.2, 90, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x2f8fff, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    beam.position.y = 45;
    monument.add(beam);

    // WAKE_UP テキスト
    const font = await new FontLoader().loadAsync('./fonts/helvetiker_bold.typeface.json');
    const geo = new TextGeometry('WAKE_UP', {
      font, size: 2.1, depth: 0.35, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 2,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, 0);
    this.wakeText = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xdff2ff, emissive: 0x9fd8ff, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.2,
    }));
    this.wakeText.position.y = 15;
    monument.add(this.wakeText);
    this.wakeText.userData.homeY = 15;
    // 発見まで隠す(遠目から光でネタバレしないため)
    this.wakeText.visible = false;
    this.wakeText.scale.setScalar(0.2);

    this.group.add(monument);
    this.monument = monument;

    this.colliders.push(new THREE.Box3(new THREE.Vector3(-12, 0, -12), new THREE.Vector3(12, 6, 12)));
  }

  _buildDebris() {
    // 浮遊する破片
    srand(99);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x123a66, emissive: 0x0a2a55, emissiveIntensity: 0.8, roughness: 0.6 });
    this.debris = new THREE.InstancedMesh(geo, mat, 220);
    this.debrisData = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    for (let i = 0; i < 220; i++) {
      const d = {
        pos: new THREE.Vector3(rand(-95, 95), rand(1, 38), rand(-95, 95)),
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        spin: rand(0.1, 0.7),
        scale: rand(0.15, 1.4),
        home: null,
      };
      d.home = d.pos.clone();
      this.debrisData.push(d);
      e.copy(d.rot); q.setFromEuler(e); s.setScalar(d.scale);
      m.compose(d.pos, q, s);
      this.debris.setMatrixAt(i, m);
    }
    this.debris.frustumCulled = false;
    this.group.add(this.debris);

    // エラーパネル
    this.panels = [];
    for (let i = 0; i < 22; i++) {
      const tex = makeErrorPanelTexture(i * 137 + 11);
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(rand(2.5, 5), rand(1.2, 2.4)),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, opacity: 0.85 })
      );
      const a = rand(0, Math.PI * 2), r = rand(18, 90);
      panel.position.set(Math.cos(a) * r, rand(2, 14), Math.sin(a) * r);
      panel.lookAt(0, panel.position.y, 0);
      panel.userData.home = panel.position.clone();
      panel.userData.phase = rand(0, 6);
      this.group.add(panel);
      this.panels.push(panel);
    }
  }

  async _buildDistantStructures(assets) {
    // ロード完了を待ってロード画面中に配置し終える(ポップイン防止)
    const rackGLTF = await assets.loadGLB('./models/rack.glb');
    srand(7);
    const DISTANT_RACKS = 6;
    for (let i = 0; i < DISTANT_RACKS; i++) {
      const src = instantiateModel(rackGLTF, { targetHeight: rand(14, 30), castShadow: false });
      const m = bakeStaticModel(src);
      const a = (i / DISTANT_RACKS) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(65, 100);
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      m.rotation.y = rand(0, Math.PI * 2);
      this.group.add(m);
    }
    // 吊り下がるケーブル
    const cableGLTF = await assets.loadGLB('./models/cables.glb');
    for (let i = 0; i < 8; i++) {
      const c = instantiateModel(cableGLTF, { targetSize: rand(6, 14), castShadow: false });
      const a = rand(0, Math.PI * 2), r = rand(20, 90);
      c.position.set(Math.cos(a) * r, rand(26, 40), Math.sin(a) * r);
      c.rotation.set(rand(0, 3), rand(0, 6), rand(0, 3));
      this.group.add(c);
    }
    // マザーボードの浮遊 slab
    const moboGLTF = await assets.loadGLB('./models/mobo.glb');
    this.moboSlabs = [];
    for (let i = 0; i < 5; i++) {
      const src = instantiateModel(moboGLTF, { targetSize: rand(6, 12), castShadow: false });
      const mb = bakeStaticModel(src);
      const a = rand(0, Math.PI * 2), r = rand(25, 80);
      mb.position.set(Math.cos(a) * r, rand(1.5, 8), Math.sin(a) * r);
      mb.rotation.set(rand(-0.5, 0.5), rand(0, 6), rand(-0.5, 0.5));
      mb.userData.home = mb.position.clone();
      mb.userData.phase = rand(0, 6);
      this.group.add(mb);
      this.moboSlabs.push(mb);
    }
  }

  _buildParticles() {
    const n = 450;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-110, 110);
      pos[i * 3 + 1] = rand(0.2, 45);
      pos[i * 3 + 2] = rand(-110, 110);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x6fc0ff, size: 0.09, transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.group.add(this.sparks);
  }

  _buildLights() {
    this.group.add(new THREE.AmbientLight(0x1a3358, 1.1));
    const hemi = new THREE.HemisphereLight(0x2a5a9a, 0x02040a, 0.7);
    this.group.add(hemi);
    this.coreLight = new THREE.PointLight(0x39a7ff, 120, 70, 1.6);
    this.coreLight.position.set(0, 12, 0);
    this.group.add(this.coreLight);
    const rim = new THREE.PointLight(0x88ccff, 40, 50, 2);
    rim.position.set(-20, 6, -20);
    this.group.add(rim);
  }

  setCrack(v) { this.groundMat.uniforms.uCrack.value = v; }

  // 崩壊開始
  beginCollapse() {
    this._collapsed = true;
    this.shaft.visible = true;
    this.tiles.forEach((t) => { t.userData.falling = false; t.userData.v = new THREE.Vector3(); t.userData.w = new THREE.Vector3(rand(-1.5,1.5),rand(-1.5,1.5),rand(-1.5,1.5)); });
  }

  // タイルを揺らして順次落下させる
  updateTiles(dt, intensity) {
    if (!this._collapsed) return;
    for (const t of this.tiles) {
      if (!t.userData.falling) {
        const d = t.position.length();
        t.position.x = t.userData.home.x + Math.sin(performance.now() * 0.02 + t.userData.phase) * 0.05 * intensity;
        t.position.z = t.userData.home.z + Math.cos(performance.now() * 0.017 + t.userData.phase) * 0.05 * intensity;
        if (intensity > 0.55 && d < 12 * intensity) {
          t.userData.falling = true;
          t.userData.v.set(rand(-0.6, 0.6), 0, rand(-0.6, 0.6));
        }
      } else {
        t.userData.v.y -= 14 * dt;
        t.position.addScaledVector(t.userData.v, dt);
        t.rotation.x += t.userData.w.x * dt;
        t.rotation.y += t.userData.w.y * dt;
        t.rotation.z += t.userData.w.z * dt;
      }
    }
  }

  scrollShaft(speed, dt) {
    for (const ring of this.shaftRings) {
      ring.position.y += speed * dt;
      if (ring.position.y > 2) ring.position.y -= 400;
      ring.material.opacity = 0.4 + Math.random() * 0.3;
    }
    this.shaftDebris.children.forEach((d) => {
      d.position.y += speed * dt * 0.8;
      d.rotation.x += d.userData.spin.x * dt; d.rotation.y += d.userData.spin.y * dt;
      if (d.position.y > 2) d.position.y = -390;
    });
  }

  reset() {
    this._collapsed = false;
    this.discovered = false;
    this._wakeReveal = 0;
    this._burst = 0;
    this._nextGlitch = 4;
    this.shaft.visible = false;
    this.setCrack(0);
    if (this.wakeText) { this.wakeText.visible = false; this.wakeText.scale.setScalar(0.2); }
    this.tiles.forEach((t) => {
      t.position.copy(t.userData.home);
      t.rotation.set(0, 0, 0);
      t.userData.falling = false;
      t.visible = true;
    });
    this.group.visible = true;
  }

  update(dt, time, playerPos) {
    this.groundMat.uniforms.uTime.value = time;

    // グリッチ監督: 静寂と異常の緩急
    this._nextGlitch -= dt;
    if (this._nextGlitch <= 0 && !this._collapsed) {
      this._burst = 1;
      this._nextGlitch = rand(4, 9.5);
      if (this._glitchCb) this._glitchCb(rand(0.25, 0.6));
    }
    this._burst = Math.max(0, this._burst - dt * 2.4);

    // 浮遊物(テンポラリは再利用)
    const m = this._m, q = this._q, e = this._e, s = this._s;
    const jolt = this._burst * 0.6;
    for (let i = 0; i < this.debrisData.length; i++) {
      const d = this.debrisData[i];
      d.rot.x += dt * d.spin * 0.6; d.rot.y += dt * d.spin;
      d.pos.y = d.home.y + Math.sin(time * 0.5 + i) * 0.5;
      d.pos.x = d.home.x + (Math.random() - 0.5) * jolt;
      d.pos.z = d.home.z + (Math.random() - 0.5) * jolt;
      e.copy(d.rot); q.setFromEuler(e); s.setScalar(d.scale);
      m.compose(d.pos, q, s);
      this.debris.setMatrixAt(i, m);
    }
    this.debris.instanceMatrix.needsUpdate = true;

    this.panels.forEach((p) => {
      p.position.y = p.userData.home.y + Math.sin(time * 0.7 + p.userData.phase) * 0.4;
      p.rotation.z = Math.sin(time * 0.4 + p.userData.phase) * 0.08 + (Math.random() - 0.5) * jolt * 0.2;
    });
    if (this.moboSlabs) this.moboSlabs.forEach((mb) => {
      mb.position.y = mb.userData.home.y + Math.sin(time * 0.6 + mb.userData.phase) * 0.6;
      mb.rotation.y += dt * 0.15;
    });

    // WAKE_UP 出現演出(発見まで非表示)
    if (this.wakeText && this.discovered && this._wakeReveal < 1) {
      this._wakeReveal = Math.min(1, this._wakeReveal + dt / 1.6);
      const k = smoothstep(0, 1, this._wakeReveal);
      this.wakeText.visible = true;
      this.wakeText.scale.setScalar(0.2 + 0.8 * k);
    }
    if (this.cray) { this.cray.rotation.y += dt * 0.5; this.cray.position.y = 11 + Math.sin(time * 0.8) * 0.5; }
    if (this.bigRing) { this.bigRing.rotation.z += dt * 0.25; this.bigRing.rotation.x = Math.sin(time * 0.3) * 0.15; }
    if (this.wakeText) {
      this.wakeText.position.y = this.wakeText.userData.homeY + Math.sin(time * 1.4) * 0.25;
      this.wakeText.rotation.y = Math.sin(time * 0.5) * 0.12;
      this.wakeText.material.emissiveIntensity = 1.4 + Math.sin(time * 3) * 0.5 + this._burst;
    }
    this.racks.forEach((r, i) => { r.position.y = r.userData.homeY + Math.sin(time * 1.2 + i) * 0.08; });
    if (this.sparks) { this.sparks.rotation.y += dt * 0.01; }

    // 発見判定
    if (!this.discovered && playerPos && Math.hypot(playerPos.x, playerPos.z) < 20) {
      this.discovered = true;
    }
    return { burst: this._burst, discovered: this.discovered, edge: Math.abs(playerPos.x) > 92 || Math.abs(playerPos.z) > 92 };
  }
}
