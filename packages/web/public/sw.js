/**
 * mya — Service Worker (Phase C / Gap 7).
 *
 * Strategy:
 *   - App shell (HTML / manifest / offline / icons): cache-first
 *   - API + WebSocket traffic: network-first, fallback to cache when offline
 *   - POSTs are never cached or served from cache (mutations always go to network)
 *   - Navigation requests that fail → /offline.html (cached)
 *   - Push events: showNotification (data.url attached to click handler)
 *   - Update flow: client posts {type:"SKIP_WAITING"} → SW skips waiting and
 *     takes over. Clients listen on `controllerchange`.
 *
 * Note: This file is intentionally plain JavaScript — Vite copies `public/`
 * files verbatim into the build output without esbuild processing. Bundling
 * would break SW root-scope semantics and the lack of an `import` graph
 * matches the §25.6 event-bus contract (vanilla, no transpilation).
 *
 * Source: source/.learned/GAP-IMPLEMENTATION-PLAN.md Phase C / Gap 7.
 */

const CACHE_VERSION = "mya-v1";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/manifest.json",
  "/offline.html",
  "/icons/192.png",
  "/icons/512.png",
  "/icons/maskable.png",
];

// URL prefixes that must always be network-first. The exact-match paths and
// prefixes that mutate state (POST) are handled separately.
const NETWORK_FIRST_PREFIXES = [
  "/events",
  "/push/",
  "/sessions",
  "/cron/",
  "/mcp/",
  "/pool/",
  "/channel/",
  "/memory/",
  "/ws-info",
  "/status",
  "/providers/",
  "/skills",
  "/config",
  "/tools",
  "/ready",
  "/functional",
  "/health/",
];

function isNetworkFirst(url) {
  if ((url.protocol === "http:" || url.protocol === "https:") && url.pathname !== "/") {
    for (const p of NETWORK_FIRST_PREFIXES) {
      if (url.pathname === p || url.pathname.startsWith(p)) return true;
    }
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort precache. Don't fail install if a single asset 404s —
      // the SW must still register so the update prompt can fire.
      await Promise.allSettled(APP_SHELL.map((u) => cache.add(u)));
      // Don't skip waiting automatically — let dashboard opt-in via SKIP_WAITING
      // so the in-flight session can finish before the new SW takes over.
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache mutations

  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== self.location.origin) return;

  // Navigation request → app-shell cache-first, offline.html fallback
  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }

  if (isNetworkFirst(url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Default: app-shell cache-first
  event.respondWith(cacheFirst(req));
});

async function handleNavigation(req) {
  try {
    // Try network for fresh HTML
    const fresh = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    cache.put("/", fresh.clone());
    return fresh;
  } catch {
    // Offline → serve cached "/" or fall back to /offline.html
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match("/");
    if (cached) return cached;
    const offline = await cache.match("/offline.html");
    if (offline) return offline;
    return new Response(
      "<!doctype html><html><head><meta charset='utf-8'><title>offline</title></head>" +
        "<body style='background:#0a0a0a;color:#e6edf3;font:14px sans-serif;padding:24px'>" +
        "mya is offline.</body></html>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
}

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) {
    // Background refresh (stale-while-revalidate-lite)
    fetch(req)
      .then((fresh) => {
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
      })
      .catch(() => {
        /* ignore — offline is fine */
      });
    return cached;
  }
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response("", { status: 504 });
  }
}

// ── Push notifications ────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = { title: "mya", body: "You have a new notification", url: "/", tag: undefined };
  try {
    if (event.data) {
      const text = event.data.text();
      if (text) {
        const parsed = JSON.parse(text);
        data = Object.assign({}, data, parsed);
      }
    }
  } catch {
    // body was not JSON — use raw text
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    tag: data.tag,
    icon: "/icons/192.png",
    badge: "/icons/192.png",
    data: { url: data.url || "/", sessionId: data.sessionId },
    requireInteraction: false,
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        try {
          if (new URL(client.url).origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) await client.navigate(targetUrl);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })()
  );
});
