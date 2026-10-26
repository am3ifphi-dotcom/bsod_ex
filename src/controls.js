import * as THREE from 'three';

/**
 * 探検用のフライトコントロール。
 *  - WASD / 矢印キーで前後左右、Space / C で上下、Shift で加速
 *  - ドラッグで視点（モバイルは画面ドラッグ + 左スティック）
 *  - 島をクリックすると自動航行
 */

const MIN_Y = 2.4;
const MAX_Y = 64;
const WORLD_RADIUS = 150;

export class Explorer {
  constructor(world, options = {}) {
    this.world = world;
    this.camera = world.camera;
    this.onFocusChange = options.onFocusChange || (() => {});
    this.onTap = options.onTap || (() => {});
    this.onKey = options.onKey || (() => {});
    this.onAutopilotEnd = options.onAutopilotEnd || (() => {});

    this.yaw = Math.PI; // 原点方向を向く
    this.pitch = -0.06;
    this.position = new THREE.Vector3(0, 11, 46);
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.focus = null;
    this.autopilot = null;
    this.dragging = false;
    this.dragMoved = 0;
    this.lastPointer = { x: 0, y: 0 };
    this.joystick = new THREE.Vector2();
    this.speedMultiplier = 1;
    this.enabled = true;
    this.time = 0;
    this.boosting = false;
    this.fovTarget = 56;
    this.canvas = options.canvas || world.canvas;

    this._bindKeyboard();
    this._bindPointer();
    this._bindJoystick();

    this._applyCamera();
  }

  /* ───────────────── input ───────────────── */

