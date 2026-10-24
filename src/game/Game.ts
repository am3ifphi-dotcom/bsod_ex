import * as THREE from 'three';
import { clamp01 } from '../core/math';
import { AudioEngine, type SurfaceKind } from '../audio/AudioEngine';
import { CollisionWorld } from '../core/Collision';
import { Input } from '../core/Input';
import { Player } from '../core/Player';
import { Renderer } from '../core/Renderer';
import { Settings, type QualityPreset, type SettingsData } from '../core/Settings';
import { AssetStore } from '../assets/Assets';
import { MaterialLibrary } from '../assets/Materials';
import { Room, ROOM } from '../world/Room';
import { buildWorld, type WorldResult } from '../world/World';
import { LAYOUT, WORLD_Y, type Interactable } from '../world/types';
import { GameConsole } from '../narrative/Console';
import type { Ui } from '../ui/Ui';
import { Cinematics } from './Cinematics';

export type Phase =
  | 'boot' | 'title' | 'room' | 'zoom' | 'bsod' | 'swallow'
  | 'tunnel' | 'world' | 'collapse' | 'landing' | 'return' | 'error';

interface RoomFocusItem {
  id: string;
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: boolean;
  onInteract: () => void;
}

type Focus =
  | { kind: 'room'; item: RoomFocusItem }
  | { kind: 'world'; item: Interactable }
  | null;

/** Two clicks per stage; six stages peel the screen off and open the mouth. */
const MAX_BSOD_STAGE = 6;

/**
 * Owns the whole experience: the phase machine, the player, the world, and the glue between
 * them. main.ts owns the frame loop and calls `frame(dt)`; Game decides what is awake.
 */
export class Game {
  readonly renderer: Renderer;
  readonly settings: Settings;
  readonly ui: Ui;
  readonly audio = new AudioEngine();
  readonly input: Input;
  readonly collision = new CollisionWorld();
  readonly player = new Player();
  readonly store = new AssetStore();
  readonly mats: MaterialLibrary;
  readonly narrative: GameConsole;

  phase: Phase = 'boot';
  room!: Room;
  world!: WorldResult;
  cinematics!: Cinematics;

  private time = 0;
  private focus: Focus = null;
  private locked = false;
  private menuOpen = false;
  private consoleOpen = false;

  /* ------------------------------------------------------------------ bsod */
  private bsodClicks = 0;
  private bsodStage = 0;
  private swallowAt = -1;

  /* -------------------------------------------------------------- ambience */
  private emitterLoops: { loop: ReturnType<AudioEngine['createEmitter']>; pos: THREE.Vector3 }[] = [];

  /* ------------------------------------------------------------ flashlight */
  private flashlight!: THREE.SpotLight;
  private flashlightOn = false;
  private flashlightClock = 0;

  /* ------------------------------------------------------------------ core */
  private coreSeen = false;
  private areaName = 'arrival';
  private landingShown = false;
  private returnTimer = 0;

  private unblockInput: (() => void) | null = null;
  private hintTimers: number[] = [];
  private roomFocus: RoomFocusItem[] = [];

  constructor(container: HTMLElement, settings: Settings, ui: Ui) {
    this.settings = settings;
    this.ui = ui;
    this.input = new Input(container);
    this.renderer = new Renderer(container, settings.data.quality);
    this.mats = new MaterialLibrary(this.store);
    this.narrative = new GameConsole({
      areaName: 'arrival',
      wakeKnown: false,
      visitedAreas: ['arrival'],
      onWakeUp: () => { /* handled by Game after submit() */ },
      onExit: () => { this.audio.doorThud(); },
      playType: () => this.audio.keyType(),
      playError: () => this.audio.consoleError(),
      playOk: () => this.audio.uiClick(),
    });
    this.bindInput();
    this.bindSettings();
  }

