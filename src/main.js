import { Game } from './game.js';

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) { return false; }
}

async function main() {
  if (!hasWebGL2()) {
    document.getElementById('loading').style.display = 'none';
    const el = document.getElementById('nogl');
    el.hidden = false;
    el.classList.add('on');
    return;
  }
  const game = new Game();
  window.__game = game;
  await game.boot();

  // --- debug entry points (dev only, harmless in production) -------------
  const q = new URLSearchParams(location.search);
  if (q.has('debug')) {
    const mode = q.get('debug');
    game.ui.showScreen('menu', false);
    game.ui.hud(true);
    game.state = 'room';
    if (mode === 'screen') {
      game.player.teleport({ x: 0.95, y: 0.02, z: 0.33, clone: () => game.player.pos }, -1.5, 0);
      game.room.powerOnScreen();
    }
    if (mode === 'void') { game.mode = 'cine'; game.enterVoid().then(() => {}); }
    if (mode === 'collapse') {
      game.mode = 'cine';
      game.enterVoid().then(() => { setTimeout(() => game.beginCollapse(), 1500); });
    }
  }

  // keep the aspect correct even when the browser resizes mid-cinematic
  window.addEventListener('resize', () => {
    if (game.tunnelMat) game.tunnelMat.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });
}

main();
