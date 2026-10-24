/**
 * Input: pointer lock, mouse look accumulation, keyboard state, one-shot actions, and a
 * blocking layer used by every modal UI (console, menu, credits, forced camera sequences).
 *
 * Rules that keep the experience from breaking:
 *  - Nothing is read from the DOM after a modal opens: `block()` stops mouse look immediately.
 *  - Escape is never swallowed; if the browser releases pointer lock we report it so the game
 *    can enter the pause state instead of silently losing input.
 *  - IME composition (Japanese input in the console) never produces game actions.
 */

export type ActionName =
  | 'interact' | 'console' | 'flashlight' | 'pause' | 'perf' | 'dev'
  | 'sprint' | 'forward' | 'back' | 'left' | 'right' | 'click';

interface ActionBinding {
  codes: string[];
  onPress?: () => void;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = false;
  private blockCount = 0;
  private bindings = new Map<ActionName, ActionBinding>();
  private actionHandlers = new Map<ActionName, Set<() => void>>();
  private enabled = true;

  locked = false;
  lockSupported = true;
  /**
   * Set when Pointer Lock is unavailable (an iframe without allow="pointer-lock", a browser
   * policy, a remote-desktop client). The game stays fully playable: mouse movement over the
   * viewport turns the camera without a locked cursor.
   */
  freeLook = false;

  private canvas: HTMLElement;
  private listeners: Array<() => void> = [];
  onPointerLockChange?: (locked: boolean) => void;
  onLockError?: (err: unknown) => void;
  onFirstInteraction?: () => void;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;

    const add = (target: Window | Document | HTMLElement,
      type: string, handler: (ev: Event) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, handler as EventListener, opts);
      this.listeners.push(() => target.removeEventListener(type as string, handler as EventListener, opts));
    };

    add(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    add(window, 'keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    add(window, 'blur', () => this.clearKeys());
    add(document, 'visibilitychange', () => { if (document.hidden) this.clearKeys(); });

    add(window, 'mousemove', (e) => {
      const me = e as MouseEvent;
      if (!this.isActive()) return;
      if (!this.locked && !this.freeLook) return;
      // Ignore occasional giant spikes some mice/OS combos emit on lock acquisition.
      if (Math.abs(me.movementX) > 400 || Math.abs(me.movementY) > 400) return;
      this.mouseDX += me.movementX;
      this.mouseDY += me.movementY;
    });

    add(window, 'mousedown', (e) => {
      const me = e as MouseEvent;
      if (me.button !== 0) return;
      this.mouseDown = true;
      if (!this.isActive()) return;
      if (!this.locked) { this.requestPointerLock(); return; }
      this.fire('click');
    });
    add(window, 'mouseup', (e) => { if ((e as MouseEvent).button === 0) this.mouseDown = false; });

    add(document, 'pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked !== wasLocked) {
        this.mouseDX = 0;
        this.mouseDY = 0;
        this.onPointerLockChange?.(this.locked);
      }
    });
    add(document, 'pointerlockerror', (e) => {
      this.lockSupported = false;
      this.onLockError?.(e);
    });
    add(this.canvas, 'click', () => {
      this.onFirstInteraction?.();
      if (!this.locked && this.isActive()) this.requestPointerLock();
    });
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  bind(name: ActionName, codes: string[]): void {
    this.bindings.set(name, { codes });
  }

  on(name: ActionName, fn: () => void): () => void {
    let set = this.actionHandlers.get(name);
    if (!set) { set = new Set(); this.actionHandlers.set(name, set); }
    set.add(fn);
    return () => set?.delete(fn);
  }

  private fire(name: ActionName): void {
    const set = this.actionHandlers.get(name);
    if (!set) return;
    for (const fn of set) {
      try { fn(); } catch (err) { console.error(`[input] handler for ${name} failed`, err); }
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return; // IME composition
    this.keys.add(e.code);
    if (e.repeat) return;
    this.pressed.add(e.code);
    if (!this.isActive()) return;
    // map to actions
    for (const [name, binding] of this.bindings) {
      if (binding.codes.includes(e.code)) {
        // Prevent the browser's default for keys we own (space/arrows/tab) while playing.
        if (['Space', 'Tab', 'F3', 'F9'].includes(e.code)) e.preventDefault();
        this.fire(name);
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.isComposing) return;
  }

  clearKeys(): void {
    this.keys.clear();
    this.pressed.clear();
    this.mouseDown = false;
  }

  isDown(code: string): boolean { return this.keys.has(code); }
  wasPressed(code: string): boolean { return this.pressed.has(code); }
  consumePresses(): void { this.pressed.clear(); }

  /** Movement vector in local space: x = right, y = forward. */
  moveAxis(): { x: number; y: number } {
    if (!this.isActive()) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  isSprinting(): boolean {
    return this.isActive() && (this.isDown('ShiftLeft') || this.isDown('ShiftRight'));
  }

  /** Consume accumulated mouse delta (radians handled by the caller through sensitivity). */
  takeMouseDelta(): { x: number; y: number } {
    if ((!this.locked && !this.freeLook) || !this.isActive()) {
      this.mouseDX = 0;
      this.mouseDY = 0;
      return { x: 0, y: 0 };
    }
    const out = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  isActive(): boolean { return this.enabled && this.blockCount === 0; }

  get blocked(): boolean { return this.blockCount > 0; }

  block(): () => void {
    this.blockCount++;
    this.clearKeys();
    return () => { this.blockCount = Math.max(0, this.blockCount - 1); };
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.clearKeys();
  }

  /** True when the view can be turned, with or without a locked pointer. */
  get lookActive(): boolean { return this.locked || this.freeLook; }

  /** Fallback used when Pointer Lock is denied (e.g. inside an iframe). */
  setFreeLook(enabled: boolean): void {
    this.freeLook = enabled;
    if (enabled) this.mouseDX = this.mouseDY = 0;
  }

  requestPointerLock(): void {
    if (this.freeLook) return;
    if (document.pointerLockElement === this.canvas) return;
    const el = this.canvas as HTMLElement & { requestPointerLock?: (opts?: unknown) => Promise<void> | void };
    try {
      const res = el.requestPointerLock?.({ unadjustedMovement: false });
      // Chrome returns a promise; absent in some browsers.
      if (res && typeof (res as Promise<void>).catch === 'function') {
        (res as Promise<void>).catch((err) => {
          console.warn('[input] pointer lock rejected', err);
          this.lockSupported = false;
          this.onLockError?.(err);
        });
      }
    } catch (err) {
      console.warn('[input] pointer lock failed', err);
      this.lockSupported = false;
      this.onLockError?.(err);
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }
}
