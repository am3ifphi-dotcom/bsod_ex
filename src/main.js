/**
 * 思い出の教室 — エントリポイント
 */
import * as THREE from 'three';
import { UI } from './ui.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Interaction } from './interact.js';
import { Minimap } from './minimap.js';
import { SketchfabPanel } from './sketchfab.js';
import { audio } from './audio.js';
import { PRESETS } from './lighting.js';

const $ = (id) => document.getElementById(id);
const ui = new UI();

let renderer, scene, camera, world, player, interact, minimap, fab;
let started = false;
let photoMode = false;
let globeSpin = 0;
let fishAngle = 0;
let time = 0;
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let degraded = false;

const START = { x: 0.45, z: -3.1, yaw: Math.PI };

function isTouch() {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

async function boot() {
  const canvas = $('scene');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    $('loadText').textContent = 'WebGL を初期化できませんでした。';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(63, window.innerWidth / window.innerHeight, 0.05, 220);
  camera.position.set(START.x, 1.58, START.z);

  world = await buildWorld({
    scene,
    renderer,
    onProgress: (p, t) => ui.progress(p, t),
  });

  player = new Player(camera, world.colliders, audio, {
    canvas,
    stickZone: $('stickZone'),
    stickKnob: $('stickKnob'),
  });
  player.touchMode = isTouch();
  player.teleport(START.x, START.z, START.yaw);

  interact = new Interaction({
    camera,
    hotspots: world.hotspots,
    fragments: world.fragments,
    blockers: world.blockers,
    ui,
    actions: {
      fan: () => {
        const f = world.refs.fan;
        f.on = !f.on;
        audio.setFan(f.on);
        audio.knock();
        ui.toast(f.on ? '扇風機が、ぶうんと回りだした。' : '扇風機が止まった。');
        ui.hideCard();
      },
      piano: () => {
        audio.melody();
        ui.toast('たどたおしい指が、まだ覚えている音。');
      },
      globe: () => {
        globeSpin = 4;
        audio.knock();
      },
      default: () => audio.knock(),
      onDiscover: (h, n) => {
        ui.notes(n, world.hotspots.length);
        audio.ui(true);
      },
      onFragment: (f, n, total) => {
        ui.memories(n, total);
        audio.pickup(n);
        if (n >= total) setTimeout(ending, 2600);
      },
    },
  });

  minimap = new Minimap($('minimap'), { fragments: world.fragments, colliders: world.colliders });
  fab = new SketchfabPanel(ui);

  ui.notes(0, world.hotspots.length);
  ui.memories(0, world.fragments.length);
  ui.time(PRESETS.day.label);

  bindUI();
  window.addEventListener('resize', onResize);
  onResize();

  // 影を一度焼いてから表示
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  ui.hideLoading();
  last = performance.now();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
function bindUI() {
  $('btnStart').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', resume);
  $('btnTitle').addEventListener('click', toTitle);
  $('btnSketchfabStart').addEventListener('click', () => openFab());
  $('btnSketchfabPause').addEventListener('click', () => openFab());
  $('btnEndingSketchfab').addEventListener('click', () => openFab());
  $('fabClose').addEventListener('click', closeFab);
  $('btnEndingClose').addEventListener('click', () => {
    ui.overlay('ending', false);
    resume();
  });
  $('btnEndingPhoto').addEventListener('click', () => {
    ui.overlay('ending', false);
    setPhoto(true);
  });
  $('journalClose').addEventListener('click', closeJournal);
  $('btnJournalClose').addEventListener('click', closeJournal);

  // 設定
  $('sldExposure').addEventListener('input', (e) => {
    renderer.toneMappingExposure = Number(e.target.value);
  });
  $('sldVolume').addEventListener('input', (e) => {
    audio.setVolume(Number(e.target.value));
  });
  $('chkBob').addEventListener('change', (e) => {
    player.bobEnabled = e.target.checked;
  });

  // タッチボタン
  const act = $('touchAction');
  act.addEventListener('touchstart', (e) => {
    e.preventDefault();
    act.classList.add('on');
    if (interact.use()) act.textContent = '見た';
    setTimeout(() => (act.textContent = '調べる'), 900);
  });
  act.addEventListener('touchend', () => act.classList.remove('on'));
  const runBtn = $('touchRun');
  runBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    player.run = !player.run;
    runBtn.classList.toggle('on', player.run);
  });

  // キーボード
  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (code === 'Tab') e.preventDefault();

    if (code === 'Escape') {
      if (ui.el.fab.classList.contains('hidden') === false) return closeFab();
      if (!ui.el.journal.classList.contains('hidden')) return closeJournal();
      if (photoMode) return setPhoto(false);
      if (!ui.el.ending.classList.contains('hidden')) {
        ui.overlay('ending', false);
        return resume();
      }
      if (started && ui.el.pause.classList.contains('hidden')) pause();
      return;
    }
    if (!started) {
      if (code === 'Enter' || code === 'Space') startGame();
      return;
    }
    if (photoMode) {
      if (code === 'Enter') capture();
      if (code === 'KeyP') setPhoto(false);
      return;
    }
    const overlayOpen = !ui.el.pause.classList.contains('hidden') || !ui.el.journal.classList.contains('hidden');
    if (overlayOpen) {
      if (code === 'KeyJ' || code === 'Tab') closeJournal();
      return;
    }
    switch (code) {
      case 'KeyE':
        interact.use();
        break;
      case 'KeyF':
        cycleTime();
        break;
      case 'KeyJ':
      case 'Tab':
        openJournal();
        break;
      case 'KeyP':
        setPhoto(true);
        break;
      case 'KeyM':
        minimap.enabled = !minimap.enabled;
        ui.minimap(minimap.enabled);
        ui.toast(minimap.enabled ? '見とり図をつける' : '見とり図をけす', 1400);
        break;
      case 'KeyH':
        pause();
        break;
    }
  });

  // マウスでも「調べる」
  $('scene').addEventListener('mousedown', (e) => {
    if (!started || photoMode || isTouch()) return;
    if (e.button === 0 && player.locked) interact.use();
  });

  // ポインタロックが外れたらポーズ
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && started && !isTouch() && ui.el.pause.classList.contains('hidden')) {
      if (!photoMode && !ui.anyOverlayOpen()) pause();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && started) audio.resume?.();
  });
}

