import * as THREE from 'three';
import { clamp, damp } from './util';

export type Box = { min: THREE.Vector3; max: THREE.Vector3; tag?: string };

export class PhysicsWorld {
  boxes: Box[] = [];
  groundHeight: (x: number, z: number) => number = () => 0;
  bounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
  private tmp = new THREE.Vector3();

  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tag = 'solid') {
    const box: Box = {
      min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
      tag,
    };
    this.boxes.push(box);
    return box;
  }

  /** Highest walkable surface at (x,z) that is reachable from `feet`. */
  supportAt(x: number, z: number, feet: number, step = 0.42) {
    let best = this.groundHeight(x, z);
    for (const b of this.boxes) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      const top = b.max.y;
      if (top > best && top <= feet + step) best = top;
    }
    return best;
  }

  private overlapsXZ(b: Box, x: number, z: number, r: number) {
    const dx = Math.max(b.min.x - x, 0, x - b.max.x);
    const dz = Math.max(b.min.z - z, 0, z - b.max.z);
    return dx * dx + dz * dz < r * r;
  }

  /** slide-resolve one axis at a time; returns whether a wall was touched */
  moveHorizontal(pos: THREE.Vector3, dx: number, dz: number, radius: number, height: number) {
    // anything whose top is within one comfortable step is walked over, everything
    // taller is a wall (0.38 m covers the 0.32 m stair treads used in the world)
    const low = pos.y + 0.38;
    const high = pos.y + height;
    let hit = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (radius * 0.6)));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      // X axis
      if (sx !== 0) {
        pos.x += sx;
        for (const b of this.boxes) {
          if (b.max.y <= low || b.min.y >= high) continue;
          if (!this.overlapsXZ(b, pos.x, pos.z, radius)) continue;
          if (sx > 0) pos.x = Math.min(pos.x, b.min.x - radius - 0.001);
          else pos.x = Math.max(pos.x, b.max.x + radius + 0.001);
          hit = true;
        }
        pos.x = clamp(pos.x, this.bounds.minX + radius, this.bounds.maxX - radius);
      }
      // Z axis
      if (sz !== 0) {
        pos.z += sz;
        for (const b of this.boxes) {
          if (b.max.y <= low || b.min.y >= high) continue;
          if (!this.overlapsXZ(b, pos.x, pos.z, radius)) continue;
          if (sz > 0) pos.z = Math.min(pos.z, b.min.z - radius - 0.001);
          else pos.z = Math.max(pos.z, b.max.z + radius + 0.001);
          hit = true;
        }
        pos.z = clamp(pos.z, this.bounds.minZ + radius, this.bounds.maxZ - radius);
      }
    }
    // safety: never remain *inside* a solid (only when the centre is inside the box)
    for (const b of this.boxes) {
      if (b.max.y <= low || b.min.y >= high) continue;
      if (pos.x < b.min.x || pos.x > b.max.x || pos.z < b.min.z || pos.z > b.max.z) continue;
      if (!this.overlapsXZ(b, pos.x, pos.z, radius)) continue;
      const pushLeft = pos.x - (b.min.x - radius);
      const pushRight = b.max.x + radius - pos.x;
      const pushBack = pos.z - (b.min.z - radius);
      const pushFront = b.max.z + radius - pos.z;
      const m = Math.min(pushLeft, pushRight, pushBack, pushFront);
      if (m === pushLeft) pos.x -= pushLeft + 0.001;
      else if (m === pushRight) pos.x += pushRight + 0.001;
      else if (m === pushBack) pos.z -= pushBack + 0.001;
      else pos.z += pushFront + 0.001;
      hit = true;
    }
    return hit;
  }

  /** test a straight line of sight (used by interactables) */
  segmentBlocked(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = this.tmp.copy(to).sub(from);
    const len = dir.length();
    dir.normalize();
    const ray = new THREE.Ray(from, dir);
    const hit = new THREE.Vector3();
    for (const b of this.boxes) {
      const box = new THREE.Box3(b.min, b.max);
      if (ray.intersectBox(box, hit)) {
        if (hit.distanceTo(from) < len - 0.05) return true;
      }
    }
    return false;
  }
}

export type PlayerEvents = {
  onFootstep?: (kind: 'wood' | 'concrete' | 'metal' | 'shard', strength: number) => void;
  onLand?: (strength: number) => void;
};

export class Player {
  pos = new THREE.Vector3(0, 0, 0);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  height = 1.7;
  radius = 0.34;
  eyeHeight = 1.62;
  walkSpeed = 3.55;
  runSpeed = 7.1;
  accel = 12;
  gravity = 22;
  grounded = true;
  enabled = true;
  bob = 0;
  bobPhase = 0;
  bobStrength = 1;
  mouseShake = 0;
  moveSpeed = 0;
  lastStepDist = 0;
  surface: 'wood' | 'concrete' | 'metal' | 'shard' = 'concrete';
  events: PlayerEvents = {};
  private coyote = 0;
  private smoothVel = new THREE.Vector3();
  private lookInertia = new THREE.Vector2();

