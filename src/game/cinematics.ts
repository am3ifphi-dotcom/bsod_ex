/**
 * 強制カメラ演出(崩壊 → 落下 → 帰還)のタイムライン
 * 「目→頭→体」の順に動く視線、ためらい、焦り、足取りの乱れを再現。
 * 操作不能なのはこの演出中のみ。終了後は必ず操作が復帰する。
 */
import * as THREE from 'three';
import { clamp, lerp, damp, saccade, smoothstep, randRange } from '../core/utils';
import type { AudioEngine } from '../core/audio';
import type { Room } from '../world/room';
import { primeCollapseFragments, type VoidContext, VOID_Y } from '../world/voidWorld';

export type CollapsePhase =
  | 'idle'
  | 'pre'          // 静寂、動けない
  | 'glance'       // 目が左右へ(サッケード)
  | 'lookDown'     // 足元の亀裂
  | 'stepBack'     // 体が後ずさり、亀裂が追う
  | 'panic'        // 早回しの視線、足音が乱れる
  | 'shatter'      // 地面が砕ける
  | 'fall'         // 落下
  | 'dark'         // 深い闇とグリッチの帳
  | 'roomApproach' // 自室が下に現れる
  | 'land'         // 着地
  | 'done';

interface Key {
  t: number;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number;
}

export class CollapseCinematic {
  phase: CollapsePhase = 'idle';
  time = 0;
  /** 出力: 演出中は true(入力無効) */
  active = false;

  private keys: Key[] = [];
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private roll = 0;
  private fov = 72;

  private startPos = new THREE.Vector3();
  private startYaw = 0;
  private crackGroup: THREE.Group | null = null;
  private fragMats: THREE.Matrix4[] = [];
  private fragVels: THREE.Vector3[] = [];
  private stopRumble: (() => void) | null = null;
  private windStarted = false;
  private fell = 0;
  private landY = 0;
  private ceilingHidden = false;
  private stepTimer = 0;
  private shake = 0;

  constructor(
    private room: Room,
    private voidCtx: VoidContext,
    private audio: AudioEngine,
    private camera: THREE.PerspectiveCamera,
    private getShake: () => number,
  ) {}

