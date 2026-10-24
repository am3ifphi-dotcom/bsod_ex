// Scripted camera sequences: leaning into the monitor, being devoured,
// the world collapsing, the fall, and the return to the bedroom.
//
// All sequences drive the same camera instance the player uses; the player's
// own controller is frozen and handed back afterwards.  Transitions between
// room-space and world-space happen while the camera is completely enclosed
// by the "throat" tunnel, so there is never a cut, fade or hard scene swap.
import * as THREE from 'three';
import { Engine } from '../core/engine';
import { Player } from './player';
import { Room } from './room';
import { World, WORLD_OFFSET, terrainHeight } from './world';
import { AudioEngine } from '../core/audio';
import { UI } from './ui';
import { Physics } from '../core/physics';
import { mouthFrag, mouthVert } from '../core/shaders';
import { RNG, clamp, damp, easeIn, easeInOut, easeOut, lerp, makeCanvas, canvasTexture, smoothstep } from '../core/utils';
import { settings } from '../core/settings';
import { APPROACH_DURATION, approachGaze } from './approach';

export type SeqMode = 'none' | 'approach' | 'consume' | 'collapse' | 'fall' | 'return';

interface Radar {
  pos: THREE.Vector3; look: [number, number]; fov: number; roll: number; shake: number;
}

export class Sequences {
  mode: SeqMode = 'none';
  t = 0;
  /** true while a sequence owns the camera */
  active = false;

  private engine: Engine;
  private player: Player;
  private room: Room;
  private world: World;
  private audio: AudioEngine;
  private ui: UI;
  private physics: Physics;
  private cam: THREE.PerspectiveCamera;

  private rng = new RNG(12345);
  private baseYaw = 0;
  private basePitch = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private eyeOff = new THREE.Vector2(0, 0);
  private cueLook: [number, number] = [0, 0];
  private roll = 0;
  private shakeAmt = 0;
  private shakeSeed = 0;
  /** camera pose at the end of the lean-in (used by the BSOD hold) */
  private leanPose: { pos: THREE.Vector3; yaw: number; pitch: number; fov: number } | null = null;

