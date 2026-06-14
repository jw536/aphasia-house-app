/* ============================================================
   My House — local storage layer (IndexedDB)
   Everything (including photos) is stored on the device itself.
   ============================================================ */

const DB = (() => {
  const DB_NAME = "my-house";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("rooms")) {
          db.createObjectStore("rooms", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("items")) {
          const items = db.createObjectStore("items", { keyPath: "id" });
          items.createIndex("byRoom", "roomId");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function tx(storeName, mode, fn) {
    const db = await open();
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = await fn(store);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function newId() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }

  return {
    newId,

    async getRooms() {
      const rooms = await tx("rooms", "readonly", s => promisify(s.getAll()));
      return rooms.sort(byOrder);
    },

    async getRoom(id) {
      return tx("rooms", "readonly", s => promisify(s.get(id)));
    },

    async putRoom(room) {
      return tx("rooms", "readwrite", s => promisify(s.put(room)));
    },

    async deleteRoom(id) {
      const items = await this.getItems(id);
      await tx("items", "readwrite", s => {
        items.forEach(it => s.delete(it.id));
        return Promise.resolve();
      });
      return tx("rooms", "readwrite", s => promisify(s.delete(id)));
    },

    async getItems(roomId) {
      const items = await tx("items", "readonly",
        s => promisify(s.index("byRoom").getAll(roomId)));
      return items.sort(byOrder);
    },

    async putItem(item) {
      return tx("items", "readwrite", s => promisify(s.put(item)));
    },

    async deleteItem(id) {
      return tx("items", "readwrite", s => promisify(s.delete(id)));
    },

    async getSetting(key) {
      const row = await tx("settings", "readonly", s => promisify(s.get(key)));
      return row ? row.value : undefined;
    },

    async setSetting(key, value) {
      return tx("settings", "readwrite", s => promisify(s.put({ key, value })));
    },
  };
})();
