// controls.js — pointer-lock FPS controller with head bob & AABB collision
import * as THREE from 'three';

export class FPControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.enabled = false;
    this.locked = false;
    this.position = new THREE.Vector3(0, 1.62, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.roll = 0;
    this.fov = 68;
    this.eyeHeight = 1.62;
    this.speed = 1.85;
    this.colliders = [];      // [{min:{x,z}, max:{x,z}}] AABBs (xz)
    this.keys = {};
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.onFootstep = null;
    this.onInteract = null;
    this._sensitivity = 0.0021;

    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (this.enabled && e.code === 'KeyE' && this.onInteract) this.onInteract();
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    dom.addEventListener('click', () => {
      if (this.enabled && !this.locked) this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * this._sensitivity;
      this.pitch -= e.movementY * this._sensitivity;
      const lim = Math.PI * 0.495;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
  }

  requestLock() {
    const p = this.dom.requestPointerLock && this.dom.requestPointerLock({ unadjustedMovement: false });
    if (p && p.catch) p.catch(() => {});
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setState(pos, yaw, pitch) {
    this.position.copy(pos);
    this.yaw = yaw;
    this.pitch = pitch;
    this.velocity.set(0, 0, 0);
    this.syncCamera(0);
  }

  /** integrate movement; dt seconds */
  update(dt) {
    if (!this.enabled) { this.syncCamera(dt); return; }
    const fwd = (this.keys['KeyW'] || this.keys['ArrowUp'] ? 1 : 0) - (this.keys['KeyS'] || this.keys['ArrowDown'] ? 1 : 0);
    const strafe = (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0) - (this.keys['KeyA'] || this.keys['ArrowLeft'] ? 1 : 0);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // camera forward is -Z rotated by yaw
    const dirX = -sin * fwd + cos * strafe;
    const dirZ = -cos * fwd - sin * strafe;
    const target = new THREE.Vector3(dirX, 0, dirZ);
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(this.speed);

    const accel = this.locked ? 10 : 6;
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, accel * dt);

    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    // slide along colliders per axis
    if (!this._blocked(nx, this.position.z)) this.position.x = nx;
    else this.velocity.x = 0;
    if (!this._blocked(this.position.x, nz)) this.position.z = nz;
    else this.velocity.z = 0;

    // head bob
    const moving = this.velocity.lengthSq() > 0.35;
    if (moving) {
      this.bobPhase += dt * 7.2;
      this.bobAmount += (1 - this.bobAmount) * Math.min(1, dt * 6);
      const stepPos = Math.sin(this.bobPhase);
      if (this.onFootstep && Math.sin(this.bobPhase - dt * 7.2) > 0 && stepPos <= 0) this.onFootstep();
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 4);
    }
    this.syncCamera(dt);
  }

  syncCamera(dt) {
    const bobY = Math.sin(this.bobPhase) * 0.032 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.022 * this.bobAmount;
    this.camera.position.set(this.position.x + bobX, this.position.y + bobY, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.swayYaw;
    this.camera.rotation.x = this.pitch + this.swayPitch;
    this.camera.rotation.z = this.roll;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _blocked(x, z) {
    const r = 0.34;
    for (const c of this.colliders) {
      if (x > c.min.x - r && x < c.max.x + r && z > c.min.z - r && z < c.max.z + r) return true;
    }
    return false;
  }
}
