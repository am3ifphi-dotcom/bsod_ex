import * as THREE from 'three';
import { makeTunnelTexture } from '../core/textures';
import { RNG } from '../core/util';

/**
 * 「画面の内側」を抜けるトンネル。
 * 内側だけを描画 (BackSide) し、テクスチャをスクロールさせることで
 * 高速移動の手触りを出す。落下中は破片が上へ流れる。
 */
export class Tunnel {
  group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private tex: THREE.Texture;
  private debris: THREE.InstancedMesh;
  private debrisData: { a: number; r: number; y: number; s: number; rot: number }[] = [];
  private length: number;
  private speed = 0;

  constructor(opts: {
    radius: number; length: number; color?: number; seed?: number;
    debrisCount?: number; opacity?: number; sides?: number; open?: boolean;
  }) {
    const { radius, length } = opts;
    this.length = length;
    this.tex = makeTunnelTexture(512, 1024, opts.seed ?? 5);
    this.tex.repeat.set(Math.max(1, Math.round(radius * 1.6)), Math.max(2, Math.round(length / 12)));
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      color: opts.color ?? 0x9fd0ff,
      side: THREE.BackSide,
      transparent: true,
      opacity: opts.opacity ?? 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const geo = new THREE.CylinderGeometry(radius, radius * 0.92, length, opts.sides ?? 28, 8, opts.open ?? true);
    const tube = new THREE.Mesh(geo, this.mat);
    this.group.add(tube);

    // 奥行きの手掛かりになるリング
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xbcdcff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const count = Math.max(3, Math.round(length / 6));
    for (let i = 0; i < count; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.94, 0.02 + radius * 0.006, 4, 22), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -length / 2 + (i / count) * length;
      ring.userData.scroll = true;
      this.group.add(ring);
    }

    // 流れる破片
    const n = opts.debrisCount ?? 70;
    const dg = new THREE.BoxGeometry(1, 1, 1);
    const dm = new THREE.MeshBasicMaterial({ color: 0x9fc8f0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.debris = new THREE.InstancedMesh(dg, dm, n);
    const rng = new RNG((opts.seed ?? 5) * 17);
    for (let i = 0; i < n; i++) {
      this.debrisData.push({
        a: rng.range(0, Math.PI * 2),
        r: rng.range(radius * 0.25, radius * 0.92),
        y: rng.range(-length / 2, length / 2),
        s: rng.range(0.02, 0.16) * radius,
        rot: rng.range(0, 6.28),
      });
    }
    this.group.add(this.debris);
  }

  setSpeed(s: number) { this.speed = s; }
  setOpacity(o: number) {
    this.mat.opacity = o;
    this.group.visible = o > 0.001;
  }
  get position() { return this.group.position; }
  get rotation() { return this.group.rotation; }

  update(dt: number, _t: number) {
    const scroll = this.speed * dt;
    this.tex.offset.y = (this.tex.offset.y + scroll * 0.06) % 1;
    this.group.children.forEach((c) => {
      if (c.userData.scroll) {
        c.position.y -= scroll * 0.5;
        if (c.position.y < -this.length / 2) c.position.y += this.length;
      }
    });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < this.debrisData.length; i++) {
      const d = this.debrisData[i];
      d.y -= scroll * (0.8 + (i % 5) * 0.15);
      if (d.y < -this.length / 2) d.y += this.length;
      q.setFromEuler(new THREE.Euler(d.rot + d.y * 0.2, d.rot * 1.7, d.rot));
      m4.compose(
        new THREE.Vector3(Math.cos(d.a) * d.r, d.y, Math.sin(d.a) * d.r),
        q, new THREE.Vector3(d.s, d.s * 2.5, d.s),
      );
      this.debris.setMatrixAt(i, m4);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
