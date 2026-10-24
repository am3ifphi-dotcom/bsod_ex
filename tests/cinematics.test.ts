import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Cinematics, type CinematicContext } from '../src/game/Cinematics';
import { Player } from '../src/core/Player';
import { TUNNEL_POINTS } from '../src/world/Tunnel';
import type { FxState } from '../src/core/Renderer';

const DT = 1 / 60;

function makeRig() {
  const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.075, 1400);
  camera.rotation.order = 'YXZ';
  const player = new Player();
  player.reset(0.55, 0, 1.35, 0, 0);
  const roomGroup = new THREE.Group();
  const monitor = new THREE.Object3D();
  monitor.position.set(-0.42, 1.2, -1.98);
  const suction: THREE.Object3D[] = [];
  for (let i = 0; i < 10; i++) {
    const o = new THREE.Object3D();
    o.position.set(i * 0.1, 0.2, 0);
    suction.push(o);
  }
  const room = {
    monitor,
    screen: new THREE.Mesh(),
    suctionProps: suction,
    setAnomaly: () => {},
    setScreenMode: () => {},
    setLamp: () => {},
    update: () => {},
    group: roomGroup,
  } as unknown as CinematicContext['room'];

  const points = TUNNEL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const tan = curve.getTangentAt(1).normalize();
  const exitPose = { yaw: Math.atan2(-tan.x, -tan.z), pitch: Math.asin(tan.y) };
  const tunnel = {
    group: new THREE.Group(),
    curve,
    exitPose,
    setActive: vi.fn(),
    setProgress: vi.fn(),
    update: vi.fn(),
  } as unknown as CinematicContext['tunnel'];

  const fx: Partial<FxState>[] = [];
  const renderer = {
    setFx: (p: Partial<FxState>) => { fx.push(p); },
    camera,
  } as unknown as CinematicContext['renderer'];

  const audio = new Proxy({}, { get: () => () => () => {} }) as unknown as CinematicContext['audio'];

  const ctx: CinematicContext = {
    camera, player, audio, renderer, room, roomGroup, tunnel,
    cameraMotion: () => 1,
  };
  return { ctx, camera, player, roomGroup, tunnel, fx, curve };
}

/** Drive a running shot for `seconds`, recording the camera position every frame. */
function record(cin: Cinematics, camera: THREE.PerspectiveCamera, seconds: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const n = Math.ceil(seconds / DT) + 2;
  for (let i = 0; i < n; i++) {
    cin.update(DT, i * DT);
    out.push(camera.position.clone());
  }
  return out;
}

const last = (a: THREE.Vector3[]): THREE.Vector3 => a[a.length - 1];

describe('cinematics continuity', () => {
  it('the zoom to the monitor ends close to the screen and never fades', async () => {
    const { ctx, camera, fx } = makeRig();
    const cin = new Cinematics(ctx);
    const done = cin.playZoomToMonitor();
    const path = record(cin, camera, 2.7);
    await done;
    expect(last(path).distanceTo(new THREE.Vector3(-0.42, 1.2, -1.98))).toBeLessThan(0.9);
    for (const p of fx) expect(p.fade ?? 0).toBe(0);
  });

  it('swallow -> tunnel hands the camera over without a jump', async () => {
    const { ctx, camera, roomGroup, tunnel, fx } = makeRig();
    const cin = new Cinematics(ctx);
    const swallow = cin.playSwallow();
    const swallowPath = record(cin, camera, 6.6);
    await swallow;
    expect(roomGroup.visible).toBe(false);
    expect(tunnel.setActive).toHaveBeenCalledWith(true);

    const tunnelShot = cin.playTunnel();
    const tunnelPath = record(cin, camera, 21);
    await tunnelShot;

    const handoff = last(swallowPath).distanceTo(tunnelPath[0]);
    expect(handoff).toBeLessThan(0.6);

    // no cut, no fade during the whole transition
    for (const p of fx) expect(p.fade ?? 0).toBeLessThanOrEqual(0.0001);

    // per-frame movement is smooth for a fast rollercoaster (no teleports)
    for (let i = 1; i < tunnelPath.length; i++) {
      expect(tunnelPath[i].distanceTo(tunnelPath[i - 1])).toBeLessThan(1.2);
    }
  });

  it('the tunnel ends exactly at the arrival eye position', async () => {
    const { ctx, camera, player } = makeRig();
    const cin = new Cinematics(ctx);
    const shot = cin.playTunnel();
    record(cin, camera, 21);
    await shot;
    player.reset(0, 120, 98, 0, 0);
    const eye = player.eyePosition;
    expect(camera.position.distanceTo(eye)).toBeLessThan(0.02);
  });

  it('collapse falls into the bedroom and the landing continues without a jump', async () => {
    const { ctx, camera, player } = makeRig();
    const cin = new Cinematics(ctx);
    const start = new THREE.Vector3(0, 121.62, 40);
    let approached = false;
    const collapse = cin.playCollapse(start, 0, 0, { x: 0.18, z: 0.16 }, () => { approached = true; });
    const fallPath = record(cin, camera, 17.3);
    await collapse;
    expect(approached).toBe(true);
    const endPos = last(fallPath);
    expect(endPos.y).toBeLessThan(2.7);
    expect(endPos.distanceTo(new THREE.Vector3(0.18, endPos.y, 0.16))).toBeLessThan(0.6);

    const landing = cin.playLanding({ x: 0.18, z: 0.16 });
    const landingPath = record(cin, camera, 3.7);
    await landing;
    expect(landingPath[0].distanceTo(endPos)).toBeLessThan(0.25);
    expect(last(landingPath).y).toBeCloseTo(1.62, 1);
    expect(last(landingPath).x).toBeCloseTo(0.18, 2);
    expect(player.position.y).toBeCloseTo(0, 2);
    expect(player.controlEnabled).toBe(true);
  });

  it('feeds back the designed values to the renderer (glitch, DOF, no invert abuse)', async () => {
    const { ctx, camera, fx } = makeRig();
    const cin = new Cinematics(ctx);
    const shot = cin.playSwallow();
    record(cin, camera, 6.7);
    await shot;
    const maxGlitch = Math.max(...fx.map((p) => p.glitch ?? 0));
    const maxChroma = Math.max(...fx.map((p) => p.chroma ?? 0));
    expect(maxGlitch).toBeGreaterThan(0.3);
    expect(maxChroma).toBeGreaterThan(0.5);
    const maxInvert = Math.max(...fx.map((p) => p.invert ?? 0));
    expect(maxInvert).toBeLessThanOrEqual(0.1);
  });
});
