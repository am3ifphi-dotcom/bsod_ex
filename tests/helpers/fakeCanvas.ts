/**
 * Minimal 2D canvas context for jsdom, so the world builders (which paint HUD/terminal
 * textures on canvases) can run in tests. It implements only what the project uses and
 * behaves like a real context for layout purposes: text metrics are approximated.
 */

type Ctx = CanvasRenderingContext2D;

class FakeGradient {
  stops: Array<[number, string]> = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

export function installFakeCanvas(): void {
  const proto = (globalThis as unknown as { HTMLCanvasElement?: { prototype: Record<string, unknown> } })
    .HTMLCanvasElement?.prototype;
  if (!proto) return;

  proto.getContext = function getContext(this: HTMLCanvasElement): Ctx {
    if ((this as unknown as { __ctx?: Ctx }).__ctx) return (this as unknown as { __ctx: Ctx }).__ctx;
    const ctx = {
      canvas: this,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '10px monospace',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      shadowBlur: 0,
      shadowColor: '#000',
      lineCap: 'butt',
      lineJoin: 'miter',
      imageSmoothingEnabled: true,
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      arc: () => {},
      ellipse: () => {},
      rect: () => {},
      roundRect: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 6 }),
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      setTransform: () => {},
      resetTransform: () => {},
      drawImage: () => {},
      createLinearGradient: () => new FakeGradient(),
      createRadialGradient: () => new FakeGradient(),
      createPattern: () => null,
      getImageData: (x: number, y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h,
      }),
      putImageData: () => {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    };
    (this as unknown as { __ctx: Ctx }).__ctx = ctx as unknown as Ctx;
    return ctx as unknown as Ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;

  proto.toDataURL = function toDataURL(): string { return 'data:image/png;base64,'; };
}
