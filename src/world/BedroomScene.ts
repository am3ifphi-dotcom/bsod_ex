import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BsodScreen } from './BsodScreen';
import {
  applyAssetAnisotropy,
  getSharedNoiseTexture,
  mergeStaticSubmeshes,
  toAtmosphericMaterial,
} from '../utils/ProceduralNoise';

export interface BoxCollider2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const PEEL_SHARD_COUNT = 64;

/**
 * Upgrades heavy PBR MeshStandardMaterial into a fast, specular + Fresnel-rim atmospheric material.
 */
export function toFastLambert(src: THREE.Material): THREE.Material {
  return toAtmosphericMaterial(src, { rimColor: 0x3b96ff });
}

export class BedroomScene {
  public readonly scene = new THREE.Scene();
  public readonly group = new THREE.Group();
  public readonly bsodScreen = new BsodScreen();

  public readonly monitorWorldPos = new THREE.Vector3(-1.723, 1.045, 0.735);
  public readonly monitorWorldQuat = new THREE.Quaternion();
  public readonly inspectCamPos = new THREE.Vector3(-1.05, 1.08, 0.735);
  public readonly inspectLookTarget = new THREE.Vector3(-1.723, 1.045, 0.735);

  public readonly pcTowerSoundPos = new THREE.Vector3(-1.74, 0.98, 0.04);
  public readonly clockSoundPos = new THREE.Vector3(-1.62, 0.56, -2.12);

  private deskLampLight!: THREE.PointLight;
  private deskLampBulbMat!: THREE.MeshBasicMaterial;
  private hemiLight!: THREE.HemisphereLight;
  private monitorBeamMat!: THREE.ShaderMaterial;
  private monitorBeamMesh!: THREE.Mesh;
  private roomDustMat!: THREE.ShaderMaterial;
  private rainGlassMat!: THREE.ShaderMaterial;

  private officeChair!: THREE.Object3D;
  private clockCanvas!: HTMLCanvasElement;
  private clockTex!: THREE.CanvasTexture;
  private lastClockText = '';

  private aftermathRelicGroup = new THREE.Group();
  private peelShards!: THREE.InstancedMesh;
  private peelShardMat!: THREE.ShaderMaterial;

  private readonly infectUniforms = {
    uInfect: { value: 0 },
    uPull: { value: 0 },
    uTime: { value: 0 },
    uPortalPos: { value: new THREE.Vector3(-1.723, 1.045, 0.735) },
    uNoiseTex: { value: getSharedNoiseTexture() },
  };

  private readonly colliders: BoxCollider2D[] = [
    // Bed platform & mattress (ModernBed + BedUnit)
    { minX: -2.07, maxX: 1.18, minZ: -2.86, maxZ: -0.20 },
    // Right-side bedside nightstand
    { minX: 1.18, maxX: 1.72, minZ: -2.58, maxZ: -1.88 },
    // PC Desk against -X wall (front edge at X = -1.25)
    { minX: -2.07, maxX: -1.23, minZ: -0.22, maxZ: 1.38 },
    // Office chair pushed slightly aside toward +Z so front of monitor is 100% clear
    { minX: -1.06, maxX: -0.56, minZ: 1.06, maxZ: 1.54 },
    // +X Window counter / bookshelf / stool / storage box
    { minX: 1.98, maxX: 2.85, minZ: -2.25, maxZ: 1.65 },
    { minX: 1.74, maxX: 2.12, minZ: -1.16, maxZ: -0.76 },
  ];

