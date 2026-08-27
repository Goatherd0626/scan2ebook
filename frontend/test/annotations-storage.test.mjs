import assert from 'node:assert/strict';
import test from 'node:test';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import JSZip from 'jszip';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const dbApi = await import('../src/core/db.js');
const {
  buildAnnotationSidecar,
  parseAnnotationSidecar,
} = await import('../src/core/annotation_format.js');
const { buildAnnotatedS2e } = await import('../src/plugins/annotations/export.js');

const range = {
  start: { page: 2, item: 0, offset: 1 },
  end: { page: 2, item: 0, offset: 5 },
};

test('annotations.json 校验非法项并在本地记录中补 bookId/type', () => {
  const parsed = parseAnnotationSidecar(JSON.stringify({
    version: 1,
    highlights: [
      { id: 'h1', range, quote: '原文', color: 'yellow', createdAt: 1, updatedAt: 2 },
      { id: 'bad-color', range, quote: '原文', color: 'purple' },
    ],
    notes: [
      { id: 'n1', range, quote: '原文', text: '  注释内容  ', createdAt: 3, updatedAt: 4 },
      { id: 'empty-note', range, quote: '原文', text: '   ' },
    ],
    bookmarks: [
      { id: 'b1', page: 2, item: 0, snippet: '书签原文', at: 5 },
      { id: 'bad-bookmark', page: 0 },
    ],
    historyNotes: [
      { id: 'history-1', page: 2, quote: '旧原文', text: '历史注释', archivedAt: 9, reason: 'page-edited' },
    ],
  }), 'book-a');

  assert.equal(parsed.invalidCount, 3);
  assert.deepEqual(parsed.records.map((record) => ({
    id: record.id, bookId: record.bookId, type: record.type,
    color: record.color, text: record.text,
  })), [
    { id: 'h1', bookId: 'book-a', type: 'highlight', color: 'yellow', text: undefined },
    { id: 'n1', bookId: 'book-a', type: 'note', color: undefined, text: '注释内容' },
    { id: 'history-1', bookId: 'book-a', type: 'history-note', color: undefined, text: '历史注释' },
  ]);
  assert.deepEqual(parsed.bookmarks, [
    { id: 'b1', page: 2, snippet: '书签原文', at: 5 },
  ]);
});

test('导出 sidecar 按正文顺序排列标注和书签，并移除 IndexedDB 专用字段', () => {
  const sidecar = buildAnnotationSidecar([
    { id: 'n2', bookId: 'book-a', type: 'note', range: { start: { page: 3, item: 0, offset: 0 }, end: { page: 3, item: 0, offset: 2 } }, quote: '后', text: '后注', createdAt: 2, updatedAt: 2 },
    { id: 'h1', bookId: 'book-a', type: 'highlight', range, quote: '原文', color: 'blue', createdAt: 1, updatedAt: 1 },
    { id: 'n1', bookId: 'book-a', type: 'note', range, quote: '原文', text: '前注', createdAt: 1, updatedAt: 1 },
    { id: 'history-1', bookId: 'book-a', type: 'history-note', page: 2, quote: '旧原文', text: '历史注释', archivedAt: 9, reason: 'page-edited' },
  ], [
    { id: 'b2', page: 8, item: 2, snippet: '后书签', at: 2 },
    { id: 'b1', page: 2, item: 1, snippet: '前书签', at: 1 },
    { id: 'b1-duplicate', page: 2, item: 5, snippet: '同页重复', at: 3 },
  ]);

  assert.equal(sidecar.version, 1);
  assert.deepEqual(sidecar.highlights.map((item) => item.id), ['h1']);
  assert.deepEqual(sidecar.notes.map((item) => item.id), ['n1', 'n2']);
  assert.equal('bookId' in sidecar.highlights[0], false);
  assert.equal('storageKey' in sidecar.highlights[0], false);
  assert.equal('type' in sidecar.notes[0], false);
  assert.deepEqual(sidecar.bookmarks.map((item) => item.id), ['b1', 'b2']);
  assert.equal(sidecar.bookmarks.some((item) => 'item' in item), false);
  assert.deepEqual(sidecar.historyNotes.map((item) => item.id), ['history-1']);
});

test('IndexedDB 按书隔离、整批替换，并在删书时级联删除标注', async () => {
  const db = await dbApi.openDB();
  await dbApi.addBook(db, { id: 'book-a', meta: {}, bookJson: {}, pdfBlob: new Blob() });
  await dbApi.addBook(db, { id: 'book-b', meta: {}, bookJson: {}, pdfBlob: new Blob() });
  await dbApi.replaceAnnotations(db, 'book-a', [
    { id: 'a1', bookId: 'wrong', type: 'highlight', range, quote: 'A', color: 'yellow' },
  ]);
  await dbApi.replaceAnnotations(db, 'book-b', [
    { id: 'a1', type: 'note', range, quote: 'B', text: '注释 B' },
  ]);

  assert.deepEqual((await dbApi.getAnnotations(db, 'book-a')).map((item) => item.id), ['a1']);
  assert.equal((await dbApi.getAnnotations(db, 'book-a'))[0].bookId, 'book-a');

  await dbApi.replaceAnnotations(db, 'book-a', [
    { id: 'a2', type: 'highlight', range, quote: 'A2', color: 'green' },
  ]);
  assert.deepEqual((await dbApi.getAnnotations(db, 'book-a')).map((item) => item.id), ['a2']);

  await dbApi.updateBookAndAnnotations(db, {
    id: 'book-b', meta: { title: '原子更新' }, bookJson: {}, pdfBlob: new Blob(),
  }, [{ id: 'atomic', type: 'history-note', page: 2, quote: '原文', text: '历史', archivedAt: 1 }]);
  assert.equal((await dbApi.getBooks(db)).find((book) => book.id === 'book-b').meta.title, '原子更新');
  assert.deepEqual((await dbApi.getAnnotations(db, 'book-b')).map((item) => item.id), ['atomic']);

  await dbApi.deleteBooks(db, ['book-a']);
  assert.deepEqual(await dbApi.getAnnotations(db, 'book-a'), []);
  assert.deepEqual((await dbApi.getAnnotations(db, 'book-b')).map((item) => item.id), ['atomic']);
  db.close();
});

test('导出的 s2e 同时包含 PDF、电子书 JSON 和独立 annotations.json', async () => {
  const book = {
    bookJson: { book: { title: '测试书' }, pages: [] },
    pdfBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
    bookmarks: [{ id: 'bm1', page: 4, item: 1, snippet: '导出书签', at: 8 }],
  };
  const blob = await buildAnnotatedS2e(book, [
    { id: 'h1', bookId: 'book-a', type: 'highlight', range, quote: '原文', color: 'orange' },
  ]);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  assert.ok(zip.file('book.pdf'));
  assert.deepEqual(JSON.parse(await zip.file('book.json').async('string')), book.bookJson);
  const sidecar = JSON.parse(await zip.file('annotations.json').async('string'));
  assert.deepEqual(sidecar.highlights.map((item) => item.id), ['h1']);
  assert.equal(sidecar.highlights[0].bookId, undefined);
  assert.deepEqual(sidecar.bookmarks.map((item) => item.id), ['bm1']);
  assert.equal('item' in sidecar.bookmarks[0], false);
});
