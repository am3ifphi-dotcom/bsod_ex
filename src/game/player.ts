// First-person controller: Rapier kinematic capsule, head bob, look inertia.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../core/physics';
import { Input } from '../core/input';
import { settings } from '../core/settings';
import { clamp, damp } from '../core/utils';

export type Surface = 'wood' | 'carpet' | 'concrete' | 'sand' | 'metal' | 'glass';

const EYE = 1.62;
const RADIUS = 0.3;
const HALF = 0.55;               // capsule half height (cylinder part)
const GRAVITY = 21;

export class Player {
  yaw = 0;
  pitch = 0;
  feet = new THREE.Vector3(0, 0, 0);
  velocity = new THREE.Vector3();
  grounded = false;
  enabled = true;
  /** when false the game (a sequence) owns the camera transform */
  controlCamera = true;
  surface: Surface = 'wood';
  onFootstep: ((s: Surface, running: boolean) => void) | null = null;

  private body!: RAPIER.RigidBody;
  private collider!: RAPIER.Collider;
  private cc!: RAPIER.KinematicCharacterController;
  private physics: Physics;
  private input: Input;
  private camera: THREE.PerspectiveCamera;

  private bobT = 0;
  private bobAmt = 0;
  private landDip = 0;
  private landVel = 0;
  private stepDist = 0;
  private shake = 0;
  private shakeSeed = Math.random() * 100;
  private fovBase = 70;
  private fovTarget = 70;
  private roll = 0;
  private jumpCooldown = 0;
  private lastYawDelta = 0;
  private idleT = 0;

  constructor(physics: Physics, input: Input, camera: THREE.PerspectiveCamera) {
    this.physics = physics;
    this.input = input;
    this.camera = camera;
    this.createBody();
  }

