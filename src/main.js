import { Game } from './game/Game.js';

const canvas = document.getElementById('gl');
const loadingEl = document.getElementById('loading');
const fillEl = document.getElementById('loading-fill');
const pctEl = document.getElementById('loading-pct');
const noteEl = document.getElementById('loading-note');
const titleEl = document.getElementById('title');
const startBtn = document.getElementById('start-btn');

const game = new Game(canvas);

const NOTES = ['corrupting memory…', 'unpacking blue screen…', 'waking the room…', 'feeding the :('];
let noteIdx = 0;
setInterval(() => { noteIdx = (noteIdx + 1) % NOTES.length; noteEl.textContent = NOTES[noteIdx]; }, 1600);

game.load((p) => {
  const pct = Math.round(p * 100);
  fillEl.style.width = pct + '%';
  pctEl.textContent = pct + '%';
}).then(() => {
  fillEl.style.width = '100%';
  pctEl.textContent = '100%';
  setTimeout(() => {
    loadingEl.classList.add('hidden');
    titleEl.classList.remove('hidden');
    // 背景に部屋をレンダリングしておく
    game.state = 'title';
    game.loop();
  }, 500);
}).catch((err) => {
  console.error(err);
  noteEl.textContent = 'LOAD FAILED — 再読み込みしてください';
  noteEl.style.color = '#ff6b86';
});

startBtn.addEventListener('click', () => {
  titleEl.classList.add('hidden');
  game.startGame();
});
