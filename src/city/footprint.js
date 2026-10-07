// Footprint mask: where the flat layers (roads with sidewalks, plazas, parks) lie, as a 2048 x 2048 one-channel
// texture over the height grid. The ground shader discards its fragments inside the mask, so the ground can
// never be drawn over a road: before this the ground mesh (RTIN, error up to 0.55 m, 1.4 m far away) and the
// road ribbons (the height grid + 6 cm) were two different surfaces that crossed each other, and on a phone
// GPU their depth values fought (docs/report-phone-f1.md, section 4).
// The mask is drawn slightly SMALLER than the layers (`erode`), so no hole can appear at their edge.
import * as THREE from 'three';

const SIDEWALK = { primary: 3.5, primary_link: 2, secondary: 3, secondary_link: 2, tertiary: 2.5, tertiary_link: 2, residential: 2, unclassified: 2, busway: 2.5 };

// city: city.json; terrain: Terrain. Returns { texture, rect: Vector4(x0, z0, 1/width, 1/depth), stats }
export function buildFootprintMask(city, terrain, { size = 2048, erode = 0.9 } = {}) {
  const t0 = performance.now();
  const x0 = terrain.x0, z0 = terrain.z0, w = terrain.x1 - x0, d = terrain.z1 - z0;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.setTransform(size / w, 0, 0, size / d, -x0 * size / w, -z0 * size / d);   // world metres -> pixels
  g.lineJoin = 'round'; g.lineCap = 'round';
  const path = (flat, close) => { g.beginPath(); g.moveTo(flat[0], flat[1]); for (let k = 2; k < flat.length; k += 2) g.lineTo(flat[k], flat[k + 1]); if (close) g.closePath(); };
  // plazas and parks: filled, then the rim is taken back by `erode`
  let polys = 0;
  const polygon = (flat) => {
    if (!flat || flat.length < 6) return;
    path(flat, true);
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = '#000'; g.lineWidth = erode * 2; g.stroke();
    polys++;
  };
  for (const pl of city.plazas) polygon(Array.isArray(pl) ? pl : pl.p);
  for (const pk of city.parks) polygon(pk);
  // roads: a stroke as wide as the sidewalk ribbon, minus the same margin on both sides
  g.strokeStyle = '#fff';
  let roads = 0;
  for (const r of city.roads) {
    const width = r.w + 2 * (SIDEWALK[r.k] || 0) - 2 * erode;
    if (width < 0.4 || r.p.length < 4) continue;
    g.lineWidth = width;
    path(r.p, false);
    g.stroke();
    roads++;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = g.getImageData(0, 0, size, size).data;
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { texture, rect: new THREE.Vector4(x0, z0, 1 / w, 1 / d), stats: { footRoads: roads, footPolys: polys, footMs: Math.round(performance.now() - t0) } };
}

// Makes a MeshLambertMaterial throw away its fragments inside the mask. Position attributes of the ground
// are world coordinates (the meshes carry an identity matrix).
export function discardInFootprint(material, mask) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    sh.uniforms.uFoot = { value: mask.texture };
    sh.uniforms.uFootRect = { value: mask.rect };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFoot;\nuniform vec4 uFootRect;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoot = (position.xz - uFootRect.xy) * uFootRect.zw;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFoot;\nuniform sampler2D uFoot;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (texture2D(uFoot, vFoot).r > 0.5) discard;');
  };
  material.customProgramCacheKey = () => 'ground-footprint';
  return material;
}