  _bindKeyboard() {
    const blocked = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyC', 'KeyQ', 'KeyF',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
    ]);

    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (blocked.has(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (!event.repeat) this.onKey(event);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        this.cancelAutopilot(true);
      }
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindPointer() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.pointerType === 'touch' && event.clientX < window.innerWidth * 0.35 && event.clientY > window.innerHeight * 0.5) {
        return; // スティック領域
      }
      this.dragging = true;
      this.dragMoved = 0;
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging || !this.enabled) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.look(dx, dy, event.pointerType === 'touch' ? 1.35 : 1);
    });

    const end = (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.classList.remove('dragging');
      if (this.dragMoved < 7 && event.type === 'pointerup') {
        this.onTap(event.clientX, event.clientY);
      }
    };

    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => {
      this.dragging = false;
      canvas.classList.remove('dragging');
    });

    canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        this.fovTarget = THREE.MathUtils.clamp(this.fovTarget + Math.sign(event.deltaY) * 3, 38, 76);
      },
      { passive: false }
    );
  }

  _bindJoystick() {
    const base = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    if (!base || !knob) return;
    this.joystickBase = base;
    this.joystickKnob = knob;

    const radius = 34;
    let active = false;
    let id = null;
    const center = { x: 0, y: 0 };

    const move = (event) => {
      if (!active || event.pointerId !== id) return;
      let dx = event.clientX - center.x;
      let dy = event.clientY - center.y;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joystick.set(dx / radius, dy / radius);
    };

    base.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      const rect = base.getBoundingClientRect();
      center.x = rect.left + rect.width / 2;
      center.y = rect.top + rect.height / 2;
      active = true;
      id = event.pointerId;
      base.setPointerCapture?.(event.pointerId);
      move(event);
    });
    base.addEventListener('pointermove', move);
    const stop = () => {
      active = false;
      id = null;
      this.joystick.set(0, 0);
      knob.style.transform = 'translate(0px, 0px)';
    };
    base.addEventListener('pointerup', stop);
    base.addEventListener('pointercancel', stop);
  }

  look(dx, dy, scale = 1) {
    const sensitivity = 0.0026 * scale;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.2, 1.1);
    this.cancelAutopilot(true);
  }

  /* ───────────────── autopilot ───────────────── */

  travelTo(entry) {
    if (!entry) return;
    const islandPos = entry.root.position.clone();
    const dir = this.position.clone().sub(islandPos).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    const target = islandPos.clone().add(dir.multiplyScalar(13.5));
    target.y = islandPos.y + 3.2;

    const toIsland = islandPos.clone().sub(this.position);
    const yawTarget = Math.atan2(toIsland.x, toIsland.z);

    this.autopilot = {
      entry,
      elapsed: 0,
      duration: THREE.MathUtils.clamp(this.position.distanceTo(target) / 26, 0.9, 3.4),
      from: this.position.clone(),
      to: target,
      fromYaw: this.yaw,
      toYaw: this.yaw + this._angleDelta(this.yaw, yawTarget),
    };
    this.onAutopilotStart?.(entry);
  }

  cancelAutopilot(silent = false) {
    if (!this.autopilot) return;
    this.autopilot = null;
    this.boosting = false;
    this.velocity.set(0, 0, 0);
    if (!silent) this.onAutopilotEnd?.();
  }

  _angleDelta(from, to) {
    let delta = (to - from + Math.PI) % (Math.PI * 2);
    if (delta < 0) delta += Math.PI * 2;
    return delta - Math.PI;
  }

  /* ───────────────── loop ───────────────── */

  update(dt) {
    this.time += dt;
    const camera = this.camera;

    if (this.autopilot) {
      const ap = this.autopilot;
      ap.elapsed += dt;
      const t = Math.min(1, ap.elapsed / ap.duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.position.lerpVectors(ap.from, ap.to, e);
      this.yaw = ap.fromYaw + this._angleDelta(ap.fromYaw, ap.toYaw) * e;
      this.pitch += (-0.08 - this.pitch) * Math.min(1, dt * 3);
      if (t >= 1) {
        this.autopilot = null;
        this.onAutopilotEnd?.(ap.entry);
      }
    } else {
      const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const input = new THREE.Vector3();

      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.sub(forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.sub(right);
      if (this.keys.has('Space')) input.y += 1;
      if (this.keys.has('KeyC') || this.keys.has('KeyQ')) input.y -= 1;

      if (this.joystick.lengthSq() > 0.001) {
        input.addScaledVector(forward, -this.joystick.y);
        input.addScaledVector(right, this.joystick.x);
      }

      const boosting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      this.boosting = boosting;
      const speed = boosting ? 42 : 15;

      if (input.lengthSq() > 0) {
        input.normalize().multiplyScalar(speed);
        this.velocity.lerp(input, Math.min(1, dt * 5.5));
        this.cancelAutopilot(true);
      } else {
        this.velocity.multiplyScalar(Math.pow(0.0025, dt));
      }

      this.position.addScaledVector(this.velocity, dt);
      this.position.y = THREE.MathUtils.clamp(this.position.y, MIN_Y, MAX_Y);

      const flat = Math.hypot(this.position.x, this.position.z);
      if (flat > WORLD_RADIUS) {
        this.position.x *= WORLD_RADIUS / flat;
        this.position.z *= WORLD_RADIUS / flat;
      }

      this.speedMultiplier = THREE.MathUtils.lerp(this.speedMultiplier, boosting ? 1.7 : 1, dt * 3);
    }

    this._applyCamera();

    // FOV の伸び（加速で少し広がる）
    const targetFov = this.fovTarget + (this.boosting ? 6 : 0) + (this.autopilot ? 2 : 0);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }

    this._updateFocus();
  }

  _applyCamera() {
    const camera = this.camera;
    camera.position.copy(this.position);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    camera.lookAt(this.position.clone().add(dir));
  }

  _updateFocus() {
    const forward = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );

    let best = null;
    let bestScore = Infinity;

    for (const entry of this.world.islands) {
      const to = entry.root.position.clone().sub(this.position);
      const distance = to.length();
      if (distance > 30 || distance < 0.5) continue;
      const dot = to.normalize().dot(forward);
      if (dot < 0.55) continue;
      const score = distance * (1.6 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    if (best !== this.focus) {
      this.focus = best;
      this.onFocusChange(best);
    }
  }

  /** 一番近い未発見の島を目指す */
  nextUnvisited(exclude = null) {
    const candidates = this.world.islands.filter((entry) => !entry.visited && entry !== exclude);
    const pool = candidates.length ? candidates : this.world.islands;
    let best = null;
    let bestDistance = Infinity;
    for (const entry of pool) {
      const distance = entry.root.position.distanceTo(this.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    return best;
  }
}
