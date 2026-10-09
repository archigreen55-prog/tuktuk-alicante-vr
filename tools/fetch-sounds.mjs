// Downloads the sound sources of assets/audio-src/sounds.json into assets/audio-src/dl/ (not kept in git):
//   freesound: the HQ preview mp3 from cdn.freesound.org (found on the sound's page; no login needed),  kenney: the pack's zip from kenney.nl, unzipped.
//   node tools/fetch-sounds.mjs [--only key,key] [--list kenney-key]
// Uses curl (it honours the proxy settings of this environment). Hosts needed: freesound.org, cdn.freesound.org, kenney.nl. Prints what failed; nothing is invented.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DL = 'assets/audio-src/dl';
const cfg = JSON.parse(await readFile('assets/audio-src/sounds.json', 'utf8'));
const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = flag('--only') ? flag('--only').split(',') : null;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const curl = (url, out) => {
  const a = ['-sSL', '-m', '120', '-A', UA, '--retry', '2', '-w', '%{http_code}', ...(out ? ['-o', out] : []), url];
  const r = spawnSync('curl', a, { encoding: out ? 'utf8' : 'latin1', maxBuffer: 1 << 28 });
  const code = out ? r.stdout.trim() : r.stdout.slice(-3), body = out ? '' : r.stdout.slice(0, -3);
  return { ok: r.status === 0 && code === '200', code, body, err: (r.stderr || '').trim() };
};
// every file below a directory
async function walk(d) { const out = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }

if (flag('--list')) {
  const dir = path.join(DL, flag('--list'));
  if (!existsSync(dir)) { console.log(`нема ${dir}: спершу node tools/fetch-sounds.mjs --only ${flag('--list')}`); process.exit(1); }
  for (const f of (await walk(dir)).filter((x) => /\.(ogg|wav|mp3|flac)$/i.test(x)).sort()) console.log(path.relative(dir, f));
  process.exit(0);
}

await mkdir(DL, { recursive: true });
const logFile = path.join(DL, 'fetched.json');
const log = existsSync(logFile) ? JSON.parse(await readFile(logFile, 'utf8')) : {};
let failed = 0;
for (const [key, s] of Object.entries(cfg.sources)) {
  if (only && !only.includes(key)) continue;
  try {
    if (s.type === 'freesound') {
      const file = path.join(DL, `${key}.mp3`);
      if (existsSync(file) && (await stat(file)).size > 5000) { console.log(`${key}: вже є`); continue; }
      const page = curl(`https://freesound.org/s/${s.id}/`);
      if (!page.ok) throw new Error(`сторінка ${page.code} ${page.err}`);
      const m = page.body.match(new RegExp(`https://cdn\\.freesound\\.org/previews/\\d+/${s.id}_\\d+-hq\\.mp3`)) || page.body.match(/https:\/\/[^"'\s]+?-hq\.mp3/);
      if (!m) throw new Error('на сторінці не знайдено посилання на HQ-прев\'ю');
      const lic = /creativecommons\.org\/publicdomain\/zero/.test(page.body) ? 'CC0' : /creativecommons\.org\/licenses\/by\/4\.0/.test(page.body) ? 'CC BY 4.0' : /creativecommons\.org\/licenses\/by-nc/.test(page.body) ? 'CC BY-NC' : /creativecommons\.org\/licenses\/by\/3\.0/.test(page.body) ? 'CC BY 3.0' : 'невідома';
      const title = (page.body.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || s.name, author = (page.body.match(/href="\/people\/([^/"]+)\//) || [])[1] || s.author;
      const dl = curl(m[0], file); if (!dl.ok) throw new Error(`файл ${dl.code} ${dl.err}`);
      log[key] = { file: path.relative(DL, file), title, author, license: lic, url: `https://freesound.org/s/${s.id}/` };
      console.log(`${key}: ${title} · ${author} · ${lic}${lic.replace(/ 4\.0| 3\.0/, '') !== s.license.replace(/ 4\.0| 3\.0/, '') ? `   !!! у sounds.json: ${s.license}` : ''}`);
    } else if (s.type === 'kenney') {
      const dir = path.join(DL, key);
      if (existsSync(dir) && (await walk(dir)).length) { console.log(`${key}: вже є`); continue; }
      const page = curl(s.page); if (!page.ok) throw new Error(`сторінка ${page.code} ${page.err}`);
      const z = page.body.match(/href="([^"]+\.zip)"/i); if (!z) throw new Error('на сторінці пакета не знайдено zip');
      const url = new URL(z[1].replace(/&amp;/g, '&'), s.page).toString(), zip = path.join(DL, `${key}.zip`);
      const dl = curl(url, zip); if (!dl.ok) throw new Error(`zip ${dl.code} ${dl.err}`);
      await mkdir(dir, { recursive: true });
      const u = spawnSync('unzip', ['-q', '-o', zip, '-d', dir], { encoding: 'utf8' }); if (u.status !== 0) throw new Error(`unzip: ${u.stderr}`);
      log[key] = { dir: key, url: s.page, license: s.license, author: s.author };
      console.log(`${key}: ${(await walk(dir)).length} файлів`);
    }
  } catch (e) { failed++; console.log(`${key}: НЕ ВДАЛОСЯ: ${e.message}`); }
}
await writeFile(logFile, JSON.stringify(log, null, 2) + '\n');
console.log(failed ? `\nне вдалося: ${failed}` : '\nусе скачано');
process.exit(failed ? 1 : 0);
