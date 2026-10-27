import * as THREE from 'three';
import { clamp, damp } from './util.js';

// 一人称プレイヤー: 移動 / 衝突 / ヘッドボブ / 慣性
export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(0, 0, 0); // 足元
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this._yawSmooth = 0;
    this._pitchSmooth = 0;
    this.eyeHeight = 1.62;
    this.radius = 0.32;
    this.speed = 2.6;
    this.runSpeed = 4.4;
    this.enabled = false;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.shake = 0;
    this.roll = 0;
    this._stepDistance = 0;
    this.onFootstep = null;
    this.colliders = [];
    this.bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    this._tmp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  reset(pos, yaw = 0, pitch = 0) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = this._yawSmooth = yaw;
    this.pitch = this._pitchSmooth = pitch;
    this.bobPhase = 0; this.bobAmount = 0; this.shake = 0; this.roll = 0;
    this._applyCamera(0, 0);
  }

  addShake(v) { this.shake = Math.min(1.2, this.shake + v); }
  addRoll(v) { this.roll += v; }

  setColliders(boxes, bounds) {
    this.colliders = boxes || [];
    if (bounds) this.bounds = bounds;
  }

  // 円 vs AABB: 最小貫通方向に押し出す(速度ゼロでも暴発しない)
  _resolveCollisions() {
    const p = this.position, r = this.radius;
    for (let iter = 0; iter < 2; iter++) {
      for (const box of this.colliders) {
        const minY = p.y + 0.1, maxY = p.y + this.eyeHeight + 0.1;
        if (maxY <= box.min.y || minY >= box.max.y) continue;
        const oxL = p.x + r - box.min.x;
        const oxR = box.max.x - (p.x - r);
        const ozL = p.z + r - box.min.z;
        const ozR = box.max.z - (p.z - r);
        if (oxL <= 0 || oxR <= 0 || ozL <= 0 || ozR <= 0) continue;
        const m = Math.min(oxL, oxR, ozL, ozR);
        if (m === oxL) { p.x = box.min.x - r - 0.001; this.velocity.x = 0; }
        else if (m === oxR) { p.x = box.max.x + r + 0.001; this.velocity.x = 0; }
        else if (m === ozL) { p.z = box.min.z - r - 0.001; this.velocity.z = 0; }
        else { p.z = box.max.z + r + 0.001; this.velocity.z = 0; }
      }
    }
    p.x = clamp(p.x, this.bounds.minX + r, this.bounds.maxX - r);
    p.z = clamp(p.z, this.bounds.minZ + r, this.bounds.maxZ - r);
  }

  update(dt, input) {
    if (!this.enabled) return;

    // 視点
    const sens = 0.0022;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this._yawSmooth = damp(this._yawSmooth, this.yaw, 22, dt);
    this._pitchSmooth = damp(this._pitchSmooth, this.pitch, 22, dt);

    // 移動入力
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = this._tmp.set(0, 0, 0)
      .addScaledVector(this._fwd, f)
      .addScaledVector(this._right, s);
    if (wish.lengthSq() > 0) wish.normalize();
    const target = input.down('ShiftLeft') || input.down('ShiftRight') ? this.runSpeed : this.speed;
    const accel = wish.lengthSq() > 0 ? 9 : 7;
    this.velocity.x = damp(this.velocity.x, wish.x * target, accel, dt);
    this.velocity.z = damp(this.velocity.z, wish.z * target, accel, dt);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this._resolveCollisions();

    // ヘッドボブ
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    const targetBob = clamp(planar / this.speed, 0, 1.4);
    this.bobAmount = damp(this.bobAmount, targetBob, 8, dt);
    this.bobPhase += dt * (6 + planar * 1.6);
    if (planar > 0.4) {
      this._stepDistance += planar * dt;
      const stride = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 1.5 : 1.9;
      if (this._stepDistance >= stride) {
        this._stepDistance = 0;
        if (this.onFootstep) this.onFootstep();
      }
    }

    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.roll = damp(this.roll, 0, 6, dt);
    this._applyCamera(dt, planar);
  }

  _applyCamera(dt, planar) {
    const cam = this.camera;
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.032 * this.bobAmount;
    const breathe = Math.sin(performance.now() * 0.0016) * 0.008;
    const sh = this.shake;
    cam.position.set(
      this.position.x + this._right.x * bobX + (Math.random() - 0.5) * sh * 0.05,
      this.position.y + this.eyeHeight + bobY + breathe + (Math.random() - 0.5) * sh * 0.06,
      this.position.z + this._right.z * bobX + (Math.random() - 0.5) * sh * 0.05
    );
    const shYaw = (Math.random() - 0.5) * sh * 0.06;
    const shPitch = (Math.random() - 0.5) * sh * 0.05;
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this._yawSmooth + shYaw;
    cam.rotation.x = this._pitchSmooth + shPitch;
    cam.rotation.z = this.roll + Math.sin(this.bobPhase) * 0.012 * this.bobAmount + (Math.random() - 0.5) * sh * 0.03;
  }
}
