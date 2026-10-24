import * as THREE from 'three';
import type { Assets } from '../core/assets';
import type { AudioEngine } from '../core/audio';
import type { Input } from '../core/Input';
import type { PostFX } from '../core/postfx';
import type { UI } from '../ui/UI';
import { CameraScript, type Pose } from '../core/camera-script';
import { CollisionWorld } from '../core/collision';
import { glitchUniforms } from '../core/materials';
import { Tunnel } from './Tunnel';
import { Player } from './Player';
import { Room, ROOM, MON as MON_POINT } from './Room';
import { World, WORLD } from './World';
import { GameConsole } from './Console';
import { clamp, damp, deg, ease, lerp, RNG } from '../core/util';

export type Phase =
  | 'boot' | 'room' | 'leanin' | 'screen' | 'finale' | 'drop'
  | 'void' | 'collapse' | 'fall' | 'return';

type Refs = {
  renderer: THREE.WebGLRenderer;
  sceneRoom: THREE.Scene;
  sceneWorld: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  assets: Assets;
  audio: AudioEngine;
  ui: UI;
  post: PostFX;
  input: Input;
  player: Player;
  room: Room;
  world: World;
};

type Timer = { at: number; fn: () => void; done: boolean };

const MON = MON_POINT;

/**
 * ゲーム全体の進行 (自室 → BSOD → 異世界 → 崩壊 → 帰還)。
 * カメラの所有権・入力の有効/無効・音の遷移をここで一元管理する。
 */
export class Director {
  phase: Phase = 'boot';
  /** 0 = 画面→口, 1 = 口→異世界の落下 */
  private dropStage: 0 | 1 = 0;
  t = 0;
  clicks = 0;
  torch = false;
  private r = {} as Refs;
  private script: CameraScript | null = null;
  private timers: Timer[] = [];
  private raycaster = new THREE.Raycaster();
  private screenPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private facePortal: THREE.Mesh | null = null;
  private mouthDisk: THREE.Mesh | null = null;
  private flash = 0;
  private flashColor = new THREE.Color(0.05, 0.34, 0.72);
  private gateTunnel: Tunnel | null = null;
  private worldShaft: Tunnel | null = null;
  private roomShaft: Tunnel | null = null;
  private debris: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private rng = new RNG(31337);
  private hasReturned = false;
  private areaShown = new Set<string>();
  private lastScene: 'room' | 'world' = 'room';
  private fxShake = 0;
  private camShake = 0;
  private debug = false;

  constructor(refs: Refs) {
    this.r = refs;
    this.debug = new URLSearchParams(location.search).has('debug');
  }

  /* ================= 初期化・遷移 ================= */
  async startRoom(first = true) {
    const { ui, audio, player, room, world, input } = this.r;
    this.phase = 'room';
    this.t = 0;
    this.clicks = 0;
    this.timers = [];
    this.script = null;
    this.hasReturned = false;
    this.areaShown.clear();
    this.camShake = 0;
    this.fxShake = 0;
    this.torch = false;

    room.reset();
    world.reset();
    player.reset();
    player.freeze = false;
    player.setPosition(0.15, 0, 1.35);
    player.yaw = 0;
    player.pitch = -0.06;
    room.collision.allowFalling = false;
    player.interactables = room.interactables;

    input.gameplay = true;
    input.lookEnabled = true;
    input.sensitivity = ui.settings.sensitivity;
    input.invertY = ui.settings.invertY;

    if (this.lastScene !== 'room') {
      audio.stopAllLayers(1.5);
      this.audioLayersReset();
    }
    this.lastScene = 'room';
    this.r.post.renderPass.scene = this.r.sceneRoom;
    this.r.post.gtao.scene = this.r.sceneRoom;
    this.r.sceneRoom.add(room.group);

    audio.setReverb(0.32, 'room');
    if (!this.roomAmbience) this.roomAmbience = audio.roomAmbience({ pc: MON.clone(), window: new THREE.Vector3(ROOM.x1, 1.5, 0) });
    ui.setChapter('STILL 01 — 自室');
    ui.setAreaTitle('03:07 / 自室');
    ui.showHud(true);
    room.screenOff();
    if (first) {
      await this.r.input.requestLock();
      ui.setSubtitle('午前 3 時 7 分。\nモニターの光だけが、部屋を青くしている。', 7000);
    }
  }
  private roomAmbience: { stop: (f?: number) => void } | null = null;
  private voidAmbience: { stop: (f?: number) => void } | null = null;

  private audioLayersReset() {
    this.roomAmbience?.stop(0.6);
    this.voidAmbience?.stop(0.6);
    this.roomAmbience = null;
    this.voidAmbience = null;
  }

  /* ================= 毎フレーム ================= */
  update(dt: number) {
    this.t += dt;
    const { ui, input, player, camera, audio, post } = this.r;
    input.sensitivity = ui.settings.sensitivity;
    input.invertY = ui.settings.invertY;
    player.settings.bobEnabled = ui.settings.shake > 0.01;
    player.settings.bobScale = ui.settings.shake;

    // タイマ
    for (const tm of this.timers) {
      if (!tm.done && this.t >= tm.at) { tm.done = true; tm.fn(); }
    }
    this.timers = this.timers.filter((x) => !x.done);

    this.camShake = damp(this.camShake, 0, 6, dt);
    this.fxShake = damp(this.fxShake, 0, 5, dt);

    switch (this.phase) {
      case 'room': this.updateRoom(dt); break;
      case 'leanin': this.updateLeanIn(dt); break;
      case 'screen': this.updateScreen(dt); break;
      case 'finale': this.updateFinale(dt); break;
      case 'drop': this.updateDrop(dt); break;
      case 'void': this.updateVoid(dt); break;
      case 'collapse': this.updateCollapse(dt); break;
      case 'fall': this.updateFall(dt); break;
      case 'return': this.updateReturn(dt); break;
      default: break;
    }

    // カメラ揺れ (設定で低減)
    const shakeAmt = this.camShake * ui.settings.shake;
    if (shakeAmt > 0.0001) {
      camera.rotateX(this.rng.range(-1, 1) * shakeAmt * 0.02);
      camera.rotateY(this.rng.range(-1, 1) * shakeAmt * 0.02);
      camera.rotateZ(this.rng.range(-1, 1) * shakeAmt * 0.008);
    }

    // 音のリスナー
    audio.updateListener(camera);
    ui.tick(dt);

    // 演出パラメータ
    const glitchScale = ui.settings.glitch;
    post.update(dt, {
      glitch: (this.glitchTarget() + this.fxGlitch) * glitchScale,
      grain: this.grainTarget(),
      vignette: 0.45 + (this.phase === 'void' ? 0.12 : 0),
      chroma: 0.0018,
      scan: this.phase === 'void' ? 0.09 : 0.05,
      fade: this.fadeTarget,
      tint: this.tintTarget,
      distort: 0.06 + this.distort,
      block: this.blockTarget * glitchScale,
      shake: this.fxShake * glitchScale,
      warp: this.warpTarget,
      flash: this.flash,
      flashColor: this.flashColor,
      focus: this.focusTarget,
      aperture: this.apertureTarget,
      dofEnabled: this.focusTarget > 0.05,
      bloom: this.phase === 'void' ? 0.62 : 0.5,
    });
    glitchUniforms.uTime.value += dt;
    glitchUniforms.uGlitch.value = damp(glitchUniforms.uGlitch.value, this.sceneGlitch, 3, dt);

    // レティクル
    this.updateReticle();
  }

