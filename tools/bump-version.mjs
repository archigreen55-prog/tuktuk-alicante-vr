// Sets the build version: cache-busting ?v=<version> on every module (index.html import map),
// on main.js, city.json and the stale-page guard, plus version.json. Run before every deploy:
//   node tools/bump-version.mjs          # 0.4.0 -> 0.4.1
//   node tools/bump-version.mjs 0.5.0    # explicit
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const versionFile = join(root, 'version.json');
const htmlFile = join(root, 'index.html');

const old = JSON.parse(readFileSync(versionFile, 'utf8')).version;
const next = process.argv[2] || old.replace(/(\d+)$/, (n) => String(+n + 1));
if (!/^[\w.-]+$/.test(next)) throw new Error(`bad version "${next}"`);

const modules = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) modules.push(relative(root, p).split('\\').join('/'));
  }
})(join(root, 'src'));
modules.sort();

let html = readFileSync(htmlFile, 'utf8');
const checks = [];
html = html.replace(/<script type="importmap">([\s\S]*?)<\/script>/, (m, json) => {
  checks.push('importmap');
  const imports = {};
  for (const [k, v] of Object.entries(JSON.parse(json).imports)) if (!k.startsWith('./src/')) imports[k] = v;
  // relative imports inside modules resolve to these URLs, so the map versions every module
  for (const f of modules) imports['./' + f] = `./${f}?v=${next}`;
  return `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>`;
});
html = html.replace(/const PAGE_VERSION = '[^']*'/, () => { checks.push('guard'); return `const PAGE_VERSION = '${next}'`; });
html = html.replace(/<script type="module" src="src\/main\.js\?v=[^"]*">/, () => { checks.push('main'); return `<script type="module" src="src/main.js?v=${next}">`; });
if (checks.length !== 3) throw new Error('index.html: expected import map, guard and main.js script, found ' + checks.join(', '));

writeFileSync(htmlFile, html);
writeFileSync(versionFile, JSON.stringify({ version: next }) + '\n');
console.log(`version ${old} -> ${next}; ${modules.length} modules in the import map`);