function startGame() {
  if (started) return;
  started = true;
  audio.init();
  audio.resume();
  audio.setMode('day');
  ui.overlay('start', false);
  ui.showHUD(true);
  if (isTouch()) ui.setTouch(true);
  player.enabled = true;
  if (!player.touchMode) player.requestLock();
  ui.toast('E（またはクリック）で調べる・光るかけらを拾う', 5200);
  setTimeout(() => {
    if (started) ui.toast('F で時間を変えてみよう（昼 → 夕焼け → 夜）', 4600);
  }, 7000);
}

function pause() {
  player.enabled = false;
  player.exitLock();
  ui.hidePrompt();
  ui.crosshair(false);
  ui.overlay('pause', true);
}

function resume() {
  ui.overlay('pause', false);
  ui.overlay('ending', false);
  ui.hideCard();
  player.enabled = true;
  audio.resume();
  if (!player.touchMode && !photoMode) player.requestLock();
}

function toTitle() {
  ui.overlay('pause', false);
  ui.overlay('journal', false);
  ui.overlay('ending', false);
  ui.hideCard();
  ui.showHUD(false);
  player.enabled = false;
  player.exitLock();
  player.teleport(START.x, START.z, START.yaw);
  started = false;
  ui.overlay('start', true);
}

function openJournal() {
  ui.journal(world.hotspots, interact.discovered, world.fragments);
  ui.overlay('journal', true);
  player.enabled = false;
  player.exitLock();
  audio.ui(true);
}

function closeJournal() {
  ui.overlay('journal', false);
  player.enabled = true;
  audio.ui(false);
  if (!player.touchMode && !photoMode) player.requestLock();
}

