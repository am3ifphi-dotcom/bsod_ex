/**
 * 立ち絵を「紙の切り絵」として 3D 空間に置くためのモジュール。
 *
 * 元絵をそのまま板に貼るのではなく、
 *   1. アルファを二値化して輪郭を切り抜く（切れ端の揺らぎ付き）
 *   2. 網点（ハーフトーン）と版ズレで印刷物にする
 *   3. 縁に沿ってアクセント色の輪郭線を入れる
 *   4. 頂点を少し反らせて、紙が反っているようにする
 *   5. 裏面は紙の裏（無地）にする
 * という処理をシェーダで行っている。
 */
import * as THREE from 'three';
import { CHARACTERS, SPOTS } from './data/characters.js';
import { nameTagTexture } from './textures.js';
import { asset } from './assets.js';

const BASE_URL = asset('chara/');
const H_METERS = 1.72;      // 正規化済み立ち絵の高さ
const ASPECT = 480 / 1200;  // 加工済み画像の縦横比

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uReveal;
  varying vec2 vUv;
  varying float vFog;
  varying vec3 vNormalW;

  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    vec3 p = position;

    // 紙の反り（左右）
    float curl = sin(uv.x * 3.14159) * 0.035;
    // 息づき（上端がわずかに揺れる）
    float sway = sin(uTime * 0.9 + uSeed * 6.28) * 0.008 * uv.y;
    p.z += curl;
    p.x += sway;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uAccent;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  uniform float uStyle;      // 0 = 切り絵, 1 = インク, 2 = スペクトル
  uniform float uHighlight;
  uniform float uOpacity;
  uniform float uReveal;
  uniform vec2 uTexel;
  uniform vec3 uLightDir;
  uniform vec3 uFillColor;
  varying vec2 vUv;
  varying float vFog;
  varying vec3 vNormalW;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  void main() {
    if (vUv.y > uReveal) discard;

    // 紙の裏面は、同じ印刷が裏返しに見える（両面印刷の立ち人形）
    bool back = !gl_FrontFacing;
    vec2 uv = back ? vec2(1.0 - vUv.x, vUv.y) : vUv;

    // 版ズレ（リソグラフ風）
    float misreg = 0.0016;
    vec4 base = texture2D(uMap, uv);
    float ar = texture2D(uMap, uv + vec2(misreg, 0.0)).r;
    float ag = base.g;
    float ab = texture2D(uMap, uv - vec2(misreg * 0.6, 0.0)).b;

    // 切り抜き：アルファを二値化し、輪郭に揺らぎを入れる
    float noise = hash(floor(uv * vec2(420.0, 1100.0)));
    float cut = smoothstep(0.18, 0.46, base.a + (noise - 0.5) * 0.07);
    if (cut < 0.02) discard;

    vec3 col = vec3(ar, ag, ab);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));

    // 印刷の網点（弱め。遠景でのモアレを避ける）
    vec2 grid = fract(uv * vec2(480.0, 1200.0) / 4.5) - 0.5;
    float dotMask = smoothstep(0.55, 0.12, length(grid));
    float print = mix(1.0, 0.74 + dotMask * 0.42, 0.3);

    // 内側の輪郭
    float aL = texture2D(uMap, uv - vec2(uTexel.x * 2.4, 0.0)).a;
    float aR = texture2D(uMap, uv + vec2(uTexel.x * 2.4, 0.0)).a;
    float aU = texture2D(uMap, uv + vec2(0.0, uTexel.y * 2.4)).a;
    float aD = texture2D(uMap, uv - vec2(0.0, uTexel.y * 2.4)).a;
    float inner = min(min(aL, aR), min(aU, aD));
    float contour = smoothstep(0.62, 0.16, inner);

    // 紙の地色（わずかに暖かい）
    vec3 paper = vec3(1.03, 0.995, 0.955);
    float shade = mix(0.78, 1.06, smoothstep(0.0, 1.0, uv.y)); // 足元を暗く

    if (uStyle < 0.5) {
      // ---- 切り絵：色を少し落として紙に印刷する
      vec3 c = mix(vec3(lum), col, 0.84) * paper * shade;
      c *= print;
      c = mix(c, uAccent * 0.5 + col * 0.35, contour * 0.7);
      // 縁のハイライト（紙の切り口）
      float edgeLight = smoothstep(0.5, 0.0, min(inner, 1.0)) * 0.0;
      c += uHighlight * 0.09 + edgeLight;
      c += uAccent * (1.0 - cut) * 0.0;
      col = c;
    } else if (uStyle < 1.5) {
      // ---- インク：二色刷り
      vec3 c = mix(vec3(0.045, 0.05, 0.06), mix(vec3(0.96, 0.94, 0.9), uAccent, 0.55), smoothstep(0.35, 0.9, lum));
      c *= mix(0.55, 1.0, print);
      c = mix(c, uAccent * 0.9, contour * 0.5);
      col = c;
    } else {
      // ---- スペクトル：色分解とずれ
      float band = sin(uv.y * 420.0 + uTime * 2.4) * 0.5 + 0.5;
      vec3 c = col * mix(0.75, 1.25, band);
      c += uAccent * pow(1.0 - cut, 2.0) * 0.8;
      c = mix(c, uAccent, contour * 0.35);
      col = c;
    }

    // 疑似ライティング（窓からの光を板の向きで受ける）
    vec3 nrm = normalize(vNormalW);
    if (!gl_FrontFacing) nrm = -nrm;
    float ndl = dot(nrm, normalize(uLightDir));
    float lightShade = 0.70 + 0.46 * clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    col *= lightShade;
    col += uFillColor * 0.10;

    // フォグ
    float f = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
    col = mix(col, uFogColor, clamp(f, 0.0, 0.85));

    // 裏面は少し沈める（紙越しの色）
    if (back) col = mix(col * 0.86, vec3(0.9, 0.88, 0.84), 0.16);

    float a = cut * uOpacity;
    a *= smoothstep(0.0, 0.06, vUv.y);
    gl_FragColor = vec4(col, a);
  }