  /* ポストエフェクトの目標値 (フェーズごと) */
  private sceneGlitch = 0;
  private fadeTarget = 1;
  private tintTarget = new THREE.Color(1, 1, 1);
  private distort = 0;
  private focusTarget = 3.0;
  private apertureTarget = 0.55;
  private warpTarget = 0;
  private blockTarget = 0;
  private fxGlitch = 0;
  private grainTarget() { return this.phase === 'void' ? 0.075 : 0.05; }
  private glitchTarget() {
    switch (this.phase) {
      case 'screen': return this.clicks * 0.03;
      case 'finale': return 0.45;
      case 'collapse': return clamp(this.t / 6, 0, 1) * 0.5;
      case 'fall': return 0.35;
      case 'drop': return 0.25;
      case 'return': return clamp(1 - this.t / 3, 0, 1) * 0.35;
      case 'void': return 0.06;
      default: return 0;
    }
  }

  /* ================= 自室 ================= */
  private updateRoom(dt: number) {
    const { player, room, input, camera, ui } = this.r;
    if (ui.reading || this.r.ui.consoleOpen) { player.freeze = true; return; }
    player.freeze = false;
    player.update(dt, input, room.collision);
    player.applyCamera(camera);
    room.update(dt, this.t, camera, this.torch);
    room.setFlashlight(this.torch);
    this.focusTarget = 5.0;
    this.apertureTarget = 0.35;
    this.blockTarget = 0;
    this.warpTarget = 0;
    this.distort = 0;
    this.fadeTarget = 1;
    this.tintTarget.setRGB(1, 1, 1);

    if (input.wasPressed('KeyF')) { this.torch = !this.torch; ui.setSubtitle(this.torch ? 'スマホのライトを点けた。' : 'ライトを消した。', 1600, true); }
    if (input.wasPressed('KeyE') || input.clicked) this.useFocused();
  }

  private currentInteractables() {
    return this.phase === 'void' || this.phase === 'collapse' || this.phase === 'fall'
      ? this.r.world.interactables
      : this.r.room.interactables;
  }

  private useFocused() {
    const it = this.r.player.focus;
    if (!it) return;
    if (it.enabled && !it.enabled()) return;
    it.onUse();
  }

  private updateReticle() {
    const { player, ui } = this.r;
    const interactive = this.phase === 'room' || this.phase === 'void';
    if (!interactive) { ui.setPrompt(null); return; }
    if (player.focus) {
      ui.setPrompt(Player.labelOf(player.focus));
      ui.setReticle('interactive');
    } else {
      ui.setPrompt(null);
      ui.setReticle('default');
    }
  }

  /* ================= PC を調べる ================= */
  usePC() {
    const { ui, audio, player, camera } = this.r;
    if (this.hasReturned) {
      // 帰還後: もう一度はじめから
      ui.openRead('SYSTEM', 'モニターは、まだ青い。\n\n「:(\n\nもう一度、最初から。');
      this.timers.push({
        at: this.t + 0.6, done: false, fn: () => {
          ui.setSubtitle('F5 か Esc メニューの「はじめから」で、状態を完全に初期化して再開できます。', 8000);
        },
      });
      return;
    }
    if (this.phase !== 'room') return;
    this.phase = 'leanin';
    this.t = 0;
    this.timers = [];
    player.freeze = true;
    this.r.input.lookEnabled = false;
    this.r.input.releaseLock();
    this.r.ui.setPrompt(null);
    this.r.ui.setReticle('hidden');
    this.r.ui.setChapter('STILL 01 — 自室 / モニター');

    // 見ている方向からモニターへ寄る
    const eye = player.eyePosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
    const lookStart = eye.clone().addScaledVector(dir, 3);
    const targetPos = new THREE.Vector3(MON.x - 0.03, MON.y - 0.06, MON.z + 1.02);
    const lookScreen = new THREE.Vector3(MON.x, MON.y - 0.02, MON.z);
    this.screenPose.pos.copy(targetPos);
    this.screenPose.look.copy(lookScreen);

    this.script = new CameraScript([
      { at: 0, pos: [eye.x, eye.y, eye.z], look: [lookStart.x, lookStart.y, lookStart.z], fov: 62, roll: 0, focus: 5, sway: 0.2 },
      { at: 0.75, pos: [lerp(eye.x, targetPos.x, 0.55), lerp(eye.y, targetPos.y, 0.5) + 0.03, lerp(eye.z, targetPos.z, 0.5)], look: [lookScreen.x, lookScreen.y, lookScreen.z], fov: 58, roll: -0.02, focus: 1.6, sway: 0.4 },
      { at: 1.9, pos: [targetPos.x, targetPos.y, targetPos.z], look: [lookScreen.x, lookScreen.y + 0.01, lookScreen.z], fov: 50, roll: -0.055, focus: 0.58, sway: 0.5 },
      { at: 2.7, pos: [targetPos.x + 0.012, targetPos.y - 0.005, targetPos.z - 0.02], look: [lookScreen.x, lookScreen.y + 0.02, lookScreen.z], fov: 49, roll: -0.04, focus: 0.52, sway: 0.35, ease: ease.out },
    ]);
    this.focusTarget = 1.0;
    this.apertureTarget = 1.5;
    audio.playFootstep('wood', 0.5);
    this.timers.push({
      at: 1.0, done: false, fn: () => { this.r.room.screenLight.intensity = 0.4; this.r.room.monitorSpot.intensity = 0.2; },
    });
    this.timers.push({
      at: 2.15, done: false, fn: () => {
        // モニターが立ち上がる
        this.r.room.showBSOD(0, 0, 0, 1);
        audio.bsodBoot();
        this.r.room.screenLight.intensity = 4.5;
      },
    });
    this.timers.push({
      at: 2.85, done: false, fn: () => {
        this.phase = 'screen';
        this.t = 0;
        this.script = null;
        // クリック操作のためポインタロックは解除する (カーソルが必要)
        this.r.input.releaseLock();
        this.r.input.gameplay = false;
        this.r.ui.setReticle('clickable');
        this.r.ui.setSubtitle(':( をクリックする', 6000);
        this.r.room.screenMesh.parent?.updateMatrixWorld(true);
      },
    });
  }

