// 3D models (scans) of landmarks, step L1 of docs/plan-realistic-landmarks.md (report: docs/report-l1.md).
// A GLB prepared by tools/prepare-model.mjs (one mesh, +Y up, +Z out of the wall, metres, origin at the bottom
// centre on the wall plane, KTX2 textures, meshopt geometry) is set on a wall of its OSM building. The wall
// behind it gets a niche, so doors and windows deeper than the wall stay visible; the niche is a little
// smaller than the model, whose ragged scan edges then lie on the wall. +1 draw call per model.
// data/facades.json, per building (OSM id): "models": [ entry, ... ]
//   "id", "src"               prepared GLB
//   "edge": 10, "at": 0.5     on wall 10 of the building (tools/prepare-facade.mjs --list), centred at this
//                             fraction of the wall's length
//   "offset": 0.02            metres out from the wall line (no z-fighting with the wall behind)
//   "niche": 0.4              how much smaller than the model the niche is, m (0 = no niche, the wall stays)
// Tool-only (tools/prepare-model.mjs): "from", "rotate", "width", "wallZ", "triangles", "texture", "ktx",
// "error", "credit" ({ author, license, url, site }).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ringOf, edgeOf } from './photoFacades.js';

// Basis Universal transcoder of the same three.js release as the import map
const BASIS_PATH = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}/examples/jsm/libs/basis/`;

// Loads and places the models of the buildings present in city.json. Returns null when there are none.
// { group, cuts: Map(osmId -> [{ edge, t0, t1, top, depth }]), footprints: [[x, z, ...]], credits, stats }
export async function loadModels(city, spec, { renderer, version = '' } = {}) {
  const byId = new Map(city.buildings.map((b) => [b.id, b]));
  const jobs = [];
  for (const [osmId, s] of Object.entries(spec || {})) {
    if (!byId.has(osmId) || !Array.isArray(s.models)) continue;
    for (const entry of s.models) if (entry.src && entry.edge != null) jobs.push({ osmId, entry });
  }
  if (!jobs.length) return null;
  const t0 = performance.now();
  const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const q = version ? `?v=${version}` : '';
  const group = new THREE.Group();
  group.name = 'landmark models';
  const cuts = new Map(), credits = new Map(), footprints = [];
  let tris = 0, meshes = 0;
  await Promise.all(jobs.map(async ({ osmId, entry }) => {
    let gltf;
    try { gltf = await loader.loadAsync(entry.src + q); } catch (e) { console.warn(`model ${entry.id}: ${e.message}`); return; }
    const obj = gltf.scene;
    obj.name = entry.id;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = lambertOf(o.material);
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      meshes++;
    });
    const box = new THREE.Box3().setFromObject(obj);
    const ring = ringOf(byId.get(osmId).p);
    const e = edgeOf(ring, entry.edge);
    const t = (entry.at ?? 0.5) * e.len, off = entry.offset ?? 0.02;
    obj.position.set(e.a[0] + e.dir[0] * t + e.n[0] * off, 0, e.a[1] + e.dir[1] * t + e.n[1] * off);
    obj.rotation.y = Math.atan2(e.n[0], e.n[1]);  // model +Z -> the wall's outward normal
    obj.updateMatrixWorld(true);
    group.add(obj);
    // the niche behind the model on every wall in its plane that it covers: a scan is often wider than one
    // OSM edge, and OSM may draw parts of the facade (towers) as buildings of their own. Wall coordinates:
    // t along the wall, height, depth
    const inset = entry.niche ?? 0.4;
    if (inset > 0 && box.min.z < -0.05) {
      const toLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      const x0 = box.min.x + inset, x1 = box.max.x - inset, reach = box.max.x - box.min.x + 5;
      for (const nb of city.buildings) {
        const nring = ringOf(nb.p);
        if (!nring.some(([x, z]) => Math.hypot(x - obj.position.x, z - obj.position.z) < reach)) continue;
        for (let i = 0; i < nring.length; i++) {
          const w = edgeOf(nring, i);
          const pa = new THREE.Vector3(w.a[0], 0, w.a[1]).applyMatrix4(toLocal), pb = new THREE.Vector3(w.b[0], 0, w.b[1]).applyMatrix4(toLocal);
          if (Math.max(Math.abs(pa.z), Math.abs(pb.z)) > 1 || Math.abs(pb.x - pa.x) < 0.98 * w.len) continue; // not this wall plane
          const lo = Math.max(x0, Math.min(pa.x, pb.x)), hi = Math.min(x1, Math.max(pa.x, pb.x));
          if (hi - lo < 0.3) continue;
          const tt = (x) => ((x - pa.x) / (pb.x - pa.x)) * w.len;
          const [t0, t1] = [tt(lo), tt(hi)].sort((p, q) => p - q);
          const cut = { edge: i, t0, t1, top: Math.min(nb.h, box.max.y - inset), depth: -box.min.z + 0.1 + Math.max(pa.z, pb.z, 0) };
          if (cut.top > 0.5) (cuts.get(nb.id) || cuts.set(nb.id, []).get(nb.id)).push(cut);
        }
      }
    }
    // what stands out of the wall below 2.5 m (plinths, steps) collides like the building
    const low = lowFootprint(obj);
    if (low) footprints.push(low.map(([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(obj.matrixWorld); return [v.x, v.z]; }).flat());
    const c = entry.credit;
    if (c && c.author) {
      const list = credits.get(osmId) || [];
      list.push(`3D-скан: ${c.author} (${c.license || '?'})${c.site ? ` · ${c.site}` : ''}`);
      credits.set(osmId, list);
    }
  }));
  ktx2.dispose();
  if (!group.children.length) return null;
  group.updateMatrixWorld(true);
  return { group, cuts, footprints, credits, stats: { models: group.children.length, meshes, tris: Math.round(tris), ms: Math.round(performance.now() - t0) } };
}

// Rectangle (model coordinates) around the vertices lower than 2.5 m that stand more than 0.3 m out of the wall
function lowFootprint(obj) {
  let x0 = Infinity, x1 = -Infinity, z1 = 0;
  const v = new THREE.Vector3(), toObj = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    toObj.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toObj);
      if (v.y > 2.5 || v.z < 0.3) continue;
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z1 = Math.max(z1, v.z);
    }
  });
  return x1 > x0 ? [[x0, 0], [x1, 0], [x1, z1], [x0, z1]] : null;
}

// "3D-скан: A (CC BY 4.0) · Sketchfab" for the tour card of a place
export function modelCreditLine(models, osmIds) {
  if (!models) return '';
  const all = [];
  for (const id of osmIds || []) for (const c of models.credits.get(id) || []) if (!all.includes(c)) all.push(c);
  return all.join(' · ');
}

// The city is lit with Lambert materials (cheap on Quest, same look): keep the scan's colour and normal maps
// and its double-sidedness (scans often have faces wound both ways).
function lambertOf(m) {
  const lam = new THREE.MeshLambertMaterial({ map: m.map || null, normalMap: m.normalMap || null, color: m.color ? m.color.clone() : 0xffffff, side: m.side });
  if (m.normalScale && lam.normalMap) lam.normalScale.copy(m.normalScale);
  lam.name = m.name;
  m.dispose();
  return lam;
}
