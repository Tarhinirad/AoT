import { describe, it, expect } from 'vitest';
import { waveComposition, WaveDirector, WAVES } from '../src/game/waves.js';
import { killScore, comboMultiplier, waveClearBonus, ScoreKeeper, SCORE } from '../src/game/score.js';
import { createRng } from '../src/core/rng.js';

describe('waveComposition', () => {
  it('starts small and escalates', () => {
    const w1 = waveComposition(1);
    expect(w1.every((v) => v === 'small')).toBe(true);
    for (let n = 2; n <= WAVES.total; n++) {
      expect(waveComposition(n).length).toBeGreaterThanOrEqual(waveComposition(n - 1).length);
    }
  });

  it('introduces large giants and abnormals in later waves', () => {
    expect(waveComposition(2)).not.toContain('large');
    expect(waveComposition(3)).toContain('large');
    expect(waveComposition(3)).not.toContain('abnormal');
    expect(waveComposition(4)).toContain('abnormal');
    expect(waveComposition(10).filter((v) => v === 'abnormal').length).toBeGreaterThan(1);
  });
});

describe('WaveDirector', () => {
  it('runs intermission → active → cleared → next wave', () => {
    const d = new WaveDirector(createRng(1));
    const spawned = [];
    d.update(WAVES.firstDelay + 0.01, 0, (v) => spawned.push(v));
    expect(d.phase).toBe('active');
    expect(d.wave).toBe(1);
    // Spawn everything, respecting intervals.
    let alive = 0;
    for (let i = 0; i < 100 && d.remainingToSpawn; i++) d.update(1, alive, (v) => { spawned.push(v); alive++; });
    expect(spawned.length).toBe(waveComposition(1).length);
    d.events.length = 0;
    d.update(0.1, 0, () => {});
    expect(d.events.map((e) => e.type)).toContain('waveCleared');
    expect(d.phase).toBe('intermission');
  });

  it('caps the number of simultaneously alive giants', () => {
    const d = new WaveDirector(createRng(2));
    d.wave = 9;
    d.update(WAVES.firstDelay + 1, 0, () => {});
    let n = 0;
    for (let i = 0; i < 200; i++) d.update(1, WAVES.maxAlive, () => n++);
    expect(n).toBe(0);
  });

  it('declares victory after the last wave', () => {
    const d = new WaveDirector(createRng(3));
    d.wave = WAVES.total - 1;
    d.update(WAVES.firstDelay + 1, 0, () => {});
    for (let i = 0; i < 200 && d.remainingToSpawn; i++) d.update(10, 0, () => {});
    d.update(0.1, 0, () => {});
    expect(d.phase).toBe('victory');
    expect(d.events.map((e) => e.type)).toContain('victory');
  });
});

describe('scoring', () => {
  const base = { variant: 'medium', speed: 10, airTime: 0, oneCut: false, health: 100, combo: 1 };

  it('awards the variant base score', () => {
    expect(killScore(base).total).toBe(SCORE.base.medium);
    expect(killScore({ ...base, variant: 'abnormal' }).total).toBeGreaterThan(killScore({ ...base, variant: 'large' }).total);
  });

  it('rewards speed and style', () => {
    const fancy = killScore({ ...base, speed: 45, airTime: 6, oneCut: true, health: 10 });
    const labels = fancy.parts.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['SPEED', 'AIRBORNE', 'ONE CUT', 'CLOSE CALL']));
    expect(fancy.total).toBeGreaterThan(killScore(base).total * 2);
  });

  it('multiplies chained kills and caps the combo', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(3)).toBeCloseTo(1.5);
    expect(comboMultiplier(100)).toBe(SCORE.maxCombo);
  });

  it('gives faster wave clears a bigger bonus', () => {
    expect(waveClearBonus(3, 30)).toBeGreaterThan(waveClearBonus(3, 80));
    expect(waveClearBonus(3, 1000)).toBe(SCORE.waveClearPerWave * 3);
  });

  it('ScoreKeeper tracks combos within the window', () => {
    const s = new ScoreKeeper();
    s.tick(1, 0);
    s.registerKill(base);
    s.tick(3, 0);
    s.registerKill(base);
    expect(s.combo).toBe(2);
    s.tick(SCORE.comboWindow + 1, 0);
    expect(s.combo).toBe(0);
    s.registerKill(base);
    expect(s.combo).toBe(1);
    expect(s.bestCombo).toBe(2);
    expect(s.kills).toBe(3);
    expect(s.score).toBeGreaterThan(3 * SCORE.base.medium);
  });
});
