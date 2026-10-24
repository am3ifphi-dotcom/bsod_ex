/**
 * ポストプロセスチェーン
 * Render → SSAO → Bloom → DoF → Glitch(線形空間) → Output(ACES) → Display(グレイン/ビネット/走査線)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Engine } from '../core/engine';
import type { QualityParams } from '../core/settings';
import { clamp } from '../core/utils';

/** 線形空間グリッチ: 色ズレ / バンド破壊 / ブロックノイズ */
const GlitchShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uIntensity: { value: 0 }, // 0..1
    uTear: { value: 0 }, // 水平ティアリング
    uBlock: { value: 0 }, // ブロックノイズ
    uRGB: { value: 0 }, // 色分解
    uFlicker: { value: 0 }, // 微細明滅(低周波・安全)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uIntensity, uTear, uBlock, uRGB, uFlicker;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      float t = uTime;

      // 水平ティアリング(帯がずれる)
      float band = floor(uv.y * 28.0 + t * 3.0);
      float tear = (hash(vec2(band, floor(t * 7.0))) - 0.5) * uTear * 0.14 * step(0.62, hash(vec2(band, floor(t * 2.3))));
      uv.x += tear;

      // ブロックノイズ(矩形の画素ズレ)
      if (uBlock > 0.001) {
        vec2 cell = floor(uv * vec2(22.0, 14.0));
        float h = hash(cell + floor(t * 4.0));
        if (h > 1.0 - uBlock * 0.22) {
          uv += (vec2(hash(cell + 1.7), hash(cell + 3.1)) - 0.5) * 0.12 * uBlock;
        }
      }

      // 色分解
      float rOff = uRGB * 0.012 + uIntensity * 0.003;
      float r = texture2D(tDiffuse, uv + vec2(rOff, 0.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(rOff, 0.0)).b;
      vec3 col = vec3(r, g, b);

      // ノイズの粒
      float grain = hash(uv * vec2(1280.0, 720.0) + t) - 0.5;
      col += grain * uIntensity * 0.10;

      // 低周波の明滅(毎秒1回以下・振幅小 → 光過敏配慮)
      col *= 1.0 - uFlicker * 0.08 * (0.5 + 0.5 * sin(t * 1.6));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** 表示空間: グレイン / ビネット / 走査線 */
const DisplayShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.32 },
    uScanline: { value: 0.05 },
    uSaturation: { value: 1.0 },
    uFade: { value: 0.0 }, // 0=通常 1=黒
    uFadeColor: { value: new THREE.Color(0x000208) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uScanline, uSaturation, uFade;
    uniform vec3 uFadeColor;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // グレイン(フィルム)
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 61.7) - 0.5;
      col += g * uGrain;

      // 走査線(ごく薄く)
      col *= 1.0 - uScanline * (0.5 + 0.5 * sin(vUv.y * 900.0));

      // ビネット
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      col *= clamp(v, 0.0, 1.0);

      // 彩度
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);

      // フェード
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface GlitchParams {
  intensity: number; // 全体
  tear: number;
  block: number;
  rgb: number;
  flicker: number;
}

export class PostChain {
  composer: EffectComposer;
  private renderPass: RenderPass;
  private ssaoPass: SSAOPass | null = null;
  private bloomPass: UnrealBloomPass;
  private bokehPass: BokehPass | null = null;
  private glitchPass: ShaderPass;
  private outputPass: OutputPass;
  private displayPass: ShaderPass;

  /** DoF */
  focusDistance = 6;
  focusAperture = 0.00006;
  dofEnabled = true;

  glitch: GlitchParams = { intensity: 0, tear: 0, block: 0, rgb: 0, flicker: 0 };
  /** 画面上のフェード(暗転用) */
  fade = 0;
  fadeColor = new THREE.Color(0x000208);

  private engine: Engine;
  private w = 1;
  private h = 1;

  constructor(engine: Engine) {
    this.engine = engine;
    const { renderer, scene, camera } = engine;
    this.w = window.innerWidth;
    this.h = window.innerHeight;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(this.w, this.h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.34, 0.7, 0.82);
    this.composer.addPass(this.bloomPass);

    this.glitchPass = new ShaderPass(GlitchShader);
    this.composer.addPass(this.glitchPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.displayPass = new ShaderPass(DisplayShader);
    this.composer.addPass(this.displayPass);

    this.applyQuality(engine.quality);
  }

  applyQuality(q: QualityParams): void {
    // SSAO / DoF の入退場
    if (q.ssao && !this.ssaoPass) {
      const ssao = new SSAOPass(this.engine.scene, this.engine.camera, this.w, this.h);
      ssao.kernelRadius = 0.45;
      ssao.minDistance = 0.0012;
      ssao.maxDistance = 0.09;
      ssao.output = SSAOPass.OUTPUT.Default;
      // bloom の直前に入れる
      this.composer.insertPass(ssao, 1);
      this.ssaoPass = ssao;
    } else if (!q.ssao && this.ssaoPass) {
      this.composer.removePass(this.ssaoPass);
      this.ssaoPass.dispose();
      this.ssaoPass = null;
    }

    if (q.dof && !this.bokehPass) {
      const bokeh = new BokehPass(this.engine.scene, this.engine.camera, {
        focus: 6,
        aperture: 0.00006,
        maxblur: 0.006,
      });
      // glitch より手前
      const idx = Math.max(1, this.composer.passes.length - 3);
      this.composer.insertPass(bokeh, idx);
      this.bokehPass = bokeh;
    } else if (!q.dof && this.bokehPass) {
      this.composer.removePass(this.bokehPass);
      this.bokehPass = null;
    }
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.w = w;
    this.h = h;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.ssaoPass?.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  setBloom(strength: number, radius = 0.7, threshold = 0.82): void {
    this.bloomPass.strength = strength;
    this.bloomPass.radius = radius;
    this.bloomPass.threshold = threshold;
  }

  setDof(focusDistance: number, aperture: number, maxblur = 0.008): void {
    this.focusDistance = focusDistance;
    this.focusAperture = aperture;
    if (this.bokehPass) {
      const uniforms = this.bokehPass.materialBokeh.uniforms as Record<string, { value: number }>;
      uniforms['focus'].value = focusDistance;
      uniforms['aperture'].value = aperture;
      uniforms['maxblur'].value = maxblur;
    }
  }

  setGlitch(p: Partial<GlitchParams>): void {
    Object.assign(this.glitch, p);
    const u = this.glitchPass.uniforms;
    u.uIntensity.value = this.glitch.intensity;
    u.uTear.value = this.glitch.tear;
    u.uBlock.value = this.glitch.block;
    u.uRGB.value = this.glitch.rgb;
    u.uFlicker.value = this.glitch.flicker;
  }

  render(dt: number): void {
    const t = this.engine.clock.elapsedTime;
    this.glitchPass.uniforms.uTime.value = t;
    this.displayPass.uniforms.uTime.value = t;
    this.displayPass.uniforms.uFade.value = this.fade;
    (this.displayPass.uniforms.uFadeColor.value as THREE.Color).copy(this.fadeColor);

    if (this.bokehPass) {
      const uniforms = this.bokehPass.materialBokeh.uniforms as Record<string, { value: number }>;
      uniforms['focus'].value = THREE.MathUtils.damp(uniforms['focus'].value, this.focusDistance, 4, dt);
    }
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose?.();
  }
}

export { clamp };
