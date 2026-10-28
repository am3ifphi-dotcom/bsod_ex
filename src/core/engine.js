import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * SignalShader — the single "look" pass of the game.
 * Everything that corrupts the image (glitch, chroma, warp, grain, CRT, fade)
 * goes through here so that the film feels like one continuous signal.
 */
const SignalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGlitch: { value: 0 },       // 0..1 block corruption
    uAberr: { value: 0 },        // chromatic aberration
    uWarp: { value: 0 },         // barrel / lens warp
    uGrain: { value: 0.022 },
    uVignette: { value: 0.42 },
    uScan: { value: 0.06 },
    uSaturation: { value: 1.0 },
    uFade: { value: 0 },         // 0..1 black
    uFlash: { value: 0 },        // 0..1 white
    uTint: { value: new THREE.Color(1, 1, 1) },
    uBend: { value: 0 },         // vertical bend (screen being pulled)
    uRoll: { value: 0 },         // rolling scanline
    uPixel: { value: 0 },        // pixelation amount
    uDirt: { value: 0.0 },       // dark organic smear
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uGlitch, uAberr, uWarp, uGrain, uVignette, uScan, uSaturation;
    uniform float uFade, uFlash, uBend, uRoll, uPixel, uDirt;
    uniform vec3 uTint;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),
                 mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);
    }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;

      // --- lens warp -------------------------------------------------
      float r2 = dot(c,c);
      uv += c * r2 * uWarp * 0.55;

      // --- vertical bend: the screen is being physically pulled ------
      uv.y += sin(uv.x * 3.14159) * uBend * 0.06;
      uv.x += sin(uv.y * 3.14159) * uBend * 0.02;

      // --- block glitch ---------------------------------------------
      if (uGlitch > 0.001) {
        float rows = 34.0 + 60.0 * hash(vec2(floor(uTime*7.0),1.0));
        float row = floor(uv.y * rows);
        float seed = hash(vec2(row, floor(uTime*18.0)));
        float amt = step(1.0 - uGlitch*0.42, seed);
        uv.x += (hash(vec2(row, floor(uTime*11.0)))-0.5) * amt * uGlitch * 0.075;
        // vertical tearing chunks
        vec2 cell = floor(uv * vec2(9.0, 26.0));
        float hs = hash(cell + floor(uTime*9.0));
        uv += (vec2(hs, hash(cell.yx)) - 0.5) * step(0.9 - uGlitch*0.22, hs) * uGlitch * 0.018;
      }

      // --- rolling bar ----------------------------------------------
      float roll = smoothstep(0.0, 0.12, abs(fract(uv.y + uTime*0.07) - 0.5));
      uv.y += (1.0-roll) * uRoll * 0.01;

      // --- pixelation -----------------------------------------------
      if (uPixel > 0.001){
        vec2 px = uRes * mix(1.0, 0.055, clamp(uPixel,0.0,1.0));
        uv = (floor(uv*px)+0.5)/px;
      }

      // --- chromatic aberration -------------------------------------
      float ab = uAberr * (0.0010 + r2*0.0022);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ab, ab*0.35)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ab, ab*0.35)).b;

      // --- organic dark smear (the thing behind the screen) ----------
      if (uDirt > 0.001){
        float n = noise(uv*7.0 + vec2(0.0, uTime*0.15));
        n = smoothstep(0.45, 0.95, n);
        col *= 1.0 - n * uDirt * 0.85;
      }

      // --- scanlines + aperture grille ------------------------------
      float scan = sin(uv.y * uRes.y * 1.15) * 0.5 + 0.5;
      col *= 1.0 - uScan * scan;
      col *= 1.0 - uScan * 0.35 * (sin(uv.x * uRes.x * 1.7)*0.5+0.5);

      // --- grade ---------------------------------------------------
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSaturation);
      col *= uTint;

      // --- vignette ------------------------------------------------
      float vig = smoothstep(0.95, 0.22, length(c) * 1.18);
      col *= mix(1.0, vig, uVignette);

      // --- grain ---------------------------------------------------
      float g = hash(uv * uRes + fract(uTime)*133.0) - 0.5;
      col += g * uGrain * (1.0 - l*0.55);

      // --- flash / fade --------------------------------------------
      col = mix(col, vec3(1.0), clamp(uFlash,0.0,1.0));
      col *= (1.0 - clamp(uFade,0.0,1.0));

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.resScale = 1;
    this.quality = 'auto';
    this._frameTimes = [];
    this._lastQualityCheck = 0;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.basePixelRatio);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.7, 0.86);
    this.composer.addPass(this.bloom);
    this.signal = new ShaderPass(SignalShader);
    this.composer.addPass(this.signal);
    this.composer.addPass(new OutputPass());

    this.u = this.signal.uniforms;
    this.time = 0;
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this.autoQuality = true;
    this.maxDpr = 1.75;
  }

  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this._applyFog(scene);
    // nothing that casts a shadow moves in these worlds, so the shadow maps are
    // rendered once per scene instead of every frame (a huge, invisible saving)
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Re-render shadow maps once (after a light or a shadow caster changes). */
  markShadowsDirty() {
    this.renderer.shadowMap.needsUpdate = true;
  }

  _applyFog(scene) {
    // bloom threshold per-scene
    this.bloom.strength = scene.userData.bloom ?? 0.62;
    this.bloom.radius = scene.userData.bloomRadius ?? 0.72;
    this.bloom.threshold = scene.userData.bloomThreshold ?? 0.86;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w; this.height = h;
    const dpr = Math.max(0.6, this.basePixelRatio * this.resScale);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.u.uRes.value.set(w * dpr, h * dpr);
    if (this.camera && this.camera.isPerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.dpr = dpr;
  }

  setQuality(q) {
    this.quality = q;
    if (q === 'high') { this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2); this.resScale = 1; this.autoQuality = false; this.maxDpr = 2; }
    else if (q === 'low') { this.basePixelRatio = 1; this.resScale = 0.8; this.autoQuality = false; this.maxDpr = 1; }
    else { this.autoQuality = true; this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 1.75); this.resScale = 1; this.maxDpr = 1.75; }
    this._resize();
  }

  _adaptive(dt) {
    if (!this.autoQuality) return;
    this._frameTimes.push(dt);
    if (this._frameTimes.length > 90) this._frameTimes.shift();
    if (this._frameTimes.length < 60) return;
    const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
    if (avg > 1 / 42 && this.resScale > 0.62) {
      this.resScale = Math.max(0.62, this.resScale - 0.08);
      this.basePixelRatio = Math.max(0.8, Math.min(this.basePixelRatio, 1.3));
      this._resize();
      this._frameTimes.length = 0;
    } else if (avg < 1 / 58 && this.resScale < 1) {
      this.resScale = Math.min(1, this.resScale + 0.05);
      this._resize();
      this._frameTimes.length = 0;
    }
  }

  render(dt) {
    this.time += dt;
    this.u.uTime.value = this.time;
    this._adaptive(dt);
    this.composer.render(dt);
  }

  /** Convenience setters used by cinematics */
  set fx(v) { Object.assign(this.u, v); }
  flash(v) { this.u.uFlash.value = v; }
  fade(v) { this.u.uFade.value = v; }
}

export { SignalShader };
