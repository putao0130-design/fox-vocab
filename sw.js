/* Dog Verb shell cache. Placeholder icons only; official art comes later. */
const CACHE = 'dog-verb-shell-v12';
const SHELL = [
  './index.html',
  './style.css?v=12',
  './app.js?v=12',
  './core.js?v=12',
  './data/books-index.js?v=12',
  './vendor/ts-fsrs.umd.js',
  './assets/dog-mascot.png?v=10',
  './assets/paw.svg?v=11',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
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
