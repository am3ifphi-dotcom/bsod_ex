import * as THREE from 'three';
import type { CollisionWorld } from './Collision';
import { clamp, damp, Spring } from './math';

export interface PlayerMoveInput {
  /** local right (+1) / left (-1) */
  x: number;
  /** local forward (+1) / back (-1) */
  y: number;
  sprint: boolean;
}

export interface FootstepEvent {
  position: THREE.Vector3;
  intensity: number;
  sprinting: boolean;
}

/**
 * First-person controller. Eye height, stride and damping are tuned for a calm, heavy walk —
 * the horror comes from the environment, not from a floaty camera.
 */
export class Player {
  readonly position = new THREE.Vector3(); // feet
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  radius = 0.33;
  height = 1.74;
  eyeHeight = 1.62;
  stepHeight = 0.46;

  walkSpeed = 4.05;
  sprintSpeed = 8.1;
  gravity = 24;
  controlEnabled = true;

  grounded = true;
  wasGrounded = true;

  private bobPhase = 0;
  private bobStrength = 0;
  private lateralLean = 0;
  private yawVelocity = 0;
  private stepAccum = 0;
  private stride = 0.82;
  private breathePhase = 0;
  private landing = new Spring(140, 16);
  private landingRoll = new Spring(90, 12);
  private speedSmooth = 0;
  private lastY = 0;
  private fallSpeedPeak = 0;

  onFootstep?: (e: FootstepEvent) => void;
  surfaceAt?: (x: number, z: number) => string;

  reset(x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.grounded = true;
    this.wasGrounded = true;
    this.stepAccum = 0;
    this.bobPhase = 0;
    this.bobStrength = 0;
    this.landing.reset();
    this.landingRoll.reset();
    this.speedSmooth = 0;
    this.fallSpeedPeak = 0;
    this.lastY = y;
  }

  look(dxPixels: number, dyPixels: number, sensitivity: number): void {
    if (!this.controlEnabled) return;
    const base = 0.0022 * sensitivity;
    this.yaw -= dxPixels * base;
    this.pitch = clamp(this.pitch - dyPixels * base, -1.48, 1.48);
  }

  /** Apply a camera impulse (used when landing hard, stumbling, etc). */
  kick(strength: number): void {
    this.landing.impulse(strength);
    this.landingRoll.impulse(strength * 0.35);
  }

