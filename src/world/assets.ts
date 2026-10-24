/**
 * 3Dアセット(GLB/glTF)の読み込み・正規化・再マテリアル化
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeModel, disposeObject } from '../core/utils';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

export function loadModel(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      const root = new THREE.Group();
      root.add(gltf.scene);
      // 影とPBR設定
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = true;
          const mat = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const mm of mats) {
            if (mm && mm.isMeshStandardMaterial) {
              mm.envMapIntensity = 1.0;
              if (mm.map) mm.map.anisotropy = 8;
            }
          }
        }
      });
      // アニメーション(扇風機など)があれば保持
      root.userData.animations = gltf.animations || [];
      return root;
    });
    cache.set(url, p);
  }
  return p.then((src) => {
    const clone = src.clone(true) as THREE.Group;
    clone.userData.animations = src.userData.animations;
    return clone;
  });
}

export interface PropPlacement {
  url: string;
  /** 原点(モデルの中心下など) */
  position: THREE.Vector3;
  rotationY?: number;
  rotation?: THREE.Euler;
  /** 最大寸法(1ユニット=1m の世界に合わせる) */
  targetSize: number;
  /** アンカー: 'center'|'bottom'|'top' */
  anchor?: 'center' | 'bottom' | 'top';
  castShadow?: boolean;
}

export async function placeProp(scene: THREE.Object3D, p: PropPlacement): Promise<THREE.Group> {
  const model = await loadModel(p.url);
  model.position.copy(p.position);
  if (p.rotation) model.rotation.copy(p.rotation);
  else if (p.rotationY) model.rotation.y = p.rotationY;
  normalizeModel(model, p.targetSize);
  // アンカー調整
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const anchor = p.anchor ?? 'bottom';
  if (anchor === 'bottom') {
    model.position.x += p.position.x - center.x;
    model.position.z += p.position.z - center.z;
    model.position.y += p.position.y - box.min.y;
  } else if (anchor === 'center') {
    model.position.add(p.position.clone().sub(center));
  } else {
    model.position.x += p.position.x - center.x;
    model.position.z += p.position.z - center.z;
    model.position.y += p.position.y - box.max.y;
  }
  if (p.castShadow === false) {
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = false;
    });
  }
  scene.add(model);
  return model;
}

/**
 * BSOD世界への「再マテリアル化」
 * 元のPBRのディテールを残しつつ、青系の自発光・エラー色を注入する。
 */
export function rematerializeVoid(root: THREE.Object3D, opts: { tint?: THREE.Color; emissiveBoost?: number; wire?: boolean } = {}): void {
  const tint = opts.tint ?? new THREE.Color(0x2b62d8);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const newMats = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) return m;
      const c = std.clone();
      if (c.color) {
        c.color.lerp(tint, 0.62);
      }
      if (c.emissive) {
        c.emissive.copy(tint).multiplyScalar(0.18 * (opts.emissiveBoost ?? 1));
      }
      if (c.metalness !== undefined) c.metalness = Math.min(1, c.metalness * 1.15 + 0.12);
      if (c.roughness !== undefined) c.roughness = c.roughness * 0.92;
      c.envMapIntensity = 1.25;
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** 全マテリアルの envMapIntensity を一括調整 */
export function setEnvIntensity(root: THREE.Object3D, v: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) std.envMapIntensity = v;
    }
  });
}

export { disposeObject };