function cycleTime() {
  const next = world.tod.cycle();
  const p = PRESETS[next];
  ui.time(p.label);
  audio.setMode(next);
  ui.toast(`${p.label} ― ${p.hint}`, 3400);
  audio.ui(true);
}

function setPhoto(on) {
  photoMode = on;
  ui.photo(on);
  player.lockAllowed = !on;
  if (on) {
    player.exitLock();
    player.enabled = true; // 視線は動かせる（ロックなし）
    ui.hidePrompt();
    ui.crosshair(false);
    ui.hideCard();
    ui.toast('写真モード：Enter で保存、P で終了', 3000);
  } else {
    if (!player.touchMode) player.requestLock();
  }
}

function capture() {
  renderer.render(scene, camera);
  try {
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `omoide-classroom-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    ui.toast('写真を保存しました', 2200);
    audio.ui(true);
  } catch (err) {
    ui.toast('写真を保存できませんでした', 2200);
  }
}

function ending() {
  audio.chime();
  ui.overlay('ending', true);
  player.enabled = false;
  player.exitLock();
}

function openFab() {
  if (started && !photoMode) {
    player.enabled = false;
    player.exitLock();
  }
  fab.open();
}

function closeFab() {
  fab.close();
  if (started && ui.el.pause.classList.contains('hidden') && ui.el.start.classList.contains('hidden')) {
    player.enabled = true;
    if (!player.touchMode && !photoMode) player.requestLock();
  }
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, degraded ? 1 : 2));
  renderer.setSize(w, h, false);
}

/* ------------------------------------------------------------------ */
function animateProps(dt) {
  const r = world.refs;
  const fr = world.furnRefs;

  // 扇風機
  const f = r.fan;
  const target = f.on ? 17 : 0;
  f.speed += (target - f.speed) * Math.min(1, dt * (f.on ? 3.2 : 1.2));
  f.blades.rotation.x += f.speed * dt;

  // 地球儀
  if (globeSpin > 0 && fr.globe) {
    globeSpin -= dt;
    fr.globe.rotation.y += dt * (1.4 + globeSpin * 0.6);
  }

  // 金魚
  if (fr.goldfish) {
    fishAngle += dt * 0.75;
    const g = fr.goldfish;
    g.position.set(Math.cos(fishAngle) * 0.062, 0.085 + Math.sin(fishAngle * 2) * 0.012, Math.sin(fishAngle) * 0.062);
    g.rotation.y = -fishAngle - Math.PI / 2;
    if (g.children[1]) g.children[1].rotation.y = 0.3 + Math.sin(time * 9) * 0.4;
  }

  // カーテンのゆらぎ（風の気配）
  for (const w of r.windows) {
    if (!w.curtains) continue;
    w.curtains.forEach((c, k) => {
      c.rotation.y = Math.sin(time * 0.55 + w.index * 1.7 + k * 0.9) * 0.035;
      c.rotation.z = (k === 0 ? -0.01 : 0.01) + Math.sin(time * 0.9 + w.index) * 0.006;
    });
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  if (started) {
    player.update(dt);
    interact.update(dt, time);
    minimap.update(dt, player);
    animateProps(dt);
  } else {
    // タイトル中はゆっくり見回す
    time += 0;
    camera.position.set(START.x, 1.62, START.z);
    camera.rotation.set(-0.03, START.yaw + Math.sin(time * 0.12) * 0.22, 0, 'YXZ');
    animateProps(dt);
  }

  world.dust.update(dt);
  world.tod.update(dt);
  audio.update(dt);
  renderer.render(scene, camera);

  // 重い環境なら品質を落とす
  if (!degraded && started) {
    fpsAcc += dt;
    fpsFrames++;
    if (fpsFrames === 120) {
      const avg = fpsAcc / fpsFrames;
      if (avg > 0.028) {
        degraded = true;
        renderer.setPixelRatio(1);
      }
      if (avg > 0.046) {
        renderer.shadowMap.enabled = false;
        world.tod.sun.castShadow = false;
        ui.toast('動作を軽くするため影をオフにしました', 3000);
      }
      fpsFrames = 0;
      fpsAcc = 0;
    }
  }
}

boot();
