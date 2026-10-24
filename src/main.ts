/**
 * 起動: 読み込み → 注意表示 → ゲーム
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Game } from './game/game';
import { SettingsStore } from './core/settings';
import { textures } from './world/textures';

const loadingEl = document.getElementById('loading')!;
const loadingBar = document.getElementById('loading-bar')!;
const loadingLabel = document.getElementById('loading-label')!;
const warningEl = document.getElementById('warning')!;
const fatalEl = document.getElementById('fatal')!;
const fatalMsg = document.getElementById('fatal-msg')!;

function setProgress(p: number, label: string): void {
  loadingBar.style.width = `${Math.round(p * 100)}%`;
  loadingLabel.textContent = label;
}

function fatal(msg: string): void {
  fatalMsg.textContent = msg;
  fatalEl.classList.remove('hidden');
  loadingEl.classList.add('hidden');
}

document.getElementById('fatal-reload')!.addEventListener('click', () => window.location.reload());

async function loadEnvironment(renderer: THREE.WebGLRenderer): Promise<{ room: THREE.Texture | null; voidEnv: THREE.Texture | null }> {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const hdrLoader = new RGBELoader();
  const loadOne = async (url: string): Promise<THREE.Texture | null> => {
    try {
      const hdr = await hdrLoader.loadAsync(url);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      return env;
    } catch (e) {
      console.warn('env load failed', url, e);
      return null;
    }
  };
  const [room, night, country] = await Promise.all([
    loadOne('assets/env/room.hdr'),
    loadOne('assets/env/night.hdr'),
    loadOne('assets/env/country.hdr'),
  ]);
  void night;
  return { room, voidEnv: country };
}

async function boot(): Promise<void> {
  const settings = new SettingsStore();

  setProgress(0.05, 'TEXTURES');
  try {
    await textures.loadExternal();
  } catch (e) {
    fatal(
      'アセットが見つかりません。\n先に `npm run fetch-assets` を実行してアセットを取得してください。\n(README の手順 1〜2 を参照)',
    );
    console.error(e);
    return;
  }

  setProgress(0.35, 'RENDERER');
  const container = document.getElementById('app')!;
  let game: Game;
  try {
    game = new Game(container, settings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('WEBGL2')) {
      fatal('WebGL2 を利用できません。\n対応ブラウザ(Chrome / Edge / Firefox / Safari 16+)で開いてください。\nハードウェアアクセラレーションが有効かも確認してください。');
    } else {
      fatal(`初期化に失敗しました:\n${msg}`);
    }
    return;
  }

  setProgress(0.65, 'ENVIRONMENT');
  const env = await loadEnvironment(game.engine.renderer);
  game.roomEnv = env.room;
  game.voidEnv = env.voidEnv;
  if (env.room) {
    game.engine.scene.environment = env.room;
    game.engine.scene.background = new THREE.Color(0x04060c);
    game.engine.scene.environmentIntensity = 1.0;
  }

  setProgress(0.85, 'WORLD');
  // ワールドは Game 生成時に構築済み。相互作用の登録。
  game.registerInteractions();

  setProgress(1.0, 'READY');
  await new Promise((r) => setTimeout(r, 250));
  loadingEl.classList.add('hidden');
  warningEl.classList.remove('hidden');

  // ---------------- 入力の配線 ----------------
  document.getElementById('start-btn')!.addEventListener('click', () => {
    warningEl.classList.add('hidden');
    void game.audio.init().then(() => {
      game.audio.setVolume(settings.data.masterVolume);
    });
    game.startGame();
  });

  // lean 中のクリック(カーソル操作)
  window.addEventListener('mousedown', (e) => {
    if (game.phase === 'lean' && e.button === 0) {
      game.handleScreenClick(e.clientX, e.clientY);
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (game.phase === 'lean') {
      game.handleMouseMoveCursor(e.clientX, e.clientY);
    }
  });

  // lean 中の Esc で戻る / UI モードの Esc・F3
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && game.phase === 'lean') {
      e.preventDefault();
      game.cancelLean();
      return;
    }
    if (e.code === 'Escape' || e.code === 'F3') {
      game.handleUiKey(e.code);
    }
  });

  // ---------------- メインループ ----------------
  const clock = new THREE.Clock();
  const loop = (): void => {
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    try {
      game.update(dt);
    } catch (err) {
      console.error(err);
    }
  };
  loop();

  // ベンチマーク(?benchmark=1): 全フェーズを自動走査して計測
  const params = new URLSearchParams(window.location.search);
  if (params.get('benchmark') === '1') {
    console.log('[benchmark] scripted full-run measurement starting (F3 で表示)');
    game.hud.togglePerf(true);
    const { BenchmarkRunner } = await import('./game/benchmark');
    const bench = new BenchmarkRunner(game);
    document.getElementById('start-btn')!.click();
    void bench.run().then((result) => {
      console.log('[benchmark] RESULT', JSON.stringify(result, null, 2));
      game.showBenchmarkResult(result);
    });
  }
}

boot().catch((e) => {
  fatal(`起動エラー:\n${e instanceof Error ? e.stack ?? e.message : String(e)}`);
});
