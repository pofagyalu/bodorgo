// Bódorgó's service worker: push notifications, and the app without a
// connection.
//
// Push: the server sends { title, body, tag, url, silent, renotify } (see
// server/src/utils/push.js); notifications with the same tag replace each
// other, so a busy chat stays one notification.
//
// Without a connection, three things make the app open and show what it
// last knew:
//  - the app itself (its page, scripts, styles, fonts, icons) is kept on
//    the device, a whole build at a time - SHELL below;
//  - what the server answered to the app's questions (the tours, the
//    games, who is logged in...) is kept too, and given again when the
//    server can't be reached - the API cache below. Reading only: nothing
//    is sent later on the user's behalf;
//  - the songbook is the app's own business: it keeps every song in
//    IndexedDB (src/app/services/song-store.ts), so its answers aren't
//    kept here.
// Pictures and videos from the server are not kept.

// The build's files and a name for that state of them - written above this
// line by sw-files.js after `ng build`. Without it (ng serve) there is
// nothing to keep: only the notifications work, as before.
const SHELL = self.__SHELL ?? { version: '', files: [] };
const OFFLINE = SHELL.files.length > 0;

const SHELL_PREFIX = 'bodorgo-shell-';
const SHELL_CACHE = `${SHELL_PREFIX}${SHELL.version}`;
const SHELL_FILES = new Set(SHELL.files);
const API_CACHE = 'bodorgo-api-v1';

// A file with a code of its content in its name (main-GMG3L7X6.js): the
// same name is the same file, in whichever build.
const HASHED = /-[A-Z0-9]{8}\.[a-z0-9]+$/;
// How long a page's own address may take to answer before the kept page is
// shown instead.
const PAGE_WAIT_MS = 4000;
// The most answers kept; the oldest go first.
const API_KEEP = 400;
// Answers not kept: the live connection's, and the songbook's (see above).
const API_SKIP = /\/socket\.io\/|\/songs(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // All of the build or none: a half-kept app would open without one of
      // its pages. If a file fails, this worker isn't installed and the one
      // before stays - the browser tries again at the next visit.
      if (OFFLINE) await keepShell();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (OFFLINE) {
        for (const name of await caches.keys()) {
          if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

// The build's files into this build's own cache - a file the build before
// already had under the same name is taken over, not downloaded again.
async function keepShell() {
  const cache = await caches.open(SHELL_CACHE);
  const earlier = (await caches.keys()).filter(
    (name) => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE,
  );
  const todo = [...SHELL.files];
  const one = async (url) => {
    if (await cache.match(url, { ignoreVary: true })) return;
    if (HASHED.test(url)) {
      for (const name of earlier) {
        const had = await caches.match(url, { cacheName: name, ignoreVary: true });
        if (had) return cache.put(url, had);
      }
    }
    // A file under its own name (index.html, an icon) is asked for afresh.
    const res = await fetch(url, { cache: HASHED.test(url) ? 'default' : 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await cache.put(url, res);
  };
  // A few at a time.
  const worker = async () => {
    while (todo.length) await one(todo.pop());
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

self.addEventListener('fetch', (event) => {
  if (!OFFLINE) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      // A page of the app - not a file opened by its address.
      if (!/\.[a-z0-9]+$/i.test(url.pathname)) event.respondWith(page(request));
      return;
    }
    if (SHELL_FILES.has(url.pathname) && !url.search) {
      event.respondWith(shellFile(request, url.pathname));
      return;
    }
  }
  if (isApiRead(request, url)) event.respondWith(apiRead(event, url));
});

// A page: from the web server while it answers - so a newer build is there
// at once (src/app/services/version.ts reloads for it) -, the kept one
// when it doesn't. Every address is the same page: the app shows the rest.
async function page(request) {
  const fresh = fetch(request);
  try {
    return await within(fresh, PAGE_WAIT_MS);
  } catch {
    fresh.catch(() => {});
    return (
      (await caches.match('/index.html', { cacheName: SHELL_CACHE, ignoreVary: true })) ?? fresh
    );
  }
}

// One of this build's files: the kept one. (Another build's page asking -
// just after a deploy - doesn't find its own files here, and they come
// from the web server: see the fetch listener.)
async function shellFile(request, path) {
  return (await caches.match(path, { cacheName: SHELL_CACHE, ignoreVary: true })) ?? fetch(request);
}

// A question of the app to the server: the ones it sends with the login
// cookie (auth-http-interceptor.ts) - nothing a page loads by itself (a
// picture, a video, a map tile).
function isApiRead(request, url) {
  return (
    request.destination === '' &&
    request.credentials === 'include' &&
    !request.headers.has('range') &&
    !API_SKIP.test(url.pathname)
  );
}

// The server's answer while there is one - and kept for when there isn't.
// Only when the server can't be reached at all: an answer that is an error
// is given as it is.
async function apiRead(event, url) {
  const { request } = event;
  try {
    const res = await fetch(request);
    if (res.status === 200 && (res.headers.get('content-type') ?? '').includes('json')) {
      event.waitUntil(keepAnswer(url, res.clone()));
    }
    return res;
  } catch (err) {
    const kept = await caches.match(request.url, { cacheName: API_CACHE, ignoreVary: true });
    if (kept) return kept;
    throw err;
  }
}

async function keepAnswer(url, res) {
  try {
    // Who is logged in: once it is nobody, or somebody else, what was kept
    // for the one before goes.
    const isMe = /\/auth\/me$/.test(url.pathname);
    if (isMe) {
      const now = await res.clone().json();
      const before = await caches.match(url.href, { cacheName: API_CACHE, ignoreVary: true });
      const was = before ? await before.json() : null;
      if (!now.loggedIn || (was?.loggedIn && was.id !== now.id)) await caches.delete(API_CACHE);
      if (!now.loggedIn) return;
    }
    const cache = await caches.open(API_CACHE);
    await cache.put(url.href, res);
    if (isMe) {
      const kept = await cache.keys();
      for (const old of kept.slice(0, Math.max(kept.length - API_KEEP, 0))) await cache.delete(old);
    }
  } catch {
    // Not kept (no room, an answer that can't be): the next one may be.
  }
}

function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
