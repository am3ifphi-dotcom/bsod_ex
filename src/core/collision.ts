import * as THREE from 'three';

export type Platform = { x0: number; x1: number; z0: number; z1: number; y: number };
export type Blocker = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; tag?: string };
export type Ramp = { x0: number; x1: number; z0: number; z1: number; yLow: number; yHigh: number; axis: 'x' | 'z'; reverse?: boolean };

/**
 * 歩行面の高さと壁の押し出しを扱う簡易コリジョン。
 * - 段差は stepHeight まで自動で登る (階段 = 連続した Platform)
 * - 屋根 (天井) は考慮しない: プレイヤーが入り込めないよう Blocker で塞ぐ
 */
export class CollisionWorld {
  platforms: Platform[] = [];
  blockers: Blocker[] = [];
  ramps: Ramp[] = [];
  terrain?: (x: number, z: number) => number;
  /** 落下可能な領域 (崩壊演出時のみ true にする) */
  allowFalling = false;

  addPlatform(x0: number, x1: number, z0: number, z1: number, y: number) {
    this.platforms.push({ x0, x1, z0, z1, y });
  }
  addBlocker(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, tag?: string) {
    this.blockers.push({ x0, x1, z0, z1, y0, y1, tag });
  }
  addRamp(r: Ramp) { this.ramps.push(r); }

  /** (x,z) における、fromY から step 以内で立てる最も高い面。無ければ -Infinity */
  groundAt(x: number, z: number, fromY: number, step = 0.52): number {
    let best = -Infinity;
    const consider = (y: number) => {
      if (y <= fromY + step + 0.001 && y > best) best = y;
    };
    if (this.terrain) consider(this.terrain(x, z));
    for (const p of this.platforms) {
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) consider(p.y);
    }
    for (const r of this.ramps) {
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
        const t = r.axis === 'x'
          ? (x - r.x0) / Math.max(1e-5, r.x1 - r.x0)
          : (z - r.z0) / Math.max(1e-5, r.z1 - r.z0);
        const k = r.reverse ? 1 - t : t;
        consider(r.yLow + (r.yHigh - r.yLow) * k);
      }
    }
    return best;
  }

  /** 水平方向の押し出し (円 vs AABB) */
  resolve(pos: THREE.Vector3, radius: number, height = 1.75) {
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.blockers) {
        if (pos.y + height < b.y0 || pos.y >= b.y1 - 1e-4) continue;
        const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
        const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          // 内部にいる: 最短の辺へ押し出す
          const dl = pos.x - b.x0, dr = b.x1 - pos.x;
          const db = pos.z - b.z0, df = b.z1 - pos.z;
          const m = Math.min(dl, dr, db, df);
          if (m === dl) pos.x = b.x0 - radius;
          else if (m === dr) pos.x = b.x1 + radius;
          else if (m === db) pos.z = b.z0 - radius;
          else pos.z = b.z1 + radius;
        }
      }
    }
  }

  clear() { this.platforms.length = 0; this.blockers.length = 0; this.ramps.length = 0; this.terrain = undefined; }
}
