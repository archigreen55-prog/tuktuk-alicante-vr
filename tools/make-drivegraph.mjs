// The streets of data/city.json that a tuk-tuk cannot drive (a wall or a slope above 33 % under the wheels: steps and steep paths of OSM) ->
// data/drive-graph.json { edges, dropped: [edge index, ...] }. The level editor's checks (src/game/pathfind.js) leave these edges out.
// Run again after tools/build-city.mjs changed the city.
//   node tools/make-drivegraph.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { buildWorld } from './sim-tour.mjs';
import { Terrain } from '../src/city/terrain.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const terrain = Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0));
const { world } = buildWorld();
const SLOPE = 0.33, R = 0.75, N = city.tour.graph.n, E = city.tour.graph.e;
const clear = (x, z) => world.penetration(x, z, R) === 0;
function segmentOk(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let px = a[0], pz = a[1];
  for (let s = 0; s <= L; s += 1) {
    const t = L ? s / L : 0, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    if (!clear(x, z)) return false;
    if (s > 0 && Math.abs(terrain.height(x, z) - terrain.height(px, pz)) > SLOPE * Math.hypot(x - px, z - pz)) return false;
    px = x; pz = z;
  }
  return true;
}
const dropped = [];
for (let k = 0; k < E.length / 3; k++) if (!segmentOk([N[E[k * 3] * 2], N[E[k * 3] * 2 + 1]], [N[E[k * 3 + 1] * 2], N[E[k * 3 + 1] * 2 + 1]])) dropped.push(k);
await writeFile('data/drive-graph.json', JSON.stringify({ edges: E.length / 3, dropped }) + '\n');
console.log(`${dropped.length} of ${E.length / 3} edges are not drivable -> data/drive-graph.json`);
