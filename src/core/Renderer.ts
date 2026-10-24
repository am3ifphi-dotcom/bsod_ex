import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { clamp, clamp01, lerp } from './math';
import type { QualityPreset } from './Settings';

/**
 * Renderer + post stack.
 *
 *   RenderPass (HDR, half float, depth texture)
 *     -> GTAOPass       (high preset only: true ground-truth AO)
 *     -> UnrealBloom    (emissive blues / white text bloom)
 *     -> BSOD pass      (depth-of-field, chromatic aberration, tearing, grain, vignette, scanline)
 *     -> OutputPass     (ACES filmic tone mapping + sRGB)
 *
 * Dynamic resolution keeps the frame budget: the pixel ratio is nudged between 0.7 and the
 * device ratio based on a rolling frame-time average.
 */

export interface FxState {
  glitch: number;       // 0..1 displacement / tearing
  chroma: number;       // 0..1 chromatic aberration
  dofFocus: number;     // metres
  dofRange: number;     // metres
  dofStrength: number;  // 0..1
  flash: number;        // 0..1 white flash
  invert: number;       // 0..1 colour inversion (carefully rate limited)
  fade: number;         // 0..1 black fade
  grain: number;
  radialBlur: number;   // extra radial blur (fall / tunnel)
}

const FX_DEFAULT: FxState = {
  glitch: 0, chroma: 0.25, dofFocus: 6, dofRange: 6, dofStrength: 0,
  flash: 0, invert: 0, fade: 0, grain: 0.35, radialBlur: 0,
};

export const BSOD_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGlitch: { value: 0 },
    uChroma: { value: 0.25 },
    uGrain: { value: 0.35 },
    uFlash: { value: 0 },
    uInvert: { value: 0 },
    uFade: { value: 0 },
    uRadial: { value: 0 },
    uAberrationCenter: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uGlitch;
    uniform float uChroma;
    uniform float uGrain;
    uniform float uFlash;
    uniform float uInvert;
    uniform float uFade;
    uniform float uRadial;
    uniform vec2 uAberrationCenter;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;

      // ---- horizontal tearing: limited to a few bands per frame
      float band = floor(uv.y * 42.0);
      float tSeed = floor(uTime * 9.0);
      float rnd = hash12(vec2(band, tSeed));
      float tear = step(0.82, rnd) * (rnd - 0.82) * 2.2;
      uv.x += (rnd - 0.5) * tear * uGlitch * 0.16;
      // large scale wobble
      uv.x += sin(uv.y * 24.0 + uTime * 3.0) * uGlitch * 0.0025;
      uv.y += cos(uv.x * 17.0 + uTime * 2.3) * uGlitch * 0.0015;

      // ---- chromatic aberration (depth of field lives in DofPass, before bloom)
      vec2 center = uAberrationCenter;
      vec2 dir = uv - center;
      float ca = uChroma * (0.0015 + dot(dir, dir) * 0.006) * (1.0 + uGlitch * 4.0);
      vec3 color = vec3(
        texture2D(tDiffuse, uv + dir * ca).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - dir * ca).b
      );

      // ---- subtle filmic grade: cold shadows, cyan highlights
      vec3 shadowTint = vec3(0.94, 0.98, 1.06);
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color *= mix(shadowTint, vec3(1.0), smoothstep(0.0, 0.6, luma));

      // ---- scanlines & noise
      float scan = sin(uv.y * 720.0 + uTime * 2.0) * 0.5 + 0.5;
      color *= 1.0 - scan * 0.014 * (0.4 + uGlitch);
      float n = hash12(uv * uResolution + fract(uTime) * 913.0);
      color += (n - 0.5) * uGrain * 0.055;

      // glitch blocks of pure signal
      if (uGlitch > 0.35) {
        float blockNoise = hash12(floor(uv * vec2(60.0, 34.0)) + tSeed);
        if (blockNoise > 0.995 - uGlitch * 0.02) {
          color = mix(color, vec3(0.55, 0.75, 1.0) * (0.5 + hash12(uv * 13.0)), 0.7 * uGlitch);
        }
      }

      // ---- flashes and inversion (rate limited by the caller)
      color = mix(color, vec3(1.0) - color, uInvert);
      color += vec3(uFlash);

      // ---- vignette
      vec2 vc = uv - 0.5;
      float vig = 1.0 - dot(vc, vc) * 0.85;
      color *= clamp(vig, 0.0, 1.0);

      // ---- Fade to black
      color *= (1.0 - uFade);

      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }`,
};


/**
 * Depth-of-field pass.
 *
 * It has to run directly after the scene render, while the first composer target still holds
 * the frame's depth texture; the later passes (GTAO, bloom) overwrite depth. The gather is a
 * golden-angle disc with 10 taps, weighted against fireflies, plus a mild chromatic split so
 * out-of-focus highlights fringe like a real lens.
 */
export const DOF_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.075 },
    uFar: { value: 1400 },
    uFocus: { value: 6 },
    uRange: { value: 6 },
    uStrength: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uChroma: { value: 0.4 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    uniform float uFocus;
    uniform float uRange;
    uniform float uStrength;
    uniform float uChroma;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 gather(vec2 uv, float radius, int taps) {
      vec3 acc = texture2D(tDiffuse, uv).rgb;
      float total = 1.0;
      for (int i = 0; i < 10; i++) {
        if (i >= taps) break;
        float fi = float(i) + 0.5;
        float a = fi * 2.39996323 + hash12(uv * 901.0 + fi) * 0.4;
        float r = sqrt(fi / float(taps)) * radius;
        vec3 s = texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r).rgb;
        float w = 1.0 / (1.0 + dot(s, s) * 0.2);
        acc += s * w;
        total += w;
      }
      return acc / total;
    }

    void main() {
      vec2 uv = vUv;
      vec4 base = texture2D(tDiffuse, uv);
      if (uStrength < 0.004) {
        gl_FragColor = base;
        return;
      }
      float d = texture2D(tDepth, uv).x;
      float viewZ = perspectiveDepthToViewZ(d, uNear, uFar);
      float depth = -viewZ;
      float coc = clamp(abs(depth - uFocus) / max(uRange, 0.001), 0.0, 1.0);
      coc = pow(coc, 1.3) * uStrength;
      float radius = coc * 0.012;
      if (radius < 0.0006) {
        gl_FragColor = base;
        return;
      }
      int taps = 6 + int(coc * 4.0);
      vec2 dir = uv - vec2(0.5);
      vec3 sharp = base.rgb;
      vec3 blurred = gather(uv, radius, taps);
      float mixAmt = clamp(radius * 95.0, 0.0, 1.0);
      vec3 color = mix(sharp, blurred, mixAmt);
      // chromatic fringing only where things are out of focus
      float ca = uChroma * 0.0026 * mixAmt;
      color.r = mix(color.r, texture2D(tDiffuse, uv + dir * ca * 2.0).r, 0.55 * mixAmt);
      color.b = mix(color.b, texture2D(tDiffuse, uv - dir * ca * 2.0).b, 0.55 * mixAmt);
      gl_FragColor = vec4(color, 1.0);
    }`,
};

