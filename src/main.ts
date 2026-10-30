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
  private glitchMilestones: Record<string, boolean> = {};

  // Staged glitch-event scheduler: every disturbance is an authored signature with its own sound.
  private glitchEvents: GlitchEvent[] = [];
  private periodicWarpCooldown = 6.2;

  // First inspection staging: the panel re-syncs, the room tone drains, and the glass ticks —
  // no imagery beyond the authentic BSOD and the ':(' it already shows.
  private firstContactTimer = -1;
  private firstContactDone = false;
  private firstContactCues: Record<string, boolean> = {};

  // Continuous Horror Tension & Heartbeat Audio state
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

  // Active Sky-Eye Crimson Gaze & Locked-Chair Resistance state (zero per-frame allocations!)
  private opticStrain = 0;
  private gazeWarnCooldown = 0;
  private chairEscapeCooldown = 0;
  private readonly _camFwd = new THREE.Vector3();
  private readonly _skyEyeDir = new THREE.Vector3(0, 0.25, -0.968).normalize();

  // Hardware audio-locked timeline start timestamps (prevents ANY audio/visual desync on frame stalls!)
  private suctionStartClock = 0;
  private arrivalStartClock = 0;
  private collapseStartClock = 0;
  private landingStartClock = 0;
  private pauseClockStart: number | null = null;
  private pausedClockAccum = 0;
  private tunnelScrollPhase = 0;

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
  private readonly qualitySelect = document.getElementById('quality-select') as HTMLSelectElement | null;
  private readonly resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
  private readonly restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;

  private qualityMode: 'auto' | 'low' | 'medium' | 'high' = 'auto';
  private renderScale = 1.0;
  private emaFrameMs = 16.0;
  private scaleCheckAccum = 0;
  private isLowTierGpu = false;
  private autoBloomEnabled = true;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      stencil: true,
      depth: true,
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    this.canvasWrap.appendChild(this.renderer.domElement);

    // Detect software / integrated WebGL renderers upfront so initial resolution starts silky-smooth!
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererStr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/SwiftShader|Software|llvmpipe|Basic Render|Intel\(R\) (UHD|HD|Iris)/i.test(rendererStr)) {
        this.isLowTierGpu = true;
      }
    } catch {
      // Ignore if debug extension is restricted
    }

    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.05, 1600);
    this.postFX = new PostFX(window.innerWidth, window.innerHeight);
    this.applyQualityMode('auto');
    this.postFX.validate(this.renderer);

    this.player = new FirstPersonController(this.camera);
    this.consoleUI = new ConsoleUI(this.audio);

    this.bindCallbacks();
    this.bindInputs();
  }

  private getActiveScene(): THREE.Scene {
    if (
      this.phase === 'GLITCH_ARRIVAL_CUTSCENE' ||
      this.phase === 'ROAM_GLITCH' ||
      this.phase === 'COLLAPSE_CUTSCENE'
    ) {
      return this.glitchWorld.scene;
    }
    return this.bedroom.scene;
  }

  private getTimelineClock(): number {
    return this.audio.getClockSeconds() - this.pausedClockAccum;
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

    // True 1-frame offscreen GPU warmup for BOTH isolated realms + all deferred cutscene meshes/textures!
    // Uploads every VAO, texture, and exact light-count shader program so transitions have 0.00ms hitch!
    this.loadingStatus.textContent = 'GPUシェーダーとテクスチャを事前転送中... 99%';
    for (const tex of this.bedroom.bsodScreen.getAllTextures()) {
      this.renderer.initTexture(tex);
    }

    this.bedroom.setWarmupVisibility(true);
    this.camera.position.copy(this.bedroom.inspectCamPos);
    this.camera.lookAt(this.bedroom.monitorWorldPos);
    this.renderer.compile(this.bedroom.scene, this.camera);
    this.postFX.render(this.renderer, this.bedroom.scene, this.camera, 0, {
      distort: 0,
      chromatic: 0,
      vignette: 0.34,
      flash: 0,
      bloom: 0.5,
    });
    this.bedroom.setWarmupVisibility(false);

    this.glitchWorld.setWarmupVisibility(true);
    this.camera.position.set(0, this.glitchWorld.spawnPosition.y + 1.7, this.glitchWorld.spawnPosition.z);
    this.camera.lookAt(this.glitchWorld.corePosition);
    this.renderer.compile(this.glitchWorld.scene, this.camera);
    this.postFX.render(this.renderer, this.glitchWorld.scene, this.camera, 0, {
      distort: 0,
      chromatic: 0,
      vignette: 0.34,
      flash: 0,
      bloom: 0.5,
    });
    this.glitchWorld.setWarmupVisibility(false);

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

    this.player.onJump = () => {
      if (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM') {
        const surf = this.bedroom.getFloorSurface(this.player.position.x, this.player.position.z);
        this.audio.playJump(surf);
      } else if (this.phase === 'ROAM_GLITCH') {
        this.audio.playJump('glitch');
      }
    };

    this.player.onLand = (impactSpeed: number) => {
      if (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM') {
        const surf = this.bedroom.getFloorSurface(this.player.position.x, this.player.position.z);
        this.audio.playJumpLand(surf, impactSpeed);
      } else if (this.phase === 'ROAM_GLITCH') {
        this.audio.playJumpLand('glitch', impactSpeed);
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
              const follow: GlitchKind[] = ['tear', 'bend', 'sort', 'roll', 'ghost'];
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
      // Invalid command: the frame tears and the colossal Sky-Eye surges in crimson rejection!
      this.glitchWorld.triggerAnomalySurge(0.88);
      this.horrorPulse = Math.max(this.horrorPulse, 0.52);
      this.triggerGlitch('tear', 0.68, 0.34, true);
      this.audio.playOneShot('glitch_slice', { volume: 0.24, rate: 1.12, reverb: 0.42 });
      this.audio.playOneShot('anomaly_tremor', { volume: 0.28, rate: 0.92, reverb: 0.5 });
    };

    this.consoleUI.onWakeUpCommand = () => {
      this.beginCollapseSequence();
    };
  }

  private bindInputs(): void {
    window.addEventListener('resize', () => {
      this.applyViewportResolution();
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

    this.qualitySelect?.addEventListener('change', () => {
      this.applyQualityMode((this.qualitySelect?.value as 'auto' | 'low' | 'medium' | 'high') || 'auto');
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
        const distCore = Math.hypot(
          this.player.position.x - this.glitchWorld.corePosition.x,
          this.player.position.z - this.glitchWorld.corePosition.z
        );
        this.consoleUI.open(this.glitchWorld.coreSecretRevealed, distCore);
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
        } else if (this.phase === 'INSPECT_PC') {
          if (this.clickCount < 3) {
            this.exitPcInspection();
          } else {
            this.triggerLockedChairWrench();
          }
          return;
        }
      }

      if (e.code === 'KeyQ' && this.phase === 'INSPECT_PC') {
        if (this.clickCount < 3) {
          this.exitPcInspection();
        } else {
          this.triggerLockedChairWrench();
        }
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
        if (e.button === 2) {
          if (this.clickCount < 3) {
            this.exitPcInspection();
          } else {
            this.triggerLockedChairWrench();
          }
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

  private computeAutoBaseScale(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingArea = Math.max(1, window.innerWidth * window.innerHeight * dpr * dpr);
    const maxPixels = this.isLowTierGpu ? 2_100_000 : 4_200_000;
    const minScale = this.isLowTierGpu ? 0.72 : 0.90;
    return THREE.MathUtils.clamp(Math.sqrt(maxPixels / backingArea), minScale, 1.0);
  }

  private applyQualityMode(mode: 'auto' | 'low' | 'medium' | 'high'): void {
    this.qualityMode = mode;
    if (mode === 'low') {
      this.renderScale = 0.72;
      this.autoBloomEnabled = false;
      this.postFX.setQuality(0, false);
    } else if (mode === 'medium') {
      this.renderScale = 0.92;
      this.autoBloomEnabled = true;
      this.postFX.setQuality(this.isLowTierGpu ? 0 : 2, true);
    } else if (mode === 'high') {
      this.renderScale = 1.0;
      this.autoBloomEnabled = true;
      this.postFX.setQuality(this.isLowTierGpu ? 2 : 4, true);
    } else {
      this.renderScale = +this.computeAutoBaseScale().toFixed(2);
      this.autoBloomEnabled = true;
      this.postFX.setQuality(this.isLowTierGpu ? 0 : 4, true);
    }
    this.applyViewportResolution();
  }

  private applyViewportResolution(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    const rw = Math.max(2, Math.round(w * dpr * this.renderScale));
    const rh = Math.max(2, Math.round(h * dpr * this.renderScale));
    this.postFX.setSize(rw, rh);
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
    if (this.paused === p) return;
    this.paused = p;
    const rawNow = this.audio.getClockSeconds();
    if (p) {
      this.pauseClockStart = rawNow;
      this.audio.setPaused(true);
    } else {
      this.audio.setPaused(false);
      const afterResume = this.audio.getClockSeconds();
      if (this.pauseClockStart !== null) {
        this.pausedClockAccum += Math.max(0, afterResume - this.pauseClockStart);
        this.pauseClockStart = null;
      }
    }
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
    const in3dWorld =
      this.phase === 'GLITCH_ARRIVAL_CUTSCENE' ||
      this.phase === 'ROAM_GLITCH' ||
      this.phase === 'COLLAPSE_CUTSCENE';
    const pool: GlitchKind[] = options?.tearOnly
      ? ['tear', 'tear', 'bend']
      : in3dWorld
        ? ['bend', 'tear', 'sort', 'roll', 'ghost', 'tear', 'bend']
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
    this.glitchMilestones = {};
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
    this.glitchWorld.setArrivalSleeveActive(true);
    this.bedroom.group.visible = true;
    this.glitchWorld.group.visible = true;

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
    this.audio.startOrUpdateLoop('rain_window', 'rain_window', {
      volume: 0.36,
      pos: this.bedroom.windowSoundPos,
      refDistance: 1.15,
      maxDistance: 7.5,
      fadeSec: 1.2,
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
    this.phase = 'INSPECT_PC';
    this.inspectBlend = 0;
    this.player.clearKeys();
    this.player.capturePoseForBlend();
    this.player.inspectCursorPx.set(window.innerWidth * 0.52, window.innerHeight * 0.52);

    this.crosshairEl.classList.add('hidden');
    this.pcCursorEl.classList.remove('hidden');
    this.audio.playOneShot('creak_room', { volume: 0.24, rate: 0.92 });

    if (this.aftermath) {
      this.audio.playOneShot('dissonance', { volume: 0.18, duration: 2.8, fadeInSec: 0.3, releaseSec: 1.0, reverb: 0.5 });
      this.showSubtitle('黒いガラスの奥に、二つの青い瞳孔が張り付いている……クリックすると再び侵食が始まる。', 4200);
      return;
    }

    if (!this.firstContactDone && this.clickCount === 0) {
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
    this.audio.stopLoop('throat_draft', 0.25);
  }

  private triggerLockedChairWrench(): void {
    if (this.chairEscapeCooldown > 0) return;
    this.chairEscapeCooldown = 1.1;
    // Brief futile backward neck strain that gets violently yanked right back to the monitor!
    this.inspectBlend = 0.82;
    this.clickPulse = Math.max(this.clickPulse, 0.86);
    this.horrorPulse = Math.max(this.horrorPulse, 0.78);
    this.triggerGlitch('roll', 0.68, 0.45);
    this.audio.playOneShot('flesh_pulse', {
      volume: 0.44,
      rate: 1.18,
      duration: 0.7,
      releaseSec: 0.25,
      pos: this.behindNeckSoundPos,
    });
    this.audio.playOneShot('creak_room', { volume: 0.52, rate: 0.74, pos: this.behindNeckSoundPos });
    this.showSubtitle('頸椎がロックされている——椅子の背後から頭を押さえつけられているように動けない。', 3100);
  }

  private handlePcScreenClick(): void {
    this.audio.playOneShot('mouse_click', { volume: 0.5, rate: 0.96 + Math.random() * 0.08 });

    if (this.aftermath) {
      // Clicking the haunted aftermath monitor violently re-engages PARASYTE_HOOK!
      this.aftermath = false;
      this.bedroom.setAftermathMode(false);
      this.aftermathBarEl.classList.add('hidden');
      this.clickCount = 0;
      this.madness = 0;
      this.targetMadness = 0;
      this.jawOpen = 0;
      this.jawVel = 0;
      this.targetJawOpen = 0;
      this.extraGlitchBurst = 0.55;
      this.horrorPulse = 0.42;
      this.triggerGlitch('tear', 0.72, 0.38);
      this.audio.playOneShot('glitch_short', { volume: 0.52 });
      this.audio.playOneShot('monitor_glitch', { volume: 0.38, duration: 0.85, releaseSec: 0.3 });
      this.showSubtitle('黒いガラスの奥の瞳孔が開いた——再び午前2時47分の青画面に引きずり込まれる。', 3400);
      return;
    }

    if (!this.hoverFace) {
      // Even off-face clicks produce a tactile LCD liquid-crystal pressure ripple right at the cursor!
      this.bedroom.bsodScreen.pulseCrack(this.cursorMonitorUv);
      if (this.clickCount === 0) {
        this.showSubtitle('左上の「:(」だけが、走査線の隙間でわずかに口角を吊り上げた気がした。', 3400);
      } else if (this.clickCount >= 2) {
        this.audio.playOneShot('flesh_pulse', { volume: 0.24, rate: 1.15, duration: 0.55, releaseSec: 0.2 });
        this.showSubtitle('大きく開いたまま動かない口と、非対称の眼球群が一斉にカーソルを見つめている。', 2600);
      }
      return;
    }

    this.clickCount++;
    this.clickPulse = 1.0;
    this.bedroom.bsodScreen.pulseCrack(this.cursorMonitorUv);
    this.triggerSpatialWave(0.38 + this.clickCount * 0.11, 0.78);

    if (this.clickCount === 1) {
      this.targetMadness = 0.16;
      this.jawVel += 0.45;
      this.targetJawOpen = 0.10;
      this.horrorPulse = 0.32;
      this.triggerGlitch('tear', 0.65, 0.44);
      this.audio.playOneShot('dissonance', {
        volume: 0.28,
        duration: 4.4,
        fadeInSec: 0.2,
        releaseSec: 1.2,
        reverb: 0.5,
      });
      this.showSubtitle('……今、「:(」が「:)」に裏返って笑った。黒い液晶割れの内側で白い歯が覗いている。', 3800);
    } else if (this.clickCount === 2) {
      this.targetMadness = 0.36;
      this.jawVel += 0.95;
      this.targetJawOpen = 0.28;
      this.horrorPulse = 0.52;
      this.triggerGlitch('mash', 0.72, 0.52);
      this.audio.playOneShot('monitor_glitch', { volume: 0.42, duration: 1.0, releaseSec: 0.35 });
      this.audio.playOneShot('flesh_pulse', { volume: 0.36, rate: 1.12, duration: 0.9, releaseSec: 0.3, reverb: 0.3 });
      // Creepy spatialised floorboard creak + breath RIGHT BEHIND YOUR CHAIR!
      this.audio.playOneShot('creak_room', {
        volume: 0.58,
        rate: 0.78,
        pos: this.behindNeckSoundPos,
      });
      this.audio.playOneShot('gasp', {
        volume: 0.28,
        rate: 0.82,
        pos: this.behindNeckSoundPos,
      });
      this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
        volume: 0.12,
        fadeSec: 1.1,
      });
      this.showSubtitle('画面右の深度スキャン——椅子の真後ろ38cmに、知らない誰かが立っている。', 3900);
    } else if (this.clickCount === 3) {
      this.targetMadness = 0.58;
      this.jawVel += 1.45;
      this.targetJawOpen = 0.50;
      this.horrorPulse = 0.72;
      // Desk lamp bulb violently pops out -> bedroom plunges into dread!
      this.audio.playOneShot('shatter', { volume: 0.52, rate: 1.55, duration: 0.55, releaseSec: 0.2, reverb: 0.25 });
      this.audio.playOneShot('flesh_pulse', { volume: 0.44, rate: 0.98, duration: 1.2, releaseSec: 0.35, reverb: 0.35 });
      this.triggerGlitch('sort', 0.80, 0.64);
      this.audio.playOneShot('scrapemare', {
        volume: 0.36,
        duration: 5.2,
        fadeInSec: 0.4,
        releaseSec: 1.6,
        reverb: 0.5,
      });
      this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
        volume: 0.22,
        fadeSec: 0.8,
      });
      this.showSubtitle('電球が破裂した。4枚に裂けた肉顎がガラスから捲れ出し、運動神経が切断されて椅子から立てない！', 3800);
    } else if (this.clickCount === 4) {
      this.targetMadness = 0.80;
      this.jawVel += 1.85;
      this.targetJawOpen = 0.72;
      this.horrorPulse = 0.86;
      this.triggerGlitch('roll', 0.86, 0.78);
      this.audio.playOneShot('noise_wave', { volume: 0.42, duration: 2.8, releaseSec: 1.0, reverb: 0.4 });
      this.audio.playOneShot('monitor_glitch', { volume: 0.58, duration: 1.2, releaseSec: 0.4 });
      this.audio.playOneShot('flesh_pulse', { volume: 0.52, rate: 0.90, duration: 1.4, releaseSec: 0.4, reverb: 0.38 });
      this.audio.startOrUpdateLoop('static_elec', 'static_elec', {
        volume: 0.36,
        fadeSec: 0.7,
      });
      this.showSubtitle('歯列を剥き出しに大きく開いた口が微動だにせず待ち構え、部屋の空気を喉の奥へ吸い込んでいる……！', 3600);
    } else if (this.clickCount === 5) {
      // UNHINGED PREDATORY GAPE — wide-open waiting maw pulling air inward before swallowing!
      this.targetMadness = 0.96;
      this.jawVel += 2.45;
      this.targetJawOpen = 0.92;
      this.horrorPulse = 0.99;
      this.triggerGlitch('ghost', 0.96, 1.5);
      this.triggerGlitch('tear', 0.88, 0.42);
      this.audio.playOneShot('sub_boom', { volume: 0.68, rate: 1.06, reverb: 0.3 });
      this.audio.playOneShot('flesh_pulse', { volume: 0.62, rate: 0.88, duration: 1.6, releaseSec: 0.4, reverb: 0.42 });
      this.audio.playOneShot('pain_glitch', { volume: 0.55, rate: 0.86, duration: 1.4, releaseSec: 0.4, reverb: 0.35 });
      this.showSubtitle('瞬きも声帯もアンマウントされた——限界まで開いたまま待つ漆黒の喉へ、身体ごと引きずり込まれる！！', 3000);
    } else {
      this.audio.stopLoop('throat_draft', 0.15);
      this.beginPredatorySuction();
    }
  }

  private beginPredatorySuction(): void {
    this.phase = 'SUCTION_CUTSCENE';
    this.suctionStartClock = this.getTimelineClock();
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
    this.audio.stopLoop('rain_window', 0.6);
    this.audio.stopLoop('rain_aftermath', 0.4);
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
   * 100% Seamless Forward-Flying Tunnel-to-3D-World Arrival!
   * Hands off mid-tunnel inside Sky-Monitor's 56m 3D Exit Sleeve while flying straight forward
   * (zero whiteout cut, zero 180° flip), then bursts out through the shattered 28m BSOD glass at t=1.15s!
   */
  private beginGlitchArrivalCutscene(): void {
    this.phase = 'GLITCH_ARRIVAL_CUTSCENE';
    this.arrivalStartClock = this.getTimelineClock();
    this.glitchArrivalTimer = 0;
    this.glitchArrivalRollCuePlayed = false;
    this.glitchArrivalLanded = false;

    this.bedroom.bsodScreen.setInsideTunnelMode(false);
    this.glitchWorld.setArrivalSleeveActive(true);

    this.crosshairEl.classList.add('hidden');
    this.worldHintEl.classList.add('hidden');
    // Zero flash at tunnel handoff so the sleeve walls & forward portal stay 100% continuous!
    this.screenFlash = 0.0;
    this.horrorPulse = 0.22;

    this.audio.stopOneShots('transition', 1.15);
    this.audio.stopLoop('pc_fan', 0.35);
    this.audio.stopLoop('static_elec', 0.45);
    this.audio.startOrUpdateLoop('fall_wind', 'fall_wind', {
      volume: 0.84,
      rate: 1.18,
      fadeSec: 0.15,
    });

    this.audio.startOrUpdateLoop('bgm_glitch', 'bgm_glitch_world', {
      volume: 0.34,
      fadeSec: 2.6,
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

    this.player.updateGlitchArrivalCutscene(
      0.016,
      0,
      this.glitchWorld.spawnPosition,
      this.glitchWorld.corePosition,
      this.glitchWorld.skyPortalPos,
      this.glitchWorld.skyPortalQuat
    );
  }

  private beginCollapseSequence(): void {
    if (this.phase === 'COLLAPSE_CUTSCENE') return;
    this.phase = 'COLLAPSE_CUTSCENE';
    this.collapseStartClock = this.getTimelineClock();
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
    this.landingStartClock = this.getTimelineClock();
    this.landingTimer = 0;
    this.aftermath = true;

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
    this.audio.startOrUpdateLoop('rain_aftermath', 'rain_aftermath', {
      volume: 0.22,
      pos: this.bedroom.windowSoundPos,
      refDistance: 1.15,
      maxDistance: 7.5,
      fadeSec: 2.0,
    });
  }

  private updatePcCursorRaycast(dt = 0.016): void {
    // At high madness (clickCount >= 3), the Parasyte maw subtly drags & trembles the cursor toward its teeth!
    if (this.madness > 0.38 && !this.aftermath && document.pointerLockElement === this.renderer.domElement) {
      const pullStrength = (this.madness - 0.38) * 62.0 * dt;
      const targetX = window.innerWidth * 0.49;
      const targetY = window.innerHeight * 0.51;
      const dx = targetX - this.player.inspectCursorPx.x;
      const dy = targetY - this.player.inspectCursorPx.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 14) {
        this.player.inspectCursorPx.x += (dx / dist) * pullStrength;
        this.player.inspectCursorPx.y += (dy / dist) * pullStrength;
      }
    }

    const tremor = this.madness > 0.30 ? (this.madness - 0.30) * 4.5 : 0;
    const jx = tremor > 0 ? Math.sin(this.elapsed * 47.0) * tremor : 0;
    const jy = tremor > 0 ? Math.cos(this.elapsed * 53.0) * tremor : 0;
    const px = this.player.inspectCursorPx.x + jx;
    const py = this.player.inspectCursorPx.y + jy;
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

    // Fast-reacting 0.40s adaptive resolution governor in 'auto' mode so ANY GPU stays locked smooth!
    if (this.qualityMode === 'auto' && !this.paused && rawDt > 0.001 && rawDt < 0.35) {
      this.emaFrameMs = this.emaFrameMs * 0.85 + rawDt * 1000 * 0.15;
      this.scaleCheckAccum += dt;
      if (this.scaleCheckAccum > 0.40) {
        this.scaleCheckAccum = 0;
        const maxAuto = this.computeAutoBaseScale();
        const inBedroom =
          this.phase === 'TITLE' ||
          this.phase === 'ROAM_BEDROOM' ||
          this.phase === 'INSPECT_PC' ||
          this.phase === 'EXIT_INSPECT' ||
          this.phase === 'AFTERMATH_ROAM';
        const minAuto = inBedroom
          ? (this.isLowTierGpu ? 0.78 : 0.92)
          : (this.isLowTierGpu ? 0.62 : 0.76);
        if (this.renderScale < minAuto) {
          this.renderScale = minAuto;
          this.applyViewportResolution();
        } else if (this.emaFrameMs > 20.5 && this.renderScale > minAuto + 0.02) {
          this.renderScale = Math.max(minAuto, +(this.renderScale - 0.08).toFixed(2));
          this.applyViewportResolution();
        } else if (this.emaFrameMs < 13.0 && this.renderScale < maxAuto - 0.03) {
          this.renderScale = Math.min(maxAuto, +(this.renderScale + 0.08).toFixed(2));
          this.applyViewportResolution();
        }
      }
    }

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
    // Always-on subtle highlight-lift & bloom glow across all phases
    let bloomAmt = 0.58 + bendAmt * 0.16 + ghostAmt * 0.12;

    let sharpenAmt = 0.34;

    if (this.phase === 'ROAM_BEDROOM' || this.phase === 'AFTERMATH_ROAM' || this.phase === 'TITLE') {
      vigAmt = 0.32;
      bloomAmt = 0.56;
      sharpenAmt = 0.38;
    } else if (this.phase === 'INSPECT_PC') {
      chromaAmt = Math.max(chromaAmt, this.madness * 0.22);
      vigAmt = 0.34 + this.madness * 0.24;
      warpAmt = Math.max(0, (this.madness - 0.55) * 0.28);
      horrorAmt = Math.max(horrorAmt, this.madness * 0.45);
      bloomAmt = 0.60 + this.madness * 0.55;
      sharpenAmt = 0.36;
    } else if (this.phase === 'SUCTION_CUTSCENE') {
      const tunnelRush = THREE.MathUtils.smoothstep(this.suctionTimer, 2.1, 6.2);
      const handoffClean = 1.0 - THREE.MathUtils.smoothstep(this.suctionTimer, 5.4, 7.1);
      distortAmt = Math.max(distortAmt, 0.14 + (1.0 - tunnelRush) * 0.34);
      chromaAmt = 0.24 + tunnelRush * 0.14;
      vigAmt = 0.38 + tunnelRush * 0.06;
      warpAmt = 0.16 + tunnelRush * 0.22;
      horrorAmt = Math.max(horrorAmt, 0.55 * (1.0 - tunnelRush * 0.75));
      mashAmt = Math.max(mashAmt, tunnelRush * 0.14 * handoffClean);
      ghostAmt = Math.max(ghostAmt, tunnelRush * 0.12 * handoffClean);
      bloomAmt = 0.78 + tunnelRush * 0.28;
      sharpenAmt = 0.18;
    } else if (this.phase === 'GLITCH_ARRIVAL_CUTSCENE') {
      // Crystal-clear C0-continuous match to SUCTION_CUTSCENE (t=7.20s -> arrival t=0.00s), ZERO hitch at exit!
      const diveFrac = THREE.MathUtils.clamp(1.0 - this.glitchArrivalTimer / 4.30, 0, 1);
      distortAmt = Math.max(distortAmt, diveFrac * 0.14);
      chromaAmt = Math.max(chromaAmt, diveFrac * 0.38);
      vigAmt = 0.28 + diveFrac * 0.16;
      warpAmt = diveFrac * 0.38;
      bloomAmt = 0.84 + diveFrac * 0.22;
      sharpenAmt = 0.32;
    } else if (this.phase === 'ROAM_GLITCH') {
      // Full-screen razor-sharp view across the entire 3D world (zero mosaic filter!)
      distortAmt = Math.max(distortAmt, this.glitchWorld.anomalyIntensity * 0.65);
      chromaAmt = Math.max(chromaAmt, this.glitchWorld.anomalyIntensity * 0.42);
      vigAmt = 0.28;
      warpAmt = this.glitchWorld.anomalyIntensity * 0.12;
      horrorAmt = Math.max(horrorAmt, this.glitchWorld.anomalyIntensity * 0.28);
      bloomAmt = 0.84 + this.glitchWorld.anomalyIntensity * 0.42;
      sharpenAmt = 0.34;
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
      sharpenAmt = 0.24;
    }

    this.postFX.render(this.renderer, this.getActiveScene(), this.camera, this.elapsed, {
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
      bloom: this.autoBloomEnabled ? bloomAmt : 0,
      sharpen: sharpenAmt,
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
        this.tunnelScrollPhase += dt * 6.0;
        this.camera.position.set(
          0.35 + Math.sin(this.elapsed * 0.35) * 0.025,
          1.58 + Math.sin(this.elapsed * 0.55) * 0.015,
          0.62
        );
        this.camera.lookAt(this.bedroom.monitorWorldPos);
        this.camera.getWorldDirection(this._camFwd);
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
          0,
          this.tunnelScrollPhase
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, false, undefined, this._camFwd);
        break;
      }

      case 'ROAM_BEDROOM':
      case 'AFTERMATH_ROAM': {
        this.tunnelScrollPhase += dt * 6.0;
        this.player.updateFreeRoam(
          dt,
          2.35,
          (x, z) => this.bedroom.getFloorHeight(x, z, this.player.position.y),
          (pos) => this.bedroom.resolvePlayerCollision(pos, 0.26),
          true,
          { jumpSpeed: 4.15, gravity: 13.8, ceilingY: 3.13 }
        );
        this.camera.getWorldDirection(this._camFwd);

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
          0,
          this.tunnelScrollPhase
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, this.aftermath, this.player.position, this._camFwd);
        break;
      }

      case 'EXIT_INSPECT': {
        this.tunnelScrollPhase += dt * 6.0;
        this.exitInspectBlend = Math.min(1, this.exitInspectBlend + dt * 3.2);
        this.player.updateExitInspectBlend(this.exitInspectBlend);
        this.camera.getWorldDirection(this._camFwd);
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
            aftermath: this.aftermath,
          },
          0,
          this.tunnelScrollPhase
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, this.aftermath, this.player.position, this._camFwd);
        if (this.exitInspectBlend >= 1) {
          this.phase = this.aftermath ? 'AFTERMATH_ROAM' : 'ROAM_BEDROOM';
        }
        break;
      }

      case 'INSPECT_PC': {
        if (this.chairEscapeCooldown > 0) {
          this.chairEscapeCooldown = Math.max(0, this.chairEscapeCooldown - dt);
        }
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
        this.updatePcCursorRaycast(dt);

        if (this.aftermath) {
          this.interactPromptEl.textContent = '[左クリック] 黒い画面に触れる（再侵食）  |  [右クリック / Q] 離れる';
          this.interactPromptEl.classList.remove('hidden');
        } else if (this.clickCount === 0) {
          this.interactPromptEl.textContent = '「:(」にカーソルを重ねてクリック  |  [右クリック / Q] 離れる';
          this.interactPromptEl.classList.remove('hidden');
        } else if (this.clickCount < 3) {
          this.interactPromptEl.textContent = '裂け始めた「:(」をクリック  |  [右クリック / Q] 離れる';
          this.interactPromptEl.classList.remove('hidden');
        } else {
          this.interactPromptEl.textContent = ':(  顎が指を離さない  —  クリックを続けろ  :(';
          this.interactPromptEl.classList.remove('hidden');
        }

        if (!this.aftermath) {
          this.stepFirstContact(dt);
          // Hollow inward throat draft as the 4-split jaw holds wide open waiting to suck you in (no pakupaku chomp!)
          if (this.jawOpen > 0.18) {
            const draftVol = THREE.MathUtils.clamp((this.jawOpen - 0.18) * 0.28, 0.03, 0.22);
            this.audio.startOrUpdateLoop('throat_draft', 'fall_wind', {
              volume: draftVol,
              rate: 0.56 + this.madness * 0.14,
              lowpassHz: 420 + this.madness * 260,
              pos: this.bedroom.monitorWorldPos,
              refDistance: 0.5,
              maxDistance: 3.5,
              fadeSec: 0.25,
            });
          }
        }

        const roomInfect = this.aftermath ? 0 : THREE.MathUtils.clamp((this.madness - 0.18) * 1.15, 0, 0.92);
        const roomPull = this.aftermath ? 0 : THREE.MathUtils.clamp((this.madness - 0.45) * 0.85, 0, 0.48);
        this.tunnelScrollPhase += dt * (6.0 + this.madness * 6.0);
        this.camera.getWorldDirection(this._camFwd);

        this.bedroom.bsodScreen.update(
          dt,
          this.elapsed,
          {
            hoverFace: this.aftermath ? false : this.hoverFace,
            cursorUv: this.cursorMonitorUv,
            clickCount: this.clickCount,
            madness: this.madness,
            jawOpen: this.jawOpen,
            suctionProgress: 0,
            aftermath: this.aftermath,
          },
          this.clickPulse,
          this.tunnelScrollPhase
        );
        this.bedroom.update(dt, this.elapsed, roomInfect, roomPull, this.aftermath, undefined, this._camFwd);
        break;
      }

      case 'SUCTION_CUTSCENE': {
        this.suctionTimer = Math.max(0, this.getTimelineClock() - this.suctionStartClock);
        const { progress, insideTunnel } = this.player.updateSuctionCutscene(
          this.suctionTimer,
          this.suctionDuration,
          this.bedroom.monitorWorldPos,
          this.bedroom.monitorWorldQuat,
          this.bedroom.bsodScreen.root.scale.z
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
        // 5.40s — brief memory double-exposure well before the clean 7.20s sleeve handoff!
        cue('ghostA', 5.4, () => this.triggerGlitch('ghost', 0.45, 0.85));

        this.tunnelScrollPhase += dt * (6.0 + progress * 42.0);
        this.camera.getWorldDirection(this._camFwd);
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
          0.4,
          this.tunnelScrollPhase
        );
        this.bedroom.update(dt, this.elapsed, 1.0, 0.55 + progress * 0.65, false, undefined, this._camFwd);

        if (this.suctionTimer >= this.suctionDuration) {
          this.beginGlitchArrivalCutscene();
        }
        break;
      }

      case 'GLITCH_ARRIVAL_CUTSCENE': {
        this.glitchArrivalTimer = Math.max(0, this.getTimelineClock() - this.arrivalStartClock);
        this.tunnelScrollPhase += dt * 48.0;
        const { finished, touchedDown, crossedAperture } = this.player.updateGlitchArrivalCutscene(
          dt,
          this.glitchArrivalTimer,
          this.glitchWorld.spawnPosition,
          this.glitchWorld.corePosition,
          this.glitchWorld.skyPortalPos,
          this.glitchWorld.skyPortalQuat
        );
        this.camera.getWorldDirection(this._camFwd);
        const arrivalReveal = THREE.MathUtils.smoothstep(this.glitchArrivalTimer, 0.0, 0.62);

        this.glitchWorld.update(
          dt,
          this.elapsed,
          this.camera.position,
          null,
          this.tunnelScrollPhase,
          arrivalReveal,
          this._camFwd
        );

        // Exact moment (t = 1.12s) you glide seamlessly out of the flared sky conduit into open 3D space!
        if (crossedAperture && !this.glitchArrivalRollCuePlayed) {
          this.glitchArrivalRollCuePlayed = true;
          this.audio.playOneShot('swoosh_thunder', { volume: 0.76, rate: 0.94, reverb: 0.55 });
          this.audio.playOneShot('transition_solemn', { volume: 0.58, reverb: 0.55 });
          this.showSubtitle('天空の亀裂を抜け落ちた——眼下のデータ海の果てに、蒼白い光の柱が立つ聖堂が聳えている。', 4600);
        }

        if (touchedDown && !this.glitchArrivalLanded) {
          this.glitchArrivalLanded = true;
          this.glitchWorld.setArrivalSleeveActive(false);
          this.audio.stopLoop('fall_wind', 0.22);
          this.audio.playOneShot('land_impact', { volume: 0.86, rate: 0.92, reverb: 0.42 });
          this.audio.playOneShot('sub_boom', { volume: 0.70, rate: 1.0, reverb: 0.35 });
          this.audio.playOneShot('swoosh_thunder', { volume: 0.44, rate: 1.25, reverb: 0.45 });
          this.audio.playOneShot('gasp', { volume: 0.56, rate: 0.98 });
          this.glitchWorld.triggerLandingShockwave();
          this.triggerSpatialWave(0.86, 0.95);
          this.triggerGlitch('tear', 0.48, 0.30);
          this.screenFlash = 0.14;
        }

        if (finished) {
          this.phase = 'ROAM_GLITCH';
          this.opticStrain = 0;
          this.periodicWarpCooldown = 6.5;
          this.crosshairEl.classList.remove('hidden');
          this.worldHintEl.textContent = '[WASD] 探索  |  [SPACE] ジャンプ  |  [C] コンソールを開く';
          this.worldHintEl.classList.remove('hidden');
          this.showSubtitle('正面の大橋の先に光の柱が見える——消化が100%に達する前に中央聖堂へ向かえ。', 5200);
        }
        break;
      }

      case 'ROAM_GLITCH': {
        const canMove = !this.consoleUI.isOpen;
        const wasRevealed = this.glitchWorld.coreSecretRevealed;
        if (this.gazeWarnCooldown > 0) {
          this.gazeWarnCooldown = Math.max(0, this.gazeWarnCooldown - dt);
        }
        this.tunnelScrollPhase += dt * 48.0;

        this.player.updateFreeRoam(
          dt,
          5.5,
          (x, z) => this.glitchWorld.getFloorHeight(x, z, this.player.position.y),
          (pos) => this.glitchWorld.resolvePlayerBounds(pos),
          canMove,
          { jumpSpeed: 6.35, gravity: 15.2 }
        );

        this.camera.getWorldDirection(this._camFwd);
        this.glitchWorld.update(
          dt,
          this.elapsed,
          this.player.position,
          null,
          this.tunnelScrollPhase,
          1.0,
          this._camFwd
        );
        this.crosshairEl.classList.remove('active');
        this.interactPromptEl.classList.add('hidden');

        // Subtle atmospheric Sky-Eye gaze tension when staring directly up at the colossal eye during surges
        const anomaly = this.glitchWorld.anomalyIntensity;
        const sheltered = this.glitchWorld.isPlayerSheltered(this.player.position);
        const eyeAlign = this._camFwd.dot(this._skyEyeDir);
        if (canMove && anomaly > 0.30 && !sheltered && eyeAlign > 0.68) {
          this.opticStrain = Math.min(1.0, this.opticStrain + dt * (0.55 + anomaly * 0.65));
          this.horrorPulse = Math.max(this.horrorPulse, 0.28 + this.opticStrain * 0.55);
          if (this.opticStrain > 0.60 && this.gazeWarnCooldown <= 0) {
            this.gazeWarnCooldown = 5.5;
            this.triggerGlitch('tear', 0.48, 0.28);
            this.audio.playOneShot('heartbeat', { volume: 0.42, rate: 1.2 });
            this.showSubtitle('天球の紅い瞳孔がこちらを見下ろしている……！', 3000);
          }
        } else {
          this.opticStrain = Math.max(0, this.opticStrain - dt * 1.25);
        }

        const distCore = Math.hypot(
          this.player.position.x - this.glitchWorld.corePosition.x,
          this.player.position.z - this.glitchWorld.corePosition.z
        );
        this.consoleUI.setWorldState(this.glitchWorld.coreSecretRevealed, distCore);

        // Seamless Environmental Horror Milestones along the Causeway (zero tedious item collecting!)
        if (this.player.position.z < 4.0 && !this.glitchMilestones.archEntry) {
          this.glitchMilestones.archEntry = true;
          this.audio.playOneShot('dissonance', { volume: 0.22, duration: 3.6, fadeInSec: 0.3, releaseSec: 1.2, reverb: 0.55 });
          this.showSubtitle('橋の縁に立つ黒い人影がこちらを見ている……近づくとノイズに溶けて消える。', 4400);
        } else if (this.player.position.z < -20.0 && !this.glitchMilestones.midSpan) {
          this.glitchMilestones.midSpan = true;
          this.glitchWorld.triggerAnomalySurge(0.70);
          this.horrorPulse = Math.max(this.horrorPulse, 0.34);
          this.triggerGlitch('ghost', 0.42, 0.7);
          this.audio.playOneShot('anomaly_tremor', { volume: 0.30, reverb: 0.58 });
          this.showSubtitle('頭上140mを巨大な脊椎が泳いでいく——青画面に呑まれた残骸がこの海を漂っている。', 4600);
        } else if (this.player.position.z < -39.0 && !this.glitchMilestones.effigySeen) {
          this.glitchMilestones.effigySeen = true;
          this.horrorPulse = Math.max(this.horrorPulse, 0.48);
          this.audio.playOneShot('heartbeat', { volume: 0.46, rate: 1.15 });
          this.showSubtitle('聖堂の階段脇——午前2時47分の「自分」がオフィスチェアに座ったまま固まっている……！', 4800);
        }

        if (!wasRevealed && this.glitchWorld.coreSecretRevealed) {
          this.audio.playOneShot('ghost_cantata', { volume: 0.48, reverb: 0.55 });
          this.worldHintEl.textContent = '[C] コンソールを開き「WAKE_UP」を実行せよ';
          this.showSubtitle('中央聖堂の上空に7文字の命令が収束した——[C] でコンソールを開き入力せよ！', 5200);
        }

        const nearCoreFactor = THREE.MathUtils.clamp(1 - distCore / 50, 0, 1);
        this.audio.startOrUpdateLoop('bgm_dread', 'bgm_dread_drone', {
          volume: 0.12 + nearCoreFactor * 0.26,
          fadeSec: 0.5,
        });
        break;
      }

      case 'COLLAPSE_CUTSCENE': {
        this.collapseTimer = Math.max(0, this.getTimelineClock() - this.collapseStartClock);

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

        this.camera.getWorldDirection(this._camFwd);
        this.glitchWorld.update(
          dt,
          this.elapsed,
          this.camera.position,
          this.collapseTimer,
          this.tunnelScrollPhase,
          1.0,
          this._camFwd
        );

        if (this.collapseTimer >= this.collapseDuration) {
          this.beginBedroomReturnLanding();
        }
        break;
      }

      case 'RETURN_LANDING': {
        this.landingTimer = Math.max(0, this.getTimelineClock() - this.landingStartClock);
        const finished = this.player.updateReturnLandingCutscene(dt, this.landingTimer);
        this.camera.getWorldDirection(this._camFwd);

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
          0,
          this.tunnelScrollPhase
        );
        this.bedroom.update(dt, this.elapsed, 0, 0, true, this.player.position, this._camFwd);

        if (finished) {
          this.phase = 'AFTERMATH_ROAM';
          this.crosshairEl.classList.remove('hidden');
          this.aftermathBarEl.classList.remove('hidden');
          this.showSubtitle(
            '自室のラグの上に倒れ込んでいた……窓ガラスを伝う残り雫の向こうは静まり返り、無人の椅子だけがこちらへ向き直っている。',
            6000
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
