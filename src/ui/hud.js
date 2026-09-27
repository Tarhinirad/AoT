/** DOM heads-up display. Values are only written when they change. */
export class Hud {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-bottom-left">
        <div class="meter health"><label>HEALTH</label><div class="bar"><div class="fill"></div></div></div>
        <div class="meter gas"><label>GAS</label><div class="bar"><div class="fill"></div></div></div>
        <div class="meter blade"><label>BLADES <span class="spares"></span></label><div class="bar"><div class="fill"></div></div></div>
      </div>`;
    this.root.insertAdjacentHTML('beforeend', `
      <div class="hud-top"><div class="wave-label"></div><div class="wave-sub"></div></div>
      <div class="hud-top-right"><div class="minimap-slot"></div><div class="score"></div><div class="combo"></div></div>
      <div class="hud-bottom-right"><div class="speed"><b>0</b> m/s</div></div>
      <div class="announce"><div class="an-main"></div><div class="an-sub"></div></div>
      <div class="resupply"><div class="resupply-label">RESUPPLYING</div><div class="bar"><div class="fill"></div></div></div>
      <div class="danger"><div class="danger-arrow"></div><div class="danger-label"></div></div>
      <div class="struggle"><div class="struggle-label">STRUGGLE!</div><div class="bar"><div class="fill"></div></div></div>`);
    parent.appendChild(this.root);
    this.dangerEl = this.root.querySelector('.danger');
    this.dangerArrow = this.root.querySelector('.danger-arrow');
    this.dangerLabel = this.root.querySelector('.danger-label');
    this.struggleEl = this.root.querySelector('.struggle');
    this.struggleFill = this.root.querySelector('.struggle .fill');
    this.struggleLabel = this.root.querySelector('.struggle-label');
    this.waveLabel = this.root.querySelector('.wave-label');
    this.waveSub = this.root.querySelector('.wave-sub');
    this.scoreEl = this.root.querySelector('.score');
    this.comboEl = this.root.querySelector('.combo');
    this.speedEl = this.root.querySelector('.speed b');
    this.minimapSlot = this.root.querySelector('.minimap-slot');
    this.announceEl = this.root.querySelector('.announce');
    this.resupplyEl = this.root.querySelector('.resupply');
    this.resupplyFill = this.root.querySelector('.resupply .fill');
    this._announceT = 0;
    this.healthFill = this.root.querySelector('.health .fill');
    this.gasFill = this.root.querySelector('.gas .fill');
    this.gasMeter = this.root.querySelector('.meter.gas');
    this.bladeFill = this.root.querySelector('.blade .fill');
    this.bladeMeter = this.root.querySelector('.meter.blade');
    this.sparesEl = this.root.querySelector('.spares');
    this._cache = {};
  }

  _set(key, value, fn) {
    if (this._cache[key] === value) return;
    this._cache[key] = value;
    fn(value);
  }

  /** Big centered announcement (wave start/clear). */
  announce(main, sub = '', dur = 2.6) {
    this.announceEl.querySelector('.an-main').textContent = main;
    this.announceEl.querySelector('.an-sub').textContent = sub;
    this.announceEl.classList.remove('show');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('show');
    this._announceT = dur;
  }

  tick(dt) {
    if (this._announceT > 0) {
      this._announceT -= dt;
      if (this._announceT <= 0) this.announceEl.classList.remove('show');
    }
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
  }

  update(state) {
    const hp = Math.round((state.health / state.maxHealth) * 1000) / 10;
    const gas = Math.round((state.gas / state.gasMax) * 1000) / 10;
    this._set('hp', hp, (v) => (this.healthFill.style.width = v + '%'));
    this._set('gas', gas, (v) => (this.gasFill.style.width = v + '%'));
    this._set('gasLow', gas < 20, (v) => this.gasMeter.classList.toggle('low', v));
    this._set('boost', state.boosting, (v) => this.gasMeter.classList.toggle('active', v));
    const blade = Math.round((state.blade / state.bladeMax) * 1000) / 10;
    this._set('blade', blade, (v) => (this.bladeFill.style.width = v + '%'));
    this._set('bladeLow', blade < 25, (v) => this.bladeMeter.classList.toggle('low', v));
    this._set('danger', !!state.danger, (v) => this.dangerEl.classList.toggle('show', v));
    if (state.danger) {
      this.dangerArrow.style.transform = `rotate(${state.danger.angle}rad) translateY(-70px)`;
      this._set('dangerKind', state.danger.kind, (v) => (this.dangerLabel.textContent = v === 'grab' ? 'GRAB!' : 'SWIPE!'));
    }
    this._set('struggle', !!state.struggle, (v) => this.struggleEl.classList.toggle('show', v));
    if (state.struggle) {
      this._set('strugglePct', Math.round(state.struggle.pct * 100), (v) => (this.struggleFill.style.width = v + '%'));
      this._set('struggleKey', state.struggle.key, (v) => (this.struggleLabel.textContent = `STRUGGLE! Mash ${v}`));
    }
    this._set('wave', state.waveText, (v) => (this.waveLabel.textContent = v || ''));
    this._set('waveSub', state.waveSub, (v) => (this.waveSub.textContent = v || ''));
    this._set('score', state.score, (v) => (this.scoreEl.textContent = (v || 0).toLocaleString()));
    this._set('combo', state.combo, (v) => {
      this.comboEl.textContent = v > 1 ? `COMBO x${v}` : '';
      this.comboEl.classList.toggle('hot', v > 1);
    });
    this._set('speed', Math.round(state.speed || 0), (v) => (this.speedEl.textContent = v));
    this._set('resupply', state.resupply > 0, (v) => this.resupplyEl.classList.toggle('show', v));
    if (state.resupply > 0) this._set('resupplyPct', Math.round(state.resupply * 100), (v) => (this.resupplyFill.style.width = v + '%'));
    this._set('spares', state.spares, (v) => (this.sparesEl.innerHTML = '▮'.repeat(v) + '<i>' + '▯'.repeat(Math.max(0, 4 - v)) + '</i>'));
  }
}
