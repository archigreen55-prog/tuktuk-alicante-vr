// Prepares photo facades for the game from data/facades.json (see src/city/photoFacades.js for the format).
// For every photo entry: takes the source photo ("from": a file in assets/facades/ or a URL, downloaded once
// into assets/facades/.cache/), straightens the perspective by the 4 "corners" of the facade, cuts it to
// the facade, scales it to <= 2048 px (or "px") and writes a compressed JPEG to "src". With an "outline"
// (the silhouette against the sky) it also writes "<src>.mask.png": the game cuts the sky out with it.
//
//   npm install                                   # once: installs sharp (image library) for this tool
//   node tools/prepare-facade.mjs                  # all photos
//   node tools/prepare-facade.mjs mercado-front    # one photo (by "id")
//   node tools/prepare-facade.mjs --list way/21410214   # the building's walls: numbers for "edges"
//   node tools/prepare-facade.mjs --check mercado-front # draws the corners and outline on the source photo
//                                                       # -> assets/facades/.check/<id>.jpg
//
// "corners": [[x, y] top-left, top-right, bottom-right, bottom-left] in pixels of the source photo (as any
// image viewer shows them, e.g. GIMP's status bar). Left and right: the ends of the covered facade
// (or of "span"; for a wall tile: one repeat of the pattern). Bottom: ground level at the wall. Top: any
// horizontal line of the facade vertically above them (the eave, a cornice). Everything above the top edge
// that the "outline" encloses (towers, a dome) is kept too.
// The height of that rectangle in metres is worked out from the perspective (the rectangle's vanishing
// points and the lens: EXIF, "focal35" in mm for a 35 mm camera, or 26 mm, a typical phone). If you know
// it (a tape, a floor count), put it in "height" (m) — that wins.
// "outline": [[x, y], ...] the building's silhouette in the same source pixels (optional).
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ringOf, photoPlacement, describeEdges, bearingOf } from '../src/city/photoFacades.js';

