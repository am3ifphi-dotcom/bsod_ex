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
  // Open bedroom rug directly in front of the bed & facing the glowing BSOD PC setup!
  public readonly position = new THREE.Vector3(0.35, 0.017, 0.62);
  public readonly velocity = new THREE.Vector3();
  public yaw = 1.6264;
  public pitch = -0.25;
  public roll = 0;
  public eyeHeight = 1.61;
  public sensitivity = 1.0;

  private readonly keys = new Set<string>();
  private walkPhase = 0;
  private lastStepHalfCycle = 0;
  private breathTime = 0;

  // Inspection cursor in viewport CSS pixels
  public readonly inspectCursorPx = new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5);
  private readonly blendStartPos = new THREE.Vector3();
  private readonly blendStartQuat = new THREE.Quaternion();
  private blendStartFov = 64;

  // CRITICAL: Must be a Camera (isCamera = true) so Three.js .lookAt() points -Z toward target instead of +Z!
  private readonly dummyCam = new THREE.PerspectiveCamera();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();

  // Human head/neck spring solver for forced-camera cutscenes
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
  }

  public onKeyDown(code: string): void {
    this.keys.add(code);
  }

  public onKeyUp(code: string): void {
    this.keys.delete(code);
  }

  public applyLookDelta(dx: number, dy: number, inspectMode: boolean): void {
    // Guard against Chrome/Windows synthetic pointer-lock re-centering spikes!
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
      this.pitch = this.euler.x * 0.88; // Natural slight horizon framing with monitor dead-center!
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
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetGroundY, Math.min(1, dt * 18));

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    // Only advance footstep cycle when player is actively pressing movement AND physically moving across floor!
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

  /**
   * Smoothly blends back from PC inspection pose to standing free-roam pose (zero vertical jump!)
   */
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

  /**
   * Smooth natural camera focus onto the PC monitor with subtle head breathing & cursor parallax
   */
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

    // Creeping magnetic pull closer to the monitor as madness escalates — punctuated by violent fear-flinch recoil when clicked!
    this.scratchDir.copy(lookTarget).sub(targetPos).normalize();
    const flinchRecoil = madness > 0.45 ? clickPulse * 0.14 : clickPulse * 0.03;
    desiredPos.addScaledVector(this.scratchDir, madness * 0.11 - flinchRecoil);

    const lookPt = this.scratchTarget.copy(lookTarget);
    lookPt.z -= nx * 0.036;
    lookPt.y += ny * 0.025;

    this.dummyCam.position.copy(desiredPos);
    this.dummyCam.up.set(0, 1, 0);
    this.dummyCam.lookAt(lookPt);

    if (madness > 0.08 || clickPulse > 0.01) {
      const amt = madness * 0.012 + clickPulse * 0.038;
      this.dummyCam.rotateZ(Math.sin(elapsed * 53.0) * amt + (madness > 0.5 ? Math.sin(elapsed * 3.7) * 0.035 * madness : 0));
      this.dummyCam.rotateY(Math.cos(elapsed * 47.0) * amt * 0.55);
      this.dummyCam.position.y += Math.cos(elapsed * 63.0) * amt * 0.5;
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
   * Recoil -> neck-straining hesitation & glance toward bedroom door -> unstoppable plunge down the 3D throat!
   */
  public updateSuctionCutscene(
    t: number,
    duration: number,
    monitorPos: THREE.Vector3,
    monitorQuat: THREE.Quaternion
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
      // Stage 1: Violent initial bite-yank right up to the 3D fangs (0..0.24s) -> desperate recoil back (0.24..0.78s)!
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
        vertOffset = THREE.MathUtils.lerp(-0.02, 0.09, easeOut);
        lookPitchOffset = Math.sin(u * Math.PI) * 0.095;
        headRoll = THREE.MathUtils.lerp(0.14, -0.08, easeOut);
        fov = THREE.MathUtils.lerp(76, 69, easeOut);
      }
    } else if (t < 2.35) {
      // Stage 2: Neck-straining physical resistance & desperate glance back toward the bedroom
      const u = (t - 0.78) / 1.57;
      distOut =
        0.88 -
        u * 0.50 +
        Math.sin(u * Math.PI * 3.0) * 0.065 +
        Math.sin(t * 46.0) * 0.008;
      sideOffset = Math.sin(u * Math.PI * 1.5) * 0.085;
      const resistGlance = Math.sin(Math.pow(u, 0.82) * Math.PI);
      // Wrench head ~62° toward the dark bedroom behind you — glimpsing the room crawling with eyes before getting yanked into the jaws!
      lookYawOffset = 1.08 * resistGlance + Math.sin(t * 44.0) * 0.032;
      lookPitchOffset = -0.09 * resistGlance + Math.cos(t * 49.0) * 0.024;
      headRoll = -0.08 - 0.28 * resistGlance;
      fov = THREE.MathUtils.lerp(69, 92, THREE.MathUtils.smoothstep(u, 0, 1));
    } else {
      // Stage 3: Full 4.85-second high-velocity speed-line flight deep down the 40m 3D monitor throat!
      const u = THREE.MathUtils.clamp((t - 2.35) / Math.max(0.5, duration - 2.35), 0, 1);
      // Smooth continuous acceleration curve that maintains thrilling forward velocity right to climax!
      const accel = Math.pow(u, 1.55);
      distOut = THREE.MathUtils.lerp(0.38, -38.2, accel);
      const spiralEnv = Math.sin(u * Math.PI) * 0.14;
      sideOffset = Math.sin(u * 13.5) * spiralEnv;
      vertOffset = Math.cos(u * 11.0) * spiralEnv * 0.85;
      lookYawOffset = Math.sin(u * 9.0) * 0.045 * (1 - u * 0.5);
      lookPitchOffset = Math.cos(u * 8.0) * 0.035 * (1 - u * 0.5);
      headRoll = Math.sin(u * 7.5) * 0.28 + u * 0.18;
      fov = THREE.MathUtils.lerp(92, 112, Math.sin(u * Math.PI * 0.82));
    }

    const camPos = this.scratchPos
      .copy(monitorPos)
      .addScaledVector(monFwd, distOut)
      .addScaledVector(monRight, sideOffset);
    camPos.y += vertOffset;

    const baseLookTarget = this.scratchTarget
      .copy(monitorPos)
      .addScaledVector(monFwd, Math.min(-6.0, distOut - 10.0));

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
      // Panic glance right at sky fracture
      this.yawSpring.target = baseYaw + 0.68;
      this.pitchSpring.target = 0.16;
      this.rollSpring.target = -0.075;
      bodyDropY = -0.04 * Math.sin((t / 0.72) * Math.PI);
    } else if (t < 1.48) {
      // Panic glance left at trembling horizon
      this.yawSpring.target = baseYaw - 0.82;
      this.pitchSpring.target = 0.08;
      this.rollSpring.target = 0.085;
      bodySideShift = -0.08;
    } else if (t < 2.25) {
      // Snap gaze straight down at shoes right as Voronoi polygonal cracks split open!
      stiffness = 34;
      damping = 6.8;
      this.yawSpring.target = baseYaw - 0.08;
      this.pitchSpring.target = -1.04;
      this.rollSpring.target = -0.04;
    } else if (t < 3.75) {
      // Watch Voronoi jigsaw seams widen beneath feet while stumbling 2 steps backward!
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
      // Exact moment Voronoi jigsaw polygons shatter along the cracks & drop away beneath your heels!
      const u = (t - 3.75) / 0.4;
      bodyBackDist = 1.15;
      bodyDropY = -u * u * 1.35;
      this.pitchSpring.target = -1.25;
      this.rollSpring.target = -0.24;
      fovTarget = 84;
    } else {
      // 5.45-second high-velocity speed-line freefall down the 245m abyssal shaft!
      const fallT = t - 4.15;
      bodyBackDist = 1.15 + Math.sin(fallT * 1.7) * 0.45;
      bodySideShift = Math.cos(fallT * 1.4) * 0.45;
      bodyDropY = -1.35 - 7.35 * fallT * fallT;

      stiffness = 14;
      damping = 4.6;

      if (fallT < 2.85) {
        // Tumbling backward looking UP at the jagged polygonal cliff rim receding high overhead!
        this.pitchSpring.target = 1.15;
        this.yawSpring.target = baseYaw + fallT * 0.52;
        this.rollSpring.target = 0.26 * Math.sin(fallT * 2.1);
        fovTarget = 98;
      } else {
        // Flipping downward into blistering speed-lines toward the rushing bedroom threshold!
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
   * Deep 3-Act Continuous Aerial Arrival Sequence into the 3D Glitch World (6.15s):
   * 1) 0.00..1.65s: Tumble backward out of the 28m Sky-Monitor at (0, 94, 58), looking UP as it shrinks into the clouds!
   * 2) 1.65..4.35s: Mid-air 180° skydiver roll over your right shoulder into a bold banking dive under the Sky-Aqueducts!
   * 3) 4.35..6.15s: Heavy knee-buckling impact on the Overlook, breathless glance down, and smooth rise to standing!
   */
  public updateGlitchArrivalCutscene(
    dt: number,
    t: number,
    spawnPos: THREE.Vector3,
    corePos: THREE.Vector3
  ): { finished: boolean; touchedDown: boolean; airSpeedFactor: number } {
    const diveEnd = 4.35;
    const totalDur = 6.15;

    if (t < diveEnd) {
      const u = THREE.MathUtils.clamp(t / diveEnd, 0, 1);
      const yCurve = 1.0 - Math.pow(u, 1.48);
      const zCurve = 1.0 - Math.pow(u, 0.92);

      // Sweeping S-bank dive from beneath the (0, 94, 58) Sky-Monitor down to (0, spawnY, 20)
      const bankSway = Math.sin(u * Math.PI * 1.35) * (1.0 - u) * THREE.MathUtils.smoothstep(u, 0.08, 0.38);
      const camX = spawnPos.x + bankSway * 19.5;
      const camY = spawnPos.y + this.eyeHeight + 83.5 * yCurve;
      const camZ = spawnPos.z + 34.0 * zCurve;

      // Singularity-free YXZ Euler skydiver choreography:
      // 0..1.15s: Falling backward facing +Z/+Y (yaw=PI, pitch=+0.78) straight UP at the 28m Sky-Monitor!
      // 1.15..2.95s: Smooth 180° shoulder roll (yaw: PI -> 0, pitch: +0.78 -> -0.46) into the Megacity dive!
      // 2.95..4.35s: Banking wingover locking onto the Sanctuary & Overlook, matching touchdown pose at t=4.35s!
      const flip = THREE.MathUtils.smoothstep(t, 1.10, 2.95);
      const endLevel = THREE.MathUtils.smoothstep(t, 3.10, diveEnd);

      const yaw = Math.PI * (1.0 - flip) - bankSway * 0.16 * flip * (1.0 - endLevel);
      const divePitch = THREE.MathUtils.lerp(-0.46, -0.24, endLevel);
      const pitch = THREE.MathUtils.lerp(0.78, divePitch, flip);

      const rollOver = Math.sin(flip * Math.PI) * -0.48;
      const wingBank = -Math.sin(u * Math.PI * 1.35) * 0.34 * flip * (1.0 - endLevel);
      const roll = THREE.MathUtils.lerp(0.18 * (1.0 - flip) + rollOver + wingBank, 0.06, endLevel)
                 + Math.sin(t * 26.0) * 0.008 * (1.0 - endLevel);

      this.camera.position.set(camX, camY, camZ);
      this.euler.set(pitch, yaw, roll, 'YXZ');
      this.camera.quaternion.setFromEuler(this.euler);
      this.camera.fov = THREE.MathUtils.lerp(98, 76, Math.pow(u, 0.82));
      this.camera.updateProjectionMatrix();

      this.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
      return { finished: false, touchedDown: false, airSpeedFactor: 1.0 - u * 0.25 };
    }

    // Touchdown & staggered physical recovery (4.35s .. 6.15s)
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
      return { finished: true, touchedDown: true, airSpeedFactor: 0 };
    }

    let eyeY = this.eyeHeight;
    let yaw = 0;
    let pitch = 0.02;
    let roll = 0;
    let fov = 66;

    if (landT < 0.34) {
      // Heavy knee-buckling slam onto the wet basalt overlook!
      const u = landT / 0.34;
      const ease = 1 - Math.pow(1 - u, 3);
      eyeY = THREE.MathUtils.lerp(this.eyeHeight + 0.32, 0.46, ease);
      pitch = THREE.MathUtils.lerp(-0.24, -0.62, ease);
      roll = THREE.MathUtils.lerp(0.06, -0.20, ease);
      yaw = THREE.MathUtils.lerp(0.0, 0.16, ease);
      fov = THREE.MathUtils.lerp(76, 69, ease);
    } else if (landT < 0.88) {
      // Catching breath on one knee, glancing briefly at the glowing circuit stone under your hands
      const u = (landT - 0.34) / 0.54;
      eyeY = THREE.MathUtils.lerp(0.46, 0.58, u);
      pitch = THREE.MathUtils.lerp(-0.62, -0.44, u);
      roll = THREE.MathUtils.lerp(-0.20, -0.12, u);
      yaw = THREE.MathUtils.lerp(0.16, -0.10, Math.sin(u * Math.PI * 0.5));
      fov = 69;
    } else {
      // Pushing off knee & rising smoothly to full standing posture facing the Sanctuary vista!
      const u = (landT - 0.88) / (landDur - 0.88);
      const smooth = u * u * (3 - 2 * u);
      eyeY = THREE.MathUtils.lerp(0.58, this.eyeHeight, smooth);
      pitch = THREE.MathUtils.lerp(-0.44, 0.02, smooth);
      roll = THREE.MathUtils.lerp(-0.12, 0.0, smooth);
      yaw = THREE.MathUtils.lerp(-0.10, 0.0, smooth);
      fov = THREE.MathUtils.lerp(69, 66, smooth);
    }

    this.position.copy(spawnPos);
    this.camera.position.set(spawnPos.x, spawnPos.y + eyeY, spawnPos.z);
    this.euler.set(pitch, yaw, roll, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, Math.min(1, dt * 15));
    this.camera.updateProjectionMatrix();
    return { finished: false, touchedDown: true, airSpeedFactor: 0 };
  }

  public updateReturnLandingCutscene(dt: number, t: number): boolean {
    const landX = 0.65;
    const landZ = 0.35;
    const targetYaw = 1.72; // Looking from rug straight toward the altered PC desk!

    let eyeY = this.eyeHeight;
    let yaw = targetYaw;
    let pitch = -0.1;
    let roll = 0;
    let fov = 64;

    if (t < 0.26) {
      // Continuous freefall momentum straight down from the dark bedroom ceiling onto the rug!
      const u = t / 0.26;
      eyeY = THREE.MathUtils.lerp(2.90, 0.36, u * u);
      pitch = THREE.MathUtils.lerp(-1.18, -0.58, u);
      roll = THREE.MathUtils.lerp(-0.18, -0.30, u);
      fov = THREE.MathUtils.lerp(102, 74, u);
    } else if (t < 1.45) {
      // Sprawled on side/elbows on the rug, gasping and glancing wildly at the chair & floorboards!
      const u = (t - 0.26) / 1.19;
      const impactBounce = Math.sin(Math.min(1, u * 3.0) * Math.PI) * 0.045;
      eyeY = 0.36 - impactBounce + u * 0.16;
      yaw = targetYaw - Math.sin(u * Math.PI) * 0.42;
      pitch = THREE.MathUtils.lerp(-0.58, -0.32, u) + Math.sin(t * 18.0) * 0.010 * (1 - u);
      roll = THREE.MathUtils.lerp(-0.30, -0.14, u);
      fov = THREE.MathUtils.lerp(74, 68, u);
    } else if (t < 3.35) {
      // Bracing hand against floor and rising unsteadily to standing posture!
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
