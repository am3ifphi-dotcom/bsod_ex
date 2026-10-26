import * as THREE from 'three';

export type InputMode = 'play' | 'ui' | 'cinematic';

/**
 * Keyboard / mouse / pointer-lock manager.
 * - `mode` gates gameplay input (console, menus, forced cinematic sequences)
 * - mouse deltas are accumulated and consumed once per frame
 * - click state is exposed so the UI can use it in unlocked ("cursor") mode
 */
export class Input {
  canvas: HTMLCanvasElement;
  keys = new Set<string>();
  justPressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseNDC = new THREE.Vector2();
  private clickQueue = 0;
  rightClickQueued = false;
  locked = false;
  mode: InputMode = 'ui';
  enabled = true;
  sensitivity = 1;

  onLockChange?: (locked: boolean) => void;
  onEscape?: () => void;
  onKeyDown?: (code: string, e: KeyboardEvent) => boolean | void;

  private pointerLockRequested = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (this.onKeyDown?.(e.code, e)) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyF', 'KeyE', 'ShiftLeft', 'Escape'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDX = this.mouseDY = 0;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.clickQueue = Math.min(8, this.clickQueue + 1);
      if (e.button === 2) this.rightClickQueued = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      this.mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.pointerLockRequested = false;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.pointerLockRequested = false;
      this.locked = false;
      this.onLockChange?.(false);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'play') {
        // Escape cannot be captured while pointer locked in some browsers; the
        // pointerlockchange handler covers that case. This covers unlocked play.
        this.onEscape?.();
      }
    });
  }

  requestLock() {
    if (this.locked) return;
    this.pointerLockRequested = true;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: false } as any);
    if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeClick() {
    if (this.clickQueue <= 0) return false;
    this.clickQueue--;
    return true;
  }

  pressed(code: string) {
    return this.keys.has(code);
  }

  wasPressed(code: string) {
    return this.justPressed.has(code);
  }

  endFrame() {
    this.justPressed.clear();
  }
}
