import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReaderServer } from '../lib/server.js';

test('前端存储客户端通过 reader API 导入、更新并读取 PDF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scan2ebook-client-storage-'));
  const distDir = join(root, 'dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, 'index.html'), '<!doctype html>');
  const instance = await createReaderServer({ port: 0, distDir, storageDir: join(root, 'data') });
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  try {
    globalThis.fetch = (url, options) => originalFetch(new URL(url, instance.url), options);
    globalThis.window = { fetch: globalThis.fetch };
    const db = await import(`../src/core/db.js?remote-client=${Date.now()}`);
    const database = await db.openDB();
    const book = {
      id: 'remote-book',
      meta: { title: '远程存储测试' },
      bookJson: { pages: [] },
      pdfBlob: new Blob(['%PDF-client'], { type: 'application/pdf' }),
      progress: null,
    };
    await db.addBook(database, book);

    const stored = (await db.getBooks(database))[0];
    assert.equal(stored.meta.title, '远程存储测试');
    assert.equal(await (await db.getBookPdf(database, stored)).text(), '%PDF-client');

    stored.progress = { page: 7 };
    await db.updateBook(database, stored);
    assert.equal((await db.getBooks(database))[0].progress.page, 7);

    const preferences = db.createPreferenceStorage(database);
    preferences.setItem('s2e-settings', '{"mode":"dark"}');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = await originalFetch(`${instance.url}/__scan2ebook__/storage`).then((response) => response.json());
    assert.equal(snapshot.preferences['s2e-settings'], '{"mode":"dark"}');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    await instance.close();
  }
});
