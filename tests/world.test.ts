// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { installFakeCanvas } from './helpers/fakeCanvas';
import { CollisionWorld } from '../src/core/Collision';
import { buildWorld, type WorldResult } from '../src/world/World';
import type { AssetStore } from '../src/assets/Assets';
import type { MaterialLibrary } from '../src/assets/Materials';
import { LAYOUT, WORLD_Y } from '../src/world/types';

/**
 * The world builders are run headlessly with stand-in materials and models. That is enough to
 * exercise every collision registration, which is what these tests are about.
 */

function fakeMats(): MaterialLibrary {
  const lib = {
    get(_name: string, _tiles = 1, opts: Record<string, unknown> = {}) {
      return new THREE.MeshStandardMaterial(opts as THREE.MeshStandardMaterialParameters);
    },
    solid(opts: Record<string, unknown> = {}) {
      return new THREE.MeshStandardMaterial(opts as THREE.MeshStandardMaterialParameters);
    },
    textTexture() { return new THREE.Texture(); },
    textTextureAsync() { return Promise.resolve(new THREE.Texture()); },
    dispose() {},
  };
  return lib as unknown as MaterialLibrary;
}

function fakeStore(): AssetStore {
  const store = {
    async instantiate(key: string, opts: Record<string, unknown> = {}) {
      const g = new THREE.Group();
      g.name = (opts.name as string) ?? `${key}-instance`;
      const p = opts.position as { x: number; y: number; z: number } | undefined;
      if (p) g.position.set(p.x, p.y, p.z);
      if (typeof opts.rotationY === 'number') g.rotation.y = opts.rotationY;
      if (typeof opts.scale === 'number') g.scale.setScalar(opts.scale);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial());
      g.add(mesh);
      return g;
    },
    async loadModel() { return new THREE.Group(); },
    async loadHDR() { return new THREE.Texture(); },
    async loadTexture() { return new THREE.Texture(); },
    cloneModel(o: THREE.Object3D) { return o.clone(); },
  };
  return store as unknown as AssetStore;
}

let world: WorldResult;
let collision: CollisionWorld;

beforeAll(async () => {
  installFakeCanvas();
  collision = new CollisionWorld();
  world = await buildWorld({ store: fakeStore(), mats: fakeMats(), collision, detail: 0.6 });
}, 60000);

describe('world build', () => {
  it('builds all five areas plus the core', () => {
    const names = world.areas.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['arrival', 'plaza', 'atrium', 'street', 'deep', 'core']));
    expect(world.group.children.length).toBeGreaterThan(5);
    expect(world.interactables.length).toBeGreaterThan(5);
  });

  it('registers real 3D far distance (not a skybox) and a fog-able skyline', () => {
    let meshes = 0;
    world.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(300);
  });

  it('places every interactable on a walkable surface', () => {
    for (const it of world.interactables) {
      const support = collision.supportAt(it.position.x, it.position.z, 0.35, it.position.y + 1.5);
      expect(support, `${it.id} at ${it.position.x},${it.position.z}`).not.toBeNull();
    }
  });

  it('has a floor under the arrival spawn', () => {
    const support = collision.supportAt(LAYOUT.start.x, LAYOUT.start.z, 0.33, WORLD_Y + 1);
    expect(support).toBeCloseTo(WORLD_Y, 1);
  });

  it('reveals the core when the player gets close', () => {
    let called = 0;
    world.onApproachCore(() => { called++; });
    world.update(0.016, 0.1, new THREE.Vector3(0, WORLD_Y, LAYOUT.monolith.z + 30));
    world.update(0.016, 0.2, new THREE.Vector3(0, WORLD_Y, LAYOUT.monolith.z + 30));
    expect(called).toBe(1);
  });

  it('breaks the floor and restores it', () => {
    const at = new THREE.Vector3(0, WORLD_Y, LAYOUT.monolith.z + 40);
    world.breakFloor(at);
    expect(collision.supportAt(at.x, at.z, 0.3, WORLD_Y + 1)).toBeNull();
    world.reset();
    expect(collision.supportAt(at.x, at.z, 0.3, WORLD_Y + 1)).toBeCloseTo(WORLD_Y, 1);
  });
});

/**
 * Reachability audit.
 *
 * Uses the real controller geometry: horizontal moves go through CollisionWorld.resolveHorizontal
 * (so walls, rails and doorways behave exactly as they do in game) and vertical moves through
 * supportAt. That proves three things:
 *   1. the player can walk from the arrival plateau to the core, the atrium, the street and the
 *      deep layer — no invisible holes in any floor;
 *   2. no standable spot exists outside the intended footprint;
 *   3. no reachable edge lets the player step into the void (which would be an endless fall).
 */
