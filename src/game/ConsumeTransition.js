import * as THREE from 'three';
import { CameraRig } from '../core/cameraRig.js';
import { clamp, lerp, smoothstep, easeInQuad, easeInCubic } from '../core/util.js';

// 「部屋 → モニター内部 → 異世界」をつなぐ捕食遷移
export class ConsumeTransition {
  constructor(camera, bedroom, postfx, audio) {
    this.camera = camera;
    this.room = bedroom;
    this.fx = postfx;
    this.audio = audio;
    this.rig = new CameraRig(camera);
    this.duration = 7.0;
    this.t = 0;
    this.running = false;
    this.onEnterVoid = null;
    this._entered = false;
    this._baseFov = camera.fov;
    this._tmp = new THREE.Vector3();
  }

  start() {
    this.running = true;
    this.t = 0;
    this._entered = false;
    this._swallowed = false;
    const pose = this.room.getInspectPose();
    this.rig.snap(pose.pos, Math.atan2(-(pose.lookAt.x - pose.pos.x), -(pose.lookAt.z - pose.pos.z)), 0, 0);
    this.startPos = pose.pos.clone();
    this.anchor = pose.lookAt.clone();
    this.room.portal.visible = true;
    this.room.portal.scale.setScalar(0.01);
    this.room.setErosion(0);
    this.room.lampSpot.intensity = 26;
    this.room.ceilingLight.intensity = 0;
    this.room.monitorHolder.visible = true;
    const fm = this.room.portal.userData.faceMat;
    fm.uniforms.uOpen.value = 0;
    fm.uniforms.uCorruption.value = 0;
    fm.uniforms.uGlitch.value = 0;
    this.fx.setNow('corruption', 0);
    this.fx.setNow('warp', 0);
    this.fx.setNow('glitch', 0);
    this.audio.setMood('transition');
    this.audio.setTension(0.15);
    this.audio.rumble(3, 0.12);
  }

  update(dt, time) {
    if (!this.running) return;
    this.t += dt;
    const t = this.t / this.duration;
    const room = this.room, fx = this.fx, audio = this.audio;

    // ---- カメラ前進(ためらい → 吸引 → 突入) ----
    const approach = easeInCubic(clamp((t - 0.12) / 0.78, 0, 1));
    const hesitate = Math.sin(clamp(t / 0.14, 0, 1) * Math.PI) * 0.09 * (1 - smoothstep(0.1, 0.3, t));
    const target = this._tmp.lerpVectors(this.startPos, this.anchor, approach);
    target.x -= hesitate;
    target.y += Math.sin(time * 8) * 0.012 * (1 - approach) + hesitate * 0.3;
    this.rig.setTarget(target, undefined, undefined, undefined);
    // 頭の慣性: 進入が速まるほど遅れて振られる
    const flinch = smoothstep(0.25, 0.7, t) * 0.12;
    this.rig.setTarget(undefined,
      -Math.PI / 2 + Math.sin(time * 5.3) * flinch * 0.5 + Math.sin(time * 13.7) * flinch * 0.25,
      Math.sin(time * 4.1) * flinch * 0.4,
      Math.sin(time * 6.7) * flinch * 0.5
    );
    this.rig.shake = smoothstep(0.3, 0.95, t) * 1.1;
    this.rig.update(dt, time, lerp(6, 22, approach), lerp(8, 26, approach));
    this.camera.fov = lerp(this._baseFov, 88, smoothstep(0.35, 0.95, t));
    this.camera.updateProjectionMatrix();

    // ---- ポータル/顔の変質 ----
    const portal = room.portal;
    const faceMat = portal.userData.faceMat;
    const open = smoothstep(0.18, 0.75, t);
    faceMat.uniforms.uOpen.value = open;
    faceMat.uniforms.uCorruption.value = smoothstep(0.1, 0.9, t);
    faceMat.uniforms.uGlitch.value = smoothstep(0.2, 1, t);
    faceMat.uniforms.uTime.value = time;
    const portalScale = lerp(0.16, 5.2, easeInQuad(smoothstep(0.16, 0.92, t)));
    portal.scale.setScalar(portalScale);
    portal.userData.rim.material.opacity = 1;
    const disc = portal.userData.darkDisc;
    disc.material.opacity = lerp(0.2, 0.98, smoothstep(0.2, 0.7, t));

    // ---- 部屋の侵食 ----
    const erode = smoothstep(0.28, 0.85, t);
    room.setErosion(erode);
    room.bsod.setCorruption(smoothstep(0.05, 0.8, t));
    room.setMonitorTarget(lerp(9, 46, erode));
    room.lampSpot.intensity = lerp(26, 0, smoothstep(0.2, 0.6, t));
    if (Math.random() < 0.05 && t > 0.3) room.flashCeiling(time, 0.05, 12);

    // ---- ポストエフェクト ----
    fx.setTarget('corruption', smoothstep(0.35, 0.98, t) * 0.98);
    fx.setTarget('warp', erode * 0.9);
    if (Math.random() < lerp(0.02, 0.5, smoothstep(0.2, 0.9, t))) {
      fx.triggerGlitch(lerp(0.15, 0.9, t));
      audio.glitch(lerp(0.2, 1, t));
    }
    audio.setTension(smoothstep(0.1, 0.85, t));

    // ---- クライマックス: 飲み込み ----
    if (t > 0.6 && !this._swallowed) {
      this._swallowed = true;
      audio.swallow();
      audio.whoosh(1.4, 0.6);
      this.rig.addShake(1.2);
    }
    if (t > 0.82 && !this._entered) {
      this._entered = true;
      this.room.monitorHolder.visible = false;
      fx.triggerFlash(1);
      if (this.onEnterVoid) this.onEnterVoid();
      // 異世界側の演出にカメラを引き渡して終了
      this.running = false;
      this.camera.fov = this._baseFov;
      this.camera.updateProjectionMatrix();
      return false;
    }

    if (t >= 1) {
      this.running = false;
      this.camera.fov = this._baseFov;
      this.camera.updateProjectionMatrix();
    }
    return this.running;
  }
}
