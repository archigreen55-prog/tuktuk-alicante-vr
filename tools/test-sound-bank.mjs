// SoundBank.play() really sounds: on a recording fake of Web Audio, a played slot must give a buffer source that is STARTED and connected
// source -> gain -> master -> destination, with the slot's level. (0.18.1 shipped with `connect` and `start` inside a comment: every effect was silent,
// and the browser test only checked that play() returned a source.)   node tools/test-sound-bank.mjs [path/to/soundBank.js]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const file = path.resolve(process.argv[2] || 'src/audio/soundBank.js');
const { SoundBank } = await import(pathToFileURL(file).href);
let bad = 0; const check = (c, m, x = '') => { if (!c) bad++; console.log(c ? 'ok  ' : 'FAIL', m, x); };

// a fake AudioContext that records the graph
class Node { constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.out = []; } connect(n) { this.out.push(n); return n; } }
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } }
const ctx = {
  state: 'running', currentTime: 0, destination: null, started: [],
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; },
  createBufferSource() { const n = new Node(this, 'source'); n.playbackRate = new Param(1); n.start = () => { n.started = true; this.started.push(n); }; n.stop = () => {}; return n; },
  decodeAudioData: async () => ({ duration: 1 }),
};
ctx.destination = new Node(ctx, 'destination');
const reaches = (from, to, seen = new Set()) => from === to || (!seen.has(from) && (seen.add(from), from.out.some((n) => reaches(n, to, seen))));

const bank = new SoundBank({ ctx });
bank.manifest = { sfx: { horn: ['sfx/horn-1.m4a', 'sfx/horn-2.m4a'], 'gate.ok': ['sfx/gate-ok-1.m4a'] }, loops: {}, music: {}, gain: { horn: 1, 'gate.ok': 0.45 }, credits: [] };
const ready = (n) => (typeof bank.ready === 'function' ? bank.ready(n) : undefined);
check(ready('horn') === false, 'before decoding: not ready');
// decoding (prepare) with fetch faked: horn-2 fails to decode
globalThis.fetch = async (url) => ({ ok: !url.includes('horn-2'), status: url.includes('horn-2') ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(8) });
const warn = console.warn; console.warn = () => {}; await bank.prepare(); console.warn = warn;
check(bank.master && reaches(bank.master, ctx.destination), 'the master goes to the speakers');
check(ready('horn') === true && ready('gate.ok') === true, 'decoded: ready');
const srcs = []; for (let i = 0; i < 20; i++) srcs.push(bank.play('horn'));
const src = srcs.find(Boolean);
check(srcs.every(Boolean), 'every press gives a source (the undecodable variant is skipped)', `${srcs.filter(Boolean).length} of 20`);
check(!!src && src.started === true, 'the source is STARTED');
check(!!src && reaches(src, bank.master) && reaches(src, ctx.destination), 'the source is connected through its gain to the master and the speakers');
check(!!src && src.buffer && src.buffer.duration === 1, 'it plays a decoded buffer');
check(ctx.started.length === 20, 'every press started a sound (the undecodable variant is skipped)', `${ctx.started.length} of 20`);
const gs = bank.play('gate.ok', { gain: 0.8 }), g = gs && gs.out[0];
check(!!g && Math.abs(g.gain.value - 0.8 * 0.45) < 1e-9, 'the slot level multiplies the gain', g ? g.gain.value.toFixed(3) : 'not connected');
bank.setMuted(true); check(bank.play('horn') === null, 'muted: nothing plays'); bank.setMuted(false);
ctx.state = 'suspended'; check(bank.play('horn') === null && ready('horn') === false, 'context suspended: nothing, not ready'); ctx.state = 'running';
check(bank.play('nope') === null && ready('nope') === false, 'an unknown slot: nothing');
console.log(bad ? `${bad} FAILED` : 'ALL OK'); process.exit(bad ? 1 : 0);
