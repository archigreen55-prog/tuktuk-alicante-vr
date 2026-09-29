// One-time download of the terrain heights for the game area: the 5 m digital terrain model of the
// Spanish IGN (MDT05, PNOA LiDAR) through the INSPIRE WCS service, as an ASCII grid.
// Usage: node tools/fetch-dem.mjs   -> writes data/raw/dem5.asc
// Data: Modelo Digital del Terreno MDT05 © Instituto Geográfico Nacional (CNIG), CC BY 4.0.
import { writeFile, mkdir } from 'node:fs/promises';
import { BBOX } from './area.mjs';

const M = 0.0005; // degrees of margin around the bbox (~50 m): the mesh blends to sea level outside
const url = 'https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&REQUEST=GetCoverage&VERSION=2.0.1' +
  `&COVERAGEID=Elevacion4258_5&FORMAT=ArcGrid&SUBSET=lat(${(BBOX.south - M).toFixed(4)},${(BBOX.north + M).toFixed(4)})` +
  `&SUBSET=long(${(BBOX.west - M).toFixed(4)},${(BBOX.east + M).toFixed(4)})`;
console.log('GET', url);
const res = await fetch(url, { headers: { 'User-Agent': 'tuktuk-alicante-vr (one-time fetch)' } });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = await res.text();
// the WCS answer is a multipart message; keep the ArcGrid part (from "ncols" to the boundary)
const start = body.indexOf('ncols');
if (start < 0) throw new Error('no ArcGrid in the answer: ' + body.slice(0, 300));
let grid = body.slice(start);
const end = grid.search(/\r?\n--/);
if (end > 0) grid = grid.slice(0, end);
grid = grid.replace(/\r\n/g, '\n').trimEnd() + '\n';
await mkdir('data/raw', { recursive: true });
await writeFile('data/raw/dem5.asc', grid);
const head = grid.split('\n').slice(0, 5).join(' | ');
console.log(`Saved data/raw/dem5.asc (${(grid.length / 1024).toFixed(0)} KB): ${head}`);
