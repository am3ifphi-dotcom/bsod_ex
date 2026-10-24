import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, damp } from './util';

/* ------------------------------------------------------------------ *
 * 被写界深度 (深度バッファを使う軽量なポスト)
 *  - ピント距離 f、錯乱円は深度差から計算
 *  - 13 タップのゴールデンアングル・スパイラル
 * ------------------------------------------------------------------ */
const DofShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 800 },
    focus: { value: 4 },
    aperture: { value: 0.6 },
    maxBlur: { value: 6 },
    enabled: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float focus;
    uniform float aperture;
    uniform float maxBlur;
    uniform float enabled;
    varying vec2 vUv;

    float linearDepth(vec2 uv){
      float z = texture2D(tDepth, uv).x;
      float ndc = z * 2.0 - 1.0;
      return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - ndc * (cameraFar - cameraNear));
    }
    float coc(vec2 uv){
      float d = linearDepth(uv);
      float c = abs(d - focus) / max(d, 0.001) * aperture;
      return clamp(c, 0.0, 1.0) * maxBlur;
    }
    void main(){
      if (enabled < 0.5) { gl_FragColor = texture2D(tColor, vUv); return; }
      vec4 center = texture2D(tColor, vUv);
      float r = coc(vUv);
      if (r < 0.35) { gl_FragColor = center; return; }
      vec2 texel = 1.0 / resolution;
      vec4 sum = center;
      float wsum = 1.0;
      const int SAMPLES = 12;
      float ang = 0.0;
      float radius = 1.0;
      for (int i = 0; i < SAMPLES; i++){
        ang += 2.39996323;
        radius = sqrt(float(i) + 0.5) / sqrt(float(SAMPLES));
        vec2 off = vec2(cos(ang), sin(ang)) * radius * r * texel * 2.2;
        vec2 uv = clamp(vUv + off, vec2(0.001), vec2(0.999));
        float sd = coc(uv);
        float w = smoothstep(0.0, 1.0, sd * 1.4);
        sum += texture2D(tColor, uv) * w;
        wsum += w;
      }
      gl_FragColor = sum / wsum;
    }
  `,
};

class DofPass extends Pass {
  material: THREE.ShaderMaterial;
  fsQuad: FullScreenQuad;
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(DofShader.uniforms) as typeof DofShader.uniforms,
      vertexShader: DofShader.vertexShader,
      fragmentShader: DofShader.fragmentShader,
      depthTest: false, depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material as unknown as THREE.Material);
    this.needsSwap = true;
  }
  setSize(w: number, h: number) {
    this.material.uniforms.resolution.value.set(w, h);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture ?? null;
    if (!readBuffer.depthTexture) { u.enabled.value = 0; } else if (u.enabled.value === 0 && u.tDepth.value) { u.enabled.value = 1; }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

/* ------------------------------------------------------------------ *
 * 最終カラーグレード + グリッチ + フィルムグレイン
 * ------------------------------------------------------------------ */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },        // 0..1
    uGrain: { value: 0.05 },
    uVignette: { value: 0.45 },
    uChroma: { value: 0.002 },
    uScan: { value: 0.06 },
    uFade: { value: 1 },          // 1 = 通常, 0 = 黒
    uTint: { value: new THREE.Color(1, 1, 1) },
    uDistort: { value: 0.0 },
    uBlock: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uShake: { value: 0 },
    uWarp: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0.05, 0.35, 0.75) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uGlitch, uGrain, uVignette, uChroma, uScan, uFade, uDistort, uBlock, uShake, uWarp;
    uniform float uFlash;
    uniform vec3 uTint, uFlashColor;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      // レンズの歪み (弱い樽型)
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      uv = 0.5 + c * (1.0 + uDistort * r2 * 1.6);

      // 空間そのものが画面へ引き込まれる歪み
      if (uWarp > 0.001){
        float w = uWarp * 0.35;
        uv += vec2(sin(uv.y * 22.0 + uTime * 3.0), cos(uv.x * 19.0 - uTime * 2.3)) * w * 0.02;
        uv = 0.5 + (uv - 0.5) * (1.0 - uWarp * 0.25 * smoothstep(0.2, 0.5, length(c)));
      }

      // ブロック単位の水平ずれ
      if (uBlock > 0.001){
        float rows = 24.0 + 60.0 * uGlitch;
        float row = floor(uv.y * rows);
        float rnd = hash(vec2(row, floor(uTime * 14.0)));
        float shift = step(1.0 - uBlock * 0.55, rnd) * (hash(vec2(row, 3.7)) - 0.5) * 0.09 * uBlock;
        uv.x += shift;
      }
      // 画面全体の微振動
      uv += vec2(sin(uTime * 51.0), cos(uTime * 43.0)) * uShake * 0.0018;

      // 色収差 (グリッチ時のみ強める)
      float ca = (uChroma + uGlitch * 0.006) * (1.0 + uDistort * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

      // 走査線
      float scan = 1.0 - uScan * (0.5 + 0.5 * sin(uv.y * uResolution.y * 1.6 + uTime * 4.0));
      col *= scan;

      // グリッチバンド
      if (uGlitch > 0.001){
        float band = step(0.985, hash(vec2(floor(uv.y * 140.0), floor(uTime * 8.0))));
        col += band * uGlitch * 0.35 * vec3(0.65, 0.85, 1.0);
        // レベルシフト
        col = mix(col, floor(col * 12.0) / 12.0, uGlitch * 0.35);
      }

      col *= uTint;

      // ビネット
      float v = smoothstep(0.9, 0.25, length(c) * 1.25);
      col *= mix(1.0, v, uVignette);

      // フィルムグレイン (明部を避ける)
      float g = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.4, 1.0, dot(col, vec3(0.33))));

      // 画面が青い光に満たされる (画面の内側への移行)
      col += uFlashColor * uFlash * (0.9 + 0.1 * sin(uTime * 40.0));

      col *= uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/* ------------------------------------------------------------------ */
export type QualityPreset = 'low' | 'medium' | 'high' | 'epic';
export type FXParams = {
  glitch: number;       // 0..1 (強度設定でスケール済み)
  grain: number;
  vignette: number;
  chroma: number;
  scan: number;
  fade: number;
  tint: THREE.Color;
  distort: number;
  block: number;
  shake: number;
  warp: number;
  flash: number;
  flashColor: THREE.Color;
  focus: number;
  aperture: number;
  dofEnabled: boolean;
  bloom: number;
  exposure: number;
};

export class PostFX {
  composer: EffectComposer;
  renderPass: RenderPass;
  dof: DofPass;
  gtao: GTAOPass;
  bloom: UnrealBloomPass;
  final: ShaderPass;
  output: OutputPass;
  private rt: THREE.WebGLRenderTarget;
  quality: QualityPreset = 'high';
  private scale = 1;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset = 'high') {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    const depth = new THREE.DepthTexture(size.x, size.y);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.rt.depthTexture = depth;

    this.composer = new EffectComposer(renderer, this.rt);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.dof = new DofPass();
    this.composer.addPass(this.dof);

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.enabled = false;
    this.gtao.blendIntensity = 0.85;
    const ao = (this.gtao as unknown as { updateGtaoMaterial: (p: Record<string, number>) => void });
    try {
      ao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.1, thickness: 1.0, scale: 1.0, samples: 12 });
    } catch { /* バージョン差異は無視 */ }
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.75, 0.62);
    this.composer.addPass(this.bloom);

    this.final = new ShaderPass({
      uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms) as typeof FinalShader.uniforms,
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
    });
    this.composer.addPass(this.final);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.setQuality(quality);
  }

  setCamera(camera: THREE.Camera) {
    this.renderPass.camera = camera;
    this.gtao.camera = camera;
  }

  setQuality(q: QualityPreset) {
    this.quality = q;
    this.gtao.enabled = q === 'high' || q === 'epic';
    this.bloom.enabled = q !== 'low';
    this.dof.material.uniforms.enabled.value = q === 'low' ? 0 : 1;
    this.bloom.strength = q === 'epic' ? 0.7 : q === 'high' ? 0.55 : 0.4;
    this.bloom.resolution.set(1, 1);
    this.renderer.shadowMap.enabled = q !== 'low';
  }

  /** CSS ピクセルサイズで受け取り、内部は devicePixelRatio を考慮する */
  setSize(cssW: number, cssH: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(Math.max(2, cssW), Math.max(2, cssH));
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    this.dof.setSize(w, h);
    this.gtao.setSize(w, h);
    this.bloom.setSize(w, h);
    this.final.material.uniforms.uResolution.value.set(w, h);
  }

  /** 動的解像度: 0.55 .. 1.0 */
  setScale(s: number) {
    this.scale = clamp(s, 0.55, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * this.scale);
    this.setSize(window.innerWidth, window.innerHeight);
  }
  get resolutionScale() { return this.scale; }

  update(dt: number, p: Partial<FXParams>) {
    const u = this.final.material.uniforms;
    if (p.glitch !== undefined) u.uGlitch.value = damp(u.uGlitch.value, p.glitch, 8, dt);
    if (p.grain !== undefined) u.uGrain.value = p.grain;
    if (p.vignette !== undefined) u.uVignette.value = p.vignette;
    if (p.chroma !== undefined) u.uChroma.value = p.chroma;
    if (p.scan !== undefined) u.uScan.value = p.scan;
    if (p.fade !== undefined) u.uFade.value = p.fade;
    if (p.tint) u.uTint.value.copy(p.tint);
    if (p.distort !== undefined) u.uDistort.value = p.distort;
    if (p.block !== undefined) u.uBlock.value = p.block;
    if (p.shake !== undefined) u.uShake.value = p.shake;
    if (p.warp !== undefined) u.uWarp.value = p.warp;
    if (p.flash !== undefined) u.uFlash.value = p.flash;
    if (p.flashColor) u.uFlashColor.value.copy(p.flashColor);
    u.uTime.value += dt;
    if (p.focus !== undefined) this.dof.material.uniforms.focus.value = p.focus;
    if (p.aperture !== undefined) this.dof.material.uniforms.aperture.value = p.aperture;
    if (p.dofEnabled !== undefined) this.dof.material.uniforms.enabled.value = (p.dofEnabled && this.quality !== 'low') ? 1 : 0;
    if (p.bloom !== undefined) this.bloom.strength = p.bloom;
    if (p.exposure !== undefined) this.renderer.toneMappingExposure = p.exposure;
    const du = this.dof.material.uniforms;
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    if (cam && 'near' in cam) {
      du.cameraNear.value = cam.near;
      du.cameraFar.value = cam.far;
    }
  }

  render(dt: number) { this.composer.render(dt); }
}
