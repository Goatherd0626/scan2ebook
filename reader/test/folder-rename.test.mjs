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
const seed = await dbApi.openDB();
for (const folder of [
  { id: 'one', name: '阅读资料', parentId: null }, { id: 'one-child', name: '随笔', parentId: 'one' },
  { id: 'two', name: '研究参考', parentId: null }, { id: 'two-child', name: '文献', parentId: 'two' },
]) await dbApi.addFolder(seed, folder);
seed.close();
await import('../src/plugins/index.js');
const app = await import('../src/core/app.js');
const waitFor = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), '等待文件夹名称同步');
};

test('侧栏只折叠当前文件夹；三点直接改名、Esc 取消并保留展开状态', async () => {
  await act(() => app.init());
  const first = document.querySelector('.folder-row[data-id="one"]');
  const second = document.querySelector('.folder-row[data-id="two"]');
  act(() => (second.querySelector('.folder-toggle') || second).click());
  assert.equal(first.nextElementSibling.hidden, false, '不能折叠其他同级文件夹');
  assert.equal(second.nextElementSibling.hidden, true);
  act(() => first.querySelector('.f-name').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
  const input = document.querySelector('.name-editor input');
  input.value = '不应保存';
  act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal((await dbApi.getFolders(app.state.db)).find(f => f.id === 'one').name, '阅读资料');
  act(() => {
    document.querySelector('[aria-label="文件夹操作 阅读资料"]').click();
    const action = [...document.querySelectorAll('.folder-more[open] .book-menu button')].find(button => button.textContent === '重命名');
    assert.ok(action, '无需打开详情即可改名');
    action.click();
  });
  document.querySelector('.name-editor input').value = '阅读与写作';
  act(() => document.querySelector('[data-name-action="save"]').click());
  await waitFor(() => document.querySelector('[aria-label="打开文件夹 阅读与写作"]'));
  assert.equal(document.querySelector('.folder-row[data-id="one"] .f-name').textContent, '阅读与写作');
  assert.equal(document.querySelector('.folder-row[data-id="two"]').nextElementSibling.hidden, true, '改名后仍保留其他文件夹的收起状态');
  assert.equal((await dbApi.getFolders(app.state.db)).find(f => f.id === 'one').name, '阅读与写作');
});

test('已打开电子书改名后切换阅读视图，名称和其他元数据不会被旧视图覆盖', async () => {
  const book = { id: 'rename-book', s2eName: '样书', importedAt: 1, folderId: null,
    meta: { title: '原书名', author: '保留作者' }, bookJson: { pages: [] }, pdfBlob: new Blob(), bookmarks: [], progress: null };
  await dbApi.addBook(app.state.db, book);
  app.state.books.push(book);
  book.pdfBlob.arrayBuffer = () => new Promise(() => {});
  await act(async () => app.openBook(book.id));
  const view = app.state.tabs.find(item => item.bookId === book.id);
  act(() => { app.readerBridge.showBookDetails(book.id); document.querySelector('.dp-close').click(); });
  assert.equal(document.getElementById('detail-panel').hidden, true);
  const result = app.readerBridge.renameBook(book.id, document.getElementById('btn-settings'));
  document.querySelector('.name-editor input').value = '改好的书名';
  await act(async () => { document.querySelector('[data-name-action="save"]').click(); await result; });
  assert.equal(document.getElementById('detail-panel').hidden, true, '改名不能重新打开用户已关闭的详情');
  assert.equal((await dbApi.getBooks(app.state.db)).find(item => item.id === book.id).meta.title, '改好的书名');
  act(() => view.setPrefs({ viewMode: 'text' }));
  const saved = (await dbApi.getBooks(app.state.db)).find(item => item.id === book.id);
  assert.equal(saved.meta.title, '改好的书名');
  assert.equal(saved.meta.author, '保留作者');
  assert.equal(saved.prefs.viewMode, 'text');
});
