import * as THREE from 'three';
import { clamp, ease, wobble, lerp } from './util';

export type Pose = {
  at: number;                     // 秒
  pos?: [number, number, number];
  look?: [number, number, number];
  fov?: number;
  roll?: number;
  ease?: (t: number) => number;
  /** 揺らぎの強さ (0 = 静止) */
  sway?: number;
  focus?: number;                 // 被写界深度のピント距離
  fade?: number;                  // 0..1
};

export type ScriptState = {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number;
  focus: number;
  fade: number;
  finished: boolean;
  time: number;
};

/**
 * 強制カメラ演出用のキーフレーム。
 * 位置と注視点を別々に補間し、さらに「頭の揺らぎ」「ためらい」を合成する。
 */
export class CameraScript {
  poses: Pose[];
  duration: number;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  state: ScriptState;

  constructor(poses: Pose[]) {
    this.poses = [...poses].sort((a, b) => a.at - b.at);
    this.duration = this.poses[this.poses.length - 1]?.at ?? 0;
    const p0 = this.poses[0];
    this.state = {
      pos: new THREE.Vector3(...(p0.pos ?? [0, 1.6, 0])),
      look: new THREE.Vector3(...(p0.look ?? [0, 1.6, -1])),
      fov: p0.fov ?? 62,
      roll: p0.roll ?? 0,
      focus: p0.focus ?? 4,
      fade: p0.fade ?? 1,
      finished: false,
      time: 0,
    };
  }

  update(t: number, seed = 0): ScriptState {
    this.state.time = t;
    const poses = this.poses;
    let i = 0;
    while (i < poses.length - 2 && poses[i + 1].at < t) i++;
    const a = poses[i], b = poses[Math.min(i + 1, poses.length - 1)];
    const span = Math.max(1e-4, b.at - a.at);
    const raw = clamp((t - a.at) / span, 0, 1);
    const e = (b.ease ?? ease.inOut)(raw);

    const ap = new THREE.Vector3(...(a.pos ?? this.toArr(this.state.pos)));
    const bp = new THREE.Vector3(...(b.pos ?? a.pos ?? this.toArr(this.state.pos)));
    this.tmpA.copy(ap).lerp(bp, e);

    const al = new THREE.Vector3(...(a.look ?? this.toArr(this.state.look)));
    const bl = new THREE.Vector3(...(b.look ?? a.look ?? this.toArr(this.state.look)));
    this.tmpB.copy(al).lerp(bl, e);

    // 頭の揺らぎ: 目 → 頭 の順に動くような微小な遅れ
    const sway = lerp(a.sway ?? 0, b.sway ?? 0, e);
    if (sway > 0) {
      const s = t * 1.0;
      this.tmpA.x += wobble(s, seed) * 0.012 * sway;
      this.tmpA.y += wobble(s * 1.3 + 4, seed) * 0.010 * sway;
      this.tmpB.x += wobble(s * 0.7 + 9, seed + 1) * 0.09 * sway;
      this.tmpB.y += wobble(s * 0.9 + 2, seed + 2) * 0.07 * sway;
    }
    this.state.pos.copy(this.tmpA);
    this.state.look.copy(this.tmpB);
    this.state.fov = lerp(a.fov ?? 62, b.fov ?? a.fov ?? 62, e);
    this.state.roll = lerp(a.roll ?? 0, b.roll ?? a.roll ?? 0, e);
    this.state.focus = lerp(a.focus ?? 4, b.focus ?? a.focus ?? 4, e);
    this.state.fade = lerp(a.fade ?? 1, b.fade ?? a.fade ?? 1, e);
    this.state.finished = t >= this.duration;
    return this.state;
  }

  private toArr(v: THREE.Vector3): [number, number, number] { return [v.x, v.y, v.z]; }

  /** カメラに反映 (注視点は up=+Y 前提) */
  apply(camera: THREE.PerspectiveCamera) {
    const s = this.state;
    camera.position.copy(s.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(s.look);
    camera.rotateZ(s.roll);
    if (Math.abs(camera.fov - s.fov) > 0.01) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
  }
}
