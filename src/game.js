import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Audio } from './core/audio.js';
import { Input } from './core/input.js';
import { Player } from './core/player.js';
import { UI } from './ui.js';
import { Room } from './world/room.js';
import { VoidWorld } from './world/void.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const easeInQuint = (k) => k * k * k * k * k;
const easeOutQuint = (k) => 1 - Math.pow(1 - k, 5);
const lerp = THREE.MathUtils.lerp;

/* --------------------------------------------------------------- smooth damp */
function smoothDamp(cur, target, state, key, dt, smoothTime) {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (state[key] + omega * change) * dt;
  state[key] = (state[key] - omega * temp) * exp;
  return target + (change + temp) * exp;
}

class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.fov = 62;
    this.tPos = new THREE.Vector3();
    this.tYaw = 0; this.tPitch = 0; this.tRoll = 0; this.tFov = 62;
    this.v = { yaw: 0, pitch: 0, roll: 0, fov: 0, x: 0, y: 0, z: 0 };
    this.stiff = 0.28;
    this.shake = 0;
    this.noiseAmp = 0;
    this.time = 0;
  }
  setTarget({ pos, yaw, pitch, roll = 0, fov = 62, stiff = 0.28 }) {
    if (pos) this.tPos.copy(pos);
    if (yaw !== undefined) this.tYaw = yaw;
    if (pitch !== undefined) this.tPitch = pitch;
    this.tRoll = roll;
    this.tFov = fov;
    this.stiff = stiff;
  }
  snap() {
    this.pos.copy(this.tPos);
    this.yaw = this.tYaw; this.pitch = this.tPitch; this.roll = this.tRoll; this.fov = this.tFov;
    this.v.yaw = this.v.pitch = this.v.roll = this.v.fov = 0;
    this.v.x = this.v.y = this.v.z = 0;
  }
  update(dt) {
    this.time += dt;
    const st = Math.max(0.02, this.stiff);
    this.pos.x = smoothDamp(this.pos.x, this.tPos.x, this.v, 'x', dt, st);
    this.pos.y = smoothDamp(this.pos.y, this.tPos.y, this.v, 'y', dt, st);
    this.pos.z = smoothDamp(this.pos.z, this.tPos.z, this.v, 'z', dt, st);
    this.yaw = smoothDamp(this.yaw, this.tYaw, this.v, 'yaw', dt, st);
    this.pitch = smoothDamp(this.pitch, this.tPitch, this.v, 'pitch', dt, st);
    this.roll = smoothDamp(this.roll, this.tRoll, this.v, 'roll', dt, st);
    this.fov = smoothDamp(this.fov, this.tFov, this.v, 'fov', dt, st);
    this.apply();
  }
  apply() {
    const c = this.cam;
    const t = this.time;
    const sh = this.shake * this.shake;
    const nx = Math.sin(t * 13.7) * 0.5 + Math.sin(t * 27.3) * 0.25;
    const ny = Math.sin(t * 11.1 + 1.7) * 0.5 + Math.sin(t * 31.7) * 0.25;
    const nAmp = this.noiseAmp + sh * 0.02;
    c.position.set(
      this.pos.x + nx * nAmp,
      this.pos.y + ny * nAmp,
      this.pos.z + Math.sin(t * 9.3) * nAmp * 0.6
    );
    c.rotation.order = 'YXZ';
    c.rotation.set(this.pitch + ny * nAmp * 0.35, this.yaw + nx * nAmp * 0.35, this.roll + nx * nAmp * 0.25);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
    this.shake *= Math.exp(-3.2 * 0.016);
  }
}

