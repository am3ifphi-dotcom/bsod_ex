/* Node 上で Canvas2D / DOM を最小限にスタブする (スモークテスト専用) */
type Ctx = Record<string, unknown>;

function makeCtx(canvas: unknown): Ctx {
  const grad = { addColorStop() { /* noop */ } };
  const base: Record<string, unknown> = {
    canvas,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: () => ({ width: 24, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }),
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k as string];
      return () => undefined;
    },
    set(t, k, v) { t[k as string] = v; return true; },
  });
}

function makeCanvas(w = 1, h = 1) {
  const c: Record<string, unknown> = { width: w, height: h, style: {} };
  const ctx = makeCtx(c);
  c.getContext = () => ctx;
  c.addEventListener = () => undefined;
  c.removeEventListener = () => undefined;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 });
  c.requestPointerLock = async () => undefined;
  c.toDataURL = () => 'data:,';
  return c;
}

export function installDomStub() {
  const doc = {
    createElement: (tag: string) => (tag === 'canvas' ? makeCanvas(2, 2) : { style: {}, appendChild() {}, addEventListener() {} }),
    createElementNS: () => makeCanvas(2, 2),
    getElementById: (id: string) => (id === 'gl' ? { style: {}, addEventListener() {}, classList: { add() {}, remove() {} } } : null),
    addEventListener() { /* noop */ },
    body: { appendChild() {}, style: {} },
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  const win = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() { /* noop */ },
    location: { search: '' },
  };
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { location: unknown }).location = { search: '?debug=1', href: 'http://localhost/' };
  (globalThis as unknown as { self: unknown }).self = globalThis;
}
installDomStub();
