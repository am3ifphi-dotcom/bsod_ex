import * as THREE from 'three';
import { CameraRig } from '../core/cameraRig.js';
import { lerp, smoothstep, keyframe } from '../core/util.js';

// 崩壊 → 落下の強制カメラ演出。終了後は必ず操作を戻す(Game側)
export class CollapseSequence {
  constructor(camera, voidScene, postfx, audio) {
    this.camera = camera;
    this.scene = voidScene;
    this.fx = postfx;
    this.audio = audio;
    this.rig = new CameraRig(camera);
    this.duration = 16.5;
    this.running = false;
    this.onLanded = null;
    this._landed = false;
    this._baseFov = camera.fov;
    this._vy = 0;
    this._fallY = 0;
  }

  start(startPos, yaw, pitch) {
    this.running = true;
    this.t = 0;
    this._landed = false;
    this._vy = 0;
    this._fallY = startPos.y;
    this.baseYaw = yaw;
    this.rig.snap(startPos, yaw, pitch, 0);
    this.scene.beginCollapse();
    this.scene.setCrack(0);
    this.fx.setNow('glitch', 0);
    this.audio.setMood('collapse');
    this.audio.setTension(0.7);
    this.audio.rumble(2.5, 0.25);
  }

  // パニック視線の目標(yaw,pitch)
  _panicLook(t) {
    const b = this.baseYaw;
    const yawKeys = [
      [0.0, 0], [0.7, -0.95], [1.5, 1.15], [2.2, 0.45], [3.0, 0.0],
      [4.2, -0.55], [5.2, 0.5], [6.0, 0.1], [6.8, 0.0],
    ];
    const pitchKeys = [
      [0.0, 0.0], [0.7, 0.08], [1.5, -0.12], [2.2, -0.55], [3.0, -1.05],
      [4.2, -0.85], [5.2, -0.95], [6.0, -0.35], [6.8, -0.7],
    ];
    return {
      yaw: b + keyframe(yawKeys, Math.min(t, 6.8)),
      pitch: keyframe(pitchKeys, Math.min(t, 6.8)),
    };
  }

  update(dt, time) {
    if (!this.running) return;
    this.t += dt;
    const t = this.t;
    const scene = this.scene, fx = this.fx, audio = this.audio;

    if (t < 7.2) {
      // ---------- パニック & 崩壊 ----------
      const look = this._panicLook(t);
      const panic = smoothstep(0, 3, t);
      this.rig.setTarget(undefined, look.yaw, look.pitch, Math.sin(time * 9) * 0.05 * panic);
      // 足元のふらつき
      const stumble = smoothstep(3, 7, t);
      this.rig.targetPos.x = this.rig.pos.x + Math.sin(time * 11) * 0.05 * stumble;
      this.rig.targetPos.z = this.rig.pos.z + Math.cos(time * 9.5) * 0.05 * stumble;
      this.rig.targetPos.y = this._fallY + Math.sin(time * 14) * 0.04 * stumble;
      this.rig.shake = 0.25 + stumble * 0.7;
      this.rig.update(dt, time, 12, 7); // 視点の追従を遅らせ、頭の慣性を出す

      // 亀裂とタイル崩落
      const crack = smoothstep(2.5, 6.5, t);
      scene.setCrack(crack);
      scene.updateTiles(dt, smoothstep(3.2, 7, t) * 1.2);

      if (Math.random() < 0.25) { fx.triggerGlitch(0.3 + crack * 0.5); audio.glitch(0.3 + crack * 0.5); }
      if (Math.random() < 0.06) audio.crack();
      audio.setTension(0.7 + crack * 0.3);

      // 足場喪失の瞬間(ためらい → 落下)
      if (t > 6.0) {
        const gasp = smoothstep(6.0, 6.5, t);
        this.rig.targetPos.y = this._fallY + Math.sin(gasp * Math.PI) * 0.12;
      }
    } else {
      // ---------- 自由落下 ----------
      const ft = t - 7.2;
      this._vy -= 9 * dt; // 重力(シャフト長に合わせて調整)
      this._fallY += this._vy * dt;
      const speed = Math.min(34, -this._vy);
      scene.scrollShaft(speed, dt);
      scene.updateTiles(dt, 1.2);

      // 風と構造物が上方へ遠ざく感覚
      this.rig.targetPos.set(Math.sin(time * 0.7) * 0.6, this._fallY, Math.cos(time * 0.5) * 0.6);
      this.rig.setTarget(undefined,
        this.baseYaw + Math.sin(time * 0.6) * 0.5,
        -0.35 + Math.sin(time * 1.3) * 0.12,
        Math.sin(time * 0.9) * 0.4
      );
      this.rig.shake = 0.35;
      this.rig.update(dt, time, 4, 4);
      this.camera.fov = lerp(this._baseFov, 92, smoothstep(0, 4, ft));
      this.camera.updateProjectionMatrix();
      fx.setTarget('warp', 0.5);
      if (Math.random() < 0.4) fx.triggerGlitch(0.25 + Math.random() * 0.4);
      if (Math.random() < 0.08) audio.glitch(0.5);
      if (ft > 1.2 && Math.random() < 0.05) audio.whoosh(0.8, 0.25);
      audio.setTension(1);
    }

    // 着地(自室へ)
    if (t > this.duration - 0.6 && !this._landed) {
      this._landed = true;
      fx.triggerFlash(1);
      audio.flash();
      if (this.onLanded) this.onLanded();
    }

    if (t >= this.duration) {
      this.running = false;
      this.camera.fov = this._baseFov;
      this.camera.updateProjectionMatrix();
    }
    return this.running;
  }
}