  /* ================= 画面 → 口 → 落下 ================= */
  private updateDrop(dt: number) {
    const { camera, world } = this.r;
    const gate = this.dropStage === 1;
    // 口を抜ける瞬間の白青い光。点滅させず 1 回だけ減衰させる
    this.flash = Math.max(0, this.flash - dt * (gate ? 1.5 : 3.4));
    this.gateTunnel?.update(dt, this.t);
    if (this.script) {
      const s = this.script.update(this.t, 9);
      this.script.apply(camera);
      this.focusTarget = s.focus;
    }
    this.apertureTarget = gate ? 1.6 : 0.9;
    this.warpTarget = gate ? Math.max(0, 0.34 - this.t * 0.09) : Math.max(0, 0.45 - this.t * 0.15);
    this.blockTarget = gate ? 0.18 : 0.45;
    this.sceneGlitch = gate ? 0.24 : 0.3;
    this.fxGlitch = gate ? 0.3 : 0.2;
    // 画面内 → トンネルは暗転で隠し、トンネル内 → 世界は光で隠す
    this.fadeTarget = gate ? 0 : 1;
    this.tintTarget.setRGB(0.92, 0.99, 1.1);
    world.update(dt, this.t, camera);
    this.updateDebris(dt, false);
    if (gate && this.gateTunnel) {
      const o = this.t < 2.0 ? 0.95 : Math.max(0, 0.95 * (1 - (this.t - 2.0) / 1.1));
      this.gateTunnel.setOpacity(o);
    } else if (this.gateTunnel) {
      this.gateTunnel.setOpacity(0.95);
    }
  }

  /* ================= 捕食カメラ ================= */
  private updateFinale(dt: number) {
    const { camera, room } = this.r;
    room.update(dt, this.t, camera, false);
    const t = this.t;
    // 顔のポータルが拡大し、口が開く
    if (this.facePortal) {
      const s = 0.7 + ease.in(t / 1.9) * 4.2;
      this.facePortal.scale.setScalar(s);
      const m = this.facePortal.material as THREE.MeshBasicMaterial;
      m.opacity = clamp(0.6 + t * 0.4, 0, 1);
    }
    if (this.mouthDisk) {
      const m = this.mouthDisk.material as THREE.MeshBasicMaterial;
      m.opacity = clamp((t - 0.5) / 0.8, 0, 1) * 0.98;
      this.mouthDisk.scale.setScalar(0.4 + ease.in(t / 2) * 6);
    }
    // 青い光が視界を満たす (1 回だけ。点滅ではない)
    this.flash = clamp((t - 1.15) / 0.75, 0, 1) * 1.15;
    this.warpTarget = clamp(t / 1.9, 0, 1) * 1.2;
    this.blockTarget = clamp(t / 1.9, 0, 1) * 0.9;
    this.fxShake = 0.6 + clamp(t / 1.9, 0, 1) * 1.4;
    this.focusTarget = 0.45;
    this.apertureTarget = 2.0;
    room.setSuction(1);
    room.screenLight.intensity = 4 + t * 9;
    if (this.script) {
      const s = this.script.update(t, 5);
      this.script.apply(camera);
    }
    if (t > 1.9) this.enterGate();
  }

  /* ================= BSOD 画面とクリック ================= */
  private updateLeanIn(dt: number) {
    const { camera, room } = this.r;
    if (!this.script) return;
    const s = this.script.update(this.t, 3);
    this.script.apply(camera);
    this.focusTarget = s.focus;
    this.apertureTarget = lerp(0.4, 1.6, clamp(this.t / 2, 0, 1));
    this.fadeTarget = 1;
    room.update(dt, this.t, camera, false);
    this.r.input.consumeLook();
  }

  private updateScreen(dt: number) {
    const { camera, room, input, ui } = this.r;
    // 固定カメラ + 呼吸のような揺らぎ
    camera.position.copy(this.screenPose.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.screenPose.look);
    camera.rotateZ(-0.045 + Math.sin(this.t * 0.6) * 0.004);
    camera.position.y += Math.sin(this.t * 1.1) * 0.002;
    if (Math.abs(camera.fov - 50) > 0.01) { camera.fov = 50; camera.updateProjectionMatrix(); }
    this.focusTarget = 0.5;
    this.apertureTarget = 1.5;
    room.update(dt, this.t, camera, false);

    // カーソルの位置でレティクル (システムカーソル) を変える
    const hit = this.screenHitTest();
    const over = hit === 'face';
    (document.getElementById('gl') as HTMLElement).style.cursor = over ? 'pointer' : 'crosshair';
    ui.setReticle('hidden');

    if (input.clicked) {
      if (over) {
        this.advanceBSOD();
      } else if (hit === 'screen') {
        this.r.audio.uiTick(0.05);
        this.r.audio.glitchHit(0.08);
        this.fxShake = Math.max(this.fxShake, 0.25);
      }
    }
    // 微妙な明滅 (2Hz 以下)
    const flick = 1 + Math.sin(this.t * 3.4) * 0.02;
    room.screenMat.emissiveIntensity = (0.9 + this.clicks * 0.06) * flick;
  }

  /** マウス位置が「:(」の上か、画面の上か */
  private screenHitTest(): 'face' | 'screen' | null {
    const { camera, input, room } = this.r;
    const ndc = input.ndc;
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hits = this.raycaster.intersectObject(room.screenMesh, false);
    if (!hits.length) return null;
    const uv = hits[0].uv;
    if (!uv) return 'screen';
    // キャンバス上の ":( " は中心 (0.5, 0.70) 付近
    if (Math.abs(uv.x - 0.5) < 0.16 && Math.abs(uv.y - 0.70) < 0.22) return 'face';
    return 'screen';
  }

  private advanceBSOD() {
    const { room, audio, ui } = this.r;
    this.clicks++;
    const stage = clamp(Math.floor(this.clicks / 2), 0, 5);
    const progress = Math.min(100, this.clicks * 10);
    const corruption = this.clicks / 10;
    room.showBSOD(stage, progress, corruption, 1 + stage * 0.55);
    room.setGlitch(corruption * 0.9);
    this.sceneGlitch = corruption * 0.35;
    this.camShake = 0.4 + corruption * 1.4;
    this.fxShake = 0.6 + corruption;
    this.warpTarget = corruption * 0.8;
    this.blockTarget = corruption * 0.9;
    this.fxGlitch = corruption * 0.25;
    this.apertureTarget = 1.5 + corruption;
    audio.glitchHit(0.2 + corruption * 0.8);
    if (this.clicks === 3) ui.setSubtitle('画面の文字が、わずかに滲んだ。', 4000);
    if (this.clicks === 6) { ui.setSubtitle('表示が剥がれ、部屋の壁が内側へ撓む。', 4500); audio.glitchHit(1); }
    if (this.clicks === 8) { ui.setSubtitle('「:(」が、こちらを見ている。', 4500); }
    room.setSuction(corruption);
    if (this.clicks >= 10) {
      this.phase = 'finale';
      this.t = 0;
      this.timers = [];
      this.sceneGlitch = 0.55;
      this.r.input.gameplay = false;
      this.r.input.lookEnabled = false;
      this.beginFinale();
    }
  }

