// cinematics.js — devour transition, collapse, fall, landing.
// Everything is first-person camera choreography with head inertia:
// layered sway noise + spring-lagged gaze + authored keyframes.
import * as THREE from 'three';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function keyframes(list, t) {
  // list: [[time, value], ...] smoothstep between entries
  if (t <= list[0][0]) return list[0][1];
  for (let i = 0; i < list.length - 1; i++) {
    const [t0, v0] = list[i], [t1, v1] = list[i + 1];
    if (t >= t0 && t <= t1) return lerp(v0, v1, smooth(t0, t1, t));
  }
  return list[list.length - 1][1];
}

function sway(t, ax, ay) {
  return {
    yaw: Math.sin(t * 0.9) * ax + Math.sin(t * 2.13 + 1.7) * ax * 0.45,
    pitch: Math.sin(t * 1.21 + 0.4) * ay + Math.sin(t * 2.7) * ay * 0.35,
  };
}

export class Cinematics {
  constructor({ controls, fx, audio, bsod }) {
    this.controls = controls;
    this.fx = fx;
    this.audio = audio;
    this.bsod = bsod;
    this.active = null;       // current sequence name
    this.t = 0;
    this.ctx = {};
    this._snapYaw = 0; this._snapPitch = 0;
    this._fallY = 0;
    this._flashDiv = document.getElementById('flash');
  }

  get busy() { return !!this.active; }

  flash(op, decay = 3) {
    this._flashDiv.style.opacity = String(op);
    this._flashDiv.style.transition = `opacity ${decay}s ease-out`;
    requestAnimationFrame(() => { this._flashDiv.style.opacity = '0'; });
  }

  // =====================================================================
  //  DEVOUR — pulled into the monitor
  // =====================================================================
  startDevour(room, world, onSwitchScene, onDone) {
    this.active = 'devour';
    this.t = 0;
    const cam = this.controls.camera;
    this.ctx = {
      room, world, onSwitchScene, onDone,
      startPos: cam.position.clone(),
      screenWorld: room.screenWorld.clone(),
      screenNormal: room.screenNormal.clone(),
      switched: false,
    };
    this.controls.enabled = false;
    this.audio.play('charge', { vol: 0.65, bus: 'sfx' });
    this.audio.play('static', { vol: 0.35, bus: 'sfx' });
  }

