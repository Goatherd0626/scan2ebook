import { shellHtml } from './fixtures/shell.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM(shellHtml, { url: 'http://127.0.0.1:8765/', pretendToBeVisual: true });
Object.assign(globalThis, { window, document: window.document, indexedDB, IDBKeyRange,
  localStorage: window.localStorage, location: window.location, NodeFilter: window.NodeFilter,
  HTMLElement: window.HTMLElement, File: window.File, IS_REACT_ACT_ENVIRONMENT: true });
window.indexedDB = indexedDB;
globalThis.IntersectionObserver = window.IntersectionObserver = class { observe() {} disconnect() {} };
const dbApi = await import('../src/core/db.js');
const seedDb = await dbApi.openDB();
for (const folder of [{ id: 'folder-move', name: '保留电子书', parentId: null }, { id: 'folder-delete', name: '一起删除', parentId: null }, { id: 'folder-child', name: '子文件夹', parentId: 'folder-delete' }]) await dbApi.addFolder(seedDb, folder);
for (const [id, folderId] of [['book-move', 'folder-move'], ['book-delete', 'folder-child']]) {
  await dbApi.addBook(seedDb, { id, folderId, s2eName: id, meta: { title: id }, bookJson: { pages: [] }, pdfBlob: new Blob(), bookmarks: [], progress: null });
}
seedDb.close();
await import('../src/plugins/index.js');
const app = await import('../src/core/app.js');
async function waitFor(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  assert.ok(predicate(), '等待文件夹操作完成');
}
function folderMenu(name, index) {
  const summary = [...document.querySelectorAll('.folder-more summary')].find((element) => element.getAttribute('aria-label') === '文件夹操作 ' + name);
  summary.click(); summary.closest('details').querySelectorAll('button')[index].click();
}

test('React 文件夹可导航、重命名、移出书籍，并确认递归删除', async () => {
  await act(() => app.init());
  assert.equal(document.querySelectorAll('.folder-card').length, 2);
  act(() => document.querySelector('[aria-label="打开文件夹 保留电子书"]').click());
  assert.equal(document.querySelectorAll('.book-item').length, 1);
  assert.match(document.querySelector('.library-breadcrumbs').textContent, /保留电子书/);
  act(() => document.querySelector('.library-breadcrumbs > button').click());
  act(() => folderMenu('保留电子书', 0));
  const name = document.querySelector('[data-folder-key="name"]');
  name.click();
  const input = name.querySelector('input');
  input.value = '重命名后的文件夹';
  act(() => input.dispatchEvent(new window.Event('blur')));
  await waitFor(() => document.querySelector('[aria-label="打开文件夹 重命名后的文件夹"]'));
  assert.ok(document.querySelector('[aria-label="打开文件夹 重命名后的文件夹"]'));
  act(() => document.querySelector('[aria-label="打开文件夹 重命名后的文件夹"]').click());
  const payload = new Map();
  const dataTransfer = { types: ['text/s2e-book', 'text/s2e-books'], effectAllowed: '', dropEffect: '',
    setData(type, value) { payload.set(type, value); }, getData(type) { return payload.get(type) || ''; } };
  const drag = new window.Event('dragstart', { bubbles: true });
  Object.defineProperty(drag, 'dataTransfer', { value: dataTransfer });
  act(() => document.querySelector('.book-open').dispatchEvent(drag));
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  act(() => document.querySelector('.library-breadcrumbs > button').dispatchEvent(drop));
  await waitFor(() => !document.querySelector('.book-item[data-id="book-move"]') && app.state.books.find((book) => book.id === 'book-move').folderId === null);
  act(() => document.querySelector('.library-breadcrumbs > button').click());
  act(() => folderMenu('重命名后的文件夹', 1));
  assert.match(document.querySelector('.app-sheet').textContent, /删除/);
  act(() => document.querySelector('[data-dialog-action="confirm"]').click());
  await waitFor(() => !document.querySelector('[aria-label="打开文件夹 重命名后的文件夹"]'));
  assert.equal(app.state.books.some((book) => book.id === 'book-move'), true);
  act(() => folderMenu('一起删除', 1));
  act(() => document.querySelector('[data-dialog-action="confirm"]').click());
  await waitFor(() => !document.querySelector('[aria-label="打开文件夹 一起删除"]'));
  assert.deepEqual(app.state.books.map((book) => book.id), ['book-move']);
  assert.equal(app.state.folders.some((folder) => folder.id === 'folder-child'), false);
  assert.deepEqual((await dbApi.getBooks(app.state.db)).map((book) => book.id), ['book-move']);
});
