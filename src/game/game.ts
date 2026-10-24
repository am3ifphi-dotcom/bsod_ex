// Game orchestration: phases, input routing, interaction, restarts.
import * as THREE from 'three';
import { Engine } from '../core/engine';
import { Input } from '../core/input';
import { AudioEngine } from '../core/audio';
import { Physics } from '../core/physics';
import { AssetLoader } from '../core/assets';
import { settings } from '../core/settings';
import { clamp, damp, easeInOut, mulberry32 } from '../core/utils';
import { Player, Surface } from './player';
import { Room, Interactable } from './room';
import { World, WORLD_OFFSET } from './world';
import { Sequences } from './sequences';
import { UI } from './ui';
import { GameConsole } from './gameConsole';
import { MAX_STAGE } from './monitor';

export type Phase = 'boot' | 'room' | 'bsod' | 'consume' | 'world' | 'collapse' | 'epilogue';

const ROOM_FOG = null;
const WORLD_FOG = new THREE.FogExp2(0x0a1e42, 0.0128);

export class Game {
  engine: Engine;
  input: Input;
  audio = new AudioEngine();
  ui: UI;
  physics = new Physics();
  assets = new AssetLoader();
  player!: Player;
  room!: Room;
  world!: World;
  sequences!: Sequences;
  gameConsole!: GameConsole;
  phase: Phase = 'boot';

