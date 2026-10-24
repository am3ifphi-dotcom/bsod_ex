import * as THREE from 'three';
import type { Player } from '../core/Player';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Renderer } from '../core/Renderer';
import type { RoomBuildResult } from '../world/Room';
import type { Tunnel } from '../world/Tunnel';
import { clamp, clamp01, easeInCubic, easeInOutCubic, easeOutCubic, fbm1, lerp, smoothstep, TAU } from '../core/math';

const easeInQuad = (t: number): number => { const k = clamp01(t); return k * k; };

/**
 * Scripted first-person camera.
 *
 * Everything here is built to read as *a person* rather than a rig:
 *  - eyes lead (fast saccades, 0.15–0.25 s), the head follows with lag, the body leans last
 *  - hesitation beats: moves stop for 200–400 ms before continuing
 *  - micro-sway and breath are always present, even when "frozen"
 *  - the fall is integrated, not animated: speed ramps, then the camera stabilises as air drag
 *    and panic take over.
 */

export interface CinematicContext {
  camera: THREE.PerspectiveCamera;
  player: Player;
  audio: AudioEngine;
  renderer: Renderer;
  room: RoomBuildResult;
  roomGroup: THREE.Group;
  tunnel: Tunnel;
  cameraMotion: () => number;
}

interface Shot {
  duration: number;
  update: (t: number, dt: number) => void;
  start?: () => void;
  end?: () => void;
}

export class Cinematics {
  private shot: Shot | null = null;
  private shotTime = 0;
  private resolve: (() => void) | null = null;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private microPhase = 0;
  private mouth: THREE.Group | null = null;
  private suctionStart = 0;
  private fallDebris: THREE.Mesh[] = [];
  private landingShaft: THREE.Group | null = null;
  active = false;

  constructor(private ctx: CinematicContext) {}

  private play(shot: Shot): Promise<void> {
    this.shot = shot;
    this.shotTime = 0;
    this.active = true;
    shot.start?.();
    return new Promise<void>((resolve) => { this.resolve = resolve; });
  }

  update(dt: number, time: number): void {
    if (!this.shot) return;
    this.shotTime += dt;
    this.microPhase += dt;
    const t = this.shotTime;
    this.shot.update(t, dt);
    // Always-on micro life: nobody holds a head perfectly still.
    const m = this.ctx.cameraMotion();
    const sway = m * 0.5;
    const yawNoise = (fbm1(this.microPhase * 0.35, 3, 1) - 0.5) * 0.0016 * sway;
    const pitchNoise = (fbm1(this.microPhase * 0.29, 3, 7) - 0.5) * 0.0014 * sway;
    this.ctx.camera.rotation.set(this.pitch + pitchNoise, this.yaw + yawNoise, this.roll, 'YXZ');
    if (t >= this.shot.duration) {
      const s = this.shot;
      this.shot = null;
      this.active = false;
      s.end?.();
      const r = this.resolve;
      this.resolve = null;
      r?.();
    }
    void time;
  }

  private pose(pos: THREE.Vector3, yaw: number, pitch: number, roll: number, fov: number): void {
    this.ctx.camera.position.copy(pos);
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
    if (Math.abs(this.ctx.camera.fov - fov) > 0.01) {
      this.ctx.camera.fov = fov;
      this.ctx.camera.updateProjectionMatrix();
    }
  }