  reset(pos: THREE.Vector3, yaw = 0, pitch = 0) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.smoothVel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.bob = 0;
    this.bobPhase = 0;
    this.grounded = true;
    this.lastStepDist = 0;
    this.lookInertia.set(0, 0);
  }

  look(dx: number, dy: number, sensitivity: number) {
    const s = 0.0022 * sensitivity;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.45, 1.45);
    this.mouseShake = Math.min(1.4, this.mouseShake + Math.min(1, Math.hypot(dx, dy) / 40));
    this.lookInertia.x += dx * s * 0.4;
    this.lookInertia.y += dy * s * 0.4;
  }

  update(dt: number, input: { forward: number; strafe: number; run: boolean }, physics: PhysicsWorld) {
    dt = Math.min(dt, 0.05);
    const speed = input.run ? this.runSpeed : this.walkSpeed;
    const wish = new THREE.Vector3(input.strafe, 0, input.forward);
    if (wish.lengthSq() > 1) wish.normalize();
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // camera forward is (-sin(yaw), 0, -cos(yaw)) for three.js YXZ euler
    const worldWish = new THREE.Vector3(wish.x * cos - wish.z * sin, 0, -wish.x * sin - wish.z * cos);

    const target = worldWish.multiplyScalar(this.enabled ? speed : 0);
    const k = 1 - Math.exp(-this.accel * dt);
    this.smoothVel.x += (target.x - this.smoothVel.x) * k;
    this.smoothVel.z += (target.z - this.smoothVel.z) * k;

    const before = this.pos.clone();
    physics.moveHorizontal(this.pos, this.smoothVel.x * dt, this.smoothVel.z * dt, this.radius, this.height);

    // vertical
    const support = physics.supportAt(this.pos.x, this.pos.z, this.pos.y);
    this.vel.y -= this.gravity * dt;
    if (this.pos.y <= support + 0.001) {
      if (!this.grounded && this.vel.y < -3) {
        this.events.onLand?.(Math.min(1, -this.vel.y / 12));
      }
      this.pos.y = support;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y - support < 0.46 && this.grounded) {
      // walk up steps
      this.pos.y = support;
      this.vel.y = 0;
    } else {
      this.grounded = false;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y < support) {
        this.pos.y = support;
        this.grounded = true;
        this.vel.y = 0;
      }
    }

    const moved = this.pos.clone().sub(before);
    moved.y = 0;
    const dist = moved.length();
    this.moveSpeed = dist / Math.max(dt, 0.0001);
    if (this.grounded && this.enabled) {
      this.bobPhase += dist * (input.run ? 2.4 : 3.1);
      this.lastStepDist += dist;
      const stride = input.run ? 1.15 : 0.85;
      if (this.lastStepDist > stride) {
        this.lastStepDist = 0;
        const strength = clamp(this.moveSpeed / this.runSpeed + 0.25, 0.35, 1);
        this.events.onFootstep?.(this.surface, strength);
      }
    }
    const speedFactor = clamp(this.moveSpeed / this.runSpeed);
    this.bob = Math.sin(this.bobPhase * 2.1) * 0.021 * speedFactor + Math.sin(this.bobPhase) * 0.006;
    this.mouseShake = Math.max(0, this.mouseShake - dt * 4);
    this.lookInertia.x = damp(this.lookInertia.x, 0, 9, dt);
    this.lookInertia.y = damp(this.lookInertia.y, 0, 9, dt);
    return this.moveSpeed;
  }

  applyCamera(camera: THREE.PerspectiveCamera, time: number, shakeScale = 1) {
    const bob = this.bob * this.bobStrength;
    const breath = Math.sin(time * 1.1) * 0.0028 * this.bobStrength;
    const swayX = Math.cos(this.bobPhase) * 0.012 * this.bobStrength * shakeScale;
    const shake = this.mouseShake * 0.004 * shakeScale;
    camera.position.set(
      this.pos.x + swayX + Math.sin(time * 37.1) * shake,
      this.pos.y + this.eyeHeight + bob + breath + Math.sin(time * 41.7) * shake,
      this.pos.z + Math.cos(time * 33.3) * shake,
    );
    const euler = new THREE.Euler(
      this.pitch + this.lookInertia.y * 0.35 + Math.sin(time * 0.7) * 0.0009,
      this.yaw + this.lookInertia.x * 0.35,
      -this.lookInertia.x * 0.25 - Math.sin(this.bobPhase) * 0.004 * this.bobStrength,
      'YXZ',
    );
    camera.quaternion.setFromEuler(euler);
  }
}
