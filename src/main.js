import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { SCENES, ROUTE } from './data/scenes.js';
import { CHARACTERS } from './data/characters.js';
import { SPAWNS } from './data/colliders.js';
import { World } from './world.js';
import { Cast } from './cutout.js';
import { Walker } from './walker.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';

/* ------------------------------------------------------------------ */
/* 例外は画面に出す                                                    */
/* ------------------------------------------------------------------ */
function showFatal(err) {
  console.error(err);
  const note = document.getElementById('loading-note');
  const label = document.querySelector('.loading-label');
  const bar = document.querySelector('.loading-bar');
  const pct = document.querySelector('.loading-num');
  if (label) label.textContent = '読み込みに失敗しました';
  if (note) note.textContent = String(err && err.message ? err.message : err);
  if (bar) bar.style.display = 'none';
  if (pct) pct.style.display = 'none';
  const box = document.getElementById('loading');
  if (!box) return;
  box.classList.remove('done');
  if (!box.dataset.fatal) {
    box.dataset.fatal = '1';
    const btn = document.createElement('button');
    btn.className = 'fatal-reload';
    btn.textContent = '再読み込み';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      location.reload();
    });
    box.appendChild(btn);
  }
}
window.addEventListener('error', (e) => showFatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

/* ------------------------------------------------------------------ */
/* レンダラ（軽量設定：影なし / 低解像度 / ポストは1パス）             */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
const PR = Math.min(window.devicePixelRatio || 1, 1.25);
renderer.setPixelRatio(PR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 160);

/* グレーディング（粒子・周辺減光・色収差・簡易AA）だけ */
const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
const rt = new THREE.WebGLRenderTarget(size.x * PR, size.y * PR, { type: THREE.HalfFloatType, samples: 0 });
const composer = new EffectComposer(renderer, rt);
composer.setSize(size.x, size.y);
composer.addPass(new RenderPass(scene, camera));

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 1.0 },
    uAberration: { value: 0.0016 },
    uFade: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / (size.x * PR), 1 / (size.y * PR)) },
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
    uniform vec2 uTexel;
    varying vec2 vUv;

    float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      float ab = uAberration * (0.35 + r2 * 2.6);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ab).b;

      // 軽いAA（輝度差があるところだけ平均する）
      vec3 n1 = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb;
      vec3 n2 = texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb;
      vec3 n3 = texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb;
      vec3 n4 = texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
      float l0 = luma(col);
      float lmax = max(max(luma(n1), luma(n2)), max(luma(n3), luma(n4)));
      float lmin = min(min(luma(n1), luma(n2)), min(luma(n3), luma(n4)));
      float edge = smoothstep(0.06, 0.35, lmax - lmin);
      col = mix(col, (col + n1 + n2 + n3 + n4) * 0.2, edge * 0.55);

      // 粒子
      col += (rand(uv * 512.0) - 0.5) * uGrain;

      // 周辺減光
      float vig = 1.0 - smoothstep(0.12, 0.92, r2 * 2.0);
      col *= mix(1.0, vig, uVignette * 0.72);

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
  style: 0,
  audioOn: false,
  playing: false,
  activeIndex: -1,
  focusIndex: 0,
  lineIndex: 0,
  done: new Set(),
  nearest: null,
  lookChar: null,
  locked: false,
};

const audio = new AudioEngine();
const world = new World(renderer, scene);
const cast = new Cast(scene);
const walker = new Walker(camera, canvas, {
  onStep: () => {
    if (state.audioOn) audio.rustle();
  },
});

const ui = new UI({
  scenes: SCENES,
  on: {
    enter: () => safeEnter(),
    next: () => safeNext(),
    scene: (i) => safeScene(i),
    free: () => walker.lock?.(),
    style: () => cycleStyle(),
    audio: () => toggleAudio(),
    unhighlight: () => cast.highlight(null),
  },
});

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
  const p = Math.min(1, glbProgress * 0.7 + castProgress * 0.3);
  ui.progress(p, glbProgress < 1 ? 'classroom.glb を読み込み中' : '立ち絵を準備中');
}

/* タイトル背景：教室の奥からゆっくり */
const idle = {
  a: { pos: new THREE.Vector3(2.9, 1.72, 4.25), tgt: new THREE.Vector3(-0.2, 1.15, -2.0) },
  b: { pos: new THREE.Vector3(-3.1, 1.66, 3.9), tgt: new THREE.Vector3(0.9, 1.1, -1.2) },
};
let idleT = 0;
function updateIdle(dt) {
  idleT += dt * 0.045;
  const k = (Math.sin(idleT) + 1) * 0.5;
  camera.position.lerpVectors(idle.a.pos, idle.b.pos, k);
  camera.lookAt(
    new THREE.Vector3().lerpVectors(idle.a.tgt, idle.b.tgt, k)
  );
  camera.position.y += Math.sin(idleT * 7.1) * 0.008;
}

