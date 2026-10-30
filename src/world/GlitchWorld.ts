import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toFastLambert } from './BedroomScene';
import { getSharedNoiseTexture } from '../utils/ProceduralNoise';

const FLOATING_SHARD_COUNT = 120;
const ABYSS_DEBRIS_COUNT = 96;
const ABYSS_STREAK_COUNT = 160;

function addInstancedGltf(
  parent: THREE.Object3D,
  template: THREE.Object3D,
  matrices: THREE.Matrix4[],
  overrideMatFn?: (mat: THREE.Material) => THREE.Material
): void {
  if (matrices.length === 0) return;
  template.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(template.matrixWorld).invert();

  template.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const relMat = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
    const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const mat = overrideMatFn ? overrideMatFn(rawMat) : toFastLambert(rawMat);

    const inst = new THREE.InstancedMesh(mesh.geometry, mat, matrices.length);
    const finalM = new THREE.Matrix4();
    for (let i = 0; i < matrices.length; i++) {
      finalM.multiplyMatrices(matrices[i], relMat);
      inst.setMatrixAt(i, finalM);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    parent.add(inst);
  });
}

export class GlitchWorld {
  public readonly scene = new THREE.Scene();
  public readonly group = new THREE.Group();
  public readonly corePosition = new THREE.Vector3(0, 4.4, -56);
  public readonly spawnPosition = new THREE.Vector3(0, 0, 20);
  public readonly skyPortalPos = new THREE.Vector3(0, 46, 86);
  public readonly skyPortalQuat = new THREE.Quaternion();

  private skySleeveMesh!: THREE.Mesh;
  private skySleeveBackCap!: THREE.Mesh;

  private terrainMat!: THREE.ShaderMaterial;
  private skyMat!: THREE.ShaderMaterial;
  private astrolabeMat!: THREE.ShaderMaterial;
  private readonly astrolabeRings: THREE.Mesh[] = [];
  private dataSeaMat!: THREE.ShaderMaterial;
  private citadelMat!: THREE.ShaderMaterial;
  private finMat!: THREE.ShaderMaterial;
  private cathedralMat!: THREE.ShaderMaterial;
  private dataFallsMat!: THREE.ShaderMaterial;
  private errorCascadeMat!: THREE.ShaderMaterial;
  private leviathanMat!: THREE.ShaderMaterial;
  private skyRiftMat!: THREE.ShaderMaterial;
  private skyTunnelMat!: THREE.ShaderMaterial;
  private skyExitStreamMat!: THREE.ShaderMaterial;
  private causewayBusMat!: THREE.ShaderMaterial;
  private floatingShardMat!: THREE.ShaderMaterial;
  private landingShockMat!: THREE.ShaderMaterial;
  private landingShockTimer = 99.0;
  private crtGlassMat!: THREE.ShaderMaterial;
  private floatingShards!: THREE.InstancedMesh;
  private dustPoints!: THREE.Points;
  private dustMat!: THREE.ShaderMaterial;

  // Atmospheric depth systems (mist volumes, cloud decks, horizon silhouettes, sky traffic, shafts)
  private mistMat!: THREE.ShaderMaterial;
  private cloudDeckMat!: THREE.ShaderMaterial;
  private skylineMat!: THREE.ShaderMaterial;
  private trafficMat!: THREE.ShaderMaterial;
  private trafficMesh!: THREE.InstancedMesh;
  private shaftMat!: THREE.ShaderMaterial;
  private skyDebris!: THREE.Group;
  private spireMat!: THREE.ShaderMaterial;
  private lanternMat!: THREE.ShaderMaterial;
  private monolithMat!: THREE.ShaderMaterial;

  // Central WAKE_UP glyph plates & Gyroscopic Sanctuary Rings!
  private readonly wakePlates: Array<{
    mesh: THREE.Mesh;
    alignedPos: THREE.Vector3;
    scatteredPos: THREE.Vector3;
    scatteredRot: THREE.Euler;
  }> = [];
  private readonly gyroRings: THREE.Mesh[] = [];
  private coreBeamMat!: THREE.ShaderMaterial;
  private corePlaqueMat!: THREE.MeshBasicMaterial;
  public coreSecretRevealed = false;
  private phantomMat!: THREE.ShaderMaterial;
  private phantomMesh!: THREE.InstancedMesh;

  // Periodic Silence vs Anomaly pacing
  private anomalyTimer = 7.5;
  public anomalyIntensity = 0;
  public onAnomalyPulse?: () => void;

  // Act 4 True Voronoi Jigsaw Collapse & 245m Abyssal Shaft
  private readonly collapseGroup = new THREE.Group();
  private voronoiMat!: THREE.ShaderMaterial;
  private crackRays!: THREE.InstancedMesh;
  private readonly crackRayStates: Array<{
    x: number;
    z: number;
    rotY: number;
    igniteT: number;
    fadeT: number;
    height: number;
    width: number;
  }> = [];
  private abyssWallMat!: THREE.ShaderMaterial;
  private abyssDebris!: THREE.InstancedMesh;
  private abyssSpeedLines!: THREE.InstancedMesh;
  private bedroomReturnPortal!: THREE.Mesh;
  private readonly collapseCenter = new THREE.Vector3(0, 0, -42);
  private readonly dummy = new THREE.Object3D();

  /**
   * Maps a local Z coordinate along the Sky-Monitor tunnel axis (localZ < 0 = inside 56m exit sleeve,
   * localZ = 0 = shattered BSOD screen mouth, localZ > 0 = out in open GlitchWorld sky) to world space.
   */
  public getSkyTunnelPoint(localZ: number, localX = 0, localY = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(localX, localY, localZ).applyQuaternion(this.skyPortalQuat).add(this.skyPortalPos);
  }

  private readonly abyssStates: Array<{
    x: number;
    y: number;
    z: number;
    rot: THREE.Euler;
    rotVel: THREE.Vector3;
    scale: THREE.Vector3;
  }> = [];

  private readonly abyssStreakStates: Array<{
    x: number;
    baseY: number;
    z: number;
    speed: number;
    len: number;
    width: number;
  }> = [];

  /**
   * Exact analytical terrain height at any (x, z) — 0.001ms fast, zero raycasting lag!
   * Sculpted into an elevated Ceremonial Causeway Bridge flanked by deep sunken Data-Ocean Chasms!
   */
  public getTerrainHeight(x: number, z: number): number {
    // 1. Broad Arrival Overlook Island around (0, +20)
    const dSpawn = Math.hypot(x * 0.8, z - 20.0);
    const spawnIsland = 2.6 * Math.exp(-(dSpawn * dSpawn) / 135.0);

    // 2. Monumental Sanctuary Ziggurat Acropolis around (0, -56)
    const dCore = Math.hypot(x, z + 56.0);
    const coreMound = 5.2 * Math.exp(-(dCore * dCore) / 340.0);
    const smoothCore = coreMound + 0.18 * Math.sin(coreMound * Math.PI * 2.5);

    // 3. Elevated Ceremonial Causeway Spine along X ~ 0 (Z: -64 .. +26)
    const inSpan = z >= -64.0 && z <= 26.0 ? 1.0 : 0.0;
    const bridgeMask = Math.exp(-(x * x) / 46.0) * inSpan;
    const bridgeDeck = 2.15 * bridgeMask;

    // 4. Sunken Abyssal Chasm Trenches flanking left & right (|X| ~ 20m -> submerged below Y=-0.35m Data Sea!)
    const absX = Math.abs(x);
    const trenchBand = Math.exp(-((absX - 20.0) * (absX - 20.0)) / 72.0) * inSpan;
    const trenchDip = -2.35 * trenchBand * (1.0 - Math.exp(-(dCore * dCore) / 260.0));

    // 4b. Branching East Ossuary Spur (+18.5, -8) & West Reliquary Spur (-18.5, -28) bridging the Data Sea!
    const spurEx = THREE.MathUtils.smoothstep(x, 0.0, 6.0) * (1.0 - THREE.MathUtils.smoothstep(x, 18.5, 25.5));
    const spurEz = Math.exp(-((z + 8.0) * (z + 8.0)) / 24.0);
    const dEast = Math.hypot(x - 18.5, z + 8.0);
    const eastWing = Math.max(3.6 * spurEx * spurEz, 3.85 * Math.exp(-(dEast * dEast) / 38.0));

    const spurWx = THREE.MathUtils.smoothstep(-x, 0.0, 6.0) * (1.0 - THREE.MathUtils.smoothstep(-x, 18.5, 25.5));
    const spurWz = Math.exp(-((z + 28.0) * (z + 28.0)) / 24.0);
    const dWest = Math.hypot(x + 18.5, z + 28.0);
    const westWing = Math.max(3.6 * spurWx * spurWz, 3.85 * Math.exp(-(dWest * dWest) / 38.0));

    // 5. Outer obsidian-concrete islands & horizon rim
    const waves =
      (Math.sin(x * 0.095) * Math.cos(z * 0.085) * 1.45 +
        Math.sin(x * 0.22 + z * 0.17) * 0.42) *
      (1.0 - bridgeMask * 0.85);

    const rCenter = Math.hypot(x, z + 18.0);
    const rim = Math.max(0.0, rCenter - 62.0) * 0.26;

    return spawnIsland + smoothCore + bridgeDeck + trenchDip + eastWing + westWing + waves + rim;
  }

  public async load(gltfLoader: GLTFLoader, texLoader: THREE.TextureLoader): Promise<void> {
    this.scene.background = new THREE.Color(0x011330);
    this.scene.fog = new THREE.FogExp2(0x011330, 0.0056);
    this.scene.add(this.group);

    const [
      crayGltf,
      rackGltf,
      crtGltf,
      moboGltf,
      cablesGltf,
      concreteDiff,
      concreteDisp,
    ] = await Promise.all([
      gltfLoader.loadAsync('/models/cray1.glb'),
      gltfLoader.loadAsync('/models/server_rack.glb'),
      gltfLoader.loadAsync('/models/crt_monitor.glb'),
      gltfLoader.loadAsync('/models/motherboard.glb'),
      gltfLoader.loadAsync('/models/cables.glb'),
      texLoader.loadAsync('/textures/concrete_diff.webp'),
      texLoader.loadAsync('/textures/concrete_disp.webp'),
    ]);

    concreteDiff.wrapS = concreteDiff.wrapT = THREE.RepeatWrapping;
    concreteDisp.wrapS = concreteDisp.wrapT = THREE.RepeatWrapping;

    this.spawnPosition.y = this.getTerrainHeight(this.spawnPosition.x, this.spawnPosition.z);
    this.corePosition.y = this.getTerrainHeight(0, -56);

    // 1. Sky Dome + Distant Colossal Error Text Bands & Lighting
    this.buildSkyAndLighting();

    // 2. Analytical 3D Walkable BSOD Concrete Terrain + Reflective Liquid-Crystal Data Ocean
    this.buildTerrain(concreteDiff, concreteDisp);

    // 2b. Sunken 360° Brutalist Kernel Citadel Megacity + Overhead Sky-Bridges + Sky Arrival Rift!
    this.buildKernelMegacityAndSkyRift();

    // 2c. Cathedral Rib-Arch Boulevard + 40m Data-Waterfalls + Frozen Error Cascades + 140m Sky-Leviathan!
    this.buildCathedralCausewayAndLeviathan();

    // 3. Central Sanctuary (Colossal Cray-1 Supercomputer + Server Obelisks + WAKE_UP Secret)
    this.buildCentralSanctuary(crayGltf.scene, rackGltf.scene, cablesGltf.scene);

    // 4. World Landmarks (Server Megaliths, Floating CRT Monitors, Giant Motherboards, Diegetic Clue Terminals)
    this.buildWorldLandmarks(rackGltf.scene, crtGltf.scene, moboGltf.scene, cablesGltf.scene);

    // 5. Floating UI Fragments & Rising Digital Ash
    this.buildFloatingAtmosphere();

    // 5b. Aerial depth pass: trench mist volumes, high cloud decks, horizon megastructure
    // silhouettes, drifting sky traffic and sky-eye light shafts.
    this.buildAtmosphericDepth();

    // 5c. Hand-placed scale & wayfinding detail (causeway lanterns, sanctuary monoliths).
    this.buildCausewayDetailAndMonoliths();

    // 5d. Threshold Host Effigy & Peripheral Stalking Glitch Apparitions
    this.buildHostEffigyAndPhantoms();

    // 6. Act 4 True Voronoi Jigsaw Fracture & 245m Abyssal Freefall Shaft
    this.buildCollapseAndAbyss(concreteDiff, concreteDisp);
  }

