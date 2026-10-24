// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { installFakeCanvas } from './helpers/fakeCanvas';
import { CollisionWorld } from '../src/core/Collision';
import { Room, ROOM } from '../src/world/Room';
import type { AssetStore } from '../src/assets/Assets';
import type { MaterialLibrary } from '../src/assets/Materials';

/**
 * The bedroom is built headlessly with stand-in materials and models. This is the only
 * execution coverage the room has (the sandbox has no WebGL), so it checks the things that
 * would throw at runtime: canvas painting, collision registration, and the return anomalies.
 */

function fakeMats(): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const lib = {
    get(name: string, tiles = 1, opts: Record<string, unknown> = {}) {
      const key = `${name}|${tiles}|${JSON.stringify(opts)}`;
      let m = cache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial(opts as THREE.MeshStandardMaterialParameters);
        cache.set(key, m);
      }
      return m;
    },
    solid(opts: Record<string, unknown> = {}) {
      return new THREE.MeshStandardMaterial(opts as THREE.MeshStandardMaterialParameters);
    },
    textTexture(_key: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 512) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      if (typeof draw === 'function') draw(ctx, size);
      return new THREE.CanvasTexture(c);
    },
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
    async loadTexture() { return new THREE.Texture(); },
    async loadHDR() { return new THREE.DataTexture(); },
  };
  return store as unknown as AssetStore;
}

let room: Room;
let collision: CollisionWorld;

beforeAll(async () => {
  installFakeCanvas();
  collision = new CollisionWorld();
  room = await Room.create(fakeStore(), fakeMats(), collision);
}, 60000);

describe('bedroom build', () => {
  it('builds the room, the monitor and the interactables', () => {
    const r = room.result;
    expect(r).toBeTruthy();
    expect(r.group.children.length).toBeGreaterThan(20);
    expect(r.monitor).toBeTruthy();
    expect(r.screen.material).toBeTruthy();
    expect(r.screenCanvas.width).toBe(1024);
    expect(r.screenCanvas.height).toBe(640);
    expect(r.lights.screenArea).toBeTruthy();
    expect(r.suctionProps.length).toBeGreaterThan(5);
  });

  it('seals the player inside the bedroom with real collision', () => {
    const snap = collision.getSolidSnapshot();
    const tags = new Set(snap.map((s) => s.tag));
    expect(tags.has('room-wall')).toBe(true);
    expect(tags.has('room-floor')).toBe(true);
    expect(tags.has('bed')).toBe(true);
    expect(tags.has('desk')).toBe(true);
    expect(tags.has('chair')).toBe(true);

    // the player spawn point is free, and the north wall cannot be walked through
    expect(collision.overlaps(ROOM.start.x, ROOM.start.y, ROOM.start.z, 0.33, 1.74)).toBe(false);
    const north = collision.resolveHorizontal(-0.42, -1.6, 0, -0.6, 0.33, 0, 1.74, 0.46);
    expect(north.z).toBeGreaterThan(-2.2);
  });

  it('draws every screen mode without throwing', () => {
    const modes = ['desktop', 'bsod', 'face', 'glitch', 'wake', 'off'] as const;
    for (const m of modes) expect(() => room.result.setScreenMode(m)).not.toThrow();
    expect(() => room.result.setScreenMode('desktop')).not.toThrow();
    expect(() => room.result.setAnomaly(1)).not.toThrow();
    expect(room.result.screenTexture).toBeTruthy();
  });

  it('keeps the return anomalies hidden until the player comes back', () => {
    const props = room.group.getObjectByName('room-anomalies');
    expect(props).toBeTruthy();
    expect(props!.visible).toBe(false);

    room.setReturnAnomaly(true);
    expect(props!.visible).toBe(true);
    const chair = room.group.getObjectByName('desk-chair');
    expect(chair).toBeTruthy();
    expect(chair!.rotation.y).toBeCloseTo(Math.PI + 0.12, 5);

    room.setReturnAnomaly(false);
    expect(props!.visible).toBe(false);
    expect(chair!.rotation.y).toBeCloseTo(Math.PI + 0.42, 5);
  });

  it('drives the clock and the lamp without throwing', () => {
    expect(() => {
      room.update(1 / 60, 0.5);
      room.update(1 / 60, 1.5);
      room.result.setLamp(false);
      room.result.setLamp(true);
    }).not.toThrow();
  });
});
