/* sw.js — cache offline + ação de notificação "Concluir" + recebimento de push */
const CACHE = 'organizador-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './push.js',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia:
//  - navegação/HTML: network-first (garante que atualizações chegam), cai pro cache offline.
//  - demais assets locais: stale-while-revalidate (rápido e se atualiza sozinho).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ---- IndexedDB (mesma base do app) ----
function idbGet() {
  return new Promise((resolve) => {
    const req = indexedDB.open('organizador-semanal', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get('state');
      g.onsuccess = () => resolve({ db, state: g.result || null });
      g.onerror = () => resolve({ db, state: null });
    };
    req.onerror = () => resolve({ db: null, state: null });
  });
}
function idbPut(db, state) {
  return new Promise((resolve) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(state, 'state');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function markDone(date, itemId) {
  const { db, state } = await idbGet();
  if (!db || !state || !state.days || !state.days[date]) return;
  const day = state.days[date];
  let changed = false;
  for (const per of ['morning', 'afternoon', 'night']) {
    const it = (day[per] || []).find((x) => x.id === itemId);
    if (it) { it.done = true; changed = true; break; }
  }
  if (changed) await idbPut(db, state);
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clientsList.forEach((c) => c.postMessage({ type: 'item-done', date, itemId }));
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  n.close();
  if (e.action === 'done' && n.data && n.data.itemId) {
    e.waitUntil(markDone(n.data.date, n.data.itemId));
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

// push real (fase backend): payload = { title, body, tag, data, actions }
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Lembrete', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Organizador Semanal';
  const opts = {
    body: data.body || '',
    tag: data.tag || 'push',
    data: data.data || {},
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    actions: data.actions || [],
    renotify: !!data.tag,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});
