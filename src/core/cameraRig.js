import * as THREE from 'three';
import { damp, smoothstep, clamp } from './util.js';

// 三人称的なカメラを「頭」として動かす補助。慣性・ためらい・ブレを伴う
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = camera.position.clone();
    this.targetPos = camera.position.clone();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.yawT = 0; this.pitchT = 0; this.rollT = 0;
    this.shake = 0;
    this.noiseSeed = Math.random() * 100;
  }

  snap(pos, yaw, pitch, roll = 0) {
    this.pos.copy(pos); this.targetPos.copy(pos);
    this.yaw = this.yawT = yaw;
    this.pitch = this.pitchT = pitch;
    this.roll = this.rollT = roll;
    this._apply(0);
  }

  setTarget(pos, yaw, pitch, roll) {
    if (pos) this.targetPos.copy(pos);
    if (yaw !== undefined) this.yawT = yaw;
    if (pitch !== undefined) this.pitchT = pitch;
    if (roll !== undefined) this.rollT = roll;
  }

  addShake(v) { this.shake = clamp(this.shake + v, 0, 1.5); }

  // 素早い視線移動(サッカード): 現在の目標から相対的に
  glance(dYaw, dPitch, dur, t) {
    const k = smoothstep(0, 1, clamp(t / dur, 0, 1));
    return { yaw: this.yawT + dYaw * k, pitch: this.pitchT + dPitch * k };
  }

  update(dt, time, posLambda = 10, rotLambda = 9) {
    this.pos.x = damp(this.pos.x, this.targetPos.x, posLambda, dt);
    this.pos.y = damp(this.pos.y, this.targetPos.y, posLambda, dt);
    this.pos.z = damp(this.pos.z, this.targetPos.z, posLambda, dt);
    this.yaw = damp(this.yaw, this.yawT, rotLambda, dt);
    this.pitch = damp(this.pitch, this.pitchT, rotLambda, dt);
    this.roll = damp(this.roll, this.rollT, rotLambda * 0.8, dt);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    this._apply(time);
  }

  _apply(time) {
    const cam = this.camera;
    const s = this.shake;
    const t = time + this.noiseSeed;
    cam.position.copy(this.pos);
    cam.position.x += (Math.sin(t * 47.3) * 0.5 + Math.sin(t * 23.1) * 0.5) * s * 0.06;
    cam.position.y += (Math.sin(t * 41.7) * 0.5 + Math.sin(t * 19.9) * 0.5) * s * 0.07;
    cam.position.z += (Math.sin(t * 53.7) * 0.5) * s * 0.06;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(
      this.pitch + (Math.random() - 0.5) * s * 0.05,
      this.yaw + (Math.random() - 0.5) * s * 0.06,
      this.roll + Math.sin(t * 13.0) * s * 0.05
    );
  }
}

export function faceYaw(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return Math.atan2(-dx, -dz);
}
