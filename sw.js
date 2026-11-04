/* Dog Verb shell cache. Icon URLs are pinned to ?v=16 so older icon bytes are not reused. */
const CACHE = 'dog-verb-shell-v16';
const SHELL = [
  './index.html',
  './style.css?v=16',
  './app.js?v=16',
  './core.js?v=16',
  './data/books-index.js?v=16',
  './vendor/ts-fsrs.umd.js',
  './assets/dog-mascot.png?v=15',
  './assets/paw.svg?v=15',
  './assets/icons/apple-touch-icon-180.png?v=16',
  './assets/icons/favicon-48.png?v=16',
  './assets/icons/icon-192.png?v=16',
  './assets/icons/icon-512.png?v=16',
  './assets/icons/icon-maskable-192.png?v=16',
  './assets/icons/icon-maskable-512.png?v=16',
  './manifest.webmanifest?v=16'
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
  if (url.pathname.indexOf('/assets/icons/') !== -1 && url.search.indexOf('v=16') === -1) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).catch(() => {
    if (event.request.mode === 'navigate') return caches.match('./index.html');
  })));
});
