import * as THREE from 'three';
import { Blades } from './blades.js';
import { COMBAT, slashDamage, hitStopDuration } from './damage.js';

const center = new THREE.Vector3();
const dir = new THREE.Vector3();
const toHb = new THREE.Vector3();

/**
 * Slash handling: a short active window after pressing slash during which a
 * sphere in front of the player is tested against giant hitboxes each step.
 * The nape wins if it overlaps; each giant can be hit once per slash.
 */
export class CombatSystem {
  constructor() {
    this.blades = new Blades();
    this.cooldown = 0;
    this.window = 0;
    this.hitThisSlash = new Set();
    this.events = []; // {type:'slash'|'hit'|'kill'|'sever'|'broken'|'swap'|'noSpares'|'dullHit', ...}
    this.slashCenter = new THREE.Vector3();
  }

  reset() {
    this.blades.refill();
    this.cooldown = 0;
    this.window = 0;
  }

  trySlash() {
    if (this.cooldown > 0) return false;
    this.cooldown = COMBAT.slashCooldown;
    this.window = COMBAT.slashWindow;
    this.hitThisSlash.clear();
    this.events.push({ type: 'slash', broken: this.blades.broken });
    return true;
  }

  trySwap() {
    if (this.blades.durability >= this.blades.max) return false;
    if (this.blades.swap()) {
      this.events.push({ type: 'swap' });
      return true;
    }
    this.events.push({ type: 'noSpares' });
    return false;
  }

  step(dt, player, lookDir, giants) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.window <= 0) return;
    this.window -= dt;
    const speed = player.speed;
    if (speed > 4) dir.copy(player.vel).divideScalar(speed);
    else dir.copy(lookDir);
    center.copy(player.pos).addScaledVector(dir, 1.1);
    this.slashCenter.copy(center);
    const R = COMBAT.slashRadius;

    for (const g of giants) {
      if (!g.alive || this.hitThisSlash.has(g)) continue;
      // Broad phase
      const dx = center.x - g.pos.x, dz = center.z - g.pos.z;
      if (dx * dx + dz * dz > (g.H * 0.8 + R) ** 2) continue;
      let best = null, bestScore = Infinity;
      for (const hb of g.rig.hitboxes) {
        if (!g.hitboxActive(hb)) continue;
        toHb.subVectors(hb.world, center);
        const d = toHb.length() - hb.radius;
        if (d > R) continue;
        // Prefer the nape, then limbs, then whatever is closest.
        const pri = hb.kind === 'nape' ? -100 : hb.kind === 'limb' ? -10 : 0;
        const score = pri + d;
        if (score < bestScore) {
          bestScore = score;
          best = hb;
        }
      }
      if (!best) continue;
      this.hitThisSlash.add(g);
      const part = best.kind;
      const durability = this.blades.durability;
      const damage = slashDamage(speed, durability, part);
      const broke = this.blades.strike(speed, part);
      const oneCut = part === 'nape' && g.napeHP >= g.napeMax;
      const res = g.applyHit(best, damage, dir);
      const stop = hitStopDuration(damage, res.killed);
      this.events.push({
        type: res.killed ? 'kill' : 'hit',
        giant: g,
        part,
        damage,
        speed,
        severed: res.severed,
        point: best.world.clone(),
        hitStop: stop,
        oneCut,
        broken: durability <= 0,
      });
      if (broke) this.events.push({ type: 'broken' });
    }
  }
}