  update(dt: number, input: PlayerMoveInput, collision: CollisionWorld, cameraMotion: number): void {
    dt = Math.min(dt, 1 / 20);
    const prevY = this.position.y;
    const control = this.controlEnabled;

    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    let wishX = 0, wishZ = 0;
    if (control) {
      wishX = fwdX * input.y + rightX * input.x;
      wishZ = fwdZ * input.y + rightZ * input.x;
      const len = Math.hypot(wishX, wishZ);
      if (len > 1) { wishX /= len; wishZ /= len; }
    }
    const sprinting = control && input.sprint && (input.x !== 0 || input.y !== 0);
    const targetSpeed = sprinting ? this.sprintSpeed : this.walkSpeed;
    const desiredX = wishX * targetSpeed;
    const desiredZ = wishZ * targetSpeed;

    const accel = this.grounded ? 13 : 2.4;
    this.velocity.x = damp(this.velocity.x, desiredX, accel, dt);
    this.velocity.z = damp(this.velocity.z, desiredZ, accel, dt);
    if (Math.hypot(desiredX, desiredZ) < 0.001) {
      const friction = this.grounded ? 11 : 0.4;
      this.velocity.x = damp(this.velocity.x, 0, friction, dt);
      this.velocity.z = damp(this.velocity.z, 0, friction, dt);
    }

    // --- horizontal collision (substepped) ---------------------------------------------
    const res = collision.resolveHorizontal(
      this.position.x, this.position.z,
      this.velocity.x * dt, this.velocity.z * dt,
      this.radius, this.position.y, this.height, this.stepHeight,
    );
    if (res.blocked) {
      // kill the velocity component that pushed us into the wall (prevents sticking)
      const dx = res.x - this.position.x;
      const dz = res.z - this.position.z;
      if (Math.abs(dx) < Math.abs(this.velocity.x * dt) * 0.6) this.velocity.x *= 0.25;
      if (Math.abs(dz) < Math.abs(this.velocity.z * dt) * 0.6) this.velocity.z *= 0.25;
    }
    this.position.x = res.x;
    this.position.z = res.z;

    // --- vertical ----------------------------------------------------------------------
    const supportY = collision.supportAt(this.position.x, this.position.z, this.radius, this.position.y + this.stepHeight);
    this.velocity.y -= this.gravity * dt;
    let ny = this.position.y + this.velocity.y * dt;

    if (supportY !== null && ny <= supportY + 0.002) {
      // landed / standing
      if (!this.grounded && this.velocity.y < -7) {
        const impact = clamp(-this.velocity.y / 22, 0, 1.2);
        this.landing.impulse(impact * 2.6);
        this.landingRoll.impulse(impact * 0.8);
      }
      ny = supportY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (this.grounded && supportY !== null && supportY < this.position.y
      && this.position.y - supportY < this.stepHeight + 0.4 && this.velocity.y <= 0.001) {
      // walking down stairs: keep contact instead of hopping
      ny = supportY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // head clearance
    const ceiling = collision.ceilingAt(this.position.x, this.position.z, this.radius, this.position.y + 0.2);
    if (ceiling !== null && ny + this.height > ceiling) {
      ny = ceiling - this.height;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
    this.position.y = ny;

    // --- camera feel -------------------------------------------------------------------
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speedSmooth = damp(this.speedSmooth, speed, 8, dt);
    const moving = speed > 0.35 && this.grounded;
    this.stride = sprinting ? 1.15 : 0.78;
    if (moving) {
      this.bobPhase += (speed / this.stride) * dt * Math.PI;
      this.bobStrength = damp(this.bobStrength, clamp(speed / this.walkSpeed, 0.4, 1.7), 6, dt);
      this.stepAccum += speed * dt;
      if (this.stepAccum > this.stride) {
        this.stepAccum -= this.stride;
        this.onFootstep?.({
          position: this.position.clone(),
          intensity: clamp(speed / this.sprintSpeed, 0.35, 1),
          sprinting,
        });
      }
    } else {
      this.bobStrength = damp(this.bobStrength, 0, 7, dt);
    }
    this.breathePhase += dt * (0.55 + (sprinting ? 0.55 : 0) + Math.max(0, this.fallSpeedPeak) * 0.04);

    this.landing.update(dt);
    this.landingRoll.update(dt);
    this.lateralLean = damp(this.lateralLean, clamp(-this.yawVelocity * 0.012, -0.05, 0.05), 6, dt);
    this.yawVelocity = damp(this.yawVelocity, 0, 9, dt);

    if (!this.wasGrounded && this.grounded) {
      this.fallSpeedPeak = Math.max(this.fallSpeedPeak, Math.abs(this.lastY - this.position.y));
    }
    this.wasGrounded = this.grounded;
    this.lastY = this.position.y;
    if (this.grounded) this.fallSpeedPeak = damp(this.fallSpeedPeak, 0, 3, dt);
    void prevY;
    this.motionScale = cameraMotion;
  }

  motionScale = 1;

  /** Adds the current turn delta to the lean model (call when mouse look is applied). */
  noteLook(dxPixels: number): void {
    this.yawVelocity += dxPixels * 0.9;
  }

  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.eyeHeight + this.bobVertical,
      this.position.z,
    );
  }

  get bobVertical(): number {
    const m = this.motionScale;
    const bob = Math.sin(this.bobPhase * 2) * 0.021 * this.bobStrength * m;
    const breathe = Math.sin(this.breathePhase * 2) * 0.0035 * m;
    const land = this.landing.value * 0.11;
    return bob + breathe + land;
  }

  get bobLateral(): number {
    const m = this.motionScale;
    return Math.cos(this.bobPhase) * 0.019 * this.bobStrength * m;
  }

  get roll(): number {
    const m = this.motionScale;
    return Math.sin(this.bobPhase) * 0.0055 * this.bobStrength * m
      + this.lateralLean * m
      + this.landingRoll.value * 0.02;
  }

  get bobPitch(): number {
    return Math.sin(this.bobPhase * 2) * 0.0032 * this.bobStrength * this.motionScale
      - this.landing.value * 0.02;
  }

  /** Absolute world-space eye transform, taking head bob / lean into account. */
  applyToCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(
      this.position.x + Math.cos(this.yaw) * this.bobLateral,
      this.position.y + this.eyeHeight + this.bobVertical,
      this.position.z - Math.sin(this.yaw) * this.bobLateral,
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch + this.bobPitch, this.yaw, this.roll);
  }
}
