// Prepares the sound files of Crazy Tuk: assets/audio-src/<file> -> assets/audio/<slot files>.m4a (AAC), loudness-matched, trimmed,
// loops made seamless, and assets/audio/manifest.json + CREDITS.md updated. Needs ffmpeg.   node tools/prepare-audio.mjs [map.json]
// assets/audio-src/map.json (default):
//   { "items": [
//     { "src": "tuktuk.flac", "slot": "loops.engine", "trim": [12.0, 20.5], "cfg": { "kmh": [0, 150], "rate": [0.7, 1.9], "gain": [0.35, 0.7] },
//       "credit": "Thailand tuk tuk…: kyles, CC0, https://freesound.org/…" },
//     { "src": "horn.wav", "slot": "sfx.horn", "gain": -3, "credit": "…" },          // sfx.<name>: one variant; the same slot again = one more variant
//     { "src": "drive.mp3", "slot": "music.drive" }, { "src": "menu.mp3", "slot": "music.menu", "credit": "Suno (test)" } ] }
// slots: sfx.<name> (see assets/audio/README.md), loops.<name> (engine | wind | squeal | nitro), music.menu, music.drive.
// "trim": [from, to] seconds; "gain": dB after the loudness matching; "cfg": the loop's settings written into the manifest.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SRC = 'assets/audio-src', OUT = 'assets/audio';
const mapFile = process.argv[2] || `${SRC}/map.json`;
if (!existsSync(mapFile)) { console.error(`нема ${mapFile}: див. коментар на початку tools/prepare-audio.mjs`); process.exit(1); }
const map = JSON.parse(await readFile(mapFile, 'utf8'));
const manifest = existsSync(`${OUT}/manifest.json`) ? JSON.parse(await readFile(`${OUT}/manifest.json`, 'utf8')) : {};
for (const k of ['sfx', 'loops', 'music']) manifest[k] = {};   // rebuilt from the map every time: the map is the truth
manifest.credits = [];
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || 'ffmpeg failed'); };
const probe = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout) || 0;
const counts = {};
const LOOP_FADE = 0.4;

for (const it of map.items) {
  const src = path.join(SRC, it.src); if (!existsSync(src)) { console.warn(`нема файлу ${src}`); continue; }
  const [kind, name] = it.slot.split('.');
  const trim = it.trim ? ['-ss', String(it.trim[0]), ...(it.trim[1] ? ['-to', String(it.trim[1])] : [])] : [];
  const gain = it.gain ? `,volume=${it.gain}dB` : '';
  const key = it.slot; counts[key] = (counts[key] || 0) + 1;
  if (kind === 'sfx') {
    const rel = `sfx/${name.replace(/\./g, '-')}-${counts[key]}.m4a`;
    await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
    ff([...trim, '-i', src, '-ac', '1', '-ar', '44100', '-af', `silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=-18:TP=-1.5:LRA=9${gain}`, '-c:a', 'aac', '-b:a', '64k', path.join(OUT, rel)]);
    (manifest.sfx[name] ||= []).push(rel);
  } else if (kind === 'loops') {
    const rel = `loops/${name}.m4a`; await mkdir(path.join(OUT, 'loops'), { recursive: true });
    // seamless: the tail (LOOP_FADE s) is cross-faded into the head, so the file's end flows into its start
    const tmp = path.join(OUT, 'loops', `_${name}.wav`);
    ff([...trim, '-i', src, '-ac', '1', '-ar', '44100', '-af', `loudnorm=I=-20:TP=-1.5:LRA=9${gain}`, tmp]);
    const L = probe(tmp);
    ff(['-i', tmp, '-i', tmp, '-filter_complex', `[0:a]atrim=${(L - LOOP_FADE).toFixed(3)}:${L.toFixed(3)},asetpts=PTS-STARTPTS[t];[1:a]atrim=0:${(L - LOOP_FADE).toFixed(3)},asetpts=PTS-STARTPTS[a];[t][a]acrossfade=d=${LOOP_FADE}:c1=tri:c2=tri`, '-c:a', 'aac', '-b:a', '64k', path.join(OUT, rel)]);
    await unlink(tmp);
    manifest.loops[name] = { file: rel, ...(it.cfg || {}) };
  } else if (kind === 'music') {
    const base = `music/${name}-${counts[key]}.m4a`;
    await mkdir(path.join(OUT, 'music'), { recursive: true });
    ff([...trim, '-i', src, '-ac', '2', '-ar', '44100', '-af', `loudnorm=I=-16:TP=-1.5:LRA=11${gain}`, '-c:a', 'aac', '-b:a', '128k', path.join(OUT, base)]);
    if (name === 'menu') manifest.music.menu = base; else (manifest.music[name] ||= []).push(base);
  } else { console.warn(`невідомий слот ${it.slot}`); continue; }
  if (it.credit) manifest.credits.push(it.credit);
  console.log(`${it.slot.padEnd(18)} <- ${it.src}`);
}
await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const credits = [`# Звуки й музика Crazy Tuk: подяки та ліцензії`, '', 'Згенеровано `tools/prepare-audio.mjs` з `assets/audio-src/map.json`.', '',
  ...(manifest.music.menu || manifest.music.drive ? ['Музика на етапі тестів створена автором проєкту в Suno. **Вона тестова й перед релізом буде замінена.**', ''] : []),
  ...manifest.credits.map((c) => `- ${c}`), ''];
await writeFile(`${OUT}/CREDITS.md`, credits.join('\n'));
console.log(`manifest.json і CREDITS.md оновлено`);
