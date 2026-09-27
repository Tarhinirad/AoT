/**
 * Supply depots: stand (grounded, slow) on a depot platform for a moment to
 * refill gas and blades.
 */
export const DEPOT = {
  radius: 4.6,
  resupplyTime: 1.2,
  maxSpeed: 6,
};

export class Depots {
  constructor(list) {
    this.list = list.map((d) => ({ x: d.x, z: d.z }));
    this.progress = 0;
    this.active = null;
    this.events = [];
  }

  nearest(pos) {
    let best = null, bd = Infinity;
    for (const d of this.list) {
      const dd = Math.hypot(d.x - pos.x, d.z - pos.z);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return { depot: best, dist: bd };
  }

  /** @returns {boolean} true on the step the resupply completes */
  update(dt, player, needsSupply) {
    const onDepot = player.grounded && player.groundCollider?.tag === 'depot' && player.speed < DEPOT.maxSpeed;
    if (!onDepot || !needsSupply) {
      this.progress = Math.max(0, this.progress - dt * 2);
      this.active = null;
      return false;
    }
    this.active = this.nearest(player.pos).depot;
    this.progress += dt;
    if (this.progress >= DEPOT.resupplyTime) {
      this.progress = 0;
      this.events.push({ type: 'resupply' });
      return true;
    }
    return false;
  }
}
