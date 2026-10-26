import type * as THREE from 'three';
import type { Fx } from './core/fx';
import type { AudioEngine } from './core/audio';
import type { Player } from './core/physics';
import type { Room } from './scenes/room';
import type { World } from './scenes/world';
import type { UI, Settings } from './ui/ui';

export type Phase = 'boot' | 'room' | 'zoom' | 'bsod' | 'absorb' | 'world' | 'collapse' | 'fall' | 'epilogue';

export type Interactable = {
  id: string;
  label: string;
  position: THREE.Vector3;
  radius: number;
  enabled: () => boolean;
  use: () => void;
};

export interface GameHost {
  camera: THREE.PerspectiveCamera;
  fx: Fx;
  audio: AudioEngine;
  ui: UI;
  player: Player;
  room: Room;
  world: World;
  settings: Settings;
  phase: Phase;
  beginCinematic: () => void;
  endCinematic: (phase: Phase) => void;
  showRoom: () => void;
  showWorld: () => void;
  setPhase: (p: Phase) => void;
  setGlitch: (geom: number, post: number) => void;
  restart: () => void;
}
