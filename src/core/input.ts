/**
 * 入力管理: ポインターロック / キーボード / マウス
 * - コンソール表示中・強制演出中はゲーム入力を遮断する
 * - IME(日本語入力)合成中はキーを無視する
 * - Esc / ポインターロック解除の競合を吸収する
 */

export type InputMode = 'game' | 'ui' | 'locked-cinematic';

interface MouseDelta { x: number; y: number }

export class InputManager {
  readonly keys = new Set<string>();
  readonly mouseButtons = new Set<number>();
  mode: InputMode = 'ui';

  /** ポインターロックが有効か(視点操作の可否) */
  pointerLocked = false;
  /** ユーザー操作によりポインターロックが必要な状態 */
  wantsPointerLock = false;

  private delta: MouseDelta = { x: 0, y: 0 };
  private wheelDelta = 0;
  private clickQueue: number[] = [];
  private keyPressQueue: string[] = [];
  private composing = false;
  private canvas: HTMLElement | null = null;

  /** モード変更通知(コンソール開閉など) */
  onModeChange: ((mode: InputMode) => void) | null = null;
  /** ポインターロック喪失(=Esc相当)通知。UI側でメニューを開く */
  onPointerLockLost: (() => void) | null = null;
  /** F キー等のフリーキー(ゲームモード時のみ) */
  onAction: ((code: string) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
    });
  }

  attachCanvas(canvas: HTMLElement): void {
    this.canvas = canvas;
    // ポインターロック要求はユーザー操作経由のクリックで行う
    canvas.addEventListener('click', () => {
      if (this.wantsPointerLock && !this.pointerLocked && this.mode === 'game') {
        this.requestLock();
      }
    });
  }

  requestLock(): void {
    this.wantsPointerLock = true;
    if (this.canvas && !this.pointerLocked) {
      const p = (this.canvas as HTMLElement & { requestPointerLock(): Promise<void> | void }).requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          /* ユーザー操作が無い等の理由で失敗 → resume-hint 表示で吸収 */
        });
      }
    }
  }

  releaseLock(): void {
    this.wantsPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'game') {
      // ゲーム操作へ復帰
    } else {
      this.keys.clear();
      this.mouseButtons.clear();
    }
    this.onModeChange?.(mode);
  }

  /** 視点回転量を取得してリセット */
  consumeMouseDelta(): MouseDelta {
    const d = this.delta;
    this.delta = { x: 0, y: 0 };
    return d;
  }

  consumeWheel(): number {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  }

  /** クリック(ボタン番号)のキュー */
  consumeClicks(): number[] {
    const c = this.clickQueue;
    this.clickQueue = [];
    return c;
  }

  consumeKeyPresses(): string[] {
    const k = this.keyPressQueue;
    this.keyPressQueue = [];
    return k;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** 移動入力 (WASD + 矢印) */
  moveVector(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.mode !== 'game' || !this.pointerLocked) return { x: 0, z: 0 };
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.composing || e.isComposing || e.keyCode === 229) return;

    // コンソール入力中は、ゲーム用キーを流用しない(コンソールUI自身で処理)
    if (this.mode === 'ui' && document.activeElement && document.activeElement.tagName === 'INPUT') {
      return;
    }

    if (this.mode === 'game') {
      // 連打・キーリピートは押しっぱなし判定にのみ使う
      if (!e.repeat) this.keyPressQueue.push(e.code);
      this.keys.add(e.code);

      if (e.code === 'KeyF' && !e.repeat) this.onAction?.('KeyF');
      if (e.code === 'KeyC' && !e.repeat) this.onAction?.('KeyC');
      if (e.code === 'KeyE' && !e.repeat) this.onAction?.('KeyE');
      if (e.code === 'KeyR' && !e.repeat) this.onAction?.('KeyR');
      if (e.code === 'F3' && !e.repeat) {
        e.preventDefault();
        this.onAction?.('F3');
      }
      if (e.code === 'Escape') {
        // ブラウザがポインターロックを外す → onPointerLockLost 経由でメニュー
      }
      // ゲームモード中のスペース等でページスクロール防止
      if (e.code === 'Space') e.preventDefault();
    } else if (this.mode === 'locked-cinematic') {
      // 強制演出: 入力はすべて無視(ログだけ)
    } else {
      // UI モード: C / Escape はUI層で処理するためキーキューに積む
      if (!e.repeat) this.keyPressQueue.push(e.code);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked || this.mode !== 'game') return;
    // 感度は呼び出し側で掛ける
    this.delta.x += e.movementX || 0;
    this.delta.y += e.movementY || 0;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.mode === 'game' && this.pointerLocked) {
      this.mouseButtons.add(e.button);
      this.clickQueue.push(e.button);
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.mode === 'game') this.wheelDelta += Math.sign(e.deltaY);
  };

  private handleBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
  };

  private handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    const was = this.pointerLocked;
    this.pointerLocked = locked;
    if (was && !locked && this.wantsPointerLock) {
      // Esc 等でロックが外れた
      this.onPointerLockLost?.();
    }
  };

  /** IME の合成状態監視(コンソール用 input に対して張る) */
  watchIME(el: HTMLElement): void {
    el.addEventListener('compositionstart', () => (this.composing = true));
    el.addEventListener('compositionend', () => (this.composing = false));
  }

  get isComposing(): boolean {
    return this.composing;
  }
}