  private canvas: HTMLCanvasElement;
  private clock = new THREE.Clock();
  private target: Interactable | null = null;
  private lean = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 46 };
  private expectingUnlock = false;
  private glitchSpike = 0;
  private glitchBase = 0.04;
  private envRoom: THREE.Texture | null = null;
  private envWorld: THREE.Texture | null = null;
  private flashlight!: THREE.SpotLight;
  private flashOn = false;
  private raycaster = new THREE.Raycaster();
  private consumeTimer = -1;
  private perfTimer = 0;
  private debug = false;
  private time = 0;
  private started = false;
  private consoleOpenAt = 0;
  private secretNoticed = false;
  private hintShown = false;
  private titleShown = false;
  private restarting = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.ui = new UI();
  }

  // -------------------------------------------------------------------- boot
  async init() {
    this.debug = new URLSearchParams(location.search).has('debug')
      || localStorage.getItem('bsod_ex.debug') === '1';

    this.ui.handlers = {
      onStart: (reduce) => this.begin(reduce),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onSettingsChanged: () => this.applySettings(),
      onConsoleCommand: (line) => this.gameConsole.execute(line),
      onConsoleOpen: () => { this.player.setFrozen(true); this.input.lookEnabled = false; },
      onConsoleClose: () => {
        this.player.setFrozen(false);
        if (this.isGameplay()) this.input.lookEnabled = true;
        this.ui.setCursor(false);
        this.requestLock();
      },
    };
    this.ui.setUiSound((k) => this.audio.ui(k));

    // ---- load assets
    try {
      await this.assets.load((f, label) => this.ui.setBootProgress(f, label));
    } catch (err) {
      console.error(err);
      this.ui.showBootError(String((err as Error).message));
      return;
    }

    // ---- physics + world content
    await this.physics.init();
    this.room = new Room(this.assets, this.physics);
    this.world = new World(this.assets, this.physics);
    this.room.build();
    this.world.build();

    this.engine.scene.add(this.room.group);
    this.engine.scene.add(this.world.group);
    this.world.group.visible = false;

    this.player = new Player(this.physics, this.input, this.engine.camera);
    this.engine.scene.add(this.engine.camera);
    this.sequences = new Sequences({
      engine: this.engine, player: this.player, room: this.room,
      world: this.world, audio: this.audio, ui: this.ui, physics: this.physics,
    });
    this.sequences.setWorldFog(WORLD_FOG);

    this.buildFlashlight();
    this.gameConsole = new GameConsole(this.ui, this.audio, {
      onWakeUp: () => this.beginCollapse(),
      onGlitch: (a) => this.addGlitch(a),
      onCredits: () => this.ui.openCredits(),
      getReadSecret: () => this.world.wakeUpRead,
    });

    // ---- environments (IBL)
    this.envWorld = this.makeEnvironment('night', 0.55);
    this.envRoom = this.room.bakeEnvironment(this.engine.renderer, this.engine.scene);
    this.applyEnvironment('room');
    this.engine.scene.fog = ROOM_FOG;

    settings.onChange((_s, changed) => {
      if (changed.includes('quality')) this.onQualityChanged();
      else this.applySettings();
      if (changed.includes('volume')) this.audio.applyVolume();
    });
    this.canvas.addEventListener('click', () => {
      if (!this.isGameplay() || this.ui.menuOpen || this.ui.consoleOpen || this.ui.creditsOpen) return;
      if (this.sequences.active) return;
      if (!this.input.pointerLocked) this.requestLock();
    });
    this.bindInput();
    this.player.onFootstep = (s, run) => this.audio.footstep(s, run);
    this.player.teleport(this.room.spawn.pos, this.room.spawn.yaw, -0.02);
    this.applySettings();

    this.sequences.onApproachDone = () => this.enterBsod();
    this.sequences.onReturned = () => this.enterEpilogue();
    this.sequences.onFallStart = () => this.audio.startFallWind();
    this.sequences.onCollapseBegin = () => { this.glitchSpike = Math.max(this.glitchSpike, 0.4); };

    this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    this.ui.enableStart();
    this.updatePerfText();
  }

  private makeEnvironment(name: string, intensity: number) {
    const tex = this.assets.env(name);
    if (!tex) return null;
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    this.engine.scene.environmentIntensity = intensity;
    return env;
  }

  private applyEnvironment(which: 'room' | 'world') {
    const env = which === 'room' ? this.envRoom : this.envWorld;
    if (env) this.engine.scene.environment = env;
    this.engine.scene.environmentIntensity = which === 'room' ? 0.55 : 0.75;
  }

  private buildFlashlight() {
    this.flashlight = new THREE.SpotLight(0xdce8ff, 14, 30, 0.52, 0.55, 1.7);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.1;
    this.flashlight.shadow.camera.far = 30;
    this.flashlight.shadow.bias = -0.001;
    this.flashlight.position.set(0.12, -0.1, 0);
    this.flashlight.target.position.set(0.05, -0.05, -1);
    this.flashlight.visible = false;
    this.engine.camera.add(this.flashlight);
    this.engine.camera.add(this.flashlight.target);
  }

  // ------------------------------------------------------------------- input
  private bindInput() {
    this.input.onPointerLockLost = () => {
      if (this.expectingUnlock) { this.expectingUnlock = false; return; }
      if (this.ui.menuOpen || this.ui.consoleOpen || this.ui.creditsOpen) return;
      if (this.isGameplay() && !this.sequences.active) this.openMenu();
    };

    this.input.onDown('Escape', () => {
      if (this.ui.consoleOpen) { this.ui.closeConsole(); return; }
      if (this.ui.creditsOpen) { this.ui.closeCredits(); return; }
      if (this.ui.menuOpen) { this.resume(); return; }
      if (this.isGameplay()) this.openMenu();
    });
    this.input.onDown('F3', () => {
      const on = this.ui.togglePerf();
      if (on) this.updatePerfText(true);
    });
    this.input.onDown('KeyC', () => this.toggleConsole());
    this.input.onDown('KeyF', () => this.toggleFlashlight());
    this.input.onDown('KeyE', () => this.useTarget());
    this.input.onDown('KeyR', () => { if (this.debug) this.restart(); });

    this.input.onMouseDown((x, y, button) => {
      if (button !== 0) return;
      if (this.phase === 'bsod') { this.bsodClick(x, y); return; }
      if (this.isGameplay()) this.useTarget();
    });
    this.input.onMouse((x, y) => {
      if (this.phase === 'bsod') this.ui.setCursor(true, x, y);
    });

    if (this.debug) {
      const jump: Record<string, () => void> = {
        Digit1: () => this.jumpTo('room'),
        Digit2: () => this.jumpTo('bsod'),
        Digit3: () => this.jumpTo('consume'),
        Digit4: () => this.jumpTo('world'),
        Digit5: () => this.jumpTo('core'),
        Digit6: () => this.jumpTo('collapse'),
        Digit7: () => this.jumpTo('epilogue'),
      };
      for (const [k, fn] of Object.entries(jump)) this.input.onDown(k, fn);
    }
  }

  // ------------------------------------------------------------------ phases
  private isGameplay() {
    return this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue';
  }

  begin(reduce: boolean) {
    if (this.started) return;
    this.started = true;
    if (reduce) {
      settings.set({ shake: 0.25, glitch: 0.3 });
    }
    void this.audio.init().then(() => {
      this.audio.applyVolume();
      this.audio.startRoomAmbience();
    });
    this.input.lookEnabled = true;
    this.input.suspended = false;
    this.requestLock();
    this.phase = 'room';
    this.room.setPower(true);
    this.ui.setLetterbox(true);
    this.ui.chapter('CHAPTER I', '自室 / 23:58', 5600);
    this.ui.hint('WASD 移動 · E 調べる · Esc 設定');
    window.setTimeout(() => this.ui.hint(null), 9000);
    this.titleShown = true;
    this.clock.start();
  }

  private enterBsod() {
    this.phase = 'bsod';
    this.input.lookEnabled = false;
    this.input.suspended = false;
    this.lean.pos.copy(this.engine.camera.position);
    this.lean.yaw = this.player.yaw;
    this.lean.pitch = this.player.pitch;
    this.lean.fov = this.engine.camera.fov;
    this.expectingUnlock = true;
    this.input.releaseLock();
    this.ui.setCursor(true, window.innerWidth / 2, window.innerHeight / 2);
    this.ui.showClickHint(true);
    this.ui.showPrompt(null);
    this.ui.setLetterbox(true);
    this.consumeTimer = -1;
  }

  private bsodClick(x: number, y: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hit = this.raycaster.intersectObject(this.room.screen, false)[0];
    if (!hit || !hit.uv) {
      return;
    }
    const u = hit.uv.x;
    const v = 1 - hit.uv.y;
    const stage = this.room.monitorScreen.click(u, v);
    if (stage < 0) {
      // clicked the screen but missed the glyph
      this.audio.ui('hover');
      return;
    }
    this.audio.bsodClick(stage);
    this.glitchSpike = Math.max(this.glitchSpike, 0.15 + stage * 0.14);
    if (stage >= 2) this.audio.glitchBurst(stage / 5);
    if (stage >= 3) this.audio.tear();
    if (stage >= MAX_STAGE && this.consumeTimer < 0) {
      this.consumeTimer = 1.6;
      this.ui.showClickHint(false);
    }
  }

  private beginCollapse() {
    if (this.phase !== 'world') return;
    this.phase = 'collapse';
    this.ui.closeConsole();
    this.input.suspended = true;
    this.input.lookEnabled = false;
    this.ui.showPrompt(null);
    this.ui.setLetterbox(true);
    this.sequences.startCollapse();
  }

  private enterWorld() {
    this.phase = 'world';
    this.player.setFrozen(false);
    this.input.suspended = false;
    this.input.lookEnabled = true;
    this.applyEnvironment('world');
    this.engine.scene.fog = WORLD_FOG;
    this.room.group.visible = false;
    this.world.group.visible = true;
    this.ui.setLetterbox(true);
    this.ui.hint('C キー: リカバリコンソール · F キー: ライト');
    window.setTimeout(() => this.ui.hint(null), 11000);
    this.requestLock();
  }

  private enterEpilogue() {
    this.phase = 'epilogue';
    this.player.setFrozen(false);
    this.input.suspended = false;
    this.input.lookEnabled = true;
    this.applyEnvironment('room');
    this.engine.scene.fog = ROOM_FOG;
    this.world.group.visible = false;
    this.room.group.visible = true;
    this.sequences.clearDebris();
    this.ui.setLetterbox(true);
    this.ui.toast('…自分の部屋だ。何かが違う。', 4200);
    window.setTimeout(() => this.ui.toast('Esc メニューから最初からやり直せます。', 4200), 5200);
    this.requestLock();
  }

  private requestLock() {
    if (this.ui.consoleOpen || this.ui.menuOpen || this.ui.creditsOpen) return;
    if (!this.isGameplay()) return;
    this.input.requestLock();
  }

  // ------------------------------------------------------------------- menus
  openMenu() {
    if (this.phase === 'boot') return;
    this.input.suspended = true;
    this.input.lookEnabled = false;
    this.expectingUnlock = true;
    this.input.releaseLock();
    this.ui.openMenu(this.phaseLabel());
    if (this.phase !== 'bsod') this.player.setFrozen(true);
  }

  resume() {
    this.ui.closeMenu();
    if (this.phase === 'bsod') {
      this.input.suspended = false;
      this.input.lookEnabled = false;
      this.ui.setCursor(true, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    this.input.suspended = false;
    this.input.lookEnabled = this.isGameplay();
    this.player.setFrozen(!this.isGameplay());
    this.requestLock();
    if (this.audio.ready) this.audio.resume();
  }

  private phaseLabel() {
    switch (this.phase) {
      case 'room': return 'CHAPTER I — 自室';
      case 'bsod': return 'SYSTEM FAILURE';
      case 'world': return 'CHAPTER II — 記憶領域';
      case 'collapse': return 'COLLAPSE';
      case 'epilogue': return 'CHAPTER III — 帰還';
      default: return '';
    }
  }

  toggleConsole() {
    if (this.phase !== 'world') return;
    if (this.ui.consoleOpen) { this.ui.closeConsole(); return; }
    this.input.lookEnabled = false;
    this.expectingUnlock = true;
    this.input.releaseLock();
    this.ui.openConsole();
  }

  toggleFlashlight() {
    if (!this.isGameplay() || this.phase === 'room') return;
    this.flashOn = !this.flashOn;
    this.flashlight.visible = this.flashOn;
    this.audio.ui('click');
  }

  // -------------------------------------------------------------- interaction
  private useTarget() {
    if (!this.isGameplay() || this.sequences.active) return;
    const t = this.target;
    if (!t) return;
    if (t.id === 'pc') {
      this.input.lookEnabled = false;
      this.ui.showPrompt(null);
      this.sequences.startApproach();
      this.phase = 'room';
      return;
    }
    t.onUse();
    switch (t.id) {
      case 'lamp':
        this.ui.toast(this.room.lampIsOn ? 'デスクライトをつけた' : 'デスクライトを消した', 1600);
        this.audio.ui('click');
        break;
      case 'blinds':
        this.ui.toast(this.room.blindsAreOpen ? 'ブラインドを開けた' : 'ブラインドを閉じた', 1600);
        this.audio.ui('click');
        break;
      case 'poster':
        this.ui.toast('「NO SIGNAL」— the machine dreams of a room you have never left.', 5200);
        break;
      case 'clock':
        this.ui.toast('23:58。秒針は止まっている。', 3600);
        break;
      case 'door':
        this.ui.toast('鍵がかかっている。開かない。', 3000);
        break;
      case 'wakeup':
        this.readSecret();
        break;
      default:
        break;
    }
  }

  private readSecret() {
    if (this.world.wakeUpRead) return;
    this.world.wakeUpRead = true;
    this.audio.ui('open');
    this.audio.glitchBurst(0.35);
    this.ui.toast('WAKE_UP — 世界の秘密。コマンドの形をしている。', 6200);
    this.glitchSpike = Math.max(this.glitchSpike, 0.3);
  }

  private scanInteractions() {
    const pool: Interactable[] = this.phase === 'world'
      ? this.world.interactables.map((i) => ({
        id: i.id, label: i.label, position: i.position, radius: i.radius, enabled: true, onUse: i.onUse,
      }))
      : this.room.interactables;
    const origin = this.engine.camera.position;
    const dir = new THREE.Vector3();
    this.engine.camera.getWorldDirection(dir);
    let best: Interactable | null = null;
    let bestDot = 0.55;
    for (const it of pool) {
      if (!it.enabled) continue;
      const to = it.position.clone().sub(origin);
      const dist = to.length();
      if (dist > it.radius) continue;
      const dot = to.normalize().dot(dir);
      if (dot < bestDot) continue;
      // nearer & more centred wins
      const score = dot - dist * 0.02;
      if (score > bestDot) { best = it; bestDot = score; }
      if (!best) best = it;
    }
    if (best !== this.target) {
      this.target = best;
      this.ui.showPrompt(best ? best.label : null);
    }
  }

  // ------------------------------------------------------------------ update
  update() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    if (this.phase === 'boot') { this.engine.render(dt); return; }

    // ---- tick sequences
    if (this.sequences.active) {
      this.sequences.update(dt);
      if (this.phase === 'consume' && !this.sequences.active) this.enterWorld();
      if (this.phase === 'collapse' && !this.sequences.active) { /* handled by callback */ }
      if (this.phase === 'room' && this.sequences.mode === 'approach') { /* still approaching */ }
      if (this.phase === 'bsod' && this.sequences.mode === 'consume') this.phase = 'consume';
    }

    // ---- room / world simulation
    this.room.update(dt, this.engine.fx.uGlitch.value);

    if (this.isGameplay() && !this.sequences.active) {
      this.player.surface = this.phase === 'room'
        ? (this.player.feet.z > 0.9 ? 'wood' : 'carpet')
        : this.world.surfaceAt(this.player.feet);
      this.player.update(dt);
      this.scanInteractions();
    } else if (this.phase === 'bsod') {
      this.updateLeanCamera(dt);
      this.scanInteractions();
    }

    if (this.phase === 'world' || this.phase === 'collapse') {
      this.world.update(dt, this.player.feet, this.engine.fx.uGlitch.value);
      if (this.phase === 'world') this.checkSecret();
    }

    // ---- glitch budget
    this.updateGlitch(dt);

    // ---- console / menu state
    if (this.consumeTimer > 0) {
      this.consumeTimer -= dt;
      if (this.consumeTimer <= 0) {
        this.consumeTimer = -1;
        this.phase = 'consume';
        this.input.suspended = true;
        this.sequences.startConsume();
      }
    }
    if (this.phase === 'epilogue' && !this.room.epilogueActive) this.room.setEpilogue(true);

    this.audio.update(dt, this.engine.camera);
    this.engine.render(dt);
    this.perfTimer += dt;
    if (this.perfTimer > 0.35) { this.perfTimer = 0; this.updatePerfText(); }
  }

  private updateLeanCamera(dt: number) {
    // hold the leaning pose with a breathing sway (no player control)
    const t = this.time;
    const cam = this.engine.camera;
    cam.position.copy(this.lean.pos);
    cam.position.y += Math.sin(t * 1.2) * 0.0035;
    cam.position.x += Math.sin(t * 0.7 + 1.3) * 0.0022;
    const e = new THREE.Euler(
      this.lean.pitch + Math.sin(t * 1.05) * 0.0035 + (this.room.monitorScreen.corruption > 0.4 ? Math.sin(t * 21) * 0.0016 : 0),
      this.lean.yaw + Math.cos(t * 0.83) * 0.003,
      -0.055 + Math.sin(t * 0.9) * 0.004,
      'YXZ',
    );
    cam.quaternion.setFromEuler(e);
    cam.fov = damp(cam.fov, this.lean.fov + Math.sin(t * 0.6) * 0.4, 4, dt);
    cam.updateProjectionMatrix();
    this.engine.setBokehFocus(0.5, 0.0035, 0.02);
  }

  private checkSecret() {
    const p = this.player.feet;
    const d = p.distanceTo(this.world.wakeUpPoint);
    if (d < 12 && !this.world.wakeUpRead && !this.secretNoticed) {
      this.secretNoticed = true;
      this.readSecret();
    }
    if (d < 40 && !this.hintShown) {
      this.hintShown = true;
      this.ui.hint('C キー: リカバリコンソール');
      window.setTimeout(() => this.ui.hint(null), 8000);
    }
  }

  private updateGlitch(dt: number) {
    const st = settings.value;
    this.glitchSpike = Math.max(0, this.glitchSpike - dt * 0.55);
    const base = this.phase === 'world' || this.phase === 'collapse'
      ? 0.035 + Math.sin(this.time * 0.7) * 0.02 + Math.max(0, Math.sin(this.time * 0.13)) * 0.03
      : this.phase === 'bsod'
        ? this.room.monitorScreen.corruption * 0.75
        : 0.0;
    const target = clamp((base + this.glitchSpike) * st.glitch, 0, 1.4);
    const fx = this.engine.fx;
    fx.uGlitch.value = damp(fx.uGlitch.value, this.sequences.active ? Math.max(fx.uGlitch.value, target * 0.4) : target, 6, dt);
    fx.uChroma.value = fx.uGlitch.value * 0.55;
    fx.uScan.value = 0.45 + fx.uGlitch.value * 0.4;
    fx.uGrain.value = 0.045 + fx.uGlitch.value * 0.03;
    if (this.phase === 'collapse') fx.uGlitch.value = Math.max(fx.uGlitch.value, this.sequences.mode === 'return' ? 0.25 : 0.35);
  }

  private addGlitch(a: number) {
    this.glitchSpike = Math.min(1.2, this.glitchSpike + a);
    this.audio.glitchBurst(clamp(a, 0.2, 1));
  }

  // -------------------------------------------------------------- perf / fx
  private updatePerfText(force = false) {
    if (!force && !this.ui.perfVisible()) return;
    const s = this.engine.stats;
    const info = this.engine.info();
    const res = this.engine.resolution;
    this.ui.setPerfText(
      `FPS ${s.fps.toFixed(1)}   1% low ${s.low1.toFixed(1)}   frame ${s.ms.toFixed(2)}ms\n` +
      `draw calls ${info.calls}   tris ${(info.tris / 1000).toFixed(0)}k   geo ${info.geoms}   tex ${info.textures}\n` +
      `render ${(res.scale * 100).toFixed(0)}%  (${Math.round(res.w)}x${Math.round(res.h)})   quality ${settings.value.quality}\n` +
      `phase ${this.phase}   glitch ${this.engine.fx.uGlitch.value.toFixed(2)}   audio ${this.audio.ready ? 'on' : 'off'}`,
    );
  }

  applySettings() {
    this.engine.setRenderScale(settings.value.resScale, !settings.value.dynamicRes);
    this.audio.applyVolume();
  }

  onQualityChanged() {
    this.engine.applyQuality();
    if (this.phase === 'room' || this.phase === 'epilogue') this.applyEnvironment('room');
    else this.applyEnvironment('world');
  }

  // ----------------------------------------------------------------- restart
  restart() {
    if (this.restarting) return;
    this.restarting = true;
    this.ui.closeMenu();
    this.sequences.reset();
    this.physics.clearDynamics();
    this.room.monitorScreen.reset();
    this.room.setPower(true);
    this.room.setEpilogue(false);
    this.world.wakeUpRead = false;
    this.gameConsole.reset();
    this.secretNoticed = false;
    this.hintShown = false;
    this.consumeTimer = -1;
    this.glitchSpike = 0;
    this.engine.fx.uGlitch.value = 0;
    this.phase = 'room';
    this.room.group.visible = true;
    this.world.group.visible = false;
    this.engine.scene.fog = ROOM_FOG;
    this.applyEnvironment('room');
    this.engine.setBokehEnabled(false);
    this.sequences.onFallStart = () => this.audio.startFallWind();
    this.player.reset(this.room.spawn.pos.clone().setY(0.02), this.room.spawn.yaw, -0.02);
    this.input.suspended = false;
    this.input.lookEnabled = true;
    this.ui.setLetterbox(true);
    this.ui.showPrompt(null);
    this.ui.hint(null);
    this.ui.chapter('CHAPTER I', '自室 / 23:58', 4600);
    this.audio.stopWorldAmbience();
    this.audio.startRoomAmbience();
    this.requestLock();
    this.restarting = false;
  }

  // -------------------------------------------------------------- debug jumps
  jumpTo(where: 'room' | 'bsod' | 'consume' | 'world' | 'core' | 'collapse' | 'epilogue') {
    if (!this.debug) return;
    this.ui.closeMenu();
    this.sequences.reset();
    this.physics.clearDynamics();
    this.input.suspended = false;
    switch (where) {
      case 'room':
        this.restart();
        break;
      case 'bsod': {
        this.phase = 'room';
        this.room.group.visible = true;
        this.world.group.visible = false;
        this.applyEnvironment('room');
        this.engine.scene.fog = ROOM_FOG;
        this.player.teleport(new THREE.Vector3(0.1, 0.02, -0.6), 0, -0.05);
        this.sequences.startApproach();
        break;
      }
      case 'consume': {
        this.phase = 'consume';
        this.room.monitorScreen.clicks = 25;
        this.room.monitorScreen.stage = 5;
        this.room.monitorScreen.corruption = 1;
        this.room.group.visible = true;
        this.world.group.visible = false;
        this.enterBsod();
        this.sequences.startConsume();
        break;
      }
      case 'world': {
        this.phase = 'world';
        this.room.group.visible = false;
        this.world.group.visible = true;
        this.applyEnvironment('world');
        this.engine.scene.fog = WORLD_FOG;
        this.player.teleport(this.world.spawn.pos.clone().setY(this.world.spawn.pos.y + 0.1), 0, 0);
        this.audio.startWorldAmbience();
        this.ui.setLetterbox(true);
        break;
      }
      case 'core': {
        this.phase = 'world';
        this.room.group.visible = false;
        this.world.group.visible = true;
        this.applyEnvironment('world');
        this.engine.scene.fog = WORLD_FOG;
        this.player.teleport(new THREE.Vector3(0, 0.6, 16).add(WORLD_OFFSET), 0, 0.1);
        this.audio.startWorldAmbience();
        break;
      }
      case 'collapse': {
        this.phase = 'world';
        this.room.group.visible = false;
        this.world.group.visible = true;
        this.applyEnvironment('world');
        this.engine.scene.fog = WORLD_FOG;
        this.player.teleport(new THREE.Vector3(0, 0.6, 16).add(WORLD_OFFSET), 0, 0.1);
        this.beginCollapse();
        break;
      }
      case 'epilogue': {
        this.phase = 'epilogue';
        this.room.group.visible = true;
        this.world.group.visible = false;
        this.applyEnvironment('room');
        this.engine.scene.fog = ROOM_FOG;
        this.room.setEpilogue(true);
        this.room.setPower(false);
        this.player.teleport(new THREE.Vector3(0.12, 0.02, 0.95), 0.06, -0.1);
        break;
      }
    }
    this.ui.closeConsole();
    if (this.isGameplay()) this.requestLock();
  }

  // ------------------------------------------------------------------ helpers
  get isDebug() { return this.debug; }
}
