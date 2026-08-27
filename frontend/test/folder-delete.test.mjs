import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'index.html'), 'utf8'), {
  url: 'http://127.0.0.1:8765/', pretendToBeVisual: true,
});
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document, indexedDB, IDBKeyRange,
  localStorage: window.localStorage, location: window.location,
  NodeFilter: window.NodeFilter, HTMLElement: window.HTMLElement, File: window.File,
});
window.indexedDB = indexedDB;
globalThis.IntersectionObserver = window.IntersectionObserver = class { observe() {} disconnect() {} };

const dbApi = await import('../src/core/db.js');
const seedDb = await dbApi.openDB();
await dbApi.addFolder(seedDb, { id: 'folder-move', name: '保留电子书', parentId: null });
await dbApi.addFolder(seedDb, { id: 'folder-delete', name: '一起删除', parentId: null });
for (const [id, folderId] of [['book-move', 'folder-move'], ['book-delete', 'folder-delete']]) {
  await dbApi.addBook(seedDb, {
    id, folderId, s2eName: id, meta: { title: id },
    bookJson: { pages: [] }, pdfBlob: new Blob(), bookmarks: [], progress: null,
  });
}
seedDb.close();

await import('../src/plugins/index.js');
const app = await import('../src/core/app.js');

test('首页 trash 检测文件夹后确认并递归删除内部电子书', async () => {
  let confirms = 0;
  window.confirm = globalThis.confirm = () => { confirms += 1; return true; };
  await app.init();
  assert.equal(document.querySelectorAll('#library-tree .folder-delete').length, 0);
  assert.equal(document.querySelectorAll('#home-table .ht-folder-row:not([hidden])').length, 2);
  assert.equal(document.querySelectorAll('#home-table .folder-delete').length, 0);
  assert.equal(document.querySelector('.ht-row[data-id="book-move"]').hidden, true);
  const search = document.getElementById('search-input');
  search.value = 'book-move';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('.ht-row[data-id="book-move"]').hidden, false, '搜索应临时展开折叠目录中的命中');
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('.ht-row[data-id="book-move"]').hidden, true, '清空搜索后恢复文件夹折叠状态');
  document.querySelector('.ht-folder-row[data-folder-id="folder-move"]').click();
  assert.equal(document.querySelector('.ht-row[data-id="book-move"]').hidden, false);
  assert.equal(document.querySelector('.ht-folder-row[data-folder-id="folder-move"]').classList.contains('selected'), true);
  assert.equal(document.getElementById('home-delete').disabled, false);
  assert.match(document.getElementById('detail-panel').textContent, /保留电子书/);
  assert.match(document.getElementById('detail-panel').textContent, /1 本/);
  const folderName = document.querySelector('#detail-panel [data-folder-key="name"]');
  assert.ok(folderName);
  folderName.click();
  const nameInput = folderName.querySelector('input');
  nameInput.value = '重命名后的文件夹';
  nameInput.dispatchEvent(new window.Event('blur'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.state.folders.find((folder) => folder.id === 'folder-move').name, '重命名后的文件夹');
  assert.match(document.getElementById('detail-panel').textContent, /重命名后的文件夹/);

  const movedRow = document.querySelector('.ht-row[data-id="book-move"]');
  const payload = new Map();
  const dataTransfer = {
    types: ['text/s2e-book', 'text/s2e-books'],
    effectAllowed: '', dropEffect: '',
    setData(type, value) { payload.set(type, value); },
    getData(type) { return payload.get(type) || ''; },
  };
  const dragStart = new window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
  movedRow.querySelector('.b-cover').dispatchEvent(dragStart);
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  document.querySelector('.home-title').dispatchEvent(drop);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(app.state.books.find((book) => book.id === 'book-move').folderId, null);

  document.getElementById('home-delete').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(app.state.folders.some((folder) => folder.id === 'folder-move'), false);
  assert.equal(app.state.books.some((book) => book.id === 'book-move'), true, '移到根目录的书不应随原文件夹删除');

  document.querySelector('.ht-folder-row[data-folder-id="folder-delete"]').click();
  document.getElementById('home-delete').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(app.state.folders.some((folder) => folder.id === 'folder-delete'), false);
  assert.equal(app.state.books.some((book) => book.id === 'book-delete'), false);
  assert.equal(confirms, 2);
});
