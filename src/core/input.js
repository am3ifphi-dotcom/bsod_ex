/**
 * Input — pointer lock with graceful fallbacks (drag-look / touch), keyboard
 * state, edge-triggered actions, and strict focus handling so that typing in
 * the console never leaks into the game (and vice versa).
 */
const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = { dx: 0, dy: 0, down: false };
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = false;
    this.typing = false;
    this.locked = false;
    this.dragLook = false;
    this._dragging = false;
    this.touch = { active: false, moveId: null, lookId: null, moveStart: [0, 0], moveVec: [0, 0], lookLast: [0, 0], tap: false };
    this._touchUse = null;
    this.onPause = null;
    this.onKey = null;
    this.onLockChange = null;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (!this.typing) e.preventDefault(); return; }
      if (this.typing) return;                       // console has focus
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.edges.add(e.code);
      this.onKey?.(e.code, e);
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      this._dragging = false;
    });

    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      document.body.classList.toggle('nolock', !this.locked);
      if (wasLocked && !this.locked && this.enabled) this.onPause?.('unlock');
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.typing) return;
      if (this.locked) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      } else if (this.dragLook && this._dragging) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouse.down = true;
      if (!this.locked && !this.dragLook && this.enabled) {
        this.requestLock();
      }
      if (!this.locked) this._dragging = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.mouse.down = false;
      this._dragging = false;
    });

    this.canvas.addEventListener('click', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.dragLook) this.requestLock();
      if (this.locked || this.dragLook) this.edges.add('Click');
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- touch ----------------------------------------------------------
    const opts = { passive: false };
    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        const leftHalf = t.clientX < window.innerWidth * 0.45;
        if (leftHalf && this.touch.moveId === null) {
          this.touch.moveId = t.identifier;
          this.touch.moveStart = [t.clientX, t.clientY];
          this.touch.moveVec = [0, 0];
        } else if (this.touch.lookId === null) {
          this.touch.lookId = t.identifier;
          this.touch.lookLast = [t.clientX, t.clientY];
        }
      }
    }, opts);
    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) {
          const dx = t.clientX - this.touch.moveStart[0];
          const dy = t.clientY - this.touch.moveStart[1];
          const max = 58;
          let vx = dx / max, vy = dy / max;
          const len = Math.hypot(vx, vy);
          if (len > 1) { vx /= len; vy /= len; }
          this.touch.moveVec = [vx, -vy];
        } else if (t.identifier === this.touch.lookId) {
          this.mouse.dx += (t.clientX - this.touch.lookLast[0]) * 2.0;
          this.mouse.dy += (t.clientY - this.touch.lookLast[1]) * 2.0;
          this.touch.lookLast = [t.clientX, t.clientY];
        }
      }
    }, opts);
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) { this.touch.moveId = null; this.touch.moveVec = [0, 0]; }
        if (t.identifier === this.touch.lookId) {
          this.touch.lookId = null;
          // a quick tap on the right side = use
          this.edges.add('Click');
        }
      }
    };
    this.canvas.addEventListener('touchend', endTouch, opts);
    this.canvas.addEventListener('touchcancel', endTouch, opts);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => { this.dragLook = true; });
      // if the browser silently refuses, fall back after a beat
      setTimeout(() => {
        if (!this.locked) this.dragLook = true;
      }, 450);
    } catch (e) {
      this.dragLook = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.keys.clear(); this.edges.clear(); this.mouse.dx = this.mouse.dy = 0; }
  }

  setTyping(on) {
    this.typing = on;
    if (on) { this.keys.clear(); this.edges.clear(); this.mouse.dx = this.mouse.dy = 0; }
  }

  /** Returns the look delta in radians-consumable units (already smoothed by the player). */
  consumeLook() {
    const s = 0.0022 * this.sensitivity;
    const out = {
      dx: this.mouse.dx * s,
      dy: this.mouse.dy * s * (this.invertY ? -1 : 1),
    };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return out;
  }

  /** Movement intent in local space: x=right, z=forward. */
  moveVector() {
    let x = 0, z = 0;
    for (const [code, [mx, mz]] of Object.entries(MOVE_KEYS)) {
      if (this.keys.has(code)) { x += mx; z += mz; }
    }
    if (this.touch.moveId !== null) { x += this.touch.moveVec[0]; z += this.touch.moveVec[1]; }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, len: Math.min(len, 1) };
  }

  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  pressed(code) {
    if (this.edges.has(code)) { return true; }
    return false;
  }

  endFrame() { this.edges.clear(); }
}
