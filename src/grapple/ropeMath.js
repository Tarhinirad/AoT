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
  hookSpeed: 200, // m/s projectile speed
  maxRange: 95, // m
  minLength: 1.2, // m, rope can't get shorter than this
  retractSpeed: 260,
  tensionAccel: 7, // free passive pull toward anchor (m/s^2)
  reelAccel: 38, // holding the hook button (uses gas)
  reelGasRate: 4, // gas/s per reeling hook
  boostAccel: 36, // Space while hooked (uses gas)
  boostGasRate: 14,
  freeBoostAccel: 22, // Space airborne without hooks
  freeBoostGasRate: 16,
  fireGasCost: 0.6,
  liftOffSpeed: 7, // hop off the ground when reeling/boosting while grounded
  gasMax: 100,
  groundRegen: 2.5, // gas/s while standing still on the ground (anti soft-lock)
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

/** Small-angle pendulum period, used as a reference in tests. */
export function pendulumPeriod(length, gravity) {
  return 2 * Math.PI * Math.sqrt(length / gravity);
}
