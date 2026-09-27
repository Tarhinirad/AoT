/**
 * Fixed-timestep loop with render interpolation. `timeScale` lets gameplay
 * slow down or freeze (hit-stop) without touching the render rate.
 */
export class FixedLoop {
  constructor({ step = 1 / 120, maxFrame = 0.1, preFrame, update, render }) {
    this.preFrame = preFrame;
    this.step = step;
    this.maxFrame = maxFrame;
    this.update = update;
    this.render = render;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.timeScale = 1;
    this._raf = (t) => this._frame(t);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._raf);
  }

  _frame(now) {
    if (!this.running) return;
    const frameDt = Math.min(this.maxFrame, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.preFrame?.(frameDt);
    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= this.step && steps < 16) {
      this.update(this.step, steps === 0);
      this.acc -= this.step;
      steps++;
    }
    if (steps === 16) this.acc = 0;
    this.render(frameDt, this.acc / this.step, steps);
    requestAnimationFrame(this._raf);
  }
}
