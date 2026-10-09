// ffmpeg helpers shared by tools/prepare-audio.mjs and tools/build-sounds.mjs: an effect (mono, loudness-matched, silence trimmed) and a seamless loop
// (the tail is cross-faded into the head), both AAC in .m4a.
import { spawnSync } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export const LOOP_FADE = 0.4;
export const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || 'ffmpeg failed'); };
export const probe = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout) || 0;
const trimArgs = (trim) => (trim ? ['-ss', String(trim[0]), ...(trim[1] ? ['-to', String(trim[1])] : [])] : []);

// opts: { trim: [from, to], gain: dB after the matching, max: longest result in s }
export async function makeSfx(src, out, { trim = null, gain = 0, max = 0 } = {}) {
  await mkdir(path.dirname(out), { recursive: true });
  ff([...trimArgs(trim), '-i', src, ...(max ? ['-t', String(max)] : []), '-ac', '1', '-ar', '44100', '-af', `silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=-18:TP=-1.5:LRA=9${gain ? `,volume=${gain}dB` : ''}${max ? `,afade=t=out:st=${Math.max(0, max - 0.15)}:d=0.15` : ''}`, '-c:a', 'aac', '-b:a', '64k', out]);
}
export async function makeLoop(src, out, { trim = null, gain = 0, minLen = 2.8 } = {}) {
  await mkdir(path.dirname(out), { recursive: true });
  const tmp = out.replace(/\.m4a$/, '') + '._tmp.wav', tiled = out.replace(/\.m4a$/, '') + '._tile.wav';
  ff([...trimArgs(trim), '-i', src, '-ac', '1', '-ar', '44100', '-af', `loudnorm=I=-20:TP=-1.5:LRA=9${gain ? `,volume=${gain}dB` : ''}`, tmp]);
  let body = tmp, L = probe(tmp), tiles = 1;
  // a short recording is repeated until it is long enough to loop without an obvious beat
  if (L < minLen) { tiles = Math.ceil(minLen / L); ff(['-stream_loop', String(tiles - 1), '-i', tmp, '-c', 'copy', tiled]); body = tiled; L = probe(tiled); }
  const a = (L - LOOP_FADE).toFixed(3), tailFrom = (L - LOOP_FADE - 0.03).toFixed(3);   // the tail is a little longer than the cross-fade
  ff(['-i', body, '-i', body, '-filter_complex', `[0:a]atrim=${tailFrom}:${L.toFixed(3)},asetpts=PTS-STARTPTS[t];[1:a]atrim=0:${a},asetpts=PTS-STARTPTS[a];[t][a]acrossfade=d=${LOOP_FADE}:c1=tri:c2=tri`, '-c:a', 'aac', '-b:a', '64k', out]);
  await unlink(tmp); if (tiles > 1) await unlink(tiled);
  if (probe(out) < 1) throw new Error(`цикл ${out} не вийшов (порожній файл)`);
  return { tiles, length: probe(out) };
}
