import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, damp } from './util';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

type Preset = {
  maxScale: number;
  minScale: number;
  dpr: number;
  ao: boolean;
  bloom: boolean;
  bloomStrength: number;
  shadow: number;
  grain: number;
};

export const PRESETS: Record<Quality, Preset> = {
  low: { maxScale: 0.72, minScale: 0.55, dpr: 0.9, ao: false, bloom: true, bloomStrength: 0.42, shadow: 512, grain: 0.022 },
  medium: { maxScale: 0.9, minScale: 0.62, dpr: 1.0, ao: true, bloom: true, bloomStrength: 0.5, shadow: 1024, grain: 0.02 },
  high: { maxScale: 1.0, minScale: 0.7, dpr: 1.25, ao: true, bloom: true, bloomStrength: 0.58, shadow: 1536, grain: 0.018 },
  ultra: { maxScale: 1.0, minScale: 0.8, dpr: 1.5, ao: true, bloom: true, bloomStrength: 0.62, shadow: 2048, grain: 0.016 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 400 },
    time: { value: 0 },
    focus: { value: 6 },
    focusRange: { value: 8 },
    dofStrength: { value: 0.0 },
    glitch: { value: 0 },
    chroma: { value: 1 },
    grain: { value: 0.03 },
    vignette: { value: 0.65 },
    scan: { value: 0.4 },
    flash: { value: 0 },
    flashColor: { value: new THREE.Color(0.55, 0.7, 1.0) },
    fade: { value: 0 },
    iris: { value: 0 },
    irisActive: { value: 0 },
    lensDistort: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float time;
    uniform float focus;
    uniform float focusRange;
    uniform float dofStrength;
    uniform float glitch;
    uniform float chroma;
    uniform float grain;
    uniform float vignette;
    uniform float scan;
    uniform float flash;
    uniform vec3 flashColor;
    uniform float fade;
    uniform float iris;
    uniform float irisActive;
    uniform float lensDistort;
    varying vec2 vUv;

    #include <packing>

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;

      // barrel-ish lens distortion, animated subtly during corruption
      if (lensDistort > 0.001) {
        vec2 c = uv - 0.5;
        float r2 = dot(c, c);
        uv = 0.5 + c * (1.0 + lensDistort * (0.35 + 1.4 * r2) * sin(time * 0.7) );
      }

      // block/tear corruption in screen space
      if (glitch > 0.001) {
        float bands = mix(70.0, 12.0, glitch);
        float band = floor(uv.y * bands + time * 4.0);
        float h = hash12(vec2(band, floor(time * 11.0)));
        float on = step(0.74 - glitch * 0.22, h);
        uv.x += (h - 0.5) * glitch * glitch * 0.11 * on;
        float tearLine = step(0.996 - glitch * 0.02, hash12(vec2(floor(uv.y * 190.0), floor(time * 9.0))));
        uv.x += tearLine * glitch * 0.06;
        uv.y += (hash12(vec2(floor(uv.x * 12.0), floor(time * 15.0))) - 0.5) * glitch * 0.004;
      }

      vec2 dir = uv - 0.5;
      float ca = (0.00035 + glitch * 0.0045) * chroma;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;

      // depth of field (12-tap golden spiral, driven by a physical-ish CoC)
      if (dofStrength > 0.002) {
        float depth = clamp(texture2D(tDepth, uv).x, 0.00001, 1.0);
        float viewZ = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
        float dist = clamp(-viewZ, 0.0, cameraFar);
        float coc = clamp(abs(dist - focus) / max(focusRange, 0.001), 0.0, 1.0);
        coc = pow(coc, 0.75) * dofStrength;
        if (coc > 0.015) {
          vec3 acc = col;
          float wsum = 1.0;
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 2.39996323;
            float r = sqrt(float(i) + 0.5) * 0.014 * coc;
            vec2 o = vec2(cos(a), sin(a)) * r;
            acc += texture2D(tDiffuse, uv + o).rgb;
            wsum += 1.0;
          }
          col = acc / wsum;
        }
      }

      // filmic grain + scanlines + rolling bar
      float scanline = sin(uv.y * resolution.y * 1.05 + time * 2.0) * 0.5 + 0.5;
      col *= 1.0 - scanline * 0.05 * scan;
      float roll = smoothstep(0.0, 0.06, abs(fract(uv.y - time * 0.045) - 0.5)) * 0.0;
      float g = hash12(uv * resolution.xy + fract(time) * 813.7);
      col += (g - 0.5) * grain * (1.0 + glitch * 1.5) * smoothstep(-0.2, 0.35, col.r + col.g + col.b);

      float vig = smoothstep(1.05, 0.28, length(dir * vec2(1.03, 1.0)));
      col *= mix(1.0, vig, vignette);

      // occasional channel swap
      float swap = step(0.93, hash12(vec2(floor(time * 6.0), 7.0))) * glitch;
      col = mix(col, col.gbr, swap * 0.22);

      // glitch bloom-ish leak
      col += flashColor * flash;
      col += vec3(0.05, 0.12, 0.35) * glitch * 0.05 * hash12(vec2(floor(uv.y * 40.0), floor(time * 20.0)));

      if (irisActive > 0.001) {
        float ir = length(dir * vec2(1.02, 1.0)) * 1.5;
        float mask = smoothstep(iris - 0.02, iris + 0.03, ir);
        col *= mix(1.0, mask, irisActive);
      }

      col *= (1.0 - fade);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Fx {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  gtao?: GTAOPass;
  bloom?: UnrealBloomPass;
  grade: ShaderPass;
  output: OutputPass;
  quality: Quality = 'medium';
  scale = 0.9;
  targetScale = 0.9;
  dynamic = true;
  private depthTexture: THREE.DepthTexture;
  private depthRT!: THREE.WebGLRenderTarget;
  private flashTimes: number[] = [];
  private depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
  dofActive = false;
  private frameAvg = 16.7;
  private adjustTimer = 0;
  glitch = 0;
  autoGlitch = 0;

  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.depthTexture.format = THREE.DepthFormat;
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: this.depthTexture, depthBuffer: true });

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.gtao = new GTAOPass(scene, camera, 1, 1);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 8 });
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.65, 0.82);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.tDepth.value = this.depthTexture;
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.setQuality('medium');
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q: Quality) {
    this.quality = q;
    const p = PRESETS[q];
    this.gtao!.enabled = p.ao;
    this.bloom!.enabled = p.bloom;
    this.bloom!.strength = p.bloomStrength;
    this.targetScale = p.maxScale;
    this.scale = p.maxScale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.dpr));
    this.renderer.shadowMap.enabled = true;
    this.composer.setPixelRatio(this.scale);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, PRESETS[this.quality].dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.scale * dpr);
    this.composer.setSize(w, h);
    this.depthRT.setSize(Math.max(2, Math.floor(w * 0.5 * dpr)), Math.max(2, Math.floor(h * 0.5 * dpr)));
    this.depthTexture.needsUpdate = true;
    this.grade.uniforms.resolution.value.set(w * this.scale * dpr, h * this.scale * dpr);
    this.grade.uniforms.cameraNear.value = 0.05;
    this.grade.uniforms.cameraFar.value = 500;
  }

  update(dt: number, time: number) {
    const target = this.dynamic ? this.targetScale : PRESETS[this.quality].maxScale;
    if (Math.abs(this.scale - target) > 0.004) {
      this.scale = damp(this.scale, target, 4, dt);
      this.composer.setPixelRatio(this.scale * Math.min(window.devicePixelRatio || 1, PRESETS[this.quality].dpr));
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.grade.uniforms.resolution.value.set(
        window.innerWidth * this.scale * Math.min(window.devicePixelRatio || 1, PRESETS[this.quality].dpr),
        window.innerHeight * this.scale * Math.min(window.devicePixelRatio || 1, PRESETS[this.quality].dpr),
      );
    }
    this.frameAvg = this.frameAvg * 0.94 + dt * 1000 * 0.06;
    this.adjustTimer += dt;
    if (this.adjustTimer > 0.9 && this.dynamic) {
      this.adjustTimer = 0;
      const preset = PRESETS[this.quality];
      if (this.frameAvg > 19.5) this.targetScale = clamp(this.targetScale - 0.06, preset.minScale, preset.maxScale);
      else if (this.frameAvg < 14.5) this.targetScale = clamp(this.targetScale + 0.03, preset.minScale, preset.maxScale);
    }
    this.grade.uniforms.time.value = time;
    // flash decays every frame (impulse based)
    const f = this.grade.uniforms.flash.value as number;
    if (f > 0.0005) this.grade.uniforms.flash.value = f * Math.exp(-dt * 3.4);
    else this.grade.uniforms.flash.value = 0;
    this.grade.uniforms.glitch.value = clamp(this.glitch + this.autoGlitch);
    this.grade.uniforms.grain.value = PRESETS[this.quality].grain;
    if (this.bloom) this.bloom.strength = PRESETS[this.quality].bloomStrength + this.autoGlitch * 0.25;
  }

  /** half-res depth prepass; only runs while a depth-driven effect needs it */
  private renderDepthPass() {
    const prevTarget = this.renderer.getRenderTarget();
    const prevOverride = this.scene.overrideMaterial;
    const prevBg = this.scene.background;
    this.scene.overrideMaterial = this.depthMaterial;
    this.scene.background = null;
    this.renderer.setRenderTarget(this.depthRT);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.scene.overrideMaterial = prevOverride;
    this.scene.background = prevBg;
  }

  render() {
    const dof = this.grade.uniforms.dofStrength.value > 0.05;
    if (dof) this.renderDepthPass();
    this.composer.render();
  }

  setFocus(focus: number, range: number, strength: number) {
    this.grade.uniforms.focus.value = focus;
    this.grade.uniforms.focusRange.value = range;
    this.grade.uniforms.dofStrength.value = strength;
  }

  /**
   * Brightness flash with a hard safety budget: at most 3 flashes in any rolling
   * second and a capped peak, so the sequence can never strobe.
   */
  flash(amount: number) {
    const now = performance.now();
    this.flashTimes = this.flashTimes.filter((t) => now - t < 1000);
    if (this.flashTimes.length >= 3) return;
    this.flashTimes.push(now);
    const peak = Math.min(0.62, amount);
    this.grade.uniforms.flash.value = Math.max(this.grade.uniforms.flash.value, peak);
  }

  set flashColor(c: THREE.Color) {
    this.grade.uniforms.flashColor.value.copy(c);
  }

  setIris(radius: number, active: boolean) {
    this.grade.uniforms.iris.value = radius;
    this.grade.uniforms.irisActive.value = active ? 1 : 0;
  }

  setFade(v: number) {
    this.grade.uniforms.fade.value = clamp(v);
  }

  setVignette(v: number) {
    this.grade.uniforms.vignette.value = v;
  }

  setLens(v: number) {
    this.grade.uniforms.lensDistort.value = v;
  }

  get frameMs() {
    return this.frameAvg;
  }

  get renderScale() {
    return this.scale;
  }
}
