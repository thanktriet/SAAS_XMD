// Service Worker for XMD Mobile PWA

// Install: activate immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: claim all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch: pass-through (caching strategies can be added later)
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'XMD Sales', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { url: data.url || '/m/' },
        tag: data.tag,
      })
    );
  } catch (e) {
    // ignore malformed push data
  }
});

// Notification click → open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || '/m/')
  );
});
