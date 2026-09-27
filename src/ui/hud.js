/** DOM heads-up display. Values are only written when they change. */
export class Hud {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-bottom-left">
        <div class="meter health"><label>HEALTH</label><div class="bar"><div class="fill"></div></div></div>
        <div class="meter gas"><label>GAS</label><div class="bar"><div class="fill"></div></div></div>
      </div>`;
    parent.appendChild(this.root);
    this.healthFill = this.root.querySelector('.health .fill');
    this.gasFill = this.root.querySelector('.gas .fill');
    this.gasMeter = this.root.querySelector('.meter.gas');
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
  }
}