  private createBody() {
    const p = this.physics;
    this.cc = p.ensureCharacter();
    const y = this.feet.y + RADIUS + HALF;
    this.body = p.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.feet.x, y, this.feet.z),
    );
    this.collider = p.world.createCollider(
      RAPIER.ColliderDesc.capsule(HALF, RADIUS).setFriction(0.0).setRestitution(0.0),
      this.body,
    );
  }

  /** Reposition the capsule (used by teleports between room and world). */
  teleport(pos: THREE.Vector3, yaw = this.yaw, pitch = this.pitch) {
    this.feet.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    const y = pos.y + RADIUS + HALF;
    this.body.setTranslation({ x: pos.x, y, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y, z: pos.z });
    this.landDip = 0; this.landVel = 0; this.bobT = 0; this.bobAmt = 0;
    this.physics.resetAccumulator();
    this.updateCamera(0);
  }

  addShake(amount: number) {
    this.shake = Math.min(1.4, this.shake + amount * settings.value.shake);
  }

  /** impulse-style landing dip, in metres */
  addLanding(strength: number) {
    this.landVel -= 2.6 * strength * (0.4 + settings.value.shake * 0.8);
    this.addShake(strength * 0.5);
  }

  /** Debug/telemetry: the kinematic capsule's actual world position. */
  bodyTranslation() { return this.body.translation(); }

  get eyePosition() { return this.camera.position; }
  get flatForward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const st = settings.value;

    if (this.enabled) {
      const look = this.input.consumeLook();
      const sens = clamp(st.sensitivity, 0.2, 3);
      // rotation is applied the same frame -> slider changes are felt instantly
      this.yaw += look.yaw * sens;
      this.pitch += look.pitch * sens;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
      this.lastYawDelta = look.yaw;
    } else {
      this.input.clearLook();
      this.lastYawDelta = 0;
    }

    let wishX = 0, wishZ = 0;
    if (this.enabled) {
      if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) wishZ -= 1;
      if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) wishZ += 1;
      if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) wishX -= 1;
      if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) wishX += 1;
    }
    const run = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    const wishLen = Math.hypot(wishX, wishZ);
    const baseSpeed = 4.3;
    const targetSpeed = wishLen > 0 ? (run ? baseSpeed * 1.85 : baseSpeed) : 0;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const desired = new THREE.Vector3();
    if (wishLen > 0) {
      desired.addScaledVector(fwd, -wishZ / wishLen);
      desired.addScaledVector(right, wishX / wishLen);
      desired.normalize().multiplyScalar(targetSpeed);
    }

    // accelerate / decelerate: snappy on the ground, floaty in the air
    const accel = this.grounded ? 14 : 3.2;
    this.velocity.x = damp(this.velocity.x, desired.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, desired.z, accel, dt);

    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1.2;
    this.velocity.y -= GRAVITY * dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    // ---- character controller sweep (always applied to keep grounding valid)
    const delta = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    this.cc.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.cc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    // hitting a ceiling: kill upward velocity
    if (!this.grounded && delta.y > 0 && mv.y < delta.y * 0.4) this.velocity.y = Math.min(this.velocity.y, 0);

    this.feet.x += mv.x; this.feet.y += mv.y; this.feet.z += mv.z;
    const cy = this.feet.y + RADIUS + HALF;
    this.body.setNextKinematicTranslation({ x: this.feet.x, y: cy, z: this.feet.z });

    // landing impact
    if (!wasGrounded && this.grounded) {
      const impact = clamp(-this.velocity.y / 12, 0, 1);
      if (impact > 0.05) {
        this.landVel -= impact * 1.9;
        this.addShake(impact * 0.45);
      }
    }

    // ---- head bob & footsteps
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const bobScale = st.shake;
    if (this.grounded) {
      this.bobT += dt * (horizSpeed / baseSpeed) * (run ? 1.9 : 1.45) * Math.PI * 2 * 1.05;
      this.stepDist += horizSpeed * dt;
      const stride = run ? 1.65 : 1.35;
      if (this.stepDist > stride && horizSpeed > 0.6) {
        this.stepDist = 0;
        this.onFootstep?.(this.surface, run);
      }
    } else {
      this.stepDist = 0.6;
    }
    this.idleT += dt;
    const breathe = Math.sin(this.idleT * 1.35) * 0.006;
    const bobY = Math.sin(this.bobT * 2) * 0.026 * bobScale * Math.min(1, horizSpeed / 4);
    const bobX = Math.cos(this.bobT) * 0.021 * bobScale * Math.min(1, horizSpeed / 4);
    this.bobAmt = damp(this.bobAmt, horizSpeed > 0.6 ? 1 : 0, 6, dt);

    // land spring
    this.landVel += (-this.landDip * 90 - this.landVel * 11) * dt;
    this.landDip += this.landVel * dt;
    this.landDip = clamp(this.landDip, -0.6, 0.25);

    // shake decay
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.shakeSeed += dt * 34;

    // dash fov kick
    this.fovTarget = this.fovBase + (horizSpeed > baseSpeed * 1.2 ? 2.6 : 0);

    // roll: slight bank into strafes + bob sway
    const strafe = (wishX / (wishLen || 1)) * 0.014 * bobScale;
    this.roll = damp(this.roll, strafe + Math.sin(this.bobT) * 0.006 * bobScale, 5, dt);

    if (this.controlCamera) this.updateCamera(dt, bobY, bobX, breathe);
  }

  updateCamera(dt: number, bobY = 0, bobX = 0, breathe = 0) {
    const eyeY = this.feet.y + EYE + bobY + breathe + this.landDip;
    this.camera.position.set(this.feet.x, eyeY, this.feet.z);

    if (this.shake > 0.001) {
      const s = this.shake * settings.value.shake;
      this.camera.position.x += Math.sin(this.shakeSeed * 1.7) * 0.028 * s;
      this.camera.position.y += Math.cos(this.shakeSeed * 2.3) * 0.024 * s;
      this.camera.position.z += Math.sin(this.shakeSeed * 1.1 + 2) * 0.028 * s;
    }

    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
    if (dt > 0) {
      // subtle look lag: the camera eases toward the head orientation
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        this.pitch + Math.sin(this.shakeSeed * 3.1) * 0.0006 * this.shake,
        this.yaw + Math.sin(this.shakeSeed * 2.4) * 0.0006 * this.shake,
        this.roll, 'YXZ',
      ));
      this.camera.quaternion.slerp(q, 1 - Math.exp(-26 * dt));
    }

    // lateral bob applied after rotation so it reads on-screen
    this.camera.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), bobX);

    if (Math.abs(this.camera.fov - this.fovTarget) > 0.01) {
      this.camera.fov = damp(this.camera.fov, this.fovTarget, 6, dt || 0.016);
      this.camera.updateProjectionMatrix();
    }
  }

  setFrozen(frozen: boolean) {
    this.enabled = !frozen;
    if (frozen) {
      this.velocity.x = 0; this.velocity.z = 0;
      this.input.clearLook();
    }
  }

  reset(pos: THREE.Vector3, yaw: number, pitch = 0) {
    this.teleport(pos, yaw, pitch);
    this.shake = 0; this.landDip = 0; this.landVel = 0;
    this.bobT = 0; this.stepDist = 0; this.velocity.set(0, 0, 0);
    this.fovBase = 70;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
  }
}
