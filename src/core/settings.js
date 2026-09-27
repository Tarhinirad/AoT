const STORAGE_KEY = 'skyhook.settings.v1';

export const DEFAULT_BINDINGS = {
  hookLeft: 'Mouse0',
  hookRight: 'Mouse2',
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  boost: 'Space',
  release: 'ShiftLeft',
  slash: 'KeyE',
  swap: 'KeyR',
  struggle: 'Space',
  pause: 'Escape',
};

export const ACTION_LABELS = {
  hookLeft: 'Fire left hook (hold to reel)',
  hookRight: 'Fire right hook (hold to reel)',
  forward: 'Steer forward',
  back: 'Steer back',
  left: 'Steer left',
  right: 'Steer right',
  boost: 'Gas boost / jump',
  release: 'Release hooks',
  slash: 'Slash',
  swap: 'Swap blades',
  struggle: 'Struggle (escape grab)',
  pause: 'Pause',
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  invertY: false,
  quality: 'medium', // low | medium | high
  fovEffects: true,
  speedLines: true,
  volume: 0.7,
  dynamicRes: true,
  bindings: { ...DEFAULT_BINDINGS },
};

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings() {
  const s = structuredClone(DEFAULT_SETTINGS);
  const store = safeStorage();
  if (!store) return s;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return s;
    const parsed = JSON.parse(raw);
    Object.assign(s, parsed, { bindings: { ...DEFAULT_BINDINGS, ...(parsed.bindings || {}) } });
  } catch {
    /* corrupt settings: fall back to defaults */
  }
  return s;
}

export function saveSettings(settings) {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked */
  }
}

export const QUALITY_PRESETS = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 0, particles: 800, fogFar: 400, antialias: false, post: false, bloom: false },
  medium: { pixelRatio: 1.0, shadows: true, shadowSize: 2048, particles: 1800, fogFar: 560, antialias: true, post: true, bloom: true },
  high: { pixelRatio: 2.0, shadows: true, shadowSize: 4096, particles: 3000, fogFar: 720, antialias: true, post: true, bloom: true },
};

/** Human readable label for a key/mouse code. */
export function codeLabel(code) {
  if (!code) return '—';
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  if (code.startsWith('Mouse')) return 'Mouse' + code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Left', ' L').replace('Right', ' R');
}
