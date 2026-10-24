import { Settings } from './core/Settings';
import { Ui } from './ui/Ui';
import { Game } from './game/Game';

/**
 * Boot. Everything that can fail (WebGL, asset decode) is caught here so the player gets a
 * readable crash screen instead of a black page.
 */

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el as T;
};

function fatal(message: string, detail?: unknown): void {
  console.error('[bsod-ex]', message, detail);
  const ui = (window as unknown as { __bsodUi?: Ui }).__bsodUi;
  if (ui) {
    ui.showCrashScreen();
    const el = document.querySelector('#crash-screen pre');
    if (el) el.textContent = `${message}\n\n${detail instanceof Error ? detail.stack ?? detail.message : String(detail ?? '')}`;
  } else {
    const pre = document.querySelector('#crash-screen pre');
    if (pre) pre.textContent = `${message}\n\n${String(detail)}`;
    document.querySelector('#crash-screen')?.classList.remove('hidden');
    document.querySelector('#loading')?.classList.add('gone');
  }
}

async function boot(): Promise<void> {
  const settings = new Settings();
  const ui = new Ui(settings);
  (window as unknown as { __bsodUi?: Ui }).__bsodUi = ui;

  const container = $('#viewport-container');
  let game: Game;
  try {
    game = new Game(container, settings, ui);
  } catch (err) {
    fatal('WebGL2 を初期化できませんでした。GPU アクセラレーションを有効にしてください。', err);
    return;
  }
  (window as unknown as { __bsodGame?: Game }).__bsodGame = game;

  ui.setCallbacks({
    onStart: () => {
      void game.startExperience().catch((err) => fatal('起動に失敗しました', err));
    },
    onResume: () => {
      game.resume();
    },
    onRestart: () => {
      void game.restart().catch((err) => fatal('再開に失敗しました', err));
    },
    onQuitToTitle: () => {
      game.quitToTitle();
    },
    onSettingsChange: (key, value) => {
      game.onSettingChanged(key, value);
    },
    onConsoleCommand: (text) => {
      game.onConsoleCommand(text);
    },
    onConsoleClose: () => {
      game.onConsoleClosed();
    },
    onBsodClick: () => {
      game.onBsodClick();
    },
    onRequestLock: () => {
      game.requestLockFromUi();
    },
  });

  ui.setProgress(0.01, 'starting');
  ui.setPerfVisible(settings.data.showPerf);
  ui.setHudVisible(false);
  ui.setFadeInstant(true);

  try {
    await game.init((p, label) => ui.setProgress(p, label));
  } catch (err) {
    fatal('初期化に失敗しました（WebGL が利用できない可能性があります）', err);
    return;
  }

  ui.setProgress(1, 'ready');
  ui.hideLoading();
  ui.showTitle();
  ui.setFadeInstant(true);
  // reveal the room behind the title screen
  window.setTimeout(() => { ui.setFadeInstant(false); }, 120);

  window.addEventListener('resize', () => {
    game.onResize();
  });
  document.addEventListener('visibilitychange', () => {
    game.onVisibilityChange(document.hidden);
  });

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      game.frame(dt);
    } catch (err) {
      fatal('実行時エラー', err);
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

window.addEventListener('error', (e) => {
  if (e.error) fatal('未処理のエラー', e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  fatal('未処理の Promise 拒否', (e as PromiseRejectionEvent).reason);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void boot(); });
} else {
  void boot();
}
