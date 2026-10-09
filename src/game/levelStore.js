// The owner's own levels (made in the editor) on this device: localStorage `tuktuk.levels.v1` = { schema: 1, levels: [level, ...] }.
// Every editing step is saved (the editor calls save()), so nothing is lost when the tab closes. Storage may be unavailable (private window,
// blocked): then the editor still works for the session, it only cannot keep the levels. No DOM, no three.js.
import { LEVEL } from './levels.js';

const KEY = 'tuktuk.levels.v1';

export function loadMine() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || data.schema !== LEVEL.schema || !Array.isArray(data.levels)) return [];
    // a level of the editor may be unfinished (fewer than 3 gates): it is kept, and only the shape is required
    return data.levels.filter((lv) => lv && typeof lv.id === 'string' && Array.isArray(lv.items) && lv.start && lv.title).map((lv) => ({ ...lv, mine: true }));
  } catch { return []; }
}
export function saveMine(levels) {
  try { localStorage.setItem(KEY, JSON.stringify({ schema: LEVEL.schema, levels: levels.map((lv) => { const { mine, ...rest } = lv; return rest; }) })); return true; } catch { return false; }
}
// replaces the level with the same id, or appends; returns the new list
export function upsert(list, level) {
  const i = list.findIndex((l) => l.id === level.id), lv = { ...level, mine: true };
  if (i < 0) return [...list, lv];
  const out = list.slice(); out[i] = lv; return out;
}
export const removeLevel = (list, id) => list.filter((l) => l.id !== id);
