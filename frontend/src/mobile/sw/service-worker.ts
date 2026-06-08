/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

// Install: activate immediately
sw.addEventListener('install', () => {
  sw.skipWaiting();
});

// Activate: claim all clients
sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

// Fetch: pass-through for now (Phase 3 will add caching strategies)
sw.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Push notification handler (Phase 4 will enhance)
sw.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      sw.registration.showNotification(data.title || 'XMD Sales', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { url: data.url || '/m/' },
        tag: data.tag,
      })
    );
  } catch {
    // ignore malformed push data
  }
});

// Notification click → open app
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    sw.clients.openWindow(event.notification.data?.url || '/m/')
  );
});

export {};
