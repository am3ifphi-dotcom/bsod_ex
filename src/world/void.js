import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const load = (u) => loader.loadAsync(u);
const rand = (a, b) => a + Math.random() * (b - a);

const BLUE = 0x0a63c8;
const DEEP = 0x041024;

/* ---------------------------------------------------------- text texture */
export function textTexture(text, opts = {}) {
  const {
    w = 1024, h = 256, font = '700 150px Selawik, "Segoe UI", Arial, sans-serif',
    color = '#dff3ff', glow = 'rgba(90,190,255,0.85)', align = 'center', spacing = 0, sub = null, subFont = null,
  } = opts;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
  const x = align === 'center' ? w / 2 : 24;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 34;
  ctx.fillStyle = color;
  ctx.fillText(text, x, sub ? h * 0.4 : h / 2);
  ctx.shadowBlur = 14;
  ctx.fillText(text, x, sub ? h * 0.4 : h / 2);
  if (sub) {
    ctx.shadowBlur = 18;
    ctx.font = subFont || '400 46px Selawik, Arial, sans-serif';
    ctx.fillStyle = 'rgba(170,215,255,0.8)';
    ctx.fillText(sub, x, h * 0.78);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------------------------------------------------------------- shaders */
const groundShader = {
  uniforms: {
    uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() },
    uPulse: { value: 0 }, uCrack: { value: 0 }, uHole: { value: 0 }, uCenter: { value: new THREE.Vector2(0, 0) },
    uFogColor: { value: new THREE.Color(DEEP) }, uFogDensity: { value: 0.028 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    varying vec2 vUv;
    void main(){
      vec4 wp = modelMatrix * vec4(position,1.0);
      vWorld = wp.xyz; vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform float uTime, uPulse, uCrack, uHole, uFogDensity;
    uniform vec3 uPlayer, uFogColor;
    uniform vec2 uCenter;
    varying vec3 vWorld;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.7,289.3)))*43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
    }
    float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=noise(p)*a; p*=2.03; a*=0.5;} return v; }

    void main(){
      vec2 p = vWorld.xz;
      float d = length(p);
      // cell grid derived from the BSOD's own UI grid
      vec2 g = abs(fract(p*0.25)-0.5);
      float line = smoothstep(0.485,0.5,max(g.x,g.y));
      vec2 g2 = abs(fract(p*0.0625)-0.5);
      float line2 = smoothstep(0.492,0.5,max(g2.x,g2.y));

      float n = fbm(p*0.11 + vec2(uTime*0.012, -uTime*0.008));
      float n2 = fbm(p*0.6 + 3.0);

      vec3 base = vec3(0.012,0.036,0.080);
      vec3 col = base;
      col += vec3(0.02,0.09,0.22) * n;
      col += vec3(0.05,0.22,0.5) * line * 0.5;
      col += vec3(0.04,0.16,0.38) * line2 * 0.65;

      // glowing fractures
      float crack = smoothstep(0.72, 0.98, fbm(p*0.16 + 11.0));
      float flick = 0.55 + 0.45*sin(uTime*1.6 + p.x*0.7 + p.y*0.4);
      col += vec3(0.10,0.42,0.95) * crack * flick * (0.55 + uCrack*2.4);

      // a rare hard flicker of dead pixels, not constant confetti
      float static_ = step(0.9994, hash(floor(p*14.0) + floor(uTime*9.0)));
      col += vec3(0.45,0.65,1.0) * static_ * (0.10 + uPulse*0.35);

      // light spill around the player
      float pl = smoothstep(9.0, 0.0, length(p - uPlayer.xz));
      col += vec3(0.03,0.10,0.20) * pl;

      // the centre dais glows
      float cd = length(p - uCenter);
      col += vec3(0.10,0.30,0.65) * smoothstep(16.0, 5.0, cd) * (0.35 + 0.2*sin(uTime*0.8));

      // the hole (collapse) swallows everything nearby
      if (uHole > 0.001){
        float h = smoothstep(uHole*16.0, uHole*6.0, length(p - uPlayer.xz));
        col = mix(col, vec3(0.0), h);
      }

      // distance fade
      float fog = 1.0 - exp(-uFogDensity*uFogDensity*d*d*1.0);
      col = mix(col, uFogColor, clamp(fog,0.0,1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const skyShader = {
  uniforms: { uTime: { value: 0 }, uHole: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform float uTime, uHole;
    varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 top = vec3(0.004,0.012,0.035);
      vec3 mid = vec3(0.012,0.055,0.13);
      vec3 bot = vec3(0.02,0.09,0.20);
      vec3 col = mix(bot, mid, smoothstep(-0.2, 0.15, h));
      col = mix(col, top, smoothstep(0.1, 0.9, h));
      // distant error-text bands
      float band = sin(h*90.0 + uTime*0.4);
      col += vec3(0.03,0.10,0.22) * smoothstep(0.9, 1.0, band) * smoothstep(0.6, -0.1, h);
      float band2 = sin(h*310.0 - uTime*0.9);
      col += vec3(0.02,0.06,0.14) * smoothstep(0.97, 1.0, band2);
      // a slow blue aurora
      float a = sin(d.x*3.0 + uTime*0.1) * cos(d.z*2.2 - uTime*0.07);
      col += vec3(0.01,0.06,0.14) * smoothstep(0.2,1.0,a) * smoothstep(0.5,0.0,abs(h-0.1));
      col *= 1.0 - uHole*0.45;
      gl_FragColor = vec4(col,1.0);
    }
  `,
};

/* ----------------------------------------------------------------- world */
export class VoidWorld {
  constructor(engine, audio) {
    this.engine = engine;
    this.audio = audio;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(DEEP, 0.014);
    this.scene.background = new THREE.Color(DEEP);
    this.scene.userData.bloom = 0.9;
    this.scene.userData.bloomRadius = 0.85;
    this.scene.userData.bloomThreshold = 0.72;
    this.eyeHeight = 1.68;
    this.surface = 'concrete';
    this.gravity = 20;
    this.radius = 62;
    this.spawn = { pos: new THREE.Vector3(2.5, 0, 30), yaw: 0.08, pitch: -0.02 };
    this.interactables = [];
    this.colliders = [];
    this.time = 0;
    this.anims = [];
    this.pulse = 0;
    this.crack = 0;
    this.hole = 0;
    this.center = new THREE.Vector2(0, -6);
    this.revealed = false;
  }

  async build() {
    const [rack, cray, mobo, cables] = await Promise.all([
      load('models/rack.glb'), load('models/cray.glb'), load('models/mobo.glb'), load('models/cables.glb'),
    ]);

    this.buildSky();
    this.buildGround();
    this.buildMonument(cray.scene);
    this.buildPillars(rack.scene);
    this.buildDebris(mobo.scene, cables.scene);
    this.buildUIWreckage();
    this.buildText();
    this.buildLights();
    this.buildInteractables();
    this.buildDistant();

    this.ready = true;
    return this;
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(240, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: skyShader.uniforms, vertexShader: skyShader.vertexShader,
      fragmentShader: skyShader.fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.sky);
  }

  buildGround() {
    const geo = new THREE.PlaneGeometry(300, 300, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(groundShader.uniforms),
      vertexShader: groundShader.vertexShader,
      fragmentShader: groundShader.fragmentShader,
      fog: false,
    });
    this.ground = new THREE.Mesh(geo, this.groundMat);
    this.ground.position.y = 0;
    this.scene.add(this.ground);

    // a huge glassy plane below the terrain: "the screen you are standing on"
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshBasicMaterial({ color: 0x02060e, transparent: true, opacity: 0.9, fog: false })
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -8;
    this.scene.add(under);
  }

  buildMonument(crayScene) {
    const g = new THREE.Group();
    g.position.set(this.center.x, 0, this.center.y);
    this.scene.add(g);
    this.monument = g;

    // dais
    const daisMat = new THREE.MeshStandardMaterial({ color: 0x3a6d96, roughness: 0.22, metalness: 0.4, emissive: 0x1d4c72, emissiveIntensity: 1.25 });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(11, 12.2, 1.4, 8), daisMat);
    dais.position.y = 0.7;
    dais.receiveShadow = true;
    g.add(dais);
    // faint glow washing over the platform top
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(11.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x2b6ea8, transparent: true, opacity: 0.20, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 1.415;
    g.add(glow);
    this.daisGlow = glow;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(11.4, 0.07, 6, 8),
      new THREE.MeshBasicMaterial({ color: 0x54c8ff, fog: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.42;
    g.add(ring);
    this.daisRing = ring;

    // the monolith — stacked Cray-1 bodies
    const body = crayScene;
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        m.emissive = new THREE.Color(0x1b4a70);
        m.emissiveIntensity = 0.7;
        m.roughness = Math.min(0.7, m.roughness ?? 0.6);
      });
    });
    const stack = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const c = body.clone(true);
      const sc = 3.15 - i * 0.11;
      c.scale.setScalar(sc);
      c.position.y = 1.4 + i * 2.35;
      c.rotation.y = i * 0.42;
      stack.add(c);
    }
    // an outer cage of ribs so the tower has readable structure at distance
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x1d4c72, roughness: 0.4, metalness: 0.6, emissive: 0x14374f, emissiveIntensity: 0.9 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.55, 30, 0.55), ribMat);
      rib.position.set(Math.cos(a) * 3.5, 16, Math.sin(a) * 3.5);
      g.add(rib);
    }
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.09, 5, 24), ribMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 6 + i * 7.5;
      g.add(band);
    }
    g.add(stack);
    this.stack = stack;

    // glowing core inside the stack
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), coreMat);
    core.position.y = 12;
    g.add(core);
    this.core = core;
    // soft halo sprite behind the core so it glows instead of reading as a flat shape
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0x7fd0ff) }, uTime: { value: 0 }, uFade: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uTime; uniform float uFade;
          void main(){
            float d = length(vUv-0.5)*2.0;
            float r1 = smoothstep(0.10, 0.0, abs(d - 0.30));
            float r2 = smoothstep(0.05, 0.0, abs(d - 0.52));
            float a = (r1*0.26 + r2*0.14 + pow(max(0.0,1.0-d),3.0)*0.05) * uFade;
            gl_FragColor = vec4(uColor*a, a);
          }`,
      })
    );
    halo.position.y = 12;
    halo.renderOrder = -1;
    g.add(halo);
    this.coreHalo = halo;

    // a shaft of light climbing out of the monument into the sky
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 3.4, 90, 20, 1, true),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0x4aa8ee) }, uTime: { value: 0 }, uFade: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uTime; uniform float uFade;
          void main(){ float fade = pow(1.0 - vUv.y, 1.6) * pow(vUv.y, 0.35) * uFade;
            float pulse = 0.75 + 0.25*sin(uTime*0.9 + vUv.y*7.0);
            gl_FragColor = vec4(uColor * fade * 0.14 * pulse, fade * 0.14); }`,
      })
    );
    beam.position.y = 45;
    g.add(beam);
    this.beam = beam;
    const coreLight = new THREE.PointLight(0x4fb4ff, 26, 42, 2);
    coreLight.position.y = 12;
    g.add(coreLight);
    this.coreLight = coreLight;

    // a light inside the stack so it is modelled rather than a silhouette
    const inner = new THREE.PointLight(0x6fc0ff, 34, 22, 1.9);
    inner.position.y = 7;
    g.add(inner);

    // uplights at the foot of the monolith
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + 0.4;
      const up = new THREE.SpotLight(0x8fd4ff, 30, 30, Math.PI * 0.22, 0.7, 1.6);
      up.position.set(Math.cos(a) * 8.4, 1.6, Math.sin(a) * 8.4);
      up.target.position.set(0, 14, 0);
      g.add(up);
      g.add(up.target);
    }

    // four shards of glass orbiting the monument
    this.orbit = [];
    for (let i = 0; i < 5; i++) {
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.12, 1.1),
        new THREE.MeshStandardMaterial({
          color: 0x0a2540, roughness: 0.15, metalness: 0.9,
          emissive: 0x113355, emissiveIntensity: 0.8, transparent: true, opacity: 0.9,
        })
      );
      shard.position.set(0, 0, 0);
      g.add(shard);
      this.orbit.push({ mesh: shard, r: 9 + i * 1.6, y: 5 + i * 3.2, a: i * 1.3, sp: 0.12 + i * 0.03 });
    }

    // steps
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(
        new THREE.CylinderGeometry(13.5 + i * 1.4, 13.9 + i * 1.4, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x1b3f5e, roughness: 0.35, metalness: 0.45, emissive: 0x0d2a42, emissiveIntensity: 1.1 })
      );
      st.position.y = 0.15 - i * 0.3;
      st.rotation.y = Math.PI / 8;
      g.add(st);
    }
  }

  buildPillars(rackScene) {
    const group = new THREE.Group();
    this.scene.add(group);
    this.pillars = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ad4ff });
    const rackMat = new THREE.MeshStandardMaterial({
      color: 0x2c6f9e, roughness: 0.45, metalness: 0.5,
      emissive: 0x1d5b8c, emissiveIntensity: 1.15,
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rand(-0.08, 0.08);
      const r = rand(23, 40);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r + this.center.y * 0.4;
      const h = rand(5, 20);
      const p = rackScene.clone(true);
      p.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false; o.receiveShadow = false;
        o.material = rackMat;
      });
      p.scale.setScalar(rand(1.2, 2.4));
      p.position.set(x, 0, z);
      p.rotation.y = a + Math.PI;
      p.rotation.z = rand(-0.06, 0.06);
      group.add(p);
      // glowing strip in the rack
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.5, 0.06), mat);
      strip.position.set(x + Math.cos(a + Math.PI) * 1.4, h * 0.3, z + Math.sin(a + Math.PI) * 1.4);
      group.add(strip);
      this.colliders.push({ type: 'circle', x, z, r: 1.2 });
      this.pillars.push({ mesh: p, strip, base: p.position.y, phase: Math.random() * 6.28 });
    }

    // cables snaking across the ground
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Mesh(
        new THREE.TorusGeometry(rand(2, 7), 0.08, 4, 14, rand(0.6, 2.4)),
        new THREE.MeshStandardMaterial({ color: 0x0a1522, roughness: 0.8, metalness: 0.3 })
      );
      c.rotation.set(-Math.PI / 2, 0, rand(0, 6.28));
      c.position.set(rand(-40, 40), 0.06, rand(-50, 30));
      this.scene.add(c);
    }
  }

  buildDebris(moboScene, cablesScene) {
    const group = new THREE.Group();
    this.scene.add(group);
    this.debris = [];
    for (let i = 0; i < 14; i++) {
      const isBoard = i % 2 === 0;
      let m;
      if (isBoard) {
        m = moboScene.clone(true);
        m.scale.setScalar(rand(0.7, 2.6));
      } else {
        const mats = [
          new THREE.MeshStandardMaterial({ color: 0x081a2e, roughness: 0.3, metalness: 0.8, emissive: 0x0a2a4a, emissiveIntensity: 0.7 }),
          new THREE.MeshStandardMaterial({ color: 0x0c3355, roughness: 0.5, metalness: 0.5, emissive: 0x14507f, emissiveIntensity: 0.9 }),
        ];
        m = new THREE.Mesh(new THREE.BoxGeometry(rand(0.6, 3.4), rand(0.06, 0.5), rand(0.6, 2.6)), mats[i % 2]);
      }
      const a = rand(0, Math.PI * 2), r = rand(9, 46);
      m.position.set(Math.cos(a) * r, rand(1.5, 22), Math.sin(a) * r + this.center.y * 0.5);
      m.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      group.add(m);
      this.debris.push({ mesh: m, y0: m.position.y, phase: rand(0, 6.28), amp: rand(0.2, 1.1), rot: rand(-0.12, 0.12) });
    }

    // wireframe shards: distance and depth cues
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x2d8fd0, wireframe: true, transparent: true, opacity: 0.11 });
    for (let i = 0; i < 22; i++) {
      const s = rand(0.6, 3.2);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), wireMat);
      const a = rand(0, 6.28), r = rand(12, 58);
      m.position.set(Math.cos(a) * r, rand(2, 26), Math.sin(a) * r);
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      group.add(m);
      this.debris.push({ mesh: m, y0: m.position.y, phase: rand(0, 6.28), amp: rand(0.4, 1.6), rot: rand(-0.2, 0.2) });
    }
  }

  /** Half-dissolved error dialogs, hanging in the air like debris of the OS. */
  buildUIWreckage() {
    const g = new THREE.Group();
    this.scene.add(g);
    this.uiPanels = [];
    const makePanel = (txt, sub) => {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 512;
      const x = c.getContext('2d');
      // window chrome
      x.fillStyle = 'rgba(8,26,44,0.92)';
      x.fillRect(0, 0, 1024, 512);
      x.strokeStyle = 'rgba(150,210,255,0.55)'; x.lineWidth = 4;
      x.strokeRect(2, 2, 1020, 508);
      x.fillStyle = 'rgba(20,60,100,0.85)';
      x.fillRect(2, 2, 1020, 54);
      x.fillStyle = 'rgba(200,230,255,0.9)';
      x.font = '700 30px Selawik, Arial, sans-serif';
      x.fillText(txt, 26, 38);
      // body text lines
      x.font = '400 26px Selawik, Arial, sans-serif';
      x.fillStyle = 'rgba(190,225,255,0.75)';
      for (let i = 0; i < 7; i++) x.fillText(sub[i % sub.length], 34, 120 + i * 44);
      // buttons
      for (let i = 0; i < 2; i++) {
        x.strokeStyle = 'rgba(160,215,255,0.6)';
        x.strokeRect(620 + i * 190, 420, 170, 56);
        x.fillStyle = 'rgba(160,215,255,0.5)';
        x.fillText(i ? 'CANCEL' : 'RETRY', 660 + i * 190, 458);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const lines = [
      'The instruction at 0x00007FF referenced memory.',
      'Click OK to terminate the process.',
      'A problem caused the program to stop working.',
      'No response. The screen is listening.',
      'wake_up is not recognized as a command.',
    ];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: makePanel(i % 2 ? 'bsod.exe' : 'recovery — unexpected', lines),
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, opacity: 0.9,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(rand(4, 9), rand(2, 4.5)), mat);
      const a = rand(0, 6.28), r = rand(14, 44);
      m.position.set(Math.cos(a) * r, rand(3, 22), Math.sin(a) * r + this.center.y * 0.5);
      m.rotation.set(rand(-0.3, 0.3), rand(0, 6.28), rand(-0.2, 0.2));
      g.add(m);
      this.uiPanels.push({ mesh: m, y0: m.position.y, phase: rand(0, 6.28), rot: rand(-0.08, 0.08) });
    }
  }

  buildText() {
    // WAKE_UP — the secret, written into the world at the centre
    const tex = textTexture('WAKE_UP', {
      w: 2048, h: 512, font: '700 250px Selawik, "Segoe UI", Arial, sans-serif',
      color: '#cfe8ff', glow: 'rgba(80,190,255,0.55)', spacing: 6,
      sub: 'SESSION TERMINATION COMMAND', subFont: '400 44px Selawik, Arial, sans-serif',
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    // a ceiling of text: when you stand under the monument and look up,
    // WAKE_UP is written across the whole sky
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(95, 23.75), mat);
    plane.rotation.x = Math.PI / 2;
    plane.position.set(this.center.x, 58.0, this.center.y);
    plane.material.opacity = 0;
    plane.visible = false;
    this.scene.add(plane);
    this.wakeText = plane;
    this.wakeMat = mat;
    this.wakeReveal = 0;

    // the same word, repeated as broken fragments on the far ring
    for (let i = 0; i < 12; i++) {
      const t2 = textTexture('WAKE_UP', { w: 1024, h: 256, font: '700 120px Selawik, Arial, sans-serif', color: 'rgba(190,230,255,0.5)', glow: 'rgba(40,120,200,0.5)', spacing: 4 });
      const m2 = new THREE.Mesh(
        new THREE.PlaneGeometry(rand(8, 20), rand(2, 5)),
        new THREE.MeshBasicMaterial({ map: t2, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.32, fog: true })
      );
      const a = rand(0, 6.28), r = rand(28, 58);
      m2.position.set(Math.cos(a) * r, rand(4, 22), Math.sin(a) * r);
      m2.rotation.y = -a + Math.PI / 2 + rand(-0.4, 0.4);
      this.scene.add(m2);
      this.debris.push({ mesh: m2, y0: m2.position.y, phase: rand(0, 6.28), amp: rand(0.2, 0.8), rot: 0 });
    }

    // a broken terminal near the spawn — the console is introduced diegetically
    const t3 = textTexture('CONSOLE_READY', { w: 1024, h: 256, font: '400 92px ui-monospace, monospace', color: 'rgba(160,220,255,0.9)', glow: 'rgba(40,140,220,0.8)', spacing: 2, sub: '[ C ]', subFont: '700 90px Selawik, Arial, sans-serif' });
    const term = new THREE.Group();
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.1, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x0a1a28, roughness: 0.4, metalness: 0.7 })
    );
    stand.position.y = 0.05;
    term.add(stand);
    const glassMat = new THREE.MeshBasicMaterial({ map: t3, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), glassMat);
    glass.position.y = 0.9;
    glass.rotation.x = -0.9;
    term.add(glass);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x143044, metalness: 0.8, roughness: 0.3 }));
    pole.position.y = 0.45;
    term.add(pole);
    term.position.set(6.2, 0, 27.0);
    term.rotation.y = -0.5;
    this.scene.add(term);
    this.terminal = term;
    this.terminalGlow = new THREE.PointLight(0x3f9fe0, 2.2, 4, 2);
    this.terminalGlow.position.set(6.2, 1.2, 27.0);
    this.scene.add(this.terminalGlow);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0x3a76bd, 0x02060c, 1.45);
    this.scene.add(hemi);
    this.hemi = hemi;
    const key = new THREE.DirectionalLight(0x9fd0ff, 1.7);
    key.position.set(-14, 24, 18);
    this.scene.add(key);
    // a cold pool near the spawn so the player isn't blind at first
    const spawnLight = new THREE.PointLight(0x22527f, 8, 18, 2);
    spawnLight.position.set(4, 5, 28);
    this.scene.add(spawnLight);

    // red error accent far away
    const red = new THREE.PointLight(0xff3344, 14, 40, 2);
    red.position.set(-18, 9, -30);
    this.scene.add(red);
    this.redLight = red;
  }

  buildDistant() {
    // silhouettes of impossible architecture on the horizon
    const mat = new THREE.MeshStandardMaterial({ color: 0x0d2c4a, roughness: 0.9, metalness: 0.1, emissive: 0x0a2740, emissiveIntensity: 0.8 });
    for (let i = 0; i < 18; i++) {
      const a = rand(0, 6.28), r = rand(70, 120);
      const w = rand(4, 18), h = rand(18, 60), d = rand(4, 18);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
      m.rotation.y = rand(0, 6.28);
      this.scene.add(m);
    }
    // floating specks
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), r = rand(2, 90);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rand(-2, 40);
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.specks = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9fd6ff, size: 0.12, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.scene.add(this.specks);
  }

  buildInteractables() {
    this.interactables = [
      {
        id: 'wake', pos: new THREE.Vector3(this.center.x, 4, this.center.y + 12), radius: 9.5,
        prompt: '　<b>WAKE_UP</b>　', onUse: () => this.discover(), once: false,
      },
      {
        id: 'terminal', pos: new THREE.Vector3(6.2, 1, 27), radius: 2.2,
        prompt: '<b>E</b>　コンソールを開く　[C]', onUse: () => this.onTerminal?.(),
      },
    ];
  }

  discover() {
    if (this.revealed) return;
    this.revealed = true;
    // the word is written into the world only once you are standing under it
    if (this.wakeText) { this.wakeText.visible = true; this.wakeMat.transparent = true; }
    this.onDiscover?.();
  }

  sampleGround() { return 0; }

  collide(pos, radius) {
    const d = Math.hypot(pos.x - this.center.x, pos.z - this.center.y);
    // dais step-up is handled by raising ground near centre
    const ground = this.sampleGround(pos.x, pos.z);
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const dd = Math.hypot(dx, dz);
      const rr = c.r + radius;
      if (dd < rr && dd > 0.0001) {
        pos.x = c.x + (dx / dd) * rr;
        pos.z = c.z + (dz / dd) * rr;
      }
    }
    // keep inside the world
    const rr = Math.hypot(pos.x, pos.z);
    if (rr > this.radius) {
      pos.x = (pos.x / rr) * this.radius;
      pos.z = (pos.z / rr) * this.radius;
    }
    // don't walk into the monument
    const dc = Math.hypot(pos.x - this.center.x, pos.z - this.center.y);
    if (dc < 12.6) {
      const nx = (pos.x - this.center.x) / (dc || 1);
      const nz = (pos.z - this.center.y) / (dc || 1);
      pos.x = this.center.x + nx * 12.6;
      pos.z = this.center.y + nz * 12.6;
    }
    return ground;
  }

  update(dt, t, ctx) {
    this.time = t;
    const u = this.groundMat.uniforms;
    u.uTime.value = t;
    u.uPulse.value = this.pulse;
    if (this.beam) {
      this.beam.material.uniforms.uTime.value = this.time;
      // standing inside the light shaft must not white out the frame
      const cam = ctx && ctx.camera;
      if (cam) {
        const d = Math.hypot(cam.position.x - this.center.x, cam.position.z - this.center.y);
        this.beam.material.uniforms.uFade.value = Math.min(1, Math.max(0, (d - 17) / 22));
      }
    }
    if (this.coreHalo && ctx && ctx.camera) {
      const d = Math.hypot(ctx.camera.position.x - this.center.x, ctx.camera.position.z - this.center.y);
      this.coreHalo.material.uniforms.uFade.value = Math.min(1, Math.max(0, (d - 20) / 24));
    }
    if (this.coreHalo && ctx && ctx.camera) this.coreHalo.quaternion.copy(ctx.camera.quaternion);
    u.uCrack.value = this.crack;
    u.uHole.value = this.hole;
    if (ctx?.player) u.uPlayer.value.copy(ctx.player);
    this.skyMat.uniforms.uTime.value = t;
    this.skyMat.uniforms.uHole.value = this.hole;

    // breathing pulse — quiet calm, then a swell
    this.pulse = 0.35 + Math.sin(t * 0.7) * 0.22 + Math.sin(t * 2.3) * 0.05;

    // float + rotate debris
    for (const d of this.debris) {
      d.mesh.position.y = d.y0 + Math.sin(t * 0.45 + d.phase) * d.amp;
      d.mesh.rotation.y += dt * d.rot;
      d.mesh.rotation.x += dt * d.rot * 0.4;
    }

    // the word burns itself into the sky after the discovery
    if (this.wakeText && this.wakeText.visible) {
      this.wakeReveal = Math.min(1, (this.wakeReveal || 0) + dt * 0.55);
      const k = this.wakeReveal;
      // the word is a sky, not a poster: it fades out of the way when you walk
      // underneath it, so it never blows out the frame at point-blank range
      const cam = ctx && ctx.camera;
      let near = 0;
      if (cam) {
        const d = Math.abs(cam.position.y - this.wakeText.position.y);
        near = Math.min(1, Math.max(0, (58 - d) / 40));
      }
      this.wakeMat.opacity = k * (0.34 + 0.05 * Math.sin(t * 1.4)) * (1 - near * 0.8);
      this.wakeText.scale.setScalar(0.82 + 0.18 * k);
      this.wakeText.position.y = 58.0 - (1 - k) * 6.0;
    }

    // the floating dialogs drift, and every so often one of them glitches out
    if (this.uiPanels) {
      for (const p of this.uiPanels) {
        p.mesh.position.y = p.y0 + Math.sin(t * 0.32 + p.phase) * 0.7;
        p.mesh.rotation.z += dt * p.rot * 0.3;
        const flick = Math.sin(t * 1.7 + p.phase * 3.1);
        p.mesh.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.8 + p.phase));
        if (flick > 0.985) p.mesh.material.opacity = 0.12;
      }
    }

    // orbit shards around the monument
    for (const o of this.orbit) {
      o.a += dt * o.sp;
      o.mesh.position.set(Math.cos(o.a) * o.r, o.y + Math.sin(t * 0.6 + o.a) * 0.6, Math.sin(o.a) * o.r);
      o.mesh.rotation.set(0.2, -o.a + Math.PI / 2, 0.12);
    }

    // core pulse
    if (this.core) {
      const s = 1 + Math.sin(t * 1.1) * 0.06 + this.crack * 0.5;
      this.core.scale.setScalar(s);
      this.core.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.1 + this.crack * 0.4;
      this.coreLight.intensity = 26 + Math.sin(t * 1.7) * 4 + this.crack * 40;
    }

    // the word breathes and intensifies as you approach
    if (this.wakeMat) {
      const near = ctx?.wakeNear || 0;
      this.wakeMat.opacity = 0.75 + 0.15 * Math.sin(t * 1.6) + near * 0.25;
      this.wakeText.position.y = 7.2 + Math.sin(t * 0.5) * 0.15;
    }
    if (this.terminalGlow) this.terminalGlow.intensity = 2.0 + Math.sin(t * 3.1) * 0.6;

    // pillar emission flicker, only rarely
    for (const p of this.pillars) {
      const f = 0.8 + Math.sin(t * 2 + p.phase) * 0.2;
      if (p.strip.material) p.strip.material.color.setRGB(0.25 * f, 0.62 * f, 1.0 * f);
    }

    // red light strobes on the beat of the collapse
    if (this.redLight) this.redLight.intensity = 6 + Math.sin(t * 0.9) * 4 + this.crack * 30;
    if (this.specks) this.specks.rotation.y = t * 0.008;

    // camera-relative sky
    if (this.sky && ctx?.camera) this.sky.position.copy(ctx.camera.position);
  }

  /** Begin the world-collapse visuals (called by the cinematic). */
  beginCollapse() {
    this.collapse = 0;
  }
}

export { groundShader, skyShader };
