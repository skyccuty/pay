/* sw.js — 앱 파일을 기기에 보관해 오프라인에서도 열리게 한다. 급여 데이터는 여기서 다루지 않는다. */
const VERSION = 'payslip-ledger-v1.3.0';
const ASSETS = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/extractors.js', './js/parser.js', './js/data.js', './js/ui-common.js',
  './js/editor.js', './js/views.js', './js/app.js',
  './lib/pdf.min.js', './lib/pdf.worker.min.js', './lib/xlsx.full.min.js', './lib/chart.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
