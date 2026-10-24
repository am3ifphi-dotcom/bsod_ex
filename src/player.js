// player.js — analytic collision (ground rects / ramps + AABB walls) and a
// first-person controller. No physics engine: deterministic, fast, and it
// structurally prevents falling off the world (a move is only accepted if a
// ground exists under the destination, except during the scripted fall).
import * as THREE from 'three';

export class CollisionWorld {
  constructor() { this.grounds = []; this.walls = []; }
  clear() { this.grounds.length = 0; this.walls.length = 0; }
  /** rect: {x0,x1,z0,z1,y} or ramp {x0,x1,z0,z1, ramp:{axis:'z', a0,a1,y0,y1}} */
  addGround(r) { r.enabled = r.enabled !== false; this.grounds.push(r); return r; }
  addWall(r) { r.enabled = r.enabled !== false; this.walls.push(r); return r; }
  groundYAt(x, z, refY = 1e9) {
    let bestBelow = null, bestBelowY = -Infinity, lowestAbove = null, lowestAboveY = Infinity;
    for (const g of this.grounds) {
      if (!g.enabled || x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) continue;
      let y = g.y;
      if (g.ramp) { const a = g.ramp.axis === 'x' ? x : z; const t = THREE.MathUtils.clamp((a - g.ramp.a0) / (g.ramp.a1 - g.ramp.a0), 0, 1); y = g.ramp.y0 + (g.ramp.y1 - g.ramp.y0) * t; }
      if (y <= refY + .55) { if (y > bestBelowY) { bestBelowY = y; bestBelow = g; } }
      else if (y < lowestAboveY) { lowestAboveY = y; lowestAbove = g; }
    }
    if (bestBelow) return { y: bestBelowY, ground: bestBelow };
    if (lowestAbove) return { y: lowestAboveY, ground: lowestAbove, above: true };
    return null;
  }
  resolveWalls(pos, radius, feetY, height = 1.7) {
    for (const w of this.walls) {
      if (!w.enabled) continue;
      if (w.y1 <= feetY + .55 || w.y0 >= feetY + height - .05) continue; // steppable / overhead
      const nx = Math.max(w.x0, Math.min(pos.x, w.x1)), nz = Math.max(w.z0, Math.min(pos.z, w.z1));
      let dx = pos.x - nx, dz = pos.z - nz; const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-9) { const d = Math.sqrt(d2); pos.x = nx + dx / d * radius; pos.z = nz + dz / d * radius; }
      else { // centre inside the box: push along the smallest exit
        const exits = [pos.x - (w.x0 - radius), (w.x1 + radius) - pos.x, pos.z - (w.z0 - radius), (w.z1 + radius) - pos.z];
        const m = Math.min(...exits);
        if (m === exits[0]) pos.x = w.x0 - radius; else if (m === exits[1]) pos.x = w.x1 + radius;
        else if (m === exits[2]) pos.z = w.z0 - radius; else pos.z = w.z1 + radius;
      }
    }
  }
}

const V = () => new THREE.Vector3();
export class Player {
  constructor(collision) {
    this.col = collision;
    this.pos = V();            // feet
    this.yaw = 0; this.pitch = 0;
    this.vy = 0; this.grounded = true;
    this.radius = .34; this.eye = 1.62; this.height = 1.72;
    this.walkSpeed = 3.3; this.sprintSpeed = 6.6;
    this.bobPhase = 0; this.bobAmp = 0; this.speedSm = 0;
    this.onFootstep = null; this._stepSide = 0;
    this.vel = V(); // horizontal velocity (smoothed)
  }
  teleport(x, y, z, yaw = 0, pitch = 0) { this.pos.set(x, y, z); this.yaw = yaw; this.pitch = pitch; this.vy = 0; this.vel.set(0, 0, 0); }
  forward(out = V()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  right(out = V()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  eyePos(out = V(), bobScale = 1) {
    const bobY = Math.sin(this.bobPhase * 2) * .021 * this.bobAmp * bobScale;
    const bobX = Math.cos(this.bobPhase) * .012 * this.bobAmp * bobScale;
    out.copy(this.pos); out.y += this.eye + bobY;
    const r = this.right(V()); out.addScaledVector(r, bobX);
    return out;
  }
  /** input: {f:-1..1 (forward+), r:-1..1 (right+), sprint} — ground-locked walking. */
  updateWalk(dt, input, bobScale = 1) {
    const speed = input.sprint ? this.sprintSpeed : this.walkSpeed;
    const f = V().set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = this.right(V());
    const wish = V().addScaledVector(f, input.f).addScaledVector(r, input.r);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    const accel = this.grounded ? 14 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    let dx = this.vel.x * dt, dz = this.vel.z * dt;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / .22)); // sub-step: no tunnelling at sprint speed
    dx /= steps; dz /= steps;
    for (let s = 0; s < steps; s++) {
      // X axis
      let nx = this.pos.x + dx;
      const probe = { x: nx, z: this.pos.z };
      this.col.resolveWalls(probe, this.radius, this.pos.y, this.height);
      let g = this.col.groundYAt(probe.x, probe.z, this.pos.y);
      if (g && !g.above) this.pos.x = probe.x; else this.vel.x = 0;
      // Z axis
      let nz = this.pos.z + dz;
      probe.x = this.pos.x; probe.z = nz;
      this.col.resolveWalls(probe, this.radius, this.pos.y, this.height);
      g = this.col.groundYAt(probe.x, probe.z, this.pos.y);
      if (g && !g.above) this.pos.z = probe.z; else this.vel.z = 0;
    }
    const g = this.col.groundYAt(this.pos.x, this.pos.z, this.pos.y);
    if (g && !g.above) {
      const dy = g.y - this.pos.y;
      this.pos.y += dy * Math.min(1, (dy > 0 ? 16 : 22) * dt + (Math.abs(dy) < .02 ? 1 : 0));
      if (Math.abs(g.y - this.pos.y) < .01) this.pos.y = g.y;
      this.grounded = true; this.vy = 0;
    } else this.grounded = false;
    // head bob + footsteps
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speedSm += (hSpeed - this.speedSm) * Math.min(1, 8 * dt);
    const moving = hSpeed > .4 && this.grounded;
    this.bobAmp += ((moving ? Math.min(1, hSpeed / this.walkSpeed) : 0) - this.bobAmp) * Math.min(1, 7 * dt);
    const prevPhase = this.bobPhase;
    this.bobPhase += dt * (4.4 + hSpeed * .85) * (moving ? 1 : 0);
    if (moving && Math.floor(this.bobPhase / Math.PI) !== Math.floor(prevPhase / Math.PI)) {
      this._stepSide ^= 1; this.onFootstep && this.onFootstep(input.sprint);
    }
    return hSpeed;
  }
  /** Free fall (scripted). Returns true when landed on an enabled ground. */
  updateFall(dt, gravity = 22, landCheck = true) {
    this.vy = Math.max(this.vy - gravity * dt, -46);
    this.pos.y += this.vy * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.vel.x *= (1 - .4 * dt); this.vel.z *= (1 - .4 * dt);
    if (!landCheck) return false;
    const g = this.col.groundYAt(this.pos.x, this.pos.z, this.pos.y + Math.abs(this.vy * dt) + .1);
    if (g && !g.above && this.pos.y <= g.y + .02) { this.pos.y = g.y; const landed = this.vy; this.vy = 0; this.grounded = true; return landed; }
    return false;
  }
}
