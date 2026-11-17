// Registro del Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(function (registro) {
      console.log('[App] Service Worker registrado:', registro.scope);
    })
    .catch(function (error) {
      console.error('[App] Error al registrar Service Worker:', error);
    });

  // Escuchar mensajes provenientes del Service Worker
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmacion recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// Bandera de soporte real de Background Sync (puede estar deshabilitado en tiempo de ejecucion)
var syncHabilitado = ('SyncManager' in window);

function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  if (!badge) return;
  if (navigator.onLine) {
    badge.textContent = 'En Linea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin conexion';
    badge.className = 'badge offline';
  }
}

function renderizarColaOutbox() {
  const lista = document.getElementById('lista-outbox');
  if (!lista) return Promise.resolve();

  return obtenerTodosLosRegistros()
    .then(function (registros) {
      if (!registros || registros.length === 0) {
        lista.innerHTML = '<li class="vacio">No hay registros en la bandeja</li>';
        return;
      }

      lista.innerHTML = registros.map(function (item) {
        var titulo = item.titulo || item.title || '(sin titulo)';
        var estado = item.estado || 'pendiente';
        return '<li class="item-outbox">' +
          '<span class="item-titulo">' + titulo + '</span>' +
          '<span class="item-estado estado-' + estado + '">' + estado + '</span>' +
          '</li>';
      }).join('');
    })
    .catch(function (error) {
      console.error('[UI] Error al renderizar la cola:', error);
      lista.innerHTML = '<li class="error">Error al cargar la bandeja</li>';
    });
}

function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then(function (respuesta) {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(function () {
      // Envio exitoso en vivo: registrar en bitacora local como sincronizado
      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(function () {
      console.warn('[Outbox] Sin conexion. Encolando en IndexedDB...');

      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(function () {
          // Deteccion de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then(function (registro) {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .then(function () {
                syncHabilitado = true;
              })
              .catch(function (error) {
                console.warn('[Outbox] No se pudo registrar Background Sync. Se usara fallback online.', error);
                syncHabilitado = false;
              });
          }
        });
    })
    .then(function () {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}

function sincronizarPendientes() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then(function (registros) {
      const pendientes = registros.filter(function (item) {
        return item.estado === 'pendiente';
      });

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Convertir cada registro pendiente en una promesa de envio + actualizacion
      const promesasDeEnvio = pendientes.map(function (item) {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Falla al reintentar envio');
            // Actualizar estado en IndexedDB de 'pendiente' a 'sincronizado'
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperar a que todos los reenvios concluyan
      return Promise.all(promesasDeEnvio);
    })
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('[Outbox] Error durante la sincronizacion masiva:', error);
    });
}

// Alias de compatibilidad para navegadores sin SyncManager
function sincronizarPendientesFallback() {
  return sincronizarPendientes();
}

// Escuchar el regreso de la conectividad
window.addEventListener('online', function () {
  actualizarIndicadorRed();
  // Degradacion elegante: sincronizar desde UI si no hay soporte real de Background Sync
  if (!('SyncManager' in window) || !syncHabilitado) {
    console.log('[Outbox] Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// Cableado del formulario
const formIncidencia = document.getElementById('form-incidencia');
if (formIncidencia) {
  formIncidencia.addEventListener('submit', function (event) {
    event.preventDefault();
    const datos = {
      titulo: document.getElementById('titulo').value,
      descripcion: document.getElementById('descripcion').value
    };

    procesarEnvioReporte(datos)
      .then(function () {
        formIncidencia.reset();
      })
      .catch(function (error) {
        console.error('[App] Error al procesar el reporte:', error);
      });
  });
}

// Cableado del boton de purga
const btnPurgar = document.getElementById('btn-purgar');
if (btnPurgar) {
  btnPurgar.addEventListener('click', function () {
    obtenerTodosLosRegistros()
      .then(function (registros) {
        const sincronizados = (registros || []).filter(function (item) {
          return item.estado === 'sincronizado';
        });

        if (sincronizados.length === 0) {
          return renderizarColaOutbox();
        }

        const promesasBorrado = sincronizados.map(function (item) {
          return eliminarRegistro(item.id);
        });

        return Promise.all(promesasBorrado);
      })
      .then(function () {
        return renderizarColaOutbox();
      })
      .catch(function (error) {
        console.error('[App] Error al purgar registros:', error);
      });
  });
}

// Inicializacion al cargar la pagina
actualizarIndicadorRed();
renderizarColaOutbox();

// Sincronizacion inicial
if (navigator.onLine) {
  if (!('SyncManager' in window) || !syncHabilitado) {
    sincronizarPendientesFallback();
  } else if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(function (registro) {
        return registro.sync.register('sync-reportes');
      })
      .then(function () {
        syncHabilitado = true;
      })
      .catch(function (error) {
        console.warn('[Outbox] Registro de sync inicial fallido. Usando fallback.', error);
        syncHabilitado = false;
        sincronizarPendientesFallback();
      });
  }
}