// main.js — BSOD_EX orchestrator: loading, states, input, ambient events.
import * as THREE from 'three';
import { BsodScreen } from './bsod.js';
import { PostFX } from './fx.js';
import { FPControls } from './controls.js';
import { AudioMan } from './audio.js';
import { buildRoom } from './room.js';
import { buildWorld, terrainHeight } from './glitchworld.js';
import { GameConsole } from './console.js';
import { Cinematics } from './cinematics.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

// ------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.02, 900);
const fx = new PostFX(renderer);
const controls = new FPControls(camera, canvas);
const audio = new AudioMan();
const bsod = new BsodScreen();

// ------------------------------------------------------------- globals
let room = null, world = null, gameConsole = null, cino = null;
let state = 'loading';   // loading|title|room|pczoom|devour|world|collapse|roomafter
let activeScene = null;
let corruption = 0;
let zoomAnim = null;     // {t, dur, from, to, onDone}
let preZoom = null;      // {pos, yaw, pitch} — where the player stood before zooming
let hintTimer = 0;
let ambientTimer = 14;
let clockTimer = 0;
let faceClickFlash = 0;

const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const shortAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// ------------------------------------------------------------- loading
function setLoad(frac, label) {
  $('load-fill').style.width = `${Math.round(frac * 100)}%`;
  if (label) $('load-label').textContent = label;
}