`;

export class CharacterCutout {
  constructor(def, textureLoader) {
    this.def = def;
    this.loader = textureLoader;
    this.textures = new Map();
    this.currentPose = null;

    this.group = new THREE.Group();
    this.group.name = `chara_${def.id}`;

    const geo = new THREE.PlaneGeometry(1, 1, 8, 14);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uAccent: { value: new THREE.Color(def.accent) },
        uFogColor: { value: new THREE.Color('#0b0d10') },
        uFogDensity: { value: 0.06 },
        uTime: { value: 0 },
        uStyle: { value: 0 },
        uHighlight: { value: 0 },
        uOpacity: { value: 1 },
        uReveal: { value: 1 },
        uTexel: { value: new THREE.Vector2(1 / 480, 1 / 1200) },
        uLightDir: { value: new THREE.Vector3(0.86, 0.34, -0.24).normalize() },
        uFillColor: { value: new THREE.Color('#ffd9b0') },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.userData.characterId = def.id;
    this.height = H_METERS * def.scale;
    this.mesh.scale.set(this.height * ASPECT, this.height, 1);
    this.group.add(this.mesh);

    // 接地影
    const shadowTex = new THREE.CanvasTexture(makeShadowCanvas());
    shadowTex.colorSpace = THREE.SRGBColorSpace;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false, color: 0x000000 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(this.height * 0.56, this.height * 0.34, 1);
    this.shadow.position.y = 0.008;
    this.group.add(this.shadow);

    // 足元のアクセントリング
    const ringGeo = new THREE.RingGeometry(this.height * 0.24, this.height * 0.25, 48);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.group.add(this.ring);

    // 名札
    const tagTex = nameTagTexture(def.name, def.kana, def.accent);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, opacity: 0.0, depthWrite: false }));
    this.tag.scale.set(this.height * 0.56, this.height * 0.14, 1);
    this.tag.position.y = this.height + 0.16;
    this.group.add(this.tag);

    // クリック判定用（見た目の板より少し細い透明板）
    this.hit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).scale(this.height * 0.34, this.height * 0.94, 1));
    this.hit.position.y = this.height * 0.47;
    this.hit.visible = false;
    this.hit.userData.characterId = def.id;
    this.group.add(this.hit);

    this.targetPos = new THREE.Vector3();
    this.targetRy = 0;
    this.visibleTarget = 0;
    this.seed = Math.random();
    this.loading = new Map();
    this._q = new THREE.Quaternion();
    this._roll = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 0, 1);
  }

  async ensurePose(key) {
    const file = this.def.poses[key] || this.def.poses[this.def.defaultPose];
    if (!file) return null;
    if (this.textures.has(file)) return this.textures.get(file);
    if (this.loading.has(file)) return this.loading.get(file);

    const p = new Promise((resolve) => {
      this.loader.load(
        `${BASE_URL}${file}.png`,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 16;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          this.textures.set(file, tex);
          resolve(tex);
        },
        undefined,
        () => resolve(null)
      );
    });
    this.loading.set(file, p);
    return p;
  }

  async setPose(key, { instant = false } = {}) {
    if (this.currentPose === key) return;
    const tex = await this.ensurePose(key);
    if (!tex) return;
    this.currentPose = key;
    if (instant) {
      this.material.uniforms.uMap.value = tex;
      return;
    }
    // 紙をめくるように差し替える
    this.flip = 0.0001;
    this.pendingTex = tex;
  }

  place(spot, { instant = false } = {}) {
    const s = typeof spot === 'string' ? SPOTS[spot] : spot;
    if (!s) return;
    this.targetPos.set(s.x, 0, s.z);
    this.targetRy = THREE.MathUtils.degToRad(s.ry ?? 180);
    if (instant) {
      this.group.position.copy(this.targetPos);
      this.group.rotation.y = this.targetRy;
    }
  }

  update(dt, t, { fogColor, fogDensity, style }) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uStyle.value = style;
    if (fogColor) u.uFogColor.value.copy(fogColor);
    if (fogDensity !== undefined) u.uFogDensity.value = fogDensity;

    // 位置と向きの補間
    const k = 1 - Math.exp(-dt * 4.5);
    this.group.position.lerp(this.targetPos, k);
    let d = this.targetRy - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * k;

    // 出現／退場
    const visK = 1 - Math.exp(-dt * 6);
    this.visibleTarget = this.visibleTarget || 0;
    this.opacityNow = THREE.MathUtils.lerp(this.opacityNow ?? 0, this.visibleTarget, visK);
    u.uOpacity.value = this.opacityNow;
    this.group.visible = this.opacityNow > 0.01;
    this.tag.material.opacity = Math.max(0, (this.opacityNow - 0.6) / 0.4) * 0.9;
    this.ring.material.opacity = 0.28 * this.opacityNow;
    this.shadow.material.opacity = 0.5 * this.opacityNow;

    // 紙めくり
    if (this.flip) {
      this.flip = Math.min(1, this.flip + dt * 5.2);
      const s = Math.abs(Math.cos(this.flip * Math.PI));
      this.mesh.scale.x = this.height * ASPECT * Math.max(0.06, s);
      if (this.flip > 0.5 && this.pendingTex) {
        u.uMap.value = this.pendingTex;
        this.pendingTex = null;
      }
      if (this.flip >= 1) {
        this.flip = 0;
        this.mesh.scale.x = this.height * ASPECT;
      }
    }

    // 名札はカメラに正対しつつ、板の向きに合わせて左右に寄る
    if (this.tag.material.opacity > 0.01) {
      this.tag.position.y = this.height + 0.16 + Math.sin(t * 1.2 + this.seed * 6.28) * 0.012;
    }
  }
}

function makeShadowCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(64, 64, 62, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export class Cast {
  constructor(scene, { onProgress } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'cast';
    scene.add(this.group);
    this.loader = new THREE.TextureLoader();
    this.onProgress = onProgress;
    this.items = new Map();
    this.active = [];
    this.style = 0;

    for (const def of Object.values(CHARACTERS)) {
      const c = new CharacterCutout(def, this.loader);
      this.items.set(def.id, c);
      this.group.add(c.group);
    }
    this.preload();
  }

  async preload() {
    const all = [];
    for (const c of this.items.values()) {
      for (const key of Object.keys(c.def.poses)) all.push(c.setPose(key, { instant: true }));
    }
    let done = 0;
    for (const p of all) {
      p.then(() => {
        done++;
        if (this.onProgress) this.onProgress(done, all.length);
      }).catch(() => {});
    }
    await Promise.allSettled(all);
    // 初期ポーズ（めくり途中の残りを消してから確定）
    for (const c of this.items.values()) {
      c.flip = 0;
      c.pendingTex = null;
      c.mesh.scale.x = c.height * ASPECT;
      c.currentPose = null;
      c.setPose(c.def.defaultPose, { instant: true });
    }
  }

  show(list = []) {
    const wanted = new Set();
    for (const entry of list) {
      const c = this.items.get(entry.id);
      if (!c) continue;
      wanted.add(entry.id);
      c.visibleTarget = 1;
      if (entry.pose) c.setPose(entry.pose);
      const base = typeof entry.spot === 'string' ? SPOTS[entry.spot] : entry.spot;
      const spot = base ? { ...base, ry: entry.ry ?? base.ry } : { x: 0.13, z: -0.55, ry: 180 };
      c.place(spot);
    }
    for (const [id, c] of this.items) {
      if (!wanted.has(id)) c.visibleTarget = 0;
    }
    this.active = [...wanted].map((id) => this.items.get(id));
  }

  setPose(id, pose) {
    const c = this.items.get(id);
    if (c) c.setPose(pose);
  }

  highlight(id) {
    for (const [cid, c] of this.items) {
      c.material.uniforms.uHighlight.value = cid === id ? 1 : 0;
    }
  }

  update(dt, t, ctx) {
    for (const c of this.items.values()) c.update(dt, t, { ...ctx, style: this.style });
  }

  pick(raycaster) {
    const objs = this.active.filter((c) => c.group.visible).map((c) => c.mesh);
    const hits = raycaster.intersectObjects(objs, false);
    return hits.length ? this.items.get(hits[0].object.userData.characterId) : null;
  }
}
