// Keeps the app shell available offline. API calls always go to the network.
const CACHE = 'deckarr-v1.5.0';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/ui.js',
  'js/install.js',
  'js/notifications.js',
  'js/services.js',
  'js/views/home.js',
  'js/views/library.js',
  'js/views/activity.js',
  'js/views/server.js',
  'js/views/settings.js',
  'js/views/unraid.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  // Network first so updates show up immediately; cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html'))),
  );
});

// ---------- push notifications (Unraid alerts) ----------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.server ? `${data.server}: ${data.title || 'Unraid'}` : data.title || 'Deckarr';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      icon: 'icons/icon-192.png',
      data: { url: data.url || './' },
    }),
  );
});

// Tapping a notification opens Deckarr on the right page, reusing an open window when there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        return open.navigate(url).catch(() => open);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
