import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const registry: any[] = [];
globalThis.document = {
  createElement: (tag: string) => {
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  createElementNS: () => {
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  addEventListener() {},
  body: { appendChild() {}, style: {} },
  documentElement: { style: {} },
  hidden: false,
} as any;
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as any;
globalThis.self = globalThis as any;

const { BsodScreen } = await import('../src/world/BsodScreen.ts');
const s = new BsodScreen() as any;
fs.mkdirSync('/tmp/bsod', { recursive: true });
s.stageTextures.forEach((t: any, i: number) => {
  fs.writeFileSync(`/tmp/bsod/stage${i}.png`, t.image.toBuffer('image/png'));
});
fs.writeFileSync('/tmp/bsod/face.png', s.faceCanvas.toBuffer('image/png'));
fs.writeFileSync('/tmp/bsod/aftermath.png', s.aftermathTex.image.toBuffer('image/png'));
fs.writeFileSync('/tmp/bsod/card.png', s.cardTex.image.toBuffer('image/png'));
console.log('dumped', s.stageTextures.length, 'stages');
