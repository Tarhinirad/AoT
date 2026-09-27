import { describe, it, expect } from 'vitest';
import {
  COMBAT, sharpness, slashDamage, bladeWear, napeHealth, limbHealth, oneShotSpeed, hitStopDuration,
} from '../src/combat/damage.js';
import { Blades } from '../src/combat/blades.js';

describe('slash damage', () => {
  it('scales with impact speed', () => {
    const slow = slashDamage(5, 100, 'nape');
    const fast = slashDamage(40, 100, 'nape');
    expect(fast).toBeGreaterThan(slow * 3);
    expect(slashDamage(0, 100, 'nape')).toBe(COMBAT.baseDamage);
  });

  it('ignores negative speed', () => {
    expect(slashDamage(-10, 100, 'nape')).toBe(slashDamage(0, 100, 'nape'));
  });

  it('is strongest at the nape and weakest on the body', () => {
    const s = 30;
    expect(slashDamage(s, 100, 'nape')).toBeGreaterThan(slashDamage(s, 100, 'limb'));
    expect(slashDamage(s, 100, 'limb')).toBeGreaterThan(slashDamage(s, 100, 'head'));
    expect(slashDamage(s, 100, 'head')).toBeGreaterThan(slashDamage(s, 100, 'body'));
    expect(slashDamage(s, 100, 'unknown')).toBe(0);
  });

  it('falls off with dull blades and is zero with broken blades', () => {
    expect(slashDamage(30, 20, 'nape')).toBeLessThan(slashDamage(30, 100, 'nape'));
    expect(slashDamage(30, 0, 'nape')).toBe(0);
  });
});

describe('sharpness and wear', () => {
  it('maps durability to [minSharpness, 1]', () => {
    expect(sharpness(100)).toBe(1);
    expect(sharpness(1)).toBeGreaterThan(COMBAT.minSharpness - 1e-9);
    expect(sharpness(0)).toBe(0);
  });

  it('wears faster on bone and at speed', () => {
    expect(bladeWear(30, 'body')).toBeGreaterThan(bladeWear(30, 'nape'));
    expect(bladeWear(40, 'nape')).toBeGreaterThan(bladeWear(10, 'nape'));
  });
});

describe('giant health', () => {
  it('grows with giant height', () => {
    expect(napeHealth(15)).toBeGreaterThan(napeHealth(4));
    expect(limbHealth(15)).toBeGreaterThan(limbHealth(4));
  });

  it('requires a fast pass to one-shot a 15 m giant but not a 4 m one', () => {
    expect(oneShotSpeed(15)).toBeGreaterThan(30);
    expect(oneShotSpeed(4)).toBeLessThan(15);
    const v = oneShotSpeed(15);
    expect(slashDamage(v + 0.5, 100, 'nape')).toBeGreaterThanOrEqual(napeHealth(15));
  });

  it('hit-stop is bounded and longer on kills', () => {
    expect(hitStopDuration(100, true)).toBeGreaterThan(hitStopDuration(100, false));
    expect(hitStopDuration(10000, true)).toBeLessThanOrEqual(0.16);
  });
});

describe('Blades', () => {
  it('dulls on each strike and breaks eventually', () => {
    const b = new Blades(1);
    let broke = false;
    let n = 0;
    while (!broke && n < 100) {
      broke = b.strike(30, 'nape');
      n++;
    }
    expect(broke).toBe(true);
    expect(n).toBeGreaterThan(3);
    expect(b.broken).toBe(true);
    expect(b.strike(30, 'nape')).toBe(false);
  });

  it('swaps to fresh blades while spares last', () => {
    const b = new Blades(1);
    b.strike(40, 'body');
    expect(b.swap()).toBe(true);
    expect(b.durability).toBe(b.max);
    expect(b.spares).toBe(0);
    expect(b.swap()).toBe(false);
    b.refill();
    expect(b.spares).toBe(b.maxSpares);
  });
});
