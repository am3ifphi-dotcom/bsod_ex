/**
 * ゲーム進行の中央制御
 * フェーズ: room → lean/bsod → swallow → void → console/collapse → fall → roomAfter → (restart)
 */
import * as THREE from 'three';
import { Engine } from '../core/engine';
import { InputManager } from '../core/input';
import { AudioEngine } from '../core/audio';
import { SettingsStore } from '../core/settings';
import { CollisionWorld, CharacterController } from '../core/collision';
import { HUD } from '../ui/hud';
import { MenuUI } from '../ui/menu';
import { Room } from '../world/room';
import { buildVoidWorld, VOID_Y, wastelandHeight, type VoidContext } from '../world/voidWorld';
import { textures } from '../world/textures';
import { BsodSequence } from './bsod';
import { CollapseCinematic } from './cinematics';
import { execCommand, bootLines, resetConsoleState, type ConsoleLine } from './console';
import { parseDebugFlags, PHASE_KEYS, type PhaseJump, type DebugInfo } from './debug';
import { clamp, damp, lerp } from '../core/utils';
import { tickGlitchMaterials as tickGlitchMats } from '../fx/glitch';

export type Phase = 'warning' | 'room' | 'lean' | 'swallow' | 'voidIntro' | 'void' | 'collapse' | 'roomAfter';

export class Game {
  readonly engine: Engine;
  readonly settings: SettingsStore;
  readonly input = new InputManager();
  readonly audio = new AudioEngine();
  readonly collision = new CollisionWorld();
  readonly hud = new HUD();
  readonly menu: MenuUI;
  controller: CharacterController;

  room!: Room;
  voidCtx!: VoidContext;
  bsod!: BsodSequence;
  collapse!: CollapseCinematic;

  phase: Phase = 'warning';
  roomEnv: THREE.Texture | null = null;
  voidEnv: THREE.Texture | null = null;
  private yaw = 0;
  private pitch = -0.06;
  private bobT = 0;
  private footstepAcc = 0;
  private flashlight: THREE.SpotLight;
  private flashOn = false;
  private consoleOpen = false;
  private consoleHistory: string[] = [];
  private raycaster = new THREE.Raycaster();
  private interactables: { id: string; pos: THREE.Vector3; range: number; label: string; action: () => void }[] = [];
  private currentPrompt: string | null = null;
  private debug: DebugInfo;
  private phaseTime = 0;
  private ambientStarted = false;
  private toastShown = new Set<string>();
  private restartQueued = false;
  private consoleEl = document.getElementById('game-console')!;
  private consoleOut = document.getElementById('console-output')!;
  private consoleInput = document.getElementById('console-input') as HTMLInputElement;
  private screenCursor = false;
  /** ベンチマーク用の強制移動・視線 */
  private benchWish = new THREE.Vector3();
  private voidDepth = 0;

  constructor(container: HTMLElement, settings: SettingsStore) {
    this.settings = settings;
    this.engine = new Engine(container, settings);
    this.debug = parseDebugFlags();
    this.menu = new MenuUI(settings);
    this.controller = new CharacterController(this.collision);

    // 懐中電灯
    this.flashlight = new THREE.SpotLight(0xcfe2ff, 0, 18, 0.52, 0.45, 1.4);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 18;
    this.flashlight.position.set(0.18, -0.12, 0);
    this.flashlight.target.position.set(0, -0.05, -1);
    this.engine.camera.add(this.flashlight, this.flashlight.target);
    this.engine.scene.add(this.engine.camera);

    this.buildWorld(settings);
    this.bindUI(settings);
    this.setupInput();

    // 初期視点
    this.controller.teleport(0.2, 0, 0.85);
    this.yaw = 0.06;
    this.pitch = -0.04;
  }

