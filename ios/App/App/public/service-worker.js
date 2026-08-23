// Service Worker for Alpha Private School Portal
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through fetch for static assets
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
