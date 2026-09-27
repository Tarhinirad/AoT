/**
 * Pure rope/pendulum math. Vectors are any {x, y, z} objects (THREE.Vector3
 * works). Kept free of rendering so it is unit tested in isolation.
 *
 * Model: each attached hook is an inextensible rope with a *maximum* length.
 * When the body is farther than that length the position is projected back
 * onto the sphere around the anchor and the outward radial velocity is
 * removed. Tangential velocity is untouched, which is exactly pendulum motion
 * with momentum preserved. Slack is taken up by the winch automatically, so
 * the rope never lengthens.
 */

export const GRAPPLE = {
  hookSpeed: 340, // m/s projectile speed
  maxRange: 110, // m
  minLength: 1.2, // m, rope can't get shorter than this
  retractSpeed: 320,
  tensionAccel: 9, // free passive pull toward anchor (m/s^2)
  reelAccel: 44, // holding the hook button (uses gas)
  reelGasRate: 3.5, // gas/s per reeling hook
  boostAccel: 36, // Space while hooked (uses gas)
  boostGasRate: 12,
  freeBoostAccel: 24, // Space airborne without hooks
  freeBoostGasRate: 14,
  fireGasCost: 0.5,
  liftOffSpeed: 7, // hop off the ground when reeling/boosting while grounded
  gasMax: 100,
  // Swing control: WASD while hooked pushes along the swing arc (perpendicular to the rope).
  swingSteerAccel: 24,
  hookedDragScale: 0.55, // less air drag while on a rope so swings keep their energy
  // Soft arrival: while reeling toward a static anchor, the approach speed is
  // capped to what can still be braked (at arrivalBrake) before reaching it, so
  // you glide up to the wall instead of slamming into it. Close in, sideways
  // motion is damped too so a shrinking rope doesn't spin you around the anchor.
  arrivalBrake: 55, // m/s^2
  arrivalStop: 1.5, // m from the anchor where the approach should end
  arrivalSpinDist: 7,
  arrivalSpinDamp: 5,
  // Slingshot: letting go of both ropes at speed adds a small push along your motion.
  releaseBoostMin: 14, // m/s, below this there is no boost
  releaseBoostScale: 0.12,
  releaseBoostMax: 6,
  releaseLift: 2.5,
  // Gas recharge: tops up to gasRegenCap after a short pause in gas use,
  // and all the way while standing still on the ground (anti soft-lock).
  gasRegen: 4,
  gasRegenDelay: 1.2,
  gasRegenCap: 45,
  groundRegen: 6,
  pullFadeNear: 1.5, // pull fades out within this distance of the anchor
  pullFadeFar: 4.0,
};

/**
 * Enforce the max-length constraint. Mutates pos and vel.
 * @returns {number} outward radial speed removed (>= 0), i.e. the "tension impulse".
 */
export function applyRopeConstraint(pos, vel, anchor, length) {
  const dx = pos.x - anchor.x, dy = pos.y - anchor.y, dz = pos.z - anchor.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist <= length || dist < 1e-9) return 0;
  const nx = dx / dist, ny = dy / dist, nz = dz / dist;
  pos.x = anchor.x + nx * length;
  pos.y = anchor.y + ny * length;
  pos.z = anchor.z + nz * length;
  const vr = vel.x * nx + vel.y * ny + vel.z * nz;
  if (vr > 0) {
    vel.x -= nx * vr;
    vel.y -= ny * vr;
    vel.z -= nz * vr;
    return vr;
  }
  return 0;
}

/** Winch: rope length only ever shortens toward the current distance. */
export function takeUpSlack(length, dist, minLength = GRAPPLE.minLength) {
  return Math.max(minLength, Math.min(length, dist));
}

/** Pull strength multiplier that fades out right next to the anchor to avoid jitter. */
export function pullFade(dist, near = GRAPPLE.pullFadeNear, far = GRAPPLE.pullFadeFar) {
  if (dist <= near) return 0;
  if (dist >= far) return 1;
  const t = (dist - near) / (far - near);
  return t * t * (3 - 2 * t);
}

/**
 * Acceleration toward the anchor for a hook in a given mode.
 * @param {{reeling: boolean, boosting: boolean, hasGas: boolean}} mode
 * @returns {number} scalar acceleration toward the anchor
 */
export function hookPullAccel(dist, mode, cfg = GRAPPLE) {
  let a = cfg.tensionAccel;
  if (mode.hasGas && mode.reeling) a += cfg.reelAccel;
  if (mode.hasGas && mode.boosting) a += cfg.boostAccel;
  return a * pullFade(dist);
}

