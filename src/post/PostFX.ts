import * as THREE from 'three';

/**
 * Commercial-Grade single-pass PostFX with a *repertoire* of glitch signatures.
 *
 * Philosophy (per art direction):
 *  - The base image is razor sharp, ACES-graded and completely clean. NO constant noise.
 *  - Every disturbance is a staged, intentional event with its own identity and sound design:
 *      1. BEND  — optical reality warp: fluid glass refraction + expanding shockwave ring + ghost echo.
 *      2. TEAR  — hard scan-tear: a handful of horizontal bands snap sideways with a bright seam.
 *      3. MASH  — datamosh: macroblock displacement + 5-bit colour crush + channel drift.
 *      4. SORT  — pixel-sort: rows stretch and smear into light streaks.
 *      5. ROLL  — CRT vertical roll: the frame slips a beat, a soft beam band drags through.
 *      6. GHOST — double exposure: a delayed, colour-shifted copy of the frame bleeds through.
 *  - The calm path costs a single texture fetch; effects only add taps while active.
 */
export type PostFXOptions = {
  distort: number;
  waveProgress?: number;
  chromatic: number;
  vignette: number;
  flash: number;
  warp?: number;
  horror?: number;
  tear?: number;
  mash?: number;
  sort?: number;
  roll?: number;
  ghost?: number;
  bloom?: number;
};

export class PostFX {
  private rt: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  /** Set if the post-process program cannot be linked — the game then renders straight to screen. */
  private disabled = false;

  // Half-resolution bloom chain (bright pass -> horizontal blur -> vertical blur)
  private rtBright: THREE.WebGLRenderTarget;
  private rtBlur: THREE.WebGLRenderTarget;
  private readonly bloomScene = new THREE.Scene();
  private readonly brightMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly quadGeo: THREE.BufferGeometry;
  private bloomEnabled = true;

