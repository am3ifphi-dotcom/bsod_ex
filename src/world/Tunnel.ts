import * as THREE from 'three';
import type { MaterialLibrary } from '../assets/Materials';
import { Rng } from '../core/math';
import { textPlane, uiPanel, wireCube } from './worldkit';

/**
 * The inside of the machine: the tunnel the player is dragged through between the bedroom
 * monitor and the glitch world. It is real geometry along a curve, so the camera can fly it
 * continuously — no cuts, no fades.
 */
export interface Tunnel {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  /** yaw/pitch of the curve at its end, so the world hand-off has no orientation snap */
  exitPose: { yaw: number; pitch: number };
  update(dt: number, time: number): void;
  setActive(active: boolean): void;
  setProgress(p: number): void;
}

/**
 * Centre line of the tunnel. The first point sits on the bedroom monitor's face and the last
 * point sits exactly at the arrival player's eye position (LAYOUT.start + eye height), so the
 * camera can be handed to and from the world without a cut.
 */
export const TUNNEL_POINTS: [number, number, number][] = [
  [-0.42, 1.2, -1.96],
  [0, 1.26, -5.2],
  [5.5, 6.5, -14],
  [-9, 22, -26],
  [11, 48, -14],
  [-8, 76, 22],
  [4, 104, 62],
  [10, 113, 80],
  [6, 118.5, 93],
  [1.4, 121.2, 101],
  [0, 121.62, 98],
];

