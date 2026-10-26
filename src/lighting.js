/**
 * 時間の変化 — 昼 / 夕焼け / 夜 の照明プリセットと、そのなめらかな切り替え
 */
import * as THREE from 'three';
import { buildLightShafts } from './room.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

export const PRESETS = {
  day: {
    label: '昼',
    hint: '六月の、よく晴れた午後。',
    fogColor: 0xc9d5d2,
    fogNear: 9,
    fogFar: 46,
    hemiSky: 0xd6e6f2,
    hemiGround: 0x9a8154,
    hemiIntensity: 1.15,
    sunColor: 0xfff3d6,
    sunIntensity: 3.4,
    sunDir: V(-0.62, -0.62, 0.22),
    ambientColor: 0x5c6c78,
    ambientIntensity: 0.5,
    shaftIntensity: 1.0,
    shaftColor: 0xfff0cf,
    lampEmissive: 0.0,
    lampLight: 0.0,
    corridorLight: 0.55,
    corridorWindow: 0xdfeaf0,
    exposure: 1.0,
    backdrop: 'day',
    dustOpacity: 0.5,
    dustColor: 0xfff2d8,
  },
  dusk: {
    label: '夕焼け',
    hint: 'チャイムのあと、誰も帰らない教室。',
    fogColor: 0x8a6a5c,
    fogNear: 7,
    fogFar: 40,
    hemiSky: 0xe2996a,
    hemiGround: 0x6a4a38,
    hemiIntensity: 0.62,
    sunColor: 0xff9a4a,
    sunIntensity: 3.9,
    sunDir: V(-0.78, -0.26, 0.3),
    ambientColor: 0x6a4a48,
    ambientIntensity: 0.42,
    shaftIntensity: 1.35,
    shaftColor: 0xff9d52,
    lampEmissive: 0.0,
    lampLight: 0.0,
    corridorLight: 0.32,
    corridorWindow: 0xe8a778,
    exposure: 1.06,
    backdrop: 'dusk',
    dustOpacity: 0.85,
    dustColor: 0xffc489,
  },
  night: {
    label: '夜',
    hint: '蛍光灯だけが、うなっている。',
    fogColor: 0x1b1a20,
    fogNear: 4,
    fogFar: 26,
    hemiSky: 0x35405c,
    hemiGround: 0x1a1814,
    hemiIntensity: 0.3,
    sunColor: 0x8fb0e8,
    sunIntensity: 0.5,
    sunDir: V(-0.5, -0.5, -0.28),
    ambientColor: 0x2a3244,
    ambientIntensity: 0.55,
    shaftIntensity: 0.35,
    shaftColor: 0x9fc0ff,
    lampEmissive: 2.4,
    lampLight: 2.1,
    corridorLight: 0.18,
    corridorWindow: 0x2c3a52,
    exposure: 1.14,
    backdrop: 'night',
    dustOpacity: 0.4,
    dustColor: 0xfff0d0,
  },
};

export const MODE_ORDER = ['day', 'dusk', 'night'];