  // ------------------------------------------------------------------
  private buildWorld(settings: SettingsStore): void {
    // ルーム
    this.room = new Room(this.collision);
    this.engine.scene.add(this.room.group);

    // 異世界
    this.voidCtx = buildVoidWorld(this.collision, this.engine.quality);
    this.engine.scene.add(this.voidCtx.group);

    // フェーズでフェード/フォグを切り替える
    this.engine.scene.fog = new THREE.FogExp2(0x04060c, 0.02);

    // BSOD / 崩壊
    this.bsod = new BsodSequence(this.room, this.voidCtx, this.audio, this.engine.camera, this.engine.scene);
    this.collapse = new CollapseCinematic(this.room, this.voidCtx, this.audio, this.engine.camera, () => settings.data.shake);
    this.collapse.setCrackParent(this.engine.scene);

    this.bsod.setArrivalCallback(() => {
      if (this.phase === 'swallow') {
        this.phase = 'voidIntro';
        this.phaseTime = 0;
        this.audio.startVoidDrone();
        this.audio.stopRoomTone(1.2);
        this.setPhaseFog('void');
        // 中心構造物のビーコン(空間音源)
        this.audio.startBeacon(this.voidCtx.beacon);
        // 操作復帰
        this.input.setMode('game');
        this.input.requestLock();
        this.hud.toast('……ここは、どこ', 3600);
      }
    });
  }

