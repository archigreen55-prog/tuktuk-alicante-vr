// Full screen, landscape lock, wake lock and "install as an app" for the phone (plan-phone.md section 6).
// Everything that can be refused records WHY (kept for the diagnostics report), because on a phone the browser
// decides silently: in 0.10.2 the bench asked for full screen and the address bar stayed.

const rec = { fullscreen: null, lock: null, wake: null, events: [] };   // { ok, why, t }
const stamp = () => ((performance.now() - (window.__diag ? window.__diag.t0 : 0)) / 1000).toFixed(1) + 's';
const note = (text) => { rec.events.push(`[${stamp()}] ${text}`); if (rec.events.length > 20) rec.events.shift(); console.log(`[screen] ${text}`); };

document.addEventListener('fullscreenchange', () => note(`fullscreenchange: ${document.fullscreenElement ? 'увійшов' : 'вийшов'} (вікно ${innerWidth}×${innerHeight})`));
document.addEventListener('fullscreenerror', () => note('fullscreenerror (браузер відхилив запит)'));
screen.orientation && screen.orientation.addEventListener && screen.orientation.addEventListener('change', () => note(`орієнтація: ${screen.orientation.type}`));

export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

// Why full screen is not possible at all, or '' when it is (document.fullscreenEnabled is false e.g. in an embedded
// viewer / Custom Tab opened from another app, or inside an iframe)
export function fullscreenBlocker() {
  const el = document.documentElement;
  if (!(el.requestFullscreen || el.webkitRequestFullscreen)) return 'у цьому браузері немає API повного екрана';
  if (document.fullscreenEnabled === false) return 'браузер забороняє повний екран на цій сторінці (схоже на вбудований перегляд посилання)';
  return '';
}

// Must be called from a tap / click handler. Returns { ok, why }. Tries with navigationUI 'hide', then plain.
export async function enterFullscreen() {
  if (isFullscreen()) { rec.fullscreen = { ok: true, why: 'вже на весь екран', t: stamp() }; return rec.fullscreen; }
  const blocker = fullscreenBlocker();
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (blocker) { rec.fullscreen = { ok: false, why: blocker, t: stamp() }; note(`повний екран неможливий: ${blocker}`); return rec.fullscreen; }
  try {
    await req.call(el, { navigationUI: 'hide' });
    rec.fullscreen = { ok: true, why: 'requestFullscreen({navigationUI:"hide"})', t: stamp() };
  } catch (e1) {
    try {
      await req.call(el);
      rec.fullscreen = { ok: true, why: `requestFullscreen() без параметрів (з параметром: ${e1.name}: ${e1.message})`, t: stamp() };
    } catch (e2) {
      rec.fullscreen = { ok: false, why: `${e2.name}: ${e2.message}`, t: stamp() };
    }
  }
  note(`повний екран: ${rec.fullscreen.ok ? 'ТАК' : 'НІ'} — ${rec.fullscreen.why}`);
  return rec.fullscreen;
}

// Landscape lock: Chrome allows it only in full screen (or an installed app)
export async function lockLandscape() {
  if (!(screen.orientation && screen.orientation.lock)) { rec.lock = { ok: false, why: 'screen.orientation.lock недоступний', t: stamp() }; note(rec.lock.why); return rec.lock; }
  try { await screen.orientation.lock('landscape'); rec.lock = { ok: true, why: 'landscape', t: stamp() }; }
  catch (e) { rec.lock = { ok: false, why: `${e.name}: ${e.message}`, t: stamp() }; }
  note(`блокування горизонталі: ${rec.lock.ok ? 'ТАК' : 'НІ'} — ${rec.lock.why}`);
  return rec.lock;
}

// The screen stays on while playing (a stop with the hands off the screen can last a minute)
let wakeLock = null;
export async function keepAwake() {
  if (!navigator.wakeLock) { rec.wake = { ok: false, why: 'navigator.wakeLock недоступний', t: stamp() }; return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => note('wake lock знято'));
    rec.wake = { ok: true, why: 'screen', t: stamp() };
  } catch (e) { rec.wake = { ok: false, why: `${e.name}: ${e.message}`, t: stamp() }; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && rec.wake && rec.wake.ok && (!wakeLock || wakeLock.released)) keepAwake(); });

// "Install as an app": Chrome offers it through beforeinstallprompt; the manifest makes the installed app full screen
let deferredInstall = null;
const installListeners = [];
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; for (const f of installListeners) f(true); note('beforeinstallprompt: застосунок можна встановити'); });
addEventListener('appinstalled', () => { deferredInstall = null; for (const f of installListeners) f(false); note('застосунок встановлено'); });
export const canInstall = () => !!deferredInstall;
export const onInstallChange = (f) => installListeners.push(f);
export async function install() { if (!deferredInstall) return false; deferredInstall.prompt(); const r = await deferredInstall.userChoice; deferredInstall = null; return r.outcome === 'accepted'; }

// for the report
export function screenReport() {
  const r = (x) => (x ? `${x.ok ? 'ТАК' : 'НІ'} — ${x.why} (${x.t})` : 'не запитувалось');
  return {
    'повний екран зараз': `${isFullscreen() ? 'так' : 'ні'}; document.fullscreenEnabled = ${document.fullscreenEnabled}; блокування: ${fullscreenBlocker() || 'немає'}`,
    'запит повного екрана': r(rec.fullscreen),
    'блокування горизонталі': r(rec.lock),
    'екран не гасне': r(rec.wake),
    'режим відображення': `${['browser', 'standalone', 'fullscreen', 'minimal-ui'].filter((m) => matchMedia(`(display-mode: ${m})`).matches).join(',') || '?'}; встановлено як застосунок: ${isStandalone() ? 'так' : 'ні'}; можна встановити: ${canInstall() ? 'так' : 'ні/невідомо'}`,
    'події екрана': rec.events.length ? rec.events.join(' | ') : 'немає',
  };
}

// a short message on the page (the start screen has its own place for it)
export function hintFor(result) {
  if (!result || result.ok) return '';
  return `Повний екран не ввімкнувся: ${result.why}. Відкрий гру в самому Chrome (⋮ → «Відкрити в Chrome») або додай на головний екран (⋮ → «Додати на головний екран» / «Встановити застосунок») — тоді вона запускається без адресного рядка.`;
}
