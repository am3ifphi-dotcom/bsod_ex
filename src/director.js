/**
 * カメラ演出。ショット（位置・注視点・画角）へゆっくり寄せる。
 * 自由視点では OrbitControls に任せ、終わるときに映画カメラへ戻す。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class Director {
  constructor(camera, dom) {
    this.camera = camera;
    this.basePos = new THREE.Vector3(0.4, 2.2, -4.4);
    this.baseTgt = new THREE.Vector3(0.4, 1.1, 2.4);
    this.pos = this.basePos.clone();
    this.tgt = this.baseTgt.clone();
    this.fov = 56;
    this.drift = new THREE.Vector3();
    this.shot = null;
    this.t = 0;
    this.free = false;
    this.keys = new Set();

    camera.position.copy(this.pos);
    camera.fov = this.fov;
    camera.updateProjectionMatrix();

    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.panSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minPolarAngle = 0.12;
    this.controls.enabled = false;

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setShot(shot, { instant = false } = {}) {
    if (!shot) return;
    this.shot = shot;
    this.basePos.copy(V(shot.pos));
    this.baseTgt.copy(V(shot.tgt));
    this.fov = shot.fov ?? 52;
    if (shot.drift) this.drift.set(shot.drift[0], shot.drift[1], shot.drift[2]);
    else this.drift.set(0, 0, 0);
    if (instant) {
      this.pos.copy(this.basePos);
      this.tgt.copy(this.baseTgt);
      this.camera.position.copy(this.pos);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.tgt);
    }
    if (this.free) this.controls.target.copy(this.baseTgt);
  }

  setFree(on) {
    this.free = on;
    this.controls.enabled = on;
    if (on) {
      this.controls.target.copy(this.tgt);
      this.controls.update();
    } else {
      // 映画カメラへ戻す：今のカメラ位置から
      this.pos.copy(this.camera.position);
      this.tgt.copy(this.controls.target);
    }
    return on;
  }

  update(dt) {
    this.t += dt;
    const cam = this.camera;

    if (this.free) {
      // キーボード移動（前後左右）
      const speed = (this.keys.has('ShiftLeft') ? 3.2 : 1.7) * dt;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).negate();
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(fwd);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(fwd);
      if (this.keys.has('KeyA')) move.sub(right);
      if (this.keys.has('KeyD')) move.add(right);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        cam.position.add(move);
        this.controls.target.add(move);
      }
      // 教室から出ないように
      cam.position.x = THREE.MathUtils.clamp(cam.position.x, -3.85, 3.85);
      cam.position.y = THREE.MathUtils.clamp(cam.position.y, 0.35, 3.2);
      cam.position.z = THREE.MathUtils.clamp(cam.position.z, -4.85, 4.7);
      this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -3.9, 3.9);
      this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -4.9, 4.75);
      this.controls.update();
      this.tgt.copy(this.controls.target);
      return;
    }

    const s = Math.sin(this.t * 0.16);
    const desiredPos = this.basePos.clone().addScaledVector(this.drift, s);
    // 手ぶれ
    desiredPos.x += Math.sin(this.t * 0.63) * 0.014;
    desiredPos.y += Math.sin(this.t * 0.77 + 1.2) * 0.011;
    desiredPos.z += Math.cos(this.t * 0.51) * 0.01;

    const k = 1 - Math.exp(-dt * 2.4);
    this.pos.lerp(desiredPos, k);
    this.tgt.lerp(this.baseTgt, 1 - Math.exp(-dt * 3.0));

    cam.position.copy(this.pos);
    cam.lookAt(this.tgt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov += (this.fov - cam.fov) * (1 - Math.exp(-dt * 2.4));
      cam.updateProjectionMatrix();
    }
  }

  /** 人物クリック用のレイ */
  raycaster(ndcX, ndcY) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return rc;
  }
}
