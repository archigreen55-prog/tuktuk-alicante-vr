// Device kind (phone / desktop) and the "turn the phone" guard. The kind is decided by the early script
// in index.html (window.__diag.ui): a touch screen without hover is a phone; ?ui=phone / ?ui=desktop force it.
export const UI = (window.__diag && window.__diag.ui) || 'desktop';
export const IS_PHONE = UI === 'phone';

// A full-screen "turn the phone" card while the phone is held upright. guard.portrait is read by the
// game loop, which pauses meanwhile.
export function installRotateGuard() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:150;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#10161c;color:#fff;font:600 20px/1.3 system-ui,sans-serif;text-align:center;padding:24px';
  el.innerHTML = '<div style="font-size:72px;line-height:1">📱↻</div><div>Поверни телефон горизонтально</div><div style="font:400 14px/1.4 system-ui,sans-serif;opacity:.7">Гра йде лише в горизонтальному положенні; поки телефон стоїть сторчма, гра на паузі.</div>';
  document.body.appendChild(el);
  const guard = { portrait: false, _q: false };   // quiet: the title screen is open (it reads fine upright, the card asks to turn the phone)
  const update = () => {
    guard.portrait = innerHeight > innerWidth;
    el.style.display = guard.portrait && !guard.quiet ? 'flex' : 'none';
  };
  Object.defineProperty(guard, 'quiet', { get: () => guard._q, set: (v) => { guard._q = !!v; update(); } });
  addEventListener('resize', update);
  addEventListener('orientationchange', update);
  update();
  return guard;
}
