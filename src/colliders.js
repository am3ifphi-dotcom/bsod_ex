/**
 * 平面（XZ）AABB コライダー
 * -------------------------------------------------------------
 * プレイヤーを「円」として扱い、めり込んだら最も近い辺へ押し出す。
 */
import * as THREE from 'three';

const _box = new THREE.Box3();

export class Colliders {
  constructor() {
    /** @type {{x0:number,z0:number,x1:number,z1:number,tag:string}[]} */
    this.items = [];
  }

  addBox(x0, z0, x1, z1, tag = '') {
    this.items.push({
      x0: Math.min(x0, x1),
      z0: Math.min(z0, z1),
      x1: Math.max(x0, x1),
      z1: Math.max(z0, z1),
      tag,
    });
    return this;
  }

  /** Object3D のワールド AABB を登録（回転していても外接箱で扱う） */
  addObject(obj, pad = 0, tag = '') {
    obj.updateMatrixWorld(true);
    _box.setFromObject(obj);
    if (!isFinite(_box.min.x) || _box.isEmpty()) return this;
    return this.addBox(_box.min.x - pad, _box.min.z - pad, _box.max.x + pad, _box.max.z + pad, tag);
  }

  /** 円を押し出す。返り値は補正後の位置 */
  resolve(px, pz, r) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.items.length; i++) {
        const c = this.items[i];
        if (px + r < c.x0 || px - r > c.x1 || pz + r < c.z0 || pz - r > c.z1) continue;
        const cx = Math.max(c.x0, Math.min(px, c.x1));
        const cz = Math.max(c.z0, Math.min(pz, c.z1));
        const dx = px - cx;
        const dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          px = cx + (dx / d) * r;
          pz = cz + (dz / d) * r;
        } else {
          // 箱の内部に入ってしまった：一番近い辺から外へ
          const left = px - c.x0;
          const right = c.x1 - px;
          const top = pz - c.z0;
          const bottom = c.z1 - pz;
          const m = Math.min(left, right, top, bottom);
          if (m === left) px = c.x0 - r;
          else if (m === right) px = c.x1 + r;
          else if (m === top) pz = c.z0 - r;
          else pz = c.z1 + r;
        }
      }
    }
    return { x: px, z: pz };
  }

  /** デバッグ表示用 */
  get count() {
    return this.items.length;
  }
}
