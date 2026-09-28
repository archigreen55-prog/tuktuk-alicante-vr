// Prepares 3D models (scans) of landmarks for the game from data/facades.json ("models" of a building,
// format at the top of src/city/models.js). For every entry: reads the source glTF/GLB ("from", e.g. a
// Sketchfab download or your own RealityScan / KIRI export), bakes the scene into one mesh, turns it so
// +Y is up and +Z looks out of the wall ("rotate"), scales it to its real width ("width", m), puts the
// origin at the bottom centre on the wall plane, simplifies it to "triangles", and writes "src" with
// textures <= "texture" px in KTX2 (Basis Universal, GPU-compressed) and meshopt-compressed geometry.
//
//   npm install                                  # once: gltf-transform, meshoptimizer, sharp
//   node tools/prepare-model.mjs                  # all models
//   node tools/prepare-model.mjs santa-maria-portal
//   node tools/prepare-model.mjs --inspect santa-maria-portal   # sizes and axes of the source, no output
//
// KTX2 needs the `ktx` tool of KTX-Software 4.4: if it is not installed (`sudo apt install ./KTX-Software-
// 4.4.2-Linux-x86_64.deb`), it is downloaded once from the official GitHub release into tools/.bin/.
import { readFile, writeFile, mkdir, stat, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let gt, gtx, gtf, mo, sharp;
try {
  gt = await import('@gltf-transform/core');
  gtx = await import('@gltf-transform/extensions');
  gtf = await import('@gltf-transform/functions');
  mo = await import('meshoptimizer');
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Потрібні бібліотеки: один раз запусти `npm install` у папці гри.');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const KTX_VERSION = '4.4.2';
const KTX_DIR = join(root, 'tools/.bin', `KTX-Software-${KTX_VERSION}-Linux-x86_64`);

async function main() {
  const facades = JSON.parse(await readFile(process.env.FACADES || join(root, 'data/facades.json'), 'utf8')); // FACADES=… for a test file
  const only = new Set(args.filter((a) => !a.startsWith('--')));
  let done = 0;
  for (const [osmId, spec] of Object.entries(facades)) {
    if (osmId.startsWith('_') || !Array.isArray(spec.models)) continue;
    for (const entry of spec.models) {
      if (only.size && !only.has(entry.id)) continue;
      if (!entry.from || !entry.src) { console.warn(`${entry.id}: немає "from" або "src", пропускаю`); continue; }
      await prepare(entry);
      done++;
    }
  }
  if (!done) console.log(only.size ? `Не знайдено моделей з id: ${[...only].join(', ')}` : 'У data/facades.json немає моделей ("models").');
}

async function prepare(entry) {
  await mo.MeshoptDecoder.ready; await mo.MeshoptEncoder.ready; await mo.MeshoptSimplifier.ready;
  const io = new gt.NodeIO().registerExtensions(gtx.ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder,
  });
  const srcFile = join(root, entry.from);
  const doc = await io.read(srcFile);
  const before = count(doc);

  // one mesh in world space: flatten the scene graph, bake node transforms, join primitives by material
  await doc.transform(gtf.dedup(), gtf.flatten());
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) gtf.clearNodeTransform(node);
  await doc.transform(gtf.join({ keepNamed: false }));

  // orientation fix: +Y up, +Z out of the wall
  const [rx, ry, rz] = (entry.rotate || [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  bake(doc, rotationXYZ(rx, ry, rz));
  let b = gtf.getBounds(doc.getRoot().listScenes()[0]);
  const size = b.max.map((v, i) => v - b.min[i]);
  if (args.includes('--inspect')) {
    console.log(`${entry.id}: ${before.tris} трикутників, ${before.textures} текстур; після "rotate" розмір x ${size[0].toFixed(3)}, y ${size[1].toFixed(3)}, z ${size[2].toFixed(3)} (одиниці джерела)`);
    return;
  }
  // the wall plane (the most common depth of front faces) goes to z = 0; the scanned ground in front of
  // the wall is cut away (the game has its own), the ground at the wall (a door sill) goes to y = 0
  const wallZ = entry.wallZ ?? wallPlane(doc);
  bake(doc, scaleTranslate(1, [0, 0, -wallZ]));
  let groundY = b.min[1];
  if (entry.ground !== 'keep') {
    groundY = entry.groundY ?? groundAtWall(doc, b.min[1], size[1]);
    const removed = cutGround(doc, groundY);
    const bits = dropIslands(doc, entry.minIsland ?? 300);
    if (removed) console.log(`  прибрано землю перед стіною: ${removed} трикутників і ${bits} в уламках; поріг на ${(groundY - b.min[1]).toFixed(2)} над найнижчою точкою`);
  }
  // real size: "width" (m) of the whole model, or "scale" (default 1: the source is in metres);
  // origin at the bottom centre, on the wall plane
  b = gtf.getBounds(doc.getRoot().listScenes()[0]);
  const s = entry.width ? entry.width / (b.max[0] - b.min[0]) : entry.scale ?? 1;
  bake(doc, scaleTranslate(s, [-(b.min[0] + b.max[0]) / 2 * s, -groundY * s, 0]));

  await doc.transform(
    gtf.weld(),
    gtf.normals({ overwrite: false }),
  );
  const tris = count(doc).tris;
  const target = entry.triangles || 80000;
  if (tris > target) {
    await doc.transform(gtf.simplify({ simplifier: mo.MeshoptSimplifier, ratio: target / tris, error: entry.error ?? 0.001, lockBorder: true }));
  }
  await doc.transform(gtf.prune(), gtf.dedup());
  const texInfo = await ktx2Textures(doc, entry.texture || 2048, entry.ktx || 'etc1s');
  await doc.transform(gtf.meshopt({ encoder: mo.MeshoptEncoder, level: 'high' }));
  b = gtf.getBounds(doc.getRoot().listScenes()[0]);

  const out = join(root, entry.src);
  await mkdir(dirname(out), { recursive: true });
  await io.write(out, doc);
  const after = count(doc);
  console.log(`${entry.id}: ${before.tris} → ${after.tris} трикутників, ${after.prims} draw call(s) → ${entry.src} ${Math.round((await stat(out)).size / 1024)} КБ`);
  console.log(`  розмір ${(b.max[0] - b.min[0]).toFixed(2)} × ${(b.max[1] - b.min[1]).toFixed(2)} м, глибина від ${b.min[2].toFixed(2)} до ${b.max[2].toFixed(2)} м від площини стіни`);
  console.log(`  текстури: ${texInfo.join(', ') || 'немає'}`);
}

// ---------- geometry ----------
function bake(doc, m) { for (const mesh of doc.getRoot().listMeshes()) gtf.transformMesh(mesh, m); }
function rotationXYZ(x, y, z) { // column-major 4x4, R = Rz * Ry * Rx
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    cy * cz, cy * sz, -sy, 0,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ];
}
function scaleTranslate(s, t) { return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t[0], t[1], t[2], 1]; }
// The wall plane of a facade scan: the depth where most of the outward-facing surface area lies.
function wallPlane(doc) {
  const bins = new Map(), BIN = 0.05;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < n; i += 3) {
      pos.getElement(idx ? idx.getScalar(i) : i, a); pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b); pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const area = Math.hypot(nx, ny, nz) / 2;
      if (!area || Math.abs(nz) / (2 * area) < 0.8) continue;   // faces the camera (either way: scans may be inside out)
      const k = Math.round((a[2] + b[2] + c[2]) / 3 / BIN);
      bins.set(k, (bins.get(k) || 0) + area);
    }
  }
  let best = 0, bestA = -1;
  for (const [k, area] of bins) if (area > bestA) { bestA = area; best = k; }
  return best * BIN;
}
// Height of the ground at the foot of the wall: horizontal faces within 1.5 m in front of the wall plane
// (z = 0 by now), the median of their heights.
function groundAtWall(doc, minY, height) {
  const ys = [];
  eachTriangle(doc, (a, b, c, n) => {
    const z = (a[2] + b[2] + c[2]) / 3, y = (a[1] + b[1] + c[1]) / 3;
    if (n[1] > 0.8 && z > -0.2 && z < 1.5 && y < minY + height * 0.25) ys.push(y);
  });
  ys.sort((p, q) => p - q);
  return ys.length ? ys[Math.floor(ys.length / 2)] : minY;
}
// Cut the scanned ground: faces looking up below the sill + 0.3 m, and everything low and far in front.
function cutGround(doc, groundY) {
  let removed = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    if (!idx) continue;
    const keep = [];
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < idx.getCount(); i += 3) {
      const ia = idx.getScalar(i), ib = idx.getScalar(i + 1), ic = idx.getScalar(i + 2);
      pos.getElement(ia, a); pos.getElement(ib, b); pos.getElement(ic, c);
      const n = normalOf(a, b, c), y = (a[1] + b[1] + c[1]) / 3 - groundY, z = (a[2] + b[2] + c[2]) / 3;
      const floor = (Math.abs(n[1]) > 0.7 && y < 0.3) || (Math.abs(n[1]) > 0.3 && y < 0.25 && z > 0.3); // flat or sloping ground
      const farFront = z > 2.2 && y < 1.5;
      if (floor || farFront || y < -0.3) { removed++; continue; }
      keep.push(ia, ib, ic);
    }
    const Arr = idx.getArray().constructor;
    idx.setArray(new Arr(keep));
  }
  return removed;
}
// Drop small disconnected pieces (bits of the scanned ground left after the cut): triangles are connected
// through shared positions (1 mm), pieces with fewer than `min` triangles go.
function dropIslands(doc, min) {
  let dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    if (!idx) continue;
    const key = new Map(), v = [0, 0, 0];
    const id = (i) => { pos.getElement(i, v); const k = v.map((x) => Math.round(x * 1000)).join(','); if (!key.has(k)) key.set(k, key.size); return key.get(k); };
    const n = idx.getCount() / 3, tv = new Int32Array(n * 3);
    for (let i = 0; i < n * 3; i++) tv[i] = id(idx.getScalar(i));
    const parent = new Int32Array(key.size).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < n; t++) { const r = find(tv[t * 3]); parent[find(tv[t * 3 + 1])] = r; parent[find(tv[t * 3 + 2])] = find(tv[t * 3]); }
    const size = new Map();
    for (let t = 0; t < n; t++) { const r = find(tv[t * 3]); size.set(r, (size.get(r) || 0) + 1); }
    const keep = [];
    for (let t = 0; t < n; t++) {
      if (size.get(find(tv[t * 3])) < min) { dropped++; continue; }
      keep.push(idx.getScalar(t * 3), idx.getScalar(t * 3 + 1), idx.getScalar(t * 3 + 2));
    }
    idx.setArray(new (idx.getArray().constructor)(keep));
  }
  return dropped;
}
function normalOf(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
function eachTriangle(doc, fn) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < n; i += 3) {
      pos.getElement(idx ? idx.getScalar(i) : i, a); pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b); pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
      fn(a, b, c, normalOf(a, b, c));
    }
  }
}
function count(doc) {
  let tris = 0, prims = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    prims++;
    tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return { tris: Math.round(tris), prims, textures: doc.getRoot().listTextures().length };
}

