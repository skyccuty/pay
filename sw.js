/* sw.js — 앱 파일을 기기에 보관해 오프라인에서도 열리게 한다. 급여 데이터는 여기서 다루지 않는다.
 * 화면·기능 파일(html/js/css/json)은 "네트워크 우선"으로 가져와, 새 버전을 올리면 바로 반영된다.
 * 용량이 큰 라이브러리와 아이콘은 "캐시 우선"으로 빠르게 연다. */
const VERSION = 'payslip-ledger-v1.4.2';
const SHELL = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/extractors.js', './js/parser.js', './js/data.js', './js/ui-common.js',
  './js/editor.js', './js/views.js', './js/app.js',
];
const STATIC = [
  './lib/pdf.min.js', './lib/pdf.worker.min.js', './lib/xlsx.full.min.js', './lib/chart.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // 파일 하나가 없어도 설치가 실패하지 않도록 개별로 담는다
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await Promise.all(SHELL.concat(STATIC).map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  }));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

const isShell = (url) => /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/');
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/lib/') || url.pathname.includes('/icons/')) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (!isShell(url)) return;
  // 브라우저의 HTTP 캐시(GitHub Pages는 10분)를 거치지 않고 서버에 최신 여부를 확인한다.
  // 바뀌지 않았으면 서버가 '변경 없음(304)'만 돌려주므로 데이터 사용량은 거의 없다.
  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