  /* ------------------------------------------------------------- 1. the desk */
  playZoomToMonitor(): Promise<void> {
    const { camera, player, room } = this.ctx;
    const start = camera.position.clone();
    const startYaw = player.yaw;
    const startPitch = player.pitch;
    const startFov = camera.fov;
    const target = new THREE.Vector3(room.monitor.position.x + 0.012, 1.207, room.monitor.position.z + 0.735);
    const targetYaw = Math.atan2(-(room.monitor.position.x - target.x), -(room.monitor.position.z - target.z));
    const targetPitch = -0.035;
    const base = {
      yaw: startYaw, pitch: startPitch, fov: startFov,
    };
    void base;
    return this.play({
      duration: 2.6,
      start: () => {
        this.ctx.audio.duck(0.5, 2.2);
        this.ctx.renderer.setFx({ dofFocus: 7, dofRange: 4, dofStrength: 0 });
      },
      update: (t) => {
        const k = easeInOutCubic(clamp01(t / 2.15));
        // a small settle overshoot at the end of the lean-in
        const settle = t > 2.15 ? Math.sin((t - 2.15) * 9) * Math.exp(-(t - 2.15) * 6) * 0.01 : 0;
        const p = start.clone().lerp(target, k);
        p.y += Math.sin(k * Math.PI) * 0.045; // the head dips slightly then rises
        const yaw = lerp(startYaw, targetYaw, k) + settle;
        const pitch = lerp(startPitch, targetPitch, k) + settle * 0.6;
        // tilt of the head as it leans in
        const roll = Math.sin(k * Math.PI) * 0.05 - k * 0.012;
        const fov = lerp(startFov, 52, easeInOutCubic(clamp01(t / 2.3)));
        this.pose(p, yaw, pitch, roll, fov);
        const focusDist = p.distanceTo(new THREE.Vector3(room.monitor.position.x, room.monitor.position.y, room.monitor.position.z));
        this.ctx.renderer.setFx({
          dofFocus: focusDist,
          dofRange: 0.9 + (1 - k) * 4,
          dofStrength: k * 0.95,
        });
        this.ctx.player.controlEnabled = false;
      },
      end: () => {
        this.ctx.player.yaw = targetYaw;
        this.ctx.player.pitch = targetPitch;
        this.ctx.renderer.setFx({ dofFocus: 0.76, dofRange: 0.85, dofStrength: 0.95 });
      },
    });
  }