  _updateDevour(dt) {
    const c = this.ctx;
    const t = this.t;
    const cam = this.controls.camera;
    const ctl = this.controls;

    // ----- scene switch inside the flash (continuity: swallowed by the screen)
    if (!c.switched && t >= 5.02) {
      c.switched = true;
      this.flash(0.85, 1.4);
      c.onSwitchScene('world');
      // callback placed us at the world spawn
      c.worldEntryPos = ctl.position.clone();
      c.worldEntryYaw = ctl.yaw;
      c.worldEntryPitch = ctl.pitch;
      this.audio.stopLoops(1.2);
    }

    if (!c.switched) {
      // ----- camera path: hesitation, then irreversible pull
      const P = keyframes([
        [0.0, 0.0], [1.15, 0.035], [1.45, 0.028], [2.15, 0.10], [2.6, 0.16],
        [3.3, 0.42], [4.1, 0.72], [4.75, 0.95], [5.05, 1.06],
      ], t);
      const dist0 = c.startPos.distanceTo(c.screenWorld);
      const dir = new THREE.Vector3().subVectors(c.screenWorld, c.startPos).normalize();
      const pos = c.startPos.clone().addScaledVector(dir, dist0 * P);
      // subtle resistance wobble on the way in
      const wob = sway(t * 1.7, 0.012 + 0.02 * (1 - P), 0.010 + 0.02 * (1 - P));
      cam.position.copy(pos);

      // aim at the mouth
      const aim = new THREE.Vector3().subVectors(c.screenWorld, cam.position);
      const yaw = Math.atan2(-aim.x, -aim.z);
      const pitch = Math.atan2(aim.y, Math.sqrt(aim.x * aim.x + aim.z * aim.z));
      ctl.yaw = yaw + wob.yaw * 2.4;
      ctl.pitch = pitch + wob.pitch * 2.4;
      ctl.roll = Math.sin(t * 2.1) * 0.02 + (t > 4.4 ? (t - 4.4) * 0.02 : 0);
      ctl.fov = keyframes([[0, 68], [2.4, 62], [3.4, 48], [4.4, 34], [5.05, 28]], t);

      // ----- fx
      const glitch = keyframes([[0, 0.02], [1.1, 0.16], [1.8, 0.38], [2.6, 0.52], [4.2, 0.62], [5.0, 0.35]], t);
      const pull = keyframes([[0, 0], [2.4, 0.05], [3.1, 0.32], [4.2, 0.9], [5.05, 1.45]], t);
      const blue = keyframes([[0, 0], [3.4, 0.12], [4.4, 0.55], [5.0, 0.95], [5.3, 1]], t);
      const noise = keyframes([[0, 0.04], [1.2, 0.14], [2.6, 0.3], [4.2, 0.42], [5.05, 0.12]], t);
      const tear = keyframes([[0, 0], [1.4, 0.18], [2.6, 0.5], [4.2, 0.65], [5.0, 0.25]], t);
      this.fx.set({
        uGlitch: glitch, uPull: pull, uBlue: blue, uNoise: noise, uTear: tear,
        uChroma: 0.18 + glitch * 0.75, uScan: 0.22 + glitch * 0.35, uVignette: 0.62 + P * 0.3,
      });
      // suction centred on the screen
      const sp = c.screenWorld.clone().project(cam);
      this.fx.uniforms.uCenter.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);

      // ----- room reacts
      c.room.monLight.intensity = 2.0 + Math.sin(t * 21) * 1.4 * glitch + P * 8;
      if (t < 3.2) {
        const fl = 1 - Math.random() * glitch * 1.15;
        c.room.lampFlicker = Math.max(0.06, fl);
      } else {
        c.room.lampFlicker = Math.max(0, 1 - (t - 3.2) * 1.4);
      }

      // ----- audio beats
      if (t > 1.05 && t < 1.25) this.audio.play('sparks1', { vol: 0.5, bus: 'sfx' });
      if (t > 1.9 && t < 2.1) this.audio.play('timeparadox', { vol: 0.85, bus: 'sfx' });
      if (t > 2.55 && t < 2.75) {
        this.audio.play('rend', { vol: 0.95, bus: 'sfx' });
        this.audio.play('portal_open2', { vol: 0.8, bus: 'sfx' });
      }
      if (t > 3.4 && t < 3.6) this.audio.play('narsie', { vol: 0.75, bus: 'music' });
      if (t > 4.55 && t < 4.75) this.audio.play('portal_travel', { vol: 0.9, bus: 'sfx' });
    } else {
      // ----- inside the world now: settle with a soft drop, wake up on the plain
      const st = t - 5.02;
      const base = c.worldEntryPos;
      ctl.position.set(base.x, base.y + Math.sin(st * 2.4) * 0.03 - (1 - smooth(5.02, 6.3, t)) * 0.12, base.z);
      ctl.yaw = c.worldEntryYaw + Math.sin(st * 0.85) * 0.05;
      ctl.pitch = keyframes([[5.02, (c.worldEntryPitch || 0) - 0.16], [6.1, -0.02], [6.6, 0.0]], t);
      ctl.roll = Math.sin(st * 1.3) * 0.03 * (1 - st / 1.8);
      ctl.fov = keyframes([[5.02, 28], [5.7, 52], [6.6, 68]], t);
      const fade = smooth(5.05, 6.35, t);
      this.fx.set({
        uBlue: 1 - fade,
        uFlash: Math.max(0, 0.55 - st * 1.1),
        uGlitch: (1 - fade) * 0.35,
        uPull: (1 - fade) * 0.9,
        uChroma: (1 - fade) * 0.5,
        uNoise: (1 - fade) * 0.3,
        uTear: (1 - fade) * 0.3,
        uScan: 0.22,
        uVignette: 0.62,
      });
      this.fx.uniforms.uCenter.value.set(0.5, 0.5);
    }

