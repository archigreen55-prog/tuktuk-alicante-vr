// The full description of a place (0.20.2, "Read more" on the card of a stop of the Real tour): the photo with its author and licence, the short and the
// long text of TukTuk OS, the guests' questions and the sources. The game stands still while it is open (like the full map). Close: the button, a tap
// beside the card, Esc, or the Back button of the phone. Texts come in the language of the interface (main.js localizedSpec).
import { t } from '../i18n.js';

const CSS = /* css */ `
.pd-layer { position: fixed; inset: 0; z-index: 70; display: none; align-items: center; justify-content: center; background: rgba(6, 10, 16, .78); color: #fff; font-family: system-ui, sans-serif; }
.pd-layer.open { display: flex; }
.pd-card { position: relative; width: min(96vw, 940px); max-height: 94vh; box-sizing: border-box; display: flex; gap: 16px; padding: 14px 16px; border-radius: 16px; background: rgba(15, 26, 40, .97); box-shadow: 0 10px 40px rgba(0, 0, 0, .55); overflow: hidden; }
.pd-photo { flex: 0 0 38%; display: flex; flex-direction: column; gap: 6px; align-self: flex-start; }
.pd-photo img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; background: #1b2a3b; display: block; }
.pd-photo img.icon { object-fit: contain; background: #fffaf0; padding: 10%; box-sizing: border-box; }
.pd-credit { font-size: 12px; line-height: 1.35; color: #9fb3c8; } .pd-credit a { color: #9fd3ff; }
.pd-text { flex: 1; min-width: 0; overflow-y: auto; padding-right: 6px; max-height: calc(94vh - 28px); -webkit-overflow-scrolling: touch; }
.pd-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; background: rgba(15, 26, 40, .97); padding-bottom: 6px; }
.pd-text h2 { margin: 4px 0 0; font-size: 21px; color: #ffd166; }
.pd-text p { margin: 0 0 9px; font-size: 15px; line-height: 1.45; color: #e8eef5; } .pd-text p.short { font-weight: 600; color: #fff; }
.pd-text h3 { margin: 14px 0 6px; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; color: #9fb3c8; }
.pd-text details { margin: 0 0 6px; background: rgba(255, 255, 255, .07); border-radius: 8px; padding: 8px 10px; font-size: 14.5px; line-height: 1.4; }
.pd-text summary { cursor: pointer; font-weight: 700; color: #ffd166; } .pd-text details p { margin: 6px 0 0; }
.pd-text ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; } .pd-text li a { color: #9fd3ff; word-break: break-word; }
.pd-close { flex: none; font: 800 15px system-ui, sans-serif; min-height: 44px; padding: 8px 14px; border: 0; border-radius: 12px; background: #ffd166; color: #222; cursor: pointer; touch-action: manipulation; }
@media (max-height: 460px) and (orientation: landscape) { .pd-card { padding: 10px 12px; gap: 12px; } .pd-photo { flex-basis: 34%; } .pd-text h2 { font-size: 18px; } .pd-text p { font-size: 14px; margin-bottom: 7px; } .pd-close { min-height: 40px; padding: 6px 12px; } }
@media (orientation: portrait) { .pd-card { flex-direction: column; overflow-y: auto; } .pd-photo { flex-basis: auto; align-self: stretch; } .pd-text { overflow: visible; max-height: none; } }
.pd-flash { position: fixed; inset: 0; z-index: 69; background: #fff; opacity: 0; pointer-events: none; }
.pd-flash.on { animation: pdflash .32s ease-out; } @keyframes pdflash { 0% { opacity: .75; } 100% { opacity: 0; } }
`;
const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

// "Photo: Choinowski, CC BY-SA 4.0" with the links to the file and to the licence (the licence asks for the author's name)
export function photoCreditHtml(photo) {
  const c = photo && photo.credit; if (!c || !c.author) return '';
  const lic = c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license);
  const who = c.sourceUrl ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.author)}</a>` : esc(c.author);
  return t('place.photoBy', { a: who, l: lic });
}
export const photoCreditText = (photo) => (photo && photo.credit && photo.credit.author ? t('place.photoBy', { a: photo.credit.author, l: photo.credit.license }) : '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createPlaceDetail({ setPaused }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const layer = el('div', 'pd-layer', null, document.body), card = el('div', 'pd-card', null, layer);
  const flashEl = el('div', 'pd-flash', null, document.body);
  const closeBtn = document.createElement('button'); closeBtn.className = 'pd-close'; closeBtn.id = 'placeClose';
  const photoBox = el('div', 'pd-photo', null, card), text = el('div', 'pd-text', null, card);
  let open = false, pushed = false, ignorePop = false;

  function fill(pl) {
    closeBtn.textContent = t('place.close');
    photoBox.textContent = ''; text.textContent = '';
    const ph = pl.photo, img = el('img', ph ? '' : 'icon', null, photoBox); img.alt = (ph && ph.alt) || pl.title; img.decoding = 'async';
    if (ph) img.src = ph.src; else if (pl.icon) img.src = pl.icon; else img.style.display = 'none';
    if (ph) { const cr = el('div', 'pd-credit', null, photoBox); cr.innerHTML = photoCreditHtml(ph); }
    const head = el('div', 'pd-head', null, text); el('h2', null, pl.title, head); head.appendChild(closeBtn);
    if (pl.fact) el('p', 'short', pl.fact, text);
    for (const para of pl.long || []) el('p', null, para, text);
    if (pl.questions && pl.questions.length) {
      el('h3', null, t('place.questions'), text);
      for (const q of pl.questions) { const d = el('details', null, null, text); el('summary', null, q.q, d); el('p', null, q.a, d); }
    }
    if (pl.sources && pl.sources.length) {
      el('h3', null, t('place.sources'), text);
      const ul = el('ul', null, null, text);
      for (const s of pl.sources) { const li = el('li', null, null, ul), a = el('a', null, s.title || s.url, li); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; }
    }
    text.scrollTop = 0;
  }
  function doClose(fromPop) {
    if (!open) return;
    open = false; layer.classList.remove('open'); setPaused(false);
    if (pushed && !fromPop) { pushed = false; ignorePop = true; setTimeout(() => { ignorePop = false; }, 600); try { history.back(); } catch (_) { ignorePop = false; } } else pushed = false;
  }
  closeBtn.addEventListener('click', () => doClose(false));
  layer.addEventListener('click', (e) => { if (e.target === layer) doClose(false); });
  // registered before the phone menu's popstate handler (created later), like the full map's: the Back button closes this first
  addEventListener('popstate', (e) => {
    if (ignorePop) { ignorePop = false; e.stopImmediatePropagation(); return; }
    if (open) { pushed = false; doClose(true); e.stopImmediatePropagation(); }
  });
  addEventListener('keydown', (e) => { if (open && e.code === 'Escape') { doClose(false); e.preventDefault(); } });
  addEventListener('tuktuk-lang', () => { if (open && api.place) fill(api.place); });
  const api = {
    place: null,
    open(pl) {
      if (open || !pl) return;
      api.place = pl; fill(pl); open = true; layer.classList.add('open'); setPaused(true);
      try { history.pushState({ placeDetail: true }, ''); pushed = true; } catch (_) { pushed = false; }
    },
    close: () => doClose(false),
    get isOpen() { return open; },
    // the flash of the tourists' cameras: a white veil that fades in a third of a second
    flash() { flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on'); },
  };
  return api;
}
