const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

function abrirDB() {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function (event) {
      reject(event.target.error);
    };
  });
}

function guardarRegistro(datos) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const req = store.add(datos);
      let idGenerado;

      req.onsuccess = function (event) {
        idGenerado = event.target.result;
      };

      req.onerror = function (event) {
        reject(event.target.error);
      };

      tx.oncomplete = function () {
        resolve(idGenerado);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}

function obtenerTodosLosRegistros() {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = function (event) {
        resolve(event.target.result);
      };

      req.onerror = function (event) {
        reject(event.target.error);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}

function eliminarRegistro(id) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = function () {
        resolve(true);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}

function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const reqGet = store.get(id);

      reqGet.onsuccess = function (event) {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error('No se encontro el registro con ID: ' + id));
          return;
        }

        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      reqGet.onerror = function (event) {
        reject(event.target.error);
      };

      tx.oncomplete = function () {
        resolve(true);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}