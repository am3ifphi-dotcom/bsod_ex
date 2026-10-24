// The "lean in and look at the PC" camera cue.
//
// When the player examines the PC the camera does not simply slide up to the
// screen: the first thing you look at is your own hands on the keyboard, then
// the gaze lifts to the monitor. Kept as pure math so it can be tested without
// a renderer (see tests/approach.test.ts).
import * as THREE from 'three';

/** Total length of the lean-in move, in seconds. */
export const APPROACH_DURATION = 3.2;
/** Window in which the gaze travels from the keyboard up to the screen. */
export const GAZE_LIFT: [number, number] = [0.85, 2.15];

/** yaw/pitch of `to` seen from `from`. yaw 0 looks down -Z, matching Player. */
export function lookAngles(from: THREE.Vector3, to: THREE.Vector3) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}

/** Interpolate two angles the short way round, so the head never spins. */
export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface Gaze {
  yaw: number;
  pitch: number;
  /** 0 = looking at the keyboard, 1 = looking at the screen */
  lift: number;
  /** distance to whatever the gaze is on, for depth of field */
  focus: number;
}

/**
 * Where the camera should look at time `t` of the approach, from position `pos`.
 * Starts on the keyboard (hands / keys), lifts to the screen over GAZE_LIFT.
 */
export function approachGaze(
  pos: THREE.Vector3, screen: THREE.Vector3, keyboard: THREE.Vector3, t: number,
): Gaze {
  const lift = smoothstep(GAZE_LIFT[0], GAZE_LIFT[1], t);
  const kb = lookAngles(pos, keyboard);
  const sc = lookAngles(pos, screen);
  return {
    yaw: lerpAngle(kb.yaw, sc.yaw, lift),
    pitch: kb.pitch + (sc.pitch - kb.pitch) * lift,
    lift,
    focus: pos.distanceTo(keyboard) + (pos.distanceTo(screen) - pos.distanceTo(keyboard)) * lift,
  };
}
