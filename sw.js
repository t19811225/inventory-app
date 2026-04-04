const CACHE_NAME = 'inventory-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/app.js',
  './js/firebase-sync.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Firebase 和外部 CDN 不走快取
  if (e.request.url.includes('firebase') || e.request.url.includes('gstatic') || e.request.url.includes('googleapis')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
