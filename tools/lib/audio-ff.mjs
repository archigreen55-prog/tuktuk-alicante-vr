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
export async function makeLoop(src, out, { trim = null, gain = 0 } = {}) {
  await mkdir(path.dirname(out), { recursive: true });
  const tmp = out.replace(/\.m4a$/, '') + '._tmp.wav';
  ff([...trimArgs(trim), '-i', src, '-ac', '1', '-ar', '44100', '-af', `loudnorm=I=-20:TP=-1.5:LRA=9${gain ? `,volume=${gain}dB` : ''}`, tmp]);
  const L = probe(tmp), a = (L - LOOP_FADE).toFixed(3);
  ff(['-i', tmp, '-i', tmp, '-filter_complex', `[0:a]atrim=${a}:${L.toFixed(3)},asetpts=PTS-STARTPTS[t];[1:a]atrim=0:${a},asetpts=PTS-STARTPTS[a];[t][a]acrossfade=d=${LOOP_FADE}:c1=tri:c2=tri`, '-c:a', 'aac', '-b:a', '64k', out]);
  await unlink(tmp);
}
