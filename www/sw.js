// Self-destructing Service Worker
// Clears all caches and unregisters itself
// This ensures any previously cached version gets cleaned up

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', async (event) => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => {
      console.log('🔥 SW: All caches cleared');
      return self.registration.unregister();
    }).then(() => {
      console.log('🔥 SW: Unregistered successfully');
      return self.clients.claim();
    })
  );
});

// Pass-through: no caching
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
