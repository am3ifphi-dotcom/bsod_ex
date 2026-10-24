import * as THREE from 'three';
import { Assets } from './core/assets';
import { AudioEngine } from './core/audio';
import { Input } from './core/Input';
import { PostFX } from './core/postfx';
import { UI } from './ui/UI';
import { Player } from './game/Player';
import { Room } from './game/Room';
import { World } from './game/World';
import { Director } from './game/Director';
import { GameConsole } from './game/Console';
import { clamp } from './core/util';

const BASE = import.meta.env.BASE_URL;

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false, alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.04, 900);
  camera.position.set(0.2, 1.62, 1.4);

  const sceneRoom = new THREE.Scene();
  sceneRoom.background = new THREE.Color(0x010306);
  const sceneWorld = new THREE.Scene();
  sceneWorld.fog = new THREE.FogExp2(0x061a2e, 0.0055);
  sceneWorld.background = new THREE.Color(0x02060c);

  const ui = new UI();
  const input = new Input(canvas);
  input.sensitivity = ui.settings.sensitivity;
  input.invertY = ui.settings.invertY;

  const assets = new Assets(renderer);
  const audio = new AudioEngine();
  const post = new PostFX(renderer, sceneRoom, camera, ui.settings.quality);

  /* ---------------- ローディング ---------------- */
  let loadProgress = 0;
  const loadPoll = window.setInterval(() => {
    loadProgress = Math.min(0.98, assets.progress);
    ui.setLoading(loadProgress, `アセットを読み込み中… ${Math.round(loadProgress * 100)}%`);
  }, 120);

  try {
    await assets.init();
  } catch (e) {
    clearInterval(loadPoll);
    ui.setLoading(0, 'アセットの読み込みに失敗しました');
    ui.setDebug(true, `ERROR: ${(e as Error).message}\n\nassets-src からアセットを生成してください:\n  npm run fetch-assets\n  npm run build-assets`);
    return;
  }
  clearInterval(loadPoll);
  ui.setLoading(0.96, 'シーンを構築中…');

  const env = assets.makeEnvMap();
  sceneRoom.environment = env;
  sceneRoom.environmentIntensity = 0.35;
  sceneWorld.environment = env;
  sceneWorld.environmentIntensity = 0.22;

  const player = new Player();
  const room = new Room(sceneRoom, assets, audio);
  const world = new World(sceneWorld, assets, audio);

  await room.build();
  sceneRoom.add(room.group);
  ui.setLoading(0.985, '異世界を構築中…');
  await world.build();
  sceneWorld.add(world.group);

  const director = new Director({
    renderer, sceneRoom, sceneWorld, camera, assets, audio, ui, post, input, player, room, world,
  });
  const consoleCtl = new GameConsole(ui, audio, {
    inVoid: () => director.phase === 'void',
    busy: () => director.phase !== 'void',
    onWakeUp: () => {
      ui.closeConsole();
      input.gameplay = false;
      input.lookEnabled = false;
      input.releaseLock();
      director.startCollapse();
    },
    onClose: () => {
      if (director.phase === 'void' || director.phase === 'room') {
        input.gameplay = true;
        input.lookEnabled = true;
        input.requestLock().catch(() => { /* drag fallback */ });
      }
    },
  });

  room.onText = (text, dur) => ui.setSubtitle(text, dur ?? 6000);
  room.onPC = () => director.usePC();
  room.onDoor = () => { audio.uiConfirm(false); };

  world.onText = (text, dur) => ui.setSubtitle(text, dur ?? 6000);
  world.onConsoleHint = () => ui.setSubtitle('C キーで、コンソールが開く。', 7000);

  player.onFootstep = (running) => audio.playFootstep(director.phase === 'room' ? 'wood' : 'stone', 1, running);
  player.onLand = (impact) => {
    if (impact > 0.15) audio.impact(impact * 0.5);
    audio.playFootstep(director.phase === 'room' ? 'wood' : 'stone', 0.8);
  };

  ui.setLoading(1, '完了');
  ui.hideLoading();
  ui.showStart();

  /* ---------------- 開始 ---------------- */
  let running = false;
  let started = false;
  ui.onStart = async () => {
    ui.hideStart();
    await audio.init();
    audio.setVolumes({ master: ui.settings.master, ambience: ui.settings.ambience, sfx: ui.settings.sfx });
    const files = (assets.manifest.audio?.footsteps?.files ?? []).map((f) => `${BASE}assets/audio/${f}`);
    await audio.loadFootsteps(files);
    audio.playFootstep('wood', 0.2);
    running = true;
    started = true;
    await director.startRoom(true);
  };

  ui.onResume = () => {
    ui.closeMenu();
    if (director.phase === 'room' || director.phase === 'void') {
      input.gameplay = true;
      input.lookEnabled = true;
      input.requestLock().catch(() => {});
    }
  };
  ui.onRestart = () => {
    ui.closeMenu();
    if (!started) return;
    director.restart();
  };

  ui.onSettingsChanged = (s, key) => {
    input.sensitivity = s.sensitivity;
    input.invertY = s.invertY;
    audio.setVolumes({ master: s.master, ambience: s.ambience, sfx: s.sfx });
    if (key === 'quality') {
      post.setQuality(s.quality);
      post.setScale(1);
      renderer.shadowMap.needsUpdate = true;
    }
    if (key === 'dynamicRes' && !s.dynamicRes) post.setScale(1);
    if (key === 'shake') player.settings.bobScale = s.shake;
  };

  /* ---------------- 入力 ---------------- */
  let fpsVisible = false;
  const debug = new URLSearchParams(location.search).has('debug');

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { fpsVisible = !fpsVisible; ui.setFps(fpsVisible); e.preventDefault(); return; }
    if (e.code === 'F5') {
      // ブラウザ再読込ではなく、完全な初期化で最初から
      e.preventDefault();
      if (!started) return;
      ui.closeConsole();
      ui.closeRead();
      ui.closeMenu();
      ui.setFps(fpsVisible);
      director.restart();
      return;
    }
    if (e.code === 'Escape') {
      if (ui.consoleOpen) { consoleCtl.close(); e.preventDefault(); return; }
      if (ui.reading) { ui.closeRead(); e.preventDefault(); return; }
      if (ui.menuOpen) { ui.onResume?.(); e.preventDefault(); return; }
      if (running) { openMenu(); e.preventDefault(); }
      return;
    }
    if (ui.consoleOpen) return;
    if (e.code === 'KeyC') {
      if (ui.reading) { ui.closeRead(); return; }
      if (ui.menuOpen) return;
      if (running) { consoleCtl.toggle(); e.preventDefault(); }
      return;
    }
    if (e.code === 'KeyE' && ui.reading) { ui.closeRead(); return; }
    if (debug) {
      // デバッグ: 各フェーズへのジャンプ (?debug=1 のときのみ)
      const map: Record<string, Parameters<Director['jump']>[0]> = {
        Digit1: 'room', Digit2: 'screen', Digit3: 'void', Digit4: 'monolith', Digit5: 'collapse', Digit6: 'return',
      };
      if (map[e.code]) { director.jump(map[e.code]); ui.setDebug(true, `DEBUG: ${ui.settings.quality}`); }
      if (e.code === 'F9') ui.setDebug(true, debugText());
    }
  });

  function openMenu() {
    if (ui.menuOpen) return;
    ui.openMenu();
    input.releaseLock();
    input.gameplay = false;
    input.lookEnabled = false;
    player.freeze = true;
    audio.uiConfirm(false);
  }

  input.onPointerLockChange = (locked) => {
    if (!locked && running && !ui.menuOpen && !ui.consoleOpen && !ui.reading
      && (director.phase === 'room' || director.phase === 'void')) {
      openMenu();
    }
    if (locked) ui.setSubtitle(null, 0);
  };

  canvas.addEventListener('mousedown', () => {
    if (!running) return;
    if (ui.menuOpen || ui.consoleOpen || ui.reading) return;
    if (director.phase === 'room' || director.phase === 'void') {
      if (!input.pointerLocked) input.requestLock().catch(() => {});
    }
  });

  window.addEventListener('visibilitychange', () => {
    if (document.hidden && running && !ui.menuOpen && !ui.consoleOpen) openMenu();
  });

  /* ---------------- リサイズ ---------------- */
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    post.setSize(w, h);
  };
  window.addEventListener('resize', onResize);
  onResize();
  if (debug) ui.setDebug(true, debugText());

  /* ---------------- ループ ---------------- */
  const clock = new THREE.Clock();
  const frameTimes: number[] = [];
  let statAccum = 0;
  let avgMs = 16.7;
  let lowFps = 60;
  let fps = 60;
  let resTimer = 0;
  let resAccum = 0;
  const menuCamPos = new THREE.Vector3(0.55, 1.55, 1.35);
  const menuCamLook = new THREE.Vector3(0.5, 1.16, -2.06);

  function debugText() {
    return [
      'DEBUG (=?debug=1)',
      '1: 自室  2: BSOD画面',
      '3: 異世界(到着)  4: 中心構造物',
      '5: 崩壊+落下  6: 帰還後',
      'F9: この表示',
      `phase: ${director.phase}`,
      `quality: ${ui.settings.quality}  res: ${post.resolutionScale.toFixed(2)}`,
    ].join('\n');
  }

  function frame() {
    requestAnimationFrame(frame);
    const dtRaw = clock.getDelta();
    const dt = Math.min(dtRaw, 0.05);

    // ---- ゲーム状態 ----
    const freeRoam = director.phase === 'room' || director.phase === 'void';
    const blocking = ui.menuOpen || ui.consoleOpen || ui.reading;
    if (running) {
      input.gameplay = freeRoam && !blocking;
      input.lookEnabled = freeRoam && !blocking;
      if (freeRoam && blocking) player.freeze = true;
      director.update(dt);
    } else {
      // タイトル背景: 自室をゆっくり見せる
      const t = performance.now() / 1000;
      camera.position.set(
        menuCamPos.x + Math.sin(t * 0.11) * 0.22,
        menuCamPos.y + Math.sin(t * 0.07) * 0.03,
        menuCamPos.z + Math.cos(t * 0.09) * 0.14,
      );
      camera.lookAt(menuCamLook);
      camera.fov = 58; camera.updateProjectionMatrix();
      room.update(dt, t, camera, false);
      post.update(dt, { focus: 2.4, aperture: 0.8, glitch: 0.0, block: 0, warp: 0, fade: 1, shake: 0, vignette: 0.5, grain: 0.055 });
    }

    // ---- 描画 ----
    renderer.info.reset();
    post.render(dt);
    audio.update(dt);
    input.endFrame();

    // ---- 統計 ----
    const ms = dtRaw * 1000;
    frameTimes.push(ms);
    if (frameTimes.length > 420) frameTimes.shift();
    statAccum += ms;
    if (frameTimes.length > 30) {
      avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      fps = 1000 / avgMs;
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
      lowFps = 1000 / Math.max(0.001, p99);
    }
    if (fpsVisible) {
      const info = renderer.info.render;
      ui.setFpsText(
        `FPS      ${fps.toFixed(1)}   (1% low ${lowFps.toFixed(1)})\n` +
        `frame    ${avgMs.toFixed(2)} ms\n` +
        `draw     ${info.calls} calls / ${(info.triangles / 1000).toFixed(0)}k tris\n` +
        `res      ${(post.resolutionScale * 100).toFixed(0)}%  ${ui.settings.quality}\n` +
        `phase    ${director.phase}`,
      );
    }

    // ---- 動的解像度 ----
    if (ui.settings.dynamicRes && running) {
      resAccum += ms; resTimer += dt;
      if (resTimer > 1.6) {
        const avg = resAccum / Math.max(1, resTimer / (1 / 60));
        const avgFrame = resAccum / Math.max(1, Math.round(1 / dt));
        if (avgFrame > 17.8 && post.resolutionScale > 0.56) post.setScale(post.resolutionScale - 0.08);
        else if (avgFrame < 12.5 && post.resolutionScale < 1) post.setScale(post.resolutionScale + 0.05);
        void avg;
        resAccum = 0; resTimer = 0;
      }
    }

    // 自動テスト用
    (window as unknown as { __BSOD: unknown }).__BSOD = {
      phase: director.phase, fps, lowFps, avgMs,
      settings: ui.settings, director, consoleCtl, startRoom: () => director.startRoom(true),
    };
  }

  requestAnimationFrame(frame);
  ui.setDebug(debug, debugText());

  // コンテキストロスト
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ui.setDebug(true, 'WebGL context lost — リロードしてください。');
  });
}

boot().catch((e) => {
  console.error(e);
  const d = document.getElementById('debug');
  if (d) {
    d.classList.remove('hidden');
    d.textContent = `起動に失敗しました:\n${(e as Error).stack ?? e}`;
  }
});
