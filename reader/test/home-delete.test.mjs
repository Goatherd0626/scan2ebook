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
for (const [id, title] of [['book-a', '第一本'], ['book-b', '第二本'], ['book-c', '第三本']]) {
  await dbApi.addBook(seedDb, { id, s2eName: title, importedAt: 1, folderId: null, meta: { title },
    bookJson: { pages: [{ pdf_page: 1, items: [{ type: 'body', text: '正文' }] }] }, pdfBlob: new Blob(), bookmarks: [], progress: null });
}
seedDb.close();
await import('../src/plugins/index.js');
const app = await import('../src/core/app.js');
async function waitFor(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), '等待实际界面更新');
}

test('React 书库支持增减、连续和框选；删除确认与设置页面返回保持可用', async () => {
  await act(() => app.init());
  assert.ok(document.querySelector('.compact-library'));
  assert.equal(document.querySelectorAll('#btn-import').length, 1);
  assert.equal(document.getElementById('batch-bar'), null, '只保留首页一处批量操作');
  assert.equal(document.getElementById('home-batch-bar').hidden, true);
  const rows = [...document.querySelectorAll('#home-table .book-item')];
  act(() => rows[0].querySelector('.book-selection').click());
  assert.equal(document.getElementById('detail-panel').hidden, true, '勾选书籍不弹出详情');
  act(() => { rows[0].querySelector('summary').click(); rows[0].querySelector('.book-menu button').click(); });
  assert.match(document.getElementById('detail-panel').textContent, /第一本/);
  document.querySelector('.dp-close').click();
  act(() => rows[2].querySelector('.book-open').dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true })));
  assert.equal(document.querySelectorAll('.book-selection[aria-checked="true"]').length, 3);
  act(() => rows[1].querySelector('.book-open').dispatchEvent(new window.MouseEvent('click', { bubbles: true, metaKey: true })));
  assert.equal(document.querySelectorAll('.book-selection[aria-checked="true"]').length, 2);
  assert.equal(rows.every((row) => !row.hasAttribute('aria-selected')), true);
  const settingsButton = document.getElementById('btn-settings');
  act(() => { settingsButton.focus(); settingsButton.click(); });
  const settings = document.getElementById('settings-view');
  assert.equal(document.activeElement.id, 'settings-title');
  assert.equal(settings.hidden, false);
  settings.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(settings.hidden, false, '设置是页面，Escape 不关闭');
  act(() => document.getElementById('settings-back').click());
  assert.equal(settings.hidden, true);
  assert.equal(document.activeElement, settingsButton);
  assert.equal(document.querySelectorAll('.book-selection[aria-checked="true"]').length, 2);
  act(() => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelectorAll('.book-selection[aria-checked="true"]').length, 0);
  rows.forEach((row, index) => { row.getBoundingClientRect = () => ({ left: 10, right: 210, top: 10 + index * 40, bottom: 35 + index * 40 }); });
  act(() => {
    document.querySelector('.home-main').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 230, clientY: 75 }));
    document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  });
  const selected = [...document.querySelectorAll('#home-table .book-item.selected')];
  assert.deepEqual(selected.map((row) => row.dataset.id), ['book-a', 'book-b']);
  assert.equal(document.querySelectorAll('#library-tree .book-row.selected').length, 2);
  const payload = new Map();
  const drag = new window.Event('dragstart', { bubbles: true });
  Object.defineProperty(drag, 'dataTransfer', { value: { setData(type, value) { payload.set(type, value); }, effectAllowed: '' } });
  act(() => selected[0].querySelector('.book-open').dispatchEvent(drag));
  assert.deepEqual(JSON.parse(payload.get('text/s2e-books')), ['book-a', 'book-b']);
  assert.equal(document.getElementById('home-batch-bar').hidden, false);
  act(() => document.getElementById('home-delete').click());
  assert.match(document.querySelector('.app-sheet').textContent, /删除 2 本/);
  await act(async () => { document.querySelector('[data-dialog-action="confirm"]').click(); await waitFor(() => app.state.books.length === 1); });
  assert.equal((await dbApi.getBooks(app.state.db)).length, 1);
  const sidebarRow = document.querySelector('#library-tree .book-row');
  act(() => { sidebarRow.click(); sidebarRow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); });
  assert.match(document.querySelector('.app-sheet').textContent, /删除电子书/);
  await act(async () => { document.querySelector('[data-dialog-action="confirm"]').click(); await waitFor(() => app.state.books.length === 0); });
  assert.equal((await dbApi.getBooks(app.state.db)).length, 0);
});
