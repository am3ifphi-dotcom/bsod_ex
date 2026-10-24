import * as THREE from 'three';
import { Rng } from '../core/math';

/**
 * Visual language of the BSOD world:
 *   deep navy fog, white terminal text, blown-out cyan seams, floating UI panes, fractured slabs.
 * These helpers keep every area consistent and cheap (canvas textures + additive materials).
 */

export const BSOD = {
  blue: new THREE.Color(0x0a4ea2),
  glow: new THREE.Color(0x4d8dff),
  cyan: new THREE.Color(0x9fd0ff),
  white: new THREE.Color(0xeaf3ff),
  ink: new THREE.Color(0x03060d),
  fog: new THREE.Color(0x050a16),
};

export function textTexture(
  text: string | string[],
  opts: {
    size?: number;
    font?: string;
    color?: string;
    bg?: string;
    align?: CanvasTextAlign;
    glow?: boolean;
    lineHeight?: number;
    pad?: number;
    width?: number;
    height?: number;
  } = {},
): THREE.CanvasTexture {
  const lines = Array.isArray(text) ? text : text.split('\n');
  const fontSize = opts.size ?? 64;
  const pad = opts.pad ?? fontSize * 0.6;
  const lh = opts.lineHeight ?? fontSize * 1.25;
  const canvas = document.createElement('canvas');
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = opts.font ?? `600 ${fontSize}px "Courier New", monospace`;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, measure.measureText(l).width);
  canvas.width = Math.max(2, Math.ceil(opts.width ?? maxW + pad * 2));
  canvas.height = Math.max(2, Math.ceil(opts.height ?? lines.length * lh + pad * 2));
  const ctx = canvas.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.font = opts.font ?? `600 ${fontSize}px "Courier New", monospace`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = opts.color ?? '#eaf3ff';
  if (opts.glow) {
    ctx.shadowColor = 'rgba(120,180,255,0.9)';
    ctx.shadowBlur = fontSize * 0.35;
  }
  const x = opts.align === 'center' ? canvas.width / 2 : opts.align === 'right' ? canvas.width - pad : pad;
  lines.forEach((l, i) => ctx.fillText(l, x, pad + i * lh));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function textPlane(
  text: string | string[],
  width: number,
  opts: {
    height?: number;
    opacity?: number;
    color?: string;
    fontSize?: number;
    additive?: boolean;
    doubleSide?: boolean;
  } = {},
): THREE.Mesh {
  const tex = textTexture(text, {
    size: opts.fontSize ?? 96,
    color: opts.color ?? '#eef6ff',
    glow: true,
    align: 'center',
  });
  const aspect = tex.image.width / tex.image.height;
  const h = opts.height ?? width / aspect;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: opts.opacity ?? 1,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      toneMapped: false,
    }),
  );
  mesh.renderOrder = 3;
  return mesh;
}

/** A broken application window, floating in the world. */
export function uiPanel(width: number, height: number, seed = 1, title = 'system.exe'): THREE.Mesh {
  const w = 768, h = Math.round(768 * (height / width));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = Math.max(64, h);
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(seed);
  ctx.fillStyle = 'rgba(4,12,26,0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(150,200,255,0.65)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  // title bar
  ctx.fillStyle = 'rgba(30,70,140,0.55)';
  ctx.fillRect(2, 2, canvas.width - 4, canvas.height * 0.09);
  ctx.fillStyle = '#dcecff';
  ctx.font = `600 ${Math.round(canvas.height * 0.045)}px "Courier New", monospace`;
  ctx.fillText(title, canvas.height * 0.06, canvas.height * 0.062);
  // body: error text + bars
  ctx.font = `${Math.round(canvas.height * 0.035)}px "Courier New", monospace`;
  const lines = 12;
  for (let i = 0; i < lines; i++) {
    if (rng.bool(0.25)) continue;
    const y = canvas.height * 0.16 + i * canvas.height * 0.046;
    ctx.fillStyle = `rgba(210,232,255,${0.35 + rng.float(0, 0.5)})`;
    ctx.fillText(rng.pick([
      'ERROR 0x000000EF: THREAD_NOT_RESPONDING',
      '> memory sector unreadable',
      '> retry? [Y/n]',
      '0x7FFE 3A21 90BC 0000',
      'SIGNAL LOST :: RECONNECTING',
      '> please stop clicking',
      'the door was never there',
    ]), canvas.height * 0.06, y);
  }
  // corrupted blocks
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rng.bool() ? 'rgba(160,205,255,0.25)' : 'rgba(20,40,80,0.5)';
    ctx.fillRect(rng.float(0, canvas.width), rng.float(0, canvas.height), rng.float(10, 90), rng.float(2, 12));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.renderOrder = 2;
  return mesh;
}

