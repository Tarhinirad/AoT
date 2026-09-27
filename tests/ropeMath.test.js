import { describe, it, expect } from 'vitest';
import {
  applyRopeConstraint, takeUpSlack, pullFade, hookPullAccel, boostDirection, drainGas, pendulumPeriod, GRAPPLE,
  swingSteer, softArrivalLimit, applySoftArrival, releaseBoostAmount, regenGas,
} from '../src/grapple/ropeMath.js';

const v = (x, y, z) => ({ x, y, z });
const len = (a) => Math.hypot(a.x, a.y, a.z);

describe('applyRopeConstraint', () => {
  it('does nothing while the rope is slack', () => {
    const pos = v(0, -5, 0), vel = v(3, -2, 0);
    expect(applyRopeConstraint(pos, vel, v(0, 0, 0), 10)).toBe(0);
    expect(pos).toEqual(v(0, -5, 0));
    expect(vel).toEqual(v(3, -2, 0));
  });

  it('projects the body back to the rope length', () => {
    const pos = v(0, -12, 0), vel = v(0, 0, 0);
    applyRopeConstraint(pos, vel, v(0, 0, 0), 10);
    expect(pos.y).toBeCloseTo(-10);
  });

  it('removes only the outward radial velocity and keeps tangential momentum', () => {
    const pos = v(0, -11, 0), vel = v(7, -4, 0);
    const removed = applyRopeConstraint(pos, vel, v(0, 0, 0), 10);
    expect(removed).toBeCloseTo(4);
    expect(vel.x).toBeCloseTo(7);
    expect(vel.y).toBeCloseTo(0);
  });

  it('does not remove inward velocity', () => {
    const pos = v(0, -11, 0), vel = v(0, 5, 0);
    applyRopeConstraint(pos, vel, v(0, 0, 0), 10);
    expect(vel.y).toBeCloseTo(5);
  });
});

describe('pendulum behaviour', () => {
  function simulate(L, theta0, seconds, g = 22, dt = 1 / 120) {
    const anchor = v(0, 0, 0);
    const pos = v(Math.sin(theta0) * L, -Math.cos(theta0) * L, 0);
    const vel = v(0, 0, 0);
    const xs = [];
    const energy0 = g * pos.y;
    for (let t = 0; t < seconds; t += dt) {
      vel.y -= g * dt;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      applyRopeConstraint(pos, vel, anchor, L);
      xs.push(pos.x);
    }
    const energy = 0.5 * (vel.x ** 2 + vel.y ** 2) + g * pos.y;
    return { xs, pos, energy0, energy, dt };
  }

  it('stays on the rope sphere', () => {
    const { pos } = simulate(12, 0.8, 5);
    expect(len(pos)).toBeCloseTo(12, 3);
  });

  it('matches the small-angle period', () => {
    const L = 10, g = 22;
    const { xs, dt } = simulate(L, 0.1, 6, g);
    // Find downward zero crossings of x to measure the period.
    const crossings = [];
    for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] <= 0) crossings.push(i * dt);
    const period = crossings[1] - crossings[0];
    expect(period).toBeCloseTo(pendulumPeriod(L, g), 1);
  });

  it('loses little energy over a swing (momentum preserved)', () => {
    const { energy0, energy } = simulate(15, 1.0, 3);
    expect(Math.abs(energy - energy0) / Math.abs(energy0)).toBeLessThan(0.08);
  });
});

