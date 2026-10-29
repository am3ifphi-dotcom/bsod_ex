/**
 * Boots the real BsodScreen with an actual 2D canvas implementation (no stub drawing) so the
 * BSOD body texture and the face channel texture can be inspected pixel by pixel.
 *
 * Run: npx tsx scripts/inspect-bsod-canvas.mts
 */
import { createCanvas } from '@napi-rs/canvas';

const registry: any[] = [];

globalThis.document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  createElementNS: (_ns: string, tag: string) => {
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  addEventListener() {},
  body: { appendChild() {}, style: {} },
  documentElement: { style: {} },
  hidden: false,
} as any;

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
} as any;

globalThis.self = globalThis as any;

const { BsodScreen } = await import('../src/world/BsodScreen.ts');

const screen = new BsodScreen();

function stats(canvas: any, label: string) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  let sr = 0, sg = 0, sb = 0, n = 0, nonEmpty = 0;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (r + g + b > 24) {
        nonEmpty++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      sr += r; sg += g; sb += b; n++;
    }
  }
  console.log(
    `${label}: ${width}x${height} avgRGB=(${(sr / n).toFixed(0)},${(sg / n).toFixed(0)},${(sb / n).toFixed(0)}) ` +
    `inkCoverage=${((nonEmpty / n) * 100).toFixed(1)}% inkBox=[${maxX > 0 ? `${minX},${minY}` : '-'}..${maxX > 0 ? `${maxX},${maxY}` : '-'}]`,
  );
  return { nonEmpty, n };
}

console.log('--- canvases created (in construction order) ---');
console.log('count =', registry.length);

const body = registry[0];
const face = registry[1];

stats(body, 'bodyTex canvas');
stats(face, 'faceTex canvas');

// Face channel: verify red ':' channel and green '(' channel really landed
function channelStats(canvas: any, label: string, idx: number) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  let n = 0, sum = 0, minX = 1e9, maxX = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = img.data[(y * width + x) * 4 + idx];
      sum += v;
      if (v > 70) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
  }
  console.log(`  face ${label}: mean=${(sum / (width * height)).toFixed(2)} inkPx=${n} xRange=[${maxX > 0 ? minX : '-'}..${maxX > 0 ? maxX : '-'}]`);
}
channelStats(face, 'R :( colon', 0);
channelStats(face, 'G paren', 1);
channelStats(face, 'B (should be 0)', 2);

console.log('\n--- measured glyph metrics the shader places the face with ---');
const anyS = screen as any;
console.log('parenC', anyS.parenC.toArray(), 'parenSize', anyS.parenSize.toArray());
console.log('colonC', anyS.colonC.toArray(), 'colonSize', anyS.colonSize.toArray());
console.log('colonDotOff', anyS.colonDotOff.toArray(), 'spine', anyS.spine.toArray());

// Does the body canvas carry the expected cerulean fill?
const ctx2 = body.getContext('2d');
const img2 = ctx2.getImageData(4, 4, 1, 1).data;
console.log('\nbody corner pixel RGBA =', [...img2]);