/** Floating wireframe cube (broken block noise), cheap and iconic. */
export function wireCube(size: number, color = 0x6ea8ff, opacity = 0.6): THREE.LineSegments {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  const mat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.LineSegments(geo, mat);
}

/** Additive light shaft cone used for volumetric-looking god rays. */
export function lightShaft(radius: number, height: number, color = 0x6fa8ff, opacity = 0.16): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, height, 24, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 2.2);
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float flicker = 0.9 + 0.1 * sin(uTime * 2.0 + vUv.y * 8.0);
        gl_FragColor = vec4(uColor, fade * edge * uOpacity * flicker);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/** Rising / drifting particle sprites ("data motes"). */
export function dataMotes(count: number, area: THREE.Vector3, color = 0x86b9ff, seed = 3): THREE.Points {
  const rng = new Rng(seed);
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.float(-area.x / 2, area.x / 2);
    pos[i * 3 + 1] = rng.float(0, area.y);
    pos[i * 3 + 2] = rng.float(-area.z / 2, area.z / 2);
    speed[i] = rng.float(0.2, 1.5);
    size[i] = rng.float(0.6, 2.4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAreaY: { value: area.y },
      uOpacity: { value: 0.6 },
    },
    vertexShader: `
      attribute float aSpeed; attribute float aSize;
      uniform float uTime; uniform float uAreaY;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * aSpeed, uAreaY);
        p.x += sin(uTime * 0.3 + position.z) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (60.0 / max(1.0, -mv.z));
        vAlpha = smoothstep(140.0, 8.0, -mv.z);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.05, length(d));
        gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Thin emissive strip (seams in the architecture). */
export function seam(
  length: number, thickness = 0.06, color = 0x4d8dff, intensity = 2.6, horizontal = true,
): THREE.Mesh {
  const geo = horizontal
    ? new THREE.BoxGeometry(length, thickness, thickness)
    : new THREE.BoxGeometry(thickness, length, thickness);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  mat.color.multiplyScalar(intensity);
  return new THREE.Mesh(geo, mat);
}

/** A frame of broken "video wall" panels that tile an error pattern. */
export function errorWall(width: number, height: number, seed = 7, rows = 6, cols = 10): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(seed);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng.bool(0.18)) continue;
      const w = width / cols;
      const h = height / rows;
      const tex = textTexture(rng.bool(0.5)
        ? rng.pick(['ERR', '0xEF', '???', 'WAKE', 'NULL', 'FATAL', ':(', '404', '#$%'])
        : `${rng.int(10, 99)}%`, { size: 48, color: rng.bool(0.7) ? '#dbeaff' : '#7fb3ff', glow: true });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.94, h * 0.94),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }),
      );
      mesh.position.set(-width / 2 + w * (c + 0.5), -height / 2 + h * (r + 0.5), rng.float(-0.02, 0.02));
      g.add(mesh);
    }
  }
  return g;
}

/** Additive glow sprite (cheap fake volumetric bloom around emitters). */
export function glowSprite(radius: number, color: THREE.ColorRepresentation, opacity = 0.5): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  const col = new THREE.Color(color);
  grad.addColorStop(0, `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},1)`);
  grad.addColorStop(0.35, `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},0.35)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(radius);
  return sprite;
}

/** Data rain shader material used in the street area. */
export function dataRain(count: number, area: THREE.Vector3, seed = 11): THREE.Points {
  const rng = new Rng(seed);
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.float(-area.x / 2, area.x / 2);
    pos[i * 3 + 1] = rng.float(0, area.y);
    pos[i * 3 + 2] = rng.float(-area.z / 2, area.z / 2);
    speed[i] = rng.float(8, 22);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAreaY: { value: area.y }, uColor: { value: new THREE.Color(0x9cc8ff) } },
    vertexShader: `
      attribute float aSpeed;
      uniform float uTime; uniform float uAreaY;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * aSpeed, uAreaY);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.0 * (90.0 / max(1.0, -mv.z));
        vA = smoothstep(160.0, 6.0, -mv.z) * 0.6;
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, max(abs(d.x) * 3.0, abs(d.y)));
        gl_FragColor = vec4(uColor, a * vA);
      }`,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

/** Small helper: does this object (and children) cast/receive shadows? */
export function setShadow(obj: THREE.Object3D, cast: boolean, receive = true): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = cast;
    m.receiveShadow = receive;
  });
}

