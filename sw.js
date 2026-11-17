// Importar el mini-wrapper de IndexedDB en el contexto del Service Worker
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v3';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json'
];

function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

function sincronizarPendientesSW() {
  console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then(function (registros) {
      const pendientes = (registros || []).filter(function (item) {
        return item.estado === 'pendiente';
      });

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map(function (item) {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then(function (respuesta) {
            if (!respuesta.ok) {
              throw new Error('Error HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(function () {
          return notificarClientesActualizacion();
        });
    });
}

self.addEventListener('install', function (event) {
  console.log('[SW] Instalado');
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME).then(function (cache) {
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_STATIC_NAME) {
            console.log('[SW] Purgando cache obsoleto:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (response) {
      if (response) return response;
      return fetch(event.request).then(function (networkResponse) {
        return caches.open(CACHE_STATIC_NAME).then(function (cache) {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(function () {
        return new Response('Sin conexion', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

self.addEventListener('sync', function (event) {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW()
        .catch(function (error) {
          console.error('[SW-Sync] Falla en sincronizacion; el navegador reintentara luego:', error);
          throw error;
        })
    );
  }
});