/** Player preferences, persisted in localStorage and applied live to the running game. */
const KEY = 'fps_settings';
export const BASE_SENS = 0.0021;

/**
 * post: colour grading + film grain pass; bloom: glow on bright highlights; normals: surface relief maps.
 * Tuned for steady 60 FPS on typical LAN PCs — High stays cinematic without melting the GPU.
 */
export const QUALITY = {
  low: { label: 'Low', pixelRatio: 0.85, shadows: false, shadowSize: 0, particles: 0.25, post: false, bloom: false, normals: false, msaa: 0, grainScale: 0 },
  medium: { label: 'Medium', pixelRatio: 1, shadows: true, shadowSize: 1024, particles: 0.45, post: true, bloom: false, normals: false, msaa: 0, grainScale: 0.35 },
  high: { label: 'High', pixelRatio: 1.25, shadows: true, shadowSize: 1536, particles: 0.7, post: true, bloom: true, normals: true, msaa: 0, grainScale: 0.75 },
  ultra: { label: 'Ultra', pixelRatio: 1.5, shadows: true, shadowSize: 2048, particles: 0.85, post: true, bloom: true, normals: true, msaa: 0, grainScale: 0.85 },
};

const DEFAULTS = { sens: 1, adsSens: 0.85, fov: 74, volume: 0.6, quality: 'medium', showFps: false };

export const SETTINGS_FIELDS = [
  { key: 'sens', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'adsSens', label: 'Aim-down-sights sensitivity', min: 0.3, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fov', label: 'Field of view', min: 60, max: 100, step: 1, fmt: (v) => `${v}°` },
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'quality', label: 'Graphics quality', options: Object.entries(QUALITY).map(([id, q]) => [id, q.label]) },
  { key: 'showFps', label: 'Show FPS counter', toggle: true },
];

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* corrupted: fall back to defaults */ }
  const legacy = Number(localStorage.getItem('fps_sens'));
  if (!saved.sens && legacy > 0) saved.sens = Math.round((legacy / BASE_SENS) * 20) / 20;
  const out = { ...DEFAULTS, ...saved };
  for (const f of SETTINGS_FIELDS) {
    if (f.min != null) out[f.key] = Math.min(f.max, Math.max(f.min, Number(out[f.key]) || DEFAULTS[f.key]));
  }
  if (!QUALITY[out.quality]) out.quality = DEFAULTS.quality;
  // One-time nudge: older saves defaulted to High which felt like slow-mo on many PCs.
  if (!saved.smoothV2 && out.quality === 'high') {
    out.quality = 'medium';
    saved.smoothV2 = true;
    saved.quality = 'medium';
    try { localStorage.setItem(KEY, JSON.stringify({ ...out, smoothV2: true })); } catch { /* ignore */ }
  }
  out.showFps = !!out.showFps;
  return out;
}

export const settings = load();
const listeners = new Set();

export function updateSettings(patch) {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
  for (const fn of listeners) fn(settings, patch);
}

export function onSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
