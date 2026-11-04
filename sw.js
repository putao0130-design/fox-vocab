/* Dog Verb shell cache. Placeholder icons only; official art comes later. */
const CACHE = 'dog-verb-shell-v13';
const SHELL = [
  './index.html',
  './style.css?v=13',
  './app.js?v=13',
  './core.js?v=13',
  './data/books-index.js?v=13',
  './vendor/ts-fsrs.umd.js',
  './assets/dog-mascot.png?v=10',
  './assets/paw.svg?v=11',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).catch(() => {
    if (event.request.mode === 'navigate') return caches.match('./index.html');
  })));
});