/** Direction for gas boost: toward the anchors, nudged along the camera look. */
export function boostDirection(anchorDirs, lookDir, out) {
  out.x = 0; out.y = 0; out.z = 0;
  for (const d of anchorDirs) {
    out.x += d.x; out.y += d.y; out.z += d.z;
  }
  const k = anchorDirs.length ? 0.35 : 1;
  out.x += lookDir.x * k;
  out.y += lookDir.y * k + (anchorDirs.length ? 0 : 0.35);
  out.z += lookDir.z * k;
  const l = Math.hypot(out.x, out.y, out.z);
  if (l > 1e-9) {
    out.x /= l; out.y /= l; out.z /= l;
  }
  return out;
}

/** Drain gas; returns the new amount and whether the requested draw was satisfied. */
export function drainGas(gas, rate, dt) {
  const need = rate * dt;
  if (gas <= 0) return { gas: 0, ok: false };
  if (gas < need) return { gas: 0, ok: true };
  return { gas: gas - need, ok: true };
}

/**
 * Swing steering: the component of the steering wish perpendicular to the
 * rope (i.e. along the swing arc). Pushing straight toward or away from the
 * anchor does nothing, so steering never fights the rope. The downward part
 * is dropped (gravity already provides it), so steering only ever lifts or
 * pushes you sideways/forward along the arc.
 * @param {{x,y,z}} wish     desired direction (length 0..1)
 * @param {{x,y,z}} ropeDir  unit vector from the body toward the anchor
 */
export function swingSteer(wish, ropeDir, out) {
  const d = wish.x * ropeDir.x + wish.y * ropeDir.y + wish.z * ropeDir.z;
  out.x = wish.x - ropeDir.x * d;
  out.y = Math.max(0, wish.y - ropeDir.y * d);
  out.z = wish.z - ropeDir.z * d;
  return out;
}

/** Highest approach speed toward an anchor that can still brake to a stop before it. */
export function softArrivalLimit(dist, cfg = GRAPPLE) {
  return 2 + Math.sqrt(2 * cfg.arrivalBrake * Math.max(0, dist - cfg.arrivalStop));
}

/**
 * Soft arrival while reeling: clamp the speed toward the anchor to the braking
 * limit, and near the anchor bleed off sideways speed. Mutates vel.
 * @returns {number} approach speed removed (>= 0)
 */
export function applySoftArrival(vel, dirToAnchor, dist, dt = 0, cfg = GRAPPLE) {
  const limit = softArrivalLimit(dist, cfg);
  let vIn = vel.x * dirToAnchor.x + vel.y * dirToAnchor.y + vel.z * dirToAnchor.z;
  let cut = 0;
  if (vIn > limit) {
    cut = vIn - limit;
    vel.x -= dirToAnchor.x * cut;
    vel.y -= dirToAnchor.y * cut;
    vel.z -= dirToAnchor.z * cut;
    vIn = limit;
  }
  // The damping zone grows with speed: a fast body needs more room to settle.
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  const zone = Math.max(cfg.arrivalSpinDist, speed * 0.3);
  if (dt > 0 && dist < zone) {
    const k = 1 - Math.exp(-cfg.arrivalSpinDamp * dt * (1 - dist / zone) * 2);
    vel.x -= (vel.x - dirToAnchor.x * vIn) * k;
    vel.y -= (vel.y - dirToAnchor.y * vIn) * k;
    vel.z -= (vel.z - dirToAnchor.z * vIn) * k;
  }
  return cut;
}

/** Extra speed granted when letting go of the ropes at speed (0 when slow). */
export function releaseBoostAmount(speed, cfg = GRAPPLE) {
  if (speed <= cfg.releaseBoostMin) return 0;
  return Math.min(cfg.releaseBoostMax, (speed - cfg.releaseBoostMin) * cfg.releaseBoostScale);
}

/**
 * Passive gas recharge.
 * @param {number} idleT seconds since gas was last spent
 * @param {boolean} restingOnGround standing still on the ground
 */
export function regenGas(gas, idleT, restingOnGround, dt, cfg = GRAPPLE) {
  if (restingOnGround) gas = Math.min(cfg.gasMax, gas + cfg.groundRegen * dt);
  if (idleT >= cfg.gasRegenDelay && gas < cfg.gasRegenCap) gas = Math.min(cfg.gasRegenCap, gas + cfg.gasRegen * dt);
  return gas;
}

/** Small-angle pendulum period, used as a reference in tests. */
export function pendulumPeriod(length, gravity) {
  return 2 * Math.PI * Math.sqrt(length / gravity);
}
