// The interface languages (0.19.0): both dictionaries carry the same keys, the English one has no Cyrillic, the {placeholders} match,
// data/tour.json has the English titles and reviews, and the facts of arcade-facts.json exist in both languages for every place.
// Usage: node tools/test-i18n.mjs
import { readFileSync } from 'node:fs';
import { dictionaries, t, setLang, pick } from '../src/i18n.js';
let bad = 0; const check = (c, m, x = '') => { if (!c) bad++; console.log(c ? 'ok  ' : 'FAIL', m, x); };
const { en, uk } = dictionaries;
const ke = Object.keys(en), ku = Object.keys(uk);
check(ke.length > 200, `dictionary size ${ke.length}`);
check(ke.filter((k) => !(k in uk)).length === 0, 'every English key is in Ukrainian', ke.filter((k) => !(k in uk)).join(','));
check(ku.filter((k) => !(k in en)).length === 0, 'every Ukrainian key is in English', ku.filter((k) => !(k in en)).join(','));
check(ke.every((k) => !/[А-Яа-яІіЇїЄєҐґ]/.test(en[k])), 'no Cyrillic in English', ke.filter((k) => /[А-Яа-яІіЇїЄєҐґ]/.test(en[k])).join(','));
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join('');
const diff = ke.filter((k) => vars(en[k]) !== vars(uk[k]));
check(diff.length === 0, 'the {placeholders} match in both languages', diff.join(','));
check(ke.every((k) => typeof en[k] === 'string' && en[k].length && typeof uk[k] === 'string' && uk[k].length), 'no empty strings');
setLang('en', { save: false });
check(t('sum.gatesLine', { e: 1, g: 2, o: 3, m: 4, n: 6 }) === 'exact 1 · good 2 · hit 3 · missed 4 of 6', 't() fills the placeholders');
check(t('no.such.key') === 'no.such.key', 'an unknown key comes back as the key');
check(pick({ uk: 'У', en: 'E' }) === 'E' && (setLang('uk', { save: false }), pick({ uk: 'У', en: 'E' }) === 'У'), 'pick() follows the language');
const tour = JSON.parse(readFileSync(new URL('../data/tour.json', import.meta.url), 'utf8'));
const places = Object.entries(tour.places);
check(places.every(([, p]) => p.title_en), 'every place has title_en', places.filter(([, p]) => !p.title_en).map(([id]) => id).join(','));
check(tour.reviews_en && Object.keys(tour.reviews).every((k) => Array.isArray(tour.reviews_en[k]) && tour.reviews_en[k].length === tour.reviews[k].length), 'reviews_en mirrors reviews');
const facts = JSON.parse(readFileSync(new URL('../data/arcade-facts.json', import.meta.url), 'utf8'));
check(places.every(([id]) => facts.uk[id] && facts.en[id]), 'arcade facts in uk and en for every place', places.filter(([id]) => !(facts.uk[id] && facts.en[id])).map(([id]) => id).join(','));
console.log(bad ? `${bad} FAILED` : 'ALL OK'); process.exit(bad ? 1 : 0);
