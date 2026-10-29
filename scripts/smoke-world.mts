import * as THREE from 'three';

// --- minimal canvas/DOM stubs so the world builders can run headless
const ctxStub: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 120 });
      if (prop === 'canvas') return { width: 1024, height: 512 };
      return () => undefined;
    },
    set() {
      return true;
    },
  }
);
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') return {};
    return {
      width: 1024,
      height: 512,
      getContext: () => ctxStub,
      style: {},
      addEventListener: () => {},
    };
  },
  createElementNS: () => ({ getContext: () => ctxStub, style: {} }),
};
(globalThis as any).window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener: () => {} };
(globalThis as any).self = globalThis;

const { GlitchWorld } = await import('../src/world/GlitchWorld.ts');

const w: any = new GlitchWorld();
console.log('constructed GlitchWorld, group children =', w.group.children.length);

const tex = new THREE.Texture();
w.buildSkyAndLighting();
w.buildTerrain(tex, tex);
w.buildKernelMegacityAndSkyRift();
w.buildCathedralCausewayAndLeviathan();
w.buildCentralSanctuary(new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D());
w.buildWorldLandmarks(new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D());
w.buildFloatingAtmosphere();
w.buildAtmosphericDepth();
w.buildCausewayDetailAndMonoliths();
w.buildCollapseAndAbyss(tex, tex);
console.log('all builders OK, group children =', w.group.children.length);

// exercise the update loop, including anomaly bursts and collapse
const pos = new THREE.Vector3(0, 5, 20);
let pulses = 0;
w.onAnomalyPulse = () => pulses++;
for (let i = 0; i < 900; i++) w.update(1 / 60, i / 60, pos, null);
for (let i = 0; i < 600; i++) w.update(1 / 60, 15 + i / 60, pos, i / 60);
console.log('update loop OK — anomaly pulses seen:', pulses, '| traffic instances:', w.trafficMesh.count);

// sanity: every mesh/instanced mesh has finite matrices
let bad = 0;
w.group.traverse((o: any) => {
  if (o.isInstancedMesh) {
    const a = o.instanceMatrix.array as Float32Array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++;
  }
});
console.log('non-finite instance matrix values:', bad);
console.log('SMOKE TEST PASSED');
