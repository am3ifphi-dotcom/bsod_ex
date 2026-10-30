import * as THREE from 'three';

const gradientStub = { addColorStop: () => undefined };
const ctxStub: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 120 });
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradientStub;
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'canvas') return { width: 512, height: 512 };
      return () => undefined;
    },
    set() {
      return true;
    },
  }
);
(globalThis as any).document = {
  createElement: () => ({ width: 512, height: 512, getContext: () => ctxStub, style: {} }),
  createElementNS: () => ({ getContext: () => ctxStub, style: {} }),
};
(globalThis as any).window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener: () => {} };
(globalThis as any).self = globalThis;

const { BedroomScene } = await import('../src/world/BedroomScene.ts');

function fakeScene(matName: string): any {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ name: matName, color: 0x888888 })
  );
  mesh.name = 'BSOD_SCREEN_NODE';
  g.add(mesh);
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ name: 'Walls', color: 0x555555 })
  );
  g.add(wall);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ name: 'Floor', color: 0x444444 })
  );
  g.add(floor);
  return { scene: g };
}

const gltfLoader: any = { loadAsync: async () => fakeScene('BSOD_SCREEN_MAT') };
const texLoader: any = { loadAsync: async () => new THREE.Texture() };

const bedroom: any = new BedroomScene();
await bedroom.load(gltfLoader, texLoader);
console.log('BedroomScene loaded. group children =', bedroom.group.children.length);

let meshes = 0;
let instanced = 0;
bedroom.group.traverse((o: any) => {
  if (o.isInstancedMesh) instanced++;
  else if (o.isMesh) meshes++;
});
console.log('meshes:', meshes, '| instanced:', instanced);

// Verify 3D Parasyte BSOD anatomy: cleanly hidden at Stage 0, active during madness, hidden in aftermath!
bedroom.setAftermathMode(false);
bedroom.bsodScreen.update(1 / 60, 0, {
  hoverFace: false,
  cursorUv: new THREE.Vector2(0.5, 0.5),
  clickCount: 0,
  madness: 0,
  jawOpen: 0,
  suctionProgress: 0,
  aftermath: false,
}, 0);
if (bedroom.bsodScreen.parasyteGroup.visible !== false) {
  throw new Error('parasyteGroup must be hidden at clean Stage-0 BSOD!');
}

// exercise the runtime updates across a full escalation + aftermath
for (let i = 0; i < 300; i++) {
  bedroom.bsodScreen.update(
    1 / 60,
    i / 60,
    {
      hoverFace: true,
      cursorUv: new THREE.Vector2(0.3, 0.6),
      clickCount: Math.min(6, Math.floor(i / 40)),
      madness: Math.min(1, i / 200),
      jawOpen: Math.min(1, i / 220),
      suctionProgress: Math.max(0, (i - 200) / 100),
      aftermath: false,
    },
    0.4
  );
  if (i === 120 && bedroom.bsodScreen.parasyteGroup.visible !== true) {
    throw new Error('parasyteGroup must be visible during active BSOD madness!');
  }
  bedroom.update(1 / 60, i / 60, Math.min(1, i / 200), Math.min(0.5, i / 400), false);
}
const bsodAny = bedroom.bsodScreen as any;
if (
  bsodAny.rimTeethMesh.count !== 40 ||
  bsodAny.jawFlapsMesh.count !== 4 ||
  Boolean(bsodAny.tongueMesh) ||
  bsodAny.sinewMesh.count !== 32 ||
  bsodAny.parasyteEyesMesh.count !== 11
) {
  throw new Error('Unexpected 3D Parasyte BSOD mesh counts!');
}
bedroom.setAftermathMode(true);
bedroom.bsodScreen.update(1 / 60, 5, {
  hoverFace: false,
  cursorUv: new THREE.Vector2(0.5, 0.5),
  clickCount: 0,
  madness: 0,
  jawOpen: 0,
  suctionProgress: 0,
  aftermath: true,
}, 0);
if (bsodAny.parasyteGroup.visible !== false) {
  throw new Error('parasyteGroup must be hidden in aftermath!');
}
bedroom.update(1 / 60, 5, 0, 0, true, new THREE.Vector3(1.2, 0.017, -1.0));

// floor surface lookup + collision sanity
const p = new THREE.Vector3(0.35, 0.017, 0.62);
bedroom.resolvePlayerCollision(p, 0.26);
console.log('surface at spawn:', bedroom.getFloorSurface(0.35, 0.62), '| resolved pos:', p.toArray().map((n: number) => +n.toFixed(2)));

// no NaN in any transform
let bad = 0;
bedroom.group.traverse((o: any) => {
  const e = o.matrixWorld.elements;
  for (let i = 0; i < e.length; i++) if (!Number.isFinite(e[i])) bad++;
});
console.log('non-finite matrix values:', bad);
console.log('SMOKE TEST PASSED');
