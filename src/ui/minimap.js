/**
 * Top-down minimap: north-up, centered on the player. The static city layer
 * is pre-rendered once to an offscreen canvas; giants/depots are drawn live.
 */
const SIZE = 190; // CSS px
const VIEW_R = 130; // meters from center to edge

export class Minimap {
  constructor(parent, city) {
    this.city = city;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._buildStatic();
    this.t = 0;
  }

  _buildStatic() {
    const W = (this.city.half + 30) * 2;
    this.ppm = 2; // pixels per meter in the static layer
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(W * this.ppm);
    const g = c.getContext('2d');
    const o = W / 2;
    const px = (x) => (x + o) * this.ppm;
    g.fillStyle = '#5d6a45';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#8c8577';
    g.fillRect(px(-this.city.half), px(-150), this.city.half * 2 * this.ppm, (this.city.half + 150) * this.ppm);
    g.fillStyle = '#3c5a34';
    for (const t of this.city.trees) {
      g.beginPath();
      g.arc(px(t.x), px(t.z), t.canopyR * 0.7 * this.ppm, 0, Math.PI * 2);
      g.fill();
    }
    for (const b of this.city.buildings) {
      g.fillStyle = b.h > 34 ? '#e6dcc4' : b.h > 18 ? '#c9bea6' : '#aa9f8a';
      g.fillRect(px(b.x - b.w / 2), px(b.z - b.d / 2), b.w * this.ppm, b.d * this.ppm);
    }
    g.fillStyle = '#d9d2c2';
    for (const w of this.city.wall) {
      g.fillRect(px(w.minX), px(w.minZ), (w.maxX - w.minX) * this.ppm, (w.maxZ - w.minZ) * this.ppm);
    }
    this.static = c;
    this.origin = o;
  }

  update(dt, player, cameraYaw, giants, depots) {
    this.t += dt;
    const { ctx } = this;
    const S = SIZE * this.dpr;
    const scale = S / (VIEW_R * 2); // px per meter
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    // Static layer, centered on the player
    const k = scale / this.ppm;
    ctx.drawImage(
      this.static,
      (player.pos.x + this.origin) * this.ppm - (S / 2) / k,
      (player.pos.z + this.origin) * this.ppm - (S / 2) / k,
      S / k, S / k, 0, 0, S, S,
    );
    const toX = (x) => S / 2 + (x - player.pos.x) * scale;
    const toY = (z) => S / 2 + (z - player.pos.z) * scale;

    // Depots
    for (const d of depots.list) {
      const x = toX(d.x), y = toY(d.z);
      const inside = Math.hypot(x - S / 2, y - S / 2) < S / 2 - 6;
      const cx = inside ? x : S / 2 + ((x - S / 2) / Math.hypot(x - S / 2, y - S / 2)) * (S / 2 - 8);
      const cy = inside ? y : S / 2 + ((y - S / 2) / Math.hypot(x - S / 2, y - S / 2)) * (S / 2 - 8);
      ctx.fillStyle = '#4ea3ff';
      ctx.strokeStyle = '#0b2440';
      ctx.lineWidth = 2 * this.dpr;
      const r = 5 * this.dpr;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
    }
    // Giants
    for (const g of giants) {
      let x = toX(g.pos.x), y = toY(g.pos.z);
      const dd = Math.hypot(x - S / 2, y - S / 2);
      const edge = dd > S / 2 - 6;
      if (edge) {
        x = S / 2 + ((x - S / 2) / dd) * (S / 2 - 6);
        y = S / 2 + ((y - S / 2) / dd) * (S / 2 - 6);
      }
      const r = (2.5 + g.H * 0.35) * this.dpr * (edge ? 0.7 : 1);
      const danger = g.brain?.telegraphing && Math.sin(this.t * 25) > 0;
      ctx.fillStyle = !g.alive ? 'rgba(80,80,80,0.6)' : danger ? '#fff' : g.abnormal ? '#ff9a2e' : '#e2412f';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow (camera heading)
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-cameraYaw);
    ctx.fillStyle = '#ffe07a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * this.dpr;
    const a = 7 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(0, -a * 1.3);
    ctx.lineTo(a * 0.8, a);
    ctx.lineTo(0, a * 0.5);
    ctx.lineTo(-a * 0.8, a);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Ring
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    // North marker
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${11 * this.dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 13 * this.dpr);
  }
}