(async function boot() {
  updateProgress();
  world.applyScene(SCENES[0].env);
  try {
    await world.load((p) => {
      glbProgress = p;
      updateProgress();
    });
  } catch (err) {
    showFatal(err);
    return;
  }

  await cast.preload({ defaultsOnly: true });

  ui.progress(1, '完了');
  setTimeout(() => {
    ui.loaded();
    ui.showTitle();
  }, 320);
})();

/* ------------------------------------------------------------------ */
/* 場面                                                                */
/* ------------------------------------------------------------------ */
function routeOf(i) {
  return ROUTE[SCENES[i].id] || { anchor: SPAWNS.frontCenter, marker: [0, 1.2, 0] };
}

function focusScene(i, { silent = false } = {}) {
  state.focusIndex = (i + SCENES.length) % SCENES.length;
  const sc = SCENES[state.focusIndex];
  world.setMarker(routeOf(state.focusIndex).marker, sc.accent);
  ui.setObjective(sc, state.done.size, SCENES.length);
  ui.setChapter(sc);
  if (!silent) ui.toast('近づくと本文が始まる');
}

function startScene(i, { teleport = false } = {}) {
  if (state.playing) return;
  state.activeIndex = (i + SCENES.length) % SCENES.length;
  const sc = SCENES[state.activeIndex];
  state.playing = true;
  state.lineIndex = 0;

  if (teleport) {
    const a = routeOf(state.activeIndex).anchor;
    walker.setPose(a.x, a.z, a.look[0], a.look[1]);
  }

  world.setMarker(null);
  world.applyScene(sc.env);
  cast.show(sc.cast);
  ui.setScene(sc, state.activeIndex);
  ui.showDialogue();
  grade.uniforms.uFade.value = 0.35;
  fadeTo(0, 420);
  audio.setScene(sc.env.night ? 'stream' : sc.env.outside === 'lava' ? 'lava' : sc.id === 'window' ? 'window' : sc.env.petals ? 'march' : 'room');
  showLine(0);
}

function finishScene() {
  const sc = SCENES[state.activeIndex];
  state.playing = false;
  state.done.add(sc.id);
  ui.hideDialogue();
  cast.show([]);
  audio.chime(760);
  ui.setProgress(state.done.size, SCENES.length);

  const next = SCENES.findIndex((s, i) => i > state.activeIndex && !state.done.has(s.id));
  if (next >= 0) {
    focusScene(next);
    ui.toast(`✝ ${sc.title} ── 本質 ${state.done.size}/${SCENES.length}`);
  } else {
    const rest = SCENES.findIndex((s) => !state.done.has(s.id));
    if (rest >= 0) {
      focusScene(rest);
      ui.toast('残りの本質を探す');
    } else {
      state.focusIndex = -1;
      world.setMarker(null);
      ui.setObjective(null, SCENES.length, SCENES.length);
      ui.caption('✝', '見えないけど、ある。');
    }
  }
}

function showLine(i) {
  const sc = SCENES[state.activeIndex];
  if (!sc) return;
  const line = sc.lines[i];
  if (!line) return;
  state.lineIndex = i;
  if (line.pose && line.spk !== 'narr') cast.setPose(line.spk, line.pose);
  if (line.spk && line.spk !== 'narr') cast.highlight(line.spk);
  else cast.highlight(null);
  ui.setLine(line, i, sc.lines.length);
  if (state.audioOn) audio.chime(600 + (i % 5) * 70);
}

function nextLine() {
  if (!state.started) return;
  if (!state.playing) {
    interact();
    return;
  }
  if (ui.isTyping()) {
    ui.advancePreview();
    return;
  }
  const sc = SCENES[state.activeIndex];
  if (state.lineIndex + 1 < sc.lines.length) {
    showLine(state.lineIndex + 1);
  } else {
    finishScene();
  }
}

/* ------------------------------------------------------------------ */
/* 操作                                                                */
/* ------------------------------------------------------------------ */
async function enter() {
  if (state.started) return;
  state.started = true;
  ui.hideTitle();
  try {
    await audio.start();
    state.audioOn = true;
    ui.setAudioLabel(true);
  } catch (err) {
    console.warn('audio unavailable', err);
  }
  walker.enter();
  const a = routeOf(0).anchor;
  walker.setPose(a.x, a.z, a.look[0], a.look[1]);
  focusScene(0, { silent: true });
  grade.uniforms.uFade.value = 1;
  fadeTo(0, 900);
  ui.toast('WASD で歩く / クリックでマウスを拘束');
}

function fadeTo(target, dur) {
  const from = grade.uniforms.uFade.value;
  const t0 = performance.now();
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / dur);
    const e = p * p * (3 - 2 * p);
    grade.uniforms.uFade.value = from + (target - from) * e;
    if (p < 1) requestAnimationFrame(step);
  };
  step();
}

