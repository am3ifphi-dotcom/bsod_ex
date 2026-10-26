import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
export const smoothstep = (t: number) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (t: number) => {
  t = clamp(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
export const easeInExpo = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * clamp(t) - 10));

/** frame-rate independent exponential smoothing */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampVec = (current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number) => {
  const k = 1 - Math.exp(-lambda * dt);
  current.lerp(target, k);
  return current;
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hash11 = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
};

// deterministic 2D value noise (cheap, used for terrain/layout)
const perm = new Uint8Array(512);
(() => {
  const rnd = mulberry32(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad2 = (hash: number, x: number, y: number) => {
  switch (hash & 3) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    default: return -x - y;
  }
};

export function noise2(x: number, y: number) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

export function fbm(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { canvas: c, ctx, texture: new THREE.CanvasTexture(c) };
}

export function makeNoiseTexture(size = 256, mono = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(rnd() * 255);
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = mono ? v : Math.floor(rnd() * 255);
    img.data[i * 4 + 2] = mono ? v : Math.floor(rnd() * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const formatBytes = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function angleWrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function setShadowRecursive(obj: THREE.Object3D, cast = true, receive = true) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
}

/**
 * Static-geometry batching: merges every non-animated, non-transparent mesh that
 * shares a material into a single buffer per material. The scene keeps its exact
 * look (same materials, same matrices) but the draw-call count drops by ~10-20x,
 * which is what makes 1080p60 possible on mid-range GPUs.
 */
export function mergeStatic(group: THREE.Object3D, skip: Set<THREE.Object3D>, minGroup = 3) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  const excluded = new Set<THREE.Object3D>();
  for (const o of skip) o.traverse((c) => excluded.add(c));
  const candidates: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(o as any).isMesh || (o as any).isSkinnedMesh || (o as any).isInstancedMesh) return;
    if (excluded.has(m)) return;
    // meshes used as anchors/parents for animated children must stay in the graph
    if (m.children.length > 0) return;
    if (Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent || mat.opacity < 1) return;
    if (!m.geometry || !m.geometry.attributes.position) return;
    candidates.push(m);
  });
  for (const m of candidates) {
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { mat, cast: m.castShadow, recv: m.receiveShadow, geos: [], meshes: [] };
      buckets.set(key, b);
    }
    const g = m.geometry.clone();
    // strip anything that would break the merge
    for (const attr of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
    }
    if (!g.index) {
      /* non-indexed is fine, mixed indexing is not — normalise below */
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    b.geos.push(g);
    b.meshes.push(m);
  }
  let merged = 0;
  for (const b of buckets.values()) {
    if (b.meshes.length < minGroup) {
      for (const g of b.geos) g.dispose();
      continue;
    }
    // three's merge needs identical attribute sets: normalise to non-indexed and
    // guarantee position / normal / uv on every geometry
    const hasUv = b.geos.some((g) => !!g.attributes.uv);
    const geos = b.geos.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      if (!n.attributes.normal) n.computeVertexNormals();
      if (hasUv && !n.attributes.uv) {
        n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      }
      if (!hasUv && n.attributes.uv) n.deleteAttribute('uv');
      return n;
    });
    const out = mergeGeometries(geos, false);
    if (!out) {
      for (const g of b.geos) g.dispose();
      continue;
    }
    const mesh = new THREE.Mesh(out, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    for (const m of b.meshes) m.parent?.remove(m);
    for (const g of b.geos) g.dispose();
    merged += b.meshes.length;
  }
  return merged;
}
