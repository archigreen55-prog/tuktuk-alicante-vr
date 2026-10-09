// Builds the sounds from assets/audio-src/sounds.json and the files that tools/fetch-sounds.mjs downloaded into assets/audio-src/dl/:
//   approved   -> assets/audio-src/map.generated.json -> tools/prepare-audio.mjs -> assets/audio/ (the game's sounds) + manifest + CREDITS.md
//   candidates -> assets/audio-cand/ (+ manifest.json): ready-made effects and SEAMLESS LOOPS for the sound lab (menu ≡ -> «Звуки», editor devices only)
//   node tools/build-sounds.mjs [--approved] [--candidates]       (both by default)
// Loops are cut where the recording is steady (tools/lib/audio-analysis.mjs), bursts (laughs, shouts) at the loudest places.
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeSfx, makeLoop } from './lib/audio-ff.mjs';
import { decodePcm, findSteady, findBursts } from './lib/audio-analysis.mjs';

const SRC = 'assets/audio-src', DL = `${SRC}/dl`, CAND = 'assets/audio-cand';
const cfg = JSON.parse(await readFile(`${SRC}/sounds.json`, 'utf8'));
const args = process.argv.slice(2), wantA = args.includes('--approved') || !args.includes('--candidates'), wantC = args.includes('--candidates') || !args.includes('--approved');
const meta = existsSync(`${DL}/fetched.json`) ? JSON.parse(await readFile(`${DL}/fetched.json`, 'utf8')) : {};

async function walk(d) { const out = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '(\\.[a-z0-9]+)?$', 'i');
// "key" or "key:pattern" (+ pick) -> [{ file (relative to the source dir), source, label }]
async function resolve(ref, pick = 1) {
  const [key, pattern] = ref.split(':'), s = cfg.sources[key];
  if (!s) throw new Error(`нема джерела ${key} у sounds.json`);
  if (s.type === 'freesound') { const f = `dl/${key}.mp3`; return existsSync(path.join(SRC, f)) ? [{ file: f, source: s, key, label: s.name }] : []; }
  const dir = path.join(DL, key); if (!existsSync(dir)) return [];
  const re = globRe(pattern || '*'), files = (await walk(dir)).filter((f) => /\.(ogg|wav|mp3|flac)$/i.test(f) && re.test(path.basename(f).replace(/\.[a-z0-9]+$/i, '')) ).sort();
  return files.slice(0, pick).map((f) => ({ file: path.relative(SRC, f), source: s, key, label: path.basename(f) }));
}
const creditOf = (s, label) => `«${label || s.name}»: ${s.author}, ${s.license}, ${s.url || (s.id ? `https://freesound.org/s/${s.id}/` : s.page)}${s.attribution ? ' (потрібна подяка за ліцензією)' : ''}`;
const attrOf = (s, label) => ({ title: label || s.name, author: s.author, license: s.license, url: s.url || (s.id ? `https://freesound.org/s/${s.id}/` : s.page) });

