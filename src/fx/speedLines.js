import { invLerp } from '../core/math.js';

/** Cheap full-screen speed streaks on a 2D canvas (stand-in for motion blur). */
export class SpeedLines {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speedlines';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.lines = [];
    for (let i = 0; i < 70; i++) this.lines.push(this._spawn({}));
    this.intensity = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _spawn(l) {
    l.a = Math.random() * Math.PI * 2;
    l.r = 0.25 + Math.random() * 0.6;
    l.len = 0.08 + Math.random() * 0.2;
    l.speed = 0.8 + Math.random() * 1.6;
    l.w = 0.6 + Math.random() * 1.6;
    return l;
  }

  resize() {
    // Half resolution is plenty for soft streaks.
    this.canvas.width = Math.ceil(window.innerWidth / 2);
    this.canvas.height = Math.ceil(window.innerHeight / 2);
  }

  update(dt, speed, enabled) {
    const target = enabled ? invLerp(26, 70, speed) : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 6);
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this.intensity < 0.02) return;
    const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    for (const l of this.lines) {
      l.r += l.speed * dt * (0.6 + this.intensity * 1.8);
      if (l.r > 1.1) {
        this._spawn(l);
        l.r = 0.3 + Math.random() * 0.2;
      }
      const r0 = l.r * R, r1 = (l.r + l.len * (0.5 + this.intensity)) * R;
      const ca = Math.cos(l.a), sa = Math.sin(l.a);
      ctx.globalAlpha = this.intensity * 0.35 * Math.min(1, (l.r - 0.25) * 3);
      ctx.lineWidth = l.w;
      ctx.beginPath();
      ctx.moveTo(cx + ca * r0, cy + sa * r0);
      ctx.lineTo(cx + ca * r1, cy + sa * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
