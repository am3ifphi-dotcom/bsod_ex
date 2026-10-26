/**
 * 空中を舞うちり — 光の筋を可见にする粒
 */
import * as THREE from 'three';
import { ROOM as R } from './materials.js';

export class DustField {
  constructor(count = 900) {
    this.count = count;
    const pos = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.amp = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // 窓側（+x）に多く、床近くにもたまる分布
      const x = (Math.random() ** 0.75) * (R.W - 0.4) + R.X0 + 0.2;
      const y = Math.random() ** 0.65 * (R.H - 0.25) + 0.15;
      const z = Math.random() * (R.D - 0.4) + R.Z0 + 0.2;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      this.base[i * 3] = x;
      this.base[i * 3 + 1] = y;
      this.base[i * 3 + 2] = z;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.speed[i] = 0.06 + Math.random() * 0.2;
      this.amp[i] = 0.06 + Math.random() * 0.22;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const sprite = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,246,224,0.55)');
      g.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    this.material = new THREE.PointsMaterial({
      size: 0.028,
      map: sprite,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      color: 0xfff2d8,
      fog: true,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
    const attr = this.points.geometry.attributes.position;
    const arr = attr.array;
    const t = this.time;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const p = this.phase[i];
      const s = this.speed[i];
      const a = this.amp[i];
      arr[i3] = this.base[i3] + Math.sin(t * s + p) * a * 0.6;
      arr[i3 + 1] = this.base[i3 + 1] + Math.sin(t * s * 0.7 + p * 1.7) * a * 0.35 + Math.sin(t * 0.05 + p) * 0.05;
      arr[i3 + 2] = this.base[i3 + 2] + Math.cos(t * s * 0.85 + p) * a * 0.5;
    }
    attr.needsUpdate = true;
  }
}
