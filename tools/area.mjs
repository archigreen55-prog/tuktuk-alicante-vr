// The game area (one place for tools/fetch-osm.mjs, tools/fetch-dem.mjs and tools/build-city.mjs).
// BBOX: what is downloaded and built. ORIGIN: the centre of local coordinates (x = east, z = south, metres).
// The origin stays at the centre of the first (0.1.0–0.9.0) bbox even though the area grew (plan-terrain.md
// 3.1): every hand-tuned local coordinate in the code and the data keeps its meaning.
export const BBOX = { south: 38.3400, west: -0.4950, north: 38.3550, east: -0.4735 };
export const ORIGIN = { lat: 38.34575, lon: -0.486 };

const phi = ORIGIN.lat * Math.PI / 180;
export const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
export const proj = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
export const unproj = (x, z) => [ORIGIN.lat - z / M_LAT, ORIGIN.lon + x / M_LON];
// local rectangle of the bbox
export function rectOf(b = BBOX) {
  const [minX, maxZ] = proj(b.south, b.west);
  const [maxX, minZ] = proj(b.north, b.east);
  return { minX, maxX, minZ, maxZ };
}