  /** 発動: プレイヤーの現在位置・向きから開始 */
  start(playerPos: THREE.Vector3, playerYaw: number): void {
    this.active = true;
    this.phase = 'pre';
    this.time = 0;
    this.fell = 0;
    this.startPos.copy(playerPos);
    this.startYaw = playerYaw;
    this.camPos.copy(playerPos).setY(playerPos.y + 1.62);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, playerYaw, 0, 'YXZ'));
    this.camLook.copy(this.camPos).add(dir);
    this.camQuat.setFromEuler(new THREE.Euler(0, playerYaw, 0, 'YXZ'));
    this.fov = 72;
    this.shake = 0;

    // 足元の亀裂(デカール群)
    this.crackGroup = new THREE.Group();
    this.crackGroup.position.copy(playerPos).setY(playerPos.y + 0.02);
    for (let i = 0; i < 3; i++) {
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 2.4),
        new THREE.MeshBasicMaterial({
          map: crackTexture(i),
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      decal.rotation.x = -Math.PI / 2;
      decal.rotation.z = Math.random() * Math.PI;
      decal.position.set(randRange(-0.4, 0.4), 0.004 * i, randRange(-0.4, 0.4));
      this.crackGroup.add(decal);
    }
    this.camera.parent?.add(this.crackGroup) ?? this.crackGroup;
    if (!this.crackGroup.parent) {
      // scene 直下
    }

    this.audio.heartbeat(2);
  }

  setCrackParent(parent: THREE.Object3D): void {
    if (this.crackGroup) parent.add(this.crackGroup);
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  /** 毎フレーム。カメラを直接動かす */
  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    const shakeAmt = this.getShake();

    switch (this.phase) {
      case 'pre': {
        // 静止 → 微かな息づかい
        this.shake = damp(this.shake, 0.02 * shakeAmt, 2, dt);
        if (this.time > 1.1) {
          this.phase = 'glance';
          this.time = 0;
        }
        break;
      }
      case 'glance': {
        // 目線が左右へ素早く走る(サッケード): まず左、停まり、右、停まる
        const t = this.time;
        let yawOff = 0;
        let pitchOff = 0;
        if (t < 0.16) {
          yawOff = -0.72 * saccade(t / 0.16);
        } else if (t < 0.85) {
          yawOff = -0.72 + Math.sin((t - 0.16) * 2.2) * 0.012;
        } else if (t < 1.02) {
          yawOff = lerp(-0.72, 0.88, saccade((t - 0.85) / 0.17));
        } else if (t < 1.8) {
          yawOff = 0.88 + Math.sin((t - 1.02) * 1.9) * 0.014;
          pitchOff = -0.06;
        } else if (t < 2.1) {
          yawOff = lerp(0.88, 0.12, saccade((t - 1.8) / 0.3));
          pitchOff = -0.1;
        } else {
          yawOff = 0.12;
          pitchOff = -0.12;
          if (t > 2.6) {
            this.phase = 'lookDown';
            this.time = 0;
          }
        }
        // 頭部慣性(目→頭)
        this.applyLookOffset(yawOff, pitchOff, dt, 9);
        this.shake = damp(this.shake, 0.035 * shakeAmt, 3, dt);
        break;
      }
      case 'lookDown': {
        // 足元を見下ろし、亀裂が走る
        const t = this.time;
        const p = smoothstep(0, 1.3, t);
        this.applyLookOffset(0.12 * (1 - p), lerp(-0.12, -1.28, p), dt, 5);
        if (this.crackGroup) {
          const grow = smoothstep(0.6, 2.8, t);
          this.crackGroup.children.forEach((c, i) => {
            const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
            m.opacity = clamp(grow * (1 - i * 0.22), 0, 0.92);
            c.scale.setScalar(0.35 + grow * (1.3 + i * 0.5));
          });
        }
        if (t > 0.7 && t < 0.85) this.audio.debrisCrack(0.5);
        if (t > 1.6 && t < 1.75) this.audio.debrisCrack(0.8);
        this.shake = damp(this.shake, 0.05 * shakeAmt, 2, dt);
        if (t > 3.4) {
          this.phase = 'stepBack';
          this.time = 0;
          this.stopRumble = this.audio.collapseRumble(9, 0.55);
        }
        break;
      }
      case 'stepBack': {
        // 体が後ずさり(目線は足元→前→また足元、ためらいあり)
        const t = this.time;
        const p = smoothstep(0, 1.2, t);
        const back = 1.15 * p;
        const dir = new THREE.Vector3(Math.sin(this.startYaw), 0, Math.cos(this.startYaw));
        this.camPos.x = this.startPos.x + dir.x * back;
        this.camPos.z = this.startPos.z + dir.z * back;
        this.camPos.y = this.startPos.y + 1.62 + Math.sin(t * 7) * 0.02 * shakeAmt * p;

        let pitch = -1.28;
        if (t < 0.5) pitch = lerp(-1.28, -0.35, saccade(t / 0.5));
        else if (t < 1.0) pitch = -0.35 + Math.sin((t - 0.5) * 3) * 0.02;
        else if (t < 1.5) pitch = lerp(-0.35, -1.05, saccade((t - 1.0) / 0.5));
        else pitch = -1.05;
        this.applyLookOffset(0, pitch, dt, 6);

        // 足音(乱れ)
        this.stepTimer -= dt;
        if (p > 0.25 && this.stepTimer <= 0) {
          this.audio.footstep('debris', 0.85);
          this.stepTimer = 0.34 + Math.random() * 0.12;
          this.shake = 0.06 * shakeAmt;
        }
        if (this.crackGroup) {
          const spread = smoothstep(0, 2.2, t);
          this.crackGroup.children.forEach((c, i) => {
            const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
            m.opacity = 0.92 * (1 - i * 0.18);
            c.scale.setScalar(1.2 + spread * (1.6 + i * 0.7) - back * 0.15);
          });
          // 亀裂が追いかける
          this.crackGroup.position.x = this.camPos.x + Math.sin(this.startYaw) * 0.25;
          this.crackGroup.position.z = this.camPos.z + Math.cos(this.startYaw) * 0.25;
        }
        if (t > 2.6) {
          this.phase = 'panic';
          this.time = 0;
        }
        break;
      }
      case 'panic': {
        // 視線が左右へ速く、短い。焦りの加速。
        const t = this.time;
        const w = Math.sin(t * 9.2) * 0.55 * (1 - t / 2.2);
        const pitch = lerp(-1.05, -0.28, smoothstep(0, 1.1, t)) + Math.sin(t * 6.1) * 0.04;
        this.applyLookOffset(w, pitch, dt, 14);
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.audio.footstep('debris', 1);
          this.stepTimer = 0.24 + Math.random() * 0.1;
          this.shake = 0.09 * this.getShake();
        }
        if (t > 1.15 && t < 1.3) this.audio.debrisCrack(1);
        this.shake = damp(this.shake, 0.1 * this.getShake(), 4, dt);
        if (t > 2.2) {
          this.phase = 'shatter';
          this.time = 0;
          this.spawnFragments();
          // 足場の床を実際に抜く(穴が開いてそこから落下できる)
          const floorMesh = this.voidCtx.group.getObjectByName('collapseFloor');
          if (floorMesh) floorMesh.visible = false;
          this.stopRumble?.();
          this.stopRumble = this.audio.collapseRumble(12, 1);
        }
        break;
      }
      case 'shatter': {
        // 地面の破片が実際に落下。足場を失う。
        const t = this.time;
        this.updateFragments(dt, t);
        // 視線: 足元の穴
        const pitch = lerp(-1.05, -1.42, smoothstep(0, 0.9, t));
        this.applyLookOffset(0, pitch, dt, 7);
        this.camPos.y = this.startPos.y + 1.62 - smoothstep(0.9, 2.1, t) * 0.55;
        if (Math.random() < dt * 3) this.audio.debrisCrack(0.9);
        if (t > 2.1) {
          this.phase = 'fall';
          this.time = 0;
          this.audio.startFallWind();
          this.windStarted = true;
        }
        break;
      }
      case 'fall': {
        // 重力落下。下向き → 周囲 → 上向き(構造物と光が遠ざかる)
        const t = this.time;
        this.fell = 0.5 * 22 * t * t + t * 6;
        this.camPos.y = this.startPos.y + 1.07 - this.fell;
        this.camPos.x = this.startPos.x + Math.sin(t * 0.7) * 0.6;
        this.camPos.z = this.startPos.z + Math.cos(t * 0.55) * 0.6;
        this.audio.setFallSpeed(clamp(t / 1.4, 0, 1));

        // 視線: 最初は下、2.5s からゆっくり上へ(遠ざかる世界)
        let pitch = -1.42;
        if (t < 2.2) {
          pitch = -1.42 + Math.sin(t * 2.4) * 0.06;
        } else if (t < 5.2) {
          pitch = lerp(-1.42, 0.85, saccade((t - 2.2) / 3.0));
        } else if (t < 6.4) {
          pitch = 0.85 + Math.sin((t - 5.2) * 1.4) * 0.05;
        } else {
          pitch = lerp(0.85, -1.1, saccade((t - 6.4) / 1.6));
        }
        // ロール(体の回転)
        this.roll = Math.sin(t * 0.5) * 0.14 * this.getShake() + Math.sin(t * 1.1) * 0.05;
        this.applyLookOffset(Math.sin(t * 0.8) * 0.12, pitch, dt, 3.2);
        this.shake = 0.07 * this.getShake();
        this.updateFragments(dt, t + 2);
        if (t > 8.2) {
          this.phase = 'dark';
          this.time = 0;
        }
        break;
      }
      case 'dark': {
        // グリッチの帳。ここで自室へ「連続的に」合流する準備
        const t = this.time;
        this.camPos.y -= 26 * dt;
        this.audio.setFallSpeed(1);
        this.applyLookOffset(Math.sin(t * 3) * 0.2, lerp(-1.1, -0.9, t / 1.2), dt, 6);
        this.shake = 0.12 * this.getShake();
        if (t > 1.15) {
          this.rejoinRoom();
          this.phase = 'roomApproach';
          this.time = 0;
        }
        break;
      }
      case 'roomApproach': {
        // 自室が下に現れ、落下の勢いで入っていく
        const t = this.time;
        const y0 = 85;
        const y1 = 1.62;
        // 減速しながら落下
        const p = clamp(t / 3.6, 0, 1);
        const ease = 1 - Math.pow(1 - p, 2.4);
        this.camPos.set(0.2 + Math.sin(t * 0.6) * 0.25, lerp(y0, y1, ease), 0.85 + Math.cos(t * 0.5) * 0.2);
        const pitch = lerp(-1.35, -1.05, smoothstep(0, 2.8, t));
        this.applyLookOffset(0, pitch, dt, 4);
        this.roll = Math.sin(t * 0.9) * 0.05 * (1 - p);
        this.audio.setFallSpeed(1 - p * 0.9);
        this.shake = (0.1 - p * 0.07) * this.getShake();

        // 天井を通過したら戻す
        if (!this.ceilingHidden && this.camPos.y < 2.55) {
          this.ceilingHidden = true;
          this.room.setCeilingVisible(true);
        }
        if (p >= 1) {
          this.phase = 'land';
          this.time = 0;
          this.audio.stopFallWind();
          this.audio.landingThud();
          this.room.setLighting('after');
        }
        break;
      }
      case 'land': {
        const t = this.time;
        // 着地の反動 → 止まる
        const dip = Math.exp(-t * 6) * Math.sin(t * 18) * 0.08;
        this.camPos.set(0.2, 1.62 - dip, 0.85);
        this.applyLookOffset(0, lerp(-1.05, -0.15, smoothstep(0, 1.4, t)), dt, 6);
        this.roll = damp(this.roll, 0, 5, dt);
        this.shake = damp(this.shake, 0, 3, dt);
        if (t > 0.5 && !this.windStarted) {
          /* already stopped */
        }
        if (t > 0.9 && t < 1.0) this.audio.heartbeat(3);
        if (t > 3.0) {
          this.phase = 'done';
          this.active = false;
          this.stopRumble?.();
          this.stopRumble = null;
          this.audio.afterglow();
        }
        break;
      }
      default:
        break;
    }

    // カメラへ反映
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.slerp(this.camQuat, Math.min(1, dt * 10));
    // シェイク
    if (this.shake > 0.001) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.2;
      this.camera.rotateZ(this.roll + (Math.random() - 0.5) * s * 0.06);
    } else {
      this.camera.rotateZ(this.roll);
    }
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, this.fov, 3, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** 視線オフセット: サッケード風に回転目標へ追従 */
  private applyLookOffset(yawOff: number, pitchOff: number, dt: number, lambda: number): void {
    const euler = new THREE.Euler(0, this.startYaw + yawOff, 0, 'YXZ');
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(euler);
    // pitch
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchOff);
    dir.applyQuaternion(pitchQ);
    this.camLook.copy(this.camPos).add(dir.multiplyScalar(4));
    const m = new THREE.Matrix4().lookAt(this.camPos, this.camLook, new THREE.Vector3(0, 1, 0));
    const targetQ = new THREE.Quaternion().setFromRotationMatrix(m);
    this.camQuat.slerp(targetQ, Math.min(1, dt * lambda));
  }

  private spawnFragments(): void {
    this.fragMats = primeCollapseFragments(this.voidCtx, this.startPos);
    this.fragVels = this.fragMats.map(() => new THREE.Vector3(randRange(-1, 1), randRange(-2, -0.2), randRange(-1, 1)));
  }

  private updateFragments(dt: number, t: number): void {
    const frag = (this.voidCtx as unknown as { fragments?: THREE.InstancedMesh }).fragments;
    if (!frag || !frag.visible) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < frag.count; i++) {
      const m = this.fragMats[i];
      if (!m) continue;
      dummy.matrix.copy(m);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      const v = this.fragVels[i];
      dummy.position.addScaledVector(v, dt * (1 + t * 0.6));
      v.y -= 7 * dt;
      dummy.rotation.set(dummy.rotation.x + dt * v.x, dummy.rotation.y + dt * v.y * 0.4, dummy.rotation.z + dt * v.z);
      dummy.updateMatrix();
      frag.setMatrixAt(i, dummy.matrix);
    }
    frag.instanceMatrix.needsUpdate = true;
  }

  /** 深い闇で自室へ合流(自室を真下に、天井を開けて配置) */
  private rejoinRoom(): void {
    const room = this.room;
    room.group.position.set(0, 0, 0);
    room.group.visible = true;
    room.setCeilingVisible(false);
    room.setLighting('after');
    this.landY = 1.62;
  }

  /** 完了後に状態を戻す */
  reset(scene: THREE.Scene): void {
    this.phase = 'idle';
    this.active = false;
    this.room.setCeilingVisible(true);
    if (this.crackGroup) {
      this.crackGroup.parent?.remove(this.crackGroup);
      this.crackGroup = null;
    }
    const frag = (this.voidCtx as unknown as { fragments?: THREE.InstancedMesh }).fragments;
    if (frag) frag.visible = false;
    this.stopRumble?.();
    this.stopRumble = null;
    if (this.windStarted) {
      this.audio.stopFallWind();
      this.windStarted = false;
    }
    void scene;
  }
}

/** 亀裂テクスチャ(モジュールローカルで生成) */
function crackTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(6,10,22,0.95)';
  const rand = (): number => {
    const x = Math.sin(seed * 999 + Math.random() * 555) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 10; i++) {
    let x = 128;
    let y = 128;
    let a = rand() * Math.PI * 2;
    ctx.lineWidth = 1 + rand() * 3.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a) * (12 + rand() * 22);
      y += Math.sin(a) * (12 + rand() * 22);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 110);
  g.addColorStop(0, 'rgba(50, 110, 255, 0.5)');
  g.addColorStop(1, 'rgba(50, 110, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { clamp, lerp, VOID_Y };
