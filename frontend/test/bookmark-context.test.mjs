import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div id="toc-panel"><div id="toc-tabs"><button data-tt="toc">目录</button></div><div id="toc-list"></div></div>
</body>`, { pretendToBeVisual: true, url: 'http://127.0.0.1:8765/' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;

const extensions = await import('../src/core/extensions.js');
await import('../src/plugins/bookmarks/index.js');

test('工具栏按当前 PDF 页切换唯一书签，文字选区不再提供书签入口', async () => {
  extensions.ui.reset();
  extensions.setEnabled('bookmarks', true);
  const book = { id: 'book-a', bookmarks: [] };
  let updates = 0;
  let confirms = 0;
  const jumps = [];
  const view = {
    bookId: 'book-a',
    textView: {
      currentPage: 7,
      pageAnchors: new Map([[7, { textContent: '第七页正文内容' }]]),
      scrollToPage: (page) => jumps.push('page:' + page),
    },
    pdfView: { currentPage: 7, gotoPage: (page) => jumps.push('pdf:' + page) },
  };
  const ctx = {
    bus: extensions.bus,
    ui: extensions.ui,
    state: { activeBookId: 'book-a', books: [book] },
    db: { updateBook: async () => { updates += 1; } },
    getView: () => view,
    toast: () => {},
    dialog: { confirm: async () => { confirms += 1; return true; } },
  };
  extensions.activateExtension('bookmarks', ctx);
  const action = extensions.ui.registry.contextActions.find((item) => item.id === 'bookmark-selection-action');
  assert.equal(action, undefined);
  const toolbar = extensions.ui.registry.toolbarWidgets.find((item) => item.id === 'bookmark-toggle');
  assert.ok(toolbar);
  const toggle = toolbar.el;
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.ok(toggle.querySelector('.i-bookmark-context'));

  const bookmarkTab = extensions.ui.registry.tocTabs.find((item) => item.id === 'bookmarks');
  bookmarkTab.onShow();
  assert.equal(document.querySelector('#tab-body-bookmarks .add-bm'), null);
  toggle.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(updates, 1);
  assert.deepEqual(book.bookmarks.map((bookmark) => bookmark.page), [7]);
  assert.equal(book.bookmarks[0].snippet, '第七页正文内容');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.ok(toggle.querySelector('.i-bookmark-context-filled'));

  toggle.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(book.bookmarks.length, 0);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  book.bookmarks = [
    { id: 'late', page: 9, snippet: '后面的书签', at: 2 },
    {
      id: 'early', page: 2,
      snippet: '这是一个用于测试书签栏摘要显示顺序和截断效果的很长正文内容',
      at: new Date(2026, 7, 25, 21, 35).getTime(),
    },
  ];
  bookmarkTab.onShow();
  const rows = [...document.querySelectorAll('#tab-body-bookmarks .bm-item')];
  assert.deepEqual(rows.map((row) => row.dataset.id), ['early', 'late']);
  assert.equal(rows[0].children[0].classList.contains('bm-page'), true);
  assert.equal(rows[0].children[0].textContent, 'P2');
  assert.equal(rows[0].children[1].classList.contains('bm-content'), true);
  assert.match(rows[0].querySelector('.bm-text').textContent, /…$/);
  assert.ok(rows[0].querySelector('.bm-text').textContent.length <= 29);
  assert.equal(rows[0].querySelector('.bm-time').textContent, '2026-08-25  21:35');
  assert.ok(rows[0].querySelector('.bm-remove-bookmark .i-bookmark-context-filled'));
  rows[0].click();
  assert.deepEqual(jumps, ['pdf:2', 'page:2']);

  rows[0].querySelector('.bm-remove-bookmark').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(confirms, 0, '单条取消书签不需要确认');
  assert.deepEqual(book.bookmarks.map((bookmark) => bookmark.id), ['late']);

  book.bookmarks = [
    { id: 'b1', page: 1, snippet: '第一页', at: 1 },
    { id: 'b2', page: 2, snippet: '第二页', at: 2 },
    { id: 'b3', page: 3, snippet: '第三页', at: 3 },
  ];
  bookmarkTab.onShow();
  let batchRows = [...document.querySelectorAll('#tab-body-bookmarks .bm-item')];
  batchRows[0].click();
  batchRows[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(document.querySelectorAll('.bm-item.selected').length, 3);
  batchRows[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, metaKey: true }));
  assert.equal(document.querySelectorAll('.bm-item.selected').length, 2);
  assert.equal([...document.querySelectorAll('.bm-item.selected')]
    .every((row) => row.getAttribute('aria-selected') === 'true'), true);
  document.getElementById('tab-body-bookmarks').dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true,
  }));
  assert.equal(document.querySelectorAll('.bm-item.selected').length, 0);
  batchRows[0].click();
  batchRows[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  batchRows[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, metaKey: true }));

  batchRows = [...document.querySelectorAll('#tab-body-bookmarks .bm-item')];
  batchRows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ left: 10, right: 220, top: 10 + index * 50, bottom: 45 + index * 50 });
  });
  const bookmarkBody = document.getElementById('tab-body-bookmarks');
  bookmarkBody.dispatchEvent(new window.MouseEvent('pointerdown', {
    bubbles: true, button: 0, clientX: 0, clientY: 0,
  }));
  document.dispatchEvent(new window.MouseEvent('pointermove', {
    bubbles: true, clientX: 240, clientY: 100,
  }));
  document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(document.querySelectorAll('.bm-item.selected').length, 2);
  document.querySelector('.bm-multi-remove').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(confirms, 1);
  assert.deepEqual(book.bookmarks.map((bookmark) => bookmark.id), ['b3']);
  extensions.deactivateExtension('bookmarks');
});
