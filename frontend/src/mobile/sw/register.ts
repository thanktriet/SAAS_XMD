// Register service worker cho mobile PWA
export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/m/',
        });
        console.log('[SW] Registered:', registration.scope);
      } catch (err) {
        console.warn('[SW] Registration failed:', err);
      }
    });
  }
}
