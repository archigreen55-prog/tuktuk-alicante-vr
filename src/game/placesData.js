// The places of the game: the structure (which OSM object, which street) lives in data/tour.json, everything that comes from TukTuk OS
// (coordinates, names, texts, photos, icons: tools/sync-tuktuk-os.mjs) in data/places-os.json, the English texts in data/places-os.en.json
// and the one-line texts of Crazy Tuk in data/tuktuk-os-arcade.json. Node-safe (the game, build-city and the tools merge them the same way).

// The one-line text of Crazy Tuk is at most this long (the card hangs for three seconds)
export const LINE_MAX = 90;
// "Опис готується" is the placeholder of TukTuk OS for a point without a text: not a fact
export const isPlaceholder = (s) => !s || /^(Опис готується|ЗАГЛУШКА)/.test(s);

// Puts the data of TukTuk OS into spec.places (in place): Ukrainian in the plain fields, English in *_en.
//   title, fact (the short text), long [paragraphs], questions [{ q, a }], sources, photo, icon, line (Crazy Tuk), at [lat, lng], zone, os (the id in TukTuk OS)
// Places without a record in places-os.json keep what tour.json says. Returns spec.
export function mergePlaces(spec, os, en, arc) {
  const places = spec.places = spec.places || {};
  for (const [id, o] of Object.entries((os && os.places) || {})) {
    const base = places[id] = places[id] || {};
    const e = (en && en.places && en.places[id]) || {}, a = (arc && arc.places && arc.places[id]) || {};
    base.os = o.os; base.zone = o.zone; base.at = [o.lat, o.lng];
    base.title = o.title; if (e.title) base.title_en = e.title;
    if (!isPlaceholder(o.short)) { base.fact = o.short; if (e.short) base.fact_en = e.short; } else { delete base.fact; delete base.fact_en; }
    if (o.long && o.long.length) { base.long = o.long; if (e.long && e.long.length) base.long_en = e.long; }
    if (o.questions && o.questions.length) { base.questions = o.questions; if (e.questions && e.questions.length) base.questions_en = e.questions; }
    if (o.sources && o.sources.length) base.sources = o.sources;
    if (o.photo) base.photo = o.photo;
    if (o.icon) base.icon = o.icon;
    if (a.uk) base.line = a.uk;
    if (a.en) base.line_en = a.en;
  }
  return spec;
}

// { placeId: one line } in the given language (English falls back to Ukrainian), for Crazy Tuk
export function arcadeLines(spec, lang) {
  const out = {};
  for (const [id, p] of Object.entries(spec.places || {})) { const l = (lang === 'en' && p.line_en) || p.line; if (l) out[id] = l; }
  return out;
}
