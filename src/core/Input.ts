import { clamp } from './util';

export type LookMode = 'pointerlock' | 'drag' | 'none';

/**
 * 入力管理。
 * - ゲーム入力の有効/無効 (コンソール・メニュー・強制演出中) を一元管理
 * - ポインタロック失敗時のフォールバック (ドラッグ視点)
 * - キーリピートは「押しっぱなし」判定に使わない (event.repeat を無視)
 */
export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private canvas: HTMLElement;
  private lookMode: LookMode = 'none';

  sensitivity = 1.0;         // 0.2 .. 3.0
  invertY = false;

  /** ゲーム操作 (移動・視点) を許可するか */
  gameplay = false;
  /** マウス視点を許可するか (強制演出中は false) */
  lookEnabled = false;

  /** このフレームの累積マウス移動 (px) */
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** このフレームのクリック (左) */
  clicked = false;
  /** 連打数カウント用 (押された瞬間のみ) */
  clickDown = false;

  onKeyDown?: (code: string, e: KeyboardEvent) => void;
  onKeyUp?: (code: string, e: KeyboardEvent) => void;
  onPointerLockChange?: (locked: boolean) => void;

  private dragActive = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private mouseX = 0;
  private mouseY = 0;

  constructor(private el: HTMLElement) {
    this.canvas = el;
    this.bind();
  }

  get pointerLocked() { return document.pointerLockElement === this.canvas; }

  private bind() {
    window.addEventListener('keydown', (e) => {
      // ブラウザ標準の挙動 (スクロール・検索など) を抑止
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote'].includes(e.code)
        && this.gameplay) e.preventDefault();
      if (e.repeat) { this.onKeyDown?.(e.code, e); return; }
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.onKeyDown?.(e.code, e);
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
      this.onKeyUp?.(e.code, e);
    });

    window.addEventListener('blur', () => { this.keys.clear(); this.dragActive = false; });

    this.el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.lookEnabled && this.lookMode === 'drag' && !this.pointerLocked) {
        this.dragActive = true;
        this.lastDragX = e.clientX; this.lastDragY = e.clientY;
      }
      this.clickDown = true;
      this.clicked = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.dragActive = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      if (!this.lookEnabled) return;
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      } else if (this.dragActive) {
        this.mouseDX += e.clientX - this.lastDragX;
        this.mouseDY += e.clientY - this.lastDragY;
        this.lastDragX = e.clientX; this.lastDragY = e.clientY;
      }
    });
    this.el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const locked = this.pointerLocked;
      if (locked) this.lookMode = 'pointerlock';
      this.onPointerLockChange?.(locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // ロックできない環境 (iframe / 権限) ではドラッグ視点に切り替える
      this.lookMode = 'drag';
      this.onPointerLockChange?.(false);
    });
  }

  /** 画面中央からのマウス位置 (NDC) - BSOD のクリック判定に使用 */
  get ndc() {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((this.mouseX - r.left) / r.width) * 2 - 1,
      y: -((this.mouseY - r.top) / r.height) * 2 + 1,
    };
  }

  async requestLock() {
    if (this.pointerLocked) return true;
    try {
      await this.canvas.requestPointerLock();
      return true;
    } catch {
      this.lookMode = 'drag';
      return false;
    }
  }

  releaseLock() {
    if (this.pointerLocked) document.exitPointerLock();
    this.dragActive = false;
  }

  isDown(code: string) { return this.keys.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  wasReleased(code: string) { return this.released.has(code); }

  /** 視点移動量 (ラジアン)。感度スライダーは即時反映される */
  consumeLook(radPerPixel = 0.0022) {
    const s = clamp(this.sensitivity, 0.2, 3.0) * radPerPixel;
    const yaw = -this.mouseDX * s;
    const pitch = -this.mouseDY * s * (this.invertY ? -1 : 1);
    this.mouseDX = 0; this.mouseDY = 0;
    return { yaw, pitch };
  }

  endFrame() {
    if (!this.lookEnabled) { this.mouseDX = 0; this.mouseDY = 0; }
    this.pressed.clear();
    this.released.clear();
    this.clicked = false;
    this.clickDown = false;
    this.wheel = 0;
  }
}