  public async load(gltfLoader: GLTFLoader, texLoader: THREE.TextureLoader): Promise<void> {
    this.scene.background = new THREE.Color(0x03050a);
    this.scene.fog = new THREE.FogExp2(0x050914, 0.045);
    this.scene.add(this.group);

    const [bedroomGltf, pcGltf, chairGltf, cablesGltf, clockTexWebp, lampTexWebp] =
      await Promise.all([
        gltfLoader.loadAsync('/models/bedroom.glb'),
        gltfLoader.loadAsync('/models/gaming_pc.glb'),
        gltfLoader.loadAsync('/models/office_chair.glb'),
        gltfLoader.loadAsync('/models/cables.glb'),
        texLoader.loadAsync('/textures/alarm_clock_diff.webp'),
        texLoader.loadAsync('/textures/desk_lamp_diff.webp'),
      ]);

    clockTexWebp.colorSpace = THREE.SRGBColorSpace;
    lampTexWebp.colorSpace = THREE.SRGBColorSpace;
    applyAssetAnisotropy(clockTexWebp);
    applyAssetAnisotropy(lampTexWebp);

    // 1. Convert Bedroom materials to specular/rim AtmosphericMaterial & inject fast texture-backed infection shader
    const roomRoot = bedroomGltf.scene;
    const matCache = new Map<THREE.Material, THREE.Material>();
    let wallTemplateMat: THREE.MeshLambertMaterial | null = null;

    roomRoot.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const oldMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const newMats = oldMats.map((m) => {
        if (!m) return m;
        let cached = matCache.get(m);
        if (!cached) {
          const mName = m.name || '';
          const isInfectedArch =
            mName.includes('Walls') ||
            mName.includes('Floor') ||
            mName.includes('material_54') || // Rug
            mName.includes('Blanket') ||
            mName.includes('Bedspread') ||
            mName.includes('BedUnit') ||
            mName.includes('Curtain') ||
            mName.includes('RoofWindow') ||
            mName === 'Window' ||
            mName === 'radiator' ||
            mName === 'Stool' ||
            mName === 'material_47';

          if (isInfectedArch) {
            const std = m as THREE.MeshStandardMaterial;
            const lam = new THREE.MeshLambertMaterial({
              name: mName,
              color: std.color ? std.color.clone() : new THREE.Color(0xffffff),
              map: std.map ?? null,
              emissive: std.emissive ? std.emissive.clone() : new THREE.Color(0x000000),
              emissiveMap: std.emissiveMap ?? null,
              emissiveIntensity: std.emissiveIntensity ?? 1,
              transparent: std.transparent ?? false,
              opacity: std.opacity ?? 1,
              alphaTest: std.alphaTest ?? 0,
              side: /Curtain|Window/i.test(mName) ? THREE.DoubleSide : THREE.FrontSide,
            });
            applyAssetAnisotropy(lam.map);
            applyAssetAnisotropy(lam.emissiveMap);
            this.injectRoomInfectionShader(lam);
            cached = lam;
          } else {
            cached = toAtmosphericMaterial(m, { rimColor: 0x3b96ff });
          }

          if (mName === 'Walls') {
            wallTemplateMat = cached as THREE.MeshLambertMaterial;
          }
          matCache.set(m, cached);
        }
        return cached;
      });
      mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
    });
    mergeStaticSubmeshes(roomRoot);
    this.group.add(roomRoot);

    // 2. Enclose cutaway -X wall, +Z wall, flat ceiling, door & nocturnal skyline
    this.buildEnclosedArchitecture(wallTemplateMat);
    this.buildNightExterior();

    // 3. Place Gaming Desktop PC Setup against the -X wall
    const pcRoot = pcGltf.scene;
    pcRoot.position.set(-1.58, 0.73, 0.42);
    pcRoot.scale.setScalar(0.105);
    pcRoot.updateMatrixWorld(true);

    const pcMatCache = new Map<THREE.Material, THREE.Material>();
    let screenNodeFound = false;

    pcRoot.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

      if (obj.name === 'BSOD_SCREEN_NODE' || rawMat?.name === 'BSOD_SCREEN_MAT') {
        const worldScale = new THREE.Vector3();
        mesh.getWorldPosition(this.monitorWorldPos);
        mesh.getWorldQuaternion(this.monitorWorldQuat);
        mesh.getWorldScale(worldScale);

        this.bsodScreen.root.position.copy(this.monitorWorldPos);
        this.bsodScreen.root.quaternion.copy(this.monitorWorldQuat);
        this.bsodScreen.root.scale.copy(worldScale);

        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.monitorWorldQuat);
        this.bsodScreen.root.position.addScaledVector(fwd, 0.003);

        this.inspectLookTarget.copy(this.monitorWorldPos);
        this.inspectCamPos.copy(this.monitorWorldPos).addScaledVector(fwd, 0.66);
        this.inspectCamPos.y += 0.035;

        mesh.visible = false;
        screenNodeFound = true;
        return;
      }

      const oldMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const newMats = oldMats.map((m) => {
        if (!m) return m;
        let cached = pcMatCache.get(m);
        if (!cached) {
          if (m.name === 'Material') {
            const std = m as THREE.MeshStandardMaterial;
            const deskLam = new THREE.MeshLambertMaterial({
              name: m.name,
              color: std.color ? std.color.clone() : new THREE.Color(0xffffff),
              map: std.map ?? null,
              side: THREE.FrontSide,
            });
            this.injectRoomInfectionShader(deskLam);
            cached = deskLam;
          } else {
            cached = toAtmosphericMaterial(m, {
              rimColor: 0x4ca8ff,
              specStrength: 0.36,
              shininess: 48,
            });
          }
          pcMatCache.set(m, cached);
        }
        return cached;
      });
      mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
    });

    if (!screenNodeFound) {
      this.bsodScreen.root.position.copy(this.monitorWorldPos);
      this.bsodScreen.root.rotation.y = Math.PI * 0.5;
      this.bsodScreen.root.scale.set(0.348, 0.365, 0.348);
    }

    mergeStaticSubmeshes(pcRoot, (o) => o.name === 'BSOD_SCREEN_NODE');
    this.infectUniforms.uPortalPos.value.copy(this.monitorWorldPos);
    this.group.add(pcRoot);
    this.group.add(this.bsodScreen.root);

    this.buildDeskLegsAndCables(cablesGltf.scene);

    // 4. Office Chair
    this.officeChair = chairGltf.scene;
    this.officeChair.position.set(-0.82, 0.017, 1.30);
    this.officeChair.scale.setScalar(0.75);
    this.officeChair.rotation.y = -2.25;
    this.officeChair.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        mesh.material = toAtmosphericMaterial(mesh.material as THREE.Material, {
          rimColor: 0x3b96ff,
          specStrength: 0.28,
        });
      }
    });
    this.group.add(this.officeChair);

    // 5. Nocturnal Props, Lighting, 100% GPU Peeling Shards, Relics & Architectural Trim
    this.buildNocturnalProps(clockTexWebp, lampTexWebp);
    this.buildNocturnalLighting();
    this.buildPeelingRoomShards();
    this.buildAftermathRelics();
    this.buildAmbientPracticals();
    this.buildArchitecturalDetail();
  }

  private buildEnclosedArchitecture(wallTemplate: THREE.MeshLambertMaterial | null): void {
    const wallMat = wallTemplate
      ? wallTemplate.clone()
      : new THREE.MeshLambertMaterial({ color: 0x262c38 });
    this.injectRoomInfectionShader(wallMat);

    const trimMat = new THREE.MeshLambertMaterial({ color: 0x161922 });
    this.injectRoomInfectionShader(trimMat);

    const westWall = new THREE.Mesh(new THREE.PlaneGeometry(4.56, 3.16, 10, 6), wallMat);
    westWall.rotation.y = Math.PI * 0.5;
    westWall.position.set(-2.062, 1.59, -0.60);
    this.group.add(westWall);

    const southWall = new THREE.Mesh(new THREE.PlaneGeometry(4.86, 3.16, 10, 6), wallMat);
    southWall.rotation.y = Math.PI;
    southWall.position.set(0.34, 1.59, 1.646);
    this.group.add(southWall);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(4.86, 3.18, 8, 8), wallMat);
    ceiling.rotation.x = Math.PI * 0.5;
    ceiling.position.set(0.34, 3.152, 0.08);
    this.group.add(ceiling);

    // Hallway light crack underneath door on +Z Wall (at X = +1.18)
    const doorCrackGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.018),
      new THREE.MeshBasicMaterial({ color: 0x45608a })
    );
    doorCrackGlow.rotation.y = Math.PI;
    doorCrackGlow.position.set(1.18, 0.029, 1.594);
    this.group.add(doorCrackGlow);
  }

  private buildAmbientPracticals(): void {
    const poolCanvas = document.createElement('canvas');
    poolCanvas.width = 128;
    poolCanvas.height = 128;
    const pctx = poolCanvas.getContext('2d')!;
    const pgrad = pctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    pgrad.addColorStop(0, 'rgba(150,185,255,0.85)');
    pgrad.addColorStop(0.45, 'rgba(90,130,215,0.30)');
    pgrad.addColorStop(1, 'rgba(40,70,140,0)');
    pctx.fillStyle = pgrad;
    pctx.fillRect(0, 0, 128, 128);
    const poolTex = new THREE.CanvasTexture(poolCanvas);
    poolTex.minFilter = THREE.LinearFilter;
    poolTex.generateMipmaps = false;
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 3.2),
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    pool.rotation.x = -Math.PI * 0.5;
    pool.rotation.z = 0.22;
    pool.position.set(1.55, 0.024, -0.55);
    this.group.add(pool);

    const shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: this.infectUniforms.uTime, uInfect: this.infectUniforms.uInfect },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uInfect;
        void main() {
          float across = smoothstep(0.0, 0.55, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
          float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          float shimmer = 0.84 + 0.16 * sin(uTime * 0.6 + vUv.y * 2.0);
          vec3 col = mix(vec3(0.24, 0.42, 0.85), vec3(0.10, 0.28, 0.75), uInfect);
          gl_FragColor = vec4(col, across * along * shimmer * 0.072);
        }
      `,
    });
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.3), shaftMat);
    shaft.position.set(2.22, 1.35, -0.55);
    shaft.rotation.set(0, -Math.PI * 0.5, -0.34);
    this.group.add(shaft);

    // 2:47 AM rain on the window: real wet glass rather than a flat additive streak.
    // Three physically-motivated layers — condensation beads, running drops with trails, and a
    // thin sheet of cold water — each with its own refraction/darkening and specular highlight.
    this.rainGlassMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: this.infectUniforms.uTime,
        uInfect: this.infectUniforms.uInfect,
        uNoiseTex: this.infectUniforms.uNoiseTex,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uInfect;
        uniform sampler2D uNoiseTex;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        // One column of running drops. uv is pane space; uv.y = 1 is the top.
        // Returns: x = head, y = trail. Both 0..1.
        vec2 runColumn(vec2 uv, float cols, float speed, float seed) {
          float cx = uv.x * cols;
          float colId = floor(cx);
          float rnd = hash21(vec2(colId, seed));
          float sp = speed * (0.55 + rnd * 1.05);
          // drop head falls from the top; second, slower drop staggered in the same lane
          float headY = 1.0 - fract(rnd * 7.31 + uTime * sp);
          float headY2 = 1.0 - fract(rnd * 3.17 + 0.42 + uTime * sp * 0.63);
          float lane = fract(cx) - 0.5;
          float wob = sin((1.0 - uv.y) * 26.0 + rnd * 31.0 + uTime * sp * 6.0) * 0.035;
          float dx = lane - wob * 0.11;
          float rad = 0.055 + rnd * 0.05;
          float head = smoothstep(rad, rad * 0.35, length(vec2(dx * 1.15, uv.y - headY)));
          float head2 = smoothstep(rad * 0.8, rad * 0.3, length(vec2(dx * 1.15, uv.y - headY2))) * 0.7;
          head = max(head, head2);
          float dy = uv.y - headY;
          float len = 0.06 + sp * 0.85;
          float trail = step(0.0, dy) * step(dy, len)
                      * smoothstep(len, 0.0, dy)
                      * smoothstep(0.016, 0.004, abs(dx + wob * 0.05))
                      * smoothstep(0.0, 0.05, dy);
          float trail2 = step(0.0, uv.y - headY2) * step(uv.y - headY2, len * 0.7)
                       * smoothstep(len * 0.7, 0.0, uv.y - headY2)
                       * smoothstep(0.013, 0.003, abs(dx - wob * 0.05)) * 0.55;
          return vec2(head, clamp(trail + trail2, 0.0, 1.0));
        }

        void main() {
          vec4 n1 = texture2D(uNoiseTex, vec2(vUv.x * 1.7 + 0.21, vUv.y * 1.1 + uTime * 0.004));
          vec4 n2 = texture2D(uNoiseTex, vec2(vUv.x * 4.3 - 0.11, vUv.y * 2.7 - uTime * 0.009));

          // ---- condensation beads: small static lenses, denser toward the cold glass edges
          vec2 g = vUv * vec2(46.0, 38.0);
          vec2 gid = floor(g);
          vec2 gf = fract(g) - 0.5;
          float gh = hash21(gid);
          vec2 goff = (vec2(hash21(gid + 3.17), hash21(gid + 8.41)) - 0.5) * 0.46;
          float grad = 0.10 + gh * 0.16;
          float beadMask = step(0.34, gh);
          float beadD = length(gf - goff);
          float bead = smoothstep(grad, grad * 0.42, beadD) * beadMask;
          float beadSpec = smoothstep(grad * 0.85, grad * 0.12, length(gf - goff - vec2(-0.16, 0.18) * grad)) * beadMask;

          // ---- running drops: two lanes at different depths
          vec2 runA = runColumn(vUv, 9.0, 0.075, 2.7);
          vec2 runB = runColumn(vUv * vec2(1.33, 1.0) + vec2(0.13, 0.0), 13.0, 0.115, 9.3);

          // ---- water sheet / mist: gives the whole pane a cold, slightly uneven wetness
          float sheet = smoothstep(0.40, 0.78, n1.b * 0.7 + n2.g * 0.45);

          float head = max(runA.x, runB.x * 0.85);
          float trail = max(runA.y, runB.y * 0.8);
          float wet = clamp(head * 1.0 + trail * 0.62 + bead * 0.72 + sheet * 0.10, 0.0, 1.0);
          float spec = clamp(head * 0.95 + beadSpec * 1.15 + trail * 0.22 + sheet * 0.06, 0.0, 1.2);

          // City neon refracted through the beads (cold blue -> magenta / sodium mix).
          vec3 neonA = vec3(0.12, 0.34, 0.72);
          vec3 neonB = vec3(0.62, 0.26, 0.52);
          vec3 neon = mix(neonA, neonB, clamp(n1.r * 1.4 + n2.b * 0.5, 0.0, 1.0));
          neon = mix(neon, vec3(0.06, 0.72, 1.0), 0.25);
          // Infection pushes the whole sheet toward BSOD cyan.
          neon = mix(neon, vec3(0.10, 0.62, 1.0), uInfect * 0.75);

          vec3 col = neon * (0.22 + 0.55 * spec);
          col += vec3(0.80, 0.93, 1.0) * pow(spec, 1.35) * 0.85;
          col = mix(col, vec3(0.012, 0.026, 0.055), (1.0 - spec) * 0.55);
          // faint rim of the sheet catching the monitor's blue
          float edgeVig = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x)
                        * smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
          col += vec3(0.10, 0.28, 0.55) * edgeVig * 0.08;
          float alpha = clamp(wet, 0.0, 1.0) * 0.92 * edgeVig;

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const rainPane = new THREE.Mesh(new THREE.PlaneGeometry(2.15, 1.75), this.rainGlassMat);
    rainPane.rotation.y = -Math.PI * 0.5;
    rainPane.position.set(2.68, 1.62, -0.55);
    rainPane.renderOrder = 3;
    this.group.add(rainPane);

    // Rain beyond the glass: three parallax depths of falling streaks, so the city outside the
    // window lives in weather instead of being a flat clean backdrop.
    const curtainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.infectUniforms.uTime,
        uInfect: this.infectUniforms.uInfect,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uInfect;
        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        float layer(vec2 uv, float cols, float speed, float seed) {
          float cx = uv.x * cols;
          float colId = floor(cx);
          float rnd = hash21(vec2(colId, seed));
          float y = fract(uv.y * 0.55 - uTime * speed * (0.65 + rnd * 0.9) + rnd * 11.0);
          float d = abs(fract(cx) - 0.5);
          float width = 0.05 + rnd * 0.06;
          float body = smoothstep(width, width * 0.2, d);
          float fade = smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.72, y);
          return body * fade * (0.28 + 0.72 * rnd);
        }
        void main() {
          float a = layer(vUv, 26.0, 0.55, 3.1);
          float b = layer(vUv * vec2(1.6, 1.0), 17.0, 0.40, 7.7);
          float c = layer(vUv * vec2(2.4, 1.0), 11.0, 0.28, 12.9);
          vec3 col = vec3(0.55, 0.76, 1.0) * a
                   + vec3(0.40, 0.60, 0.94) * b * 0.85
                   + vec3(0.26, 0.42, 0.80) * c * 0.6;
          col = mix(col, vec3(0.20, 0.72, 1.0), uInfect * 0.6);
          float vertFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          gl_FragColor = vec4(col, 0.34 * vertFade);
        }
      `,
    });
    const rainCurtain = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 5.4), curtainMat);
    rainCurtain.rotation.y = -Math.PI * 0.5;
    rainCurtain.position.set(4.05, 2.05, -0.55);
    rainCurtain.renderOrder = 2;
    this.group.add(rainCurtain);

    // Dead pendant fixture under ceiling rose
    const cordMat = new THREE.MeshLambertMaterial({ color: 0x15181f });
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), cordMat);
    cord.position.set(0.34, 2.935, 0.1);
    this.group.add(cord);

    const shadeMat = new THREE.MeshLambertMaterial({ color: 0x2a2f3c, side: THREE.DoubleSide });
    this.injectRoomInfectionShader(shadeMat);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 12, 1, true), shadeMat);
    shade.position.set(0.34, 2.66, 0.1);
    shade.rotation.x = Math.PI;
    this.group.add(shade);
  }

  private pushBox(
    batch: THREE.BufferGeometry[],
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(1, 1, 1)
      )
    );
    batch.push(geo);
  }

  private buildArchitecturalDetail(): void {
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x2b3140 });
    this.injectRoomInfectionShader(trimMat);
    const panelMat = new THREE.MeshLambertMaterial({ color: 0x232936 });
    this.injectRoomInfectionShader(panelMat);

    const trim: THREE.BufferGeometry[] = [];
    const panels: THREE.BufferGeometry[] = [];

    const WEST_X = -2.055;
    const SOUTH_Z = 1.638;
    const CEIL_Y = 3.145;
    const CHAIR_RAIL_Y = 0.94;

    for (let i = 0; i < 7; i++) {
      const z0 = -2.72 + i * 0.62;
      const ph = 0.62;
      const pw = 0.5;
      const pz = z0 + 0.31;
      this.pushBox(panels, 0.018, ph, 0.045, WEST_X + 0.012, 0.52, pz - pw * 0.5);
      this.pushBox(panels, 0.018, ph, 0.045, WEST_X + 0.012, 0.52, pz + pw * 0.5);
      this.pushBox(panels, 0.018, 0.045, pw, WEST_X + 0.012, 0.52 + ph * 0.5, pz);
      this.pushBox(panels, 0.018, 0.045, pw, WEST_X + 0.012, 0.52 - ph * 0.5, pz);
      this.pushBox(panels, 0.010, ph - 0.09, pw - 0.09, WEST_X + 0.005, 0.52, pz);
    }
    this.pushBox(trim, 0.05, 0.055, 4.6, WEST_X + 0.028, CHAIR_RAIL_Y, -0.6);
    this.pushBox(trim, 0.07, 0.022, 4.6, WEST_X + 0.036, CHAIR_RAIL_Y - 0.036, -0.6);
    this.pushBox(trim, 0.026, 0.115, 4.6, WEST_X + 0.015, 0.058, -0.6);
    this.pushBox(trim, 0.045, 0.018, 4.6, WEST_X + 0.023, 0.118, -0.6);
    this.pushBox(trim, 0.055, 0.05, 4.6, WEST_X + 0.028, CEIL_Y - 0.035, -0.6);
    this.pushBox(trim, 0.085, 0.03, 4.6, WEST_X + 0.042, CEIL_Y - 0.082, -0.6);

    for (let i = 0; i < 7; i++) {
      const x0 = -2.0 + i * 0.62;
      const ph = 0.62;
      const pw = 0.5;
      const px = x0 + 0.31;
      if (px > 0.62 && px < 1.76) continue;
      this.pushBox(panels, 0.045, ph, 0.018, px - pw * 0.5, 0.52, SOUTH_Z - 0.012);
      this.pushBox(panels, 0.045, ph, 0.018, px + pw * 0.5, 0.52, SOUTH_Z - 0.012);
      this.pushBox(panels, pw, 0.045, 0.018, px, 0.52 + ph * 0.5, SOUTH_Z - 0.012);
      this.pushBox(panels, pw, 0.045, 0.018, px, 0.52 - ph * 0.5, SOUTH_Z - 0.012);
      this.pushBox(panels, pw - 0.09, ph - 0.09, 0.010, px, 0.52, SOUTH_Z - 0.005);
    }
    this.pushBox(trim, 4.9, 0.055, 0.05, 0.34, CHAIR_RAIL_Y, SOUTH_Z - 0.028);
    this.pushBox(trim, 4.9, 0.022, 0.07, 0.34, CHAIR_RAIL_Y - 0.036, SOUTH_Z - 0.036);
    this.pushBox(trim, 4.9, 0.115, 0.026, 0.34, 0.058, SOUTH_Z - 0.015);
    this.pushBox(trim, 4.9, 0.018, 0.045, 0.34, 0.118, SOUTH_Z - 0.023);
    this.pushBox(trim, 4.9, 0.05, 0.055, 0.34, CEIL_Y - 0.035, SOUTH_Z - 0.028);
    this.pushBox(trim, 4.9, 0.03, 0.085, 0.34, CEIL_Y - 0.082, SOUTH_Z - 0.042);

    this.pushBox(trim, 4.9, 0.055, 0.05, 0.34, CEIL_Y - 0.035, -1.52);
    this.pushBox(trim, 0.05, 0.055, 2.4, 2.66, CEIL_Y - 0.035, 0.06);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.pushBox(trim, 0.085, 0.014, 0.26, 0.34 + Math.cos(a) * 0.42, CEIL_Y - 0.012, 0.1 + Math.sin(a) * 0.42, 0, -a, 0);
    }

    // Include the door leaf & casing directly into trim batch to save another draw call!
    const DOOR_X = 1.18;
    this.pushBox(trim, 0.075, 2.16, 0.055, DOOR_X - 0.49, 1.08, SOUTH_Z - 0.03);
    this.pushBox(trim, 0.075, 2.16, 0.055, DOOR_X + 0.49, 1.08, SOUTH_Z - 0.03);
    this.pushBox(trim, 1.05, 0.075, 0.055, DOOR_X, 2.19, SOUTH_Z - 0.03);
    this.pushBox(trim, 1.14, 0.035, 0.075, DOOR_X, 2.245, SOUTH_Z - 0.04);
    this.pushBox(panels, 0.9, 2.1, 0.05, DOOR_X, 1.06, SOUTH_Z - 0.012);
    this.pushBox(trim, 0.62, 0.9, 0.014, DOOR_X, 1.62, SOUTH_Z - 0.042);
    this.pushBox(trim, 0.62, 0.72, 0.014, DOOR_X, 0.55, SOUTH_Z - 0.042);
    this.pushBox(trim, 0.98, 0.022, 0.09, DOOR_X, 0.012, SOUTH_Z - 0.02);

    if (trim.length) {
      const merged = mergeGeometries(trim, false);
      if (merged) this.group.add(new THREE.Mesh(merged, trimMat));
      for (const g of trim) g.dispose();
    }
    if (panels.length) {
      const merged = mergeGeometries(panels, false);
      if (merged) this.group.add(new THREE.Mesh(merged, panelMat));
      for (const g of panels) g.dispose();
    }

    const handleMat = new THREE.MeshBasicMaterial({ color: 0x8d9aae });
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.028), handleMat);
    lever.position.set(DOOR_X - 0.33, 1.02, SOUTH_Z - 0.055);
    this.group.add(lever);

    // Merged contact shadows (1 single draw call instead of 4!)
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.38)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const shadowSpots: Array<[number, number, number, number]> = [
      [0.34, -1.5, 3.4, 2.9],
      [-1.62, 0.6, 1.2, 2.2],
      [-0.82, 1.3, 1.0, 1.0],
      [1.42, -2.2, 0.9, 1.2],
    ];
    const shadowGeos: THREE.BufferGeometry[] = [];
    for (const [x, z, w, d] of shadowSpots) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI * 0.5);
      g.translate(x, 0.022, z);
      shadowGeos.push(g);
    }
    const mergedShadows = mergeGeometries(shadowGeos, false);
    for (const g of shadowGeos) g.dispose();
    if (mergedShadows) {
      const sm = new THREE.Mesh(mergedShadows, shadowMat);
      sm.renderOrder = 1;
      this.group.add(sm);
    }
  }

  private buildNightExterior(): void {
    const skyMat = new THREE.ShaderMaterial({
      depthWrite: false,
      fog: false,
      uniforms: { uInfect: this.infectUniforms.uInfect, uTime: this.infectUniforms.uTime },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uInfect;
        uniform float uTime;
        float h21(vec2 p) {
          p = fract(p * vec2(443.897, 441.423));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }
        void main() {
          float h = clamp(vUv.y, 0.0, 1.0);
          vec3 horizon = vec3(0.055, 0.085, 0.16);
          vec3 zenith = vec3(0.008, 0.014, 0.038);
          vec3 col = mix(horizon, zenith, pow(h, 0.65));

          vec2 moon = vec2(0.30, 0.34);
          float d = length((vUv - moon) * vec2(1.0, 0.78));
          col += vec3(0.55, 0.68, 0.92) * exp(-d * 34.0) * 0.55;
          col += vec3(0.86, 0.92, 1.0) * smoothstep(0.016, 0.006, d) * 0.9;

          vec2 cell = floor(vUv * 90.0);
          float star = step(0.9955, h21(cell));
          col += vec3(0.75, 0.85, 1.0) * star * smoothstep(0.25, 0.9, h) * (0.6 + 0.4 * sin(uTime * 2.0 + cell.x));

          col = mix(col, vec3(0.02, 0.10, 0.28), clamp(uInfect, 0.0, 1.0) * 0.8);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), skyMat);
    skyBackdrop.rotation.y = -Math.PI * 0.5;
    skyBackdrop.position.set(5.4, 2.4, -0.6);
    this.group.add(skyBackdrop);

    const layerSpec: Array<{ x: number; tint: number; count: number; hMin: number; hMax: number; wMin: number; wMax: number; seed: number }> = [
      { x: 5.0, tint: 0x0a1428, count: 14, hMin: 1.4, hMax: 5.2, wMin: 0.34, wMax: 0.85, seed: 11 },
      { x: 4.4, tint: 0x070f20, count: 10, hMin: 1.0, hMax: 3.6, wMin: 0.4, wMax: 0.95, seed: 29 },
      { x: 3.9, tint: 0x050b18, count: 7, hMin: 0.8, hMax: 2.4, wMin: 0.5, wMax: 1.1, seed: 47 },
    ];

    let seedCounter = 0;
    const allWins: THREE.BufferGeometry[] = [];
    for (const layer of layerSpec) {
      const batch: THREE.BufferGeometry[] = [];
      let cursor = -4.2;
      for (let i = 0; i < layer.count; i++) {
        const rnd = (n: number) => Math.abs(Math.sin((seedCounter + n) * 12.9898 + layer.seed) * 43758.5453) % 1;
        const w = layer.wMin + rnd(1) * (layer.wMax - layer.wMin);
        const h = layer.hMin + rnd(2) * (layer.hMax - layer.hMin);
        const z = cursor + w * 0.5;
        cursor += w + 0.1 + rnd(3) * 0.25;
        seedCounter++;

        this.pushBox(batch, 0.3, h, w, layer.x, h * 0.5 - 0.35, z);
        const rows = Math.max(2, Math.floor(h / 0.44));
        const cols = Math.max(2, Math.floor(w / 0.18));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const lit = Math.abs(Math.sin((r * 37 + c * 91 + seedCounter * 13 + layer.seed) * 0.7)) % 1;
            if (lit < 0.74) continue;
            const wy = 0.16 + r * 0.44;
            if (wy > h - 0.35) continue;
            const wz = z - w * 0.5 + 0.09 + c * 0.18;
            const wg = new THREE.PlaneGeometry(0.055, 0.075);
            wg.applyMatrix4(
              new THREE.Matrix4().compose(
                new THREE.Vector3(layer.x - 0.16, wy, wz),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI * 0.5, 0)),
                new THREE.Vector3(1, 1, 1)
              )
            );
            allWins.push(wg);
          }
        }
      }

      const bodyMat = new THREE.MeshBasicMaterial({ color: layer.tint });
      const mergedBody = mergeGeometries(batch, false);
      if (mergedBody) this.group.add(new THREE.Mesh(mergedBody, bodyMat));
      for (const g of batch) g.dispose();
    }

    if (allWins.length) {
      const mergedWin = mergeGeometries(allWins, false);
      for (const g of allWins) g.dispose();
      if (mergedWin) {
        this.group.add(
          new THREE.Mesh(
            mergedWin,
            new THREE.MeshBasicMaterial({
              color: 0x8cb8e4,
              transparent: true,
              opacity: 0.78,
              depthWrite: false,
            })
          )
        );
      }
    }
  }

  private buildDeskLegsAndCables(cablesTemplate: THREE.Object3D): void {
    const legMat = new THREE.MeshLambertMaterial({ color: 0x12151c });
    const legBatch: THREE.BufferGeometry[] = [];
    const legCoords = [
      [-1.98, -0.14],
      [-1.30, -0.14],
      [-1.98, 1.30],
      [-1.30, 1.30],
    ];
    for (const [lx, lz] of legCoords) {
      this.pushBox(legBatch, 0.045, 0.70, 0.045, lx, 0.365, lz);
    }
    const mergedLegs = mergeGeometries(legBatch, false);
    for (const g of legBatch) g.dispose();
    if (mergedLegs) this.group.add(new THREE.Mesh(mergedLegs, legMat));

    cablesTemplate.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = toAtmosphericMaterial((o as THREE.Mesh).material as THREE.Material);
      }
    });
    const cable1 = cablesTemplate.clone(true);
    cable1.position.set(-1.82, 0.72, 0.36);
    cable1.rotation.set(0.3, Math.PI * 0.5, 0.45);
    cable1.scale.setScalar(0.62);
    this.group.add(cable1);
  }

  private buildNocturnalProps(clockTexWebp: THREE.Texture, lampTexWebp: THREE.Texture): void {
    const lampMat = new THREE.MeshLambertMaterial({ map: lampTexWebp, color: 0x9aa4b8 });
    const lampGroup = new THREE.Group();
    lampGroup.position.set(-1.74, 0.756, 1.20);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.02, 12), lampMat);
    lampGroup.add(lampBase);

    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.32, 8), lampMat);
    lampStem.position.set(-0.02, 0.16, 0);
    lampStem.rotation.z = -0.18;
    lampGroup.add(lampStem);

    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.12, 12, 1, true),
      new THREE.MeshLambertMaterial({ map: lampTexWebp, color: 0x7e8799, side: THREE.DoubleSide })
    );
    lampShade.position.set(0.04, 0.30, -0.02);
    lampShade.rotation.z = 0.45;
    lampGroup.add(lampShade);

    this.deskLampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffcf87 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), this.deskLampBulbMat);
    bulb.position.set(0.045, 0.275, -0.02);
    lampGroup.add(bulb);
    this.group.add(lampGroup);

    const mugMat = toAtmosphericMaterial(
      new THREE.MeshStandardMaterial({ color: 0xd8dde8, roughness: 0.22, metalness: 0.05 }),
      { rimColor: 0x62b4ff }
    );
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.092, 12), mugMat);
    mug.position.set(-1.38, 0.802, 1.06);
    this.group.add(mug);

    // Bedside Digital Alarm Clock
    this.clockCanvas = document.createElement('canvas');
    this.clockCanvas.width = 256;
    this.clockCanvas.height = 128;
    this.clockTex = new THREE.CanvasTexture(this.clockCanvas);
    this.clockTex.colorSpace = THREE.SRGBColorSpace;
    this.clockTex.generateMipmaps = false;
    this.clockTex.minFilter = THREE.LinearFilter;
    this.updateClockDisplay('02:47', false);

    const clockBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.065, 0.16),
      new THREE.MeshLambertMaterial({ map: clockTexWebp, color: 0x333844 })
    );
    clockBody.position.copy(this.clockSoundPos);
    clockBody.rotation.y = 0.42;
    const clockFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.135, 0.05),
      new THREE.MeshBasicMaterial({ map: this.clockTex })
    );
    clockFace.rotation.y = Math.PI * 0.5;
    clockFace.position.set(0.056, 0.004, 0);
    clockBody.add(clockFace);
    this.group.add(clockBody);
  }

  private updateClockDisplay(timeStr: string, glitching: boolean): void {
    const key = `${timeStr}_${glitching ? 1 : 0}`;
    if (key === this.lastClockText) return;
    this.lastClockText = key;

    const ctx = this.clockCanvas.getContext('2d')!;
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = glitching ? '#38a8ff' : '#ff3b3b';
    ctx.font = 'bold 66px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeStr, 128, 66);
    this.clockTex.needsUpdate = true;
  }

  private buildNocturnalLighting(): void {
    // Rich nocturnal moonlight + bounce baked into 1 HemisphereLight (cuts PointLight count by 33%!)
    this.hemiLight = new THREE.HemisphereLight(0x365694, 0x090d18, 0.86);
    this.group.add(this.hemiLight);

    this.deskLampLight = new THREE.PointLight(0xffb469, 0.58, 2.6, 1.8);
    this.deskLampLight.position.set(-1.68, 1.0, 1.18);
    this.group.add(this.deskLampLight);

    // Cinematic Volumetric Monitor Light Shaft
    const beamLen = 1.95;
    const beamGeo = new THREE.CylinderGeometry(0.24, 0.80, beamLen, 20, 1, true);
    beamGeo.rotateZ(-Math.PI * 0.5);
    beamGeo.translate(beamLen * 0.5 + 0.02, -0.04, 0);

    this.monitorBeamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uIntensity;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float edgeSoft = pow(abs(dot(normalize(vNormalW), viewDir)), 1.65);
          float along = smoothstep(1.95, 0.05, vWorldPos.x - (-1.72));
          float camDistFade = smoothstep(0.62, 1.25, length(cameraPosition - vec3(-1.72, 1.05, 0.735)));
          float scan = 0.92 + 0.08 * sin(vWorldPos.y * 38.0 - uTime * 7.0);
          float alpha = edgeSoft * along * camDistFade * 0.095 * uIntensity * scan;
          gl_FragColor = vec4(0.05, 0.44, 0.98, alpha);
        }
      `,
    });
    this.monitorBeamMesh = new THREE.Mesh(beamGeo, this.monitorBeamMat);
    this.monitorBeamMesh.position.copy(this.monitorWorldPos);
    this.group.add(this.monitorBeamMesh);

    // Floating nocturnal dust motes caught in the monitor's blue glow
    const dustCount = 72;
    const dPos = new Float32Array(dustCount * 3);
    const dSeed = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      dPos[i * 3 + 0] = -1.65 + Math.random() * 1.9;
      dPos[i * 3 + 1] = 0.55 + Math.random() * 1.25;
      dPos[i * 3 + 2] = 0.05 + Math.random() * 1.35;
      dSeed[i] = Math.random() * 100.0;
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));
    this.roomDustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPull: { value: 0 },
        uPortal: { value: this.monitorWorldPos },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPull;
        uniform vec3 uPortal;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.35 + aSeed) * 0.06;
          p.y += mod(uTime * 0.035 + aSeed * 0.1, 0.9) - 0.45;
          p.z += cos(uTime * 0.31 + aSeed * 1.3) * 0.06;
          if (uPull > 0.01) {
            float t = fract(uTime * (0.8 + uPull * 2.5) + fract(aSeed));
            p = mix(p, uPortal, t * clamp(uPull * 1.5, 0.0, 1.0));
          }
          float dMon = distance(p, uPortal);
          vAlpha = smoothstep(2.1, 0.25, dMon) * (0.35 + 0.65 * sin(uTime * 1.8 + aSeed));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(5.5 / max(0.4, -mv.z), 1.2, 3.8);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float soft = smoothstep(0.5, 0.05, length(c));
          gl_FragColor = vec4(0.42, 0.78, 1.0, soft * vAlpha * 0.55);
        }
      `,
    });
    this.group.add(new THREE.Points(dGeo, this.roomDustMat));
  }

  /**
   * 100% GPU-Animated Peeling Room Memory Shards (0.0ms CPU overhead, zero per-frame matrix uploads!)
   */
  private buildPeelingRoomShards(): void {
    const shardGeo = new THREE.BoxGeometry(0.18, 0.13, 0.014);
    const origins = new Float32Array(PEEL_SHARD_COUNT * 4);
    const meta = new Float32Array(PEEL_SHARD_COUNT * 3);

    for (let i = 0; i < PEEL_SHARD_COUNT; i++) {
      const zone = i % 4;
      let ox = 0, oy = 0, oz = 0;
      if (zone === 0) {
        ox = -2.02; oy = 0.3 + Math.random() * 2.6; oz = -1.8 + Math.random() * 3.2;
      } else if (zone === 1) {
        ox = -1.6 + Math.random() * 3.6; oy = 3.08; oz = -1.3 + Math.random() * 2.7;
      } else if (zone === 2) {
        ox = -1.5 + Math.random() * 3.2; oy = 0.05; oz = -0.4 + Math.random() * 1.9;
      } else {
        ox = -1.6 + Math.random() * 3.6; oy = 0.4 + Math.random() * 2.5; oz = 1.58;
      }
      origins[i * 4 + 0] = ox;
      origins[i * 4 + 1] = oy;
      origins[i * 4 + 2] = oz;
      origins[i * 4 + 3] = Math.random() * 0.45; // delay

      meta[i * 3 + 0] = 0.7 + Math.random() * 0.9; // speed
      meta[i * 3 + 1] = 0.6 + Math.random() * 1.6; // scale
      meta[i * 3 + 2] = i % 5 === 0 ? 1.0 : 0.0; // bright flag
    }
    shardGeo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 4));
    shardGeo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 3));

    this.peelShardMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInfect: { value: 0 },
        uPull: { value: 0 },
        uPortal: { value: this.monitorWorldPos },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aOrigin;
        attribute vec3 aMeta;
        uniform float uTime;
        uniform float uInfect;
        uniform float uPull;
        uniform vec3 uPortal;
        varying float vBright;
        void main() {
          vBright = aMeta.z;
          float intensity = clamp((uInfect - 0.20) / 0.80, 0.0, 1.0);
          float localP = clamp(fract(intensity * 1.15 + uPull * 0.95 + uTime * 0.28 * aMeta.x - aOrigin.w), 0.0, 1.0);
          float gate = step(0.21, uInfect);
          float shrink = (1.0 - smoothstep(0.76, 1.0, localP)) * smoothstep(0.0, 0.08, localP) * gate;

          float a = uTime * (1.8 + aMeta.x * 2.0) + aOrigin.w * 20.0;
          float ca = cos(a), sa = sin(a);
          vec3 lp = position * aMeta.y * shrink;
          vec3 rotP = vec3(lp.x * ca - lp.y * sa, lp.x * sa + lp.y * ca, lp.z);

          // Spiral vortex orbit into the monitor mouth!
          vec3 worldCenter = mix(aOrigin.xyz, uPortal, localP * localP);
          worldCenter.y += sin(uTime * 4.0 + aOrigin.w * 30.0) * 0.16 * localP * (1.0 - localP);
          worldCenter.z += cos(uTime * 3.5 + aOrigin.x * 5.0) * 0.14 * localP * (1.0 - localP);

          gl_Position = projectionMatrix * viewMatrix * vec4(worldCenter + rotP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBright;
        void main() {
          vec3 col = mix(vec3(0.0, 0.44, 0.86), vec3(0.84, 0.95, 1.0), vBright);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.peelShards = new THREE.InstancedMesh(shardGeo, this.peelShardMat, PEEL_SHARD_COUNT);
    this.peelShards.frustumCulled = false;
    this.peelShards.visible = false;
    this.group.add(this.peelShards);
  }

  private buildAftermathRelics(): void {
    this.aftermathRelicGroup.visible = false;

    const shardMat = new THREE.MeshBasicMaterial({ color: 0x52b8ff });
    const crystalPositions = [
      { pos: [-1.42, 0.766, 0.78], rot: [0.2, 0.6, 0.1], s: [0.065, 0.008, 0.045] },
      { pos: [-1.36, 0.765, 0.69], rot: [-0.1, 1.3, 0.2], s: [0.045, 0.007, 0.032] },
      { pos: [-1.47, 0.767, 0.64], rot: [0.4, -0.4, 0.15], s: [0.038, 0.012, 0.028] },
      { pos: [0.42, 0.025, 0.25], rot: [0.05, 0.9, 0.02], s: [0.055, 0.006, 0.038] },
    ];
    const batch: THREE.BufferGeometry[] = [];
    for (const c of crystalPositions) {
      this.pushBox(batch, c.s[0], c.s[1], c.s[2], c.pos[0], c.pos[1], c.pos[2], c.rot[0], c.rot[1], c.rot[2]);
    }
    const merged = mergeGeometries(batch, false);
    for (const g of batch) g.dispose();
    if (merged) this.aftermathRelicGroup.add(new THREE.Mesh(merged, shardMat));

    this.group.add(this.aftermathRelicGroup);
  }

  /**
   * Ultra-fast texture-backed Room Surface Craft + BSOD Circuit/Vein Infection Shader!
   * Uses 2 bilinear fetches from uNoiseTex instead of 28 per-pixel hash calls (~8x faster GPU ALU!).
   */
  private injectRoomInfectionShader(mat: THREE.Material): void {
    if (mat.userData.bsodInfected) return;
    mat.userData.bsodInfected = true;

    mat.customProgramCacheKey = () => 'bsod_lambert_infect_v4';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uInfect = this.infectUniforms.uInfect;
      shader.uniforms.uPull = this.infectUniforms.uPull;
      shader.uniforms.uTime = this.infectUniforms.uTime;
      shader.uniforms.uPortalPos = this.infectUniforms.uPortalPos;
      shader.uniforms.uNoiseTex = this.infectUniforms.uNoiseTex;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vBsodWorldPos;
          varying float vBsodWallAmt;
          varying float vBsodMonGlint;
          uniform float uInfect;
          uniform float uPull;
          uniform float uTime;
          uniform vec3 uPortalPos;
          `
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `
          vec4 bsodWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            bsodWp = instanceMatrix * bsodWp;
          #endif
          bsodWp = modelMatrix * bsodWp;

          if (uPull > 0.002) {
            vec3 toMonP = uPortalPos - bsodWp.xyz;
            float dMonP = length(toMonP);
            float cell = sin(bsodWp.x * 8.0 + uTime * 3.0) * cos(bsodWp.y * 8.0 - bsodWp.z * 7.0);
            float pullAmt = uPull * smoothstep(5.2, 0.35, dMonP) * (0.55 + 0.45 * cell);
            bsodWp.xyz += normalize(toMonP + vec3(0.0001)) * pullAmt * min(dMonP * 0.85, 2.25);
            bsodWp.y += sin(dMonP * 5.0 - uTime * 9.0) * 0.09 * uPull;
          }

          vBsodWorldPos = bsodWp.xyz;
          vec3 bsodN = objectNormal;
          #ifdef USE_INSTANCING
            bsodN = mat3(instanceMatrix) * bsodN;
          #endif
          vec3 wnrmV = normalize(mat3(modelMatrix) * bsodN);
          vBsodWallAmt = 1.0 - smoothstep(0.32, 0.72, abs(wnrmV.y));

          // Compute monitor specular glint IN VERTEX SHADER (eliminates 4 normalize + pow per pixel!)
          vec3 toCamV = normalize(cameraPosition - bsodWp.xyz);
          vec3 toMonV = uPortalPos - bsodWp.xyz;
          float dMonV = length(toMonV);
          vec3 hMonV = normalize(toCamV + toMonV / max(dMonV, 0.001));
          vBsodMonGlint = pow(max(dot(wnrmV, hMonV), 0.0), 24.0) * smoothstep(3.6, 0.4, dMonV) * 0.36;

          vec4 mvPosition = viewMatrix * bsodWp;
          gl_Position = projectionMatrix * mvPosition;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vBsodWorldPos;
          varying float vBsodWallAmt;
          varying float vBsodMonGlint;
          uniform float uInfect;
          uniform float uPull;
          uniform float uTime;
          uniform vec3 uPortalPos;
          uniform sampler2D uNoiseTex;
          `
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          {
            vec3 wp = vBsodWorldPos;
            float wallAmt = vBsodWallAmt;
            float uAxis = wp.x + wp.z;

            // Single bilinear fetch in calm bedroom (R = coarse FBM, G = fine grain)!
            vec4 nCoarse = texture2D(uNoiseTex, vec2(uAxis * 0.28, wp.y * 0.28));

            float stripe = smoothstep(0.40, 0.50, abs(fract(uAxis * 1.92) - 0.5)) * wallAmt;
            float floorAO = smoothstep(0.52, 0.0, wp.y) * wallAmt;
            float ceilAO = smoothstep(2.58, 3.15, wp.y) * wallAmt;

            gl_FragColor.rgb *= 1.0 - (nCoarse.g - 0.5) * 0.07 + (nCoarse.r - 0.5) * 0.11 + stripe * 0.055;
            gl_FragColor.rgb *= 1.0 - (floorAO * 0.40 + ceilAO * 0.32);
            gl_FragColor.rgb += vec3(0.05, 0.26, 0.62) * vBsodMonGlint;

            if (uInfect > 0.002) {
              vec4 nFine = texture2D(uNoiseTex, vec2(uAxis * 1.45, wp.y * 1.45 + wp.z * 0.35));
              float dMon = distance(wp, uPortalPos);
              vec3 q = floor(wp * 12.0);
              float cellHash = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              float waveRadius = uInfect * 6.8;
              float front = waveRadius - dMon + (nCoarse.r - 0.5) * 0.95;

              float veinFront = smoothstep(-1.35, 0.15, front) * smoothstep(0.02, 0.18, uInfect);
              float veinLine = smoothstep(0.085, 0.0, nFine.a) * veinFront;
              gl_FragColor.rgb += vec3(0.18, 0.72, 1.0) * veinLine * (0.65 + 0.55 * sin(uTime * 10.0 - dMon * 4.0));

              float mask = smoothstep(-0.16, 0.22, front) * smoothstep(0.02, 0.25, uInfect);
              float edgeBand = smoothstep(0.30, 0.0, abs(front)) * step(0.03, uInfect);

              vec3 gridF = abs(fract(wp * 6.0) - 0.5);
              float gridLine = step(0.46, max(gridF.x, max(gridF.y, gridF.z)));
              float scanPulse = 0.86 + 0.14 * sin(wp.y * 42.0 - uTime * 16.0);
              vec3 bsodCol = vec3(0.0, 0.175, 0.60) * scanPulse;

              vec2 wallCell = fract(vec2(uAxis, wp.y) * 2.4) - 0.5;
              float blink = step(0.12, fract(uTime * 0.65 + cellHash * 7.3));
              float wEyeL = smoothstep(0.08, 0.035, length(wallCell - vec2(-0.12, 0.06)));
              float wEyeR = smoothstep(0.08, 0.035, length(wallCell - vec2(0.12, 0.06)));
              float wallEyes = (wEyeL + wEyeR) * step(0.76, cellHash) * blink * smoothstep(0.32, 0.72, uInfect);

              bsodCol = mix(bsodCol, vec3(0.85, 0.95, 1.0), gridLine * 0.55 + step(0.94, cellHash) * 0.4);
              bsodCol += vec3(1.0, 0.22, 0.30) * wallEyes * 1.35;

              gl_FragColor.rgb = mix(gl_FragColor.rgb, bsodCol, mask * 0.95);
              gl_FragColor.rgb += vec3(0.44, 0.82, 1.0) * edgeBand * 0.92;
            }
          }
          `
        );
    };
  }

  /** Enables all deferred/cutscene sub-groups for 1 offscreen warmup frame at boot! */
  public setWarmupVisibility(active: boolean): void {
    this.peelShards.visible = active;
    this.aftermathRelicGroup.visible = active;
    this.bsodScreen.setWarmupVisibility(active);
  }

  public setAftermathMode(aftermath: boolean): void {
    this.aftermathRelicGroup.visible = aftermath;
    if (this.officeChair) {
      if (aftermath) {
        this.officeChair.position.set(-0.78, 0.017, 1.18);
        this.officeChair.rotation.y = 1.15;
      } else {
        this.officeChair.position.set(-0.82, 0.017, 1.30);
        this.officeChair.rotation.y = -2.25;
      }
    }
    this.updateClockDisplay(aftermath ? '02:48' : '02:47', aftermath);
  }

  public resolvePlayerCollision(pos: THREE.Vector3, radius = 0.26): void {
    pos.x = THREE.MathUtils.clamp(pos.x, -2.02 + radius, 2.68 - radius);
    pos.z = THREE.MathUtils.clamp(pos.z, -2.80 + radius, 1.60 - radius);

    for (const box of this.colliders) {
      const closestX = THREE.MathUtils.clamp(pos.x, box.minX, box.maxX);
      const closestZ = THREE.MathUtils.clamp(pos.z, box.minZ, box.maxZ);
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        } else {
          const penLeft = Math.abs(pos.x - box.minX);
          const penRight = Math.abs(box.maxX - pos.x);
          const penBack = Math.abs(pos.z - box.minZ);
          const penFront = Math.abs(pos.z - box.maxZ);
          const m = Math.min(penLeft, penRight, penBack, penFront);
          if (m === penFront) pos.z = box.maxZ + radius;
          else if (m === penBack) pos.z = box.minZ - radius;
          else if (m === penRight) pos.x = box.maxX + radius;
          else pos.x = box.minX - radius;
        }
      }
    }
  }

  public getFloorSurface(x: number, z: number): 'wood' | 'rug' {
    if (x > -1.55 && x < 1.32 && z > -1.75 && z < 1.12) {
      return 'rug';
    }
    return 'wood';
  }

  public update(
    dt: number,
    elapsed: number,
    infectLevel: number,
    pullLevel: number,
    aftermath: boolean,
    playerPos?: THREE.Vector3
  ): void {
    this.infectUniforms.uInfect.value = infectLevel;
    this.infectUniforms.uPull.value = pullLevel;
    this.infectUniforms.uTime.value = aftermath ? elapsed * 0.08 : elapsed;

    this.monitorBeamMat.uniforms.uTime.value = elapsed;
    this.monitorBeamMat.uniforms.uIntensity.value = aftermath ? 0.22 : 1.0 + infectLevel * 1.4;
    this.monitorBeamMesh.visible = pullLevel < 0.75;

    this.roomDustMat.uniforms.uTime.value = aftermath ? elapsed * 0.12 : elapsed;
    this.roomDustMat.uniforms.uPull.value = pullLevel;

    if (aftermath) {
      this.deskLampLight.intensity = 0.06;
      this.deskLampBulbMat.color.setHex(0x28221e);
      this.hemiLight.intensity = 0.56;
      // Bedside digital clock occasionally twitches from 02:48 to '  :)'!
      const smileClock = Math.sin(elapsed * 1.37) > 0.96;
      this.updateClockDisplay(smileClock ? '  :)' : '02:48', true);
      if (this.officeChair) {
        // Uncanny aftermath detail: the empty office chair slowly swivels on its own to keep facing you!
        if (playerPos) {
          const targetYaw = Math.atan2(
            playerPos.x - this.officeChair.position.x,
            playerPos.z - this.officeChair.position.z
          );
          let delta = targetYaw - this.officeChair.rotation.y;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          this.officeChair.rotation.y += delta * Math.min(1, dt * 1.15);
        } else {
          this.officeChair.rotation.y = 1.15 + Math.sin(elapsed * 0.9) * 0.045;
        }
      }
    } else if (infectLevel < 0.25) {
      const flicker = 1 - infectLevel * 1.4 * Math.abs(Math.sin(elapsed * 29.0));
      this.deskLampLight.intensity = 0.58 * Math.max(0.1, flicker);
      this.deskLampBulbMat.color.setHex(0xffcf87);
      this.hemiLight.intensity = 0.72;
      this.updateClockDisplay('02:47', false);
    } else {
      const snapOff = infectLevel > 0.48 ? 0.0 : 0.28 * (Math.sin(elapsed * 52.0) > 0.2 ? 1 : 0);
      this.deskLampLight.intensity = snapOff;
      this.deskLampBulbMat.color.setHex(snapOff > 0.05 ? 0x88c8ff : 0x0b1628);
      this.hemiLight.intensity = 0.72 + infectLevel * 0.45;
      this.updateClockDisplay(infectLevel > 0.6 ? '88:88' : '02:47', true);
      if (this.officeChair) {
        this.officeChair.rotation.y = -2.25 + Math.sin(elapsed * 34.0) * 0.04 * infectLevel;
      }
    }

    const showPeel = infectLevel > 0.21;
    this.peelShards.visible = showPeel;
    if (showPeel) {
      this.peelShardMat.uniforms.uTime.value = elapsed;
      this.peelShardMat.uniforms.uInfect.value = infectLevel;
      this.peelShardMat.uniforms.uPull.value = pullLevel;
    }
  }
}
