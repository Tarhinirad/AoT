/**
 * Pure combat math: slash damage from impact speed, blade wear and sharpness,
 * and giant health pools. Unit tested.
 */
export const COMBAT = {
  baseDamage: 10,
  speedDamage: 3.2, // damage per m/s of impact speed
  partMultiplier: { nape: 1.0, limb: 0.85, head: 0.35, body: 0.2 },
  minSharpness: 0.35,
  wearBase: 7,
  wearPerSpeed: 0.22,
  wearHardMultiplier: 1.4, // body/head hits hit bone and dull faster
  bladeMax: 100,
  spares: 4,
  slashCooldown: 0.32,
  slashWindow: 0.14,
  slashRadius: 2.3,
  hitStopBase: 0.05,
};

/** Blade effectiveness from durability; broken blades do nothing. */
export function sharpness(durability, max = COMBAT.bladeMax) {
  if (durability <= 0) return 0;
  const t = Math.min(1, durability / max);
  return COMBAT.minSharpness + (1 - COMBAT.minSharpness) * t;
}

/**
 * Damage from a slash.
 * @param {number} speed player speed at impact (m/s)
 * @param {number} durability current blade durability
 * @param {'nape'|'limb'|'head'|'body'} part
 */
export function slashDamage(speed, durability, part) {
  const mult = COMBAT.partMultiplier[part] ?? 0;
  const raw = COMBAT.baseDamage + Math.max(0, speed) * COMBAT.speedDamage;
  return Math.round(raw * mult * sharpness(durability));
}

/** Durability lost by a strike. */
export function bladeWear(speed, part) {
  const hard = part === 'body' || part === 'head';
  const w = COMBAT.wearBase + Math.max(0, speed) * COMBAT.wearPerSpeed;
  return w * (hard ? COMBAT.wearHardMultiplier : 1);
}

/** Nape health: bigger giants need faster strikes. */
export function napeHealth(height) {
  return Math.round(30 + height * 6);
}

/** Limb health before it is severed. */
export function limbHealth(height) {
  return Math.round(25 + height * 4);
}

/** Minimum speed needed to one-shot a nape with fresh blades. */
export function oneShotSpeed(height) {
  return Math.max(0, (napeHealth(height) - COMBAT.baseDamage) / COMBAT.speedDamage);
}

/** Hit-stop duration scales with how hard the hit was. */
export function hitStopDuration(damage, killed) {
  return Math.min(0.16, COMBAT.hitStopBase + damage * 0.0005 + (killed ? 0.06 : 0));
}