let sharp;
try { ({ default: sharp } = await import('sharp')); } catch {
  console.error('Потрібна бібліотека sharp: один раз запусти `npm install` у папці гри.');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const check = args[0] === '--check';
const MAX_PX = 2048;          // Quest budget per facade (plan-stage-5 §2.7, report-mercado)
const DEFAULT_FOCAL35 = 26;   // mm, typical phone main camera
const JPEG_QUALITY = 84;
const UA = 'tuktuk-alicante-vr facade tool (https://github.com/archigreen55-prog/tuktuk-alicante-vr)';

async function prepare(entry, ring, b) {
  const srcFile = await sourceFile(entry.from);
  const img = sharp(srcFile, { limitInputPixels: false }).rotate(); // EXIF orientation, as viewers show it
  const meta = await sharp(srcFile).metadata();
  const swap = meta.orientation >= 5;
  const W = swap ? meta.height : meta.width, H = swap ? meta.width : meta.height;
  const [tl, tr, br, bl] = entry.corners;
  if (check) return drawCheck(entry, srcFile, W, H, ring);

  // metric width of the corner rectangle: the facade span (placed photo) or one tile (wall)
  let widthM, place = null;
  if (entry.wall) widthM = entry.wall;
  else { place = photoPlacement(ring, entry); widthM = place.width; }
  // metric height: given, or from the perspective
  const exifF = focal35FromExif(meta.exif);
  const focal35 = entry.focal35 || exifF || DEFAULT_FOCAL35;
  const fPx = (focal35 / 43.27) * Math.hypot(W, H);
  const persp = rectAspect([tl, tr, br, bl], W, H, fPx);
  const heightM = entry.height || widthM / persp.aspect;
  // homography: rectangle metres (x right, y up from the ground) -> source pixels
  const toSrc = homography([[0, heightM], [widthM, heightM], [widthM, 0], [0, 0]], [tl, tr, br, bl]);
  const toM = invert3(toSrc);
  const outlineM = (entry.outline || []).map((p) => apply(toM, p[0], p[1]));
  const topM = Math.max(heightM, ...outlineM.map((p) => p[1] + 0.1));
  // output size: no bigger than the photo really has (longest corner edge in source pixels) or px / 2048
  const lim = entry.px || MAX_PX;
  let ow = Math.min(lim, Math.round(Math.max(dist(tl, tr), dist(bl, br))));
  let oh = Math.round((ow * topM) / widthM);
  if (oh > lim) { ow = Math.round((ow * lim) / oh); oh = lim; }

  // warp at 2x, then a good downscale (lanczos) -> no aliasing from the big source
  const { data: src, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const SS = 2, sw = ow * SS, sh = oh * SS;
  const big = Buffer.alloc(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const ym = topM * (1 - (y + 0.5) / sh);
    for (let x = 0; x < sw; x++) {
      const xm = (widthM * (x + 0.5)) / sw;
      const [sx, sy] = apply(toSrc, xm, ym);
      bilinear(src, info.width, info.height, sx - 0.5, sy - 0.5, big, (y * sw + x) * 3);
    }
  }
  let rgb = await sharp(big, { raw: { width: sw, height: sh, channels: 3 } }).resize(ow, oh, { kernel: 'lanczos3' }).raw().toBuffer();

  const out = join(root, entry.src);
  await mkdir(dirname(out), { recursive: true });
  let maskInfo = '';
  if (outlineM.length >= 3 && !entry.wall) { // a wall tile repeats: its outline only sets the height
    const pts = outlineM.map(([x, y]) => `${((x / widthM) * ow).toFixed(2)},${((1 - y / topM) * oh).toFixed(2)}`).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}"><rect width="100%" height="100%" fill="black"/><polygon points="${pts}" fill="white"/></svg>`;
    const mask = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const alpha = mask.info.channels === 1 ? mask.data : pick(mask.data, mask.info.channels);
    rgb = pushPull(rgb, alpha, ow, oh); // building colours under the sky, so the edges never bleed blue
    const maskFile = out.replace(/\.[^.]+$/, '') + '.mask.png';
    await sharp(alpha, { raw: { width: ow, height: oh, channels: 1 } }).png({ compressionLevel: 9 }).toFile(maskFile);
    maskInfo = `, маска ${basename(maskFile)} ${kb(await stat(maskFile))}`;
  }
  await sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(out);

  const pxm = ow / widthM;
  console.log(`${entry.id}: ${ow}×${oh} px = ${widthM.toFixed(1)} × ${topM.toFixed(1)} м (${pxm.toFixed(0)} px/м) → ${entry.src} ${kb(await stat(out))}${maskInfo}`);
  console.log(`  висота прямокутника кутів ${heightM.toFixed(2)} м ${entry.height ? '(задана "height")' : `(з перспективи, об'єктив ${focal35} мм${entry.focal35 ? ' з "focal35"' : exifF ? ' з EXIF' : ' — типовий, EXIF немає'}${persp.focal35 ? `; точки сходу кажуть ${persp.focal35.toFixed(0)} мм` : ''})`}`);
  if (place) console.log(`  стіни ${entry.edges.join('–')}: ${place.extent.toFixed(1)} м, фото на ${place.s0.toFixed(1)}–${place.s1.toFixed(1)} м, камера дивиться на ${Math.round(bearingOf(...place.view))}°`);
  if (entry.lathe || args.includes('--outline')) console.log(`  контур у метрах (x від лівого краю, y від землі): ${JSON.stringify(outlineM.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]))}`);
}

// ---------- source photos ----------
async function sourceFile(from) {
  if (!/^https?:/.test(from)) return join(root, from);
  const file = join(root, 'assets/facades/.cache', decodeURIComponent(basename(new URL(from).pathname)));
  try { await stat(file); return file; } catch { /* download */ }
  console.log(`завантажую ${from}`);
  const res = await fetch(from, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${from}: HTTP ${res.status}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function drawCheck(entry, srcFile, W, H, ring) {
  const s = Math.min(1, 1600 / Math.max(W, H));
  const P = (p) => `${(p[0] * s).toFixed(1)},${(p[1] * s).toFixed(1)}`;
  const c = entry.corners;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * s)}" height="${Math.round(H * s)}">`;
  svg += `<polygon points="${c.map(P).join(' ')}" fill="none" stroke="red" stroke-width="3"/>`;
  if (entry.outline) svg += `<polygon points="${entry.outline.map(P).join(' ')}" fill="rgba(255,220,0,0.15)" stroke="yellow" stroke-width="2"/>`;
  c.forEach((p, i) => { svg += `<circle cx="${p[0] * s}" cy="${p[1] * s}" r="9" fill="red"/><text x="${p[0] * s + 12}" y="${p[1] * s - 8}" font-size="22" font-family="sans-serif" fill="red" stroke="white" stroke-width="0.6">${['TL', 'TR', 'BR', 'BL'][i]}</text>`; });
  svg += '</svg>';
  const out = join(root, 'assets/facades/.check', `${entry.id}.jpg`);
  await mkdir(dirname(out), { recursive: true });
  await sharp(srcFile).rotate().resize(Math.round(W * s)).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 85 }).toFile(out);
  console.log(`${entry.id}: ${out}`);
  // the prepared image with the wall corners of the building (OSM) as vertical lines
  if (entry.wall) return;
  let meta;
  try { meta = await sharp(join(root, entry.src)).metadata(); } catch { return; }
  const pl = photoPlacement(ring, entry);
  let lines = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">`;
  for (const e of pl.edges) {
    const u = pl.u(e.a[0], e.a[1]);
    const raw = ((u - pl.s0) / pl.width) * meta.width, x = pl.frac(u) * meta.width;
    if (Math.abs(raw - x) > 1) lines += `<line x1="${raw}" y1="0" x2="${raw}" y2="${meta.height}" stroke="white" stroke-width="1" stroke-dasharray="6 6"/>`;
    lines += `<line x1="${x}" y1="0" x2="${x}" y2="${meta.height}" stroke="red" stroke-width="2"/><text x="${x + 4}" y="${meta.height - 8 - (e.i % 2) * 22}" font-size="20" fill="red" stroke="white" stroke-width="0.5">${e.i}</text>`;
  }
  lines += '</svg>';
  const out2 = join(root, 'assets/facades/.check', `${entry.id}-walls.jpg`);
  await sharp(join(root, entry.src)).composite([{ input: Buffer.from(lines) }]).jpeg({ quality: 85 }).toFile(out2);
  console.log(`${entry.id}: ${out2} (червоні лінії — початки стін OSM з номерами, пунктир — де вони були б без "align")`);
}

// ---------- geometry ----------
// 3x3 homography mapping 4 points from -> to (DLT, solved exactly)
function homography(from, to) {
  const A = [], bv = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
  }
  const h = solve(A, bv);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function apply(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// True width/height of a rectangle seen in perspective (Zhang & He, "Whiteboard scanning", 2007):
// principal point at the image centre, square pixels, focal length f in pixels. Also returns the focal
// length the two vanishing points imply (35 mm equivalent), when they are not at infinity.
function rectAspect([tl, tr, br, bl], W, H, f) {
  const h = (p) => [p[0] - W / 2, p[1] - H / 2, 1];
  const m1 = h(tl), m2 = h(tr), m3 = h(bl), m4 = h(br);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  const q = (n) => (n[0] * n[0] + n[1] * n[1]) / (f * f) + n[2] * n[2];
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  const focal35 = f2 > 0 && Math.abs(n2[2]) > 1e-3 && Math.abs(n3[2]) > 1e-3 ? (Math.sqrt(f2) / Math.hypot(W, H)) * 43.27 : null;
  return { aspect: Math.sqrt(q(n2) / q(n3)), focal35 };
}
function bilinear(src, w, h, x, y, out, o) {
  x = Math.min(Math.max(x, 0), w - 1.001); y = Math.min(Math.max(y, 0), h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 3, i10 = i00 + 3, i01 = i00 + w * 3, i11 = i01 + 3;
  for (let c = 0; c < 3; c++) {
    const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
    const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
    out[o + c] = Math.round(top + (bot - top) * fy);
  }
}
function pick(data, ch) { const out = Buffer.alloc(data.length / ch); for (let i = 0; i < out.length; i++) out[i] = data[i * ch]; return out; }

// Push-pull fill: pixels outside the mask get the colour of the nearest building pixels (smoothly), so
// the mip levels in the game never mix sky into the facade's silhouette.
function pushPull(rgb, alpha, w, h) {
  const levels = [];
  let cw = w, chh = h;
  let P = new Float32Array(w * h * 3), Wt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = alpha[i] / 255; Wt[i] = a; for (let c = 0; c < 3; c++) P[i * 3 + c] = rgb[i * 3 + c] * a; }
  levels.push({ P, W: Wt, w: cw, h: chh });
  while (cw > 1 || chh > 1) {
    const nw = Math.max(1, Math.ceil(cw / 2)), nh = Math.max(1, Math.ceil(chh / 2));
    const NP = new Float32Array(nw * nh * 3), NW = new Float32Array(nw * nh);
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x, j = (y >> 1) * nw + (x >> 1);
      NW[j] += Wt[i]; for (let c = 0; c < 3; c++) NP[j * 3 + c] += P[i * 3 + c];
    }
    for (let j = 0; j < nw * nh; j++) if (NW[j] > 1) { for (let c = 0; c < 3; c++) NP[j * 3 + c] /= NW[j]; NW[j] = 1; }
    P = NP; Wt = NW; cw = nw; chh = nh;
    levels.push({ P, W: Wt, w: cw, h: chh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], C = levels[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x, j = (y >> 1) * C.w + (x >> 1);
      const k = 1 - L.W[i], cw2 = C.W[j] || 1;
      for (let c = 0; c < 3; c++) L.P[i * 3 + c] += (k * C.P[j * 3 + c]) / cw2;
      L.W[i] = 1;
    }
  }
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h * 3; i++) out[i] = Math.max(0, Math.min(255, Math.round(levels[0].P[i])));
  return out;
}

// EXIF FocalLengthIn35mmFilm (tag 0xA405) from the raw EXIF block sharp returns
function focal35FromExif(buf) {
  if (!buf) return null;
  let o = buf.indexOf('Exif\0\0') === 0 ? 6 : 0;
  const le = buf.toString('ascii', o, o + 2) === 'II';
  const u16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
  const u32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
  const ifd = (off, tag) => {
    const n = u16(o + off);
    for (let k = 0; k < n; k++) { const e = o + off + 2 + k * 12; if (u16(e) === tag) return { type: u16(e + 2), val: e + 8 }; }
    return null;
  };
  try {
    const exifPtr = ifd(u32(o + 4), 0x8769);
    if (!exifPtr) return null;
    const f = ifd(u32(exifPtr.val), 0xa405);
    return f ? u16(f.val) || null : null;
  } catch { return null; }
}
const kb = (s) => `${Math.round(s.size / 1024)} КБ`;

async function main() {
  const facades = JSON.parse(await readFile(join(root, 'data/facades.json'), 'utf8'));
  const city = JSON.parse(await readFile(join(root, 'data/city.json'), 'utf8'));
  const buildingById = new Map(city.buildings.map((b) => [b.id, b]));

  if (args[0] === '--list') {
    const id = args[1];
    const b = buildingById.get(id);
    if (!b) throw new Error(`${id}: немає в data/city.json`);
    const ring = ringOf(b.p);
    console.log(`${id} ${b.n || ''}: висота ${b.h} м, ${ring.length} стін (ребер контуру). "faces" — куди дивиться стіна (0 = північ, 90 = схід, 180 = південь).`);
    for (const e of describeEdges(ring, b.e)) console.log(`  ${String(e.i).padStart(3)}  ${e.len.toFixed(1).padStart(6)} м  faces ${String(e.faces).padStart(3)}°  ${e.street}`);
    return;
  }
  const only = new Set(args.filter((a) => !a.startsWith('--')));

  let done = 0;
  for (const [osmId, spec] of Object.entries(facades)) {
    if (osmId.startsWith('_') || !spec.photos) continue;
    const b = buildingById.get(osmId);
    if (!b) { console.warn(`${osmId}: немає в data/city.json, пропускаю`); continue; }
    const ring = ringOf(b.p);
    for (const entry of spec.photos) {
      if (only.size && !only.has(entry.id)) continue;
      if (!entry.from || !entry.corners) { console.warn(`${entry.id}: немає "from" або "corners", пропускаю`); continue; }
      await prepare(entry, ring, b);
      done++;
    }
  }
  if (!done) console.log(only.size ? `Не знайдено фото з id: ${[...only].join(', ')}` : 'У data/facades.json немає фото з "from" і "corners".');
}

await main();
