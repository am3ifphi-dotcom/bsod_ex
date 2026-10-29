import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioManager } from './audio/AudioManager';
import { BedroomScene } from './world/BedroomScene';
import { GlitchWorld } from './world/GlitchWorld';
import { FirstPersonController } from './player/FirstPersonController';
import { ConsoleUI } from './ui/ConsoleUI';
import { PostFX } from './post/PostFX';

type GlitchKind = 'bend' | 'tear' | 'mash' | 'sort' | 'roll' | 'ghost';

interface GlitchEvent {
  kind: GlitchKind;
  age: number;
  dur: number;
  peak: number;
}

type GamePhase =
  | 'TITLE'
  | 'ROAM_BEDROOM'
  | 'INSPECT_PC'
  | 'EXIT_INSPECT'
  | 'SUCTION_CUTSCENE'
  | 'GLITCH_ARRIVAL_CUTSCENE'
  | 'ROAM_GLITCH'
  | 'COLLAPSE_CUTSCENE'
  | 'RETURN_LANDING'
  | 'AFTERMATH_ROAM';

class BsodExperienceApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly postFX: PostFX;

  private readonly audio = new AudioManager();
  private readonly bedroom = new BedroomScene();
  private readonly glitchWorld = new GlitchWorld();
  private readonly player: FirstPersonController;
  private readonly consoleUI: ConsoleUI;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndcVec = new THREE.Vector2();
  private readonly scratchCamDir = new THREE.Vector3();
  private readonly scratchToMon = new THREE.Vector3();

  private phase: GamePhase = 'TITLE';
  private paused = false;
  private elapsed = 0;
  private lastFrameTime = performance.now();

  // Pointer-lock spike guard + iframe drag-to-look fallback!
  private lockWarmupEvents = 0;
  private ignoreMouseUntil = 0;
  private isDraggingLook = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private dragTravelPx = 0;

  // Act 2 BSOD & Predatory Suction state
  private inspectBlend = 0;
  private exitInspectBlend = 0;
  private clickCount = 0;
  private madness = 0;
  private targetMadness = 0;
  private jawOpen = 0;
  private jawVel = 0;
  private targetJawOpen = 0;
  private clickPulse = 0;
  private hoverFace = false;
  private wasHoveringFace = false;
  private cursorMonitorUv = new THREE.Vector2(0.5, 0.5);
  private suctionTimer = 0;
  private readonly suctionDuration = 7.2;
  private suctionWhooshPlayed = false;
  private suctionBurstMidPlayed = false;
  private suctionCues: Record<string, boolean> = {};
  private aftermath = false;

  // Act 3 Bold Aerial Sky-Rift Arrival state
  private glitchArrivalTimer = 0;
  private glitchArrivalRollCuePlayed = false;
  private glitchArrivalLanded = false;

  // Staged glitch-event scheduler: every disturbance is an authored signature with its own sound.
  private glitchEvents: GlitchEvent[] = [];
  private periodicWarpCooldown = 6.2;

  // First inspection staging: the panel re-syncs, the room tone drains, and the glass ticks —
  // no imagery beyond the authentic BSOD and the ':(' it already shows.
  private firstContactTimer = -1;
  private firstContactDone = false;
  private firstContactCues: Record<string, boolean> = {};

  // Continuous Horror Tension & Heartbeat state
  private heartbeatCooldown = 0.8;
  private roomDreadTimer = 4.8;
  private horrorPulse = 0;
  private readonly behindNeckSoundPos = new THREE.Vector3(-0.12, 1.32, 0.76);
  private readonly roomCornerSoundPos = new THREE.Vector3(0.95, 1.35, -0.55);

  // Act 4 Collapse & Freefall state
  private collapseTimer = 0;
  private readonly collapseDuration = 9.6;
  private readonly collapseOrigin = new THREE.Vector3();
  private collapseBaseYaw = 0;
  private collapseStepFlags = { s1: false, s2: false };
  private collapseCrackSfxPlayed = false;
  private collapseShatterSfxPlayed = false;
  private collapseWindStarted = false;
  private collapseMidCuePlayed = false;

  // Act 5 Return Landing state
  private landingTimer = 0;

  // PostFX transients
  private extraGlitchBurst = 0;
  private screenFlash = 0;
  private subtitleTimeout: number | null = null;

  // DOM Elements
  private readonly canvasWrap = document.getElementById('canvas-wrap')!;
  private readonly titleOverlay = document.getElementById('title-overlay')!;
  private readonly loadingFill = document.getElementById('loading-bar-fill')!;
  private readonly loadingStatus = document.getElementById('loading-status')!;
  private readonly startBtn = document.getElementById('start-btn') as HTMLButtonElement;

  private readonly hudEl = document.getElementById('hud')!;
  private readonly crosshairEl = document.getElementById('crosshair')!;
  private readonly pcCursorEl = document.getElementById('pc-cursor')!;
  private readonly interactPromptEl = document.getElementById('interact-prompt')!;
  private readonly worldHintEl = document.getElementById('world-hint')!;
  private readonly subtitleEl = document.getElementById('subtitle-banner')!;
  private readonly aftermathBarEl = document.getElementById('aftermath-bar')!;

  private readonly pauseModal = document.getElementById('pause-modal')!;
  private readonly pausePhaseLabel = document.getElementById('pause-phase-label')!;
  private readonly sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
  private readonly volSlider = document.getElementById('vol-slider') as HTMLInputElement;
  private readonly resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
  private readonly restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;

  constructor() {
    // 1.0x pixel ratio guarantees buttery 60 FPS across laptops, VMs, and HiDPI displays!
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      stencil: true,
      depth: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    this.canvasWrap.appendChild(this.renderer.domElement);

    // Far plane pushed out to 1600m so the horizon megastructures, cloud decks and sky vault are
    // never clipped (they sit between 230m and ~700m from the player).
    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.05, 1600);
    this.postFX = new PostFX(window.innerWidth, window.innerHeight);
    this.postFX.validate(this.renderer);

    this.player = new FirstPersonController(this.camera);
    this.consoleUI = new ConsoleUI(this.audio);

    this.scene.background = new THREE.Color(0x02060f);
    this.scene.add(this.bedroom.group);
    this.scene.add(this.glitchWorld.group);
    this.glitchWorld.group.visible = false;

    this.bindCallbacks();
    this.bindInputs();
  }

  public async init(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();

    let audioPct = 0;
    let modelPct = 0;
    const updateProgress = (msg: string) => {
      const pct = Math.min(99, Math.round(audioPct * 0.4 + modelPct * 0.6));
      this.loadingFill.style.width = `${pct}%`;
      this.loadingStatus.textContent = `${msg} ${pct}%`;
    };

    const audioPromise = this.audio.preloadFiles((done, total) => {
      audioPct = (done / total) * 100;
      updateProgress('環境音・グリッチ音響を読み込み中...');
    });

    const bedroomPromise = this.bedroom.load(gltfLoader, texLoader).then(() => {
      modelPct += 50;
      updateProgress('深夜の自室モデルを展開中...');
    });

    const glitchPromise = this.glitchWorld.load(gltfLoader, texLoader).then(() => {
      modelPct += 50;
      updateProgress('異世界構造物を構築中...');
    });

    await Promise.all([audioPromise, bedroomPromise, glitchPromise]);

    // Pre-compile BOTH Bedroom and Glitch World shaders upfront so transitions have 0.0ms hitch!
    this.loadingStatus.textContent = 'GPUシェーダーを事前コンパイル中... 99%';
    this.bedroom.group.visible = true;
    this.glitchWorld.group.visible = true;
    this.renderer.compile(this.scene, this.camera);
    this.glitchWorld.group.visible = false;

    this.player.resetToBedroomSpawn(this.bedroom.monitorWorldPos);

    this.loadingFill.style.width = '100%';
    this.loadingStatus.textContent = '準備完了 — マウスと音声を使用します';
    document.getElementById('loading-block')?.classList.add('hidden');
    this.startBtn.classList.remove('hidden');
    this.startBtn.disabled = false;

    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.animate);
  }

  private bindCallbacks(): void {
    this.player.onFootstep = () => {
      if (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM') {
        const surf = this.bedroom.getFloorSurface(this.player.position.x, this.player.position.z);
        this.audio.playFootstep(surf);
      } else if (this.phase === 'ROAM_GLITCH') {
        this.audio.playFootstep('glitch');
      }
    };

    this.glitchWorld.onAnomalyPulse = () => {
      if (this.phase === 'ROAM_GLITCH') {
        this.audio.playOneShot('anomaly_tremor', { volume: 0.36, reverb: 0.6 });
        this.audio.playOneShot('scrapemare', {
          volume: 0.20,
          rate: 0.86,
          duration: 2.4,
          fadeInSec: 0.25,
          reverb: 0.55,
        });
        // The world's own surge drives the signature, so the screen-space distortion always
        // corresponds to something happening out in the terrain (towers shearing, sky-eye flaring).
        const primary = this.triggerRandomGlitch(0.82 + this.glitchWorld.anomalyIntensity * 0.16);
        if (primary !== 'bend' && Math.random() < 0.45) this.triggerSpatialWave(0.72, 1.05, true);
        // 40% of surges stack a second signature ~3 frames later, so the "language" keeps changing.
        if (Math.random() < 0.4) {
          window.setTimeout(() => {
            if (this.phase === 'ROAM_GLITCH') {
              const follow: GlitchKind[] = ['tear', 'mash', 'sort', 'roll', 'ghost'];
              this.triggerGlitch(follow[Math.floor(Math.random() * follow.length)], 0.5, 0.42);
            }
          }, 130);
        }
        this.horrorPulse = Math.max(this.horrorPulse, 0.38);
      }
    };

    this.consoleUI.onCloseRequest = () => {
      if (this.phase === 'ROAM_GLITCH' && !this.paused) {
        this.requestLockSafe();
      }
    };

    this.consoleUI.onWrongCommand = () => {
      // Invalid command: the frame itself rejects the input (console_error is already voiced
      // inside ConsoleUI, so we only add the optical tear and a thin signal crack here).
      this.triggerGlitch('tear', 0.62, 0.3, true);
      this.audio.playOneShot('glitch_slice', { volume: 0.20, rate: 1.16, reverb: 0.4 });
    };

    this.consoleUI.onWakeUpCommand = () => {
      this.beginCollapseSequence();
    };
  }

  private bindInputs(): void {
    window.addEventListener('resize', () => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.postFX.setSize(w, h);
    });

    // CRITICAL: Request Pointer Lock & unlock Audio SYNCHRONOUSLY inside user click gesture!
    this.startBtn.addEventListener('click', () => {
      this.requestLockSafe();
      this.audio.unlock();
      this.titleOverlay.classList.add('hidden');
      this.hudEl.classList.remove('hidden');
      this.startFreshExperience();
    });

    this.resumeBtn.addEventListener('click', () => {
      if (this.isPointerLockDesired(false)) {
        this.requestLockSafe();
      }
      this.setPaused(false);
    });

    this.restartBtn.addEventListener('click', () => {
      this.requestLockSafe();
      this.setPaused(false);
      this.startFreshExperience();
    });

    this.sensSlider.addEventListener('input', () => {
      this.player.sensitivity = parseFloat(this.sensSlider.value);
    });

    this.volSlider.addEventListener('input', () => {
      this.audio.setMasterVolume(parseFloat(this.volSlider.value));
    });

    window.addEventListener('keydown', (e) => {
      if (this.phase === 'TITLE') return;

      if (this.consoleUI.isOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          this.consoleUI.close(true);
        }
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.phase === 'INSPECT_PC' && this.clickCount < 3 && !this.paused) {
          this.exitPcInspection();
          return;
        }
        this.setPaused(!this.paused);
        return;
      }

      if (this.paused) return;

      if (e.code === 'KeyC' && this.phase === 'ROAM_GLITCH') {
        e.preventDefault();
        this.player.clearKeys();
        this.audio.playOneShot('ui_hover', { volume: 0.45, rate: 1.15 });
        this.consoleUI.open();
        return;
      }

      if (e.code === 'KeyR' && this.phase === 'AFTERMATH_ROAM') {
        e.preventDefault();
        this.requestLockSafe();
        this.startFreshExperience();
        return;
      }

      if (e.code === 'KeyE') {
        if (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM') {
          if (this.canInspectPc()) {
            this.enterPcInspection();
            return;
          }
        } else if (this.phase === 'INSPECT_PC' && this.clickCount < 3) {
          this.exitPcInspection();
          return;
        }
      }

      if (e.code === 'KeyQ' && this.phase === 'INSPECT_PC' && this.clickCount < 3) {
        this.exitPcInspection();
        return;
      }

      this.player.onKeyDown(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.player.onKeyUp(e.code);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.phase === 'TITLE' || this.paused || this.consoleUI.isOpen) return;
      if (performance.now() < this.ignoreMouseUntil) return;

      const isLocked = document.pointerLockElement === this.renderer.domElement;

      if (isLocked && this.lockWarmupEvents > 0) {
        // Skip initial synthetic browser pointer-lock centering delta jump!
        this.lockWarmupEvents--;
        return;
      }

      if (this.phase === 'INSPECT_PC') {
        if (isLocked) {
          this.player.applyLookDelta(e.movementX, e.movementY, true);
        } else {
          this.player.setDirectMousePos(e.clientX, e.clientY);
        }
        return;
      }

      const allowFreeLook =
        this.phase === 'ROAM_BEDROOM' ||
        this.phase === 'ROAM_GLITCH' ||
        this.phase === 'AFTERMATH_ROAM';

      if (!allowFreeLook) return;

      if (isLocked) {
        this.player.applyLookDelta(e.movementX, e.movementY, false);
      } else if (this.isDraggingLook) {
        // Smooth drag-to-look fallback if iframe/browser doesn't lock pointer!
        const dx = e.clientX - this.lastDragX;
        const dy = e.clientY - this.lastDragY;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
        this.dragTravelPx += Math.hypot(dx, dy);
        this.player.applyLookDelta(dx * 1.35, dy * 1.35, false);
      }
    });

    this.renderer.domElement.addEventListener('mousedown', (e) => {
      if (this.phase === 'TITLE' || this.paused || this.consoleUI.isOpen) return;

      this.audio.unlock();

      const isLocked = document.pointerLockElement === this.renderer.domElement;
      if (!isLocked && this.isPointerLockDesired(false) && e.button === 0) {
        this.requestLockSafe();
        this.isDraggingLook = true;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
        this.dragTravelPx = 0;
      }

      if (this.phase === 'INSPECT_PC') {
        if (!isLocked) {
          this.player.setDirectMousePos(e.clientX, e.clientY);
          this.updatePcCursorRaycast();
        }
        if (e.button === 2 && this.clickCount < 3) {
          this.exitPcInspection();
          return;
        }
        if (e.button === 0) {
          this.handlePcScreenClick();
        }
        return;
      }

      if (
        e.button === 0 &&
        isLocked &&
        (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM') &&
        this.canInspectPc()
      ) {
        this.enterPcInspection();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isDraggingLook && e.button === 0) {
        const wasTap = this.dragTravelPx < 7;
        this.isDraggingLook = false;
        if (
          wasTap &&
          document.pointerLockElement !== this.renderer.domElement &&
          (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM') &&
          this.canInspectPc()
        ) {
          this.enterPcInspection();
        }
      }
    });

    window.addEventListener('contextmenu', (e) => {
      if (this.phase !== 'TITLE') e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.renderer.domElement) {
        this.lockWarmupEvents = 3;
        this.ignoreMouseUntil = Math.max(this.ignoreMouseUntil, performance.now() + 180);
        this.isDraggingLook = false;
      } else if (!this.consoleUI.isOpen) {
        this.player.clearKeys();
      }
    });
  }

  private isPointerLockDesired(checkPaused = true): boolean {
    if (checkPaused && this.paused) return false;
    return (
      !this.consoleUI.isOpen &&
      (this.phase === 'ROAM_BEDROOM' ||
        this.phase === 'INSPECT_PC' ||
        this.phase === 'EXIT_INSPECT' ||
        this.phase === 'ROAM_GLITCH' ||
        this.phase === 'AFTERMATH_ROAM')
    );
  }

  private requestLockSafe(): void {
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch {
      // Ignore if sandboxed iframe restricts pointer lock; drag-look fallback handles it seamlessly
    }
  }

  private setPaused(p: boolean): void {
    this.paused = p;
    this.player.clearKeys();
    this.isDraggingLook = false;
    if (p) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.pausePhaseLabel.textContent = this.getPhaseDescription();
      this.pauseModal.classList.remove('hidden');
    } else {
      this.pauseModal.classList.add('hidden');
    }
  }

  private getPhaseDescription(): string {
    switch (this.phase) {
      case 'ROAM_BEDROOM':
      case 'EXIT_INSPECT':
        return '深夜 02:47 — 自室';
      case 'INSPECT_PC':
      case 'SUCTION_CUTSCENE':
        return '0x000000F4 — BSOD 侵食中';
      case 'GLITCH_ARRIVAL_CUTSCENE':
      case 'ROAM_GLITCH':
      case 'COLLAPSE_CUTSCENE':
        return 'MEMORY_DUMP — BSOD グリッチ世界';
      case 'RETURN_LANDING':
      case 'AFTERMATH_ROAM':
        return '深夜 02:48 — 帰還後の自室';
      default:
        return '';
    }
  }

  private showSubtitle(text: string, durationMs = 4200): void {
    if (this.subtitleTimeout !== null) {
      window.clearTimeout(this.subtitleTimeout);
    }
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.remove('hidden');
    this.subtitleTimeout = window.setTimeout(() => {
      this.subtitleEl.classList.add('hidden');
    }, durationMs);
  }

  /**
   * First inspection: a composed 4.2s beat where the room tone drains away and the panel
   * re-syncs with a single vertical roll and a hairline tear. No imagery is added to the
   * screen — the BSOD and its ':(' must stay perfectly authentic.
   */
  private stepFirstContact(dt: number): void {
    if (this.firstContactTimer < 0) return;
    this.firstContactTimer += dt;
    const t = this.firstContactTimer;
    const cue = (key: string, at: number, fn: () => void): void => {
      if (t > at && !this.firstContactCues[key]) {
        this.firstContactCues[key] = true;
        fn();
      }
    };

    // 0.15s — the room's life drains away, a reverse swell breathes in under everything.
    cue('swell', 0.15, () => {
      this.audio.playOneShot('void_swell', {
        volume: 0.30,
        rate: 0.82,
        duration: 2.4,
        fadeInSec: 0.45,
        releaseSec: 0.7,
        reverb: 0.45,
      });
      this.audio.startOrUpdateLoop('room_tone', 'room_tone', {
        volume: 0.05,
        lowpassHz: 520,
        fadeSec: 1.6,
      });
    });
    // 0.55s — the panel re-syncs: a single vertical roll and a soft panel tick.
    cue('sync', 0.55, () => {
      this.audio.playOneShot('monitor_glitch', {
        volume: 0.24,
        rate: 0.72,
        duration: 1.25,
        releaseSec: 0.5,
      });
      this.triggerGlitch('roll', 0.38, 0.85);
    });
    // 1.15s — the panel warms under your gaze.
    cue('face', 1.15, () => {
      this.audio.playOneShot('flesh_pulse', {
        volume: 0.28,
        rate: 0.66,
        duration: 2.2,
        fadeInSec: 0.25,
        releaseSec: 0.8,
        reverb: 0.6,
      });
      this.audio.playOneShot('heartbeat', { volume: 0.30, rate: 0.82 });
      this.horrorPulse = 0.55;
    });
    // 2.15s — a hairline tear runs down the panel.
    cue('look', 2.15, () => {
      this.triggerGlitch('tear', 0.46, 0.28);
      this.audio.playOneShot('glitch_slice', { volume: 0.16, rate: 0.82, reverb: 0.42 });
    });
    // 3.05s — the panel settles back into its idle BSOD.
    cue('sink', 3.05, () => {
      this.audio.playOneShot('gasp', { volume: 0.20, rate: 0.9, pos: this.behindNeckSoundPos });
      this.showSubtitle('……今、画面の奥で何かが動いた気がした。気のせいだ。気のせいのはずだ。', 4600);
    });
    // 3.55s — the room's own life fades back in, as if nothing happened.
    cue('restore', 3.55, () => {
      this.audio.startOrUpdateLoop('room_tone', 'room_tone', {
        volume: 0.14,
        lowpassHz: 950,
        fadeSec: 1.4,
      });
    });

    if (t > 4.2) {
      this.firstContactTimer = -1;
      this.firstContactDone = true;
    }
  }

  /**
   * Optical reality-bend wave (fluid glass refraction + expanding ring + ghost echo).
   * Stays clean between events: the shader returns to a single-tap razor-sharp image at 0.
   */
  private triggerSpatialWave(peakIntensity: number, durationSec = 0.85, silent = false): void {
    this.triggerGlitch('bend', peakIntensity, durationSec, silent);
  }

  /**
   * Fires one authored glitch signature. Each kind has a matching sound design layer so the
   * visual and audio always read as the same event.
   */
  private triggerGlitch(
    kind: GlitchKind,
    peakIntensity: number,
    durationSec: number,
    silent = false
  ): void {
    if (this.glitchEvents.length >= 8) this.glitchEvents.shift();
    this.glitchEvents.push({
      kind,
      age: 0,
      dur: Math.max(0.18, durationSec),
      peak: THREE.MathUtils.clamp(peakIntensity, 0, 1),
    });
    if (!silent) this.playGlitchSignatureSound(kind, peakIntensity);
  }

  /** Sound design layer per glitch signature (distinct textures, never a repeated jump-scare). */
  private playGlitchSignatureSound(kind: GlitchKind, peak: number): void {
    const lvl = THREE.MathUtils.clamp(peak, 0, 1);
    switch (kind) {
      case 'bend':
        this.audio.playOneShot('anomaly_tremor', {
          volume: 0.08 + lvl * 0.16,
          rate: 0.92 + Math.random() * 0.16,
          reverb: 0.62,
        });
        break;
      case 'tear':
        this.audio.playOneShot('glitch_slice', {
          volume: 0.16 + lvl * 0.26,
          rate: 0.90 + Math.random() * 0.22,
          reverb: 0.34,
        });
        break;
      case 'mash':
        this.audio.playOneShot('glitch_stutter', {
          volume: 0.14 + lvl * 0.24,
          rate: 0.94 + Math.random() * 0.18,
          reverb: 0.26,
        });
        break;
      case 'sort':
        this.audio.playOneShot('glitch_short', {
          volume: 0.12 + lvl * 0.20,
          rate: 1.02 + Math.random() * 0.24,
          reverb: 0.3,
        });
        break;
      case 'roll':
        this.audio.playOneShot('tape_stop', {
          volume: 0.12 + lvl * 0.20,
          rate: 1.14,
          duration: 0.95,
          releaseSec: 0.3,
          reverb: 0.34,
        });
        break;
      case 'ghost':
        this.audio.playOneShot('flesh_pulse', {
          volume: 0.10 + lvl * 0.16,
          rate: 0.82 + Math.random() * 0.1,
          duration: 1.4,
          releaseSec: 0.5,
          fadeInSec: 0.18,
          reverb: 0.55,
        });
        break;
    }
  }

  /** Picks a fresh signature so the world never repeats the same distortion twice in a row. */
  private triggerRandomGlitch(peak: number, options?: { tearOnly?: boolean }): GlitchKind {
    const pool: GlitchKind[] = options?.tearOnly
      ? ['tear', 'tear', 'mash']
      : ['bend', 'tear', 'mash', 'sort', 'roll', 'ghost', 'tear', 'mash'];
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const durations: Record<GlitchKind, [number, number]> = {
      bend: [0.8, 1.15],
      tear: [0.24, 0.5],
      mash: [0.34, 0.62],
      sort: [0.45, 0.8],
      roll: [0.5, 0.85],
      ghost: [0.9, 1.5],
    };
    const [d0, d1] = durations[kind];
    this.triggerGlitch(kind, peak, d0 + Math.random() * (d1 - d0));
    return kind;
  }

  private startFreshExperience(): void {
    this.audio.stopAllLoops(0.25);
    this.audio.stopOneShots(undefined, 0.2);
    this.consoleUI.reset();
    this.glitchWorld.resetCollapse();

    this.aftermath = false;
    this.clickCount = 0;
    this.madness = 0;
    this.targetMadness = 0;
    this.jawOpen = 0;
    this.jawVel = 0;
    this.targetJawOpen = 0;
    this.clickPulse = 0;
    this.suctionTimer = 0;
    this.suctionWhooshPlayed = false;
    this.suctionBurstMidPlayed = false;
    this.suctionCues = {};
    this.glitchArrivalTimer = 0;
    this.glitchArrivalRollCuePlayed = false;
    this.glitchArrivalLanded = false;
    this.glitchEvents.length = 0;
    this.periodicWarpCooldown = 6.2;
    this.firstContactTimer = -1;
    this.firstContactDone = false;
    this.firstContactCues = {};
    this.heartbeatCooldown = 0.9;
    this.roomDreadTimer = 4.6;
    this.horrorPulse = 0;
    this.extraGlitchBurst = 0;
    this.screenFlash = 0;

    this.bedroom.setAftermathMode(false);
    this.bedroom.bsodScreen.setInsideTunnelMode(false);
    this.bedroom.group.visible = true;
    this.glitchWorld.group.visible = false;
    this.scene.background = new THREE.Color(0x02060f);

    this.player.resetToBedroomSpawn(this.bedroom.monitorWorldPos);
    this.ignoreMouseUntil = performance.now() + 260;
    this.phase = 'ROAM_BEDROOM';

    this.pcCursorEl.classList.add('hidden');
    this.crosshairEl.classList.remove('hidden');
    this.worldHintEl.classList.add('hidden');
    this.aftermathBarEl.classList.add('hidden');

    this.audio.startOrUpdateLoop('room_tone', 'room_tone', {
      volume: 0.16,
      lowpassHz: 950,
      fadeSec: 1.0,
    });
    this.audio.startOrUpdateLoop('pc_fan', 'pc_fan_hum', {
      volume: 0.32,
      lowpassHz: 1800,
      pos: this.bedroom.pcTowerSoundPos,
      refDistance: 0.7,
      maxDistance: 6.5,
      fadeSec: 1.0,
    });
    this.audio.startOrUpdateLoop('clock_tick', 'clock_tick', {
      volume: 0.24,
      pos: this.bedroom.clockSoundPos,
      refDistance: 0.55,
      maxDistance: 4.5,
      fadeSec: 1.0,
    });

    this.showSubtitle('ふと目が覚めた。机のPCモニターが真っ青な画面のまま光っている……', 4600);
  }

  private canInspectPc(): boolean {
    const dx = this.player.position.x - this.bedroom.monitorWorldPos.x;
    const dz = this.player.position.z - this.bedroom.monitorWorldPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.15) return false;

    this.camera.getWorldDirection(this.scratchCamDir);
    this.scratchToMon.copy(this.bedroom.monitorWorldPos).sub(this.camera.position).normalize();
    return this.scratchCamDir.dot(this.scratchToMon) > 0.42;
  }

  private enterPcInspection(): void {
    if (this.aftermath) {
      this.aftermath = false;
      this.bedroom.setAftermathMode(false);
      this.aftermathBarEl.classList.add('hidden');
      this.clickCount = 0;
      this.madness = 0;
      this.targetMadness = 0;
      this.jawOpen = 0;
      this.jawVel = 0;
      this.targetJawOpen = 0;
      this.audio.playOneShot('glitch_short', { volume: 0.48 });
      this.extraGlitchBurst = 0.42;
    }

    this.phase = 'INSPECT_PC';
    this.inspectBlend = 0;
    this.player.clearKeys();
    this.player.capturePoseForBlend();
    this.player.inspectCursorPx.set(window.innerWidth * 0.52, window.innerHeight * 0.52);

    this.crosshairEl.classList.add('hidden');
    this.pcCursorEl.classList.remove('hidden');
    this.audio.playOneShot('creak_room', { volume: 0.24, rate: 0.92 });

    if (!this.firstContactDone && !this.aftermath && this.clickCount === 0) {
      this.firstContactTimer = 0;
      this.firstContactCues = {};
    }
  }

  private exitPcInspection(): void {
    if (this.firstContactTimer >= 0) {
      this.firstContactTimer = -1;
      this.firstContactDone = true;
    }
    this.player.capturePoseForBlend();
    this.exitInspectBlend = 0;
    this.phase = 'EXIT_INSPECT';

    this.pcCursorEl.classList.add('hidden');
    this.crosshairEl.classList.remove('hidden');
    this.interactPromptEl.classList.add('hidden');
  }

  private handlePcScreenClick(): void {
    this.audio.playOneShot('mouse_click', { volume: 0.5, rate: 0.96 + Math.random() * 0.08 });

    if (!this.hoverFace) {
      if (this.clickCount === 0) {
        this.showSubtitle('青い画面の左上に浮かぶ大きな「:(」が、じっとこちらを見返している……', 3400);
      }
      return;
    }

    this.clickCount++;
    this.clickPulse = 1.0;
    this.bedroom.bsodScreen.pulseCrack();
    this.triggerSpatialWave(0.38 + this.clickCount * 0.11, 0.78);

    if (this.clickCount === 1) {
      this.targetMadness = 0.14;
      this.jawVel += 0.3;
      this.targetJawOpen = 0.045;
      this.horrorPulse = 0.30;
      this.triggerGlitch('tear', 0.62, 0.42);
      this.audio.playOneShot('dissonance', {
        volume: 0.26,
        duration: 4.4,
        fadeInSec: 0.2,
        releaseSec: 1.2,
        reverb: 0.5,
      });
      this.showSubtitle('……画面の文面が勝手に書き換わった？ 「:(」が、ほんの少しだけ大きくなった気がする。', 3600);
    } else if (this.clickCount === 2) {
      this.targetMadness = 0.32;
      this.jawVel += 0.6;
      this.targetJawOpen = 0.10;
      this.horrorPulse = 0.48;
      this.triggerGlitch('mash', 0.70, 0.5);
      this.audio.playOneShot('monitor_glitch', { volume: 0.40, duration: 1.0, releaseSec: 0.35 });
      // Creepy spatialised floorboard creak + breath RIGHT BEHIND YOUR CHAIR!
      this.audio.playOneShot('creak_room', {
        volume: 0.58,
        rate: 0.78,
        pos: this.behindNeckSoundPos,
      });
      this.audio.playOneShot('gasp', {
        volume: 0.26,
        rate: 0.82,
        pos: this.behindNeckSoundPos,
      });
      this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
        volume: 0.10,
        fadeSec: 1.1,
      });
      this.showSubtitle('背後の床が軋んだ……画面に「絶対に後ろを振り向かないでください」と出ている。', 3500);
    } else if (this.clickCount === 3) {
      this.targetMadness = 0.52;
      this.jawVel += 1.0;
      this.targetJawOpen = 0.30;
      this.horrorPulse = 0.68;
      // Desk lamp bulb violently pops out -> bedroom plunges into dread!
      this.audio.playOneShot('shatter', { volume: 0.50, rate: 1.55, duration: 0.55, releaseSec: 0.2, reverb: 0.25 });
      this.triggerGlitch('sort', 0.78, 0.62);
      this.audio.playOneShot('scrapemare', {
        volume: 0.34,
        duration: 5.2,
        fadeInSec: 0.4,
        releaseSec: 1.6,
        reverb: 0.5,
      });
      this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
        volume: 0.20,
        fadeSec: 0.8,
      });
      this.showSubtitle('デスクライトが弾け割れ、部屋の壁一面に「目」のような染みが浮かび始めた……！', 3400);
    } else if (this.clickCount === 4) {
      this.targetMadness = 0.74;
      this.jawVel += 1.6;
      this.targetJawOpen = 0.54;
      this.horrorPulse = 0.82;
      this.triggerGlitch('roll', 0.82, 0.75);
      this.audio.playOneShot('noise_wave', { volume: 0.40, duration: 2.8, releaseSec: 1.0, reverb: 0.4 });
      this.audio.playOneShot('monitor_glitch', { volume: 0.56, duration: 1.2, releaseSec: 0.4 });
      this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
        volume: 0.34,
        fadeSec: 0.7,
      });
      this.showSubtitle('画面の走査線が一度だけ「下に落ちた」——その一瞬、奥に誰かの輪郭が見えた。', 3400);
    } else if (this.clickCount === 5) {
      // UNHINGED PREDATORY LUNGE — no laughter: a physical sub-impact plus a wet organic heave.
      this.targetMadness = 0.94;
      this.jawVel += 2.2;
      this.targetJawOpen = 0.80;
      this.horrorPulse = 0.98;
      this.triggerGlitch('ghost', 0.95, 1.5);
      this.triggerGlitch('tear', 0.85, 0.4);
      this.audio.playOneShot('sub_boom', { volume: 0.66, rate: 1.06, reverb: 0.3 });
      this.audio.playOneShot('flesh_pulse', { volume: 0.52, rate: 0.94, duration: 1.6, releaseSec: 0.4, reverb: 0.42 });
      this.audio.playOneShot('pain_glitch', { volume: 0.52, rate: 0.86, duration: 1.4, releaseSec: 0.4, reverb: 0.35 });
      this.showSubtitle('画面の中から「顔」が飛び出してきた——もう逃げられない！！', 2900);
    } else {
      this.beginPredatorySuction();
    }
  }

  private beginPredatorySuction(): void {
    this.phase = 'SUCTION_CUTSCENE';
    this.suctionTimer = 0;
    this.suctionWhooshPlayed = false;
    this.suctionBurstMidPlayed = false;
    this.targetMadness = 1.0;
    this.jawVel += 2.6;
    this.targetJawOpen = 1.0;
    this.extraGlitchBurst = 1.0;
    this.horrorPulse = 1.0;

    this.pcCursorEl.classList.add('hidden');
    this.interactPromptEl.classList.add('hidden');

    this.audio.stopLoop('clock_tick', 0.3);
    this.audio.stopLoop('room_tone', 0.4);
    this.audio.playOneShot('reality_rift', {
      volume: 0.62,
      duration: 2.4,
      releaseSec: 0.8,
      reverb: 0.42,
      channel: 'transition',
    });
    this.audio.playOneShot('scrapemare', {
      volume: 0.34,
      rate: 0.96,
      duration: 6.6,
      fadeInSec: 0.6,
      releaseSec: 1.4,
      reverb: 0.5,
      channel: 'transition',
    });
    this.audio.playOneShot('gasp', { volume: 0.62 });
    this.audio.playOneShot('breathing_panic', {
      volume: 0.42,
      fadeInSec: 0.3,
      releaseSec: 0.8,
      channel: 'transition',
    });
    // horror_riser is 8.05s: starting at offset 0.85s aligns its exact 8.05s peak to suctionDuration = 7.20s!
    this.audio.playOneShot('horror_riser', {
      volume: 0.76,
      offset: 0.85,
      fadeInSec: 0.22,
      reverb: 0.45,
      channel: 'transition',
    });
    this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
      volume: 0.66,
      rate: 1.18,
      fadeSec: 0.22,
    });
  }

  /**
   * Deep 3-Act Aerial Sky-Monitor Arrival!
   * ZERO cheap whiteout cut: you burst straight out of the colossal 28m PC Monitor in the sky at (0, 94, 58),
   * tumbling backward looking UP at it shrinking overhead -> mid-air 180° roll -> sweeping dive onto the Overlook!
   */
  private beginGlitchArrivalCutscene(): void {
    this.phase = 'GLITCH_ARRIVAL_CUTSCENE';
    this.glitchArrivalTimer = 0;
    this.glitchArrivalRollCuePlayed = false;
    this.glitchArrivalLanded = false;

    this.bedroom.bsodScreen.setInsideTunnelMode(false);
    this.bedroom.group.visible = false;
    this.glitchWorld.group.visible = true;

    this.crosshairEl.classList.add('hidden');
    this.worldHintEl.classList.add('hidden');
    // Subtle glass-shatter spatial refraction wave instead of a blinding whiteout cut!
    this.screenFlash = 0.12;
    this.triggerSpatialWave(0.95, 1.15);
    this.horrorPulse = 0.25;

    // Long musical release (0.95s) instead of chopping the riser mid-peak — no stuttering cuts.
    this.audio.stopOneShots('transition', 0.95);
    this.audio.stopLoop('pc_fan', 0.3);
    this.audio.stopLoop('static_elec', 0.35);
    this.audio.startOrUpdateLoop('fall_wind', 'fall_wind', {
      volume: 0.82,
      rate: 1.16,
      fadeSec: 0.12,
    });
    this.triggerGlitch('tear', 0.95, 0.36);
    this.triggerGlitch('ghost', 0.55, 1.2);
    this.audio.playOneShot('shatter', { volume: 0.68, rate: 1.08, reverb: 0.48 });
    this.audio.playOneShot('swoosh_thunder', { volume: 0.76, rate: 0.92, reverb: 0.55 });
    this.audio.playOneShot('transition_solemn', { volume: 0.56, reverb: 0.55 });

    this.audio.startOrUpdateLoop('bgm_glitch', 'bgm_glitch_world', {
      volume: 0.34,
      fadeSec: 2.8,
      reverb: 0.28,
    });
    this.audio.startOrUpdateLoop('bgm_dread', 'bgm_dread_drone', {
      volume: 0.18,
      fadeSec: 3.0,
    });
    this.audio.startOrUpdateLoop('core_scanner', 'core_scanner', {
      volume: 0.48,
      pos: this.glitchWorld.corePosition,
      refDistance: 4.5,
      maxDistance: 65,
      reverb: 0.42,
      fadeSec: 2.4,
    });

    // Position the camera immediately on frame 0 of the aerial sky-dive!
    this.player.updateGlitchArrivalCutscene(
      0.016,
      0,
      this.glitchWorld.spawnPosition,
      this.glitchWorld.corePosition
    );
    this.showSubtitle('上空の亀裂から吐き出された——眼下に巨大な青の都市と深淵が広がっている！', 4400);
  }

  private beginCollapseSequence(): void {
    if (this.phase === 'COLLAPSE_CUTSCENE') return;
    this.phase = 'COLLAPSE_CUTSCENE';
    this.collapseTimer = 0;
    this.collapseStepFlags = { s1: false, s2: false };
    this.collapseCrackSfxPlayed = false;
    this.collapseShatterSfxPlayed = false;
    this.collapseWindStarted = false;
    this.collapseMidCuePlayed = false;

    this.player.clearKeys();
    this.player.initCollapseCutscene();
    this.collapseOrigin.copy(this.player.position);
    this.collapseBaseYaw = this.player.yaw;

    this.glitchWorld.startCollapseAt(this.player.position);

    this.crosshairEl.classList.add('hidden');
    this.worldHintEl.classList.add('hidden');
    this.interactPromptEl.classList.add('hidden');

    this.requestLockSafe();

    this.extraGlitchBurst = 0.92;
    this.audio.stopLoop('bgm_glitch', 0.9);
    this.audio.stopLoop('core_scanner', 0.9);
    this.audio.startOrUpdateLoop('earthquake', 'earthquake', {
      volume: 0.70,
      fadeSec: 0.25,
      reverb: 0.35,
    });
    // Start horror_riser at rate 0.84 (~9.58s effective duration!) so it spans the entire 9.60s collapse & freefall!
    this.audio.playOneShot('horror_riser', {
      volume: 0.66,
      rate: 0.84,
      fadeInSec: 0.35,
      reverb: 0.5,
      channel: 'transition',
    });
    this.audio.playOneShot('breathing_panic', { volume: 0.58, channel: 'transition' });
  }

  private beginBedroomReturnLanding(): void {
    this.phase = 'RETURN_LANDING';
    this.landingTimer = 0;
    this.aftermath = true;

    this.glitchWorld.group.visible = false;
    this.bedroom.group.visible = true;
    this.bedroom.setAftermathMode(true);
    this.bedroom.bsodScreen.setInsideTunnelMode(false);

    this.clickCount = 0;
    this.madness = 0;
    this.targetMadness = 0;
    this.jawOpen = 0;
    this.jawVel = 0;
    this.targetJawOpen = 0;

    // Seamless dark bedroom ceiling drop — ZERO blinding whiteout flash!
    this.screenFlash = 0.08;
    this.triggerSpatialWave(0.88, 0.95);

    // Smooth 0.7s release so the collapse risers resolve instead of snapping to silence.
    this.audio.stopOneShots('transition', 0.7);
    this.audio.stopLoop('earthquake', 0.55);
    this.audio.stopLoop('fall_wind', 0.5);
    this.audio.stopLoop('bgm_dread', 0.8);

    this.triggerGlitch('ghost', 0.72, 1.4);
    this.triggerGlitch('tear', 0.5, 0.3);
    this.audio.playOneShot('land_impact', { volume: 0.82, reverb: 0.12 });
    this.audio.playOneShot('sub_boom', { volume: 0.58, rate: 1.12, duration: 1.1, releaseSec: 0.5, reverb: 0.2 });
    this.audio.playOneShot('creak_room', { volume: 0.55, rate: 0.92 });
    this.audio.playOneShot('gasp', { volume: 0.45, rate: 0.95 });

    window.setTimeout(() => {
      if (this.phase === 'RETURN_LANDING' || this.phase === 'AFTERMATH_ROAM') {
        this.audio.playOneShot('aftermath_piano', { volume: 0.48, reverb: 0.5 });
      }
    }, 650);

    this.audio.startOrUpdateLoop('room_tone', 'room_tone', {
      volume: 0.14,
      lowpassHz: 900,
      fadeSec: 1.8,
    });
    this.audio.startOrUpdateLoop('pc_fan', 'pc_fan_hum', {
      volume: 0.18,
      lowpassHz: 1100,
      pos: this.bedroom.pcTowerSoundPos,
      fadeSec: 1.8,
    });
    this.audio.startOrUpdateLoop('clock_tick', 'clock_tick', {
      volume: 0.22,
      pos: this.bedroom.clockSoundPos,
      fadeSec: 1.8,
    });
  }

  private updatePcCursorRaycast(): void {
    const px = this.player.inspectCursorPx.x;
    const py = this.player.inspectCursorPx.y;
    this.pcCursorEl.style.transform = `translate3d(${px - 3}px, ${py - 2}px, 0)`;

    this.ndcVec.set(
      (px / Math.max(1, window.innerWidth)) * 2 - 1,
      -(py / Math.max(1, window.innerHeight)) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndcVec, this.camera);

    const hits = this.raycaster.intersectObject(this.bedroom.bsodScreen.hitboxMesh, false);
    if (hits.length > 0 && hits[0].uv) {
      this.cursorMonitorUv.copy(hits[0].uv);
      this.hoverFace = this.bedroom.bsodScreen.isUvOnFace(this.cursorMonitorUv, this.madness);
    } else {
      this.hoverFace = false;
    }

    if (this.hoverFace !== this.wasHoveringFace) {
      this.wasHoveringFace = this.hoverFace;
      if (this.hoverFace) {
        this.pcCursorEl.classList.add('hover-face');
        this.audio.playOneShot('ui_hover', { volume: 0.25, rate: 0.8 + this.madness * 0.5 });
      } else {
        this.pcCursorEl.classList.remove('hover-face');
      }
    }
  }

  private animate = (now: number): void => {
    requestAnimationFrame(this.animate);

    const rawDt = (now - this.lastFrameTime) * 0.001;
    this.lastFrameTime = now;
    const dt = Math.min(rawDt, 0.05);

    if (!this.paused) {
      this.elapsed += dt;
      this.stepSimulation(dt);
    }

    // Evaluate smooth bell-curve Optical Reality-Warp Wave (0.000 when inactive -> crystal-clear image!)
    // ---------------------------------------------------------------- STAGED GLITCH EVENTS
    // Each signature has its own envelope shape: tears/mash snap and decay, bends swell and release.
    let bendAmt = 0.0;
    let waveProg = 0.5;
    let tearAmt = 0.0;
    let mashAmt = 0.0;
    let sortAmt = 0.0;
    let rollAmt = 0.0;
    let ghostAmt = 0.0;
    let newestBend = -1;
    for (const ev of this.glitchEvents) {
      const p = THREE.MathUtils.clamp(ev.age / ev.dur, 0, 1);
      const sharp = ev.kind === 'tear' || ev.kind === 'mash' || ev.kind === 'sort';
      const env = Math.pow(Math.sin(Math.PI * p), sharp ? 0.55 : 0.92);
      const v = env * ev.peak;
      switch (ev.kind) {
        case 'bend':
          bendAmt = Math.max(bendAmt, v);
          if (ev.age > newestBend) {
            newestBend = ev.age;
            waveProg = p;
          }
          break;
        case 'tear':
          tearAmt = Math.max(tearAmt, v);
          break;
        case 'mash':
          mashAmt = Math.max(mashAmt, v);
          break;
        case 'sort':
          sortAmt = Math.max(sortAmt, v);
          break;
        case 'roll':
          rollAmt = Math.max(rollAmt, v);
          break;
        case 'ghost':
          ghostAmt = Math.max(ghostAmt, v);
          break;
      }
    }

    let distortAmt = Math.max(bendAmt, this.extraGlitchBurst * 0.65);
    let chromaAmt = bendAmt * 0.48 + tearAmt * 0.34;
    let vigAmt = 0.34;
    let warpAmt = 0.0;
    let horrorAmt = this.horrorPulse;
    // Bloom carries the neon identity: quiet in the bedroom, blooming hard in the glitch world.
    let bloomAmt = 0.48 + bendAmt * 0.16 + ghostAmt * 0.12;

    if (this.phase === 'ROAM_BEDROOM') {
      vigAmt = 0.38;
      bloomAmt = 0.46;
    } else if (this.phase === 'INSPECT_PC') {
      chromaAmt = Math.max(chromaAmt, this.madness * 0.22);
      vigAmt = 0.36 + this.madness * 0.24;
      warpAmt = Math.max(0, (this.madness - 0.55) * 0.28);
      horrorAmt = Math.max(horrorAmt, this.madness * 0.45);
      bloomAmt = 0.50 + this.madness * 0.55;
    } else if (this.phase === 'SUCTION_CUTSCENE') {
      const tunnelRush = THREE.MathUtils.smoothstep(this.suctionTimer, 2.1, 6.8);
      distortAmt = Math.max(distortAmt, 0.38 + (1.0 - tunnelRush) * 0.32);
      chromaAmt = 0.42 + tunnelRush * 0.30;
      vigAmt = 0.48 + tunnelRush * 0.14;
      warpAmt = 0.18 + tunnelRush * 0.58;
      horrorAmt = Math.max(horrorAmt, 0.55 * (1.0 - tunnelRush * 0.6));
      mashAmt = Math.max(mashAmt, tunnelRush * 0.22);
      ghostAmt = Math.max(ghostAmt, tunnelRush * 0.18);
      bloomAmt = 0.80 + tunnelRush * 0.55;
    } else if (this.phase === 'GLITCH_ARRIVAL_CUTSCENE') {
      const diveFrac = THREE.MathUtils.clamp(1.0 - this.glitchArrivalTimer / 4.35, 0, 1);
      chromaAmt = Math.max(chromaAmt, diveFrac * 0.32);
      vigAmt = 0.30 + diveFrac * 0.14;
      warpAmt = diveFrac * 0.48;
      bloomAmt = 0.86 + diveFrac * 0.20;
    } else if (this.phase === 'ROAM_GLITCH') {
      // Crystal-clear view during normal exploration, warping smoothly ONLY during periodic waves & anomalies!
      distortAmt = Math.max(distortAmt, this.glitchWorld.anomalyIntensity * 0.65);
      chromaAmt = Math.max(chromaAmt, this.glitchWorld.anomalyIntensity * 0.42);
      vigAmt = 0.28;
      warpAmt = this.glitchWorld.anomalyIntensity * 0.12;
      horrorAmt = Math.max(horrorAmt, this.glitchWorld.anomalyIntensity * 0.28);
      bloomAmt = 0.74 + this.glitchWorld.anomalyIntensity * 0.45;
    } else if (this.phase === 'COLLAPSE_CUTSCENE') {
      const fallFactor = THREE.MathUtils.clamp((this.collapseTimer - 3.8) / 4.8, 0, 1);
      distortAmt = Math.max(distortAmt, 0.24 + fallFactor * 0.38);
      chromaAmt = 0.28 + fallFactor * 0.45;
      vigAmt = 0.40 + fallFactor * 0.22;
      warpAmt = fallFactor * 0.68;
      horrorAmt = Math.max(horrorAmt, 0.28 + fallFactor * 0.25);
      sortAmt = Math.max(sortAmt, fallFactor * 0.18);
      ghostAmt = Math.max(ghostAmt, fallFactor * 0.12);
      bloomAmt = 0.82 + fallFactor * 0.34;
    }

    this.postFX.render(this.renderer, this.scene, this.camera, this.elapsed, {
      distort: distortAmt,
      waveProgress: waveProg,
      chromatic: chromaAmt,
      vignette: vigAmt,
      flash: this.screenFlash,
      warp: warpAmt,
      horror: horrorAmt,
      tear: tearAmt,
      mash: mashAmt,
      sort: sortAmt,
      roll: rollAmt,
      ghost: ghostAmt,
      bloom: bloomAmt,
    });
  };

  private stepSimulation(dt: number): void {
    this.clickPulse = Math.max(0, this.clickPulse - dt * 3.8);
    this.extraGlitchBurst = Math.max(0, this.extraGlitchBurst - dt * 2.4);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 2.2);
    this.horrorPulse = Math.max(0, this.horrorPulse - dt * 1.8);
    if (this.glitchEvents.length > 0) {
      for (const ev of this.glitchEvents) ev.age += dt;
      this.glitchEvents = this.glitchEvents.filter((ev) => ev.age < ev.dur);
    }

    // Distortion pacing while the monitor is being provoked (the 3D world owns its own pacing
    // via GlitchWorld's anomaly surges, so the two never stack into constant noise).
    if (this.phase === 'INSPECT_PC' && this.clickCount >= 1) {
      this.periodicWarpCooldown -= dt;
      if (this.periodicWarpCooldown <= 0) {
        this.periodicWarpCooldown = 3.8 - this.madness * 1.1 + Math.random() * 2.0;
        this.triggerRandomGlitch(0.28 + this.madness * 0.42);
      }
    }

    this.madness = THREE.MathUtils.lerp(this.madness, this.targetMadness, Math.min(1, dt * 4.5));
    // The jaw is driven by a critically-underdamped spring rather than a plain exponential lerp:
    // each stage of the yawn overshoots a hair and settles, and every click injects a little
    // impulse, so the aperture snaps open like a hinge under load instead of melting open.
    {
      const jawStiffness = this.phase === 'SUCTION_CUTSCENE' ? 120 : 42;
      const jawDamping = this.phase === 'SUCTION_CUTSCENE' ? 15.5 : 8.4;
      const step = Math.min(dt, 1 / 45);
      this.jawVel += (this.targetJawOpen - this.jawOpen) * jawStiffness * step;
      this.jawVel -= this.jawVel * jawDamping * step;
      this.jawVel += this.clickPulse * 0.55 * step;
      this.jawOpen += this.jawVel * step;
      this.jawOpen = THREE.MathUtils.clamp(this.jawOpen, 0, 1.12);
    }

    // Continuous accelerating sub-bass Heartbeat from first anomaly click right through suction!
    if (
      (this.phase === 'INSPECT_PC' && this.clickCount >= 1) ||
      this.phase === 'SUCTION_CUTSCENE'
    ) {
      this.heartbeatCooldown -= dt;
      if (this.heartbeatCooldown <= 0) {
        const panicLevel =
          this.phase === 'SUCTION_CUTSCENE'
            ? 1.0
            : THREE.MathUtils.clamp(this.clickCount / 5.0, 0.15, 0.95);
        // Accelerates smoothly from ~70 BPM (0.86s) up to frantic 182 BPM (0.33s)!
        this.heartbeatCooldown = THREE.MathUtils.lerp(0.86, 0.33, panicLevel);
        this.audio.playOneShot('heartbeat', {
          volume: THREE.MathUtils.lerp(0.32, 0.76, panicLevel),
          rate: THREE.MathUtils.lerp(0.94, 1.32, panicLevel),
        });
        this.horrorPulse = Math.max(this.horrorPulse, panicLevel * 0.35);
      }
    }

    switch (this.phase) {
      case 'TITLE': {
        this.camera.position.set(
          0.35 + Math.sin(this.elapsed * 0.35) * 0.025,
          1.58 + Math.sin(this.elapsed * 0.55) * 0.015,
          0.62
        );
        this.camera.lookAt(this.bedroom.monitorWorldPos);
        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: false,
            cursorUv: this.cursorMonitorUv,
            clickCount: 0,
            madness: 0,
            jawOpen: 0,
            suctionProgress: 0,
            aftermath: false,
          },
          0
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, false);
        break;
      }

      case 'ROAM_BEDROOM':
      case 'AFTERMATH_ROAM': {
        this.player.updateFreeRoam(
          dt,
          2.35,
          () => 0.017,
          (pos) => this.bedroom.resolvePlayerCollision(pos, 0.26),
          true
        );

        const nearPc = this.canInspectPc();
        if (nearPc) {
          this.crosshairEl.classList.add('active');
          this.interactPromptEl.textContent = this.aftermath
            ? '[CLICK / E] 異変の残るPCモニターを覗き込む'
            : '[CLICK / E] PCモニターを調べる';
          this.interactPromptEl.classList.remove('hidden');
        } else {
          this.crosshairEl.classList.remove('active');
          this.interactPromptEl.classList.add('hidden');
        }

        // Subtle atmospheric horror tension right from the initial bedroom walk!
        if (!this.aftermath) {
          this.roomDreadTimer -= dt;
          if (this.roomDreadTimer <= 0) {
            this.roomDreadTimer = 7.5 + Math.random() * 5.5;
            this.audio.playOneShot('creak_room', {
              volume: 0.22,
              rate: 0.72 + Math.random() * 0.18,
              pos: this.roomCornerSoundPos,
            });
            this.horrorPulse = Math.max(this.horrorPulse, 0.18);
          }
        }

        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: false,
            cursorUv: this.cursorMonitorUv,
            clickCount: 0,
            madness: 0,
            jawOpen: 0,
            suctionProgress: 0,
            aftermath: this.aftermath,
          },
          0
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, this.aftermath);
        break;
      }

      case 'EXIT_INSPECT': {
        this.exitInspectBlend = Math.min(1, this.exitInspectBlend + dt * 3.2);
        this.player.updateExitInspectBlend(this.exitInspectBlend);
        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: false,
            cursorUv: this.cursorMonitorUv,
            clickCount: this.clickCount,
            madness: this.madness,
            jawOpen: this.jawOpen,
            suctionProgress: 0,
            aftermath: false,
          },
          0
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, false);
        if (this.exitInspectBlend >= 1) {
          this.phase = 'ROAM_BEDROOM';
        }
        break;
      }

      case 'INSPECT_PC': {
        this.inspectBlend = Math.min(1, this.inspectBlend + dt * 2.4);
        this.player.updateInspectPose(
          dt,
          this.elapsed,
          this.inspectBlend,
          this.bedroom.inspectCamPos,
          this.bedroom.inspectLookTarget,
          this.madness,
          this.clickPulse
        );
        this.updatePcCursorRaycast();

        if (this.clickCount === 0) {
          this.interactPromptEl.textContent = '「:(」にカーソルを重ねてクリック  |  [右クリック / Q] 離れる';
          this.interactPromptEl.classList.remove('hidden');
        } else if (this.clickCount < 3) {
          this.interactPromptEl.textContent = '「:(」をクリックし続ける  |  [右クリック / Q] 離れる';
          this.interactPromptEl.classList.remove('hidden');
        } else {
          this.interactPromptEl.textContent = ':(  離れられない  —  クリックを続けろ  :(';
          this.interactPromptEl.classList.remove('hidden');
        }

        this.stepFirstContact(dt);

        const roomInfect = THREE.MathUtils.clamp((this.madness - 0.18) * 1.15, 0, 0.92);
        const roomPull = THREE.MathUtils.clamp((this.madness - 0.45) * 0.85, 0, 0.48);

        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: this.hoverFace,
            cursorUv: this.cursorMonitorUv,
            clickCount: this.clickCount,
            madness: this.madness,
            jawOpen: this.jawOpen,
            suctionProgress: 0,
            aftermath: false,
          },
          this.clickPulse
        );
        this.bedroom.update(dt, this.elapsed, roomInfect, roomPull, false);
        break;
      }

      case 'SUCTION_CUTSCENE': {
        this.suctionTimer += dt;
        const { progress, insideTunnel } = this.player.updateSuctionCutscene(
          this.suctionTimer,
          this.suctionDuration,
          this.bedroom.monitorWorldPos,
          this.bedroom.monitorWorldQuat
        );

        this.bedroom.bsodScreen.setInsideTunnelMode(insideTunnel);

        // Seven authored beats across the 7.2s devouring — each one has its own signature & sound.
        const cue = (key: string, at: number, fn: () => void): void => {
          if (this.suctionTimer > at && !this.suctionCues[key]) {
            this.suctionCues[key] = true;
            fn();
          }
        };

        // 0.30s — the glass surface shears and the glyph rips sideways for a frame.
        cue('tearA', 0.3, () => this.triggerGlitch('tear', 0.74, 0.34));
        // 1.12s — your head wrenches 62° back at the bedroom: the room "rolls" one frame and drops a beat.
        cue('rollA', 1.12, () => {
          this.triggerGlitch('roll', 0.72, 0.8);
          this.audio.playOneShot('flesh_pulse', {
            volume: 0.34,
            rate: 0.76,
            duration: 1.9,
            fadeInSec: 0.1,
            releaseSec: 0.7,
            reverb: 0.6,
          });
          this.horrorPulse = 0.95;
        });
        // 2.28s — the throat opens and the air is pulled out of the room.
        cue('rush', 2.28, () => {
          this.audio.playOneShot('swoosh_thunder', {
            volume: 0.72,
            reverb: 0.42,
            channel: 'transition',
          });
          this.audio.playOneShot('wormhole_suck', {
            volume: 0.74,
            reverb: 0.42,
            channel: 'transition',
          });
          this.audio.startOrUpdateLoop('fall_wind', 'fall_wind', {
            volume: 0.72,
            rate: 1.28,
            fadeSec: 0.4,
          });
          this.triggerGlitch('mash', 0.78, 0.55);
        });
        // 3.30s — the whole frame datamoshes into blue macroblocks.
        cue('mashA', 3.3, () => this.triggerGlitch('mash', 0.88, 0.6));
        // 4.10s — pixel-sort streaks as the walls are dragged past you.
        cue('sortA', 4.1, () => this.triggerGlitch('sort', 0.82, 0.8));
        // 4.60s — mid-throat slam + the reverse swell that carries you out into the sky.
        cue('burst', 4.6, () => {
          this.audio.playOneShot('whoosh_cyber', {
            volume: 0.74,
            rate: 1.05,
            reverb: 0.45,
            channel: 'transition',
          });
          this.audio.playOneShot('sub_boom', {
            volume: 0.44,
            rate: 1.25,
            duration: 1.2,
            releaseSec: 0.4,
            channel: 'transition',
          });
          this.audio.playOneShot('void_swell', {
            volume: 0.62,
            rate: 1.12,
            duration: 2.65,
            releaseSec: 0.45,
            fadeInSec: 0.4,
            channel: 'transition',
          });
          this.triggerGlitch('bend', 0.9, 1.0);
        });
        // 5.55s — a ghost double-exposure of the bedroom flashes over the tunnel.
        cue('ghostA', 5.55, () => this.triggerGlitch('ghost', 0.62, 1.1));
        // 6.55s — final tear storm right before the glass breaks.
        cue('tearStorm', 6.55, () => {
          this.triggerGlitch('tear', 0.95, 0.38);
          window.setTimeout(() => this.triggerGlitch('mash', 0.8, 0.3, true), 130);
        });

        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: true,
            cursorUv: this.cursorMonitorUv,
            clickCount: 6,
            madness: 1.0,
            jawOpen: 1.0,
            suctionProgress: progress,
            aftermath: false,
          },
          0.4
        );
        this.bedroom.update(dt, this.elapsed, 1.0, 0.55 + progress * 0.65, false);

        if (this.suctionTimer >= this.suctionDuration) {
          this.beginGlitchArrivalCutscene();
        }
        break;
      }

      case 'GLITCH_ARRIVAL_CUTSCENE': {
        this.glitchArrivalTimer += dt;
        const { finished, touchedDown } = this.player.updateGlitchArrivalCutscene(
          dt,
          this.glitchArrivalTimer,
          this.glitchWorld.spawnPosition,
          this.glitchWorld.corePosition
        );

        this.glitchWorld.update(dt, this.elapsed, this.camera.position, null);

        // Synced to the 1.45s mid-air 180° skydiver body-roll from looking UP at the 28m Sky-Monitor to diving down!
        if (this.glitchArrivalTimer > 1.30 && !this.glitchArrivalRollCuePlayed) {
          this.glitchArrivalRollCuePlayed = true;
          this.audio.playOneShot('whoosh_cyber', { volume: 0.62, rate: 0.94, reverb: 0.5 });
          // The world's audio "drops a frame" with the body roll.
          this.audio.playOneShot('tape_stop', {
            volume: 0.20,
            rate: 1.24,
            duration: 0.8,
            releaseSec: 0.25,
            reverb: 0.3,
          });
          this.triggerGlitch('tear', 0.42, 0.3);
        }

        if (touchedDown && !this.glitchArrivalLanded) {
          this.glitchArrivalLanded = true;
          this.audio.stopLoop('fall_wind', 0.22);
          this.audio.playOneShot('land_impact', { volume: 0.86, rate: 0.92, reverb: 0.42 });
          this.audio.playOneShot('sub_boom', { volume: 0.70, rate: 1.0, reverb: 0.35 });
          this.audio.playOneShot('swoosh_thunder', { volume: 0.44, rate: 1.25, reverb: 0.45 });
          this.audio.playOneShot('gasp', { volume: 0.56, rate: 0.98 });
          this.glitchWorld.triggerLandingShockwave();
          this.triggerSpatialWave(0.86, 0.95);
          this.triggerGlitch('mash', 0.52, 0.34);
          this.screenFlash = 0.14;
        }

        if (finished) {
          this.phase = 'ROAM_GLITCH';
          this.periodicWarpCooldown = 6.5;
          this.crosshairEl.classList.remove('hidden');
          this.worldHintEl.textContent = '[C] カーネルコンソールを開く';
          this.worldHintEl.classList.remove('hidden');
          this.showSubtitle('遠くに巨大な光の神殿が聳えている……高架の橋を渡って調査しよう。', 5200);
        }
        break;
      }

      case 'ROAM_GLITCH': {
        const canMove = !this.consoleUI.isOpen;
        const wasRevealed = this.glitchWorld.coreSecretRevealed;

        this.player.updateFreeRoam(
          dt,
          5.4,
          (x, z) => this.glitchWorld.getTerrainHeight(x, z),
          (pos) => this.glitchWorld.resolvePlayerBounds(pos),
          canMove
        );

        this.glitchWorld.update(dt, this.elapsed, this.player.position, null);

        if (!wasRevealed && this.glitchWorld.coreSecretRevealed) {
          this.audio.playOneShot('ghost_cantata', { volume: 0.44, reverb: 0.55 });
          this.showSubtitle('中央構造物の文字列が収束した —— 世界の秘密の命令語が読める。', 4800);
        }

        const distCore = Math.hypot(
          this.player.position.x - this.glitchWorld.corePosition.x,
          this.player.position.z - this.glitchWorld.corePosition.z
        );
        const nearCoreFactor = THREE.MathUtils.clamp(1 - distCore / 50, 0, 1);
        this.audio.startOrUpdateLoop('bgm_dread', 'bgm_dread_drone', {
          volume: 0.12 + nearCoreFactor * 0.26,
          fadeSec: 0.5,
        });
        break;
      }

      case 'COLLAPSE_CUTSCENE': {
        this.collapseTimer += dt;

        // Synced to Voronoi seam ignition right under your shoes (t = 1.05s..1.45s)!
        if (this.collapseTimer > 1.22 && !this.collapseCrackSfxPlayed) {
          this.collapseCrackSfxPlayed = true;
          this.audio.playOneShot('shatter', {
            volume: 0.58,
            rate: 0.92,
            reverb: 0.35,
            channel: 'transition',
          });
          this.audio.playOneShot('gasp', { volume: 0.55, rate: 1.05 });
          // Hairline seams light up under your shoes -> the frame tears along the crack pattern.
          this.triggerGlitch('tear', 0.46, 0.34);
        }

        // Synced to exact Voronoi jigsaw drop threshold (t = 3.75s)!
        if (this.collapseTimer > 3.74 && !this.collapseShatterSfxPlayed) {
          this.collapseShatterSfxPlayed = true;
          this.audio.playOneShot('shatter', {
            volume: 0.88,
            rate: 0.70,
            reverb: 0.5,
            channel: 'transition',
          });
          this.audio.playOneShot('pain_glitch', {
            volume: 0.60,
            duration: 1.6,
            releaseSec: 0.5,
            reverb: 0.45,
            channel: 'transition',
          });
          this.audio.playOneShot('sub_boom', {
            volume: 0.72,
            rate: 0.94,
            reverb: 0.4,
            channel: 'transition',
          });
          this.triggerGlitch('mash', 0.92, 0.5);
          this.triggerGlitch('sort', 0.8, 0.7);
          this.extraGlitchBurst = 0.9;
        }

        // Synced to 245m speed-line freefall plunge (t = 4.08s)!
        if (this.collapseTimer > 4.08 && !this.collapseWindStarted) {
          this.collapseWindStarted = true;
          this.audio.startOrUpdateLoop('fall_wind', 'fall_wind', {
            volume: 0.76,
            rate: 1.18,
            fadeSec: 0.3,
          });
          this.audio.playOneShot('swoosh_thunder', {
            volume: 0.76,
            reverb: 0.45,
            channel: 'transition',
          });
          this.audio.playOneShot('whoosh_cyber', {
            volume: 0.68,
            rate: 0.88,
            reverb: 0.5,
            channel: 'transition',
          });
          this.triggerGlitch('ghost', 0.5, 1.6);
          this.triggerGlitch('roll', 0.55, 0.9);
        }

        // Mid-abyss: the world's own audio loses sync twice as the structures fall away above you.
        if (this.collapseTimer > 6.1 && !this.collapseMidCuePlayed) {
          this.collapseMidCuePlayed = true;
          this.audio.playOneShot('tape_stop', {
            volume: 0.30,
            rate: 1.0,
            duration: 1.1,
            releaseSec: 0.35,
            reverb: 0.45,
            channel: 'transition',
          });
          this.triggerGlitch('tear', 0.62, 0.34);
        }

        this.player.updateCollapseAndFallCutscene(
          dt,
          this.collapseTimer,
          this.collapseOrigin,
          this.collapseBaseYaw,
          () => this.audio.playFootstep('panic'),
          this.collapseStepFlags
        );

        this.glitchWorld.update(dt, this.elapsed, this.camera.position, this.collapseTimer);

        if (this.collapseTimer >= this.collapseDuration) {
          this.beginBedroomReturnLanding();
        }
        break;
      }

      case 'RETURN_LANDING': {
        this.landingTimer += dt;
        const finished = this.player.updateReturnLandingCutscene(dt, this.landingTimer);

        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: false,
            cursorUv: this.cursorMonitorUv,
            clickCount: 0,
            madness: 0,
            jawOpen: 0,
            suctionProgress: 0,
            aftermath: true,
          },
          0
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, true);

        if (finished) {
          this.phase = 'AFTERMATH_ROAM';
          this.crosshairEl.classList.remove('hidden');
          this.aftermathBarEl.classList.remove('hidden');
          this.showSubtitle(
            '自室のラグの上に倒れ込んでいた……椅子がこちらを向き、机の上に青い結晶片が残っている。',
            5800
          );
        }
        break;
      }
    }

    this.audio.updateListener(this.camera);
  }
}

const app = new BsodExperienceApp();
app.init().catch((err) => {
  console.error('Initialization failed:', err);
  const st = document.getElementById('loading-status');
  if (st) st.textContent = `初期化エラー: ${String(err)}`;
});
