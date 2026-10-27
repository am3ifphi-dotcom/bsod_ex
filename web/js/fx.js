// fx.js — single-pass screen-space FX (glitch, pull, chroma, scan, flash...)
// One extra draw call. All distortion lives here so the scene stays cheap.
import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uGlitch;   // general corruption (tear + noise + block shift)
  uniform float uPull;     // radial suction toward uCenter
  uniform vec2  uCenter;   // suction focal point (uv)
  uniform float uChroma;   // chromatic aberration
  uniform float uScan;     // scanline strength
  uniform float uNoise;    // static noise
  uniform float uVignette;
  uniform float uBlue;     // blend toward BSOD blue
  uniform float uFlash;    // white/blue flash
  uniform float uTear;     // horizontal band tear amount
  uniform vec2  uRes;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;

    // radial pull (suction into the screen)
    if (uPull > 0.001) {
      vec2 d = uv - uCenter;
      float r = length(d);
      float k = uPull * 0.55;
      uv = uCenter + d * (1.0 - k * exp(-r * 1.6)) - d * k * 0.22;
    }

    // horizontal tear bands
    float band = floor(uv.y * 28.0);
    float tearRnd = hash(vec2(band, floor(uTime * 13.0)));
    float tear = (tearRnd - 0.5) * uTear * step(0.72, hash(vec2(band, floor(uTime * 7.0) + 3.0)));
    uv.x += tear;

    // block glitch shift
    if (uGlitch > 0.001) {
      float blk = floor(uv.y * 12.0);
      float r2 = hash(vec2(blk, floor(uTime * 9.0)));
      uv.x += (r2 - 0.5) * uGlitch * 0.10 * step(0.6, r2);
    }

    // chromatic aberration
    float ca = uChroma * 0.012 + uGlitch * 0.004;
    vec2 dir = normalize(uv - vec2(0.5) + 1e-5);
    vec3 col;
    col.r = texture2D(tDiffuse, uv + dir * ca).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - dir * ca).b;

    // static noise
    if (uNoise > 0.001) {
      float n = hash(uv * uRes * 0.5 + vec2(uTime * 61.7, uTime * 47.3));
      col = mix(col, vec3(n * 0.85 + 0.1), uNoise * 0.55);
    }

    // scanlines
    float scan = sin(vUv.y * uRes.y * 1.7) * 0.5 + 0.5;
    col *= 1.0 - uScan * scan * 0.55;

    // blue grade toward BSOD colour
    vec3 bsod = vec3(0.0, 0.47, 0.843);
    col = mix(col, bsod * (0.35 + 0.65 * length(col)), uBlue * 0.85);

    // vignette
    float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
    col *= mix(1.0, vig, uVignette);

    // flash
    col = mix(col, vec3(0.82, 0.92, 1.0), clamp(uFlash, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const dpr = renderer.getPixelRatio();
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      samples: Math.min(4, renderer.capabilities.maxSamples || 0),
    });
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      tDiffuse: { value: this.rt.texture },
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uPull: { value: 0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uChroma: { value: 0 },
      uScan: { value: 0.12 },
      uNoise: { value: 0 },
      uVignette: { value: 0.55 },
      uBlue: { value: 0 },
      uFlash: { value: 0 },
      uTear: { value: 0 },
      uRes: { value: new THREE.Vector2(w, h) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false,
    });
    const tri = new THREE.PlaneGeometry(2, 2);
    this.quadScene.add(new THREE.Mesh(tri, mat));
  }

  setSize(w, h, dpr) {
    this.rt.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.uniforms.uRes.value.set(w * dpr, h * dpr);
  }

  render(scene, camera, time) {
    this.uniforms.uTime.value = time;
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }

  /** set many uniforms at once: fx.set({uGlitch: .4, uPull: 1}) */
  set(obj) {
    for (const k in obj) if (this.uniforms[k]) this.uniforms[k].value = obj[k];
  }

  reset() {
    this.set({
      uGlitch: 0, uPull: 0, uChroma: 0, uScan: 0.12, uNoise: 0,
      uVignette: 0.55, uBlue: 0, uFlash: 0, uTear: 0,
    });
    this.uniforms.uCenter.value.set(0.5, 0.5);
  }
}
