// The text report of the "Копіювати звіт" button: everything needed to judge a phone from a chat message.
// Each section is guarded: a missing browser API must never break the report.
const pad = (s, n) => String(s).padEnd(n);

async function battery() {
  try {
    if (!navigator.getBattery) return 'н/д (API недоступний)';
    const b = await navigator.getBattery();
    return `${Math.round(b.level * 100)} %${b.charging ? ', заряджається' : ', не заряджається'}`;
  } catch { return 'н/д'; }
}

// devicemotion for ~1 s: do the sensors exist and how often do they report
function sampleMotion(ms = 1000) {
  return new Promise((resolve) => {
    if (typeof DeviceMotionEvent === 'undefined') { resolve(null); return; }
    let n = 0, last = null;
    const h = (e) => { n++; last = e; };
    addEventListener('devicemotion', h);
    setTimeout(() => {
      removeEventListener('devicemotion', h);
      const a = last && last.accelerationIncludingGravity, r = last && last.rotationRate;
      resolve({
        events: n, hz: n * 1000 / ms, interval: last && last.interval,
        gravity: a && a.x != null ? `${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)}` : null,
        rotation: r && r.alpha != null ? `${r.alpha.toFixed(1)}, ${r.beta.toFixed(1)}, ${r.gamma.toFixed(1)}` : null,
      });
    }, ms);
  });
}

function gpuInfo(renderer) {
  const gl = renderer.getContext();
  const o = {};
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    o.vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    o.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    o.version = gl.getParameter(gl.VERSION);
    o.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    o.units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    o.highp = hp ? hp.precision : 0;
    const attrs = gl.getContextAttributes() || {};
    o.antialias = attrs.antialias;
    o.samples = gl.getParameter(gl.SAMPLES);
    o.exts = ['EXT_disjoint_timer_query_webgl2', 'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_s3tc', 'EXT_texture_filter_anisotropic'].map((n) => `${n.replace(/^(EXT|WEBGL)_/, '')}:${gl.getExtension(n) ? 'так' : 'ні'}`).join(' ');
  } catch (e) { o.error = e.message; }
  return o;
}

