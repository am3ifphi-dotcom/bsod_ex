import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let cachedNoiseTex: THREE.DataTexture | null = null;

/**
 * Anisotropic filtering level applied to every loaded albedo/detail map.
 * At 1 (the old value) the floor and walls smear into mush at grazing angles, which reads as
 * "low resolution" even at native render size. main.ts pushes the GPU's real maximum in at boot.
 */
let globalAnisotropy = 1;

export function setAssetAnisotropy(value: number): void {
  globalAnisotropy = Math.max(1, Math.min(16, Math.floor(value)));
}

export function getAssetAnisotropy(): number {
  return globalAnisotropy;
}

export function applyAssetAnisotropy(tex: THREE.Texture | null | undefined): void {
  if (tex) tex.anisotropy = globalAnisotropy;
}

function hash2(ix: number, iy: number, seed: number): number {
  let n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function tileValueNoise(x: number, y: number, period: number, seed: number): number {
  const gx = x * period;
  const gy = y * period;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const x0 = ((ix % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((iy % period) + period) % period;
  const y1 = (y0 + 1) % period;

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function tileWorley(x: number, y: number, cells: number, seed: number): number {
  const gx = x * cells;
  const gy = y * cells;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let minDistSq = 99.0;
  let secondDistSq = 99.0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = (((ix + dx) % cells) + cells) % cells;
      const cy = (((iy + dy) % cells) + cells) % cells;
      const px = ix + dx + hash2(cx, cy, seed);
      const py = iy + dy + hash2(cx, cy, seed + 97);
      const ddx = gx - px;
      const ddy = gy - py;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minDistSq) {
        secondDistSq = minDistSq;
        minDistSq = d2;
      } else if (d2 < secondDistSq) {
        secondDistSq = d2;
      }
    }
  }
  const edge = Math.sqrt(secondDistSq) - Math.sqrt(minDistSq);
  return Math.min(1, Math.max(0, edge * 1.35));
}

/**
 * Shared 256x256 tileable RGBA procedural noise atlas (~2.5ms once at boot):
 *  - R: Smooth 4-octave tileable FBM (clouds, volumetric mist, surface dampness)
 *  - G: High-frequency mineral / plaster micro-grain
 *  - B: Anisotropic streak / brushed-vein noise
 *  - A: Tileable Worley Voronoi cell-edge field (fractures, caustics, puddles)
 */
export function getSharedNoiseTexture(): THREE.DataTexture {
  if (cachedNoiseTex) return cachedNoiseTex;

  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const ny = y / size;
    for (let x = 0; x < size; x++) {
      const nx = x / size;

      const fbm =
        tileValueNoise(nx, ny, 4, 11) * 0.5 +
        tileValueNoise(nx, ny, 8, 23) * 0.25 +
        tileValueNoise(nx, ny, 16, 37) * 0.15 +
        tileValueNoise(nx, ny, 32, 53) * 0.1;

      const grain =
        tileValueNoise(nx, ny, 48, 71) * 0.6 +
        tileValueNoise(nx, ny, 96, 89) * 0.4;

      const streak =
        tileValueNoise(nx, ny, 24, 103) * 0.35 +
        tileValueNoise(nx * 1.0, ny * 0.25, 32, 131) * 0.65;

      const cell = tileWorley(nx, ny, 10, 173);

      const idx = (y * size + x) * 4;
      data[idx + 0] = Math.min(255, Math.max(0, Math.round(fbm * 255)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(grain * 255)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(streak * 255)));
      data[idx + 3] = Math.min(255, Math.max(0, Math.round(cell * 255)));
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cachedNoiseTex = tex;
  return tex;
}

export interface AtmosphericMatOptions {
  rimColor?: number;
  rimStrength?: number;
  specStrength?: number;
  shininess?: number;
  keepDoubleSide?: boolean;
  /** Set false when caller plans to attach its own onBeforeCompile (e.g. room infection shader) */
   deduplicate?: boolean;
}

const rimColorCache = new Map<string, THREE.Color>();
const dedupedMatCache = new Map<string, THREE.MeshLambertMaterial>();

function attachVertexAtmoHook(
  lam: THREE.MeshLambertMaterial,
  rimCol: THREE.Color,
  params: THREE.Vector3
): void {
  lam.userData.atmoRim = rimCol;
  lam.userData.atmoParams = params;
  lam.customProgramCacheKey = () => 'bsod_atmo_vtx_v2';
  lam.onBeforeCompile = (shader) => {
    shader.uniforms.uAtmoRim = { value: lam.userData.atmoRim };
    shader.uniforms.uAtmoParams = { value: lam.userData.atmoParams };

    // Compute Fresnel rim + Blinn-Phong specular IN VERTEX SHADER (1 cycle add per pixel in fragment!)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vAtmoGlow;
        uniform vec3 uAtmoRim;
        uniform vec3 uAtmoParams;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        {
          vec3 aV = normalize(-mvPosition.xyz);
          vec3 aN = normalize(transformedNormal);
          float oneMinusNdv = 1.0 - clamp(abs(dot(aN, aV)), 0.0, 1.0);
          float fres = oneMinusNdv * oneMinusNdv * oneMinusNdv;
          vec3 keyDir = normalize(vec3(-0.35, 0.65, 0.67));
          vec3 hVec = normalize(keyDir + aV);
          float spec = pow(max(dot(aN, hVec), 0.0), uAtmoParams.y) * uAtmoParams.x;
          vAtmoGlow = uAtmoRim * (fres * uAtmoParams.z + spec * 0.65) + vec3(spec * 0.35);
        }
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vAtmoGlow;
        `
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `
        #include <dithering_fragment>
        gl_FragColor.rgb += vAtmoGlow;
        `
      );
  };
}

/**
 * Upgrades heavy PBR MeshStandardMaterial into an ultra-fast vertex-highlighted Lambert material:
 *  - ~5x cheaper fragment shading than GGX PBR while preserving crisp rim light & specular sheen!
 *  - Deduplicates identical material signatures so static submeshes can batch into single draw calls.
 */
export function toAtmosphericMaterial(
  src: THREE.Material,
  opts: AtmosphericMatOptions = {}
): THREE.Material {
  if (!(src as THREE.MeshStandardMaterial).isMeshStandardMaterial) return src;
  const std = src as THREE.MeshStandardMaterial;

  const rough = THREE.MathUtils.clamp(std.roughness ?? 0.65, 0.08, 1.0);
  const metal = THREE.MathUtils.clamp(std.metalness ?? 0.1, 0.0, 1.0);

  const needsDouble =
    opts.keepDoubleSide ||
    std.transparent ||
    std.alphaTest > 0 ||
    /curtain|plant|leaf|glass|shade|paper|blanket/i.test(std.name || '');

  const side = needsDouble ? std.side : THREE.FrontSide;
  const rimHex = opts.rimColor ?? 0x4da8ff;
  const specStr = opts.specStrength ?? (0.14 + (1.0 - rough) * 0.40 + metal * 0.34);
  const shininess = opts.shininess ?? (14.0 + (1.0 - rough) * 52.0);
  const rimStr = opts.rimStrength ?? (0.08 + (1.0 - rough) * 0.16 + metal * 0.14);

  const canDedupe = opts.deduplicate !== false;
  const sig = canDedupe
    ? [
        std.map?.uuid ?? '-',
        std.emissiveMap?.uuid ?? '-',
        std.color.getHexString(),
        std.emissive.getHexString(),
        std.emissiveIntensity.toFixed(2),
        std.transparent ? '1' : '0',
        std.opacity.toFixed(2),
        std.alphaTest.toFixed(2),
        side,
        rimHex.toString(16),
        specStr.toFixed(2),
        shininess.toFixed(0),
        rimStr.toFixed(2),
      ].join('|')
    : '';

  if (canDedupe) {
    const hit = dedupedMatCache.get(sig);
    if (hit) return hit;
  }

  if (std.map) std.map.anisotropy = globalAnisotropy;
  if (std.emissiveMap) std.emissiveMap.anisotropy = globalAnisotropy;

  const lam = new THREE.MeshLambertMaterial({
    name: std.name,
    color: std.color.clone(),
    map: std.map,
    emissive: std.emissive.clone(),
    emissiveMap: std.emissiveMap,
    emissiveIntensity: std.emissiveIntensity,
    transparent: std.transparent,
    opacity: std.opacity,
    alphaTest: std.alphaTest,
    side,
  });

  const rimKey = rimHex.toString(16);
  let rimCol = rimColorCache.get(rimKey);
  if (!rimCol) {
    rimCol = new THREE.Color(rimHex);
    rimColorCache.set(rimKey, rimCol);
  }

  attachVertexAtmoHook(lam, rimCol, new THREE.Vector3(specStr, shininess, rimStr));

  if (canDedupe) {
    dedupedMatCache.set(sig, lam);
  }
  return lam;
}

/**
 * Merges static non-skinned, single-material opaque child meshes inside a GLTF subtree:
 *  1) Merges meshes sharing identical Material instances.
 *  2) Also merges untextured solid-color Lambert meshes (that have not been given a custom
 *     infection shader) into ONE vertex-colored batch to slash small-prop draw calls!
 */
export function mergeStaticSubmeshes(
  root: THREE.Object3D,
  skipNodePredicate?: (obj: THREE.Object3D) => boolean
): void {
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  const solidUntextured: THREE.Mesh[] = [];

  root.traverse((obj) => {
    if (obj === root) return;
    if (skipNodePredicate?.(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (
      !mesh.isMesh ||
      (mesh as THREE.InstancedMesh).isInstancedMesh ||
      (mesh as THREE.SkinnedMesh).isSkinnedMesh
    ) {
      return;
    }
    if (!mesh.visible || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    if (!mat || mat.transparent || mat.alphaTest > 0) return;
    const geo = mesh.geometry;
    if (!geo || !geo.attributes.position || !geo.attributes.normal) return;

    const customKey = mat.customProgramCacheKey?.() ?? '';
    const isPlainAtmoUntextured =
      mat.isMeshLambertMaterial &&
      !mat.map &&
      !mat.emissiveMap &&
      mat.emissive.r === 0 &&
      mat.emissive.g === 0 &&
      mat.emissive.b === 0 &&
      mat.side === THREE.FrontSide &&
      (customKey === '' || customKey === 'bsod_atmo_vtx_v2') &&
      !geo.attributes.color;

    if (isPlainAtmoUntextured) {
      solidUntextured.push(mesh);
      return;
    }

    let bucket = buckets.get(mat);
    if (!bucket) {
      bucket = [];
      buckets.set(mat, bucket);
    }
    bucket.push(mesh);
  });

  // 1) Merge identical-material buckets
  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const hasUv = Boolean(meshes[0].geometry.attributes.uv);
    const compatible = meshes.every(
      (m) => Boolean(m.geometry.attributes.uv) === hasUv && !m.geometry.attributes.color
    );
    if (!compatible) continue;

    const clonedGeos: THREE.BufferGeometry[] = [];
    for (const m of meshes) {
      const g = m.geometry.clone();
      const rel = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(rel);
      for (const attrName of Object.keys(g.attributes)) {
        if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
          g.deleteAttribute(attrName);
        }
      }
      clonedGeos.push(g);
    }

    const merged = mergeGeometries(clonedGeos, false);
    for (const cg of clonedGeos) cg.dispose();
    if (!merged) continue;

    for (const m of meshes) m.removeFromParent();
    const mergedMesh = new THREE.Mesh(merged, mat);
    mergedMesh.name = `Merged_${mat.name || 'Static'}`;
    root.add(mergedMesh);
  }

  // 2) Merge all untextured solid-color meshes into ONE vertex-colored draw call
  if (solidUntextured.length >= 2) {
    const clonedGeos: THREE.BufferGeometry[] = [];
    const sampleMat = solidUntextured[0].material as THREE.MeshLambertMaterial;
    for (const m of solidUntextured) {
      const mMat = m.material as THREE.MeshLambertMaterial;
      const g = m.geometry.clone();
      const rel = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(rel);
      for (const attrName of Object.keys(g.attributes)) {
        if (attrName !== 'position' && attrName !== 'normal') {
          g.deleteAttribute(attrName);
        }
      }
      const vCount = g.attributes.position.count;
      const colors = new Float32Array(vCount * 3);
      const r = mMat.color.r;
      const gr = mMat.color.g;
      const b = mMat.color.b;
      for (let i = 0; i < vCount; i++) {
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = gr;
        colors[i * 3 + 2] = b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      clonedGeos.push(g);
    }

    const merged = mergeGeometries(clonedGeos, false);
    for (const cg of clonedGeos) cg.dispose();
    if (merged) {
      for (const m of solidUntextured) m.removeFromParent();
      const vtxMat = new THREE.MeshLambertMaterial({
        name: 'Merged_VertexColored_Atmo',
        color: 0xffffff,
        vertexColors: true,
        side: THREE.FrontSide,
      });
      const rimCol = (sampleMat.userData.atmoRim as THREE.Color) ?? new THREE.Color(0x4da8ff);
      const params =
        (sampleMat.userData.atmoParams as THREE.Vector3) ?? new THREE.Vector3(0.28, 32.0, 0.14);
      attachVertexAtmoHook(vtxMat, rimCol, params);
      const mergedMesh = new THREE.Mesh(merged, vtxMat);
      mergedMesh.name = 'Merged_Untextured_Props';
      root.add(mergedMesh);
    }
  }
}
