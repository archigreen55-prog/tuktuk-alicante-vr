// Synchronisation with TukTuk OS (docs/plan-tuktuk-os-sync-2.md): one command pulls the points of the route (coordinates, names, texts, photos,
// icons) into the game. The source is a read-only copy of TukTuk OS, a branch of it (data/tuktuk-os-map.json "source").
//
//   node tools/sync-tuktuk-os.mjs [--ref origin/feat/route-preview] [--repo <dir> | --clone] [--dry-run | --check] [--no-fetch] [--no-build]
//   node tools/sync-tuktuk-os.mjs --stamp-translations     the English texts / Crazy Tuk lines in data/ are current: remember the hashes of the Ukrainian originals
//   node tools/sync-tuktuk-os.mjs --translations-doc        writes docs/translations-os-en.md (the Ukrainian original and the English text side by side)
//
// What it does: reads points.json, text.uk.json (+ text.stubs.uk.json), media.json of the branch; writes
//   data/places-os.json          the points: game id, coordinates, clean title, short / long texts, questions, sources, icon, photo (generated; do not edit)
//   assets/tour/<id>/…           icon (illustration.svg), photo.webp (640 px), thumb.webp; assets/tour/CREDITS.md (authors, licences)
// then prints the report of what changed (added, removed, moved, text changed), the translations that are missing or out of date
// (data/places-os.en.json) and the Crazy Tuk lines that are missing, too long or out of date (data/tuktuk-os-arcade.json), and rebuilds
// data/city.json (tools/build-city.mjs) when the coordinates changed. --dry-run: the report only. --check: exit code 1 if the game is behind TukTuk OS.
// The mapping (which TukTuk OS point is which place of the game) is data/tuktuk-os-map.json "points"; the old tools/import-tuktuk-os.mjs (route lines) uses the same file.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINE_MAX, isPlaceholder } from '../src/game/placesData.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWN = { 'dry-run': 0, check: 0, 'no-fetch': 0, 'no-build': 0, clone: 0, help: 0, 'stamp-translations': 0, 'translations-doc': 0, repo: 1, ref: 1 };
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], name = a.replace(/^--/, '');
  if (!a.startsWith('--') || !(name in KNOWN)) fail(`невідомий аргумент ${a}. Довідка: node tools/sync-tuktuk-os.mjs --help`);
  if (KNOWN[name]) { const v = process.argv[++i]; if (v === undefined || v.startsWith('--')) fail(`--${name}: потрібне значення`); args[name] = v; } else args[name] = true;
}
if (args.help) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(src.slice(0, src.findIndex((l) => l.startsWith('import'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim());
  process.exit(0);
}
function fail(msg) { console.error('✗ ' + msg); process.exit(2); }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hash = (v) => createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 8);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const lines = [];
const say = (s = '') => lines.push(s);

// ---------- the mapping ----------
const MAP_FILE = join(ROOT, 'data/tuktuk-os-map.json');
const map = readJson(MAP_FILE);
const ref = args.ref || (map.source && map.source.ref) || 'origin/main';
const route = (map.source && map.source.route) || 'alicante-classic';
const CONTENT = `client/src/content/routes/${route}`, MEDIA = `client/public/media/${route}`;

// ---------- the copy of TukTuk OS ----------
function findRepo() {
  const want = args.repo || (map.source && map.source.repo && map.source.repo.replace(/^~(?=\/|$)/, homedir()));
  const sibling = resolve(ROOT, '..', 'tuktuk-os');
  for (const d of [args.repo, want, process.env.TUKTUK_OS_REPO, sibling]) if (d && existsSync(join(d, '.git'))) return d;
  if (args.clone) {
    const dir = mkdtempSync(join(tmpdir(), 'tuktuk-os-'));
    console.error(`… клоную TukTuk OS у ${dir} (без файлів, лише потрібні гілки)`);
    execFileSync('git', ['clone', '--quiet', '--no-checkout', '--filter=blob:none', 'https://github.com/archigreen55-prog/tuktuk-os', dir], { stdio: 'inherit' });
    return dir;
  }
  return fail(`немає копії TukTuk OS (шукав: ${[args.repo, want, sibling].filter(Boolean).join(', ')}). Вкажи --repo <тека> або додай --clone.`);
}
const repo = findRepo();
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 120_000 });
const gitBin = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 120_000 });
if (!args['no-fetch']) { try { git('fetch', '--all', '--prune', '--quiet'); } catch (err) { say(`⚠ git fetch не вдався (${String(err.stderr || err.message).split('\n')[0]}): беру те, що є локально.`); } }
let commit; try { commit = git('rev-parse', ref).trim(); } catch { fail(`у копії TukTuk OS немає гілки чи коміту ${ref}`); }
const show = (p) => { try { return git('show', `${ref}:${p}`); } catch { return null; } };
const showJson = (p) => { const t = show(p); if (t === null) return null; try { return JSON.parse(t); } catch (err) { return fail(`${ref}:${p} — не JSON: ${err.message}`); } };

