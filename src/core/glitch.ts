import * as THREE from 'three';

/**
 * Global, shared glitch uniforms. Every "glitchified" material reads the same
 * values so geometry, texture UVs and emission distort together with the
 * post-process pass. Grades are driven by the story phase.
 */
export const glitchUniforms = {
  uTime: { value: 0 },
  uGlitch: { value: 0 }, // 0..1 geometry/uv corruption
  uFlicker: { value: 0 }, // 0..1 emissive flicker
  uSeed: { value: 0.37 },
};

const VERT_COMMON = /* glsl */ `
uniform float uTime;
uniform float uGlitch;
uniform float uSeed;
float bsodHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 41.7) * 43758.5453123);
}
vec2 bsodUv(vec2 uv) {
  float g = uGlitch;
  if (g < 0.002) return uv;
  float band = floor(uv.y * (14.0 + 40.0 * g) + uTime * 2.3);
  float h = bsodHash(vec2(band, floor(uTime * 8.0)));
  float shift = (h - 0.5) * g * g * 0.16 * step(0.55, h);
  float tearY = floor(uTime * 6.0) * 0.173;
  float tear = step(0.985 - g * 0.08, bsodHash(vec2(floor(uv.y * 120.0), tearY))) * g * 0.09;
  return uv + vec2(shift + tear, 0.0);
}
`;

const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
{
  float g = uGlitch;
  if (g > 0.001) {
    vec3 p = position;
    float cell = floor(p.y * (2.0 + 14.0 * (1.0 - g)) + p.x * 0.7);
    float n = bsodHash(vec2(cell, floor(uTime * 7.0) + p.z * 3.0));
    float push = step(0.88 - g * 0.35, n) * g * (0.06 + 0.42 * bsodHash(vec2(cell, uTime)));
    transformed += normal * push;
    transformed.x += (bsodHash(vec2(cell, floor(uTime * 3.0))) - 0.5) * g * g * 0.14;
  }
}
`;

const FRAG_COMMON = /* glsl */ `
uniform float uTime;
uniform float uGlitch;
uniform float uFlicker;
uniform float uSeed;
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  float f = uFlicker;
  if (f > 0.001) {
    float h = fract(sin(dot(vec2(floor(uTime * 30.0), 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    float drop = step(0.72, h) * f;
    totalEmissiveRadiance *= (1.0 - drop * 0.85);
    totalEmissiveRadiance += vec3(0.02, 0.06, 0.16) * f * (0.3 + 0.7 * h);
  }
}
`;

const patched = new WeakSet<THREE.Material>();

/** Inject geometry/UV/emission corruption into any MeshStandardMaterial. */
export function glitchify<T extends THREE.Material>(material: T, strength = 1): T {
  if (patched.has(material)) return material;
  patched.add(material);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uTime = glitchUniforms.uTime;
    shader.uniforms.uGlitch = glitchUniforms.uGlitch;
    shader.uniforms.uFlicker = glitchUniforms.uFlicker;
    shader.uniforms.uSeed = glitchUniforms.uSeed;
    shader.uniforms.uStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${VERT_COMMON}\nuniform float uStrength;\n#include <common>`)
      .replace('#include <begin_vertex>', VERT_BEGIN)
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = bsodUv(vMapUv);
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = bsodUv(vNormalMapUv);
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${FRAG_COMMON}\n#include <common>`)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'bsod-glitch-v3';
  material.needsUpdate = true;
  return material;
}

export function setGlitch(geometry: number, flicker: number) {
  glitchUniforms.uGlitch.value = geometry;
  glitchUniforms.uFlicker.value = flicker;
}
