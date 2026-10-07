// 서비스워커: 오프라인에서도 마지막 데이터 표시 + 앱 설치(PWA) 지원
// __VERSION__ 은 빌드 시 웹 자산 내용 해시로 치환됨 (자산이 바뀔 때만 캐시 교체)
const CACHE = 'hot-issues-__VERSION__';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패 시 캐시 (뉴스는 항상 최신이 중요)
async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res.ok) cache.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data.json')) {
    // ?t= 캐시버스터는 무시하고 하나의 키로 저장
    event.respondWith(networkFirst(req, new URL('data.json', self.registration.scope).href));
  } else if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, new URL('index.html', self.registration.scope).href));
  } else {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => 'focus' in c);
      return client ? client.focus() : self.clients.openWindow(self.registration.scope);
    })
  );
});