function interact() {
  // 近くの「本質」
  if (!state.playing && state.focusIndex >= 0) {
    const sc = SCENES[state.focusIndex];
    const m = routeOf(state.focusIndex).marker;
    const d = walker.distToXZ({ x: m[0], z: m[2] });
    if (d < 2.6) {
      startScene(state.focusIndex);
      return;
    }
    ui.toast(`本質まで ${d.toFixed(1)}m`);
    return;
  }
  // 見ている人物
  if (state.lookChar) {
    ui.showCard(state.lookChar.def);
    cast.highlight(state.lookChar.def.id);
    if (state.audioOn) audio.chime(980);
  }
}

const STYLE_NAMES = ['切り絵', 'インク', 'スペクトル'];
function cycleStyle() {
  state.style = (state.style + 1) % 3;
  cast.style = state.style;
  ui.setStyleLabel(STYLE_NAMES[state.style]);
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

/* クリック：人物カード / 本文送り / ポインタロック */
let downAt = null;
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!state.started) return;
  const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 0;
  downAt = null;
  if (state.locked) {
    if (state.playing) nextLine();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const hit = cast.pick(walker.raycaster(ndcX, ndcY));
  if (hit) {
    cast.highlight(hit.def.id);
    ui.showCard(hit.def);
    return;
  }
  if (!document.getElementById('charcard').classList.contains('is-hidden')) {
    ui.closeCard();
    return;
  }
  if (state.playing) {
    nextLine();
    return;
  }
  // 何も無いところを「押しただけ」なら視点操作に入る（ドラッグで見回した後は入らない）
  if (moved < 6) walker.lock();
});

document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === canvas;
  ui.setLocked(state.locked);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.code;
  if (k === 'Space' || k === 'Enter' || k === 'KeyE') {
    e.preventDefault();
    if (k === 'KeyE') interact();
    else nextLine();
  } else if (k === 'KeyT') {
    if (state.started) ui.toggleTOC();
  } else if (k === 'KeyS') {
    cycleStyle();
  } else if (k === 'KeyM') {
    toggleAudio();
  } else if (k === 'KeyH') {
    ui.hideAllUI();
  } else if (k === 'Escape') {
    ui.closeTOC();
    ui.closeCard();
    ui.closeCredits();
  } else if (k === 'Tab' && state.started) {
    e.preventDefault();
    interact();
  }
});

/* 目次から飛ぶ */
function goToScene(i) {
  if (state.playing) {
    state.playing = false;
    ui.hideDialogue();
    cast.show([]);
  }
  startScene(i, { teleport: true });
  ui.closeTOC();
}

/* ------------------------------------------------------------------ */
/* 安全版ラッパ                                                        */
/* ------------------------------------------------------------------ */
const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch (err) {
    console.error(err);
    try {
      ui.toast('表示エラー（コンソールを確認）');
    } catch (_) {}
    return undefined;
  }
};
function safeEnter() {
  return safe(enter)();
}
function safeNext() {
  return safe(nextLine)();
}
function safeScene(i) {
  return safe(goToScene)(i);
}

/* ------------------------------------------------------------------ */
/* リサイズ & ループ                                                   */
/* ------------------------------------------------------------------ */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  grade.uniforms.uTexel.value.set(1 / (w * PR), 1 / (h * PR));
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let probe = 0;
let fpsAcc = 0;
let fpsFrames = 0;
let showFps = false;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (state.started) walker.update(dt);
  else updateIdle(dt);

  world.update(dt, t, camera);
  cast.update(dt, t, { fogColor: scene.fog.color, fogDensity: scene.fog.density });
  grade.uniforms.uTime.value = t;

  // 0.12 秒ごとに、近くの本質／見ている人物を調べる
  probe -= dt;
  if (probe <= 0 && state.started) {
    probe = 0.12;
    probeWorld();
  }

  composer.render();

  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 1) {
    if (showFps) ui.setFps(Math.round(fpsFrames / fpsAcc));
    fpsAcc = 0;
    fpsFrames = 0;
  }
}
tick();

function probeWorld() {
  // 見ている人物
  cast.group.updateWorldMatrix(true, true);
  const hit = cast.pick(walker.raycaster());
  state.lookChar = hit;
  ui.setCrosshair(hit ? 'active' : 'idle');

  if (state.playing) {
    ui.setPrompt(null);
    return;
  }

  if (state.focusIndex < 0) {
    ui.setPrompt(hit ? `［E］${hit.def.name}` : null);
    return;
  }

  const m = routeOf(state.focusIndex).marker;
  const d = walker.distToXZ({ x: m[0], z: m[2] });
  if (d < 1.25) {
    ui.setPrompt('本質が漏れ出している');
    startScene(state.focusIndex);
  } else if (d < 3.2) {
    ui.setPrompt(`［E］本質をひらく　${d.toFixed(1)}m`);
  } else if (hit) {
    ui.setPrompt(`［E］${hit.def.name}`);
  } else {
    ui.setPrompt(null);
  }
}

/* デバッグ */
window.__honnshitsu = { scene, camera, world, cast, walker, ui, goToScene, startScene, SCENES, ROUTE, state, CHARACTERS };
