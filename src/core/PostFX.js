import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// エラー文字が敷き詰められたテクスチャ(侵食面のテクスチャ)
export function makeGlyphTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#062a55';
  ctx.fillRect(0, 0, 512, 512);
  const words = ['0x000000EF', 'CRITICAL_PROCESS_DIED', 'MEMORY_MANAGEMENT', 'IRQL_NOT_LESS_OR_EQUAL',
    'PAGE_FAULT', ':(', 'KERNEL_SECURITY', 'SYSTEM_THREAD', 'WAKE_UP', '0xFF', 'NTOSKRNL', 'FATAL',
    'UNEXPECTED_STORE', 'EXCEPTION', 'ACCESS_DENIED', '//corrupt', 'rebooting…'];;
  ctx.font = '13px "Courier New", monospace';
  ctx.fillStyle = 'rgba(180,225,255,0.55)';
  let y = 14;
  while (y < 512) {
    let x = 8;
    while (x < 500) {
      const w = words[(Math.random() * words.length) | 0];
      ctx.globalAlpha = 0.25 + Math.random() * 0.5;
      ctx.fillText(w, x, y);
      x += ctx.measureText(w).width + 10 + Math.random() * 26;
    }
    y += 18;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGlitch: { value: 0 },
    uCorruption: { value: 0 },
    uFlash: { value: 0 },
    uWarp: { value: 0 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.6 },
    uGlyphTex: { value: null },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D uGlyphTex;
    uniform float uTime, uGlitch, uCorruption, uFlash, uWarp, uGrain, uVignette;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(float n){ return fract(sin(n) * 43758.5453123); }
    float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      float a = hash2(i), b = hash2(i + vec2(1.,0.)), c = hash2(i + vec2(0.,1.)), d = hash2(i + vec2(1.,1.));
      vec2 u = f*f*(3.-2.*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
    }

    void main(){
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      float t = uTime;

      // レンズ歪み(空間の歪み)
      float r2 = dot(cc, cc);
      uv = uv + cc * r2 * uWarp * 0.55;

      // ブロック状の水平テアー
      float sliceCount = 18.0;
      float slice = floor(uv.y * sliceCount);
      float trigger = step(0.82 - uGlitch * 0.75, hash(slice + floor(t * 14.0)));
      float tear = (hash(slice * 7.13 + floor(t * 9.0)) - 0.5) * uGlitch * 0.14 * trigger;
      uv.x += tear;

      // 大きめのブロック移動
      vec2 block = floor(uv * vec2(12.0, 9.0));
      float btrigger = step(0.93 - uGlitch * 0.55, hash2(block + floor(t * 6.0)));
      uv += (vec2(hash2(block + 1.7), hash2(block + 3.3)) - 0.5) * btrigger * uGlitch * 0.05;

      // 色収差
      float ca = (0.0012 + uGlitch * 0.012 + uCorruption * 0.004) * (0.4 + r2 * 2.2);
      vec2 dir = normalize(cc + 1e-5);
      float r = texture2D(tDiffuse, uv + dir * ca).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * ca).b;
      vec3 col = vec3(r, g, b);

      // グリッチでの色調量子化
      float quant = step(0.96 - uGlitch * 0.4, hash(floor(t * 30.0)));
      col = mix(col, floor(col * 6.0) / 6.0, quant * uGlitch * 0.55);

      // BSOD侵食(中心からノイズで広がる)
      float n = noise(uv * 3.2 + vec2(t * 0.25, -t * 0.18));
      float mask = smoothstep(0.55 - uCorruption * 0.62, 0.55 - uCorruption * 0.62 + 0.16, length(cc) * (0.8 + n * 0.55));
      float erode = 1.0 - mask;
      if (erode > 0.001) {
        vec2 guv = uv * 2.0 + vec2(t * 0.35, t * 0.12);
        vec3 glyph = texture2D(uGlyphTex, guv).rgb;
        vec3 bsod = mix(vec3(0.016, 0.18, 0.45), vec3(0.05, 0.48, 0.85), n * 0.7);
        bsod = mix(bsod, glyph, 0.5);
        // 侵食エッジの白い発光
        float edge = smoothstep(0.0, 0.12, erode) * (1.0 - smoothstep(0.12, 0.3, erode));
        bsod += edge * vec3(0.5, 0.8, 1.0) * 1.4;
        col = mix(col, bsod, clamp(erode * (0.35 + uCorruption * 0.85), 0.0, 1.0));
      }

      // スキャンライン
      col *= 1.0 - 0.08 * sin(uv.y * uResolution.y * 1.4);

      // グレイン
      float gr = (hash2(uv * uResolution + t) - 0.5) * uGrain * (1.0 + uGlitch * 3.0);
      col += gr;

      // ビネット
      float vig = smoothstep(0.95, 0.25, length(cc) * (1.15 - uVignette * 0.4));
      col *= vig;

      // フラッシュ
      col = mix(col, vec3(0.85, 0.94, 1.0), clamp(uFlash, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(HorrorShader);
    this.pass.uniforms.uGlyphTex.value = makeGlyphTexture();
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
    this.targets = { glitch: 0, corruption: 0, flash: 0, warp: 0 };
    this.current = { glitch: 0, corruption: 0, flash: 0, warp: 0 };
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.pass.uniforms.uResolution.value.set(w, h);
  }

  // 目標値をセット(毎フレーム滑らかに補間)
  setTarget(key, v) { this.targets[key] = v; }
  setNow(key, v) { this.targets[key] = v; this.current[key] = v; this.pass.uniforms['u' + key[0].toUpperCase() + key.slice(1)].value = v; }

  triggerGlitch(amount) { this.targets.glitch = Math.max(this.targets.glitch, amount); }
  triggerFlash(amount) { this.targets.flash = Math.max(this.targets.flash, amount); }

  update(dt, time) {
    const u = this.pass.uniforms;
    u.uTime.value = time;
    for (const k of Object.keys(this.targets)) {
      const target = this.targets[k];
      // フラッシュとグリッチは素早く減衰、それ以外は滑らかに追従
      const rate = (k === 'flash' || k === 'glitch') ? 7.5 : 3.2;
      this.current[k] += (target - this.current[k]) * Math.min(1, rate * dt);
      u['u' + k[0].toUpperCase() + k.slice(1)].value = this.current[k];
    }
    // グリッチのバースト後、目標を0に戻す
    this.targets.glitch = 0;
    this.targets.flash = 0;
  }

  render(dt, time) { this.update(dt, time); this.composer.render(); }
}
