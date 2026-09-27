// عمّالي — Service Worker (V60؛ V83: لا يعترض docs/ ولا يعيد التطبيق لفتح ملف): الصفحة تُفتح من الجهاز فورًا، والتحديث يُجلب في الخلفية ويُعرض شريط «نسخة أحدث جاهزة»
// كان حتى V59 «الشبكة أولًا»: كل فتح ينتظر تنزيل الصفحة (نحو 1.35 ميغابايت مضغوطة) أو انقطاع الاتصال قبل الظهور.
const CACHE = 'amali-v83';
const CORE = ['./', './index.html', './manifest.json', './icon-180.png'];
const FONTS_FILES = ['plex','naskh','cairo','tajawal','almarai','amiri','kufi','readex','markazi'].flatMap(f => ['./fonts/' + f + '-400.woff2', './fonts/' + f + '-700.woff2']).concat(['./fonts/plex-600.woff2', './fonts/kufi-600.woff2', './fonts/readex-600.woff2']);
const FLAG = './__amali_update';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.concat(FONTS_FILES)).catch(() => {}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
  if (url.pathname.includes('/docs/')) return; // V83: الدليل والفيديو من الشبكة مباشرة (Safari يحتاج طلبات المدى للفيديو)
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
