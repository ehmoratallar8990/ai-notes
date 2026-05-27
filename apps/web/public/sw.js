self.addEventListener('install', event => { event.waitUntil(caches.open('ai-notes-v1').then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']))); });
self.addEventListener('fetch', event => { if (event.request.method === 'GET') event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request))); });
