// Small per-viewer settings kept in localStorage (may be unavailable: then defaults apply).
export function loadSetting(key, fallback) {
  try {
    const v = localStorage.getItem('tuktuk.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function saveSetting(key, value) {
  try { localStorage.setItem('tuktuk.' + key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
