// Bódorgó's service worker - only for push notifications (no offline
// caching). The server sends { title, body, tag, url, silent, renotify }
// (see server/src/utils/push.js); notifications with the same tag replace
// each other, so a busy chat stays one notification.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bódorgó', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag && !!data.renotify,
      silent: !!data.silent,
      icon: '/assets/icons/app/android-chrome-192x192.png',
      badge: '/assets/icons/app/android-chrome-192x192.png',
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping it opens (or focuses) the site on the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = windows.find((w) => w.url === url);
      if (same) return same.focus();
      const any = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (any) {
        await any.focus();
        return any.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