const points = showJson(`${CONTENT}/points.json`);
const texts = showJson(`${CONTENT}/text.uk.json`) || {};
const stubs = showJson(`${CONTENT}/text.stubs.uk.json`) || {};
const media = showJson(`${CONTENT}/media.json`) || {};
if (!points) fail(`у ${ref} немає ${CONTENT}/points.json`);

// ---------- ids and titles ----------
const camel = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const gameId = (id) => (map.points && map.points[id] && map.points[id].vr) || camel(id);
// "Casa Carbonell — старт туру", "…, фініш туру": the role of a point belongs to a level, not to the name
const cleanTitle = (id, t) => (map.points && map.points[id] && map.points[id].title) || String(t || id).replace(/\s*(—|-|,)\s*(старт|фініш)( туру)?\s*$/i, '').replace(/,\s*(старт|фініш) туру\s*$/i, '').trim();

const prev = existsSync(join(ROOT, 'data/places-os.json')) ? readJson(join(ROOT, 'data/places-os.json')) : { places: {} };
const places = {};
const assets = [];   // { to, bytes }
const credits = [];
const seen = new Set();
for (const p of points) {
  const id = gameId(p.id);
  if (seen.has(id)) fail(`два пункти TukTuk OS дають одне місце гри "${id}" (дивись points у data/tuktuk-os-map.json)`);
  seen.add(id);
  const tx = texts[p.id] || stubs[p.id] || {};
  const md = media[p.id] || {};
  const rec = {
    os: p.id, ...(Number.isFinite(p.order) ? { order: p.order } : {}), role: p.role, zone: p.zone, stop: p.stopKind || null,
    lat: r6(p.lat), lng: r6(p.lng), coordSource: p.coordSource || '',
    title: cleanTitle(p.id, tx.title), short: isPlaceholder(tx.short) ? '' : tx.short,
  };
  if (tx.long && tx.long.length) rec.long = tx.long;
  if (tx.questions && tx.questions.length) rec.questions = tx.questions;
  if (tx.sources && tx.sources.length) rec.sources = tx.sources;
  if (md.illustration) {
    const buf = tryBin(`${MEDIA}/${p.id}/illustration.svg`);
    if (buf) {
      rec.icon = `assets/tour/${id}/illustration.svg`; assets.push({ to: rec.icon, bytes: buf });
      const c = md.illustration.credit || {}; credits.push(`- ${rec.title}: ілюстрація — ${c.author || 'TukTuk'}, ${c.license || ''}${c.status ? ` (${c.status})` : ''}`);
    }
  }
  if (md.photo) {
    const sw = (md.photo.srcset || []).find((s) => s.w === 640) || (md.photo.srcset || [])[0];
    const pb = sw && tryBin(`${MEDIA}/${p.id}/${sw.src.split('/').pop()}`), tb = md.photo.thumb && tryBin(`${MEDIA}/${p.id}/${md.photo.thumb.split('/').pop()}`);
    if (pb) {
      assets.push({ to: `assets/tour/${id}/photo.webp`, bytes: pb });
      if (tb) assets.push({ to: `assets/tour/${id}/thumb.webp`, bytes: tb });
      const c = md.photo.credit || {};
      rec.photo = {
        src: `assets/tour/${id}/photo.webp`, ...(tb ? { thumb: `assets/tour/${id}/thumb.webp` } : {}), w: sw.w, ratio: md.photo.width && md.photo.height ? +(md.photo.width / md.photo.height).toFixed(3) : 1.333,
        ...(md.photo.placeholder ? { placeholder: md.photo.placeholder } : {}), alt: (md.photo.alt && md.photo.alt.uk) || '',
        credit: { title: c.title || '', author: c.author || '', license: c.license || '', licenseUrl: c.licenseUrl || '', sourceUrl: c.sourceUrl || '', modifications: c.modifications || '', status: c.status || '' },
      };
      credits.push(`- ${rec.title}: фото — ${c.author || '?'}, ${c.license || '?'}${c.licenseUrl ? ` (${c.licenseUrl})` : ''}, ${c.sourceUrl || c.title || ''}${c.modifications ? `. Зміни: ${c.modifications}` : ''}${c.status ? ` [${c.status}]` : ''}`);
    }
  }
  places[id] = rec;
}
function tryBin(path) { try { return gitBin('show', `${ref}:${path}`); } catch { return null; } }

