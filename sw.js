/* Dog Verb shell cache. Install identity stays app-v18. Shell query is v=20 for cloze translations plus the check-in share card. */
const CACHE = 'dog-verb-shell-v20';
const SHELL = [
  './index.html',
  './style.css?v=20',
  './app.js?v=20',
  './core.js?v=20',
  './data/books-index.js?v=18',
  './data/example-zh.js?v=20',
  './vendor/ts-fsrs.umd.js',
  './assets/dog-mascot.png?v=15',
  './assets/dog-mascot-transparent.png',
  './assets/paw.svg?v=15',
  './assets/paw-check-128.png',
  './assets/icons/logo-doubao-2048.png',
  './assets/icons/install-v18/apple-180.png?v=18',
  './assets/icons/install-v18/favicon-48.png?v=18',
  './assets/icons/install-v18/icon-192.png?v=18',
  './assets/icons/install-v18/icon-512.png?v=18',
  './assets/icons/install-v18/maskable-192.png?v=18',
  './assets/icons/install-v18/maskable-512.png?v=18',
  './manifest.webmanifest?v=18'
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
  if (url.pathname.indexOf('/assets/icons/') !== -1 && url.pathname.indexOf('/install-v18/') === -1) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).catch(() => {
    if (event.request.mode === 'navigate') return caches.match('./index.html');
  })));
});