  private bindUI(settings: SettingsStore): void {
    this.menu.onResume = () => {
      this.menu.hide();
      if (!this.consoleOpen && (this.phase === 'room' || this.phase === 'void' || this.phase === 'roomAfter')) {
        this.input.setMode('game');
        this.input.requestLock();
      }
    };
    this.menu.onRestart = () => {
      this.menu.hide();
      this.restartGame();
    };
    settings.onChange((s, key) => {
      if (key === 'masterVolume' || key === 'all') this.audio.setVolume(s.masterVolume);
      if (key === 'quality' || key === 'all') {
        this.engine.applyQuality();
      }
    });
    this.audio.setVolume(settings.data.masterVolume);

    // コンソールUI
    this.consoleInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitConsole();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeConsole();
      } else if (e.key === 'c' && this.consoleInput.value === '' && !e.repeat && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 空欄で C → 閉じる(Esc/Cでの開閉)
        e.preventDefault();
        this.closeConsole();
      }
      e.stopPropagation();
    });
    this.input.watchIME(this.consoleInput);
    document.getElementById('console-close')!.addEventListener('click', () => this.closeConsole());
  }

  private setupInput(): void {
    this.input.attachCanvas(this.engine.canvas);
    this.input.onPointerLockLost = () => {
      if (this.consoleOpen) return;
      if (this.phase === 'lean' || this.phase === 'swallow') return;
      if (this.collapse.active) return;
      // Esc でメニュー
      if (this.phase === 'room' || this.phase === 'void' || this.phase === 'roomAfter') {
        this.openMenu();
      }
    };
    this.input.onAction = (code) => {
      if (code === 'F3') {
        this.hud.togglePerf();
        return;
      }
      if (this.input.mode !== 'game') return;
      if (code === 'KeyF') {
        this.flashOn = !this.flashOn;
        this.flashlight.intensity = this.flashOn ? 26 : 0;
        this.audio.uiBlip();
        this.hud.toast(this.flashOn ? 'ライト ON' : 'ライト OFF', 1200);
      }
      if (code === 'KeyC') {
        if (this.phase === 'void' || this.phase === 'voidIntro') {
          this.openConsole();
        }
      }
      if (code === 'KeyE') {
        this.tryInteract();
      }
      if (code === 'KeyR' && this.phase === 'roomAfter') {
        this.restartGame();
      }
      if (this.debug.enabled) {
        const jump = PHASE_KEYS[code];
        if (jump) this.debugJump(jump);
      }
    };
  }

  // ------------------------------------------------------------------
  //  フェーズ制御
  // ------------------------------------------------------------------
  startGame(): void {
    void this.audio.init().then(() => {
      this.audio.setVolume(this.settings.data.masterVolume);
    });
    this.phase = 'room';
    this.phaseTime = 0;
    this.input.setMode('game');
    this.input.requestLock();
    this.startAmbience();
    this.hud.toast('WASD: 移動 / E: 調べる / F: ライト / C: コンソール', 5200);
  }

  private startAmbience(): void {
    if (this.ambientStarted) return;
    this.ambientStarted = true;
    void this.audio.init();
    this.audio.startRoomTone();
    // 環境マップ
    if (this.engine.scene.environment === null) {
      // main.ts で設定済み
    }
    this.setPhaseFog('room');
    this.room.setLighting('normal');
  }

  private setPhaseFog(phase: Phase | 'fall'): void {
    const fog = this.engine.scene.fog as THREE.FogExp2;
    // 環境マップの切り替え(自室=屋内IBL / 異世界=野外IBL)
    const wantVoid = phase === 'void' || phase === 'voidIntro' || phase === 'collapse' || phase === 'fall';
    const env = wantVoid ? (this.voidEnv ?? this.roomEnv) : this.roomEnv;
    if (this.engine.scene.environment !== env) this.engine.scene.environment = env;
    switch (phase) {
      case 'room':
      case 'roomAfter':
        fog.color.set(0x04060c);
        fog.density = 0.022;
        break;
      case 'lean':
      case 'swallow':
        fog.color.set(0x030510);
        fog.density = 0.018;
        break;
      case 'void':
      case 'voidIntro':
        fog.color.set(0x0a1836);
        fog.density = this.engine.quality.fogDensity;
        break;
      case 'collapse':
        fog.color.set(0x081228);
        fog.density = 0.012;
        break;
      case 'fall':
        fog.color.set(0x050a1c);
        fog.density = 0.006;
        break;
    }
  }

  // ------------------------------------------------------------------
  //  メインループ
  // ------------------------------------------------------------------
  update(dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.05);
    this.phaseTime += dt;
    const time = this.engine.clock.elapsedTime;

    // 世界の更新
    this.room.update(dt);
    this.room.updateAnomalies(dt);
    for (const fn of this.voidCtx.tickables) fn(dt, time);
    tickGlitchMats(time, this.currentGlitchScale());

    // ポストのグリッチ強度
    this.updatePost(dt);

    // 音声リスナー
    this.audio.syncListener(this.engine.camera);

    // フェーズ別
    switch (this.phase) {
      case 'room':
      case 'void':
      case 'roomAfter':
        this.updatePlayer(dt);
        break;
      case 'lean':
      case 'swallow':
        this.bsod.update(dt, this.settings.data.glitchIntensity);
        if (this.bsod.state === 'arrived' && this.phase === 'swallow') {
          // callback 済み
        }
        break;
      case 'voidIntro':
        this.updatePlayer(dt, true);
        if (this.phaseTime > 2.2) {
          this.phase = 'void';
          this.phaseTime = 0;
          this.hud.toast('……見ろ。遠くに、何か立っている', 4200);
        }
        break;
      case 'collapse':
        this.collapse.update(dt);
        if (this.collapse.finished) {
          this.enterRoomAfter();
        }
        break;
      default:
        break;
    }

    // HUD
    this.hud.tick(
      dt,
      `draws ${this.engine.renderer.info.render.calls}\ntris  ${this.engine.renderer.info.render.triangles}\nscale ${this.engine.renderScale.toFixed(2)}\nphase ${this.phase}`,
    );
    this.engine.tickDynamicResolution(dt);
    this.engine.render(dt);
  }

  private currentGlitchScale(): number {
    const g = this.settings.data.glitchIntensity;
    switch (this.phase) {
      case 'room':
        return 0.15 * g;
      case 'lean':
        return (0.3 + this.bsod.corruptionLevel * 2.2) * g;
      case 'swallow':
        return 2.4 * g;
      case 'void':
      case 'voidIntro':
        return 0.55 * g;
      case 'collapse':
        return (this.collapse.phase === 'shatter' || this.collapse.phase === 'fall' ? 1.6 : 0.8) * g;
      case 'roomAfter':
        return 0.35 * g;
      default:
        return 0.2 * g;
    }
  }

  private updatePost(dt: number): void {
    const g = this.settings.data.glitchIntensity;
    const post = this.engine.post;
    switch (this.phase) {
      case 'lean':
        post.setGlitch({
          intensity: this.bsod.corruptionLevel * 0.55 * g,
          tear: this.bsod.corruptionLevel * 0.7 * g,
          block: this.bsod.corruptionLevel * 0.5 * g,
          rgb: (0.15 + this.bsod.corruptionLevel) * g,
          flicker: this.bsod.corruptionLevel * 0.3 * g,
        });
        post.setDof(0.85, 0.00012, 0.011);
        break;
      case 'swallow':
        post.setGlitch({ intensity: 0.85 * g, tear: 1.0 * g, block: 0.8 * g, rgb: 1.0 * g, flicker: 0.25 * g });
        break;
      case 'void':
      case 'voidIntro':
        post.setGlitch({ intensity: 0.16 * g, tear: 0.12 * g, block: 0.1 * g, rgb: 0.22 * g, flicker: 0.06 * g });
        post.setDof(14, 0.00002, 0.003);
        break;
      case 'collapse':
        post.setGlitch({ intensity: 0.35 * g, tear: 0.3 * g, block: 0.28 * g, rgb: 0.4 * g, flicker: 0.12 * g });
        break;
      case 'roomAfter':
        post.setGlitch({ intensity: 0.12 * g, tear: 0.08 * g, block: 0.05 * g, rgb: 0.12 * g, flicker: 0.05 * g });
        post.setDof(2.2, 0.00004, 0.006);
        break;
      default:
        post.setGlitch({ intensity: 0.1 * g, tear: 0.05 * g, block: 0.04 * g, rgb: 0.1 * g, flicker: 0.04 * g });
        post.setDof(3, 0.00003, 0.005);
        break;
    }
    // フェード(崩壊中の暗部)
    if (this.collapse.active && this.collapse.phase === 'dark') {
      post.fade = Math.min(0.92, this.collapse.time * 1.15);
    } else if (this.collapse.active && this.collapse.phase === 'roomApproach') {
      post.fade = Math.max(0, 0.92 - this.collapse.time * 0.85);
    } else {
      post.fade = damp(post.fade, 0, 4, dt);
    }
  }

  // ------------------------------------------------------------------
  //  プレイヤー操作(部屋 / 異世界)
  // ------------------------------------------------------------------
  private updatePlayer(dt: number, locked = false): void {
    const settings = this.settings;
    const sens = settings.data.sensitivity;
    const shake = settings.data.shake;

    if (!this.consoleOpen && !locked && this.input.mode === 'game' && this.input.pointerLocked) {
      const d = this.input.consumeMouseDelta();
      this.yaw -= d.x * 0.0021 * sens;
      this.pitch -= d.y * 0.0021 * sens;
      this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08);
    }

    // 移動
    const mv = this.input.moveVector();
    const speed = (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? 6.2 : 3.15) * (locked ? 0 : 1);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(mv.x * cos - mv.z * sin, 0, -mv.x * sin - mv.z * cos);
    if (this.input.mode !== 'game' || this.consoleOpen) wish.set(0, 0, 0);
    if (this.benchWish.lengthSq() > 0) wish.copy(this.benchWish);
    this.controller.update(wish, speed, dt);

    // カメラ
    const eye = this.controller.eyePosition(new THREE.Vector3());
    // ヘッドボブ(控えめ)
    const horizSpeed = Math.hypot(this.controller.velocity.x, this.controller.velocity.z);
    this.bobT += dt * horizSpeed * 1.65;
    const bobAmp = shake * 0.022 * clamp(horizSpeed / 3, 0, 1.4);
    const bobY = Math.sin(this.bobT * 2) * bobAmp;
    const bobX = Math.cos(this.bobT) * bobAmp * 0.7;
    eye.y += bobY;
    eye.x += bobX * Math.cos(this.yaw);
    eye.z += bobX * Math.sin(this.yaw);

    this.engine.camera.position.lerp(eye, Math.min(1, dt * 18));
    this.engine.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    // 足音
    if (this.controller.grounded && horizSpeed > 0.6) {
      this.footstepAcc += dt * horizSpeed;
      const stride = this.input.isDown('ShiftLeft') ? 2.6 : 1.85;
      if (this.footstepAcc > stride) {
        this.footstepAcc = 0;
        const surface = this.phase === 'room' || this.phase === 'roomAfter' ? 'wood' : 'stone';
        this.audio.footstep(surface, clamp(horizSpeed / 3, 0.4, 1.1));
      }
    }

    // 対話判定
    this.updateInteractions();
    // クリックでも調べる
    if (this.input.mode === 'game' && this.input.pointerLocked && !this.consoleOpen) {
      for (const b of this.input.consumeClicks()) {
        if (b === 0 && this.currentPrompt) this.tryInteract();
      }
    }

    // 異世界の近接イベント
    if (this.phase === 'void' || this.phase === 'voidIntro') {
      this.updateVoidProximity();
    }
  }

  private updateInteractions(): void {
    if (this.phase === 'swallow' || this.phase === 'lean') {
      this.hud.setPrompt(null);
      return;
    }
    // レイキャスト(中央)
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.engine.camera);
    let best: { id: string; label: string; action: () => void; dist: number } | null = null;
    for (const it of this.interactables) {
      const dist = it.pos.distanceTo(this.engine.camera.position);
      if (dist > it.range) continue;
      const dir = it.pos.clone().sub(this.engine.camera.position).normalize();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.engine.camera.quaternion);
      if (dir.dot(fwd) < 0.72) continue;
      if (!best || dist < best.dist) {
        best = { id: it.id, label: it.label, action: it.action, dist };
      }
    }
    if (best) {
      this.hud.setPrompt(`[E] ${best.label}`);
      this.currentPrompt = best.id;
    } else {
      this.hud.setPrompt(null);
      this.currentPrompt = null;
    }
  }

  private tryInteract(): void {
    if (this.currentPrompt === 'pc') {
      const pc = this.interactables.find((i) => i.id === 'pc');
      pc?.action();
    } else if (this.currentPrompt === 'replay') {
      this.restartGame();
    }
  }

  private updateVoidProximity(): void {
    const pos = this.engine.camera.position;
    const toCore = Math.hypot(pos.x - this.voidCtx.wakeUpLook.x, pos.z - this.voidCtx.wakeUpLook.z);
    if (toCore < 42 && !this.toastShown.has('wake')) {
      this.toastShown.add('wake');
      this.hud.toast('碑文が読める —— WAKE_UP', 5200);
    }
    const toDepths = Math.hypot(pos.x + 150, pos.z + 230);
    this.voidDepth = clamp(1 - toDepths / 90, 0, 1);
    this.audio.setVoidDepth(this.voidDepth);
    // コンソールの存在に気づく(破損UI付近)
    if (Math.hypot(pos.x - 34, pos.z + 220) < 40 && !this.toastShown.has('consoleHint')) {
      this.toastShown.add('consoleHint');
      this.hud.toast('破損した端末:「PRESS [C] TO OPEN TERMINAL」', 5200);
    }
    if (Math.hypot(pos.x - 140, pos.z + 220) < 55 && !this.toastShown.has('cityHint')) {
      this.toastShown.add('cityHint');
      this.hud.toast('都市の残骸 —— 記憶の断片が侵食されている', 4200);
    }
  }

  // ------------------------------------------------------------------
  //  対話: 登録
  // ------------------------------------------------------------------
  registerInteractions(): void {
    this.interactables = [];
    const pcPos = this.room.lookTargets.get('pc')!.clone();
    this.interactables.push({
      id: 'pc',
      pos: pcPos,
      range: 2.35,
      label: 'PCをのぞき込む',
      action: () => {
        if (this.phase !== 'room' && this.phase !== 'roomAfter') return;
        if (this.phase === 'roomAfter') {
          this.restartGame();
          return;
        }
        this.beginLean();
      },
    });
    const replayPos = pcPos;
    this.interactables.push({
      id: 'replay',
      pos: replayPos,
      range: 2.35,
      label: '最初からやり直す',
      action: () => this.restartGame(),
    });
    // 味わい対象
    for (const [id, label] of [
      ['bed', 'ベッドを見る'],
      ['window', '窓の外を見る'],
      ['skull', '棚の上を見る'],
    ] as [string, string][]) {
      const pos = this.room.lookTargets.get(id);
      if (pos) {
        this.interactables.push({ id: `look_${id}`, pos: pos.clone(), range: 3.2, label, action: () => this.lookFlavor(id) });
      }
    }
  }

  private lookFlavor(id: string): void {
    const lines: Record<string, string> = {
      bed: '寝る気にはなれない。',
      window: '街の灯が、いつもより遠い。',
      skull: '……いつから、そこにあった?',
    };
    this.hud.toast(lines[id] ?? '', 2800);
    this.audio.uiBlip();
  }

  // ------------------------------------------------------------------
  //  BSOD 開始
  // ------------------------------------------------------------------
  private beginLean(): void {
    this.phase = 'lean';
    this.phaseTime = 0;
    this.input.releaseLock();
    this.input.setMode('ui');
    this.screenCursor = true;
    this.engine.canvas.style.cursor = 'crosshair';
    this.bsod.beginLean();
    this.setPhaseFog('lean');
    this.hud.toast('画面の「:(」をクリック', 3600);
  }

  /** lean 中のクリック(マウス) */
  handleScreenClick(x: number, y: number): void {
    if (this.phase !== 'lean') return;
    if (this.bsod.isOverSadFace(x, y, window.innerWidth, window.innerHeight)) {
      this.bsod.click();
      if (this.bsod.clicks >= this.bsod.maxClicks) {
        this.phase = 'swallow';
        this.phaseTime = 0;
        this.setPhaseFog('swallow');
        this.screenCursor = false;
        this.engine.canvas.style.cursor = 'default';
      }
    }
  }

  handleMouseMoveCursor(x: number, y: number): void {
    if (this.phase !== 'lean') return;
    const over = this.bsod.isOverSadFace(x, y, window.innerWidth, window.innerHeight);
    this.engine.canvas.style.cursor = over ? 'pointer' : 'crosshair';
  }

  /** lean 中の Esc: いったん離れる */
  cancelLean(): void {
    if (this.phase !== 'lean') return;
    this.phase = 'room';
    this.bsod.reset();
    this.room.setLighting('normal');
    this.screenCursor = false;
    this.engine.canvas.style.cursor = 'default';
    this.input.setMode('game');
    this.input.requestLock();
    this.setPhaseFog('room');
  }

  // ------------------------------------------------------------------
  //  コンソール
  // ------------------------------------------------------------------
  openConsole(): void {
    if (this.consoleOpen) return;
    this.consoleOpen = true;
    this.consoleEl.classList.add('open');
    this.input.setMode('ui');
    this.input.releaseLock();
    this.menu.hideResumeHint();
    this.audio.uiOpen();

    // 履歴表示(初回はブート行)
    if (this.consoleHistory.length === 0) {
      for (const line of bootLines()) this.appendConsoleLine(line);
    }
    window.setTimeout(() => this.consoleInput.focus(), 30);
  }

  closeConsole(): void {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.consoleEl.classList.remove('open');
    this.consoleInput.blur();
    this.audio.uiClose();
    if (this.phase === 'room' || this.phase === 'void' || this.phase === 'roomAfter') {
      this.input.setMode('game');
      this.input.requestLock();
      // ロックに失敗した場合の保険
      window.setTimeout(() => {
        if (!this.input.pointerLocked && !this.consoleOpen && !this.menu.visible) {
          this.menu.showResumeHint();
        }
      }, 300);
    }
  }

  private submitConsole(): void {
    const raw = this.consoleInput.value;
    this.consoleInput.value = '';
    const result = execCommand(raw);
    if (result.clear) {
      this.consoleOut.innerHTML = '';
    } else {
      for (const line of result.lines) this.appendConsoleLine(line);
    }
    this.consoleHistory.push(raw);
    this.audio.consoleExec();
    if (result.wakeUp) {
      this.audio.consoleError();
      window.setTimeout(() => {
        this.closeConsole();
        this.startCollapse();
      }, 900);
    }
  }

  private appendConsoleLine(line: ConsoleLine): void {
    const div = document.createElement('div');
    div.className = `line-${line.cls}`;
    div.textContent = line.text;
    this.consoleOut.appendChild(div);
    this.consoleOut.scrollTop = this.consoleOut.scrollHeight;
  }

  // ------------------------------------------------------------------
  //  崩壊 → 帰還
  // ------------------------------------------------------------------
  private startCollapse(): void {
    this.phase = 'collapse';
    this.phaseTime = 0;
    this.input.setMode('locked-cinematic');
    this.input.releaseLock();
    this.hud.setPrompt(null);
    this.setPhaseFog('collapse');
    const pos = this.controller.position.clone();
    this.collapse.start(pos, this.yaw);
    this.collapse.setCrackParent(this.engine.scene);
    this.hud.setPrompt(null);
  }

  private enterRoomAfter(): void {
    this.phase = 'roomAfter';
    this.phaseTime = 0;
    this.input.setMode('game');
    this.input.requestLock();
    this.controller.teleport(0.2, 0, 0.85);
    this.yaw = 0.1;
    this.pitch = -0.05;
    this.room.group.visible = true;
    this.room.setLighting('after');
    this.room.setAfterglow(true);
    this.room.spawnAnomalies();
    this.room.setClockTime(2, 17);
    this.setPhaseFog('roomAfter');
    this.audio.startRoomTone();
    this.audio.stopVoidDrone(1.5);
    this.audio.stopBeacon();
    this.hud.toast('……自室。ただ、少しだけ、おかしい。', 4600);
    // PC のプロンプトを差し替え
    const pc = this.interactables.find((i) => i.id === 'pc');
    if (pc) pc.label = 'PCに触れる(最初からやり直す)';
  }

  restartGame(): void {
    if (this.restartQueued) return;
    this.restartQueued = true;
    window.setTimeout(() => {
      this.restartQueued = false;
      // 完全初期化
      this.bsod.reset();
      this.collapse.reset(this.engine.scene);
      this.room.reset();
      this.room.group.visible = true;
      this.room.setLighting('normal');
      resetConsoleState();
      this.consoleOut.innerHTML = '';
      this.consoleHistory = [];
      this.toastShown.clear();
      this.phase = 'room';
      this.phaseTime = 0;
      this.controller.teleport(0.2, 0, 0.85);
      this.yaw = 0.06;
      this.pitch = -0.04;
      this.flashOn = false;
      this.flashlight.intensity = 0;
      this.engine.post.fade = 0;
      this.setPhaseFog('room');
      this.audio.stopVoidDrone(1);
      this.audio.stopBeacon();
      this.audio.startRoomTone();
      if (!this.input.pointerLocked) {
        this.input.setMode('game');
        this.input.requestLock();
      }
      this.hud.toast('最初から、やり直す。', 3000);
    }, 60);
  }

  // ------------------------------------------------------------------
  //  メニュー / デバッグ
  // ------------------------------------------------------------------
  /** Esc / F3 (UIモード中のみ。ゲームモードは InputManager 側で処理) */
  handleUiKey(code: string): void {
    if (code === 'Escape' && this.consoleOpen) {
      this.closeConsole();
      return;
    }
    if (this.input.mode === 'game') return;
    if (code === 'Escape' && this.menu.visible) {
      this.menu.hide();
      if (!this.consoleOpen && (this.phase === 'room' || this.phase === 'void' || this.phase === 'roomAfter')) {
        this.input.setMode('game');
        this.input.requestLock();
      }
    }
    if (code === 'F3') this.hud.togglePerf();
  }

  openMenu(): void {
    this.menu.show();
    this.input.releaseLock();
    this.input.setMode('ui');
    this.audio.uiOpen();
  }

  private debugJump(jump: PhaseJump): void {
    switch (jump) {
      case 'room':
        this.restartGame();
        break;
      case 'bsod':
        this.beginLean();
        break;
      case 'void':
        this.bsod.reset();
        this.room.group.visible = false;
        this.phase = 'void';
        this.controller.teleport(0, wastelandHeight(0, -6) + VOID_Y, -6);
        this.audio.startVoidDrone();
        this.setPhaseFog('void');
        break;
      case 'console':
        this.debugJump('void');
        window.setTimeout(() => this.openConsole(), 200);
        break;
      case 'collapse':
        if (this.phase !== 'void') {
          this.debugJump('void');
          this.controller.teleport(this.voidCtx.collapseAnchor.x, this.voidCtx.collapseAnchor.y, this.voidCtx.collapseAnchor.z);
        }
        window.setTimeout(() => this.startCollapse(), 100);
        break;
      case 'fall':
        this.debugJump('collapse');
        break;
      case 'return':
        this.enterRoomAfter();
        break;
    }
  }

  /** デバッグ: 計測用の統計 */
  get stats(): ReturnType<HUD['stats']> {
    return this.hud.stats();
  }

  // ---------------- ベンチマーク / デバッグ用フック ----------------
  benchSetLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  benchSetWalk(x: number, _y: number, z: number): void {
    this.benchWish.set(x, 0, z);
    if (this.benchWish.lengthSq() > 0) this.benchWish.normalize();
  }

  benchTeleport(x: number, y: number, z: number): void {
    this.controller.teleport(x, y, z);
    this.engine.camera.position.set(x, y, z);
  }

  benchBeginLean(): void {
    this.beginLean();
  }

  benchOpenConsole(): void {
    this.openConsole();
  }

  benchExec(cmd: string): void {
    this.consoleInput.value = cmd;
    this.submitConsole();
  }

  showBenchmarkResult(r: { seconds: number; avgFps: number; onePercentLowFps: number; minFps: number; samples: number }): void {
    this.hud.togglePerf(true);
    this.hud.toast(
      `計測完了 ${r.seconds.toFixed(0)}s — 平均 ${r.avgFps.toFixed(1)}fps / 1%low ${r.onePercentLowFps.toFixed(1)}fps`,
      15000,
    );
  }
}
