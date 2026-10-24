// Shared helpers for the headless test suite.
//
// The suite runs under node with a jsdom + @napi-rs/canvas DOM shim. There is
// no WebGL context: geometry, materials, physics, layout and GLSL *source*
// validation are covered, GPU compilation and pixels are not.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { installDom } from './dom-shim.ts';
import { Physics } from '../src/core/physics.ts';

/** Install the DOM shim once; safe to call from every test file. */
export function bootDom() {
  if ((globalThis as any).__bsodDomReady) return;
  installDom();
  (globalThis as any).__bsodDomReady = true;
}

export interface ManifestModel {
  name: string;
  file: string;
  bytes: number;
  tris: number;
  lod: boolean;
  licence: string;
  author: string;
  bounds?: { size: [number, number, number] };
  error?: string;
}

export interface Manifest {
  generated: string;
  models: ManifestModel[];
  hdr: { name: string; file: string; bytes: number; licence: string; author: string }[];
}

export const ROOT = process.cwd();

export function readManifest(): Manifest {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/asset-manifest.json'), 'utf8'));
}

export function readCredits() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/credits.json'), 'utf8'));
}

/**
 * Stand-in for the real `AssetLoader`: it exposes the same surface the scene
 * builders use but hands out placeholder meshes, so level construction can be
 * exercised without decoding glTF (and without a GPU).
 */
export class FakeAssets {
  models = new Map<string, THREE.Group>();
  lods = new Map<string, THREE.Group>();
  constructor(manifest: Manifest) {
    for (const m of manifest.models) {
      if (m.error) continue;
      const g = new THREE.Group();
      g.name = m.name;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial()));
      if (m.lod) this.lods.set(m.name, g);
      else this.models.set(m.name, g);
    }
  }
  has(n: string) { return this.models.has(n); }
  clone(n: string) { return this.models.get(n)!.clone(true); }
  lodTwin(n: string) { return this.lods.get(n) ?? null; }
  env() { return null; }
}

export async function makePhysics() {
  const physics = new Physics();
  await physics.init();
  return physics;
}
