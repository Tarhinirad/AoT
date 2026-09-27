import * as THREE from 'three';

const proj = new THREE.Vector3();

/**
 * Hit feedback presentation: floating damage numbers, kill banner, screen
 * flash and toast messages. (Hit-stop and camera shake are driven by the game.)
 */
export class Feedback {
  constructor(parent) {
    this.layer = document.createElement('div');
    this.layer.className = 'fx-layer';
    parent.appendChild(this.layer);
    this.numbers = [];
    this.pool = [];
    this.banner = document.createElement('div');
    this.banner.className = 'kill-banner';
    this.banner.innerHTML = '<div class="kb-main"></div><div class="kb-sub"></div>';
    parent.appendChild(this.banner);
    this.flash = document.createElement('div');
    this.flash.className = 'screen-flash';
    parent.appendChild(this.flash);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    parent.appendChild(this.toastEl);
    this._bannerTimer = 0;
    this._toastTimer = 0;
  }

  damageNumber(pos, text, kind = 'hit') {
    const el = this.pool.pop() || document.createElement('div');
    el.className = 'dmg-num ' + kind;
    el.textContent = text;
    this.layer.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), life: 1.0, rise: 0 });
  }

  clearToast() {
    this.toastEl.classList.remove('show');
    this._toastTimer = 0;
  }

  killBanner(main, sub = '') {
    this.clearToast();
    this.banner.querySelector('.kb-main').textContent = main;
    this.banner.querySelector('.kb-sub').textContent = sub;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // restart CSS animation
    this.banner.classList.add('show');
    this._bannerTimer = 1.6;
  }

  screenFlash(color = 'rgba(255,255,255,0.35)') {
    this.flash.style.background = color;
    this.flash.classList.remove('show');
    void this.flash.offsetWidth;
    this.flash.classList.add('show');
  }

  toast(text, dur = 1.6) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this._toastTimer = dur;
  }

  update(dt, camera, width, height) {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.rise += dt * 60;
      if (n.life <= 0) {
        n.el.remove();
        this.pool.push(n.el);
        this.numbers.splice(i, 1);
        continue;
      }
      proj.copy(n.pos).project(camera);
      if (proj.z > 1) {
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = '';
      const x = (proj.x * 0.5 + 0.5) * width;
      const y = (-proj.y * 0.5 + 0.5) * height - n.rise;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.8 + n.life * 0.4})`;
      n.el.style.opacity = Math.min(1, n.life * 2.5);
    }
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
