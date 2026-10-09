// Crazy Tuk levels (0.16.0): a level is a JSON file (data/levels/<id>.json, listed in data/levels/index.json), the same for the game, the
// simulation (tools/sim-arcade.mjs) and the editor. No three.js here: it runs in Node too. Format (docs/plan-level-editor.md, section 2):
//   { schema: 1, id, title: { uk, en, es }, type: "standard" | "stay-on-road" | "stunt",
//     start: { place } | { x, z, heading },
//     time: { mode: "auto" | "manual", par },     // par in seconds; "auto" = measured by the simulation / estimated from the length, "manual" = set by the owner
//     items: [ { k: "gate", place } | { k: "gate", p: [x, z], d?: [dx, dz], title?, fact?, w? } , { k: "via", p: [x, z], r? }, ... ],
//     rules: {}, extras: {} }
// The order of `items` is the order of the run; the LAST gate is the finish (`finish: true`); a "via" point belongs to the gate that follows it.
export const LEVEL = {
  schema: 1,
  minGates: 3, maxGates: 12,        // gates of a level, the finish included
  viaR: 16,                         // m: default radius of a via point
  types: ['standard', 'stay-on-road', 'stunt'],
  langs: ['uk', 'en', 'es'],
  factMax: 70,                      // characters of a gate's one-line fact
  titleMax: 40,
};

// the name in a language; falls back to uk, then any, then the id
export function levelTitle(level, lang = 'uk') {
  const t = level && level.title;
  if (!t) return level ? String(level.id) : '';
  if (typeof t === 'string') return t;
  return t[lang] || t.uk || t.en || t.es || String(level.id);
}

// the translations of the three tours that were already in the game (the owner's own levels get theirs when they are added to the game)
export const BUILTIN_TITLES = {
  short: { uk: 'Короткий тур', en: 'Short tour', es: 'Tour corto' },
  castle: { uk: '30 хв: до замку', en: '30 min: to the castle', es: '30 min: al castillo' },
  full: { uk: 'Повний тур', en: 'Full tour', es: 'Tour completo' },
};

// a level made from a tour of data/tour.json (the three tours of the game; also the fallback when data/levels cannot be loaded)
// vias: { gateId: [[x, z], ...] } or with finish key "<id>:finish" (data/arcade-via.json of one tour); par: seconds or null
export function levelFromTour(spec, tourId, { vias = null, par = null } = {}) {
  const def = spec.tours.find((t) => t.id === tourId) || spec.tours[0];
  const items = [];
  const viasOf = (key) => (vias && vias[key] || []).map((v) => ({ k: 'via', p: [v.p ? v.p[0] : v[0], v.p ? v.p[1] : v[1]], ...(v.r && v.r !== LEVEL.viaR ? { r: v.r } : {}) }));
  for (const r of def.route) { const id = r.stop || r.pass; items.push(...viasOf(id), { k: 'gate', place: id }); }
  items.push(...viasOf(def.start + ':finish'), { k: 'gate', place: def.start, finish: true });
  return {
    schema: LEVEL.schema, id: def.id, title: BUILTIN_TITLES[def.id] || { uk: def.title || def.id, en: def.title || def.id, es: def.title || def.id },
    type: 'standard', start: { place: def.start }, time: { mode: 'auto', par: par || null }, items, rules: {}, extras: {},
  };
}

export const gatesOf = (level) => (level.items || []).filter((i) => i.k === 'gate');

// checks the shape and the rules that need no map; returns a list of problems (empty = fine). {places}: city.tour.places (to know a place id), optional
export function validateLevel(level, { places = null } = {}) {
  const er = [];
  if (!level || typeof level !== 'object') return ['рівень порожній'];
  if (level.schema !== LEVEL.schema) er.push(`невідома версія формату: ${level.schema}`);
  if (!level.id || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(level.id)) er.push('id: латиницею, цифри, «-» або «_», до 40 символів');
  if (!level.title || !(level.title.uk || '').trim()) er.push('немає назви українською');
  for (const l of LEVEL.langs) if (level.title && String(level.title[l] || '').length > LEVEL.titleMax) er.push(`назва ${l} довша за ${LEVEL.titleMax} символів`);
  if (!LEVEL.types.includes(level.type || 'standard')) er.push(`невідомий тип рівня: ${level.type}`);
  const s = level.start;
  if (!s || !(s.place || (Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.heading)))) er.push('немає старту (місце або x, z, heading)');
  else if (s.place && places && !places[s.place]) er.push(`старт: місце «${s.place}» не знайдено`);
  const t = level.time || {};
  if (t.mode !== 'auto' && t.mode !== 'manual') er.push('час: mode має бути auto або manual');
  if (t.mode === 'manual' && !(t.par >= 20 && t.par <= 3600)) er.push('час уручну: від 20 до 3600 секунд');
  const items = level.items || [], gates = gatesOf(level);
  if (gates.length < LEVEL.minGates) er.push(`воріт ${gates.length}: потрібно щонайменше ${LEVEL.minGates}`);
  if (gates.length > LEVEL.maxGates) er.push(`воріт ${gates.length}: не більше ${LEVEL.maxGates}`);
  let last = -1; items.forEach((it, i) => { if (it.k === 'gate') last = i; });
  items.forEach((it, i) => {
    if (it.k === 'gate') {
      const fin = it.finish === true;
      if (fin !== (i === last)) er.push(i === last ? 'останні ворота мають бути фінішем' : 'фініш має бути останніми воротами');
      if (it.place) { if (places && !places[it.place]) er.push(`ворота ${i}: місце «${it.place}» не знайдено`); }
      else if (!(Array.isArray(it.p) && Number.isFinite(it.p[0]) && Number.isFinite(it.p[1]))) er.push(`ворота ${i}: немає координат`);
      if (it.fact && String(it.fact).length > LEVEL.factMax) er.push(`ворота ${i}: факт довший за ${LEVEL.factMax} символів`);
    } else if (it.k === 'via') {
      if (!(Array.isArray(it.p) && Number.isFinite(it.p[0]) && Number.isFinite(it.p[1]))) er.push(`«через» ${i}: немає координат`);
      if (i > last) er.push('«через» після фінішу не має сенсу');
    } else er.push(`елемент ${i}: невідомий вид «${it.k}»`);
  });
  return er;
}
