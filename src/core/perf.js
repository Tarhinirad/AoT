/**
 * Frame-time monitor with an optional overlay (F3) and dynamic resolution:
 * when frames are consistently slow the pixel ratio steps down (further the
 * slower they are), and it probes back up when things have been smooth for a
 * while. A probe that fails doubles the wait before the next one, so a GPU
 * sitting right at the limit doesn't flip resolution back and forth. If even
 * the lowest ratio can't keep up, `onTooSlow` asks the game for a cheaper
 * graphics preset.
 */
export const PERF = {
  window: 0.5, // s, frame times are averaged over this
  slowMs: 20, // average above this counts as slow
  fastMs: 17.5, // average below this counts as smooth (a 60 Hz vsync sits at 16.7)
  slowHold: 1, // s of slow frames before stepping down
  fastHold: 4, // s of smooth frames before probing up
  minRatio: 0.5,
  probeCooldown: 6, // s after a step down before probing up again (doubles per failed probe)
  maxCooldown: 60,
  tooSlowMs: 24, // still this slow at the minimum ratio → ask for a cheaper preset
  tooSlowHold: 3,
};

export class PerfMonitor {
  constructor(parent, renderer) {
    this.renderer = renderer;
    this.el = null;
    if (parent) {
      this.el = document.createElement('div');
      this.el.className = 'perf';
      this.el.style.display = 'none';
      parent.appendChild(this.el);
    }
    this.frames = 0;
    this.acc = 0;
    this.avgMs = 16.7;
    this.slowT = 0;
    this.fastT = 0;
    this.tooSlowT = 0;
    this.cooldown = 0;
    this.nextCooldown = PERF.probeCooldown;
    this.probing = false; // the last change was a step up that hasn't proven itself yet
    this.maxRatio = 1;
    this.ratio = 1;
    this.dynamic = true;
    this.onRatio = null;
    this.onTooSlow = null;
    this.tooSlowFired = false; // asked once for this preset; setMax() re-arms it
  }

  toggle() {
    if (this.el) this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
  }

  /** @param {boolean} keepRatio stay at the current ratio if it fits (a fallback shouldn't bounce back up) */
  setMax(maxRatio, keepRatio = false) {
    this.maxRatio = maxRatio;
    this.ratio = keepRatio ? Math.min(this.ratio, maxRatio) : maxRatio;
    this.tooSlowFired = false;
    this.slowT = this.fastT = this.tooSlowT = 0;
    this.cooldown = 0;
    this.nextCooldown = PERF.probeCooldown;
    this.probing = false;
  }

  frame(dt, active) {
    this.frames++;
    this.acc += dt;
    if (this.acc < PERF.window) return;
    this.avgMs = (this.acc / this.frames) * 1000;
    const window = this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.el && this.el.style.display !== 'none') {
      const info = this.renderer.info.render;
      this.el.textContent = `${Math.round(1000 / this.avgMs)} fps · ${this.avgMs.toFixed(1)} ms · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · res x${this.ratio.toFixed(2)}`;
    }
    if (!active) {
      // Menus, pauses and tab switches don't count toward either decision.
      this.slowT = this.fastT = this.tooSlowT = 0;
      return;
    }
    if (!this.dynamic) return; // the player chose a fixed resolution: change nothing
    this.cooldown -= window;
    if (this.avgMs > PERF.slowMs) {
      this.slowT += window;
      this.fastT = 0;
    } else if (this.avgMs < PERF.fastMs) {
      this.fastT += window;
      this.slowT = 0;
    } else {
      this.slowT = this.fastT = 0;
    }
    const min = Math.min(PERF.minRatio, this.maxRatio);
    const atMin = this.ratio <= min + 1e-3;
    this.tooSlowT = atMin && this.avgMs > PERF.tooSlowMs ? this.tooSlowT + window : 0;
    if (this.tooSlowT >= PERF.tooSlowHold && !this.tooSlowFired) {
      this._tooSlow();
    } else if (this.slowT >= PERF.slowHold && !atMin) {
      // Pixel cost scales with ratio², so aim for the ratio that would hit ~17 ms.
      const k = Math.min(0.9, Math.max(0.7, Math.sqrt(17 / this.avgMs)));
      this._setRatio(Math.max(min, Math.floor(this.ratio * k * 20) / 20));
      this.slowT = 0;
      if (this.probing) this.nextCooldown = Math.min(PERF.maxCooldown, this.nextCooldown * 2);
      this.probing = false;
      this.cooldown = this.nextCooldown;
    } else if (this.fastT >= PERF.fastHold && this.cooldown <= 0 && this.ratio < this.maxRatio - 1e-3) {
      this._setRatio(Math.min(this.maxRatio, this.ratio + 0.1));
      this.fastT = 0;
      this.probing = true;
    } else if (this.probing && this.fastT >= PERF.fastHold) {
      this.probing = false; // the last step up held: future probes may come sooner again
      this.nextCooldown = PERF.probeCooldown;
    }
  }

  _setRatio(r) {
    if (Math.abs(r - this.ratio) < 1e-3) return;
    this.ratio = r;
    this.onRatio?.(r);
  }

  _tooSlow() {
    this.tooSlowFired = true;
    this.tooSlowT = 0;
    this.slowT = 0;
    this.onTooSlow?.();
  }
}
