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
  window,
  document: window.document,
  indexedDB,
  IDBKeyRange,
  localStorage: window.localStorage,
  location: window.location,
  NodeFilter: window.NodeFilter,
  HTMLElement: window.HTMLElement,
  File: window.File,
});
window.indexedDB = indexedDB;
globalThis.IntersectionObserver = window.IntersectionObserver = class { observe() {} disconnect() {} };

const dbApi = await import('../src/core/db.js');
const seedDb = await dbApi.openDB();
for (const [id, title] of [['book-a', '第一本'], ['book-b', '第二本'], ['book-c', '第三本']]) {
  await dbApi.addBook(seedDb, {
    id, s2eName: title, importedAt: 1, folderId: null,
    meta: { title },
    bookJson: { pages: [{ pdf_page: 1, items: [{ type: 'body', text: '正文' }] }] },
    pdfBlob: new Blob(), bookmarks: [], progress: null,
  });
}
seedDb.close();

await import('../src/plugins/index.js');
const app = await import('../src/core/app.js');

test('首页和侧边栏无需模式按钮即可连续、增减和框选，并确认删除', async () => {
  let confirms = 0;
  const acceptDeleteSheet = async () => {
    const sheet = document.querySelector('.app-sheet');
    assert.ok(sheet, '删除操作应显示应用内确认 Sheet');
    assert.match(sheet.textContent, /删除/);
    confirms += 1;
    sheet.querySelector('[data-dialog-action="confirm"]').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  };
  await app.init();
  assert.equal(document.getElementById('detail-panel').hidden, false);
  assert.match(document.getElementById('detail-panel').textContent, /未选择对象/);

  const toolbarButtons = [...document.querySelectorAll('.home-actions > .home-tool')];
  assert.deepEqual(toolbarButtons.map((button) => button.id), [
    'home-new-folder', 'home-delete', 'home-import',
  ]);
  assert.equal(document.getElementById('home-batch'), null);
  assert.equal(document.getElementById('btn-batch'), null);
  assert.equal(document.querySelectorAll('.batch-check').length, 0);
  assert.ok(document.querySelector('#home-delete .i-trash'));
  assert.equal(document.getElementById('home-delete').disabled, true);

  const rows = [...document.querySelectorAll('#home-table .ht-row')];
  rows[0].click();
  assert.equal(document.getElementById('home-delete').disabled, false);
  assert.match(document.getElementById('detail-panel').textContent, /第一本/);
  rows[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(document.querySelectorAll('#home-table .ht-row.selected').length, 3);
  assert.match(document.getElementById('detail-panel').textContent, /已选择 3 本电子书/);
  rows[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, metaKey: true }));
  assert.equal(document.querySelectorAll('#home-table .ht-row.selected').length, 2);

  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ left: 10, right: 210, top: 10 + index * 40, bottom: 35 + index * 40 });
  });
  rows[2].click();
  rows[0].dispatchEvent(new window.MouseEvent('pointerdown', {
    bubbles: true, button: 0, clientX: 0, clientY: 0,
  }));
  document.dispatchEvent(new window.MouseEvent('pointermove', {
    bubbles: true, clientX: 230, clientY: 75,
  }));
  document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.querySelectorAll('#home-table .ht-row.selected').length, 2);

  rows[2].click();
  document.querySelector('.home-head').dispatchEvent(new window.MouseEvent('pointerdown', {
    bubbles: true, button: 0, clientX: 0, clientY: 0,
  }));
  document.dispatchEvent(new window.MouseEvent('pointermove', {
    bubbles: true, clientX: 230, clientY: 75,
  }));
  document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(document.querySelectorAll('#home-table .ht-row.selected').length, 2, '首页标题区空白处也应能开始框选');
  assert.equal(document.querySelectorAll('#library-tree .book-row.selected').length, 2);
  const selectedRows = [...document.querySelectorAll('#home-table .ht-row.selected')];
  assert.equal(selectedRows.every((row) => row.draggable), true, '选中的书籍行应恢复拖拽移动');
  const dragPayload = new Map();
  const dragStart = new window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', {
    value: {
      setData(type, value) { dragPayload.set(type, value); },
      effectAllowed: '',
    },
  });
  selectedRows[0].dispatchEvent(dragStart);
  assert.deepEqual(JSON.parse(dragPayload.get('text/s2e-books')).sort(), ['book-a', 'book-b']);
  assert.equal(document.getElementById('home-batch-bar').hidden, false);

  document.getElementById('home-delete').click();
  await acceptDeleteSheet();

  assert.equal(confirms, 1);
  assert.equal(app.state.books.length, 1);
  assert.equal((await dbApi.getBooks(app.state.db)).length, 1);

  const remainingSidebarRow = document.querySelector('#library-tree .book-row');
  remainingSidebarRow.click();
  remainingSidebarRow.focus();
  remainingSidebarRow.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Delete', bubbles: true, cancelable: true,
  }));
  await acceptDeleteSheet();
  assert.equal(confirms, 2);
  assert.equal(app.state.books.length, 0);
});
