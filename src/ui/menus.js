import { ACTION_LABELS, DEFAULT_BINDINGS, codeLabel, saveSettings } from '../core/settings.js';

const BEST_KEY = 'skyhook.best.v1';

export function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY)) || { score: 0, wave: 0 };
  } catch {
    return { score: 0, wave: 0 };
  }
}

export function saveBest(best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* ignore */
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * All full-screen menus. Pure DOM; talks to the game through callbacks.
 */
export class Menus {
  constructor(parent, { settings, input, onPlay, onResume, onRestart, onQuit, onSettingsChanged }) {
    this.settings = settings;
    this.input = input;
    this.cb = { onPlay, onResume, onRestart, onQuit, onSettingsChanged };
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    this.screens = {};
    this.current = null;
    this.returnTo = 'main';
    this._build();
  }

  _screen(name, html) {
    const el = document.createElement('div');
    el.className = 'screen ' + name;
    el.innerHTML = `<div class="panel">${html}</div>`;
    this.root.appendChild(el);
    this.screens[name] = el;
    return el;
  }

  _build() {
    const main = this._screen('main', `
      <h1 class="title">SKYHOOK</h1>
      <p class="subtitle">The wall is breached. Swing, strike the nape, hold the district.</p>
      <button class="btn primary" data-act="play">PLAY</button>
      <button class="btn" data-act="howto">HOW TO PLAY</button>
      <button class="btn" data-act="settings">SETTINGS</button>
      <p class="hint best"></p>`);
    main.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'play') this.cb.onPlay();
      if (act === 'howto') this.show('howto');
      if (act === 'settings') this.openSettings('main');
    });

    const howto = this._screen('howto', `
      <h2>How to play</h2>
      <div class="controls-list"></div>
      <ul class="tips">
        <li>Fire a hook at a building, then <b>hold</b> its button to reel in. Release (Shift) at the top of the arc to keep your momentum.</li>
        <li>Giants only die from a cut to the <b>nape</b> (back of the neck). Damage scales with your speed: big giants need a fast pass.</li>
        <li>Hitting limbs staggers giants; enough damage severs them. Severed legs make giants crawl. Limbs regrow.</li>
        <li>A giant glowing red is winding up. Grabs come from the front, so get behind or above it.</li>
        <li>If grabbed, mash Space (or slash) to break free before it bites.</li>
        <li>Land on a blue-beacon <b>supply depot</b> to refill gas and blades.</li>
      </ul>
      <button class="btn" data-act="back">BACK</button>`);
    howto.addEventListener('click', (e) => {
      if (e.target.dataset?.act === 'back') this.show('main');
    });

    const settings = this._screen('settings', `
      <h2>Settings</h2>
      <div class="setting"><label>Mouse sensitivity <span class="val sens-val"></span></label><input type="range" class="sens" min="0.2" max="3" step="0.05"></div>
      <div class="setting check"><label><input type="checkbox" class="invert"> Invert mouse Y</label></div>
      <div class="setting"><label>Graphics quality</label>
        <select class="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div class="setting check"><label><input type="checkbox" class="dynres"> Dynamic resolution (holds 60 fps)</label></div>
      <div class="setting check"><label><input type="checkbox" class="fov"> Widen FOV with speed</label></div>
      <div class="setting check"><label><input type="checkbox" class="lines"> Speed lines</label></div>
      <div class="setting"><label>Volume <span class="val vol-val"></span></label><input type="range" class="vol" min="0" max="1" step="0.05"></div>
      <h3>Key bindings <small>(click, then press a key or mouse button, Esc cancels)</small></h3>
      <div class="bindings"></div>
      <button class="btn" data-act="reset-keys">RESET KEYS TO DEFAULT</button>
      <button class="btn primary" data-act="back">DONE</button>`);
    this._wireSettings(settings);

    const pause = this._screen('pause', `
      <h2>Paused</h2>
      <button class="btn primary" data-act="resume">RESUME</button>
      <button class="btn" data-act="settings">SETTINGS</button>
      <button class="btn" data-act="restart">RESTART RUN</button>
      <button class="btn" data-act="quit">QUIT TO MENU</button>`);
    pause.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'resume') this.cb.onResume();
      if (act === 'settings') this.openSettings('pause');
      if (act === 'restart') this.cb.onRestart();
      if (act === 'quit') this.cb.onQuit();
    });

    const results = this._screen('results', `
      <h1 class="results-title"></h1>
      <p class="subtitle results-sub"></p>
      <div class="results-score"></div>
      <div class="results-grid"></div>
      <button class="btn primary" data-act="again">PLAY AGAIN</button>
      <button class="btn" data-act="menu">MAIN MENU</button>`);
    results.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'again') this.cb.onRestart();
      if (act === 'menu') this.cb.onQuit();
    });
  }

  _wireSettings(el) {
    const s = this.settings;
    const q = (sel) => el.querySelector(sel);
    const changed = (needsQuality = false) => {
      saveSettings(s);
      this.cb.onSettingsChanged?.(needsQuality);
    };
    q('.sens').addEventListener('input', (e) => {
      s.sensitivity = +e.target.value;
      q('.sens-val').textContent = s.sensitivity.toFixed(2);
      changed();
    });
    q('.invert').addEventListener('change', (e) => {
      s.invertY = e.target.checked;
      changed();
    });
    q('.quality').addEventListener('change', (e) => {
      s.quality = e.target.value;
      changed(true);
    });
    q('.dynres').addEventListener('change', (e) => {
      s.dynamicRes = e.target.checked;
      changed(true);
    });
    q('.fov').addEventListener('change', (e) => {
      s.fovEffects = e.target.checked;
      changed();
    });
    q('.lines').addEventListener('change', (e) => {
      s.speedLines = e.target.checked;
      changed();
    });
    q('.vol').addEventListener('input', (e) => {
      s.volume = +e.target.value;
      q('.vol-val').textContent = Math.round(s.volume * 100) + '%';
      changed();
    });
    el.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'back') this.show(this.returnTo);
      if (act === 'reset-keys') {
        s.bindings = { ...DEFAULT_BINDINGS };
        changed();
        this._renderBindings();
      }
      const bind = e.target.dataset?.bind;
      if (bind) this._rebind(bind, e.target);
    });
  }

  _rebind(action, btn) {
    btn.textContent = 'press a key…';
    btn.classList.add('listening');
    // Defer so this click's own mouseup/mousedown doesn't get captured.
    setTimeout(() => {
      this.input.captureNextCode((code) => {
        btn.classList.remove('listening');
        if (code !== 'Escape') {
          // Swap if another action already uses this code.
          const b = this.settings.bindings;
          const other = Object.keys(b).find((k) => b[k] === code && k !== action);
          // Struggle only matters while grabbed, so it may share a key with anything.
          if (other && other !== 'pause' && other !== 'struggle' && action !== 'struggle') b[other] = b[action];
          b[action] = code;
          saveSettings(this.settings);
          this.cb.onSettingsChanged?.(false);
        }
        this._renderBindings();
      });
    }, 50);
  }

  _renderBindings() {
    const b = this.settings.bindings;
    const rows = Object.keys(ACTION_LABELS)
      .filter((a) => a !== 'pause')
      .map((a) => `<div class="bind-row"><span>${esc(ACTION_LABELS[a])}</span><button class="key" data-bind="${a}">${esc(codeLabel(b[a]))}</button></div>`)
      .join('');
    this.screens.settings.querySelector('.bindings').innerHTML = rows;
    const list = Object.keys(ACTION_LABELS)
      .map((a) => `<div class="bind-row"><span>${esc(ACTION_LABELS[a])}</span><span class="key">${esc(a === 'pause' ? 'Esc' : codeLabel(b[a]))}</span></div>`)
      .join('');
    this.screens.howto.querySelector('.controls-list').innerHTML = list;
  }

  openSettings(returnTo) {
    this.returnTo = returnTo;
    const s = this.settings;
    const el = this.screens.settings;
    el.querySelector('.sens').value = s.sensitivity;
    el.querySelector('.sens-val').textContent = s.sensitivity.toFixed(2);
    el.querySelector('.invert').checked = s.invertY;
    el.querySelector('.quality').value = s.quality;
    el.querySelector('.fov').checked = s.fovEffects;
    el.querySelector('.dynres').checked = s.dynamicRes;
    el.querySelector('.lines').checked = s.speedLines;
    el.querySelector('.vol').value = s.volume;
    el.querySelector('.vol-val').textContent = Math.round(s.volume * 100) + '%';
    this.show('settings');
  }

  show(name, data) {
    if (name === 'howto' || name === 'settings') this._renderBindings();
    if (name === 'main') {
      const best = loadBest();
      this.screens.main.querySelector('.best').textContent = best.score ? `Best: ${best.score.toLocaleString()} pts · wave ${best.wave}` : 'Click PLAY to lock the mouse. Esc pauses.';
    }
    if (name === 'results' && data) this._fillResults(data);
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('visible', k === name);
    this.current = name;
  }

  hideAll() {
    for (const el of Object.values(this.screens)) el.classList.remove('visible');
    this.current = null;
  }

  _fillResults(d) {
    const el = this.screens.results;
    el.querySelector('.results-title').textContent = d.victory ? 'DISTRICT HELD' : 'FALLEN';
    el.querySelector('.results-title').classList.toggle('victory', d.victory);
    el.querySelector('.results-sub').textContent = d.victory
      ? `All ${d.wave} waves repelled.`
      : `You fell on wave ${d.wave}.`;
    el.querySelector('.results-score').innerHTML = `${d.score.toLocaleString()}<small> pts${d.newBest ? ' · NEW BEST' : ''}</small>`;
    const stat = (k, v) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
    const kv = d.killsByVariant;
    const styleRows = Object.entries(d.styleTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => stat(k, v.toLocaleString()))
      .join('');
    el.querySelector('.results-grid').innerHTML = `
      <div class="col"><h3>Run</h3>
        ${stat('Giants slain', d.kills)}
        ${stat('S / M / L / Abnormal', `${kv.small} / ${kv.medium} / ${kv.large} / ${kv.abnormal}`)}
        ${stat('Limbs severed', d.limbs)}
        ${stat('Grabs escaped', d.escapes)}
        ${stat('Best combo', 'x' + d.bestCombo)}
        ${stat('Top speed', Math.round(d.topSpeed) + ' m/s')}
        ${stat('Fastest kill', Math.round(d.fastestKill) + ' m/s')}
        ${stat('Time', formatTime(d.time))}
      </div>
      <div class="col"><h3>Score breakdown</h3>${styleRows || stat('—', 0)}</div>`;
  }
}

function formatTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
