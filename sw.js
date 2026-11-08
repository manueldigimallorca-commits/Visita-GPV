/* Cartera GPV · Service Worker
 * Estrategia:
 *  - Navegaciones (documentos HTML): network-first con fallback a caché.
 *    Así las actualizaciones llegan en cuanto hay cobertura, pero la app
 *    sigue abriendo sin conexión.
 *  - Mismo origen (CSS/JS/iconos/manifest): cache-first + refresco en segundo plano.
 *  - Terceros (Tailwind, Fonts, SheetJS): stale-while-revalidate, con timeout
 *    para no bloquear la carga si no hay red.
 */

const VERSION = 'v4.4.1';
const CACHE_STATIC = `cartera-gpv-static-${VERSION}`;
const CACHE_RUNTIME = `cartera-gpv-runtime-${VERSION}`;

const APP_FILE = './index.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// ---- Instalación: precarga de lo imprescindible ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      // addAll falla si un solo recurso falla; los añadimos uno a uno.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res && res.ok) await cache.put(url, res);
          } catch (err) {
            // Un recurso opcional no debe romper la instalación.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

// ---- Activación: limpiar versiones antiguas ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ---- Utilidades ----
function isNavigation(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isSameOrigin(url) {
  return new URL(url, self.location.origin).origin === self.location.origin;
}

// Red con límite de tiempo; si tarda demasiado, seguimos con caché.
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ---- Fetch ----
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET; el resto va directo a la red.
  if (request.method !== 'GET') return;

  const url = request.url;

  // 1) Navegaciones: network-first, fallback a la app cacheada.
  if (isNavigation(request)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetchWithTimeout(request, 4500);
          // Solo aceptamos respuestas buenas. Un 5xx (servidor caído, proxy, etc.)
          // NO debe sustituir la copia cacheada ni mostrarse en blanco.
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cache.put(request, fresh.clone()).catch(() => {});
            return fresh;
          }
        } catch (err) {
          // Sin red: caemos al caché de abajo.
        }

        {
          const cache = await caches.open(CACHE_STATIC);
          const cached =
            (await cache.match(request)) ||
            (await cache.match(APP_FILE));
          return (
            cached ||
            new Response(
              '<!DOCTYPE html><meta charset="utf-8"><title>Sin conexión</title>' +
                '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
                '<h1>Sin conexión</h1><p>Abre la app una vez con internet para poder usarla offline.</p></body>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
            )
          );
        }
      })()
    );
    return;
  }

  // 2) Mismo origen: cache-first + actualización en segundo plano.
  if (isSameOrigin(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_STATIC);
        const cached = await cache.match(request);
        if (cached) {
          // Revalidación silenciosa
          fetch(request)
            .then((res) => {
              if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
            })
            .catch(() => {});
          return cached;
        }
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) {
            cache.put(request, fresh.clone()).catch(() => {});
            return fresh;
          }
          return cached || fresh || new Response('', { status: 504, statusText: 'Offline' });
        } catch (err) {
          return cached || new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // 3) Terceros: stale-while-revalidate con timeout.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_RUNTIME);
      const cached = await cache.match(request);

      const network = fetchWithTimeout(request, 6000)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(request, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      if (cached) return cached;
      const fresh = await network;
      return fresh || new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});

// ---- Mensajes desde la app ----
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});
