import { describe, it, expect } from 'vitest';
import { PerfMonitor, PERF } from '../src/core/perf.js';

/** Feed `seconds` of frames at a steady frame time. */
function feed(perf, seconds, ms, active = true) {
  const n = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) perf.frame(ms / 1000, active);
}

function monitor(maxRatio = 1) {
  const perf = new PerfMonitor(null, null);
  perf.setMax(maxRatio);
  perf.changes = [];
  perf.onRatio = (r) => perf.changes.push(r);
  perf.tooSlow = 0;
  perf.onTooSlow = () => perf.tooSlow++;
  return perf;
}

describe('dynamic resolution', () => {
  it('leaves a smooth 60 fps game alone', () => {
    const perf = monitor();
    feed(perf, 30, 16.7);
    expect(perf.changes).toEqual([]);
    expect(perf.ratio).toBe(1);
  });

  it('steps down further when frames are much slower', () => {
    const mild = monitor();
    feed(mild, 1.2, 22);
    const heavy = monitor();
    feed(heavy, 1.2, 50);
    expect(mild.ratio).toBeLessThan(1);
    expect(heavy.ratio).toBeLessThan(mild.ratio);
    expect(heavy.ratio).toBeGreaterThanOrEqual(PERF.minRatio);
  });

  it('reaches the minimum ratio within a few seconds on a very slow GPU', () => {
    const perf = monitor();
    feed(perf, 6, 60);
    expect(perf.ratio).toBeCloseTo(PERF.minRatio, 5);
  });

  it('asks for a cheaper preset when the minimum ratio is still too slow', () => {
    const perf = monitor();
    feed(perf, 6 + PERF.tooSlowHold + 1, 60);
    expect(perf.tooSlow).toBeGreaterThanOrEqual(1);
  });

  it('backs off its probes when stepping up keeps failing', () => {
    const perf = monitor();
    feed(perf, 1.2, 25); // step down
    const down = perf.changes.length;
    // Smooth until it probes up, then slow again: the probe fails.
    feed(perf, PERF.probeCooldown + 0.5, 16);
    expect(perf.changes.length).toBe(down + 1);
    feed(perf, 1.2, 25);
    expect(perf.changes.length).toBe(down + 2);
    // The next probe now waits twice as long.
    feed(perf, PERF.probeCooldown * 2 - 0.6, 16);
    expect(perf.changes.length).toBe(down + 2);
    feed(perf, 1, 16);
    expect(perf.changes.length).toBe(down + 3);
  });

  it('ignores slow frames while not playing', () => {
    const perf = monitor();
    feed(perf, 10, 60, false);
    expect(perf.changes).toEqual([]);
    expect(perf.tooSlow).toBe(0);
  });

  it('changes nothing when dynamic resolution is off', () => {
    const perf = monitor();
    perf.dynamic = false;
    feed(perf, 20, 60);
    expect(perf.changes).toEqual([]);
    expect(perf.tooSlow).toBe(0);
  });
});
