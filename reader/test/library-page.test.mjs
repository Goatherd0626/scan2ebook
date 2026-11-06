import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

const initial = new JSDOM('<body></body>', { url: 'http://127.0.0.1:8765/' });
globalThis.window = initial.window;
globalThis.document = initial.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { LibraryPage } = await import('../src/web/LibraryPage.tsx');
const { state } = await import('../src/core/app.js');
const { bus } = await import('../src/core/extensions.js');

function setup(t, { folderRecords = [], bookRecords } = {}) {
  const dom = new JSDOM('<main id="library"></main>', { url: 'http://127.0.0.1:8765/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const previousBooks = state.books;
  const previousFolders = state.folders;
  const books = bookRecords || [
    { id: 'book-a', s2eName: '第一本', importedAt: 10, meta: { title: '第一本' }, bookJson: { pages: [{ pdf_page: 1 }, { pdf_page: 2 }] }, progress: null },
    { id: 'book-b', s2eName: '第二本', importedAt: 20, meta: { title: '第二本' }, bookJson: { pages: [{ pdf_page: 1 }, { pdf_page: 2 }] }, progress: { page: 1, at: 20 } },
  ];
  state.books = books;
  state.folders = folderRecords;
  const root = createRoot(document.getElementById('library'));
  act(() => root.render(createElement(LibraryPage)));
  t.after(() => {
    act(() => root.unmount());
    state.books = previousBooks;
    state.folders = previousFolders;
    dom.window.close();
  });
  const visibleIds = () => [...document.querySelectorAll('#home-table .book-item')].map((element) => element.dataset.id);
  const readFirstBook = () => act(() => {
    books[0].progress = { page: 2, at: 100 };
    bus.emit('library:change');
  });
  return { books, visibleIds, readFirstBook };
}

test('原位更新阅读进度后，最近阅读顺序立即更新', (t) => {
  const { books, visibleIds, readFirstBook } = setup(t);
  assert.deepEqual(visibleIds(), ['book-b', 'book-a']);

  readFirstBook();

  assert.equal(state.books, books);
  assert.deepEqual(visibleIds(), ['book-a', 'book-b']);
  assert.match(document.querySelector('[data-id="book-a"] .book-reading').textContent, /第 2 页/);
});

test('原位更新阅读进度后，未开始筛选立即移除已读书籍', (t) => {
  const { books, visibleIds, readFirstBook } = setup(t);
  const unread = [...document.querySelectorAll('.library-tabs button')].find((button) => button.textContent === '未开始');
  act(() => unread.click());
  assert.deepEqual(visibleIds(), ['book-a']);

  readFirstBook();

  assert.equal(state.books, books);
  assert.equal(unread.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(visibleIds(), []);
  assert.match(document.querySelector('.library-no-results').textContent, /没有匹配的书籍/);
});

test('零本书时保留文件夹入口，根书库和文件夹空态明确区分', (t) => {
  setup(t, { bookRecords: [], folderRecords: [{ id: 'empty-folder', name: '空文件夹', parentId: null }] });
  assert.equal(document.querySelector('.library-empty'), null);
  assert.match(document.querySelector('.library-no-results').textContent, /还没有添加书籍/);
  act(() => document.querySelector('[aria-label="打开文件夹 空文件夹"]').click());
  assert.match(document.querySelector('.library-no-results').textContent, /文件夹里还没有书/);
  act(() => document.querySelector('.library-breadcrumbs > button').click());
  assert.match(document.querySelector('.library-no-results').textContent, /还没有添加书籍/);
});

test('文件夹逐层打开并能由面包屑返回父层', (t) => {
  setup(t, { bookRecords: [], folderRecords: [{ id: 'parent', name: '研究资料', parentId: null }, { id: 'child', name: '史料', parentId: 'parent' }] });
  assert.equal(document.querySelectorAll('.folder-card').length, 1);
  act(() => document.querySelector('[aria-label="打开文件夹 研究资料"]').click());
  assert.equal(document.querySelectorAll('.folder-card').length, 1);
  act(() => document.querySelector('[aria-label="打开文件夹 史料"]').click());
  assert.match(document.querySelector('.library-breadcrumbs').textContent, /书库研究资料史料/);
  act(() => document.querySelector('.library-breadcrumbs > span button').click());
  assert.ok(document.querySelector('[aria-label="打开文件夹 史料"]'));
});
