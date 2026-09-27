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
      <div class="danger"><div class="danger-arrow"></div><div class="danger-label"></div></div>
      <div class="struggle"><div class="struggle-label">STRUGGLE!</div><div class="bar"><div class="fill"></div></div></div>`);
    parent.appendChild(this.root);
    this.dangerEl = this.root.querySelector('.danger');
    this.dangerArrow = this.root.querySelector('.danger-arrow');
    this.dangerLabel = this.root.querySelector('.danger-label');
    this.struggleEl = this.root.querySelector('.struggle');
    this.struggleFill = this.root.querySelector('.struggle .fill');
    this.struggleLabel = this.root.querySelector('.struggle-label');
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
    this._set('spares', state.spares, (v) => (this.sparesEl.innerHTML = '▮'.repeat(v) + '<i>' + '▯'.repeat(Math.max(0, 4 - v)) + '</i>'));
  }
}
