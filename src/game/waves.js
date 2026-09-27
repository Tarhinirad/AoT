/**
 * Wave mode rules: what each wave contains, how fast giants trickle in, and
 * the intermission between waves. Composition is pure and unit tested; the
 * WaveDirector drives it over time and asks the game to spawn giants.
 */
export const WAVES = {
  total: 10,
  firstDelay: 6,
  intermission: 9,
  maxAlive: 7,
  spawnInterval: [2.5, 5],
};

/** Variant list for wave n (1-based). Escalates count, size and abnormals. */
export function waveComposition(n) {
  const total = Math.min(16, 2 + Math.floor(n * 1.4));
  const abnormal = n >= 4 ? Math.min(3, Math.floor((n - 1) / 3)) : 0;
  const large = n >= 3 ? Math.min(4, Math.floor((n - 1) / 2)) : 0;
  const medium = n >= 2 ? Math.min(6, Math.floor(n * 0.7)) : 0;
  const small = Math.max(0, total - abnormal - large - medium);
  const list = [];
  for (let i = 0; i < small; i++) list.push('small');
  for (let i = 0; i < medium; i++) list.push('medium');
  for (let i = 0; i < large; i++) list.push('large');
  for (let i = 0; i < abnormal; i++) list.push('abnormal');
  return list;
}

export class WaveDirector {
  constructor(rng) {
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.wave = 0;
    this.phase = 'intermission'; // intermission | active | victory
    this.timer = WAVES.firstDelay;
    this.queue = [];
    this.spawnTimer = 0;
    this.waveTime = 0;
    this.events = [];
  }

  get remainingToSpawn() {
    return this.queue.length;
  }

  /**
   * @param {number} dt
   * @param {number} alive giants currently alive
   * @param {(variant:string)=>void} spawn
   */
  update(dt, alive, spawn) {
    if (this.phase === 'victory') return;
    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this._startWave();
      return;
    }
    this.waveTime += dt;
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0 && alive < WAVES.maxAlive) {
      spawn(this.queue.shift());
      const [a, b] = WAVES.spawnInterval;
      this.spawnTimer = a + (b - a) * this.rng.next();
    }
    if (!this.queue.length && alive === 0) {
      this.events.push({ type: 'waveCleared', wave: this.wave, time: this.waveTime });
      if (this.wave >= WAVES.total) {
        this.phase = 'victory';
        this.events.push({ type: 'victory' });
      } else {
        this.phase = 'intermission';
        this.timer = WAVES.intermission;
      }
    }
  }

  _startWave() {
    this.wave++;
    this.phase = 'active';
    this.waveTime = 0;
    this.spawnTimer = 0;
    // Shuffle so the big ones don't always arrive last.
    const list = waveComposition(this.wave);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    this.queue = list;
    this.events.push({ type: 'waveStart', wave: this.wave, count: list.length });
  }
}
