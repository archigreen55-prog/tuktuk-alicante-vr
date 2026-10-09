// Handing a level over (0.17.0): a level becomes a short text code (deflate + base64url, "TTL1." in front), the owner pastes it into the chat with the
// developer, who adds it to the game (tools/add-level.mjs). The code can also come back (import), and a plain JSON file is accepted as well.
// Uses CompressionStream (Chrome 80+, Node 18+); without it the code is the plain JSON in base64 ("TTJ1.").
import { validateLevel, LEVEL } from './levels.js';

const toB64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64u = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
// (a broken stream rejects the reader; the writer's promises are silenced so that the error is reported once, to the caller)
async function pipe(bytes, stream) { const w = stream.writable.getWriter(); w.write(bytes).catch(() => {}); w.close().catch(() => {}); return new Uint8Array(await new Response(stream.readable).arrayBuffer()); }

// the level as it is sent: no editor flags
export function cleanLevel(level) { const { mine, ...rest } = level; return JSON.parse(JSON.stringify(rest)); }

export async function encodeLevel(level) {
  const json = JSON.stringify(cleanLevel(level)), bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') { try { return 'TTL1.' + toB64u(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ } }
  return 'TTJ1.' + toB64u(bytes);
}

// text (a code, possibly broken into lines, or the JSON itself) -> { level } or { error }
export async function decodeLevel(text, { places = null } = {}) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Порожньо: встав код рівня або відкрий файл' };
  let json;
  try {
    if (t[0] === '{') json = t;
    else {
      const m = /^(TTL1|TTJ1)\.([A-Za-z0-9_\-\s]+)$/.exec(t);
      if (!m) return { error: 'Це не схоже на код рівня (має починатися з TTL1.)' };
      const bytes = fromB64u(m[2].replace(/\s+/g, ''));
      json = new TextDecoder().decode(m[1] === 'TTL1' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes);
    }
    const level = JSON.parse(json);
    if (!level || typeof level !== 'object' || !Array.isArray(level.items)) return { error: 'У коді немає рівня' };
    if (level.schema !== LEVEL.schema) return { error: `Код від іншої версії формату (${level.schema})` };
    return { level: cleanLevel(level), problems: validateLevel(level, { places }) };
  } catch (e) { return { error: 'Код пошкоджений або обрізаний' + (e && e.message ? ': ' + e.message : '') }; }
}