    if (t >= 6.6) {
      this.active = null;
      this.fx.reset();
      c.onDone();
    }
  }

  // =====================================================================
  //  COLLAPSE — WAKE_UP sequence, fall, and landing
  // =====================================================================
  startCollapse(world, room, screenTex, onSwitchScene, onDone) {
    this.active = 'collapse';
    this.t = 0;
    const cam = this.controls.camera;
    const p = this.controls.position;
    world.buildCracks(p.x, p.z);
    world.buildChunks(p.x, p.z);

    // the blue screen far below — the way home
    const below = new THREE.Mesh(
      new THREE.PlaneGeometry(52, 29),
      new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, fog: false })
    );
    below.rotation.x = -Math.PI / 2;
    below.position.set(p.x, p.y - 93, p.z);
    world.scene.add(below);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(76, 42),
      new THREE.MeshBasicMaterial({
        color: 0x2f8fff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(p.x, p.y - 93.4, p.z);
    world.scene.add(glow);

    this.ctx = {
      world, room, onSwitchScene, onDone, below, glow,
      startYaw: this.controls.yaw, startPitch: this.controls.pitch,
      baseY: p.y, fallStartY: p.y, switched: false, landed: false,
      landPos: new THREE.Vector3(1.72, 1.10, -0.42),
    };
    this.controls.enabled = false;
    this.audio.stopLoops(1.2);
    this.audio.play('empulse', { vol: 0.85, bus: 'sfx' });
  }

  _updateCollapse(dt) {
    const c = this.ctx;
    const t = this.t;
    const cam = this.controls.camera;
    const ctl = this.controls;

    // ============ phase 1-2: instinctive look-around (0 – 3.4s)
    if (t < 3.4) {
      const ky = keyframes([
        [0, 0], [0.55, 0], [0.78, -0.85], [1.25, -0.95], [1.62, 1.15], [2.05, 1.25],
        [2.45, -0.35], [2.85, -0.3], [3.4, 0],
      ], t);
      const kp = keyframes([
        [0, 0], [0.55, -0.04], [1.25, -0.10], [2.05, -0.16], [2.45, 0.06], [3.4, -0.02],
      ], t);
      const s = sway(t * 2.1, 0.045, 0.035);
      ctl.yaw = c.startYaw + ky + s.yaw;
      ctl.pitch = c.startPitch + kp + s.pitch;
      ctl.roll = Math.sin(t * 1.4) * 0.012;
      ctl.fov = 68 + Math.sin(t * 1.1) * 1.5;
      ctl.position.y = c.baseY + Math.sin(t * 8.5) * 0.008;

      if (t > 0.4 && t < 0.6) this.audio.play('creepalert', { vol: 0.55, bus: 'music' });
      if (t > 1.5 && t < 1.7) this.audio.play('alert', { vol: 0.4, bus: 'sfx' });
      if (t > 2.3 && t < 2.5) this.audio.play('rumble_far1', { vol: 0.7, bus: 'sfx' });
    }
    // ============ phase 3: gaze to the ground, cracks (3.4 – 5.6s)
    else if (t < 5.6) {
      const kp = keyframes([[3.4, -0.02], [4.1, -0.55], [4.7, -1.12], [5.6, -1.22]], t);
      const s = sway(t * 1.6, 0.035, 0.02);
      ctl.yaw = c.startYaw + Math.sin(t * 0.7) * 0.12 + s.yaw;
      ctl.pitch = c.startPitch + kp + s.pitch;
      ctl.roll = Math.sin(t * 1.1) * 0.02;
      c.world.crackLines.visible = true;
      c.world.crackLines.material.opacity = smooth(3.7, 5.4, t);
      if (t > 3.5 && t < 3.7) this.audio.play('gateway', { vol: 0.95, bus: 'sfx' });
      if (t > 4.2 && t < 4.4) this.audio.play('glassknock', { vol: 0.7, bus: 'sfx' });
      if (t > 4.9 && t < 5.1) {
        this.audio.play('rumble', { vol: 0.85, bus: 'sfx' });
        this.audio.play('siren', { vol: 0.32, bus: 'sfx' });
      }
    }
    // ============ phase 4: the floor dies (5.6 – 8.2s)
    else if (t < 8.2) {
      const s = sway(t * 2.6, 0.05, 0.03);
      ctl.yaw = c.startYaw + Math.sin(t * 1.3) * 0.22 + s.yaw;
      ctl.pitch = c.startPitch + keyframes([[5.6, -1.22], [7.4, -1.28], [8.2, -0.62]], t) + s.pitch;
      const jolt = Math.sin(t * 31) * smooth(6.0, 6.5, t) * (1 - smooth(7.6, 8.2, t));
      ctl.position.y = c.baseY + jolt * 0.05 - smooth(7.2, 8.2, t) * 0.55;
      ctl.roll = Math.sin(t * 2.2) * 0.04 + (t > 7.6 ? (t - 7.6) * 0.12 : 0);
      if (t > 5.8 && t < 6.0) this.audio.play('glassbr1', { vol: 0.8, bus: 'sfx' });
      if (t > 6.5 && t < 6.7) this.audio.play('explosioncreak', { vol: 0.85, bus: 'sfx' });
      if (t > 7.1 && t < 7.3) this.audio.play('glassbr2', { vol: 0.85, bus: 'sfx' });
      if (t > 7.7 && t < 7.9) {
        this.audio.play('glassbr3', { vol: 0.9, bus: 'sfx' });
        this.audio.play('explosion_distant', { vol: 0.8, bus: 'sfx' });
      }
    }
    // ============ phase 5: the fall (8.2 – 14.1s)
    else if (t < 14.1) {
      const ft = t - 8.2;                       // 0..5.9
      const fallDur = 5.9;
      const k = ft / fallDur;
      // gravity-ish easing
      const drop = (k * k) * 88;
      ctl.position.y = c.baseY - 0.55 - drop;
      // head: recoil up, then watch the world go away
      const kp = keyframes([
        [8.2, -0.62], [9.0, 0.42], [10.6, 0.58], [12.4, 0.18], [13.3, -0.45], [14.1, -0.85],
      ], t);
      const s = sway(t * 1.15, 0.10, 0.06);
      ctl.yaw = c.startYaw + Math.sin(ft * 0.8) * 0.35 + s.yaw;
      ctl.pitch = kp + s.pitch;
      ctl.roll = Math.sin(ft * 1.15) * 0.16 + Math.sin(ft * 0.4) * 0.08;
      ctl.fov = keyframes([[8.2, 68], [9.6, 88], [12.5, 93], [14.1, 84]], t);
      if (t > 8.2 && t < 8.45) {
        this.audio.loop('wind', { vol: 0.75, fade: 0.6, bus: 'sfx' });
        this.audio.play('meteorimpact', { vol: 0.7, bus: 'sfx' });
      }
      if (t > 12.6 && t < 12.8) this.audio.play('veryfar_noise', { vol: 0.8, bus: 'sfx' });
    }
    // ============ phase 6-7: impact & landing in the room (14.1s+)
    else {
      if (!c.switched) {
        c.switched = true;
        this.flash(1.0, 1.1);
        this.audio.stopLoops(1.0);
        c.onSwitchScene('room');
        ctl.position.copy(c.landPos);
        // looking at the monitor from just outside it
        const aim = new THREE.Vector3().subVectors(c.room.screenWorld, ctl.position);
        c.landYaw = Math.atan2(-aim.x, -aim.z);
        ctl.yaw = c.landYaw;
        ctl.pitch = 0.32;
        ctl.fov = 84;
        this.audio.play('portal_close', { vol: 0.85, bus: 'sfx' });
        this.audio.play('bodyfall1', { vol: 0.85, bus: 'sfx' });
      }
      const lt = t - 14.1;                      // 0..2.4
      // momentum: sweep back to the standing spot with a stumble
      const P = keyframes([[0, 0], [0.22, 0.55], [0.5, 0.86], [0.85, 1.0]], lt);
      const target = this.ctx.room.spawn.pos;
      ctl.position.lerpVectors(c.landPos, target, P);
      ctl.position.y = keyframes([
        [0, 1.10], [0.22, 1.30], [0.5, 1.42], [0.75, 1.50], [1.0, 1.545], [1.45, 1.62],
      ], lt) + Math.sin(lt * 9) * 0.02 * (1 - lt / 1.6);
      // startled look-around, then settle
      const ky = keyframes([[0, 0], [0.45, 1.55], [0.95, 1.75], [1.5, -0.5], [2.0, -0.12], [2.4, 0]], lt);
      const kp = keyframes([[0, 0.32], [0.5, 0.12], [1.1, -0.12], [1.8, -0.05], [2.4, -0.03]], lt);
      ctl.yaw = (c.landYaw || 0) + ky + Math.sin(lt * 12) * 0.012 * (1 - lt);
      ctl.pitch = kp + Math.sin(lt * 10.5) * 0.012 * (1 - lt);
      ctl.roll = Math.sin(lt * 7) * 0.05 * (1 - lt / 1.2);
      ctl.fov = keyframes([[0, 84], [0.8, 72], [1.8, 68]], lt);
      if (lt > 0.9 && lt < 1.1) this.audio.play('chime', { vol: 0.4, bus: 'sfx' });
      if (lt > 1.6) {
        this.active = null;
        ctl.roll = 0;
        ctl.fov = 68;
        c.onDone();
      }
    }

    // shared fx for the collapse
    const glitch = keyframes([[0, 0.05], [3.4, 0.15], [5.6, 0.35], [8.2, 0.55], [11, 0.3], [14.1, 0.6]], t);
    this.fx.set({
      uGlitch: glitch,
      uChroma: 0.12 + glitch * 0.6,
      uScan: 0.16 + glitch * 0.3,
      uNoise: keyframes([[0, 0.02], [8.2, 0.1], [12, 0.22], [14.1, 0.5]], t),
      uVignette: keyframes([[0, 0.55], [8.2, 0.62], [12, 0.72], [14.1, 0.8]], t),
      uTear: glitch * 0.5,
      uBlue: 0,
    });
  }

  // =====================================================================
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.active === 'devour') this._updateDevour(dt);
    else if (this.active === 'collapse') this._updateCollapse(dt);
  }
}