  // room-devouring props
  private mouth!: THREE.Mesh;
  private mouthUniforms = { uOpen: { value: 0 }, uTime: { value: 0 }, uGlitch: { value: 0 } };
  private tunnel!: THREE.Mesh;
  private tunnelUniforms = { uTime: { value: 0 }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(0x3f8cff) } };
  private tunnelGroup = new THREE.Group();
  private suckProps: { obj: THREE.Object3D; base: THREE.Vector3; delay: number; dir: THREE.Vector3 }[] = [];

  // collapse props
  private cracks: THREE.Mesh[] = [];
  private crackMats: THREE.MeshBasicMaterial[] = [];
  private hole!: THREE.Mesh;
  private debris: { mesh: THREE.Mesh; body: any; spin: THREE.Vector3 }[] = [];
  private collapseOrigin = new THREE.Vector3();
  private groundY = 0;

  // callbacks
  onEmergeInWorld: (() => void) | null = null;
  onFallStart: (() => void) | null = null;
  onReturned: (() => void) | null = null;
  onApproachDone: (() => void) | null = null;
  onCollapseBegin: (() => void) | null = null;

  constructor(deps: {
    engine: Engine; player: Player; room: Room; world: World; audio: AudioEngine;
    ui: UI; physics: Physics;
  }) {
    this.engine = deps.engine;
    this.player = deps.player;
    this.room = deps.room;
    this.world = deps.world;
    this.audio = deps.audio;
    this.ui = deps.ui;
    this.physics = deps.physics;
    this.cam = deps.engine.camera;
    this.buildMouth();
    this.buildTunnel();
  }

  private buildMouth() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: mouthVert,
      fragmentShader: mouthFrag,
      uniforms: this.mouthUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mouth = new THREE.Mesh(geo, mat);
    this.mouth.position.copy(this.room.screenWorldPosition()).add(new THREE.Vector3(0, 0, 0.01));
    this.mouth.scale.setScalar(0.001);
    this.mouth.visible = false;
    this.mouth.renderOrder = 5;
    this.room.group.add(this.mouth);
  }

  private buildTunnel() {
    const geo = new THREE.CylinderGeometry(2.6, 5.5, 46, 28, 12, true);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.tunnelUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv; vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vPos;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main() {
          // scrolling error-text bands + block noise, moving toward the camera
          float band = step(0.55, fract(vUv.y * 42.0 + uTime * 2.4));
          float row = floor(vUv.y * 42.0);
          float g = step(0.72, hash(vec2(row, floor(uTime * 14.0))));
          vec3 col = uColor * (0.06 + band * 0.05 + g * 0.22);
          // shimmering shards
          vec2 gp = floor(vUv * vec2(30.0, 46.0));
          col += uColor * 0.35 * step(0.985, hash(gp + floor(uTime * 9.0)));
          // bright rim near the screen edge
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          col *= mix(0.4, 1.0, edge);
          gl_FragColor = vec4(col * uIntensity, 1.0);
        }`,
    });
    this.tunnel = new THREE.Mesh(geo, mat);
    this.tunnel.position.set(0, 0, -24);
    this.tunnel.frustumCulled = false;
    this.tunnelGroup.add(this.tunnel);
    // shard rings tumbling past the camera
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8fc0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2 - i * 0.1, 0.03, 4, 26), ringMat);
      ring.position.set(0, 0, -3 - i * 4.0);
      ring.rotation.z = this.rng.range(0, 3);
      this.tunnelGroup.add(ring);
    }
    this.tunnelGroup.visible = false;
    this.engine.scene.add(this.tunnelGroup);
  }

  // ------------------------------------------------------------------ setup
  /** The leaning pose the approach ended on, if it has run. */
  get approachPose() { return this.leanPose; }
  forgetApproachPose() { this.leanPose = null; }

  private enter(mode: SeqMode) {
    this.mode = mode;
    this.t = 0;
    this.active = true;
    this.player.controlCamera = false;
    this.player.setFrozen(true);
    this.baseYaw = this.player.yaw;
    this.basePitch = this.player.pitch;
    this.lookYaw = this.player.yaw;
    this.lookPitch = this.player.pitch;
    this.cueLook = [this.lookYaw, this.lookPitch];
    this.roll = 0;
    this.shakeAmt = 0;
  }

  /**
   * Hand the camera back to the player. `resetCamera: false` keeps the scripted
   * camera transform in place (the lean-in ends off the player's capsule, so
   * snapping to the standing eye height would flick the view backwards).
   */
  private exit(resetCamera = true) {
    this.active = false;
    this.mode = 'none';
    this.player.controlCamera = true;
    this.player.setFrozen(false);
    this.player.yaw = this.lookYaw;
    this.player.pitch = clamp(this.lookPitch, -1.2, 1.2);
    if (resetCamera) this.player.updateCamera(0.016);
    this.tunnelGroup.visible = false;
  }

  // --------------------------------------------------------------- approach
  startApproach() {
    this.enter('approach');
    this.audio.monitorOn();
    this.engine.setBokehEnabled(true);
    this.engine.setBokehFocus(0.5, 0.0032, 0.014);
    this.ui.setLetterbox(true);
    this.ui.showPrompt(null);
  }

  // ---------------------------------------------------------------- consume
  startConsume() {
    this.enter('consume');
    this.mouth.visible = true;
    this.mouthUniforms.uOpen.value = 0;
    this.audio.consumeRiser(7.5);
    this.engine.setBokehEnabled(true);
    this.ui.showClickHint(false);
    this.ui.setCursor(false);
    // props that get pulled into the screen
    this.suckProps = [];
    this.room.group.children.forEach((child, i) => {
      if (child === this.mouth) return;
      if ((child as any).isLight) return;
      this.suckProps.push({
        obj: child,
        base: child.position.clone(),
        delay: this.rng.range(0.2, 2.4) + (i % 5) * 0.08,
        dir: new THREE.Vector3(
          this.rng.range(-0.6, 0.6),
          this.rng.range(-0.4, 0.4),
          this.rng.range(0.4, 1.6),
        ),
      });
    });
  }

  // --------------------------------------------------------------- collapse
  startCollapse() {
    this.enter('collapse');
    this.collapseOrigin.copy(this.player.feet);
    this.groundY = this.player.feet.y;
    this.buildCrackDecals();
    this.audio.rumble(9.5, 0.22);
    this.onCollapseBegin?.();
  }

  private buildCrackDecals() {
    // procedural crack sprite: branching lines on a transparent canvas
    const { c, ctx } = makeCanvas(1024, 1024);
    ctx.clearRect(0, 0, 1024, 1024);
    const rng = new RNG(99);
    const drawBranch = (x: number, y: number, ang: number, len: number, depth: number) => {
      if (depth <= 0 || len < 6) return;
      let cx = x, cy = y, a = ang;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const seg = Math.max(3, len / 6);
      for (let i = 0; i < 6; i++) {
        a += rng.range(-0.35, 0.35);
        cx += Math.cos(a) * seg;
        cy += Math.sin(a) * seg;
        ctx.lineTo(cx, cy);
      }
      ctx.strokeStyle = `rgba(4,8,20,${0.85 - depth * 0.06})`;
      ctx.lineWidth = Math.max(1, depth * 1.6);
      ctx.stroke();
      // pale inner highlight
      ctx.strokeStyle = `rgba(150,200,255,${0.22 - depth * 0.02})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (rng.next() < 0.8) drawBranch(cx, cy, a + rng.range(0.4, 1.3), len * 0.62, depth - 1);
      if (rng.next() < 0.65) drawBranch(cx, cy, a - rng.range(0.4, 1.3), len * 0.55, depth - 1);
    };
    for (let i = 0; i < 7; i++) {
      drawBranch(512 + rng.range(-60, 60), 512 + rng.range(-60, 60), rng.range(0, 6.28), rng.range(180, 300), 5);
    }
    const tex = canvasTexture(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
        color: 0xffffff, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = this.rng.range(0, 6.28);
      const offset = i === 0 ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(this.rng.range(-2.4, 2.4), 0, this.rng.range(-2.4, 2.4));
      m.position.copy(this.collapseOrigin).add(offset).add(new THREE.Vector3(0, 0.03 + i * 0.005, 0));
      m.visible = false;
      m.renderOrder = 2;
      this.engine.scene.add(m);
      this.cracks.push(m);
      this.crackMats.push(mat);
    }
    // the void under the ground
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000205, transparent: true, opacity: 0 });
    this.hole = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), holeMat);
    this.hole.rotation.x = -Math.PI / 2;
    this.hole.position.copy(this.collapseOrigin).add(new THREE.Vector3(0, 0.02, 0));
    this.hole.visible = false;
    this.hole.renderOrder = 3;
    this.engine.scene.add(this.hole);
  }

  private spawnDebris(n: number) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.7, metalness: 0.2, flatShading: true });
    for (let i = 0; i < n; i++) {
      const size = new THREE.Vector3(this.rng.range(0.25, 1.1), this.rng.range(0.12, 0.5), this.rng.range(0.25, 1.1));
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0.6, 4.2);
      const pos = this.collapseOrigin.clone().add(new THREE.Vector3(Math.cos(a) * r, -this.rng.range(0.2, 1.2), Math.sin(a) * r));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.copy(size);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(pos);
      mesh.rotation.set(this.rng.range(0, 3), this.rng.range(0, 3), this.rng.range(0, 3));
      this.engine.scene.add(mesh);
      const body = this.physics.addDynamicBox(pos, size.clone().multiplyScalar(0.5), { ccd: false });
      body.applyImpulse({ x: this.rng.range(-2, 2), y: this.rng.range(0.5, 3.5), z: this.rng.range(-2, 2) }, true);
      body.applyTorqueImpulse({ x: this.rng.range(-1.5, 1.5), y: this.rng.range(-1.5, 1.5), z: this.rng.range(-1.5, 1.5) }, true);
      this.debris.push({ mesh, body, spin: new THREE.Vector3(this.rng.range(-2, 2), this.rng.range(-2, 2), this.rng.range(-2, 2)) });
    }
  }

  // ----------------------------------------------------------------- return
  startReturn(land: boolean) {
    this.enter('return');
    this.tunnelGroup.visible = true;
    this.tunnelUniforms.uIntensity.value = 1;
    if (land) this.audio.stopFallWind();
  }

  // ------------------------------------------------------------------ update
  update(dt: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    this.shakeSeed += dt * 40;
    switch (this.mode) {
      case 'approach': this.updateApproach(dt); break;
      case 'consume': this.updateConsume(dt); break;
      case 'collapse': this.updateCollapse(dt); break;
      case 'fall': this.updateFall(dt); break;
      case 'return': this.updateReturn(dt); break;
      default: break;
    }
    this.syncDebris();
    return this.active;
  }

  private syncDebris() {
    for (const d of this.debris) {
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  clearDebris() {
    for (const d of this.debris) {
      this.engine.scene.remove(d.mesh);
      this.physics.removeBody(d.body);
    }
    this.debris.length = 0;
    for (const c of this.cracks) { this.engine.scene.remove(c); c.geometry.dispose(); }
    this.cracks.length = 0;
    this.crackMats.length = 0;
    if (this.hole) { this.engine.scene.remove(this.hole); this.hole.geometry.dispose(); }
  }

  /** organic camera: saccade (eyes) -> head -> settle, with a constant micro-sway */
  private applyCamera(dt: number, extraPos = new THREE.Vector3(), posLerp = 1) {
    const s = settings.value.shake;
    // eyes dart first: the offset snaps toward the new target and relaxes
    this.eyeOff.x = damp(this.eyeOff.x, 0, 5.5, dt);
    this.eyeOff.y = damp(this.eyeOff.y, 0, 5.5, dt);
    this.lookYaw = damp(this.lookYaw, this.cueLook[0], 7.5, dt);
    this.lookPitch = damp(this.lookPitch, this.cueLook[1], 7.5, dt);

    const swayYaw = Math.sin(this.t * 0.7) * 0.004 + Math.sin(this.t * 1.31) * 0.0022;
    const swayPitch = Math.cos(this.t * 0.53) * 0.0035;
    const shake = this.shakeAmt * s;
    const jx = Math.sin(this.shakeSeed * 1.7) * 0.02 * shake;
    const jy = Math.cos(this.shakeSeed * 2.3) * 0.02 * shake;

    const yaw = this.lookYaw + this.eyeOff.x + swayYaw + jx;
    const pitch = clamp(this.lookPitch + this.eyeOff.y + swayPitch + jy, -1.5, 1.5);
    const roll = this.roll + Math.sin(this.t * 0.9) * 0.006 + Math.sin(this.shakeSeed * 0.7) * 0.006 * shake;

    if (posLerp >= 1) {
      this.cam.position.copy(extraPos);
    } else {
      this.cam.position.lerp(extraPos, posLerp);
    }
    const e = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    this.cam.quaternion.setFromEuler(e);
    if (Math.abs(this.cam.fov - this.cueFov) > 0.01) {
      this.cam.fov = damp(this.cam.fov, this.cueFov, 9, dt);
      this.cam.updateProjectionMatrix();
    }
  }
  private cueFov = 70;

  private setLook(yaw: number, pitch: number, saccade = 0.35) {
    this.cueLook = [yaw, pitch];
    // eye lead: a small extra offset that decays
    this.eyeOff.x += (yaw - this.lookYaw) * saccade * 0.25;
    this.eyeOff.y += (pitch - this.lookPitch) * saccade * 0.25;
  }

  // ---------------------------------------------------------------- approach
  private updateApproach(dt: number) {
    const t = this.t;
    const screen = this.room.screenWorldPosition();
    const keyboard = this.room.keyboardWorldPosition();

    // ---- body: stand -> lean over the desk -> eye level with the screen
    const e = easeInOut(clamp(t / (APPROACH_DURATION - 0.4)));
    const from = new THREE.Vector3(this.player.feet.x, this.player.feet.y + 1.62, this.player.feet.z);
    const target = new THREE.Vector3(screen.x + 0.02, screen.y + 0.03, screen.z + 0.62);
    const pos = from.clone().lerp(target, e);
    pos.y -= Math.sin(e * Math.PI) * 0.05;   // dip forward over the desk

    // ---- gaze: your own hands on the keys first, then up to the screen
    const gaze = approachGaze(pos, screen, keyboard, t);
    this.setLook(gaze.yaw, gaze.pitch, 0.5);

    this.cueFov = lerp(62, 46, e);
    this.roll = lerp(0, -0.055, e);
    // depth of field follows whatever you are actually looking at, so the keys
    // are sharp while you look down and the screen is sharp once you look up
    this.engine.setBokehFocus(gaze.focus, 0.0035, 0.02);

    this.applyCamera(dt, pos, 1);

    // settle, then hand over. The camera stays where the lean left it, and the
    // pose is recorded so the BSOD "hold" can use the exact same transform.
    if (t >= 1 && t > APPROACH_DURATION) {
      this.leanPose = {
        pos: this.cam.position.clone(),
        yaw: this.lookYaw,
        pitch: this.lookPitch,
        fov: 46,
      };
      this.cam.fov = 46;
      this.cam.updateProjectionMatrix();
      this.exit(false);
      this.onApproachDone?.();
    }
  }

  // ----------------------------------------------------------------- consume
  private updateConsume(dt: number) {
    const t = this.t;
    const screen = this.room.screenWorldPosition();

    // ---- 0..1.4 : push into the glyph
    if (t < 1.4) {
      const e = easeIn(t / 1.4);
      const pos = new THREE.Vector3(screen.x, screen.y + 0.03, screen.z + 0.62 - e * 0.28);
      this.cam.position.copy(pos);
      this.cam.lookAt(screen);
      this.cam.fov = lerp(46, 40, e);
      this.cam.updateProjectionMatrix();
      this.mouth.scale.setScalar(lerp(0.4, 1.6, e));
      this.mouthUniforms.uOpen.value = clamp((t - 0.6) / 1.4) * 0.5;
    }

    // ---- 1.4..4.2 : the room is eaten; props slide into the screen
    if (t >= 1.4 && t < 4.4) {
      const local = t - 1.4;
      this.mouth.scale.setScalar(lerp(1.6, 22, easeOut(clamp(local / 2.6))));
      this.mouthUniforms.uOpen.value = clamp(0.5 + local / 2.2);
      this.engine.fx.uGlitch.value = clamp(local / 2.6) * 1.0 * settings.value.glitch + 0.25;
      this.roll = Math.sin(local * 3.1) * 0.02 + local * 0.004;
      for (const p of this.suckProps) {
        const k = clamp((local - p.delay) / 1.4);
        if (k <= 0) continue;
        const target = screen.clone().add(new THREE.Vector3(0, 0, 0.05));
        p.obj.position.lerpVectors(p.base, target, easeIn(k) * 0.85);
        p.obj.position.addScaledVector(p.dir, k * 0.5);
        p.obj.scale.setScalar(clamp(1 - k * 0.9));
        p.obj.rotation.z += p.dir.x * 0.02;
      }
      const pos = new THREE.Vector3(screen.x, screen.y + 0.02, screen.z + 0.34 - local * 0.06);
      this.cam.position.copy(pos);
      this.cam.lookAt(screen);
      this.cam.rotation.z += Math.sin(local * 7) * 0.01;
      this.cam.fov = lerp(40, 62, clamp(local / 3));
      this.cam.updateProjectionMatrix();
      this.shakeAmt = 0.35 + local * 0.1;
      if (Math.random() < 0.02) this.audio.glitchBurst(0.6);
    }

    // ---- 4.4..6.0 : we are pulled through the mouth into the throat
    if (t >= 4.4 && t < 6.2) {
      const local = t - 4.4;
      this.tunnelGroup.visible = true;
      this.tunnelUniforms.uTime.value = t;
      this.tunnelGroup.position.copy(this.cam.position);
      this.tunnelGroup.quaternion.copy(this.cam.quaternion);
      const z = -2 + local * 9;
      this.tunnel.position.z = z;
      const pos = new THREE.Vector3(screen.x, screen.y, screen.z + 0.1 + local * 3.4);
      this.cam.position.copy(pos);
      const e = new THREE.Euler(Math.sin(local * 2.0) * 0.05, Math.PI + Math.sin(local * 1.3) * 0.04, Math.sin(local * 3.0) * 0.06, 'YXZ');
      this.cam.quaternion.setFromEuler(e);
      this.cam.fov = lerp(62, 92, clamp(local / 1.8));
      this.cam.updateProjectionMatrix();
      this.engine.fx.uGlitch.value = 1.0 * settings.value.glitch;
      this.shakeAmt = 0.8;
      // at the darkest point of the throat, swap the world in
      if (t > 5.5 && this.room.group.visible) {
        this.room.group.visible = false;
        this.world.group.visible = true;
        this.engine.scene.fog = this.worldFog;
        this.engine.scene.background = null;
        this.audio.startWorldAmbience();
        this.onEmergeInWorld?.();
      }
    }

    // ---- 6.2..8.2 : fall out of the throat into the wasteland
    if (t >= 6.2 && t < 8.4) {
      const local = (t - 6.2) / 2.2;
      this.tunnelGroup.position.copy(this.cam.position);
      this.tunnel.position.z = -2 + local * 34;
      this.tunnelUniforms.uIntensity.value = (1 - local) * 0.9;
      const spawn = this.world.spawn.pos.clone();
      const start = spawn.clone().add(new THREE.Vector3(0, 16, 6));
      const pos = start.clone();
      pos.y = lerp(start.y, spawn.y + 1.62, easeIn(local));
      pos.z = lerp(start.z, spawn.z, easeOut(local));
      this.cam.position.copy(pos);
      const yaw = Math.PI * 0.02;
      const e = new THREE.Euler(lerp(0.5, 0.02, easeOut(local)) + Math.sin(local * 8) * 0.01 * (1 - local), yaw, lerp(0.06, 0, easeOut(local)), 'YXZ');
      this.cam.quaternion.setFromEuler(e);
      this.cam.fov = lerp(92, 70, easeOut(local));
      this.cam.updateProjectionMatrix();
      this.engine.fx.uGlitch.value = (1 - local) * 0.8 * settings.value.glitch;
      this.shakeAmt = (1 - local) * 0.9;
      this.audio.setFallWindLevel?.(0.6 * (1 - local), 0.6);
      if (this.t > 7.9) {
        this.tunnelGroup.visible = false;
        this.engine.fx.uGlitch.value = 0;
        this.player.teleport(this.world.spawn.pos.clone().setY(this.world.spawn.pos.y + 0.05), 0, 0.02);
        this.exit();
        this.player.addLanding(0.8);
        this.audio.footstep('sand', false);
        this.audio.footstep('concrete', false);
        this.ui.chapter('CHAPTER II', '記憶領域 / MEMORY SPACE', 5200);
        this.ui.setLetterbox(true);
      }
    }
    this.mouthUniforms.uTime.value = t;
    this.mouthUniforms.uGlitch.value = this.engine.fx.uGlitch.value;
    this.mouthUniforms.uOpen.value = Math.max(this.mouthUniforms.uOpen.value, this.mouth.visible ? 0.2 : 0);
  }

  private worldFog = new THREE.FogExp2(0x0a1e42, 0.0125);

  // ---------------------------------------------------------------- collapse
  private updateCollapse(dt: number) {
    const t = this.t;
    const head = this.collapseOrigin.clone().add(new THREE.Vector3(0, 1.62, 0));
    const fwdYaw = this.baseYaw;
    let pos = head.clone();
    let fov = 70;

    // helper to look in a direction relative to the player's yaw
    const rel = (d: number, pitch: number) => [fwdYaw + d, pitch] as [number, number];

    if (t < 1.6) {
      // breathing, unaware
      this.setLook(...rel(0.02, -0.03), 0.2);
      this.cueFov = 70;
    } else if (t < 3.0) {
      // something is wrong: eyes dart right, then the head follows
      this.setLook(...rel(0.75, 0.02), 0.9);
      this.cueFov = 72;
      this.roll = lerp(this.roll, 0.02, 0.1);
      if (t > 2.0 && t < 2.05) this.audio.breath(true);
    } else if (t < 4.4) {
      this.setLook(...rel(-0.55, 0.06), 0.85);
      if (t > 3.6 && t < 3.65) this.audio.heartbeat(0.8);
    } else if (t < 6.4) {
      // look down at the feet: cracks
      this.setLook(...rel(0.02, -0.95), 1.0);
      this.cueFov = 74;
      if (t > 4.6 && !this.cracks[0].visible) {
        this.cracks.forEach((c, i) => { c.visible = true; });
        this.audio.crack(1.4);
        this.audio.debris(6, 1.2);
      }
      const k = clamp((t - 4.6) / 1.8);
      this.crackMats.forEach((m, i) => { m.opacity = clamp(k * 1.4 - i * 0.15); });
      this.shakeAmt = k * 0.5;
      pos.y -= k * 0.05;
    } else if (t < 8.6) {
      // follow the crack as it runs away, then look up in alarm
      const k = Math.sin((t - 6.4) * 1.6);
      this.setLook(...rel(0.28 + k * 0.25, -0.75), 0.7);
      this.shakeAmt = 0.6;
      if (t > 7.2 && this.debris.length === 0) {
        this.spawnDebris(26);
        this.audio.debris(14, 1.4);
        this.audio.crack(2);
      }
      this.cueFov = 76;
    } else if (t < 10.2) {
      // the ground gives way: a stumble, a grab for balance
      const k = clamp((t - 8.6) / 1.6);
      this.setLook(...rel(-0.15 + k * 0.3, -1.05), 1.2);
      this.shakeAmt = 0.9 + k * 0.5;
      this.hole.visible = true;
      (this.hole.material as THREE.MeshBasicMaterial).opacity = easeIn(k);
      pos.y -= easeIn(k) * 0.55;
      pos.z += easeIn(k) * 0.2;
      this.roll = Math.sin(k * 8) * 0.03 * k;
      if (t > 9.4 && this.tunnelGroup.visible === false) {
        this.tunnelGroup.visible = true;
        this.tunnelUniforms.uIntensity.value = 0.5;
      }
      if (k > 0.2 && k < 0.24) this.audio.crack(2.4);
    } else if (t < 14.0) {
      // falling
      const k = clamp((t - 10.2) / 3.8);
      this.cueFov = 88;
      this.setLook(...rel(Math.sin(k * 2.6) * 0.4, 0.35 + Math.sin(k * 3.1) * 0.3), 1.0);
      this.shakeAmt = 1.2;
      this.tunnelGroup.visible = true;
      this.tunnelGroup.position.copy(this.cam.position);
      this.tunnelGroup.quaternion.copy(this.cam.quaternion);
      this.tunnel.position.z = -6 - k * 26;
      this.tunnelUniforms.uIntensity.value = 0.85;
      pos = this.cam.position.clone();
      pos.y -= 9.4 * dt * (1 + k * 1.5);
      this.engine.fx.uGlitch.value = 0.7 * settings.value.glitch * (1 - k * 0.4);
      this.audio.setFallWindLevel(1.0, 0.9);
      if (k > 0.5 && !this.fallStarted) { this.fallStarted = true; this.onFallStart?.(); }
    } else {
      // hand over to the return sequence
      this.fallStarted = false;
      this.startReturn(true);
    }

    this.cam.position.copy(pos);
    const e = new THREE.Euler(
      clamp(this.lookPitch + Math.sin(this.t * 1.7) * 0.005, -1.5, 1.5),
      this.lookYaw + Math.sin(this.t * 1.1) * 0.004,
      this.roll, 'YXZ',
    );
    this.cam.quaternion.setFromEuler(e);
    // eyes lead: add a decaying extra yaw/pitch
    this.eyeOff.x = damp(this.eyeOff.x, 0, 4.5, dt);
    this.eyeOff.y = damp(this.eyeOff.y, 0, 4.5, dt);
    const eyeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.eyeOff.y, this.eyeOff.x, 0, 'YXZ'));
    this.cam.quaternion.multiply(eyeQ);
    this.cam.fov = damp(this.cam.fov, this.cueFov, 6, dt);
    this.cam.updateProjectionMatrix();
  }
  private fallStarted = false;

  // -------------------------------------------------------------------- fall
  private updateFall(_dt: number) {
    // handled inline in updateCollapse
  }

  // ------------------------------------------------------------------ return
  private updateReturn(dt: number) {
    const t = this.t;
    // continue falling inside the throat, then land in the bedroom
    const landing = new THREE.Vector3(0.12, 0.0, 0.95);
    if (t < 1.4) {
      this.tunnelGroup.visible = true;
      this.tunnelGroup.position.copy(this.cam.position);
      this.tunnelGroup.quaternion.copy(this.cam.quaternion);
      this.tunnel.position.z = -6 - t * 12;
      this.tunnelUniforms.uIntensity.value = 0.8;
      this.cam.position.y -= 7.2 * dt;
      this.engine.fx.uGlitch.value = 0.5 * settings.value.glitch;
      this.shakeAmt = 0.8;
      if (!this.roomSwapped && t > 0.7) {
        this.roomSwapped = true;
        this.world.group.visible = false;
        this.room.group.visible = true;
        this.engine.scene.fog = this.roomFog;
        this.audio.stopWorldAmbience();
        this.audio.startRoomAmbience();
        this.room.setPower(false);
        this.room.setEpilogue(true);
        this.player.teleport(landing.clone().add(new THREE.Vector3(0, 3.4, 0)), 0.06, -0.15);
      }
    } else {
      const k = clamp((t - 1.4) / 0.55);
      const y = lerp(3.4, 0, easeIn(k));
      this.player.feet.set(landing.x, Math.max(0, y), landing.z);
      this.cam.position.set(landing.x, Math.max(0.02, y + 1.62), landing.z);
      this.tunnelGroup.visible = false;
      this.engine.fx.uGlitch.value = (1 - k) * 0.35 * settings.value.glitch;
      this.shakeAmt = 1.2 * (1 - k);
      const pitch = lerp(-0.2, -0.55, k);
      this.cam.quaternion.setFromEuler(new THREE.Euler(pitch, this.baseYaw, Math.sin(k * 5) * 0.02 * (1 - k), 'YXZ'));
      this.cam.fov = lerp(80, 70, easeOut(k));
      this.cam.updateProjectionMatrix();
      if (k >= 1) {
        this.audio.landing();
        this.player.teleport(landing, this.baseYaw, -0.1);
        this.player.addLanding(1.4);
        this.exit();
        this.engine.setBokehEnabled(false);
        this.ui.chapter('CHAPTER III', '帰還 / あなたの部屋', 5000);
        this.onReturned?.();
      }
    }
  }
  private roomSwapped = false;
  private roomFog = new THREE.FogExp2(0x05070c, 0.0);

  reset() {
    this.clearDebris();
    this.active = false;
    this.mode = 'none';
    this.t = 0;
    this.roomSwapped = false;
    this.fallStarted = false;
    this.tunnelGroup.visible = false;
    this.mouth.visible = false;
    this.mouth.scale.setScalar(0.001);
    this.mouthUniforms.uOpen.value = 0;
    this.debris.length = 0;
    // restore room prop transforms
    for (const p of this.suckProps) {
      p.obj.position.copy(p.base);
      p.obj.scale.setScalar(1);
      p.obj.rotation.z = 0;
    }
    this.suckProps = [];
  }

  /** used by the game when the player restarts */
  setWorldFog(fog: THREE.FogExp2) { this.worldFog = fog; }
  get isActive() { return this.active; }
}
