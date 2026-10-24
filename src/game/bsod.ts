/**
 * BSOD シーケンス: 寄り込み → 連打で崩壊 → 顔/口へ変質 → 1本のカメラで異世界へ
 * 「部屋 → モニター内部 → 異世界」をフェードで繋がず、立体的なトンネルで連続遷移する。
 */
import * as THREE from 'three';
import { clamp, lerp, damp, easeInOutCubic, easeOutCubic, randomGlitchString, makeCanvas, canvasTexture } from '../core/utils';
import type { AudioEngine } from '../core/audio';
import type { Room } from '../world/room';
import { VOID_Y, wastelandHeight, type VoidContext } from '../world/voidWorld';

export type BsodState = 'idle' | 'leaning' | 'clicking' | 'swallowing' | 'arrived';

const LEAN_POSE = {
  pos: new THREE.Vector3(0.72, 1.42, -1.62),
  look: new THREE.Vector3(0.72, 1.3, -2.42),
  roll: -0.055,
  fov: 58,
};

export class BsodSequence {
  state: BsodState = 'idle';
  clicks = 0;
  readonly maxClicks = 7;

  private t = 0;
  private startPos = new THREE.Vector3();
  private startQuat = new THREE.Quaternion();
  private startFov = 72;
  private corruption = 0;
  private faceGrow = 0;
  private swallowT = 0;

  private mouthGroup: THREE.Group | null = null;
  private tunnel: THREE.Mesh | null = null;
  private tunnelRings: THREE.InstancedMesh | null = null;
  private path: THREE.CatmullRomCurve3 | null = null;
  private suctionObjects: { obj: THREE.Object3D; origin: THREE.Vector3; localPos: THREE.Vector3; localRot: THREE.Euler }[] = [];
  private onSwallowDone: (() => void) | null = null;

  constructor(
    private room: Room,
    private voidCtx: VoidContext,
    private audio: AudioEngine,
    private camera: THREE.PerspectiveCamera,
    private scene: THREE.Scene,
  ) {}

  /** 覗き込み開始 */
  beginLean(): void {
    this.state = 'leaning';
    this.t = 0;
    this.startPos.copy(this.camera.position);
    this.startQuat.copy(this.camera.quaternion);
    this.startFov = this.camera.fov;
    this.clicks = 0;
    this.corruption = 0;
    this.faceGrow = 0;
    this.room.updateScreen(0, 0);
  }

  /** モニター上の「:(」をクリック */
  click(): void {
    if (this.state !== 'clicking' && this.state !== 'leaning') return;
    this.state = 'clicking';
    if (this.clicks >= this.maxClicks) return;
    this.clicks++;
    const s = this.clicks;
    this.audio.glitchBlip(s);
    // 段階的崩壊
    this.corruption = clamp(s / (this.maxClicks - 1), 0, 1);
    if (s === 3) {
      this.room.setLighting('dark');
      this.audio.suction(0.2, 0.7);
    }
    if (s === 5) {
      this.faceGrow = 0.45;
      this.audio.suction(0.55, 1);
    }
    if (s === 6) {
      this.faceGrow = 0.75;
      this.audio.suction(0.8, 1);
    }
    if (s >= this.maxClicks) {
      this.faceGrow = 1;
      this.beginSwallow();
    }
    this.room.updateScreen(this.corruption, this.faceGrow);
  }

