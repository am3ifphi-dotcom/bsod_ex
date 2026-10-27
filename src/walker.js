/**
 * WASD 探索用の一人称コントローラ。
 *  - WASD / 矢印 … 移動（Shift で走る）
 *  - マウス … 見回す（クリックでポインタロック / ドラッグでも可）
 *  - スマホ … 左半分のバーチャルスティックで移動、右半分ドラッグで視点
 *  - 机・壁との当たり判定、頭の揺れ、足音
 */
import * as THREE from 'three';
import { COLLIDERS, ROOM } from './data/colliders.js';

const EYE = 1.58;
const RADIUS = 0.22;
const SPEED = 1.55;
const RUN = 2.9;
const LOOK_KEY = 1.7; // 矢印キーで見回す速さ(rad/s)

export class Walker {
  constructor(camera, dom, { onStep } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.onStep = onStep;

    this.pos = new THREE.Vector3(0, EYE, 3.2);
    this.yaw = Math.PI;     // 0 = -Z（教室の後ろ）を向く
    this.pitch = -0.02;
    this.vel = new THREE.Vector3();
    this.enabled = false;
    this.keys = new Set();
    this.bob = 0;
    this.moving = false;
    this.stepAcc = 0;
    this.locked = false;
    this.dragging = false;
    this.sensitivity = 0.0024;

    this._touch = { moveId: null, lookId: null, mx: 0, my: 0, lx: 0, ly: 0, sx: 0, sy: 0, dx: 0, dy: 0, active: false };

    this.bind();
    this.apply();
  }

  /* ---------------------------------------------------------------- */
  bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // ポインタロック（クリックで入る）
    this.dom.addEventListener('click', () => {
      if (!this.enabled || this.locked) return;
      if (this.dom.requestPointerLock) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.dom.classList.toggle('is-locked', this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.yaw -= e.movementX * this.sensitivity;
        this.pitch -= e.movementY * this.sensitivity;
        this.clampPitch();
      } else if (this.dragging) {
        this.yaw -= e.movementX * this.sensitivity * 1.2;
        this.pitch -= e.movementY * this.sensitivity * 1.2;
        this.clampPitch();
      }
    });
    this.dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'touch') return;
      this.dragging = true;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));

    // タッチ：左＝移動、右＝視点
    const t = this._touch;
    this.dom.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const touch of e.changedTouches) {
        if (touch.clientX < window.innerWidth * 0.45 && t.moveId === null) {
          t.moveId = touch.identifier;
          t.sx = touch.clientX;
          t.sy = touch.clientY;
          t.mx = 0;
          t.my = 0;
          t.active = true;
        } else if (t.lookId === null) {
          t.lookId = touch.identifier;
          t.lx = touch.clientX;
          t.ly = touch.clientY;
        }
      }
    }, { passive: true });

    this.dom.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier === t.moveId) {
          const dx = touch.clientX - t.sx;
          const dy = touch.clientY - t.sy;
          const len = Math.hypot(dx, dy) || 1;
          const max = 62;
          const k = Math.min(1, len / max);
          t.mx = (dx / len) * k;
          t.my = (dy / len) * k;
        } else if (touch.identifier === t.lookId) {
          this.yaw -= (touch.clientX - t.lx) * 0.006;
          this.pitch -= (touch.clientY - t.ly) * 0.006;
          this.clampPitch();
          t.lx = touch.clientX;
          t.ly = touch.clientY;
        }
      }
    }, { passive: true });

    const end = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === t.moveId) {
          t.moveId = null;
          t.mx = t.my = 0;
          t.active = false;
        }
        if (touch.identifier === t.lookId) t.lookId = null;
      }
    };
    this.dom.addEventListener('touchend', end, { passive: true });
    this.dom.addEventListener('touchcancel', end, { passive: true });
  }

  clampPitch() {
    const lim = Math.PI / 2 - 0.06;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** 位置と向きを直接指定 */
  setPose(x, z, lookAtX, lookAtZ, { instant = true } = {}) {
    this.pos.set(x, EYE, z);
    if (lookAtX !== undefined) {
      this.yaw = Math.atan2(-(lookAtX - x), -(lookAtZ - z));
    }
    this.vel.set(0, 0, 0);
    if (instant) this.apply();
  }

  enter() {
    this.enabled = true;
  }

  exit() {
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
  }

  apply() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.rotation.z = 0;
  }

  /** 円 vs 矩形で押し出す */
  resolve(nx, nz) {
    let x = nx;
    let z = nz;
    for (let iter = 0; iter < 3; iter++) {
      for (const c of COLLIDERS) {
        const dx = x - c.x;
        const dz = z - c.z;
        const ox = c.hx + RADIUS - Math.abs(dx);
        const oz = c.hz + RADIUS - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          // 浅い方の軸へ逃がす
          if (ox < oz) x += Math.sign(dx || 1) * ox;
          else z += Math.sign(dz || 1) * oz;
        }
      }
    }
    x = Math.max(ROOM.minX, Math.min(ROOM.maxX, x));
    z = Math.max(ROOM.minZ, Math.min(ROOM.maxZ, z));
    return [x, z];
  }

  get direction() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt) {
    if (!this.enabled) return;

    // 見回し（矢印キーは自由視点の補助）
    const k = this.keys;
    if (k.has('ArrowLeft')) this.yaw += LOOK_KEY * dt;
    if (k.has('ArrowRight')) this.yaw -= LOOK_KEY * dt;
    if (k.has('ArrowUp')) this.pitch += LOOK_KEY * 0.6 * dt;
    if (k.has('ArrowDown')) this.pitch -= LOOK_KEY * 0.6 * dt;
    this.clampPitch();

    // 入力
    let fx = 0;
    let fz = 0;
    if (k.has('KeyW')) fz += 1;
    if (k.has('KeyS')) fz -= 1;
    if (k.has('KeyA')) fx -= 1;
    if (k.has('KeyD')) fx += 1;

    const t = this._touch;
    if (t.active) {
      fx += t.mx;
      fz += -t.my;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) {
      fx /= len;
      fz /= len;
    }

    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : SPEED) * (t.active ? Math.min(1, len) / (len || 1) : 1);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wx = -sinY * fz + cosY * fx;
    const wz = -cosY * fz - sinY * fx;

    const targetVX = wx * speed;
    const targetVZ = wz * speed;
    const acc = 1 - Math.exp(-dt * 12);
    this.vel.x += (targetVX - this.vel.x) * acc;
    this.vel.z += (targetVZ - this.vel.z) * acc;

    const [x, z] = this.resolve(this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt);
    this.pos.x = x;
    this.pos.z = z;

    // 頭の揺れ・足音
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.moving = sp > 0.12;
    this.bob += dt * (this.moving ? sp * 5.2 : 0);
    const bobY = Math.sin(this.bob) * (this.moving ? 0.019 : 0);
    const bobX = Math.cos(this.bob * 0.5) * (this.moving ? 0.012 : 0);

    this.stepAcc += dt * sp;
    if (this.moving && this.stepAcc > 1.05) {
      this.stepAcc = 0;
      this.onStep?.();
    }

    this.camera.position.set(this.pos.x + bobX * 0.2, EYE + bobY, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** 画面中心のレイ */
  raycaster() {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    return rc;
  }

  distToXZ(p) {
    return Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
  }
}