// ctx: { renderer, stats, bench, cap, game() -> { ... } }
export async function buildReport(ctx) {
  const { renderer, stats, bench } = ctx;
  const D = window.__diag || { errors: [], log: [], ui: '?' };
  const g = ctx.game();
  const L = [];
  const sec = (t) => L.push('', `== ${t} ==`);
  const [bat, motion] = await Promise.all([battery(), sampleMotion()]);

  L.push('Tuk-Tuk Alicante — звіт діагностики', `версія ${g.version} · ${new Date().toISOString()}`, location.href);

  if (bench && bench.results.length) {
    sec('Замір (?bench)');
    L.push(...bench.formatResults(ctx.cap));
  }

  const snap = stats.snapshot();
  sec('FPS (останні ~5 с)');
  L.push(`FPS ${snap.fps.toFixed(1)} · кадр ${snap.avgMs.toFixed(1)} мс · p95 ${snap.p95.toFixed(1)} мс · p99 ${snap.p99.toFixed(1)} мс · 1 % найгірших ${snap.low1.toFixed(0)} FPS · найгірший ${snap.worst.toFixed(0)} мс · кадрів >33 мс: ${snap.long} з ${snap.frames}`);
  L.push(`сцена: draw calls ${snap.calls} · трикутників ${snap.tris} · CPU кадру ${snap.cpuMs.toFixed(1)} мс · GPU ${snap.gpuMs == null ? 'н/д (таймер недоступний)' : snap.gpuMs.toFixed(1) + ' мс'}`);
  const hz = stats.refreshHz;
  L.push(`частота екрана (requestAnimationFrame): ${hz ? hz.toFixed(0) + ' Гц' : 'н/д'} · обмеження кадрів: ${ctx.cap > 0 ? ctx.cap : 'немає'}`);
  if (stats.history.length) {
    const h = stats.history;
    L.push(`історія FPS (5 с на крок, ${h.length} кроків, від старого до нового): ` + h.map((b) => b.fps.toFixed(0)).join(' '));
  }

  sec('Пристрій');
  L.push(`інтерфейс: ${D.ui}${new URLSearchParams(location.search).get('ui') ? ' (примусово)' : ''} · торкання: ${navigator.maxTouchPoints || 0} точок`);
  L.push(`браузер: ${navigator.userAgent}`);
  L.push(`ядер CPU: ${navigator.hardwareConcurrency ?? 'н/д'} · пам'ять пристрою: ${navigator.deviceMemory ? '≥ ' + navigator.deviceMemory + ' ГБ' : 'н/д'}`);
  const pm = performance.memory;
  L.push(`пам'ять JS: ${pm ? `${(pm.usedJSHeapSize / 1048576).toFixed(0)} МБ з ліміту ${(pm.jsHeapSizeLimit / 1048576).toFixed(0)} МБ` : 'н/д'}`);
  L.push(`батарея: ${bat} · мережа: ${navigator.connection ? `${navigator.connection.effectiveType || '?'}, ~${navigator.connection.downlink ?? '?'} Мбіт/с` : 'н/д'}`);

  sec('Екран і режим');
  const gl0 = renderer.getContext();
  const b = { x: gl0.drawingBufferWidth, y: gl0.drawingBufferHeight };
  L.push(`екран: ${screen.width}×${screen.height} · вікно: ${innerWidth}×${innerHeight} · devicePixelRatio ${devicePixelRatio} · використано pixelRatio ${renderer.getPixelRatio()} → малюється ${b.x}×${b.y} (${(b.x * b.y / 1e6).toFixed(2)} Мп)`);
  L.push(`орієнтація: ${(screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'landscape' : 'portrait')} · повний екран: ${document.fullscreenElement ? 'так' : 'ні'} · застосунок (standalone): ${matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches ? 'так' : 'ні'}`);

  sec('Графіка');
  const gi = gpuInfo(renderer);
  L.push(`GPU: ${gi.renderer || 'н/д'} (${gi.vendor || '?'})`);
  L.push(`${gi.version || ''} · макс. текстура ${gi.maxTex} · текстурних блоків ${gi.units} · highp у фрагментних шейдерах: ${gi.highp ? 'так' : 'НІ'} · MSAA: ${gi.antialias ? 'так, ' + gi.samples + 'x' : 'ні'}`);
  L.push(`розширення: ${gi.exts}${gi.error ? ' · помилка: ' + gi.error : ''}`);
  const info = renderer.info;
  L.push(`three.js: геометрій ${info.memory.geometries} · текстур ${info.memory.textures} · шейдерних програм ${info.programs ? info.programs.length : '?'}`);

  sec('Датчики');
  L.push(`DeviceMotionEvent: ${typeof DeviceMotionEvent !== 'undefined' ? 'є' : 'немає'} · DeviceOrientationEvent: ${typeof DeviceOrientationEvent !== 'undefined' ? 'є' : 'немає'} · запит дозволу потрібен: ${typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function' ? 'так' : 'ні'}`);
  L.push(`Sensor API: GravitySensor ${'GravitySensor' in window ? 'є' : 'немає'} · Gyroscope ${'Gyroscope' in window ? 'є' : 'немає'} · RelativeOrientationSensor ${'RelativeOrientationSensor' in window ? 'є' : 'немає'} · AbsoluteOrientationSensor ${'AbsoluteOrientationSensor' in window ? 'є' : 'немає'}`);
  if (motion) L.push(`devicemotion за 1 с: ${motion.events} подій (${motion.hz.toFixed(0)} Гц, інтервал ${motion.interval ?? '?'} мс) · гравітація x,y,z: ${motion.gravity || 'н/д'} · швидкість обертання: ${motion.rotation || 'н/д'}`);
  else L.push('devicemotion: немає');

  sec('Гра');
  for (const [k, v] of Object.entries(g.info)) L.push(`${pad(k, 22)} ${v}`);

  sec(`Помилки (${D.errors.length})`);
  if (!D.errors.length) L.push('немає');
  for (const e of D.errors) L.push(`[${e.t}] ${e.msg}`);

  sec('Останні рядки консолі');
  const logs = (D.log || []).slice(-30);
  if (!logs.length) L.push('(порожньо — журнал вмикається на телефоні, з ?diag або ?bench)');
  for (const e of logs) L.push(`[${e.t}] ${e.level === 'log' ? '' : e.level + ': '}${e.text}`);
  return L.join('\n');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* no permission / not focused: fall back */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}
