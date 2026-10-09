// Prepares the sound files of Crazy Tuk: assets/audio-src/<file> -> assets/audio/<slot files>.m4a (AAC), loudness-matched, trimmed,
// loops made seamless, and assets/audio/manifest.json + CREDITS.md updated. Needs ffmpeg.   node tools/prepare-audio.mjs [map.json]
// assets/audio-src/map.json (default):
//   { "items": [
//     { "src": "tuktuk.flac", "slot": "loops.engine", "trim": [12.0, 20.5], "cfg": { "kmh": [0, 150], "rate": [0.7, 1.9], "gain": [0.35, 0.7] },
//       "credit": "Thailand tuk tuk…: kyles, CC0, https://freesound.org/…" },
//     { "src": "horn.wav", "slot": "sfx.horn", "gain": -3, "credit": "…" },          // sfx.<name>: one variant; the same slot again = one more variant
//     // also: "max": longest effect in s; "slotGain": the slot's level in the game (manifest.gain); "attribution": { title, author, license, url } for CC BY works
//     { "src": "drive.mp3", "slot": "music.drive" }, { "src": "menu.mp3", "slot": "music.menu", "credit": "Suno (test)" } ] }
// slots: sfx.<name> (see assets/audio/README.md), loops.<name> (engine | wind | squeal | nitro), music.menu, music.drive.
// "trim": [from, to] seconds; "gain": dB after the loudness matching; "cfg": the loop's settings written into the manifest.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeSfx, makeLoop, ff } from './lib/audio-ff.mjs';

const SRC = 'assets/audio-src', OUT = 'assets/audio';
const mapFile = process.argv[2] || `${SRC}/map.json`;
if (!existsSync(mapFile)) { console.error(`нема ${mapFile}: див. коментар на початку tools/prepare-audio.mjs`); process.exit(1); }
const map = JSON.parse(await readFile(mapFile, 'utf8'));
const manifest = existsSync(`${OUT}/manifest.json`) ? JSON.parse(await readFile(`${OUT}/manifest.json`, 'utf8')) : {};
for (const k of ['sfx', 'loops', 'music', 'gain']) manifest[k] = {};   // rebuilt from the map every time: the map is the truth
manifest.credits = []; manifest.attribution = [];
const counts = {};

for (const it of map.items) {
  const src = path.join(SRC, it.src); if (!existsSync(src)) { console.warn(`нема файлу ${src}`); continue; }
  const dot = it.slot.indexOf('.'), kind = it.slot.slice(0, dot), name = it.slot.slice(dot + 1);   // sfx.hit.light -> kind sfx, name hit.light
  const trim = it.trim ? ['-ss', String(it.trim[0]), ...(it.trim[1] ? ['-to', String(it.trim[1])] : [])] : [];
  const gain = it.gain ? `,volume=${it.gain}dB` : '';
  const key = it.slot; counts[key] = (counts[key] || 0) + 1;
  if (kind === 'sfx') {
    const rel = `sfx/${name.replace(/\./g, '-')}-${counts[key]}.m4a`;
    await makeSfx(src, path.join(OUT, rel), { trim: it.trim, gain: it.gain, max: it.max });
    (manifest.sfx[name] ||= []).push(rel);
    if (it.slotGain != null) manifest.gain[name] = it.slotGain;
  } else if (kind === 'loops') {
    const rel = `loops/${name}.m4a`;
    await makeLoop(src, path.join(OUT, rel), { trim: it.trim, gain: it.gain });   // seamless: the tail is cross-faded into the head
    manifest.loops[name] = { file: rel, ...(it.cfg || {}) };
  } else if (kind === 'music') {
    const base = `music/${name}-${counts[key]}.m4a`;
    await mkdir(path.join(OUT, 'music'), { recursive: true });
    ff([...trim, '-i', src, '-ac', '2', '-ar', '44100', '-af', `loudnorm=I=-16:TP=-1.5:LRA=11${gain}`, '-c:a', 'aac', '-b:a', '128k', path.join(OUT, base)]);
    if (name === 'menu') manifest.music.menu = base; else (manifest.music[name] ||= []).push(base);
  } else { console.warn(`невідомий слот ${it.slot}`); continue; }
  if (it.credit && !manifest.credits.includes(it.credit)) manifest.credits.push(it.credit);
  if (it.attribution && !manifest.attribution.some((a) => a.url === it.attribution.url)) manifest.attribution.push(it.attribution);   // CC BY works: shown in the game's credits line
  console.log(`${it.slot.padEnd(18)} <- ${it.src}`);
}
await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const credits = [`# Звуки й музика Crazy Tuk: подяки та ліцензії`, '', 'Згенеровано `tools/prepare-audio.mjs` з `assets/audio-src/map.json`.', '',
  ...(manifest.music.menu || manifest.music.drive ? ['Музика на етапі тестів створена автором проєкту в Suno. **Вона тестова й перед релізом буде замінена.**', ''] : []),
  ...manifest.credits.map((c) => `- ${c}`), ''];
await writeFile(`${OUT}/CREDITS.md`, credits.join('\n'));
console.log(`manifest.json і CREDITS.md оновлено`);
