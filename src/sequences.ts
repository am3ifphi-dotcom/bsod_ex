import * as THREE from 'three';
import type { Game } from './game';
import { clamp, damp, easeInCubic, easeInOutCubic, easeOutCubic, easeOutExpo, lerp, smoothstep } from './core/util';
import { terrainHeight } from './scenes/world';

export interface Sequence {
  update(dt: number): boolean;
  readonly name: string;
}

const UP = new THREE.Vector3(0, 1, 0);

function lookQuat(eye: THREE.Vector3, target: THREE.Vector3, roll = 0) {
  const m = new THREE.Matrix4().lookAt(eye, target, UP);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  return q;
}

/** a hand-authored "saccade": eyes snap, head follows a beat later */
function saccade(t: number, times: [number, number][], amount: number) {
  let v = 0;
  for (const [start, dur] of times) {
    const k = clamp((t - start) / dur);
    v += (1 - Math.cos(k * Math.PI)) * 0.5;
  }
  return v * amount;
}

function noise1(x: number) {
  return Math.sin(x * 1.7) * 0.5 + Math.sin(x * 3.31 + 1.2) * 0.3 + Math.sin(x * 7.7 + 2.1) * 0.2;
}

/* ========================================================================== */
/*  1. lean into the monitor                                                  */
/* ========================================================================== */
export class ZoomSequence implements Sequence {
  name = 'zoom';
  game: Game;
  t = 0;
  startPos = new THREE.Vector3();
  startQuat = new THREE.Quaternion();
  targetPos = new THREE.Vector3(-0.15, 1.075, -1.24);
  screenPos = new THREE.Vector3(-0.15, 1.05, -2.136);
  targetQuat = new THREE.Quaternion();
  done = false;
  beeped = false;

  constructor(game: Game) {
    this.game = game;
    this.startPos.copy(game.camera.position);
    this.startQuat.copy(game.camera.quaternion);
    this.targetQuat = lookQuat(this.targetPos, this.screenPos);
  }

  update(dt: number) {
    this.game.beginCinematic();
    this.t += dt;
    const t = this.t;
    const k = easeInOutCubic(clamp(t / 1.9));

    // first the eyes find the screen, then the body follows
    const lookK = easeOutCubic(clamp(t / 0.75));
    const moveK = easeInOutCubic(clamp((t - 0.3) / 1.5));
    const q = this.startQuat.clone().slerp(this.targetQuat, Math.max(lookK * 0.35, moveK));
    const p = this.startPos.clone().lerp(this.targetPos, moveK);
    p.y += Math.sin(moveK * Math.PI) * 0.03;
    p.z += Math.sin(t * 0.7) * 0.004;
    // a small head tilt and a breath
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.035 * moveK));
    this.game.camera.position.copy(p);
    this.game.camera.quaternion.copy(q);
    this.game.camera.fov = lerp(70, 58, k);
    this.game.camera.updateProjectionMatrix();

    this.game.fx.setFocus(lerp(3.2, 0.9, moveK), lerp(7, 0.65, moveK), smoothstep(moveK) * 0.85);

    if (t > 0.55 && !this.beeped) {
      this.beeped = true;
      this.game.room.drawScreen('bsod', 0);
      this.game.room.monitorLight.intensity = 9.2;
      this.game.audio.bsodBeep();
      this.game.fx.flash(0.08);
    }
    if (t > 1.9) {
      this.game.enterBsod();
      return true;
    }
    return false;
  }
}

