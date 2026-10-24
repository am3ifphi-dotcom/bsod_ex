// Rapier wrapper: static level colliders + kinematic character controller +
// dynamic debris used by the collapse sequence.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export interface CharacterMoveResult {
  moved: THREE.Vector3;
  grounded: boolean;
}

export class Physics {
  world!: RAPIER.World;
  private ready = false;
  private accum = 0;
  readonly fixedDt = 1 / 60;
  charController: RAPIER.KinematicCharacterController | null = null;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -20.5, z: 0 });
    this.world.integrationParameters.dt = this.fixedDt;
    // a couple of extra solver iterations keeps stacked debris stable
    this.world.numSolverIterations = 6;
    this.ready = true;
  }

  get isReady() { return this.ready; }

  /** Build (once) the character controller shared by the player. */
  ensureCharacter() {
    if (!this.charController) {
      const cc = this.world.createCharacterController(0.02);
      cc.enableAutostep(0.55, 0.2, true);
      cc.enableSnapToGround(0.45);
      cc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
      cc.setMinSlopeSlideAngle((38 * Math.PI) / 180);
      cc.setApplyImpulsesToDynamicBodies(true);
      cc.setCharacterMass(82);
      cc.setSlideEnabled(true);
      this.charController = cc;
    }
    return this.charController;
  }

  step(dt: number) {
    if (!this.ready) return;
    this.accum += Math.min(dt, 0.25);
    let steps = 0;
    while (this.accum >= this.fixedDt && steps < 4) {
      this.world.step();
      this.accum -= this.fixedDt;
      steps++;
    }
  }

  resetAccumulator() { this.accum = 0; }

  // ------------------------------------------------------------- statics
  addBoxStatic(center: THREE.Vector3, half: THREE.Vector3, quat?: THREE.Quaternion) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(center.x, center.y, center.z)
        .setRotation(quat ? { x: quat.x, y: quat.y, z: quat.z, w: quat.w } : { x: 0, y: 0, z: 0, w: 1 }),
    );
    const col = RAPIER.ColliderDesc.cuboid(Math.max(half.x, 0.01), Math.max(half.y, 0.01), Math.max(half.z, 0.01))
      .setFriction(0.9)
      .setRestitution(0.02);
    this.world.createCollider(col, body);
    return body;
  }

  /** Trimesh collider from a THREE geometry (already transformed into world space). */
  addTrimeshStatic(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
    const g = geometry.index ? geometry : geometry;
    const pos = g.getAttribute('position');
    const verts = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (matrix) v.applyMatrix4(matrix);
      verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z;
    }
    let idx: Uint32Array;
    if (g.index) {
      idx = new Uint32Array(g.index.count);
      for (let i = 0; i < g.index.count; i++) idx[i] = g.index.getX(i);
    } else {
      idx = new Uint32Array(pos.count);
      for (let i = 0; i < pos.count; i++) idx[i] = i;
    }
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.95).setRestitution(0.0);
    this.world.createCollider(col, body);
    return body;
  }

  // ------------------------------------------------------------- dynamic
  addDynamicBox(pos: THREE.Vector3, half: THREE.Vector3, opts: { mass?: number; ccd?: boolean } = {}) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(opts.ccd ?? false),
    );
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setDensity(1.1)
      .setFriction(0.7)
      .setRestitution(0.18);
    this.world.createCollider(col, body);
    return body;
  }

  addDynamicConvex(pos: THREE.Vector3, points: Float32Array, opts: { ccd?: boolean } = {}) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(opts.ccd ?? false),
    );
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (desc) this.world.createCollider(desc.setDensity(0.8).setFriction(0.8).setRestitution(0.12), body);
    else this.world.createCollider(RAPIER.ColliderDesc.ball(0.3), body);
    return body;
  }

  removeBody(body: RAPIER.RigidBody) {
    if (!this.ready) return;
    this.world.removeRigidBody(body);
  }

  clearDynamics() {
    // used when restarting: drop everything that was spawned by sequences
    if (!this.ready) return;
    const doomed: RAPIER.RigidBody[] = [];
    this.world.forEachRigidBody((b) => {
      if (b.bodyType() === RAPIER.RigidBodyType.Dynamic) doomed.push(b);
    });
    doomed.forEach((b) => this.world.removeRigidBody(b));
  }
}
