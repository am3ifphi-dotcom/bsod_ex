/**
 * Collision & navigation volumes.
 *
 * The whole walkable world is described with axis aligned solids (boxes) plus walkable ramps
 * (used for stairs, so the player glides up them instead of fighting every step). Everything
 * here is dependency free and unit-testable in Node — see tests/collision.test.ts.
 *
 * Player model: a vertical capsule approximated by a circle in XZ (radius) and a body span in Y.
 */

export interface Vec3Like { x: number; y: number; z: number; }

export interface Ramp {
  /** Horizontal axis the slope runs along: 0 = x, 2 = z. */
  axis: 0 | 2;
  /** Height at the minimum side of `axis`. */
  yLow: number;
  /** Height at the maximum side of `axis`. */
  yHigh: number;
  /** Ramp surfaces do not block horizontal movement (you walk up them). */
  walkable: boolean;
}

export interface Solid {
  id: number;
  min: [number, number, number];
  max: [number, number, number];
  ramp?: Ramp;
  tag: string;
  enabled: boolean;
}

export type SolidSpec = {
  min: [number, number, number];
  max: [number, number, number];
  ramp?: Ramp;
  tag?: string;
};

const circleRectPush = (
  x: number, z: number, r: number,
  minX: number, minZ: number, maxX: number, maxZ: number,
): { nx: number; nz: number; depth: number } | null => {
  const cx = Math.max(minX, Math.min(x, maxX));
  const cz = Math.max(minZ, Math.min(z, maxZ));
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // centre inside the rect: push along the axis of least penetration
  const left = x - minX, right = maxX - x, back = z - minZ, front = maxZ - z;
  const m = Math.min(left, right, back, front);
  if (m === left) return { nx: -1, nz: 0, depth: left + r };
  if (m === right) return { nx: 1, nz: 0, depth: right + r };
  if (m === back) return { nx: 0, nz: -1, depth: back + r };
  return { nx: 0, nz: 1, depth: front + r };
};

export class CollisionWorld {
  private solids: Solid[] = [];
  private nextId = 1;
  private grid = new Map<string, Solid[]>();
  private cell = 6;
  private dirty = true;
  private lastQueryKey = '';
  private lastQueryResult: Solid[] = [];

  get count(): number { return this.solids.length; }

