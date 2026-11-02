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
  g.add(new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ name: 'Walls', color: 0x555555 })
  ));
  g.add(new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ name: 'Floor', color: 0x444444 })
  ));
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

const bsod: any = bedroom.bsodScreen;
bedroom.setAftermathMode(false);
bsod.update(1 / 60, 0, {
  hoverFace: false,
  cursorUv: new THREE.Vector2(0.5, 0.5),
  clickCount: 0,
  madness: 0,
  jawOpen: 0,
  suctionProgress: 0,
  aftermath: false,
}, 0);
if (bsod.parasyteGroup.visible || bsod.throatTeeth.visible || bsod.throatGroup.visible) {
  throw new Error('Stage 0 must be a perfectly still, undecorated stop screen.');
}

// Drive a full timeline: six near-identical stages -> transfer -> aftermath.
const camFwd = new THREE.Vector3(-0.9, -0.1, -0.4).normalize();
let scrollPhase = 0;
for (let i = 0; i < 360; i++) {
  scrollPhase += (1 / 60) * 18.0;
  const stage = Math.min(5, Math.floor(i / 55));
  const suction = Math.max(0, (i - 290) / 70);
  bsod.update(
    1 / 60,
    i / 60,
    {
      hoverFace: true,
      cursorUv: new THREE.Vector2(0.144, 0.742),
      clickCount: stage,
      madness: stage / 12,
      jawOpen: stage >= 5 ? 1 : 0,
      suctionProgress: suction,
      aftermath: false,
    },
    0.2,
    scrollPhase
  );
  if (bsod.parasyteGroup.visible || bsod.throatTeeth.visible) {
    throw new Error('Anatomical meshes must never be displayed.');
  }
  if (suction < 0.02 && bsod.throatGroup.visible) {
    throw new Error('The page conduit must not open during inspection.');
  }
  if (suction > 0.1 && !bsod.throatGroup.visible) {
    throw new Error('The page conduit must open during the transfer.');
  }
  // The room no longer peels apart into a vortex of shards, at any intensity.
  bedroom.update(1 / 60, i / 60, Math.min(1, i / 260), 0.3, false, new THREE.Vector3(0.35, 0.017, 0.62), camFwd);
  if (bedroom.peelShards.visible) {
    throw new Error('Walls must stay intact — the room is a display surface, not torn wallpaper.');
  }
}

// Bedroom detail systems still intact.
for (const key of ['rainGlassMat', 'skylightRainMat', 'rainStreakMat', 'rainSplashMat', 'floorCausticMat', 'lenticularMat', 'mirrorAnomalyMat']) {
  if (!bedroom[key]) throw new Error(`Missing bedroom detail material: ${key}`);
}
if (bedroom.getFloorHeight(0.35, 0.62, 0.017) > 0.05) {
  throw new Error('Unexpected spawn floor height in bedroom!');
}
if (bedroom.getFloorHeight(-0.45, -1.35, 0.60) < 0.50) {
  throw new Error('Bed platform should be jumpable when player is airborne above bed height!');
}

bedroom.setAftermathMode(true);
bsod.update(1 / 60, 6, {
  hoverFace: false,
  cursorUv: new THREE.Vector2(0.5, 0.5),
  clickCount: 0,
  madness: 0,
  jawOpen: 0,
  suctionProgress: 0,
  aftermath: true,
}, 0);
if (bsod.parasyteGroup.visible || bsod.throatGroup.visible || bsod.throatTeeth.visible) {
  throw new Error('The aftermath panel must be dark and still.');
}
bedroom.update(1 / 60, 6, 0, 0, true, new THREE.Vector3(1.2, 0.017, -1.0));

const p = new THREE.Vector3(0.35, 0.017, 0.62);
bedroom.resolvePlayerCollision(p, 0.26);
console.log('surface at spawn:', bedroom.getFloorSurface(0.35, 0.62), '| resolved pos:', p.toArray().map((n: number) => +n.toFixed(2)));

let bad = 0;
bedroom.group.traverse((o: any) => {
  const e = o.matrixWorld.elements;
  for (let i = 0; i < e.length; i++) if (!Number.isFinite(e[i])) bad++;
});
if (bad > 0) throw new Error(`${bad} non-finite matrix values in bedroom.`);
console.log('BEDROOM SMOKE TEST PASSED — still screen, intact room, no anatomy.');
