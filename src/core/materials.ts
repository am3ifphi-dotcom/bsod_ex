import * as THREE from 'three';
import type { Assets, TexSet } from './assets';

/* ------------------------------------------------------------------ *
 * 異世界のマテリアル制御用の共有ユニフォーム。
 * ポストエフェクトだけでなく、ジオメトリ変形・発光にも異常を起こす。
 * ------------------------------------------------------------------ */
export const glitchUniforms = {
  uTime: { value: 0 },
  uGlitch: { value: 0 },        // 0..1 (崩壊の進行度)
  uCorrupt: { value: 0 },       // 0..1 (世界の侵食度)
  uPlayer: { value: new THREE.Vector3() },
  uPulse: { value: 0 },         // 中心構造物の鼓動
};

const GLITCH_VERTEX = /* glsl */`
#include <begin_vertex>
vGlitchWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
{
  vec4 gwPos = modelMatrix * vec4(transformed, 1.0);
  float amp = uGlitch * 0.9 + uCorrupt * 0.18;
  // 低周波のうねり
  float n = sin(gwPos.x * 0.35 + uTime * 0.9) * cos(gwPos.z * 0.31 - uTime * 0.7);
  transformed.x += n * amp * 0.25;
  transformed.z += n * amp * 0.18;
  // 水平ブロック単位のスライスずれ
  float slice = floor(gwPos.y * 12.0);
  float r = fract(sin(slice * 12.9898 + 4.1414) * 43758.5453);
  transformed.x += (step(0.82, r) * (r - 0.5)) * amp * 9.0;
  transformed.y += (step(0.94, r) * (r - 0.5)) * amp * 3.0;
  // 頂点の飛散 (近距離のみ)
  float d = distance(gwPos.xyz, uPlayer);
  float burst = smoothstep(26.0, 3.0, d) * uGlitch;
  transformed += normal * burst * (fract(sin(dot(gwPos.xyz, vec3(12.9, 78.2, 37.7))) * 43758.5) - 0.5) * 0.6;
}
`;

const GLITCH_FRAGMENT = /* glsl */`
#include <emissivemap_fragment>
{
  // 走査線と横方向のノイズバンドを発光に重ねる
  float scan = 0.82 + 0.18 * sin(vGlitchWPos.y * 90.0 + uTime * 2.0);
  float band = step(0.995, fract(sin(floor(vGlitchWPos.y * 24.0) * 91.7 + uTime * 0.7) * 4375.85));
  totalEmissiveRadiance *= scan;
  totalEmissiveRadiance += band * vec3(0.9, 0.97, 1.0) * (0.35 + uCorrupt * 0.9);
}
`;

export function patchGlitch(material: THREE.Material, displace = 1) {
  const m = material as THREE.MeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = glitchUniforms.uTime;
    shader.uniforms.uGlitch = glitchUniforms.uGlitch;
    shader.uniforms.uCorrupt = glitchUniforms.uCorrupt;
    shader.uniforms.uPlayer = glitchUniforms.uPlayer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uGlitch;\nuniform float uCorrupt;\nuniform vec3 uPlayer;\nvarying vec3 vGlitchWPos;')
      .replace('#include <begin_vertex>', GLITCH_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCorrupt;\nvarying vec3 vGlitchWPos;')
      .replace('#include <emissivemap_fragment>', GLITCH_FRAGMENT);
    if (displace < 1) {
      // 控えめ変形 (小物など)
      shader.vertexShader = shader.vertexShader.replace('float amp = uGlitch * 0.9 + uCorrupt * 0.18;', `float amp = (uGlitch * 0.9 + uCorrupt * 0.18) * ${displace.toFixed(2)};`);
    }
  };
  m.customProgramCacheKey = () => 'glitch' + displace.toFixed(2);
  return m;
}

/* ------------------------------------------------------------------ *
 * マテリアル生成ヘルパ
 * ------------------------------------------------------------------ */
export type PBRVariant = {
  repeat?: number | [number, number];
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  glitch?: number;          // 0 = パッチしない
  envMapIntensity?: number;
  aoIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  pole?: number;            // 異世界用の青い脱色度 0..1
};

export async function makeMaterial(assets: Assets, key: string, v: PBRVariant = {}) {
  const set: TexSet = await assets.texSet(key);
  const rep = v.repeat ?? 1;
  const rx = Array.isArray(rep) ? rep[0] : rep;
  const ry = Array.isArray(rep) ? rep[1] : rep;
  const clone = (t: THREE.Texture | null): THREE.Texture | null => {
    if (!t) return null;
    const c = t.clone();
    c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(rx, ry);
    return c;
  };
  const normal = clone(set.normal);
  const mat = new THREE.MeshStandardMaterial({
    map: clone(set.albedo),
    normalMap: normal,
    aoMap: clone(set.orm),
    roughnessMap: clone(set.orm),
    metalnessMap: clone(set.orm),
    color: v.color ?? 0xffffff,
    roughness: v.roughness ?? 1.0,
    metalness: v.metalness ?? 1.0,
    emissive: v.emissive ?? 0x000000,
    emissiveIntensity: v.emissiveIntensity ?? 1,
    envMapIntensity: v.envMapIntensity ?? 0.8,
    transparent: v.transparent ?? false,
    opacity: v.opacity ?? 1,
    side: v.side ?? THREE.FrontSide,
  });
  mat.aoMapIntensity = v.aoIntensity ?? 1.0;
  if (normal) (normal as unknown as { normalScale: THREE.Vector2 }).normalScale.set(v.normalScale ?? 1, v.normalScale ?? 1);
  // glTF の metallicRoughness / occlusion は同じテクスチャを共有できる
  if (mat.roughnessMap) mat.roughnessMap.channel = 0;
  if (v.pole) {
    // 異世界: 青く脱色し、わずかに自己発光させる
    mat.color.lerp(new THREE.Color(0x3f6ea8), v.pole * 0.55);
    if (!v.emissive) mat.emissive = new THREE.Color(0x0a2a55);
    mat.emissiveIntensity = v.emissiveIntensity ?? 0.35;
  }
  if (v.glitch) patchGlitch(mat, v.glitch);
  return mat;
}

/* 単色の PBR (小物・構造物用) */
export function solid(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.7, metalness: 0.05, ...opts,
  });
}

/* 発光マテリアル (異世界のライン・UI 断片) */
export function emissive(color: THREE.ColorRepresentation, intensity = 2, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity,
    roughness: 1, metalness: 0, ...opts,
  });
}
