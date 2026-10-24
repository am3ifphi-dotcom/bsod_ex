// BSOD_EX — entry point.
import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('view') as HTMLCanvasElement;
if (!canvas) throw new Error('canvas #view missing');

const game = new Game(canvas);
// handy for debugging in the browser console; harmless in production
(window as unknown as { BSOD: Game }).BSOD = game;

function showFatal(msg: string) {
  const el = document.getElementById('bootLine');
  if (el) {
    el.classList.remove('hidden');
    el.textContent = msg;
    el.style.color = '#ff9a9a';
  }
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFatal('GPU コンテキストが失われました。ページを再読み込みしてください。');
});

game.init()
  .then(() => {
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      // the engine measures real frame time itself; this is just the RAF pump
      void (now - last);
      last = now;
      try {
        game.update();
      } catch (err) {
        console.error(err);
        showFatal(`実行時エラー: ${(err as Error).message}`);
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })
  .catch((err) => {
    console.error(err);
    showFatal(`起動に失敗しました: ${(err as Error).message}`);
  });
