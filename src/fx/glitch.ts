/**
 * ジオメトリ・マテリアルグリッチ
 * ポストエフェクトだけでなく、頂点変形・テクスチャ・ライティングに異常を注入する。
 */
import * as THREE from 'three';

export interface GlitchMaterialOptions {
  /** 頂点変形の振幅(m) */
  amp?: number;
  /** ブロックスナップの強さ */
  block?: number;
  /** 発光のちらつき */
  emissiveFlicker?: number;
}

interface Patched {
  uGlitchAmp: { value: number };
  uGlitchTime: { value: number };
  uGlitchBlock: { value: number };
  uGlitchFlicker: { value: number };
  uGlitchSeed: { value: number };
}

const patchedMats = new Set<{ mat: THREE.Material; u: Patched; baseAmp: number }>();

/** マテリアルにグリッチを注入 */
export function applyGlitch(mat: THREE.Material, opts: GlitchMaterialOptions = {}): void {
  const u: Patched = {
    uGlitchAmp: { value: opts.amp ?? 0.03 },
    uGlitchTime: { value: 0 },
    uGlitchBlock: { value: opts.block ?? 0 },
    uGlitchFlicker: { value: opts.emissiveFlicker ?? 0 },
    uGlitchSeed: { value: Math.random() * 100 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uGlitchAmp, uGlitchTime, uGlitchBlock, uGlitchSeed;
        float gHash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164)) + uGlitchSeed) * 43758.5453);
        }
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          float t = uGlitchTime;
          float h = gHash(floor(position * 3.0) + floor(t * 6.0));
          float gate = step(0.92, gHash(floor(position * 1.2) + floor(t * 2.0)));
          vec3 off = (vec3(
            gHash(position + t),
            gHash(position.yzx + t * 1.3),
            gHash(position.zxy + t * 0.7)
          ) - 0.5) * 2.0;
          transformed += off * uGlitchAmp * gate * (0.4 + h);
          if (uGlitchBlock > 0.001) {
            float q = uGlitchBlock * 0.25;
            transformed = mix(transformed, floor(transformed / q + 0.5) * q, uGlitchBlock * 0.5 * gate);
          }
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uGlitchFlicker, uGlitchTime, uGlitchSeed;
        `,
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `
        #include <dithering_fragment>
        if (uGlitchFlicker > 0.001) {
          float fl = step(0.965, fract(sin(floor(uGlitchTime * 9.0) + uGlitchSeed) * 43758.5453));
          gl_FragColor.rgb *= 1.0 + fl * uGlitchFlicker * 0.9;
          gl_FragColor.rgb += vec3(0.02, 0.05, 0.22) * fl * uGlitchFlicker;
        }
        `,
      );
    mat.userData.shader = shader;
  };
  mat.needsUpdate = true;
  patchedMats.add({ mat, u, baseAmp: opts.amp ?? 0.03 });
}

/** 毎フレーム: 全グリッチマテリアルへ時間を供給。ampScale は状況に応じた強度 */
export function tickGlitchMaterials(time: number, ampScale: number): void {
  for (const e of patchedMats) {
    e.u.uGlitchTime.value = time;
    e.u.uGlitchAmp.value = e.baseAmp * ampScale;
    if (e.mat.userData.shader) {
      e.mat.userData.shader.uniforms.uGlitchTime.value = time;
      e.mat.userData.shader.uniforms.uGlitchAmp.value = e.u.uGlitchAmp.value;
    }
  }
}

/** 安全に解除 */
export function clearGlitchMats(): void {
  patchedMats.clear();
}

/** ビルド時に使える: ワイヤーフレーム風の被覆シェーダ(遠景の構造物用) */
export function makeWireframeOverlayMaterial(color: THREE.Color, opacity = 0.28): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        vec3 g = abs(fract(vPos * 0.5) - 0.5);
        float line = min(min(g.x, g.y), g.z);
        float m = 1.0 - smoothstep(0.0, 0.06, line);
        gl_FragColor = vec4(uColor, m * uOpacity);
      }
    `,
  });
}