/* ================================================================== GAME */
export class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.engine = new Engine(this.canvas);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.03, 400);
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.player = new Player(this.camera, this.audio);
    this.ui = new UI(this);
    this.rig = new CameraRig(this.camera);

    this.state = 'boot';
    this.mode = 'ui';
    this.time = 0;
    this.clock = 0;
    this.tasks = [];
    this.paused = false;
    this.clickCount = 0;
    this.cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false, hover: false };
    this.glitchPulse = 0;
    this.tunnel = null;
    this.flashLocked = false;

    this.settings = {
      volume: 0.8, sens: 1.0, quality: 'auto', bob: true, reduceFlash: false,
      ...(JSON.parse(localStorage.getItem('sleep.settings') || '{}')),
    };

    this.buildCursor();
    this.bindUI();
    this.bindInput();

    this.timeScale = new URLSearchParams(location.search).has('fast') ? 3 : 1;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  /* --------------------------------------------------------------- booting */
  async boot() {
    try {
      // fonts for the BSOD
      await this.initAudioAndFonts();
      this.ui.setLoad(0.35);

      this.room = new Room(this.engine, this.audio, { hasReturned: false });
      await this.room.build();
      await this.room.bsod.loadFonts();
      this.ui.setLoad(0.8);

      this.room.onStory = (id) => this.roomStory(id);
      this.room.onInteract = (id) => this.onRoomInteract(id);
      this.setupScenes(this.room);
      this.ui.setLoad(1);
      setTimeout(() => this.ui.hideLoading(), 260);
      this.ui.showScreen('menu', true);
      this.state = 'menu';
      this.mode = 'ui';
      this.engine.setScene(this.room.scene, this.camera);
      this.player.setWorld(this.room);
      // cinematic idle shot behind the menu
      this.idleMenuShot();
    } catch (e) {
      console.error(e);
      const l = document.getElementById('loading');
      if (l) l.innerHTML = '<div style="color:#f66;font:12px monospace;letter-spacing:.2em">LOAD ERROR — ' + e.message + '</div>';
    }
  }

  async initAudioAndFonts() {
    await this.audio.init((p) => this.ui.setLoad(0.05 + p * 0.3));
    this.audio.setVolume(this.settings.volume);
  }

  setupScenes(world) {
    this.camera.parent?.remove(this.camera);
    world.scene.add(this.camera);
    this.engine.setScene(world.scene, this.camera);
    this.player.setWorld(world);
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-start').addEventListener('click', () => this.startGame());
    $('btn-settings').addEventListener('click', () => { this.ui.showScreen('menu', false); this.ui.showScreen('settings', true); });
    $('btn-help').addEventListener('click', () => { this.ui.showScreen('menu', false); this.ui.showScreen('help', true); });
    $('btn-settings-close').addEventListener('click', () => {
      this.ui.showScreen('settings', false);
      if (this.state === 'menu') this.ui.showScreen('menu', true);
      else if (this.paused) this.ui.showScreen('pause', true);
    });
    $('btn-help-close').addEventListener('click', () => { this.ui.showScreen('help', false); this.ui.showScreen('menu', true); });
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-pause-settings').addEventListener('click', () => { this.ui.showScreen('pause', false); this.ui.showScreen('settings', true); });
    $('btn-restart').addEventListener('click', () => this.restart());
    $('btn-again').addEventListener('click', () => this.restart());

    const vol = $('opt-vol'), sens = $('opt-sens'), qual = $('opt-quality'), bob = $('opt-bob'), flash = $('opt-flash');
    vol.value = Math.round(this.settings.volume * 100);
    $('val-vol').textContent = vol.value;
    sens.value = Math.round(this.settings.sens * 100);
    $('val-sens').textContent = this.settings.sens.toFixed(2);
    qual.value = this.settings.quality;
    bob.checked = this.settings.bob;
    flash.checked = this.settings.reduceFlash;
    vol.addEventListener('input', () => {
      this.settings.volume = +vol.value / 100;
      $('val-vol').textContent = vol.value;
      this.audio.setVolume(this.settings.volume);
      this.saveSettings();
    });
    sens.addEventListener('input', () => {
      this.settings.sens = +sens.value / 100;
      $('val-sens').textContent = this.settings.sens.toFixed(2);
      this.input.sensitivity = this.settings.sens;
      this.saveSettings();
    });
    qual.addEventListener('change', () => { this.settings.quality = qual.value; this.engine.setQuality(qual.value); this.saveSettings(); });
    bob.addEventListener('change', () => { this.settings.bob = bob.checked; this.player.bobEnabled = bob.checked; this.saveSettings(); });
    flash.addEventListener('change', () => { this.settings.reduceFlash = flash.checked; this.saveSettings(); });

    this.input.sensitivity = this.settings.sens;
    this.player.bobEnabled = this.settings.bob;
    this.engine.setQuality(this.settings.quality);

    this.ui.onCommand = (cmd) => this.onConsoleCommand(cmd);
    this.input.onPause = (reason) => { if (reason === 'unlock' && this.mode === 'play') this.pause(); };
  }

  saveSettings() {
    localStorage.setItem('sleep.settings', JSON.stringify(this.settings));
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.ui.consoleOpen) { this.ui.closeConsole(); return; }
        if (this.mode === 'play') this.pause();
        else if (this.paused) this.resume();
      }
      if (this.mode !== 'play') return;
      if (this.state === 'void' && (e.code === 'KeyC') && !this.ui.consoleOpen) {
        this.openConsole();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.ui.consoleOpen) return;
      if (this.cursor.active) {
        if (this.input.locked) {
          this.cursor.x = THREE.MathUtils.clamp(this.cursor.x + (e.movementX || 0), 0, window.innerWidth);
          this.cursor.y = THREE.MathUtils.clamp(this.cursor.y + (e.movementY || 0), 0, window.innerHeight);
        } else {
          this.cursor.x = e.clientX; this.cursor.y = e.clientY;
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.mode === 'play' && this.cursor.active) this.onScreenClick();
    });
  }

  buildCursor() {
    const c = document.createElement('div');
    c.id = 'screen-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 3 L4 20 L9 15.6 L12.2 22.4 L15 21 L11.8 14.4 L18 14.2 Z" fill="#eaf4ff" stroke="#08111d" stroke-width="1.2"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;pointer-events:none;z-index:55;opacity:0;transform:translate(-50%,-50%);filter:drop-shadow(0 0 6px rgba(90,180,255,.9));transition:opacity .18s';
    document.getElementById('app').appendChild(c);
    this.cursorEl = c;
  }

  /* ---------------------------------------------------------------- start */
  async startGame() {
    // must be called from a user gesture: unlock audio + pointer lock
    this.audio.resume();
    this.input.requestLock();
    this.ui.showScreen('menu', false);
    this.ui.hud(true);
    this.ui.rec(true);
    this.state = 'room';
    this.mode = 'cine';
    this.player.setWorld(this.room);
    this.audio.music('music.room', 0.42, 3.0);
    this.audio.loop('amb.rain', { vol: 0.3, fade: 3, id: 'rain' });
    this.audio.loop('amb.room_noise', { vol: 0.1, fade: 4, id: 'room_noise' });
    this.audio.muffleTo(20000, 1);
    if (!/skipintro/.test(location.search)) await this.cinematicWake();
    else {
      // dev/test path: start standing in the room
      this.engine.fade(0);
      this.player.teleport(new THREE.Vector3(0.42, 0.02, 0.16), -1.22, -0.06);
      this.player.applyCamera();
    }
    this.mode = 'play';
    this.ui.keys(true);
    setTimeout(() => this.ui.keys(false), 9000);
  }

  /* ---------------------------------------------------------------- loop */
  loop(now) {
    requestAnimationFrame(this.loop.bind(this));
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!isFinite(dt)) dt = 0.016;
    dt = Math.min(dt, 0.05) * this.timeScale;
    this.time += dt;

    // tasks (cinematic tweens)
    if (this.tasks.length) {
      const done = [];
      for (const t of this.tasks) {
        t.t += dt;
        const k = clamp01(t.t / t.dur);
        try { t.fn(t.ease ? t.ease(k) : k, k); } catch (e) { console.error(e); }
        if (k >= 1) { done.push(t); t.resolve(); }
      }
      for (const d of done) this.tasks.splice(this.tasks.indexOf(d), 1);
    }

    if (!this.paused) this.update(dt);
    this.renderPass(dt);
    this.input.endFrame();
  }

  renderPass(dt) {
    if (this.mode === 'cine') this.rig.update(dt);
    this.engine.render(dt);
    if (this.tunnelActive && this.tunnel) {
      const r = this.engine.renderer;
      r.autoClear = false;
      r.clearDepth();
      r.render(this.tunnelScene, this.tunnelCam);
      r.autoClear = true;
    }
  }

  update(dt) {
    const world = this.world();
    const t = this.time;

    if (this.mode === 'play') {
      this.player.update(dt, this.input, true);
      this.rig.pos.copy(this.camera.position);
      this.rig.yaw = this.player.yaw;
      this.rig.pitch = this.player.pitch;
      this.rig.fov = this.camera.fov;
    } else if (this.input) {
      this.input.consumeLook();
    }
    if (this.chunkTick) this.chunkTick(dt);

    // interaction prompts (only while the player is actually in control)
    if (this.mode === 'play' && (this.state === 'room' || this.state === 'void')) this.updateInteraction();
    else if (this.mode !== 'play') this.ui.prompt('');

    // screen cursor
    this.updateCursor();

    if (world) world.update(dt, t, {
      player: this.player.pos,
      camera: this.camera,
      hoverScreen: this.cursor.hover,
      pupil: this.pupilVector(),
      glitchPulse: this.glitchPulse,
      wakeNear: this.wakeNear || 0,
    });

    if (this.state === 'room' || this.state === 'return') this.ui.clock(t);

    this.glitchPulse *= Math.exp(-3 * dt);

    // in the void the picture stays calm, then slips for a heartbeat, then calms again
    if (this.state === 'void' && this.mode === 'play' && !this.ui.consoleOpen) {
      this.anomTimer = (this.anomTimer ?? 8) - dt;
      if (this.anomTimer <= 0) {
        this.anomTimer = 8 + Math.random() * 10;
        this.anom = 0.55 + Math.random() * 0.45;
        const k = 1 + Math.floor(Math.random() * 4);
        this.audio.play('weird' + k, { vol: 0.16 });
        if (Math.random() < 0.4) this.audio.play('glitch' + (1 + Math.floor(Math.random() * 4)), { vol: 0.12 });
      }
      this.anom *= Math.exp(-2.2 * dt);
      this.engine.u.uGlitch.value = Math.max(-0.06, this.anom * 0.55);
      this.engine.u.uAberr.value = 0.14 + this.anom * 0.5;
      this.engine.u.uWarp.value = 0.05 + this.anom * 0.18;
    }
  }

  world() {
    if (this.state === 'void' || this.state === 'collapse' || this.state === 'fall') return this.voidWorld || this.room;
    return this.room;
  }

  pupilVector() {
    // screen-local: where the player's head is relative to the monitor
    const target = this.screenCenterWorld();
    const eye = this.camera.position;
    const dx = eye.x - target.x, dy = eye.y - target.y, dz = eye.z - target.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dz / len, y: -(dy / len) * 1.4 };
  }

  screenCenterWorld() {
    if (!this._screenCenter) this._screenCenter = new THREE.Vector3();
    // SCREEN_POS is already in world space (the room builds its own monitor)
    const p = this.room?.SCREEN_POS || { x: 2.1475, y: 0.985, z: 0.34 };
    this._screenCenter.set(p.x, p.y, p.z);
    return this._screenCenter;
  }

  /* ---------------------------------------------------------- interaction */
  updateInteraction() {
    let best = null, bestD = Infinity;
    const eye = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const list = this.state === 'room' || this.state === 'return' ? this.room.interactables : this.voidWorld.interactables;
    for (const it of list) {
      const d = it.pos.distanceTo(eye);
      if (d > it.radius) continue;
      const dir = it.pos.clone().sub(eye).normalize();
      const dot = dir.dot(fwd);
      const need = d < 1.2 ? -0.2 : 0.45;
      if (dot < need) continue;
      if (d < bestD) { bestD = d; best = it; }
    }
    this.hovered = best;
    if (best) {
      this.ui.prompt(best.prompt);
      this.ui.setCrosshair(true);
    } else {
      this.ui.prompt('');
      this.ui.setCrosshair(false);
    }
    if (this.state === 'void' && this.voidWorld) {
      const wd = Math.hypot(eye.x - this.voidWorld.center.x, eye.z - this.voidWorld.center.y + 6);
      this.wakeNear = clamp01(1 - (wd - 12) / 14);
    }
    if (best && (this.input.pressed('KeyE') || (this.input.pressed('Click') && !this.cursor.active))) {
      best.onUse?.();
    }
  }

  updateCursor() {
    const active = this.cursor.active;
    this.cursorEl.style.opacity = active ? '1' : '0';
    if (active) {
      this.cursorEl.style.left = this.cursor.x + 'px';
      this.cursorEl.style.top = this.cursor.y + 'px';
      this.ui.setCrosshair(false);
      this.ui.el.crosshair.style.display = 'none';
    } else {
      this.ui.el.crosshair.style.display = '';
    }
  }

  /* ============================================================ CINEMATICS */
  tween(dur, fn, ease) {
    return new Promise((resolve) => {
      this.tasks.push({ t: 0, dur: Math.max(0.0001, dur), fn, ease, resolve });
    });
  }
  wait(d) { return this.tween(d, () => {}); }

  /** Shot helper: point the rig at a world position with a smoothness. */
  lookAt(pos, from, stiff = 0.32, fov = 60, roll = 0) {
    const dir = pos.clone().sub(from);
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    this.rig.setTarget({ pos: from, yaw, pitch, fov, stiff, roll });
    return { yaw, pitch };
  }

  /* ---------------------------------------------------------- 1. waking up */
  async cinematicWake() {
    // lying in bed: head on the pillow, eyes open toward the dark room
    const lieHead = new THREE.Vector3(-0.10, 0.80, -2.02);
    const sitHead = new THREE.Vector3(0.02, 1.02, -1.42);
    const standPos = new THREE.Vector3(0.42, 0.02, 0.16);

    this.engine.fade(1);
    this.ui.narration('');
    this.rig.setTarget({ pos: lieHead, yaw: -2.30, pitch: 0.34, fov: 60, stiff: 0.9, roll: 0.06 });
    this.rig.snap();
    this.player.pos.set(0.42, 0.02, 0.16);
    this.player.yaw = this.player.targetYaw = -Math.PI / 2;
    this.player.pitch = this.player.targetPitch = 0;

    this.audio.heartbeat(1.35, 0.12);
    await this.wait(1.2);
    // fade up slowly, the eyes still half shut: the room resolves around us
    await this.tween(3.0, (k) => {
      this.engine.fade(1 - k);
      // the head sinks a little toward the pillow as consciousness returns
      this.rig.setTarget({
        pos: lieHead.clone().add(new THREE.Vector3(0, -0.03 * (1 - k), 0.02 * (1 - k))),
        yaw: -2.30 + 0.05 * k,
        pitch: 0.34 - 0.14 * k,
        fov: 60, stiff: 0.9, roll: 0.06 * (1 - k),
      });
    }, easeInOut);
    await this.wait(0.4);
    // head rolls to the side — the monitor's glow is the only light in the room
    await this.tween(2.2, (k) => {
      const kk = easeInOut(k);
      this.rig.setTarget({
        pos: lieHead, yaw: -2.30 + 0.22 * kk, pitch: 0.20 - 0.16 * kk,
        fov: 60, stiff: 0.85, roll: 0.06 - 0.1 * kk,
      });
    }, easeInOut);
    this.ui.narration('<em>03:14</em>。まだ、夜だ。', 4200);
    await this.wait(1.3);
    // sit up: the head lifts first, then the torso follows — real inertia
    await this.tween(2.3, (k, raw) => {
      const kk = easeInOut(k);
      const headLead = easeOut(Math.min(1, k * 1.6));
      const pos = lieHead.clone().lerp(sitHead, kk);
      pos.y += Math.sin(kk * Math.PI) * 0.05;
      this.rig.setTarget({
        pos,
        yaw: -2.08 + (-1.35 - -2.08) * kk,
        pitch: (0.04 - 0.04 * headLead) + 0.10 * (1 - kk),
        fov: 60 + 2 * kk, stiff: 0.62, roll: -0.04 * (1 - kk),
      });
    });
    await this.wait(0.5);
    // stand: weight forward over the feet, camera rises
    const from = sitHead.clone();
    const standEye = new THREE.Vector3(0.42, 1.62, 0.16);
    await this.tween(2.0, (k) => {
      const kk = easeInOut(k);
      const pos = from.clone().lerp(standEye, kk);
      pos.z += Math.sin(kk * Math.PI) * 0.18;   // lean over the knees
      this.rig.setTarget({
        pos, yaw: -1.35 + (-1.22 - -1.35) * kk, pitch: 0.06 - 0.12 * kk,
        fov: 62 + 2 * kk, stiff: 0.5,
      });
    });
    this.rig.setTarget({ pos: standEye, yaw: -1.22, pitch: -0.06, fov: 64, stiff: 0.4 });
    await this.wait(0.4);
    this.player.teleport(standPos, -1.22, -0.06);
    this.player.applyCamera();
    this.audio.play('impact_soft', { vol: 0.3 });
    this.ui.chapter('01', '自室', '03:14 — まだ起きている', 4600);
  }

  /* ------------------------------------------------- 2. examine the screen */
  async focusScreen() {
    if (this.mode !== 'play' || this.state !== 'room') return;
    if (this.room.screenOn && this.room.eaten > 0) return;
    this.mode = 'cine';
    this.ui.prompt('');
    this.ui.keys(false);
    const screen = this.screenCenterWorld();
    const target = screen.clone().add(new THREE.Vector3(-0.86, 0.06, 0.02));
    const startPos = this.camera.position.clone();
    const startYaw = this.player.yaw, startPitch = this.player.pitch;

    this.audio.play('click_soft', { vol: 0.5 });
    this.audio.duck(0.3, 2.0);
    this.audio.loop('amb.rain', { vol: 0.14, fade: 2.5, id: 'rain' });

    const look = this.lookAt(screen, target, 0.5, 50);
    this.rig.setTarget({ pos: startPos, yaw: startYaw, pitch: startPitch, fov: 64, stiff: 0.5 });
    this.rig.snap();
    this.rig.setTarget({ pos: target, yaw: look.yaw, pitch: look.pitch - 0.03, fov: 50, stiff: 0.62, roll: -0.012 });
    await this.wait(1.35);

    // screen flickers awake
    this.room.powerOnScreen();
    this.audio.play('zap', { vol: 0.25 });
    await this.wait(0.35);
    this.audio.play('glitch2', { vol: 0.3 });
    this.glitchPulse = 1.0;
    this.engine.u.uGlitch.value = 0.15;
    await this.wait(0.25);
    this.engine.u.uGlitch.value = 0.0;

    this.state = 'examine';
    this.mode = 'examine';
    this.cursor.active = true;
    this.cursor.x = window.innerWidth / 2;
    this.cursor.y = window.innerHeight / 2;
    this.clickCount = 0;
    this.examining = true;
    this.ui.narration('マウスで <em>:(</em> を指して、クリック。', 5200);
    this.audio.loop('amb.whisper_bed', { vol: 0.1, fade: 4, id: 'whispers' });
  }

  onScreenClick() {
    const uv = this.raycastScreenUV();
    if (!uv) return;
    const hover = this.room.bsod.hitTest(uv);
    if (!hover) {
      // clicking elsewhere on the screen
      this.audio.play('click', { vol: 0.3, rate: 0.8 });
      this.engine.u.uGlitch.value = Math.max(this.engine.u.uGlitch.value, 0.08);
      return;
    }
    this.escalate();
  }

  escalate() {
    this.clickCount++;
    const c = this.clickCount;
    this.audio.play(c === 1 ? 'lowdown' : c < 4 ? 'glitch1' : 'glitch3', { vol: 0.5 });
    this.audio.stutter(2 + Math.min(5, c), 0.09 + c * 0.008);
    if (c === 1) {
      this.audio.music('music.void', 0.3, 4.0);
      this.audio.play('zap', { vol: 0.35 });
      this.ui.narration('', 0);
    }
    const nx = clamp01(this.room.eaten + 0.105);
    this.room.setEaten(nx);
    this.glitchPulse = 0.55;
    // the distortion is a slip in the picture, not a wall of noise
    this.engine.u.uGlitch.value = 0.14 + nx * 0.3;
    this.engine.u.uAberr.value = 0.2 + nx * 0.6;
    this.engine.u.uWarp.value = nx * 0.22;
    this.engine.u.uSaturation.value = 1 + nx * 0.25;
    this.rig.shake = 0.12 + nx * 0.22;
    // camera creep in (the body leans closer without meaning to)
    const screen = this.screenCenterWorld();
    const dist = 0.86 - nx * 0.52;
    const target = screen.clone().add(new THREE.Vector3(-dist, 0.07 - nx * 0.02, 0.02));
    const look = this.lookAt(screen, target, 0.5, 50 + nx * 8);
    this.rig.setTarget({ pos: target, yaw: look.yaw, pitch: look.pitch - 0.02 + nx * 0.02, fov: 50 + nx * 8, stiff: 0.8, roll: -0.008 + nx * 0.012 });
    if (c === 2) this.ui.narration('……消えない。', 3000);
    if (c === 4) {
      this.ui.narration('画面の<em>奥</em>に、部屋がある。', 4200);
      this.audio.play('weird', { vol: 0.4 });
      this.room.lights.moon.intensity = 0.4;
    }
    if (c === 6) this.ui.narration('違う。ここは、<em>内側</em>だ。', 4200);
    if (nx >= 0.99 || c >= 10) this.beginSwallow();
  }

  raycastScreenUV() {
    if (!this.room.screenPlane) return null;
    const ndc = new THREE.Vector2(
      (this.cursor.x / window.innerWidth) * 2 - 1,
      -(this.cursor.y / window.innerHeight) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.room.screenPlane, false);
    if (!hit.length) return null;
    return hit[0].uv;
  }

  /* ------------------------------------------------------------ 3. swallow */
  async beginSwallow() {
    if (this.swallowing) return;
    this.swallowing = true;
    this.cursor.active = false;
    this.ui.narration('');
    this.mode = 'cine';
    this.room.setEaten(1);
    this.audio.play('impact_place_holder', { vol: 0 });
    this.audio.play('lowdown', { vol: 0.7 });
    this.audio.riser(4.6, 1.1);
    this.room.lights.ceil.intensity = 0;
    this.buildTunnel();
    const screen = this.screenCenterWorld();
    const base = this.camera.position.clone();
    // a beat of hesitation: the body pulls back before it is taken
    await this.tween(0.42, (k) => {
      const back = 0.05 * easeOut(k);
      this.rig.setTarget({ pos: base.clone().add(new THREE.Vector3(back, 0.01, 0)), yaw: this.rig.tYaw, pitch: this.rig.tPitch, fov: 54, stiff: 0.45 });
      this.engine.u.uGlitch.value = 0.25 + k * 0.2;
      this.rig.shake = 0.25;
    });
    this.ui.toast('SIGNAL LOST', 2400);
    // then it takes you
    const start = this.camera.position.clone();
    const end = screen.clone().add(new THREE.Vector3(-0.16, 0, 0));
    await this.tween(1.25, (k) => {
      const kk = easeInQuint(k);
      const pos = start.clone().lerp(end, kk);
      pos.y += Math.sin(kk * Math.PI) * 0.015;
      // the head is dragged, not driven: the yaw lags a touch behind the position
      this.rig.setTarget({ pos, yaw: this.rig.tYaw, pitch: this.rig.tPitch, fov: 54 + kk * 30, stiff: 0.34 });
      this.engine.u.uWarp.value = 0.25 + k * 0.55;
      this.engine.u.uAberr.value = 0.5 + k * 0.7;
      this.engine.u.uGlitch.value = 0.35 + k * 0.25;
      this.rig.shake = 0.25 + k * 0.35;
      this.room.setEaten(1);
      this.room.scene.fog.density = 0.02 + k * 0.06;
    });
    // the overlay tunnel takes over the frame
    this.tunnelActive = true;
    this.tunnelMat.uniforms.uMouth.value = 0;
    this.audio.downpitch(2.6);
    await this.tween(1.5, (k) => {
      const u = this.tunnelMat.uniforms;
      u.uProgress.value = k;
      u.uTime.value = this.time;
      u.uMouth.value = easeIn(k) * 0.9;
      this.engine.u.uGlitch.value = 0.4 + k * 0.25;
      this.engine.u.uAberr.value = 0.9 + k * 0.6;
      this.rig.shake = 0.5;
    }, easeInOut);
    this.ui.flash(this.settings.reduceFlash ? 0.35 : 0.9, 260);
    this.audio.thump(0.9, 40);
    this.engine.fade(1);
    this.tunnelActive = false;
    await this.wait(0.45);
    await this.enterVoid();
  }

  buildTunnel() {
    if (this.tunnel) return;
    const geo = new THREE.PlaneGeometry(2, 2);
    this.tunnelMat = new THREE.ShaderMaterial({
      uniforms: {
        tScreen: { value: this.room.bsod.texture },
        uProgress: { value: 0 },
        uMouth: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: window.innerWidth / window.innerHeight },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D tScreen;
        uniform float uProgress, uMouth, uTime, uAspect;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          vec2 p = vUv - 0.5;
          p.x *= uAspect;
          float r = length(p);
          float a = atan(p.y, p.x);
          // pulled into the middle of the image
          float pull = mix(0.42, 0.06, uProgress);
          vec2 uv = 0.5 + (vUv - 0.5) * pull / max(0.05, 0.45 - uProgress*0.25);
          // radial smear
          vec3 col = vec3(0.0);
          for (int i = 0; i < 6; i++) {
            float fi = float(i) / 5.0;
            vec2 off = (vUv - 0.5) * (0.004 + 0.05 * uProgress) * fi;
            col += texture2D(tScreen, clamp(uv + off, 0.001, 0.999)).rgb;
          }
          col /= 6.0;
          // white hot rim as the frame is eaten
          float rim = smoothstep(0.15, 0.55, r + uMouth * 0.6);
          col = mix(vec3(0.85,0.95,1.0), col, rim);
          col += vec3(0.3,0.6,1.0) * pow(max(0.0, 1.0 - r * 2.2), 3.0) * uProgress * 1.6;
          // tearing
          float band = step(0.86, hash(vec2(floor(vUv.y*120.0), floor(uTime*20.0)))) * uProgress;
          col = mix(col, vec3(0.9,0.97,1.0), band*0.7);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.tunnel = new THREE.Mesh(geo, this.tunnelMat);
    this.tunnel.frustumCulled = false;
    this.tunnelScene = new THREE.Scene();
    this.tunnelScene.add(this.tunnel);
    this.tunnelCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /* -------------------------------------------------------------- 4. void */
  async enterVoid() {
    if (!this.voidWorld) {
      this.voidWorld = new VoidWorld(this.engine, this.audio);
      await this.voidWorld.build();
      this.voidWorld.onDiscover = () => this.onDiscoverWake();
      this.voidWorld.onTerminal = () => this.openConsole();
    }
    this.state = 'void';
    this.mode = 'cine';
    this.engine.fade(1);
    this.setupScenes(this.voidWorld);
    this.player.teleport(this.voidWorld.spawn.pos, this.voidWorld.spawn.yaw, -0.05);

    this.audio.stopLoop('rain', 1.2);
    this.audio.stopLoop('whispers', 1.6);
    this.audio.stopLoop('pc_fan', 2);
    this.audio.stopLoop('tower', 2);
    this.audio.music('music.world', 0.5, 5);
    this.audio.loop('amb.void_drone', { vol: 0.32, fade: 4, id: 'void_drone' });
    this.audio.loop('amb.static', { vol: 0.045, fade: 5, id: 'static' });
    this.audio.loop('amb.whisper_bed', { vol: 0.09, fade: 5, id: 'whispers' });
    this.audio.muffleTo(20000, 2);

    // the arrival: camera comes to rest from the fall
    this.rig.setTarget({ pos: new THREE.Vector3(2.5, 0.4, 30), yaw: 0.08, pitch: 0.6, fov: 70, stiff: 0.5 });
    this.rig.snap();
    this.camera.position.set(2.5, 8, 32);
    await this.tween(2.4, (k) => this.engine.fade(1 - k), easeOut);
    const target = new THREE.Vector3(2.5, 1.68, 30);
    this.rig.setTarget({ pos: target, yaw: 0.08, pitch: 0.02, fov: 66, stiff: 0.55 });
    this.audio.play('whoosh3', { vol: 0.5 });
    this.audio.play('impact_plate', { vol: 0.4 });
    await this.wait(1.5);
    this.player.teleport(this.voidWorld.spawn.pos, this.voidWorld.spawn.yaw, 0);
    this.player.applyCamera();
    this.mode = 'play';
    this.ui.chapter('02', 'BLUE', 'STOP CODE: 0x0000000C', 5600);
    this.ui.narration('青い。息が、白い。<br/>どこまで歩いても、足音だけが返ってくる。', 7000);
    this.state = 'void';
    this.voidStart = this.time;
    this.consoleHinted = false;
    // the world settles into calm blue; anomalies come and go
    this.engine.u.uGlitch.value = 0;
    this.engine.u.uAberr.value = 0.14;
    this.engine.u.uWarp.value = 0.05;
    this.engine.u.uSaturation.value = 1.02;
    this.engine.u.uGrain.value = 0.028;
    this.engine.u.uScan.value = 0.04;
    this.rig.shake = 0;
    this.anom = 0;
    this.anomTimer = 7 + Math.random() * 6;
  }

  onDiscoverWake() {
    this.audio.play('weird2', { vol: 0.5 });
    this.audio.play('powerup', { vol: 0.4 });
    this.ui.narration('<em>WAKE_UP</em><br/>──それは、命令の形をしている。', 8000);
    this.ui.toast('C  —  CONSOLE', 6000);
    this.consoleHinted = true;
  }

  openConsole() {
    if (this.state !== 'void' || this.ui.consoleOpen) return;
    this.input.exitLock();
    this.ui.openConsole('');
    this.ui.clearConsole();
    this.ui.print('<span class="dim">RECOVERY CONSOLE 0x0B50D — read-only, unverified</span>');
    this.ui.print('<span class="dim">type a command. <span class="hi">HELP</span> lists what is left.</span>');
    this.ui.print('');
    this.audio.play('glitch4', { vol: 0.35 });
  }

  onConsoleCommand(raw) {
    const cmd = raw.trim();
    const low = cmd.toLowerCase();
    const reply = (html, delay = 220) => {
      setTimeout(() => { this.ui.print(html); this.audio.play('ui_tick', { vol: 0.25 }); }, delay);
    };
    const deny = (html) => {
      this.audio.play('ui_error', { vol: 0.4 });
      this.audio.stutter(3, 0.1);
      this.ui.print(html);
    };
    if (!cmd) return;

    if (low === 'wake_up' || low === 'wakeup' || low === 'wake up' || low === 'WAKE_UP') {
      this.ui.print('<span class="ok">WAKE_UP accepted.</span>');
      this.audio.play('powerup', { vol: 0.5 });
      setTimeout(() => this.beginCollapse(), 900);
      this.ui.closeConsole();
      return;
    }
    if (low === 'help' || low === '?') {
      reply('<span class="dim">KNOWN VERBS:</span>');
      reply('  <span class="cmd">whoami</span>   <span class="dim">— what is wearing your name</span>', 300);
      reply('  <span class="cmd">sleep</span>    <span class="dim">— close the session</span>', 420);
      reply('  <span class="cmd">echo</span>     <span class="dim">— say it back</span>', 540);
      reply('  <span class="cmd">clear</span>    <span class="dim">— erase the room</span>', 660);
      reply('<span class="dim">there are other words. you have seen one of them.</span>', 900);
      return;
    }
    if (low === 'whoami') {
      reply('<span class="dim">READING USER…</span>');
      reply('<span class="err">ERROR: 2 sessions own this body.</span>', 700);
      reply('<span class="dim">one of them is still asleep in a chair.</span>', 1200);
      return;
    }
    if (low === 'sleep' || low === 'exit' || low === 'quit' || low === 'logout') {
      reply('<span class="dim">closing session…</span>');
      reply('<span class="err">REFUSED. the room is load-bearing.</span>', 800);
      this.audio.play('ui_deny', { vol: 0.4 });
      return;
    }
    if (low.startsWith('echo')) {
      const rest = cmd.slice(4).trim();
      reply(rest ? `<span class="dim">${escapeHtml(rest)}</span>` : '<span class="dim">…</span>');
      if (rest) reply('<span class="dim">(it was already said. earlier. by you.)</span>', 900);
      return;
    }
    if (low === 'clear' || low === 'cls') {
      this.ui.clearConsole();
      this.ui.print('<span class="dim">the room was not cleared. only the text.</span>');
      return;
    }
    if (low === 'ls' || low === 'dir') {
      reply('<span class="cmd">/room</span>  <span class="cmd">/room/again</span>  <span class="cmd">/sleep</span>  <span class="err">/wake_up (locked)</span>');
      return;
    }
    if (['wake', 'wake_up()', 'wakeup()', 'WAKE_UP()', 'wake_up;'].includes(cmd)) {
      deny('<span class="err">syntax error: the command is not a function. it is a door.</span>');
      return;
    }
    if (low === 'hello' || low === 'hi') {
      reply('<span class="dim">hello.</span>');
      reply('<span class="dim">…you said that eleven minutes ago.</span>', 800);
      return;
    }
    if (low === 'blue' || low === 'bsod') {
      reply('<span class="glitch">: (</span>');
      return;
    }
    if (low === 'wake_up!' || low === 'wake up!') {
      deny('<span class="err">no. punctuation makes it a wish.</span>');
      return;
    }
    // unknown
    deny(`<span class="err">'${escapeHtml(cmd)}' is not recognized.</span>`);
    reply('<span class="dim">the console is listening. the room is not.</span>', 600);
    this.audio.stutter(4, 0.12);
    this.glitchPulse = 0.7;
    this.engine.u.uGlitch.value = 0.35;
    this.rig.shake = 0.5;
  }

  /* -------------------------------------------------------- 5. the collapse */
  async beginCollapse() {
    if (this.collapsing) return;
    this.collapsing = true;
    this.mode = 'cine';
    this.state = 'collapse';
    this.ui.clearConsole();
    this.ui.narration('');
    this.ui.prompt('');
    this.voidWorld.beginCollapse();
    this.voidWorld.crack = 0;
    this.input.setEnabled(false);

    const eye = this.player.pos.clone();
    eye.y += this.player.eye;
    const yaw0 = this.player.yaw;
    this.rig.setTarget({ pos: eye, yaw: yaw0, pitch: 0, fov: 66, stiff: 0.5 });
    this.rig.snap();

    // --- the silence before ------------------------------------------------
    this.audio.stopAllLoops(1.2);
    this.audio.music('music.void', 0.32, 3.0);
    this.audio.play('impact_soft', { vol: 0.25 });
    this.ui.toast('WAKE_UP — EXECUTING', 3200);
    this.audio.loop('amb.static', { vol: 0.03, fade: 2, id: 'static' });
    await this.wait(1.1);
    const stopBeat = this.audio.heartbeat(0.95, 0.18);

    // --- panic look-around: saccades with head inertia ---------------------
    const look = async (dyaw, dpitch, dur, stiff = 0.22) => {
      this.rig.setTarget({ pos: eye, yaw: yaw0 + dyaw, pitch: dpitch, fov: 66, stiff });
      this.audio.play('whoosh4', { vol: 0.22, rate: 0.6 });
      await this.wait(dur);
    };
    await look(0.62, 0.06, 0.42, 0.16);
    await look(-0.75, -0.03, 0.5, 0.15);
    await look(-0.15, 0.34, 0.6, 0.2);
    this.audio.play('weird', { vol: 0.35 });
    // something moves in the distance
    this.voidWorld.redLight.intensity = 40;
    await look(0.1, -0.12, 0.45, 0.24);

    // --- look down at the feet --------------------------------------------
    const lookDown = new Promise(async (resolve) => {
      this.rig.setTarget({ pos: eye, yaw: yaw0 + 0.05, pitch: -1.05, fov: 68, stiff: 0.34 });
      await this.wait(1.05);
      resolve();
    });
    this.audio.play('rock_break2', { vol: 0.3, rate: 0.7 });
    this.audio.riser(5.5, 0.9);
    await lookDown;
    // the crack opens under the player
    const center = new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z);
    this.buildCrack(center);
    await this.tween(1.5, (k) => {
      this.voidWorld.crack = k;
      this.rig.shake = 0.4 + k * 1.2;
      this.rig.setTarget({ pos: eye, yaw: yaw0 + 0.05, pitch: -1.05 + k * 0.06, fov: 68 + k * 4, stiff: 0.4 });
      if (Math.random() < 0.3) this.audio.play('rock_fall', { vol: 0.2 + k * 0.3, rate: 0.7 + Math.random() * 0.5 });
    });
    // small step back — a flinch
    await this.tween(0.5, (k) => {
      this.rig.setTarget({ pos: eye.clone().add(new THREE.Vector3(0, 0.02 * k, 0.25 * k)), yaw: yaw0 + 0.05, pitch: -1.0 + k * 0.25, fov: 72, stiff: 0.2 });
    });
    this.audio.thump(0.7, 55);
    this.rig.shake = 2.0;
    this.audio.play('rock_break', { vol: 0.7 });
    this.spawnFallingChunks(center);
    // --- the ground gives way --------------------------------------------
    this.voidWorld.hole = 0;
    const fallStart = this.camera.position.clone();
    let fell = 0;
    await this.tween(2.0, (k) => {
      this.voidWorld.hole = Math.min(1, k * 1.3);
      const drop = easeIn(k) * 2.4;
      fell = drop;
      this.rig.setTarget({
        pos: new THREE.Vector3(fallStart.x, fallStart.y - drop, fallStart.z),
        yaw: yaw0 + 0.05 + Math.sin(k * 6) * 0.03,
        pitch: -1.0 + k * 0.9,
        fov: 74 + k * 8, stiff: 0.3, roll: Math.sin(k * 5) * 0.05,
      });
      this.rig.shake = 1.5;
      this.engine.u.uGlitch.value = 0.4 + k * 0.4;
    });
    this.state = 'fall';
    this.audio.play('whoosh2', { vol: 0.8 });
    this.audio.play('sub_drop', { vol: 0.7 });
    this.audio.downpitch(6.0);
    this.audio.loop('amb.static', { vol: 0.2, fade: 1, id: 'static' });

    // --- the fall ---------------------------------------------------------
    const fallDur = 6.2;
    const fallFrom = this.camera.position.clone();
    this.spawnFallStreaks();
    this.voidWorld.ground.visible = false;
    const spin = { yaw: 0, pitch: 0, roll: 0 };
    await this.tween(fallDur, (k, raw) => {
      const drop = easeIn(k) * 130 + k * 30;
      const pos = new THREE.Vector3(
        fallFrom.x + Math.sin(k * 3.1) * 0.5,
        fallFrom.y - drop,
        fallFrom.z + Math.cos(k * 2.4) * 0.5
      );
      this.rig.setTarget({
        pos, yaw: yaw0 + Math.sin(raw * 2.2) * 0.5, pitch: 0.4 + Math.sin(raw * 1.6) * 0.5,
        fov: 70 + Math.sin(raw * 3) * 6 + k * 10, stiff: 0.14, roll: Math.sin(raw * 2.7) * 0.16,
      });
      // the world recedes upward: clouds of static rush past
      this.rig.noiseAmp = 0.02 + k * 0.03;
      this.engine.u.uAberr.value = 1.2 + k * 2.5;
      this.engine.u.uWarp.value = 0.4 + k * 0.8;
      this.engine.u.uDirt.value = k * 0.35;
      this.engine.u.uSaturation.value = 1.4 - k * 0.6;
      this.engine.u.uGlitch.value = 0.3 + Math.sin(raw * 20) * 0.15 * k;
      if (Math.random() < 0.02) this.audio.play('glitch1', { vol: 0.25, rate: 0.6 + Math.random() });
      if (this.fallStreaks) this.fallStreaks.position.y = pos.y - 6;
    }, (x) => x);
    stopBeat?.();
    this.audio.stopAllLoops(0.4);
    this.audio.muffleTo(300, 0.6);
    this.audio.thump(1.0, 30);
    this.audio.play('glass_break', { vol: 0.4 });
    this.ui.flash(this.settings.reduceFlash ? 0.5 : 1, 900);
    await this.wait(0.35);
    await this.landInRoom();
  }

  buildCrack(center) {
    const g = new THREE.Group();
    const segs = 16;
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 + Math.random() * 0.2;
      const len = 1.2 + Math.random() * 2.6;
      const w = 0.02 + Math.random() * 0.05;
      const geo = new THREE.PlaneGeometry(w, len);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(center.x + Math.cos(a) * len * 0.45, 0.012, center.z + Math.sin(a) * len * 0.45);
      m.rotation.y = -a + Math.PI / 2;
      g.add(m);
    }
    // the abyss under the crack
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false })
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(center.x, 0.02, center.z);
    g.add(hole);
    this.scene_root = this.voidWorld.scene;
    this.voidWorld.scene.add(g);
    this.crackGroup = g;
    this.crackMat = mat;
    this.crackHole = hole;
    // animate open
    const start = performance.now();
    const anim = () => {
      if (!this.crackGroup) return;
      const k = Math.min(1, (performance.now() - start) / 2200);
      mat.opacity = k * 0.85;
      hole.material.opacity = k * 0.95;
      hole.scale.setScalar(0.6 + k * 0.8);
      requestAnimationFrame(anim);
    };
    anim();
  }

  spawnFallingChunks(center) {
    const geoms = [
      new THREE.BoxGeometry(0.6, 0.12, 0.5),
      new THREE.BoxGeometry(1.2, 0.16, 0.8),
      new THREE.BoxGeometry(0.35, 0.1, 0.7),
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a1c2c, roughness: 0.35, metalness: 0.6, emissive: 0x0a2b46, emissiveIntensity: 0.6 });
    this.chunks = [];
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(geoms[i % 3], mat);
      const a = Math.random() * 6.28, r = 0.4 + Math.random() * 3.4;
      m.position.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
      m.rotation.set(Math.random() * 0.4, Math.random() * 6.28, Math.random() * 0.4);
      this.voidWorld.scene.add(m);
      this.chunks.push({
        mesh: m, vel: new THREE.Vector3(Math.cos(a) * 0.3, -1 - Math.random() * 2, Math.sin(a) * 0.3),
        spin: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
        delay: Math.random() * 0.6,
      });
    }
    // animate in the background (independent of the cinematic clock)
    const tick = (dt) => {
      if (!this.chunks) return;
      for (const c of this.chunks) {
        if (c.delay > 0) { c.delay -= dt; continue; }
        c.vel.y -= 9 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
      }
    };
    this.chunkTick = tick;
  }

  spawnFallStreaks() {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fallStreaks = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xbfe6ff, size: 0.14, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.voidWorld.scene.add(this.fallStreaks);
  }

  /* --------------------------------------------------------------- 6. return */
  async landInRoom() {
    this.state = 'return';
    this.mode = 'cine';
    this.audio.stopAllLoops(0.2);
    this.rig.noiseAmp = 0;
    this.rig.shake = 0;
    // reset grade
    Object.entries({ uGlitch: 0.6, uAberr: 1.4, uWarp: 0.2, uDirt: 0, uSaturation: 1.0 }).forEach(([k, v]) => {
      this.engine.u[k].value = v;
    });
    // into the room
    this.room.applyReturnState();
    this.setupScenes(this.room);
    this.engine.fade(1);
    this.audio.play('impact_plate', { vol: 0.7 });
    this.audio.thump(0.8, 45);
    const floorPos = new THREE.Vector3(0.62, 0.42, 0.62);
    this.rig.setTarget({ pos: floorPos, yaw: -1.35, pitch: -0.55, fov: 74, stiff: 0.5 });
    this.rig.snap();
    await this.tween(0.7, (k) => this.engine.fade(1 - k), easeOut);
    this.audio.music('music.room', 0.35, 4.0);
    this.audio.loop('amb.rain', { vol: 0.26, fade: 3, id: 'rain' });
    this.audio.loop('amb.room_noise', { vol: 0.09, fade: 3, id: 'room_noise' });
    this.audio.muffleTo(20000, 2.5);
    this.audio.play('weird2', { vol: 0.28, rate: 0.6 });
    // get up off the floor
    await this.tween(2.9, (k, raw) => {
      const kk = easeInOut(k);
      const pos = floorPos.clone().lerp(new THREE.Vector3(0.45, 1.64, 0.5), kk);
      this.rig.setTarget({ pos, yaw: -1.35 + kk * 0.2, pitch: -0.55 + kk * 0.55, fov: 74 - kk * 10, stiff: 0.6 });
    });
    this.player.teleport(new THREE.Vector3(0.45, 0.02, 0.5), -1.15, 0);
    this.player.applyCamera();
    this.mode = 'play';
    // the tear in the picture closes; a little of it never quite does
    this.tween(2.4, (k) => {
      const s = 1 - easeOut(k);
      this.engine.u.uGlitch.value = 0.6 * s * s;
      this.engine.u.uAberr.value = 1.4 * s + 0.04;
      this.engine.u.uWarp.value = 0.2 * s;
    }).catch(() => {});
    this.ui.narration('……戻ってきた。<br/>机の上は、<em>元のまま</em>のはずだ。', 6000);
    this.audio.heartbeat(1.6, 0.1);
    setTimeout(() => this.ui.toast('ESC  —  MENU', 4200), 2400);
  }

  /* ----------------------------------------------------------- interactions */
  onRoomInteract(id) {
    if (id === 'pc') {
      if (this.state === 'return') {
        this.ui.narration('画面は、まだ青い。<br/>……もう、いい。', 5200);
        this.audio.play('glitch1', { vol: 0.3 });
        setTimeout(() => this.showEnd(), 1500);
        return;
      }
      this.focusScreen();
    }
  }

  roomStory(id) {
    switch (id) {
      case 'mug':
        this.audio.play('impact_glass', { vol: 0.16, rate: 1.4 });
        this.ui.narration('冷めたコーヒー。<br/>底に、青い<em>反射</em>が沈んでいる。', 4200);
        break;
      case 'phone':
        if (this.state === 'return') {
          this.ui.narration('画面に、見覚えのない通知。<br/>「<em>0% complete</em>」', 5000);
        } else {
          this.ui.narration('通知は、まだ<em>3:14</em>で止まっている。', 4200);
        }
        break;
      case 'notes':
        this.ui.narration('「ねむれない」<br/>「ねむったら、おきられない」<br/><span style="opacity:.6">その下に、別の筆跡で「WAKE_UP」</span>', 6500);
        break;
      case 'window':
        this.ui.narration('雨。<br/>街の明かりが、<em>青く</em>滲んでいる。', 4200);
        break;
      default: break;
    }
    this.audio.play('paper_01', { vol: 0.2, randomRate: 0.2 });
  }

  /* ------------------------------------------------------------- pause/end */
  pause() {
    if (this.paused || this.mode === 'ui') return;
    this.paused = true;
    this.input.exitLock();
    this.ui.showScreen('pause', true);
    this.audio.duck(0.2, 0.4);
  }

  resume() {
    this.paused = false;
    this.ui.showScreen('pause', false);
    this.audio.unduck(0.6);
    this.input.requestLock();
  }

  showEnd() {
    this.mode = 'ui';
    this.input.exitLock();
    this.ui.showScreen('end', true);
    this.audio.duck(0.25, 1.2);
  }

  async restart() {
    this.ui.showScreen('end', false);
    this.ui.showScreen('pause', false);
    this.engine.fade(1);
    this.mode = 'cine';
    await this.wait(0.5);
    // reset room state
    this.room.resetToStart?.();
    this.audio.stopAllLoops(0.5);
    this.swallowing = false;
    this.collapsing = false;
    this.clickCount = 0;
    this.glitchPulse = 0;
    this.state = 'room';
    this.setupScenes(this.room);
    Object.entries({ uGlitch: 0, uAberr: 0, uWarp: 0, uDirt: 0, uSaturation: 1, uFade: 0 }).forEach(([k, v]) => {
      this.engine.u[k].value = v;
    });
    this.ui.flash(0.3, 300);
    await this.cinematicWake();
    this.audio.music('music.room', 0.42, 3.0);
    this.audio.loop('amb.rain', { vol: 0.3, fade: 3, id: 'rain' });
    this.audio.loop('amb.room_noise', { vol: 0.1, fade: 4, id: 'room_noise' });
    this.mode = 'play';
    this.input.requestLock();
  }

  idleMenuShot() {
    // slow drift behind the menu, so the first frame is never dead
    const p = new THREE.Vector3(0.4, 1.75, 1.2);
    const look = new THREE.Vector3(1.6, 1.1, 0.2);
    const d = look.clone().sub(p);
    const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.rig.setTarget({ pos: p, yaw, pitch, fov: 58, stiff: 2 });
    this.rig.snap();
    this.mode = 'cine';
    this.menuDrift = true;
  }

  requestLockSoon() {
    setTimeout(() => { if (this.mode === 'play') this.input.requestLock(); }, 120);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
