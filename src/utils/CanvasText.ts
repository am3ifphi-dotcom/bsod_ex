/**
 * Canvas typography helpers.
 *
 * Two problems this solves, both of which used to ruin the in-world signage:
 *
 *  1. GLYPH COVERAGE. The BSOD copy is Japanese. If the canvas font stack resolves to a family
 *     that has no CJK glyphs (Linux, kiosk browsers, locked-down Chromebooks), every character
 *     renders as a hollow tofu box and the single most important prop in the game turns into
 *     rectangles. We probe candidate families by rendering a glyph next to a Private Use Area
 *     codepoint: if both rasters are identical, the family had no glyph and fell back to the
 *     same missing-glyph box.
 *
 *  2. OVERFLOW. Signs are authored on a fixed canvas, but translated strings are not. `fitText`
 *     shrinks to a floor size and then ellipsises so nothing ever runs off a plaque or through
 *     the bezel of a monitor.
 *
 * Everything is cached — the probes run once, at boot, while the loading bar is on screen.
 */

type Ctx = CanvasRenderingContext2D;

const CJK_SAMPLE = '問';
const MISSING_PROBE = '\uE000'; // Private Use Area: nothing ships a real glyph for this.

const JP_STACK = [
  // Self-hosted subset first: it is the only family guaranteed to exist on every client.
  '"Noto Sans JP"',
  '"Yu Gothic UI"',
  '"Yu Gothic"',
  '"Hiragino Sans"',
  '"Hiragino Kaku Gothic ProN"',
  '"Noto Sans JP"',
  '"Noto Sans CJK JP"',
  '"Source Han Sans JP"',
  '"IBM Plex Sans JP"',
  '"Meiryo"',
  '"MS PGothic"',
  '"BIZ UDGothic"',
  '"Droid Sans Japanese"',
];

const MONO_STACK = [
  '"Cascadia Mono"',
  '"Consolas"',
  '"SF Mono"',
  '"Roboto Mono"',
  '"Noto Sans Mono CJK JP"',
  '"BIZ UDGothic"',
  '"MS Gothic"',
  '"Noto Sans JP"',
  '"monospace"',
];

let resolvedJp: string | null = null;
let resolvedMono: string | null = null;

/** Renders `ch` into a tiny scratch canvas and returns a crude ink signature. */
function rasterSignature(ctx: Ctx, family: string, ch: string, px = 34): string {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 48, 48);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `400 ${px}px ${family}`;
  ctx.fillText(ch, 4, 24);
  let data: ImageData | null = null;
  try {
    data = ctx.getImageData(0, 0, 48, 48);
  } catch {
    return 'unavailable';
  }
  if (!data || data.data.length !== 48 * 48 * 4) return 'unavailable';
  let sig = '';
  let ink = 0;
  for (let i = 3; i < data.data.length; i += 4) {
    const a = data.data[i];
    if (a > 40) ink++;
    // Coarse 1-bit sampling keeps the signature cheap and still distinguishes glyph shapes.
    sig += a > 110 ? '1' : '0';
  }
  return `${ink}:${sig}`;
}

/**
 * True when `family` actually rasterises a CJK glyph instead of the missing-glyph box.
 * `unavailable` (canvas readback denied) is treated as "assume it works" so we never
 * accidentally downgrade a font stack we cannot inspect.
 */
function familyHasCjk(ctx: Ctx, family: string): boolean {
  const sample = rasterSignature(ctx, family, CJK_SAMPLE);
  if (sample === 'unavailable') return true;
  const tofu = rasterSignature(ctx, family, MISSING_PROBE);
  if (tofu === 'unavailable') return true;
  return sample !== tofu;
}

