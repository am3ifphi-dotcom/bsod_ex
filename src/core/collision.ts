/**
 * 衝突判定とキャラクターコントローラー
 * - 高度場(地形) + AABB群 + ランプ(傾斜面) + 階段ステップアップ
 * - ダッシュ時も壁抜け・マップ外脱落しない
 */
import * as THREE from 'three';
import { clamp } from './utils';

export interface BoxCollider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** 上面を歩行可能として扱うか(天井のみのコライダーは false) */
  walkable: boolean;
}

export interface RampCollider {
  /** XZ平面の矩形。axis方向に y0→y1 へ傾く */
  min: THREE.Vector2;
  max: THREE.Vector2;
  y0: number;
  y1: number;
  axis: 'x' | 'z';
  flip: boolean;
}

export interface TerrainSampler {
  /** (x,z) の地形高さ。範囲外なら null */
  heightAt(x: number, z: number): number | null;
}

const PLAYER_RADIUS = 0.32;
const PLAYER_HEIGHT = 1.72;
const EYE_HEIGHT = 1.62;
const STEP_HEIGHT = 0.48;
const GRAVITY = 16.5;

export class CollisionWorld {
  boxes: BoxCollider[] = [];
  ramps: RampCollider[] = [];
  terrains: TerrainSampler[] = [];
  /** 外周の壁(AABBの追加でもよいが、境界は専用) */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  addBox(min: THREE.Vector3, max: THREE.Vector3, walkable = true): void {
    this.boxes.push({ min: min.clone(), max: max.clone(), walkable });
  }

  addBoxCentered(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, walkable = true): void {
    this.addBox(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
      walkable,
    );
  }

  addRamp(minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number, axis: 'x' | 'z', flip = false): void {
    this.ramps.push({ min: new THREE.Vector2(minX, minZ), max: new THREE.Vector2(maxX, maxZ), y0, y1, axis, flip });
  }

  addTerrain(t: TerrainSampler): void {
    this.terrains.push(t);
  }

