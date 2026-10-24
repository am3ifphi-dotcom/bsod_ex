// GLSL used by the game: glitch vertex deformation, the BSOD sky, instanced
// debris drift, the devouring "mouth", and the final compositing pass.
import * as THREE from 'three';

export const skyVert = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const skyFrag = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uGlitch;
  varying vec3 vWorldPos;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 dir = normalize(vWorldPos);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.42, 0.62, h));
    col = mix(col, uTop, smoothstep(0.55, 1.0, h));

    // faint cathedral-like bands of light in the fog
    float band = sin(dir.y * 26.0 + uTime * 0.05) * 0.5 + 0.5;
    col += uGlow * 0.05 * band * smoothstep(0.35, 0.8, h);

    // distant error grid: horizon-aligned scanlines that fade out
    float grid = abs(fract(dir.y * 60.0 + 0.5) - 0.5);
    col += uGlow * 0.05 * smoothstep(0.48, 0.5, grid) * (1.0 - smoothstep(0.48, 0.7, h));

    // stars / floating pixels
    vec2 sp = floor(dir.xz * 220.0 / max(0.25, 1.0 - abs(dir.y)));
    float star = step(0.9985, hash(sp)) * smoothstep(0.15, 0.6, h);
    col += vec3(0.55, 0.72, 1.0) * star * 0.7;

    // glitch: horizontal displacement bands + colour shift
    if (uGlitch > 0.01) {
      float row = floor(dir.y * 40.0);
      float sh = step(0.9, hash(vec2(row, floor(uTime * 5.0)))) * uGlitch;
      col = mix(col, col.brg * 1.4, sh * 0.8);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- debris
export const debrisVert = /* glsl */`
  attribute vec3 aOffset;
  attribute vec3 aAxis;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aScale;
  attribute float aKind;
  uniform float uTime;
  uniform float uGlitch;
  varying float vShade;
  varying float vKind;
  varying vec3 vN;

  mat3 rotAxis(vec3 axis, float angle) {
    float s = sin(angle), c = cos(angle);
    float oc = 1.0 - c;
    return mat3(
      oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,
      oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,
      oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c
    );
  }

  void main() {
    float t = uTime * aSpeed + aPhase;
    vec3 p = position * aScale;
    p = rotAxis(normalize(aAxis), t * 0.35) * p;
    vec3 off = aOffset;
    off.y += sin(t * 0.7 + aPhase) * 1.6;
    off.x += cos(t * 0.41 + aPhase * 1.7) * 1.1;
    off.z += sin(t * 0.33 + aPhase * 2.3) * 1.1;
    // pulse inward when glitching
    off *= 1.0 - uGlitch * 0.12 * sin(t * 3.0 + aPhase);
    vec4 mv = viewMatrix * vec4(off + p, 1.0);
    vShade = 0.35 + 0.65 * abs(normalize(normalMatrix * normalize(normal)).z);
    vKind = aKind;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

export const debrisFrag = /* glsl */`
  precision highp float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uTime;
  uniform float uGlitch;
  varying float vShade;
  varying float vKind;
  varying vec3 vN;
  void main() {
    vec3 col = mix(uColorA, uColorB, vKind);
    float fres = pow(1.0 - abs(vN.z), 2.0);
    col *= (0.55 + 0.45 * vShade) * (0.7 + 0.6 * fres);
    // wireframe-ish edge glow for a few shards
    if (vKind > 0.6) col += vec3(0.3, 0.6, 1.0) * fres * 0.5;
    col += vec3(0.1, 0.3, 0.9) * uGlitch * 0.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ------------------------------------------------------------- the mouth
export const mouthVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const mouthFrag = /* glsl */`
  precision highp float;
  uniform float uOpen;      // 0 = plain :( face, 1 = fully open maw
  uniform float uTime;
  uniform float uGlitch;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // the maw: an ellipse that grows with uOpen
    float rx = mix(0.05, 0.62, uOpen);
    float ry = mix(0.02, 0.92, uOpen);
    float d = length(vec2(p.x / rx, (p.y + 0.05) / ry));
    float inside = 1.0 - smoothstep(0.92, 1.02, d);

    // teeth: radial blocks around the opening
    float ang = atan(p.y, p.x);
    float teeth = step(0.45, fract(ang * 9.0 + uTime * 0.4)) * smoothstep(1.35, 1.0, d) * step(0.72, d);

    vec3 maw = vec3(0.0);
    maw += vec3(0.02, 0.05, 0.16) * (1.0 - d);
    // throat glow deep inside
    maw += vec3(0.08, 0.35, 1.0) * smoothstep(0.55, 0.0, d) * (0.35 + 0.3 * uOpen);
    // swirling rings
    float rings = sin(d * 22.0 - uTime * 4.0) * 0.5 + 0.5;
    maw += vec3(0.15, 0.4, 0.9) * rings * 0.18 * inside;
    maw += vec3(0.85, 0.9, 1.0) * teeth * 0.75;

    // face: the ":( " glyph carved from light on the outside
    float eyes = smoothstep(0.09, 0.0, length(p - vec2(-0.42, 0.45))) + smoothstep(0.09, 0.0, length(p - vec2(0.42, 0.45)));
    float mouth = smoothstep(0.05, 0.0, length(vec2(p.x, (p.y + 0.32) * 2.2))) * step(abs(p.y + 0.3), 0.26);
    float glyph = clamp(eyes + mouth, 0.0, 1.0) * (1.0 - uOpen);
    vec3 glyphCol = vec3(0.95, 0.97, 1.0) * glyph * 2.2;

    vec3 col = maw * inside + glyphCol;
    float alpha = max(inside, glyph) ;
    // dissolve the outer rim into the screen
    alpha *= smoothstep(1.9, 0.7, r);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// -------------------------------------------------------- final composite
export const finalFrag = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uGlitch;     // 0..1 global glitch intensity
  uniform float uGrain;
  uniform float uVignette;
  uniform float uChroma;     // extra chromatic aberration
  uniform float uScan;
  uniform float uShakeSeed;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 uv = vUv;
    float g = uGlitch;

    // ---- row tearing (block displacement)
    float rows = 42.0;
    float row = floor(uv.y * rows);
    float seed = floor(uTime * 11.0);
    float tear = step(0.86 - g * 0.34, hash(vec2(row, seed)));
    uv.x += (hash(vec2(row * 1.7, seed + 3.1)) - 0.5) * 0.22 * g * tear;

    // ---- slight global wobble (imperceptible at g=0)
    uv.x += sin(uv.y * 24.0 + uTime * 2.0) * 0.0012 * g;

    // ---- chromatic aberration: radial + glitch boost
    vec2 c = uv - 0.5;
    float rad = dot(c, c);
    float ca = (0.0016 + uChroma * 0.02) * (0.35 + rad * 1.6);
    vec2 dir = normalize(c + 0.0001);
    vec3 col;
    col.r = texture2D(tDiffuse, uv + dir * ca).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - dir * ca).b;

    // ---- block noise / corrupted tiles
    if (g > 0.02) {
      vec2 tiles = floor(uv * vec2(14.0, 22.0));
      float tk = hash(tiles + seed * 0.37);
      if (tk > 1.0 - g * 0.16) {
        vec2 off = (vec2(hash(tiles), hash(tiles + 7.0)) - 0.5) * 0.06 * g;
        col = mix(col, texture2D(tDiffuse, uv + off).rgb, 0.85);
      }
      // rare full-frame colour pulse, rate limited by the caller
      col = mix(col, vec3(col.g, col.b, col.r) * 1.15, step(0.995 - g * 0.01, hash(vec2(seed, 3.0))) * 0.5);
    }

    // ---- scanlines / CRT feel
    float sl = sin(uv.y * uResolution.y * 1.6) * 0.5 + 0.5;
    col *= 1.0 - uScan * 0.06 * sl;

    // ---- film grain (animated, luminance dependent)
    float gr = noise(uv * uResolution * 0.6 + uTime * 61.0) - 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += gr * uGrain * (0.06 + 0.1 * (1.0 - abs(lum - 0.45) * 2.0));

    // ---- vignette
    float vig = smoothstep(0.95, 0.25, length(c) * 1.25);
    col *= mix(1.0, vig, uVignette);

    // subtle lift so blacks stay blue rather than crushed
    col = max(col, vec3(0.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const finalVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ------------------------------------------------------- utility materials
/** Patch any MeshStandardMaterial with the BSOD vertex/fragment corruption. */
export function withGlitch(mat: THREE.MeshStandardMaterial, uniforms: {
  uTime: { value: number }; uGlitch: { value: number };
}, uvAttribute = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uGlitch = uniforms.uGlitch;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uGlitch;
        float gh(float n){ return fract(sin(n) * 43758.5453123); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uGlitch > 0.0001) {
          float t = uTime;
          float w = sin(position.y * 3.4 + t * 1.7) * cos(position.x * 2.1 - t * 0.9);
          transformed += objectNormal * (w * 0.09 * uGlitch);
          float rw = floor(position.y * 7.0 + floor(t * 3.0) * 0.37);
          float slice = step(0.72, gh(rw * 12.9898)) * gh(rw * 78.233 + floor(t * 4.0));
          transformed.x += (slice - 0.35) * 0.6 * uGlitch;
          transformed.z += (gh(rw + t) - 0.5) * 0.12 * uGlitch;
          transformed *= 1.0 - uGlitch * 0.06 * step(0.86, gh(rw * 3.77 + floor(t * 2.0)));
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uGlitch;
        float gh2(float n){ return fract(sin(n) * 43758.5453123); }
        ${uvAttribute ? 'varying vec2 vGlitchUv;' : ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          ${uvAttribute ? `
          float sl = sin(vGlitchUv.y * 900.0 + uTime * 12.0) * 0.5 + 0.5;
          gl_FragColor.rgb *= 1.0 - uGlitch * 0.34 * sl;
          gl_FragColor.rgb += vec3(0.05, 0.22, 0.75) * uGlitch * 0.4 *
              step(0.7, gh2(floor(uTime * 9.0) + vGlitchUv.y * 40.0));` : `
          gl_FragColor.rgb += vec3(0.02, 0.10, 0.34) * uGlitch * 0.5 *
              step(0.85, gh2(floor(uTime * 7.0) + floor(gl_FragCoord.y * 0.02)));`}
        }`);
    if (uvAttribute) {
      // NOTE: the declaration itself is injected in the <common> block above;
      // only the assignment belongs in main().
      shader.vertexShader = shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vGlitchUv = uv;`);
    }
  };
  mat.customProgramCacheKey = () => `glitch-${uvAttribute}`;
  return mat;
}

/** Unlit additive "hologram" material used for in-world UI fragments. */
export function hudFragmentMaterial(map: THREE.Texture, color = 0x9fc8ff) {
  const m = new THREE.MeshBasicMaterial({
    map, color, transparent: true, opacity: 0.85, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  return m;
}
