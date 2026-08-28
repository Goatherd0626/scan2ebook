import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReaderStorage, defaultStorageDir } from '../lib/storage.js';

test('macOS 默认使用统一 Application Support 目录', () => {
  assert.equal(
    defaultStorageDir({ home: '/Users/tester', os: 'darwin', env: {} }),
    '/Users/tester/Library/Application Support/Scan2Ebook Reader',
  );
});

test('书库按书分文件存储 PDF、记录与标注', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'scan2ebook-storage-'));
  const storage = await new ReaderStorage(storageDir).init();
  const book = {
    id: 'book-a',
    meta: { title: '测试书' },
    bookJson: { pages: [{ pdf_page: 1, items: [] }] },
    bookmarks: [],
    progress: { page: 1 },
  };

  await storage.writePdf(book.id, Buffer.from('%PDF-test'));
  await storage.command({ action: 'putBook', book });
  await storage.command({ action: 'replaceAnnotations', bookId: book.id, records: [
    { id: 'note-a', type: 'note', text: '注释' },
  ] });
  await storage.command({ action: 'setPreference', key: 's2e-settings', value: '{"mode":"eye"}' });

  const snapshot = await storage.snapshot();
  assert.deepEqual(snapshot.books, [book]);
  assert.equal(snapshot.annotations['book-a'][0].storageKey, 'book-a:note-a');
  assert.equal(snapshot.preferences['s2e-settings'], '{"mode":"eye"}');
  assert.equal((await storage.readPdf(book.id)).toString(), '%PDF-test');

  const library = JSON.parse(await readFile(join(storageDir, 'library.json'), 'utf8'));
  assert.deepEqual(library.bookIds, ['book-a']);
  assert.equal('bookJson' in library, false);
  assert.equal('books' in library, false);
  assert.deepEqual(JSON.parse(await readFile(join(storageDir, 'books', 'book-a', 'record.json'), 'utf8')), book);
});

test('多个 reader 实例共用同一目录且不丢失并发更新', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'scan2ebook-shared-storage-'));
  const first = await new ReaderStorage(storageDir).init();
  const second = await new ReaderStorage(storageDir).init();

  await Promise.all([
    first.command({ action: 'putBook', book: { id: 'book-a', meta: { title: 'A' } } }),
    second.command({ action: 'putBook', book: { id: 'book-b', meta: { title: 'B' } } }),
  ]);

  assert.deepEqual((await first.snapshot()).books.map((book) => book.id).sort(), ['book-a', 'book-b']);
  assert.deepEqual((await second.snapshot()).books.map((book) => book.id).sort(), ['book-a', 'book-b']);
});

test('拒绝使用不安全的 book id 越界写入', async () => {
  const storage = await new ReaderStorage(await mkdtemp(join(tmpdir(), 'scan2ebook-safe-storage-'))).init();
  await assert.rejects(
    () => storage.command({ action: 'putBook', book: { id: '../outside' } }),
    /book\.id 不合法/,
  );
});