  terrainHeight(x: number, z: number): number | null {
    let best: number | null = null;
    for (const t of this.terrains) {
      const h = t.heightAt(x, z);
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best;
  }

  rampHeightAt(x: number, z: number): number | null {
    let best: number | null = null;
    for (const r of this.ramps) {
      if (x < r.min.x || x > r.max.x || z < r.min.y || z > r.max.y) continue;
      const t = r.axis === 'x' ? (x - r.min.x) / Math.max(0.001, r.max.x - r.min.x) : (z - r.min.y) / Math.max(0.001, r.max.y - r.min.y);
      const tt = r.flip ? 1 - t : t;
      const y = r.y0 + (r.y1 - r.y0) * tt;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  /** (x,z) 上の歩行可能な最高上面(box上面/ランプ/地形) */
  surfaceHeight(x: number, z: number, fromY: number): number {
    let best = -Infinity;
    // ボックス上面
    for (const b of this.boxes) {
      if (!b.walkable) continue;
      if (x < b.min.x - PLAYER_RADIUS || x > b.max.x + PLAYER_RADIUS) continue;
      if (z < b.min.z - PLAYER_RADIUS || z > b.max.z + PLAYER_RADIUS) continue;
      if (b.max.y <= fromY + STEP_HEIGHT && b.max.y > best) best = b.max.y;
    }
    const ramp = this.rampHeightAt(x, z);
    if (ramp !== null && ramp <= fromY + STEP_HEIGHT + 0.6 && ramp > best) best = ramp;
    const terr = this.terrainHeight(x, z);
    if (terr !== null && terr <= fromY + STEP_HEIGHT + 2.5 && terr > best) best = terr;
    return best;
  }
}

export interface MoveResult {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  groundNormal: THREE.Vector3;
  hitWall: boolean;
}

export class CharacterController {
  position = new THREE.Vector3(0, 2, 0);
  velocity = new THREE.Vector3();
  grounded = false;
  /** 外部から姿勢を奪う(強制演出中) */
  disabled = false;
  eyeHeight = EYE_HEIGHT;
  radius = PLAYER_RADIUS;

  private tmp = new THREE.Vector3();

  constructor(private world: CollisionWorld) {}

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
  }

  /**
   * 1フレーム移動
   * @param wishDir 進行方向(ワールドXZ, 正規化済み)
   * @param speed   水平速度 m/s
   * @param dt      デルタ
   */
  update(wishDir: THREE.Vector3, speed: number, dt: number): MoveResult {
    const pos = this.position;
    const vel = this.velocity;
    let hitWall = false;

    if (this.disabled) {
      vel.x *= Math.exp(-6 * dt);
      vel.z *= Math.exp(-6 * dt);
    } else {
      // 応答の速い水平制御
      const accel = this.grounded ? 42 : 12;
      const targetX = wishDir.x * speed;
      const targetZ = wishDir.z * speed;
      vel.x += (targetX - vel.x) * Math.min(1, accel * dt);
      vel.z += (targetZ - vel.z) * Math.min(1, accel * dt);
      if (wishDir.lengthSq() < 0.0001 && this.grounded) {
        const damp = Math.exp(-13 * dt);
        vel.x *= damp;
        vel.z *= damp;
      }
    }

    // 重力
    vel.y -= GRAVITY * dt;
    if (vel.y < -55) vel.y = -55;

    // --- 水平移動と壁押し出し ---
    const dx = vel.x * dt;
    const dz = vel.z * dt;

    // X軸
    pos.x += dx;
    hitWall = this.resolveHorizontal('x', dx) || hitWall;
    // Z軸
    pos.z += dz;
    hitWall = this.resolveHorizontal('z', dz) || hitWall;

    // 境界
    const b = this.world.bounds;
    if (b) {
      const minX = b.minX + this.radius;
      const maxX = b.maxX - this.radius;
      const minZ = b.minZ + this.radius;
      const maxZ = b.maxZ - this.radius;
      if (pos.x < minX) {
        pos.x = minX;
        vel.x = Math.max(0, vel.x);
        hitWall = true;
      }
      if (pos.x > maxX) {
        pos.x = maxX;
        vel.x = Math.min(0, vel.x);
        hitWall = true;
      }
      if (pos.z < minZ) {
        pos.z = minZ;
        vel.z = Math.max(0, vel.z);
        hitWall = true;
      }
      if (pos.z > maxZ) {
        pos.z = maxZ;
        vel.z = Math.min(0, vel.z);
        hitWall = true;
      }
    }

    // --- 垂直移動 ---
    const feet = pos.y; // feet position
    let newFeet = feet + vel.y * dt;
    const ground = this.world.surfaceHeight(pos.x, pos.z, feet);

    let grounded = false;
    if (ground > -Infinity && newFeet <= ground && vel.y <= 0.001) {
      // 着地 / 歩行
      newFeet = ground;
      vel.y = 0;
      grounded = true;
    }

    // 天井(ボックスの下)は単純化: 高い位置に潜り込まないよう頭上チェック
    pos.y = newFeet;

    // ステップアップ: 低い段差で足が空に浮いた場合は面へ吸着
    if (!grounded && vel.y < 0.001 && vel.y > -2.5) {
      const g2 = this.world.surfaceHeight(pos.x, pos.z, pos.y + STEP_HEIGHT);
      if (g2 > -Infinity && pos.y - g2 < STEP_HEIGHT && pos.y - g2 > -0.35) {
        pos.y = g2;
        vel.y = 0;
        grounded = true;
      }
    }

    this.grounded = grounded;
    return {
      position: pos,
      velocity: vel,
      grounded,
      groundNormal: new THREE.Vector3(0, 1, 0),
      hitWall,
    };
  }

  /** 水平方向の壁押し出し(軸分離) */
  private resolveHorizontal(axis: 'x' | 'z', delta: number): boolean {
    const pos = this.position;
    const feet = pos.y;
    const headY = feet + PLAYER_HEIGHT;
    let hit = false;
    for (const b of this.world.boxes) {
      // 縦の重なり: 足がボックス上面より下、頭が下面より上 = 交差
      const overlapY = headY > b.min.y + 0.02 && feet < b.max.y - STEP_HEIGHT;
      if (!overlapY) continue;
      // 上に乗れる低い段差なら階段として無視(ステップアップ対象)
      if (b.max.y - feet <= STEP_HEIGHT && b.max.y > feet - 0.05) continue;

      const px = pos.x;
      const pz = pos.z;
      const inX = px > b.min.x - this.radius && px < b.max.x + this.radius;
      const inZ = pz > b.min.z - this.radius && pz < b.max.z + this.radius;
      if (inX && inZ) {
        hit = true;
        if (axis === 'x') {
          if (delta > 0) pos.x = b.min.x - this.radius;
          else if (delta < 0) pos.x = b.max.x + this.radius;
          else {
            // 押し出し(最短)
            const dl = Math.abs(px - (b.min.x - this.radius));
            const dr = Math.abs(b.max.x + this.radius - px);
            pos.x = dl < dr ? b.min.x - this.radius : b.max.x + this.radius;
          }
          this.velocity.x = 0;
        } else {
          if (delta > 0) pos.z = b.min.z - this.radius;
          else if (delta < 0) pos.z = b.max.z + this.radius;
          else {
            const dl = Math.abs(pz - (b.min.z - this.radius));
            const dr = Math.abs(b.max.z + this.radius - pz);
            pos.z = dl < dr ? b.min.z - this.radius : b.max.z + this.radius;
          }
          this.velocity.z = 0;
        }
      }
    }
    return hit;
  }

  /** 頭部位置 */
  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.eyeHeight);
  }

  /** 立ち止まり用の減速 */
  dampVelocity(lambda: number, dt: number): void {
    const f = Math.exp(-lambda * dt);
    this.velocity.x *= f;
    this.velocity.z *= f;
  }
}

export { clamp };
