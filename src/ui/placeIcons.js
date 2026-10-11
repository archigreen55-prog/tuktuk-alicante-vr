// The icons of the places (0.20.2): the illustrations of TukTuk OS (assets/tour/<id>/illustration.svg, prototypes) as round badges on the maps.
// iconOf(place) returns an image once it has loaded (null until then: the map draws its plain dot); the badge ring has the colour of the zone of the city.
let version = '';
export const setIconVersion = (v) => { version = v ? `?v=${v}` : ''; };

// zones of TukTuk OS (points.json "zone")
export const ZONE_COLOR = { waterfront: '#3b8fd9', 'old-town': '#c9803c', castle: '#8a63b8', west: '#4fa05a', center: '#d6b13a', station: '#7a8794', south: '#3fb09a', hub: '#2e9e57' };
export const zoneColor = (zone) => ZONE_COLOR[zone] || '#7a8794';

const cache = new Map();
export function iconOf(place) {
  if (!place || !place.icon) return null;
  let e = cache.get(place.icon);
  if (!e) {
    const img = new Image(); e = { img, ok: false, failed: false };
    img.onload = () => { e.ok = true; }; img.onerror = () => { e.failed = true; };
    img.decoding = 'async'; img.src = place.icon + version;
    cache.set(place.icon, e);
  }
  return e.ok ? e.img : null;
}

// a round badge: the picture inside a ring (the picture is drawn at 1.15 × the radius: the illustrations have air round them)
export function drawBadge(g, img, x, y, r, ring = '#10161c', lineWidth = 2.5, bg = '#fffaf0') {
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.clip();
  const s = r * 2.3; g.drawImage(img, x - s / 2, y - s / 2 - r * 0.04, s, s);
  g.restore();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.lineWidth = lineWidth; g.strokeStyle = ring; g.stroke();
}
