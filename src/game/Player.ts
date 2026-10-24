import * as THREE from 'three';
import type { CollisionWorld } from '../core/collision';
import type { Input } from '../core/Input';
import { clamp, damp, deg } from '../core/util';

export type Interactable = {
  id: string;
  point: THREE.Vector3;
  radius: number;       // 反応する距離
  label: string | (() => string);  // プロンプト文言 (例: "PC を調べる")
  onUse: () => void;
  enabled?: () => boolean;
  maxAngle?: number;    // ラジアン
};

export type PlayerSettings = {
  bobEnabled: boolean;
  bobScale: number;
  walkSpeed: number;
  runSpeed: number;
  sensitivity: number;
};

/**
 * 一人称プレイヤー。
 * - 歩行/ダッシュ、段差の自動ステップアップ、壁の押し出し
 * - 控えめなヘッドボブと着地の沈み込み
 * - 視点操作は強制演出中に入力ごと無効化できる
 */
export class Player {
  pos = new THREE.Vector3(0, 0, 0);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;

  eyeHeight = 1.62;
  radius = 0.31;
  bodyHeight = 1.72;

  onGround = false;
  speed = 0;
  private bobPhase = 0;
  private bobY = 0;
  private bobX = 0;
  private landDip = 0;
  private lastSafe = new THREE.Vector3();
  private stepAccum = 0;
  private jumpVel = 0;

  settings: PlayerSettings = {
    bobEnabled: true, bobScale: 1, walkSpeed: 4.3, runSpeed: 8.2, sensitivity: 1,
  };

  onFootstep?: (running: boolean, intensity: number) => void;
  onLand?: (impact: number) => void;
  interactables: Interactable[] = [];
  focus: Interactable | null = null;

  static labelOf(it: Interactable | null): string {
    if (!it) return '';
    return typeof it.label === 'function' ? it.label() : it.label;
  }

  // 強制演出用の上書き (null なら通常)
  overridePos: THREE.Vector3 | null = null;
  freeze = false;

  setPosition(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.lastSafe.copy(this.pos);
  }

  reset() {
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.vel.set(0, 0, 0);
    this.bobPhase = 0; this.bobY = 0; this.bobX = 0; this.landDip = 0;
    this.freeze = false; this.overridePos = null;
    this.focus = null;
  }

  update(dt: number, input: Input, world: CollisionWorld) {
    if (this.freeze) {
      input.consumeLook();
      this.vel.set(0, 0, 0);
      this.updateFocus(world);
      return;
    }

    // --- 視点 ---
    const look = input.consumeLook();
    this.yaw += look.yaw;
    this.pitch = clamp(this.pitch + look.pitch, -deg(88), deg(88));

    // --- 移動入力 ---
    let fx = 0, fz = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) fz -= 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) fz += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) fx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const targetSpeed = len > 0 ? (running ? this.settings.runSpeed : this.settings.walkSpeed) : 0;

    // ヨー方向へ変換
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    const accel = this.onGround ? 12 : 3.5;
    const targetVX = wx * targetSpeed;
    const targetVZ = wz * targetSpeed;
    this.vel.x = damp(this.vel.x, targetVX, accel, dt);
    this.vel.z = damp(this.vel.z, targetVZ, accel, dt);

    // --- 水平移動 (細かく分割して壁抜けを防ぐ) ---
    const dx = this.vel.x * dt;
    const dz = this.vel.z * dt;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.12));
    for (let i = 0; i < steps; i++) {
      this.pos.x += dx / steps;
      this.pos.z += dz / steps;
      world.resolve(this.pos, this.radius, this.bodyHeight);
    }

    // --- 足元の高さ ---
    const ground = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.25, 0.55);
    if (this.onGround && ground > this.pos.y && ground - this.pos.y < 0.6 && this.jumpVel <= 0) {
      // 段差を滑らかに登る
      this.pos.y = Math.min(ground, this.pos.y + Math.max(2.2 * dt, (ground - this.pos.y) * 12 * dt));
    }

    // --- 重力 ---
    this.jumpVel -= 24 * dt;
    this.pos.y += this.jumpVel * dt;
    const g2 = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.55, 0.55);
    if (g2 > -Infinity && this.pos.y <= g2) {
      if (this.jumpVel < -2.5) {
        const impact = clamp(-this.jumpVel / 14, 0, 1);
        this.landDip = Math.min(0.14, impact * 0.16);
        this.onLand?.(impact);
      }
      this.pos.y = g2;
      this.jumpVel = 0;
      this.onGround = true;
      this.lastSafe.copy(this.pos);
    } else {
      this.onGround = false;
    }

    // マップ外への脱落防止 (崩壊演出中は許可)
    if (!world.allowFalling && this.pos.y < this.lastSafe.y - 8.0) {
      this.pos.copy(this.lastSafe);
      this.vel.set(0, 0, 0);
      this.jumpVel = 0;
      this.onGround = true;
    }
    if (this.pos.y < -200) {
      this.pos.copy(this.lastSafe);
      this.vel.set(0, 0, 0); this.jumpVel = 0;
    }

    // --- ヘッドボブ ---
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = planarSpeed;
    const bobAmount = this.settings.bobEnabled ? (running ? 0.032 : 0.020) * this.settings.bobScale : 0;
    if (this.onGround && planarSpeed > 0.3) {
      this.bobPhase += dt * (running ? 12.0 : 8.2) * clamp(planarSpeed / this.settings.walkSpeed, 0.5, 1.4);
      const stepIndex = Math.floor(this.bobPhase / Math.PI);
      if (stepIndex !== this.lastStepIndex) {
        this.lastStepIndex = stepIndex;
        this.onFootstep?.(running, clamp(planarSpeed / this.settings.runSpeed, 0.4, 1));
      }
    } else {
      this.bobPhase = damp(this.bobPhase, Math.round(this.bobPhase / Math.PI) * Math.PI, 4, dt);
    }
    const targetBobY = Math.sin(this.bobPhase) * bobAmount;
    const targetBobX = Math.cos(this.bobPhase * 0.5) * bobAmount * 0.7;
    this.bobY = damp(this.bobY, targetBobY, 16, dt);
    this.bobX = damp(this.bobX, targetBobX, 12, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);

    // 走行時のわずかなバンク
    const strafe = this.vel.x * cos - this.vel.z * sin;
    this.roll = damp(this.roll, clamp(-strafe * 0.004, -0.02, 0.02), 6, dt);

    this.updateFocus(world);
  }
  private lastStepIndex = 0;

  private updateFocus(_world: CollisionWorld) {
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    const camDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const eye = this.eyePosition(new THREE.Vector3());
    for (const it of this.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const d = eye.distanceTo(it.point);
      if (d > it.radius) continue;
      const dir = it.point.clone().sub(eye).normalize();
      const ang = Math.acos(clamp(dir.dot(camDir), -1, 1));
      if (ang > (it.maxAngle ?? deg(32))) continue;
      const score = ang * 2 + d * 0.15;
      if (score < bestScore) continue;
      bestScore = score;
      best = it;
    }
    this.focus = best;
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight + this.bobY - this.landDip, this.pos.z);
  }

  applyCamera(camera: THREE.PerspectiveCamera) {
    const p = this.eyePosition();
    p.x += this.bobX * Math.cos(this.yaw);
    p.z -= this.bobX * Math.sin(this.yaw);
    camera.position.copy(p);
    camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  /** 今の向きで、前方の点 (インタラクト地点) を取得 */
  forwardPoint(distance: number, out = new THREE.Vector3()) {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return out.copy(this.eyePosition()).addScaledVector(dir, distance);
  }
}
