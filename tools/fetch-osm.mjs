// One-time download of OpenStreetMap data for central Alicante via Overpass API.
// Usage: node tools/fetch-osm.mjs   -> writes data/raw/alicante.osm.json
// Data © OpenStreetMap contributors, ODbL.
import { writeFile, mkdir } from 'node:fs/promises';

export const BBOX = { south: 38.3400, west: -0.4950, north: 38.3515, east: -0.4770 };
const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

const query = `
[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["natural"="coastline"](${b});
  way["natural"~"water|peak|cliff|scrub"](${b});
  node["natural"="peak"](${b});
  way["landuse"](${b});
  way["leisure"~"park|garden|marina"](${b});
  way["historic"](${b});
  relation["historic"](${b});
  way["man_made"~"pier|breakwater|quay"](${b});
  node["natural"="tree"](${b});
  way["natural"="tree_row"](${b});
  way["place"="square"](${b});
  node["name"~"Mercado Central|Explanada|Luceros|Méndez Núñez|Santa Bárbara",i](${b});
  way["name"~"Mercado Central|Explanada|Luceros|Méndez Núñez|Santa Bárbara",i](${b});
  relation["name"~"Mercado Central|Explanada|Luceros|Méndez Núñez|Santa Bárbara",i](${b});
);
out geom;
`;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

for (const url of MIRRORS) {
  try {
    console.log('Querying', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'tuktuk-alicante-vr/0.1 (one-time fetch)' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    await mkdir('data/raw', { recursive: true });
    await writeFile('data/raw/alicante.osm.json', JSON.stringify(json));
    console.log(`Saved ${json.elements.length} elements, timestamp ${json.osm3s?.timestamp_osm_base}`);
    process.exit(0);
  } catch (e) {
    console.warn('Failed:', e.message);
  }
}
console.error('All mirrors failed');
process.exit(1);
