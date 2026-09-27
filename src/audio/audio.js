/**
 * Procedural audio: everything is synthesized with the Web Audio API (noise
 * buffers, oscillators, filters, envelopes). No audio files.
 *
 * Continuous layers (wind, gas hiss) follow the player's state; one-shots are
 * fire-and-forget node graphs with simple distance attenuation and stereo pan.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.7;
    this._voices = 0;
    this._lastStep = 0;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Shared 2 s white-noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind: looping noise through a bandpass whose cutoff and gain follow speed.
    this.wind = this._loop();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Gas hiss
    this.gas = this._loop();
    const gasHp = ctx.createBiquadFilter();
    gasHp.type = 'highpass';
    gasHp.frequency.value = 2200;
    this.gasGain = ctx.createGain();
    this.gasGain.gain.value = 0;
    this.gas.connect(gasHp).connect(this.gasGain).connect(this.master);
    this.enabled = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _loop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  /** Per-frame update of the continuous layers. */
  update(speed, boosting, reeling, active) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const s = active ? Math.min(1, Math.max(0, (speed - 4) / 60)) : 0;
    this.windGain.gain.setTargetAtTime(s * s * 0.5 + (active ? 0.015 : 0.03), t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + s * 1800, t, 0.2);
    const g = active ? (boosting ? 0.22 : reeling ? 0.08 : 0) : 0;
    this.gasGain.gain.setTargetAtTime(g, t, 0.04);
  }

  /* ---------------- building blocks ---------------- */

  _out(gain = 1, pan = 0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  _env(param, t, peak, attack, decay, floor = 0.0001) {
    param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(floor, t + attack + decay);
  }

  _noiseBurst(dest, t, dur, type, f0, f1, q = 1, peak = 1, attack = 0.005) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this._env(g.gain, t, peak, attack, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + attack + 0.05);
  }

  _tone(dest, t, type, f0, f1, dur, peak = 1, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    this._env(g.gain, t, peak, attack, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  _can() {
    return this.enabled && this.ctx.state === 'running';
  }

  /* ---------------- one-shots ---------------- */

  hookFire() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.35);
    this._noiseBurst(o, t, 0.16, 'bandpass', 4000, 700, 2, 0.8);
    this._tone(o, t, 'triangle', 1400, 280, 0.12, 0.25);
  }

  hookHit(kind = 'building', pan = 0, gain = 1) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.45 * gain, pan);
    const f = kind === 'giant' ? 140 : kind === 'tree' ? 260 : 420;
    this._tone(o, t, 'square', f, f * 0.5, 0.07, 0.35);
    this._noiseBurst(o, t, 0.06, 'highpass', 2500, 1200, 0.7, 0.6);
  }

  release() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.2);
    this._tone(o, t, 'triangle', 500, 900, 0.08, 0.4);
  }

  /** Short gas burst (slingshot release). */
  gasBurst(amount = 1) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.25 + 0.2 * amount);
    this._noiseBurst(o, t, 0.28, 'bandpass', 3500, 900, 0.8, 0.9, 0.01);
  }

  slash(hit = false) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.4);
    this._noiseBurst(o, t, 0.18, 'bandpass', 1400, 6500, 1.4, 0.9, 0.01);
    if (!hit) this._tone(o, t, 'sine', 2600, 2400, 0.25, 0.05);
  }

  flesh(damage, pan = 0) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.5 + Math.min(0.4, damage / 250), pan);
    this._tone(o, t, 'sine', 140, 45, 0.22, 0.9);
    this._noiseBurst(o, t, 0.15, 'lowpass', 1800, 300, 0.8, 0.7);
    this._noiseBurst(o, t + 0.02, 0.35, 'highpass', 3000, 5000, 0.5, 0.25);
  }

  kill() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.8);
    this._tone(o, t, 'sine', 90, 30, 0.6, 1);
    this._noiseBurst(o, t, 0.2, 'lowpass', 2000, 200, 0.8, 0.8);
    // Steam venting
    this._noiseBurst(o, t + 0.05, 1.4, 'highpass', 1800, 4000, 0.4, 0.35, 0.08);
    // Metallic ring of the blades
    this._tone(o, t, 'sine', 3200, 3100, 0.6, 0.08);
    this._tone(o, t, 'sine', 4300, 4250, 0.5, 0.05);
  }

  sever() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.5);
    this._noiseBurst(o, t, 0.4, 'bandpass', 900, 200, 1, 0.8);
    this._tone(o, t, 'sine', 70, 35, 0.4, 0.6);
  }

  swap() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.3);
    this._noiseBurst(o, t, 0.04, 'highpass', 3000, 3000, 1, 0.6);
    this._tone(o, t + 0.05, 'sine', 1900, 1850, 0.25, 0.3);
    this._tone(o, t + 0.12, 'sine', 2700, 2650, 0.3, 0.25);
  }

  broken() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.35);
    this._tone(o, t, 'square', 3000, 800, 0.15, 0.2);
    this._noiseBurst(o, t, 0.12, 'highpass', 4000, 2000, 1, 0.5);
  }

  dull() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.3);
    this._tone(o, t, 'triangle', 220, 120, 0.1, 0.5);
  }

  footstep(size, dist, pan) {
    if (!this._can()) return;
    const now = this.ctx.currentTime;
    const gain = Math.min(1, (size / 15) * (1 / (1 + dist / 35))) * 0.9;
    if (gain < 0.03) return;
    if (now - this._lastStep < 0.06) return; // avoid pile-ups with many giants
    this._lastStep = now;
    const o = this._out(gain, pan);
    const f = 70 - size * 1.5;
    this._tone(o, now, 'sine', f, f * 0.55, 0.3, 1, 0.01);
    this._noiseBurst(o, now, 0.18, 'lowpass', 400, 80, 0.7, 0.5);
  }

  roar(size, abnormal, dist, pan) {
    if (!this._can()) return;
    const t = this.ctx.currentTime;
    const gain = Math.min(0.8, 0.9 / (1 + dist / 50));
    if (gain < 0.04) return;
    const o = this._out(gain, pan);
    const ctx = this.ctx;
    const base = abnormal ? 150 : 95 - size * 2.5;
    const dur = abnormal ? 0.9 : 1.3;
    for (const detune of [1, 1.51, 0.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * detune, t);
      osc.frequency.linearRampToValueAtTime(base * detune * (abnormal ? 1.8 : 0.8), t + dur);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = abnormal ? 23 : 7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = base * 0.06;
      lfo.connect(lfoGain).connect(osc.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = abnormal ? 1400 : 700;
      const g = ctx.createGain();
      this._env(g.gain, t, 0.3 / detune, 0.12, dur);
      osc.connect(f).connect(g).connect(o);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + dur + 0.2);
      lfo.stop(t + dur + 0.2);
    }
  }

  windup(dist, pan) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(Math.min(0.6, 0.8 / (1 + dist / 30)), pan);
    this._tone(o, t, 'sawtooth', 55, 130, 0.7, 0.35, 0.3);
    this._tone(o, t, 'sine', 880, 1320, 0.5, 0.06, 0.2);
  }

  whoosh(pan) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.5, pan);
    this._noiseBurst(o, t, 0.45, 'bandpass', 200, 900, 1.5, 0.9, 0.15);
  }

  grabbed() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.7);
    this._noiseBurst(o, t, 0.3, 'bandpass', 500, 150, 1, 1);
    this._tone(o, t, 'sine', 110, 40, 0.4, 0.9);
  }

  hurt() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.5);
    this._tone(o, t, 'sine', 160, 60, 0.18, 0.9);
    this._noiseBurst(o, t, 0.12, 'lowpass', 1200, 200, 0.7, 0.6);
  }

  bodyfall(size, dist, pan) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(Math.min(1, (size / 12) / (1 + dist / 60)), pan);
    this._tone(o, t, 'sine', 50, 22, 1.4, 1, 0.02);
    this._noiseBurst(o, t, 1.2, 'lowpass', 600, 60, 0.6, 0.8, 0.02);
  }

  resupply() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.25);
    [523, 659, 784, 1046].forEach((f, i) => this._tone(o, t + i * 0.07, 'triangle', f, f, 0.18, 0.5));
  }

  gasEmpty() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.25);
    for (let i = 0; i < 3; i++) this._noiseBurst(o, t + i * 0.09, 0.05, 'highpass', 2500, 1500, 1, 0.7);
  }

  bell() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.35);
    for (let k = 0; k < 3; k++) {
      const tt = t + k * 0.55;
      [330, 330 * 2.76, 330 * 5.4].forEach((f, i) => this._tone(o, tt, 'sine', f, f * 0.995, 1.2 - i * 0.3, 0.5 / (i + 1), 0.005));
    }
  }

  fanfare() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.3);
    [392, 523, 659, 784].forEach((f, i) => this._tone(o, t + i * 0.12, 'sawtooth', f, f, 0.5, 0.25, 0.02));
  }

  click() {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(0.2);
    this._tone(o, t, 'triangle', 900, 700, 0.04, 0.5);
  }

  land(speed) {
    if (!this._can()) return;
    const t = this.ctx.currentTime, o = this._out(Math.min(0.5, speed / 40));
    this._noiseBurst(o, t, 0.12, 'lowpass', 900, 150, 0.7, 0.8);
  }
}