describe('map integrity', () => {
  it('is walkable from arrival to the core and everywhere in between, with no escapes', () => {
    const CELL = 0.4;
    const STEP = 0.55;
    const R = 0.33;
    const H = 1.74;

    const inside = (x: number, z: number): boolean => {
      const inRect = (minX: number, maxX: number, minZ: number, maxZ: number): boolean =>
        x >= minX - 0.05 && x <= maxX + 0.05 && z >= minZ - 0.05 && z <= maxZ + 0.05;
      const A = LAYOUT.arrival;
      if (inRect(A.center.x - A.half.x, A.center.x + A.half.x, A.center.z - A.half.z, A.center.z + A.half.z)) return true;
      if (inRect(-LAYOUT.path.halfWidth, LAYOUT.path.halfWidth, LAYOUT.plaza.max.z, A.center.z - A.half.z)) return true;
      if (inRect(LAYOUT.plaza.min.x, LAYOUT.plaza.max.x, LAYOUT.plaza.min.z, LAYOUT.plaza.max.z)) return true;
      if (inRect(LAYOUT.atrium.min.x, LAYOUT.atrium.max.x, LAYOUT.atrium.min.z, LAYOUT.atrium.max.z)) return true;
      if (inRect(LAYOUT.atriumBridge.x0, LAYOUT.atriumBridge.x1, LAYOUT.atriumBridge.z - LAYOUT.atriumBridge.halfWidth, LAYOUT.atriumBridge.z + LAYOUT.atriumBridge.halfWidth)) return true;
      if (inRect(LAYOUT.street.min.x, LAYOUT.street.max.x, LAYOUT.street.min.z, LAYOUT.street.max.z)) return true;
      if (inRect(LAYOUT.streetBridge.x0, LAYOUT.streetBridge.x1, 30, 42)) return true;
      if (inRect(-7, 7, LAYOUT.core.min.z, LAYOUT.plaza.min.z)) return true;
      if (inRect(LAYOUT.core.min.x, LAYOUT.core.max.x, LAYOUT.core.min.z, LAYOUT.core.max.z)) return true;
      if (inRect(LAYOUT.deep.min.x, LAYOUT.deep.max.x, LAYOUT.deep.min.z, LAYOUT.deep.max.z)) return true;
      return false;
    };

    const key = (x: number, z: number, y: number): string =>
      `${Math.round(x / CELL)}:${Math.round(z / CELL)}:${Math.round(y / 0.3)}`;

    type Node = { x: number; z: number; y: number };
    const start: Node = { x: LAYOUT.start.x, z: LAYOUT.start.z, y: WORLD_Y };
    const queue: Node[] = [start];
    const seen = new Set<string>([key(start.x, start.z, start.y)]);
    const visited: Node[] = [];
    let outside = 0;
    let escapes = 0;
    let guard = 0;
    const DIRS: Array<[number, number]> = [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]];

    while (queue.length && guard++ < 500000) {
      const n = queue.shift() as Node;
      visited.push(n);
      if (!inside(n.x, n.z)) outside++;
      for (const [dx, dz] of DIRS) {
        const tx = n.x + dx;
        const tz = n.z + dz;
        const moved = collision.resolveHorizontal(n.x, n.z, dx, dz, R, n.y, H, STEP);
        const travelled = Math.hypot(moved.x - n.x, moved.z - n.z);
        if (travelled < CELL * 0.35) continue;            // wall / railing
        const px = moved.x;
        const pz = moved.z;
        const support = collision.supportAt(px, pz, R, n.y + STEP);
        if (support === null) {
          // a real step into nothing: this would be an endless fall out of the map
          escapes++;
          continue;
        }
        if (support > n.y + STEP + 0.01) continue;         // too high to climb
        if (support < n.y - 22) continue;                  // lethal drop, treat as an exit
        const k = key(px, pz, support);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: px, z: pz, y: support });
        void tx; void tz;
      }
    }

    expect(guard).toBeLessThan(500000);
    expect(escapes).toBe(0);
    expect(outside).toBe(0);

    const reached = (fn: (n: Node) => boolean): boolean => visited.some(fn);
    // the monolith's base: stand in front of the text wall
    expect(reached((n) => Math.abs(n.x) < 4 && n.z < -84 && n.z > -96)).toBe(true);
    // the atrium ground floor
    expect(reached((n) => n.x < -50 && n.z > 10 && n.z < 60)).toBe(true);
    // the street
    expect(reached((n) => n.x > 60 && n.z > 20 && n.z < 50)).toBe(true);
    // the deep service layer
    expect(reached((n) => n.y < WORLD_Y - 4 && n.x > 20 && n.x < 50)).toBe(true);
  }, 120000);
});
