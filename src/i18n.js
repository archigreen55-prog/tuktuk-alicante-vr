// Languages of the interface (0.19.0): English and Ukrainian. t('key', { n: 3 }) gives the string of the current language ({n} is replaced);
// the dictionaries are src/i18n/en.js and src/i18n/uk.js (flat keys). The language: ?lang=uk|en, else the saved choice (tuktuk.lang), else the
// phone's language (Ukrainian when it lists uk, English otherwise). setLang() saves it and fires 'tuktuk-lang' on window: the screens that are
// built once rebuild their texts on it. pick(obj) takes obj[lang] from data objects ({ uk, en, es }: level titles, facts).
import { loadSetting, saveSetting } from './settings.js';
import en from './i18n/en.js';
import uk from './i18n/uk.js';

const DICT = { en, uk };
export const LANGS = [['en', 'EN'], ['uk', 'UA']];
let lang = 'en';

const BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';   // the tools (node) import the game modules too
export function detectLang(params = BROWSER ? new URLSearchParams(location.search) : new URLSearchParams()) {
  const q = params.get('lang'); if (q && DICT[q]) return q;
  const saved = loadSetting('lang', null); if (saved && DICT[saved]) return saved;
  const langs = BROWSER ? navigator.languages || [navigator.language || 'en'] : ['uk'];
  return langs.some((l) => /^uk/i.test(l)) ? 'uk' : 'en';
}
export function setLang(l, { save = true } = {}) {
  if (!DICT[l] || l === lang) return false;
  lang = l; if (save) saveSetting('lang', l);
  if (BROWSER) { document.documentElement.lang = l; dispatchEvent(new CustomEvent('tuktuk-lang', { detail: l })); }
  return true;
}
export const getLang = () => lang;
export function t(key, vars) {
  let s = DICT[lang][key]; if (s == null) s = DICT.en[key]; if (s == null) return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}
export const pick = (obj, fallback = '') => (obj && typeof obj === 'object' ? (obj[lang] || obj.uk || obj.en || fallback) : (obj ?? fallback));
export const otherLang = () => (lang === 'uk' ? 'en' : 'uk');
// the dictionaries, for the tests (every key of en must be in uk and the other way round)
export const dictionaries = DICT;
// the start-up: the language before any screen is built
lang = detectLang(); if (BROWSER) document.documentElement.lang = lang;