const out = {
  _help: ['ЗГЕНЕРОВАНО tools/sync-tuktuk-os.mjs з TukTuk OS. Не редагуй: зміни йдуть у TukTuk OS (або в data/tuktuk-os-map.json) і підтягуються командою node tools/sync-tuktuk-os.mjs.'],
  source: { repo: 'archigreen55-prog/tuktuk-os', ref: ref.replace(/^origin\//, ''), commit: commit.slice(0, 12), route },
  places,
};
const outText = JSON.stringify(out, null, 1).replace(/\n {3,}/g, (m) => m) + '\n';

// ---------- the report: what changed ----------
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 87418.57, (a.lat - b.lat) * 111003);
const added = Object.keys(places).filter((k) => !prev.places[k]), removed = Object.keys(prev.places).filter((k) => !places[k]);
const moved = [], retext = [], rephoto = [];
for (const [k, n] of Object.entries(places)) {
  const o = prev.places[k]; if (!o) continue;
  const d = metres(n, o); if (d > 1) moved.push(`${k} (${Math.round(d)} м)`);
  const ch = ['title', 'short', 'long', 'questions', 'sources'].filter((f) => JSON.stringify(n[f]) !== JSON.stringify(o[f])); if (ch.length) retext.push(`${k}: ${ch.join(', ')}`);
  if (JSON.stringify(n.photo) !== JSON.stringify(o.photo) || n.icon !== o.icon) rephoto.push(k);
}
const same = !added.length && !removed.length && !moved.length && !retext.length && !rephoto.length && (!prev.source || prev.source.commit === out.source.commit);
say(`TukTuk OS: ${ref} @ ${commit.slice(0, 12)}, пунктів ${points.length}, у грі місць ${Object.keys(places).length}`);
say(same ? '✓ data/places-os.json збігається з TukTuk OS: нових змін немає.' : '');
if (!same) {
  if (added.length) say(`+ додано: ${added.join(', ')}`);
  if (removed.length) say(`− зникло з TukTuk OS: ${removed.join(', ')}`);
  if (moved.length) say(`↔ зсунулось: ${moved.join(', ')}`);
  if (retext.length) say(`✎ змінився текст: ${retext.join('; ')}`);
  if (rephoto.length) say(`▣ фото чи значок: ${rephoto.join(', ')}`);
}

// ---------- translations and Crazy Tuk lines ----------
const enFile = join(ROOT, 'data/places-os.en.json'), arcFile = join(ROOT, 'data/tuktuk-os-arcade.json');
const en = existsSync(enFile) ? readJson(enFile) : { _help: [], places: {} };
const arc = existsSync(arcFile) ? readJson(arcFile) : { _help: [], places: {} };
const FIELDS = ['title', 'short', 'long', 'questions'];
const src = (rec, f) => (f === 'short' && !rec.short ? '' : rec[f]);
if (args['stamp-translations']) {
  for (const [k, rec] of Object.entries(places)) {
    const e = en.places[k]; if (e) { e.from = {}; for (const f of FIELDS) if (e[f] != null && src(rec, f)) e.from[f] = hash(src(rec, f)); }
    const a = arc.places[k]; if (a) a.from = hash(rec.short || rec.title);
  }
  writeFileSync(enFile, JSON.stringify(en, null, 1) + '\n'); writeFileSync(arcFile, JSON.stringify(arc, null, 1) + '\n');
  console.log(`✓ хеші перекладів оновлено (${Object.keys(en.places).length} місць, ${Object.keys(arc.places).length} рядків Crazy Tuk)`);
}
// places that are not in the game (outside the play area: no street near them, data/city.json) need no long text, no question and no Crazy Tuk line
let inCity = null; try { inCity = readJson(join(ROOT, 'data/city.json')).tour.places; } catch { /* no city yet: everything is needed */ }
const inGame = (k) => !inCity || !!inCity[k];
const needEn = { title: [], short: [], long: [], questions: [] }, staleEn = [], tooLong = [], noLine = [], staleLine = [], draft = [];
for (const [k, rec] of Object.entries(places)) {
  const e = en.places[k] || {};
  for (const f of FIELDS) {
    if (!src(rec, f) || (Array.isArray(rec[f]) && !rec[f].length) || (!inGame(k) && (f === 'long' || f === 'questions'))) continue;
    if (e[f] == null) needEn[f].push(k);
    else if (e.from && e.from[f] !== hash(src(rec, f))) staleEn.push(`${k}.${f}`);
  }
  if (e.draft) draft.push(k);
  const a = arc.places[k];
  if ((!rec.short && !rec.long) || !inGame(k)) continue;   // no text of TukTuk OS ("Опис готується") or not in the game: no line
  if (!a || !a.uk || !a.en) noLine.push(k);
  else {
    if (a.uk.length > LINE_MAX || a.en.length > LINE_MAX) tooLong.push(`${k} (${a.uk.length}/${a.en.length})`);
    if (a.from && a.from !== hash(rec.short || rec.title)) staleLine.push(k);
  }
}
const keysOf = (o) => Object.entries(o).map(([f, a]) => (a.length ? `${f}: ${a.join(', ')}` : '')).filter(Boolean);
say();
say('Переклади (data/places-os.en.json):');
say(keysOf(needEn).length ? '  немає англійської: ' + keysOf(needEn).join(' | ') : '  ✓ усе перекладено');
if (staleEn.length) say('  ⚠ оригінал змінився після перекладу (переклад лишається, але застарів): ' + staleEn.join(', '));
if (draft.length) say(`  · чернетки, що чекають перевірки власника: ${draft.length}`);
say('Рядки Crazy Tuk (data/tuktuk-os-arcade.json):');
say(noLine.length ? '  немає рядка: ' + noLine.join(', ') : '  ✓ рядки є для всіх місць з текстом');
if (tooLong.length) say(`  ✗ довші за ${LINE_MAX} знаків: ` + tooLong.join(', '));
if (staleLine.length) say('  ⚠ short змінився після рядка: ' + staleLine.join(', '));

// ---------- --translations-doc ----------
if (args['translations-doc']) {
  const md = ['# Переклади з TukTuk OS на англійську: для перевірки', '', `Згенеровано tools/sync-tuktuk-os.mjs --translations-doc (TukTuk OS ${ref} @ ${commit.slice(0, 12)}). Оригінал (uk) — з TukTuk OS, англійську пишу я.`,
    'Що виправити — виправ прямо тут або напиши в чат; я перенесу в data/places-os.en.json. «ок» під блоком означає, що все добре. Усе, що тут, уже в грі як чернетка.', ''];
  const sec = (title, f, fmt) => {
    md.push(`## ${title}`, '');
    for (const [k, rec] of Object.entries(places)) {
      const e = en.places[k]; if (!e || e[f] == null || !src(rec, f) || (Array.isArray(rec[f]) && !rec[f].length)) continue;
      md.push(`### ${rec.title} \`${k}\``, '', ...fmt(rec[f], e[f]), '');
    }
  };
  const one = (u, e) => [`- uk: ${u}`, `- en: ${e}`];
  md.push('## 1. Назви', '', '| Місце | uk (TukTuk OS) | en |', '|---|---|---|');
  for (const [k, rec] of Object.entries(places)) { const e = en.places[k]; if (e && e.title) md.push(`| \`${k}\` | ${rec.title} | ${e.title} |`); }
  md.push('');
  sec('2. Короткі описи (картка Справжнього туру)', 'short', one);
  const arcMd = ['## 3. Рядки Crazy Tuk (≤ ' + LINE_MAX + ' знаків)', '', '| Місце | uk | en |', '|---|---|---|'];
  for (const [k, a] of Object.entries(arc.places)) if (places[k]) arcMd.push(`| ${places[k].title} | ${a.uk} (${a.uk.length}) | ${a.en} (${a.en.length}) |`);
  md.push(...arcMd, '');
  sec('4. Докладніше (long)', 'long', (u, e) => u.flatMap((x, i) => [`- uk ${i + 1}: ${x}`, `- en ${i + 1}: ${e[i] ?? '—'}`, '']));
  sec('5. Питання й відповіді', 'questions', (u, e) => u.flatMap((x, i) => [`- uk ${i + 1}: **${x.q}** ${x.a}`, `- en ${i + 1}: **${e[i] ? e[i].q : '—'}** ${e[i] ? e[i].a : ''}`, '']));
  writeFileSync(join(ROOT, 'docs/translations-os-en.md'), md.join('\n') + '\n');
  console.log('✓ docs/translations-os-en.md');
}

// ---------- write ----------
const creditsText = ['# Фото й значки точок маршруту (з TukTuk OS)', '', 'Згенеровано tools/sync-tuktuk-os.mjs. Усе зі статусом prototype — тимчасове. Фото з Wikimedia Commons: автор і ліцензія обов’язкові (CC BY / CC BY-SA).', '', ...credits, ''].join('\n');
const diskOf = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p)) : null);
const changedAssets = assets.filter((a) => { const d = diskOf(a.to); return !d || !d.equals(a.bytes); });
const placesChanged = diskOf('data/places-os.json')?.toString() !== outText;
const creditsChanged = diskOf('assets/tour/CREDITS.md')?.toString() !== creditsText;
if (changedAssets.length) say(`\nФайли в assets/tour: ${changedAssets.length} змінилось з ${assets.length}`);
if (args.check) {
  const behind = placesChanged || changedAssets.length || creditsChanged || staleEn.length || tooLong.length;
  console.log(lines.join('\n'));
  console.log(behind ? '\n✗ --check: гра відстала від TukTuk OS (запусти node tools/sync-tuktuk-os.mjs)' : '\n✓ --check: гра відповідає TukTuk OS');
  process.exit(behind ? 1 : 0);
}
if (!args['dry-run']) {
  if (placesChanged) writeFileSync(join(ROOT, 'data/places-os.json'), outText);
  for (const a of changedAssets) { mkdirSync(dirname(join(ROOT, a.to)), { recursive: true }); writeFileSync(join(ROOT, a.to), a.bytes); }
  if (creditsChanged) { mkdirSync(join(ROOT, 'assets/tour'), { recursive: true }); writeFileSync(join(ROOT, 'assets/tour/CREDITS.md'), creditsText); }
  say(placesChanged ? '\n✓ data/places-os.json записано' : '\n· data/places-os.json без змін');
  if (!args['no-build'] && (placesChanged || moved.length)) {
    say('… node tools/build-city.mjs');
    const log = execFileSync('node', ['tools/build-city.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const l of log.split('\n')) if (/^place |^tour |no drivable|not found|needs "osm"/.test(l)) say('  ' + l.slice(0, 200));
    say('  (par рівнів: node tools/sim-arcade.mjs <рівень> --par --write, якщо ворота зсунулись більш ніж на 15 м)');
    const far = moved.filter((s) => parseInt(s.match(/\((\d+) м\)/)[1], 10) > 15);
    if (far.length) say(`  ⚠ ворота зсунулись більш ніж на 15 м: ${far.join(', ')} — перерахуй par і переглянь рівні`);
  }
} else say('\n(--dry-run: нічого не записано)');
console.log(lines.join('\n'));