  /* ---------------------------------------------------------- 2. swallowed */
  playSwallow(): Promise<void> {
    const { camera, room, audio, renderer, tunnel } = this.ctx;
    const startPos = camera.position.clone();
    const startYaw = this.yaw;
    const startPitch = this.pitch;
    const screenPos = new THREE.Vector3(room.monitor.position.x, room.monitor.position.y, room.monitor.position.z);
    const mouth = this.buildMouth(screenPos);
    this.mouth = mouth;
    const suction = room.suctionProps;
    const startTransforms = suction.map((o) => ({
      pos: o.position.clone(),
      scale: o.scale.clone(),
    }));
    const streaks: THREE.Mesh[] = [];
    for (let i = 0; i < 44; i++) {
      const geo = new THREE.PlaneGeometry(0.2 + Math.random() * 0.5, 0.06 + Math.random() * 0.12);
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() < 0.6 ? 0x9fd0ff : 0xffffff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const m = new THREE.Mesh(geo, mat);
      const a = Math.random() * TAU;
      const r = 0.4 + Math.random() * 2.4;
      m.position.set(startPos.x + Math.cos(a) * r, startPos.y + Math.sin(a) * r, startPos.z + (Math.random() - 0.5) * 2);
      m.rotation.z = Math.random() * TAU;
      this.ctx.roomGroup.add(m);
      streaks.push(m);
    }
    // where the mouth meets the tunnel: the exact first point of the tunnel curve
    const entry = tunnel.curve.getPointAt(0);
    let entered = false;
    const ENTER_T = 3.5;

    return this.play({
      duration: 6.6,
      start: () => {
        audio.duck(0.2, 4);
        audio.whoosh(1.6, true);
        renderer.setFx({ chroma: 0.9, glitch: 0.25, dofStrength: 1, dofRange: 0.5, dofFocus: 0.7 });
      },
      update: (t) => {
        if (t < ENTER_T) {
          // A: the screen breathes | B: the pull | the last beats reach the mouth
          const pull = easeInCubic(clamp01((t - 0.9) / 2.4));
          const rush = easeInQuad(clamp01((t - 2.0) / 1.5));
          const roll = Math.sin(t * 1.6) * 0.05 * pull + rush * 0.2;
          const yaw = startYaw + Math.sin(t * 0.9) * 0.05 * pull;
          const pitch = startPitch + Math.sin(t * 1.3) * 0.03 * pull - rush * 0.05;
          const p = startPos.clone().lerp(entry, clamp01(pull));
          p.x += Math.sin(t * 7.0) * 0.02 * rush;
          p.y += Math.sin(t * 2.2) * 0.006;
          const fov = lerp(camera.fov, 96, rush);
          this.pose(p, yaw, pitch, roll, fov);
          renderer.setFx({
            glitch: 0.2 + pull * 0.5 + rush * 0.3,
            chroma: 0.6 + rush * 1.4,
            dofStrength: 0.95 - rush * 0.85,
            radialBlur: rush * 0.7,
          });

          // the face opens
          mouth.scale.setScalar(lerp(1, 11, easeInOutCubic(clamp01((t - 0.9) / 2.6))));
          mouth.position.z = screenPos.z + 0.05 + clamp01((t - 0.9) / 2.4) * 0.14;
          mouth.rotation.z = Math.sin(t * 2.4) * 0.08 * clamp01(t / 2);

          // room props get eaten
          const k = clamp01((t - 1.1) / 2.3);
          for (let i = 0; i < suction.length; i++) {
            const o = suction[i];
            const s0 = startTransforms[i];
            const delay = (i % 7) * 0.05;
            const kk = clamp01((k - delay) / (1 - delay));
            const dir = screenPos.clone().sub(s0.pos).normalize();
            const dist = s0.pos.distanceTo(screenPos);
            o.position.copy(s0.pos).add(dir.multiplyScalar(dist * kk * 1.05));
            o.position.x += Math.sin(kk * 8 + i) * 0.18 * kk;
            o.position.y += Math.cos(kk * 7 + i * 2) * 0.16 * kk;
            o.scale.copy(s0.scale).multiplyScalar(1 - kk * 0.92);
            o.rotation.z += kk * 0.4;
          }
          for (let i = 0; i < streaks.length; i++) {
            const sp = streaks[i];
            const dirZ = (i % 2 === 0 ? 1 : -1);
            sp.position.z += dirZ * (0.4 + rush * 26) * (1 / 60);
            sp.position.x += Math.sin(i + t * 2) * 0.01;
            if (Math.abs(sp.position.z - p.z) > 26) sp.position.z = p.z + dirZ * 2;
            (sp.material as THREE.MeshBasicMaterial).opacity = 0.15 + rush * 0.7;
          }
          return;
        }

        // ---- C: through the face, onto the tunnel curve (one continuous move)
        if (!entered) {
          entered = true;
          tunnel.setActive(true);
          tunnel.setProgress(0);
          this.ctx.roomGroup.visible = false;
        }
        const k = clamp01((t - ENTER_T) / (6.6 - ENTER_T));
        const prog = Math.min(0.999, 0.001 + easeInQuad(k) * 0.054);
        const p = tunnel.curve.getPointAt(prog);
        const tan = tunnel.curve.getTangentAt(prog).normalize();
        const yaw = Math.atan2(-tan.x, -tan.z);
        const pitch = Math.asin(clamp(tan.y, -1, 1));
        this.pose(p, yaw, pitch, Math.sin(k * 6.0) * 0.22 * k, lerp(96, 90, k));
        tunnel.setProgress(prog);
        renderer.setFx({
          glitch: 0.55,
          chroma: 2.0,
          dofStrength: 0.15,
          radialBlur: 0.85,
          flash: Math.max(0, 0.6 - k * 3.2),
        });
      },
      end: () => {
        for (const s of streaks) {
          s.parent?.remove(s);
          s.geometry.dispose();
          (s.material as THREE.Material).dispose();
        }
        if (this.mouth) {
          this.mouth.parent?.remove(this.mouth);
          this.mouth = null;
        }
        this.ctx.renderer.setFx({ chroma: 0.35, flash: 0, dofStrength: 0, radialBlur: 0.3 });
        void camera;
      },
    });
  }