  /* ====================================================================== boot */
  async init(onProgress?: (p: number, label: string) => void): Promise<void> {
    this.setPhase('boot');
    this.renderer.renderer.setClearColor(0x02040a, 1);
    this.renderer.scene.background = null;

    onProgress?.(0.04, 'loading materials');
    await this.mats.init();

    onProgress?.(0.28, 'loading environment');
    try {
      const env = await this.store.makeEnv('assets/env/moonless_golf_1k.hdr', this.renderer.renderer);
      this.renderer.setEnvironment(env, null);
    } catch (err) {
      console.warn('[game] environment probe failed, continuing with analytic lights', err);
    }

    onProgress?.(0.4, 'building the bedroom');
    this.room = await Room.create(this.store, this.mats, this.collision);
    this.renderer.scene.add(this.room.group);
    this.room.group.visible = false;

    onProgress?.(0.62, 'reconstructing memory sectors');
    const detail = this.settings.data.quality === 'low' ? 0.55 : this.settings.data.quality === 'medium' ? 0.8 : 1;
    this.world = await buildWorld({ store: this.store, mats: this.mats, collision: this.collision, detail });
    this.renderer.scene.add(this.world.group);
    this.renderer.scene.add(this.world.tunnel.group);
    this.world.group.visible = false;
    this.world.tunnel.group.visible = false;

    onProgress?.(0.9, 'waking the machine');
    this.cinematics = new Cinematics({
      camera: this.renderer.camera,
      player: this.player,
      audio: this.audio,
      renderer: this.renderer,
      room: this.room.result,
      roomGroup: this.room.group,
      tunnel: this.world.tunnel,
      cameraMotion: () => this.settings.data.cameraMotion,
    });

    this.setupFlashlight();
    this.setupReflectionProbe();
    this.setupEmitters();
    this.setupPlayerCallbacks();

    // the monitor is the only thing in the bedroom you can touch
    this.roomFocus = [{
      id: 'monitor',
      position: ROOM.monitorPos.clone(),
      radius: 2.3,
      prompt: 'モニタを見る',
      enabled: true,
      onInteract: () => { void this.beginZoom(); },
    }];

    this.world.onApproachCore(() => {
      if (this.phase !== 'world') return;
      this.coreSeen = true;
      this.ui.subtitle('モノリスが、こちらの名前を呼んでいる。', 5200);
      this.audio.whisper();
    });

    this.resetPlaythrough();
    this.room.group.visible = true;
    this.player.reset(ROOM.start.x, ROOM.start.y, ROOM.start.z, ROOM.startYaw, -0.04);
    this.player.controlEnabled = false;
    this.player.applyToCamera(this.renderer.camera);
    this.renderer.setFx({ glitch: 0, chroma: 0, grain: 0.045, dofStrength: 0, fade: 0, flash: 0, invert: 0, radialBlur: 0 });
    this.setPhase('title');
    onProgress?.(1, 'ready');
  }