const lerp = (a, b, t) => a + (b - a) * t;
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class TimeOfDay {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} refs room.js が返す refs
   * @param {object} dust DustField
   */
  constructor(scene, renderer, refs, dust) {
    this.scene = scene;
    this.renderer = renderer;
    this.refs = refs;
    this.dust = dust;
    this.mode = 'day';
    this.t = 1; // 遷移の進行（1で完了）
    this.from = { ...PRESETS.day };
    this.to = { ...PRESETS.day };
    this.flicker = 0;

    scene.fog = new THREE.Fog(PRESETS.day.fogColor, PRESETS.day.fogNear, PRESETS.day.fogFar);

    this.hemi = new THREE.HemisphereLight(0xd6e6f2, 0x9a8154, 1.15);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x5c6c78, 0.5);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff3d6, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -7.5;
    this.sun.shadow.camera.right = 7.5;
    this.sun.shadow.camera.top = 7.5;
    this.sun.shadow.camera.bottom = -7.5;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 42;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.022;
    this.sun.shadow.radius = 2.2;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.sun.target.position.set(-1.5, 0.6, 0.5);

    // 窓からの反射光（弱い塗り光）
    this.bounce = new THREE.DirectionalLight(0xffe8c8, 0.35);
    this.bounce.position.set(6, 2.2, 0);
    scene.add(this.bounce);

    /* ---- 光の柱：プリセットぶん用意して opacity でクロスフェード ---- */
    this.shafts = {};
    for (const name of MODE_ORDER) {
      const p = PRESETS[name];
      const g = buildLightShafts(refs.windows, p.sunDir, p.shaftIntensity, p.shaftColor);
      g.visible = name === 'day';
      g.traverse((o) => {
        if (o.isMesh) o.material.opacity = name === 'day' ? 1 : 0;
      });
      refs.shaftGroup.add(g);
      this.shafts[name] = g;
    }

    /* ---- 背景（空）：3枚をクロスフェード ---- */
    this.backdrops = {};
    this._bdMats = {};
    const base = refs.backdropMesh;
    for (const name of MODE_ORDER) {
      const mat = refs.backdropMats[name].clone();
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = name === 'day' ? 1 : 0;
      this._bdMats[name] = mat;
      if (name === 'day') {
        base.material = mat;
        this.backdrops[name] = base;
      } else {
        const m = base.clone();
        m.material = mat;
        m.position.x -= 0.09 * (name === 'dusk' ? 1 : 2);
        base.parent.add(m);
        this.backdrops[name] = m;
      }
    }

    scene.background = new THREE.Color(PRESETS.day.fogColor);
    this.apply('day', true);
  }

  set(mode, instant = false) {
    if (!PRESETS[mode]) return;
    this.from = this._snapshot();
    this.to = PRESETS[mode];
    this.mode = mode;
    this.t = instant ? 1 : 0;
    if (instant) this.apply(mode, true);
  }

  cycle() {
    const i = MODE_ORDER.indexOf(this.mode);
    const next = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    this.set(next);
    return next;
  }

  /** 現在の見た目をプリセット形式で取り出す（遷移の起点にする） */
  _snapshot() {
    const s = {};
    s.fogColor = this.scene.fog.color.getHex();
    s.fogNear = this.scene.fog.near;
    s.fogFar = this.scene.fog.far;
    s.hemiSky = this.hemi.color.getHex();
    s.hemiGround = this.hemi.groundColor.getHex();
    s.hemiIntensity = this.hemi.intensity;
    s.sunColor = this.sun.color.getHex();
    s.sunIntensity = this.sun.intensity;
    s.sunDir = this.sun.position.clone().normalize().multiplyScalar(-1);
    s.ambientColor = this.ambient.color.getHex();
    s.ambientIntensity = this.ambient.intensity;
    s.shaftIntensity = this.to.shaftIntensity;
    s.shaftColor = this.to.shaftColor;
    s.lampEmissive = this.refs.lamps.length ? this.refs.lamps[0].emissiveIntensity : 0;
    s.lampLight = this.refs.lampLights.length ? this.refs.lampLights[0].intensity : 0;
    s.corridorLight = this.refs.corridorLight.intensity;
    s.corridorWindow = this.refs.corridorWindow.material.color.getHex();
    s.exposure = this.renderer.toneMappingExposure;
    s.backdrop = this.mode;
    s.dustOpacity = this.dust.material.opacity;
    s.dustColor = this.dust.material.color.getHex();
    return s;
  }

  update(dt) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / 1.8);
      this._blend(smootherstep(this.t));
    }
    // 夕暮れは1本だけ蛍光灯がチカつく（消灯中なので昼は無し）
    if (this.mode === 'night' && this.t >= 1) {
      this.flicker += dt;
      const f = 1 + Math.sin(this.flicker * 41) * 0.02 + (Math.random() < 0.004 ? -0.55 : 0);
      for (let i = 0; i < this.refs.lampLights.length; i++) {
        const base = lerp(this.from.lampLight, this.to.lampLight, smootherstep(this.t));
        this.refs.lampLights[i].intensity = base * (i === 1 ? f : 1);
      }
    }
  }

  _blend(k) {
    const a = this.from;
    const b = this.to;
    const c = (ca, cb) => new THREE.Color(ca).lerp(new THREE.Color(cb), k);

    this.scene.fog.color.copy(c(a.fogColor, b.fogColor));
    if (this.scene.background) this.scene.background.copy(this.scene.fog.color);
    this.scene.fog.near = lerp(a.fogNear, b.fogNear, k);
    this.scene.fog.far = lerp(a.fogFar, b.fogFar, k);
    this.hemi.color.copy(c(a.hemiSky, b.hemiSky));
    this.hemi.groundColor.copy(c(a.hemiGround, b.hemiGround));
    this.hemi.intensity = lerp(a.hemiIntensity, b.hemiIntensity, k);

    this.ambient.color.copy(c(a.ambientColor, b.ambientColor));
    this.ambient.intensity = lerp(a.ambientIntensity, b.ambientIntensity, k);

    this.sun.color.copy(c(a.sunColor, b.sunColor));
    this.sun.intensity = lerp(a.sunIntensity, b.sunIntensity, k);
    const dir = a.sunDir.clone().lerp(b.sunDir, k).normalize();
    this.sun.position.copy(dir).multiplyScalar(-24);
    this.sun.shadow.camera.updateProjectionMatrix();

    this.bounce.intensity = lerp(a.hemiIntensity, b.hemiIntensity, k) * 0.32;
    this.bounce.color.copy(c(a.sunColor, b.sunColor));

    this.renderer.toneMappingExposure = lerp(a.exposure, b.exposure, k);

    // 蛍光灯
    const lampE = lerp(a.lampEmissive, b.lampEmissive, k);
    for (const m of this.refs.lamps) m.emissiveIntensity = lampE;
    const lampI = lerp(a.lampLight, b.lampLight, k);
    for (const l of this.refs.lampLights) l.intensity = lampI;

    // 廊下
    this.refs.corridorLight.intensity = lerp(a.corridorLight, b.corridorLight, k);
    this.refs.corridorWindow.material.color.copy(c(a.corridorWindow, b.corridorWindow));

    // 光の柱・空・ちりのクロスフェード
    for (const name of MODE_ORDER) {
      const target = name === b.backdrop ? 1 : 0;
      const g = this.shafts[name];
      g.visible = true;
      g.traverse((o) => {
        if (o.isMesh) o.material.opacity = lerp(o.material.opacity, target, Math.min(1, k * 1.4));
      });
      const bd = this._bdMats[name];
      bd.opacity = lerp(bd.opacity, target, Math.min(1, k * 1.4));
    }
    if (this.dust) {
      this.dust.material.opacity = lerp(a.dustOpacity, b.dustOpacity, k);
      this.dust.material.color.copy(c(a.dustColor, b.dustColor));
    }
  }

  apply(mode, instant) {
    const p = PRESETS[mode];
    this.to = p;
    this.from = p;
    this.t = 1;
    this._blend(1);
    for (const name of MODE_ORDER) {
      const on = name === mode;
      this.shafts[name].visible = on;
      this.shafts[name].traverse((o) => {
        if (o.isMesh) o.material.opacity = 1;
      });
      this._bdMats[name].opacity = on ? 1 : 0;
      this.backdrops[name].visible = true;
    }
    this.scene.background = new THREE.Color(p.fogColor);
  }
}