export function buildTunnel(mats: MaterialLibrary, detail: number): Tunnel {
  const group = new THREE.Group();
  group.name = 'tunnel';
  group.visible = false;
  const rng = new Rng(5150);

  const points = TUNNEL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const endTan = curve.getTangentAt(1).normalize();
  const exitPose = {
    yaw: Math.atan2(-endTan.x, -endTan.z),
    pitch: Math.asin(THREE.MathUtils.clamp(endTan.y, -1, 1)),
  };

  /* ------------------------------------------------------------- inner skin */
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#04101f';
  c.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 8) {
    c.fillStyle = `rgba(60,110,190,${0.04 + (y % 32 === 0 ? 0.1 : 0)})`;
    c.fillRect(0, y, 512, 2);
  }
  for (let i = 0; i < 260; i++) {
    const x = rng.float(0, 512);
    const y = rng.float(0, 512);
    const w = rng.float(4, 90);
    const h = rng.float(1, 5);
    c.fillStyle = rng.bool(0.75) ? `rgba(120,180,255,${rng.float(0.05, 0.35)})` : `rgba(220,240,255,${rng.float(0.05, 0.25)})`;
    c.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 30; i++) {
    c.fillStyle = 'rgba(10,25,50,0.8)';
    c.fillRect(0, rng.float(0, 512), 512, rng.float(2, 10));
  }
  const skinTex = new THREE.CanvasTexture(canvas);
  skinTex.wrapS = skinTex.wrapT = THREE.RepeatWrapping;
  skinTex.repeat.set(1, 26);
  skinTex.colorSpace = THREE.SRGBColorSpace;

  const tubeGeo = new THREE.TubeGeometry(curve, Math.round(360 * detail), 7.2, 24, false);
  const skinMat = new THREE.MeshStandardMaterial({
    map: skinTex,
    side: THREE.BackSide,
    emissive: 0x2a5ca8,
    emissiveMap: skinTex,
    emissiveIntensity: 1.6,
    roughness: 0.5,
    metalness: 0.2,
  });
  const skin = new THREE.Mesh(tubeGeo, skinMat);
  group.add(skin);

  // a slightly smaller additive tube for glow
  const glowGeo = new THREE.TubeGeometry(curve, Math.round(200 * detail), 6.6, 16, false);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x2f6fd0,
    transparent: true,
    opacity: 0.12,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  group.add(new THREE.Mesh(glowGeo, glowMat));

  /* --------------------------------------------------------------- rings */
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x6fa8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  const rings: THREE.Mesh[] = [];
  const ringCount = Math.round(40 * detail);
  for (let i = 0; i < ringCount; i++) {
    const t = i / ringCount;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.9, 0.06, 4, 28), ringMat);
    ring.position.copy(p);
    ring.lookAt(p.clone().add(tangent));
    group.add(ring);
    rings.push(ring);
  }

  /* ------------------------------------------------------------ fragments */
  const fragMat = new THREE.MeshBasicMaterial({ color: 0x9fc8ff, transparent: true, opacity: 0.55, toneMapped: false });
  const frags: { mesh: THREE.Object3D; t: number; off: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  for (let i = 0; i < Math.round(70 * detail); i++) {
    const t = rng.float(0, 0.98);
    const p = curve.getPointAt(t);
    const roll = rng.bool();
    let obj: THREE.Object3D;
    if (roll) {
      obj = uiPanel(rng.float(2, 6), rng.float(1.2, 3.4), 800 + i, ['error', 'wake.exe', 'memory'][i % 3]);
    } else {
      obj = textPlane(rng.pick(['0x000000EF', 'WAKE_UP', ':(', 'NULL', '47%', 'ERR']), rng.float(2, 5), {
        color: '#dcecff', additive: true, opacity: 0.9,
      });
    }
    const off = new THREE.Vector3(rng.float(-5, 5), rng.float(-4.5, 4.5), rng.float(-1.6, 1.6));
    obj.position.copy(p).add(off);
    obj.lookAt(p);
    obj.rotateY(rng.float(-0.4, 0.4));
    group.add(obj);
    frags.push({ mesh: obj, t, off, spin: new THREE.Vector3(rng.float(-0.4, 0.4), rng.float(-0.6, 0.6), rng.float(-0.3, 0.3)) });
  }
  for (let i = 0; i < 12; i++) {
    const t = rng.float(0.05, 0.95);
    const p = curve.getPointAt(t);
    const wc = wireCube(rng.float(1, 3.4), 0x6ea8ff, 0.4);
    wc.position.copy(p).add(new THREE.Vector3(rng.float(-4, 4), rng.float(-3, 3), rng.float(-1, 1)));
    group.add(wc);
    frags.push({ mesh: wc, t, off: new THREE.Vector3(0, 0, 0), spin: new THREE.Vector3(0.3, 0.5, 0.1) });
  }

  /* --------------------------------------------------------------- cables */
  const cableMat = mats.solid({ color: 0x0a1420, roughness: 0.7 });
  for (let i = 0; i < 14; i++) {
    const t0 = rng.float(0.05, 0.9);
    const a = curve.getPointAt(t0);
    const b = curve.getPointAt(Math.min(0.99, t0 + rng.float(0.01, 0.06)));
    const mid = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(rng.float(-5, 5), rng.float(-4, 4), 0));
    const c2 = new THREE.CatmullRomCurve3([a, mid, b]);
    const geo = new THREE.TubeGeometry(c2, 12, 0.03, 4, false);
    group.add(new THREE.Mesh(geo, cableMat));
  }

  /* ------------------------------------------------------------ particles */
  const count = Math.round(900 * detail);
  const pos = new Float32Array(count * 3);
  const tt = new Float32Array(count);
  const spd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    tt[i] = rng.float(0, 1);
    spd[i] = rng.float(0.02, 0.12);
    const p = curve.getPointAt(tt[i]);
    pos[i * 3] = p.x + rng.float(-6, 6);
    pos[i * 3 + 1] = p.y + rng.float(-6, 6);
    pos[i * 3 + 2] = p.z + rng.float(-6, 6);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  pGeo.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xa9d2ff) } },
    vertexShader: `
      attribute float aSpeed;
      attribute float aT;
      uniform float uTime;
      varying float vA;
      void main() {
        float t = fract(aT - uTime * aSpeed * 0.35);
        // approximate the curve with a straight-ish vertical drift for cheap motion
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.z += sin(t * 20.0) * 0.4;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.4 * (90.0 / max(1.0, -mv.z));
        vA = smoothstep(90.0, 2.0, -mv.z);
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.08, length(d));
        gl_FragColor = vec4(uColor, a * vA);
      }`,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  group.add(particles);

  /* --------------------------------------------------------------- lights */
  const lights: THREE.PointLight[] = [];
  for (const t of [0.08, 0.3, 0.55, 0.78, 0.95]) {
    const light = new THREE.PointLight(0x5f9cff, 26, 34, 2);
    light.position.copy(curve.getPointAt(t));
    group.add(light);
    lights.push(light);
  }

  let progress = 0;
  let active = false;

  return {
    group,
    curve,
    exitPose,
    setActive(a: boolean) {
      active = a;
      group.visible = a;
    },
    setProgress(p: number) {
      progress = p;
      // pulse the rings as the camera passes them
      skinTex.offset.y = -p * 26;
    },
    update(dt: number, time: number) {
      if (!active) return;
      skinMat.emissiveIntensity = 1.4 + Math.sin(time * 8) * 0.15 + Math.sin(time * 31) * 0.06;
      pMat.uniforms.uTime.value = time;
      for (let i = 0; i < rings.length; i++) {
        const t = i / rings.length;
        const d = Math.abs(t - progress);
        const near = Math.max(0, 1 - d * 14);
        const m = rings[i].material as THREE.MeshBasicMaterial;
        m.opacity = 0.18 + near * 0.7;
        rings[i].scale.setScalar(1 + near * 0.06);
      }
      for (const f of frags) {
        const d = Math.abs(f.t - progress);
        const push = Math.max(0, 1 - d * 6);
        f.mesh.position
          .copy(curve.getPointAt(f.t))
          .add(f.off.clone().multiplyScalar(1 + (1 - push) * 0.5));
        f.mesh.rotation.x += f.spin.x * dt;
        f.mesh.rotation.y += f.spin.y * dt;
        f.mesh.rotation.z += f.spin.z * dt;
      }
      glowMat.opacity = 0.1 + Math.sin(time * 3.4) * 0.03;
      for (let i = 0; i < lights.length; i++) {
        lights[i].intensity = 20 + Math.sin(time * 6 + i * 2) * 8;
      }
    },
  };
}
