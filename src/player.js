/**
 * 一人称コントローラ — キーボード / マウス（ポインタロック） / タッチ
 */
import * as THREE from 'three';
import { ROOM as R } from './materials.js';

const EYE_STAND = 1.58;
const EYE_CROUCH = 0.94;
const RADIUS = 0.235;

export class Player {
  constructor(camera, colliders, audio, dom = {}) {
    this.camera = camera;
    this.colliders = colliders;
    this.audio = audio;
    this.dom = dom;
    /** 体の半径（GLB 教室は机の間が狭いので細め） */
    this.radius = dom.radius || RADIUS;
    /** 行動範囲（無ければ手続き版の ROOM を使う） */
    this.bounds = dom.bounds || null;

    this.pos = new THREE.Vector3(0, 0, 2.9);
    this.yaw = Math.PI; // 黒板の方を向いて始める
    this.pitch = -0.02;
    this.vel = new THREE.Vector2();
    this.eye = EYE_STAND;
    this.targetEye = EYE_STAND;
    this.enabled = false;
    this.locked = false;
    this.bob = 0;
    this.bobAmp = 0;
    this.stepDist = 0;
    this.roll = 0;
    this.speed = 0;
    this.crouch = false;
    this.run = false;
    this.bobEnabled = true;
    this.sensitivity = 1;
    this.touchMode = false;
    this.lockAllowed = true;
    this.dragging = false;

    this.keys = new Set();
    this.stick = { x: 0, y: 0, active: false, id: null, cx: 0, cy: 0 };
    this.touchLook = { id: null, x: 0, y: 0 };
    this._lastYaw = this.yaw;

    this._bind();
  }

