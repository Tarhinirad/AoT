import * as THREE from 'three';

export const PLAYER_CONFIG = {
  radius: 0.45,
  gravity: 22,
  walkSpeed: 10,
  groundAccel: 70,
  groundSlideDecel: 22,
  airSteerAccel: 13,
  jumpSpeed: 8.5,
  quadDrag: 0.0032, // terminal velocity around sqrt(g/k) ≈ 83 m/s
  maxSpeed: 90,
  impactDamageSpeed: 46, // colliding faster than this into a surface hurts
  impactDamageScale: 0.9,
  maxHealth: 100,
};

/**
 * Kinematic sphere body for the soldier. The game orchestrates each fixed step:
 * integrate() → rope constraints → collide(). External systems add
 * accelerations through `accel` before integrate().
 */
export class Player {
  constructor(spawn) {
    this.pos = new THREE.Vector3().copy(spawn);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.radius = PLAYER_CONFIG.radius;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundCollider = null;
    this.timeSinceGrounded = 0;
    this.airTime = 0;
    this.health = PLAYER_CONFIG.maxHealth;
    this.maxHealth = PLAYER_CONFIG.maxHealth;
    this.facingYaw = 0;
    this.pendingImpact = 0; // damage from crashes, collected by the game
    this.lastImpactSpeed = 0;
    this.alive = true;
    this.grabbed = false;
    this.grabImmunity = 0;
    this._contactN = new THREE.Vector3();
  }

  get speed() {
    return this.vel.length();
  }

  reset(spawn) {
    this.pos.copy(spawn);
    this.prevPos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.alive = true;
    this.grabbed = false;
    this.grabImmunity = 0;
    this.airTime = 0;
  }

  /**
   * @param {number} dt
   * @param {{wish: THREE.Vector3, jump: boolean, hooked: boolean, dragScale?: number}} intent
   *   wish: desired horizontal move direction (length 0..1, world space)
   *   dragScale: multiplier on air drag (ropes lower it so swings keep momentum)
   */
  integrate(dt, intent) {
    const C = PLAYER_CONFIG;
    this.prevPos.copy(this.pos);
    const v = this.vel;
    const onGround = this.grounded && !intent.hooked;

    // Gravity + external accelerations (hooks, gas)
    v.x += this.accel.x * dt;
    v.y += (this.accel.y - C.gravity) * dt;
    v.z += this.accel.z * dt;
    this.accel.set(0, 0, 0);

    if (onGround) {
      // Ground movement: approach target velocity; slide to a stop when fast.
      const tx = intent.wish.x * C.walkSpeed, tz = intent.wish.z * C.walkSpeed;
      const dx = tx - v.x, dz = tz - v.z;
      const horiz = Math.hypot(v.x, v.z);
      const rate = (horiz > C.walkSpeed + 1 ? C.groundSlideDecel : C.groundAccel) * dt;
      const dl = Math.hypot(dx, dz);
      if (dl > rate) {
        v.x += (dx / dl) * rate;
        v.z += (dz / dl) * rate;
      } else {
        v.x = tx;
        v.z = tz;
      }
      if (intent.jump) {
        v.y = Math.max(v.y, C.jumpSpeed);
        this.grounded = false;
      }
    } else {
      // Air steering
      v.x += intent.wish.x * C.airSteerAccel * dt;
      v.z += intent.wish.z * C.airSteerAccel * dt;
      if (intent.wish.y) v.y += intent.wish.y * C.airSteerAccel * dt;
    }

    // Quadratic air drag
    const sp = v.length();
    if (sp > 0.001) {
      const drag = Math.min(sp, C.quadDrag * (intent.dragScale ?? 1) * sp * sp * dt);
      v.multiplyScalar((sp - drag) / sp);
    }
    if (sp > C.maxSpeed) v.multiplyScalar(C.maxSpeed / sp);

    this.pos.addScaledVector(v, dt);
  }

  collide(colliders, dt) {
    const C = PLAYER_CONFIG;
    let grounded = false;
    let impact = 0;
    const v = this.vel;
    colliders.resolveSphere(this.pos, this.radius, (nx, ny, nz, depth, col) => {
      const vn = v.x * nx + v.y * ny + v.z * nz;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        // Remove the inward normal component (inelastic), keep tangential.
        v.x -= nx * vn;
        v.y -= ny * vn;
        v.z -= nz * vn;
      }
      if (ny > 0.6) {
        grounded = true;
        this.groundNormal.set(nx, ny, nz);
        this.groundCollider = col;
      }
    });
    // Keep inside a generous world boundary
    const LIM = 520;
    if (Math.abs(this.pos.x) > LIM) { this.pos.x = Math.sign(this.pos.x) * LIM; v.x = 0; }
    if (Math.abs(this.pos.z) > LIM) { this.pos.z = Math.sign(this.pos.z) * LIM; v.z = 0; }
    if (this.pos.y > 400) { this.pos.y = 400; v.y = Math.min(v.y, 0); }

    if (impact > C.impactDamageSpeed) {
      this.pendingImpact += (impact - C.impactDamageSpeed) * C.impactDamageScale;
    }
    this.lastImpactSpeed = impact;
    this.grounded = grounded;
    if (grounded) {
      this.timeSinceGrounded = 0;
      this.airTime = 0;
    } else {
      this.timeSinceGrounded += dt;
      this.airTime += dt;
    }
  }

  damage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.alive = false;
  }
}
