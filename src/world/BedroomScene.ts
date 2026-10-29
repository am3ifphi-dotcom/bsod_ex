import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BsodScreen } from './BsodScreen';

export interface BoxCollider2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const PEEL_SHARD_COUNT = 56;

/**
 * Convert heavy MeshStandardMaterial to fast MeshLambertMaterial while preserving
 * albedo, emissive, alpha cutout, and double-sided flags — 4x faster fragment shading!
 */
export function toFastLambert(src: THREE.Material): THREE.Material {
  if (!(src as THREE.MeshStandardMaterial).isMeshStandardMaterial) return src;
  const std = src as THREE.MeshStandardMaterial;
  const lam = new THREE.MeshLambertMaterial({
    name: std.name,
    color: std.color.clone(),
    map: std.map,
    emissive: std.emissive.clone(),
    emissiveMap: std.emissiveMap,
    emissiveIntensity: std.emissiveIntensity,
    transparent: std.transparent,
    opacity: std.opacity,
    alphaTest: std.alphaTest,
    side: std.side,
  });
  return lam;
}

export class BedroomScene {
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

  private officeChair!: THREE.Object3D;
  private clockCanvas!: HTMLCanvasElement;
  private clockTex!: THREE.CanvasTexture;
  private lastClockText = '';

  private aftermathRelicGroup = new THREE.Group();
  private peelShards!: THREE.InstancedMesh;
  private peelData: Array<{
    origin: THREE.Vector3;
    rot: THREE.Euler;
    rotSpeed: THREE.Vector3;
    scale: THREE.Vector3;
    delay: number;
    speed: number;
  }> = [];

  private readonly infectUniforms = {
    uInfect: { value: 0 },
    uPull: { value: 0 },
    uTime: { value: 0 },
    uPortalPos: { value: new THREE.Vector3(-1.723, 1.045, 0.735) },
  };

  private readonly colliders: BoxCollider2D[] = [
    // Bed platform & mattress (ModernBed + BedUnit)
    { minX: -2.07, maxX: 1.18, minZ: -2.86, maxZ: -0.20 },
    // Right-side bedside nightstand
    { minX: 1.18, maxX: 1.72, minZ: -2.58, maxZ: -1.88 },
    // PC Desk against -X wall (front edge at X = -1.25)
    { minX: -2.07, maxX: -1.23, minZ: -0.22, maxZ: 1.38 },
    // Office chair pushed slightly aside toward +Z so front of monitor is 100% clear!
    { minX: -1.06, maxX: -0.56, minZ: 1.06, maxZ: 1.54 },
    // +X Window counter / bookshelf / stool / storage box
    { minX: 1.98, maxX: 2.85, minZ: -2.25, maxZ: 1.65 },
    { minX: 1.74, maxX: 2.12, minZ: -1.16, maxZ: -0.76 },
  ];

  public async load(gltfLoader: GLTFLoader, texLoader: THREE.TextureLoader): Promise<void> {
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

    // 1. Convert Bedroom materials to fast Lambert & inject infection shader ONLY onto large architectural surfaces!
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
          cached = toFastLambert(m);
          const mName = m.name || '';
          // Inject room infection shader onto main architectural & large furniture surfaces
          if (
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
            mName === 'material_47'
          ) {
            this.injectRoomInfectionShader(cached);
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
    this.group.add(roomRoot);

    // 2. Enclose cutaway -X wall, +Z wall, flat ceiling, door & nocturnal skyline
    this.buildEnclosedArchitecture(wallTemplateMat);
    this.buildNightExterior();

    // 3. Place the SINGLE Gaming Desktop PC Setup against the -X wall
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

        // Comfortable seated/leaning-in inspection camera framing the full monitor + bezel + room glow
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
          cached = toFastLambert(m);
          if (m.name === 'Material') {
            // Desk tabletop infects cleanly during escalation
            this.injectRoomInfectionShader(cached);
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

    this.infectUniforms.uPortalPos.value.copy(this.monitorWorldPos);
    this.group.add(pcRoot);
    this.group.add(this.bsodScreen.root);

    // Add 4 steel desk legs & under-desk cable harness (no extra PC boards!)
    this.buildDeskLegsAndCables(cablesGltf.scene);

    // 4. Office Chair (placed naturally slightly to the side so front of monitor is 100% open!)
    this.officeChair = chairGltf.scene;
    this.officeChair.position.set(-0.82, 0.017, 1.30);
    this.officeChair.scale.setScalar(0.75);
    this.officeChair.rotation.y = -2.25;
    this.officeChair.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        mesh.material = toFastLambert(mesh.material as THREE.Material);
      }
    });
    this.group.add(this.officeChair);

    // 5. Lived-in Nocturnal Props (Desk Lamp, Coffee Mug, Digital Clock)
    this.buildNocturnalProps(clockTexWebp, lampTexWebp);

    // 6. Lightweight Nocturnal Lighting (ONLY 1 HemisphereLight + 1 Desk Lamp PointLight + Monitor PointLight!)
    this.buildNocturnalLighting();

