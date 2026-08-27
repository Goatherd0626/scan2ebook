/* IndexedDB 书库：电子书本体（含 PDF blob）+ 元数据 + 文件夹。 */
const DB_NAME = 'scan2ebook-reader';
const DB_VER = 2;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('annotations')) {
        const annotations = db.createObjectStore('annotations', { keyPath: 'storageKey' });
        annotations.createIndex('bookId', 'bookId', { unique: false });
      }
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
export function deleteBooks(db, ids) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['books', 'annotations'], 'readwrite');
    const books = transaction.objectStore('books');
    const annotations = transaction.objectStore('annotations').index('bookId');
    ids.forEach((id) => {
      books.delete(id);
      const request = annotations.openCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
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

export function getAnnotations(db, bookId) {
  return tx(db, 'annotations', 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.index('bookId').getAll(IDBKeyRange.only(bookId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export function replaceAnnotations(db, bookId, records) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('annotations', 'readwrite');
    const store = transaction.objectStore('annotations');
    const request = store.index('bookId').openCursor(IDBKeyRange.only(bookId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      records.forEach((record) => store.put({
        ...record,
        bookId,
        storageKey: bookId + ':' + record.id,
      }));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function deleteAnnotations(db, bookId) {
  return replaceAnnotations(db, bookId, []);
}

export function updateBookAndAnnotations(db, book, records) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['books', 'annotations'], 'readwrite');
    transaction.objectStore('books').put(book);
    const store = transaction.objectStore('annotations');
    const request = store.index('bookId').openCursor(IDBKeyRange.only(book.id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      records.forEach((record) => store.put({
        ...record,
        bookId: book.id,
        storageKey: book.id + ':' + record.id,
      }));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
