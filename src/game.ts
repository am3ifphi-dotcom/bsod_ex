import * as THREE from 'three';
import { Fx, type Quality } from './core/fx';
import { Assets } from './core/assets';
import { AudioEngine } from './core/audio';
import { Input } from './core/input';
import { Player, PhysicsWorld } from './core/physics';
import { Room, type Interactable } from './scenes/room';
import { World, terrainHeight } from './scenes/world';
import { UI, type Settings } from './ui/ui';
import { CollapseSequence, ZoomSequence, AbsorbSequence, type Sequence } from './sequences';
import { clamp, lerp, smoothstep } from './core/util';
import { setGlitch, glitchUniforms } from './core/glitch';
import type { Phase } from './types';

const BSOD_CLICKS = 7;
const ROOM_SPAWN = new THREE.Vector3(0, 0, 1.95);

export class Game {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  fx: Fx;
  assets: Assets;
  audio = new AudioEngine();
  input: Input;
  ui: UI;
  player = new Player();
  roomPhysics = new PhysicsWorld();
  room!: Room;
  world!: World;
  phase: Phase = 'boot';
  sequence: Sequence | null = null;
  settings: Settings;
  bsodStage = 0;
  flashlight!: THREE.SpotLight;
  flashlightOn = false;
  private clock = new THREE.Clock();
  time = 0;
  private fpsFrames: number[] = [];
  private allFrameTimes: number[] = [];
  private lastPerf = 0;
  private lastInteractable: Interactable | null = null;
  private bsodIdle = 0;
  private worldTime = 0;
  private hintShown = false;
  private wakeShown = false;
  private monolithLine = false;
  private intentionalUnlock = false;
  private lockGraceUntil = 0;
  private started = false;
  private paused = false;
  private roomEnv?: THREE.Texture;
  private debug = false;
  private debugPhase?: Phase;
  private benchMode = false;
  private timeScale = 1;
  private noFx = false;
  private frameCount = 0;
  private manualRender = false;
  private lastPhase: Phase = 'boot';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const params = new URLSearchParams(location.search);
    this.debug = params.get('debug') === '1';
    this.debugPhase = (params.get('phase') as Phase) || undefined;
    this.benchMode = params.get('bench') === '1';
    this.timeScale = params.get('fast') ? 3 : 1;
    this.noFx = params.get('nofx') === '1';
    if (params.get('direct') === '1') (window as any).__DIRECT__ = true;
    this.manualRender = params.get('manual') === '1';

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // we reset stats manually once per frame so the F3 HUD shows the real total
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 620);
    this.camera.position.set(0, 1.62, 2);
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color(0x010208);

    this.assets = new Assets(this.renderer);
    this.fx = new Fx(this.renderer, this.scene, this.camera);
    this.input = new Input(canvas);

    this.ui = new UI({
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onSettings: (s, changed) => this.applySettings(changed),
      onConsoleOpen: () => {
        this.player.enabled = false;
        this.input.mode = 'ui';
        this.intentionalUnlock = true;
        this.input.releaseLock();
        this.ui.setPrompt(null);
      },
      onConsoleClose: () => {
        this.input.mode = 'play';
        this.lockGraceUntil = performance.now() + 1200;
        this.intentionalUnlock = true;
        if (this.phase === 'world') {
          this.input.requestLock();
          this.player.enabled = true;
        }
      },
      onConsoleCommand: (cmd) => this.handleConsoleCommand(cmd),
      onResumeOverlay: () => {
        this.ui.hideResume();
        this.input.requestLock();
      },
    });
    this.settings = this.ui.settings;

    this.createFlashlight();
    this.bindInput();
    if (params.get('quality')) this.ui.settings.quality = params.get('quality') as Quality;
    this.fx.setQuality(this.settings.quality);
    this.fx.dynamic = this.settings.dynamic;
    this.applySettings('quality');
    if (this.noFx) {
      this.fx.bloom!.enabled = false;
      this.fx.gtao!.enabled = false;
      this.renderer.shadowMap.enabled = false;
      this.fx.setQuality('low');
    }

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.fx.resize();
    });

    (window as any).__BSOD_ASSETS__ = this.assets;
    (window as any).__BSOD_GAME__ = this;
    this.exposeDebugApi();
  }

  private createFlashlight() {
    this.flashlight = new THREE.SpotLight(0xdde9ff, 26, 18, 0.5, 0.65, 1.5);
    this.flashlight.position.set(0.12, -0.12, 0);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.bias = -0.002;
    this.flashlight.shadow.normalBias = 0.02;
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 18;
    const target = new THREE.Object3D();
    target.position.set(0, 0, -1);
    this.camera.add(this.flashlight);
    this.camera.add(target);
    this.flashlight.target = target;
    this.flashlight.visible = false;
  }

  private bindInput() {
    this.input.onKeyDown = (code) => {
      if (this.ui.consoleVisible) return true; // console owns the keyboard
      if (code === 'F3') {
        this.ui.togglePerf();
        return true;
      }
      if (this.ui.menuVisible) {
        if (code === 'Escape') {
          this.ui.closeMenu();
          this.resume();
          return true;
        }
        return true;
      }
      if (code === 'Escape') {
        if (this.sequence) return true;
        // the console consumes its own Escape (it closes there, not here)
        if (this.ui.consoleVisible) return true;
        if (this.ui.menuVisible) return true;
        if (this.phase === 'bsod' || this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue') {
          this.openMenu();
          return true;
        }
        return true;
      }
      if (code === 'KeyF' && (this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue')) {
        this.toggleFlashlight();
        return true;
      }
      if (code === 'KeyC') {
        if (this.phase === 'world' && !this.sequence) {
          if (this.ui.consoleVisible) this.ui.closeConsole();
          else this.openConsole();
        } else if (this.phase === 'room' || this.phase === 'epilogue') {
          this.ui.toast('ここではコンソールに接続できない。');
        }
        return true;
      }
      if (code === 'KeyE' && !this.sequence && (this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue')) {
        this.useInteractable();
        return true;
      }
      if (this.debug && code === 'F9') {
        this.debugJump(1);
        return true;
      }
      return false;
    };

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.ui.hideResume();
        return;
      }
      // ignore the lock loss caused by our own console/menu/cinematic handling
      if (performance.now() < this.lockGraceUntil) {
        this.ui.hideResume();
        return;
      }
      if (this.intentionalUnlock) {
        this.intentionalUnlock = false;
        return;
      }
      if (this.ui.menuVisible || this.ui.consoleVisible || this.sequence) return;
      if (this.phase === 'bsod') return;
      if (this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue') {
        this.openMenu();
      }
    };

    this.canvas.addEventListener('click', () => {
      if (!this.started || this.ui.menuVisible || this.ui.consoleVisible) return;
      if (this.phase === 'bsod') return; // handled by the BSOD click path
      if (!this.input.locked && !this.sequence && (this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue')) {
        this.lockGraceUntil = performance.now() + 1200;
        this.input.requestLock();
      }
    });
  }

  async init() {
    const setStatus = (txt: string) => this.ui.setLoading(txt);
    setStatus('MEMORY を読み込み中…');
    await this.assets.load((n, total) => {
      setStatus(`ASSETS ${n}/${total}`);
    });
    setStatus('ROOM.BAK を再構成中…');
    this.room = new Room(this.assets).build();
    this.setupRoomPhysics();
    this.room.group.visible = false;
    this.scene.add(this.room.group);
    // bake a reflection probe for the room (monitor light bounces)
    setStatus('反射プローブを焼成中…');
    this.room.group.visible = true;
    this.scene.environment = this.assets.env('apartment') ?? null;
    this.room.bakeProbe(this.renderer, this.scene, 0.34);
    this.roomEnv = this.scene.environment ?? undefined;
    this.room.group.visible = false;

    setStatus('BSOD WORLD を構築中…');
    this.world = new World(this.assets).build();
    this.world.group.visible = false;
    this.scene.add(this.world.group);

    this.player.events.onFootstep = (kind, strength) => this.audio.footstep(kind, strength);
    this.player.events.onLand = (s) => this.audio.footstep(this.phase === 'epilogue' ? 'wood' : 'shard', 1.3 * s);
    this.ui.setLoading('READY');
    setTimeout(() => this.ui.hideLoadingVeil(), 150);

    if (this.debugPhase) {
      this.started = true;
      setTimeout(() => {
        this.ui.hideTitle();
        this.jumpTo(this.debugPhase!);
      }, 350);
    } else {
      this.showTitleScene();
    }
    this.loop();
  }

  /** a slow, dark camera drift behind the title screen */
  private showTitleScene() {
    this.room.group.visible = true;
    this.world.group.visible = false;
    this.scene.environment = this.roomEnv ?? null;
    this.scene.fog = null;
    this.camera.position.set(0.4, 1.7, 2.5);
    this.camera.quaternion.setFromEuler(new THREE.Euler(-0.05, 0.2, 0, 'YXZ'));
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.room.drawScreen('off');
    this.room.monitorLight.intensity = 6.4;
    this.fx.setFocus(2.6, 7, 0.4);
    this.fx.glitch = 0.06;
  }

  start() {
    if (this.started && this.phase !== 'boot') return;
    this.started = true;
    this.audio.init().then(() => {
      this.audio.setVolume(this.settings.volume);
      this.audio.startRoomAmbience();
      this.audio.uiBus.gain.value = 0.5 * this.settings.volume;
    });
    this.ui.hideTitle();
    this.ui.hideResume();
    this.restart(true);
    this.input.requestLock();
  }

  resume() {
    this.ui.closeMenu();
    this.lockGraceUntil = performance.now() + 1200;
    if (!this.sequence) {
      this.input.mode = 'play';
      this.player.enabled = this.phase === 'room' || this.phase === 'world' || this.phase === 'epilogue';
      if (this.phase !== 'bsod') this.input.requestLock();
    }
  }

  openMenu() {
    if (this.sequence) return;
    this.lockGraceUntil = performance.now() + 1200;
    this.ui.openMenu();
    this.player.enabled = false;
    this.input.mode = 'ui';
    this.intentionalUnlock = true;
    this.input.releaseLock();
    this.ui.setPrompt(null);
  }

  restart(fromStart = false) {
    this.sequence = null;
    this.phase = 'room';
    this.worldTime = 0;
    this.hintShown = false;
    this.wakeShown = false;
    this.monolithLine = false;
    this.bsodStage = 0;
    this.bsodIdle = 0;
    this.flashlightOn = false;
    this.flashlight.visible = false;
    this.player.reset(ROOM_SPAWN.clone(), 0.02, -0.03);
    this.player.surface = 'wood';
    this.room.setEpilogue(false);
    this.room.screenStage = 0;
    this.room.drawScreen('off');
    this.room.epilogueGroup.visible = false;
    this.world.clearDynamic();
    this.world.monolithSeen = false;
    this.world.consoleHintSeen = false;
    this.showRoom();
    this.fx.setFade(0);
    this.fx.setIris(0, false);
    this.fx.setLens(0);
    this.fx.flash(0);
    this.fx.setFocus(3.2, 8, 0.32);
    setGlitch(0, 0);
    this.fx.glitch = 0;
    this.audio.stopWorldAmbience();
    this.audio.startRoomAmbience();
    this.audio.clearSpatial();
    this.ui.clearSubtitle();
    this.ui.setPrompt(null);
    this.ui.hideResume();
    if (!fromStart) this.input.requestLock();
    this.input.mode = 'play';
    this.player.enabled = true;
    this.ui.chapter('00 — 自室 / 03:33');
    this.ui.subtitle('午前3時33分。部屋には、モニターの青い光だけがある。', '', 6);
    this.ui.toast('WASD 移動 / マウス 視点 / E 調べる', 5);
  }

  showRoom() {
    this.room.group.visible = true;
    this.world.group.visible = false;
    this.scene.environment = this.roomEnv ?? null;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x01030a);
  }

  showWorld() {
    this.room.group.visible = false;
    this.world.group.visible = true;
    this.scene.environment = this.assets.env('night') ?? null;
    this.scene.environmentIntensity = 1.0;
    this.scene.fog = new THREE.FogExp2(0x050a18, 0.0032);
    this.scene.background = new THREE.Color(0x03060f);
  }

  beginCinematic() {
    this.input.mode = 'cinematic';
    this.player.enabled = false;
    this.ui.setPrompt(null);
    this.ui.hideChapter();
  }

  endCinematic(phase: Phase) {
    this.setPhase(phase);
    this.lockGraceUntil = performance.now() + 1500;
    this.input.mode = 'play';
    this.player.enabled = true;
    if (!this.ui.menuVisible && !this.ui.consoleVisible) this.input.requestLock();
  }

  setPhase(p: Phase) {
    this.lastPhase = this.phase;
    this.phase = p;
  }

  setGlitch(geom: number, post: number) {
    const s = this.settings.glitch;
    setGlitch(clamp(geom * s), clamp(0.4 * geom * s + post * s * 0.6));
    this.fx.glitch = clamp(0.15 * geom * s + post * s * 0.55);
  }

  enterBsod() {
    this.phase = 'bsod';
    this.sequence = null;
    this.bsodStage = 0;
    this.bsodIdle = 0;
    this.input.mode = 'ui';
    this.player.enabled = false;
    this.intentionalUnlock = true;
    this.input.releaseLock();
    this.room.drawScreen('bsod', 0);
    this.room.screenStage = 0;
    this.fx.setFocus(0.95, 0.72, 0.85);
    this.fx.glitch = 0;
    this.ui.setPrompt(null);
    this.canvas.style.cursor = 'crosshair';
    this.ui.toast('画面の「:(」をクリック', 6);
    this.audio.whisper(0.03);
  }

  private handleBsodClick() {
    if (this.phase !== 'bsod' || this.sequence) return;
    const hit = this.raycastScreen();
    if (!hit) {
      (this as any).bsodMisses = ((this as any).bsodMisses ?? 0) + 1;
      this.audio.click('soft');
      this.fx.glitch = 0.06;
      return;
    }
    this.bsodStage = Math.min(BSOD_CLICKS, this.bsodStage + 1);
    this.room.setScreenStage(this.bsodStage);
    this.room.screenStage = this.bsodStage;
    this.audio.glitchBurst(0.5 + this.bsodStage * 0.12);
    this.audio.keyboardClick();
    this.fx.flash(0.06 + this.bsodStage * 0.02);
    const k = this.bsodStage / BSOD_CLICKS;
    setGlitch(0.02 + k * 0.55, 0.12 + k * 0.6);
    this.room.monitorLight.intensity = 8 + k * 5;
    this.room.monitorSpill.intensity = 3.2 + k * 2.4;
    this.audio.whisper(0.02 + k * 0.04);
    if (this.bsodStage >= 3) this.room.moonLight.intensity = 9 + Math.sin(this.time * 3) * k * 2;
    if (this.bsodStage >= BSOD_CLICKS) {
      this.canvas.style.cursor = 'none';
      this.sequence = new AbsorbSequence(this);
      this.setPhase('absorb');
      this.ui.setPrompt(null);
      this.ui.clearSubtitle();
    }
  }

  private raycastScreen() {
    this.room.group.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.input.mouseNDC, this.camera);
    const hits = ray.intersectObject(this.room.screenMesh, false);
    if (!hits.length) return null;
    const uv = hits[0].uv;
    if (!uv) return null;
    const v = 1 - uv.y;
    const r = this.room.faceRegion;
    const onFace = uv.x >= r.x0 && uv.x <= r.x1 && v >= r.y0 && v <= r.y1;
    if (onFace) return hits[0];
    // after the first click the whole panel is unstable: accept clicks anywhere on it
    if (this.bsodStage >= 1) return hits[0];
    // never let the player get stuck: a patient hand always gets through
    if (((this as any).bsodMisses ?? 0) > 14) return hits[0];
    return null;
  }

  openConsole() {
    if (this.phase !== 'world' || this.sequence) return;
    this.input.mode = 'ui';
    this.player.enabled = false;
    this.intentionalUnlock = true;
    this.lockGraceUntil = performance.now() + 1200;
    this.input.releaseLock();
    this.ui.openConsole();
    this.ui.consoleClear();
    this.ui.consoleLog('RECOVERY_CONSOLE v0.3.3', 'sys');
    this.ui.consoleLog('MEMORY MOUNT: /dev/room (read-only)', 'sys');
    this.ui.consoleLog('接続されました。HELP でコマンド一覧。', 'sys');
    this.audio.click('mech');
  }

  handleConsoleCommand(raw: string) {
    const q = raw.trim();
    const cmd = q.toUpperCase().replace(/\s+/g, ' ');
    this.ui.consoleLog(`> ${q}`, 'cmd');
    if (!q) {
      this.audio.errorTone();
      this.ui.consoleLog('ERR_EMPTY_INPUT 0x00000000 — 何も入力されていません。', 'err');
      return;
    }
    if (cmd === 'WAKE_UP') {
      this.audio.chime(880, 0.08);
      this.ui.consoleLog('RECOVERY SEQUENCE ACCEPTED.', 'ok');
      this.ui.consoleLog('DO NOT LOOK DOWN.', 'warn');
      this.ui.closeConsole();
      this.intentionalUnlock = true;
      this.input.mode = 'cinematic';
      this.player.enabled = false;
      this.ui.setPrompt(null);
      this.setPhase('collapse');
      this.sequence = new CollapseSequence(this);
      return;
    }
    if (cmd === 'CLEAR' || cmd === 'CLS') {
      this.ui.consoleClear();
      this.audio.click();
      return;
    }
    if (cmd === 'EXIT' || cmd === 'QUIT' || cmd === 'CLOSE') {
      this.ui.closeConsole();
      return;
    }
    if (cmd === 'HELP' || cmd === '?') {
      this.ui.consoleLog('KNOWN NODES:', 'sys');
      this.ui.consoleLog('  HELP  STATUS  DIR  SYSINFO  WHOAMI  TRACE  SCAN', 'sys');
      this.ui.consoleLog('  CLEAR  EXIT  OPEN  PING  FORMAT', 'sys');
      this.ui.consoleLog('  (recovery word is not stored in this console)', 'warn');
      return;
    }
    if (cmd === 'STATUS') {
      this.ui.consoleLog('SECTOR: BSOD_WORLD', 'sys');
      this.ui.consoleLog('MEMORY INTEGRITY: 41% — DEGRADING', 'warn');
      this.ui.consoleLog('EXIT CONDITION: UNKNOWN', 'err');
      this.ui.consoleLog('NOTE: THE MONOLITH REMEMBERS THE WORD.', 'sys');
      return;
    }
    if (cmd === 'DIR' || cmd === 'LS') {
      this.ui.consoleLog('/dev/room/  ROOM.BAK  03:33', 'sys');
      this.ui.consoleLog('/mem/lost/  CORE.DMP  FACE.IMG  WAKE.LOG (locked)', 'sys');
      this.ui.consoleLog('1 locked file. access denied.', 'err');
      return;
    }
    if (cmd === 'WHOAMI') {
      this.ui.consoleLog('you (guest) — process id 0x1A77', 'ok');
      return;
    }
    if (cmd === 'SYSINFO') {
      this.ui.consoleLog('HOST: SUBJECT-ROOM', 'sys');
      this.ui.consoleLog('UPTIME: 03:33:07 (paused)', 'sys');
      this.ui.consoleLog('INPUT DEVICE: your hands', 'sys');
      return;
    }
    if (cmd === 'PING') {
      this.ui.consoleLog('PING monolith.bsod (0.0.0.0): 56 data bytes', 'sys');
      this.ui.consoleLog('64 bytes: seq=0 time=3330 ms', 'warn');
      this.ui.consoleLog('64 bytes: seq=1 time=??? ms', 'warn');
      this.ui.consoleLog('--- 100% packet loss — something answered ---', 'err');
      this.audio.errorTone();
      return;
    }
    if (cmd === 'TRACE' || cmd === 'SCAN') {
      this.ui.consoleLog('SCANNING...', 'sys');
      this.ui.consoleLog('  3 signatures: ROOM, FACE, MONOLITH', 'sys');
      this.ui.consoleLog('  the third one is warm.', 'warn');
      return;
    }
    if (cmd === 'OPEN') {
      this.ui.consoleLog('OPEN: permission denied (read-only memory)', 'err');
      this.audio.errorTone();
      return;
    }
    if (cmd === 'FORMAT') {
      this.ui.consoleLog('FORMAT DENIED. you are inside the disk.', 'err');
      this.audio.glitchBurst(0.7);
      return;
    }
    if (cmd.startsWith('WAKE')) {
      this.ui.consoleLog('INCOMPLETE RECOVERY WORD.', 'warn');
      this.ui.consoleLog('expected 7 characters. received ' + cmd.length + '.', 'sys');
      this.audio.errorTone();
      return;
    }
    if (cmd === 'SUDO' || cmd.startsWith('SUDO ')) {
      this.ui.consoleLog('you are already root. that is the problem.', 'err');
      return;
    }
    // unknown input — error-code flavoured and slightly aware
    const code = (Math.floor(Math.random() * 0xffff) + 0x1000).toString(16).toUpperCase().padStart(4, '0');
    this.ui.consoleLog(`ERR_0x0000${code}_UNKNOWN_NODE "${q.slice(0, 42)}"`, 'err');
    this.ui.consoleLog('the console repeats it back, slower.', 'warn');
    this.audio.errorTone();
    this.audio.whisper(0.02);
    this.fx.glitch = Math.min(0.5, this.fx.glitch + 0.15);
  }

  private useInteractable() {
    if (this.phase === 'bsod' || this.phase === 'zoom' || this.sequence) return;
    if (!this.lastInteractable) return;
    const it = this.lastInteractable;
    this.audio.click('soft');
    if (this.phase === 'room' || this.phase === 'epilogue') this.useRoom(it);
    else if (this.phase === 'world') this.useWorld(it);
  }

  private useRoom(it: Interactable) {
    if (this.room.screenMode === 'epilogue' || this.phase === 'epilogue') {
      if (it.id === 'pc') {
        this.ui.subtitle('モニターが、もう一度こちらを見ている。', 'WAKE_UP?');
        this.audio.chime(440, 0.05);
        setTimeout(() => this.restart(), 1800);
        return;
      }
    }
    switch (it.id) {
      case 'pc':
        this.setPhase('zoom');
        this.sequence = new ZoomSequence(this);
        this.audio.whisper(0.03);
        break;
      case 'window':
        this.ui.subtitle('窓の外に、雨の音はない。街の灯りだけが、少し遅れて瞬いている。');
        break;
      case 'shelf':
        this.ui.subtitle(this.room.helmet ? '棚には、拾ったヘルメットと古いランプ。どちらも埃をかぶっている。' : '棚には、読まなくなった本が並んでいる。');
        break;
      case 'door':
        this.ui.subtitle('ドアノブは動かない。……ここから出る必要は、ない。');
        this.audio.click('mech');
        break;
      case 'clock':
        this.ui.subtitle(this.phase === 'epilogue' ? '3時33分。秒針が、動いていない。' : `午前${new Date().getHours()}時${String(new Date().getMinutes()).padStart(2, '0')}分。`);
        break;
      case 'poster':
        this.ui.subtitle('「SIGNAL LOST」——自分で描いたはずのポスターなのに、初めて見る気がする。');
        break;
      case 'bed':
        this.ui.subtitle(this.phase === 'epilogue' ? 'ベッドは冷えている。誰も寝ていなかったみたいだ。' : 'まだ温かい。ついさっきまで、ここにいた。');
        break;
      case 'mug':
        this.ui.subtitle('冷めたコーヒー。口をつけた跡が、ふたつある。');
        break;
    }
  }

  private useWorld(it: Interactable) {
    if (it.id.startsWith('lore_')) {
      const lines = this.world.loreLines[it.id];
      if (lines) {
        this.ui.subtitle(lines.join('<br>'), it.label, 7);
        this.audio.chime(520, 0.04);
        this.audio.whisper(0.03);
      }
      return;
    }
    if (it.id === 'console_hint') {
      this.world.consoleHintSeen = true;
      this.ui.subtitle('壊れたパネルだ。コンソールに接続できそうだ。', 'RECOVERY CONSOLE');
      this.ui.toast('[C] コンソール', 5);
      this.audio.click('mech');
      return;
    }
  }

  private toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.flashlight.visible = this.flashlightOn;
    this.audio.click('mech');
    this.ui.toast(this.flashlightOn ? 'ライト ON' : 'ライト OFF', 1.4);
  }

  applySettings(changed: keyof Settings) {
    this.settings = this.ui.settings;
    this.input.sensitivity = this.settings.sensitivity;
    this.audio.setVolume(this.settings.volume);
    this.player.bobStrength = 0.25 + this.settings.shake * 0.75;
    if (changed === 'quality') {
      this.fx.setQuality(this.settings.quality as Quality);
    }
    if (changed === 'dynamic') {
      this.fx.dynamic = this.settings.dynamic;
    }
    if (changed === 'glitch' || changed === 'quality' || changed === 'dynamic') {
      this.fx.autoGlitch = 0;
    }
    this.fx.setQuality(this.settings.quality as Quality);
    this.fx.dynamic = this.settings.dynamic;
  }

  private updateInteractable() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const list = (this.phase === 'world' ? this.world.interactables : this.room.interactables).filter((i) => i.enabled());
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const camPos = this.camera.position;
    for (const it of list) {
      const d = it.position.distanceTo(camPos);
      if (d > Math.min(3.0, it.radius + 0.7)) continue;
      const dir = it.position.clone().sub(camPos).normalize();
      const dot = dir.dot(forward);
      if (dot < 0.35) continue;
      const score = d - dot * 1.4;
      if (score < bestScore) {
        best = it;
        bestScore = score;
      }
    }
    this.lastInteractable = best;
    this.ui.setPrompt(best ? best.label : null);
  }

  private updatePerf(dt: number) {
    this.fpsFrames.push(dt);
    if (this.fpsFrames.length > 240) this.fpsFrames.shift();
    this.allFrameTimes.push(dt * 1000);
    if (this.allFrameTimes.length > 8000) this.allFrameTimes.shift();
    if (this.time - this.lastPerf < 0.35) return;
    this.lastPerf = this.time;
    const sorted = this.fpsFrames.slice().sort((a, b) => a - b);
    const avgMs = (this.fpsFrames.reduce((n, v) => n + v, 0) / Math.max(1, this.fpsFrames.length)) * 1000;
    const idx = Math.max(0, Math.floor(sorted.length * 0.99));
    const p1 = sorted.length ? sorted[idx] * 1000 : 0;
    const info = this.renderer.info;
    this.ui.updatePerf({
      FPS: (1000 / Math.max(avgMs, 0.001)).toFixed(1),
      '1% LOW': (1000 / Math.max(p1, 0.001)).toFixed(1),
      FRAME: `${avgMs.toFixed(2)} ms`,
      DRAW: info.render.calls,
      TRI: `${(info.render.triangles / 1000).toFixed(0)}k`,
      TEX: info.memory.textures,
      GEO: info.memory.geometries,
      RES: `${this.fx.renderScale.toFixed(2)}x`,
      QUALITY: this.settings.quality.toUpperCase(),
      PHASE: this.phase.toUpperCase(),
      PIXEL: `${Math.round(window.innerWidth * this.fx.renderScale)}x${Math.round(window.innerHeight * this.fx.renderScale)}`,
    });
  }

  private updateRoomHover() {
    const hit = this.raycastScreen();
    this.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  }

  private update(dt: number) {
    this.time += dt;
    glitchUniforms.uTime.value = this.time;
    this.ui.update(dt);
    this.input.sensitivity = this.settings.sensitivity;

    const menuPaused = this.ui.menuVisible;
    const consolePaused = this.ui.consoleVisible;

    if (this.sequence) {
      const done = this.sequence.update(menuPaused ? 0 : dt);
      if (done) this.sequence = null;
    } else {
      switch (this.phase) {
        case 'boot':
          this.camera.position.set(0.4 + Math.sin(this.time * 0.06) * 0.03, 1.7, 2.5);
          this.camera.quaternion.setFromEuler(new THREE.Euler(-0.05, 0.22 + Math.sin(this.time * 0.04) * 0.02, 0, 'YXZ'));
          break;
        case 'room':
        case 'epilogue': {
          if (!menuPaused && !consolePaused) {
            const move = this.readMove();
            this.player.enabled = true;
            this.player.surface = 'wood';
            this.player.update(dt, move, this.roomPhysics);
            this.player.applyCamera(this.camera, this.time, this.settings.shake);
            this.player.bobStrength = 0.25 + this.settings.shake * 0.75;
            this.updateRoomInteractions();
            const speed = this.player.moveSpeed;
            this.camera.fov = lerp(this.camera.fov, 70 + clamp(speed / this.player.runSpeed) * 4, 1 - Math.exp(-6 * dt));
            this.camera.updateProjectionMatrix();
            this.fx.setFocus(2.6, 7, 0.32);
            this.room.update(dt, this.time, this.camera);
          }
          break;
        }
        case 'bsod': {
          this.bsodIdle += dt;
          this.room.update(dt, this.time, this.camera);
          this.updateRoomHover();
          if (this.input.consumeClick()) this.handleBsodClick();
          if (this.bsodIdle > 4.5 && this.bsodIdle < 6) this.ui.toast('「:(」にカーソルを合わせてクリック', 3);
          if (this.bsodIdle > 12 && this.bsodIdle < 14) this.ui.toast('何度でも、クリックしていい', 3);
          break;
        }
        case 'world': {
          if (!menuPaused && !consolePaused) {
            this.worldTime += dt;
            const move = this.readMove();
            this.player.enabled = true;
            this.player.surface = 'shard';
            this.player.update(dt, move, this.world.physics);
            this.player.applyCamera(this.camera, this.time, this.settings.shake);
            this.player.bobStrength = 0.2 + this.settings.shake * 0.8;
            const speed = this.player.moveSpeed;
            this.camera.fov = lerp(this.camera.fov, 72 + clamp(speed / this.player.runSpeed) * 5, 1 - Math.exp(-6 * dt));
            this.camera.updateProjectionMatrix();
            this.fx.setFocus(9, 34, 0.28);
            this.world.update(dt, this.time, this.camera);
            this.updateWorldTriggers();
            this.updateInteractable();
            if (this.flashlightOn) this.fx.setFocus(7, 22, 0.3);
          }
          break;
        }
        default:
          break;
      }
    }

    // shared scene updates
    if (!menuPaused && !consolePaused) {
      this.room.update(dt, this.time, this.camera);
      if (this.phase === 'world' || this.phase === 'collapse' || this.phase === 'fall') {
        this.world.update(dt, this.time, this.camera);
      }
    }

    // cinematic glitch decay / ambient corruption
    if (!this.sequence) {
      if (this.phase === 'world') {
        this.fx.autoGlitch = 0.02 + Math.sin(this.time * 0.23) * 0.015;
        glitchUniforms.uFlicker.value = 0.04 + Math.sin(this.time * 1.3) * 0.02;
      } else if (this.phase === 'room' || this.phase === 'epilogue') {
        this.fx.autoGlitch = this.phase === 'epilogue' ? 0.035 : 0;
        glitchUniforms.uFlicker.value = this.phase === 'epilogue' ? 0.08 : 0.01;
      }
    }
    glitchUniforms.uGlitch.value = clamp(glitchUniforms.uGlitch.value);

    this.audio.update(dt, this.phase);
    this.audio.updateListener(this.camera);
    this.fx.update(menuPaused ? 0 : dt, this.time);
    this.updatePerf(dt);
    this.input.endFrame();
  }

  private readMove() {
    const active = this.input.mode === 'play' && this.input.locked;
    let forward = 0;
    let strafe = 0;
    if (active) {
      if (this.input.pressed('KeyW')) forward += 1;
      if (this.input.pressed('KeyS')) forward -= 1;
      if (this.input.pressed('KeyD')) strafe += 1;
      if (this.input.pressed('KeyA')) strafe -= 1;
      const { dx, dy } = this.input.consumeMouse();
      if (dx || dy) this.player.look(dx, dy, this.settings.sensitivity);
    } else {
      this.input.consumeMouse();
    }
    const run = this.input.pressed('ShiftLeft') || this.input.pressed('ShiftRight');
    return { forward, strafe, run };
  }

  private setupRoomPhysics() {
    this.roomPhysics.bounds = { minX: -3.3, maxX: 3.3, minZ: -2.75, maxZ: 2.75 };
    this.roomPhysics.groundHeight = () => 0;
    for (const b of this.room.colliders) {
      this.roomPhysics.addBox(b.cx, b.cy, b.cz, b.sx, b.sy, b.sz);
    }
  }

  private updateRoomInteractions() {
    this.updateInteractable();
    if (this.input.consumeClick()) {
      this.useInteractable();
    }
  }

  private updateWorldTriggers() {
    const p = this.player.pos;
    const dm = Math.hypot(p.x - this.world.monolith.x, p.z - this.world.monolith.z);
    if (dm < 46 && !this.monolithLine) {
      this.monolithLine = true;
      this.ui.subtitle('巨大な柱。表面に、白い文字が刻まれている。', 'MONOLITH');
      this.audio.chime(330, 0.05);
      this.audio.addSpatialHum(this.world.monolith.clone().setY(6), 48, 0.11);
    }
    if (dm < 26 && !this.wakeShown) {
      this.wakeShown = true;
      this.ui.subtitle('WAKE_UP', 'THE WORD');
      this.audio.chime(880, 0.06);
    }
    if (!this.hintShown && this.worldTime > 22) {
      this.hintShown = true;
      this.ui.toast('壊れたUIのそばで [C] が使える', 6);
    }
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05) * this.timeScale;
    this.renderer.info.reset();
    const __t0 = performance.now();
    this.update(dt);
    const __t1 = performance.now();
    if (this.manualRender) return;
    if ((window as any).__DIRECT__) this.renderer.render(this.scene, this.camera);
    else this.fx.render();
    const __t2 = performance.now();
    (window as any).__PROF = { update: __t1 - __t0, render: __t2 - __t1, total: __t2 - __t0 };
    this.frameCount++;
    void this.paused;
  };

  /* ------------------------------------------------------------------ debug */
  debugJump(dir = 1) {
    const order: Phase[] = ['room', 'bsod', 'absorb', 'world', 'collapse', 'fall', 'epilogue'];
    const cur = order.indexOf(this.phase);
    const next = order[clamp(cur + dir, 0, order.length - 1) as number] ?? 'room';
    this.jumpTo(next);
  }

  jumpTo(phase: Phase) {
    this.sequence = null;
    this.ui.closeMenu();
    this.ui.closeConsole();
    this.ui.hideTitle();
    this.room.epilogueGroup.visible = false;
    this.room.setEpilogue(false);
    this.world.clearDynamic();
    this.fx.setFade(0);
    this.fx.setIris(0, false);
    this.fx.setLens(0);
    this.fx.flash(0);
    setGlitch(0, 0);
    this.fx.glitch = 0;
    this.audio.stopWorldAmbience();
    this.audio.clearSpatial();
    this.bsodStage = 0;
    this.ui.clearSubtitle();
    switch (phase) {
      case 'room':
        this.restart(true);
        break;
      case 'bsod':
        this.showRoom();
        this.room.drawScreen('bsod', 0);
        this.player.reset(ROOM_SPAWN.clone(), 0, 0);
        this.camera.position.set(-0.15, 1.075, -1.24);
        this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.camera.position, new THREE.Vector3(-0.15, 1.05, -2.14), new THREE.Vector3(0, 1, 0)));
        this.camera.fov = 58;
        this.camera.updateProjectionMatrix();
        this.enterBsod();
        break;
      case 'absorb':
        this.showRoom();
        this.room.drawScreen('bsod', 7);
        this.camera.position.set(-0.15, 1.075, -1.24);
        this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.camera.position, new THREE.Vector3(-0.15, 1.05, -2.14), new THREE.Vector3(0, 1, 0)));
        this.player.reset(ROOM_SPAWN.clone(), 0, 0);
        this.setPhase('absorb');
        this.sequence = new AbsorbSequence(this);
        break;
      case 'world':
        this.showWorld();
        this.phase = 'world';
        this.player.reset(new THREE.Vector3(0, terrainHeight(0, 250), 250), 0.04, -0.04);
        this.player.surface = 'shard';
        this.audio.startWorldAmbience();
        this.audio.addSpatialHum(this.world.monolith.clone().setY(6), 48, 0.09);
        this.input.mode = 'play';
        this.player.enabled = true;
        this.ui.chapter('01 — BSOD WORLD');
        break;
      case 'collapse':
        this.showWorld();
        this.phase = 'world';
        this.player.reset(new THREE.Vector3(0, terrainHeight(0, 12), 12), Math.PI, -0.02);
        this.player.applyCamera(this.camera, this.time, this.settings.shake);
        this.audio.startWorldAmbience();
        this.setPhase('collapse');
        this.sequence = new CollapseSequence(this);
        break;
      case 'fall':
        this.showWorld();
        this.phase = 'world';
        this.player.reset(new THREE.Vector3(0, terrainHeight(0, 12), 12), Math.PI, -0.02);
        this.player.applyCamera(this.camera, this.time, this.settings.shake);
        this.audio.startWorldAmbience();
        this.setPhase('collapse');
        this.sequence = new CollapseSequence(this, 4.2);
        break;
      case 'epilogue':
        this.showRoom();
        this.room.setEpilogue(true);
        this.phase = 'epilogue';
        this.player.reset(new THREE.Vector3(0, 0, 1.65), 0.02, -0.05);
        this.player.surface = 'wood';
        this.input.mode = 'play';
        this.player.enabled = true;
        this.audio.startRoomAmbience();
        break;
    }
    if (phase !== 'bsod' && phase !== 'absorb' && phase !== 'collapse' && phase !== 'fall') {
      this.input.requestLock();
    }
  }

  debugPhaseNext() {
    this.debugJump(1);
  }

  /* --------------------------------------------------------------- benchmark */
  async runBenchmark() {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    this.allFrameTimes = [];
    const phases: { name: string; act: () => Promise<void> }[] = [
      { name: 'room', act: async () => { this.jumpTo('room'); await sleep(4000); } },
      { name: 'zoom', act: async () => { this.ui.openMenu(); this.jumpTo('bsod'); await sleep(5000); } },
      {
        name: 'bsod',
        act: async () => {
          for (let i = 0; i < BSOD_CLICKS; i++) {
            this.bsodStage = Math.min(BSOD_CLICKS, this.bsodStage + 1);
            this.room.setScreenStage(this.bsodStage);
            await sleep(120);
          }
          this.sequence = new AbsorbSequence(this);
          this.setPhase('absorb');
          await sleep(6500);
        },
      },
      { name: 'world', act: async () => { this.jumpTo('world'); await sleep(9000); } },
      { name: 'console', act: async () => { this.openConsole(); this.handleConsoleCommand('status'); await sleep(1500); this.handleConsoleCommand('WAKE_UP'); await sleep(12000); } },
      { name: 'return', act: async () => { await sleep(9000); } },
    ];
    for (const p of phases) await p.act();
    const times = this.allFrameTimes.slice().sort((a, b) => a - b);
    const avg = times.reduce((n, v) => n + v, 0) / Math.max(1, times.length);
    const p1 = times[Math.max(0, Math.floor(times.length * 0.99))] ?? avg;
    const result = {
      sampledFrames: times.length,
      avgFps: +(1000 / avg).toFixed(2),
      p1LowFps: +(1000 / p1).toFixed(2),
      minFps: +(1000 / (times[times.length - 1] ?? avg)).toFixed(2),
      renderer: (() => {
        const gl = this.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })(),
      width: window.innerWidth,
      height: window.innerHeight,
      quality: this.settings.quality,
      timestamp: new Date().toISOString(),
    };
    (window as any).__BENCH__ = result;
    console.log('BENCH_RESULT', JSON.stringify(result));
    this.ui.toast('BENCH COMPLETE', 5);
    return result;
  }

  private exposeDebugApi() {
    (window as any).__BSOD__ = {
      jump: (p: Phase) => this.jumpTo(p),
      state: () => ({
        phase: this.phase,
        bsodStage: this.bsodStage,
        player: this.player.pos.toArray().map((n) => +n.toFixed(2)),
        yaw: +this.player.yaw.toFixed(3),
        pitch: +this.player.pitch.toFixed(3),
        sequence: this.sequence?.name ?? null,
        consoleOpen: this.ui.consoleVisible,
        menuOpen: this.ui.menuVisible,
        locked: this.input.locked,
        wakeShown: this.wakeShown,
        epilogue: this.room.screenMode === 'epilogue',
        flashlight: this.flashlightOn,
        renderScale: +this.fx.renderScale.toFixed(2),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      console: (cmd: string) => {
        if (!this.ui.consoleVisible) this.openConsole();
        this.handleConsoleCommand(cmd);
      },
      useConsole: () => this.openConsole(),
      closeConsole: () => this.ui.closeConsole(),
      clickBsod: () => this.handleBsodClick(),
      rayProbe: () => {
        this.camera.updateMatrixWorld(true);
        this.room.group.updateMatrixWorld(true);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(this.input.mouseNDC, this.camera);
        const hits = ray.intersectObject(this.room.screenMesh, false);
        return {
          ndc: [this.input.mouseNDC.x, this.input.mouseNDC.y],
          camera: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
          dir: [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z],
          screenWorld: this.room.screenMesh.getWorldPosition(new THREE.Vector3()).toArray(),
          hits: hits.length,
          uv: hits[0]?.uv ? [hits[0].uv.x, hits[0].uv.y] : null,
          phase: this.phase,
          seq: this.sequence?.name ?? null,
          visible: this.room.screenMesh.visible,
          groupVisible: this.room.group.visible,
        };
      },
      bsodMisses: () => (this as any).bsodMisses ?? 0,
      faceScreenPoint: () => {
        const r = this.room.faceRegion;
        const u = (r.x0 + r.x1) / 2;
        const v = 1 - (r.y0 + r.y1) / 2;
        const p = new THREE.Vector3(u - 0.5, v - 0.5, 0);
        // convert UV to the monitor's local plane coordinates and project
        const geom = this.room.screenMesh.geometry as THREE.PlaneGeometry;
        const w = geom.parameters.width;
        const h = geom.parameters.height;
        this.room.screenMesh.localToWorld(p.set((u - 0.5) * w, (v - 0.5) * h, 0));
        p.project(this.camera);
        return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
      },
      forceLock: (v = true) => {
        this.input.locked = v;
      },
      setInputMode: (m: 'play' | 'ui' | 'cinematic') => {
        this.input.mode = m;
      },
      key: (code: string, down = true) => {
        if (down) this.input.keys.add(code);
        else this.input.keys.delete(code);
      },
      setQuality: (q: Quality) => {
        this.ui.settings.quality = q;
        this.fx.setQuality(q);
      },
      setNoFx: (v: boolean) => {
        this.fx.bloom!.enabled = !v;
        this.fx.gtao!.enabled = !v;
        this.renderer.shadowMap.enabled = !v;
      },
      move: (dx: number, dy: number) => {
        this.player.yaw -= dx * 0.0022 * this.settings.sensitivity;
        this.player.pitch = clamp(this.player.pitch - dy * 0.0022 * this.settings.sensitivity, -1.45, 1.45);
      },
      teleport: (x: number, z: number, yaw = 0) => {
        const y = this.phase === 'room' || this.phase === 'epilogue' ? 0 : terrainHeight(x, z);
        this.player.reset(new THREE.Vector3(x, y, z), yaw);
      },
      bench: () => this.runBenchmark(),
      advance: (seconds: number) => {
        const n = Math.min(9000, Math.max(1, Math.round(seconds * 60)));
        for (let i = 0; i < n; i++) {
          this.update(1 / 60 * this.timeScale);
          if (i % 20 === 0) this.fx.render();
        }
        this.fx.render();
        return this.phase;
      },
      setManualRender: (v: boolean) => {
        this.manualRender = v;
      },
      renderOnce: () => {
        this.fx.render();
        return true;
      },
      game: this,
    };
    if (this.benchMode) {
      const wait = setInterval(() => {
        if (this.started && this.phase === 'room') {
          clearInterval(wait);
          setTimeout(() => this.runBenchmark(), 1200);
        } else if (this.assets.loaded >= this.assets.total) {
          clearInterval(wait);
          this.start();
          setTimeout(() => this.runBenchmark(), 2500);
        }
      }, 500);
    }
  }
}
