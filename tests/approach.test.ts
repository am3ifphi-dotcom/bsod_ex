// The lean-in cue: when the player examines the PC, the gaze has to land on the
// keyboard first (hands / keys) and then lift to the monitor. This suite
// replays the exact camera path and gaze curve the game uses, so "you never
// actually look at the keyboard" cannot regress.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  APPROACH_DURATION, GAZE_LIFT, approachGaze, lerpAngle, lookAngles,
} from '../src/game/approach.ts';

// room geometry (must match src/game/room.ts)
const SCREEN = new THREE.Vector3(0, 1.15, -1.524);
const KEYBOARD = new THREE.Vector3(0, 0.8, -1.16);
const FEET = new THREE.Vector3(0.35, 0.02, 1.25);   // room spawn
const EYE = 1.62;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** camera position at time t of the approach (same formula as Sequences) */
function pathPos(t: number) {
  const e = easeInOut(Math.min(1, Math.max(0, t / (APPROACH_DURATION - 0.4))));
  const from = new THREE.Vector3(FEET.x, FEET.y + EYE, FEET.z);
  const target = new THREE.Vector3(SCREEN.x + 0.02, SCREEN.y + 0.03, SCREEN.z + 0.62);
  const pos = from.clone().lerp(target, e);
  pos.y -= Math.sin(e * Math.PI) * 0.05;
  return pos;
}

const dirFromAngles = (yaw: number, pitch: number) => new THREE.Vector3(
  -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
);

/** angle between the gaze and a world point, in degrees */
function angleTo(pos: THREE.Vector3, yaw: number, pitch: number, target: THREE.Vector3) {
  const gaze = dirFromAngles(yaw, pitch);
  const to = target.clone().sub(pos).normalize();
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(gaze.dot(to), -1, 1)));
}

test('yaw 0 looks down -Z, like the player', () => {
  const a = lookAngles(new THREE.Vector3(0, 1.6, 1), new THREE.Vector3(0, 1.6, 0));
  assert.ok(Math.abs(a.yaw) < 1e-6, `expected yaw 0, got ${a.yaw}`);
  assert.ok(Math.abs(a.pitch) < 1e-6);
  const right = lookAngles(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(1, 1.6, 0));
  assert.ok(right.yaw < 0, 'a target to the right (east) must be a negative yaw');
});

test('angle interpolation takes the short way round', () => {
  const a = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(Math.abs(Math.abs(a) - Math.PI) < 0.02, `should pass through ±π, got ${a}`);
});

test('the gaze starts on the keyboard', () => {
  const pose = approachGaze(pathPos(0.2), SCREEN, KEYBOARD, 0.2);
  assert.equal(pose.lift, 0);
  const off = angleTo(pathPos(0.2), pose.yaw, pose.pitch, KEYBOARD);
  assert.ok(off < 1, `at t=0.2 the gaze should be locked on the keys, off by ${off.toFixed(1)}°`);
  // ...and the keyboard is what is in focus
  assert.ok(Math.abs(pose.focus - pathPos(0.2).distanceTo(KEYBOARD)) < 1e-6);
});

test('the gaze ends on the screen', () => {
  const pos = pathPos(APPROACH_DURATION);
  const pose = approachGaze(pos, SCREEN, KEYBOARD, APPROACH_DURATION);
  assert.equal(pose.lift, 1);
  const off = angleTo(pos, pose.yaw, pose.pitch, SCREEN);
  assert.ok(off < 1, `at the end the gaze should be on the screen, off by ${off.toFixed(1)}°`);
});

test('the keyboard is in frame for the first part of the lean', () => {
  const fov = 62;   // widest the approach uses; it only narrows after the lift
  let frames = 0;
  for (let t = 0.2; t < GAZE_LIFT[0]; t += 1 / 60) {
    const pos = pathPos(t);
    const { yaw, pitch } = approachGaze(pos, SCREEN, KEYBOARD, t);
    const off = angleTo(pos, yaw, pitch, KEYBOARD);
    assert.ok(off < fov / 2, `keys left the frame at t=${t.toFixed(2)} (${off.toFixed(1)}° off-axis)`);
    frames++;
  }
  assert.ok(frames > 30, 'the keyboard beat should last long enough to read');
});

test('the look never swings more than ~40° and never spins', () => {
  let prev = approachGaze(pathPos(0), SCREEN, KEYBOARD, 0);
  let maxStep = 0;
  for (let t = 1 / 60; t <= APPROACH_DURATION; t += 1 / 60) {
    const g = approachGaze(pathPos(t), SCREEN, KEYBOARD, t);
    maxStep = Math.max(maxStep, Math.abs(THREE.MathUtils.radToDeg(lerpAngle(prev.yaw, g.yaw, 1) - prev.yaw)));
    assert.ok(Math.abs(g.pitch) < 1.45, `pitch ${g.pitch} exceeded the player clamp`);
    prev = g;
  }
  assert.ok(maxStep < 3, `the gaze jumped ${maxStep.toFixed(1)}° in one frame`);
});

test('the camera stays in front of the monitor and inside the room', () => {
  for (let t = 0; t <= APPROACH_DURATION; t += 0.05) {
    const p = pathPos(t);
    assert.ok(p.z > SCREEN.z + 0.4, `camera clipped into the monitor at t=${t.toFixed(2)} (z=${p.z.toFixed(2)})`);
    assert.ok(p.z < 2.0 && Math.abs(p.x) < 2.0, `camera left the room at t=${t.toFixed(2)}`);
    assert.ok(p.y > 0.9 && p.y < 1.8, `camera height drifted to ${p.y.toFixed(2)} m`);
  }
});
