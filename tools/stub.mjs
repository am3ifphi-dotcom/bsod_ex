/**
 * スモークテスト — ブラウザなしでワールド構築ロジックを通しで実行する。
 * Canvas 2D / WebGL は使えないので、2Dコンテキストはスタブに差し替える。
 *
 *   node tools/smoke.mjs
 */
import * as THREE from 'three';

/* ---------------- Canvas 2D スタブ ---------------- */
function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  const ctx = {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    filter: 'none',
    globalCompositeOperation: 'source-over',
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform() {},
    resetTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    setLineDash() {},
    getLineDash() {
      return [];
    },
    fillText() {},
    strokeText() {},
    measureText(t) {
      return { width: String(t).length * 8, actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 2 };
    },
    drawImage() {},
    createLinearGradient() {
      return grad;
    },
    createRadialGradient() {
      return grad;
    },
    createConicGradient() {
      return grad;
    },
    createPattern() {
      return null;
    },
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h };
    },
    createImageData(w, h) {
      if (typeof w === 'number') return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      return { data: new Uint8ClampedArray(w.width * w.height * 4), width: w.width, height: w.height };
    },
    putImageData() {},
    isPointInPath() {
      return false;
    },
  };
  return ctx;
}

function makeCanvas(w = 300, h = 150) {
  const c = {
    width: w,
    height: h,
    style: {},
    nodeName: 'CANVAS',
    clientWidth: w,
    clientHeight: h,
    getAttribute(n) {
      return n === 'width' ? String(this.width) : n === 'height' ? String(this.height) : null;
    },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    getContext(type) {
      if (type === '2d') {
        this._ctx = this._ctx || makeCtx(this);
        return this._ctx;
      }
      return null;
    },
    toDataURL() {
      return 'data:image/png;base64,';
    },
  };
  return c;
}

/* ---------------- グローバルスタブ ---------------- */
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas();
    return { style: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  },
  createElementNS(ns, tag) {
    return this.createElement(tag);
  },
  addEventListener() {},
  body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
  hidden: false,
  pointerLockElement: null,
};
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 0),
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true }); } catch {}

