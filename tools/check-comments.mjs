// Finds code that ended up inside a // comment (0.18.1 lost `src.connect(...); src.start();` that way: an edit glued them onto the end of a comment line).
// A comment is suspicious when it holds a statement: a call or an assignment closed by `;`, or `const / let / return / if (`.
//   node tools/check-comments.mjs [dir]     -> lists the lines; exit 1 when any is found
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] || 'src';
async function walk(d) { const out = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else if (/\.(m?js)$/.test(e.name)) out.push(p); } return out; }

// the start of a // comment on a line, skipping strings, template literals (which may span lines: `state.tpl`) and regex literals
function commentStart(line, state) {
  let q = state.tpl ? '`' : null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') { state.tpl = false; return i; }
    if (c === '/' && line[i + 1] === '*') { const e = line.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === '/' && /[(,=:[!&|?{};]\s*$|^\s*$|return\s*$/.test(line.slice(0, i))) { q = '/'; continue; }   // a regex literal
  }
  state.tpl = q === '`';
  return -1;
}
// code, not prose: a member call closed by `;` (src.start();), a bare call closed by `;` (foo(x);), a declaration, a `return x;`
const STATEMENT = [
  /\.[A-Za-z_$][\w$]*\([^()]*\)\s*;/,
  /(^|[\s;{])[A-Za-z_$][\w$]*\([^()]*\)\s*;/,
  /(^|[;{]\s*)(const|let|var)\s+[\w$]+\s*=\s*\S/,
  /(^|[;{]\s*)return\s+[\w$.()]+\s*;/,
];
let found = 0;
for (const f of await walk(root)) {
  const lines = (await readFile(f, 'utf8')).split('\n'), state = { tpl: false };
  lines.forEach((line, i) => {
    const k = commentStart(line, state); if (k < 0) return;
    const text = line.slice(k + 2);
    if (STATEMENT.some((re) => re.test(text))) { found++; console.log(`${f}:${i + 1}: ${text.trim().slice(0, 160)}`); }
  });
}
console.log(found ? `\n${found} suspicious comment(s): read each one` : 'no code in comments');
process.exit(found ? 1 : 0);