  /* ================= 捕食 → 異世界 ================= */
  private beginFinale() {
    const { room, audio, ui } = this.r;
    ui.setSubtitle(null);
    ui.setReticle('hidden');
    (document.getElementById('gl') as HTMLElement).style.cursor = 'none';
    room.setSuction(1);

    // 顔のポータルと口
    const faceTex = (room as unknown as { makeGhostFaceTexture?: () => THREE.Texture });
    void faceTex;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.makePortalFaceTexture(), transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    face.scale.setScalar(0.7);
    face.position.set(MON.x, MON.y, MON.z + 0.02);
    face.renderOrder = 999;
    this.r.sceneRoom.add(face);
    this.facePortal = face;

    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 48),
      new THREE.MeshBasicMaterial({ color: 0x000308, transparent: true, opacity: 0, depthTest: false, fog: false }),
    );
    mouth.position.set(MON.x, MON.y - 0.02, MON.z + 0.03);
    mouth.renderOrder = 1000;
    this.r.sceneRoom.add(mouth);
    this.mouthDisk = mouth;

    // 画面へ吸い込まれるカメラ
    this.script = new CameraScript([
      { at: 0, pos: [this.screenPose.pos.x, this.screenPose.pos.y, this.screenPose.pos.z], look: [this.screenPose.look.x, this.screenPose.look.y, this.screenPose.look.z], fov: 50, roll: -0.05, focus: 0.5, sway: 0.5, ease: ease.linear },
      { at: 0.9, pos: [MON.x - 0.01, MON.y - 0.03, MON.z + 0.66], look: [MON.x, MON.y - 0.02, MON.z], fov: 58, roll: 0.03, focus: 0.3, sway: 0.9, ease: ease.in },
      { at: 1.9, pos: [MON.x, MON.y - 0.02, MON.z + 0.13], look: [MON.x, MON.y - 0.02, MON.z], fov: 74, roll: -0.12, focus: 0.1, sway: 1.5, ease: ease.in },
    ]);
    audio.collapseRumble();
    this.timers.push({ at: 0.9, done: false, fn: () => audio.glitchHit(1) });
    this.timers.push({ at: 1.4, done: false, fn: () => audio.glitchHit(1) });
    this.timers.push({ at: 2.4, done: false, fn: () => { if (this.gateTunnel) this.gateTunnel.setSpeed(120); } });
  }

  private makePortalFaceTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 512);
    const grd = ctx.createRadialGradient(256, 300, 10, 256, 300, 240);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.62, 'rgba(0,4,10,0.95)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.ellipse(256, 330, 180, 140, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eaf4ff';
    for (const y of [120, 250]) { ctx.beginPath(); ctx.arc(150, y, 26, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#eaf4ff';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(300, 250, 160, -Math.PI * 0.6, Math.PI * 0.6); ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private gateGroup: THREE.Group | null = null;
  private gateDebris: THREE.Mesh[] = [];

  /** 画面から異世界の「口」へ移動 (青い光で覆われた瞬間に行う) */
  private enterGate() {
    if (this.phase !== 'finale' && this.phase !== 'drop') return;
    if (this.dropStage === 1) return;
    const { sceneWorld, camera, audio, post, world } = this.r;
    this.phase = 'drop';
    this.dropStage = 1;
    this.t = 0;
    this.timers = [];
    this.lastScene = 'world';
    post.renderPass.scene = sceneWorld;
    post.gtao.scene = sceneWorld;
    this.r.input.gameplay = false;
    this.r.input.lookEnabled = false;
    this.flash = 1.4;

    // ゲート (空に開いた口) + トンネル
    if (!this.gateTunnel) {
      const g = new THREE.Group();
      const tun = new Tunnel({ radius: 9, length: 42, color: 0xbfe0ff, seed: 91, debrisCount: 90, opacity: 0.9, sides: 36 });
      tun.group.position.set(WORLD.gate.x, WORLD.gate.y - 4, WORLD.gate.z);
      sceneWorld.add(tun.group);
      tun.setSpeed(110);
      this.gateTunnel = tun;
      g.position.copy(WORLD.gate);
      sceneWorld.add(g);
      this.gateGroup = g;
    }
    this.gateTunnel.setOpacity(0.95);
    this.gateTunnel.setSpeed(120);

    // トンネル突入 → 落下
    camera.fov = 78; camera.updateProjectionMatrix();
    const start = new THREE.Vector3(WORLD.gate.x, WORLD.gate.y + 10, WORLD.gate.z);
    const exit = new THREE.Vector3(WORLD.gate.x, WORLD.gate.y - 22, WORLD.gate.z);
    const ground = new THREE.Vector3(WORLD.arrival.x, this.r.world.collision.groundAt(WORLD.arrival.x, WORLD.arrival.z, 20, 99), WORLD.arrival.z);
    this.script = new CameraScript([
      { at: 0, pos: [start.x, start.y, start.z], look: [start.x, start.y - 30, start.z], fov: 78, roll: 0.06, focus: 2.5, ease: ease.linear },
      { at: 2.0, pos: [exit.x, exit.y, exit.z], look: [exit.x, exit.y - 30, exit.z], fov: 80, roll: -0.05, focus: 3, ease: ease.in },
      { at: 3.1, pos: [exit.x, exit.y - 16, exit.z], look: [WORLD.gate.x, WORLD.gate.y + 30, WORLD.gate.z], fov: 88, roll: 0.12, focus: 20, ease: ease.out },
      { at: 4.2, pos: [ground.x + 1.5, ground.y + 9, ground.z + 1.0], look: [ground.x, ground.y, ground.z], fov: 90, roll: -0.08, focus: 26, ease: ease.in },
      { at: 4.85, pos: [ground.x, ground.y + 1.55, ground.z], look: [ground.x, ground.y + 1.4, ground.z - 6], fov: 74, roll: 0, focus: 3, ease: ease.out },
    ]);
    audio.stopAllLayers(0.3);
    this.roomAmbience = null;
    audio.setReverb(0.9, 'void');
    const rumble = audio.collapseRumble();
    const wind = audio.fallWind();
    this.timers.push({ at: 1.6, done: false, fn: () => { wind.set(1.2); audio.impact(0.4); this.fxShake = 1.2; } });
    this.timers.push({
      at: 4.2, done: false, fn: () => {
        wind.set(1.6);
        this.gateTunnel?.setOpacity(0);
        audio.impact(0.85);
        this.camShake = 1.2;
        this.fxShake = 1.4;
      },
    });
    this.timers.push({
      at: 4.85, done: false, fn: () => {
        wind.stop(0.8);
        rumble.stop(1.2);
        audio.impact(1);
        this.camShake = 1.6;
        this.fxShake = 1.6;
        this.spawnDust(ground);
      },
    });
    this.timers.push({
      at: 5.4, done: false, fn: () => {
        // 操作を戻す
        this.phase = 'void';
        this.dropStage = 0;
        this.t = 0;
        this.script = null;
        this.r.player.setPosition(ground.x, ground.y, ground.z);
        this.r.player.yaw = 0; // 中心構造物 (-z) を向く
        this.r.player.pitch = 0.06;
        this.r.player.interactables = this.r.world.interactables;
        this.r.input.gameplay = true;
        this.r.input.lookEnabled = true;
        this.r.input.requestLock().catch(() => {});
        this.focusTarget = 4;
        this.apertureTarget = 0.5;
        this.warpTarget = 0;
        this.blockTarget = 0;
        this.fxGlitch = 0;
        this.camShake = 0;
        this.voidAmbience = audio.voidAmbience([
          { pos: new THREE.Vector3(0, 30, -96), freq: 73.4 },
          { pos: new THREE.Vector3(-58, 12, -6), freq: 110 },
          { pos: new THREE.Vector3(60, 14, -18), freq: 146.8 },
          { pos: new THREE.Vector3(0, 8, 22), freq: 98 },
          { pos: new THREE.Vector3(-6, -8, 4), freq: 55 },
        ]);
        this.r.ui.setChapter('STILL 02 — メモリの外側');
        this.r.ui.setAreaTitle('青い荒野');
        this.r.ui.setSubtitle('—— 息ができる。ここは、まだ世界の内側だ。', 7000);
        void this.r.post;
      },
    });
    this.r.ui.setChapter('STILL 02 — メモリの外側');
    world.setGlitch(0.2);
  }

  private spawnDust(at: THREE.Vector3) {
    const { sceneWorld } = this.r;
    const geo = new THREE.BufferGeometry();
    const n = 120;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = at.x + this.rng.range(-2, 2);
      pos[i * 3 + 1] = at.y + this.rng.range(0, 0.6);
      pos[i * 3 + 2] = at.z + this.rng.range(-2, 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9fc6ec, size: 0.06, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    sceneWorld.add(pts);
    let life = 0;
    const upd = (dt: number) => {
      life += dt;
      mat.opacity = Math.max(0, 0.8 - life * 0.6);
      pts.position.y += dt * 0.4;
      if (life > 1.5) { sceneWorld.remove(pts); geo.dispose(); mat.dispose(); return false; }
      return true;
    };
    this.extraUpdates.push(upd);
  }
  private extraUpdates: ((dt: number) => boolean)[] = [];

  /* ================= 自由探索 (異世界) ================= */
  private updateVoid(dt: number) {
    const { player, world, input, camera, ui } = this.r;
    if (ui.reading || ui.consoleOpen) { player.freeze = true; }
    else player.freeze = false;
    player.interactables = world.interactables;
    const worldCollision = world.collision;
    worldCollision.allowFalling = false;
    player.update(dt, input, worldCollision);
    player.applyCamera(camera);
    world.update(dt, this.t, camera);
    world.setGlitch(0.15);
    this.focusTarget = 6;
    this.apertureTarget = 0.35;
    this.fadeTarget = 1;
    this.tintTarget.setRGB(0.94, 1.0, 1.08);
    this.warpTarget = 0;
    this.blockTarget = 0;

    this.areaTriggers();

    if (input.wasPressed('KeyF')) {
      this.torch = !this.torch;
      ui.setSubtitle(this.torch ? 'ライトを点けた。' : 'ライトを消した。', 1500, true);
    }
    if (this.torch) {
      // 異世界用のライト (ワールドのシーンに追加)
      if (!this.worldLight) {
        const l = new THREE.SpotLight(0xdbe9ff, 22, 30, deg(28), 0.6, 1.4);
        l.castShadow = true;
        l.shadow.mapSize.set(512, 512);
        this.r.sceneWorld.add(l, l.target);
        this.worldLight = l;
      }
      this.worldLight.visible = true;
      this.worldLight.position.copy(camera.position);
      const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      this.worldLight.target.position.copy(camera.position).addScaledVector(d, 8);
      this.worldLight.target.updateMatrixWorld();
    } else if (this.worldLight) this.worldLight.visible = false;

    if (input.wasPressed('KeyE') || input.clicked) this.useFocused();
  }
  private worldLight: THREE.SpotLight | null = null;

  private areaTriggers() {
    const { player, ui, world } = this.r;
    const p = player.pos;
    const zones: { id: string; test: () => boolean; title: string }[] = [
      { id: 'arrival', test: () => p.z > 60, title: '青い荒野' },
      { id: 'arch', test: () => Math.abs(p.x) < 30 && p.z < 52 && p.z > -14 && p.y > -4, title: '崩壊した建築 — 吹き抜け' },
      { id: 'deep', test: () => p.y < -6, title: '深層 — 露出した配線' },
      { id: 'west', test: () => p.x < -30, title: '侵食された都市 (西)' },
      { id: 'east', test: () => p.x > 30, title: '侵食された都市 (東)' },
      { id: 'monolith', test: () => Math.hypot(p.x - WORLD.monolith.x, p.z - WORLD.monolith.z) < 40, title: '中心構造物' },
    ];
    for (const z of zones) {
      if (!this.areaShown.has(z.id) && z.test()) {
        this.areaShown.add(z.id);
        ui.setAreaTitle(z.title);
      }
    }
    // WAKE_UP の間近で自動的に「読む」演出
    if (!world.secretRevealed) {
      const d = p.distanceTo(world.chamberCenter);
      if (d < 13) {
        world.setSecretRevealed();
        ui.setAreaTitle('WAKE_UP');
        this.r.audio.wakeChord();
        ui.setSubtitle('壁一面に、命令が刻まれている。', 8000);
      }
    }
  }

  /* ================= 崩壊 ================= */
  startCollapse() {
    const { player, ui, audio, world, camera } = this.r;
    if (this.phase !== 'void') return;
    this.phase = 'collapse';
    this.t = 0;
    this.timers = [];
    player.freeze = true;
    this.r.input.gameplay = false;
    this.r.input.lookEnabled = false;
    this.r.input.releaseLock();
    ui.setPrompt(null);
    ui.setReticle('hidden');
    ui.setChapter('STILL 03 — 崩壊');
    audio.stopAllLayers(1.2);
    this.voidAmbience = null;

    const P = player.pos.clone();
    const eye = new THREE.Vector3(P.x, P.y + 1.62, P.z);
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, player.yaw, 0));
    const rightV = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, player.yaw, 0));
    const at = (dist: number, y: number, side = 0) =>
      eye.clone().addScaledVector(fwd, dist).addScaledVector(rightV, side).setY(eye.y + y);
    const crack = P.clone().addScaledVector(fwd, 2.2).addScaledVector(rightV, -0.8);
    crack.y = P.y + 0.05;

    this.script = new CameraScript([
      // まっすぐ前を見る
      { at: 0.0, pos: [eye.x, eye.y, eye.z], look: [at(8, 0).x, at(8, 0).y, at(8, 0).z], fov: 62, roll: 0, focus: 8, sway: 0.5, ease: ease.linear },
      // 目だけが先に左へ、頭が遅れて追う
      { at: 0.9, pos: [eye.x, eye.y, eye.z], look: [at(7, 1.2, 2.6).x, at(7, 1.2, 2.6).y, at(7, 1.2, 2.6).z], fov: 62, roll: 0.02, focus: 8, sway: 0.7, ease: ease.inOut },
      { at: 1.6, pos: [eye.x, eye.y, eye.z], look: [at(7, 0.6, -3.2).x, at(7, 0.6, -3.2).y, at(7, 0.6, -3.2).z], fov: 63, roll: -0.03, focus: 7, sway: 0.9, ease: ease.inOut },
      // 足元を見る
      { at: 2.6, pos: [eye.x, eye.y - 0.02, eye.z], look: [P.x + 0.3, P.y + 0.05, P.z + 0.5], fov: 66, roll: 0.01, focus: 1.6, sway: 0.6, ease: ease.inOut },
      { at: 3.3, pos: [eye.x, eye.y - 0.04, eye.z], look: [crack.x, crack.y, crack.z], fov: 64, roll: -0.02, focus: 2.0, sway: 0.5, ease: ease.out },
      // 亀裂を追う
      { at: 4.2, pos: [eye.x, eye.y - 0.06, eye.z], look: [crack.x + 0.9, crack.y, crack.z - 0.6], fov: 62, roll: 0.03, focus: 2.2, sway: 0.6, ease: ease.inOut },
      // 後ずさり
      { at: 4.9, pos: [eye.x - fwd.x * 0.55, eye.y - 0.1, eye.z - fwd.z * 0.55], look: [crack.x, crack.y + 0.1, crack.z], fov: 64, roll: -0.05, focus: 2.6, sway: 0.9, ease: ease.out },
      // 足場が崩れ、体勢を崩す
      { at: 5.6, pos: [eye.x - fwd.x * 0.4, eye.y - 0.45, eye.z - fwd.z * 0.4], look: [crack.x, crack.y - 1.2, crack.z], fov: 70, roll: 0.12, focus: 3, sway: 1.4, ease: ease.in },
      // 落下開始
      { at: 6.4, pos: [P.x, P.y + 0.4, P.z], look: [P.x + 1.2, P.y - 8, P.z + 1.2], fov: 82, roll: -0.2, focus: 8, sway: 1.2, ease: ease.in },
    ]);

    audio.heartbeat(1);
    this.timers.push({ at: 0.6, done: false, fn: () => { this.r.audio.breath(true, 0.8); } });
    this.timers.push({ at: 1.4, done: false, fn: () => { this.r.audio.breath(false, 0.9); } });
    this.timers.push({ at: 2.2, done: false, fn: () => { this.r.audio.breath(true, 1.1); this.r.audio.heartbeat(1.2); } });
    this.timers.push({ at: 3.2, done: false, fn: () => { this.r.audio.crack(1.2); this.fxShake = 0.8; this.camShake = 1.0; } });
    this.timers.push({ at: 4.0, done: false, fn: () => { this.r.audio.crack(0.8); this.r.audio.heartbeat(1.4); } });
    this.timers.push({ at: 4.9, done: false, fn: () => { this.r.audio.crack(1.5); this.fxShake = 1.2; this.camShake = 1.4; } });
    this.timers.push({ at: 5.4, done: false, fn: () => { this.r.audio.crack(2.0); this.shakeCamera(2.0); this.breakGround(P); } });
    this.timers.push({ at: 6.2, done: false, fn: () => { this.beginFall(P); } });

    this.createCracks(crack);
    world.setGlitch(0.6);
    this.sceneGlitch = 0.4;
    (this.r.post as unknown as { gtao: { enabled: boolean } }).gtao.enabled = false;
  }

  private shakeCamera(v: number) { this.camShake = Math.max(this.camShake, v); }

  private crackGroup: THREE.Group | null = null;

  private createCracks(at: THREE.Vector3) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 14; i++) {
      const len = this.rng.range(1.5, 7);
      const w = this.rng.range(0.02, 0.09);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = this.rng.range(0, Math.PI * 2);
      m.position.set(at.x + this.rng.range(-2, 2), at.y + 0.02, at.z + this.rng.range(-2, 2));
      g.add(m);
    }
    this.r.sceneWorld.add(g);
    this.crackGroup = g;
    // 亀裂の光
    const l = new THREE.PointLight(0x9fd0ff, 0, 14, 2);
    l.position.set(at.x, at.y + 0.6, at.z);
    g.add(l);
    this.crackLight = l;
  }
  private crackLight: THREE.PointLight | null = null;
  private holeMesh: THREE.Mesh | null = null;

  /** 地面を割り、破片を実際に落下させる */
  private breakGround(at: THREE.Vector3) {
    const { sceneWorld, audio } = this.r;
    const mat = new THREE.MeshStandardMaterial({ color: 0x24405e, roughness: 0.8, metalness: 0.5, emissive: 0x0a2340, emissiveIntensity: 0.8 });
    for (let i = 0; i < 46; i++) {
      const s = this.rng.range(0.15, 1.0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.5, s), mat);
      const ang = this.rng.range(0, Math.PI * 2);
      const rad = this.rng.range(0, 5);
      m.position.set(at.x + Math.cos(ang) * rad, at.y - this.rng.range(0, 1.2), at.z + Math.sin(ang) * rad);
      sceneWorld.add(m);
      this.debris.push({
        mesh: m,
        vel: new THREE.Vector3(this.rng.range(-2, 2), this.rng.range(-1, 3), this.rng.range(-2, 2)),
        spin: new THREE.Vector3(this.rng.range(-3, 3), this.rng.range(-3, 3), this.rng.range(-3, 3)),
      });
    }
    // 開いた穴
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 32),
      new THREE.MeshBasicMaterial({ color: 0x000206, transparent: true, opacity: 0.92, depthWrite: false }),
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(at.x, at.y + 0.04, at.z);
    if (this.holeMesh) { this.holeMesh.parent?.remove(this.holeMesh); (this.holeMesh.material as THREE.Material).dispose(); this.holeMesh.geometry.dispose(); }
    sceneWorld.add(hole);
    this.holeMesh = hole;
    this.r.world.collision.allowFalling = true;
    audio.collapseRumble();
  }

  private updateCollapse(dt: number) {
    const { camera, audio } = this.r;
    this.sceneGlitch = 0.5;
    this.fxGlitch = 0.2;
    this.blockTarget = 0.4;
    // 亀裂の光と破片
    if (this.crackLight) this.crackLight.intensity = 4 + Math.sin(this.t * 14) * 1.2;
    if (this.crackGroup) {
      this.crackGroup.children.forEach((c, i) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = c as THREE.Mesh;
          const s = Math.min(1, Math.max(0, (this.t - 3.0 - i * 0.06) * 1.2));
          m.scale.set(1, Math.max(0.001, s), 1);
          m.position.y = 0.02;
        }
      });
    }
    this.updateDebris(dt, true);

    if (this.script) {
      const s = this.script.update(this.t, 7);
      this.script.apply(camera);
      this.focusTarget = s.focus;
      this.apertureTarget = 0.8;
      if (this.t > 2.0) this.camShake = Math.max(this.camShake, 0.25 + Math.min(1, (this.t - 2) / 4));
    }
    if (this.t > 0.4 && this.t < 6.0 && Math.sin(this.t * 1.4) > 0.995) audio.heartbeat(1.2);
  }

  /** 洞窟へ落下 → 自室へ */
  private beginFall(P: THREE.Vector3) {
    const { sceneWorld, sceneRoom, camera, audio } = this.r;
    this.phase = 'fall';
    this.t = 0;
    this.timers = [];
    // 落下シャフト (異世界側)
    if (!this.worldShaft) {
      const shaft = new Tunnel({ radius: 9, length: 120, color: 0x8fc4f0, seed: 33, debrisCount: 110, opacity: 0.95, sides: 24 });
      shaft.group.position.set(P.x, P.y - 58, P.z);
      sceneWorld.add(shaft.group);
      this.worldShaft = shaft;
    } else {
      this.worldShaft.group.position.set(P.x, P.y - 58, P.z);
    }
    this.worldShaft.setOpacity(1);
    this.worldShaft.setSpeed(60);
    // 自室側の落下穴
    if (!this.roomShaft) {
      const rs = new Tunnel({ radius: 1.4, length: 40, color: 0xbfe0ff, seed: 51, debrisCount: 40, opacity: 0, sides: 18 });
      rs.group.position.set(0.4, 20, 0.5);
      sceneRoom.add(rs.group);
      this.roomShaft = rs;
    }
    audio.stopAllLayers(0.4);
    const wind = audio.fallWind();
    const rumble = audio.collapseRumble();
    this.timers.push({ at: 1.8, done: false, fn: () => { wind.set(1.5); this.fxShake = 1.3; } });
    this.timers.push({ at: 2.6, done: false, fn: () => { this.switchToRoomFall(); } });
    this.timers.push({ at: 3.5, done: false, fn: () => { wind.stop(0.4); rumble.stop(0.6); this.landInRoom(); } });

    const start = new THREE.Vector3(P.x, P.y + 0.6, P.z);
    this.script = new CameraScript([
      { at: 0, pos: [start.x, start.y, start.z], look: [start.x, start.y - 30, start.z], fov: 82, roll: 0.2, focus: 8, ease: ease.in },
      { at: 1.6, pos: [start.x, start.y - 40, start.z], look: [start.x + 2, start.y - 60, start.z], fov: 92, roll: -0.35, focus: 20, ease: ease.linear },
      { at: 2.6, pos: [start.x, start.y - 96, start.z], look: [start.x, start.y - 130, start.z], fov: 96, roll: 0.5, focus: 30, ease: ease.linear },
    ]);
    this.worldShaft.setSpeed(70);
  }

  /** 自室の天井へ切り替え (落下シャフトの内側で行うため見えない) */
  private switchToRoomFall() {
    const { post, sceneRoom } = this.r;
    post.renderPass.scene = sceneRoom;
    post.gtao.scene = sceneRoom;
    this.lastScene = 'room';
    if (this.worldShaft) this.worldShaft.setOpacity(0);
    if (this.roomShaft) { this.roomShaft.setOpacity(1); this.roomShaft.setSpeed(60); }
    this.r.room.setCeilingVisible(false);
    // スクリプトを自室用に差し替え
    const y0 = 22;
    this.scriptAt = this.t;
    this.script = new CameraScript([
      { at: 0, pos: [0.4, y0, 0.5], look: [0.4, y0 - 20, 0.5], fov: 88, roll: -0.2, focus: 10, ease: ease.linear },
      { at: 0.55, pos: [0.35, 3.2, 0.6], look: [0.2, 0.4, -0.4], fov: 76, roll: 0.1, focus: 3, ease: ease.in },
      { at: 0.9, pos: [0.3, 1.62, 0.8], look: [0.2, 1.2, -1.6], fov: 66, roll: -0.06, focus: 3, ease: ease.out },
      { at: 1.4, pos: [0.3, 1.62, 0.85], look: [0.2, 1.35, -1.7], fov: 62, roll: 0, focus: 3, ease: ease.inOut, sway: 0.6 },
    ]);
    this.sceneGlitch = 0.4;
  }
  private scriptAt = 0;

  private landInRoom() {
    const { camera, audio, player, room, ui, input, post } = this.r;
    this.phase = 'return';
    this.t = 0;
    this.timers = [];
    if (this.roomShaft) this.roomShaft.setOpacity(0);
    room.setCeilingVisible(true);
    room.setAnomaly(true);
    this.hasReturned = true;
    audio.impact(1.0);
    audio.wakeChord();
    this.gateTunnel?.setOpacity(0);
    this.camShake = 1.5;
    this.fxShake = 1.6;
    this.spawnRoomDust();
    player.setPosition(0.3, 0, 0.85);
    player.yaw = 0;
    player.pitch = -0.02;
    player.interactables = room.interactables;
    this.script = new CameraScript([
      { at: 0, pos: [0.3, 0.95, 0.85], look: [0.25, 0.85, -1.6], fov: 68, roll: 0.08, focus: 2.2, sway: 1.2, ease: ease.out },
      { at: 0.7, pos: [0.3, 1.28, 0.85], look: [0.25, 1.15, -1.7], fov: 64, roll: -0.05, focus: 2.6, sway: 0.9, ease: ease.inOut },
      { at: 1.5, pos: [0.3, 1.62, 0.86], look: [0.25, 1.45, -1.7], fov: 62, roll: 0, focus: 3.2, sway: 0.4, ease: ease.out },
      { at: 2.6, pos: [0.3, 1.62, 0.88], look: [0.2, 1.42, -1.75], fov: 62, roll: 0, focus: 3.4, sway: 0.35, ease: ease.inOut },
    ]);
    this.timers.push({ at: 2.4, done: false, fn: () => {
      audio.setReverb(0.3, 'room');
      this.roomAmbience = audio.roomAmbience({ pc: MON.clone(), window: new THREE.Vector3(ROOM.x1, 1.5, 0) });
      ui.setChapter('STILL 04 — 帰還');
      ui.setAreaTitle('03:07 / 自室 — 2 度目');
      ui.setSubtitle('床の感触がある。\nモニターは、まだ青い。', 8000);
    } });
    this.timers.push({ at: 3.4, done: false, fn: () => {
      this.phase = 'room';
      this.t = 0;
      this.script = null;
      input.gameplay = true;
      input.lookEnabled = true;
      input.requestLock().catch(() => {});
      player.freeze = false;
      this.sceneGlitch = 0;
      this.fxGlitch = 0;
      this.blockTarget = 0;
      this.fadeTarget = 1;
      this.tintTarget.setRGB(1, 1, 1);
      room.collision.allowFalling = false;
      void camera; void post;
    } });
    this.r.ui.setChapter('STILL 04 — 帰還');
  }

  private spawnRoomDust() {
    const { sceneRoom } = this.r;
    const geo = new THREE.BufferGeometry();
    const n = 150;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.rng.range(-1.5, 2);
      pos[i * 3 + 1] = this.rng.range(0, 0.8);
      pos[i * 3 + 2] = this.rng.range(-1, 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xa8cdf0, size: 0.012, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    sceneRoom.add(pts);
    let life = 0;
    this.extraUpdates.push((dt) => {
      life += dt;
      mat.opacity = Math.max(0, 0.9 - life * 0.45);
      pts.position.y += dt * 0.25;
      if (life > 2.2) { sceneRoom.remove(pts); geo.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  private updateFall(dt: number) {
    const { camera } = this.r;
    this.sceneGlitch = 0.3;
    this.fxGlitch = 0.15;
    this.blockTarget = 0.5;
    if (this.worldShaft) { this.worldShaft.update(dt, this.t); }
    this.updateDebris(dt, false);
    if (this.script) {
      // switchToRoomFall 後は時間軸をリセットして使う
      const localT = this.t - (this.scriptAt || 0);
      const s = this.script.update(Math.max(0, localT), 11);
      this.script.apply(camera);
      this.focusTarget = s.focus;
      this.apertureTarget = 1.2;
      this.warpTarget = 0.2;
    }
    if (this.roomShaft) { this.roomShaft.update(dt, this.t); this.roomShaft.setSpeed(50); }
  }

  private updateReturn(dt: number) {
    const { camera, room, player } = this.r;
    room.update(dt, this.t, camera, false);
    this.sceneGlitch = Math.max(0, 0.35 - this.t * 0.15);
    this.fxGlitch = Math.max(0, 0.2 - this.t * 0.1);
    this.blockTarget = Math.max(0, 0.3 - this.t * 0.2);
    this.fadeTarget = 1;
    this.tintTarget.setRGB(0.95, 1, 1.06);
    if (this.script) {
      const s = this.script.update(this.t, 13);
      this.script.apply(camera);
      this.focusTarget = s.focus;
      this.apertureTarget = 0.7;
    }
    void player;
  }

  private updateDebris(dt: number, relative: boolean) {
    const camY = this.r.camera.position.y;
    for (const d of this.debris) {
      d.vel.y -= 22 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (relative && d.mesh.position.y < camY - 40) d.mesh.visible = false;
      if (d.mesh.position.y < -400) d.mesh.visible = false;
    }
  }

  /* ================= リプレイ ================= */
  restart() {
    const { ui, audio, post, input, camera, sceneWorld, sceneRoom } = this.r;
    ui.closeMenu();
    ui.closeConsole();
    ui.closeRead();
    ui.setSubtitle(null);
    audio.stopAllLayers(0.15);
    audio.setReverb(0.32, 'room');
    this.roomAmbience = null;
    this.voidAmbience = null;
    this.clearTransient();
    glitchUniforms.uGlitch.value = 0;
    glitchUniforms.uCorrupt.value = 0;
    this.sceneGlitch = 0;
    this.fxGlitch = 0;
    this.blockTarget = 0;
    this.warpTarget = 0;
    this.distort = 0;
    this.fadeTarget = 1;
    this.tintTarget.setRGB(1, 1, 1);
    this.focusTarget = 4;
    this.apertureTarget = 0.5;
    this.camShake = 0;
    this.fxShake = 0;
    this.torch = false;
    this.debris.forEach((d) => { d.mesh.parent?.remove(d.mesh); });
    this.debris = [];
    this.extraUpdates = [];
    this.r.player.interactables = this.r.room.interactables;
    this.r.world.collision.allowFalling = false;
    this.r.room.collision.allowFalling = false;
    this.hasReturned = false;
    this.areaShown.clear();
    this.clicks = 0;
    this.script = null;
    this.timers = [];
    this.r.world.setGlitch(0);
    this.r.post.setQuality(ui.settings.quality);
    post.renderPass.scene = sceneRoom;
    post.gtao.scene = sceneRoom;
    this.lastScene = 'room';
    void sceneWorld; void camera; void input;
    this.phase = 'boot';
    this.t = 0;
    this.startRoom(true);
  }

  /** 演出中の一時オブジェクトを片付ける */
  private clearTransient() {
    const { sceneRoom, sceneWorld } = this.r;
    if (this.facePortal) { sceneRoom.remove(this.facePortal); this.facePortal = null; }
    if (this.mouthDisk) { sceneRoom.remove(this.mouthDisk); this.mouthDisk = null; }
    this.flash = 0;
    if (this.crackGroup) {
      sceneWorld.remove(this.crackGroup);
      this.crackGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      });
      this.crackGroup = null;
    }
    this.crackLight = null;
    if (this.holeMesh) {
      this.holeMesh.parent?.remove(this.holeMesh);
      this.holeMesh.geometry.dispose();
      (this.holeMesh.material as THREE.Material).dispose();
      this.holeMesh = null;
    }
    if (this.gateTunnel) { this.gateTunnel.setOpacity(0); }
    if (this.worldShaft) this.worldShaft.setOpacity(0);
    if (this.roomShaft) this.roomShaft.setOpacity(0);
    this.r.camera.position.set(0, 1.6, 0);
  }

  /* ================= デバッグ ================= */
  jump(target: 'room' | 'screen' | 'void' | 'monolith' | 'collapse' | 'return') {
    if (!this.debug) return;
    const { ui } = this.r;
    this.clearTransient();
    this.timers = [];
    this.script = null;
    this.r.input.gameplay = true;
    this.r.input.lookEnabled = true;
    this.r.player.freeze = false;
    switch (target) {
      case 'room':
        this.restart();
        break;
      case 'screen': {
        this.startRoom(false);
        this.r.player.setPosition(0.3, 0, -1.0);
        this.usePC();
        // 寄りのアニメーションを飛ばして BSOD 画面へ
        this.t = 2.86;
        this.r.room.showBSOD(0, 0, 0, 1);
        break;
      }
      case 'void': {
        this.phase = 'void';
        this.t = 0;
        this.r.post.renderPass.scene = this.r.sceneWorld;
        this.r.post.gtao.scene = this.r.sceneWorld;
        this.lastScene = 'world';
        this.r.sceneWorld.add(this.r.world.group);
        this.r.player.setPosition(WORLD.arrival.x, 0.2, WORLD.arrival.z);
        this.r.player.yaw = 0;
        this.r.player.pitch = 0;
        this.r.player.interactables = this.r.world.interactables;
        this.r.audio.stopAllLayers(0.3);
        this.roomAmbience = null;
        this.voidAmbience = this.r.audio.voidAmbience([{ pos: new THREE.Vector3(0, 30, -96), freq: 73.4 }]);
        ui.setChapter('STILL 02 — メモリの外側');
        ui.showHud(true);
        break;
      }
      case 'monolith':
        this.jump('void');
        this.r.player.setPosition(WORLD.monolith.x + 2, 0.4, WORLD.monolith.z + 6);
        break;
      case 'collapse':
        this.jump('void');
        this.startCollapse();
        break;
      case 'return': {
        this.startRoom(false);
        this.r.room.setAnomaly(true);
        this.hasReturned = true;
        this.r.player.setPosition(0.2, 0, 0.9);
        this.r.player.yaw = 0;
        this.r.room.setCeilingVisible(true);
        this.r.ui.setSubtitle('帰還後の状態にジャンプしました。', 4000);
        break;
      }
    }
  }
}
