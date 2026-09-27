/**
 * Scoring: kills (by variant), speed, and style bonuses, with a combo
 * multiplier for chained kills. Pure functions + a small stats tracker.
 */
export const SCORE = {
  base: { small: 100, medium: 180, large: 300, abnormal: 450 },
  speedFree: 20, // m/s before speed bonus kicks in
  speedPerMs: 8,
  airTimeMin: 4,
  airTimeBonus: 120,
  oneCutBonus: 150,
  closeCallHealth: 25,
  closeCallBonus: 100,
  comboWindow: 10, // seconds between kills to keep the combo
  comboStep: 0.25,
  maxCombo: 3,
  waveClearPerWave: 250,
  waveParTime: 90,
  waveTimeBonusPerSec: 5,
};

/**
 * @param {{variant:string, speed:number, airTime:number, oneCut:boolean, health:number, combo:number}} k
 * @returns {{total:number, parts:{label:string, points:number}[], multiplier:number}}
 */
export function killScore(k) {
  const parts = [];
  parts.push({ label: 'KILL', points: SCORE.base[k.variant] ?? 100 });
  const speedPts = Math.round(Math.max(0, k.speed - SCORE.speedFree) * SCORE.speedPerMs);
  if (speedPts > 0) parts.push({ label: 'SPEED', points: speedPts });
  if (k.airTime >= SCORE.airTimeMin) parts.push({ label: 'AIRBORNE', points: SCORE.airTimeBonus });
  if (k.oneCut) parts.push({ label: 'ONE CUT', points: SCORE.oneCutBonus });
  if (k.health <= SCORE.closeCallHealth) parts.push({ label: 'CLOSE CALL', points: SCORE.closeCallBonus });
  const multiplier = comboMultiplier(k.combo);
  const sum = parts.reduce((a, p) => a + p.points, 0);
  return { total: Math.round(sum * multiplier), parts, multiplier };
}

export function comboMultiplier(combo) {
  return Math.min(SCORE.maxCombo, 1 + Math.max(0, combo - 1) * SCORE.comboStep);
}

export function waveClearBonus(wave, seconds) {
  const timeBonus = Math.max(0, Math.round((SCORE.waveParTime - seconds) * SCORE.waveTimeBonusPerSec));
  return SCORE.waveClearPerWave * wave + timeBonus;
}

/** Tracks run statistics and the running combo. */
export class ScoreKeeper {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = 0;
    this.kills = 0;
    this.killsByVariant = { small: 0, medium: 0, large: 0, abnormal: 0 };
    this.combo = 0;
    this.bestCombo = 0;
    this.lastKillTime = -1e9;
    this.topSpeed = 0;
    this.fastestKill = 0;
    this.limbs = 0;
    this.escapes = 0;
    this.styleTotals = {};
    this.time = 0;
  }

  tick(dt, speed) {
    this.time += dt;
    if (speed > this.topSpeed) this.topSpeed = speed;
    if (this.combo > 0 && this.time - this.lastKillTime > SCORE.comboWindow) this.combo = 0;
  }

  registerKill(k) {
    this.combo = this.time - this.lastKillTime <= SCORE.comboWindow ? this.combo + 1 : 1;
    this.lastKillTime = this.time;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.kills++;
    this.killsByVariant[k.variant] = (this.killsByVariant[k.variant] || 0) + 1;
    this.fastestKill = Math.max(this.fastestKill, k.speed);
    const res = killScore({ ...k, combo: this.combo });
    for (const p of res.parts) this.styleTotals[p.label] = (this.styleTotals[p.label] || 0) + p.points;
    this.score += res.total;
    return res;
  }

  addBonus(label, points) {
    this.score += points;
    this.styleTotals[label] = (this.styleTotals[label] || 0) + points;
  }
}