  /* ================================================================== wiring */
  private bindInput(): void {
    this.input.bind('interact', ['KeyE']);
    this.input.bind('console', ['KeyC']);
    this.input.bind('flashlight', ['KeyF']);
    this.input.bind('pause', ['Escape']);
    this.input.bind('perf', ['F3']);
    this.input.bind('dev', ['F9']);

    this.input.on('interact', () => this.tryInteract());
    this.input.on('console', () => this.toggleConsole());
    this.input.on('pause', () => this.onEscape());
    this.input.on('flashlight', () => this.toggleFlashlight());
    this.input.on('perf', () => this.togglePerf());
    this.input.on('dev', () => this.debugJump());

    // click also interacts while the pointer is locked (games do both)
    this.input.on('click', () => this.tryInteract());

    this.input.onLockError = () => this.enableFreeLook();

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement !== null;
      if (this.locked) this.input.setFreeLook(false);
      this.ui.setCursorLocked(this.locked || this.input.freeLook);
      if (!this.locked && this.isPlayable && !this.menuOpen && !this.consoleOpen) this.openMenu();
    });
  }

  private bindSettings(): void {
    this.settings.onChange((key, value) => {
      if (key === 'volume') this.audio.setVolume(this.settings.data.volume);
      if (key === 'showPerf') this.ui.setPerfVisible(this.settings.data.showPerf);
      if (key === 'quality') this.renderer.setQuality(value as QualityPreset);
      if (key === 'fov') {
        this.renderer.camera.fov = this.settings.data.fov;
        this.renderer.camera.updateProjectionMatrix();
      }
    });
    this.audio.setVolume(this.settings.data.volume);
  }

  private setupFlashlight(): void {
    this.flashlight = new THREE.SpotLight(0xdfeaff, 0, 26, 0.55, 0.45, 1.5);
    this.flashlight.castShadow = this.settings.data.quality !== 'low';
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.bias = -0.0016;
    this.flashlight.shadow.camera.near = 0.15;
    this.flashlight.shadow.camera.far = 26;
    this.flashlight.visible = false;
    this.renderer.scene.add(this.flashlight);
    this.renderer.scene.add(this.flashlight.target);
  }

  /**
   * A real reflection probe for the core: one cube render at the monolith, converted to a PMREM
   * and handed to the area's materials. Captured once, off-frame, before the title appears.
   */
  private setupReflectionProbe(): void {
    try {
      const core = this.world.areas.find((a) => a.name === 'core');
      if (!core) return;
      const probe = this.renderer.captureProbe(
        new THREE.Vector3(LAYOUT.monolith.x, WORLD_Y + 14, LAYOUT.monolith.z + 34),
        128,
      );
      core.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial || std.emissiveIntensity > 2) continue;
          std.envMap = probe;
          std.envMapIntensity = 0.85;
          std.needsUpdate = true;
        }
      });
    } catch (err) {
      console.warn('[game] reflection probe failed (continuing with the HDRI probe)', err);
    }
  }

  private setupEmitters(): void {
    for (const area of this.world.areas) {
      for (const em of area.emitters ?? []) {
        const loop = this.audio.createEmitter(em.kind, { x: em.position.x, y: em.position.y, z: em.position.z });
        if (loop) this.emitterLoops.push({ loop, pos: em.position.clone() });
      }
    }
  }

  private setupPlayerCallbacks(): void {
    this.player.surfaceAt = (x, z) => this.surfaceAt(x, z);
    this.player.onFootstep = (e) => {
      if (this.phase === 'room' || this.phase === 'return') this.audio.footstep('wood', e.intensity, e.sprinting);
      else if (this.phase === 'world') this.audio.footstep(this.surfaceAt(e.position.x, e.position.z), e.intensity, e.sprinting);
    };
  }

  private surfaceAt(x: number, z: number): SurfaceKind {
    if (this.phase === 'room' || this.phase === 'return') return 'wood';
    if (this.player.position.y < WORLD_Y - 2) return 'metal';
    if (z > LAYOUT.path.z1) return 'rubble';
    if (z > LAYOUT.plaza.max.z) return 'concrete';
    if (z > LAYOUT.coreBridge.z0) {
      if (x < LAYOUT.plaza.min.x) return 'tile';
      if (x > LAYOUT.plaza.max.x) return 'asphalt';
      return 'concrete';
    }
    return 'metal';
  }

  /* =================================================================== public */
  get isPlayable(): boolean {
    return this.phase === 'room' || this.phase === 'world' || this.phase === 'return';
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    document.body.dataset.phase = p;
  }

  requestLockFromUi(): void {
    if (!this.isPlayable || this.menuOpen || this.consoleOpen) return;
    if (this.ui.isMenuOpen || this.ui.isCreditsOpen) return;
    this.armLook();
  }

  /**
   * Ask for pointer lock and, if the browser refuses it (an embedding iframe without
   * allow="pointer-lock", a policy, a remote-desktop client), fall back to lock-free mouse look
   * after a moment so the game stays playable in a preview pane.
   */
  private armLook(): void {
    if (!this.isPlayable || this.menuOpen || this.consoleOpen) return;
    if (this.input.freeLook) return;
    this.input.requestPointerLock();
    const id = window.setTimeout(() => {
      this.hintTimers = this.hintTimers.filter((x) => x !== id);
      if (this.locked || this.input.freeLook || !this.isPlayable) return;
      this.enableFreeLook();
    }, 900);
    this.hintTimers.push(id);
  }

  private enableFreeLook(): void {
    if (!this.isPlayable || this.input.freeLook) return;
    this.input.setFreeLook(true);
    this.ui.setCursorLocked(true);
    this.ui.subtitle('この環境ではポインタロックが使えません。マウスの移動で視界が動きます。', 8000);
  }

  /** Start a run from the title screen. */
  async startExperience(): Promise<void> {
    if (this.phase !== 'title') return;
    // request the lock while we are still inside the click gesture
    this.armLook();
    this.ui.hideTitle();
    this.ui.setHudVisible(true);
    await this.audio.ensure();
    this.audio.setVolume(this.settings.data.volume);
    this.audio.setSpace('room');
    this.audio.startRoomAmbience();
    this.resetPlaythrough();
    this.enterRoom(true);
    this.armLook();
    this.ui.subtitle('03:47。モニタの光だけが、部屋を青くしている。', 7000);
    this.scheduleHint([
      '机の前に立て。モニタを見る。',
      'E / クリック で調べる　WASD で移動　Shift で走る',
      'F 懐中電灯　C コンソール　Esc メニュー',
    ], 6000);
  }

  async restart(): Promise<void> {
    this.clearHintTimers();
    this.ui.closeMenu();
    this.ui.closeCredits();
    this.ui.closeConsole();
    this.releaseInputBlock();
    this.menuOpen = false;
    this.consoleOpen = false;
    this.resetPlaythrough();
    await this.audio.ensure();
    this.audio.startRoomAmbience();
    this.enterRoom(true);
    this.armLook();
    this.ui.subtitle('03:47。モニタの光だけが、部屋を青くしている。', 6000);
  }

  quitToTitle(): void {
    this.clearHintTimers();
    this.menuOpen = false;
    this.consoleOpen = false;
    this.ui.closeMenu();
    this.ui.closeCredits();
    this.ui.closeConsole();
    this.releaseInputBlock();
    this.ui.showBsod(false);
    this.ui.setHudVisible(false);
    this.ui.setPrompt(null);
    this.ui.hint(null);
    this.ui.clearSubtitle();
    this.player.controlEnabled = false;
    this.flashlightOn = false;
    if (this.flashlight) this.flashlight.visible = false;
    this.input.exitPointerLock();
    this.input.setFreeLook(false);
    this.ui.setCursorLocked(false);
    this.audio.stopAllAmbience();
    this.resetPlaythrough();
    this.world.group.visible = false;
    this.world.tunnel.group.visible = false;
    this.room.group.visible = true;
    this.room.result.setScreenMode('desktop');
    this.room.result.setAnomaly(0);
    this.room.result.setLamp(true);
    this.player.reset(ROOM.start.x, ROOM.start.y, ROOM.start.z, ROOM.startYaw, -0.04);
    this.player.applyToCamera(this.renderer.camera);
    this.renderer.setFx({ glitch: 0, chroma: 0, grain: 0.045, dofStrength: 0, fade: 0, flash: 0, invert: 0, radialBlur: 0 });
    this.audio.setSpace('room');
    this.setPhase('title');
    this.ui.showTitle();
  }

  resume(): void {
    if (!this.menuOpen) {
      this.requestLockFromUi();
      return;
    }
    this.menuOpen = false;
    this.ui.closeMenu();
    this.releaseInputBlock();
    this.player.controlEnabled = !this.cinematics?.active;
    this.armLook();
  }

  onSettingChanged(key: string, value: number | string | boolean): void {
    if (key === 'quality') {
      this.settings.set('quality', value as QualityPreset);
    } else {
      this.settings.set(key as keyof SettingsData, value as never);
    }
    if (key === 'volume') this.audio.setVolume(this.settings.data.volume);
    if (key === 'showPerf') this.ui.setPerfVisible(this.settings.data.showPerf);
    if (key === 'quality') {
      this.renderer.setQuality(this.settings.data.quality as QualityPreset);
      if (this.flashlight) this.flashlight.castShadow = this.settings.data.quality !== 'low';
    }
    if (key === 'fov') {
      this.renderer.camera.fov = this.settings.data.fov;
      this.renderer.camera.updateProjectionMatrix();
    }
  }

  onVisibilityChange(hidden: boolean): void {
    if (hidden && this.isPlayable && !this.menuOpen && !this.consoleOpen) this.openMenu();
  }

  /**
   * Dev-only phase jump (F9). Compiled out of production builds: `import.meta.env.DEV` is
   * replaced with `false`, so the binding does nothing in the shipped game.
   */
  private debugJump(): void {
    if (!import.meta.env.DEV) return;
    if (this.cinematics?.active) return;
    const order: Phase[] = ['room', 'world', 'collapse'];
    const current = this.phase === 'return' ? 'room' : this.phase;
    const next = order[(Math.max(0, order.indexOf(current)) + 1) % order.length];
    console.info(`[dev] F9: ${this.phase} -> ${next}`);
    if (next === 'room') {
      this.resetPlaythrough();
      this.enterRoom(false);
    } else if (next === 'world') {
      this.enterWorld(false);
    } else {
      this.beginCollapse();
    }
  }

  /* =================================================================== phases */
  private enterRoom(fromStart: boolean): void {
    this.setPhase('room');
    this.room.group.visible = true;
    this.world.group.visible = false;
    this.world.tunnel.group.visible = false;
    this.player.reset(ROOM.start.x, ROOM.start.y, ROOM.start.z, ROOM.startYaw, -0.04);
    this.player.controlEnabled = true;
    this.player.applyToCamera(this.renderer.camera);
    this.renderer.camera.fov = this.settings.data.fov;
    this.renderer.camera.updateProjectionMatrix();
    this.renderer.setFx({ glitch: 0.015, chroma: 0.05, grain: 0.045, dofStrength: 0, radialBlur: 0, flash: 0, invert: 0, fade: 0 });
    this.room.result.setLamp(true);
    this.room.setReturnAnomaly(false);
    this.room.result.setScreenMode(fromStart ? 'desktop' : 'glitch');
    this.room.result.setAnomaly(fromStart ? 0 : 0.3);
    this.audio.setSpace('room');
    this.ui.setHudVisible(true);
    this.ui.setPrompt(null);
    this.setTarget(null);
  }

  private async beginZoom(): Promise<void> {
    if (this.phase !== 'room') return;
    this.setPhase('zoom');
    this.ui.setPrompt(null);
    this.clearHintTimers();
    this.ui.hint(null);
    this.player.controlEnabled = false;
    this.input.exitPointerLock();
    this.room.result.setScreenMode('bsod');
    this.room.result.setAnomaly(0.2);
    this.audio.bsodAppear();
    this.audio.duck(0.45, 2.2);
    await this.cinematics.playZoomToMonitor();
    this.beginBsod();
  }

  private beginBsod(): void {
    this.setPhase('bsod');
    this.bsodClicks = 0;
    this.bsodStage = 0;
    this.swallowAt = -1;
    this.ui.showBsod(true);
    this.ui.setBsodStage(0);
    this.ui.setHudVisible(false);
    this.ui.subtitle('画面の「:(」を、何度でもクリックしろ。', 6500);
    this.audio.setSpace('void');
    this.audio.glitchBurst(0);
    this.renderer.setFx({ glitch: 0.12, chroma: 0.2, grain: 0.14, dofStrength: 0.35, radialBlur: 0 });
  }

  onBsodClick(): void {
    if (this.phase !== 'bsod') return;
    this.bsodClicks++;
    const stage = Math.min(MAX_BSOD_STAGE, Math.ceil(this.bsodClicks / 2));
    if (stage === this.bsodStage) return;
    this.bsodStage = stage;
    this.ui.setBsodStage(stage);
    this.audio.glitchBurst(stage);
    this.room.result.setAnomaly(0.2 + stage * 0.11);
    this.room.result.setScreenMode(stage >= 4 ? 'face' : 'bsod');
    if (stage >= 3) this.room.result.setLamp(false);
    this.renderer.setFx({
      glitch: 0.12 + stage * 0.085,
      chroma: 0.2 + stage * 0.2,
      invert: stage >= 4 ? 0.1 : 0,
      radialBlur: stage >= 5 ? 0.16 : 0,
    });
    this.ui.subtitle(
      stage <= 1 ? '文字が、こちらの動きに合わせて震えている。'
        : stage <= 3 ? '画面の内側から、何かが押し返してくる。'
          : stage <= 5 ? 'ガラスのような音。画面に、ひびが入った。'
            : '向こう側が見えている。',
      4200,
    );
    if (stage >= MAX_BSOD_STAGE) this.swallowAt = this.time + 1.15;
  }

  private async beginSwallow(): Promise<void> {
    this.setPhase('swallow');
    this.swallowAt = -1;
    this.ui.showBsod(false);
    this.ui.clearSubtitle();
    this.ui.setHudVisible(false);
    this.room.result.setScreenMode('face');
    this.room.result.setAnomaly(1);
    this.audio.setSpace('void');
    this.audio.whoosh(1.6, true);
    await this.cinematics.playSwallow();
    this.setPhase('tunnel');
    this.audio.stopRoomAmbience();
    await this.cinematics.playTunnel();
    this.enterWorld(true);
  }

  private enterWorld(fromTunnel: boolean): void {
    this.setPhase('world');
    this.room.group.visible = false;
    this.world.group.visible = true;
    this.world.tunnel.group.visible = false;
    this.world.reset();
    this.world.group.visible = true;
    const start = LAYOUT.start;
    this.player.reset(start.x, WORLD_Y, start.z, 0, -0.02);
    this.player.controlEnabled = true;
    this.player.applyToCamera(this.renderer.camera);
    this.renderer.camera.fov = this.settings.data.fov;
    this.renderer.camera.updateProjectionMatrix();
    this.renderer.setFx({ glitch: 0.07, chroma: 0.16, grain: 0.07, dofStrength: 0, radialBlur: 0, flash: 0, invert: 0, fade: 0 });
    this.audio.setSpace('world');
    this.audio.startWorldAmbience();
    this.ui.setHudVisible(true);
    this.ui.setPrompt(null);
    this.narrative.setContext({ areaName: 'arrival', wakeKnown: false, visitedAreas: ['arrival'] });
    this.flashlightOn = true;
    this.coreSeen = false;
    this.landingShown = false;
    this.returnTimer = 0;
    if (fromTunnel) {
      this.ui.subtitle('ここは、どこだ。', 4200);
      this.scheduleHint(['前へ。光の柱を目指せ。', 'C コンソール　F 懐中電灯　Esc メニュー'], 5200);
    } else {
      this.ui.subtitle('（開発ジャンプ）グリッチ世界。', 2600);
    }
  }

  private beginCollapse(): void {
    if (this.phase !== 'world') return;
    this.setPhase('collapse');
    this.ui.setHudVisible(false);
    this.ui.setPrompt(null);
    this.ui.clearSubtitle();
    this.ui.hint(null);
    this.player.controlEnabled = false;
    this.flashlightOn = false;
    this.audio.stopWorldAmbience();
    this.audio.stopRoomAmbience();
    this.audio.setSpace('void');
    this.audio.rumble(17, 1);

    const center = new THREE.Vector3(LAYOUT.monolith.x, WORLD_Y, LAYOUT.monolith.z + 18);
    this.world.breakFloor(center);
    const landing = { x: ROOM.start.x - 0.35, z: ROOM.start.z + 0.55 };

    void this.cinematics.playCollapse(
      this.player.eyePosition.clone(), this.player.yaw, this.player.pitch, landing,
      () => this.ui.subtitle('部屋が、下から迫ってくる。', 1800),
    ).then(async () => {
      this.setPhase('landing');
      this.world.group.visible = false;
      this.world.tunnel.group.visible = false;
      this.room.group.visible = true;
      this.room.result.setScreenMode('glitch');
      this.room.result.setAnomaly(0.5);
      this.room.result.setLamp(false);
      this.room.setReturnAnomaly(true);
      this.audio.stopAllAmbience();
      this.audio.setSpace('room');
      await this.cinematics.playLanding(landing);
      // landing shot ends with the player controller already at the floor position
      this.setPhase('return');
      this.landingShown = false;
      this.returnTimer = 0;
      this.player.controlEnabled = true;
      this.ui.setHudVisible(true);
      this.audio.startRoomAmbience();
      this.renderer.setFx({ glitch: 0.05, chroma: 0.12, grain: 0.06, dofStrength: 0, radialBlur: 0, flash: 0, invert: 0 });
      this.ui.subtitle('03:47。まだ、03:47。', 8000);
      this.armLook();
    }).catch((err) => {
      console.error('[game] collapse failed', err);
      this.fail(err);
    });
  }

  /* =================================================================== console */
  toggleConsole(): void {
    if (!this.isPlayable) return;
    if (this.consoleOpen) {
      this.closeConsole();
      return;
    }
    this.consoleOpen = true;
    this.player.controlEnabled = false;
    this.unblockInput = this.input.block();
    this.input.exitPointerLock();
    this.ui.openConsole();
    this.audio.consoleOpen();
    for (const line of this.narrative.welcome()) this.ui.consolePrint(line.text, line.cls);
    this.ui.setPrompt(null);
    this.ui.hint(null);
    // landing anomalies: the prompt has already told the player the console exists
    this.ui.setDevHint('');
  }

  private closeConsole(): void {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.ui.closeConsole();
    this.releaseInputBlock();
    this.player.controlEnabled = !this.cinematics.active;
    this.armLook();
  }

  onConsoleClosed(): void {
    if (!this.consoleOpen) {
      this.player.controlEnabled = true;
      this.releaseInputBlock();
      this.armLook();
      return;
    }
    this.consoleOpen = false;
    this.releaseInputBlock();
    this.player.controlEnabled = !this.cinematics.active;
    this.armLook();
  }

  onConsoleCommand(text: string): void {
    if (!this.consoleOpen) return;
    const wasArmed = this.narrative.hasAcceptedWake;
    const lines = this.narrative.submit(text);
    for (const line of lines) this.ui.consolePrint(line.text, line.cls);
    if (this.narrative.hasAcceptedWake && !wasArmed) {
      this.ui.consoleSetEnabled(false);
      this.audio.setSpace('void');
      this.audio.rumble(3, 0.5);
      this.ui.consolePrint('', 'line');
      this.ui.consolePrint('入力を停止しました。', 'sys');
      window.setTimeout(() => {
        if (!this.consoleOpen) return;
        this.consoleOpen = false;
        this.ui.closeConsole();
        this.releaseInputBlock();
        this.beginCollapse();
      }, 900);
    }
  }

  /* ==================================================================== menus */
  private onEscape(): void {
    if (this.consoleOpen) {
      this.closeConsole();
      return;
    }
    if (this.ui.isCreditsOpen) {
      this.ui.closeCredits();
      return;
    }
    if (this.menuOpen || this.ui.isMenuOpen) {
      this.resume();
      return;
    }
    if (this.isPlayable) this.openMenu();
  }

  private openMenu(): void {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.player.controlEnabled = false;
    if (!this.unblockInput) this.unblockInput = this.input.block();
    this.input.exitPointerLock();
    this.ui.setPrompt(null);
    this.ui.openMenu(false);
    this.audio.uiClick();
  }

  private releaseInputBlock(): void {
    if (!this.unblockInput) return;
    this.unblockInput();
    this.unblockInput = null;
  }

  /* ==================================================================== focus */
  private setTarget(item: Focus): void {
    this.focus = item;
    if (!item) {
      this.ui.setPrompt(null);
      this.ui.setReticleHot(false);
      return;
    }
    this.ui.setReticleHot(true, item.kind === 'world');
    this.ui.setPrompt(item.item.prompt);
  }

  tryInteract(): void {
    if (!this.isPlayable || this.menuOpen || this.consoleOpen || this.ui.isMenuOpen || this.ui.isCreditsOpen) return;
    const item = this.focus;
    if (!item) return;
    this.audio.uiClick();
    if (item.kind === 'room') {
      item.item.onInteract();
      return;
    }
    const w = item.item;
    w.onInteract?.();
    if (w.message) this.ui.subtitle(w.message, 5200);
    if (w.id.startsWith('terminal')) {
      this.narrative.setContext({ areaName: 'terminal' });
      this.toggleConsole();
    }
    if (w.id === 'core-text') {
      this.narrative.setContext({ wakeKnown: true });
      this.audio.whisper();
    }
  }

  private updateFocus(): void {
    if (!this.isPlayable || this.menuOpen || this.consoleOpen || this.cinematics.active) {
      if (this.focus) this.setTarget(null);
      return;
    }
    const cam = this.renderer.camera;
    const eye = cam.position;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let best: Focus = null;
    let bestScore = Infinity;

    const consider = (pos: THREE.Vector3, radius: number, prompt: string, make: () => Focus): void => {
      const to = pos.clone().sub(eye);
      const dist = to.length();
      if (dist > radius) return;
      const dot = to.normalize().dot(forward);
      if (dot < 0.4) return;
      const score = dist / Math.max(0.2, dot);
      if (score < bestScore) {
        bestScore = score;
        best = make();
      }
    };

    if (this.phase === 'room') {
      for (const it of this.roomFocus) {
        if (!it.enabled) continue;
        consider(it.position, it.radius, it.prompt, () => ({ kind: 'room', item: it }));
      }
    } else if (this.phase === 'world') {
      for (const it of this.world.interactables) {
        if (!it.enabled) continue;
        consider(it.position, it.radius, it.prompt, () => ({ kind: 'world', item: it }));
      }
    }
    this.setTarget(best);
  }

  /* ================================================================ flashlight */
  private toggleFlashlight(): void {
    if (this.phase !== 'world' || this.menuOpen || this.consoleOpen) return;
    this.flashlightOn = !this.flashlightOn;
    this.audio.clickLight();
  }

  private updateFlashlight(dt: number): void {
    const want = this.flashlightOn && this.phase === 'world';
    const cam = this.renderer.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.flashlight.position.copy(cam.position);
    this.flashlight.target.position.copy(cam.position).addScaledVector(dir, 8);
    this.flashlight.target.updateMatrixWorld();

    const shadows = this.settings.data.quality !== 'low';
    const cast = shadows && want;
    if (this.flashlight.castShadow !== cast) {
      this.flashlight.castShadow = cast;
      this.flashlight.shadow.needsUpdate = true;
    }
    this.flashlightClock += dt;
    const flicker = 0.93 + Math.sin(this.flashlightClock * 23.1) * 0.03 + Math.sin(this.flashlightClock * 6.7) * 0.04;
    const target = want ? 110 * flicker : 0;
    this.flashlight.intensity += (target - this.flashlight.intensity) * Math.min(1, dt * 16);
    this.flashlight.visible = this.flashlight.intensity > 0.5;
  }

  private togglePerf(): void {
    if (!this.menuOpen && !this.consoleOpen && this.isPlayable) {
      this.settings.set('showPerf', !this.settings.data.showPerf);
    }
  }

  /* =================================================================== helpers */
  private scheduleHint(lines: string[], delayMs: number): void {
    const id = window.setTimeout(() => {
      this.hintTimers = this.hintTimers.filter((x) => x !== id);
      if (!this.isPlayable) return;
      this.ui.hint(lines);
    }, delayMs);
    this.hintTimers.push(id);
  }

  private clearHintTimers(): void {
    for (const t of this.hintTimers) window.clearTimeout(t);
    this.hintTimers = [];
  }

  private resetPlaythrough(): void {
    this.bsodClicks = 0;
    this.bsodStage = 0;
    this.swallowAt = -1;
    this.coreSeen = false;
    this.landingShown = false;
    this.returnTimer = 0;
    this.narrative.reset();
    this.areaName = 'arrival';
    this.visited = new Set(['arrival']);
    this.narrative.setContext({ areaName: 'arrival', wakeKnown: false, visitedAreas: ['arrival'] });
    this.ui.closeConsole();
    this.ui.showBsod(false);
    this.ui.hint(null);
    this.ui.clearSubtitle();
    if (this.world) {
      this.world.reset();
      this.world.setGlitch(0.07);
      this.world.tunnel.setActive(false);
      this.world.tunnel.setProgress(0.055);
      this.world.tunnel.group.visible = false;
    }
    if (this.room) {
      this.room.result.setScreenMode('desktop');
      this.room.result.setAnomaly(0);
      this.room.result.setLamp(true);
      this.room.setReturnAnomaly(false);
    }
    this.renderer.setFx({ glitch: 0, chroma: 0, grain: 0.045, dofStrength: 0, radialBlur: 0, flash: 0, invert: 0, fade: 0 });
    this.flashlightOn = false;
    if (this.flashlight) this.flashlight.visible = false;
    this.player.controlEnabled = true;
    this.setTarget(null);
  }

  private fail(err: unknown): void {
    console.error('[game]', err);
    this.setPhase('error');
    this.player.controlEnabled = false;
    this.ui.setHudVisible(false);
    this.ui.showCrashScreen();
  }

  /* ================================================================== per-frame */
  frame(dt: number): void {
    const step = Math.min(0.05, dt);
    this.time += step;

    if (this.phase === 'bsod' && this.swallowAt > 0 && this.time >= this.swallowAt) {
      this.swallowAt = -1;
      void this.beginSwallow().catch((e) => this.fail(e));
    }

    if (this.phase === 'return') {
      this.returnTimer += step;
      if (!this.landingShown && this.returnTimer > 4.5) {
        this.landingShown = true;
        this.ui.subtitle('机の上に、さっきまで無かったものが落ちている。', 6500);
        this.audio.whisper();
      }
      if (this.returnTimer > 16 && this.returnTimer < 16.1) {
        this.ui.subtitle('03:47。時計は、まだ止まっている。Esc でメニュー。', 9000);
      }
    }

    const cam = this.renderer.camera;
    const canLook = this.isPlayable && this.input.lookActive && !this.menuOpen && !this.consoleOpen && !this.cinematics.active;
    if (cam && this.player.controlEnabled && !this.cinematics.active) {
      const axis = this.input.isActive() ? this.input.moveAxis() : { x: 0, y: 0 };
      const sprint = this.input.isActive() && this.input.isSprinting();
      this.player.update(step, { x: axis.x, y: axis.y, sprint }, this.collision, this.settings.data.cameraMotion);
      this.player.applyToCamera(cam);
    }
    const md = this.input.takeMouseDelta();
    if (canLook && (md.x !== 0 || md.y !== 0)) {
      this.player.look(md.x, md.y, this.settings.data.sensitivity);
      this.player.applyToCamera(cam);
    }

    if (this.cinematics?.active) this.cinematics.update(step, this.time);

    this.updateFlashlight(step);

    if (this.phase === 'room' || this.phase === 'return' || this.phase === 'zoom' || this.phase === 'bsod' || this.phase === 'swallow') {
      this.room.result.update(step, this.time);
    }
    if (this.phase === 'world' || this.phase === 'collapse') {
      this.world.update(step, this.time, cam.position);
    }

    this.updateAreaContext();
    this.updateEmitters();
    this.audio.updateListener(cam);
    this.updateFocus();
    this.updateWorldGlitch();
    this.updateBsodRect();

    this.renderer.render(step, this.time);
    if (this.ui.isPerfVisible) {
      this.ui.setPerf(this.renderer.stats, {
        phase: this.phase,
        pos: `${cam.position.x.toFixed(1)} ${cam.position.y.toFixed(1)} ${cam.position.z.toFixed(1)}`,
        lock: this.locked ? 'yes' : 'no',
      });
    }
  }

  /** Which of the five sectors the player is standing in (drives the console's `status`). */
  private areaAt(x: number, z: number): string {
    if (this.player.position.y < WORLD_Y - 2) return 'deep';
    if (z > LAYOUT.arrival.center.z - LAYOUT.arrival.half.z) return 'arrival';
    if (z > LAYOUT.plaza.max.z) return 'path';
    if (z >= LAYOUT.plaza.min.z && x >= LAYOUT.plaza.min.x && x <= LAYOUT.plaza.max.x) return 'plaza';
    if (z >= LAYOUT.core.min.z && z <= LAYOUT.core.max.z) return 'core';
    if (x < LAYOUT.plaza.min.x) return 'atrium';
    if (x > LAYOUT.plaza.max.x) return 'street';
    return 'core-bridge';
  }

  private visited = new Set<string>(['arrival']);

  private updateAreaContext(): void {
    if (this.phase !== 'world') return;
    const name = this.areaAt(this.player.position.x, this.player.position.z);
    if (!this.visited.has(name)) this.visited.add(name);
    if (this.areaName !== name) {
      this.areaName = name;
      this.narrative.setContext({ areaName: name, visitedAreas: [...this.visited] });
    }
  }

  private updateEmitters(): void {
    for (const e of this.emitterLoops) e.loop?.setActive(this.phase === 'world' || this.phase === 'collapse', 0.6);
  }

  private updateWorldGlitch(): void {
    const g = this.settings.data.glitch;
    if (this.phase === 'world' || this.phase === 'collapse') {
      this.world.setGlitch(this.phase === 'collapse' ? 0.85 : 0.12 + (this.coreSeen ? 0.1 : 0) + g * 0.22);
    }
    if (this.phase === 'world') {
      const near = Math.hypot(
        this.player.position.x - LAYOUT.monolith.x,
        this.player.position.z - (LAYOUT.monolith.z + 18),
      );
      if (near < 95) this.renderer.setFx({ glitch: 0.07 + g * 0.12 + clamp01((95 - near) / 95) * 0.1 });
    }
  }

  private updateBsodRect(): void {
    if (this.phase !== 'bsod' || !this.ui.bsodVisible) return;
    const cam = this.renderer.camera;
    const corners = [
      new THREE.Vector3(-0.33, 0.21, 0.03),
      new THREE.Vector3(0.33, 0.21, 0.03),
      new THREE.Vector3(-0.33, -0.21, 0.03),
      new THREE.Vector3(0.33, -0.21, 0.03),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      const p = c.clone().add(ROOM.monitorPos).project(cam);
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const w = Math.max(260, maxX - minX);
    const h = Math.max(170, maxY - minY);
    this.ui.setBsodRect(minX - 14, minY - 14, w + 28, h + 28);
  }

  onResize(): void {
    this.renderer.resize();
    this.updateBsodRect();
  }

  dispose(): void {
    this.clearHintTimers();
    this.audio.stopAllAmbience();
    for (const e of this.emitterLoops) e.loop?.dispose();
    this.emitterLoops = [];
    this.input.dispose();
  }
}