  /* ---------------- 入力 ---------------- */
  _bind() {
    const canvas = this.dom.canvas;

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        this.keys.add(k);
        if (k === 'shift') this.run = true;
        if (k === 'c' || k === 'control') this.crouch = true;
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
          if (this.enabled) e.preventDefault();
        }
      },
      { passive: false }
    );
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'shift') this.run = false;
      if (k === 'c' || k === 'control') this.crouch = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.run = false;
      this.crouch = false;
    });

    // ポインタロック
    if (canvas) {
      canvas.addEventListener('click', () => {
        if (this.enabled && !this.touchMode && !this.locked && this.lockAllowed) this.requestLock();
      });
      canvas.addEventListener('mousedown', (e) => {
        if (this.enabled && !this.locked && e.button === 0) this.dragging = true;
      });
      window.addEventListener('mouseup', () => (this.dragging = false));
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === canvas;
        document.body.classList.toggle('locked', this.locked);
        if (!this.locked && this.enabled && this.onUnlock) this.onUnlock();
      });
      document.addEventListener('mousemove', (e) => {
        if (!this.enabled) return;
        if (this.locked) {
          this.rotate(e.movementX * 0.0022 * this.sensitivity, e.movementY * 0.0022 * this.sensitivity);
        } else if (this.dragging) {
          this.rotate(e.movementX * 0.0032 * this.sensitivity, e.movementY * 0.0032 * this.sensitivity);
        }
      });
    }

    // タッチ：視点
    if (canvas) {
      canvas.addEventListener(
        'touchstart',
        (e) => {
          if (!this.enabled) return;
          for (const t of e.changedTouches) {
            if (this.touchLook.id === null) {
              this.touchLook.id = t.identifier;
              this.touchLook.x = t.clientX;
              this.touchLook.y = t.clientY;
            }
          }
        },
        { passive: true }
      );
      canvas.addEventListener(
        'touchmove',
        (e) => {
          if (!this.enabled) return;
          for (const t of e.changedTouches) {
            if (t.identifier !== this.touchLook.id) continue;
            const dx = t.clientX - this.touchLook.x;
            const dy = t.clientY - this.touchLook.y;
            this.touchLook.x = t.clientX;
            this.touchLook.y = t.clientY;
            this.rotate(dx * 0.005 * this.sensitivity, dy * 0.005 * this.sensitivity);
          }
          e.preventDefault();
        },
        { passive: false }
      );
      const endLook = (e) => {
        for (const t of e.changedTouches) if (t.identifier === this.touchLook.id) this.touchLook.id = null;
      };
      canvas.addEventListener('touchend', endLook, { passive: true });
      canvas.addEventListener('touchcancel', endLook, { passive: true });
    }

    // タッチ：スティック
    const zone = this.dom.stickZone;
    const knob = this.dom.stickKnob;
    if (zone) {
      const start = (e) => {
        if (this.stick.active) return;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const rect = zone.getBoundingClientRect();
        this.stick.active = true;
        this.stick.id = t.identifier ?? 'mouse';
        this.stick.cx = rect.left + 84;
        this.stick.cy = rect.bottom - 88;
        this._updateStick(t.clientX, t.clientY, knob);
        e.preventDefault();
      };
      const move = (e) => {
        if (!this.stick.active) return;
        for (const t of e.changedTouches || [e]) {
          if ((t.identifier ?? 'mouse') !== this.stick.id) continue;
          this._updateStick(t.clientX, t.clientY, knob);
        }
        e.preventDefault();
      };
      const end = (e) => {
        for (const t of e.changedTouches || [e]) {
          if ((t.identifier ?? 'mouse') !== this.stick.id) continue;
          this.stick.active = false;
          this.stick.x = this.stick.y = 0;
          if (knob) knob.style.transform = 'translate(-50%,-50%)';
        }
      };
      zone.addEventListener('touchstart', start, { passive: false });
      zone.addEventListener('touchmove', move, { passive: false });
      zone.addEventListener('touchend', end, { passive: true });
      zone.addEventListener('touchcancel', end, { passive: true });
      zone.addEventListener('mousedown', start);
      window.addEventListener('mousemove', (e) => this.stick.active && move(e));
      window.addEventListener('mouseup', (e) => end(e));
    }
  }

  _updateStick(x, y, knob) {
    const dx = x - this.stick.cx;
    const dy = y - this.stick.cy;
    const max = 52;
    const d = Math.min(max, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    this.stick.x = (Math.cos(a) * d) / max;
    this.stick.y = (Math.sin(a) * d) / max;
    if (knob) knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px))`;
  }

  rotate(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    const lim = Math.PI / 2 - 0.04;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  requestLock() {
    const canvas = this.dom.canvas;
    if (canvas && canvas.requestPointerLock) {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  teleport(x, z, yaw = this.yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.pitch = -0.02;
    this.vel.set(0, 0);
  }

  /* ---------------- 更新 ---------------- */
  update(dt) {
    dt = Math.min(dt, 0.05);
    // 入力ベクトル
    let ix = 0;
    let iz = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('w') || k.has('arrowup')) iz -= 1;
      if (k.has('s') || k.has('arrowdown')) iz += 1;
      if (k.has('a') || k.has('arrowleft')) ix -= 1;
      if (k.has('d') || k.has('arrowright')) ix += 1;
      if (this.stick.active) {
        ix += this.stick.x;
        iz += this.stick.y;
      }
    }
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }

    this.targetEye = this.crouch ? EYE_CROUCH : EYE_STAND;
    this.eye += (this.targetEye - this.eye) * Math.min(1, dt * 11);

    const running = this.run && !this.crouch && len > 0.2;
    const speed = this.crouch ? 0.95 : running ? 3.05 : 1.62;
    // 加速度＋減衰
    const target = new THREE.Vector2(ix * speed, -iz * speed);
    const accel = len > 0 ? 13 : 17;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.y += (target.y - this.vel.y) * Math.min(1, dt * accel);
    this.speed = this.vel.length();

    //  yaw を考慮した移動
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // ローカル (x=右, y=前) → ワールド
    // right = (cos, -sin) / forward = (-sin, -cos)
    const wx = this.vel.x * cos - this.vel.y * sin;
    const wz = -(this.vel.x * sin + this.vel.y * cos);

    let nx = this.pos.x + wx * dt;
    let nz = this.pos.z + wz * dt;
    const r = this.radius;
    const fixed = this.colliders.resolve(nx, nz, r);
    nx = fixed.x;
    nz = fixed.z;
    // 部屋の外には出さない（手続き版は廊下だけ別ルール）
    if (this.bounds) {
      const B = this.bounds;
      nx = Math.max(B.x0 + r, Math.min(B.x1 - r, nx));
      nz = Math.max(B.z0 + r, Math.min(B.z1 - r, nz));
    } else {
      const inCorridor = nx < R.X0;
      if (inCorridor) {
        nx = Math.max(R.X0 - 1.05, Math.min(R.X0 + 0.4, nx));
        nz = Math.max(1.98, Math.min(2.84, nz));
      } else {
        nx = Math.max(R.X0 + r, Math.min(R.X1 - r, nx));
        nz = Math.max(R.Z0 + r, Math.min(R.Z1 - r, nz));
      }
    }
    this.pos.x = nx;
    this.pos.z = nz;

    // 頭揺れと足音
    const moveAmt = Math.min(1, this.speed / 1.7);
    if (this.enabled && moveAmt > 0.06) {
      this.bob += dt * (running ? 12.2 : 8.4) * moveAmt;
      this.bobAmp += ((this.crouch ? 0.012 : running ? 0.045 : 0.028) * moveAmt - this.bobAmp) * Math.min(1, dt * 6);
      this.stepDist += this.speed * dt;
      const stride = running ? 1.5 : 1.05;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        if (this.audio) this.audio.step(running ? 1.15 : 0.8);
      }
    } else {
      this.bobAmp += (0 - this.bobAmp) * Math.min(1, dt * 5);
      // 立ち止まっているときの呼吸
      this.bob += dt * 1.1;
    }

    const bobOn = this.bobEnabled ? 1 : 0;
    const bobY = Math.sin(this.bob * 2) * this.bobAmp * bobOn;
    const bobX = Math.cos(this.bob) * this.bobAmp * 0.5 * bobOn;
    const breathe = Math.sin(this.bob) * 0.006 * (1 - moveAmt);

    // 旋回・横移動によるカメラの傾き
    const yawRate = (this.yaw - this._lastYaw) / Math.max(dt, 1e-4);
    this._lastYaw = this.yaw;
    const targetRoll = THREE.MathUtils.clamp(-this.vel.x * 0.011 - yawRate * 0.018, -0.05, 0.05);
    this.roll += (targetRoll * bobOn - this.roll) * Math.min(1, dt * 8);

    this.camera.position.set(this.pos.x + bobX * 0.3, this.eye + bobY + breathe, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  /** 視線の向き（単位ベクトル） */
  getForward(out = new THREE.Vector3()) {
    return out.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }
}