describe('winch and pull', () => {
  it('only shortens the rope and respects the minimum length', () => {
    expect(takeUpSlack(20, 15)).toBe(15);
    expect(takeUpSlack(20, 25)).toBe(20);
    expect(takeUpSlack(20, 0.2)).toBe(GRAPPLE.minLength);
  });

  it('fades pull near the anchor', () => {
    expect(pullFade(0.5)).toBe(0);
    expect(pullFade(10)).toBe(1);
    const mid = pullFade(2.75);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('reeling and boosting add acceleration only with gas', () => {
    const base = hookPullAccel(20, { reeling: false, boosting: false, hasGas: true });
    const reel = hookPullAccel(20, { reeling: true, boosting: false, hasGas: true });
    const boost = hookPullAccel(20, { reeling: true, boosting: true, hasGas: true });
    const empty = hookPullAccel(20, { reeling: true, boosting: true, hasGas: false });
    expect(base).toBe(GRAPPLE.tensionAccel);
    expect(reel).toBeGreaterThan(base);
    expect(boost).toBeGreaterThan(reel);
    expect(empty).toBe(base);
  });
});

describe('boost direction and gas', () => {
  it('points between two anchors, nudged by look direction', () => {
    const out = v(0, 0, 0);
    boostDirection([v(1, 0, 0), v(0, 0, 1)], v(0, 0, 0), out);
    expect(out.x).toBeCloseTo(Math.SQRT1_2);
    expect(out.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('uses the look direction (with lift) when no hook is attached', () => {
    const out = v(0, 0, 0);
    boostDirection([], v(0, 0, -1), out);
    expect(out.z).toBeLessThan(-0.9);
    expect(out.y).toBeGreaterThan(0);
    expect(len(out)).toBeCloseTo(1);
  });

  it('drains gas and refuses when empty', () => {
    expect(drainGas(10, 5, 1)).toEqual({ gas: 5, ok: true });
    expect(drainGas(0, 5, 1)).toEqual({ gas: 0, ok: false });
    expect(drainGas(2, 5, 1)).toEqual({ gas: 0, ok: true });
  });
});

describe('swing control', () => {
  it('steers along the arc, never along the rope', () => {
    const out = v(0, 0, 0);
    // Hanging straight below the anchor: horizontal steering passes through unchanged.
    swingSteer(v(1, 0, 0), v(0, 1, 0), out);
    expect(out).toEqual(v(1, 0, 0));
    // Pushing straight at the anchor does nothing.
    swingSteer(v(0, 0, -1), v(0, 0, -1), out);
    expect(len(out)).toBeCloseTo(0);
  });

  it('never pushes the body downward', () => {
    const out = v(0, 0, 0);
    const up = Math.SQRT1_2;
    swingSteer(v(0, 0, -1), v(0, up, -up), out);
    expect(out.y).toBe(0);
    // Past the anchor, forward steering lifts you up the back of the arc.
    swingSteer(v(0, 0, -1), v(0, up, up), out);
    expect(out.y).toBeGreaterThan(0);
    expect(out.z).toBeLessThan(0);
  });
});

describe('soft arrival', () => {
  it('allows fast approaches far away and slow ones close in', () => {
    expect(softArrivalLimit(60)).toBeGreaterThan(70);
    expect(softArrivalLimit(GRAPPLE.arrivalStop)).toBe(2);
    expect(softArrivalLimit(5)).toBeLessThan(softArrivalLimit(10));
  });

  it('removes only the excess speed toward the anchor when far from it', () => {
    const vel = v(5, 0, -80);
    const cut = applySoftArrival(vel, v(0, 0, -1), 30, 1 / 120);
    const limit = softArrivalLimit(30);
    expect(cut).toBeCloseTo(80 - limit);
    expect(vel.z).toBeCloseTo(-limit);
    expect(vel.x).toBe(5);
  });

  it('bleeds off sideways speed right next to the anchor', () => {
    const vel = v(20, 0, 0);
    applySoftArrival(vel, v(0, 0, -1), 1.5, 1 / 120);
    expect(vel.x).toBeLessThan(20);
    expect(vel.x).toBeGreaterThan(15);
  });

  it('leaves slow or receding motion alone', () => {
    const vel = v(0, 0, 3);
    expect(applySoftArrival(vel, v(0, 0, -1), 1)).toBe(0);
    expect(vel.z).toBe(3);
  });
});

describe('slingshot release and gas recharge', () => {
  it('gives no boost when slow and a capped boost when fast', () => {
    expect(releaseBoostAmount(GRAPPLE.releaseBoostMin - 1)).toBe(0);
    expect(releaseBoostAmount(GRAPPLE.releaseBoostMin + 10)).toBeCloseTo(10 * GRAPPLE.releaseBoostScale);
    expect(releaseBoostAmount(500)).toBe(GRAPPLE.releaseBoostMax);
  });

  it('recharges only after a pause, and only up to the cap in the air', () => {
    expect(regenGas(10, 0, false, 1)).toBe(10);
    expect(regenGas(10, GRAPPLE.gasRegenDelay, false, 1)).toBeCloseTo(10 + GRAPPLE.gasRegen);
    expect(regenGas(GRAPPLE.gasRegenCap, 5, false, 1)).toBe(GRAPPLE.gasRegenCap);
    expect(regenGas(GRAPPLE.gasRegenCap + 10, 5, false, 1)).toBe(GRAPPLE.gasRegenCap + 10);
  });

  it('refills the whole tank while resting on the ground', () => {
    let gas = 80;
    for (let i = 0; i < 100; i++) gas = regenGas(gas, 5, true, 0.1);
    expect(gas).toBe(GRAPPLE.gasMax);
  });
});
