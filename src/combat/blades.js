import { COMBAT, bladeWear, sharpness } from './damage.js';

/** Dual blade pair with durability, plus a stock of spare pairs. */
export class Blades {
  constructor(spares = COMBAT.spares) {
    this.max = COMBAT.bladeMax;
    this.durability = this.max;
    this.spares = spares;
    this.maxSpares = spares;
  }

  get broken() {
    return this.durability <= 0;
  }

  get sharpness() {
    return sharpness(this.durability, this.max);
  }

  /** Apply wear for a strike. Returns true if the blades broke on this hit. */
  strike(speed, part) {
    if (this.broken) return false;
    this.durability = Math.max(0, this.durability - bladeWear(speed, part));
    return this.durability <= 0;
  }

  /** Swap to a fresh pair. Returns false when no spares remain. */
  swap() {
    if (this.spares <= 0) return false;
    this.spares--;
    this.durability = this.max;
    return true;
  }

  refill() {
    this.spares = this.maxSpares;
    this.durability = this.max;
  }
}
