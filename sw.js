/* Cartera GPV: paquete offline completo y coherente por versión.
 * No se activa una versión si falta un recurso imprescindible.
 * Cache-first evita esperas de red y mezclar HTML/CSS de versiones distintas.
 */

const VERSION = 'v4.6.12';
const CACHE_STATIC = `cartera-gpv-static-${VERSION}`;

const APP_FILE = './index.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  `./assets/utilities.css?v=${VERSION}`,
  `./assets/app.css?v=${VERSION}`,
  './assets/vendor/xlsx.full.min.js',
  './assets/fonts/public-sans-variable.ttf',
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
      try {
        await cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })));
        // Un despliegue parcial o una caché intermedia no deben mezclar versiones.
        const html = await (await cache.match(APP_FILE)).text();
        const css = await (await cache.match(`./assets/app.css?v=${VERSION}`)).text();
        if (!html.includes(`<meta name="app-version" content="${VERSION}">`) ||
            !html.includes(`./assets/app.css?v=${VERSION}`) ||
            !html.includes(`./assets/utilities.css?v=${VERSION}`) ||
            !css.includes(`/* cartera-gpv-style:${VERSION} */`)) {
          throw new Error('HTML y CSS deben pertenecer a la misma versión que el service worker');
        }
      } catch (error) {
        await caches.delete(CACHE_STATIC);
        throw error;
      }
      // Las actualizaciones esperan confirmación para no interrumpir una visita.
      if (!self.registration.active) await self.skipWaiting();
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
          .filter((k) => k.startsWith('cartera-gpv-') && k !== CACHE_STATIC)
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

  // No se interceptan otros orígenes. La aplicación no necesita ninguno.
  if (!isSameOrigin(url)) return;

  // 1) Navegaciones: abrir inmediatamente la versión instalada.
  if (isNavigation(request)) {
    event.respondWith(
      (async () => {
        const installed = await caches.open(CACHE_STATIC);
        const shell = await installed.match(APP_FILE);
        if (shell) return shell;
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

  // 2) Recursos locales: misma versión que el documento instalado.
  if (isSameOrigin(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_STATIC);
        const cached = await cache.match(request);
        if (cached) {
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
  if (data.type === 'CHECK_OFFLINE' && event.source) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_STATIC);
      const resources = await Promise.all(PRECACHE_URLS.map(url => cache.match(url)));
      event.source.postMessage({ type: 'OFFLINE_STATUS', ready: resources.every(Boolean), version: VERSION });
    })());
  }
});
