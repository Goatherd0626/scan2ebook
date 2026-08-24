/* IndexedDB 书库：电子书本体（含 PDF blob）+ 元数据 + 文件夹。 */
const DB_NAME = 'scan2ebook-reader';
const DB_VER = 1;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function getAll(db, store) {
  return tx(db, store, 'readonly', (s) => new Promise((res, rej) => {
    const r = s.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}

export async function getBooks(db) { return getAll(db, 'books'); }
export async function getFolders(db) { return getAll(db, 'folders'); }
export function addBook(db, book) { return tx(db, 'books', 'readwrite', (s) => s.put(book)); }
export function updateBook(db, book) { return tx(db, 'books', 'readwrite', (s) => s.put(book)); }
export function deleteBooks(db, ids) { return tx(db, 'books', 'readwrite', (s) => ids.forEach((id) => s.delete(id))); }
export function addFolder(db, folder) { return tx(db, 'folders', 'readwrite', (s) => s.put(folder)); }
export function deleteFolder(db, id) { return tx(db, 'folders', 'readwrite', (s) => s.delete(id)); }

export function moveBooks(db, ids, folderId) {
  return tx(db, 'books', 'readwrite', (s) => {
    ids.forEach((id) => {
      const r = s.get(id);
      r.onsuccess = () => { if (r.result) { r.result.folderId = folderId; s.put(r.result); } };
    });
  });
}