  constructor(width: number, height: number) {
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: true,
      // 4x MSAA resolved inside the render target: the 3D world is made of hard architectural
      // edges, and without this every tower and causeway edge stair-steps at 1x pixel ratio.
      samples: 4,
    });

    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    triGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uTime: { value: 0 },
        uDistort: { value: 0 },
        uWaveProgress: { value: 0 },
        uChromatic: { value: 0 },
        uVignette: { value: 0.34 },
        uFlash: { value: 0 },
        uWarp: { value: 0 },
        uHorror: { value: 0 },
        uTear: { value: 0 },
        uMash: { value: 0 },
        uSort: { value: 0 },
        uRoll: { value: 0 },
        uGhost: { value: 0 },
        tBloom: { value: null },
        uBloom: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uDistort;
        uniform float uWaveProgress;
        uniform float uChromatic;
        uniform float uVignette;
        uniform float uFlash;
        uniform float uWarp;
        uniform float uHorror;
        uniform float uTear;
        uniform float uMash;
        uniform float uSort;
        uniform float uRoll;
        uniform float uGhost;
        uniform sampler2D tBloom;
        uniform float uBloom;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        vec3 acesFilmic(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        vec3 fetch(vec2 p) {
          return texture2D(tDiffuse, clamp(p, 0.0015, 0.9985)).rgb;
        }

        void main() {
          vec2 uv = vUv;
          vec2 centered = uv - 0.5;
          vec2 aspectCentered = centered * vec2(1.777, 1.0);
          float rad = length(aspectCentered);
          float r2 = dot(centered, centered);

          // ---------------------------------------------------------------- 0. SPEED WARP
          if (uWarp > 0.005) {
            uv = 0.5 + centered * (1.0 - uWarp * r2 * 0.78);
            centered = uv - 0.5;
            r2 = dot(centered, centered);
          }

          float total = uDistort + uTear + uMash + uSort + uRoll + uGhost + uWarp + uChromatic;
          vec2 refractOffset = vec2(0.0);
          float waveMask = 0.0;
          float seam = 0.0;
          float chaseBands = 0.0;

          if (total > 0.0025) {
            // ------------------------------------------------------------ 1. OPTICAL BEND
            if (uDistort > 0.004) {
              float ringRadius = uWaveProgress * 1.45;
              float ringBand = exp(-pow((rad - ringRadius) * 5.2, 2.0)) * sin((rad - ringRadius) * 24.0);
              vec2 radialDir = rad > 0.001 ? normalize(centered) : vec2(0.0, 1.0);

              float n1 = vnoise(uv * vec2(4.5, 3.2) + vec2(uTime * 1.3, -uTime * 0.9)) - 0.5;
              float n2 = vnoise(uv * vec2(8.0, 5.5) - vec2(uTime * 1.7, -uTime * 1.1)) - 0.5;
              vec2 fluidBend = vec2(n1, n2) * 0.038 * uDistort;

              float slipCenter = fract(uTime * 0.85);
              float slipBand = exp(-pow((uv.y - slipCenter) * 9.5, 2.0));
              float smoothShear = sin(uv.y * 18.0 + uTime * 9.0) * slipBand * 0.030 * uDistort;

              refractOffset = radialDir * ringBand * 0.028 * uDistort + fluidBend + vec2(smoothShear, 0.0);
              waveMask = clamp(length(refractOffset) * 28.0 + abs(ringBand) * uDistort, 0.0, 1.0);
            }

            // ------------------------------------------------------------ 2. SCAN TEAR
            // A FEW wide bands snap sideways at a stuttering 11Hz hold — reads as a deliberate
            // broadcast signal tear, never as constant random noise.
            if (uTear > 0.01) {
              float tick = floor(uTime * 11.0);
              float bands = 7.0;
              float band = floor(uv.y * bands);
              float pick = hash21(vec2(band, tick) + vec2(3.7, 9.1));
              float on = step(0.52, pick);
              float shift = (hash21(vec2(band * 1.7, tick + 4.0)) - 0.5) * 0.30 * uTear;
              uv.x += shift * on;
              // Feather the very edge of each torn band by one pixel-ish so it reads as glass.
              float feather = smoothstep(0.0, 0.012, fract(uv.y * bands)) * smoothstep(1.0, 0.988, fract(uv.y * bands));
              uv.x -= shift * on * (1.0 - feather) * 0.35;
              seam = on * smoothstep(0.006, 0.0, abs(fract(uv.y * bands) - 0.5)) * uTear;
              chaseBands += on;
            }

            // ------------------------------------------------------------ 3. DATAMOSH
            if (uMash > 0.01) {
              float tick = floor(uTime * 7.0);
              vec2 grid = vec2(26.0, 15.0);
              vec2 cell = floor(uv * grid);
              float pick = hash21(cell + tick * 0.37);
              vec2 off = vec2(
                hash21(cell * 1.31 + tick * 2.11) - 0.5,
                hash21(cell * 2.73 + tick * 1.07) - 0.5
              ) * 0.105 * uMash;
              // Only ~38% of macroblocks smear, the rest hold perfectly still.
              uv += off * step(0.62, pick);
            }

            // ------------------------------------------------------------ 4. PIXEL SORT
            if (uSort > 0.01) {
              float tick = floor(uTime * 9.0);
              float row = floor(uv.y * 74.0);
              float pick = hash21(vec2(row, tick));
              float rowActive = smoothstep(0.55, 0.86, pick) * uSort;
              float anchor = hash21(vec2(row * 3.1, tick + 2.0));
              uv.x = mix(uv.x, anchor * 0.55 + uv.x * 0.45, rowActive * 0.65);
              seam += rowActive * 0.55;
            }

            // ------------------------------------------------------------ 5. CRT ROLL
            if (uRoll > 0.01) {
              float rollY = fract(uTime * 0.31 + 0.15);
              float beam = exp(-pow((uv.y - rollY) * 11.0, 2.0));
              uv.y += beam * 0.075 * uRoll;
              seam += beam * uRoll * 0.9;
            }
          }

          // ---------------------------------------------------------------- BASE SAMPLE
          vec3 col;
          float dispersion = uChromatic * 0.011 + waveMask * 0.011 + uWarp * 0.016 + seam * 0.02;
          if (dispersion > 0.0012) {
            vec2 dispVec = centered * dispersion * (0.45 + r2 * 2.1) + refractOffset * 0.38;
            col.r = fetch(uv + dispVec).r;
            col.g = fetch(uv).g;
            col.b = fetch(uv - dispVec).b;
          } else {
            col = fetch(uv);
          }

          // Ghost echo of the bend (double vision on strong spatial warps)
          if (uDistort > 0.18) {
            vec3 ghost = fetch(vUv - refractOffset * 1.35);
            col = mix(col, ghost, clamp((uDistort - 0.18) * 0.34, 0.0, 0.26));
          }

          // ---------------------------------------------------------------- GHOST / FEEDBACK ECHO
          // A delayed, chromatic-lagged copy of the frame bleeds through — like a video mixer
          // holding the previous field. Three taps only, all gated by uGhost.
          if (uGhost > 0.02) {
            vec2 drift = vec2(
              sin(uTime * 1.7) * 0.028,
              cos(uTime * 1.3) * 0.020
            ) * uGhost;
            vec3 echoA = fetch(vUv - drift * 1.6);
            vec3 echoB = fetch(vUv - drift * 3.1 - vec2(0.006, 0.0));
            vec3 echo = mix(echoA, echoB, 0.45);
            echo *= vec3(0.86, 1.0, 1.12);
            col = mix(col, echo, clamp(uGhost * 0.52, 0.0, 0.62));
            // Interlace comb from the held field
            float comb = 0.5 + 0.5 * sin(vUv.y * 900.0);
            col *= mix(1.0, mix(0.86, 1.06, comb), uGhost * 0.5);
          }

          // ---------------------------------------------------------------- PIXEL SORT SMEAR
          if (uSort > 0.05) {
            vec3 smear = fetch(uv + vec2(0.010 * uSort, 0.0))
                       + fetch(uv + vec2(0.026 * uSort, 0.0))
                       + fetch(uv + vec2(-0.018 * uSort, 0.0));
            col = mix(col, smear * 0.3333, clamp(uSort * 0.45, 0.0, 0.55));
          }

          // ---------------------------------------------------------------- MASH COLOUR CRUSH
          if (uMash > 0.02) {
            float levels = mix(48.0, 5.0, clamp(uMash, 0.0, 1.0) * 0.6);
            vec3 crushed = floor(col * levels + 0.5) / levels;
            col = mix(col, crushed, clamp(uMash * 0.85, 0.0, 0.9));
            // VHS-style channel drift inside the corrupted blocks
            float chan = clamp(uMash * 0.012, 0.0, 0.014);
            col.r = mix(col.r, fetch(uv + vec2(chan, 0.0)).r, uMash * 0.7);
            col.b = mix(col.b, fetch(uv - vec2(chan, 0.0)).b, uMash * 0.7);
          }

          // ---------------------------------------------------------------- SEAMS & BEAM
          if (seam > 0.01) {
            col += vec3(0.42, 0.86, 1.0) * clamp(seam, 0.0, 1.0) * 0.16;
          }
          if (uRoll > 0.02) {
            float rollY = fract(uTime * 0.31 + 0.15);
            float beam = exp(-pow((vUv.y - rollY) * 16.0, 2.0));
            col *= 1.0 + beam * uRoll * 0.16;
          }

          // Peripheral wind-streak sheen only during high-speed dive / abyss freefall
          if (uWarp > 0.04) {
            float ang = atan(centered.y, centered.x);
            float ray = pow(max(0.0, sin(ang * 38.0 + uTime * 9.0)), 14.0);
            float rimMask = smoothstep(0.08, 0.36, r2) * uWarp;
            col += vec3(0.45, 0.85, 1.0) * ray * 0.26 * rimMask;
          }

          // ---------------------------------------------------------------- GRADE
          col = acesFilmic(col * 1.18);
          col = pow(col, vec3(1.0 / 2.2));

          // Subtle cold-teal / warm-magenta split-tone, breathing with the horror level
          if (uHorror > 0.01) {
            float darkPulse = 0.86 + 0.14 * sin(uTime * 5.0);
            float edgeShadow = smoothstep(0.08, 0.42, r2) * uHorror * darkPulse;
            col = mix(col, col * vec3(0.74, 0.26, 0.32), edgeShadow * 0.62);
          }
          col = mix(col, col * vec3(0.94, 1.0, 1.06) + vec3(0.0, 0.004, 0.010), 0.35);

          // Fine cinema sensor grain to kill dark gradient banding (0.014 = imperceptible)
          float grain = (hash21(vUv * 512.0 + fract(uTime * 17.3)) - 0.5) * 0.013;
          col += grain;

          // --- Bloom: half-res bright-pass glow, added after grading so neon bleeds over the image.
          if (uBloom > 0.001) {
            vec3 glow = texture2D(tBloom, vUv).rgb;
            col += glow * uBloom;
          }

          float vig = smoothstep(0.96, 0.18, r2 * (1.05 + uVignette));
          col *= mix(1.0 - uVignette * 0.72, 1.0, vig);

          // Restrained luminance flash
          col = mix(col, vec3(0.90, 0.97, 1.0), clamp(uFlash, 0.0, 1.0));

          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(triGeo, this.mat);
    mesh.frustumCulled = false;
    this.quadScene.add(mesh);

    this.quadGeo = triGeo;
    const bloomOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtBright = new THREE.WebGLRenderTarget(Math.max(2, width >> 1), Math.max(2, height >> 1), bloomOpts);
    this.rtBlur = new THREE.WebGLRenderTarget(Math.max(2, width >> 1), Math.max(2, height >> 1), bloomOpts);

    // Bright pass: soft-knee threshold so only genuine light sources survive.
    this.brightMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uThreshold: { value: 0.62 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uThreshold;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float knee = smoothstep(uThreshold, uThreshold + 0.28, luma);
          gl_FragColor = vec4(c * knee, 1.0);
        }
      `,
    });

    // Separable 9-tap gaussian; run twice (horizontal then vertical).
    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1 / Math.max(2, width >> 1), 1 / Math.max(2, height >> 1)) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform vec2 uDir;
        uniform vec2 uTexel;
        void main() {
          vec2 step0 = uDir * uTexel * 1.35;
          vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
          sum += (texture2D(tDiffuse, vUv + step0).rgb + texture2D(tDiffuse, vUv - step0).rgb) * 0.1945946;
          sum += (texture2D(tDiffuse, vUv + step0 * 2.0).rgb + texture2D(tDiffuse, vUv - step0 * 2.0).rgb) * 0.1216216;
          sum += (texture2D(tDiffuse, vUv + step0 * 3.0).rgb + texture2D(tDiffuse, vUv - step0 * 3.0).rgb) * 0.0540540;
          sum += (texture2D(tDiffuse, vUv + step0 * 4.0).rgb + texture2D(tDiffuse, vUv - step0 * 4.0).rgb) * 0.0162162;
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
    });

    const brightMesh = new THREE.Mesh(triGeo, this.brightMat);
    brightMesh.frustumCulled = false;
    this.bloomScene.add(brightMesh);

    this.mat.uniforms.tBloom.value = this.rtBright.texture;
  }

  public setSize(width: number, height: number): void {
    this.rt.setSize(width, height);
    this.rtBright.setSize(Math.max(2, width >> 1), Math.max(2, height >> 1));
    this.rtBlur.setSize(Math.max(2, width >> 1), Math.max(2, height >> 1));
    this.blurMat.uniforms.uTexel.value.set(
      1 / Math.max(2, width >> 1),
      1 / Math.max(2, height >> 1)
    );
  }

  /**
   * Compiles the quad program once and disables the pass if the driver rejects it.
   * A single GLSL typo must never be able to black out the whole game again.
   */
  public validate(renderer: THREE.WebGLRenderer): void {
    try {
      renderer.compile(this.quadScene, this.quadCamera);
      const programs = (renderer.info?.programs ?? []) as Array<{
        diagnostics?: {
          runnable?: boolean;
          vertexShader?: { log?: string | null };
          fragmentShader?: { log?: string | null };
        };
      }>;
      for (const program of programs) {
        const diag = program.diagnostics;
        if (!diag) continue;
        if (diag.runnable === false || diag.fragmentShader?.log || diag.vertexShader?.log) {
          this.disabled = true;
          console.error('[PostFX] post-process shader rejected by the GPU — direct rendering fallback.', diag);
          return;
        }
      }
    } catch (err) {
      this.disabled = true;
      console.error('[PostFX] validation failed — direct rendering fallback.', err);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    elapsed: number,
    opts: PostFXOptions
  ): void {
    if (this.disabled) {
      renderer.setRenderTarget(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      return;
    }

    const u = this.mat.uniforms;
    u.uTime.value = elapsed;
    u.uDistort.value = opts.distort;
    u.uWaveProgress.value = opts.waveProgress ?? 0.5;
    u.uChromatic.value = opts.chromatic;
    u.uVignette.value = opts.vignette;
    u.uFlash.value = opts.flash;
    u.uWarp.value = opts.warp ?? 0;
    u.uHorror.value = opts.horror ?? 0;
    u.uTear.value = opts.tear ?? 0;
    u.uMash.value = opts.mash ?? 0;
    u.uSort.value = opts.sort ?? 0;
    u.uRoll.value = opts.roll ?? 0;
    u.uGhost.value = opts.ghost ?? 0;

    renderer.setRenderTarget(this.rt);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    const bloomStrength = this.bloomEnabled ? (opts.bloom ?? 0.55) : 0;
    u.uBloom.value = bloomStrength;
    if (bloomStrength > 0.001) {
      const quad = this.bloomScene.children[0] as THREE.Mesh;
      // 1) bright pass at half resolution
      this.brightMat.uniforms.tDiffuse.value = this.rt.texture;
      quad.material = this.brightMat;
      renderer.setRenderTarget(this.rtBright);
      renderer.clear(true, false, false);
      renderer.render(this.bloomScene, this.quadCamera);

      // 2) separable blur (horizontal then vertical)
      this.blurMat.uniforms.tDiffuse.value = this.rtBright.texture;
      this.blurMat.uniforms.uDir.value.set(1, 0);
      quad.material = this.blurMat;
      renderer.setRenderTarget(this.rtBlur);
      renderer.clear(true, false, false);
      renderer.render(this.bloomScene, this.quadCamera);

      this.blurMat.uniforms.tDiffuse.value = this.rtBlur.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1);
      renderer.setRenderTarget(this.rtBright);
      renderer.clear(true, false, false);
      renderer.render(this.bloomScene, this.quadCamera);
    }

    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }
}
