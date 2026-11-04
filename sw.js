/* Dog Verb shell cache. Icons live on *-db.png paths so installers cannot reuse Logo C. */
const CACHE = 'dog-verb-shell-v17';
const SHELL = [
  './index.html',
  './style.css?v=17',
  './app.js?v=17',
  './core.js?v=17',
  './data/books-index.js?v=17',
  './vendor/ts-fsrs.umd.js',
  './assets/dog-mascot.png?v=15',
  './assets/paw.svg?v=15',
  './assets/icons/apple-touch-icon-180-db.png',
  './assets/icons/favicon-48-db.png',
  './assets/icons/icon-192-db.png',
  './assets/icons/icon-512-db.png',
  './assets/icons/icon-maskable-192-db.png',
  './assets/icons/icon-maskable-512-db.png',
  './manifest.webmanifest?v=17'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.indexOf('/assets/icons/') !== -1 && url.pathname.indexOf('-db.png') === -1) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).catch(() => {
    if (event.request.mode === 'navigate') return caches.match('./index.html');
  })));
});
