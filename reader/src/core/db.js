/* 书库默认由本地 reader 服务持久化，不再按浏览器端口隔离。
   IndexedDB 仅作为旧版数据的一次性迁移源，以及无服务的单元测试 fallback。 */
const DB_NAME = 'scan2ebook-reader';
const DB_VER = 2;
const STORAGE_PATH = '/__scan2ebook__/storage';
const COMMAND_PATH = '/__scan2ebook__/storage/command';
const MIGRATION_KEY = 's2e-server-storage-migrated-v1';

function openLegacyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('books')) database.createObjectStore('books', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('folders')) database.createObjectStore('folders', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('annotations')) {
        const annotations = database.createObjectStore('annotations', { keyPath: 'storageKey' });
        annotations.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(database, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    const objectStore = transaction.objectStore(store);
    const out = fn(objectStore);
    transaction.oncomplete = () => resolve(out);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function legacyGetAll(database, store) {
  return tx(database, store, 'readonly', (objectStore) => new Promise((resolve, reject) => {
    const request = objectStore.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function isRemote(database) {
  return database?.kind === 'server';
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `存储服务返回 ${response.status}`);
  return body;
}

async function refresh(database) {
  database.snapshot = await requestJson(STORAGE_PATH);
  return database.snapshot;
}

async function command(payload) {
  return requestJson(COMMAND_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function serializableBook(book) {
  const copy = { ...book };
  delete copy.pdfBlob;
  delete copy.pdfUrl;
  return copy;
}

function isBlobLike(value) {
  return value && typeof value.arrayBuffer === 'function';
}

function remoteBooks(snapshot) {
  return (snapshot.books || []).map((book) => ({
    ...book,
    pdfUrl: `${STORAGE_PATH}/books/${encodeURIComponent(book.id)}/pdf`,
  }));
}

function legacyGetAnnotations(database, bookId) {
  return tx(database, 'annotations', 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.index('bookId').getAll(IDBKeyRange.only(bookId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function migrateLegacy(database) {
  if (typeof indexedDB === 'undefined') return;
  try { if (localStorage.getItem(MIGRATION_KEY) === '1') return; } catch {}

  let legacy;
  try {
    legacy = await openLegacyDB();
    const books = await legacyGetAll(legacy, 'books');
    const folders = await legacyGetAll(legacy, 'folders');
    const sharedBookIds = new Set((database.snapshot.books || []).map((book) => book.id));
    const sharedFolderIds = new Set((database.snapshot.folders || []).map((folder) => folder.id));
    for (const folder of folders) {
      if (!sharedFolderIds.has(folder.id)) await command({ action: 'putFolder', folder });
    }
    for (const book of books) {
      // 已进入统一书库的同 ID 数据更新，不用其他旧端口的副本覆盖。
      if (sharedBookIds.has(book.id)) {
        const sharedAnnotations = database.snapshot.annotations?.[book.id] || [];
        if (!sharedAnnotations.length) {
          const legacyAnnotations = await legacyGetAnnotations(legacy, book.id);
          if (legacyAnnotations.length) {
            await command({ action: 'replaceAnnotations', bookId: book.id, records: legacyAnnotations });
          }
        }
        continue;
      }
      if (isBlobLike(book.pdfBlob)) {
        const response = await fetch(`${STORAGE_PATH}/books/${encodeURIComponent(book.id)}/pdf`, {
          method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: book.pdfBlob,
        });
        if (!response.ok) throw new Error('旧版 PDF 迁移失败');
      }
      await command({ action: 'putBook', book: serializableBook(book) });
      const annotations = await legacyGetAnnotations(legacy, book.id);
      if (annotations.length) await command({ action: 'replaceAnnotations', bookId: book.id, records: annotations });
    }
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('s2e-') && key !== MIGRATION_KEY
            && !(key in (database.snapshot.preferences || {}))) {
          await command({ action: 'setPreference', key, value: localStorage.getItem(key) });
        }
      }
    } catch {}
    await refresh(database);
    try { localStorage.setItem(MIGRATION_KEY, '1'); } catch {}
  } catch (error) {
    console.warn('[scan2ebook] 旧版 IndexedDB 数据迁移未完成：', error);
  } finally {
    legacy?.close();
  }
}

export async function openDB() {
  // node:test/JSDOM 没有真实浏览器 fetch，直接使用测试用 IndexedDB fallback。
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    if (typeof indexedDB === 'undefined') throw new Error('当前环境没有可用的阅读器存储');
    return openLegacyDB();
  }
  try {
    const database = { kind: 'server', snapshot: await requestJson(STORAGE_PATH), close() {} };
    await migrateLegacy(database);
    return database;
  } catch (error) {
    if (typeof indexedDB === 'undefined') throw error;
    console.warn('[scan2ebook] 本地存储服务不可用，暂用 IndexedDB：', error);
    return openLegacyDB();
  }
}

export async function getBooks(database) {
  if (isRemote(database)) return remoteBooks(await refresh(database));
  return legacyGetAll(database, 'books');
}

export async function getFolders(database) {
  if (isRemote(database)) return (await refresh(database)).folders || [];
  return legacyGetAll(database, 'folders');
}

export async function getBookPdf(_database, book) {
  if (isBlobLike(book.pdfBlob)) return book.pdfBlob;
  if (!book.pdfUrl) throw new Error('电子书缺少 PDF 数据地址');
  const response = await fetch(book.pdfUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`无法读取 PDF：${response.status}`);
  return response.blob();
}

export async function addBook(database, book) {
  if (!isRemote(database)) return tx(database, 'books', 'readwrite', (store) => store.put(book));
  if (isBlobLike(book.pdfBlob)) {
    const response = await fetch(`${STORAGE_PATH}/books/${encodeURIComponent(book.id)}/pdf`, {
      method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: book.pdfBlob,
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'PDF 保存失败');
  }
  await command({ action: 'putBook', book: serializableBook(book) });
}

export async function updateBook(database, book) {
  if (!isRemote(database)) return tx(database, 'books', 'readwrite', (store) => store.put(book));
  await command({ action: 'putBook', book: serializableBook(book) });
}

export async function deleteBooks(database, ids) {
  if (isRemote(database)) {
    await command({ action: 'deleteBooks', ids });
    return;
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['books', 'annotations'], 'readwrite');
    const books = transaction.objectStore('books');
    const annotations = transaction.objectStore('annotations').index('bookId');
    ids.forEach((id) => {
      books.delete(id);
      const request = annotations.openCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete(); cursor.continue();
      };
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function addFolder(database, folder) {
  if (!isRemote(database)) return tx(database, 'folders', 'readwrite', (store) => store.put(folder));
  await command({ action: 'putFolder', folder });
}

export async function deleteFolder(database, id) {
  if (!isRemote(database)) return tx(database, 'folders', 'readwrite', (store) => store.delete(id));
  await command({ action: 'deleteFolder', id });
}

export async function moveBooks(database, ids, folderId) {
  if (isRemote(database)) {
    await command({ action: 'moveBooks', ids, folderId });
    return;
  }
  return tx(database, 'books', 'readwrite', (store) => {
    ids.forEach((id) => {
      const request = store.get(id);
      request.onsuccess = () => { if (request.result) { request.result.folderId = folderId; store.put(request.result); } };
    });
  });
}

export async function getAnnotations(database, bookId) {
  if (isRemote(database)) return (await refresh(database)).annotations?.[bookId] || [];
  return legacyGetAnnotations(database, bookId);
}

export async function replaceAnnotations(database, bookId, records) {
  if (isRemote(database)) {
    await command({ action: 'replaceAnnotations', bookId, records });
    database.snapshot.annotations ||= {};
    database.snapshot.annotations[bookId] = records.map((record) => ({
      ...record, bookId, storageKey: `${bookId}:${record.id}`,
    }));
    return;
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('annotations', 'readwrite');
    const store = transaction.objectStore('annotations');
    const request = store.index('bookId').openCursor(IDBKeyRange.only(bookId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      records.forEach((record) => store.put({ ...record, bookId, storageKey: `${bookId}:${record.id}` }));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function deleteAnnotations(database, bookId) {
  return replaceAnnotations(database, bookId, []);
}

export async function updateBookAndAnnotations(database, book, records) {
  if (isRemote(database)) {
    await command({ action: 'updateBookAndAnnotations', book: serializableBook(book), records });
    database.snapshot.annotations ||= {};
    database.snapshot.annotations[book.id] = records.map((record) => ({
      ...record, bookId: book.id, storageKey: `${book.id}:${record.id}`,
    }));
    return;
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['books', 'annotations'], 'readwrite');
    transaction.objectStore('books').put(book);
    const store = transaction.objectStore('annotations');
    const request = store.index('bookId').openCursor(IDBKeyRange.only(book.id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      records.forEach((record) => store.put({ ...record, bookId: book.id, storageKey: `${book.id}:${record.id}` }));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function createPreferenceStorage(database) {
  if (!isRemote(database)) return localStorage;
  const cache = new Map(Object.entries(database.snapshot.preferences || {}));
  return {
    getItem(key) { return cache.has(key) ? cache.get(key) : null; },
    setItem(key, value) {
      const stringValue = String(value);
      cache.set(key, stringValue);
      command({ action: 'setPreference', key, value: stringValue }).catch((error) => {
        console.warn('[scan2ebook] 偏好设置保存失败：', error);
      });
    },
  };
}
