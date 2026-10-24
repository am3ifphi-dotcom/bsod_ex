import type * as THREE from 'three';
import type { CollisionWorld } from '../core/Collision';
import type { AssetStore } from '../assets/Assets';
import type { MaterialLibrary } from '../assets/Materials';

export interface AreaContext {
  collision: CollisionWorld;
  mats: MaterialLibrary;
  store: AssetStore;
  baseY: number;
  /** quality-scaled detail multiplier: 1 = high, 0.6 = low */
  detail: number;
}

export interface Interactable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: boolean;
  onInteract?: () => void;
  /** describe() is shown as a subtitle when interacting; consoles use it instead */
  message?: string;
}

export interface Area {
  name: string;
  group: THREE.Group;
  bounds: { min: THREE.Vector3; max: THREE.Vector3 };
  update?(dt: number, time: number, playerPos: THREE.Vector3): void;
  lights: THREE.Light[];
  interactables: Interactable[];
  emitters?: { kind: 'lamp' | 'monolith' | 'portal' | 'terminal'; position: THREE.Vector3 }[];
  /** Called when the player gets close, for streaming: heavy detail on/off */
  setDetailed?(detailed: boolean): void;
}

/** World coordinate helpers — the whole glitch world floats far above the bedroom. */
export const WORLD_Y = 120;

export const LAYOUT = {
  arrival: { center: { x: 0, z: 90 }, half: { x: 25, z: 20 } },
  path: { z0: 56, z1: 70, halfWidth: 7 },
  plaza: { min: { x: -26, z: 16 }, max: { x: 26, z: 56 } },
  atrium: { min: { x: -104, z: 6 }, max: { x: -40, z: 66 } },
  atriumBridge: { x0: -40, x1: -26, z: 36, halfWidth: 6 },
  street: { min: { x: 44, z: 8 }, max: { x: 120, z: 64 } },
  streetBridge: { x0: 26, x1: 44, z: 36, halfWidth: 6 },
  deep: { min: { x: 6, z: 22 }, max: { x: 62, z: 52 }, floorY: WORLD_Y - 6, ceilY: WORLD_Y - 2 },
  coreBridge: { z0: -60, z1: 16, halfWidth: 7 },
  core: { min: { x: -44, z: -132 }, max: { x: 44, z: -60 } },
  monolith: { x: 0, z: -100, width: 26, depth: 20, height: 92 },
  start: { x: 0, z: 98 },
} as const;