  private buildSkyAndLighting(): void {
    // Generate giant sky error-band texture for surreal BSOD horizon scale
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2048;
    skyCanvas.height = 512;
    const sctx = skyCanvas.getContext('2d')!;
    sctx.clearRect(0, 0, 2048, 512);
    sctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    sctx.font = '300 42px Consolas, "Segoe UI", monospace';
    const lines = [
      '0x000000F4  CRITICAL_OBJECT_TERMINATION  //  PAGE_FAULT_IN_NONPAGED_AREA  //  MEMORY_MANAGEMENT',
      ':(   問題が発生したため、意識を再起動できません。   99% COMPLETE   //   STOP: 0x0078D7',
      'DUMPING_PHYSICAL_REALITY_TO_DISK: [████████████████████████████░]  SECTOR_LOCKED',
    ];
    for (let i = 0; i < lines.length; i++) {
      sctx.fillText(lines[i] + '   ' + lines[i], 20, 140 + i * 115);
    }
    const skyBandTex = new THREE.CanvasTexture(skyCanvas);
    skyBandTex.wrapS = THREE.RepeatWrapping;
    skyBandTex.wrapT = THREE.ClampToEdgeWrapping;
    skyBandTex.minFilter = THREE.LinearFilter;
    skyBandTex.generateMipmaps = false;

    const skyGeo = new THREE.SphereGeometry(230, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uCollapse: { value: 0 },
        uPlayerPos: { value: new THREE.Vector3(0, 5, 20) },
        uBandTex: { value: skyBandTex },
        uNoiseTex: { value: getSharedNoiseTexture() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldDir;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uAnomaly;
        uniform float uCollapse;
        uniform vec3 uPlayerPos;
        uniform sampler2D uBandTex;
        uniform sampler2D uNoiseTex;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float y = clamp(dir.y, -0.4, 1.0);
          vec3 zenith = mix(vec3(0.0, 0.012, 0.062), vec3(0.035, 0.0, 0.015), max(uCollapse, uAnomaly * 0.45));
          vec3 midBlue = mix(vec3(0.0, 0.115, 0.46), vec3(0.18, 0.02, 0.10), uAnomaly * 0.35);
          vec3 horizon = mix(vec3(0.008, 0.24, 0.76), vec3(0.75, 0.16, 0.28), uAnomaly * 0.42);

          vec3 col = mix(horizon, midBlue, smoothstep(-0.02, 0.35, y));
          col = mix(col, zenith, smoothstep(0.32, 0.88, y));

          // === COLOSSAL WATCHING SINGULARITY EYE IN THE SKY BEHIND THE SANCTUARY ===
          vec3 sunDir = normalize(vec3(0.0, 0.34, -0.94));
          float sunCos = dot(dir, sunDir);
          float sunAng = acos(clamp(sunCos, -1.0, 1.0));

          vec3 rightVec = normalize(cross(vec3(0.0, 1.0, 0.0), sunDir));
          vec3 upVec = cross(sunDir, rightVec);
          vec2 sunPlane = vec2(dot(dir, rightVec), dot(dir, upVec));
          float rayTheta = atan(sunPlane.y, sunPlane.x);

          // Volumetric god-rays + rotating cyber-iris corona!
          float godRays = (0.55 + 0.45 * sin(rayTheta * 9.0 + uTime * 0.35) * cos(rayTheta * 17.0 - uTime * 0.28))
                        * exp(-sunAng * 3.0);
          vec3 rayCol = mix(vec3(0.28, 0.74, 1.0), vec3(1.0, 0.18, 0.28), max(uAnomaly * 0.75, uCollapse));
          col += rayCol * godRays * (0.42 + uAnomaly * 0.52);

          // Almond-shaped Giant Watcher Eyelid, Serrated Parasyte Rim & Bloodshot Iris!
          vec2 eyeSpace = sunPlane / 0.115;
          float blinkSquint = 1.0 + 0.28 * sin(uTime * 0.7) + uAnomaly * 0.45;
          float lidSerration = (abs(fract((rayTheta * 0.1591549 + 0.5) * 40.0) - 0.5) * 2.0) * (0.03 + 0.08 * max(uAnomaly, uCollapse));
          float almondR = length(vec2(eyeSpace.x * 0.72, eyeSpace.y * blinkSquint)) + lidSerration;
          float outerHalo = smoothstep(0.014, 0.0, abs(sunAng - 0.205)) * (0.45 + 0.55 * step(0.35, fract(rayTheta * 6.0 + uTime * 0.2)));
          float scleraRim = exp(-abs(almondR - 1.0) * 14.0) * 1.45;
          col += mix(vec3(0.76, 0.94, 1.0), vec3(1.0, 0.20, 0.28), max(uAnomaly, uCollapse)) * (scleraRim + outerHalo * 0.78);

          if (almondR < 1.02) {
            // Saccadic micro-twitches + live tracking of player's world X/Z across the basin!
            float sacTick = floor(uTime * (3.5 + uAnomaly * 14.0));
            vec2 sac = (vec2(hash(vec2(sacTick, 1.3)), hash(vec2(sacTick, 7.9))) - 0.5) * (0.04 + 0.16 * max(uAnomaly, uCollapse));
            vec2 gazeShift = vec2(clamp(uPlayerPos.x / 55.0, -0.28, 0.28), clamp((-20.0 - uPlayerPos.z) / 140.0, -0.18, 0.18)) + sac;
            vec2 irisP = eyeSpace - gazeShift;
            float irisR = length(irisP);
            float safeIx = (abs(irisP.x) < 1e-5 && abs(irisP.y) < 1e-5) ? 1e-5 : irisP.x;
            float irisAng = atan(irisP.y, safeIx);
            float irisFibers = 0.5 + 0.5 * sin(irisAng * 34.0 + sin(irisR * 18.0 - uTime * 2.5) * 1.8);

            // Sclera interior with arterial bloodshot capillaries flaring during anomalies
            float cap1 = pow(max(0.0, 1.0 - abs(sin(irisAng * 11.0 + sin(almondR * 15.0) * 1.7))), 14.0);
            vec3 eyeCol = mix(vec3(0.008, 0.035, 0.12), vec3(0.88, 0.92, 0.96), smoothstep(0.68, 0.99, almondR) * 0.72);
            eyeCol = mix(eyeCol, vec3(0.85, 0.04, 0.12), cap1 * smoothstep(0.55, 0.96, almondR) * (0.28 + 0.72 * max(uAnomaly, uCollapse)));

            // Glowing cybernetic/eldritch iris ring
            float inIris = smoothstep(0.72, 0.64, irisR) * smoothstep(0.16, 0.28, irisR);
            vec3 irisTint = mix(vec3(0.12, 0.68, 1.0), vec3(1.0, 0.08, 0.18), max(uAnomaly * 0.92, uCollapse));
            eyeCol += irisTint * inIris * (0.55 + 0.85 * irisFibers);

            // Constricting manic pinpoint / slit pupil!
            float slitFactor = mix(1.2, 3.6, max(uAnomaly, uCollapse));
            float pupilSize = mix(0.24, 0.14, max(uAnomaly, uCollapse));
            float pupilR = length(vec2(irisP.x * slitFactor, irisP.y));
            float inPupil = smoothstep(pupilSize + 0.04, pupilSize - 0.02, pupilR);
            eyeCol = mix(eyeCol, vec3(0.0, 0.002, 0.01), inPupil);
            float pupilRim = smoothstep(0.04, 0.0, abs(pupilR - pupilSize));
            eyeCol += mix(vec3(0.75, 0.95, 1.0), vec3(1.0, 0.15, 0.22), max(uAnomaly, uCollapse)) * pupilRim * 1.15;

            col = mix(col, eyeCol, smoothstep(1.02, 0.93, almondR));
          }

          // Jagged reality-fracture lightning seams tearing across the sky vault!
          if (y > 0.10) {
            float seamWave = sin(dir.x * 9.0 + sin(dir.z * 7.0 + uTime * 0.4) * 1.6);
            float skyCrack = smoothstep(0.012 + uAnomaly * 0.01, 0.0, abs(seamWave - 0.42))
                           * step(0.65 - uAnomaly * 0.45 - uCollapse * 0.5, hash(vec2(floor(dir.z * 14.0), floor(uTime * 8.0))));
            col += mix(vec3(0.55, 0.90, 1.0), vec3(1.0, 0.20, 0.30), uAnomaly) * skyCrack * 0.85;
          }

          // Slowly drifting monumental error-text sky rings
          if (y > 0.02 && y < 0.58) {
            float glitchShift = (0.012 + uAnomaly * 0.09) * (hash(vec2(floor(y * 34.0), floor(uTime * 18.0))) - 0.5);
            vec2 buv = vec2(vUv.x * 3.0 + uTime * 0.006 + glitchShift, (y - 0.02) / 0.56);
            float txt = texture2D(uBandTex, buv).a;
            col += vec3(0.75, 0.92, 1.0) * txt * (0.48 + uAnomaly * 0.95 + uCollapse * 1.15);
          }

          // === KERNEL AURORA BOREALIS CURTAINS & ECLIPSE CORONA RAYS ===
          if (y > 0.04) {
            float azim = atan(dir.x, -dir.z);
            vec4 an1 = texture2D(uNoiseTex, vec2(azim * 0.95 + uTime * 0.014, y * 0.55 - uTime * 0.022));
            vec4 an2 = texture2D(uNoiseTex, vec2(azim * 2.15 - uTime * 0.019, y * 1.10 + an1.r * 0.28));
            float curtain = pow(clamp(sin(azim * 6.0 + an1.r * 4.8 + uTime * 0.22) * 0.5 + 0.5, 0.0, 1.0), 3.2)
                          * smoothstep(0.32, 0.84, an2.b)
                          * smoothstep(0.04, 0.24, y) * smoothstep(0.88, 0.30, y);
            vec3 auroraCalm = mix(vec3(0.04, 0.62, 0.96), vec3(0.26, 0.34, 1.0), smoothstep(0.12, 0.58, y));
            vec3 auroraPanic = vec3(1.0, 0.14, 0.34);
            col += mix(auroraCalm, auroraPanic, max(uAnomaly * 0.85, uCollapse)) * curtain * (0.62 + uAnomaly * 0.55);

            // Sweeping radial solar-eclipse corona rays emanating from the Watching Sky-Eye
            vec2 eyeDelta = vec2(dir.x, dir.y - 0.33);
            float eclipseAng = atan(eyeDelta.y, eyeDelta.x);
            float raySpoke = pow(0.5 + 0.5 * cos(eclipseAng * 11.0 - uTime * 0.24 + an1.g * 1.8), 5.0);
            float rayFalloff = exp(-sunAng * 3.1) * smoothstep(0.06, 0.26, sunAng);
            col += mix(vec3(0.36, 0.82, 1.0), vec3(1.0, 0.22, 0.30), uAnomaly) * raySpoke * rayFalloff * 0.48;
          }

          // === STRATOSPHERIC CLOUD BANKS (Fast smooth hardware-bilinear FBM lookup!) ===
          {
            vec2 cp = vec2(atan(dir.z, dir.x) * 0.42 + uTime * 0.0022, dir.y * 1.15);
            vec4 cn1 = texture2D(uNoiseTex, cp);
            vec4 cn2 = texture2D(uNoiseTex, cp * 2.7 - vec2(uTime * 0.004, 0.0));
            float band = cn1.r * 0.68 + cn2.g * 0.32;
            float horizonMask = smoothstep(0.48, 0.01, y) * smoothstep(-0.30, 0.02, y);
            float cloudAmt = smoothstep(0.36, 0.76, band) * horizonMask;
            vec3 cloudCol = mix(vec3(0.025, 0.095, 0.23), vec3(0.16, 0.40, 0.78), smoothstep(0.0, 0.38, y));
            cloudCol += mix(vec3(0.38, 0.74, 1.0), vec3(1.0, 0.25, 0.32), uAnomaly) * exp(-sunAng * 2.2) * 0.42;
            col = mix(col, cloudCol, clamp(cloudAmt * 0.74, 0.0, 0.74));
          }

          // === HIGH STAR FIELD ===
          if (y > 0.18) {
            vec2 starCell = floor(dir.xz / max(0.004, 0.010 + y * 0.006) * 26.0);
            float star = hash(starCell + 7.1);
            float starOn = step(0.9965, star) * smoothstep(0.18, 0.55, y);
            float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + star * 6.0) + star * 30.0);
            col += vec3(0.72, 0.88, 1.0) * starOn * twinkle * 1.6;
          }

          // Sky fracture lightning fissures during world collapse or heavy anomaly!
          float skyCrackAmt = max(uCollapse, max(0.0, uAnomaly - 0.55) * 0.85);
          if (skyCrackAmt > 0.01) {
            float ang = atan(dir.z, dir.x);
            float crack = smoothstep(0.028 * (1.0 + skyCrackAmt), 0.0, abs(sin(ang * 7.0 + y * 9.0 + sin(y * 23.0) * 0.6)));
            col += vec3(0.92, 0.97, 1.0) * crack * skyCrackAmt * 1.25;
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.group.add(new THREE.Mesh(skyGeo, this.skyMat));

    // Colossal Precessing Celestial Kernel Astrolabe Rings suspended around the Watching Sky-Eye!
    this.astrolabeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
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
        uniform float uAnomaly;
        void main() {
          // Crisp register tick marks + travelling clockwork arc pulse along torus circumference
          float ticks = step(0.38, fract(vUv.x * 72.0));
          float majorTick = step(0.82, fract(vUv.x * 12.0));
          float arcPulse = 0.55 + 0.45 * sin(vUv.x * 18.8495 - uTime * 1.8);
          float core = smoothstep(0.5, 0.12, abs(vUv.y - 0.5));
          vec3 calmCol = mix(vec3(0.32, 0.80, 1.0), vec3(0.88, 0.96, 1.0), majorTick);
          vec3 panicCol = vec3(1.0, 0.20, 0.32);
          vec3 col = mix(calmCol, panicCol, uAnomaly * 0.85);
          float alpha = core * (0.24 + 0.42 * ticks + 0.34 * majorTick) * arcPulse;
          gl_FragColor = vec4(col, alpha * 0.72);
        }
      `,
    });
    const astrolabeHub = new THREE.Group();
    astrolabeHub.position.set(0, 68, -148);
    const astroRadii = [26, 39, 54];
    for (let i = 0; i < astroRadii.length; i++) {
      const ringGeo = new THREE.TorusGeometry(astroRadii[i], 0.34 + i * 0.08, 6, 72);
      const ringMesh = new THREE.Mesh(ringGeo, this.astrolabeMat);
      ringMesh.rotation.set(0.35 + i * 0.42, i * 0.6, 0.25 - i * 0.3);
      astrolabeHub.add(ringMesh);
      this.astrolabeRings.push(ringMesh);
    }
    this.group.add(astrolabeHub);

    // Atmospheric directional + hemisphere lighting for 3D structural depth
    const hemi = new THREE.HemisphereLight(0x6ec3ff, 0x001b3a, 1.05);
    this.group.add(hemi);

    const dir = new THREE.DirectionalLight(0xd6f0ff, 1.35);
    dir.position.set(22, 48, -30);
    this.group.add(dir);

    const backRim = new THREE.DirectionalLight(0x0088ff, 0.75);
    backRim.position.set(-30, 18, 35);
    this.group.add(backRim);
  }

  private buildTerrain(concreteDiff: THREE.Texture, concreteDisp: THREE.Texture): void {
    const size = 180;
    const segs = 124;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI * 0.5);
    // Offset Z center to -18 so terrain covers Z: [-108 .. +72] cleanly!
    geo.translate(0, 0, -18);

    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      posAttr.setY(i, this.getTerrainHeight(vx, vz));
    }
    geo.computeVertexNormals();

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uConcreteMap: { value: concreteDiff },
        uDispMap: { value: concreteDisp },
        uNoiseTex: { value: getSharedNoiseTexture() },
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uCollapseCenter: { value: this.collapseCenter },
        uCollapseActive: { value: 0 },
        uFogColor: { value: new THREE.Color(0x011330) },
        uFogDensity: { value: 0.0056 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;

        void main() {
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;
        uniform sampler2D uConcreteMap;
        uniform sampler2D uDispMap;
        uniform sampler2D uNoiseTex;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uCollapseCenter;
        uniform float uCollapseActive;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        // ---------------------------------------------------------------- PARALLAX RELIEF MAPPING
        // The old build flattened the basalt relief into a screen-space derivative trick, so the
        // ground looked like the SAME decal no matter where you stood. This marches the view ray
        // through the displacement height field, so the surface genuinely gains depth: walk past a
        // ridge and it slides across the texture exactly as real relief would.
        // Returns the UV offset; the caller applies it to every subsequent lookup.
        vec2 parallaxOffset(vec2 baseUv, vec3 viewDirW, vec3 nrmW, float scale) {
          vec3 vDir = normalize(viewDirW);
          // Project the view ray onto the surface plane (the terrain is a heightfield in XZ).
          float ndv = max(dot(vDir, nrmW), 0.12);
          vec2 dir = vDir.xz / ndv;
          float len = length(dir);
          if (len < 1e-4) return vec2(0.0);
          dir /= len;
          const int STEPS = 6;
          vec2 offs = vec2(0.0);
          vec2 stepUv = dir * (scale / float(STEPS));
          float dz = 1.0 / float(STEPS);
          for (int i = 0; i < STEPS; i++) {
            float h = texture2D(uDispMap, baseUv + offs).r;
            float travel = (1.0 - h) * dz;
            offs += stepUv * travel;
          }
          return offs;
        }

        void main() {
          if (uCollapseActive > 0.5) {
            float rPatch = length(vWorldPos.xz - uCollapseCenter.xz);
            if (rPatch < 12.18) {
              discard;
            }
          }

          vec3 baseN = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float camDist = length(cameraPosition - vWorldPos);

          // ---- PARALLAX: only worth paying for near the camera; far away it is invisible.
          vec2 terrainUv = vWorldPos.xz * 0.16;
          float parallaxFade = 1.0 - smoothstep(26.0, 62.0, camDist);
          vec2 pOff = parallaxOffset(terrainUv, viewDir, baseN, 0.055) * parallaxFade;
          vec2 dispUv = vWorldPos.xz * 0.12 + pOff * 0.75;

          vec3 conc = texture2D(uConcreteMap, terrainUv + pOff).rgb;
          float disp = texture2D(uDispMap, dispUv).r;
          vec4 macroN = texture2D(uNoiseTex, vWorldPos.xz * 0.045 + pOff * 0.28);

          float hField = disp * 0.7 + conc.r * 0.3;
          float dHx = dFdx(hField);
          float dHy = dFdy(hField);
          vec3 dPdx = dFdx(vWorldPos);
          vec3 dPdy = dFdy(vWorldPos);
          vec3 r1 = cross(dPdy, baseN);
          vec3 r2 = cross(baseN, dPdx);
          float det = dot(dPdx, r1);
          // Guard the degenerate determinant case so normalize() can never produce NaN.
          float detSafe = (det < 0.0 ? -det : det);
          float detSign = det < 0.0 ? -1.0 : 1.0;
          vec3 surfGrad = detSign * (dHx * r1 + dHy * r2);
          vec3 nrm = normalize(abs(detSafe) * baseN - surfGrad * 1.45 + baseN * 1e-5);

          // ---- WORLD-SPACE MICRO-NORMAL from the relief height field.
          // This is what makes the basalt read as a rough, view-dependent surface: the fine
          // facets catch the light differently as the camera swings around them.
          float e = 0.035;
          float hL = texture2D(uDispMap, dispUv - vec2(e, 0.0)).r;
          float hR = texture2D(uDispMap, dispUv + vec2(e, 0.0)).r;
          float hD = texture2D(uDispMap, dispUv - vec2(0.0, e)).r;
          float hU = texture2D(uDispMap, dispUv + vec2(0.0, e)).r;
          float microFade = parallaxFade * (1.0 - smoothstep(12.0, 44.0, camDist));
          vec3 microN = normalize(vec3((hL - hR) * 3.4 * microFade, 1.0, (hD - hU) * 3.4 * microFade));
          // Rotate the micro-normal into the terrain's local frame (XZ plane, +Y up).
          nrm = normalize(vec3(nrm.x + microN.x, nrm.y * (0.35 + 0.65 * microN.y), nrm.z + microN.z));

          vec3 lightDir = normalize(vec3(0.12, 0.62, -0.78));
          vec3 halfDir = normalize(lightDir + viewDir);
          float ndl = clamp(dot(nrm, lightDir), 0.0, 1.0);
          float spec = pow(max(dot(nrm, halfDir), 0.0), 42.0) * (0.35 + 0.65 * conc.r);

          // ---- ANISOTROPIC SHEEN: a stretched highlight that slides across the ground as the
          // view angle changes, so the basalt reads as brushed, directional stone.
          vec3 tangent = normalize(vec3(1.0, 0.0, 0.0) - nrm * dot(nrm, vec3(1.0, 0.0, 0.0)));
          vec3 bitan = normalize(cross(nrm, tangent));
          vec3 Ht = normalize(lightDir + viewDir);
          float th = dot(Ht, tangent);
          float bh = dot(Ht, bitan);
          float aniso = pow(max(1.0 - th * th, 0.0), 24.0) * pow(max(dot(nrm, Ht), 0.0), 8.0);

          float puddle = smoothstep(0.48, 0.72, macroN.r * 0.72 + disp * 0.42);
          vec3 reflDir = reflect(-viewDir, nrm);
          float eyeSpec = pow(max(dot(reflDir, normalize(vec3(0.0, 0.30, -0.95))), 0.0), 28.0);

          vec3 darkObsidian = vec3(0.005, 0.018, 0.068);
          vec3 litStone = mix(vec3(0.0, 0.11, 0.44), vec3(0.55, 0.04, 0.12), uAnomaly * 0.55);
          vec3 baseBlue = mix(darkObsidian, litStone, conc.r * 0.72 + disp * 0.28);
          baseBlue += (macroN.g - 0.5) * 0.045;
          vec3 col = baseBlue * (0.40 + 0.78 * ndl) + vec3(0.55, 0.88, 1.0) * spec * 0.58;
          col += vec3(0.35, 0.62, 1.0) * aniso * 0.30 * (0.4 + 0.6 * disp);
          col += mix(vec3(0.18, 0.55, 1.0), vec3(1.0, 0.22, 0.30), uAnomaly * 0.7) * eyeSpec * puddle * 0.88;
          col = mix(col, baseBlue * 0.55 + vec3(0.02, 0.10, 0.24) * (1.0 - ndl), puddle * 0.42);

          // ---- THIN-FILM IRIDESCENCE: the obsidian carries a data-crystal sheen whose hue
          // depends on the view angle (Fresnel-driven), so the surface visibly changes colour
          // as the player turns their head.
          float fres = pow(1.0 - clamp(dot(nrm, viewDir), 0.0, 1.0), 3.0);
          float filmPhase = fres * 7.4 + hField * 5.5 + uTime * 0.12;
          vec3 irid = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + filmPhase);
          col += irid * fres * (0.055 + 0.11 * uAnomaly) * (0.35 + 0.65 * (1.0 - puddle));

          vec2 fwMajor = max(fwidth(vWorldPos.xz * 0.25), vec2(0.0001));
          vec2 gMajor = abs(fract(vWorldPos.xz * 0.25 - 0.5) - 0.5) / fwMajor;
          float lineMajor = 1.0 - min(min(gMajor.x, gMajor.y), 1.0);

          vec2 fwMinor = max(fwidth(vWorldPos.xz), vec2(0.0001));
          vec2 gMinor = abs(fract(vWorldPos.xz - 0.5) - 0.5) / fwMinor;
          float lineMinor = 1.0 - min(min(gMinor.x, gMinor.y), 1.0);

          float onPath = exp(-(vWorldPos.x * vWorldPos.x) / 11.0) * step(-58.0, vWorldPos.z) * step(vWorldPos.z, 24.0);
          float spurEastLine = exp(-((vWorldPos.z + 8.0) * (vWorldPos.z + 8.0)) / 3.2) * step(0.0, vWorldPos.x) * step(vWorldPos.x, 19.5);
          float spurWestLine = exp(-((vWorldPos.z + 28.0) * (vWorldPos.z + 28.0)) / 3.2) * step(-19.5, vWorldPos.x) * step(vWorldPos.x, 0.0);
          float pathPulse = 0.5 + 0.5 * sin(vWorldPos.z * 0.38 + uTime * 3.2);
          float spurPulse = 0.5 + 0.5 * sin(abs(vWorldPos.x) * 0.55 - uTime * 4.2);
          float railLine = smoothstep(0.12, 0.0, abs(abs(vWorldPos.x) - 2.65)) * step(-55.0, vWorldPos.z) * step(vWorldPos.z, 22.0);
          float shoreGlow = smoothstep(0.32, 0.0, abs(vWorldPos.y - (-0.32)));

          vec3 accentGlow = mix(vec3(0.58, 0.88, 1.0), vec3(1.0, 0.28, 0.36), uAnomaly * 0.7);
          float vein = sin(vWorldPos.z * 0.55 - uTime * 2.4) * 0.5 + 0.5;
          col += accentGlow * lineMajor * (0.38 + onPath * 0.42 * pathPulse + uAnomaly * 0.45) * (0.72 + vein * 0.55);
          // Arterial crimson-cyan nerve traces leading out along the East (+18.5,-8) & West (-18.5,-28) Shrine Spurs!
          col += vec3(0.95, 0.20, 0.36) * (spurEastLine + spurWestLine) * lineMajor * (0.45 + 0.55 * spurPulse);
          col *= mix(0.76, 1.0, disp);
          col += vec3(0.25, 0.65, 1.0) * lineMinor * 0.12;
          col += accentGlow * railLine * (0.35 + 0.50 * pathPulse);
          col += vec3(0.45, 0.88, 1.0) * shoreGlow * 0.65;

          float heightMist = exp(-max(vWorldPos.y + 1.5, 0.0) * 0.022);
          float airDensity = uFogDensity * (0.72 + heightMist * 1.25);
          float fogFactor = 1.0 - exp(-airDensity * airDensity * camDist * camDist);
          vec3 viewW = normalize(vWorldPos - cameraPosition);
          float sunScatter = pow(max(dot(viewW, normalize(vec3(0.0, 0.26, -0.96))), 0.0), 5.0);
          vec3 aerialTint = mix(vec3(0.008, 0.078, 0.20), vec3(0.035, 0.21, 0.47), clamp((vWorldPos.y + 4.0) * 0.014, 0.0, 1.0));
          aerialTint += vec3(0.16, 0.42, 0.88) * sunScatter * 0.72;
          col = mix(col, aerialTint, clamp(fogFactor, 0.0, 0.95));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const terrainMesh = new THREE.Mesh(geo, this.terrainMat);
    this.group.add(terrainMesh);

    // Reflective Liquid-Crystal BSOD Data-Ocean filling the sunken chasms at Y = -0.35m!
    // 900m ocean: the data sea now runs past the horizon silhouettes so there is no visible
    // world edge when you look out from the Overlook or during the aerial arrival.
    const seaGeo = new THREE.PlaneGeometry(900, 900, 1, 1);
    seaGeo.rotateX(-Math.PI * 0.5);
    seaGeo.translate(0, -0.35, -24);
    this.dataSeaMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uCollapseActive: { value: 0 },
        uCollapseCenter: { value: this.collapseCenter },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAnomaly;
        uniform float uCollapseActive;
        uniform vec3 uCollapseCenter;

        void main() {
          if (uCollapseActive > 0.5 && length(vWorldPos.xz - uCollapseCenter.xz) < 12.2) {
            discard;
          }
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          // Animated interference wave normal for shimmering liquid-crystal reflection!
          float w1 = sin(vWorldPos.x * 0.85 + uTime * 1.4) * cos(vWorldPos.z * 0.75 - uTime * 1.1);
          float w2 = sin((vWorldPos.x - vWorldPos.z) * 1.6 - uTime * 2.1);
          vec3 waveN = normalize(vec3((w1 + w2 * 0.5) * 0.08, 1.0, (w1 - w2 * 0.5) * 0.08));

          float fresnel = pow(1.0 - clamp(dot(waveN, viewDir), 0.0, 1.0), 3.2);
          vec3 sunDir = normalize(vec3(0.0, 0.33, -0.944));
          vec3 refl = reflect(-viewDir, waveN);
          float sunSpec = pow(max(dot(refl, sunDir), 0.0), 48.0);

          // Hex/grid data currents + deep submerged parallax server-trench abyss beneath the dark mirror waves!
          vec2 cell = fract(vWorldPos.xz * 0.25 + vec2(0.0, uTime * 0.18));
          float stream = smoothstep(0.06, 0.0, abs(cell.x - 0.5)) * (0.4 + 0.6 * sin(vWorldPos.z * 0.2 + uTime * 2.0));

          vec2 subUv = vWorldPos.xz * 0.068 - (viewDir.xz / max(abs(viewDir.y) + 0.20, 0.20)) * 0.36;
          vec2 subGrid = abs(fract(subUv) - 0.5);
          float trenchRack = smoothstep(0.055, 0.0, min(subGrid.x, subGrid.y))
                           * (0.45 + 0.55 * sin(subUv.y * 6.283 + uTime * 1.3));
          float deepSpore = smoothstep(0.96, 1.0, sin(subUv.x * 12.0 + uTime * 0.7) * cos(subUv.y * 12.0 - uTime * 0.9));

          vec3 abyssCol = vec3(0.002, 0.015, 0.058)
                        + mix(vec3(0.02, 0.34, 0.78), vec3(0.85, 0.10, 0.24), uAnomaly) * (trenchRack * 0.38 + deepSpore * 0.45) * (1.0 - fresnel * 0.7);
          vec3 skyReflCol = mix(vec3(0.04, 0.40, 0.94), vec3(0.88, 0.12, 0.24), uAnomaly * 0.65);
          vec3 col = mix(abyssCol, skyReflCol, clamp(fresnel * 0.85 + 0.08, 0.0, 1.0));
          col += vec3(0.75, 0.95, 1.0) * sunSpec * 1.25;
          col += vec3(0.25, 0.72, 1.0) * stream * 0.28;

          float camDist = length(cameraPosition - vWorldPos);
          vec3 viewW2 = normalize(vWorldPos - cameraPosition);
          float sunScatter2 = pow(max(dot(viewW2, normalize(vec3(0.0, 0.26, -0.96))), 0.0), 5.0);
          float fog = 1.0 - exp(-0.0056 * 0.0056 * camDist * camDist * 1.35);
          vec3 seaFog = mix(vec3(0.004, 0.070, 0.185), vec3(0.03, 0.20, 0.46), 0.5)
                      + vec3(0.16, 0.42, 0.88) * sunScatter2 * 0.7;
          col = mix(col, seaFog, clamp(fog, 0.0, 0.96));

          gl_FragColor = vec4(col, 0.94);
        }
      `,
    });
    const seaMesh = new THREE.Mesh(seaGeo, this.dataSeaMat);
    this.group.add(seaMesh);