/* ========================================================================== */
/*  2. the screen eats the room and the camera                                */
/* ========================================================================== */
export class AbsorbSequence implements Sequence {
  name = 'absorb';
  game: Game;
  t = 0;
  portal: THREE.Group;
  fragments: { mesh: THREE.Mesh; start: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  startPos = new THREE.Vector3();
  startQuat = new THREE.Quaternion();
  swapped = false;
  worldCamStart = new THREE.Vector3(0, 8.5, 262);
  worldCamEnd = new THREE.Vector3(0, 2.2, 250);
  worldLook = new THREE.Vector3(0, 6, 40);
  endQuat = new THREE.Quaternion();

  constructor(game: Game) {
    this.game = game;
    this.startPos.copy(game.camera.position);
    this.startQuat.copy(game.camera.quaternion);
    const room = game.room;

    // the peeling display becomes a physical mouth
    this.portal = new THREE.Group();
    const faceMat = new THREE.MeshBasicMaterial({
      map: room.screenTexture,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4), faceMat);
    face.name = 'portal-face';
    this.portal.add(face);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, toneMapped: false, transparent: true, opacity: 0.9 });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 10, 48), ringMat);
    mouth.position.z = 0.01;
    mouth.name = 'portal-mouth';
    this.portal.add(mouth);
    for (let i = 0; i < 14; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.1, 4), ringMat);
      const a = (i / 14) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.01);
      tooth.rotation.z = a - Math.PI / 2;
      this.portal.add(tooth);
    }
    this.portal.position.set(-0.15, 1.05, -2.1);
    this.portal.scale.setScalar(1);
    room.group.add(this.portal);

    // room fragments that get pulled into the screen
    const geoms = [new THREE.BoxGeometry(0.08, 0.08, 0.02), new THREE.BoxGeometry(0.15, 0.03, 0.1), new THREE.BoxGeometry(0.04, 0.18, 0.04)];
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0x9fb4d8, toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: 0x3f6bff, toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: 0xe8eeff, toneMapped: false }),
    ];
    for (let i = 0; i < 34; i++) {
      const mesh = new THREE.Mesh(geoms[i % geoms.length], mats[i % mats.length]);
      const p = new THREE.Vector3(
        -3 + Math.random() * 6,
        0.3 + Math.random() * 2.2,
        -2.6 + Math.random() * 4.6,
      );
      mesh.position.copy(p);
      room.group.add(mesh);
      this.fragments.push({ mesh, start: p, spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4) });
    }
    this.endQuat = lookQuat(this.worldCamEnd, this.worldLook);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const g = this.game;
    g.beginCinematic();

    if (!this.swapped) {
      const k = easeInCubic(clamp(t / 1.9));
      // camera creeps, then is pulled
      const target = new THREE.Vector3(-0.15, 1.05, -2.08);
      const p = this.startPos.clone().lerp(target, clamp(t / 2.0) * 0.8 + k * 0.2);
      p.x += noise1(t * 8.1) * 0.01 * t;
      p.y += noise1(t * 7.3 + 5) * 0.008 * t;
      g.camera.position.copy(p);
      const q = this.startQuat.clone().slerp(lookQuat(p, new THREE.Vector3(-0.15, 1.05, -6)), clamp(t / 1.4));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(t * 11) * 0.01 * t));
      g.camera.quaternion.copy(q);
      g.camera.fov = 58 + easeInCubic(clamp(t / 2)) * 32;
      g.camera.updateProjectionMatrix();
      g.fx.setFocus(0.95, 0.7, 0.85);
      g.fx.setLens(Math.min(0.5, t * 0.35));

      // screen and face grow
      const scale = 1 + easeInCubic(clamp(t / 1.8)) * 6.5;
      this.portal.scale.setScalar(scale);
      this.portal.position.z = -2.1 + clamp(t / 2) * 0.22;
      const mouth = this.portal.getObjectByName('portal-mouth') as THREE.Mesh;
      if (mouth) mouth.scale.setScalar(1 + t * 0.6);

      // fragments get sucked in
      for (const f of this.fragments) {
        const kk = clamp((t - 0.3) / 1.6);
        const targetPos = new THREE.Vector3(-0.15, 1.05, -2.05);
        f.mesh.position.copy(f.start).lerp(targetPos, easeInCubic(kk));
        f.mesh.rotation.x += f.spin.x * dt;
        f.mesh.rotation.y += f.spin.y * dt;
        f.mesh.scale.setScalar(1 - kk * 0.85);
      }

      // escalation
      const gl = clamp(t / 1.9);
      g.setGlitch(gl * 0.9, 0.25 + gl * 0.75);
      g.fx.setLens(Math.min(0.5, t * 0.32));
      if (t > 0.4 && !(this as any).riser) {
        (this as any).riser = true;
        g.audio.riser(1.7, 1.0);
        g.audio.whisper(0.06);
      }
      if (t > 1.0 && !(this as any).portalSfx) {
        (this as any).portalSfx = true;
        g.audio.portal();
      }

      if (t > 1.8) {
        this.swapped = true;
        // through the mouth: cut the room, reveal the world behind the same frame
        g.room.group.visible = false;
        g.showWorld();
        g.camera.position.copy(this.worldCamStart);
        g.camera.quaternion.copy(lookQuat(this.worldCamStart, this.worldLook));
        g.camera.fov = 92;
        g.camera.updateProjectionMatrix();
        g.fx.flash(1.0);
        g.fx.setIris(1.9, false);
        g.fx.setLens(0);
        g.audio.impact(1.0);
        g.audio.whoosh(2.2, 1.2);
        g.setGlitch(0.5, 0.8);
        g.audio.startWorldAmbience();
      }
      return false;
    }

    // --- arrival: spat out above the wasteland, fall into the body
    const at = t - 1.8;
    const k = easeOutCubic(clamp(at / 1.15));
    const p = this.worldCamStart.clone().lerp(this.worldCamEnd, k);
    p.x += noise1(at * 2.3) * 0.2 * (1 - k);
    g.camera.position.copy(p);
    const q = lookQuat(p, this.worldLook);
    const wobble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(at * 5.1) * 0.06 * (1 - k));
    g.camera.quaternion.copy(q).multiply(wobble);
    g.camera.fov = lerp(92, 70, easeOutCubic(clamp(at / 1.6)));
    g.camera.updateProjectionMatrix();
    g.setGlitch(0.5 * (1 - clamp(at / 1.4)), 0.8 * (1 - clamp(at / 1.2)));
    g.fx.setFocus(8, 30, 0.35);

    // iris reveal
    g.fx.setIris(lerp(0.02, 1.9, easeOutExpo(clamp(at / 1.2))), at < 1.2);

    if (at > 0.35 && !(this as any).landed) {
      (this as any).landed = true;
      g.audio.impact(0.35);
      g.player.reset(new THREE.Vector3(0, terrainHeight(0, 250), 250), 0.04, -0.04);
    }
    if (at > 2.6) {
      g.fx.setIris(0, false);
      g.endCinematic('world');
      g.ui.chapter('01 — BSOD WORLD');
      g.ui.subtitle('見知らぬ青い荒野。遠くに、白く光る柱が見える。');
      g.audio.startWorldAmbience();
      return true;
    }
    return false;
  }
}