/** Fracture a plane geometry into slab-like pieces (ground plates). */
export function fracturedSlab(
  w: number, d: number, material: THREE.Material, seed = 5, cols = 4, rows = 4,
): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(seed);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      if (rng.bool(0.06)) continue;
      const cw = (w / cols) * rng.float(0.9, 1.02);
      const cd = (d / rows) * rng.float(0.9, 1.02);
      const m = new THREE.Mesh(geo, material);
      m.scale.set(cw, rng.float(0.12, 0.5), cd);
      m.position.set(
        -w / 2 + (x + 0.5) * (w / cols) + rng.float(-0.15, 0.15),
        rng.float(-0.25, 0.06),
        -d / 2 + (z + 0.5) * (d / rows) + rng.float(-0.15, 0.15),
      );
      m.rotation.y = rng.float(-0.03, 0.03);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }
  return g;
}

/* ------------------------------------------------------------------ boundaries */

export type Edge = 'n' | 's' | 'e' | 'w';
export interface PerimeterGap { edge: Edge; from: number; to: number }

export interface PerimeterOptions {
  minX: number; maxX: number; minZ: number; maxZ: number;
  y: number;
  height?: number;
  gaps?: PerimeterGap[];
  /** draw visible blocks along the edge (otherwise only collision is added) */
  visual?: boolean;
  material?: THREE.Material;
  seed?: number;
  tag?: string;
}

/**
 * Closes the walkable edge of an area.
 *
 * The collision wall is continuous (so a dashing player can never leave the map) while the
 * visible geometry is broken up into slabs, so the boundary reads as ruined architecture
 * rather than an invisible fence. Openings are declared explicitly, one per connection.
 */
export function closePerimeter(
  ctx: { collision: { add(spec: { min: [number, number, number]; max: [number, number, number]; tag: string }): unknown } },
  group: THREE.Group,
  opts: PerimeterOptions,
): void {
  const { minX, maxX, minZ, maxZ, y } = opts;
  const height = opts.height ?? 1.35;
  const tag = opts.tag ?? 'perimeter';
  const rng = new Rng(opts.seed ?? 12);
  const gaps = opts.gaps ?? [];
  const mat = opts.material ?? new THREE.MeshStandardMaterial({ color: 0x1b2531, roughness: 0.85, metalness: 0.2 });

  const runs = (edge: Edge, from: number, to: number): Array<[number, number]> => {
    const cuts = gaps.filter((g) => g.edge === edge).sort((a, b) => a.from - b.from);
    const out: Array<[number, number]> = [];
    let cursor = from;
    for (const c of cuts) {
      const a = Math.max(from, Math.min(to, c.from));
      const b = Math.max(from, Math.min(to, c.to));
      if (a > cursor) out.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < to) out.push([cursor, to]);
    return out;
  };

  const addWall = (ax: number, az: number, bx: number, bz: number, edge: Edge): void => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const thick = 0.42;
    // collision: one continuous box per run
    ctx.collision.add({
      min: [alongX ? Math.min(ax, bx) : cx - thick / 2, y, alongX ? cz - thick / 2 : Math.min(az, bz)],
      max: [alongX ? Math.max(ax, bx) : cx + thick / 2, y + height, alongX ? cz + thick / 2 : Math.max(az, bz)],
      tag,
    });
    if (!opts.visual) return;
    const count = Math.max(1, Math.round(len / 2.6));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const h = height * rng.float(0.7, 1.18);
      const segLen = (len / count) * rng.float(0.72, 0.96);
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? segLen : 0.5, h, alongX ? 0.5 : segLen),
        mat,
      );
      block.position.set(px, y + h / 2, pz);
      block.rotation.y = rng.float(-0.03, 0.03);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
      // a thin emissive seam on top so the boundary is legible in the dark
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? segLen : 0.12, 0.035, alongX ? 0.12 : segLen),
        new THREE.MeshBasicMaterial({ color: 0x2f6fd0, toneMapped: false, transparent: true, opacity: 0.55 }),
      );
      seam.position.set(px, y + h + 0.02, pz);
      group.add(seam);
    }
    void edge;
  };

  for (const [a, b] of runs('n', minX, maxX)) addWall(a, minZ, b, minZ, 'n');
  for (const [a, b] of runs('s', minX, maxX)) addWall(a, maxZ, b, maxZ, 's');
  for (const [a, b] of runs('w', minZ, maxZ)) addWall(minX, a, minX, b, 'w');
  for (const [a, b] of runs('e', minZ, maxZ)) addWall(maxX, a, maxX, b, 'e');
}
