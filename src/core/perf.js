/**
 * Frame-time monitor with an optional overlay (F3) and dynamic resolution:
 * when frames are consistently slow the pixel ratio steps down, and it
 * creeps back up when there is headroom. Keeps gameplay near 60 fps on
 * weaker GPUs without the player touching settings.
 */
export class PerfMonitor {
  constructor(parent, renderer) {
    this.renderer = renderer;
    this.el = document.createElement('div');
    this.el.className = 'perf';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    this.frames = 0;
    this.acc = 0;
    this.avgMs = 16.7;
    this.slowT = 0;
    this.fastT = 0;
    this.cooldown = 0;
    this.maxRatio = 1;
    this.ratio = 1;
    this.dynamic = true;
    this.onRatio = null;
  }

  toggle() {
    this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
  }

  setMax(maxRatio) {
    this.maxRatio = maxRatio;
    this.ratio = maxRatio;
    this.slowT = this.fastT = 0;
  }

  frame(dt, active) {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.avgMs = (this.acc / this.frames) * 1000;
    const window = this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.el.style.display !== 'none') {
      const info = this.renderer.info.render;
      this.el.textContent = `${Math.round(1000 / this.avgMs)} fps · ${this.avgMs.toFixed(1)} ms · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · res x${this.ratio.toFixed(2)}`;
    }
    if (!this.dynamic || !active) return;
    this.cooldown -= window;
    if (this.avgMs > 20) {
      this.slowT += window;
      this.fastT = 0;
    } else if (this.avgMs < 17.5) {
      this.fastT += window;
      this.slowT = 0;
    } else {
      this.slowT = this.fastT = 0;
    }
    const min = Math.min(0.5, this.maxRatio);
    if (this.slowT >= 1.5 && this.ratio > min + 1e-3) {
      this.ratio = Math.max(min, this.ratio - 0.1);
      this.slowT = 0;
      this.cooldown = 6; // don't immediately climb back up
      this.onRatio?.(this.ratio);
    } else if (this.fastT >= 4 && this.cooldown <= 0 && this.ratio < this.maxRatio - 1e-3) {
      this.ratio = Math.min(this.maxRatio, this.ratio + 0.1);
      this.fastT = 0;
      this.onRatio?.(this.ratio);
    }
  }
}