async function boot() {
  setLoad(0.04, 'モニターの準備…');
  await new Promise((r) => setTimeout(r, 30));

  room = await buildRoom(bsod.canvas, (i, p) => setLoad(0.05 + p * 0.45, '自室を読み込み中…'));
  setLoad(0.55, '異世界を構築中…');
  world = await buildWorld((i, p) => setLoad(0.55 + p * 0.25, '異世界を構築中…'));
  setLoad(0.84, '音を積み上げ中…');
  await audio.preload([
    'room_hum', 'room_atmos', 'clock_tick', 'click', 'mclick', 'beep', 'twobeep', 'triplebeep',
    'deniedbeep', 'chime', 'buzz', 'buzz_sigh', 'creak1', 'creak2', 'creak3', 'flicker', 'sparks1', 'sparks2',
    'carpet1', 'carpet2', 'carpet3',
    'rend', 'portal_open1', 'portal_open2', 'portal_open3', 'portal_travel', 'portal_close',
    'timeparadox', 'teleport_diss', 'charge', 'empulse', 'creepalert', 'narsie', 'static',
    'world_amb', 'world_amb2', 'world_amb3', 'voidsembrace', 'ghost1', 'ghost2', 'ghosty_wind',
    'ghost_whisper', 'far_noise', 'veryfar_noise', 'sting_a', 'sting_b', 'sting_c', 'sting_sin',
    'asteroid1', 'asteroid2', 'catwalk1', 'catwalk2',
    'gateway', 'alert', 'siren', 'glassbr1', 'glassbr2', 'glassbr3', 'glassknock', 'glass_reverse',
    'explosioncreak', 'explosionfar', 'explosion_distant', 'meteorimpact',
    'rumble', 'rumble_far1', 'rumble_far3', 'wind', 'bodyfall1', 'bodyfall2',
    'terminal_prompt', 'terminal_success', 'terminal_error', 'doorclick',
    'ui_click', 'ui_click2', 'ui_hover', 'ui_switch',
  ]);
  setLoad(1, '完了');

  gameConsole = new GameConsole({
    audio,
    onWake: () => {
      enterCollapse();
      gameConsole.close();
    },
    onCommand: (kind) => {
      if (kind === 'error' || kind === 'wake_refused') fxBlip(0.32);
    },
    onClose: () => {
      if (state === 'world') {
        controls.enabled = true;
        controls.requestLock();
      }
    },
  });
  cino = new Cinematics({ controls, fx, audio, bsod });

  // room lamp flicker hook for the devour
  room.setFlicker = (f) => {
    room.lamp.intensity = 6.5 * f;
    room.bedside.intensity = 1.8 * f;
  };

  activeScene = room.scene;
  $('loading').classList.add('hidden');
  $('title').classList.remove('hidden');
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------- helpers
function showHint(text, dur = 3.2) {
  $('hint-text').textContent = text;
  $('hint').classList.remove('hidden');
  hintTimer = dur;
}
function hideHint() {
  $('hint').classList.add('hidden');
  hintTimer = 0;
}
function showSubtitle(text, dur = 3.6) {
  $('subtitle-text').textContent = text;
  $('subtitle').classList.remove('hidden');
  setTimeout(() => $('subtitle').classList.add('hidden'), dur * 1000);
}
function fxBlip(strength = 0.4, dur = 0.28) {
  fx.set({ uGlitch: strength, uTear: strength * 0.7, uChroma: 0.15 + strength * 0.5 });
  setTimeout(() => {
    if (!cino.busy) fx.set({ uGlitch: 0, uTear: 0, uChroma: 0 });
  }, dur * 1000);
}

function startRoomAudio() {
  audio.stopLoops(0.5);
  audio.loop('room_hum', { vol: 0.32, fade: 2.2, bus: 'amb' });
  audio.loop('room_atmos', { vol: 0.22, fade: 3.0, bus: 'amb' });
  audio.setBus('music', 0.7, 1.5);
}
function startWorldAudio() {
  audio.stopLoops(1.4);
  audio.loop('world_amb', { vol: 0.5, fade: 2.5, bus: 'amb' });
  audio.loop('world_amb3', { vol: 0.22, fade: 3.5, bus: 'amb' });
  audio.loop('voidsembrace', { vol: 0.34, fade: 4.0, bus: 'music' });
  audio.setBus('music', 1.0, 2);
}

// ------------------------------------------------------------- states
function enterRoom(firstTime) {
  state = 'room';
  activeScene = room.scene;
  controls.enabled = true;
  controls.setState(room.spawn.pos, room.spawn.yaw, room.spawn.pitch);
  controls.colliders = room.colliders;
  controls.onFootstep = () => {
    if (Math.random() < 0.5) audio.play(`carpet${1 + ((Math.random() * 3) | 0)}`, { vol: 0.26, rate: 0.92 + Math.random() * 0.16, bus: 'sfx' });
  };
  bsod.setMode('desktop');
  corruption = 0;
  bsod.setCorruption(0);
  startRoomAudio();
  if (firstTime) {
    showSubtitle('夜。いつもと変わらない、静かな部屋。', 4.2);
    setTimeout(() => showHint('WASD / マウスで歩く ・ クリックで視点操作', 4.6), 4600);
  }
}

function enterWorld(fromDevour) {
  state = 'world';
  activeScene = world.scene;
  if (!fromDevour) {
    world.spawn.pos.y = terrainHeight(world.spawn.pos.x, world.spawn.pos.z) + controls.eyeHeight;
    controls.setState(world.spawn.pos, world.spawn.yaw, world.spawn.pitch);
  }
  controls.enabled = true;
  controls.colliders = [];
  controls.onFootstep = () => {
    if (Math.random() < 0.5) audio.play(Math.random() < 0.5 ? 'asteroid1' : 'asteroid2', { vol: 0.3, rate: 0.9 + Math.random() * 0.25, bus: 'sfx' });
  };
  startWorldAudio();
  showSubtitle('——画面の、内側。', 3.4);
  setTimeout(() => showHint('C — コンソールを開く', 6), 3800);
  ambientTimer = 12;
}

function enterRoomAfter() {
  state = 'roomafter';
  activeScene = room.scene;
  controls.enabled = true;
  controls.colliders = room.colliders;
  controls.onFootstep = () => {
    if (Math.random() < 0.5) audio.play(`carpet${1 + ((Math.random() * 3) | 0)}`, { vol: 0.26, rate: 0.92 + Math.random() * 0.16, bus: 'sfx' });
  };
  bsod.setMode('aftermath');
  room.setFlicker ? room.setFlicker(1) : null;
  startRoomAudio();
  $('restart-hint').classList.remove('hidden');
  showSubtitle('……自室。モニターの向こうに、まだ何かいる。', 4.4);
}

function enterPCZoom() {
  state = 'pczoom';
  controls.enabled = false;
  controls.releaseLock();
  const from = camera.position.clone();
  const to = room.screenWorld.clone().addScaledVector(room.screenNormal, 0.47);
  to.y += 0.055;
  preZoom = { pos: controls.position.clone(), yaw: controls.yaw, pitch: controls.pitch };
  zoomAnim = {
    t: 0, dur: 1.15, from, to,
    done: false,
    cb: () => {
      bsod.setMode('crash');
      audio.play('beep', { vol: 0.55, bus: 'sfx' });
      audio.play('static', { vol: 0.22, bus: 'sfx' });
      audio.play('buzz_sigh', { vol: 0.35, bus: 'sfx' });
      showHint(':( をクリックする', 5.5);
    },
  };
  audio.play('mclick', { vol: 0.4, bus: 'ui' });
}

function exitPCZoom() {
  state = 'room';
  controls.enabled = true;
  const from = camera.position.clone();
  const to = preZoom ? preZoom.pos.clone() : room.spawn.pos.clone();
  const backYaw = preZoom ? preZoom.yaw : controls.yaw;
  const backPitch = preZoom ? preZoom.pitch : controls.pitch;
  zoomAnim = {
    t: 0, dur: 0.9, from, to, back: true, done: false,
    cb: () => { controls.setState(to, backYaw, backPitch); },
  };
  showHint('クリックで視点操作を再開', 3);
}

function enterDevour() {
  state = 'devour';
  hideHint();
  cino.startDevour(room, world, (where) => {
    if (where === 'world') {
      state = 'world-pre';
      activeScene = world.scene;
      world.spawn.pos.y = terrainHeight(world.spawn.pos.x, world.spawn.pos.z) + controls.eyeHeight;
      controls.setState(world.spawn.pos, world.spawn.yaw, world.spawn.pitch);
    }
  }, () => {
    enterWorld(true);
  });
  audio.setBus('amb', 0.35, 1.5);
}

function enterCollapse() {
  state = 'collapse';
  controls.enabled = false;
  controls.releaseLock();
  hideHint();
  $('restart-hint').classList.add('hidden');
  cino.startCollapse(world, room, room.tex, (where) => {
    if (where === 'room') {
      activeScene = room.scene;
      bsod.setMode('static');
      setTimeout(() => bsod.setMode('aftermath'), 500);
    }
  }, () => {
    enterRoomAfter();
  });
}

function restart() {
  // soft reset — back to a fresh night in the room
  if (cino && cino.busy) return;
  if (cino && cino.ctx) {
    if (cino.ctx.below) { world.scene.remove(cino.ctx.below); world.scene.remove(cino.ctx.glow); }
    cino.ctx = {};
  }
  world.crackLines.visible = false;
  world.chunkMesh.visible = false;
  gameConsole.close();
  gameConsole.discovered = false;
  gameConsole.log.innerHTML = '';
  $('restart-hint').classList.add('hidden');
  fx.reset();
  if (room.setFlicker) room.setFlicker(1);
  controls.onFootstep = () => {
    if (Math.random() < 0.5) audio.play(`carpet${1 + ((Math.random() * 3) | 0)}`, { vol: 0.26, rate: 0.92 + Math.random() * 0.16, bus: 'sfx' });
  };
  zoomAnim = null;
  enterRoom(false);
  showSubtitle('——夜。いつもと変わらない、静かな部屋。', 4);
}

// ------------------------------------------------------------- input
$('btn-start').addEventListener('click', () => {
  audio.resume();
  $('title').classList.add('hidden');
  enterRoom(true);
  controls.requestLock();
});

$('lock-hint').addEventListener('click', () => {
  $('lock-hint').classList.add('hidden');
  controls.requestLock();
});

document.addEventListener('pointerlockchange', () => {
  const free = (state === 'room' || state === 'world' || state === 'roomafter');
  const consoleOpen = gameConsole && gameConsole.opened;
  if (!controls.locked && free && !consoleOpen && !(cino && cino.busy)) {
    $('lock-hint').classList.remove('hidden');
  } else {
    $('lock-hint').classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (state === 'loading' || state === 'title') return;
  if (gameConsole.opened) return;    // console handles its own keys

  if (e.code === 'KeyC' && state === 'world') {
    gameConsole.open();
    controls.enabled = false;
    controls.keys = {};
    controls.releaseLock();
    return;
  }
  if (e.code === 'Escape' && state === 'pczoom') {
    exitPCZoom();
    return;
  }
  if (e.code === 'KeyR' && (state === 'roomafter' || state === 'world' || state === 'room')) {
    restart();
    return;
  }
  if ((e.code === 'Enter' || e.code === 'KeyE') && state === 'pczoom' && !zoomAnim) {
    // clicking the face is the only way — but Enter shouldn't hard-lock the player
  }
});

// mouse: face hovering & clicking during PC_ZOOM
canvas.addEventListener('mousemove', (e) => {
  if (state !== 'pczoom' || zoomAnim) return;
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = raycaster.intersectObject(room.screen, false)[0];
  if (hit && hit.uv) {
    bsod.setCursor(hit.uv.x, 1 - hit.uv.y);
    const over = bsod.hitFace(hit.uv.x, 1 - hit.uv.y);
    canvas.style.cursor = over ? 'pointer' : 'crosshair';
    if (over && Math.random() < 0.02) audio.play('ui_hover', { vol: 0.12, bus: 'ui' });
  } else {
    canvas.style.cursor = 'crosshair';
  }
});

canvas.addEventListener('click', (e) => {
  if (state === 'pczoom' && !zoomAnim) {
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    const hit = raycaster.intersectObject(room.screen, false)[0];
    if (hit && hit.uv && bsod.hitFace(hit.uv.x, 1 - hit.uv.y)) {
      corruption = Math.min(1, corruption + 1 / 8);
      bsod.setCorruption(corruption);
      faceClickFlash = 1;
      audio.play('static', { vol: 0.3 + corruption * 0.5, rate: 0.85 + corruption * 0.7, bus: 'sfx' });
      audio.play(corruption > 0.5 ? 'deniedbeep' : 'ui_click2', { vol: 0.6, rate: 0.9 + corruption * 0.45, bus: 'ui' });
      fxBlip(0.14 + corruption * 0.45, 0.2 + corruption * 0.18);
      if (corruption >= 1) {
        setTimeout(() => { if (state === 'pczoom') enterDevour(); }, 520);
      }
    } else {
      audio.play('ui_click', { vol: 0.35, bus: 'ui' });
    }
    return;
  }
  if (state === 'room' && !cino.busy && !zoomAnim) {
    // interact when close & roughly looking at the PC
    const d = controls.position.distanceTo(room.interactPos);
    if (d < 2.6) {
      const toPC = new THREE.Vector3().subVectors(room.interactPos, controls.position).normalize();
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
      if (fwd.dot(toPC) > 0.42) enterPCZoom();
    }
  }
});

controls.onInteract = () => {
  if (gameConsole && gameConsole.opened) return;
  if (state === 'room' && !cino.busy && !zoomAnim) {
    const d = controls.position.distanceTo(room.interactPos);
    if (d < 2.8) enterPCZoom();
  }
};

// ------------------------------------------------------------- resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fx.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
});

