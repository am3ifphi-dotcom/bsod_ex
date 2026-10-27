// アセットローダー(メッシュオプトGLB対応)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class AssetManager {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.cache = new Map();
    this._progressCb = null;
    this.manager.onProgress = (url, loaded, total) => {
      if (this._progressCb) this._progressCb(loaded / total, url);
    };
  }

  onProgress(cb) { this._progressCb = cb; }

  async loadGLB(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    const gltf = await this.gltfLoader.loadAsync(url);
    this.cache.set(url, gltf);
    return gltf;
  }

  async loadTexture(url) {
    const key = 'tex:' + url;
    if (this.cache.has(key)) return this.cache.get(key);
    const tex = await this.textureLoader.loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }
}

// GLBシーンを指定サイズに正規化してクローン
export function instantiateModel(gltf, opts = {}) {
  const root = gltf.scene.clone(true);
  // スキン等は無い(静的モデルのみ使用)
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = opts.castShadow ?? true;
      o.receiveShadow = opts.receiveShadow ?? true;
      if (opts.materials) {
        if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
        else o.material = o.material.clone();
      }
    }
  });
  if (opts.targetHeight || opts.targetSize) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = opts.targetHeight
      ? opts.targetHeight / size.y
      : Math.min(opts.targetSize / size.x, opts.targetSize / size.y, opts.targetSize / size.z);
    root.scale.multiplyScalar(s);
  }
  return root;
}

// 静的モデルをマテリアル単位に融合し、ドローコールを削減(テレイン/背景用)
export function bakeStaticModel(root) {
  const byMat = new Map();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  });
  const out = new THREE.Group();
  let baked = false;
  for (const [mat, geos] of byMat) {
    try {
      const merged = mergeGeometries(geos, false);
      if (!merged) throw new Error('merge failed');
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      out.add(mesh);
      baked = true;
    } catch {
      out.add(root); // フォールバック: 融合できなければ元を使用
      return out;
    }
  }
  out.userData.baked = baked;
  return out;
}

// モデルを床(指定y)に接地
export function placeOnFloor(obj, floorY = 0) {
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y += floorY - box.min.y;
}

export function findNode(root, predicate) {
  let found = null;
  root.traverse((o) => { if (!found && predicate(o)) found = o; });
  return found;
}

export function findNodes(root, predicate) {
  const out = [];
  root.traverse((o) => { if (predicate(o)) out.push(o); });
  return out;
}
