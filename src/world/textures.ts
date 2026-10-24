/**
 * テクスチャ供給
 * - 外部PBRテクスチャ(BabylonJS Assets CC-BY-4.0 / three.js examples / Khronos)
 * - 手続き生成テクスチャ(グリッチ世界のUI断片・エラー文字・亀裂など)
 */
import * as THREE from 'three';
import { makeCanvas, canvasTexture, randomHex, randomGlitchString, mulberry32, fbm2, lerp, clamp } from '../core/utils';

const loader = new THREE.TextureLoader();

export interface PbrSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  metalnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
  bumpMap?: THREE.Texture;
}

function load(url: string, srgb: boolean, repeat = 1): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

export class TextureLibrary {
  private cache = new Map<string, THREE.Texture>();
  ready = false;

  // 外部PBR
  wood!: PbrSet;
  brick!: PbrSet;
  rocky!: PbrSet;
  dirt!: THREE.Texture;
  sand!: THREE.Texture;
  rock!: THREE.Texture;

  async loadExternal(): Promise<void> {
    const [woodMap, woodBump, woodRough, brickMap, brickBump, brickRough, rockyMap, rockyNorm, rockyMR, dirt, sand, rock] =
      await Promise.all([
        load('assets/textures/hardwood2_diffuse.jpg', true),
        load('assets/textures/hardwood2_bump.jpg', false),
        load('assets/textures/hardwood2_roughness.jpg', false),
        load('assets/textures/brick_diffuse.jpg', true),
        load('assets/textures/brick_bump.jpg', false),
        load('assets/textures/brick_roughness.jpg', false),
        load('assets/textures/rockyGround_basecolor.png', true),
        load('assets/textures/rockyGround_normal.png', false),
        load('assets/textures/rockyGround_metalRough.png', false),
        load('assets/textures/dirt.jpg', true),
        load('assets/textures/sand.jpg', true),
        load('assets/textures/rock.png', true),
      ]);

    // hardwood2 は bump → normal として扱う(three は bumpMap も使えるが統一のため normal 相当で)
    this.wood = { map: woodMap, roughnessMap: woodRough };
    this.wood.bumpMap = woodBump;
    this.brick = { map: brickMap, roughnessMap: brickRough };
    this.brick.bumpMap = brickBump;
    this.rocky = { map: rockyMap, normalMap: rockyNorm, roughnessMap: rockyMR, metalnessMap: rockyMR };
    this.dirt = dirt;
    this.sand = sand;
    this.rock = rock;
    this.ready = true;
  }

  tex(key: string, gen: () => HTMLCanvasElement): THREE.Texture {
    let t = this.cache.get(key);
    if (!t) {
      t = canvasTexture(gen());
      this.cache.set(key, t);
    }
    return t;
  }

  // ------------------------------------------------------------------
  //  手続き生成
  // ------------------------------------------------------------------