    // Radial Impact Shockwave Ring on the Arrival Overlook for the Sky-Dive Landing!
    const shockGeo = new THREE.PlaneGeometry(24, 24);
    shockGeo.rotateX(-Math.PI * 0.5);
    this.landingShockMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uShockT: { value: 99.0 },
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
        uniform float uShockT;
        void main() {
          if (uShockT > 1.8) discard;
          float r = length(vUv - 0.5) * 2.0;
          float waveR = uShockT * 0.85;
          float ring = smoothstep(0.11, 0.0, abs(r - waveR)) * (1.0 - smoothstep(0.2, 1.4, uShockT));
          float ring2 = smoothstep(0.06, 0.0, abs(r - waveR * 0.62)) * (1.0 - smoothstep(0.2, 1.2, uShockT));
          gl_FragColor = vec4(0.68, 0.94, 1.0, (ring + ring2 * 0.6) * 0.92);
        }
      `,
    });
    const shockMesh = new THREE.Mesh(shockGeo, this.landingShockMat);
    shockMesh.position.set(0, this.spawnPosition.y + 0.08, 20);
    this.group.add(shockMesh);
  }

  public triggerLandingShockwave(): void {
    this.landingShockTimer = 0.0;
    this.landingShockMat.uniforms.uShockT.value = 0.0;
  }

  public triggerAnomalySurge(strength = 1.0): void {
    this.anomalyIntensity = Math.max(this.anomalyIntensity, THREE.MathUtils.clamp(strength, 0, 1));
    this.anomalyTimer = 6.5 + Math.random() * 3.0;
  }

  public setArrivalSleeveActive(active: boolean): void {
    if (this.skySleeveMesh) this.skySleeveMesh.visible = active;
    if (this.skySleeveBackCap) this.skySleeveBackCap.visible = active;
  }

  /**
   * Builds a jaw-dropping 360° Brutalist Kernel Citadel Megacity (156 Skyscrapers & Sky-Aqueducts in 1 Draw Call!)
   * plus the Colossal Torn ':(' Sky-Rift Portal overhead at (0, 88, 58) from which the player plunges!
   */
  private buildKernelMegacityAndSkyRift(): void {
    const towerCount = 156;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1, 1, 12, 1);
    const seedAttr = new Float32Array(towerCount);
    const styleAttr = new Float32Array(towerCount);
    // Tower tops are recorded while the instances are laid out so we can cap the skyline with
    // spires in a second instanced draw call.
    const towerTops: Array<{ x: number; y: number; z: number; w: number }> = [];

    this.citadelMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uFogColor: { value: new THREE.Color(0x011330) },
        uFogDensity: { value: 0.0052 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aStyle;
        uniform float uTime;
        uniform float uAnomaly;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        varying vec2 vUv;
        varying float vSeed;

        float hash11(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          return fract(p * (p + p));
        }

        void main() {
          vUv = uv;
          vSeed = aSeed;

          // === STRUCTURAL SILHOUETTE ===
          // A box reads as a box. Every tower now gets a real massing profile: tapered obelisks,
          // stepped setback skyscrapers, flared art-deco crowns or a slim blade. The profile is a
          // function of height, so the 12 height segments bend into a genuine silhouette.
          float hFrac = uv.y;
          float style = aStyle;
          float prof = 1.0;
          if (style < 0.28) {
            // Tapered obelisk
            prof = mix(1.0, 0.52, pow(hFrac, 0.80));
          } else if (style < 0.56) {
            // Stepped setbacks (three tiers) — the classic 1930s skyscraper massing
            float tier = floor(min(hFrac, 0.999) * 3.0);
            prof = 1.0 - tier * 0.145;
            // Sharpen the step edges so they read as ledges rather than a smooth taper
            float ledge = smoothstep(0.0, 0.02, abs(fract(hFrac * 3.0)));
            prof += (1.0 - ledge) * 0.02;
          } else if (style < 0.80) {
            // Flared crown tower
            prof = mix(1.0, 0.78, hFrac) + smoothstep(0.78, 1.0, hFrac) * 0.22;
          } else {
            // Slim blade, leaning slightly
            prof = mix(1.0, 0.86, hFrac);
          }
          // Caps and undersides use the profile at their own height so the cap stays planar.
          float capH = abs(normal.y) > 0.5 ? (normal.y > 0.0 ? 1.0 : 0.0) : hFrac;
          float capProf = 1.0;
          if (style < 0.28) capProf = mix(1.0, 0.52, pow(capH, 0.80));
          else if (style < 0.56) capProf = 1.0 - floor(min(capH, 0.999) * 3.0) * 0.145;
          else if (style < 0.80) capProf = mix(1.0, 0.78, capH) + smoothstep(0.78, 1.0, capH) * 0.22;
          else capProf = mix(1.0, 0.86, capH);

          vec3 p = position;
          float useProf = abs(normal.y) > 0.5 ? capProf : prof;
          p.x *= useProf;
          p.z *= useProf;

          vec4 wp = vec4(p, 1.0);
          vec3 nrm = normal;
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            nrm = mat3(instanceMatrix) * nrm;
          #endif
          wp = modelMatrix * wp;

          // Physical 3D horizontal skyscraper glitch-slice shear!
          float bandId = floor(wp.y * 0.16 + aSeed * 19.0);
          float tick = floor(uTime * 12.0 + aSeed * 7.0);
          float sliceRnd = hash11(bandId * 13.7 + tick);
          if (sliceRnd > 0.94 - uAnomaly * 0.36) {
            float shear = (sliceRnd - 0.5) * (3.2 + uAnomaly * 8.5);
            wp.x += shear;
          }

          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * nrm);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        varying vec2 vUv;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        void main() {
          vec3 nrm = normalize(vNormalW);
          vec3 lightDir = normalize(vec3(0.0, 0.42, -0.91));
          float ndl = clamp(dot(nrm, lightDir), 0.0, 1.0);
          float rim = pow(1.0 - abs(dot(nrm, normalize(cameraPosition - vWorldPos))), 2.3);

          float fin = 0.72 + 0.28 * step(0.45, fract(vUv.x * 8.0));
          vec3 col = vec3(0.005, 0.016, 0.055) * fin * (0.45 + 0.85 * ndl) + vec3(0.05, 0.28, 0.72) * rim * 0.52;

          if (abs(nrm.y) < 0.45) {
            vec2 winGrid = vec2(
              (abs(nrm.x) > 0.5 ? vWorldPos.z : vWorldPos.x) * 0.58,
              vWorldPos.y * 0.44
            );
            vec2 cid = floor(winGrid);
            vec2 f = fract(winGrid);
            float inPane = step(0.20, f.x) * step(f.x, 0.80) * step(0.24, f.y) * step(f.y, 0.76);
            float h = hash21(cid + floor(vSeed * 100.0));
            float flicker = step(0.71, h) * (0.55 + 0.45 * sin(uTime * (1.5 + h * 4.5) + h * 20.0));

            float vBus = smoothstep(0.45, 0.5, fract(vUv.x * 2.0)) * step(0.28, vSeed);
            float busPulse = 0.45 + 0.55 * sin(vWorldPos.y * 0.16 - uTime * 4.2 + vSeed * 12.0);
            float elevator = smoothstep(0.92, 1.0, fract(vWorldPos.y * 0.045 - uTime * (0.4 + vSeed * 0.6))) * vBus;

            float beaconMask = smoothstep(0.955, 0.99, vUv.y) * step(0.4, vSeed);
            float beaconBlink = pow(0.5 + 0.5 * sin(uTime * 4.8 + vSeed * 31.0), 4.0);

            vec3 winCol = mix(vec3(0.18, 0.72, 1.0), vec3(1.0, 0.16, 0.26), step(0.90 - uAnomaly * 0.65, h));
            col += winCol * inPane * flicker * 0.92;
            col += mix(vec3(0.35, 0.82, 1.0), vec3(1.0, 0.22, 0.30), uAnomaly * 0.75) * vBus * busPulse * 0.68;
            col += vec3(0.92, 0.98, 1.0) * elevator * 1.1;
            col += vec3(1.0, 0.10, 0.18) * beaconMask * (0.35 + 0.85 * beaconBlink);
          }

          // --- Aerial perspective: trench mist pools on the basin floor, thinning with altitude,
          // with warm forward-scatter toward the eclipsed sky-eye. This is what sells the depth.
          // --- Architectural detail that also fakes aerial perspective *within* the object:
          // dark plinth at street level, corner light seams, glowing crown band at the roofline.
          float edgeSeam = smoothstep(0.05, 0.0, min(vUv.x, 1.0 - vUv.x));
          float crownBand = smoothstep(0.87, 0.985, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
          col += mix(vec3(0.26, 0.68, 1.0), vec3(1.0, 0.26, 0.32), uAnomaly * 0.8) * edgeSeam * 0.16;
          col += vec3(0.52, 0.84, 1.0) * crownBand * 0.22;
          col *= 0.62 + 0.38 * smoothstep(-4.0, 46.0, vWorldPos.y);

          // ---- VIEW-DEPENDENT TOWER GLAZING ----
          // The curtain walls are coated in smart glass that reflects the sky-eye. The reflection
          // intensity is Fresnel-driven, so a tower face glows hard when you look at it edge-on
          // and goes almost matte when you face it head-on. Walk past a tower and its whole
          // facade changes brightness - a strong, readable view-dependent cue.
          vec3 vDirC = normalize(cameraPosition - vWorldPos);
          float fresC = pow(1.0 - clamp(dot(nrm, vDirC), 0.0, 1.0), 2.6);
          vec3 skyRefl = mix(vec3(0.04, 0.16, 0.44), vec3(0.30, 0.62, 1.0), fresC);
          col += skyRefl * fresC * 0.26 * (0.5 + 0.5 * abs(nrm.y) * 0.0 + 0.5);
          // A tight specular glint off the glass that tracks the eye across the facade.
          vec3 hC = normalize(normalize(vec3(0.0, 0.42, -0.91)) + vDirC);
          float glintC = pow(max(dot(nrm, hC), 0.0), 90.0);
          col += vec3(0.75, 0.92, 1.0) * glintC * 0.35;

          float camDist = length(cameraPosition - vWorldPos);
          float heightMist = exp(-max(vWorldPos.y + 1.5, 0.0) * 0.022);
          float airDensity = uFogDensity * (0.72 + heightMist * 1.25);
          float fogFactor = 1.0 - exp(-airDensity * airDensity * camDist * camDist);
          vec3 viewW = normalize(vWorldPos - cameraPosition);
          float sunScatter = pow(max(dot(viewW, normalize(vec3(0.0, 0.26, -0.96))), 0.0), 5.0);
          vec3 aerialTint = mix(vec3(0.008, 0.078, 0.20), vec3(0.035, 0.21, 0.47), clamp((vWorldPos.y + 4.0) * 0.014, 0.0, 1.0));
          aerialTint += vec3(0.16, 0.42, 0.88) * sunScatter * 0.72;
          col = mix(col, aerialTint, clamp(fogFactor, 0.0, 0.93));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const citadels = new THREE.InstancedMesh(boxGeo, this.citadelMat, towerCount);
    citadels.frustumCulled = false;
    const tmp = new THREE.Object3D();
    let idx = 0;

    // A) 32 Mid-ground Sunken Chasm Megalith Towers flanking the bridge (|X| = 20..48m, Z = +32..-78)
    for (let i = 0; i < 32; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const tx = side * (21 + (row % 3) * 8.5 + Math.sin(i * 3.1) * 3.0);
      const tz = 30 - row * 7.2;
      const th = 22 + ((i * 17) % 38);
      const tw = 4.2 + (i % 4) * 1.6;
      const td = 4.2 + ((i + 2) % 4) * 1.8;
      tmp.position.set(tx, th * 0.5 - 3.0, tz);
      tmp.rotation.set(0, ((i % 3) - 1) * 0.08, ((i % 2) - 0.5) * 0.03);
      tmp.scale.set(tw, th, td);
      tmp.updateMatrix();
      seedAttr[idx] = ((i * 37) % 100) / 100;
      styleAttr[idx] = ((i * 23) % 10) / 10;
      towerTops.push({ x: tx, y: th - 3.0, z: tz, w: tw });
      citadels.setMatrixAt(idx++, tmp.matrix);
    }

    // B) 116 Horizon Megacity Skyscrapers encircling 360° (r = 68..152m, heights up to 135m!)
    for (let i = 0; i < 116; i++) {
      const ang = (i / 116) * Math.PI * 2 + Math.sin(i * 7.1) * 0.02;
      const ringLayer = i % 3;
      const rad = 70 + ringLayer * 26 + ((i * 13) % 15);
      const tx = Math.cos(ang) * rad;
      const tz = -18 + Math.sin(ang) * rad;
      // Leave a narrow notch directly behind the Sanctuary Core so the Eclipsed Sky Sun shines between twin spires!
      if (Math.abs(tx) < 11 && tz < -65) {
        tmp.position.set(tx < 0 ? -16 : 16, 52, tz);
        tmp.scale.set(8.5, 118, 9.5);
      } else {
        const th = 38 + ringLayer * 28 + ((i * 29) % 46);
        const tw = 6.5 + (i % 5) * 2.6;
        const td = 6.5 + ((i + 3) % 5) * 2.6;
        tmp.position.set(tx, th * 0.5 - 4.0, tz);
        tmp.scale.set(tw, th, td);
      }
      tmp.rotation.set(0, -ang + Math.PI * 0.5, 0);
      tmp.updateMatrix();
      seedAttr[idx] = ((i * 53) % 100) / 100;
      styleAttr[idx] = ((i * 31) % 10) / 10;
      towerTops.push({ x: tmp.position.x, y: tmp.position.y + tmp.scale.y * 0.5, z: tmp.position.z, w: tmp.scale.x });
      citadels.setMatrixAt(idx++, tmp.matrix);
    }

    // C) 8 Colossal Overhead Brutalist Sky-Aqueduct Beams spanning high across the chasm!
    const bridgeZs = [34, 6, -22, -46];
    for (let i = 0; i < 8; i++) {
      const bz = bridgeZs[i % 4] + (i >= 4 ? 2.4 : 0);
      const by = (i >= 4 ? 54 : 38) + (i % 3) * 4;
      tmp.position.set(0, by, bz);
      tmp.rotation.set(0, (i % 2 === 0 ? 1 : -1) * 0.08, (i >= 4 ? 0.025 : -0.02));
      tmp.scale.set(118, i >= 4 ? 1.8 : 2.8, i >= 4 ? 2.2 : 3.6);
      tmp.updateMatrix();
      seedAttr[idx] = 0.85;
      styleAttr[idx] = 0.5;
      citadels.setMatrixAt(idx++, tmp.matrix);
    }

    boxGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedAttr, 1));
    boxGeo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(styleAttr, 1));
    citadels.instanceMatrix.needsUpdate = true;
    this.group.add(citadels);

    // ---------------------------------------------------------------- SPIRES & BEACON CAPS
    // Cap the skyline: antenna spires with pulsing beacon tips on the taller towers. One draw call.
    const spireMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAnomaly;
        void main() {
          float tip = smoothstep(0.55, 1.0, vUv.y);
          float pulse = pow(0.5 + 0.5 * sin(uTime * 2.2 + vWorldPos.x * 0.12 + vWorldPos.z * 0.09), 6.0);
          vec3 col = mix(vec3(0.30, 0.70, 1.0), vec3(1.0, 0.24, 0.30), uAnomaly * 0.85);
          float camDist = length(cameraPosition - vWorldPos);
          float fade = smoothstep(420.0, 60.0, camDist);
          gl_FragColor = vec4(col, (0.10 + tip * 0.55 + pulse * 0.45 * tip) * fade);
        }
      `,
    });

    const spires = towerTops.filter((t) => t.y > 26 && t.w > 3.0).slice(0, 72);
    const spireGeo = new THREE.ConeGeometry(0.55, 1, 5, 1, true);
    spireGeo.translate(0, 0.5, 0);
    const spireMesh = new THREE.InstancedMesh(spireGeo, spireMat, Math.max(1, spires.length));
    spireMesh.frustumCulled = false;
    spireMesh.renderOrder = 2;
    const spDummy = new THREE.Object3D();
    for (let i = 0; i < spires.length; i++) {
      const t = spires[i];
      const h = 8 + ((i * 37) % 22);
      spDummy.position.set(t.x, t.y - 1.5, t.z);
      spDummy.rotation.set(0, (i * 1.7) % 3.14, 0);
      spDummy.scale.set(1.1 + (i % 3) * 0.5, h, 1.1 + (i % 3) * 0.5);
      spDummy.updateMatrix();
      spireMesh.setMatrixAt(i, spDummy.matrix);
    }
    spireMesh.instanceMatrix.needsUpdate = true;
    this.group.add(spireMesh);
    this.spireMat = spireMat;

    // ------------------------------------------------------- STRUCTURAL FINS & BUTTRESSES
    // Flat-shaded boxes read as cardboard at silhouette distance. These faceted buttresses lean
    // against the megaliths and give the skyline real cantilevered structure in one draw call.
    const finMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uFogColor: { value: new THREE.Color(0x011330) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uFogColor;
        void main() {
          vec3 nrm = normalize(vNormalW);
          float ndl = clamp(dot(nrm, normalize(vec3(0.0, 0.5, -0.86))), 0.0, 1.0);
          float rim = pow(1.0 - abs(dot(nrm, normalize(cameraPosition - vWorldPos))), 2.6);
          vec3 col = vec3(0.004, 0.016, 0.055) * (0.5 + 0.9 * ndl) + vec3(0.07, 0.30, 0.72) * rim * 0.42;
          col += vec3(0.20, 0.62, 1.0) * rim * 0.10 * (0.5 + 0.5 * sin(uTime * 0.7 + vWorldPos.y * 0.2));
          float camDist = length(cameraPosition - vWorldPos);
          float airDensity = 0.0056 * (0.72 + exp(-max(vWorldPos.y + 1.5, 0.0) * 0.022) * 1.25);
          float fogFactor = 1.0 - exp(-airDensity * airDensity * camDist * camDist);
          vec3 aerialTint = mix(vec3(0.008, 0.078, 0.20), vec3(0.035, 0.21, 0.47), clamp((vWorldPos.y + 4.0) * 0.014, 0.0, 1.0));
          col = mix(col, aerialTint, clamp(fogFactor, 0.0, 0.93));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const finGeo = this.makeChamferedColumnGeometry(6, 0.7, 6);
    const finTowers = towerTops.filter((t) => t.y > 20).slice(0, 46);
    const finMesh = new THREE.InstancedMesh(finGeo, finMat, Math.max(1, finTowers.length * 2));
    finMesh.frustumCulled = false;
    const finDummy = new THREE.Object3D();
    let fIdx = 0;
    for (let i = 0; i < finTowers.length; i++) {
      const t = finTowers[i];
      for (const dir of [-1, 1]) {
        const h = Math.min(t.y * 0.72, 34) * (0.8 + ((i % 3) * 0.12));
        const lean = 0.19 + (i % 4) * 0.02;
        finDummy.position.set(t.x + dir * t.w * 0.62, h * 0.5 - 3.0, t.z);
        finDummy.rotation.set(0, 0, -dir * lean);
        finDummy.scale.set(1.5 + (i % 3) * 0.6, h, 2.4 + (i % 2) * 1.1);
        finDummy.updateMatrix();
        finMesh.setMatrixAt(fIdx++, finDummy.matrix);
      }
    }
    finMesh.count = fIdx;
    finMesh.instanceMatrix.needsUpdate = true;
    this.group.add(finMesh);
    this.finMat = finMat;

    // D) Colossal Circular Sky-Maw & Solid 58m Vortex Exit Sleeve at (0, 46, 86)
    //    Aimed cleanly at (0, 22, -6) (-14.62 deg pitch) so you fly seamlessly out through the physical 3D rim!
    const skyMonGroup = new THREE.Group();
    skyMonGroup.position.copy(this.skyPortalPos);
    skyMonGroup.lookAt(0, 22.0, -6.0);
    this.skyPortalQuat.copy(skyMonGroup.quaternion);

    // 58m Solid Vortex Sleeve (radius 3.8m deep -> flared 6.4m lip right at z=0, ZERO premature wall fade!)
    // NOTE: the exit deliberately carries NO teeth. The mouth is a clean, smoothly-flared aperture that
    // dissolves into the open sky, so the tunnel->sky junction reads as one continuous organic surface
    // instead of a hard ring of spikes (see the seam-fix below).
    const sleeveLen = 58.0;
    const sleeveGeo = new THREE.CylinderGeometry(5.6, 3.8, sleeveLen, 32, 28, true);
    sleeveGeo.rotateX(Math.PI * 0.5);
    sleeveGeo.translate(0, 0, -sleeveLen * 0.5);

    this.skyTunnelMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: false,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uNoiseTex: { value: getSharedNoiseTexture() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLocalPos;
        varying float vDepth;
        void main() {
          vUv = uv;
          float d = clamp(-position.z / 58.0, 0.0, 1.0);
          vDepth = d;
          // Bell-flare organic lip collar right over the final ~6m. The flare is a smooth C1 curve
          // (cubic ease-out) instead of the old exponential, so the wall has no visible crease where
          // the collar begins - that crease was what read as an abrupt seam at the junction.
          float lipT = clamp((position.z + 6.0) / 6.0, 0.0, 1.0);
          float lipEase = 1.0 - pow(1.0 - lipT, 3.0);
          float lipFlare = 1.0 + 0.145 * lipEase;
          vec3 p = vec3(position.xy * lipFlare, position.z);
          vLocalPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLocalPos;
        varying float vDepth;
        uniform float uTime;
        uniform sampler2D uNoiseTex;
        void main() {
          float safeX = (abs(vLocalPos.x) < 1e-5 && abs(vLocalPos.y) < 1e-5) ? 1e-5 : vLocalPos.x;
          float angle = atan(vLocalPos.y, safeX);
          float zScroll = vLocalPos.z * 0.62 + uTime * 48.0;
          vec4 nSample = texture2D(uNoiseTex, vec2(angle * 0.3183, vLocalPos.z * 0.025 + uTime * 0.18));

          vec2 cell = vec2(angle * 6.366, zScroll);
          vec2 f = fract(cell);
          float line = smoothstep(0.075, 0.0, min(f.x, 1.0 - f.x)) + smoothstep(0.06, 0.0, min(f.y, 1.0 - f.y));
          float helixA = pow(max(0.0, sin(angle * 6.0 + vLocalPos.z * 0.22 + uTime * 17.2)), 8.0);
          float helixB = pow(max(0.0, cos(angle * 10.0 - vLocalPos.z * 0.16 + uTime * 12.7)), 10.0);
          float shockRing = smoothstep(0.92, 1.0, fract(vLocalPos.z * 0.09 + uTime * 7.0));

          // Matches BsodScreen's deep sleeveBase palette 1:1.
          vec3 col = mix(vec3(0.006, 0.12, 0.44), vec3(0.004, 0.065, 0.28), smoothstep(0.08, 0.65, vDepth));
          col += vec3(0.28, 0.76, 1.0) * line * 0.46;
          col += vec3(0.32, 0.84, 1.0) * (helixA * 0.55 + helixB * 0.45) * 0.88;
          col += vec3(0.70, 0.94, 1.0) * shockRing * 0.72;

          // === SMOOTH JUNCTION FIX ===
          // The old build painted a hard "gum collar" ring (with 48 scalloped tooth sockets) across the
          // final 2.6m of the sleeve. That band terminated dead against the open sky and read as a
          // bolted-on seam. It is replaced by a wide, feathered rim-light gradient that keeps the wall
          // alive right up to the aperture and lets the sky colour bleed into it continuously.
          float rimT = clamp((vLocalPos.z + 9.0) / 9.0, 0.0, 1.0);
          float rimGlow = smoothstep(0.0, 1.0, rimT);
          // Slow breathing shimmer along the aperture so the lip feels alive, not machined.
          float breathe = 0.5 + 0.5 * sin(angle * 3.0 + uTime * 0.9 + vLocalPos.z * 0.12);
          vec3 skyBleed = mix(vec3(0.012, 0.10, 0.30), vec3(0.10, 0.34, 0.72), breathe * 0.55 + 0.25);
          col = mix(col, skyBleed, rimGlow * rimGlow * 0.62);
          // A soft luminous edge exactly at the aperture, feathered inward over ~2.5m so it reads as a
          // glow diffusing through the membrane rather than a hard rim.
          float edgeGlow = exp(-max(0.0, -vLocalPos.z) * 0.42);
          col += vec3(0.42, 0.78, 1.0) * edgeGlow * 0.55;
          // Fine organic striation across the collar so the surface still has texture at the seam.
          float striation = 0.5 + 0.5 * sin(angle * 34.0 + vLocalPos.z * 0.9 + uTime * 1.7);
          col += vec3(0.10, 0.26, 0.52) * striation * rimGlow * 0.22;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sleeveMesh = new THREE.Mesh(sleeveGeo, this.skyTunnelMat);
    sleeveMesh.frustumCulled = false;
    skyMonGroup.add(sleeveMesh);
    this.skySleeveMesh = sleeveMesh;

    const backCap = new THREE.Mesh(
      new THREE.CircleGeometry(4.0, 24),
      new THREE.MeshBasicMaterial({ color: 0x00081c, side: THREE.DoubleSide })
    );
    backCap.position.z = -sleeveLen - 0.1;
    skyMonGroup.add(backCap);
    this.skySleeveBackCap = backCap;

    // Soft Radial Corona halo around the 6.4m flared aperture.
    // The old build had a dark "lip shroud" band here which visually completed a toothed maw. With the
    // teeth removed from the exit, that band would read as a disembodied ring of gums, so it is replaced
    // by a pure light halo: a soft radial bloom that hides the sleeve/sky boundary instead of drawing it.
    const riftGeo = new THREE.PlaneGeometry(30.0, 30.0);
    this.skyRiftMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
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
        void main() {
          vec2 d = (vUv - 0.5) * 2.0; // -1..+1 over 30m -> r=0.427 is the 6.4m flared sleeve lip!
          float safeX = (abs(d.x) < 1e-5 && abs(d.y) < 1e-5) ? 1e-5 : d.x;
          float ang = atan(d.y, safeX);
          float r = length(d);

          // Feathered halo: a wide inner glow that spills INTO the aperture plus a thin bright ring
          // exactly on the lip radius. Both are soft, so nothing reads as an edge.
          float innerGlow = smoothstep(0.62, 0.30, r) * smoothstep(0.20, 0.32, r);
          float ring = exp(-abs(r - 0.427) * 16.0);
          float outer = exp(-max(0.0, r - 0.427) * 3.4) * smoothstep(0.427, 0.50, r);

          float a = innerGlow * 0.34 + ring * 0.62 + outer * 0.30;
          // Gentle angular shimmer so the halo breathes instead of looking like a decal.
          a *= 0.82 + 0.18 * (0.5 + 0.5 * sin(ang * 5.0 + uTime * 0.8));
          vec3 col = mix(vec3(0.06, 0.24, 0.62), vec3(0.42, 0.82, 1.0), ring);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    });
    const skyRift = new THREE.Mesh(riftGeo, this.skyRiftMat);
    skyRift.frustumCulled = false;
    skyRift.renderOrder = 2;
    skyMonGroup.add(skyRift);

    // 140 Continuous Outward-Streaming Hyperspace Speed-Lines & Mist Filaments (-48m inside sleeve -> +42m in open sky!)
    // Bridges the tunnel-to-sky transition so speed filaments fly right out into the 3D world around the player!
    const exitLineCount = 140;
    const exitLineGeo = new THREE.BoxGeometry(0.045, 0.045, 1.0);
    const eSeed = new Float32Array(exitLineCount * 4);
    for (let i = 0; i < exitLineCount; i++) {
      eSeed[i * 4 + 0] = (i / exitLineCount) * Math.PI * 2 + (i % 5) * 0.11;
      eSeed[i * 4 + 1] = 1.65 + ((i * 0.381966) % 1) * 4.8; // radius 1.65m..6.45m (clear center corridor!)
      eSeed[i * 4 + 2] = (i * 0.618034) % 1;
      eSeed[i * 4 + 3] = 0.65 + ((i * 0.271828) % 1) * 1.35;
    }
    exitLineGeo.setAttribute('aExitSeed', new THREE.InstancedBufferAttribute(eSeed, 4));
    this.skyExitStreamMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aExitSeed;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          float zMin = -48.0;
          float zSpan = 90.0; // -48m inside sleeve -> +42m out in open sky!
          float spd = 28.0 + aExitSeed.w * 22.0;
          float z = zMin + mod(aExitSeed.z * zSpan + uTime * spd, zSpan);
          float tSpan = (z - zMin) / zSpan;
          // Flare gently outward after crossing Z=0 into open sky!
          float skyFlare = 1.0 + max(0.0, z) * 0.032;
          float swirl = aExitSeed.x + z * 0.018 + uTime * 0.45;
          float r = aExitSeed.y * skyFlare;
          float len = (3.8 + aExitSeed.w * 5.2);
          vec3 lp = vec3(position.x, position.y, position.z * len);
          vAlpha = smoothstep(0.0, 0.12, tSpan) * (1.0 - smoothstep(0.62, 1.0, tSpan)) * (0.42 + 0.45 * fract(aExitSeed.w * 5.7));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(cos(swirl) * r + lp.x, sin(swirl) * r + lp.y, z + lp.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(0.62, 0.92, 1.0, vAlpha);
        }
      `,
    });
    const skyExitStreams = new THREE.InstancedMesh(exitLineGeo, this.skyExitStreamMat, exitLineCount);
    skyExitStreams.frustumCulled = false;
    skyMonGroup.add(skyExitStreams);

    // Outward-blown crystalline glass wreckage orbiting wide around the open flight corridor
    this.skyDebris = new THREE.Group();
    const debrisGeo = new THREE.CylinderGeometry(1, 1, 0.10, 3, 1);
    debrisGeo.rotateX(Math.PI * 0.5);
    const debrisMat = new THREE.MeshBasicMaterial({
      color: 0xa6e2ff,
      transparent: true,
      opacity: 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const debris = new THREE.InstancedMesh(debrisGeo, debrisMat, 36);
    debris.frustumCulled = false;
    const dbDummy = new THREE.Object3D();
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2 + (i % 3) * 0.14;
      const rad = 6.2 + (i % 6) * 1.75;
      dbDummy.position.set(
        Math.cos(ang) * rad,
        Math.sin(ang) * rad,
        1.5 + (i % 7) * 3.1
      );
      dbDummy.rotation.set(i * 0.7, i * 1.1, i * 0.5);
      const sc = 0.65 + (i % 4) * 0.65;
      dbDummy.scale.set(sc, sc * 0.7, sc);
      dbDummy.updateMatrix();
      debris.setMatrixAt(i, dbDummy.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
    this.skyDebris.add(debris);
    skyMonGroup.add(this.skyDebris);

    this.group.add(skyMonGroup);

    // Single focused Sanctuary point light (cuts PointLight shader loop in half while hemi+2 DirLights sculpt causeway!)
    const coreLamp = new THREE.PointLight(0x3aa8ff, 30, 56, 2.0);
    coreLamp.position.set(this.corePosition.x, this.corePosition.y + 9.5, this.corePosition.z);
    this.group.add(coreLamp);
  }

  /**
   * Ultra-Intricate GPU-Driven Megastructures (ONLY 4 Draw Calls = 0.0ms CPU overhead!):
   * 1. 48 Brutalist Gothic Cathedral Rib-Arches framing the Causeway + Diagonal Abyssal Blade Monoliths
   * 2. 14 Colossal 40m Cascading Binary/Hex Data-Waterfalls pouring from the Sky-Aqueducts into the Data-Ocean
   * 3. 72 Frozen Exploding Windows Error-Cascade Panes suspended in mid-air spirals
   * 4. 88 Articulated Biomechanical Kernel-Ouroboros Sky-Leviathan Vertebrae slithering across the high sky!
   */
  /**
   * A unit-height tapered column with `sides` radial segments, a square-ish chamfer profile and
   * flat caps, authored in the same 1×1×1 footprint a BoxGeometry would occupy so existing
   * instance scales keep working. Vertices are split per face so shading stays crisp.
   */
  private makeChamferedColumnGeometry(sides: number, chamfer: number, segs: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const nrm: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    // Profile in XZ: a superellipse-ish chamfered octagon, widened along Z for a blade cross-section.
    const prof: Array<[number, number]> = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      // chamfer blend between a square (0.5) and a circle (0.5·c) footprint
      const px = THREE.MathUtils.lerp(Math.sign(c) * 0.5, c * 0.5, chamfer);
      const pz = THREE.MathUtils.lerp(Math.sign(sn) * 0.5, sn * 0.5, chamfer);
      prof.push([px, pz]);
    }
    // taper: bottom slightly wider than top → structural, load-bearing silhouette
    const taperAt = (h: number) => 1.0 - h * 0.16;
    const ring = (h: number) => {
      const t = taperAt(h);
      return prof.map(([px, pz]) => [px * t, h - 0.5, pz * t] as [number, number, number]);
    };
    const rows = [ring(0), ring(0.5), ring(1)];
    const U = 1 / prof.length;
    for (let r = 0; r < rows.length - 1; r++) {
      const a = rows[r];
      const b = rows[r + 1];
      for (let i = 0; i < prof.length; i++) {
        const j = (i + 1) % prof.length;
        const base = pos.length / 3;
        // face corners: a[i] a[j] b[j] b[i]
        const quad = [a[i], a[j], b[j], b[i]];
        // face normal from the mid-chord
        const ex = a[j][0] - a[i][0];
        const ez = a[j][2] - a[i][2];
        const len = Math.hypot(ex, ez) || 1;
        const nx = ez / len;
        const nz = -ex / len;
        for (let k = 0; k < 4; k++) {
          pos.push(quad[k][0], quad[k][1], quad[k][2]);
          nrm.push(nx, 0, nz);
        }
        uvs.push(i * U, r * 0.5, (i + 1) * U, r * 0.5, (i + 1) * U, (r + 1) * 0.5, i * U, (r + 1) * 0.5);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // caps
    for (const [h, ny] of [
      [0, -1],
      [1, 1],
    ] as Array<[number, number]>) {
      const ringVerts = ring(h);
      const centerIdx = pos.length / 3;
      const t = taperAt(h);
      pos.push(0, h - 0.5, 0);
      nrm.push(0, ny, 0);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < prof.length; i++) {
        pos.push(ringVerts[i][0], ringVerts[i][1], ringVerts[i][2]);
        nrm.push(0, ny, 0);
        uvs.push(0.5 + ringVerts[i][0] * t, 0.5 + ringVerts[i][2] * t);
      }
      for (let i = 0; i < prof.length; i++) {
        const a = centerIdx + 1 + i;
        const b = centerIdx + 1 + ((i + 1) % prof.length);
        if (ny > 0) idx.push(centerIdx, a, b);
        else idx.push(centerIdx, b, a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }

  private buildCathedralCausewayAndLeviathan(): void {
    const tmp = new THREE.Object3D();

    // 1. Cathedral Rib-Arches & Angled Abyssal Blade Monoliths (56 instances, 1 draw call!)
    const ribCount = 56;
    const ribGeo = this.makeChamferedColumnGeometry(8, 0.45, 8);
    const ribPhase = new Float32Array(ribCount);
    this.cathedralMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uFogColor: { value: new THREE.Color(0x011330) },
        uFogDensity: { value: 0.0056 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        varying vec2 vUv;
        varying float vPhase;
        varying float vKeel;
        void main() {
          vUv = uv;
          vPhase = aPhase;
          // Object-space normal tells the fragment shader which facets are structural keels,
          // so the glowing stripes land on the corner faces of the chamfered rib.
          vKeel = smoothstep(0.55, 0.98, abs(normal.x));
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        varying vec2 vUv;
        varying float vPhase;
        varying float vKeel;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        void main() {
          vec3 nrm = normalize(vNormalW);
          float ndl = clamp(dot(nrm, normalize(vec3(0.0, 0.55, -0.84))), 0.0, 1.0);
          float rim = pow(1.0 - abs(dot(nrm, normalize(cameraPosition - vWorldPos))), 2.2);

          // Sequential ceremonial pulse wave racing down the cathedral rib-arches toward the Sanctuary!
          float seqWave = pow(0.5 + 0.5 * sin(uTime * 3.6 - vPhase * 0.72), 6.0);
          float edgeStrip = vKeel;
          float rung = smoothstep(0.86, 0.98, fract(vUv.y * 12.0));

          vec3 col = vec3(0.006, 0.022, 0.075) * (0.4 + 0.8 * ndl) + vec3(0.08, 0.36, 0.85) * rim * 0.48;
          vec3 glowTint = mix(vec3(0.42, 0.88, 1.0), vec3(1.0, 0.18, 0.28), uAnomaly * 0.8);
          col += glowTint * edgeStrip * (0.28 + 0.85 * seqWave);
          col += glowTint * rung * 0.24;

          // --- Aerial perspective: trench mist pools on the basin floor, thinning with altitude,
          // with warm forward-scatter toward the eclipsed sky-eye. This is what sells the depth.
          float camDist = length(cameraPosition - vWorldPos);
          float heightMist = exp(-max(vWorldPos.y + 1.5, 0.0) * 0.022);
          float airDensity = uFogDensity * (0.72 + heightMist * 1.25);
          float fogFactor = 1.0 - exp(-airDensity * airDensity * camDist * camDist);
          vec3 viewW = normalize(vWorldPos - cameraPosition);
          float sunScatter = pow(max(dot(viewW, normalize(vec3(0.0, 0.26, -0.96))), 0.0), 5.0);
          vec3 aerialTint = mix(vec3(0.008, 0.078, 0.20), vec3(0.035, 0.21, 0.47), clamp((vWorldPos.y + 4.0) * 0.014, 0.0, 1.0));
          aerialTint += vec3(0.16, 0.42, 0.88) * sunScatter * 0.72;
          col = mix(col, aerialTint, clamp(fogFactor, 0.0, 0.95));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const cathedralMesh = new THREE.InstancedMesh(ribGeo, this.cathedralMat, ribCount);
    cathedralMesh.frustumCulled = false;
    let rIdx = 0;

    // 12 Pairs (24 ribs) of Towering Inward-Curving Gothic Server-Cathedral Ribs flanking the Causeway!
    for (let i = 0; i < 12; i++) {
      const z = 14.5 - i * 5.2;
      const baseH = this.getTerrainHeight(4.6, z);
      for (const side of [-1, 1]) {
        const archH = 11.5 + (i % 3) * 1.4;
        tmp.position.set(side * 4.85, baseH + archH * 0.42, z);
        tmp.rotation.set(0, 0, side * 0.36);
        tmp.scale.set(0.52, archH, 0.88);
        tmp.updateMatrix();
        ribPhase[rIdx] = i;
        cathedralMesh.setMatrixAt(rIdx++, tmp.matrix);
      }
    }

    // 8 Overhead Crown Cross-Lintels spanning above the Cathedral Ribs
    for (let i = 0; i < 8; i++) {
      const z = 12.0 - i * 7.6;
      const baseH = this.getTerrainHeight(0, z);
      tmp.position.set(0, baseH + 10.6 + (i % 2) * 1.2, z);
      tmp.rotation.set(0, 0, (i % 2 === 0 ? 1 : -1) * 0.03);
      tmp.scale.set(7.4, 0.42, 0.72);
      tmp.updateMatrix();
      ribPhase[rIdx] = i * 1.4;
      cathedralMesh.setMatrixAt(rIdx++, tmp.matrix);
    }

    // 24 Dramatic Diagonal Jagged Obsidian Shard-Spires erupting out of the boiling Data-Ocean!
    for (let i = 0; i < 24; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const sx = side * (12.5 + (row % 3) * 4.8);
      const sz = 22.0 - row * 6.8;
      const sh = 14.0 + ((i * 11) % 16);
      tmp.position.set(sx, sh * 0.34 - 2.2, sz);
      tmp.rotation.set(((i % 3) - 1) * 0.18, ((i * 5) % 7) * 0.12, -side * (0.38 + (i % 3) * 0.09));
      tmp.scale.set(1.35 + (i % 3) * 0.5, sh, 1.8 + (i % 2) * 0.7);
      tmp.updateMatrix();
      ribPhase[rIdx] = row + 3.0;
      cathedralMesh.setMatrixAt(rIdx++, tmp.matrix);
    }

    ribGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ribPhase, 1));
    cathedralMesh.instanceMatrix.needsUpdate = true;
    this.group.add(cathedralMesh);

    // 2. 14 Colossal 40m Cascading Binary/Hex Data-Waterfalls pouring from Sky-Aqueducts into the Data-Ocean!
    const fallCount = 14;
    const fallGeo = new THREE.PlaneGeometry(1, 1, 1, 8);
    this.dataFallsMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uv.y * 12.0 - uTime * 5.0) * 0.06;
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAnomaly;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 41.2);
          return fract(p.x * p.y);
        }

        void main() {
          float xFade = sin(vUv.x * 3.14159265);
          // Roaring downward data streams + foaming splash impact at bottom (vUv.y -> 0)!
          float colId = floor(vUv.x * 18.0);
          float speed = 2.4 + hash21(vec2(colId, 1.3)) * 2.6;
          float cellY = vUv.y * 26.0 + uTime * speed;
          float packet = step(0.42, hash21(vec2(colId, floor(cellY)))) * (0.45 + 0.55 * fract(cellY));
          float splash = smoothstep(0.14, 0.0, vUv.y) * (0.65 + 0.35 * sin(uTime * 14.0 + vUv.x * 20.0));
          float topFade = smoothstep(1.0, 0.88, vUv.y);

          vec3 col = mix(vec3(0.12, 0.68, 1.0), vec3(1.0, 0.20, 0.32), uAnomaly * 0.75);
          col = mix(col, vec3(0.92, 0.99, 1.0), splash * 0.85);
          float alpha = (packet * 0.42 + splash * 0.72) * xFade * topFade;

          float camDist = length(cameraPosition - vWorldPos);
          alpha *= exp(-0.00003 * camDist * camDist);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
        }
      `,
    });
    const fallsMesh = new THREE.InstancedMesh(fallGeo, this.dataFallsMat, fallCount);
    fallsMesh.frustumCulled = false;
    const fallBridgeZs = [34, 6, -22, -46];
    for (let i = 0; i < fallCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const bz = fallBridgeZs[i % 4] + ((i * 3) % 5) - 2.0;
      const fx = side * (15.5 + (i % 3) * 9.5);
      const topY = i >= 10 ? 54.0 : 38.5;
      const h = topY + 0.4;
      tmp.position.set(fx, topY * 0.5 - 0.35, bz);
      tmp.rotation.set(0, side * -0.32, 0);
      tmp.scale.set(2.4 + (i % 3) * 0.9, h, 1);
      tmp.updateMatrix();
      fallsMesh.setMatrixAt(i, tmp.matrix);
    }
    fallsMesh.instanceMatrix.needsUpdate = true;
    this.group.add(fallsMesh);

    // 3. 72 Frozen Exploding Windows Error-Cascade Panes suspended in mid-air spirals (100% GPU animated!)
    const errCanvas = document.createElement('canvas');
    errCanvas.width = 512;
    errCanvas.height = 256;
    const ectx = errCanvas.getContext('2d')!;
    ectx.fillStyle = '#005bb5';
    ectx.fillRect(0, 0, 512, 256);
    ectx.fillStyle = '#e8f4ff';
    ectx.fillRect(0, 0, 512, 38);
    ectx.fillStyle = '#003a7a';
    ectx.font = 'bold 22px Consolas, monospace';
    ectx.fillText('FATAL_EXCEPTION // 0x000000F4', 14, 27);
    ectx.fillStyle = '#d92b3a';
    ectx.fillRect(466, 5, 38, 28);
    ectx.fillStyle = '#ffffff';
    ectx.fillText('X', 478, 27);
    ectx.strokeStyle = '#9ad8ff';
    ectx.lineWidth = 5;
    ectx.strokeRect(3, 3, 506, 250);
    ectx.font = '300 68px "Segoe UI", sans-serif';
    ectx.fillText(':(', 24, 124);
    ectx.font = '20px Consolas, monospace';
    ectx.fillText('CRITICAL_PROCESS_DIED', 126, 98);
    ectx.fillText('MEM_SECTOR_CORRUPTED [99%]', 126, 132);
    ectx.strokeStyle = '#ffffff';
    ectx.lineWidth = 3;
    ectx.strokeRect(176, 184, 160, 42);
    ectx.fillText('[ ABORT ]', 202, 212);
    const errTex = new THREE.CanvasTexture(errCanvas);
    errTex.colorSpace = THREE.SRGBColorSpace;

    const errCount = 72;
    const errGeo = new THREE.PlaneGeometry(2.3, 1.15);
    const errSeed = new Float32Array(errCount);
    this.errorCascadeMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTex: { value: errTex },
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uAnomaly;
        varying vec2 vUv;
        varying float vSeed;
        varying float vDist;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          wp.y += sin(uTime * 1.8 + aSeed * 25.0) * 0.28;
          // Glitch snap sideways during anomalies!
          float snap = step(0.88 - uAnomaly * 0.45, fract(sin(floor(uTime * 16.0) + aSeed * 91.7) * 43758.5));
          wp.x += snap * (aSeed - 0.5) * 2.4;
          vec4 mv = viewMatrix * wp;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        varying float vDist;
        uniform sampler2D uTex;
        uniform float uTime;
        uniform float uAnomaly;
        void main() {
          vec2 uv = vUv;
          if (fract(sin(floor(uTime * 18.0) + vSeed * 43.1) * 9182.3) > 0.85 - uAnomaly * 0.4) {
            uv.x = fract(uv.x + 0.14);
          }
          vec4 tex = texture2D(uTex, uv);
          vec3 col = mix(tex.rgb, vec3(1.0, 0.18, 0.28), uAnomaly * 0.45 * step(0.6, vSeed));
          float fogFade = exp(-0.000045 * vDist * vDist);
          gl_FragColor = vec4(col, 0.88 * fogFade);
        }
      `,
    });
    const errorMesh = new THREE.InstancedMesh(errGeo, this.errorCascadeMat, errCount);
    errorMesh.frustumCulled = false;
    for (let i = 0; i < errCount; i++) {
      // Arrange in classic cascading trails curving up out of the chasm & overhead!
      const trail = i % 4;
      const stepInTrail = Math.floor(i / 4);
      const side = trail % 2 === 0 ? -1 : 1;
      const baseZ = 22.0 - stepInTrail * 4.4;
      const baseX = side * (7.2 + (trail >= 2 ? 6.5 : 0) + Math.sin(stepInTrail * 0.45) * 2.8);
      const baseY = 3.2 + (stepInTrail % 7) * 0.85 + (trail >= 2 ? 5.5 : 0);
      tmp.position.set(baseX, baseY, baseZ);
      tmp.rotation.set(
        Math.sin(i * 0.7) * 0.16,
        side * -0.55 + Math.cos(i * 0.3) * 0.22,
        Math.sin(i * 0.5) * 0.12
      );
      const sc = 0.75 + (stepInTrail % 4) * 0.18;
      tmp.scale.set(sc, sc, 1);
      tmp.updateMatrix();
      errSeed[i] = ((i * 29) % 100) / 100;
      errorMesh.setMatrixAt(i, tmp.matrix);
    }
    errGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(errSeed, 1));
    errorMesh.instanceMatrix.needsUpdate = true;
    this.group.add(errorMesh);

    // 4. Colossal 140m Articulated Biomechanical Sky-Leviathan (88 Chamfered Armor Vertebrae, 100% GPU Vertex-Animated!)
    const segCount = 88;
    const segGeo = this.makeChamferedColumnGeometry(6, 0.38, 2);
    segGeo.rotateX(Math.PI * 0.5);
    const segAttr = new Float32Array(segCount);
    for (let i = 0; i < segCount; i++) segAttr[i] = i / (segCount - 1);
    segGeo.setAttribute('aSeg', new THREE.InstancedBufferAttribute(segAttr, 1));

    this.leviathanMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uFogColor: { value: new THREE.Color(0x011330) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeg;
        uniform float uTime;
        uniform float uAnomaly;
        varying float vSeg;
        varying vec3 vNrm;
        varying float vCamDist;

        vec3 evalSpine(float phase) {
          // Sweeping 136m figure-eight sky orbit weaving through the high Sky-Bridges & above the Sanctuary!
          float x = sin(phase) * 66.0;
          float z = -18.0 + sin(phase * 2.0) * 46.0;
          float y = 56.0 + cos(phase * 3.0) * 12.0 + sin(phase * 7.0) * 2.2;
          return vec3(x, y, z);
        }

        void main() {
          vSeg = aSeg;
          float speed = 0.20 + uAnomaly * 0.18;
          float phase = uTime * speed - aSeg * 1.45;
          vec3 center = evalSpine(phase);
          vec3 ahead = evalSpine(phase + 0.04);
          vec3 fwd = normalize(ahead - center);
          vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(right, fwd);

          // Tapered rib-vertebra profile: massive armored head/thorax tapering to whip tail + dorsal fins!
          float taper = sin(pow(aSeg, 0.65) * 3.14159265);
          float ribFlare = (mod(floor(aSeg * 88.0), 2.0) > 0.5) ? 1.55 : 0.92;
          vec3 sc = vec3((1.2 + taper * 2.8) * ribFlare, (1.1 + taper * 2.4), 1.4 + taper * 1.6);

          vec3 localP = position * sc;
          vec3 worldP = center + right * localP.x + up * localP.y + fwd * localP.z;
          vNrm = normalize(right * normal.x + up * normal.y + fwd * normal.z);

          vec4 mv = viewMatrix * vec4(worldP, 1.0);
          vCamDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vSeg;
        varying vec3 vNrm;
        varying float vCamDist;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uFogColor;
        void main() {
          float ndl = clamp(dot(normalize(vNrm), normalize(vec3(0.0, 0.6, -0.8))), 0.0, 1.0);
          float pulse = pow(0.5 + 0.5 * sin(vSeg * 28.0 - uTime * 6.5), 4.0);
          vec3 body = vec3(0.004, 0.014, 0.052) * (0.4 + 0.8 * ndl);
          vec3 biolum = mix(vec3(0.28, 0.84, 1.0), vec3(1.0, 0.14, 0.24), max(uAnomaly * 0.85, step(vSeg, 0.05)));
          vec3 col = body + biolum * (0.22 + 0.88 * pulse);
          float fog = 1.0 - exp(-0.000022 * vCamDist * vCamDist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 0.86));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const leviathanMesh = new THREE.InstancedMesh(segGeo, this.leviathanMat, segCount);
    leviathanMesh.frustumCulled = false;
    tmp.position.set(0, 0, 0);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    for (let i = 0; i < segCount; i++) {
      leviathanMesh.setMatrixAt(i, tmp.matrix);
    }
    leviathanMesh.instanceMatrix.needsUpdate = true;
    this.group.add(leviathanMesh);
  }

  private buildCentralSanctuary(
    crayTemplate: THREE.Object3D,
    rackTemplate: THREE.Object3D,
    cablesTemplate: THREE.Object3D
  ): void {
    const cx = this.corePosition.x;
    const cy = this.corePosition.y;
    const cz = this.corePosition.z;

    const sanctuary = new THREE.Group();
    sanctuary.position.set(cx, cy, cz);

    // Brutalist stepped octagonal dais under the Cray-1 Supercomputer
    const daisMat = new THREE.MeshLambertMaterial({
      color: 0x002d5c,
      emissive: 0x004e9c,
      emissiveIntensity: 0.45,
    });
    const step1 = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 9.4, 0.45, 8), daisMat);
    step1.position.y = 0.2;
    sanctuary.add(step1);

    const step2 = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.2, 0.45, 8), daisMat);
    step2.position.y = 0.62;
    sanctuary.add(step2);

    // Glowing white alignment ring on the plaza floor showing where to stand
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.8, 7.05, 48),
      new THREE.MeshBasicMaterial({ color: 0xd9f2ff, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.y = 0.46;
    sanctuary.add(ring);

    // Colossal Cray-1 Supercomputer Monument (cray1.glb)!
    const cray = crayTemplate.clone(true);
    cray.scale.setScalar(2.75);
    cray.position.set(0, 0.84, 0);
    cray.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const lam = toFastLambert((o as THREE.Mesh).material as THREE.Material) as THREE.MeshLambertMaterial;
        if (lam.name.includes('red') || lam.name.includes('paint')) {
          lam.color.setHex(0x0078d7);
          lam.emissive.setHex(0x00468c);
          lam.emissiveIntensity = 0.55;
        }
        (o as THREE.Mesh).material = lam;
      }
    });
    sanctuary.add(cray);

    // Towering Fresnel-Softened Skyward Data Vortex Beam rising 160m into the Eclipsed Sky!
    const beamGeo = new THREE.CylinderGeometry(0.55, 1.65, 160, 20, 1, true);
    this.coreBeamMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
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
        uniform float uAnomaly;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fres = pow(abs(dot(normalize(vNormalW), viewDir)), 1.5);
          float rise = 0.65 + 0.35 * sin(vWorldPos.y * 0.45 - uTime * 7.5);
          float pulseBand = smoothstep(0.86, 1.0, fract(vWorldPos.y * 0.045 - uTime * 0.85));
          // Twin counter-rotating helical memory ribbons ascending 160m into the heavens!
          float ang = vUv.x * 6.283185;
          float helix1 = pow(0.5 + 0.5 * sin(ang * 2.0 + vWorldPos.y * 0.14 - uTime * 3.4), 7.0);
          float helix2 = pow(0.5 + 0.5 * sin(-ang * 2.0 + vWorldPos.y * 0.11 - uTime * 2.6), 7.0);
          float topFade = smoothstep(160.0, 18.0, vWorldPos.y);
          float alpha = fres * topFade * (0.24 + 0.24 * pulseBand + 0.38 * (helix1 + helix2) + uAnomaly * 0.28) * rise;
          vec3 col = mix(vec3(0.62, 0.92, 1.0), vec3(1.0, 0.24, 0.36), uAnomaly * 0.75);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const beam = new THREE.Mesh(beamGeo, this.coreBeamMat);
    beam.position.y = 80;
    sanctuary.add(beam);

    // 3 Counter-Rotating Giant Gyroscopic Kernel Halo Rings hovering above the Cray-1 Core!
    const ringRadii = [5.2, 6.8, 8.5];
    for (let rIdx = 0; rIdx < ringRadii.length; rIdx++) {
      const rGeo = new THREE.TorusGeometry(ringRadii[rIdx], 0.075, 8, 56);
      const rMat = new THREE.MeshBasicMaterial({
        color: rIdx === 0 ? 0xffffff : rIdx === 1 ? 0x7fd4ff : 0x1ea0ff,
        transparent: true,
        opacity: 0.82 - rIdx * 0.14,
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.set(0, 11.2, 0);
      sanctuary.add(rMesh);
      this.gyroRings.push(rMesh);
    }

    // Encircling Towering Server Rack Obelisks + Hanging Umbilical Cables (Instanced for single draw call!)
    const sanctRackMats: THREE.Matrix4[] = [];
    const sanctCableMats: THREE.Matrix4[] = [];
    const tmpObj = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Math.PI * 0.125;
      if (Math.abs(Math.sin(ang) - 1.0) < 0.18) continue;

      const rad = 11.2;
      const rx = Math.cos(ang) * rad;
      const rz = Math.sin(ang) * rad;

      tmpObj.position.set(rx, -0.4, rz);
      tmpObj.scale.set(2.8, 3.6, 2.8);
      tmpObj.lookAt(0, 2.0, 0);
      tmpObj.updateMatrix();
      sanctRackMats.push(tmpObj.matrix.clone());

      tmpObj.position.set(rx * 0.85, 6.8, rz * 0.85);
      tmpObj.scale.set(6.5, 4.0, 4.0);
      tmpObj.lookAt(0, 4.5, 0);
      tmpObj.updateMatrix();
      sanctCableMats.push(tmpObj.matrix.clone());
    }
    addInstancedGltf(sanctuary, rackTemplate, sanctRackMats);
    addInstancedGltf(sanctuary, cablesTemplate, sanctCableMats);

    // === THE WORLD SECRET: "WAKE_UP" 3D OBSIDIAN & CRYSTAL STELE MONOLITHS ===
    const chars = ['W', 'A', 'K', 'E', '_', 'U', 'P'];
    const spacing = 1.44;
    const startX = -((chars.length - 1) * spacing) * 0.5;
    const steleBackingMat = new THREE.MeshLambertMaterial({
      color: 0x050e22,
      emissive: 0x062858,
      emissiveIntensity: 0.75,
    });

    for (let i = 0; i < chars.length; i++) {
      const chCanvas = document.createElement('canvas');
      chCanvas.width = 256;
      chCanvas.height = 320;
      const cctx = chCanvas.getContext('2d')!;
      cctx.fillStyle = '#031d44';
      cctx.fillRect(0, 0, 256, 320);
      cctx.strokeStyle = '#6ec8ff';
      cctx.lineWidth = 8;
      cctx.strokeRect(10, 10, 236, 300);
      cctx.strokeStyle = 'rgba(255,255,255,0.45)';
      cctx.lineWidth = 2;
      cctx.strokeRect(22, 22, 212, 276);

      cctx.fillStyle = '#7acbff';
      cctx.font = '18px Consolas, monospace';
      cctx.textAlign = 'center';
      cctx.fillText(`0x0${i + 1}`, 128, 44);

      cctx.fillStyle = '#ffffff';
      cctx.font = 'bold 186px Consolas, "Segoe UI", monospace';
      cctx.textBaseline = 'middle';
      cctx.shadowColor = '#66c8ff';
      cctx.shadowBlur = 22;
      cctx.fillText(chars[i], 128, 172);

      const tex = new THREE.CanvasTexture(chCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;

      // Sculpted 3D obsidian tablet with front & back illuminated crystal glyph face
      const steleBody = new THREE.Mesh(new THREE.BoxGeometry(1.26, 1.58, 0.18), steleBackingMat);
      const faceMat = new THREE.MeshBasicMaterial({ map: tex });
      const frontFace = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.48), faceMat);
      frontFace.position.z = 0.095;
      const backFace = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.48), faceMat);
      backFace.rotation.y = Math.PI;
      backFace.position.z = -0.095;
      steleBody.add(frontFace, backFace);

      const alignedPos = new THREE.Vector3(startX + i * spacing, 7.55, 1.8);
      const scatteredPos = new THREE.Vector3(
        startX * 1.9 + (i - 3) * 3.1 + Math.sin(i * 2.3) * 2.8,
        8.5 + (i % 3) * 2.6,
        -4.5 + Math.cos(i * 1.9) * 5.8
      );
      const scatteredRot = new THREE.Euler(
        (i % 2 === 0 ? 1 : -1) * 0.65,
        (i - 3) * 0.55,
        Math.sin(i * 1.7) * 0.48
      );

      steleBody.position.copy(scatteredPos);
      steleBody.rotation.copy(scatteredRot);
      sanctuary.add(steleBody);

      this.wakePlates.push({
        mesh: steleBody,
        alignedPos,
        scatteredPos,
        scatteredRot,
      });
    }

    // Sculpted Brutalist Lectern Pedestal + Core Terminal Inscription Plaque at front of Cray-1 Core
    const lecternPedestal = new THREE.Mesh(
      this.makeChamferedColumnGeometry(8, 0.38, 4),
      steleBackingMat
    );
    lecternPedestal.position.set(0, 1.0, 3.74);
    lecternPedestal.scale.set(1.15, 2.0, 0.72);
    sanctuary.add(lecternPedestal);

    const plaqueBezel = new THREE.Mesh(new THREE.BoxGeometry(2.64, 1.06, 0.12), steleBackingMat);
    plaqueBezel.position.set(0, 2.05, 3.59);
    plaqueBezel.rotation.x = -0.22;
    sanctuary.add(plaqueBezel);

    const plaqueCanvas = document.createElement('canvas');
    plaqueCanvas.width = 1024;
    plaqueCanvas.height = 384;
    const pctx = plaqueCanvas.getContext('2d')!;
    pctx.fillStyle = '#001836';
    pctx.fillRect(0, 0, 1024, 384);
    pctx.strokeStyle = '#6ec4ff';
    pctx.lineWidth = 6;
    pctx.strokeRect(8, 8, 1008, 368);

    pctx.fillStyle = '#82cdff';
    pctx.font = '25px Consolas, monospace';
    pctx.fillText('KERNEL_CORE_REGISTER // 0x0078D7 [HOST_SESSION: 02:47]', 44, 66);

    pctx.fillStyle = '#ffffff';
    pctx.font = 'bold 54px Consolas, monospace';
    pctx.fillText('EMERGENCY INTERRUPT : WAKE_UP', 44, 166);

    pctx.fillStyle = '#d4ecff';
    pctx.font = '28px "Segoe UI", "Yu Gothic UI", sans-serif';
    pctx.fillText('[ C ] でカーネルコンソールを開き WAKE_UP を実行せよ。', 44, 254);
    pctx.fillText('※ 意識が完全にダンプ固定される前に強制割り込みをかけろ', 44, 304);

    const plaqueTex = new THREE.CanvasTexture(plaqueCanvas);
    plaqueTex.colorSpace = THREE.SRGBColorSpace;

    this.corePlaqueMat = new THREE.MeshBasicMaterial({
      map: plaqueTex,
      transparent: true,
      opacity: 0.35,
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.94), this.corePlaqueMat);
    plaque.position.set(0, 2.05, 3.66);
    plaque.rotation.x = -0.22;
    sanctuary.add(plaque);

    this.group.add(sanctuary);
  }

  private buildWorldLandmarks(
    rackTemplate: THREE.Object3D,
    crtTemplate: THREE.Object3D,
    moboTemplate: THREE.Object3D,
    cablesTemplate: THREE.Object3D
  ): void {
    // Shared animated BSOD glow shader for all floating CRT Monitor glass screens (supports Instancing!)
    this.crtGlassMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uAnomaly;
        void main() {
          float scan = 0.86 + 0.14 * sin(vUv.y * 95.0 - uTime * 12.0 + vWorld.x);
          float bar = step(0.84, fract(vUv.y * 5.0 - uTime * 0.45 + vWorld.z * 0.2));
          vec3 col = vec3(0.0, 0.191, 0.687) * scan;

          // Watching ':(' eyes inside every floating CRT screen that blink & snap bright during Anomaly Surges!
          float blink = step(0.06, fract(uTime * 0.23 + vWorld.x * 0.17 + vWorld.z * 0.11)) + step(0.25, uAnomaly);
          vec2 cUv = (vUv - 0.5) * vec2(1.35, 1.0);
          float eyeL = smoothstep(0.085, 0.045, length(cUv - vec2(-0.18, 0.14)));
          float eyeR = smoothstep(0.085, 0.045, length(cUv - vec2(0.18, 0.14)));
          float mouth = smoothstep(0.045, 0.018, abs(length(cUv - vec2(0.0, -0.32)) - 0.22)) * step(-0.22, cUv.y);
          float watcher = clamp((eyeL + eyeR) * clamp(blink, 0.0, 1.0) + mouth * 0.85, 0.0, 1.0);

          col = mix(col, vec3(0.95, 0.99, 1.0), clamp(bar * 0.28 + watcher * (0.65 + uAnomaly * 0.35) + uAnomaly * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const tmp = new THREE.Object3D();

    // 1. Towering Server Rack Megaliths (batched into InstancedMesh!)
    const rackPlacements: Array<[number, number, number, number]> = [
      [-8.5, 8, 2.2, 0.35],
      [9.2, 5, 2.4, -0.42],
      [-11.0, -8, 2.9, 0.25],
      [11.5, -11, 2.7, -0.3],
      [-9.5, -24, 3.1, 0.4],
      [10.2, -27, 3.3, -0.35],
      [-13.5, -40, 3.5, 0.2],
      [13.8, -41, 3.4, -0.22],
      [-34, -18, 6.8, 0.5],
      [38, -26, 7.4, -0.6],
      [-28, -74, 8.2, 0.3],
      [31, -78, 8.5, -0.4],
    ];
    const rackMatrices: THREE.Matrix4[] = [];
    for (const [rx, rz, sc, rotY] of rackPlacements) {
      tmp.position.set(rx, this.getTerrainHeight(rx, rz) - 0.25, rz);
      tmp.scale.setScalar(sc);
      tmp.rotation.set(Math.sin(rx) * 0.06, rotY, Math.cos(rz) * 0.05);
      tmp.updateMatrix();
      rackMatrices.push(tmp.matrix.clone());
    }
    addInstancedGltf(this.group, rackTemplate, rackMatrices);

    // 2. Giant Fractured Motherboard Tectonic Slabs (batched into 1 InstancedMesh!)
    const moboPlacements: Array<[number, number, number, number, number]> = [
      [-15.5, 2, 22, 0.5, 0.62],
      [16.2, -4, 24, -0.6, -0.55],
      [-18.0, -19, 28, 0.8, 0.48],
      [19.5, -22, 26, -0.7, -0.52],
      [-17.2, -35, 30, 0.4, 0.58],
      [17.8, -37, 29, -0.5, -0.6],
      [-26.0, -55, 38, 0.9, 0.45],
      [27.0, -58, 36, -0.85, -0.45],
    ];
    const moboMatrices: THREE.Matrix4[] = [];
    for (const [mx, mz, sc, ryRot, rzRot] of moboPlacements) {
      tmp.position.set(mx, this.getTerrainHeight(mx, mz) + 0.6, mz);
      tmp.scale.setScalar(sc);
      tmp.rotation.set(0.25, ryRot, rzRot);
      tmp.updateMatrix();
      moboMatrices.push(tmp.matrix.clone());
    }
    addInstancedGltf(this.group, moboTemplate, moboMatrices);

    // 3. Suspended Vintage CRT Monitors + Colossal Arrival Monitor + Dangling Cables (batched into InstancedMeshes!)
    const crtPlacements: Array<[number, number, number, number]> = [
      [-3.8, 12, 1.85, 2.4],
      [4.2, 6, 2.35, -2.2],
      [-4.6, -3, 2.1, 2.1],
      [4.9, -14, 2.6, -2.5],
      [-5.2, -21, 1.95, 1.9],
      [4.5, -31, 2.4, -2.1],
      [-4.4, -42, 2.8, 2.3],
      [4.8, -44, 2.2, -2.3],
      [-8.5, -49, 3.6, 1.8],
      [8.5, -49, 3.6, -1.8],
    ];
    const crtMatrices: THREE.Matrix4[] = [];
    const crtCableMatrices: THREE.Matrix4[] = [];
    for (const [cx, cz, hOff, rotY] of crtPlacements) {
      const baseH = this.getTerrainHeight(cx, cz);
      tmp.position.set(cx, baseH + hOff, cz);
      tmp.scale.setScalar(2.65);
      tmp.rotation.set(0.14, rotY, Math.sin(cx + cz) * 0.14);
      tmp.updateMatrix();
      crtMatrices.push(tmp.matrix.clone());

      tmp.position.set(cx, baseH + hOff - 0.55, cz);
      tmp.scale.setScalar(1.9);
      tmp.rotation.set(0, rotY, Math.PI * 0.5);
      tmp.updateMatrix();
      crtCableMatrices.push(tmp.matrix.clone());
    }
    // Include the Colossal Fractured Arrival Monitor behind spawn (Z=+27.5) in the same batch!
    tmp.position.set(0, this.getTerrainHeight(0, 27.5) + 3.2, 27.5);
    tmp.scale.setScalar(16.0);
    tmp.rotation.set(-0.08, Math.PI, 0.04);
    tmp.updateMatrix();
    crtMatrices.push(tmp.matrix.clone());

    addInstancedGltf(this.group, crtTemplate, crtMatrices, (mat) =>
      mat && mat.name.includes('glass') ? this.crtGlassMat : toFastLambert(mat)
    );
    addInstancedGltf(this.group, cablesTemplate, crtCableMatrices);

    // 4. Processional Brutalist Memory-Gate Colonnade framing the causeway toward the Cray-1 Sanctuary (1 InstancedMesh!)
    const gateZList = [13, 3, -7, -17, -27, -37];
    const gateBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const gateBoxMat = new THREE.MeshLambertMaterial({
      color: 0x003a7a,
      emissive: 0x002452,
      emissiveIntensity: 0.65,
    });
    const gateInst = new THREE.InstancedMesh(gateBoxGeo, gateBoxMat, gateZList.length * 3);
    gateInst.frustumCulled = false;
    let gIdx = 0;
    for (let i = 0; i < gateZList.length; i++) {
      const gz = gateZList[i];
      const spanX = 5.6 + (i % 2) * 0.45;
      const colH = 7.4 + i * 0.55;
      const hL = this.getTerrainHeight(-spanX, gz);
      const hR = this.getTerrainHeight(spanX, gz);

      // Left monolithic pillar
      tmp.position.set(-spanX, hL + colH * 0.5 - 0.4, gz);
      tmp.rotation.set(0, 0, -0.04);
      tmp.scale.set(0.68, colH, 0.88);
      tmp.updateMatrix();
      gateInst.setColorAt(gIdx, new THREE.Color(0x0066cc));
      gateInst.setMatrixAt(gIdx++, tmp.matrix);

      // Right monolithic pillar
      tmp.position.set(spanX, hR + colH * 0.5 - 0.4, gz);
      tmp.rotation.set(0, 0, 0.04);
      tmp.scale.set(0.68, colH, 0.88);
      tmp.updateMatrix();
      gateInst.setColorAt(gIdx, new THREE.Color(0x0066cc));
      gateInst.setMatrixAt(gIdx++, tmp.matrix);

      // Floating fractured lintel arch beam overhead
      tmp.position.set(0, Math.max(hL, hR) + colH + 0.45 + Math.sin(i * 1.9) * 0.25, gz);
      tmp.rotation.set(0.03 * ((i % 2) - 0.5), 0, Math.sin(i * 2.1) * 0.045);
      tmp.scale.set(spanX * 2.18, 0.46, 0.92);
      tmp.updateMatrix();
      gateInst.setColorAt(gIdx, new THREE.Color(0x7fd2ff));
      gateInst.setMatrixAt(gIdx++, tmp.matrix);
    }
    gateInst.instanceMatrix.needsUpdate = true;
    gateInst.instanceColor!.needsUpdate = true;
    this.group.add(gateInst);

    this.createDiegeticLogSign(
      new THREE.Vector3(-2.8, this.getTerrainHeight(-2.8, 9) + 1.45, 9),
      0.38,
      'MEMORY_0247.DMP // 意識隔離領域',
      'あなたの身体はまだ部屋の椅子に座ったまま、顎に咥えられています。',
      '中央核から伸びる「3本の紅い神経動脈」を辿り、楔をすべて引き抜け。'
    );

    this.createDiegeticLogSign(
      new THREE.Vector3(3.1, this.getTerrainHeight(3.1, -18) + 1.45, -18),
      -0.38,
      'OPTIC_HAZARD // 天球の紅い凝視',
      '空の瞳が紅く脈動している間、その瞳を直視してはならない。',
      '視線を伏せるか肋骨アーチの影に隠れ、[ C ] コンソールで封印状態を確認せよ。'
    );
  }

  private createDiegeticLogSign(
    pos: THREE.Vector3,
    rotY: number,
    header: string,
    line1: string,
    line2: string
  ): void {
    const c = document.createElement('canvas');
    c.width = 768;
    c.height = 280;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(2, 22, 54, 0.94)';
    ctx.fillRect(0, 0, 768, 280);
    ctx.fillStyle = 'rgba(24, 118, 220, 0.28)';
    ctx.fillRect(10, 10, 748, 56);
    ctx.strokeStyle = 'rgba(130, 212, 255, 0.92)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 752, 264);

    ctx.fillStyle = '#8ad4ff';
    ctx.font = 'bold 22px Consolas, monospace';
    ctx.fillText(header, 32, 46);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px "Segoe UI", "Yu Gothic UI", sans-serif';
    ctx.fillText(line1, 32, 136);
    ctx.fillText(line2, 32, 188);

    ctx.fillStyle = 'rgba(122, 200, 255, 0.65)';
    ctx.font = '16px Consolas, monospace';
    ctx.fillText('STATUS: DIAGNOSTIC_TERMINAL_ONLINE // [0x0078D7]', 32, 246);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;

    // Sculpted Brutalist Obsidian Diagnostic Lectern (replaces thin 5cm stick post!)
    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(pos.x, pos.y - 1.45, pos.z);
    consoleGroup.rotation.y = rotY;

    const obsidianMat = new THREE.MeshLambertMaterial({
      color: 0x050e22,
      emissive: 0x041d42,
      emissiveIntensity: 0.65,
    });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x5cc2ff });

    const plinth = new THREE.Mesh(this.makeChamferedColumnGeometry(8, 0.35, 2), obsidianMat);
    plinth.position.set(0, 0.68, -0.08);
    plinth.scale.set(0.88, 1.36, 0.56);
    consoleGroup.add(plinth);

    const baseGlow = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.05, 0.72), trimMat);
    baseGlow.position.set(0, 0.03, -0.08);
    consoleGroup.add(baseGlow);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.84, 0.14), obsidianMat);
    hood.position.set(0, 1.42, 0.02);
    hood.rotation.x = -0.24;
    consoleGroup.add(hood);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.94, 0.71),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    sign.position.set(0, 1.42, 0.095);
    sign.rotation.x = -0.24;
    consoleGroup.add(sign);

    this.group.add(consoleGroup);
  }

  private buildFloatingAtmosphere(): void {
    // 1. 100% GPU-Animated Floating Corrupted BSOD UI Shards (0.0ms CPU per frame!)
    const shardCanvas = document.createElement('canvas');
    shardCanvas.width = 256;
    shardCanvas.height = 128;
    const ctx = shardCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0, 108, 204, 0.86)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#d8f2ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = '22px Consolas, monospace';
    ctx.fillText(':(  ERR_0xF4', 20, 48);
    ctx.fillRect(20, 74, 175, 10);
    ctx.strokeRect(20, 74, 210, 10);

    const shardTex = new THREE.CanvasTexture(shardCanvas);
    shardTex.colorSpace = THREE.SRGBColorSpace;

    const shardGeo = new THREE.PlaneGeometry(1.4, 0.7);
    const aBase = new Float32Array(FLOATING_SHARD_COUNT * 4);
    const aSpin = new Float32Array(FLOATING_SHARD_COUNT * 4);
    for (let i = 0; i < FLOATING_SHARD_COUNT; i++) {
      const x = (Math.random() - 0.5) * 96;
      const z = -75 + Math.random() * 105;
      const y = this.getTerrainHeight(x, z) + 2.2 + Math.random() * 18.0;
      aBase[i * 4 + 0] = x;
      aBase[i * 4 + 1] = y;
      aBase[i * 4 + 2] = z;
      aBase[i * 4 + 3] = 0.55 + Math.random() * 1.45; // scale

      aSpin[i * 4 + 0] = (Math.random() - 0.5) * 0.35;
      aSpin[i * 4 + 1] = (Math.random() - 0.5) * 0.45;
      aSpin[i * 4 + 2] = Math.random() * Math.PI * 2;
      aSpin[i * 4 + 3] = (i % 3) - 1;
    }
    shardGeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 4));
    shardGeo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(aSpin, 4));

    this.floatingShardMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTex: { value: shardTex },
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aBase;
        attribute vec4 aSpin;
        uniform float uTime;
        uniform float uAnomaly;
        varying vec2 vUv;
        varying float vDist;
        void main() {
          vUv = uv;
          float ay = aSpin.z + uTime * aSpin.y;
          float ax = aSpin.z * 0.7 + uTime * aSpin.x;
          float cy = cos(ay), sy = sin(ay);
          float cx = cos(ax), sx = sin(ax);
          vec3 p = position * aBase.w;
          vec3 p1 = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
          vec3 p2 = vec3(p1.x * cy + p1.z * sy, p1.y, -p1.x * sy + p1.z * cy);

          float jump = step(0.5, uAnomaly) * sin(uTime * 55.0) * 0.35 * aSpin.w;
          vec3 worldP = aBase.xyz + vec3(jump, sin(uTime * 0.9 + aSpin.z) * 0.45, 0.0) + p2;
          vec4 mv = viewMatrix * vec4(worldP, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vDist;
        uniform sampler2D uTex;
        uniform float uAnomaly;
        void main() {
          vec4 tex = texture2D(uTex, vUv);
          vec3 col = mix(tex.rgb, vec3(1.0, 0.25, 0.34), uAnomaly * 0.45);
          float fade = smoothstep(145.0, 35.0, vDist);
          gl_FragColor = vec4(col, tex.a * 0.82 * fade);
        }
      `,
    });
    this.floatingShards = new THREE.InstancedMesh(shardGeo, this.floatingShardMat, FLOATING_SHARD_COUNT);
    this.floatingShards.frustumCulled = false;
    this.group.add(this.floatingShards);

    // 2. Reverse-Snow Rising Digital Pixel Motes (1 draw call!)
    const pCount = 800;
    const positions = new Float32Array(pCount * 3);
    const phases = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 110;
      positions[i * 3 + 1] = Math.random() * 32;
      positions[i * 3 + 2] = -82 + Math.random() * 115;
      phases[i] = Math.random() * 100.0;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.45 + fract(aPhase) * 0.65), 32.0);
          p.x += sin(uTime * 0.6 + aPhase) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vAlpha = smoothstep(75.0, 12.0, dist) * (0.45 + 0.55 * sin(uTime * 3.0 + aPhase));
          gl_PointSize = clamp(18.0 / max(1.0, dist), 1.5, 5.5);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(0.78, 0.93, 1.0, vAlpha * 0.72);
        }
      `,
    });
    this.dustPoints = new THREE.Points(pGeo, this.dustMat);
    this.group.add(this.dustPoints);

    // 3. 4 Towering Translucent Sky Error Dialog Monoliths around the Glitch World basin (grand commercial scale!)
    const monoCanvas = document.createElement('canvas');
    monoCanvas.width = 512;
    monoCanvas.height = 320;
    const mctx = monoCanvas.getContext('2d')!;
    mctx.fillStyle = 'rgba(0, 74, 168, 0.72)';
    mctx.fillRect(0, 0, 512, 320);
    mctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    mctx.fillRect(0, 0, 512, 34);
    mctx.fillStyle = '#004aa8';
    mctx.font = 'bold 20px Consolas, monospace';
    mctx.fillText('KERNEL_PANIC_MEMORY_DUMP.SYS', 16, 24);
    mctx.fillText('[X]', 468, 24);
    mctx.strokeStyle = 'rgba(180, 228, 255, 0.85)';
    mctx.lineWidth = 3;
    mctx.strokeRect(3, 3, 506, 314);
    mctx.fillStyle = '#eaf6ff';
    mctx.font = '22px Consolas, monospace';
    mctx.fillText(':(  UNRECOVERABLE_CONSCIOUSNESS_FAULT', 24, 92);
    mctx.font = '17px Consolas, monospace';
    mctx.fillText('ADDRESS: 0xFFFFF803_0078D700', 24, 136);
    mctx.fillText('THREAD_LOCKED_IN_DISPLAY_BUFFER', 24, 168);
    mctx.strokeRect(24, 212, 464, 22);
    mctx.fillRect(28, 216, 442, 14);
    mctx.fillText('99% COMPLETE — AWAITING SHELL SIGNAL', 24, 272);

    const monoTex = new THREE.CanvasTexture(monoCanvas);
    monoTex.colorSpace = THREE.SRGBColorSpace;
    const monoMat = new THREE.MeshBasicMaterial({
      map: monoTex,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const monoGeo = new THREE.PlaneGeometry(28, 17.5);
    const monoSpots: Array<[number, number, number, number]> = [
      [-58, 26, -34, 0.48],
      [60, 29, -28, -0.52],
      [-42, 32, -88, 0.22],
      [46, 30, -86, -0.25],
    ];
    for (const [mx, my, mz, mry] of monoSpots) {
      const m = new THREE.Mesh(monoGeo, monoMat);
      m.position.set(mx, my, mz);
      m.rotation.y = mry;
      this.group.add(m);
    }
  }

  /**
   * Aerial depth pass — the layer that makes the basin read as a *place* rather than a diorama.
   *
   *  1. Trench mist volumes: camera-facing billboards pooling in the chasms (1 draw call).
   *  2. Cloud decks: two fbm sheets passing overhead and through the sky-monitor (1 draw call each).
   *  3. Horizon silhouettes: a distant ring of megastructures fading into the aerial haze.
   *  4. Sky traffic: packets of light streaming along elevated lanes between the towers.
   *  5. Sky-eye light shafts: additive volumetric wedges fanning out of the eclipsed corona.
   *
   * Total added cost: 6 draw calls, zero per-frame allocation.
   */
  private buildAtmosphericDepth(): void {
    // ---------------------------------------------------------------- 1. TRENCH MIST VOLUMES (Fast uNoiseTex!)
    this.mistMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uNoiseTex: { value: getSharedNoiseTexture() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vFade;
        void main() {
          vUv = uv;
          vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sx = length(instanceMatrix[0].xyz);
          float sy = length(instanceMatrix[1].xyz);
          vec3 toCam = cameraPosition - center;
          toCam.y = 0.0;
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(0.0001, 0.0, 0.0));
          vec3 wp = center + right * (position.x * sx) + vec3(0.0, position.y * sy, 0.0);
          vWorldPos = wp;
          float dist = length(cameraPosition - wp);
          vFade = smoothstep(2.0, 10.5, length(cameraPosition.xz - center.xz)) * smoothstep(320.0, 60.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vFade;
        uniform float uTime;
        uniform float uAnomaly;
        uniform sampler2D uNoiseTex;

        void main() {
          vec2 p = vUv * vec2(0.85, 0.55) + vec2(uTime * 0.006, uTime * 0.003);
          float n1 = texture2D(uNoiseTex, p).r;
          float n2 = texture2D(uNoiseTex, p * 2.3 - vec2(uTime * 0.005, 0.0)).g;
          float n = n1 * 0.72 + n2 * 0.28;
          float edge = smoothstep(0.0, 0.36, vUv.x) * smoothstep(1.0, 0.64, vUv.x)
                     * smoothstep(0.0, 0.32, vUv.y) * smoothstep(1.0, 0.56, vUv.y);
          float body = smoothstep(0.34, 0.84, n) * edge * vFade;

          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float scatter = pow(max(dot(viewDir, normalize(vec3(0.0, 0.30, -0.95))), 0.0), 3.0);
          vec3 col = mix(vec3(0.035, 0.11, 0.26), vec3(0.14, 0.34, 0.66), scatter);
          col = mix(col, vec3(0.30, 0.10, 0.16), uAnomaly * 0.45);
          gl_FragColor = vec4(col, body * (0.28 + uAnomaly * 0.14));
        }
      `,
    });

    const MIST_COUNT = 36;
    const mistGeo = new THREE.PlaneGeometry(1, 1);
    const mist = new THREE.InstancedMesh(mistGeo, this.mistMat, MIST_COUNT);
    mist.frustumCulled = false;
    mist.renderOrder = 3;
    const mDummy = new THREE.Object3D();
    for (let i = 0; i < MIST_COUNT; i++) {
      const alongBridge = i % 4 !== 0;
      const side = i % 2 === 0 ? -1 : 1;
      let mx: number;
      let mz: number;
      let my: number;
      if (alongBridge) {
        mx = side * (12 + Math.random() * 26);
        mz = -84 + Math.random() * 118;
        my = -1.4 + Math.random() * 3.4;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const r = 86 + Math.random() * 62;
        mx = Math.cos(ang) * r;
        mz = -18 + Math.sin(ang) * r;
        my = 2.0 + Math.random() * 9.0;
      }
      const w = 28 + Math.random() * 30;
      const h = 9 + Math.random() * 13;
      mDummy.position.set(mx, my + h * 0.4, mz);
      mDummy.rotation.set(0, 0, 0);
      mDummy.scale.set(w, h, 1);
      mDummy.updateMatrix();
      mist.setMatrixAt(i, mDummy.matrix);
    }
    mist.instanceMatrix.needsUpdate = true;
    this.group.add(mist);

    // ---------------------------------------------------------------- 2. UNIFIED STORM CLOUD DECK (Single pass, 2 taps!)
    this.cloudDeckMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uNoiseTex: { value: getSharedNoiseTexture() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uAnomaly;
        uniform sampler2D uNoiseTex;

        void main() {
          vec2 drift = vec2(uTime * 0.0028, uTime * 0.0012);
          vec2 p = vWorldPos.xz * 0.0014 + drift;
          float base = texture2D(uNoiseTex, p).r;
          float detail = texture2D(uNoiseTex, p * 2.9 - drift * 1.6).g;
          float cloud = smoothstep(0.44, 0.78, base * 0.74 + detail * 0.26);

          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float sunScatter = pow(max(dot(viewDir, normalize(vec3(0.0, 0.30, -0.95))), 0.0), 4.0);
          vec3 col = mix(vec3(0.012, 0.055, 0.145), vec3(0.11, 0.32, 0.66), sunScatter);
          col = mix(col, vec3(0.34, 0.06, 0.14), uAnomaly * 0.55);
          col += vec3(0.42, 0.76, 1.0) * pow(cloud, 2.0) * 0.15 * (0.4 + sunScatter);

          float dist = length(cameraPosition - vWorldPos);
          float fade = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x)
                     * smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.72, vUv.y)
                     * smoothstep(780.0, 160.0, dist);
          gl_FragColor = vec4(col, cloud * fade * 0.36);
        }
      `,
    });

    const deckUnified = new THREE.Mesh(new THREE.PlaneGeometry(820, 820), this.cloudDeckMat);
    deckUnified.rotation.x = -Math.PI * 0.5;
    deckUnified.position.set(0, 74, -18);
    deckUnified.renderOrder = 2;
    this.group.add(deckUnified);

    // ---------------------------------------------------------------- 3. HORIZON SILHOUETTES
    this.skylineMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float aSeed;
        varying vec3 vWorldPos;
        varying float vSeed;
        void main() {
          vSeed = aSeed;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;

        float hash21(vec2 p) {
          p = fract(p * vec2(443.897, 441.423));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        void main() {
          // Distant towers are pure silhouette + scattered window light, drowned in aerial haze.
          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float h = clamp(vWorldPos.y / 170.0, 0.0, 1.0);
          float fogAmount = clamp(0.42 + h * 0.15, 0.0, 0.92);

          vec3 silhouette = vec3(0.012, 0.045, 0.115);
          vec3 haze = mix(vec3(0.05, 0.16, 0.36), vec3(0.10, 0.30, 0.60), h);
          float sunScatter = pow(max(dot(viewDir, normalize(vec3(0.0, 0.30, -0.95))), 0.0), 3.0);
          haze += vec3(0.22, 0.48, 0.95) * sunScatter * 0.55;
          vec3 col = mix(silhouette, haze, fogAmount);

          // Sparse window lights give the horizon scale without needing real geometry.
          vec2 winGrid = vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y) * vec2(0.30, 0.26);
          vec2 cid = floor(winGrid);
          vec2 f = fract(winGrid);
          float pane = step(0.3, f.x) * step(f.x, 0.7) * step(0.3, f.y) * step(f.y, 0.7);
          float lit = step(0.55, hash21(cid + floor(vSeed * 90.0)));
          col += mix(vec3(0.30, 0.62, 1.0), vec3(1.0, 0.24, 0.30), uAnomaly * 0.6) * pane * lit * (1.0 - fogAmount) * 0.55;
          col += vec3(1.0, 0.10, 0.16) * smoothstep(0.995, 1.0, fract(vWorldPos.y * 0.013 + vSeed)) * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const SKYLINE_COUNT = 132;
    const skylineGeo = new THREE.BoxGeometry(1, 1, 1);
    const skyline = new THREE.InstancedMesh(skylineGeo, this.skylineMat, SKYLINE_COUNT);
    skyline.frustumCulled = false;
    const skylineSeeds = new Float32Array(SKYLINE_COUNT);
    const sDummy = new THREE.Object3D();
    for (let i = 0; i < SKYLINE_COUNT; i++) {
      const ang = (i / SKYLINE_COUNT) * Math.PI * 2 + Math.sin(i * 5.3) * 0.05;
      const r = 176 + (i % 4) * 34 + ((i * 17) % 26);
      const h = 46 + ((i * 31) % 110) + (i % 5) * 16;
      const w = 7 + (i % 6) * 3.6;
      sDummy.position.set(Math.cos(ang) * r, h * 0.5 - 8, -18 + Math.sin(ang) * r);
      sDummy.rotation.set(0, -ang, 0);
      sDummy.scale.set(w, h, w * (0.65 + (i % 3) * 0.22));
      sDummy.updateMatrix();
      skyline.setMatrixAt(i, sDummy.matrix);
      skylineSeeds[i] = ((i * 47) % 100) / 100;
    }
    skylineGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(skylineSeeds, 1));
    skyline.instanceMatrix.needsUpdate = true;
    this.group.add(skyline);

    // ---------------------------------------------------------------- 4. 100% GPU SKY TRAFFIC (0.0ms CPU!)
    this.trafficMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aLaneA; // baseX, y, z, speedWithDir
        attribute vec2 aLaneB; // len, phase
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          float dir = sign(aLaneA.w);
          float travel = mod(aLaneA.x + aLaneA.w * uTime + 300.0, 260.0) - 130.0;
          float bob = sin(uTime * 0.7 + aLaneB.y) * 1.6;

          // Local Z scaled by len, rotated around Y by +-90 deg so cylinder streams along +-X!
          vec3 lp = vec3(position.x, position.y, position.z * aLaneB.x);
          vec3 rotP = dir > 0.0 ? vec3(lp.z, lp.y, -lp.x) : vec3(-lp.z, lp.y, lp.x);
          vec3 wp = vec3(travel, aLaneA.y + bob, aLaneA.z) + rotP;
          vWorldPos = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAnomaly;
        void main() {
          float head = smoothstep(0.75, 1.0, vUv.y);
          float tail = pow(1.0 - vUv.y, 1.6);
          vec3 col = mix(vec3(0.32, 0.78, 1.0), vec3(1.0, 0.28, 0.34), uAnomaly * 0.8);
          float dist = length(cameraPosition - vWorldPos);
          float fade = smoothstep(280.0, 40.0, dist) * smoothstep(0.0, 12.0, dist);
          gl_FragColor = vec4(col * (0.5 + head * 0.9), (tail * 0.75 + head * 0.55) * fade);
        }
      `,
    });

    const TRAFFIC_COUNT = 110;
    const trafficGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 4, 1, true);
    trafficGeo.translate(0, 0.5, 0);
    trafficGeo.rotateX(Math.PI * 0.5);
    const laneA = new Float32Array(TRAFFIC_COUNT * 4);
    const laneB = new Float32Array(TRAFFIC_COUNT * 2);
    this.trafficMesh = new THREE.InstancedMesh(trafficGeo, this.trafficMat, TRAFFIC_COUNT);
    this.trafficMesh.frustumCulled = false;
    this.trafficMesh.renderOrder = 4;
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const lane = i % 3;
      const dir = lane === 1 ? -1 : 1;
      laneA[i * 4 + 0] = (Math.random() - 0.5) * 240;
      laneA[i * 4 + 1] = 26 + lane * 22 + Math.random() * 16;
      laneA[i * 4 + 2] = -96 + Math.random() * 150;
      laneA[i * 4 + 3] = dir * (9 + Math.random() * 26);
      laneB[i * 2 + 0] = 6 + Math.random() * 20;
      laneB[i * 2 + 1] = i;
    }
    trafficGeo.setAttribute('aLaneA', new THREE.InstancedBufferAttribute(laneA, 4));
    trafficGeo.setAttribute('aLaneB', new THREE.InstancedBufferAttribute(laneB, 2));
    this.group.add(this.trafficMesh);

    // ---------------------------------------------------------------- 5. SKY-EYE LIGHT SHAFTS
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sx = length(instanceMatrix[0].xyz);
          float sy = length(instanceMatrix[1].xyz);
          vec3 toCam = normalize(cameraPosition - center);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 wp = center + right * (position.x * sx) + vec3(0.0, position.y * sy, 0.0);
          vWorldPos = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAnomaly;
        void main() {
          float across = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
          float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float shimmer = 0.7 + 0.3 * sin(vUv.y * 12.0 - uTime * 1.6 + vUv.x * 6.0);
          vec3 col = mix(vec3(0.30, 0.66, 1.0), vec3(1.0, 0.30, 0.36), uAnomaly * 0.75);
          float dist = length(cameraPosition - vWorldPos);
          float fade = smoothstep(400.0, 80.0, dist);
          gl_FragColor = vec4(col, across * along * shimmer * 0.11 * fade);
        }
      `,
    });

    const SHAFT_COUNT = 22;
    const shaftGeo = new THREE.PlaneGeometry(1, 1);
    const shafts = new THREE.InstancedMesh(shaftGeo, this.shaftMat, SHAFT_COUNT);
    shafts.frustumCulled = false;
    shafts.renderOrder = 3;
    const shDummy = new THREE.Object3D();
    for (let i = 0; i < SHAFT_COUNT; i++) {
      const ang = -Math.PI * 0.5 + (i / SHAFT_COUNT) * Math.PI * 1.5;
      const r = 46 + (i % 4) * 26;
      const h = 150 + (i % 3) * 60;
      shDummy.position.set(Math.cos(ang) * r, h * 0.5 + 6, -18 + Math.sin(ang) * r * 1.15);
      shDummy.scale.set(10 + (i % 5) * 8, h, 1);
      shDummy.updateMatrix();
      shafts.setMatrixAt(i, shDummy.matrix);
    }
    shafts.instanceMatrix.needsUpdate = true;
    this.group.add(shafts);
  }

  /**
   * Hand-placed detail pass: the elements that give the basin human scale and readable wayfinding.
   *  - 26 causeway lanterns: emissive post + head pair flanking the walkway (2 draw calls).
   *  - 12 engraved monoliths orbiting the sanctuary, slowly turning under the beam.
   *  - A ring of leaning grave-marker slabs in the sunken chasms for depth cues up close.
   */
  private buildCausewayDetailAndMonoliths(): void {
    // ---------------------------------------------------------------- CAUSEWAY LANTERNS
    const lanternMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 }, uFlicker: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying float vSeed;
        attribute float aSeed;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        uniform float uFlicker;
        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        void main() {
          // uFlicker = 1 for the emissive head instances, 0 for the post instances.
          float flick = 0.82 + 0.18 * sin(uTime * (2.0 + vSeed * 5.0) + vSeed * 40.0);
          if (uFlicker > 0.5) {
            vec3 core = mix(vec3(0.72, 0.94, 1.0), vec3(1.0, 0.34, 0.38), uAnomaly * 0.8);
            float glow = smoothstep(0.5, 0.05, length(vUv - 0.5));
            gl_FragColor = vec4(core * (1.4 + glow), 1.0);
          } else {
            vec3 metal = vec3(0.020, 0.045, 0.095);
            vec3 viewDir = normalize(vWorldPos - cameraPosition);
            float rim = pow(1.0 - abs(dot(normalize(vec3(vUv.x - 0.5, 0.0, 1.0)), viewDir)), 2.0);
            float band = smoothstep(0.02, 0.0, abs(vUv.y - 0.42)) + smoothstep(0.02, 0.0, abs(vUv.y - 0.78));
            vec3 col = metal + vec3(0.16, 0.44, 0.86) * (rim * 0.35 + band * 0.45) * flick;
            float camDist = length(cameraPosition - vWorldPos);
            col = mix(col, vec3(0.03, 0.20, 0.46), clamp(1.0 - exp(-0.00005 * camDist * camDist), 0.0, 0.85));
            gl_FragColor = vec4(col, 1.0);
          }
        }
      `,
    });

    const LAMP_COUNT = 26;
    const postGeo = new THREE.BoxGeometry(0.18, 4.4, 0.18);
    postGeo.translate(0, 2.2, 0);
    const headGeo = new THREE.BoxGeometry(0.42, 0.30, 0.42);

    const postMat = lanternMat.clone();
    postMat.uniforms.uTime = lanternMat.uniforms.uTime;
    postMat.uniforms.uAnomaly = lanternMat.uniforms.uAnomaly;
    postMat.uniforms.uFlicker = { value: 0 };
    const headMat = lanternMat.clone();
    headMat.uniforms.uTime = lanternMat.uniforms.uTime;
    headMat.uniforms.uAnomaly = lanternMat.uniforms.uAnomaly;
    headMat.uniforms.uFlicker = { value: 1 };

    const posts = new THREE.InstancedMesh(postGeo, postMat, LAMP_COUNT);
    const heads = new THREE.InstancedMesh(headGeo, headMat, LAMP_COUNT);
    posts.frustumCulled = false;
    heads.frustumCulled = false;
    const lDummy = new THREE.Object3D();
    for (let i = 0; i < LAMP_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const t = Math.floor(i / 2) / (LAMP_COUNT / 2 - 1);
      const z = 22 - t * 78;
      const x = side * 3.05;
      const y = this.getTerrainHeight(x, z);
      lDummy.position.set(x, y, z);
      lDummy.rotation.set(0, side * 0.06, 0);
      lDummy.scale.set(1, 1, 1);
      lDummy.updateMatrix();
      posts.setMatrixAt(i, lDummy.matrix);
      lDummy.position.set(x, y + 4.42, z);
      lDummy.updateMatrix();
      heads.setMatrixAt(i, lDummy.matrix);
    }
    const lampSeeds = new Float32Array(LAMP_COUNT);
    for (let i = 0; i < LAMP_COUNT; i++) lampSeeds[i] = (i % 7) / 7;
    postGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(lampSeeds, 1));
    headGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(lampSeeds, 1));
    posts.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.group.add(posts);
    this.group.add(heads);
    this.lanternMat = lanternMat;

    // ---------------------------------------------------------------- SANCTUARY MONOLITHS
    const monolithMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vUv = uv;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorldPos = wp.xyz;
          vec3 nrmW = normal;
          #ifdef USE_INSTANCING
            nrmW = mat3(instanceMatrix) * nrmW;
          #endif
          vNormalW = normalize(mat3(modelMatrix) * nrmW);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying vec3 vNormalW;
        uniform float uTime;
        uniform float uAnomaly;
        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        void main() {
          vec3 nrm = normalize(vNormalW);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float ndl = clamp(dot(nrm, normalize(vec3(0.1, 0.55, -0.82))), 0.0, 1.0);
          float rim = pow(1.0 - abs(dot(nrm, viewDir)), 1.8);

          vec3 col = vec3(0.006, 0.020, 0.062) * (0.5 + 0.7 * ndl);
          col += vec3(0.10, 0.34, 0.72) * rim * 0.42;

          // Engraved horizontal command bands with crawling glyph ticks.
          float band = smoothstep(0.018, 0.0, abs(fract(vUv.y * 14.0) - 0.5)) * step(0.15, vUv.y) * step(vUv.y, 0.95);
          float ticks = step(0.6, hash21(vec2(floor(vUv.x * 26.0), floor(vUv.y * 14.0) + floor(uTime * 2.0))));
          col += mix(vec3(0.55, 0.88, 1.0), vec3(1.0, 0.26, 0.32), uAnomaly * 0.8) * band * (0.28 + ticks * 0.5);

          // Vertical seam running down the edge of every slab.
          col += vec3(0.42, 0.80, 1.0) * smoothstep(0.03, 0.0, min(vUv.x, 1.0 - vUv.x)) * 0.22;

          // ---- VIEW-DEPENDENT DATA-CRYSTAL SHEEN ----
          // The slab faces are coated in a thin holographic film. Its interference colour is a
          // function of the FRESNEL term (i.e. of the angle between the face and the eye), so
          // each slab changes hue as the player walks around it, and the seam highlight slides
          // along the edge as the viewing angle shifts.
          float fres = pow(1.0 - clamp(dot(nrm, viewDir), 0.0, 1.0), 2.2);
          float phase = fres * 9.2 + vUv.y * 3.1 + uTime * 0.22;
          vec3 irid = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + phase);
          col += irid * fres * (0.075 + 0.10 * uAnomaly);
          // Anisotropic vertical streak: the film is stretched along the slab, so the sheen
          // smears into a vertical band that slides with the view.
          vec3 axis = normalize(vec3(0.0, 1.0, 0.0) - nrm * nrm.y);
          vec3 hDir = normalize(normalize(vec3(0.1, 0.55, -0.82)) + viewDir);
          float streak = pow(max(1.0 - dot(hDir, axis) * dot(hDir, axis), 0.0), 18.0);
          col += mix(vec3(0.20, 0.55, 1.0), vec3(0.95, 0.35, 0.90), uAnomaly * 0.7) * streak * 0.22;

          float camDist = length(cameraPosition - vWorldPos);
          col = mix(col, vec3(0.02, 0.12, 0.30), clamp(1.0 - exp(-0.00006 * camDist * camDist), 0.0, 0.9));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const MONO_COUNT = 12;
    const monolithGeo = new THREE.BoxGeometry(2.2, 17.5, 1.7);
    const monoliths = new THREE.InstancedMesh(monolithGeo, monolithMat, MONO_COUNT);
    monoliths.frustumCulled = false;
    const moDummy = new THREE.Object3D();
    for (let i = 0; i < MONO_COUNT; i++) {
      const ang = (i / MONO_COUNT) * Math.PI * 2;
      const r = 15.5 + (i % 3) * 2.4;
      moDummy.position.set(
        this.corePosition.x + Math.cos(ang) * r,
        this.corePosition.y + 8.4 - (i % 2) * 0.7,
        this.corePosition.z + Math.sin(ang) * r
      );
      moDummy.rotation.set(0.03 * Math.sin(i), -ang + Math.PI * 0.5, 0.05 * Math.cos(i * 1.7));
      moDummy.scale.set(1, 0.85 + (i % 4) * 0.12, 1);
      moDummy.updateMatrix();
      monoliths.setMatrixAt(i, moDummy.matrix);
    }
    monoliths.instanceMatrix.needsUpdate = true;
    this.group.add(monoliths);
    this.monolithMat = monolithMat;

    // ---------------------------------------------------------------- ARCHITECTURAL CAUSEWAY PARAPETS & CENTRAL MEMORY BUS
    const curbCount = 52;
    const curbGeo = new THREE.BoxGeometry(0.42, 0.44, 2.75);
    const curbInst = new THREE.InstancedMesh(curbGeo, monolithMat, curbCount);
    curbInst.frustumCulled = false;
    let cIdx = 0;
    for (let i = 0; i < 26; i++) {
      const z = 18.5 - i * 2.55;
      for (const side of [-1, 1]) {
        const x = side * 3.38;
        const y = this.getTerrainHeight(x, z);
        const yNext = this.getTerrainHeight(x, z - 1.5);
        const pitch = Math.atan2(yNext - y, 1.5);
        moDummy.position.set(x, y + 0.16, z);
        moDummy.rotation.set(pitch, 0, 0);
        moDummy.scale.set(1, 1, 1);
        moDummy.updateMatrix();
        curbInst.setMatrixAt(cIdx++, moDummy.matrix);
      }
    }
    curbInst.instanceMatrix.needsUpdate = true;
    this.group.add(curbInst);

    // Arrival Overlook Octagonal Plaza Ring & Medallion at (0, spawnY, 20)
    const overlookDais = new THREE.Mesh(
      new THREE.CylinderGeometry(5.6, 6.2, 0.22, 8),
      new THREE.MeshLambertMaterial({
        color: 0x051430,
        emissive: 0x06285a,
        emissiveIntensity: 0.55,
      })
    );
    overlookDais.position.set(0, this.getTerrainHeight(0, 20) - 0.04, 20);
    this.group.add(overlookDais);

    const overlookRing = new THREE.Mesh(
      new THREE.RingGeometry(4.4, 4.65, 32),
      new THREE.MeshBasicMaterial({ color: 0x8ad8ff, side: THREE.DoubleSide })
    );
    overlookRing.rotation.x = -Math.PI * 0.5;
    overlookRing.position.set(0, this.getTerrainHeight(0, 20) + 0.085, 20);
    this.group.add(overlookRing);

    // Central Glowing 64-Bit Kernel Memory Bus Conduit conforming smoothly along the Causeway spine!
    const busGeo = new THREE.PlaneGeometry(1.15, 68, 1, 48);
    busGeo.rotateX(-Math.PI * 0.5);
    busGeo.translate(0, 0, -14.5);
    const busPos = busGeo.attributes.position;
    for (let i = 0; i < busPos.count; i++) {
      const bx = busPos.getX(i);
      const bz = busPos.getZ(i);
      busPos.setY(i, this.getTerrainHeight(bx, bz) + 0.055);
    }
    this.causewayBusMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAnomaly;
        void main() {
          float lane = smoothstep(0.06, 0.0, abs(fract(vUv.x * 8.0) - 0.5));
          float border = smoothstep(0.08, 0.0, min(vUv.x, 1.0 - vUv.x));
          float packet = pow(0.5 + 0.5 * sin(vWorldPos.z * 0.42 + uTime * 7.5), 8.0);
          float endFade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
          vec3 col = mix(vec3(0.28, 0.78, 1.0), vec3(1.0, 0.24, 0.34), uAnomaly * 0.8);
          float alpha = (lane * 0.28 + border * 0.65 + lane * packet * 0.85) * endFade;
          gl_FragColor = vec4(col, alpha * 0.72);
        }
      `,
    });
    const busMesh = new THREE.Mesh(busGeo, this.causewayBusMat);
    busMesh.renderOrder = 2;
    this.group.add(busMesh);
  }

  private buildCollapseAndAbyss(concreteDiff: THREE.Texture, concreteDisp: THREE.Texture): void {
    this.collapseGroup.visible = false;
    this.group.add(this.collapseGroup);

    // =========================================================================
    // 1. TRUE 2D HALF-PLANE VORONOI 3D JIGSAW FRACTURE SYSTEM (84 Prisms, 1 Draw Call!)
    //    - Ground cracks open along real polygonal Voronoi seams right under your shoes
    //    - Every shard shatters 100% faithfully along those exact cracks!
    //    - Zero painted fake cracks left floating or stuck on the ground after collapse!
    // =========================================================================
    const INNER_CELLS = 64;
    const RIM_CELLS = 20;
    interface VoronoiSite {
      x: number;
      z: number;
      r: number;
      isRim: boolean;
      rand: number;
    }
    const sites: VoronoiSite[] = [];
    let rng = 1337;
    const nextRand = (): number => {
      rng = (rng * 16807) % 2147483647;
      return (rng - 1) / 2147483646;
    };

    // 64 inner jigsaw cells (dense right under player's feet r=0..3m, expanding out to r=9.1m)
    for (let i = 0; i < INNER_CELLS; i++) {
      const u = i / INNER_CELLS;
      const r = i === 0 ? 0.16 : 0.38 + Math.pow(u, 0.72) * 8.65;
      const ang = i * 2.39996323 + (nextRand() - 0.5) * 0.22;
      sites.push({
        x: Math.cos(ang) * r,
        z: Math.sin(ang) * r,
        r,
        isRim: false,
        rand: nextRand(),
      });
    }
    // 20 outer jagged cliff-rim cells (r=10.3..11.2m) that stay anchored as 3D polygonal cliff ledges!
    for (let i = 0; i < RIM_CELLS; i++) {
      const ang = (i / RIM_CELLS) * Math.PI * 2 + (nextRand() - 0.5) * 0.08;
      const r = 10.65 + (nextRand() - 0.5) * 0.65;
      sites.push({
        x: Math.cos(ang) * r,
        z: Math.sin(ang) * r,
        r,
        isRim: true,
        rand: nextRand(),
      });
    }

    type Pt2 = { x: number; z: number };
    const clipHalfPlane = (poly: Pt2[], nx: number, nz: number, c: number): Pt2[] => {
      const out: Pt2[] = [];
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const da = nx * a.x + nz * a.z - c;
        const db = nx * b.x + nz * b.z - c;
        if (da <= 0) out.push(a);
        if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
          const t = da / (da - db);
          out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        }
      }
      return out;
    };

    // Outer 32-gon disk of radius 12.36m (cleanly overlaps terrainMat's 12.18m discard circle!)
    const baseDisk: Pt2[] = [];
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      baseDisk.push({ x: Math.cos(a) * 12.36, z: Math.sin(a) * 12.36 });
    }

    const posArr: number[] = [];
    const normArr: number[] = [];
    const centerArr: number[] = [];
    const timingArr: number[] = [];
    const rotAxisArr: number[] = [];
    const faceEdgeArr: number[] = []; // x = faceType (0=top, 1=side/bottom), y = edgeFactor (0=centroid..1=seam), z = cellHash

    const pushVert = (
      px: number,
      py: number,
      pz: number,
      nx: number,
      ny: number,
      nz: number,
      cx: number,
      cz: number,
      crackT: number,
      dropT: number,
      isRim: number,
      rx: number,
      ry: number,
      rz: number,
      rSpd: number,
      faceType: number,
      edgeF: number,
      cHash: number
    ) => {
      posArr.push(px, py, pz);
      normArr.push(nx, ny, nz);
      centerArr.push(cx, cz);
      timingArr.push(crackT, dropT, isRim);
      rotAxisArr.push(rx, ry, rz, rSpd);
      faceEdgeArr.push(faceType, edgeF, cHash);
    };

    const SLAB_THICKNESS = 0.62;

    for (let i = 0; i < sites.length; i++) {
      let poly = baseDisk.slice();
      const si = sites[i];
      for (let j = 0; j < sites.length; j++) {
        if (i === j) continue;
        const sj = sites[j];
        const dx = sj.x - si.x;
        const dz = sj.z - si.z;
        const midX = (si.x + sj.x) * 0.5;
        const midZ = (si.z + sj.z) * 0.5;
        poly = clipHalfPlane(poly, dx, dz, dx * midX + dz * midZ);
        if (poly.length < 3) break;
      }
      if (poly.length < 3) continue;

      // Exact polygon centroid
      let cx = 0;
      let cz = 0;
      for (const p of poly) {
        cx += p.x;
        cz += p.z;
      }
      cx /= poly.length;
      cz /= poly.length;

      const cellR = Math.hypot(cx, cz);
      // Cracks ignite right under shoes at t = 1.05s and propagate outward across Voronoi seams!
      const crackTime = 1.05 + cellR * 0.21 + si.rand * 0.08;
      // Inner Voronoi polygons break loose right along those cracks starting at t = 3.75s!
      const dropTime = 3.75 + Math.pow(Math.min(cellR / 9.4, 1.0), 0.8) * 1.55 + si.rand * 0.22;
      const isRim = si.isRim ? 1.0 : 0.0;

      // Random normalized 3D rotation axis for tumbling freefall
      const ax = new THREE.Vector3(
        nextRand() - 0.5,
        (nextRand() - 0.5) * 0.5,
        nextRand() - 0.5
      ).normalize();
      const rotSpeed = 1.45 + nextRand() * 2.35;

      // Top face: triangle fan FROM CENTROID (cx, 0, cz) so edgeFactor interpolates 0.0 -> 1.0 EXACTLY onto every Voronoi seam!
      for (let k = 0; k < poly.length; k++) {
        const p0 = poly[k];
        const p1 = poly[(k + 1) % poly.length];
        // For outer rim cells' outermost perimeter (>12.0m), suppress edge glow so outer blend to terrainMat is 100% invisible!
        const e0 = si.isRim && Math.hypot(p0.x, p0.z) > 11.9 ? 0.0 : 1.0;
        const e1 = si.isRim && Math.hypot(p1.x, p1.z) > 11.9 ? 0.0 : 1.0;

        pushVert(cx, 0, cz, 0, 1, 0, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 0, 0.0, si.rand);
        pushVert(p0.x, 0, p0.z, 0, 1, 0, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 0, e0, si.rand);
        pushVert(p1.x, 0, p1.z, 0, 1, 0, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 0, e1, si.rand);
      }

      // Bottom face
      for (let k = 1; k < poly.length - 1; k++) {
        const p0 = poly[0];
        const p1 = poly[k + 1];
        const p2 = poly[k];
        pushVert(p0.x, -SLAB_THICKNESS, p0.z, 0, -1, 0, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 0.5, si.rand);
        pushVert(p1.x, -SLAB_THICKNESS, p1.z, 0, -1, 0, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 0.5, si.rand);
        pushVert(p2.x, -SLAB_THICKNESS, p2.z, 0, -1, 0, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 0.5, si.rand);
      }

      // Extruded 3D polygonal cliff side walls along every Voronoi crack boundary!
      for (let k = 0; k < poly.length; k++) {
        const p0 = poly[k];
        const p1 = poly[(k + 1) % poly.length];
        const ex = p1.x - p0.x;
        const ez = p1.z - p0.z;
        const len = Math.hypot(ex, ez) || 1;
        // Outward 2D normal for CCW polygon
        let snx = ez / len;
        let snz = -ex / len;
        if (snx * ((p0.x + p1.x) * 0.5 - cx) + snz * ((p0.z + p1.z) * 0.5 - cz) < 0) {
          snx = -snx;
          snz = -snz;
        }
        pushVert(p0.x, 0, p0.z, snx, 0, snz, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 1.0, si.rand);
        pushVert(p0.x, -SLAB_THICKNESS, p0.z, snx, 0, snz, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 0.3, si.rand);
        pushVert(p1.x, -SLAB_THICKNESS, p1.z, snx, 0, snz, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 0.3, si.rand);

        pushVert(p0.x, 0, p0.z, snx, 0, snz, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 1.0, si.rand);
        pushVert(p1.x, -SLAB_THICKNESS, p1.z, snx, 0, snz, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 0.3, si.rand);
        pushVert(p1.x, 0, p1.z, snx, 0, snz, cx, cz, crackTime, dropTime, isRim, ax.x, ax.y, ax.z, rotSpeed, 1, 1.0, si.rand);
      }
    }

    const voronoiGeo = new THREE.BufferGeometry();
    voronoiGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    voronoiGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    voronoiGeo.setAttribute('aCellCenter', new THREE.Float32BufferAttribute(centerArr, 2));
    voronoiGeo.setAttribute('aCellTiming', new THREE.Float32BufferAttribute(timingArr, 3));
    voronoiGeo.setAttribute('aRotAxis', new THREE.Float32BufferAttribute(rotAxisArr, 4));
    voronoiGeo.setAttribute('aFaceEdge', new THREE.Float32BufferAttribute(faceEdgeArr, 3));

    this.voronoiMat = new THREE.ShaderMaterial({
      uniforms: {
        uConcreteMap: { value: concreteDiff },
        uDispMap: { value: concreteDisp },
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uCollapseTime: { value: 0 },
        uCollapseCenter: { value: this.collapseCenter },
        uFogColor: { value: new THREE.Color(0x011330) },
        uFogDensity: { value: 0.0056 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aCellCenter;
        attribute vec3 aCellTiming; // x=crackTime, y=dropTime, z=isRim
        attribute vec4 aRotAxis;    // xyz=axis, w=rotSpeed
        attribute vec3 aFaceEdge;   // x=faceType, y=edgeFactor, z=cellHash

        uniform float uTime;
        uniform float uCollapseTime;
        uniform vec3 uCollapseCenter;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vSampleXZ;
        varying float vFaceType;
        varying float vEdgeFactor;
        varying float vCrackGlow;

        // Exact analytical GlitchWorld terrain height so seam with terrainMat is 0.000mm!
        float evalTerrainHeight(vec2 xz) {
          float dSpawn = length(vec2(xz.x * 0.8, xz.y - 20.0));
          float spawnIsland = 2.6 * exp(-(dSpawn * dSpawn) / 135.0);

          float dCore = length(vec2(xz.x, xz.y + 56.0));
          float coreMound = 5.2 * exp(-(dCore * dCore) / 340.0);
          float smoothCore = coreMound + 0.18 * sin(coreMound * 3.14159265 * 2.5);

          float inSpan = step(-64.0, xz.y) * step(xz.y, 26.0);
          float bridgeMask = exp(-(xz.x * xz.x) / 46.0) * inSpan;
          float bridgeDeck = 2.15 * bridgeMask;

          float absX = abs(xz.x);
          float trenchBand = exp(-((absX - 20.0) * (absX - 20.0)) / 72.0) * inSpan;
          float trenchDip = -2.35 * trenchBand * (1.0 - exp(-(dCore * dCore) / 260.0));

          float spurEx = smoothstep(0.0, 6.0, xz.x) * (1.0 - smoothstep(18.5, 25.5, xz.x));
          float spurEz = exp(-((xz.y + 8.0) * (xz.y + 8.0)) / 24.0);
          float dEast = length(vec2(xz.x - 18.5, xz.y + 8.0));
          float eastWing = max(3.6 * spurEx * spurEz, 3.85 * exp(-(dEast * dEast) / 38.0));

          float spurWx = smoothstep(0.0, 6.0, -xz.x) * (1.0 - smoothstep(18.5, 25.5, -xz.x));
          float spurWz = exp(-((xz.y + 28.0) * (xz.y + 28.0)) / 24.0);
          float dWest = length(vec2(xz.x + 18.5, xz.y + 28.0));
          float westWing = max(3.6 * spurWx * spurWz, 3.85 * exp(-(dWest * dWest) / 38.0));

          float waves = (sin(xz.x * 0.095) * cos(xz.y * 0.085) * 1.45 +
                         sin(xz.x * 0.22 + xz.y * 0.17) * 0.42) * (1.0 - bridgeMask * 0.85);

          float rCenter = length(vec2(xz.x, xz.y + 18.0));
          float rim = max(0.0, rCenter - 62.0) * 0.26;
          return spawnIsland + smoothCore + bridgeDeck + trenchDip + eastWing + westWing + waves + rim;
        }

        // Analytical terrain normal so top-face lighting matches terrainMat seamlessly!
        vec3 evalTerrainNormal(vec2 xz) {
          float eps = 0.25;
          float hL = evalTerrainHeight(xz - vec2(eps, 0.0));
          float hR = evalTerrainHeight(xz + vec2(eps, 0.0));
          float hD = evalTerrainHeight(xz - vec2(0.0, eps));
          float hU = evalTerrainHeight(xz + vec2(0.0, eps));
          return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
        }

        vec3 rotateAxisAngle(vec3 v, vec3 axis, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
        }

        void main() {
          float crackTime = aCellTiming.x;
          float dropTime = aCellTiming.y;
          float isRim = aCellTiming.z;
          float cellHash = aFaceEdge.z;

          float crackT = smoothstep(0.0, 0.34, uCollapseTime - crackTime);
          float ft = max(0.0, uCollapseTime - dropTime);

          // Sample texture & grid in original unshifted world XZ so patterns stick to each jigsaw slab!
          vec2 origWorldXZ = uCollapseCenter.xz + position.xz;
          vSampleXZ = origWorldXZ;
          float origSurfY = evalTerrainHeight(origWorldXZ);

          // Physical seam opening: each inner polygon contracts slightly toward its centroid to split real 3D Voronoi fissures!
          vec2 localXZ = position.xz;
          if (isRim < 0.5) {
            localXZ = mix(position.xz, aCellCenter, 0.055 * crackT);
          } else {
            // Outer cliff-rim polygons stay welded to terrainMat on their outer perimeter!
            float outerPin = smoothstep(11.9, 10.2, length(position.xz));
            localXZ = mix(position.xz, aCellCenter, 0.025 * crackT * outerPin);
          }

          vec3 nrm = aFaceEdge.x < 0.5 ? evalTerrainNormal(origWorldXZ) : normal;
          vec3 wp = vec3(uCollapseCenter.x + localXZ.x, origSurfY + position.y, uCollapseCenter.z + localXZ.y);

          if (isRim < 0.5) {
            // Pre-collapse tectonic fault stepping & high-frequency shudder right under your shoes!
            float preDrop = 1.0 - step(0.001, ft);
            wp.y -= 0.048 * crackT * (0.35 + 0.65 * cellHash) * preDrop;
            wp.y += sin(uTime * 48.0 + cellHash * 37.0) * 0.022 * crackT * preDrop;

            // True 3D jigsaw tumble & gravity freefall once dropTime hits!
            if (ft > 0.0) {
              vec2 centerWXZ = uCollapseCenter.xz + aCellCenter;
              vec3 pivotW = vec3(centerWXZ.x, evalTerrainHeight(centerWXZ) - 0.28, centerWXZ.y);
              float ang = ft * aRotAxis.w;
              vec3 rel = wp - pivotW;
              rel = rotateAxisAngle(rel, aRotAxis.xyz, ang);
              nrm = rotateAxisAngle(nrm, aRotAxis.xyz, ang);

              // Gravity acceleration + subtle radial separation so central shaft opens cleanly for the falling player
              vec2 radDir = length(aCellCenter) > 0.05 ? normalize(aCellCenter) : vec2(1.0, 0.0);
              float fallY = -2.5 * ft - 11.5 * ft * ft;
              wp = pivotW + rel + vec3(radDir.x * ft * 0.35, fallY, radDir.y * ft * 0.35);
            }
            // Seam glow blazes as cracks split open, then cools cleanly as slabs plummet into the dark shaft!
            vCrackGlow = crackT * exp(-ft * 1.15);
          } else {
            // Outer cliff-rim glow cools completely once the chasm finishes opening — ZERO leftover crack lines!
            vCrackGlow = crackT * smoothstep(5.8, 4.1, uCollapseTime);
          }

          vWorldPos = wp;
          vNormal = normalize(nrm);
          vFaceType = aFaceEdge.x;
          vEdgeFactor = aFaceEdge.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vSampleXZ;
        varying float vFaceType;
        varying float vEdgeFactor;
        varying float vCrackGlow;

        uniform sampler2D uConcreteMap;
        uniform sampler2D uDispMap;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        void main() {
          vec3 conc = texture2D(uConcreteMap, vSampleXZ * 0.16).rgb;
          float disp = texture2D(uDispMap, vSampleXZ * 0.11).r;
          vec3 nrm = normalize(vNormal);
          vec3 lightDir = normalize(vec3(0.12, 0.62, -0.78));
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 halfDir = normalize(lightDir + viewDir);
          float ndl = clamp(dot(nrm, lightDir), 0.0, 1.0);
          float spec = pow(max(dot(nrm, halfDir), 0.0), 28.0) * (0.35 + 0.65 * conc.r);

          vec3 col;
          if (vFaceType < 0.5) {
            // Top surface — 100% identical chiaroscuro obsidian-stone shading to terrainMat!
            float spec2 = pow(max(dot(nrm, halfDir), 0.0), 36.0) * (0.35 + 0.65 * conc.r);
            vec3 darkObsidian = vec3(0.005, 0.018, 0.068);
            vec3 litStone = mix(vec3(0.0, 0.11, 0.44), vec3(0.55, 0.04, 0.12), uAnomaly * 0.55);
            vec3 baseBlue = mix(darkObsidian, litStone, conc.r * 0.72 + disp * 0.28);
            col = baseBlue * (0.40 + 0.78 * ndl) + vec3(0.55, 0.88, 1.0) * spec2 * 0.58;

            vec2 fwMajor = max(fwidth(vSampleXZ * 0.25), vec2(0.0001));
            vec2 gMajor = abs(fract(vSampleXZ * 0.25 - 0.5) - 0.5) / fwMajor;
            float lineMajor = 1.0 - min(min(gMajor.x, gMajor.y), 1.0);

            vec2 fwMinor = max(fwidth(vSampleXZ), vec2(0.0001));
            vec2 gMinor = abs(fract(vSampleXZ - 0.5) - 0.5) / fwMinor;
            float lineMinor = 1.0 - min(min(gMinor.x, gMinor.y), 1.0);

            float onPath = exp(-(vSampleXZ.x * vSampleXZ.x) / 11.0) * step(-58.0, vSampleXZ.y) * step(vSampleXZ.y, 24.0);
            float pathPulse = 0.5 + 0.5 * sin(vSampleXZ.y * 0.38 + uTime * 3.2);
            float railLine = smoothstep(0.12, 0.0, abs(abs(vSampleXZ.x) - 2.65)) * step(-55.0, vSampleXZ.y) * step(vSampleXZ.y, 22.0);
            float shoreGlow = smoothstep(0.32, 0.0, abs(vWorldPos.y - (-0.32)));

            vec3 accentGlow = mix(vec3(0.58, 0.88, 1.0), vec3(1.0, 0.28, 0.36), uAnomaly * 0.7);
            // Slow data pulses travel along the major seams, so the plaza feels alive rather than painted.
            float vein = sin(vWorldPos.z * 0.55 - uTime * 2.4) * 0.5 + 0.5;
            col += accentGlow * lineMajor * (0.38 + onPath * 0.42 * pathPulse + uAnomaly * 0.45) * (0.72 + vein * 0.55);
            // Darken along polygonal crevices & carve a PITCH-BLACK abyssal fracture fissure (NOT bright white wash!)
            float cav = clamp(vEdgeFactor, 0.0, 1.0);
            col *= mix(1.0, 0.52, pow(cav, 2.4) * vCrackGlow);
            col += vec3(0.25, 0.65, 1.0) * lineMinor * 0.12;
            col += accentGlow * railLine * (0.35 + 0.50 * pathPulse);
            col += vec3(0.45, 0.88, 1.0) * shoreGlow * 0.65;

            // Crisp dark-edged fracture bevel + pitch-black chasm gap right along the Voronoi crack!
            float seamBevel = smoothstep(0.88, 0.94, cav) * (1.0 - smoothstep(0.94, 0.97, cav)) * vCrackGlow;
            float seamChasm = smoothstep(0.945, 0.992, cav) * vCrackGlow;
            col += vec3(0.14, 0.28, 0.44) * seamBevel;
            col = mix(col, vec3(0.001, 0.003, 0.012), clamp(seamChasm * 0.98, 0.0, 0.98));
          } else {
            // Newly-split 3D concrete fracture cliff wall — dark sheared stone with subtle deep cobalt fissure rim!
            vec3 cliffCol = mix(vec3(0.003, 0.012, 0.045), vec3(0.012, 0.11, 0.34), conc.r) * (0.34 + 0.66 * ndl);
            vec3 fissureRim = vec3(0.12, 0.30, 0.52) * vCrackGlow * pow(vEdgeFactor, 2.0) * 0.55;
            col = cliffCol + fissureRim;
          }

          // --- Aerial perspective: trench mist pools on the basin floor, thinning with altitude,
          // with warm forward-scatter toward the eclipsed sky-eye. This is what sells the depth.
          float camDist = length(cameraPosition - vWorldPos);
          float heightMist = exp(-max(vWorldPos.y + 1.5, 0.0) * 0.022);
          float airDensity = uFogDensity * (0.72 + heightMist * 1.25);
          float fogFactor = 1.0 - exp(-airDensity * airDensity * camDist * camDist);
          vec3 viewW = normalize(vWorldPos - cameraPosition);
          float sunScatter = pow(max(dot(viewW, normalize(vec3(0.0, 0.26, -0.96))), 0.0), 5.0);
          vec3 aerialTint = mix(vec3(0.008, 0.078, 0.20), vec3(0.035, 0.21, 0.47), clamp((vWorldPos.y + 4.0) * 0.014, 0.0, 1.0));
          aerialTint += vec3(0.16, 0.42, 0.88) * sunScatter * 0.72;
          col = mix(col, aerialTint, clamp(fogFactor, 0.0, 0.96));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const voronoiMesh = new THREE.Mesh(voronoiGeo, this.voronoiMat);
    // voronoiMat outputs direct world-space coordinates in vertexShader, so keep it at origin inside group!
    voronoiMesh.frustumCulled = false;
    voronoiMesh.visible = false;
    voronoiMesh.name = 'VoronoiJigsawFloor';
    this.group.add(voronoiMesh);

    // 1b. 48 Upward Volumetric Fissure Light Blades shooting out of the splitting Voronoi seams before collapse!
    const rayGeo = new THREE.PlaneGeometry(1.0, 1.0);
    rayGeo.translate(0, 0.5, 0);
    const rayMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float hFade = sin(vUv.x * 3.14159265);
          float vFade = pow(1.0 - vUv.y, 1.85);
          gl_FragColor = vec4(0.68, 0.93, 1.0, hFade * vFade * 0.42);
        }
      `,
    });
    const CRACK_RAY_COUNT = 48;
    this.crackRays = new THREE.InstancedMesh(rayGeo, rayMat, CRACK_RAY_COUNT);
    this.crackRays.frustumCulled = false;
    for (let i = 0; i < CRACK_RAY_COUNT; i++) {
      const sA = sites[i % INNER_CELLS];
      const sB = sites[(i * 3 + 1) % INNER_CELLS];
      const mx = (sA.x + sB.x) * 0.5;
      const mz = (sA.z + sB.z) * 0.5;
      const rMid = Math.hypot(mx, mz);
      this.crackRayStates.push({
        x: mx,
        z: mz,
        rotY: Math.atan2(sB.x - sA.x, sB.z - sA.z),
        igniteT: 1.08 + rMid * 0.21,
        fadeT: 3.75 + Math.pow(Math.min(rMid / 9.4, 1.0), 0.8) * 1.35,
        height: 1.6 + (i % 5) * 0.55,
        width: 0.45 + (i % 4) * 0.25,
      });
    }
    this.collapseGroup.add(this.crackRays);

    // =========================================================================
    // 2. 245m DEEP ABYSSAL CHASM WALL CYLINDER (Memory-Dump Shaft rushing past!)
    // =========================================================================
    const wallGeo = new THREE.CylinderGeometry(10.35, 9.2, 245, 32, 1, true);
    wallGeo.translate(0, -122.8, 0);
    this.abyssWallMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vLocalY;
        void main() {
          vUv = uv;
          vLocalY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vLocalY;
        uniform float uTime;
        void main() {
          float depthFade = smoothstep(0.0, -9.0, vLocalY) * smoothstep(-245.0, -210.0, vLocalY);
          float vStripes = pow(max(0.0, sin(vUv.x * 62.8318 * 2.0)), 14.0);
          float hRings = smoothstep(0.94, 1.0, fract(-vLocalY * 0.14 - uTime * 1.5));
          vec3 voidCol = vec3(0.002, 0.018, 0.085);
          vec3 lineCol = vec3(0.28, 0.76, 1.0) * (vStripes * 0.48 + hRings * 0.55);
          gl_FragColor = vec4(voidCol + lineCol, depthFade * 0.96);
        }
      `,
    });
    this.collapseGroup.add(new THREE.Mesh(wallGeo, this.abyssWallMat));

    // =========================================================================
    // 3. 160 HIGH-VELOCITY ABYSSAL FREEFALL SPEED-LINES (1 Additive InstancedMesh!)
    // =========================================================================
    const streakGeo = new THREE.PlaneGeometry(0.065, 1.0);
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xdcf4ff,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.abyssSpeedLines = new THREE.InstancedMesh(streakGeo, streakMat, ABYSS_STREAK_COUNT);
    this.abyssSpeedLines.frustumCulled = false;

    for (let i = 0; i < ABYSS_STREAK_COUNT; i++) {
      const ang = (i / ABYSS_STREAK_COUNT) * Math.PI * 2 + Math.random() * 0.35;
      const rad = 1.6 + Math.random() * 7.8;
      this.abyssSpeedLines.setColorAt(
        i,
        new THREE.Color(i % 3 === 0 ? 0xffffff : i % 2 === 0 ? 0x66ccff : 0x0088ff)
      );
      this.abyssStreakStates.push({
        x: Math.cos(ang) * rad,
        baseY: -4.0 - Math.random() * 232.0,
        z: Math.sin(ang) * rad,
        speed: 24.0 + Math.random() * 34.0,
        len: 7.5 + Math.random() * 14.5,
        width: 0.65 + Math.random() * 1.4,
      });
    }
    this.abyssSpeedLines.instanceColor!.needsUpdate = true;
    this.collapseGroup.add(this.abyssSpeedLines);

    // =========================================================================
    // 4. 96 TUMBLING ABYSSAL ARCHITECTURAL DEBRIS BLOCKS IN THE SHAFT
    // =========================================================================
    const abyssGeo = new THREE.BoxGeometry(1.4, 0.45, 1.1);
    const abyssMat = new THREE.MeshLambertMaterial({
      map: concreteDiff,
      color: 0x0064c8,
      emissive: 0x002654,
      emissiveIntensity: 0.6,
    });
    this.abyssDebris = new THREE.InstancedMesh(abyssGeo, abyssMat, ABYSS_DEBRIS_COUNT);
    this.abyssDebris.frustumCulled = false;

    for (let i = 0; i < ABYSS_DEBRIS_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 2.6 + Math.random() * 6.8;
      this.abyssStates.push({
        x: Math.cos(ang) * rad,
        y: -8.0 - Math.random() * 220.0,
        z: Math.sin(ang) * rad,
        rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        rotVel: new THREE.Vector3(
          (Math.random() - 0.5) * 2.6,
          (Math.random() - 0.5) * 2.6,
          (Math.random() - 0.5) * 2.6
        ),
        scale: new THREE.Vector3(0.55 + Math.random() * 1.35, 0.5 + Math.random() * 0.9, 0.55 + Math.random() * 1.35),
      });
    }
    this.collapseGroup.add(this.abyssDebris);

    // =========================================================================
    // 5. MIDNIGHT BEDROOM CEILING APERTURE AT -224m (ZERO WHITE-OUT CUT!)
    // Matches the dark night bedroom palette (0x02060f) + blue desk glow on one side!
    // =========================================================================
    const portalGeo = new THREE.PlaneGeometry(14.5, 14.5);
    portalGeo.rotateX(-Math.PI * 0.5);
    const portalMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
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
        void main() {
          vec2 d = (vUv - 0.5) * 2.0;
          float box = max(abs(d.x), abs(d.y));
          // Glowing cyan spatial tear rim opening into the dark midnight bedroom (vec3(0.008, 0.022, 0.058))!
          float rim = smoothstep(0.10, 0.0, abs(box - 0.78));
          float outerFade = smoothstep(1.0, 0.76, box);
          // Subtle warm wood-rug & blue desk-monitor bounce glimpsed inside the dark room below!
          float deskGlow = exp(-length(d - vec2(-0.45, 0.15)) * 2.8);
          float plank = 0.92 + 0.08 * sin(vUv.x * 48.0);
          vec3 darkRoom = vec3(0.008, 0.020, 0.052) * plank + vec3(0.02, 0.16, 0.42) * deskGlow;
          vec3 col = darkRoom + vec3(0.52, 0.88, 1.0) * rim * (0.75 + 0.25 * sin(uTime * 8.0));
          gl_FragColor = vec4(col, outerFade * 0.98);
        }
      `,
    });
    this.bedroomReturnPortal = new THREE.Mesh(portalGeo, portalMat);
    this.bedroomReturnPortal.position.set(0, -224, 0);
    this.collapseGroup.add(this.bedroomReturnPortal);
  }

  private buildHostEffigyAndPhantoms(): void {
    const obsidianMat = new THREE.MeshLambertMaterial({
      color: 0x060d20,
      emissive: 0x061a3d,
      emissiveIntensity: 0.65,
    });
    const fleshMat = new THREE.MeshLambertMaterial({
      color: 0x3b0412,
      emissive: 0x990b2d,
      emissiveIntensity: 0.78,
    });
    const silhouetteMat = new THREE.MeshLambertMaterial({
      color: 0x030712,
      emissive: 0x0b2548,
      emissiveIntensity: 0.52,
    });

    // Silent Environmental Horror Monument beside the Sanctuary Threshold (-2.1, y, -44.2):
    // Your own paralyzed silhouette slumped in an office chair facing a floating BSOD slab (no fetch-quest chores!)
    const effigyX = -2.1;
    const effigyZ = -44.2;
    const effigyY = this.getTerrainHeight(effigyX, effigyZ);
    const effigyGroup = new THREE.Group();
    effigyGroup.position.set(effigyX, effigyY, effigyZ);
    effigyGroup.rotation.y = 0.28;

    const basePlinth = new THREE.Mesh(this.makeChamferedColumnGeometry(8, 1.55, 0.28), obsidianMat);
    basePlinth.position.y = 0.12;
    effigyGroup.add(basePlinth);

    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.66), obsidianMat);
    chairSeat.position.set(0, 0.72, 0.25);
    effigyGroup.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.76, 0.08), obsidianMat);
    chairBack.position.set(0, 1.12, 0.56);
    chairBack.rotation.x = 0.10;
    effigyGroup.add(chairBack);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.68, 10), silhouetteMat);
    torso.position.set(0, 1.12, 0.24);
    torso.rotation.x = -0.14;
    effigyGroup.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), silhouetteMat);
    head.position.set(0, 1.60, 0.14);
    effigyGroup.add(head);

    const miniScreen = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.68, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x0068c9 })
    );
    miniScreen.position.set(0, 1.56, -0.78);
    effigyGroup.add(miniScreen);

    for (const side of [-1, 1]) {
      const clampCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.18, 1.56, -0.74),
        new THREE.Vector3(side * 0.46, 1.68, -0.30),
        new THREE.Vector3(side * 0.19, 1.61, 0.14),
      ]);
      const clampMesh = new THREE.Mesh(new THREE.TubeGeometry(clampCurve, 10, 0.055, 6, false), fleshMat);
      effigyGroup.add(clampMesh);
    }
    this.group.add(effigyGroup);

    // 8 Peripheral Stalking Glitch Apparitions (100% GPU-animated via explicit InstancedBufferAttribute!)
    const PHANTOM_COUNT = 8;
    const figGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.82, 8, 6);
    figGeo.translate(0, 0.91, 0);
    const phantomSpots: Array<[number, number]> = [
      [-9.5, 4.0],
      [10.2, -19.5],
      [-11.5, -12.0],
      [14.2, -3.5],
      [-14.0, -32.0],
      [9.4, -38.5],
      [-8.8, -51.0],
      [10.6, -54.0],
    ];
    const pData = new Float32Array(PHANTOM_COUNT * 4);
    for (let i = 0; i < PHANTOM_COUNT; i++) {
      const [px, pz] = phantomSpots[i];
      pData[i * 4 + 0] = px;
      pData[i * 4 + 1] = this.getTerrainHeight(px, pz);
      pData[i * 4 + 2] = pz;
      pData[i * 4 + 3] = i * 1.71;
    }
    figGeo.setAttribute('aPhantom4', new THREE.InstancedBufferAttribute(pData, 4));

    this.phantomMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uPlayerPos: { value: new THREE.Vector3(0, 2, 20) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aPhantom4;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uPlayerPos;
        varying float vH;
        varying float vDissolve;
        varying float vSeed;

        void main() {
          vH = clamp(position.y / 1.82, 0.0, 1.0);
          vSeed = aPhantom4.w;
          vec3 baseW = aPhantom4.xyz;

          // Face silently toward the player on XZ!
          vec2 toPlayer = uPlayerPos.xz - baseW.xz;
          float dist = length(toPlayer);
          vec2 fwd = dist > 1e-3 ? toPlayer / dist : vec2(0.0, 1.0);
          vec2 right = vec2(fwd.y, -fwd.x);

          // Dissolves into upward static ash whenever player walks within 12.5m!
          float nearFade = 1.0 - smoothstep(7.5, 13.5, dist);
          vDissolve = nearFade;

          // Silhouette pinch at neck (vH ~ 0.76) + eerie head tilt!
          float neckPinch = 1.0 - 0.55 * exp(-pow((vH - 0.76) * 14.0, 2.0));
          float headSwell = 1.0 + 0.35 * smoothstep(0.78, 0.90, vH) * (1.0 - smoothstep(0.95, 1.0, vH));
          float glitchX = sin(vH * 38.0 + uTime * 34.0 + vSeed) * 0.06 * (uAnomaly + nearFade * 2.5);
          float headTilt = smoothstep(0.76, 0.98, vH) * 0.14 * sin(vSeed * 3.0);

          vec3 lp = vec3((position.x * neckPinch * headSwell) + headTilt + glitchX, position.y + nearFade * vH * 1.4, position.z * neckPinch * 0.65);
          vec3 worldPos = baseW + vec3(right * lp.x + fwd * lp.z, 0.0) + vec3(0.0, lp.y, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vH;
        varying float vDissolve;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;

        void main() {
          float scan = fract(vH * 28.0 - uTime * 3.5 + vSeed);
          if (vDissolve > 0.94) discard;
          if (scan < vDissolve * 0.92) discard;

          vec3 shadowCol = vec3(0.004, 0.012, 0.032);
          // Two faint watching pinprick glow-eyes near head height (vH ~ 0.88)!
          float eyeBand = exp(-pow((vH - 0.885) * 36.0, 2.0));
          vec3 eyeCol = mix(vec3(0.65, 0.90, 1.0), vec3(1.0, 0.22, 0.36), uAnomaly);
          vec3 col = shadowCol + eyeCol * eyeBand * 0.65;
          float alpha = (0.78 + 0.18 * uAnomaly) * (1.0 - vDissolve) * smoothstep(0.0, 0.12, vH);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.90));
        }
      `,
    });
    this.phantomMesh = new THREE.InstancedMesh(figGeo, this.phantomMat, PHANTOM_COUNT);
    this.phantomMesh.frustumCulled = false;
    this.group.add(this.phantomMesh);
  }

  /** True when the player ducks under Cathedral rib-arches or beside Sanctuary monoliths to break Sky-Eye gaze! */
  public isPlayerSheltered(pos: THREE.Vector3): boolean {
    // Cathedral rib-arch stations along z = 14, 2, -10, -22, -34 when near arch piers (|x| in 3.2..7.5)
    for (const gz of [14, 2, -10, -22, -34]) {
      if (Math.abs(pos.z - gz) < 2.6 && Math.abs(pos.x) > 2.4 && Math.abs(pos.x) < 8.2) {
        return true;
      }
    }
    // Close lee of Central Cray-1 Sanctuary cylinder
    if (Math.hypot(pos.x - this.corePosition.x, pos.z - this.corePosition.z) < 6.4) {
      return true;
    }
    return false;
  }

  /** Enables deferred collapse geometry for 1 offscreen warmup frame at boot so collapse never stutters! */
  public setWarmupVisibility(active: boolean): void {
    this.collapseGroup.visible = active;
  }

  public startCollapseAt(playerPos: THREE.Vector3): void {
    const groundY = this.getTerrainHeight(playerPos.x, playerPos.z);
    this.collapseCenter.set(playerPos.x, groundY, playerPos.z);
    this.collapseGroup.position.copy(this.collapseCenter);
    this.collapseGroup.visible = true;

    const voronoiFloor = this.group.getObjectByName('VoronoiJigsawFloor');
    if (voronoiFloor) voronoiFloor.visible = true;
    this.terrainMat.uniforms.uCollapseActive.value = 1.0;
    this.dataSeaMat.uniforms.uCollapseActive.value = 1.0;
    this.voronoiMat.uniforms.uCollapseTime.value = 0.0;
  }

  public resetCollapse(): void {
    this.collapseGroup.visible = false;
    const voronoiFloor = this.group.getObjectByName('VoronoiJigsawFloor');
    if (voronoiFloor) voronoiFloor.visible = false;
    this.terrainMat.uniforms.uCollapseActive.value = 0.0;
    this.dataSeaMat.uniforms.uCollapseActive.value = 0.0;
    this.voronoiMat.uniforms.uCollapseTime.value = 0.0;
    this.skyMat.uniforms.uCollapse.value = 0;
    this.landingShockTimer = 99.0;
    this.landingShockMat.uniforms.uShockT.value = 99.0;
    this.coreSecretRevealed = false;
  }

  public resolvePlayerBounds(pos: THREE.Vector3): void {
    // Keep player inside the explorable basin & safely on the elevated Causeway/Islands above the -0.35m Data Sea!
    pos.x = THREE.MathUtils.clamp(pos.x, -56, 56);
    pos.z = THREE.MathUtils.clamp(pos.z, -76, 42);

    const h = this.getTerrainHeight(pos.x, pos.z);
    if (h < -0.05) {
      // Gently push up the slope toward the central Causeway / Plaza brink so you can peer over the Data Sea safely!
      const eps = 0.4;
      const gx = this.getTerrainHeight(pos.x + eps, pos.z) - this.getTerrainHeight(pos.x - eps, pos.z);
      const gz = this.getTerrainHeight(pos.x, pos.z + eps) - this.getTerrainHeight(pos.x, pos.z - eps);
      const glen = Math.hypot(gx, gz);
      if (glen > 1e-4) {
        const push = Math.min(0.45, (-0.05 - h) * 0.9);
        pos.x += (gx / glen) * push;
        pos.z += (gz / glen) * push;
      } else {
        pos.x *= 0.92;
      }
    }

    // Collide gently with the central Cray-1 core cylinder at (0, -56), radius 3.45m
    const dx = pos.x - this.corePosition.x;
    const dz = pos.z - this.corePosition.z;
    const dist = Math.hypot(dx, dz);
    const minCoreR = 3.55;
    if (dist < minCoreR && dist > 1e-4) {
      pos.x = this.corePosition.x + (dx / dist) * minCoreR;
      pos.z = this.corePosition.z + (dz / dist) * minCoreR;
    }
  }

  public update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    collapseElapsed: number | null
  ): void {
    const isCollapsing = collapseElapsed !== null;

    // 1. Pacing between Silence & Periodic Anomaly Surges (静寂と異常の緩急)
    if (!isCollapsing) {
      this.anomalyTimer -= dt;
      if (this.anomalyTimer <= 0) {
        this.anomalyTimer = 6.4 + Math.random() * 3.4;
        this.anomalyIntensity = 1.0;
        this.onAnomalyPulse?.();
      } else {
        this.anomalyIntensity = Math.max(0, this.anomalyIntensity - dt * 1.15);
      }
    } else {
      this.anomalyIntensity = Math.min(1.0, 0.55 + collapseElapsed * 0.25);
    }

    // 2. Central Sanctuary WAKE_UP Stele Convergence (aligns seamlessly as player approaches the Core!)
    const distToCore = Math.hypot(
      playerPos.x - this.corePosition.x,
      playerPos.z - this.corePosition.z
    );
    const alignT = THREE.MathUtils.smoothstep(23.0 - distToCore, 0.0, 10.5);
    if (alignT > 0.65) {
      this.coreSecretRevealed = true;
    }

    for (let i = 0; i < this.wakePlates.length; i++) {
      const wp = this.wakePlates[i];
      const hoverY = Math.sin(elapsed * 1.8 + i * 0.7) * (0.28 * (1 - alignT) + 0.05);
      wp.mesh.position.lerpVectors(wp.scatteredPos, wp.alignedPos, alignT);
      wp.mesh.position.y += hoverY;

      if (this.anomalyIntensity > 0.2) {
        wp.mesh.position.x += (Math.random() - 0.5) * 0.14 * this.anomalyIntensity;
      }

      wp.mesh.rotation.set(
        wp.scatteredRot.x * (1 - alignT),
        wp.scatteredRot.y * (1 - alignT),
        wp.scatteredRot.z * (1 - alignT)
      );
    }
    this.corePlaqueMat.opacity = THREE.MathUtils.lerp(0.28, 0.96, alignT);

    if (this.phantomMat) {
      this.phantomMat.uniforms.uTime.value = elapsed;
      this.phantomMat.uniforms.uAnomaly.value = this.anomalyIntensity;
      this.phantomMat.uniforms.uPlayerPos.value.copy(playerPos);
    }

    // 3. 100% GPU Floating BSOD Shards (0.0ms CPU!)
    this.floatingShardMat.uniforms.uTime.value = elapsed;
    this.floatingShardMat.uniforms.uAnomaly.value = this.anomalyIntensity;

    // 4. Update Shaders & Gyroscopic Sanctuary Halo Rings
    this.terrainMat.uniforms.uTime.value = elapsed;
    this.terrainMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.dataSeaMat.uniforms.uTime.value = elapsed;
    this.dataSeaMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.citadelMat.uniforms.uTime.value = elapsed;
    this.citadelMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    if (this.finMat) {
      this.finMat.uniforms.uTime.value = elapsed;
      this.finMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    }
    this.cathedralMat.uniforms.uTime.value = elapsed;
    this.cathedralMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.dataFallsMat.uniforms.uTime.value = elapsed;
    this.dataFallsMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.errorCascadeMat.uniforms.uTime.value = elapsed;
    this.errorCascadeMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.leviathanMat.uniforms.uTime.value = elapsed;
    this.leviathanMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.skyRiftMat.uniforms.uTime.value = elapsed;
    this.skyTunnelMat.uniforms.uTime.value = elapsed;
    this.skyExitStreamMat.uniforms.uTime.value = elapsed;
    this.causewayBusMat.uniforms.uTime.value = elapsed;
    this.causewayBusMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    if (this.landingShockTimer < 2.5) {
      this.landingShockTimer += dt;
      this.landingShockMat.uniforms.uShockT.value = this.landingShockTimer;
    }
    this.voronoiMat.uniforms.uTime.value = elapsed;
    this.voronoiMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.skyMat.uniforms.uTime.value = elapsed;
    this.skyMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.skyMat.uniforms.uPlayerPos.value.copy(playerPos);
    this.astrolabeMat.uniforms.uTime.value = elapsed;
    this.astrolabeMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.crtGlassMat.uniforms.uTime.value = elapsed;
    this.crtGlassMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.dustMat.uniforms.uTime.value = elapsed;
    this.coreBeamMat.uniforms.uTime.value = elapsed;
    this.coreBeamMat.uniforms.uAnomaly.value = this.anomalyIntensity;

    // --- Aerial depth systems: mist banks drift, cloud decks roll, haze breathes.
    this.mistMat.uniforms.uTime.value = elapsed;
    this.mistMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.cloudDeckMat.uniforms.uTime.value = elapsed;
    this.cloudDeckMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.skylineMat.uniforms.uTime.value = elapsed;
    this.skylineMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.spireMat.uniforms.uTime.value = elapsed;
    this.spireMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.trafficMat.uniforms.uTime.value = elapsed;
    this.trafficMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.shaftMat.uniforms.uTime.value = elapsed;
    this.shaftMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.lanternMat.uniforms.uTime.value = elapsed;
    this.lanternMat.uniforms.uAnomaly.value = this.anomalyIntensity;
    this.monolithMat.uniforms.uTime.value = elapsed;
    this.monolithMat.uniforms.uAnomaly.value = this.anomalyIntensity;

    // The shattered monitor wreckage orbits its own broken screen.
    this.skyDebris.rotation.z = elapsed * 0.045;
    this.skyDebris.rotation.y = Math.sin(elapsed * 0.08) * 0.15;

    const ringSpeedMult = isCollapsing ? 4.5 : 1.0 + this.anomalyIntensity * 2.2;
    for (let i = 0; i < this.gyroRings.length; i++) {
      const r = this.gyroRings[i];
      const dir = i % 2 === 0 ? 1 : -1;
      r.rotation.x = 0.65 * Math.sin(elapsed * 0.38 * ringSpeedMult + i * 1.2);
      r.rotation.y = elapsed * (0.45 + i * 0.18) * dir * ringSpeedMult;
      r.rotation.z = 0.52 * Math.cos(elapsed * 0.31 * ringSpeedMult + i * 0.9);
    }
    for (let i = 0; i < this.astrolabeRings.length; i++) {
      const ar = this.astrolabeRings[i];
      const dir = i % 2 === 0 ? 1 : -1;
      ar.rotation.z = elapsed * (0.045 + i * 0.022) * dir * ringSpeedMult;
      ar.rotation.x = 0.38 + i * 0.36 + 0.18 * Math.sin(elapsed * 0.09 + i * 1.7);
      ar.rotation.y = 0.24 * Math.cos(elapsed * 0.07 + i * 2.1);
    }

    // 5. Update Act 4 True Voronoi Jigsaw Fracture & 245m Freefall Speed-Line Shaft!
    if (isCollapsing) {
      const ct = collapseElapsed;
      this.voronoiMat.uniforms.uCollapseTime.value = ct;
      this.skyMat.uniforms.uCollapse.value = THREE.MathUtils.clamp(ct / 3.8, 0, 1);
      this.abyssWallMat.uniforms.uTime.value = elapsed;

      // Animate upward fissure god-rays erupting out of Voronoi seams & extinguishing cleanly once floor drops!
      for (let i = 0; i < this.crackRayStates.length; i++) {
        const cr = this.crackRayStates[i];
        const rise = THREE.MathUtils.smoothstep(ct, cr.igniteT, cr.igniteT + 0.28);
        const extinguish = 1.0 - THREE.MathUtils.smoothstep(ct, cr.fadeT - 0.15, cr.fadeT + 0.35);
        const amp = rise * extinguish;
        this.dummy.position.set(cr.x, -0.05, cr.z);
        this.dummy.rotation.set(0, cr.rotY, 0);
        this.dummy.scale.set(cr.width * amp, Math.max(0.001, cr.height * amp), 1);
        this.dummy.updateMatrix();
        this.crackRays.setMatrixAt(i, this.dummy.matrix);
      }
      this.crackRays.instanceMatrix.needsUpdate = true;

      // Upward-rushing freefall speed lines inside the 245m shaft!
      const streakActive = THREE.MathUtils.smoothstep(ct, 3.6, 4.4);
      for (let i = 0; i < ABYSS_STREAK_COUNT; i++) {
        const st = this.abyssStreakStates[i];
        const cycledY = -4.0 - (((-st.baseY - ct * st.speed) % 228.0 + 228.0) % 228.0);
        this.dummy.position.set(st.x, cycledY, st.z);
        this.dummy.rotation.set(0, Math.atan2(st.x, st.z), 0);
        this.dummy.scale.set(st.width, st.len * Math.max(0.01, streakActive), 1);
        this.dummy.updateMatrix();
        this.abyssSpeedLines.setMatrixAt(i, this.dummy.matrix);
      }
      this.abyssSpeedLines.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < ABYSS_DEBRIS_COUNT; i++) {
        const a = this.abyssStates[i];
        this.dummy.position.set(a.x, a.y, a.z);
        this.dummy.rotation.set(
          a.rot.x + ct * a.rotVel.x,
          a.rot.y + ct * a.rotVel.y,
          a.rot.z + ct * a.rotVel.z
        );
        this.dummy.scale.copy(a.scale);
        this.dummy.updateMatrix();
        this.abyssDebris.setMatrixAt(i, this.dummy.matrix);
      }
      this.abyssDebris.instanceMatrix.needsUpdate = true;
      (this.bedroomReturnPortal.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
    }
  }
}
