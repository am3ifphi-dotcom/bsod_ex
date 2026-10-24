// Renderer, camera, post-processing chain, dynamic resolution and frame stats.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { finalFrag, finalVert } from './shaders';
import { settings, QUALITY } from './settings';
import { clamp } from './utils';

export class FrameStats {
  fps = 60;
  ms = 16.7;
  low1 = 60;
  private times: number[] = [];
  private acc = 0;
  private frames = 0;

  push(dt: number) {
    const ms = dt * 1000;
    this.times.push(ms);
    if (this.times.length > 900) this.times.shift();
    this.acc += dt; this.frames++;
    if (this.acc >= 0.4) {
      this.ms = (this.acc / this.frames) * 1000;
      this.fps = 1000 / this.ms;
      const sorted = [...this.times].sort((a, b) => a - b);
      const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || this.ms;
      this.low1 = 1000 / Math.max(p99, 0.0001);
      this.acc = 0; this.frames = 0;
    }
  }
  reset() { this.times.length = 0; this.acc = 0; this.frames = 0; }
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene = new THREE.Scene();
  composer!: EffectComposer;
  stats = new FrameStats();

  // post passes
  private renderPass!: RenderPass;
  private gtao?: GTAOPass;
  private bloom?: UnrealBloomPass;
  private bokeh?: BokehPass;
  private outputPass!: OutputPass;
  finalPass!: ShaderPass;

  // uniforms shared with the game
  fx = {
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uChroma: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 0.42 },
    uScan: { value: 0.5 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uShakeSeed: { value: 0 },
    tDiffuse: { value: null as THREE.Texture | null },
  };

  // world-space glitch uniforms (used by patched materials)
  glitchUniforms = {
    uTime: { value: 0 },
    uGlitch: { value: 0 },
  };

  private size = new THREE.Vector2(1, 1);
  private renderScale = 1;
  private targetScale = 1;
  private adaptTimer = 0;
  private samples = 4;
  bokehActive = false;
  private frameCb: ((dt: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.02, 1600);
    this.camera.position.set(0, 1.6, 0);

    this.buildComposer();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildComposer() {
    const preset = settings.preset;
    const w = Math.max(1, Math.floor(this.size.x * this.renderScale));
    const h = Math.max(1, Math.floor(this.size.y * this.renderScale));
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: this.samples,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(w, h);

    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);

    if (preset.gtao) {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      const params = this.gtao.updateGtaoMaterial({
        radius: 0.55, distanceExponent: 1.4, thickness: 1.2,
        scale: 1.0, samples: preset.gtaoSamples, distanceFallOff: 1.0, screenSpaceRadius: false,
      });
      void params;
      composer.addPass(this.gtao);
    } else {
      this.gtao = undefined;
    }

    if (preset.dof) {
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 4, aperture: 0.0025, maxblur: 0.012 });
      (this.bokeh as any).enabled = false;
      composer.addPass(this.bokeh);
    } else {
      this.bokeh = undefined;
    }

    if (preset.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w * preset.bloomRes, h * preset.bloomRes),
        preset.bloomStrength, 0.72, 0.72);
      composer.addPass(this.bloom);
    } else {
      this.bloom = undefined;
    }

    this.outputPass = new OutputPass();
    composer.addPass(this.outputPass);

    this.finalPass = new ShaderPass({
      uniforms: this.fx as any,
      vertexShader: finalVert,
      fragmentShader: finalFrag,
    });
    // ShaderPass deep-clones its uniforms; point both views at our shared
    // objects so the game can drive uGlitch / uGrain every frame.
    this.finalPass.uniforms = this.fx as any;
    this.finalPass.material.uniforms = this.fx as any;
    composer.addPass(this.finalPass);

    this.composer = composer;
  }

  setBokehFocus(focus: number, aperture = 0.0022, maxblur = 0.011) {
    if (!this.bokeh) return;
    const mat = (this.bokeh as any).materialBokeh;
    if (mat?.uniforms) {
      mat.uniforms.focus.value = focus;
      mat.uniforms.aperture.value = aperture;
      mat.uniforms.maxblur.value = maxblur;
    }
  }

  setBokehEnabled(on: boolean) {
    this.bokehActive = on && !!this.bokeh;
    if (this.bokeh) (this.bokeh as any).enabled = this.bokehActive;
  }

  applyQuality() {
    const preset = settings.preset;
    this.samples = preset.samples;
    // rebuild (samples / pass set changes with the preset)
    const old = this.composer;
    this.size.copy(this.getCssSize());
    this.buildComposer();
    this.resize();
    old?.dispose?.();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private getCssSize() {
    const el = this.renderer.domElement;
    return new THREE.Vector2(Math.max(1, el.clientWidth || window.innerWidth), Math.max(1, el.clientHeight || window.innerHeight));
  }

  resize() {
    const size = this.getCssSize();
    this.size.copy(size);
    const preset = settings.preset;
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(size.x, size.y, false);
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();

    const w = Math.max(2, Math.floor(size.x * this.renderScale));
    const h = Math.max(2, Math.floor(size.y * this.renderScale));
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fx.uResolution.value.set(w * pr, h * pr);
  }

  setRenderScale(scale: number, immediate = false) {
    this.targetScale = clamp(scale, 0.45, 1.6);
    if (immediate) {
      this.renderScale = this.targetScale;
      this.resize();
    }
  }

  /** Adaptive resolution: keeps the frame time near 16.6 ms. */
  private adapt(dt: number) {
    if (!settings.value.dynamicRes) {
      if (Math.abs(this.renderScale - settings.value.resScale) > 0.001) {
        this.renderScale = settings.value.resScale;
        this.targetScale = this.renderScale;
        this.resize();
      }
      return;
    }
    this.adaptTimer += dt;
    if (this.adaptTimer < 0.75) return;
    this.adaptTimer = 0;
    const maxScale = settings.value.resScale;
    const fps = this.stats.fps;
    let want = this.targetScale;
    if (fps < 54) want = Math.max(0.5, this.targetScale - 0.07);
    else if (fps > 58.5 && this.targetScale < maxScale) want = Math.min(maxScale, this.targetScale + 0.04);
    if (Math.abs(want - this.renderScale) > 0.02) {
      this.renderScale += (want - this.renderScale) * 0.5;
      this.targetScale = want;
      this.resize();
    } else {
      this.targetScale = want;
    }
  }

  render(dt: number) {
    this.stats.push(dt);
    this.adapt(dt);
    this.fx.uTime.value += dt;
    this.glitchUniforms.uTime.value = this.fx.uTime.value;
    this.glitchUniforms.uGlitch.value = this.fx.uGlitch.value;
    this.stepExtra?.(dt);
    this.composer.render(dt);
  }

  stepExtra?: (dt: number) => void;

  get resolution() { return { scale: this.renderScale, w: this.size.x, h: this.size.y }; }

  info() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries,
      textures: i.memory.textures, programs: i.programs?.length ?? 0,
    };
  }

  dispose() {
    this.composer.dispose();
    this.renderer.dispose();
  }
}

export { QUALITY };