/* ========================================================================== */
/*  3. WAKE_UP — the world notices                                             */
/* ========================================================================== */
export class CollapseSequence implements Sequence {
  name = 'collapse';
  game: Game;
  t: number;
  startPos = new THREE.Vector3();
  baseYaw = 0;
  basePitch = 0;
  hole?: THREE.Mesh;
  holeRim?: THREE.Mesh;
  crackTex: THREE.CanvasTexture;
  debris: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  fragmentsSpawned = false;
  swapped = false;
  roomCeiling?: THREE.Object3D;
  fallVel = 0;
  startY = 0;
  whited = false;
  private cues = new Set<string>();

  constructor(game: Game, startAt = 0) {
    this.game = game;
    this.t = startAt;
    this.startPos.copy(game.camera.position);
    this.baseYaw = game.player.yaw;
    this.basePitch = game.player.pitch;
    this.startY = game.camera.position.y;
    this.crackTex = this.makeCrackTexture();
    this.roomCeiling = (game.room as any).ceiling;
  }

  private cue(key: string) {
    if (this.cues.has(key)) return false;
    this.cues.add(key);
    return true;
  }

  private makeCrackTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(150,190,255,0.75)';
    ctx.lineWidth = 1.1;
    const rnd = Math.random;
    const branch = (x: number, y: number, ang: number, len: number, depth: number) => {
      if (depth <= 0 || len < 4) return;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      ctx.globalAlpha = 0.16 + depth * 0.10;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      branch(nx, ny, ang + (rnd() - 0.5) * 0.9, len * 0.75, depth - 1);
      if (rnd() > 0.35) branch(nx, ny, ang + (rnd() - 0.5) * 1.6, len * 0.6, depth - 1);
    };
    for (let i = 0; i < 16; i++) {
      branch(256, 256, rnd() * Math.PI * 2, 40 + rnd() * 40, 5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const g = this.game;
    g.beginCinematic();

    const yawOff =
      saccade(t, [[0.15, 0.55]], 0.34) - saccade(t, [[0.8, 0.5]], 0.26) + saccade(t, [[1.5, 0.6]], 0.18) - saccade(t, [[2.2, 0.5]], 0.1);
    const pitchOff = -saccade(t, [[1.35, 1.1]], 0.34) - saccade(t, [[2.4, 0.8]], 0.22) + saccade(t, [[4.0, 0.7]], 0.1);
    const breathe = Math.sin(t * 1.7) * 0.01;

    if (t < 1.2) {
      if (this.cue('heart1')) g.audio.heartbeat(0.7);
      if (this.cue('breath1')) g.audio.breath(1.0, 1.1);
      if (this.cue('whisper1')) g.audio.whisper(0.05);
      g.ui.subtitle('……何かが、応答した。', 'SYSTEM');
    }
    if (t > 1.2 && t < 3.0) {
      if (this.cue('heart2')) g.audio.heartbeat(1.0);
      if (this.cue('breath2')) g.audio.breath(1.3, 1.25);
      if (this.cue('crack1')) {
        g.audio.crack(1.0);
        this.addHole();
      }
      if (this.cue('sub2')) g.ui.subtitle('足元が、軋んでいる。');
    }

    // forced camera: root position stays, then stumbles backwards
    let px = this.startPos.x + Math.sin(t * 1.3) * 0.006;
    let pz = this.startPos.z;
    let py = this.startPos.y;
    if (t > 1.9 && t < 3.4) {
      const k = smoothstep(clamp((t - 1.9) / 1.5));
      pz += k * 1.1;
      py -= Math.sin(k * Math.PI) * 0.05;
      if (t > 2.0 && this.cue('step1')) {
        g.audio.footstep('shard', 1.0);
        g.audio.footstep('shard', 0.8);
        g.ui.subtitle('……まずい。');
      }
    }
    if (t > 3.0) {
      // the ground gives way
      const fall = clamp((t - 3.0) / 0.9);
      py -= easeInCubic(fall) * 1.4;
      pz += 0.2 * fall;
      if (this.cue('crack2')) {
        g.audio.crack(1.6);
        g.audio.debris();
        g.audio.riser(1.4, 0.8);
        g.ui.subtitle('足場が、ない。');
        this.spawnFragments();
      }
    }

    // head / eyes
    const lookUp = t > 3.4 ? clamp((t - 3.4) / 1.4) * 0.95 : 0;
    const baseEuler = new THREE.Euler(this.basePitch + pitchOff + lookUp + Math.sin(t * 2.1) * 0.004, this.baseYaw + yawOff, Math.sin(t * 0.8) * 0.01, 'YXZ');
    const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);

    if (t < 3.4) {
      g.camera.position.set(px, py + Math.sin(t * 1.6) * 0.012 + breathe, pz);
      g.camera.quaternion.copy(baseQuat);
      g.camera.fov = 70 + Math.sin(t * 2.0) * 0.6;
      g.camera.updateProjectionMatrix();
      g.fx.setFocus(2.2, 3.2, 0.5);
      g.setGlitch(clamp((t - 1.2) / 2.0) * 0.25, clamp((t - 1.2) / 2.0) * 0.4);
      // the camera looks down at the spreading cracks
      if (this.hole) {
        const s = 1 + easeOutCubic(clamp((t - 2.0) / 1.6)) * 1.5;
        this.hole.scale.setScalar(s);
        const under = (this as any).holeUnder as THREE.Mesh | undefined;
        if (under) under.scale.setScalar(s);
        const hl = (this as any).holeLight as THREE.PointLight | undefined;
        if (hl) hl.intensity = clamp((t - 1.9) / 1.2) * 22;
        (this.hole.material as THREE.MeshBasicMaterial).opacity = clamp((t - 1.9) / 1.2) * 0.95;
        if (this.holeRim) {
          this.holeRim.scale.setScalar(s * 1.02);
          (this.holeRim.material as THREE.MeshBasicMaterial).opacity = clamp((t - 2.0) / 1.2) * 0.6;
        }
      }
      if (t > 2.7) {
        g.ui.subtitle('……落ちる。');
        g.audio.fallWind(0.4);
      }
      return false;
    }

    // ------------------------------------------------------------------ fall
    this.fallVel += (t > 3.4 ? 13 : 0) * dt;
    py -= this.fallVel * dt;
    const fallT = t - 3.4;
    const tumble = Math.sin(fallT * 1.25) * 0.06 + Math.sin(fallT * 3.1) * 0.02;
    const q = baseQuat.clone();
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(fallT * 0.8) * 0.07 - 0.18, Math.sin(fallT * 0.5) * 0.05, tumble, 'YXZ')));
    g.camera.position.set(px + Math.sin(fallT * 0.9) * 0.3, py, pz + Math.cos(fallT * 0.7) * 0.2);
    g.camera.quaternion.copy(q);
    g.camera.fov = 70 + clamp(fallT / 5) * 20;
    g.camera.updateProjectionMatrix();
    g.fx.setFocus(8, 30, 0.3);
    g.setGlitch(0.2 + clamp(fallT / 4) * 0.35, 0.3);
    g.audio.fallWind(1.0);
    g.fx.setIris(0, false);

    if (this.cue('fallstart')) {
      g.ui.subtitle('光が、上へ流れていく。');
      g.audio.whoosh(3.4, 1.4);
      g.audio.riser(3.0, 1.2);
      g.audio.heartbeat(1.2);
    }
    if (this.cue('fallmid') && fallT > 1.4) {
      g.audio.whisper(0.08);
      g.ui.subtitle('街も、柱も、遠くなる。');
    }
    if (this.cue('fallend') && fallT > 3.4) {
      g.audio.whisper(0.05);
    }

    // falling debris around the camera
    for (const d of this.debris) {
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.z += d.spin.z * dt;
    }

    if (fallT > 4.6 && !this.swapped) {
      // masked hand-off: the same downward velocity continues into the room
      this.swapped = true;
      g.showRoom();
      g.room.ceiling.visible = false;
      g.fx.flash(0.9);
      g.audio.impact(0.8);
      g.audio.stopWorldAmbience();
      g.audio.startRoomAmbience();
      g.room.setEpilogue(true);
      g.camera.position.set(0, 26, 0.6);
      const look = new THREE.Vector3(0, 0, -1.6);
      g.camera.quaternion.copy(lookQuat(g.camera.position, look));
      g.camera.fov = 88;
      g.camera.updateProjectionMatrix();
      g.ui.subtitle('');
    }

    if (this.swapped) {
      const rt = fallT - 4.6;
      const fall = easeInCubic(clamp(rt / 0.95));
      const y = lerp(26, 1.62, fall);
      g.camera.position.set(Math.sin(rt * 8) * 0.03 * (1 - fall), y, 0.6 + Math.sin(rt * 0.8) * 0.05);
      const look = new THREE.Vector3(0, Math.max(0.2, y - 3), -2.2);
      g.camera.quaternion.copy(lookQuat(g.camera.position, look));
      g.camera.fov = lerp(88, 74, fall);
      g.camera.updateProjectionMatrix();
      g.setGlitch(0.15 * (1 - fall), 0.2);
      if (rt > 0.9 && !this.whited) {
        this.whited = true;
        g.fx.flash(1.2);
        g.audio.impact(1.4);
        g.room.ceiling.visible = true;
        g.audio.breath(1.6, 0.9);
        g.audio.heartbeat(1.4);
      }
      if (rt > 1.1) {
        // get up from the floor: hands → head → standing height
        const stand = easeOutCubic(clamp((rt - 1.1) / 1.6));
        g.camera.position.set(0.02, lerp(1.05, 1.62, stand), 0.85 - stand * 0.15);
        g.camera.quaternion.copy(lookQuat(g.camera.position, new THREE.Vector3(-0.15, 1.05, -2.2)));
        g.camera.fov = lerp(74, 70, stand);
        g.camera.updateProjectionMatrix();
        g.fx.setFocus(lerp(1.2, 3.4, stand), lerp(2.2, 8, stand), 0.55 * (1 - stand * 0.5));
        g.ui.subtitle('……戻ってきた。', '03:33');
      }
      if (rt > 2.9) {
        g.player.reset(new THREE.Vector3(0, 0, 1.65), 0.02, -0.05);
        g.fx.setFocus(3.4, 9, 0.35);
        g.setPhase('epilogue');
        g.endCinematic('epilogue');
        g.ui.chapter('03 — 03:33');
        g.ui.subtitle('時計が、止まっている。');
        g.audio.stopWorldAmbience();
        g.audio.startRoomAmbience();
        g.audio.chime(660, 0.04);
        return true;
      }
      return false;
    }
    return false;
  }

  private addHole() {
    const g = this.game;
    const y = terrainHeight(this.startPos.x, this.startPos.z) + 0.03;
    const mat = new THREE.MeshBasicMaterial({ color: 0x010205, transparent: true, opacity: 0, depthWrite: false });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), mat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(this.startPos.x, y, this.startPos.z - 0.2);
    this.game.world.dynamicGroup.add(hole);
    this.hole = hole;

    const rimMat = new THREE.MeshBasicMaterial({ color: 0x6fa1ff, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.32, 48), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.copy(hole.position).add(new THREE.Vector3(0, 0.01, 0));
    this.game.world.dynamicGroup.add(rim);
    this.holeRim = rim;
    // faint under-lighting so the fissure reads as depth, not as a flat black disc
    const holeLight = new THREE.PointLight(0x4f86ff, 0, 14, 2);
    holeLight.position.copy(hole.position).add(new THREE.Vector3(0, 0.35, 0));
    this.game.world.dynamicGroup.add(holeLight);
    (this as any).holeLight = holeLight;
    const under = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 40),
      new THREE.MeshBasicMaterial({ color: 0x0a1730, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.copy(hole.position).add(new THREE.Vector3(0, -0.02, 0));
    this.game.world.dynamicGroup.add(under);
    (this as any).holeUnder = under;

    // crack decal
    const crackMat = new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const crackMat2 = crackMat.clone();
    (crackMat2 as THREE.MeshBasicMaterial).map = this.crackTex;
    (crackMat2 as THREE.MeshBasicMaterial).opacity = 0.85;
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), crackMat2);
    crack.rotation.x = -Math.PI / 2;
    crack.position.copy(hole.position).add(new THREE.Vector3(0, 0.005, 0));
    this.game.world.dynamicGroup.add(crack);
  }

  private spawnFragments() {
    if (this.fragmentsSpawned) return;
    this.fragmentsSpawned = true;
    const g = this.game;
    const rnd = Math.random;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.8, metalness: 0.2, emissive: 0x0a1734, emissiveIntensity: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      const a = rnd() * Math.PI * 2;
      const r = 1.6 + rnd() * 4.4;
      mesh.position.set(this.startPos.x + Math.cos(a) * r, terrainHeight(this.startPos.x, this.startPos.z) + 0.2 + rnd() * 0.4, this.startPos.z - 0.2 + Math.sin(a) * r);
      const s = 0.16 + rnd() * 0.45;
      mesh.scale.set(s, 0.08 + rnd() * 0.14, s);
      mesh.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      g.world.dynamicGroup.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * 0.4, 0.4 + rnd() * 1.2, Math.sin(a) * 0.4), spin: new THREE.Vector3(rnd() * 2, 0, rnd() * 2) });
    }
  }
}
