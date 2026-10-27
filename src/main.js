import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { SCENES } from './data/scenes.js';
import { CHARACTERS } from './data/characters.js';
import { World } from './world.js';
import { Cast } from './cutout.js';
import { Director } from './director.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';

/* ------------------------------------------------------------------ */
/* 例外は画面に出す（真っ黒のまま黙って死なないように）                */
/* ------------------------------------------------------------------ */
function showFatal(err) {
  console.error(err);
  const note = document.getElementById('loading-note');
  const label = document.querySelector('.loading-label');
  const bar = document.querySelector('.loading-bar');
  const pct = document.querySelector('.loading-num');
  if (label) label.textContent = '本質の読み込みに失敗しました';
  if (note) note.textContent = String(err && err.message ? err.message : err);
  if (bar) bar.style.display = 'none';
  if (pct) pct.style.display = 'none';
  const box = document.getElementById('loading');
  if (box) box.classList.remove('done');
}
window.addEventListener('error', (e) => showFatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

/* ------------------------------------------------------------------ */
/* レンダラ                                                            */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
const PR = Math.min(window.devicePixelRatio || 1, 1.7);
renderer.setPixelRatio(PR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.05, 200);

/* ポストプロセス */
const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
const rt = new THREE.WebGLRenderTarget(size.x * PR, size.y * PR, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, rt);
composer.setSize(size.x, size.y);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(size.clone().multiplyScalar(1), 0.55, 0.72, 0.74);
composer.addPass(bloom);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 1.0 },
    uAberration: { value: 0.0012 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uFade;
    varying vec2 vUv;

    float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      float ab = uAberration * (0.4 + r2 * 2.4);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ab).b;

      // 粒子
      float n = rand(uv * 512.0);
      col += (n - 0.5) * uGrain;

      // ビネット
      float vig = smoothstep(0.95, 0.15, r2 * 1.9);
      col *= mix(1.0, vig, uVignette * 0.55);

      // ごく薄い色かぶり
      col = mix(col, col * vec3(1.02, 0.995, 0.965), 0.6);

      col *= (1.0 - uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ */
/* 状態                                                                */
/* ------------------------------------------------------------------ */
const state = {
  started: false,
  sceneIndex: 0,
  lineIndex: 0,
  style: 0,
  free: false,
  audioOn: false,
  loadingDone: false,
};

const audio = new AudioEngine();

const ui = new UI({
  scenes: SCENES,
  on: {
    enter: () => enter(),
    next: () => nextLine(),
    scene: (i) => goToScene(i),
    free: () => toggleFree(),
    style: () => cycleStyle(),
    audio: () => toggleAudio(),
    unhighlight: () => cast.highlight(null),
  },
});

const world = new World(renderer, scene);
const cast = new Cast(scene);
const director = new Director(camera, canvas);

/* ------------------------------------------------------------------ */
/* 起動                                                                */
/* ------------------------------------------------------------------ */
let glbProgress = 0;
let castProgress = 0;
cast.onProgress = (done, total) => {
  castProgress = done / total;
  updateProgress();
};

function updateProgress() {
  const p = Math.min(1, glbProgress * 0.6 + castProgress * 0.4);
  ui.progress(p, glbProgress < 1 ? 'classroom.glb を読み込み中' : '立ち絵を加工中（切り絵シェーダ）');
}

(async function boot() {
  updateProgress();
  // タイトル画面の背景：教室の全景をゆっくり
  director.setShot(SCENES[0].shots.title, { instant: true });
  world.applyScene(SCENES[0].env);

  await world.load((p) => {
    glbProgress = p;
    updateProgress();
  });
  // 立ち絵のプリロード完了を待つ（失敗しても止まらないようにタイムアウト付き）
  await new Promise((resolve) => {
    const t0 = performance.now();
    const check = setInterval(() => {
      if (castProgress >= 1 || performance.now() - t0 > 45000) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  ui.progress(1, '完了');
  setTimeout(() => {
    ui.loaded();
    ui.showTitle();
    state.loadingDone = true;
  }, 420);

  // タイトル背景用に、人物を少しだけ置いておく
  cast.show([
    { id: 'ryoma', spot: 'A4' },
    { id: 'mie', pose: 'normal', spot: 'A2' },
    { id: 'terachi', spot: 'A3' },
    { id: 'satou', pose: 'game', spot: 'W1' },
    { id: 'rei', spot: 'A5' },
  ]);
})();

/* ------------------------------------------------------------------ */
/* 場面遷移                                                            */
/* ------------------------------------------------------------------ */
let current = null;

function goToScene(index, { instant = false } = {}) {
  state.sceneIndex = (index + SCENES.length) % SCENES.length;
  const sc = SCENES[state.sceneIndex];
  current = sc;
  state.lineIndex = 0;

  world.applyScene(sc.env);
  cast.show(sc.cast);
  ui.setScene(sc, state.sceneIndex);
  bloom.strength = sc.env.bloom ?? 0.55;
  audio.setScene(sc.env.night ? 'stream' : sc.env.outside === 'lava' ? 'lava' : sc.id === 'window' ? 'window' : sc.env.petals ? 'march' : 'room');
  director.setShot(sc.shots[sc.lines[0]?.shot] || Object.values(sc.shots)[0], { instant });
  showLine(0);
  document.getElementById('charcard').classList.add('is-hidden');
}

function showLine(i) {
  const sc = current;
  if (!sc) return;
  const line = sc.lines[i];
  if (!line) return;
  state.lineIndex = i;

  if (line.shot && sc.shots[line.shot]) director.setShot(sc.shots[line.shot]);
  if (line.pose && line.spk !== 'narr') cast.setPose(line.spk, line.pose);
  if (line.spk && line.spk !== 'narr') cast.highlight(line.spk);
  ui._line = line.text;
  ui.setLine(line, i, sc.lines.length);
  if (state.audioOn) audio.chime(620 + (i % 5) * 60);
}

function nextLine() {
  if (!state.started) return;
  if (ui.isTyping()) {
    ui.advancePreview();
    return;
  }
  const sc = current;
  if (!sc) return;
  if (state.lineIndex + 1 < sc.lines.length) {
    if (state.audioOn) audio.rustle();
    showLine(state.lineIndex + 1);
  } else if (state.sceneIndex + 1 < SCENES.length) {
    if (state.audioOn) audio.rustle();
    goToScene(state.sceneIndex + 1);
  } else {
    // 最終場面
    ui.toast('✝ 本質 ✝ ── ここまで');
    ui.el.caption.innerHTML = `
      <div class="cap-no">✝</div>
      <div class="cap-title">本質は、ないときの方が本質である。</div>
      <div class="cap-rule"></div>`;
    ui.el.caption.classList.add('show');
  }
}

/* ------------------------------------------------------------------ */
/* 操作                                                                */
/* ------------------------------------------------------------------ */
async function enter() {
  if (state.started) return;
  state.started = true;
  ui.hideTitle();

  // 窓の外から教室へ入っていく
  director.pos.set(6.2, 2.5, -5.2);
  director.tgt.set(0.2, 1.3, 2.0);
  camera.position.copy(director.pos);
  camera.lookAt(director.tgt);

  try {
    await audio.start();
    state.audioOn = true;
    ui.setAudioLabel(true);
  } catch (err) {
    console.warn('audio unavailable', err);
  }

  goToScene(0);
  grade.uniforms.uFade.value = 1;
  fadeIn();
}

function fadeIn() {
  const t0 = performance.now();
  const dur = 1600;
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / dur);
    grade.uniforms.uFade.value = 1 - p * p * (3 - 2 * p);
    if (p < 1) requestAnimationFrame(step);
  };
  step();
}

function toggleFree() {
  state.free = !state.free;
  director.setFree(state.free);
  ui.setFreeLabel(state.free);
  ui.toast(state.free ? '自由視点：WASD / ドラッグ / ホイール' : '演出視点に戻りました');
}

const STYLE_NAMES = ['切り絵', 'インク', 'スペクトル'];
function cycleStyle() {
  state.style = (state.style + 1) % 3;
  cast.style = state.style;
  ui.setStyleLabel(STYLE_NAMES[state.style]);
  ui.toast(`立ち絵スタイル：${STYLE_NAMES[state.style]}`);
}

async function toggleAudio() {
  if (!state.audioOn) {
    try {
      await audio.start();
      state.audioOn = true;
      audio.setMuted(false);
      ui.setAudioLabel(true);
    } catch (err) {
      console.warn('audio unavailable', err);
    }
  } else {
    state.audioOn = false;
    audio.setMuted(true);
    ui.setAudioLabel(false);
  }
}

/* クリック／タップ */
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  down = null;
  if (dist > 8 || dt > 600) return;

  const rect = canvas.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const rc = director.raycaster(ndcX, ndcY);
  const hit = cast.pick(rc);
  if (hit) {
    cast.highlight(hit.def.id);
    ui.showCard(hit.def);
    if (state.audioOn) audio.chime(980);
    return;
  }
  if (document.getElementById('charcard').classList.contains('is-hidden') === false) {
    ui.closeCard();
    return;
  }
  if (!state.free) nextLine();
});

/* キーボード */
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.code;
  if (k === 'Space' || k === 'Enter') {
    e.preventDefault();
    nextLine();
  } else if (k === 'ArrowRight' && !state.free) {
    e.preventDefault();
    if (state.started) goToScene(state.sceneIndex + 1);
  } else if (k === 'ArrowLeft' && !state.free) {
    e.preventDefault();
    if (state.started) goToScene(state.sceneIndex - 1);
  } else if (k === 'ArrowDown' && !state.free) {
    e.preventDefault();
    nextLine();
  } else if (k === 'ArrowUp' && !state.free) {
    e.preventDefault();
    if (state.lineIndex > 0) showLine(state.lineIndex - 1);
  } else if (k === 'KeyF') {
    if (state.started) toggleFree();
  } else if (k === 'KeyT') {
    if (state.started) ui.toggleTOC();
  } else if (k === 'KeyM') {
    toggleAudio();
  } else if (k === 'KeyS') {
    cycleStyle();
  } else if (k === 'KeyH') {
    ui.hideAllUI();
  } else if (k === 'Escape') {
    ui.closeTOC();
    ui.closeCard();
    ui.closeCredits();
  }
});

/* リサイズ */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  bloom.setSize(w, h);
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/* ループ                                                              */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let fpsAcc = 0;
let fpsFrames = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  director.update(dt);
  world.update(dt, t, camera);
  cast.update(dt, t, {
    fogColor: scene.fog.color,
    fogDensity: scene.fog.density,
  });
  grade.uniforms.uTime.value = t;

  composer.render();

  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 1) {
    state.fps = Math.round(fpsFrames / fpsAcc);
    if (state.showFps) ui.setFps(state.fps);
    fpsAcc = 0;
    fpsFrames = 0;
  }
}
tick();

/* デバッグ用（コンソールから触れるように） */
window.__honnshitsu = { scene, camera, world, cast, director, ui, goToScene, CHARACTERS };
