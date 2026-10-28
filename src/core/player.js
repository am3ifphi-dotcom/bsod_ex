import * as THREE from 'three';

/**
 * First-person controller.
 * - camera orientation is smoothed (head inertia / weight)
 * - walk + sprint + gravity + collide-and-slide against the active world
 * - head bob, breathing, landing impulse, footsteps
 */
export class Player {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.eye = 1.62;
    this.radius = 0.34;
    this.gravity = 18;
    this.onGround = true;
    this.bob = 0;
    this.bobAmp = 1;
    this.time = 0;
    this.stamina = 1;
    this.speed = 0;
    this.landImpulse = 0;
    this.roll = 0;
    this.targetRoll = 0;
    this.fov = 64;
    this.baseFov = 64;
    this.lookSpeed = 13;
    this.world = null;
    this.footstepSurface = 'carpet';
    this.stepPhase = 0;
    this.lastStep = 0;
    this._idle = 0;
    this.breathe = true;
    this.bobEnabled = true;
    this.overrideCamera = null;
    this.shake = 0;
    this._tmp = new THREE.Vector3();
  }

  setWorld(world) {
    this.world = world;
    this.eye = world.eyeHeight ?? 1.62;
    this.footstepSurface = world.surface ?? 'carpet';
    this.gravity = world.gravity ?? 18;
    if (world.spawn) this.teleport(world.spawn.pos, world.spawn.yaw, world.spawn.pitch);
  }

  teleport(pos, yaw = this.yaw, pitch = this.pitch) {
    this.pos.copy(pos);
    if (this.world?.sampleGround) this.pos.y = this.world.sampleGround(pos.x, pos.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.roll = this.targetRoll = 0;
    this.onGround = true;
    this.bob = 0;
  }

  setLook(yaw, pitch, immediate = false) {
    this.targetYaw = yaw;
    this.targetPitch = pitch;
    if (immediate) { this.yaw = yaw; this.pitch = pitch; }
  }

  addLook(dx, dy) {
    this.targetYaw -= dx;
    this.targetPitch -= dy;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch, -1.48, 1.48);
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt, input, enabled = true) {
    this.time += dt;
    const world = this.world;

    // ---- look ---------------------------------------------------------
    if (enabled && input) {
      const look = input.consumeLook();
      this.addLook(look.dx, look.dy);
    } else if (input) {
      input.consumeLook();
    }
    const k = 1 - Math.exp(-this.lookSpeed * dt);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.targetRoll *= Math.exp(-4 * dt);
    this.roll += (this.targetRoll - this.roll) * (1 - Math.exp(-6 * dt));

    // ---- move ---------------------------------------------------------
    let wish = { x: 0, z: 0, len: 0 };
    if (enabled && input) wish = input.moveVector();
    const sprint = enabled && input?.sprint && wish.len > 0.1;
    const targetSpeed = (sprint ? 3.9 : 2.35) * wish.len;
    const accel = this.onGround ? 14 : 3.2;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wishDir = new THREE.Vector3()
      .addScaledVector(right, wish.x)
      .addScaledVector(fwd, wish.z);
    if (wishDir.lengthSq() > 0) wishDir.normalize();

    const desired = wishDir.clone().multiplyScalar(targetSpeed);
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (desired.x - this.vel.x) * a;
    this.vel.z += (desired.z - this.vel.z) * a;
    if (wish.len < 0.05 && this.onGround) {
      const fr = 1 - Math.exp(-9 * dt);
      this.vel.x -= this.vel.x * fr;
      this.vel.z -= this.vel.z * fr;
    }

    // gravity / jump
    if (world?.gravity) {
      this.vel.y -= world.gravity * dt;
      if (enabled && input?.pressed('Space') && this.onGround) {
        this.vel.y = 5.0;
        this.onGround = false;
      }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    if (world?.collide) world.collide(this.pos, this.radius);
    const groundY = world?.sampleGround ? world.sampleGround(this.pos.x, this.pos.z) : 0;
    if (this.pos.y <= groundY + 0.001) {
      if (!this.onGround && this.vel.y < -5.5) this.landImpulse = Math.min(1, -this.vel.y / 12);
      this.pos.y = groundY;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.vel.y < -0.2) {
      this.onGround = false;
    }

    // ---- bob / footsteps ---------------------------------------------
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed += (hSpeed - this.speed) * (1 - Math.exp(-8 * dt));
    this.stepPhase += hSpeed * dt * 2.15;
    if (this.onGround && hSpeed > 0.45) {
      const s = Math.floor(this.stepPhase / Math.PI);
      if (s !== this.lastStep) {
        this.lastStep = s;
        this.audio?.footstep(this.footstepSurface, Math.min(1, hSpeed / 3.4));
        this.bob += 1;
      }
    }
    this._idle = hSpeed < 0.12 ? Math.min(1, this._idle + dt) : Math.max(0, this._idle - dt * 3);
    this.bobAmp = THREE.MathUtils.lerp(this.bobAmp, this.onGround ? Math.min(1, hSpeed / 2.4) : 0, 1 - Math.exp(-6 * dt));
    this.landImpulse *= Math.exp(-6 * dt);
    this.shake *= Math.exp(-5 * dt);
    this.fov = THREE.MathUtils.lerp(this.fov, this.baseFov + (sprint ? 4 : 0), 1 - Math.exp(-6 * dt));

    this.applyCamera();
  }

  applyCamera() {
    const cam = this.camera;
    const t = this.time;
    const bobEnabled = this.bobEnabled;
    const bobY = bobEnabled ? Math.sin(this.stepPhase * 2) * 0.028 * this.bobAmp : 0;
    const bobX = bobEnabled ? Math.cos(this.stepPhase) * 0.022 * this.bobAmp : 0;
    const breathe = bobEnabled ? Math.sin(t * 1.15) * 0.006 * (0.35 + this._idle * 0.65) : 0;
    const land = this.landImpulse * 0.16;
    const shakeX = (Math.random() - 0.5) * this.shake * 0.02;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.02;

    cam.position.set(
      this.pos.x + bobX * 0.6 + shakeX,
      this.pos.y + this.eye + bobY + breathe - land + shakeY,
      this.pos.z
    );
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;
    cam.rotation.z = this.roll + bobX * 0.35;
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