  /** グリッチ文字(エラー文字列)のアトラス */
  glyphAtlas(): THREE.Texture {
    return this.tex('glyphAtlas', () => {
      const { canvas, ctx } = makeCanvas(512, 512);
      ctx.fillStyle = '#02060f';
      ctx.fillRect(0, 0, 512, 512);
      const cell = 64;
      const lines = [
        '0x000000A1', 'PAGE_FAULT', ':(  ', 'MEM_DUMP', '▓▒░█', 'KERNEL', '0xDEAD', 'BSOD',
        'ERR_SYS', '█▓▒░', '0x00FF', 'LOST_', 'FAULT!', '>>C:\\', 'NULL', 'glitch',
        '0xC0DE', 'SAVE_ME', '[C]:', 'WAKE??', 'SEG_FAULT', '///', 'E_R_R', '<<>>',
        '0xB10B', 'MEM_ERR', '*_*', 'EXIT?', '░░░░', 'RUN()', '0xFFFF', 'help!',
      ];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 32; i++) {
        const x = (i % 8) * cell + cell / 2;
        const y = Math.floor(i / 8) * cell + cell / 2;
        ctx.fillStyle = i % 5 === 0 ? '#9fc3ff' : '#4d7fd4';
        ctx.font = `${i % 3 === 0 ? 'bold ' : ''}22px ui-monospace, Consolas, monospace`;
        ctx.fillText(lines[i], x, y);
      }
      return canvas;
    });
  }

  /** BSOD 画面(モニターテクスチャ)。恒久1枚を使い回して描き直す */
  private bsodCanvas: HTMLCanvasElement | null = null;
  private bsodTex: THREE.CanvasTexture | null = null;
  private bsodState = '';

  bsodScreen(frame: number, corruption: number, faceGrow = 0): THREE.Texture {
    const key = `${Math.round(corruption * 24)}_${Math.round(faceGrow * 12)}`;
    if (!this.bsodCanvas) {
      const { canvas } = makeCanvas(1024, 576);
      this.bsodCanvas = canvas;
      this.bsodTex = canvasTexture(canvas);
    }
    if (this.bsodState === key) return this.bsodTex!;
    this.bsodState = key;
    const canvas = this.bsodCanvas;
    const ctx = canvas.getContext('2d')!;
    this.drawBsod(ctx, canvas, frame, corruption, faceGrow);
    this.bsodTex!.needsUpdate = true;
    return this.bsodTex!;
  }

  private drawBsod(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, frame: number, corruption: number, faceGrow: number): void {
    const blue = `rgb(${lerp(10, 8, corruption)}, ${lerp(82, 40, corruption)}, ${lerp(199, 130, corruption)})`;
    ctx.fillStyle = blue;
    ctx.fillRect(0, 0, 1024, 576);

    // 巨大な :(
    ctx.fillStyle = '#e8f0ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (faceGrow <= 0) {
      ctx.font = '200px "Segoe UI", sans-serif';
      ctx.fillText(':(', 220, 250);
    } else {
      ctx.save();
      ctx.translate(512, 300);
      const s = 1 + faceGrow * 0.25;
      ctx.scale(s, s);
      ctx.font = `${200 + faceGrow * 240}px "Segoe UI", sans-serif`;
      ctx.fillText(':(', 0, 0);
      ctx.restore();
    }

    // テキスト
    const alpha = clamp(1 - faceGrow * 1.4, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#dfe8ff';
    ctx.textAlign = 'left';
    const scramble = (str: string): string => {
      if (corruption < 0.02) return str;
      return str
        .split('')
        .map((c) => (Math.random() < corruption * 0.55 ? randomGlitchString(1)[0] : c))
        .join('');
    };
    ctx.font = '28px "Segoe UI", sans-serif';
    ctx.fillText(scramble('お使いの PC に問題が発生したため、再起動する必要があります。'), 320, 320);
    ctx.font = '22px "Segoe UI", sans-serif';
    ctx.fillText(scramble('エラー コード: MEMORY_DUMP_FAULT'), 320, 372);
    ctx.fillText(scramble(`停止コード: 0x000000${randomHex(2)}`), 320, 410);
    ctx.fillText(scramble(`完了率: ${Math.min(100, Math.round(corruption * 137))}%`), 320, 448);
    // QRコード風
    if (corruption < 0.75) {
      const qs = 6;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          if ((x * 7 + y * 13 + frame * 3) % 3 === 0) {
            ctx.fillStyle = Math.random() < corruption ? '#7c93c8' : '#e8f0ff';
            ctx.fillRect(880 + x * qs, 420 + y * qs, qs, qs);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    // 乱れの帯
    if (corruption > 0.08) {
      const bands = Math.floor(corruption * 14);
      for (let i = 0; i < bands; i++) {
        const y = Math.random() * 576;
        const h = 2 + Math.random() * 18;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(0,10,40,0.4)';
        ctx.fillRect(0, y, 1024, h);
        const shift = (Math.random() - 0.5) * corruption * 120;
        ctx.drawImage(canvas, shift, y, 1024, h, 0, y, 1024, h);
      }
    }
  }

  /** 亀裂デカール */
  crackDecal(seed = 0): THREE.Texture {
    return this.tex(`crack_${seed}`, () => {
      const { canvas, ctx } = makeCanvas(512, 512);
      ctx.clearRect(0, 0, 512, 512);
      const rng = mulberry32(seed * 999 + 7);
      const cx = 256;
      const cy = 256;
      ctx.strokeStyle = 'rgba(10, 14, 26, 0.95)';
      for (let i = 0; i < 14; i++) {
        const ang = rng() * Math.PI * 2;
        let x = cx;
        let y = cy;
        ctx.lineWidth = 1 + rng() * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const len = 6 + rng() * 12;
        let a = ang;
        for (let s = 0; s < len; s++) {
          a += (rng() - 0.5) * 0.8;
          x += Math.cos(a) * (14 + rng() * 22);
          y += Math.sin(a) * (14 + rng() * 22);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // 中心の発光
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
      grad.addColorStop(0, 'rgba(60, 120, 255, 0.55)');
      grad.addColorStop(1, 'rgba(60, 120, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);
      return canvas;
    });
  }

  /** 破損UI(世界内に浮かぶ窓) */
  brokenUI(seed = 0, variant = 0): THREE.Texture {
    return this.tex(`ui_${seed}_${variant}`, () => {
      const { canvas, ctx } = makeCanvas(512, 288);
      const rng = mulberry32(seed * 31 + variant);
      ctx.fillStyle = 'rgba(6, 18, 48, 0.92)';
      ctx.fillRect(0, 0, 512, 288);
      ctx.strokeStyle = '#4d7fd4';
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, 500, 276);
      // タイトルバー
      ctx.fillStyle = '#12326e';
      ctx.fillRect(6, 6, 500, 36);
      ctx.fillStyle = '#9fc3ff';
      ctx.font = '18px ui-monospace, Consolas, monospace';
      const titles = ['SYSTEM_RECOVER.EXE', 'memory_dmp.sys', 'TERMINAL // LOST', 'bsod_driver', 'EXIT_NODE', 'process: gone'];
      ctx.fillText(titles[variant % titles.length], 18, 31);
      // 本文
      ctx.font = '20px ui-monospace, Consolas, monospace';
      const bodies = [
        ['> scan world ............ FAILED', '> scan host ............. FAILED', '> escape route: [C]', '> status: dreaming'],
        ['0x000000A1 MEMORY_DUMP_FAULT', 'the room is still loading', 'the room is still loading', 'the room is still load'],
        ['PRESS [C] TO OPEN TERMINAL', '> input protocol unknown', '> input protocol unknown', '> _'],
        ['who turned off the lights?', 'who turned off the lights?', 'who turned of█ the ligh', 'who t█rn█d █ff th█ ligh'],
      ];
      const body = bodies[variant % bodies.length];
      for (let i = 0; i < body.length; i++) {
        ctx.fillStyle = i === 2 && variant === 2 ? '#86ffc8' : '#6f93dd';
        const scramble = rng() < 0.3 ? randomGlitchString(body[i].length) : body[i];
        ctx.fillText(scramble, 24, 92 + i * 40);
      }
      // 破損帯
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(${80 + rng() * 100}, ${120 + rng() * 100}, 255, ${0.12 + rng() * 0.2})`;
        ctx.fillRect(0, rng() * 288, 512, 3 + rng() * 14);
      }
      return canvas;
    });
  }

  /** WAKE_UP の碑文 */
  wakeUpTexture(): THREE.Texture {
    return this.tex('wakeup', () => {
      const { canvas, ctx } = makeCanvas(1024, 256);
      ctx.fillStyle = '#020713';
      ctx.fillRect(0, 0, 1024, 256);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 140px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#8fc0ff';
      ctx.shadowColor = '#2a6bff';
      ctx.shadowBlur = 36;
      ctx.fillText('WAKE_UP', 512, 132);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(140, 180, 255, 0.5)';
      ctx.font = '22px ui-monospace, Consolas, monospace';
      ctx.fillText('// exit protocol 0x00000000', 512, 226);
      return canvas;
    });
  }

  /** 建物窓(都市の残骸) */
  windowGrid(seed = 0): THREE.Texture {
    return this.tex(`win_${seed}`, () => {
      const { canvas, ctx } = makeCanvas(256, 256);
      const rng = mulberry32(seed * 17 + 3);
      ctx.fillStyle = '#0a1224';
      ctx.fillRect(0, 0, 256, 256);
      const cols = 6;
      const rows = 8;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const r = rng();
          const px = 12 + x * 40;
          const py = 10 + y * 30;
          if (r < 0.16) ctx.fillStyle = '#cfe4ff';
          else if (r < 0.3) ctx.fillStyle = '#3d6cc4';
          else if (r < 0.36) ctx.fillStyle = '#7c93c8';
          else ctx.fillStyle = '#12203e';
          ctx.fillRect(px, py, 26, 18);
        }
      }
      return canvas;
    });
  }

  /** ブロックノイズ(深層エリアの壁) */
  blockNoise(seed = 0): THREE.Texture {
    return this.tex(`block_${seed}`, () => {
      const { canvas, ctx } = makeCanvas(256, 256);
      const rng = mulberry32(seed * 41 + 11);
      const cell = 16;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = rng();
          const b = Math.floor(8 + v * 60);
          ctx.fillStyle = `rgb(${Math.floor(b * 0.35)}, ${Math.floor(b * 0.6)}, ${Math.floor(b * 1.6 + 30)})`;
          ctx.fillRect(x * cell, y * cell, cell, cell);
          if (v > 0.86) {
            ctx.fillStyle = 'rgba(120, 170, 255, 0.65)';
            ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
          }
        }
      }
      return canvas;
    });
  }

  /** 壁のポスター */
  posterTexture(kind: number): THREE.Texture {
    return this.tex(`poster_${kind}`, () => {
      const { canvas, ctx } = makeCanvas(256, 384);
      const rng = mulberry32(kind * 77 + 5);
      const hue = 200 + kind * 24;
      ctx.fillStyle = `hsl(${hue}, 18%, 12%)`;
      ctx.fillRect(0, 0, 256, 384);
      ctx.strokeStyle = `hsl(${hue}, 40%, 55%)`;
      ctx.lineWidth = 4;
      ctx.strokeRect(14, 14, 228, 356);
      ctx.fillStyle = `hsl(${hue}, 45%, 70%)`;
      ctx.font = 'bold 34px sans-serif';
      const words = ['NOISE', 'SIGNAL', 'DEEP', 'BLUE', 'DREAM', 'STATIC'];
      ctx.fillText(words[kind % words.length], 34, 84);
      ctx.font = '18px sans-serif';
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `hsla(${hue}, 30%, ${40 + rng() * 30}%, 0.8)`;
        ctx.fillRect(34, 130 + i * 34, 60 + rng() * 150, 10);
      }
      return canvas;
    });
  }

  /** 時計の文字盤 */
  clockFace(): THREE.Texture {
    return this.tex('clockFace', () => {
      const { canvas, ctx } = makeCanvas(256, 256);
      ctx.fillStyle = '#e8e4da';
      ctx.beginPath();
      ctx.arc(128, 128, 124, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1c2230';
      ctx.lineWidth = 6;
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
        ctx.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      return canvas;
    });
  }

  /** 窓の外の夜景(発光面) */
  nightCityTexture(): THREE.Texture {
    return this.tex('nightCity', () => {
      const { canvas, ctx } = makeCanvas(512, 256);
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#050a1c');
      grad.addColorStop(0.55, '#0a1430');
      grad.addColorStop(1, '#1a2a52');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);
      const rng = mulberry32(99);
      // 遠景ビル
      for (let i = 0; i < 26; i++) {
        const w = 18 + rng() * 46;
        const h = 40 + rng() * 120;
        const x = rng() * 512;
        ctx.fillStyle = `rgb(${8 + rng() * 10}, ${14 + rng() * 12}, ${32 + rng() * 18})`;
        ctx.fillRect(x, 256 - h, w, h);
        for (let wy = 0; wy < h - 12; wy += 10) {
          for (let wx = 3; wx < w - 6; wx += 8) {
            if (rng() < 0.16) {
              ctx.fillStyle = `rgba(255, 214, 150, ${0.25 + rng() * 0.55})`;
              ctx.fillRect(x + wx, 256 - h + wy, 3, 5);
            }
          }
        }
      }
      return canvas;
    });
  }

  /** 雑多な生活感のラベル(ボトル等) */
  stickerTexture(): THREE.Texture {
    return this.tex('sticker', () => {
      const { canvas, ctx } = makeCanvas(128, 128);
      ctx.fillStyle = '#d8d2c4';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#2c3448';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('MEM', 12, 40);
      ctx.fillText('DUMP', 12, 64);
      ctx.fillStyle = '#8a2f3b';
      ctx.fillRect(12, 82, 80, 12);
      return canvas;
    });
  }

  /** 地面の霧ノイズ(加算用) */
  fogNoise(): THREE.Texture {
    return this.tex('fogNoise', () => {
      const { canvas, ctx } = makeCanvas(256, 256);
      const img = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const v = (fbm2(x * 0.02, y * 0.02, 4) + 0.6) * 128;
          const i = (y * 256 + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 255);
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas;
    }, );
  }

  /** ソフトな円(パーティクル/光用) */
  softCircle(): THREE.Texture {
    return this.tex('softCircle', () => {
      const { canvas, ctx } = makeCanvas(128, 128);
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return canvas;
    });
  }
}

export const textures = new TextureLibrary();