// ------------------------------------------------------------------ approved
if (wantA) {
  const items = [], missing = [];
  for (const a of cfg.approved) {
    const r = await resolve(a.src, a.pick || 1);
    if (!r.length) { missing.push(`${a.slot} <- ${a.src}`); continue; }
    const slot = cfg.slots[a.slot]; if (!slot) throw new Error(`нема слота ${a.slot}`);
    for (const x of r) {
      const info = meta[x.key] || {}, label = x.source.type === 'freesound' ? (info.title || x.source.name) : `${x.source.name}: ${x.label}`;
      items.push({ src: x.file, slot: `${slot.kind === 'loop' ? 'loops' : 'sfx'}.${a.slot}`, max: a.max || 3, slotGain: slot.gain, cfg: slot.cfg, credit: creditOf({ ...x.source, author: info.author || x.source.author }, x.source.type === 'kenney' ? x.source.name : label), ...(x.source.attribution ? { attribution: attrOf(x.source, label) } : {}) });
    }
  }
  console.log(`затверджені: ${items.length} файлів, не знайдено: ${missing.length}`);
  for (const m of missing) console.log('  немає: ' + m);
  if (items.length) {
    await writeFile(`${SRC}/map.generated.json`, JSON.stringify({ items }, null, 1));
    const r = spawnSync('node', ['tools/prepare-audio.mjs', `${SRC}/map.generated.json`], { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1);
  } else console.log('нічого збирати: спершу node tools/fetch-sounds.mjs');
}

// ------------------------------------------------------------------ candidates
if (wantC) {
  await rm(CAND, { recursive: true, force: true }); await mkdir(CAND, { recursive: true });
  const out = { schema: 1, slots: {} }; let n = 0;
  for (const [slotId, list] of Object.entries(cfg.candidates)) {
    const slot = cfg.slots[slotId], entry = { title: slot.title, kind: slot.kind, ...(slot.cfg ? { cfg: slot.cfg } : {}), gain: slot.gain ?? 1, candidates: [] };
    for (const c of list) {
      for (const x of await resolve(c.src, c.pick || 1)) {
        const src = path.join(SRC, x.file), info = meta[x.key] || {}, id = `${x.key}${x.source.type === 'kenney' ? '-' + x.label.replace(/\.[a-z0-9]+$/i, '') : ''}`.replace(/[^A-Za-z0-9_-]/g, '_');
        const name = x.source.type === 'freesound' ? (info.title || x.source.name) : `${x.source.name}: ${x.label}`, author = info.author || x.source.author;
        const base = { name, author, license: x.source.license, url: x.source.url || (x.source.id ? `https://freesound.org/s/${x.source.id}/` : x.source.page), attribution: !!x.source.attribution };
        try {
          if (slot.kind === 'loop') {
            let trim = null, note = 'ціле';
            if (c.auto === 'steady') { const seg = findSteady(decodePcm(src), 22050, { min: slotId === 'engine' ? 4 : 3, max: slotId === 'engine' ? 6 : 5 }); if (seg) { trim = [+seg.from.toFixed(2), +seg.to.toFixed(2)]; note = `рівна ділянка ${trim[0]}–${trim[1]} с`; } else note = 'рівної ділянки не знайдено: взято початок'; }
            if (!trim) trim = [0, 6];
            const file = `${slotId}/${id}.m4a`, r = await makeLoop(src, path.join(CAND, file), { trim });
            entry.candidates.push({ id, file, ...base, note: `${note}${r.tiles > 1 ? `; запис короткий, повторено ${r.tiles} разів` : ''}; цикл ${r.length.toFixed(1)} с` }); n++;
          } else if (c.bursts) {
            const bursts = findBursts(decodePcm(src), 22050, { n: c.bursts, min: c.min || 0.6, max: c.max || 2.5 });
            if (!bursts.length) throw new Error('голосних фрагментів не знайдено');
            let i = 0; for (const b of bursts) { i++; const cid = `${id}-b${i}`, file = `${slotId}/${cid}.m4a`; await makeSfx(src, path.join(CAND, file), { trim: [b.from, b.to] }); entry.candidates.push({ id: cid, file, ...base, name: `${name} (фрагмент ${i}: ${b.from}–${b.to} с)`, note: `вирізано за гучністю, ${b.db} дБ` }); n++; }
          } else { const file = `${slotId}/${id}.m4a`; await makeSfx(src, path.join(CAND, file), { max: c.max || 3 }); entry.candidates.push({ id, file, ...base, note: 'цілий файл, не довший за 3 с' }); n++; }
        } catch (e) { console.warn(`${slotId} <- ${c.src}: ${e.message}`); }
      }
      if (!(await resolve(c.src, c.pick || 1)).length) console.warn(`${slotId}: немає джерела ${c.src} (fetch-sounds)`);
    }
    out.slots[slotId] = entry;
  }
  await writeFile(`${CAND}/manifest.json`, JSON.stringify(out, null, 1) + '\n');
  console.log(`кандидати: ${n} файлів у ${CAND}/, слотів ${Object.keys(out.slots).length}`);
}
