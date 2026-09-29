/** Stable browser device fingerprint (not true HWID). Persisted in localStorage. */
export function getDeviceHash() {
  const key = 'sw_device_hash';
  try {
    const existing = localStorage.getItem(key);
    if (existing && /^[a-f0-9]{32,128}$/i.test(existing)) return existing;
  } catch { /* ignore */ }
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width, screen.height, screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    navigator.hardwareConcurrency || 0,
  ].join('|');
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hash = (`d${(h >>> 0).toString(16)}${Date.now().toString(16)}`).slice(0, 64);
  try { localStorage.setItem(key, hash); } catch { /* ignore */ }
  return hash;
}
