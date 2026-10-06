// عمّالي — Service Worker (V60؛ V83: لا يعترض docs/ ولا يعيد التطبيق لفتح ملف): الصفحة تُفتح من الجهاز فورًا، والتحديث يُجلب في الخلفية ويُعرض شريط «نسخة أحدث جاهزة»
// كان حتى V59 «الشبكة أولًا»: كل فتح ينتظر تنزيل الصفحة (نحو 1.35 ميغابايت مضغوطة) أو انقطاع الاتصال قبل الظهور.
// V103b: قناتان على الموقع نفسه — الثابتة في الجذر (للزملاء) والتجريبية في beta/ (للمالك). لكل قناة ذاكرتها، ولا تمسّ إحداهما ذاكرة الأخرى،
// والجذر لا يعترض صفحات beta/. الخطوط والأيقونات ومحرك القراءة والدليل في الجذر وحده تشترك فيها القناتان.
const SCOPE = new URL(self.registration.scope).pathname, BETA = /\/beta\/$/.test(SCOPE), UP = BETA ? '../' : './';
const CACHE = BETA ? 'amali-beta-v176' : 'amali-v176';   // يُرفع الرقمان معًا مع كل إصدار
const CORE = ['./', './index.html', './manifest.json', UP + 'icon-180.png'];
const FONTS_FILES = ['plex','naskh','cairo','tajawal','almarai','amiri','kufi','readex','markazi'].flatMap(f => [UP + 'fonts/' + f + '-400.woff2', UP + 'fonts/' + f + '-700.woff2']).concat([UP + 'fonts/reem-700.woff2', UP + 'fonts/reem-700-lat.woff2', UP + 'fonts/plex-600.woff2', UP + 'fonts/kufi-600.woff2', UP + 'fonts/readex-600.woff2']);
const FLAG = './__amali_update';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.concat(FONTS_FILES)).catch(() => {}))); });
// V108: حزم المبادئ (packs/) في ذاكرة مستقلة تشترك فيها القناتان ولا تُمسح مع كل إصدار؛ اسم الملف يحمل إصدار الحزمة
const PKC = 'amali-packs';
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== PKC && k.startsWith('amali-beta-') === BETA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// V83: الصفحة وحدها «HTML»؛ فتح ملف (PDF/فيديو) لا يُعاد إليه التطبيق
function isHtml(req, url) { const p = url.pathname; if (/\.[a-z0-9]{2,5}$/i.test(p) && !/\.html?$/i.test(p)) return false; return req.mode === 'navigate' || p.endsWith('/') || p.endsWith('index.html'); }
const buildOf = t => { const m = /<meta name="amali-build" content="([^"]*)"/.exec(t || ''); return m ? m[1] : ''; };
let busy = null;
// يجلب الصفحة من الشبكة في الخلفية؛ إن تغيّر رقم البناء تُحفظ النسخة الجديدة ويُبلَّغ التطبيق
function refresh() {
  if (busy) return busy;
  busy = (async () => {
    try {
      const c = await caches.open(CACHE);
      const res = await fetch('./index.html', { cache: 'no-cache' });
      if (!res || !res.ok) return;
      const old = await c.match('./index.html');
      const nt = await res.clone().text(), ob = old ? buildOf(await old.clone().text()) : '', nb = buildOf(nt);
      await c.put('./index.html', res);
      if (old && nb && nb !== ob) {
        await c.put(FLAG, new Response(JSON.stringify({ build: nb, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
        (await self.clients.matchAll({ type: 'window' })).forEach(w => w.postMessage({ type: 'amali-update', build: nb }));
      }
    } catch (e) {} finally { busy = null; }
  })();
  return busy;
}
self.addEventListener('message', e => { if (e.data && e.data.type === 'amali-check') e.waitUntil(refresh()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // لا يعترض طلبات claude.ai أو الخارجية
  if (!BETA && url.pathname.startsWith(SCOPE + 'beta/')) return; // V103b: صفحات القناة التجريبية لعامل خدمتها
  if (url.pathname.includes('/docs/')) return;
  if (/\/packs\//.test(url.pathname)) { e.respondWith(packFetch(e.request, url)); return; } // V83: الدليل والفيديو من الشبكة مباشرة (Safari يحتاج طلبات المدى للفيديو)
  if (isHtml(e.request, url)) {
    e.respondWith((async () => {
      const hit = await caches.match('./index.html');
      if (hit) { e.waitUntil(refresh()); return hit; }   // من الجهاز فورًا، والتحديث في الخلفية
      try { const res = await fetch(e.request); const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {}); return res; }
      catch (err) { return (await caches.match(e.request)) || Response.error(); }
    })());
    return;
  }
  // بقية الملفات (خطوط، محرك القراءة، صور): الذاكرة أولًا لسرعة العمل دون اتصال
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy).catch(() => {})); return res; }).catch(() => caches.match('./index.html'))));
});

// V108: فهرس الحزم من الذاكرة ويُحدَّث في الخلفية، وملف الحزمة من الذاكرة أولًا (اسمه يتغير مع إصداره)؛ يُحذف الإصدار الأقدم من الدائرة نفسها
async function packFetch(req, url) {
  const c = await caches.open(PKC);
  if (/index\.json$/.test(url.pathname)) {
    // من الجهاز فورًا إن وُجد، ويُحدَّث في الخلفية فيصل إصدار الحزمة الأحدث في الفتح التالي (لا انتظار لشبكة متعثرة)
    const old = await c.match(url.pathname);
    const net = fetch(req).then(r => { if (r && r.ok) c.put(url.pathname, r.clone()); return r; });
    if (old) { net.catch(() => {}); return old; }
    return net;
  }
  // V125: حزم التشريعات تُطلب ومعها بصمتها (?h=) — المفتاح هو المسار مع البصمة، فالمحتوى الجديد باسم الملف نفسه يُجلب، وتُحذف النسخة الأقدم
  if (/\/legis\//.test(url.pathname) && url.search) {
    const key = url.pathname + url.search, h2 = await c.match(key); if (h2) return h2;
    const r2 = await fetch(req);
    if (r2 && r2.ok) { await c.put(key, r2.clone()); (await c.keys()).forEach(k => { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(k); }); }
    return r2;
  }
  const hit = await c.match(url.pathname); if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) {
    await c.put(url.pathname, r.clone());
    // يُحذف ما في الذاكرة من إصدار أقدم للدائرة نفسها فقط (أجزاء الإصدار نفسه تبقى معًا)
    const R = /mabadi-pack_(.+?)_v([\d.]+?)(?:_part\d+of\d+)?\.json$/, m = R.exec(url.pathname);
    if (m) (await c.keys()).forEach(k => { const x = R.exec(new URL(k.url).pathname); if (x && x[1] === m[1] && x[2] !== m[2]) c.delete(k); });
    // V124: حزم التشريعات (packs/legis/) — يُحذف الإصدار الأقدم من المجموعة نفسها
    const RL = /mabadi-legis(?:_(.+?))?(?:-index)?_v([\d.]+)\.json$/, n = RL.exec(url.pathname);
    if (n) (await c.keys()).forEach(k => { const x = RL.exec(new URL(k.url).pathname); if (x && (x[1] || '') === (n[1] || '') && x[2] !== n[2] && /-index_/.test(k.url) === /-index_/.test(url.pathname)) c.delete(k); });
  }
  return r;
}