  /** 口の変質 → 吸い込み → 飛行 */
  private beginSwallow(): void {
    this.state = 'swallowing';
    this.swallowT = 0;
    this.audio.suction(1, 1.2);

    // --- 口(顔の入口) ---
    const mouth = new THREE.Group();
    mouth.position.set(0.72, 1.3, -2.44);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x06122e,
      emissive: 0x2244aa,
      emissiveIntensity: 1.4,
      roughness: 0.35,
      metalness: 0.7,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.2, 12, 40), ringMat);
    mouth.add(ring);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.66, 32), new THREE.MeshBasicMaterial({ color: 0x01040c }));
    inner.position.z = -0.06;
    mouth.add(inner);
    this.scene.add(mouth);
    this.mouthGroup = mouth;

    // --- トンネル(喉): ルームから深く降り、異世界の空へ抜ける ---
    const pts = [
      new THREE.Vector3(0.72, 1.3, -2.42),
      new THREE.Vector3(0.7, 1.15, -4.2),
      new THREE.Vector3(0.55, 0.2, -8),
      new THREE.Vector3(0.3, -12, -13),
      new THREE.Vector3(0.1, -70, -16),
      new THREE.Vector3(0, -220, -13),
      new THREE.Vector3(0, -420, -10),
      new THREE.Vector3(0, VOID_Y + 60, -8),
      new THREE.Vector3(0, VOID_Y + 22, -6),
      new THREE.Vector3(0, wastelandHeight(0, -6) + VOID_Y + 2.4, -6),
    ];
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.4);
    this.path = path;

    const tubeGeo = new THREE.TubeGeometry(path, 160, 2.35, 14, false);
    const tubeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: false,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vPos;
        uniform float uTime, uSpeed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          float scroll = uTime * (0.15 + uSpeed * 2.2);
          float bands = smoothstep(0.45, 0.5, fract(uv.x * 26.0 - scroll)) * smoothstep(0.55, 0.5, fract(uv.x * 26.0 - scroll));
          float cell = hash(floor(uv * vec2(48.0, 160.0)) + floor(uTime * 3.0));
          vec3 base = mix(vec3(0.01, 0.03, 0.10), vec3(0.05, 0.14, 0.42), bands);
          base += vec3(0.10, 0.22, 0.62) * cell * (0.16 + uSpeed * 0.5);
          // 奥行き
          float depth = smoothstep(0.0, 0.65, fract(uv.x * 0.5 + uTime * 0.05));
          base *= 0.55 + 0.7 * depth;
          gl_FragColor = vec4(base, 1.0);
        }
      `,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    this.scene.add(tube);
    this.tunnel = tube;

    // 速度リング
    const ringGeo = new THREE.TorusGeometry(2.2, 0.07, 6, 24);
    const speedRingMat = new THREE.MeshBasicMaterial({ color: 0x6fa0ff, transparent: true, opacity: 0.55 });
    const rings = new THREE.InstancedMesh(ringGeo, speedRingMat, 40);
    this.scene.add(rings);
    this.tunnelRings = rings;

    // 吸い込まれる物体(部屋の小物を記録)
    this.suctionObjects = [];
    const collect = (obj: THREE.Object3D, depth = 0): void => {
      if (depth > 2) return;
      for (const ch of obj.children) {
        const mesh = ch as THREE.Mesh;
        if (mesh.isMesh && (mesh.geometry as THREE.BufferGeometry).attributes?.position) {
          if (Math.random() < 0.4) {
            this.suctionObjects.push({
              obj: mesh,
              origin: mesh.getWorldPosition(new THREE.Vector3()),
              localPos: mesh.position.clone(),
              localRot: mesh.rotation.clone(),
            });
          }
        }
        collect(ch, depth + 1);
      }
    };
    collect(this.room.group);
  }

  setArrivalCallback(fn: () => void): void {
    this.onSwallowDone = fn;
  }

  /** 毎フレーム。カメラを直接操作 */
  update(dt: number, glitchScale: number): void {
    switch (this.state) {
      case 'idle':
        return;

      case 'leaning':
      case 'clicking': {
        this.t += dt;
        const p = easeInOutCubic(clamp(this.t / 1.6, 0, 1));
        // 頭を傾けて覗き込む自然な動き
        const targetPos = LEAN_POSE.pos.clone();
        targetPos.y += Math.sin(this.t * 1.1) * 0.008;
        this.camera.position.lerpVectors(this.startPos, targetPos, p);
        const m = new THREE.Matrix4().lookAt(targetPos, LEAN_POSE.look, new THREE.Vector3(0, 1, 0));
        const targetQ = new THREE.Quaternion().setFromRotationMatrix(m);
        // 顔の傾き(ロール)
        const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), LEAN_POSE.roll * p);
        targetQ.multiply(rollQ);
        this.camera.quaternion.slerp(targetQ, Math.min(1, dt * 4.5));
        this.camera.fov = damp(this.camera.fov, LEAN_POSE.fov, 3, dt);
        this.camera.updateProjectionMatrix();

        // 連打に応じた世界の歪み
        const s = this.clicks;
        if (s >= 2) {
          // 部屋のグリッチ(頂点変形)を段階的に
        }
        this.room.updateScreen(this.corruption, this.faceGrow);
        return;
      }

      case 'swallowing': {
        this.swallowT += dt;
        const t = this.swallowT;
        const path = this.path!;
        // パス進行: ゆっくり → 加速 → 減速
        const total = 6.8;
        const u = clamp(t / total, 0, 1);
        const speedCurve = u < 0.12 ? easeOutCubic(u / 0.12) * 0.1 : u > 0.82 ? 0.1 + easeInOutCubic((u - 0.82) / 0.18) * 0.9 * 0.0 + 0.9 * ((u - 0.82) / 0.18) : 0.1 + (u - 0.12) / 0.7 * 0.9;
        const uu = clamp(speedCurve, 0, 1);
        const pos = path.getPointAt(uu);
        const look = path.getPointAt(clamp(uu + 0.02, 0, 1));
        this.camera.position.copy(pos);
        const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        this.camera.quaternion.slerp(q, Math.min(1, dt * 8));
        // FOV: 口元で一度広がり、飛行中も広め
        const fovT = u < 0.16 ? lerp(58, 86, u / 0.16) : u > 0.82 ? lerp(86, 72, (u - 0.82) / 0.18) : 86 + Math.sin(u * 20) * 1.5;
        this.camera.fov = damp(this.camera.fov, fovT, 4, dt);
        this.camera.updateProjectionMatrix();

        // 口の回転・スケール
        if (this.mouthGroup) {
          const s = clamp(t * 1.4, 0, 1);
          this.mouthGroup.scale.setScalar(0.4 + s * 2.6);
          this.mouthGroup.rotation.z += dt * 0.6 * (1 - u);
          this.mouthGroup.visible = u < 0.22;
        }

        // トンネルの速度表現
        const tubeMat = this.tunnel!.material as THREE.ShaderMaterial;
        tubeMat.uniforms.uTime.value = t;
        tubeMat.uniforms.uSpeed.value = clamp(u * 1.6, 0, 1);

        // 速度リング
        const rings = this.tunnelRings!;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < rings.count; i++) {
          const ringU = ((i / rings.count) + u * 1.35) % 1;
          const p2 = path.getPointAt(ringU);
          const tangent = path.getTangentAt(ringU);
          dummy.position.copy(p2);
          dummy.lookAt(p2.clone().add(tangent));
          const sc = 0.85 + Math.sin(i * 1.7 + t * 3) * 0.12;
          dummy.scale.setScalar(sc);
          dummy.updateMatrix();
          rings.setMatrixAt(i, dummy.matrix);
        }
        rings.instanceMatrix.needsUpdate = true;

        // 部屋の物体の吸い込み(u<0.15 だけ見える)
        if (u < 0.18) {
          const pull = clamp(t / 1.1, 0, 1);
          for (const s2 of this.suctionObjects) {
            if (!s2.obj.parent) continue;
            const target = new THREE.Vector3(0.72, 1.3, -2.42);
            const world = s2.origin.clone().lerp(target, pull * 0.55 * Math.random() * 0.35 + pull * 0.2);
            s2.obj.position.lerp(s2.obj.parent.worldToLocal(world), 0.12);
            s2.obj.rotation.x += dt * pull * (Math.random() - 0.5) * 3;
            s2.obj.rotation.y += dt * pull * (Math.random() - 0.5) * 3;
          }
        }

        // 終了: 異世界の到着地点へ
        if (u >= 1) {
          this.state = 'arrived';
          const ey = wastelandHeight(0, -6) + VOID_Y;
          this.camera.position.set(0, ey + 1.62, -6);
          // 中心構造物(北 = -z)を向く
          this.camera.quaternion.setFromEuler(new THREE.Euler(-0.06, 0, 0, 'YXZ'));
          this.camera.fov = 72;
          this.camera.updateProjectionMatrix();
          // チューブ掃除
          if (this.tunnel) {
            this.scene.remove(this.tunnel);
            this.tunnel.geometry.dispose();
            (this.tunnel.material as THREE.Material).dispose();
            this.tunnel = null;
          }
          if (this.tunnelRings) {
            this.scene.remove(this.tunnelRings);
            this.tunnelRings = null;
          }
          if (this.mouthGroup) {
            this.scene.remove(this.mouthGroup);
            this.mouthGroup = null;
          }
          this.room.group.visible = false;
          this.onSwallowDone?.();
        }
        return;
      }

      case 'arrived':
        return;
    }
  }

  /** クリック判定: マウス位置がモニターの「:(」上か */
  isOverSadFace(mouseX: number, mouseY: number, width: number, height: number): boolean {
    if (this.state !== 'leaning' && this.state !== 'clicking') return false;
    const ndc = new THREE.Vector2((mouseX / width) * 2 - 1, -(mouseY / height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.room.screenMesh, false);
    if (!hit.length) return false;
    const uv = hit[0].uv;
    if (!uv) return false;
    // 画面左上寄りの :(
    if (this.faceGrow <= 0) {
      return uv.x > 0.08 && uv.x < 0.36 && uv.y > 0.3 && uv.y < 0.72;
    }
    return true; // 顔が巨大化したら画面のどこでも
  }

  get corruptionLevel(): number {
    return this.corruption;
  }

  /** 吸い込まれた小物を元の位置へ戻す(リプレイ時の完全初期化) */
  restoreSuction(): void {
    for (const s of this.suctionObjects) {
      if (!s.obj.parent) continue;
      s.obj.position.copy(s.localPos);
      s.obj.rotation.copy(s.localRot);
    }
    this.suctionObjects = [];
  }

  reset(): void {
    this.restoreSuction();
    this.state = 'idle';
    this.clicks = 0;
    this.corruption = 0;
    this.faceGrow = 0;
    this.room.updateScreen(0, 0);
    this.room.group.visible = true;
    if (this.tunnel) {
      this.scene.remove(this.tunnel);
      this.tunnel = null;
    }
    if (this.tunnelRings) {
      this.scene.remove(this.tunnelRings);
      this.tunnelRings = null;
    }
    if (this.mouthGroup) {
      this.scene.remove(this.mouthGroup);
      this.mouthGroup = null;
    }
  }
}

export { randomGlitchString, makeCanvas, canvasTexture };
