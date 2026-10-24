// Minimal DOM + canvas shim so three.js scene construction can run under node.
// WebGL is *not* available; this only exercises geometry/material/logic code.
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><canvas id="c"></canvas></body></html>', { pretendToBeVisual: true });
  const w = dom.window as any;
  globalThis.window = w;
  globalThis.document = w.document;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  } catch { /* node 22 exposes a read-only navigator */ }
  globalThis.HTMLElement = w.HTMLElement;
  globalThis.HTMLCanvasElement = w.HTMLCanvasElement;
  (globalThis as any).self = w;
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);

  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (tag: string) => {
    if (String(tag).toLowerCase() === 'canvas') {
      const c: any = createCanvas(300, 150);
      c.style = {};
      c.clientWidth = 300;
      c.clientHeight = 150;
      c.addEventListener = () => {};
      c.removeEventListener = () => {};
      return c;
    }
    return origCreate(tag);
  };
  return dom;
}