    // 7. Instanced Peeling Room Shards (1 single draw call, hidden when idle!)
    this.buildPeelingRoomShards();

    // 8. Act 5 Lingering Aftermath Relics
    this.buildAftermathRelics();

    // 8b. Window moonlight spill + a dead pendant fixture under the ceiling rose.
    this.buildAmbientPracticals();

    // 9. Architectural craftsmanship: wainscot panelling, chair rail, crown moulding,
    //    a properly built door, ceiling rose and contact shadows. All merged into a
    //    handful of draw calls so the room reads as a real, built space.
    this.buildArchitecturalDetail();
  }

  private buildEnclosedArchitecture(wallTemplate: THREE.MeshLambertMaterial | null): void {
    const wallMat = wallTemplate
      ? wallTemplate.clone()
      : new THREE.MeshLambertMaterial({ color: 0x262c38 });
    this.injectRoomInfectionShader(wallMat);

    const trimMat = new THREE.MeshLambertMaterial({ color: 0x161922 });
    this.injectRoomInfectionShader(trimMat);

    // -X Wall behind the Gaming PC setup
    const westWall = new THREE.Mesh(new THREE.PlaneGeometry(4.56, 3.16, 12, 8), wallMat);
    westWall.rotation.y = Math.PI * 0.5;
    westWall.position.set(-2.062, 1.59, -0.60);
    this.group.add(westWall);

    // +Z South Wall enclosing the room behind the player
    const southWall = new THREE.Mesh(new THREE.PlaneGeometry(4.86, 3.16, 12, 8), wallMat);
    southWall.rotation.y = Math.PI;
    southWall.position.set(0.34, 1.59, 1.646);
    this.group.add(southWall);

    // Flat Upper Ceiling seamlessly meeting the sloped skylight at Z = -1.501, Y = 3.153
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(4.86, 3.18, 12, 10), wallMat);
    ceiling.rotation.x = Math.PI * 0.5;
    ceiling.position.set(0.34, 3.152, 0.08);
    this.group.add(ceiling);

    // Baseboards
    const westBase = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.09, 4.54), trimMat);
    westBase.position.set(-2.05, 0.06, -0.60);
    this.group.add(westBase);

    const southBase = new THREE.Mesh(new THREE.BoxGeometry(4.84, 0.09, 0.025), trimMat);
    southBase.position.set(0.34, 0.06, 1.635);
    this.group.add(southBase);

    // Bedroom Door on +Z Wall (at X = +1.18) with hallway light crack underneath
    const doorGroup = new THREE.Group();
    doorGroup.position.set(1.18, 0.017, 1.632);

    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.14, 0.045), trimMat);
    doorFrame.position.y = 1.07;
    doorGroup.add(doorFrame);

    const doorPanelMat = new THREE.MeshLambertMaterial({ color: 0x1e222c });
    this.injectRoomInfectionShader(doorPanelMat);
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.88, 2.06, 0.055), doorPanelMat);
    doorPanel.position.set(0, 1.05, -0.008);
    doorGroup.add(doorPanel);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.024, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x6e788c })
    );
    handle.position.set(-0.33, 1.0, -0.045);
    doorGroup.add(handle);

    const doorCrackGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.018),
      new THREE.MeshBasicMaterial({ color: 0x3b4d6b })
    );
    doorCrackGlow.rotation.y = Math.PI;
    doorCrackGlow.position.set(0, 0.012, -0.038);
    doorGroup.add(doorCrackGlow);

    this.group.add(doorGroup);
  }

  /**
   * Practical lights that give the room a read: cold moon spill through the right-hand window
   * (a soft pool plus a faint shaft), and a dead pendant hanging from the ceiling rose. Both are
   * authored to be *dim* — the monitor is the only real light source in the room, and everything
   * else exists to reveal that it isn't.
   */
  private buildAmbientPracticals(): void {
    // ------------------------------------------------ moonlight pool on the floor
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
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 3.2),
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        opacity: 0.30,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    pool.rotation.x = -Math.PI * 0.5;
    pool.rotation.z = 0.22;
    pool.position.set(1.55, 0.024, -0.55);
    this.group.add(pool);

    // Faint volume of light falling in from the window
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
          float shimmer = 0.82 + 0.18 * sin(uTime * 0.6 + vUv.y * 2.0);
          vec3 col = mix(vec3(0.24, 0.42, 0.85), vec3(0.10, 0.28, 0.75), uInfect);
          gl_FragColor = vec4(col, across * along * shimmer * 0.075);
        }
      `,
    });
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.3), shaftMat);
    shaft.position.set(2.22, 1.35, -0.55);
    shaft.rotation.set(0, -Math.PI * 0.5, -0.34);
    this.group.add(shaft);

    // Cool fill so the window side of the room is never pure black
    const moonFill = new THREE.PointLight(0x6f92ff, 1.35, 4.4, 1.6);
    moonFill.position.set(2.15, 2.05, -0.55);
    this.group.add(moonFill);

    // ------------------------------------------------ dead pendant under the ceiling rose
    const cordMat = new THREE.MeshLambertMaterial({ color: 0x15181f });
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), cordMat);
    cord.position.set(0.34, 2.935, 0.1);
    this.group.add(cord);

    const shadeMat = new THREE.MeshLambertMaterial({ color: 0x2a2f3c, side: THREE.DoubleSide });
    this.injectRoomInfectionShader(shadeMat);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 14, 1, true), shadeMat);
    shade.position.set(0.34, 2.66, 0.1);
    shade.rotation.x = Math.PI;
    this.group.add(shade);

    const deadBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x2a2118 })
    );
    deadBulb.position.set(0.34, 2.695, 0.1);
    this.group.add(deadBulb);
  }

  /** Adds one transformed box to a merge batch (position + optional Euler in radians). */
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

  /**
   * Real architectural joinery for the room. The previous room was bare planes, which is why it
   * read as a grey box instead of a bedroom: what is missing is not texture but *edges* — the
   * chair rail, the raised wainscot panels, the crown, the door casing and the skirting shadow
   * that tell your eye how the room is constructed.
   *
   * Everything is merged into 3 geometries (trim / panel / door), so the whole pass costs 3 draws.
   */
  private buildArchitecturalDetail(): void {
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x2b3140 });
    this.injectRoomInfectionShader(trimMat);
    const panelMat = new THREE.MeshLambertMaterial({ color: 0x232936 });
    this.injectRoomInfectionShader(panelMat);
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x2a3040 });
    this.injectRoomInfectionShader(doorMat);

    const trim: THREE.BufferGeometry[] = [];
    const panels: THREE.BufferGeometry[] = [];

    // Room extents (matching the collision bounds and the enclosed walls)
    const WEST_X = -2.055;
    const SOUTH_Z = 1.638;
    const CEIL_Y = 3.145;
    const CHAIR_RAIL_Y = 0.94;

    // ------------------------------------------------ WEST WALL (-X): wainscot + panels
    for (let i = 0; i < 7; i++) {
      const z0 = -2.72 + i * 0.62;
      const ph = 0.62;
      const pw = 0.5;
      const pz = z0 + 0.31;
      // Raised-panel frame: 4 chamfered rails around a recessed field
      this.pushBox(panels, 0.018, ph, 0.045, WEST_X + 0.012, 0.52, pz - pw * 0.5);
      this.pushBox(panels, 0.018, ph, 0.045, WEST_X + 0.012, 0.52, pz + pw * 0.5);
      this.pushBox(panels, 0.018, 0.045, pw, WEST_X + 0.012, 0.52 + ph * 0.5, pz);
      this.pushBox(panels, 0.018, 0.045, pw, WEST_X + 0.012, 0.52 - ph * 0.5, pz);
      // Recessed field sits a few mm back so it catches the lamp at a shallow angle
      this.pushBox(panels, 0.010, ph - 0.09, pw - 0.09, WEST_X + 0.005, 0.52, pz);
    }
    // Chair rail + skirting (two-step profile) + crown (two-step)
    this.pushBox(trim, 0.05, 0.055, 4.6, WEST_X + 0.028, CHAIR_RAIL_Y, -0.6);
    this.pushBox(trim, 0.07, 0.022, 4.6, WEST_X + 0.036, CHAIR_RAIL_Y - 0.036, -0.6);
    this.pushBox(trim, 0.026, 0.115, 4.6, WEST_X + 0.015, 0.058, -0.6);
    this.pushBox(trim, 0.045, 0.018, 4.6, WEST_X + 0.023, 0.118, -0.6);
    this.pushBox(trim, 0.055, 0.05, 4.6, WEST_X + 0.028, CEIL_Y - 0.035, -0.6);
    this.pushBox(trim, 0.085, 0.03, 4.6, WEST_X + 0.042, CEIL_Y - 0.082, -0.6);

    // ------------------------------------------------ SOUTH WALL (+Z): same treatment
    for (let i = 0; i < 7; i++) {
      const x0 = -2.0 + i * 0.62;
      const ph = 0.62;
      const pw = 0.5;
      const px = x0 + 0.31;
      if (px > 0.62 && px < 1.76) continue; // leave the doorway clear
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

    // ------------------------------------------------ CEILING: crown return + rose
    this.pushBox(trim, 4.9, 0.055, 0.05, 0.34, CEIL_Y - 0.035, -1.52);
    this.pushBox(trim, 0.05, 0.055, 2.4, 2.66, CEIL_Y - 0.035, 0.06);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.pushBox(trim, 0.085, 0.014, 0.26, 0.34 + Math.cos(a) * 0.42, CEIL_Y - 0.012, 0.1 + Math.sin(a) * 0.42, 0, -a, 0);
    }

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

    // ------------------------------------------------ DOOR: casing, panels, hinges
    const door: THREE.BufferGeometry[] = [];
    const DOOR_X = 1.18;
    // Casing (stops + architrave) wrapping the opening
    this.pushBox(door, 0.075, 2.16, 0.055, DOOR_X - 0.49, 1.08, SOUTH_Z - 0.03);
    this.pushBox(door, 0.075, 2.16, 0.055, DOOR_X + 0.49, 1.08, SOUTH_Z - 0.03);
    this.pushBox(door, 1.05, 0.075, 0.055, DOOR_X, 2.19, SOUTH_Z - 0.03);
    this.pushBox(door, 1.14, 0.035, 0.075, DOOR_X, 2.245, SOUTH_Z - 0.04);
    // Leaf with two recessed panels (matches the joinery elsewhere in the room)
    this.pushBox(door, 0.9, 2.1, 0.05, DOOR_X, 1.06, SOUTH_Z - 0.012);
    this.pushBox(door, 0.62, 0.9, 0.014, DOOR_X, 1.62, SOUTH_Z - 0.042);
    this.pushBox(door, 0.62, 0.72, 0.014, DOOR_X, 0.55, SOUTH_Z - 0.042);
    // Threshold + hinges + lever handle
    this.pushBox(door, 0.98, 0.022, 0.09, DOOR_X, 0.012, SOUTH_Z - 0.02);
    this.pushBox(door, 0.05, 0.09, 0.03, DOOR_X - 0.42, 0.34, SOUTH_Z - 0.045);
    this.pushBox(door, 0.05, 0.09, 0.03, DOOR_X - 0.42, 1.68, SOUTH_Z - 0.045);

    const mergedDoor = mergeGeometries(door, false);
    if (mergedDoor) this.group.add(new THREE.Mesh(mergedDoor, doorMat));
    for (const g of door) g.dispose();

    const handleMat = new THREE.MeshLambertMaterial({ color: 0x7f8a9e });
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.028), handleMat);
    lever.position.set(DOOR_X + 0.33, 1.02, SOUTH_Z - 0.055);
    this.group.add(lever);
    const rosette = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.016, 12), handleMat);
    rosette.rotation.x = Math.PI * 0.5;
    rosette.position.set(DOOR_X + 0.33, 1.02, SOUTH_Z - 0.045);
    this.group.add(rosette);

    // ------------------------------------------------ CONTACT SHADOWS
    // Soft dark pools under each heavy object. Without these, furniture appears to float.
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
      [0.34, -1.5, 3.4, 2.9], // bed
      [-1.62, 0.6, 1.2, 2.2], // desk + PC
      [-0.82, 1.3, 1.0, 1.0], // chair
      [1.42, -2.2, 0.9, 1.2], // nightstand
    ];
    for (const [x, z, w, d] of shadowSpots) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMat);
      plane.rotation.x = -Math.PI * 0.5;
      plane.position.set(x, 0.022, z);
      plane.renderOrder = 1;
      this.group.add(plane);
    }
  }

  /**
   * The view out of the bedroom window. It used to be a flat navy plane with four boxes; now it
   * is three parallax layers of city silhouette, a graded night sky with a low moon, and a scatter
   * of lit windows — the depth cue that makes the room feel like it sits inside a city at 2am.
   */
  private buildNightExterior(): void {
    // ------------------------------------------------ graded night sky
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

          // Low moon with a soft atmospheric halo behind the towers.
          vec2 moon = vec2(0.30, 0.34);
          float d = length((vUv - moon) * vec2(1.0, 0.78));
          col += vec3(0.55, 0.68, 0.92) * exp(-d * 34.0) * 0.55;
          col += vec3(0.86, 0.92, 1.0) * smoothstep(0.016, 0.006, d) * 0.9;

          // Sparse stars, brighter near the zenith.
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

    // ------------------------------------------------ parallax city layers
    const layerSpec: Array<{ x: number; tint: number; count: number; hMin: number; hMax: number; wMin: number; wMax: number; seed: number }> = [
      { x: 5.0, tint: 0x0a1428, count: 16, hMin: 1.4, hMax: 5.2, wMin: 0.34, wMax: 0.85, seed: 11 },
      { x: 4.4, tint: 0x070f20, count: 12, hMin: 1.0, hMax: 3.6, wMin: 0.4, wMax: 0.95, seed: 29 },
      { x: 3.9, tint: 0x050b18, count: 8, hMin: 0.8, hMax: 2.4, wMin: 0.5, wMax: 1.1, seed: 47 },
    ];

    let seedCounter = 0;
    for (const layer of layerSpec) {
      const batch: THREE.BufferGeometry[] = [];
      const winBatch: THREE.BufferGeometry[] = [];
      let cursor = -4.2;
      for (let i = 0; i < layer.count; i++) {
        const rnd = (n: number) => Math.abs(Math.sin((seedCounter + n) * 12.9898 + layer.seed) * 43758.5453) % 1;
        const w = layer.wMin + rnd(1) * (layer.wMax - layer.wMin);
        const h = layer.hMin + rnd(2) * (layer.hMax - layer.hMin);
        const z = cursor + w * 0.5;
        cursor += w + 0.1 + rnd(3) * 0.25;
        seedCounter++;

        this.pushBox(batch, 0.3, h, w, layer.x, h * 0.5 - 0.35, z);
        // Art-deco crown on the taller silhouettes
        if (h > layer.hMin + (layer.hMax - layer.hMin) * 0.55) {
          this.pushBox(batch, 0.22, 0.14, w * 0.22, layer.x, h - 0.3, z);
          this.pushBox(batch, 0.16, 0.1, w * 0.1, layer.x, h - 0.16, z);
        }
        // Lit windows: a handful per building, deterministic so they never pop
        const rows = Math.max(2, Math.floor(h / 0.42));
        const cols = Math.max(2, Math.floor(w / 0.17));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const lit = Math.abs(Math.sin((r * 37 + c * 91 + seedCounter * 13 + layer.seed) * 0.7)) % 1;
            if (lit < 0.72) continue;
            const wy = 0.16 + r * 0.42;
            if (wy > h - 0.35) continue;
            const wz = z - w * 0.5 + 0.09 + c * 0.17;
            const wg = new THREE.PlaneGeometry(0.055, 0.075);
            wg.applyMatrix4(
              new THREE.Matrix4().compose(
                new THREE.Vector3(layer.x - 0.16, wy, wz),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI * 0.5, 0)),
                new THREE.Vector3(1, 1, 1)
              )
            );
            winBatch.push(wg);
          }
        }
      }

      const bodyMat = new THREE.MeshBasicMaterial({ color: layer.tint });
      const mergedBody = mergeGeometries(batch, false);
      if (mergedBody) this.group.add(new THREE.Mesh(mergedBody, bodyMat));
      for (const g of batch) g.dispose();

      const winMat = new THREE.MeshBasicMaterial({
        color: layer === layerSpec[0] ? 0x9dc4e8 : 0x6b91bd,
        transparent: true,
        opacity: layer === layerSpec[0] ? 0.9 : 0.55,
        depthWrite: false,
      });
      const mergedWin = mergeGeometries(winBatch, false);
      if (mergedWin) this.group.add(new THREE.Mesh(mergedWin, winMat));
      for (const g of winBatch) g.dispose();
    }

    // Billboard haze sheet between the near and far layers softens the skyline edge.
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0x1a3358,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), hazeMat);
    haze.rotation.y = -Math.PI * 0.5;
    haze.position.set(4.65, 1.7, -0.6);
    this.group.add(haze);
  }

  private buildDeskLegsAndCables(cablesTemplate: THREE.Object3D): void {
    const legMat = new THREE.MeshLambertMaterial({ color: 0x12151c });
    const legGeo = new THREE.BoxGeometry(0.045, 0.70, 0.045);
    const legCoords = [
      [-1.98, -0.14],
      [-1.30, -0.14],
      [-1.98, 1.30],
      [-1.30, 1.30],
    ];
    for (const [lx, lz] of legCoords) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, 0.365, lz);
      this.group.add(leg);
    }

    cablesTemplate.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = toFastLambert((o as THREE.Mesh).material as THREE.Material);
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

    // Late-night coffee mug
    const mugMat = new THREE.MeshLambertMaterial({ color: 0xd8dde8 });
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
    // Clean, ultra-fast 2-PointLight + 1-HemisphereLight nocturnal setup
    this.hemiLight = new THREE.HemisphereLight(0x28406e, 0x0a0e18, 0.72);
    this.group.add(this.hemiLight);

    // Subtle warm desk lamp right beside the monitor
    this.deskLampLight = new THREE.PointLight(0xffb469, 0.58, 2.6, 1.8);
    this.deskLampLight.position.set(-1.68, 1.0, 1.18);
    this.group.add(this.deskLampLight);

    // Cinematic Volumetric Monitor Light Shaft (fades out automatically when inspecting screen up close!)
    const beamLen = 1.95;
    const beamGeo = new THREE.CylinderGeometry(0.24, 0.78, beamLen, 20, 1, true);
    beamGeo.rotateZ(-Math.PI * 0.5); // Extends along +X from monitor into dark bedroom
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
          // Soft Fresnel silhouette falloff so cone has zero hard edges!
          float edgeSoft = pow(abs(dot(normalize(vNormalW), viewDir)), 1.65);
          // Fade along length from screen (vUv.y = 1 -> 0 depending on cylinder UV)
          float along = smoothstep(1.95, 0.05, vWorldPos.x - (-1.72));
          // Fade out cleanly when camera leans close to inspect monitor so text stays 100% razor-sharp!
          float camDistFade = smoothstep(0.62, 1.25, length(cameraPosition - vec3(-1.72, 1.05, 0.735)));
          float scan = 0.92 + 0.08 * sin(vWorldPos.y * 38.0 - uTime * 7.0);
          float alpha = edgeSoft * along * camDistFade * 0.095 * uIntensity * scan;
          gl_FragColor = vec4(0.05, 0.42, 0.96, alpha);
        }
      `,
    });
    this.monitorBeamMesh = new THREE.Mesh(beamGeo, this.monitorBeamMat);
    this.monitorBeamMesh.position.copy(this.monitorWorldPos);
    this.group.add(this.monitorBeamMesh);

    // Subtle floating nocturnal dust motes caught in the monitor's blue glow (1 single Points draw call!)
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
          // During suction, dust motes whip straight into the monitor maw!
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

  private buildPeelingRoomShards(): void {
    const shardGeo = new THREE.BoxGeometry(0.18, 0.13, 0.012);
    const shardMat = new THREE.MeshBasicMaterial({ color: 0x0078d7 });
    this.peelShards = new THREE.InstancedMesh(shardGeo, shardMat, PEEL_SHARD_COUNT);
    this.peelShards.frustumCulled = false;
    this.peelShards.visible = false;

    for (let i = 0; i < PEEL_SHARD_COUNT; i++) {
      const bright = i % 5 === 0 ? new THREE.Color(0xdcf0ff) : new THREE.Color(0x0078d7);
      this.peelShards.setColorAt(i, bright);

      const zone = i % 4;
      const origin = new THREE.Vector3();
      if (zone === 0) {
        origin.set(-2.02, 0.3 + Math.random() * 2.6, -1.8 + Math.random() * 3.2);
      } else if (zone === 1) {
        origin.set(-1.6 + Math.random() * 3.6, 3.08, -1.3 + Math.random() * 2.7);
      } else if (zone === 2) {
        origin.set(-1.5 + Math.random() * 3.2, 0.05, -0.4 + Math.random() * 1.9);
      } else {
        origin.set(-1.6 + Math.random() * 3.6, 0.4 + Math.random() * 2.5, 1.58);
      }

      this.peelData.push({
        origin,
        rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4
        ),
        scale: new THREE.Vector3(0.6 + Math.random() * 1.8, 0.5 + Math.random() * 1.4, 1),
        delay: Math.random() * 0.45,
        speed: 0.7 + Math.random() * 0.9,
      });
    }
    this.peelShards.instanceColor!.needsUpdate = true;
    this.group.add(this.peelShards);
  }

  private buildAftermathRelics(): void {
    this.aftermathRelicGroup.visible = false;

    const shardMat = new THREE.MeshBasicMaterial({ color: 0x3aa6ff });
    const crystalPositions = [
      { pos: [-1.42, 0.766, 0.78], rot: [0.2, 0.6, 0.1], s: [0.065, 0.008, 0.045] },
      { pos: [-1.36, 0.765, 0.69], rot: [-0.1, 1.3, 0.2], s: [0.045, 0.007, 0.032] },
      { pos: [-1.47, 0.767, 0.64], rot: [0.4, -0.4, 0.15], s: [0.038, 0.012, 0.028] },
      { pos: [0.42, 0.025, 0.25], rot: [0.05, 0.9, 0.02], s: [0.055, 0.006, 0.038] },
    ];
    for (const c of crystalPositions) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(c.s[0], c.s[1], c.s[2]), shardMat);
      m.position.set(c.pos[0], c.pos[1], c.pos[2]);
      m.rotation.set(c.rot[0], c.rot[1], c.rot[2]);
      this.aftermathRelicGroup.add(m);
    }

    this.group.add(this.aftermathRelicGroup);
  }

  /**
   * Injects fast GPU BSOD infection & suction pull with early-out guards so idle cost is 0.0ms!
   */
  private injectRoomInfectionShader(mat: THREE.Material): void {
    if (mat.userData.bsodInfected) return;
    mat.userData.bsodInfected = true;

    mat.customProgramCacheKey = () => 'bsod_lambert_infect_v2';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uInfect = this.infectUniforms.uInfect;
      shader.uniforms.uPull = this.infectUniforms.uPull;
      shader.uniforms.uTime = this.infectUniforms.uTime;
      shader.uniforms.uPortalPos = this.infectUniforms.uPortalPos;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vBsodWorldPos;
          varying vec3 vBsodNrm;
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
            vec3 toMon = uPortalPos - bsodWp.xyz;
            float dMon = length(toMon);
            float cell = sin(bsodWp.x * 8.0 + uTime * 3.0) * cos(bsodWp.y * 8.0 - bsodWp.z * 7.0);
            float pullAmt = uPull * smoothstep(5.2, 0.35, dMon) * (0.55 + 0.45 * cell);
            bsodWp.xyz += normalize(toMon + vec3(0.0001)) * pullAmt * min(dMon * 0.85, 2.2);
            bsodWp.y += sin(dMon * 5.0 - uTime * 9.0) * 0.09 * uPull;
          }

          vBsodWorldPos = bsodWp.xyz;
          vec3 bsodN = objectNormal;
          #ifdef USE_INSTANCING
            bsodN = mat3(instanceMatrix) * bsodN;
          #endif
          vBsodNrm = normalize(mat3(modelMatrix) * bsodN);
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
          varying vec3 vBsodNrm;
          uniform float uInfect;
          uniform float uPull;
          uniform float uTime;
          uniform vec3 uPortalPos;

          float bsodHash(vec2 p) {
            p = fract(p * vec2(127.1, 311.7));
            p += dot(p, p + 34.23);
            return fract(p.x * p.y);
          }
          float bsodNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(bsodHash(i), bsodHash(i + vec2(1.0, 0.0)), u.x),
                       mix(bsodHash(i + vec2(0.0, 1.0)), bsodHash(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          `
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          if (uInfect > 0.002) {
            float distToMon = distance(vBsodWorldPos, uPortalPos);
            vec3 q = floor(vBsodWorldPos * 12.0);
            float cellHash = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float waveRadius = uInfect * 6.8;
            float front = waveRadius - distToMon + (cellHash - 0.5) * 1.15;
            float mask = smoothstep(-0.18, 0.22, front) * smoothstep(0.02, 0.25, uInfect);
            float edgeBand = smoothstep(0.32, 0.0, abs(front)) * step(0.03, uInfect);

            vec3 gridF = abs(fract(vBsodWorldPos * 6.0) - 0.5);
            float gridLine = step(0.46, max(gridF.x, max(gridF.y, gridF.z)));
            float scanPulse = 0.86 + 0.14 * sin(vBsodWorldPos.y * 42.0 - uTime * 16.0);
            vec3 bsodCol = vec3(0.0, 0.165, 0.58) * scanPulse;

            // Unsettling staring ':' eye pairs erupting across the dark infected bedroom walls!
            vec2 wallCell = fract(vec2(vBsodWorldPos.x + vBsodWorldPos.z, vBsodWorldPos.y) * 2.4) - 0.5;
            float blink = step(0.12, fract(uTime * 0.65 + cellHash * 7.3));
            float wEyeL = smoothstep(0.08, 0.035, length(wallCell - vec2(-0.12, 0.06)));
            float wEyeR = smoothstep(0.08, 0.035, length(wallCell - vec2(0.12, 0.06)));
            float wallEyes = (wEyeL + wEyeR) * step(0.76, cellHash) * blink * smoothstep(0.32, 0.72, uInfect);

            bsodCol = mix(bsodCol, vec3(0.85, 0.95, 1.0), gridLine * 0.55 + step(0.94, cellHash) * 0.4);
            bsodCol += vec3(1.0, 0.25, 0.30) * wallEyes * 1.35;

            gl_FragColor.rgb = mix(gl_FragColor.rgb, bsodCol, mask * 0.95);
            gl_FragColor.rgb += vec3(0.42, 0.80, 1.0) * edgeBand * 0.9;
          }

          // ---------------------------------------------------------------- SURFACE CRAFT
          // World-space detail applied to every architectural surface so the room stops reading
          // as flat colour: plaster tooth, moisture bloom rising from the skirting, damp bleeding
          // down from the ceiling, and a soft vertiginous occlusion in the corners of the room.
          {
            vec3 wnrm = normalize(vBsodNrm);
            float upness = abs(wnrm.y);
            vec3 wp = vBsodWorldPos;
            float wallAmt = 1.0 - smoothstep(0.32, 0.72, upness);

            // Fine plaster tooth (two octaves, screen-independent, tiny footprint)
            float tooth = bsodNoise(wp.xz * 96.0 + wp.y * 71.0) * 0.5 + bsodNoise(wp.xz * 41.0) * 0.5;
            // Broad damp bloom that creeps up from the floor along vertical surfaces
            float riseFromFloor = 1.0 - smoothstep(0.0, 1.15 + bsodNoise(wp.xz * 2.2) * 0.55, wp.y);
            float damp = smoothstep(0.35, 0.85, bsodNoise(vec2((wp.x + wp.z) * 1.9, wp.y * 0.42))) * wallAmt * riseFromFloor;
            // Streaks bleeding down from the ceiling line
            float leakBand = smoothstep(0.55, 0.95, bsodNoise(vec2((wp.x + wp.z) * 5.5, wp.y * 0.6)));
            float leak = leakBand * wallAmt * smoothstep(2.0, 3.1, wp.y);

            // --- wallpaper: vertical stripe field + offset damask motif, authored in world space
            // so it stays perfectly consistent across the GLB shell and the enclosing planes.
            float uAxis = (wp.x + wp.z);
            float stripe = smoothstep(0.42, 0.5, abs(fract(uAxis * 1.92) - 0.5));
            vec2 dup = vec2(uAxis * 3.84, wp.y * 3.84);
            float rowFlip = step(0.5, fract(dup.x));
            vec2 dm = abs(fract(dup + vec2(0.5 * rowFlip, 0.5 * rowFlip)) - 0.5);
            float damask = smoothstep(0.20, 0.055, length(dm * vec2(1.0, 1.25)));
            float damaskRing = smoothstep(0.028, 0.0, abs(length(dm * vec2(1.0, 1.25)) - 0.205));
            float paper = (stripe * 0.5 + damask * 0.34 + damaskRing * 0.12) * wallAmt;

            // --- skim-coat trowel streaks: strongly anisotropic noise reads as hand-applied plaster
            float skim = bsodNoise(vec2(uAxis * 34.0, wp.y * 2.6)) * 0.6
                       + bsodNoise(vec2(uAxis * 96.0, wp.y * 7.0)) * 0.4;

            // --- large-scale tonal drift: no two panels receive identical light
            float panelDrift = bsodNoise(vec2(uAxis * 0.55, wp.y * 0.5));

            // --- hairline settlement cracks, only in the lower half of the walls
            float crackN = bsodNoise(vec2(uAxis * 9.0, wp.y * 16.0));
            float crackLine = smoothstep(0.022, 0.0, abs(crackN - 0.5))
                            * smoothstep(0.35, 0.9, bsodNoise(vec2(uAxis * 2.1, wp.y * 2.4)))
                            * wallAmt * (1.0 - smoothstep(0.8, 2.1, wp.y));

            gl_FragColor.rgb *= 1.0 - tooth * 0.075 + (skim - 0.5) * 0.045 + (panelDrift - 0.5) * 0.10;
            gl_FragColor.rgb *= 1.0 + paper * 0.085 - damask * 0.02;
            gl_FragColor.rgb *= 1.0 - crackLine * 0.55;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.66, 0.72, 0.84), damp * 0.42);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.58, 0.64, 0.76), leak * 0.30);

            // Corner occlusion: darker where any surface meets the floor or the ceiling.
            float floorAO = smoothstep(0.55, 0.0, wp.y) * wallAmt;
            float ceilAO = smoothstep(2.55, 3.15, wp.y) * wallAmt;
            gl_FragColor.rgb *= 1.0 - (floorAO * 0.42 + ceilAO * 0.34);

            // Faint cool bounce on the lower walls keeps the shadow side from going to mud.
            gl_FragColor.rgb += vec3(0.012, 0.022, 0.045) * floorAO;
          }
          `
        );
    };
  }

  public setAftermathMode(aftermath: boolean): void {
    this.aftermathRelicGroup.visible = aftermath;
    if (this.officeChair) {
      if (aftermath) {
        // Eerie subtle change: the office chair has rotated on its own to face where you fell on the rug!
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
          const penFront = Math.abs(box.maxZ - pos.z);
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
    aftermath: boolean
  ): void {
    this.infectUniforms.uInfect.value = infectLevel;
    this.infectUniforms.uPull.value = pullLevel;
    this.infectUniforms.uTime.value = elapsed;

    this.monitorBeamMat.uniforms.uTime.value = elapsed;
    this.monitorBeamMat.uniforms.uIntensity.value = aftermath ? 0.22 : 1.0 + infectLevel * 1.4;
    this.monitorBeamMesh.visible = pullLevel < 0.75;

    this.roomDustMat.uniforms.uTime.value = elapsed;
    this.roomDustMat.uniforms.uPull.value = pullLevel;

    if (aftermath) {
      this.deskLampLight.intensity = 0.06;
      this.deskLampBulbMat.color.setHex(0x28221e);
      this.hemiLight.intensity = 0.56;
      if (this.officeChair) {
        // Eerie slow sway of the chair that rotated to watch you on the rug
        this.officeChair.rotation.y = 1.15 + Math.sin(elapsed * 0.9) * 0.045;
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

    if (infectLevel > 0.22) {
      this.peelShards.visible = true;
      const intensity = THREE.MathUtils.clamp((infectLevel - 0.22) / 0.78, 0, 1);
      for (let i = 0; i < PEEL_SHARD_COUNT; i++) {
        const d = this.peelData[i];
        const localP = THREE.MathUtils.clamp(
          (intensity * 1.25 + pullLevel * 0.85 - d.delay) * d.speed,
          0,
          1
        );
        if (localP <= 0.001) {
          _mat4.makeScale(0.0001, 0.0001, 0.0001);
          this.peelShards.setMatrixAt(i, _mat4);
          continue;
        }
        _pos.lerpVectors(d.origin, this.monitorWorldPos, localP * localP);
        _pos.y += Math.sin(elapsed * 4.0 + i) * 0.14 * localP;
        d.rot.x += d.rotSpeed.x * dt * (1 + pullLevel * 3);
        d.rot.y += d.rotSpeed.y * dt * (1 + pullLevel * 3);
        _quat.setFromEuler(d.rot);
        const shrink = 1.0 - smoothStep(0.75, 1.0, localP);
        _scale.copy(d.scale).multiplyScalar(Math.max(0.001, shrink));
        _mat4.compose(_pos, _quat, _scale);
        this.peelShards.setMatrixAt(i, _mat4);
      }
      this.peelShards.instanceMatrix.needsUpdate = true;
    } else if (this.peelShards.visible) {
      this.peelShards.visible = false;
    }
  }
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