  add(spec: SolidSpec): Solid {
    const s: Solid = {
      id: this.nextId++,
      min: [...spec.min] as [number, number, number],
      max: [...spec.max] as [number, number, number],
      ramp: spec.ramp,
      tag: spec.tag ?? 'world',
      enabled: true,
    };
    this.solids.push(s);
    this.dirty = true;
    return s;
  }

  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tag = 'world'): Solid {
    return this.add({
      min: [cx - sx / 2, cy - sy / 2, cz - sz / 2],
      max: [cx + sx / 2, cy + sy / 2, cz + sz / 2],
      tag,
    });
  }

  /** Remove every solid with `tag` whose horizontal footprint touches the given circle. */
  removeTagNear(tag: string, x: number, z: number, radius: number): number {
    let n = 0;
    for (const s of this.solids) {
      if (!s.enabled || s.tag !== tag) continue;
      const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
      const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
      if ((x - cx) ** 2 + (z - cz) ** 2 <= radius * radius) {
        s.enabled = false;
        n++;
      }
    }
    if (n) this.dirty = true;
    return n;
  }

  /**
   * Disable every floor-like solid (top surface within reach of the feet) whose footprint
   * touches the circle. Used when the ground shatters in the collapse sequence.
   */
  disableFloorNear(x: number, feetY: number, z: number, radius: number): number {
    let n = 0;
    for (const s of this.solids) {
      if (!s.enabled) continue;
      const top = s.max[1];
      if (top < feetY - 1.6 || top > feetY + 1.0) continue;
      const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
      const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
      if ((x - cx) ** 2 + (z - cz) ** 2 <= radius * radius) {
        s.enabled = false;
        n++;
      }
    }
    if (n) this.dirty = true;
    return n;
  }

  /** Re-enable everything (used when the experience restarts). */
  restoreAll(): number {
    let n = 0;
    for (const s of this.solids) {
      if (!s.enabled) { s.enabled = true; n++; }
    }
    if (n) this.dirty = true;
    return n;
  }

  clear(): void {
    this.solids.length = 0;
    this.grid.clear();
    this.dirty = true;
    this.lastQueryKey = '';
  }

  private key(cx: number, cz: number): string { return `${cx},${cz}`; }

  private rebuild(): void {
    this.grid.clear();
    for (const s of this.solids) {
      if (!s.enabled) continue;
      const x0 = Math.floor(s.min[0] / this.cell), x1 = Math.floor(s.max[0] / this.cell);
      const z0 = Math.floor(s.min[2] / this.cell), z1 = Math.floor(s.max[2] / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = this.key(cx, cz);
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(s);
        }
      }
    }
    this.dirty = false;
    this.lastQueryKey = '';
  }

  /** All enabled solids near a horizontal circle (broad phase). */
  query(x: number, z: number, radius: number): Solid[] {
    if (this.dirty) this.rebuild();
    const k = `${Math.round(x * 2)},${Math.round(z * 2)},${Math.round(radius * 2)}`;
    if (k === this.lastQueryKey) return this.lastQueryResult;
    const out: Solid[] = [];
    const x0 = Math.floor((x - radius) / this.cell), x1 = Math.floor((x + radius) / this.cell);
    const z0 = Math.floor((z - radius) / this.cell), z1 = Math.floor((z + radius) / this.cell);
    const seen = new Set<number>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(this.key(cx, cz));
        if (!arr) continue;
        for (const s of arr) {
          if (!s.enabled || seen.has(s.id)) continue;
          seen.add(s.id);
          out.push(s);
        }
      }
    }
    this.lastQueryKey = k;
    this.lastQueryResult = out;
    return out;
  }

  /** Highest walkable surface under the circle, at or below `maxY`. */
  supportAt(x: number, z: number, radius: number, maxY: number): number | null {
    let best: number | null = null;
    for (const s of this.query(x, z, radius)) {
      const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
      const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > radius * radius * 1.0) continue;
      let top: number;
      if (s.ramp) {
        const t = s.ramp.axis === 0
          ? (x - s.min[0]) / Math.max(1e-6, s.max[0] - s.min[0])
          : (z - s.min[2]) / Math.max(1e-6, s.max[2] - s.min[2]);
        top = s.ramp.yLow + (s.ramp.yHigh - s.ramp.yLow) * Math.max(0, Math.min(1, t));
      } else {
        top = s.max[1];
      }
      if (top > maxY + 1e-4) continue;
      if (best === null || top > best) best = top;
    }
    return best;
  }

  /** Lowest ceiling above the player's head. */
  ceilingAt(x: number, z: number, radius: number, minY: number): number | null {
    let best: number | null = null;
    for (const s of this.query(x, z, radius)) {
      if (s.ramp) continue;
      const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
      const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
      if ((x - cx) ** 2 + (z - cz) ** 2 > radius * radius) continue;
      if (s.max[1] < minY) continue;
      if (best === null || s.min[1] < best) best = s.min[1];
    }
    return best;
  }

  /**
   * Resolve horizontal movement with wall sliding. `substep` keeps fast sprint movement from
   * tunnelling through thin walls. Returns the corrected position and whether we hit anything.
   */
  resolveHorizontal(
    x: number, z: number, dx: number, dz: number,
    radius: number, feetY: number, height: number, stepHeight: number,
    substep = 0.09,
  ): { x: number; z: number; blocked: boolean } {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / substep));
    let px = x, pz = z;
    let blocked = false;
    // Anything whose top is within roughly one step of the feet is treated as a step
    // (the controller lifts onto it via supportAt) instead of a wall.
    const bodyMin = feetY + stepHeight * 0.9;
    const bodyMax = feetY + height;
    for (let i = 0; i < steps; i++) {
      px += dx / steps;
      pz += dz / steps;
      for (let iter = 0; iter < 3; iter++) {
        let adjusted = false;
        for (const s of this.query(px, pz, radius)) {
          if (s.ramp && s.ramp.walkable) continue; // walk up, never block
          // vertical overlap test (a low box is a step, a high box is an overhang)
          if (s.max[1] <= bodyMin) continue;
          if (s.min[1] >= bodyMax) continue;
          const push = circleRectPush(px, pz, radius, s.min[0], s.min[2], s.max[0], s.max[2]);
          if (!push) continue;
          px += push.nx * (push.depth + 1e-4);
          pz += push.nz * (push.depth + 1e-4);
          adjusted = true;
          blocked = true;
        }
        if (!adjusted) break;
      }
    }
    return { x: px, z: pz, blocked };
  }

  /** Is a capsule at this position intersecting anything? Used for safe landing checks. */
  overlaps(x: number, y: number, z: number, radius: number, height: number): boolean {
    for (const s of this.query(x, z, radius)) {
      if (s.ramp && s.ramp.walkable) continue;
      if (s.max[1] <= y + 0.02) continue;
      if (s.min[1] >= y + height) continue;
      if (circleRectPush(x, z, radius, s.min[0], s.min[2], s.max[0], s.max[2])) return true;
    }
    return false;
  }

  /** Snapshot for the dev overlay. */
  getSolidSnapshot(): readonly Solid[] { return this.solids; }
}
