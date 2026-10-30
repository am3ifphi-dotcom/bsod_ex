import * as THREE from 'three';

export interface Spring1D {
  value: number;
  vel: number;
  target: number;
}

function stepSpring(s: Spring1D, stiffness: number, damping: number, dt: number): number {
  const steps = Math.max(1, Math.ceil(dt / 0.016));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const force = (s.target - s.value) * stiffness - s.vel * damping;
    s.vel += force * h;
    s.value += s.vel * h;
  }
  return s.value;
}

export class FirstPersonController {
  public readonly position = new THREE.Vector3(0.35, 0.017, 0.62);
  public readonly velocity = new THREE.Vector3();
  public yaw = 1.6264;
  public pitch = -0.25;
  public roll = 0;
  public eyeHeight = 1.61;
  public sensitivity = 1.0;

  private readonly keys = new Set<string>();
  private walkPhase = 0;
  // --- Jump state -------------------------------------------------------------
  private verticalVelocity = 0;
  private grounded = true;
  private jumpQueued = false;
  private lastGroundY = 0;
  private readonly jumpHeight = 1.05;
  private readonly gravity = 18.5;
  private lastStepHalfCycle = 0;
  private breathTime = 0;

  public readonly inspectCursorPx = new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5);
  private readonly blendStartPos = new THREE.Vector3();
  private readonly blendStartQuat = new THREE.Quaternion();
  private blendStartFov = 64;

  // Must be a Camera (isCamera = true) so Three.js .lookAt() points -Z toward target!
  private readonly dummyCam = new THREE.PerspectiveCamera();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();

  public readonly yawSpring: Spring1D = { value: 0, vel: 0, target: 0 };
  public readonly pitchSpring: Spring1D = { value: 0, vel: 0, target: 0 };
  public readonly rollSpring: Spring1D = { value: 0, vel: 0, target: 0 };

  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly fwdVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();

  public onFootstep?: () => void;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  public clearKeys(): void {
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.lastStepHalfCycle = Math.floor(this.walkPhase / Math.PI);
    this.verticalVelocity = 0;
    this.jumpQueued = false;
    this.grounded = true;
    this.lastGroundY = this.position.y;
  }

  public onKeyDown(code: string): void {
    this.keys.add(code);
    // Edge-triggered jump: Space queues a single jump, it does not bunny-hop while held.
    if (code === 'Space') {
      this.jumpQueued = true;
    }
  }

  public onKeyUp(code: string): void {
    this.keys.delete(code);
  }

  /** True while the player is in the air (not standing on the ground). */
  public get isAirborne(): boolean {
    return !this.grounded;
  }

  public applyLookDelta(dx: number, dy: number, inspectMode: boolean): void {
    if (Math.abs(dx) > 130 || Math.abs(dy) > 130) return;

    if (inspectMode) {
      this.inspectCursorPx.x = THREE.MathUtils.clamp(
        this.inspectCursorPx.x + dx * 1.05,
        20,
        window.innerWidth - 20
      );
      this.inspectCursorPx.y = THREE.MathUtils.clamp(
        this.inspectCursorPx.y + dy * 1.05,
        20,
        window.innerHeight - 20
      );
      return;
    }

    const sens = 0.0021 * this.sensitivity;
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.38, 1.35);
  }

  public setDirectMousePos(clientX: number, clientY: number): void {
    this.inspectCursorPx.set(
      THREE.MathUtils.clamp(clientX, 16, window.innerWidth - 16),
      THREE.MathUtils.clamp(clientY, 16, window.innerHeight - 16)
    );
  }

  public resetToBedroomSpawn(monitorWorldPos?: THREE.Vector3): void {
    this.position.set(0.35, 0.017, 0.62);
    this.velocity.set(0, 0, 0);
    this.roll = 0;
    this.walkPhase = 0;
    this.lastStepHalfCycle = 0;

    if (monitorWorldPos) {
      this.dummyCam.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
      this.dummyCam.up.set(0, 1, 0);
      this.dummyCam.lookAt(monitorWorldPos);
      this.euler.setFromQuaternion(this.dummyCam.quaternion, 'YXZ');
      this.yaw = this.euler.y;
      this.pitch = this.euler.x * 0.88;
    } else {
      this.yaw = 1.6264;
      this.pitch = -0.24;
    }

    this.camera.fov = 64;
    this.camera.updateProjectionMatrix();
    this.applyFreeRoamCamera(0);
  }

  public updateFreeRoam(
    dt: number,
    moveSpeed: number,
    groundYFn: (x: number, z: number) => number,
    collisionFn: (pos: THREE.Vector3) => void,
    inputEnabled: boolean
  ): void {
    this.breathTime += dt;

    let moveForward = 0;
    let moveRight = 0;
    if (inputEnabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveForward += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveForward -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveRight += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveRight -= 1;
    }

    this.fwdVec.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.rightVec.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wishX = this.fwdVec.x * moveForward + this.rightVec.x * moveRight;
    const wishZ = this.fwdVec.z * moveForward + this.rightVec.z * moveRight;
    const wishLen = Math.hypot(wishX, wishZ);

    const targetVx = wishLen > 1e-4 ? (wishX / wishLen) * moveSpeed : 0;
    const targetVz = wishLen > 1e-4 ? (wishZ / wishLen) * moveSpeed : 0;

    const accel = wishLen > 1e-4 ? 12.0 : 10.5;
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVx, Math.min(1, dt * accel));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVz, Math.min(1, dt * accel));

    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    collisionFn(this.position);
    const actualMoveSpeed = Math.hypot(this.position.x - prevX, this.position.z - prevZ) / Math.max(dt, 1e-4);

    const targetGroundY = groundYFn(this.position.x, this.position.z);

    // ---------------------------------------------------------------- JUMP / GRAVITY
    // The ground contact used to be a plain exponential snap-to-floor, which cannot express
    // "leaving the ground". It is replaced by a proper ballistic integrator: gravity pulls the
    // player down, a queued jump launches them, and landing re-clamps to the floor surface.
    if (inputEnabled && this.jumpQueued && this.grounded) {
      // Impulse chosen so a full-hold jump reaches roughly `jumpHeight` metres.
      this.verticalVelocity = Math.sqrt(2 * this.gravity * this.jumpHeight);
      this.grounded = false;
    }
    this.jumpQueued = false;

    if (!this.grounded) {
      this.verticalVelocity -= this.gravity * dt;
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= targetGroundY) {
        this.position.y = targetGroundY;
        this.verticalVelocity = 0;
        this.grounded = true;
      }
    } else {
      // Grounded: follow the ground surface, but stay glued to it so slopes do not launch the player.
      this.position.y = THREE.MathUtils.lerp(this.position.y, targetGroundY, Math.min(1, dt * 18));
      // If the floor rises above the player (walking up a step) we must not be stuck below it.
      if (targetGroundY > this.position.y + 0.02) {
        this.position.y = targetGroundY;
      }
      // Walking off a ledge: the ground drops away sharply between this frame and the last one.
      // The player then leaves the ground and falls under gravity instead of silently snapping
      // down to the new surface. Comparing against the PREVIOUS ground height (rather than an
      // absolute threshold) means gently sloping terrain never triggers a false fall.
      if (this.lastGroundY - targetGroundY > 0.40) {
        this.grounded = false;
        this.verticalVelocity = 0;
      }
    }
    this.lastGroundY = targetGroundY;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (inputEnabled && wishLen > 1e-3 && actualMoveSpeed > 0.35 && speed > 0.45) {
      this.walkPhase += dt * (4.6 + actualMoveSpeed * 1.35);
      const halfCycle = Math.floor(this.walkPhase / Math.PI);
      if (halfCycle !== this.lastStepHalfCycle) {
        this.lastStepHalfCycle = halfCycle;
        this.onFootstep?.();
      }
    } else {
      this.lastStepHalfCycle = Math.floor(this.walkPhase / Math.PI);
    }

    this.applyFreeRoamCamera(Math.min(1, actualMoveSpeed / Math.max(1, moveSpeed)));
  }

  public applyFreeRoamCamera(moveFactor: number): void {
    const bobY =
      Math.sin(this.walkPhase * 2.0) * 0.022 * moveFactor +
      Math.sin(this.breathTime * 1.5) * 0.003;
    const bobSway = Math.cos(this.walkPhase) * 0.012 * moveFactor;
    const subtleRoll = Math.cos(this.walkPhase) * 0.006 * moveFactor;

    this.euler.set(this.pitch, this.yaw, subtleRoll, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    this.rightVec.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.set(
      this.position.x + this.rightVec.x * bobSway,
      this.position.y + this.eyeHeight + bobY,
      this.position.z + this.rightVec.z * bobSway
    );
  }

  public capturePoseForBlend(): void {
    this.blendStartPos.copy(this.camera.position);
    this.blendStartQuat.copy(this.camera.quaternion);
    this.blendStartFov = this.camera.fov;
  }

  public updateExitInspectBlend(blendT: number): void {
    const smoothT = THREE.MathUtils.smoothstep(blendT, 0, 1);

    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.dummyCam.quaternion.setFromEuler(this.euler);
    this.dummyCam.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);

    this.camera.position.lerpVectors(this.blendStartPos, this.dummyCam.position, smoothT);
    this.camera.quaternion.slerpQuaternions(this.blendStartQuat, this.dummyCam.quaternion, smoothT);
    this.camera.fov = THREE.MathUtils.lerp(this.blendStartFov, 64, smoothT);
    this.camera.updateProjectionMatrix();
  }

  public updateInspectPose(
    dt: number,
    elapsed: number,
    blendT: number,
    targetPos: THREE.Vector3,
    lookTarget: THREE.Vector3,
    madness: number,
    clickPulse: number
  ): void {
    const nx = (this.inspectCursorPx.x / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = -((this.inspectCursorPx.y / Math.max(1, window.innerHeight)) * 2 - 1);

    const desiredPos = this.scratchPos.copy(targetPos);
    desiredPos.z -= nx * 0.026;
    desiredPos.y += ny * 0.018 + Math.sin(elapsed * 1.6) * 0.0025;

    this.scratchDir.copy(lookTarget).sub(targetPos).normalize();
    const flinchRecoil = madness > 0.45 ? clickPulse * 0.13 : clickPulse * 0.03;
    desiredPos.addScaledVector(this.scratchDir, madness * 0.11 - flinchRecoil);

    const lookPt = this.scratchTarget.copy(lookTarget);
    lookPt.z -= nx * 0.036;
    lookPt.y += ny * 0.025;

    this.dummyCam.position.copy(desiredPos);
    this.dummyCam.up.set(0, 1, 0);
    this.dummyCam.lookAt(lookPt);

    if (madness > 0.08 || clickPulse > 0.01) {
      const amt = madness * 0.011 + clickPulse * 0.036;
      this.dummyCam.rotateZ(Math.sin(elapsed * 53.0) * amt + (madness > 0.5 ? Math.sin(elapsed * 3.7) * 0.03 * madness : 0));
      this.dummyCam.rotateY(Math.cos(elapsed * 47.0) * amt * 0.5);
      this.dummyCam.position.y += Math.cos(elapsed * 63.0) * amt * 0.45;
    }

    const smoothT = THREE.MathUtils.smoothstep(blendT, 0, 1);
    this.camera.position.lerpVectors(this.blendStartPos, this.dummyCam.position, smoothT);
    this.camera.quaternion.slerpQuaternions(this.blendStartQuat, this.dummyCam.quaternion, smoothT);

    const targetFov = THREE.MathUtils.lerp(this.blendStartFov, 58, smoothT) + madness * 5.0;
    if (Math.abs(this.camera.fov - targetFov) > 0.04) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Act 2 Predatory Suction Camera:
   * Recoil -> neck-straining resistance & glance toward bedroom -> unstoppable forward acceleration
   * down the 3D BSOD throat straight into the glowing GlitchWorld horizon portal at the far end!
   * Ends at u=1.0 aligned dead-center (yawOffset=0, pitchOffset=0, roll=+0.16, fov=98) for a 100% seamless handoff!
   */
  public updateSuctionCutscene(
    t: number,
    duration: number,
    monitorPos: THREE.Vector3,
    monitorQuat: THREE.Quaternion,
    monitorScaleZ = 0.348
  ): { progress: number; insideTunnel: boolean } {
    const monFwd = this.scratchDir.set(0, 0, 1).applyQuaternion(monitorQuat);
    const monRight = this.scratchRight.set(1, 0, 0).applyQuaternion(monitorQuat);

    let distOut = 0.58;
    let sideOffset = 0;
    let vertOffset = 0.03;
    let lookYawOffset = 0;
    let lookPitchOffset = 0;
    let headRoll = 0;
    let fov = 62;

    if (t < 0.78) {
      if (t < 0.24) {
        const b = t / 0.24;
        distOut = THREE.MathUtils.lerp(0.55, 0.34, Math.sin(b * Math.PI * 0.5));
        vertOffset = THREE.MathUtils.lerp(0.03, -0.02, b);
        headRoll = 0.14 * b;
        fov = THREE.MathUtils.lerp(62, 76, b);
      } else {
        const u = (t - 0.24) / 0.54;
        const easeOut = 1 - Math.pow(1 - u, 3);
        distOut = THREE.MathUtils.lerp(0.34, 0.90, easeOut);
        vertOffset = THREE.MathUtils.lerp(-0.02, 0.08, easeOut);
        lookPitchOffset = Math.sin(u * Math.PI) * 0.095;
        headRoll = THREE.MathUtils.lerp(0.14, -0.08, easeOut);
        fov = THREE.MathUtils.lerp(76, 69, easeOut);
      }
    } else if (t < 2.25) {
      const u = (t - 0.78) / 1.47;
      distOut =
        0.88 -
        u * 0.50 +
        Math.sin(u * Math.PI * 3.0) * 0.055 +
        Math.sin(t * 44.0) * 0.006;
      sideOffset = Math.sin(u * Math.PI * 1.5) * 0.075 * (1 - u);
      vertOffset = THREE.MathUtils.lerp(0.08, 0.0, THREE.MathUtils.smoothstep(u, 0, 1));
      const resistGlance = Math.sin(Math.pow(u, 0.82) * Math.PI);
      lookYawOffset = 1.02 * resistGlance + Math.sin(t * 42.0) * 0.024 * (1 - u);
      lookPitchOffset = -0.08 * resistGlance;
      headRoll = -0.08 - 0.24 * resistGlance;
      fov = THREE.MathUtils.lerp(69, 90, THREE.MathUtils.smoothstep(u, 0, 1));
    } else {
      const u = THREE.MathUtils.clamp((t - 2.25) / Math.max(0.5, duration - 2.25), 0, 1);
      const accel = Math.pow(u, 1.55);
      // Reach exact localZ = -88.56 (27.44 local units from z=-116 cap, matching GlitchWorld's -27.44m sleeve start 1:1!)
      const endWorldDist = -88.56 * Math.max(0.1, monitorScaleZ);
      distOut = THREE.MathUtils.lerp(0.38, endWorldDist, accel);
      const damp = 1.0 - THREE.MathUtils.smoothstep(u, 0.58, 1.0);
      const spiralEnv = Math.sin(u * Math.PI) * 0.095 * damp;
      sideOffset = Math.sin(u * 12.0) * spiralEnv;
      vertOffset = Math.cos(u * 10.0) * spiralEnv * 0.85;
      lookYawOffset = Math.sin(u * 8.0) * 0.035 * damp;
      lookPitchOffset = Math.cos(u * 7.0) * 0.028 * damp;
      headRoll = THREE.MathUtils.lerp(Math.sin(u * 6.5) * 0.24, 0.12, THREE.MathUtils.smoothstep(u, 0.55, 1.0));
      fov = THREE.MathUtils.lerp(90, 96, THREE.MathUtils.smoothstep(u, 0.0, 0.85));
    }

    const camPos = this.scratchPos
      .copy(monitorPos)
      .addScaledVector(monFwd, distOut)
      .addScaledVector(monRight, sideOffset);
    camPos.y += vertOffset;

    const baseLookTarget = this.scratchTarget
      .copy(monitorPos)
      .addScaledVector(monFwd, Math.min(-6.0, distOut - 27.44 * Math.max(0.1, monitorScaleZ)));

    this.dummyCam.position.copy(camPos);
    this.dummyCam.up.set(0, 1, 0);
    this.dummyCam.lookAt(baseLookTarget);
    this.dummyCam.rotateY(lookYawOffset);
    this.dummyCam.rotateX(lookPitchOffset);
    this.dummyCam.rotateZ(headRoll);

    this.camera.position.copy(camPos);
    this.camera.quaternion.copy(this.dummyCam.quaternion);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();

    const insideTunnel = distOut < -0.03;
    const progress = THREE.MathUtils.clamp((t - 1.9) / Math.max(0.5, duration - 1.9), 0, 1);
    return { progress, insideTunnel };
  }

  public initCollapseCutscene(): void {
    this.yawSpring.value = this.yaw;
    this.yawSpring.target = this.yaw;
    this.yawSpring.vel = 0;

    this.pitchSpring.value = this.pitch;
    this.pitchSpring.target = this.pitch;
    this.pitchSpring.vel = 0;

    this.rollSpring.value = 0;
    this.rollSpring.target = 0;
    this.rollSpring.vel = 0;
    this.velocity.set(0, 0, 0);
  }

  public updateCollapseAndFallCutscene(
    dt: number,
    t: number,
    originPos: THREE.Vector3,
    baseYaw: number,
    onPanicStep: () => void,
    stepFlags: { s1: boolean; s2: boolean }
  ): void {
    let bodyBackDist = 0;
    let bodySideShift = 0;
    let bodyDropY = 0;
    let fovTarget = 68;
    let stiffness = 26;
    let damping = 6.2;

    if (t < 0.72) {
      this.yawSpring.target = baseYaw + 0.68;
      this.pitchSpring.target = 0.16;
      this.rollSpring.target = -0.075;
      bodyDropY = -0.04 * Math.sin((t / 0.72) * Math.PI);
    } else if (t < 1.48) {
      this.yawSpring.target = baseYaw - 0.82;
      this.pitchSpring.target = 0.08;
      this.rollSpring.target = 0.085;
      bodySideShift = -0.08;
    } else if (t < 2.25) {
      stiffness = 34;
      damping = 6.8;
      this.yawSpring.target = baseYaw - 0.08;
      this.pitchSpring.target = -1.04;
      this.rollSpring.target = -0.04;
    } else if (t < 3.75) {
      const u = (t - 2.25) / 1.5;
      stiffness = 32;
      damping = 6.5;

      if (u < 0.48) {
        this.yawSpring.target = baseYaw + 0.34;
        this.pitchSpring.target = -1.08;
        this.rollSpring.target = 0.09;
      } else {
        this.yawSpring.target = baseYaw - 0.28;
        this.pitchSpring.target = -1.16;
        this.rollSpring.target = -0.11;
      }

      bodyBackDist = THREE.MathUtils.smoothstep(u, 0.05, 0.92) * 1.15;
      bodyDropY = Math.abs(Math.sin(u * Math.PI * 2.0)) * -0.085;

      if (u > 0.22 && !stepFlags.s1) {
        stepFlags.s1 = true;
        onPanicStep();
      }
      if (u > 0.68 && !stepFlags.s2) {
        stepFlags.s2 = true;
        onPanicStep();
      }
      fovTarget = 74;
    } else if (t < 4.15) {
      const u = (t - 3.75) / 0.4;
      bodyBackDist = 1.15;
      bodyDropY = -u * u * 1.35;
      this.pitchSpring.target = -1.25;
      this.rollSpring.target = -0.24;
      fovTarget = 84;
    } else {
      const fallT = t - 4.15;
      bodyBackDist = 1.15 + Math.sin(fallT * 1.7) * 0.45;
      bodySideShift = Math.cos(fallT * 1.4) * 0.45;
      bodyDropY = -1.35 - 7.35 * fallT * fallT;

      stiffness = 14;
      damping = 4.6;

      if (fallT < 2.85) {
        this.pitchSpring.target = 1.15;
        this.yawSpring.target = baseYaw + fallT * 0.52;
        this.rollSpring.target = 0.26 * Math.sin(fallT * 2.1);
        fovTarget = 98;
      } else {
        this.pitchSpring.target = -1.28;
        this.yawSpring.target = baseYaw + 1.55;
        this.rollSpring.target = -0.18;
        fovTarget = 108;
      }
    }

    const curYaw = stepSpring(this.yawSpring, stiffness, damping, dt);
    const curPitch = stepSpring(this.pitchSpring, stiffness, damping, dt);
    const curRoll = stepSpring(this.rollSpring, stiffness, damping, dt);

    const tremorAmt = t < 4.25 ? 0.007 : 0.012;
    const tx = Math.sin(t * 37.0) * Math.cos(t * 19.0) * tremorAmt;
    const ty = Math.cos(t * 41.0) * tremorAmt;

    const backDirX = Math.sin(baseYaw);
    const backDirZ = Math.cos(baseYaw);
    const sideDirX = Math.cos(baseYaw);
    const sideDirZ = -Math.sin(baseYaw);

    this.camera.position.set(
      originPos.x + backDirX * bodyBackDist + sideDirX * bodySideShift,
      originPos.y + this.eyeHeight + bodyDropY,
      originPos.z + backDirZ * bodyBackDist + sideDirZ * bodySideShift
    );

    this.euler.set(THREE.MathUtils.clamp(curPitch + tx, -1.48, 1.48), curYaw + ty, curRoll, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);

    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fovTarget, Math.min(1, dt * 6));
    this.camera.updateProjectionMatrix();
  }

  /**
   * 100% Seamless Forward-Flying Tunnel-to-3D-World Arrival Sequence (6.20s):
   * 1) 0.00..1.15s: Inside the Sky-Monitor's 56m 3D Data-Vortex Exit Sleeve (localZ: -31.5m -> 0.0m),
   *    flying straight forward toward the open 28m shattered BSOD glass aperture with the live 3D
   *    GlitchWorld Cathedral & Celestial Sky-Eye directly ahead through the mouth!
   * 2) 1.15..4.55s: Burst straight out through the shattered Sky-Monitor glass & crystalline shards onto a
   *    C1-continuous cubic Hermite flight spline sweeping gracefully under the colossal Sky-Aqueduct onto the Overlook!
   * 3) 4.55..6.20s: Physical landing absorb on the Overlook octagonal medallion & rise to standing!
   */
  public updateGlitchArrivalCutscene(
    dt: number,
    t: number,
    spawnPos: THREE.Vector3,
    _corePos: THREE.Vector3,
    skyPortalPos?: THREE.Vector3,
    skyPortalQuat?: THREE.Quaternion
  ): { finished: boolean; touchedDown: boolean; airSpeedFactor: number; crossedAperture: boolean } {
    const tunnelDur = 1.12;
    const glideDur = 3.18;
    const diveEnd = tunnelDur + glideDur; // 4.30s
    const totalDur = 5.95;

    const p0x = skyPortalPos ? skyPortalPos.x : 0;
    const p0y = skyPortalPos ? skyPortalPos.y : 46;
    const p0z = skyPortalPos ? skyPortalPos.z : 86;

    if (skyPortalQuat) {
      this.scratchDir.set(0, 0, 1).applyQuaternion(skyPortalQuat).normalize();
    } else {
      this.scratchDir.set(0, 22.0 - p0y, -6.0 - p0z).normalize();
    }
    const fwdX = this.scratchDir.x;
    const fwdY = this.scratchDir.y;
    const fwdZ = this.scratchDir.z;
    const tunnelPitch = Math.asin(THREE.MathUtils.clamp(fwdY, -0.99, 0.99));
    const exitSpeed = 24.5; // m/s -> -27.44m sleeve start & 77.9m Hermite tangent matching the 76.7m sky chord!

    if (t < tunnelDur) {
      // Phase 1: Inside the Solid Circular Sky-Maw Sleeve (-27.44m -> 0.0m at 24.5 m/s)
      const s = THREE.MathUtils.clamp(t / tunnelDur, 0, 1);
      const localZ = -exitSpeed * tunnelDur * (1.0 - s);

      const camX = p0x + fwdX * localZ;
      const camY = p0y + fwdY * localZ;
      const camZ = p0z + fwdZ * localZ;

      const roll = THREE.MathUtils.lerp(0.12, 0.03, THREE.MathUtils.smoothstep(s, 0, 1));
      const fov = 96.0 - 6.0 * s;

      this.camera.position.set(camX, camY, camZ);
      this.euler.set(tunnelPitch, 0, roll, 'YXZ');
      this.camera.quaternion.setFromEuler(this.euler);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();

      this.position.copy(spawnPos);
      return { finished: false, touchedDown: false, airSpeedFactor: 1.0, crossedAperture: false };
    }

    if (t < diveEnd) {
      // Phase 2: Velocity-Aligned C1/C2-Smooth Cubic Hermite Flight out through the 48 Sky-Maw Teeth onto Overlook!
      const u = THREE.MathUtils.clamp((t - tunnelDur) / glideDur, 0, 1);
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;

      const m0x = fwdX * (exitSpeed * glideDur);
      const m0y = fwdY * (exitSpeed * glideDur);
      const m0z = fwdZ * (exitSpeed * glideDur);

      const p1x = spawnPos.x;
      const p1y = spawnPos.y + this.eyeHeight + 0.30;
      const p1z = spawnPos.z;

      const m1x = 0;
      const m1y = -9.5;
      const m1z = -24.0;

      // C2-smooth sin^2(u * PI) lateral bank: value=0 AND derivative=0 at u=0 and u=1!
      const sinU = Math.sin(u * Math.PI);
      const bankCurve = sinU * sinU * (1.0 - u * 0.35);
      const camX = h00 * p0x + h10 * m0x + h01 * p1x + h11 * m1x + bankCurve * 3.0;
      const camY = h00 * p0y + h10 * m0y + h01 * p1y + h11 * m1y;
      const camZ = h00 * p0z + h10 * m0z + h01 * p1z + h11 * m1z;

      // Analytic flight tangent dP/du so camera looks naturally along its true 3D swooping trajectory (0.000 deg jump at u=0!)
      const dh00 = 6 * u2 - 6 * u;
      const dh10 = 3 * u2 - 4 * u + 1;
      const dh01 = -6 * u2 + 6 * u;
      const dh11 = 3 * u2 - 2 * u;
      const dBank = Math.PI * Math.sin(2 * Math.PI * u) * (1.0 - u * 0.35) - 0.35 * sinU * sinU;
      const vx = dh00 * p0x + dh10 * m0x + dh01 * p1x + dh11 * m1x + dBank * 3.0;
      const vy = dh00 * p0y + dh10 * m0y + dh01 * p1y + dh11 * m1y;
      const vz = dh00 * p0z + dh10 * m0z + dh01 * p1z + dh11 * m1z;
      const vLen = Math.max(1e-4, Math.hypot(vx, vy, vz));
      const velPitch = Math.asin(THREE.MathUtils.clamp(vy / vLen, -0.92, 0.92));
      const velYaw = Math.atan2(-vx, -vz);

      const flareBlend = THREE.MathUtils.smoothstep(u, 0.52, 1.0);
      const pitch = THREE.MathUtils.lerp(velPitch, -0.24, flareBlend);
      const yaw = THREE.MathUtils.lerp(velYaw * 0.45, 0.0, flareBlend);
      const roll = 0.03 - bankCurve * 0.13;
      // C1-continuous FOV continuation from Phase 1 (90.0 -> 74.0, matching dfov/dt = -5.357 deg/s at u=0!)
      const fov = 90.0 - 17.04 * u + 1.04 * u2;

      this.camera.position.set(camX, camY, camZ);
      this.euler.set(pitch, yaw, roll, 'YXZ');
      this.camera.quaternion.setFromEuler(this.euler);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();

      this.position.copy(spawnPos);
      return {
        finished: false,
        touchedDown: false,
        airSpeedFactor: 1.0 - u * 0.35,
        crossedAperture: true,
      };
    }

    // Phase 3: Touchdown & crisp athletic knee-absorb onto the Overlook octagonal plaza (4.55s .. 6.20s)
    const landT = t - diveEnd;
    const landDur = totalDur - diveEnd;

    if (landT >= landDur) {
      this.position.copy(spawnPos);
      this.velocity.set(0, 0, 0);
      this.yaw = 0;
      this.pitch = 0.02;
      this.roll = 0;
      this.walkPhase = 0;
      this.lastStepHalfCycle = 0;
      this.camera.fov = 66;
      this.camera.updateProjectionMatrix();
      this.applyFreeRoamCamera(0);
      return { finished: true, touchedDown: true, airSpeedFactor: 0, crossedAperture: true };
    }

    let eyeY = this.eyeHeight;
    let yaw = 0;
    let pitch = 0.02;
    let roll = 0;
    let fov = 66;

    if (landT < 0.32) {
      const u = landT / 0.32;
      const ease = 1 - Math.pow(1 - u, 3);
      eyeY = THREE.MathUtils.lerp(this.eyeHeight + 0.30, 0.56, ease);
      pitch = THREE.MathUtils.lerp(-0.24, -0.52, ease);
      roll = THREE.MathUtils.lerp(0.03, -0.14, ease);
      yaw = THREE.MathUtils.lerp(0.0, 0.10, ease);
      fov = THREE.MathUtils.lerp(74, 68, ease);
    } else if (landT < 0.80) {
      const u = (landT - 0.32) / 0.48;
      eyeY = THREE.MathUtils.lerp(0.56, 0.68, u);
      pitch = THREE.MathUtils.lerp(-0.52, -0.36, u);
      roll = THREE.MathUtils.lerp(-0.14, -0.08, u);
      yaw = THREE.MathUtils.lerp(0.10, -0.06, Math.sin(u * Math.PI * 0.5));
      fov = 68;
    } else {
      const u = (landT - 0.80) / (landDur - 0.80);
      const smooth = u * u * (3 - 2 * u);
      eyeY = THREE.MathUtils.lerp(0.68, this.eyeHeight, smooth);
      pitch = THREE.MathUtils.lerp(-0.36, 0.02, smooth);
      roll = THREE.MathUtils.lerp(-0.08, 0.0, smooth);
      yaw = THREE.MathUtils.lerp(-0.06, 0.0, smooth);
      fov = THREE.MathUtils.lerp(68, 66, smooth);
    }

    this.position.copy(spawnPos);
    this.camera.position.set(spawnPos.x, spawnPos.y + eyeY, spawnPos.z);
    this.euler.set(pitch, yaw, roll, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, Math.min(1, dt * 15));
    this.camera.updateProjectionMatrix();
    return { finished: false, touchedDown: true, airSpeedFactor: 0, crossedAperture: true };
  }

  public updateReturnLandingCutscene(dt: number, t: number): boolean {
    const landX = 0.65;
    const landZ = 0.35;
    const targetYaw = 1.72;

    let eyeY = this.eyeHeight;
    let yaw = targetYaw;
    let pitch = -0.1;
    let roll = 0;
    let fov = 64;

    if (t < 0.26) {
      const u = t / 0.26;
      eyeY = THREE.MathUtils.lerp(2.90, 0.36, u * u);
      pitch = THREE.MathUtils.lerp(-1.18, -0.58, u);
      roll = THREE.MathUtils.lerp(-0.18, -0.30, u);
      fov = THREE.MathUtils.lerp(102, 74, u);
    } else if (t < 1.45) {
      const u = (t - 0.26) / 1.19;
      const impactBounce = Math.sin(Math.min(1, u * 3.0) * Math.PI) * 0.045;
      eyeY = 0.36 - impactBounce + u * 0.16;
      yaw = targetYaw - Math.sin(u * Math.PI) * 0.42;
      pitch = THREE.MathUtils.lerp(-0.58, -0.32, u) + Math.sin(t * 18.0) * 0.010 * (1 - u);
      roll = THREE.MathUtils.lerp(-0.30, -0.14, u);
      fov = THREE.MathUtils.lerp(74, 68, u);
    } else if (t < 3.35) {
      const u = (t - 1.45) / 1.90;
      const smooth = u * u * (3 - 2 * u);
      eyeY = THREE.MathUtils.lerp(0.52, this.eyeHeight, smooth);
      yaw = targetYaw + Math.sin(u * Math.PI) * 0.06;
      pitch = THREE.MathUtils.lerp(-0.32, -0.1, smooth);
      roll = THREE.MathUtils.lerp(-0.14, 0.0, smooth) + Math.sin(u * Math.PI) * 0.035;
      fov = THREE.MathUtils.lerp(68, 64, smooth);
    } else {
      this.position.set(landX, 0.017, landZ);
      this.yaw = targetYaw;
      this.pitch = -0.1;
      this.roll = 0;
      this.camera.fov = 64;
      this.camera.updateProjectionMatrix();
      this.applyFreeRoamCamera(0);
      return true;
    }

    this.position.set(landX, 0.017, landZ);
    this.camera.position.set(landX, 0.017 + eyeY, landZ);
    this.euler.set(pitch, yaw, roll, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, Math.min(1, dt * 14));
    this.camera.updateProjectionMatrix();
    return false;
  }
}
