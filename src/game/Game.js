import * as THREE from 'three';
import { AssetManager } from '../core/AssetManager.js';
import { Input } from '../core/Input.js';
import { Player } from '../core/Player.js';
import { PostFX } from '../core/PostFX.js';
import { AudioEngine } from '../core/AudioEngine.js';
import { BedroomScene } from './BedroomScene.js';
import { GlitchScene } from './GlitchScene.js';
import { ConsumeTransition } from './ConsumeTransition.js';
import { CollapseSequence } from './CollapseSequence.js';
import { GameConsole } from './Console.js';
import { HUD } from './HUD.js';
import { lerp, smoothstep } from '../core/util.js';

const STATE = {
  LOADING: 'loading', TITLE: 'title', ROOM: 'room', INSPECT: 'inspect',
  CONSUME: 'consume', VOID_ENTRY: 'void_entry', VOID: 'void',
  CONSOLE: 'console', COLLAPSE: 'collapse', LANDING: 'landing',
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 500);
    this.input = new Input(canvas);
    this.assets = new AssetManager();
    this.audio = new AudioEngine();
    this.hud = new HUD();
    this.player = new Player(this.camera);
    this.state = STATE.LOADING;
    this.time = 0;
    this._tmp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._clock = new THREE.Clock();
    this._edgeWarnAt = 0;
    this._voidTime = 0;

    this._bindPointerEvents();
    window.addEventListener('resize', () => this._resize());
  }

  async load(onProgress) {
    this.assets.onProgress((p) => onProgress && onProgress(p));
    this.bedroom = new BedroomScene();
    this.void = new GlitchScene();
    await Promise.all([this.bedroom.load(this.assets), this.void.load(this.assets)]);

    this.sceneRoom = new THREE.Scene();
    this.sceneRoom.background = new THREE.Color(0x02030a);
    this.sceneRoom.fog = new THREE.FogExp2(0x05070d, 0.03);
    this.sceneRoom.add(this.bedroom.group);

    this.sceneVoid = new THREE.Scene();
    this.sceneVoid.background = new THREE.Color(0x050a14);
    this.sceneVoid.fog = new THREE.FogExp2(0x050a14, 0.016);
    this.sceneVoid.add(this.void.group);

    this.activeScene = this.sceneRoom;
    this.postfx = new PostFX(this.renderer, this.activeScene, this.camera);
    this.postfx.setSize(window.innerWidth, window.innerHeight);

    this.consume = new ConsumeTransition(this.camera, this.bedroom, this.postfx, this.audio);
    this.consume.onEnterVoid = () => this._enterVoid();
    this.collapseSeq = new CollapseSequence(this.camera, this.void, this.postfx, this.audio);
    this.collapseSeq.onLanded = () => this._landInBedroom();

    this.console = new GameConsole(this.audio);
    this.console.onWakeUp = () => this._startCollapse();
    // ゲーム時間ベースの遅延実行(バックグラウンドタブのタイマー抑制に強い)
    this.console.clock = (sec, fn) => this.after(sec, fn);
    this._timers = [];
    this.console.onToggle = (open, handoff) => { if (!open && !handoff) this._closeConsole(); };
    this.player.onFootstep = () => this.audio.footstep();

    // プレイヤー初期配置
    const s = this.bedroom.playerStart;
    this.player.setColliders(this.bedroom.colliders, this.bedroom.bounds);
    this.player.reset(s.pos, s.yaw, s.pitch);
    this.bedroom.setMonitorPower(false);
  }

  _bindPointerEvents() {
    this.input.onLockChange((locked) => {
      if (this.state === STATE.ROOM || this.state === STATE.VOID) {
        if (!locked) this._pause();
      }
    });
    // ボタンはinnerHTMLで差し替わるので委譲で受ける
    document.getElementById('pause').addEventListener('click', (e) => {
      if (e.target.id === 'resume-btn') {
        if (this._landingAwait) this._afterLanding();
        else this._resume();
      }
    });
    document.addEventListener('mousemove', (e) => { this._lastMouse = e; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === STATE.ROOM || this.state === STATE.VOID)) this._pause();
    });
  }

  // ---------------- 状態遷移 ----------------
  after(sec, fn) {
    this._timers.push({ t: sec, fn });
  }

  _tickTimers(dt) {
    if (!this._timers || !this._timers.length) return;
    for (let i = this._timers.length - 1; i >= 0; i--) {
      const tm = this._timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this._timers.splice(i, 1); tm.fn(); }
    }
  }

  startGame() {
    this.audio.init();
    this.state = STATE.ROOM;
    this.input.enabled = true;
    this.player.enabled = true;
    this.hud.show();
    this.hud.setHint('<b>WASD</b> 移動　<b>マウス</b> 視点　<b>SHIFT</b> 走る　<b>E</b> 調べる');
    this.audio.setMood('room');
    this.audio.setTension(0.08);
    this._setScene(this.sceneRoom);
    const s = this.bedroom.playerStart;
    this.player.setColliders(this.bedroom.colliders, this.bedroom.bounds);
    this.player.reset(s.pos, s.yaw, s.pitch);
    this.input.requestLock();
    this.after(0.6, () => this.hud.say('夜の自室。机の上のPCが、静かに待っている。', 4.5));
  }

  _setScene(scene) {
    this.activeScene = scene;
    this.postfx.composer.passes[0].scene = scene;
  }

  _pause() {
    if (this._paused) return;
    this._paused = true;
    document.getElementById('pause').classList.remove('hidden');
    this.hud.showCrosshair(false);
  }

  _resume() {
    if (!this._paused) return;
    this._paused = false;
    document.getElementById('pause').classList.add('hidden');
    this.hud.showCrosshair(true);
    this.input.requestLock();
  }

  _startInspect() {
    this.state = STATE.INSPECT;
    this.input.exitLock();
    // インスペクト中も pressed() を使うため enabled は維持(移動は state で止まる)
    this.input.keys.clear();
    this.input._justPressed.clear();
    this.hud.showCrosshair(false);
    this.hud.hidePrompt();
    this._preInspect = { pos: this.player.position.clone(), yaw: this.player.yaw, pitch: this.player.pitch };
    this.bedroom.setMonitorPower(true);
    this.bedroom.setMonitorTarget(9);
    this.audio.blip(440, 0.12, 'triangle', 0.08);
    this.inspectBlend = 0;
    const pose = this.bedroom.getInspectPose();
    this._inspectTarget = pose;
    this.clickCount = 0;
    this._faceHover = false;
    this.hud.say('ブルースクリーン。……この顔は、こちらを見ている。', 4);
    document.body.style.cursor = 'default';
  }

  _cancelInspect() {
    this.bedroom.setMonitorPower(false);
    this.state = STATE.ROOM;
    this.input.enabled = true;
    this.input.keys.clear();
    this.input._justPressed.clear();
    this.player.reset(this._preInspect.pos, this._preInspect.yaw, this._preInspect.pitch);
    this.hud.showCrosshair(true);
    this.input.requestLock();
  }

  _startConsume() {
    this.state = STATE.CONSUME;
    this.hud.clearSubtitle();
    this.hud.hidePrompt();
    this.hud.showCrosshair(false);
    this.bedroom.bsod.setCracked(false);
    this.consume.start();
  }

  _enterVoid() {
    this._setScene(this.sceneVoid);
    this.void.reset();
    this._discovered = false;
    this.state = STATE.VOID_ENTRY;
    this._entryT = 0;
    this.postfx.setNow('corruption', 1);
    this.postfx.setNow('warp', 0.6);
    this.postfx.triggerFlash(0.9);
    const s = this.void.playerStart;
    this.player.setColliders(this.void.colliders, this.void.bounds);
    this.player.reset(s.pos, s.yaw, s.pitch);
    this.player.enabled = false;
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(s.pos.x, s.pos.y + this.player.eyeHeight, s.pos.z);
    this.audio.setMood('void');
    this.audio.setTension(0.25);
    this.audio.rumble(2, 0.3);
    this._voidTime = 0;
  }

  _openConsole() {
    if (this.state !== STATE.VOID) return;
    this.state = STATE.CONSOLE;
    this.input.exitLock();
    this.console.discovery = this.void.discovered;
    this.console.open();
    this.hud.showCrosshair(false);
  }

  _closeConsole() {
    if (this.state !== STATE.CONSOLE) return;
    this.state = STATE.VOID;
    this.input.enabled = true;
    this.hud.showCrosshair(true);
    setTimeout(() => this.input.requestLock(), 60);
  }

  _startCollapse() {
    if (this.state === STATE.CONSOLE) this.console.close(true);
    this.state = STATE.COLLAPSE;
    this.input.enabled = false;
    this.player.enabled = false; // カメラは演出リグが駆動(_afterLandingで復帰)
    this.hud.showCrosshair(false);
    this.hud.clearSubtitle();
    this.hud.setHint('');
    const p = this.camera.position.clone();
    const yaw = this.player.yaw, pitch = this.player.pitch;
    this.collapseSeq.start(p, yaw, pitch);
  }

  _landInBedroom() {
    this._setScene(this.sceneRoom);
    this.void.shaft.visible = false;
    this.bedroom.setAnomaly(true);
    this.bedroom.monitorHolder.visible = true;
    this.bedroom.setMonitorPower(true);
    this.bedroom.setMonitorTarget(7);
    this.postfx.setNow('corruption', 0);
    this.postfx.setNow('warp', 0);
    this.state = STATE.LANDING;
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this._landT = 0;
    this.landPos = new THREE.Vector3(1.45, 0.42, 0.6);
    this.landYaw = -Math.PI / 2 + 0.4;
    this.camera.position.copy(this.landPos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(-0.25, this.landYaw, 0.12);
    this.audio.setMood('room');
    this.audio.setTension(0.4);
    this.audio.thud(0.9);
    this.audio.rumble(1.5, 0.25);
    this._spawnDust(this.landPos);
    this._landingAwait = true;
    this.after(1.8, () => {
      if (this.state !== STATE.LANDING) return;
      document.querySelector('#pause .pause-inner').innerHTML =
        '<h2>RETURNED</h2><p>部屋に、戻ってきた。</p><button id="resume-btn">クリックで操作を再開</button>';
      document.getElementById('pause').classList.remove('hidden');
      this.hud.showCrosshair(false);
    });
  }

  _afterLanding() {
    this._landingAwait = false;
    document.getElementById('pause').classList.add('hidden');
    document.querySelector('#pause .pause-inner').innerHTML =
      '<h2>PAUSED</h2><p>一時停止中</p><button id="resume-btn">再開する</button>';
    this.state = STATE.ROOM;
    this.input.enabled = true;
    this.player.setColliders(this.bedroom.colliders, this.bedroom.bounds);
    this.player.reset(new THREE.Vector3(1.45, 0.02, 0.6), this.landYaw, 0);
    this.player.enabled = true;
    this.hud.show();
    this.hud.showCrosshair(true);
    this.hud.setHint('<b>WASD</b> 移動　<b>E</b> 調べる　<b>M</b> ミュート');
    this.hud.say('部屋は帰ってきた。だが、PCの様子が……おかしい。', 5);
    this.audio.setTension(0.15);
    this.input.requestLock();
  }

  _spawnDust(pos) {
    const n = 80;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x + (Math.random() - 0.5) * 0.8;
      p[i * 3 + 1] = pos.y + Math.random() * 0.3;
      p[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.8;
      v.push(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.2, (Math.random() - 0.5) * 1.6));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x9fc4ee, size: 0.03, transparent: true, opacity: 0.7, depthWrite: false,
    }));
    this.sceneRoom.add(pts);
    const start = this.time;
    const tick = () => {
      const age = this.time - start;
      const arr = geo.attributes.position;
      for (let i = 0; i < n; i++) {
        arr.array[i * 3] += v[i].x * 0.016;
        arr.array[i * 3 + 1] += v[i].y * 0.016;
        arr.array[i * 3 + 2] += v[i].z * 0.016;
      }
      arr.needsUpdate = true;
      pts.material.opacity = Math.max(0, 0.7 - age * 0.5);
      if (age < 2.2 && this.activeScene === this.sceneRoom) requestAnimationFrame(tick);
      else this.sceneRoom.remove(pts);
    };
    tick();
  }

  // ---------------- フレーム更新 ----------------
  update() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const input = this.input;

    if (this._paused) { this.postfx.render(dt, this.time); input.endFrame(); return; }
    this.time += dt;

    this._tickTimers(dt);

    switch (this.state) {
      case STATE.ROOM: this._updateRoom(dt); break;
      case STATE.INSPECT: this._updateInspect(dt); break;
      case STATE.CONSUME: this._updateConsume(dt); break;
      case STATE.VOID_ENTRY: this._updateVoidEntry(dt); break;
      case STATE.VOID: this._updateVoid(dt); break;
      case STATE.CONSOLE: break;
      case STATE.COLLAPSE: this._updateCollapse(dt); break;
      case STATE.LANDING: this._updateLanding(dt); break;
    }

    if (input.pressed('KeyM') && (this.state === STATE.ROOM || this.state === STATE.VOID)) {
      const muted = this.audio.toggleMute();
      this.hud.say(muted ? 'ミュート' : 'ミュート解除', 1.2);
    }

    // 部屋シーンがアクティブな間だけ寝室を更新(異世界中はCPUを使わない)
    if (this.state === STATE.ROOM || this.state === STATE.INSPECT ||
        this.state === STATE.CONSUME || this.state === STATE.LANDING) {
      this.bedroom.update(dt, this.time);
    }
    this.postfx.render(dt, this.time);
    input.endFrame();
  }

  _updateRoom(dt) {
    const input = this.input;
    this.player.update(dt, input);
    // モニターへの接近判定
    const anchor = this.bedroom.anchor;
    this.camera.getWorldDirection(this._fwd);
    this._tmp.copy(anchor).sub(this.camera.position);
    const dist = this._tmp.length();
    const facing = this._tmp.normalize().dot(this._fwd);
    if (dist < 2.5 && facing > 0.45) {
      this.hud.showPrompt('<b>E / クリック</b> でPCを調べる');
      this.hud.setHot(true);
      if (input.pressed('KeyE') || input.pressed('Mouse0')) this._startInspect();
    } else {
      this.hud.hidePrompt();
      this.hud.setHot(false);
    }
  }

  _updateInspect(dt) {
    // 着座モーション
    if (this.inspectBlend < 1) {
      this.inspectBlend = Math.min(1, this.inspectBlend + dt / 1.1);
      const k = smoothstep(0, 1, this.inspectBlend);
      const fromPos = this._preInspect.pos.clone();
      fromPos.y += this.player.eyeHeight;
      this.camera.position.lerpVectors(fromPos, this._inspectTarget.pos, k);
      this._lookTarget = this._lookTarget || new THREE.Object3D();
      this._lookTarget.position.copy(this._inspectTarget.lookAt);
      this._lookTarget.updateMatrixWorld();
      this.camera.quaternion.slerp(this._lookTarget.quaternion, k);
      return;
    }
    const input = this.input;
    if (input.pressed('KeyE') || input.pressed('Escape')) { this._cancelInspect(); return; }

    // 顔ヒットボックスへのレイキャスト
    this._raycaster.setFromCamera(input.mouseNDC(this._lastMouse || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }), this.camera);
    const hit = this._raycaster.intersectObject(this.bedroom.faceHitbox, false);
    const hover = hit.length > 0;
    if (hover !== this._faceHover) {
      this._faceHover = hover;
      this.canvas.style.cursor = hover ? 'pointer' : 'default';
      this.hud.setHot(hover);
    }
    if (hover) {
      this.hud.showPrompt('<b>クリック</b> で顔に触れる　 / 　<b>E</b> で離れる');
      if (input.pressed('Mouse0')) this._clickFace();
    } else {
      this.hud.showPrompt('<b>:(</b> にカーソルを重ねてクリック　 / 　<b>E</b> で離れる');
    }
    // 微細な不安
    this.camera.rotation.z = Math.sin(this.time * 3.2) * 0.004 + (this.clickCount * 0.004);
    if (this.clickCount > 0) this.postfx.triggerGlitch(this.clickCount * 0.04);
  }

  _clickFace() {
    this.clickCount++;
    const c = this.clickCount / 6;
    this.bedroom.bsod.setCorruption(c);
    this.bedroom.setMonitorTarget(9 + c * 22);
    this.postfx.triggerGlitch(0.25 + c * 0.6);
    this.postfx.triggerFlash(Math.min(0.25, c * 0.12));
    this.audio.glitch(0.3 + c * 0.7);
    this.audio.setTension(0.2 + c * 0.6);
    this.camera.rotation.x += (Math.random() - 0.5) * 0.03 * c;
    this.hud.say(this.clickCount < 3 ? '画面が、ざわつく。' : this.clickCount < 5 ? '部屋の輪郭が、青く滲み始める。' : 'もう、止まらない。', 1.8);
    this.camera.rotation.x += (Math.random() - 0.5) * 0.015 * c;
    if (this.clickCount >= 6) this._startConsume();
  }

  _updateConsume(dt) {
    const alive = this.consume.update(dt, this.time);
    if (!alive && this.state === STATE.CONSUME) {
      // 遷移完了を待つ(enterVoidはフラッシュ時に発火済み)
    }
  }

  _updateVoidEntry(dt) {
    this._entryT += dt;
    const t = this._entryT / 2.2;
    this.postfx.setTarget('corruption', 1 - smoothstep(0, 1, t));
    this.postfx.setTarget('warp', 0.6 * (1 - smoothstep(0, 1, t)));
    // ゆっくり頭を上げる
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.x = lerp(-0.5, this.player.pitch, smoothstep(0, 1, t));
    this.camera.rotation.y = this.player.yaw + Math.sin(this.time) * 0.03 * (1 - t);
    if (t >= 1) {
      this.state = STATE.VOID;
      this.player.enabled = true;
      this.input.enabled = true;
      this.hud.showCrosshair(true);
      this.input.requestLock();
      this.hud.setHint('<b>WASD</b> 探索　<b>SHIFT</b> 走る');
      this.hud.say('青の世界。どこまでも歩ける。何かが、中心で待っている。', 5);
    }
  }

  _updateVoid(dt) {
    const input = this.input;
    this.player.update(dt, input);
    this._voidTime += dt;
    const ev = this.void.update(dt, this.time, this.player.position);
    if (ev.burst > 0) this.postfx.triggerGlitch(ev.burst * 0.5);
    if (ev.discovered && !this._discovered) {
      this._discovered = true;
      this.hud.showDiscovery('WAKE_UP');
      this.audio.chime();
      this.console.discovery = true;
      this.hud.setHint('<b>C</b> コンソールを開く　　<b>WASD</b> 探索');
      this.after(1.5, () => this.hud.say('脱出コマンド: WAKE_UP —— Cキーでコンソールを開く', 5));
    }
    if (!this._discovered && this._voidTime > 75) {
      this.hud.setHint('<b>C</b> コンソール（何かコマンドがあるかもしれない）');
    }
    if (ev.edge && this.time - this._edgeWarnAt > 6) {
      this._edgeWarnAt = this.time;
      this.hud.say('境界が青いノイズに溶けている。この先には何もない。', 3);
      this.postfx.triggerGlitch(0.4);
      this.audio.glitch(0.4);
    }
    if (input.pressed('KeyC')) this._openConsole();
  }

  _updateCollapse(dt) {
    const alive = this.collapseSeq.update(dt, this.time);
    if (!alive && this.state === STATE.COLLAPSE) {
      // onLandedで遷移済み
    }
  }

  _updateLanding(dt) {
    this._landT += dt;
    const t = Math.min(1, this._landT / 1.4);
    const k = smoothstep(0, 1, t);
    const y = lerp(this.landPos.y, 1.62, k) + Math.sin(t * Math.PI * 2) * 0.08 * (1 - t);
    this.camera.position.set(this.landPos.x, y, this.landPos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.x = lerp(-0.25, 0, k);
    this.camera.rotation.z = lerp(0.12, 0, k);
    this.camera.rotation.y = this.landYaw;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    this.update();
  }
}
