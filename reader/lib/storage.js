import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const STORAGE_VERSION = 1;
export const LIBRARY_FILE = 'library.json';

export function defaultStorageDir({ home = homedir(), os = platform(), env = process.env } = {}) {
  if (env.SCAN2EBOOK_READER_DATA_DIR?.trim()) return resolve(env.SCAN2EBOOK_READER_DATA_DIR.trim());
  if (os === 'darwin') return join(home, 'Library', 'Application Support', 'Scan2Ebook Reader');
  if (os === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Scan2Ebook Reader');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'scan2ebook-reader');
}

function emptyLibrary() {
  return { version: STORAGE_VERSION, bookIds: [], folders: [], preferences: {} };
}

function normalizeLibrary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const sourceIds = Array.isArray(source.bookIds)
    ? source.bookIds
    : (Array.isArray(source.books) ? source.books.map((book) => book?.id) : []);
  return {
    version: STORAGE_VERSION,
    bookIds: [...new Set(sourceIds.filter(validId))],
    folders: Array.isArray(source.folders) ? source.folders : [],
    preferences: source.preferences && typeof source.preferences === 'object' ? source.preferences : {},
  };
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function requireId(value, label = 'id') {
  if (!validId(value)) throw new Error(`${label} 不合法`);
  return value;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAnnotations(bookId, records) {
  return (records || []).map((record) => ({
    ...jsonClone(record),
    bookId,
    storageKey: `${bookId}:${requireId(record.id, 'annotation.id')}`,
  }));
}

export class ReaderStorage {
  constructor(storageDir = defaultStorageDir()) {
    this.storageDir = resolve(storageDir);
    this.libraryPath = join(this.storageDir, LIBRARY_FILE);
    this.lockPath = join(this.storageDir, '.write-lock');
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(join(this.storageDir, 'books'), { recursive: true, mode: 0o700 });
    await this.#serialize(async () => this.#withLock(async () => {
      let source;
      try {
        source = JSON.parse(await readFile(this.libraryPath, 'utf8'));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw new Error(`无法读取阅读器书库：${error.message}`);
        await this.#writeLibrary(emptyLibrary());
        return;
      }

      // 兼容开发期间的单文件 schema，转换后每本书独立写入，避免进度更新重写整个书库。
      if (Array.isArray(source.books)) {
        for (const book of source.books) {
          if (!validId(book?.id)) continue;
          await this.#writeJson(this.recordPath(book.id), book);
          if (source.annotations?.[book.id]) {
            await this.#writeJson(this.annotationsPath(book.id), source.annotations[book.id]);
          }
        }
        await this.#writeLibrary(normalizeLibrary(source));
      }
    }));
    return this;
  }

  bookDir(bookId) {
    return join(this.storageDir, 'books', requireId(bookId, 'bookId'));
  }

  pdfPath(bookId) {
    return join(this.bookDir(bookId), 'book.pdf');
  }

  recordPath(bookId) {
    return join(this.bookDir(bookId), 'record.json');
  }

  annotationsPath(bookId) {
    return join(this.bookDir(bookId), 'annotations.json');
  }

  async snapshot() {
    const library = await this.#readLibrary();
    const books = [];
    const annotations = {};
    for (const bookId of library.bookIds) {
      const book = await this.#readJson(this.recordPath(bookId), null);
      if (!book) continue;
      books.push(book);
      annotations[bookId] = await this.#readJson(this.annotationsPath(bookId), []);
    }
    return jsonClone({
      version: library.version,
      books,
      folders: library.folders,
      annotations,
      preferences: library.preferences,
    });
  }

  async readPdf(bookId) {
    return readFile(this.pdfPath(bookId));
  }

  async writePdf(bookId, bytes) {
    await this.#serialize(async () => this.#withLock(
      async () => this.#atomicWrite(this.pdfPath(bookId), bytes),
    ));
  }

  async command(payload) {
    return this.#serialize(async () => this.#withLock(async () => {
      const library = await this.#readLibrary();
      const action = payload?.action;

      if (action === 'putBook') {
        const book = jsonClone(payload.book);
        requireId(book?.id, 'book.id');
        delete book.pdfBlob;
        delete book.pdfUrl;
        await this.#writeJson(this.recordPath(book.id), book);
        if (!library.bookIds.includes(book.id)) library.bookIds.push(book.id);
      } else if (action === 'deleteBooks') {
        const ids = new Set((payload.ids || []).map((id) => requireId(id, 'bookId')));
        library.bookIds = library.bookIds.filter((id) => !ids.has(id));
        for (const id of ids) await rm(this.bookDir(id), { recursive: true, force: true });
      } else if (action === 'putFolder') {
        const folder = jsonClone(payload.folder);
        requireId(folder?.id, 'folder.id');
        const index = library.folders.findIndex((item) => item.id === folder.id);
        if (index < 0) library.folders.push(folder); else library.folders[index] = folder;
      } else if (action === 'deleteFolder') {
        const id = requireId(payload.id, 'folderId');
        library.folders = library.folders.filter((folder) => folder.id !== id);
      } else if (action === 'moveBooks') {
        const ids = new Set((payload.ids || []).map((id) => requireId(id, 'bookId')));
        const folderId = payload.folderId == null ? null : requireId(payload.folderId, 'folderId');
        for (const id of ids) {
          const book = await this.#readJson(this.recordPath(id), null);
          if (!book) continue;
          book.folderId = folderId;
          await this.#writeJson(this.recordPath(id), book);
        }
      } else if (action === 'replaceAnnotations') {
        const bookId = requireId(payload.bookId, 'bookId');
        await this.#writeJson(this.annotationsPath(bookId), normalizeAnnotations(bookId, payload.records));
      } else if (action === 'updateBookAndAnnotations') {
        const book = jsonClone(payload.book);
        requireId(book?.id, 'book.id');
        delete book.pdfBlob;
        delete book.pdfUrl;
        await this.#writeJson(this.recordPath(book.id), book);
        await this.#writeJson(this.annotationsPath(book.id), normalizeAnnotations(book.id, payload.records));
        if (!library.bookIds.includes(book.id)) library.bookIds.push(book.id);
      } else if (action === 'setPreference') {
        const key = String(payload.key || '');
        if (!/^s2e-[A-Za-z0-9:_-]+$/.test(key)) throw new Error('preference key 不合法');
        library.preferences[key] = String(payload.value ?? '');
      } else {
        throw new Error(`不支持的存储操作：${action}`);
      }

      // library.json 只保存索引、文件夹和偏好，不包含 PDF 或整本 book.json。
      await this.#writeLibrary(library);
      return { ok: true };
    }));
  }

  #serialize(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async #withLock(operation) {
    const deadline = Date.now() + 5000;
    const lockToken = JSON.stringify({ pid: process.pid, token: randomUUID() });
    let handle;
    while (!handle) {
      try {
        handle = await open(this.lockPath, 'wx', 0o600);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const lockInfo = await stat(this.lockPath).catch(() => null);
        if (lockInfo && Date.now() - lockInfo.mtimeMs > 60_000) {
          const owner = await this.#readLockOwner();
          // 超时本身不代表锁已失效；大 PDF 写入可能持续一分钟以上。
          if (!owner || !this.#processExists(owner.pid)) {
            await rm(this.lockPath, { force: true });
            continue;
          }
        }
        if (Date.now() >= deadline) throw new Error('无法获取阅读器数据写入锁');
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
    }
    try {
      await handle.writeFile(lockToken, 'utf8');
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(this.lockPath, { force: true }).catch(() => {});
      throw error;
    }
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => {});
      // 只释放自己创建的锁，避免异常回收后误删其他进程的新锁。
      const currentToken = await readFile(this.lockPath, 'utf8').catch(() => null);
      if (currentToken === lockToken) await rm(this.lockPath, { force: true }).catch(() => {});
    }
  }

  async #readLockOwner() {
    try {
      const owner = JSON.parse(await readFile(this.lockPath, 'utf8'));
      return Number.isSafeInteger(owner?.pid) && owner.pid > 0 ? owner : null;
    } catch {
      return null;
    }
  }

  #processExists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  }

  async #readLibrary() {
    return normalizeLibrary(await this.#readJson(this.libraryPath, emptyLibrary()));
  }

  async #readJson(path, fallback) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return fallback;
      throw new Error(`无法读取 ${path}：${error.message}`);
    }
  }

  async #writeLibrary(library) {
    await this.#writeJson(this.libraryPath, normalizeLibrary(library));
  }

  async #writeJson(path, value) {
    await this.#atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async #atomicWrite(target, content) {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
  }
}