// ------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  // ---------- camera tween (zoom in/out)
  if (zoomAnim) {
    zoomAnim.t += dt;
    const k = Math.min(1, zoomAnim.t / zoomAnim.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    // NOTE: write controls.position (syncCamera copies it to the camera)
    controls.position.lerpVectors(zoomAnim.from, zoomAnim.to, e);
    controls.bobAmount = 0;
    if (zoomAnim.back) {
      // blend gaze from the screen back to the player's own look direction
      const aim = new THREE.Vector3().subVectors(room.screenWorld, camera.position);
      const aimYaw = Math.atan2(-aim.x, -aim.z);
      const aimPitch = Math.atan2(aim.y, Math.sqrt(aim.x * aim.x + aim.z * aim.z));
      const destYaw = preZoom ? preZoom.yaw : aimYaw;
      const destPitch = preZoom ? preZoom.pitch : aimPitch;
      controls.yaw = aimYaw + shortAngle(destYaw - aimYaw) * e;
      controls.pitch = aimPitch + (destPitch - aimPitch) * e;
    } else {
      const aim = new THREE.Vector3().subVectors(room.screenWorld, camera.position);
      controls.yaw = Math.atan2(-aim.x, -aim.z);
      controls.pitch = Math.atan2(aim.y, Math.sqrt(aim.x * aim.x + aim.z * aim.z));
    }
    controls.syncCamera(dt);
    if (k >= 1 && !zoomAnim.done) {
      zoomAnim.done = true;
      const cb = zoomAnim.cb;
      zoomAnim = null;
      if (cb) cb();
    }
  } else if (cino && cino.busy) {
    cino.update(dt);
    controls.syncCamera(dt);
  } else if (gameConsole && gameConsole.opened) {
    controls.syncCamera(dt);
  } else {
    controls.update(dt);
  }

  // ---------- scene updates
  if (room) room.update(elapsed, dt);
  if (world && (activeScene === world.scene)) world.update(elapsed, dt);

  // ---------- room light behaviour
  if (room && (state === 'room' || state === 'roomafter' || state === 'pczoom')) {
    const base = 1 + Math.sin(elapsed * 0.9) * 0.03;
    if (state !== 'devour') {
      room.lamp.intensity = 6.5 * base;
      room.bedside.intensity = 1.8 * base;
    }
    room.monLight.intensity = 1.9 + Math.sin(elapsed * 2.2) * 0.18 + corruption * 2.4 + faceClickFlash * 2.2;
    faceClickFlash *= Math.pow(0.02, dt);
  }

  // ---------- BSOD canvas texture
  if (bsod.tick(elapsed)) room.tex.needsUpdate = true;

  // ---------- hints
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) hideHint();
  }
  if (state === 'room' && !cino.busy) {
    const d = controls.position.distanceTo(room.interactPos);
    if (d < 2.35 && hintTimer <= 0) {
      $('hint-text').textContent = 'クリック / E — パソコンを調べる';
      $('hint').classList.remove('hidden');
    } else if (d >= 2.55 && hintTimer <= 0 && $('hint-text').textContent.includes('調べる')) {
      hideHint();
    }
  }

  // ---------- world ambient events (silence ↔ anomaly rhythm)
  if (state === 'world' && !cino.busy) {
    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = 17 + Math.random() * 22;
      const pick = ['sting_a', 'sting_b', 'sting_c', 'sting_sin', 'far_noise', 'glassknock', 'ghosty_wind', 'rumble_far3', 'static'][(Math.random() * 9) | 0];
      audio.play(pick, { vol: 0.26 + Math.random() * 0.3, rate: 0.85 + Math.random() * 0.4, bus: 'sfx' });
      fxBlip(0.16 + Math.random() * 0.2, 0.5);
    }
    // WAKE_UP discovery
    const dMon = controls.position.distanceTo(new THREE.Vector3(0, controls.position.y, 21.5));
    if (dMon < 14 && !gameConsole.discovered) {
      gameConsole.discover();
      audio.play('ghost_whisper', { vol: 0.65, bus: 'sfx' });
      audio.play('creepalert', { vol: 0.5, bus: 'music' });
      fxBlip(0.4, 0.7);
      showSubtitle('……『WAKE_UP』。ガラスに、文字が彫られている。', 5.2);
    }
    // occasional steps while standing near structures
    if (Math.random() < dt * 0.05) audio.play(Math.random() < 0.5 ? 'catwalk1' : 'catwalk2', { vol: 0.2, rate: 0.8, pan: Math.random() * 2 - 1, bus: 'sfx' });
  }

  // ---------- room-after residue
  if (state === 'roomafter' && Math.random() < dt * 0.06) {
    fxBlip(0.18, 0.4);
    audio.play(Math.random() < 0.5 ? 'static' : 'ghost1', { vol: 0.16, bus: 'sfx' });
  }
  // ---------- room ambience events
  if ((state === 'room' || state === 'roomafter') && !cino.busy) {
    clockTimer -= dt;
    if (clockTimer <= 0) {
      clockTimer = 6.5 + Math.random() * 9;
      const pick = ['creak1', 'creak2', 'creak3', 'sting_sin'][(Math.random() * 4) | 0];
      audio.play(pick, { vol: 0.12 + Math.random() * 0.12, rate: 0.85 + Math.random() * 0.3, pan: Math.random() * 1.6 - 0.8, bus: 'sfx' });
    }
    if (Math.random() < dt * 0.22) {
      audio.play('clock_tick', { vol: 0.05 + Math.random() * 0.05, rate: 1, bus: 'amb' });
    }
  }

  // ---------- cinematic-driven room flicker (devour)
  if (room && state === 'devour' && room.lampFlicker != null) {
    room.setFlicker(room.lampFlicker);
  } else if (room && state !== 'devour' && room.lampFlicker != null && state !== 'room' && state !== 'roomafter') {
    room.setFlicker(1);
    room.lampFlicker = null;
  }

  // ---------- render
  fx.render(activeScene || room.scene, camera, elapsed);
}

boot().catch((e) => {
  console.error(e);
  $('load-label').textContent = '読み込みに失敗しました: ' + e.message;
});
