// 入力管理: キーボード / マウス / Pointer Lock / フォーカス状態
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false;
    this.locked = false;
    this.enabled = false;            // ゲームが入力を受け付けるか
    this.consumeMouseMove = false;   // 次の mousemove を消費するか(ロック復帰時のジャンプ対策)
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this._justPressed = new Set();
    this._onLockChange = null;
    this._onClick = null;
    this._preventKeys = new Set(['Tab']);

    document.addEventListener('keydown', (e) => {
      if (this._preventKeys.has(e.key)) e.preventDefault();
      if (!e.repeat) this._justPressed.add(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.consumeMouseMove) { this.consumeMouseMove = false; return; }
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this._justPressed.add('Mouse0');
      }
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { this.wheel += e.deltaY; }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.consumeMouseMove = true;
      this.keys.clear();
      this.mouseDown = false;
      if (this._onLockChange) this._onLockChange(this.locked);
    });
  }

  onLockChange(fn) { this._onLockChange = fn; }
  onClick(fn) { this._onClick = fn; }
  fireClick() { if (this._onClick) this._onClick(); }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => { /* ブラウザ側で拒否された場合: ポーズUIから復帰可能 */ });
      } catch { /* noop */ }
    }
  }
  exitLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this._justPressed.has(code); }

  // マウスNDC(インスペクト時のレイキャスト用)
  mouseNDC(eventLike) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((eventLike.clientX - r.left) / r.width) * 2 - 1;
    const y = -((eventLike.clientY - r.top) / r.height) * 2 + 1;
    if (!this._ndc) this._ndc = { x: 0, y: 0 };
    this._ndc.x = x;
    this._ndc.y = y;
    return this._ndc;
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this._justPressed.clear();
  }
}