function probeContext(): Ctx | null {
  try {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const canvas = doc.createElement('canvas') as HTMLCanvasElement;
    canvas.width = 48;
    canvas.height = 48;
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Best available Japanese-capable family list, cached after the first probe. */
export function jpFontStack(): string {
  if (resolvedJp) return resolvedJp;
  const ctx = probeContext();
  if (!ctx) {
    resolvedJp = JP_STACK.join(', ');
    return resolvedJp;
  }
  for (const family of JP_STACK) {
    const plain = family.replace(/"/g, '');
    // A bare fallback family name still needs quoting when it contains a space.
    const candidate = plain === family ? family : family;
    if (familyHasCjk(ctx, candidate)) {
      // Keep the resolved family first but retain the rest of the stack for weight coverage.
      resolvedJp = [family, 'sans-serif'].join(', ');
      return resolvedJp;
    }
  }
  resolvedJp = 'sans-serif';
  return resolvedJp;
}

/** Monospace stack that can also render Japanese telemetry captions. */
export function monoFontStack(): string {
  if (resolvedMono) return resolvedMono;
  const ctx = probeContext();
  if (!ctx) {
    resolvedMono = MONO_STACK.join(', ');
    return resolvedMono;
  }
  for (const family of MONO_STACK) {
    const plain = family.replace(/"/g, '');
    if (familyHasCjk(ctx, plain)) {
      resolvedMono = [family, 'monospace'].join(', ');
      return resolvedMono;
    }
  }
  resolvedMono = 'monospace';
  return resolvedMono;
}

/** `ctx.font` assignment helper — keeps weight/size/family ordering correct everywhere. */
export function setFont(ctx: Ctx, weight: number | string, sizePx: number, family: string): void {
  ctx.font = `${weight} ${Math.max(1, Math.round(sizePx))}px ${family}`;
}

export interface FitOptions {
  weight?: number | string;
  sizePx: number;
  minSizePx?: number;
  family: string;
  /** Truncate with a single glyph tail rather than wrapping. */
  ellipsis?: string;
}

/**
 * Shrink-then-ellipsise a single line so it always fits `maxWidth`.
 * Returns the (possibly shortened) string and the pixel size actually used.
 */
export function fitText(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  opts: FitOptions
): { text: string; sizePx: number } {
  const { family, ellipsis = '…' } = opts;
  const weight = opts.weight ?? 400;
  const minSize = opts.minSizePx ?? Math.max(10, opts.sizePx * 0.62);
  let size = opts.sizePx;
  setFont(ctx, weight, size, family);
  if (ctx.measureText(text).width <= maxWidth) return { text, sizePx: size };

  // 1. Step the size down.
  while (size > minSize) {
    size = Math.max(minSize, size - Math.max(1, size * 0.06));
    setFont(ctx, weight, size, family);
    if (ctx.measureText(text).width <= maxWidth) return { text, sizePx: size };
  }

  // 2. Shed characters from the tail until the ellipsised line fits.
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + ellipsis).width > maxWidth) {
    cut = cut.slice(0, Math.max(1, cut.length - 1));
  }
  return { text: cut.length < text.length ? cut + ellipsis : cut, sizePx: size };
}

/**
 * Greedy word/character wrap for mixed Japanese + latin copy.
 * Japanese has no spaces, so we fall back to per-character wrapping when a "word" is too long.
 */
export function wrapText(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  weight: number | string,
  sizePx: number,
  family: string
): string[] {
  setFont(ctx, weight, sizePx, family);
  const out: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (!para) {
      out.push('');
      continue;
    }
    // Break on spaces first, then split any over-long token per grapheme.
    const tokens = para.split(/(\s+)/).filter((t) => t.length > 0);
    let line = '';
    const push = (): void => {
      if (line.trim().length > 0) out.push(line.trimEnd());
      line = '';
    };
    for (const token of tokens) {
      const test = line + token;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
        continue;
      }
      if (line.trim().length > 0) push();
      if (ctx.measureText(token).width <= maxWidth) {
        line = token.trimStart();
        continue;
      }
      // Very long token (CJK run or hex blob): hard-wrap by character.
      let chunk = '';
      for (const ch of Array.from(token)) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk.length > 0) {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    push();
  }
  return out;
}
