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

function setup(t) {
  const dom = new JSDOM('<main id="library"></main>', { url: 'http://127.0.0.1:8765/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const previousBooks = state.books;
  const previousFolders = state.folders;
  const books = [
    { id: 'book-a', s2eName: '第一本', importedAt: 10, meta: { title: '第一本' }, bookJson: { pages: [{ pdf_page: 1 }, { pdf_page: 2 }] }, progress: null },
    { id: 'book-b', s2eName: '第二本', importedAt: 20, meta: { title: '第二本' }, bookJson: { pages: [{ pdf_page: 1 }, { pdf_page: 2 }] }, progress: { page: 1, at: 20 } },
  ];
  state.books = books;
  state.folders = [];
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
  assert.match(document.querySelector('[data-id="book-a"] .book-reading').textContent, /100%/);
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
  assert.match(document.querySelector('.library-no-results').textContent, /还没有符合条件的书/);
});