export class DofPass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  near = 0.075;
  far = 1400;
  state: { focus: number; range: number; strength: number; chroma: number } = {
    focus: 6, range: 6, strength: 0, chroma: 0.4,
  };

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(DOF_SHADER.uniforms),
      vertexShader: DOF_SHADER.vertexShader,
      fragmentShader: DOF_SHADER.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
    this.enabled = false;
  }

  override setSize(width: number, height: number): void {
    this.material.uniforms.uResolution.value.set(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    const depth = readBuffer.depthTexture;
    u.tDepth.value = depth;
    u.uNear.value = this.near;
    u.uFar.value = this.far;
    u.uFocus.value = this.state.focus;
    u.uRange.value = this.state.range;
    u.uStrength.value = this.state.strength;
    u.uChroma.value = this.state.chroma;
    if (renderer.getRenderTarget() !== writeBuffer) renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

export class BsodPass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  state: FxState = { ...FX_DEFAULT };
  /** user setting: scales the visual glitch independent of the narrative script */
  glitchScale = 1;
  time = 0;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BSOD_SHADER.uniforms),
      vertexShader: BSOD_SHADER.vertexShader,
      fragmentShader: BSOD_SHADER.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  override setSize(width: number, height: number): void {
    this.material.uniforms.uResolution.value.set(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    // The colour buffer that reaches this pass may be the bloom result, which has no depth.
    // The scene depth lives on the first composer target and is always at the same resolution.
    u.uTime.value = this.time;
    u.uGlitch.value = this.state.glitch * this.glitchScale;
    u.uChroma.value = this.state.chroma;
    u.uGrain.value = this.state.grain;
    u.uFlash.value = this.state.flash;
    u.uInvert.value = this.state.invert;
    u.uFade.value = this.state.fade;
    u.uRadial.value = this.state.radialBlur;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.quad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.quad.render(renderer);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

export interface PerfStats {
  fps: number;
  avgFps: number;
  low1: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  scale: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly fx: BsodPass;
  readonly bloom: UnrealBloomPass;
  private gtao: GTAOPass | null = null;
  private dof!: DofPass;
  private composerTarget: THREE.WebGLRenderTarget;
  private quality: QualityPreset;
  private basePixelRatio: number;
  private resolutionScale = 1;
  private frameTimes: number[] = [];
  private lastStatUpdate = 0;
  private lastScaleChange = 0;
  private flashWindow = -10;
  private flashCount = 0;
  private prevFlash = 0;
  private container: HTMLElement;
  stats: PerfStats = { fps: 60, avgFps: 60, low1: 60, frameMs: 16, drawCalls: 0, triangles: 0, scale: 1 };
  onQualityChange?: (q: QualityPreset) => void;

  constructor(container: HTMLElement, quality: QualityPreset) {
    this.container = container;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'viewport';
    this.renderer.domElement.tabIndex = -1;

    RectAreaLightUniformsLib.init();

    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.75 : 1.25);
    const size = this.viewSize();
    this.camera = new THREE.PerspectiveCamera(74, size.width / size.height, 0.075, 1400);
    this.camera.rotation.order = 'YXZ';

    this.scene.fog = new THREE.FogExp2(0x050a14, 0.0025);

    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.setSize(size.width, size.height);

    const px = size.width * this.basePixelRatio;
    const py = size.height * this.basePixelRatio;
    const depthTexture = new THREE.DepthTexture(px, py);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;
    this.composerTarget = new THREE.WebGLRenderTarget(px, py, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this.composer = new EffectComposer(this.renderer, this.composerTarget);
    this.composerTarget.depthTexture = depthTexture;
    this.composer.setPixelRatio(this.basePixelRatio);
    this.composer.setSize(size.width, size.height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.dof = new DofPass();
    this.composer.addPass(this.dof);
    if (quality === 'high') this.addGtao(px, py);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.62, 0.72, 0.62);
    this.composer.addPass(this.bloom);
    this.fx = new BsodPass();
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());

    this.applyQuality(quality);
    window.addEventListener('resize', () => this.resize());
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(container);
    }
  }

  private viewSize(): { width: number; height: number } {
    return {
      width: Math.max(320, this.container.clientWidth || window.innerWidth),
      height: Math.max(200, this.container.clientHeight || window.innerHeight),
    };
  }

  private addGtao(px: number, py: number): void {
    if (this.gtao) return;
    const pass = new GTAOPass(this.scene, this.camera, px, py);
    pass.output = GTAOPass.OUTPUT.Default;
    pass.blendIntensity = 0.85;
    pass.updateGtaoMaterial({
      radius: 0.6,
      distanceExponent: 1.2,
      thickness: 1.0,
      scale: 1.0,
      samples: 16,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    pass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
    this.gtao = pass;
    this.composer.addPass(pass);
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    if (q === 'high' && !this.gtao) {
      // insert GTAO right after the depth-of-field pass (index 0 = render, 1 = dof)
      const size = this.viewSize();
      this.addGtao(size.width * this.basePixelRatio, size.height * this.basePixelRatio);
      const passes = this.composer.passes;
      const gtaoIndex = passes.indexOf(this.gtao!);
      if (gtaoIndex > 2) {
        passes.splice(gtaoIndex, 1);
        passes.splice(2, 0, this.gtao!);
      }
    } else if (q !== 'high' && this.gtao) {
      this.composer.removePass(this.gtao);
      this.gtao.dispose?.();
      this.gtao = null;
    }
    this.applyQuality(q);
    this.resize();
    this.onQualityChange?.(q);
  }

  private applyQuality(q: QualityPreset): void {
    const size = this.viewSize();
    this.basePixelRatio = Math.min(
      window.devicePixelRatio || 1,
      q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 1.0,
    );
    this.bloom.strength = q === 'low' ? 0.45 : 0.62;
    this.bloom.resolution.set(
      Math.max(160, size.width * (q === 'low' ? 0.35 : 0.5)),
      Math.max(120, size.height * (q === 'low' ? 0.35 : 0.5)),
    );
    this.renderer.shadowMap.enabled = q !== 'low';
    this.fx.state.grain = q === 'low' ? 0.2 : 0.35;
    this.resize();
  }

  resize(): void {
    const size = this.viewSize();
    const ratio = this.basePixelRatio * this.resolutionScale;
    this.camera.aspect = size.width / size.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.width, size.height, true);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(size.width, size.height);
    const px = Math.floor(size.width * ratio);
    const py = Math.floor(size.height * ratio);
    if (this.composerTarget.width !== px || this.composerTarget.height !== py) {
      this.composerTarget.setSize(px, py);
      const dt = this.composerTarget.depthTexture;
      if (dt) {
        dt.image.width = px;
        dt.image.height = py;
        dt.needsUpdate = true;
      }
    }
    this.fx.setSize(px, py);
    this.bloom.setSize(px * 0.5, py * 0.5);
    this.gtao?.setSize(px, py);
  }

  setFx(patch: Partial<FxState>): void {
    Object.assign(this.fx.state, patch);
  }

  setEnvironment(env: THREE.Texture | null, background?: THREE.Texture | null, backgroundIntensity = 1): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 1;
    this.scene.background = background ?? null;
    this.scene.backgroundIntensity = backgroundIntensity;
  }

  /** Render a one-off cube map at a position and convert it to an IBL environment (reflection probe). */
  captureProbe(position: THREE.Vector3, resolution = 256): THREE.Texture {
    const cubeRT = new THREE.WebGLCubeRenderTarget(resolution, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.1, 120, cubeRT);
    cubeCam.position.copy(position);
    const prevBg = this.scene.background;
    this.scene.background = null;
    cubeCam.update(this.renderer, this.scene);
    this.scene.background = prevBg;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromCubemap(cubeRT.texture).texture;
    pmrem.dispose();
    cubeRT.dispose();
    return env;
  }

  render(dt: number, time: number): void {
    this.renderer.info.reset();
    this.fx.state.glitch = clamp01(this.fx.state.glitch);
    this.fx.time = time;
    this.applyFlashSafety(time);
    // Deterministic buffer order: the scene always renders into renderTarget1, so the depth
    // texture handed to the BSOD pass is always the one that matches this frame.
    this.syncDof();
    this.composer.writeBuffer = this.composer.renderTarget1;
    this.composer.readBuffer = this.composer.renderTarget2;
    this.composer.render(dt);
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
    this.trackPerformance(dt, time);
  }

  /** Copy the DOF state to the pass, and disable it entirely when it would do nothing. */
  private syncDof(): void {
    const s = this.fx.state;
    const active = s.dofStrength > 0.004;
    this.dof.enabled = active;
    if (!active) return;
    this.dof.near = this.camera.near;
    this.dof.far = this.camera.far;
    this.dof.state.focus = s.dofFocus;
    this.dof.state.range = s.dofRange;
    this.dof.state.strength = s.dofStrength;
    this.dof.state.chroma = s.chroma;
  }

  /**
   * Photosensitivity guard: at most three flash onsets per second reach the shader, and the
   * inversion term is capped. The narrative direction is unchanged; only the rate is bounded.
   */
  private applyFlashSafety(time: number): void {
    const s = this.fx.state;
    s.invert = clamp01(s.invert) * 0.15;
    const flash = clamp01(s.flash);
    if (time - this.flashWindow > 1) {
      this.flashWindow = time;
      this.flashCount = 0;
    }
    if (flash > 0.02 && this.prevFlash <= 0.02) this.flashCount++;
    this.prevFlash = flash;
    if (this.flashCount > 3) s.flash = 0;
  }

  private trackPerformance(dt: number, time: number): void {
    const ms = dt * 1000;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    if (time - this.lastStatUpdate > 0.25) {
      this.lastStatUpdate = time;
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 16.7;
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
      const low = sorted.length ? sorted[idx] : 16.7;
      this.stats.frameMs = avg;
      this.stats.fps = 1000 / Math.max(0.01, avg);
      this.stats.avgFps = 1000 / Math.max(0.01, avg);
      this.stats.low1 = 1000 / Math.max(0.01, low);
      this.stats.scale = this.resolutionScale;
      // dynamic resolution
      const now = performance.now();
      if (now - this.lastScaleChange > 1500) {
        if (avg > 19.5 && this.resolutionScale > 0.7) {
          this.resolutionScale = clamp(this.resolutionScale - 0.1, 0.7, 1);
          this.lastScaleChange = now;
          this.resize();
        } else if (avg < 13.5 && this.resolutionScale < 1) {
          this.resolutionScale = clamp(this.resolutionScale + 0.05, 0.7, 1);
          this.lastScaleChange = now;
          this.resize();
        }
      }
    }
    void lerp;
  }
}
