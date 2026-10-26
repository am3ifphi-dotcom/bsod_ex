import { Game } from './game';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas #scene missing');

const boot = async () => {
  try {
    const game = new Game(canvas);
    await game.init();
  } catch (err) {
    console.error(err);
    const veil = document.getElementById('loading-veil');
    if (veil) {
      veil.classList.remove('done');
      veil.innerHTML = `<div style="max-width:600px;text-align:center;line-height:1.8;letter-spacing:.08em">
        <div style="color:#ff7d8c;font-size:14px">BOOT FAILURE</div>
        <div style="color:#93a9d6;font-size:11px;margin-top:10px">${String(err).replace(/</g, '&lt;')}</div>
        <div style="color:#5f7fc0;font-size:10px;margin-top:14px">GPU/WebGL2 が利用できる環境で再読み込みしてください。</div>
      </div>`;
    }
  }
};

boot();
