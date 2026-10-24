import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/core/Collision';
import { Player } from '../src/core/Player';

/** Drive a player for `seconds` at a fixed timestep with a constant wish direction. */
function drive(
  player: Player,
  world: CollisionWorld,
  opts: { x?: number; y?: number; sprint?: boolean; seconds: number },
): void {
  const step = 1 / 60;
  const n = Math.round(opts.seconds / step);
  for (let i = 0; i < n; i++) {
    player.update(step, { x: opts.x ?? 0, y: opts.y ?? 0, sprint: opts.sprint ?? false }, world, 1);
  }
}

function roomWorld(): CollisionWorld {
  const w = new CollisionWorld();
  w.add({ min: [-10, -0.5, -10], max: [10, 0, 10], tag: 'floor' });
  // four walls, 3 m tall
  w.add({ min: [-10, 0, -10], max: [10, 3, -9.7], tag: 'wall' });
  w.add({ min: [-10, 0, 9.7], max: [10, 3, 10], tag: 'wall' });
  w.add({ min: [-10, 0, -10], max: [-9.7, 3, 10], tag: 'wall' });
  w.add({ min: [9.7, 0, -10], max: [10, 3, 10], tag: 'wall' });
  return w;
}

describe('collision', () => {
  it('keeps the player inside a closed room while dashing at a wall', () => {
    const world = roomWorld();
    const p = new Player();
    p.reset(0, 0, 0, 0, 0);
    drive(p, world, { y: 1, sprint: true, seconds: 4 });
    expect(p.position.z).toBeGreaterThan(-9.7 - 0.34);
    expect(p.position.z).toBeLessThan(-8.0);
    expect(p.position.y).toBeCloseTo(0, 3);

    drive(p, world, { y: -1, sprint: true, seconds: 4 });
    expect(p.position.z).toBeLessThan(9.7 + 0.34);
    expect(p.position.z).toBeGreaterThan(8.0);

    drive(p, world, { x: 1, sprint: true, seconds: 6 });
    expect(p.position.x).toBeLessThan(9.7 + 0.34);
  });

  it('cannot be pushed through a wall by a large instantaneous step', () => {
    const world = new CollisionWorld();
    world.add({ min: [-5, 0, -5], max: [5, 0, 5], tag: 'floor' });
    world.add({ min: [-5, 0, -5], max: [5, 4, -4.8], tag: 'wall' });
    const p = new Player();
    p.reset(0, 0, -4, 0, 0);
    // 6 m/s for 3 s straight into the wall
    drive(p, world, { y: 1, sprint: true, seconds: 3 });
    expect(p.position.z).toBeGreaterThan(-4.8 - 0.35);
  });

  it('walks up a 12 step staircase and stays on top', () => {
    const world = new CollisionWorld();
    world.add({ min: [-5, -0.5, -20], max: [5, 0, 5], tag: 'floor' });
    const steps = 12;
    const rise = 0.18;
    const run = 0.32;
    const top = -1 - steps * run;
    for (let i = 0; i < steps; i++) {
      const z0 = -1 - i * run;
      world.add({ min: [-4, 0, z0 - run], max: [4, rise * (i + 1), z0], tag: 'step' });
    }
    world.add({ min: [-4, 0, top - 6], max: [4, rise * steps, top], tag: 'landing' });
    const p = new Player();
    p.reset(0, 0, 2, 0, 0);
    drive(p, world, { y: 1, sprint: false, seconds: 3.2 });
    expect(p.position.y).toBeGreaterThan(rise * steps - 0.02);
    expect(p.position.z).toBeLessThan(top + 0.2);
    // and walking back down does not launch us into the air
    drive(p, world, { y: -1, sprint: false, seconds: 3 });
    expect(p.position.y).toBeLessThan(rise * steps);
    expect(p.position.y).toBeGreaterThanOrEqual(-0.01);
  });

  it('supports ramps as walkable slopes via their axis', () => {
    const world = new CollisionWorld();
    const slope = world.add({
      min: [-2, 0, -6], max: [2, 2, 0],
      ramp: { axis: 2, yLow: 0, yHigh: 2, walkable: true },
      tag: 'ramp',
    });
    expect(world.supportAt(0, -0.2, 0.3, 3)).toBeGreaterThan(0.5);
    expect(world.supportAt(0, -6.6, 0.3, 3)).toBeNull();
    slope.enabled = false;
    expect(world.supportAt(0, -0.2, 0.3, 3)).toBeNull();
  });

  it('opens the floor for the collapse and restores it on reset', () => {
    const world = roomWorld();
    const removed = world.disableFloorNear(0, 0, 0, 3);
    expect(removed).toBeGreaterThan(0);
    expect(world.supportAt(0, 0, 0.3, 1)).toBeNull();
    world.restoreAll();
    expect(world.supportAt(0, 0, 0.3, 1)).toBeCloseTo(0, 4);
  });

  it('blocks the ceiling', () => {
    const world = new CollisionWorld();
    world.add({ min: [-5, 0, -5], max: [5, 0, 5], tag: 'floor' });
    world.add({ min: [-5, 2, -5], max: [5, 2.2, 5], tag: 'ceiling' });
    const p = new Player();
    p.reset(0, 0, 0, 0, 0);
    p.velocity.y = 12;
    const step = 1 / 60;
    for (let i = 0; i < 120; i++) p.update(step, { x: 0, y: 0, sprint: false }, world, 1);
    expect(p.position.y).toBeLessThanOrEqual(2.2 - 1.74 + 0.02);
  });
});

describe('player', () => {
  it('dashes at roughly twice walking speed', () => {
    const world = roomWorld();
    const walk = new Player();
    walk.reset(0, 0, 0, 0, 0);
    drive(walk, world, { y: 1, sprint: false, seconds: 1.2 });
    const walkDist = Math.abs(walk.position.z);

    const dash = new Player();
    dash.reset(0, 0, 0, 0, 0);
    drive(dash, world, { y: 1, sprint: true, seconds: 1.2 });
    const dashDist = Math.abs(dash.position.z);

    expect(dashDist / walkDist).toBeGreaterThan(1.8);
    expect(dashDist / walkDist).toBeLessThan(2.2);
  });

  it('does not move while control is disabled', () => {
    const world = roomWorld();
    const p = new Player();
    p.reset(0, 0, 0, 0, 0);
    p.controlEnabled = false;
    drive(p, world, { y: 1, sprint: true, seconds: 2 });
    expect(Math.abs(p.position.z)).toBeLessThan(0.05);
  });

  it('clamps pitch and yaw safely', () => {
    const p = new Player();
    p.look(0, -100000, 3);
    expect(p.pitch).toBeGreaterThan(0);
    expect(p.pitch).toBeLessThanOrEqual(1.481);
    p.look(0, 100000, 1);
    expect(p.pitch).toBeGreaterThanOrEqual(-1.481);
  });
});