// ---------- textures: resize, then KTX2 / Basis Universal with mip levels ----------
async function ktx2Textures(doc, maxSize, mode) {
  const ktx = await ktxTool();
  const tmp = await mkdtemp(join(tmpdir(), 'ktx-'));
  const info = [];
  const normalTex = new Set(doc.getRoot().listMaterials().map((m) => m.getNormalTexture()).filter(Boolean));
  for (const [i, tex] of doc.getRoot().listTextures().entries()) {
    const img = sharp(Buffer.from(tex.getImage()));
    const meta = await img.metadata();
    const k = Math.min(1, maxSize / Math.max(meta.width, meta.height));
    const w = pow2(meta.width * k), h = pow2(meta.height * k);         // POT: mip levels without surprises
    const png = join(tmp, `t${i}.png`), out = join(tmp, `t${i}.ktx2`);
    await img.resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toFile(png);
    const isNormal = normalTex.has(tex);
    const fmt = isNormal ? 'R8G8B8_UNORM' : 'R8G8B8_SRGB';
    const enc = mode === 'uastc'
      ? ['--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18']
      : ['--encode', 'basis-lz', '--clevel', '2', '--qlevel', '192'];
    execFileSync(ktx, ['create', '--format', fmt, ...enc, '--generate-mipmap', ...(isNormal ? ['--normal-mode'] : []), '--assign-tf', isNormal ? 'linear' : 'srgb', png, out],
      { env: { ...process.env, LD_LIBRARY_PATH: join(dirname(dirname(ktx)), 'lib') }, stdio: ['ignore', 'ignore', 'inherit'] });
    tex.setImage(new Uint8Array(await readFile(out))).setMimeType('image/ktx2');
    info.push(`${meta.width}×${meta.height} → ${w}×${h} ${mode.toUpperCase()} ${Math.round((await stat(out)).size / 1024)} КБ${isNormal ? ' (нормалі)' : ''}`);
  }
  if (info.length) doc.createExtension(gtx.KHRTextureBasisu).setRequired(true);
  await rm(tmp, { recursive: true, force: true });
  return info;
}
const pow2 = (v) => 2 ** Math.max(0, Math.round(Math.log2(Math.max(1, v))));

// `ktx` from PATH, or the official Linux build unpacked into tools/.bin/ (downloaded once, SHA-1 checked)
async function ktxTool() {
  try { execFileSync('ktx', ['--version'], { stdio: 'ignore' }); return 'ktx'; } catch { /* not installed */ }
  const bin = join(KTX_DIR, 'bin/ktx');
  if (existsSync(bin)) return bin;
  const base = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Linux-x86_64.tar.bz2`;
  console.log(`завантажую KTX-Software ${KTX_VERSION} (офіційний реліз Khronos) у tools/.bin/ …`);
  const data = Buffer.from(await (await fetch(base)).arrayBuffer());
  const want = (await (await fetch(base + '.sha1')).text()).trim().split(/\s+/)[0];
  const got = createHash('sha1').update(data).digest('hex');
  if (want !== got) throw new Error(`KTX-Software: контрольна сума не збігається (${got} ≠ ${want})`);
  await mkdir(dirname(KTX_DIR), { recursive: true });
  const archive = KTX_DIR + '.tar.bz2';
  await writeFile(archive, data);
  execFileSync('tar', ['xjf', archive, '-C', dirname(KTX_DIR)]);
  await rm(archive);
  return bin;
}

await main();
