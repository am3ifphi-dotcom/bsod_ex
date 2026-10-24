// Keyboard / mouse / pointer-lock handling.
// A single source of truth for "can the player look & move right now".

export type KeyName = string;

export class Input {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** set while a text field / menu owns the keyboard */
  suspended = false;
  /** pointer lock + look enabled */
  lookEnabled = false;
  pointerLocked = false;

  private canvas: HTMLCanvasElement;
  private downHandlers = new Map<string, Set<() => void>>();
  private upHandlers = new Map<string, Set<() => void>>();
  private wheelHandlers = new Set<(dy: number) => void>();
  private mouseHandlers = new Set<(x: number, y: number) => void>();
  private clickHandlers = new Set<(x: number, y: number, button: number) => void>();
  private lookScale = 0.0022;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (this.isTextField(e.target)) return;      // console / inputs own their keys
      const code = e.code;
      // Never swallow browser-critical combos (reload, devtools, close tab)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Tab', 'F5', 'F12', 'F11'].includes(code)) return;
      if (this.suspended) {
        // still record so keys don't "stick" when we resume
        if (code === 'Escape') this.emit(this.downHandlers, 'Escape');
        return;
      }
      const wasDown = this.keys.has(code);
      this.keys.add(code);
      if (!wasDown) this.emit(this.downHandlers, code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      if (this.isTextField(e.target)) return;
      const code = e.code;
      if (!this.keys.has(code)) return;
      this.keys.delete(code);
      if (!this.suspended) this.emit(this.upHandlers, code);
    });

    window.addEventListener('blur', () => {
      // drop all keys: avoids stuck movement when alt-tabbing
      this.keys.clear();
      this.mouseDX = this.mouseDY = 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.mouseDX = this.mouseDY = 0;
        this.onPointerLockLost?.();
      }
    });
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
      this.onPointerLockLost?.();
    });

    window.addEventListener('mousemove', (e) => {
      const mx = e.clientX / window.innerWidth;
      const my = e.clientY / window.innerHeight;
      this.mouseHandlers.forEach((h) => h(e.clientX, e.clientY));
      if (!this.pointerLocked || this.suspended || !this.lookEnabled) return;
      // clamp huge deltas (some browsers report spikes after lock)
      const dx = Math.max(-220, Math.min(220, e.movementX || 0));
      const dy = Math.max(-220, Math.min(220, e.movementY || 0));
      this.mouseDX += dx;
      this.mouseDY += dy;
      void mx; void my;
    });

    window.addEventListener('mousedown', (e) => {
      if (this.suspended) return;
      if (this.isTextField(e.target)) return;
      if (this.pointerLocked || this.lookEnabled) {
        this.clickHandlers.forEach((h) => h(e.clientX, e.clientY, e.button));
      }
    });

    window.addEventListener('wheel', (e) => {
      if (this.suspended) return;
      this.wheelHandlers.forEach((h) => h(Math.sign(e.deltaY)));
    }, { passive: true });

    // keep the audio / pointer-lock target from dragging the page
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dragstart', (e) => e.preventDefault());
  }

  onPointerLockLost?: () => void;

  isTextField(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  private emit(map: Map<string, Set<() => void>>, code: string) {
    map.get(code)?.forEach((h) => h());
  }

  onDown(code: KeyName, fn: () => void) {
    if (!this.downHandlers.has(code)) this.downHandlers.set(code, new Set());
    this.downHandlers.get(code)!.add(fn);
    return () => this.downHandlers.get(code)?.delete(fn);
  }
  onUp(code: KeyName, fn: () => void) {
    if (!this.upHandlers.has(code)) this.upHandlers.set(code, new Set());
    this.upHandlers.get(code)!.add(fn);
    return () => this.upHandlers.get(code)?.delete(fn);
  }
  onWheel(fn: (dy: number) => void) { this.wheelHandlers.add(fn); return () => this.wheelHandlers.delete(fn); }
  onMouse(fn: (x: number, y: number) => void) { this.mouseHandlers.add(fn); return () => this.mouseHandlers.delete(fn); }
  onMouseDown(fn: (x: number, y: number, button: number) => void) {
    this.clickHandlers.add(fn);
    return () => this.clickHandlers.delete(fn);
  }

  isDown(code: KeyName) { return this.keys.has(code) && !this.suspended; }

  /** consume the accumulated look delta in radians (before sensitivity) */
  consumeLook(): { yaw: number; pitch: number } {
    const out = { yaw: -this.mouseDX * this.lookScale, pitch: -this.mouseDY * this.lookScale };
    this.mouseDX = 0; this.mouseDY = 0;
    return out;
  }

  clearLook() { this.mouseDX = 0; this.mouseDY = 0; }

  requestLock() {
    if (this.pointerLocked) return;
    const p = this.canvas.requestPointerLock({ unadjustedMovement: false } as any) as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture missing */ });
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