  private buildMouth(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.position.z += 0.06;
    const lipMat = new THREE.MeshBasicMaterial({ color: 0xdff0ff, toneMapped: false, depthTest: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 48), lipMat);
    g.add(ring);
    const teethMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, toneMapped: false, depthTest: false });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 4), teethMat);
      tooth.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0);
      tooth.rotation.z = a - Math.PI / 2;
      g.add(tooth);
    }
    const throat = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x000308, toneMapped: false, depthTest: false }),
    );
    throat.position.z = -0.01;
    g.add(throat);
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 32),
      new THREE.MeshBasicMaterial({ color: 0x4d8dff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    g.add(glow);
    g.traverse((o) => { o.renderOrder = 20; });
    g.rotation.y = 0;
    this.ctx.roomGroup.add(g);
    const light = new THREE.PointLight(0x7fb4ff, 6, 6, 2);
    light.position.copy(at).add(new THREE.Vector3(0, 0, 0.6));
    g.add(light);
    return g;
  }

  /* ------------------------------------------------------------- 3. tunnel */
  playTunnel(): Promise<void> {
    const { camera, tunnel, renderer, audio } = this.ctx;
    const up = new THREE.Vector3(0, 1, 0);
    const lookTarget = new THREE.Vector3();
    return this.play({
      duration: 21,
      start: () => {
        tunnel.setActive(true);
        audio.whoosh(2.4, true);
        audio.rumble(6, 0.5);
        renderer.setFx({ glitch: 0.35, chroma: 0.8, radialBlur: 0.5, dofStrength: 0 });
      },
      update: (t) => {
        const k = clamp01(t / 19.5);
        const progress = 0.055 + easeInOutCubic(k) * 0.945;
        const p = tunnel.curve.getPointAt(progress);
        const tangent = tunnel.curve.getTangentAt(progress);
        // banking through the curves
        const roll = Math.sin(k * 9.5) * 0.32 * Math.sin(k * Math.PI) + Math.sin(t * 0.7) * 0.05;
        // look slightly ahead, with human drift
        lookTarget.copy(p).add(tangent.clone().multiplyScalar(9));
        const yaw = Math.atan2(-(lookTarget.x - p.x), -(lookTarget.z - p.z));
        const pitch = Math.asin(clamp((lookTarget.y - p.y) / Math.max(0.001, lookTarget.distanceTo(p)), -1, 1));
        this.pose(p.clone(), yaw, pitch + Math.sin(t * 0.5) * 0.04, roll, lerp(90, 74, k));
        tunnel.setProgress(progress);
        const surge = Math.sin(k * Math.PI) ** 0.5;
        renderer.setFx({
          glitch: 0.22 + surge * 0.45 + Math.max(0, Math.sin(t * 3.7)) * 0.12,
          chroma: 0.7 + surge * 1.1,
          radialBlur: 0.35 + surge * 0.5,
          flash: (k > 0.955 ? (k - 0.955) * 8 : 0) + Math.max(0, Math.sin(t * 9.3) - 0.92) * 2,
          invert: Math.max(0, Math.sin(t * 1.7) - 0.985) * 0.6,
        });
        if (k > 0.93 && k < 0.96) audio.whoosh(1.2, false);
        void up;
      },
      end: () => {
        renderer.setFx({ glitch: 0.05, chroma: 0.3, radialBlur: 0, flash: 0, invert: 0 });
      },
    });
  }

  /* ----------------------------------------------------------- 4. collapse */
  playCollapse(
    startPos: THREE.Vector3,
    startYaw: number,
    startPitch: number,
    landing: { x: number; z: number },
    onApproachLanding?: () => void,
  ): Promise<void> {
    const { camera, audio, renderer } = this.ctx;
    const sPos = startPos.clone();
    const sYaw = startYaw;
    const sPitch = startPitch;
    const landXZ = new THREE.Vector2(landing.x, landing.z);
    let approached = false;
    let rumbleStop: (() => void) | null = null;
    let fallStop: (() => void) | null = null;
    const baseYaw = sYaw;
    // hand-authored beats (seconds). The eye moves first; the body follows late.
    const beats: { t: number; yaw: number; pitch: number; dy: number; dz: number; roll: number }[] = [
      { t: 0.0, yaw: 0, pitch: 0, dy: 0, dz: 0, roll: 0 },
      { t: 1.1, yaw: 0.02, pitch: 0.02, dy: 0, dz: 0, roll: 0 },
      { t: 1.45, yaw: 0.62, pitch: 0.06, dy: -0.01, dz: 0, roll: -0.02 },   // eyes snap left
      { t: 2.15, yaw: 0.58, pitch: 0.03, dy: -0.01, dz: 0, roll: -0.02 },   // hesitate
      { t: 2.5, yaw: -0.55, pitch: -0.02, dy: -0.02, dz: 0.04, roll: 0.03 }, // snap right
      { t: 3.2, yaw: -0.5, pitch: -0.05, dy: -0.02, dz: 0.04, roll: 0.03 },
      { t: 3.7, yaw: -0.1, pitch: -0.28, dy: -0.03, dz: 0.06, roll: 0.01 },
      { t: 4.8, yaw: 0.18, pitch: -0.9, dy: -0.1, dz: 0.1, roll: -0.04 },   // look at the floor
      { t: 6.4, yaw: 0.32, pitch: -1.05, dy: -0.16, dz: 0.12, roll: -0.05 }, // track cracks
      { t: 7.4, yaw: -0.2, pitch: -0.7, dy: -0.24, dz: 0.16, roll: 0.07 },  // step back / stumble
      { t: 8.2, yaw: -0.35, pitch: -0.45, dy: -0.5, dz: 0.2, roll: 0.1 },
    ];
    const beatAt = (t: number): { yaw: number; pitch: number; dy: number; dz: number; roll: number } => {
      let a = beats[0];
      let b = beats[beats.length - 1];
      for (let i = 0; i < beats.length - 1; i++) {
        if (t >= beats[i].t && t <= beats[i + 1].t) { a = beats[i]; b = beats[i + 1]; break; }
      }
      const span = Math.max(0.0001, b.t - a.t);
      const k = easeInOutCubic(clamp01((t - a.t) / span));
      return {
        yaw: lerp(a.yaw, b.yaw, k),
        pitch: lerp(a.pitch, b.pitch, k),
        dy: lerp(a.dy, b.dy, k),
        dz: lerp(a.dz, b.dz, k),
        roll: lerp(a.roll, b.roll, k),
      };
    };

    return this.play({
      duration: 17.2,
      start: () => {
        audio.duck(0.15, 6);
        rumbleStop = audio.rumble(9, 0.9);
        renderer.setFx({ glitch: 0.12, chroma: 0.5, dofStrength: 0 });
      },
      update: (t, dt) => {
        // ---- 0..9 s : the beat before the floor goes
        if (t < 9.0) {
          const b = beatAt(t);
          const p = sPos.clone();
          p.y += b.dy;
          p.z += b.dz;
          p.y += Math.sin(t * 1.4) * 0.005;
          p.x += Math.sin(t * 0.8) * 0.004;
          this.pose(p, baseYaw + b.yaw, sPitch + b.pitch, b.roll, 74 + Math.sin(t * 0.4) * 0.6);
          if (t > 6.6 && rumbleStop) { rumbleStop(); rumbleStop = null; }
          if (t > 6.9 && t < 7.05) audio.crack(1.4);
          if (t > 8.1) {
            audio.crack(1.8);
            audio.debris();
            if (!fallStop) fallStop = audio.startFallWind();
          }
          renderer.setFx({
            glitch: 0.12 + smoothstep(5.5, 9, t) * 0.35,
            chroma: 0.5 + smoothstep(5, 9, t) * 0.6,
            flash: 0,
          });
          return;
        }

        // ---- 9..17 s : the fall (integrated, with terminal drift)
        const fallT = clamp01((t - 9.0) / 8.0);
        // the fall ends a few metres above the bedroom floor; the landing shot continues the drop
        // ends just under the bedroom ceiling so the room can be revealed without clipping
        const endY = 2.15;
        const distance = Math.max(0, sPos.y - endY) * easeInQuad(fallT);
        const p = sPos.clone();
        p.y = sPos.y - distance;
        // horizontal travel eases from the glitch world into the bedroom footprint
        const hk = easeInOutCubic(clamp01((fallT - 0.25) / 0.7));
        const baseX = lerp(sPos.x, landXZ.x, hk);
        const baseZ = lerp(sPos.z, landXZ.y, hk);
        const drift = Math.sin(fallT * Math.PI);
        p.x = baseX + Math.sin(fallT * 6.2) * 1.8 * drift;
        p.z = baseZ + Math.cos(fallT * 4.7) * 1.4 * drift;
        // look: hole -> up at the receding world -> down at the light
        let pitch: number;
        let yaw: number;
        let roll: number;
        if (fallT < 0.22) {
          const k = fallT / 0.22;
          pitch = lerp(-0.45, 0.75, smoothstep(0.25, 1, k));
          yaw = baseYaw - 0.3 + Math.sin(k * 4) * 0.15;
          roll = lerp(0.1, -0.25, k);
        } else if (fallT < 0.55) {
          const k = (fallT - 0.22) / 0.33;
          pitch = lerp(0.75, -0.35, smoothstep(0, 1, k));
          yaw = baseYaw + Math.sin(k * 5.5) * 0.35;
          roll = Math.sin(k * 6.0) * 0.45;
        } else {
          const k = (fallT - 0.55) / 0.45;
          pitch = lerp(-0.35, -0.85, smoothstep(0, 1, k));
          yaw = baseYaw + Math.sin(k * 2.2) * 0.12;
          roll = lerp(Math.sin(3.0) * 0.45, 0.03, smoothstep(0, 1, k));
        }
        this.pose(p, yaw, pitch, roll, 84 + fallT * 8);
        renderer.setFx({
          glitch: 0.3 + fallT * 0.25,
          chroma: 0.6 + fallT * 1.2,
          radialBlur: 0.25 + fallT * 0.75,
          flash: Math.max(0, Math.sin(t * 5.3) - 0.995) * 20,
        });
        this.spawnFallDebris(p, dt);
        if (!approached && p.y < 3.1) {
          approached = true;
          // the bedroom comes up out of the dark underneath
          this.showLandingShaft(true, landXZ.x, landXZ.y);
          onApproachLanding?.();
        }
        return;
      },
      end: () => {
        if (fallStop) { fallStop(); fallStop = null; }
        if (rumbleStop) { rumbleStop(); rumbleStop = null; }
        this.clearFallDebris();
        this.showLandingShaft(false);
        this.ctx.renderer.setFx({ glitch: 0.25, chroma: 0.5, radialBlur: 0, flash: 0, fade: 0 });
        void camera;
      },
    });
  }

  private spawnFallDebris(center: THREE.Vector3, dt: number): void {
    if (this.fallDebris.length < 26 && Math.random() < dt * 26) {
      const geo = new THREE.BoxGeometry(0.2 + Math.random() * 0.8, 0.06 + Math.random() * 0.3, 0.3 + Math.random() * 0.9);
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fc8ff, transparent: true, opacity: 0.5, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(center).add(new THREE.Vector3(
        (Math.random() - 0.5) * 7,
        Math.random() * 4 - 1,
        (Math.random() - 0.5) * 7,
      ));
      m.userData.vy = 6 + Math.random() * 14;
      m.userData.spin = (Math.random() - 0.5) * 3;
      m.userData.life = 0;
      this.ctx.camera.parent?.add(m);
      this.fallDebris.push(m);
    }
    for (const m of this.fallDebris) {
      m.position.y += (m.userData.vy as number) * dt * 0.35;
      m.rotation.x += (m.userData.spin as number) * dt;
      m.rotation.z += (m.userData.spin as number) * dt * 0.7;
      m.userData.life = (m.userData.life as number) + dt;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - (m.userData.life as number) * 0.4);
    }
    this.fallDebris = this.fallDebris.filter((m) => {
      if ((m.userData.life as number) > 1.6) {
        m.parent?.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  private clearFallDebris(): void {
    for (const m of this.fallDebris) {
      m.parent?.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.fallDebris = [];
  }

  private showLandingShaft(show: boolean, x = 0, z = 0): void {
    if (!this.landingShaft && show) {
      const g = new THREE.Group();
      const shaftMat = new THREE.MeshBasicMaterial({
        color: 0x6fa8ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.4, 40, 20, 1, true), shaftMat);
      cyl.position.y = 20;
      g.add(cyl);
      const glow = new THREE.PointLight(0x7fb4ff, 40, 60, 2);
      glow.position.set(0, 4, 0);
      g.add(glow);
      g.position.set(x, 0, z);
      this.ctx.roomGroup.add(g);
      this.landingShaft = g;
    }
    if (this.landingShaft) this.landingShaft.visible = show;
  }

  /* ------------------------------------------------------------- 5. landing */
  playLanding(landing: { x: number; z: number }): Promise<void> {
    const { camera, audio, renderer, player } = this.ctx;
    // No teleport: the landing shot continues from wherever the fall left the camera.
    const start = camera.position.clone();
    const startYaw = this.yaw;
    const startPitch = this.pitch;
    const startRoll = this.roll;
    const startFov = camera.fov;
    const target = new THREE.Vector3(landing.x, 1.62, landing.z);
    const hit = Math.min(1, Math.max(0.18, start.y > 1.7 ? 0.9 * (3.4 / Math.max(0.5, start.y - 1.62)) : 0.2));
    let landed = false;
    return this.play({
      duration: 3.6,
      start: () => {
        renderer.setFx({ flash: 0.3, glitch: 0.5, chroma: 0.8, radialBlur: 0 });
        this.ctx.roomGroup.visible = true;
      },
      update: (t) => {
        const k = easeOutCubic(clamp01(t / hit));
        const p = start.clone().lerp(target, k);
        // the impact: a short, heavy vertical settle
        if (t > hit) p.y += Math.sin(clamp01((t - hit) / 0.5) * Math.PI * 2) * Math.exp(-(t - hit) * 5) * 0.06;
        if (!landed && t >= hit) {
          landed = true;
          audio.land(1.2);
          audio.debris();
          player.position.set(target.x, 0, target.z);
          renderer.setFx({ flash: 0.18 });
        }
        const w = easeOutCubic(clamp01((t - hit * 0.5) / 1.9));
        const pitch = lerp(startPitch, -0.03, w);
        const yaw = lerp(startYaw, 0, w);
        const roll = lerp(startRoll, 0, w) + Math.sin(t * 6) * Math.exp(-t * 2.2) * 0.06;
        this.pose(p, yaw, pitch, roll, lerp(startFov, 74, clamp01(t / 1.6)));
        renderer.setFx({
          flash: Math.max(0, 0.3 - t * 0.8),
          glitch: Math.max(0, 0.5 - t * 0.3),
          chroma: Math.max(0.3, 0.8 - t * 0.36),
        });
        if (t > 1.5 && t < 1.6) audio.heartbeat(0.8);
        if (t > 2.4 && t < 2.5) audio.heartbeat(0.6);
        if (t > 3.0 && t < 3.1) audio.breath(0.5);
      },
      end: () => {
        player.reset(landing.x, 0, landing.z, 0, -0.03);
        player.controlEnabled = true;
        renderer.setFx({ flash: 0, glitch: 0.08, chroma: 0.3 });
        camera.updateProjectionMatrix();
      },
    });
  }

  /** Used by the debug jump: place the camera instantly. */
  snapTo(pos: THREE.Vector3, yaw: number, pitch: number): void {
    this.pose(pos, yaw, pitch, 0, 74);
    this.ctx.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  get isActive(): boolean { return this.active; }
  get progress(): number { return this.shot ? clamp01(this.shotTime / this.shot.duration) : 1; }

  /** Cancel any running shot (used on restart). */
  cancel(): void {
    if (this.shot) {
      this.shot.end?.();
      this.shot = null;
    }
    const r = this.resolve;
    this.resolve = null;
    r?.();
    this.active = false;
    this.clearFallDebris();
    this.showLandingShaft(false);
    if (this.mouth) {
      this.mouth.parent?.remove(this.mouth);
      this.mouth = null;
    }
    this.ctx.renderer.setFx({ flash: 0, invert: 0, fade: 0, radialBlur: 0, glitch: 0, dofStrength: 0 });
    void easeOutCubic;
  }
}
