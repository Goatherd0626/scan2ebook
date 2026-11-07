import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { shellHtml } from './fixtures/shell.mjs';
const { window } = new JSDOM(shellHtml, { url: 'http://127.0.0.1:8765/', pretendToBeVisual: true });
Object.assign(globalThis, { window, document: window.document, indexedDB, IDBKeyRange,
  location: window.location, localStorage: window.localStorage, HTMLElement: window.HTMLElement,
  NodeFilter: window.NodeFilter, File: window.File });
globalThis.IntersectionObserver = window.IntersectionObserver = class { observe() {} disconnect() {} };
localStorage.setItem('s2e-plugin:eyecare', '0');
localStorage.setItem('s2e-plugin:search', '0');
await import('../src/plugins/index.js');
const extensions = await import('../src/core/extensions.js');
const app = await import('../src/core/app.js');
await app.init({ mountHome(host) { host.innerHTML = '<div class="home-main"></div>'; } });
const openSettings = () => document.getElementById('btn-settings').click();
const category = (id) => document.querySelector(`#settings-nav [data-settings-section="${id}"]`);

test('旧版关闭的内置功能会启用，界面不再提供插件开关和设置弹窗', () => {
  assert.equal(extensions.getExtension('eyecare')._active, true);
  assert.equal(extensions.getExtension('search')._active, true);
  assert.ok(document.getElementById('search-wrap'));
  assert.equal(document.getElementById('settings-dialog'), null);
  assert.equal(document.getElementById('eyecare-panel'), null);
  assert.equal(document.querySelector('.ec-toolbar-btn'), null);
  assert.equal(document.querySelector('.plugin-row, [role="switch"]'), null);
  assert.equal(document.getElementById('btn-settings').getAttribute('aria-label'), '设置');
});

test('设置作为独立页面按分类切换，URL 记录当前子页，返回书库后恢复入口焦点', () => {
  openSettings();
  assert.equal(document.body.dataset.screen, 'settings');
  assert.equal(document.getElementById('home-view').style.display, 'none');
  assert.equal(document.getElementById('settings-view').hidden, false);
  assert.equal(document.activeElement.id, 'settings-title');
  assert.deepEqual([...document.querySelectorAll('#settings-nav a')].map(item => item.textContent), ['外观', '阅读排版']);
  category('typography').click();
  assert.equal(new URL(location.href).searchParams.get('view'), 'settings');
  assert.equal(new URL(location.href).searchParams.get('section'), 'typography');
  assert.equal(document.getElementById('settings-section-appearance').hidden, true);
  assert.equal(document.getElementById('settings-section-typography').hidden, false);
  document.getElementById('settings-back').click();
  assert.equal(document.body.dataset.screen, 'library');
  assert.equal(document.getElementById('settings-view').hidden, true);
  assert.equal(document.activeElement.id, 'btn-settings');
});

test('调整即时生效并保存，分类恢复默认不会覆盖另一类设置', () => {
  openSettings(); category('typography').click();
  const size = document.querySelector('[data-k="fontSize"]');
  size.value = '22';
  size.dispatchEvent(new window.Event('input', { bubbles: true }));
  size.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.documentElement.style.getPropertyValue('--font-size'), '22px');
  assert.equal(JSON.parse(localStorage.getItem('s2e-settings')).fontSize, 22);
  category('appearance').click();
  document.querySelector('button[data-mode="dark"]').click();
  assert.equal(document.body.classList.contains('dark'), true);
  document.querySelector('#settings-section-appearance [data-reset]').click();
  assert.equal(document.body.classList.contains('dark'), false);
  assert.equal(JSON.parse(localStorage.getItem('s2e-settings')).fontSize, 22);
});

test('从阅读页进入设置后可返回同一阅读视图，Escape 不将设置当弹窗关闭', async () => {
  document.getElementById('settings-back').click();
  const wv = document.createElement('div'); wv.className = 'book-view';
  wv.innerHTML = '<div class="text-panel"><p class="text-item" data-item="7:0">原来的阅读段落</p></div>';
  const panel = wv.querySelector('.text-panel');
  const paragraph = panel.querySelector('.text-item');
  let paragraphTop = 70;
  panel.scrollTop = 20;
  panel.getBoundingClientRect = () => ({ top: 64 });
  paragraph.getBoundingClientRect = () => ({ top: paragraphTop, bottom: paragraphTop + 50 });
  document.getElementById('workspace').appendChild(wv);
  const view = { bookId: 'book-test', wv, model: { pages: [], toc: [] }, prefs: { viewMode: 'text' },
    pdfView: { currentPage: 7 }, textView: { currentPage: 7 }, applyPrefs() {} };
  app.state.tabs.push(view);
  app.state.books.push({ id: 'book-test', meta: { title: '测试书' } });
  await app.openBook('book-test');
  openSettings(); assert.equal(wv.hidden, true);
  paragraphTop = 170;
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.body.dataset.screen, 'settings');
  document.getElementById('settings-back').click();
  assert.equal(app.activeView(), view);
  assert.equal(wv.hidden, false);
  assert.equal(view.textView.currentPage, 7);
  assert.equal(panel.scrollTop, 120, '排版重新布局后保持原段落相对阅读视口的位置');
  assert.equal(document.body.dataset.screen, 'reading');
});

test('正文编辑草稿在设置往返期间保留，隐藏时不会被快捷键保存或关闭', async () => {
  const view = app.activeView();
  const book = app.state.books.find(b => b.id === view.bookId);
  book.bookJson = { pages: [{ pdf_page: 7, items: [{ type: 'body', text: '原文字' }] }] };
  book.bookmarks = [];
  document.querySelector('.editor-toggle').click();
  extensions.bus.emit('page:select', { bookId: book.id, page: 7 });
  const deadline = Date.now() + 1500;
  while (!document.querySelector('.page-editor-overlay') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  const overlay = document.querySelector('.page-editor-overlay');
  assert.ok(overlay);
  overlay.querySelector('[data-action="edit-item"]').click();
  const textarea = overlay.querySelector('textarea');
  textarea.value = '尚未保存的正文修改';
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  textarea.focus();
  openSettings();
  assert.equal(overlay.isConnected, true, '设置往返保留草稿 DOM');
  assert.equal(overlay.hidden, true, '编辑器在设置页暂时隐藏');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('.app-sheet'), null);
  assert.equal(book.bookJson.pages[0].items[0].text, '原文字');
  document.getElementById('settings-back').click();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(overlay.isConnected, true);
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.querySelector('textarea').value, '尚未保存的正文修改');
  assert.equal(document.activeElement, textarea);
  extensions.deactivateExtension('editor');
});

test('设置页面的浏览器查找快捷键不会聚焦隐藏的正文搜索', () => {
  openSettings();
  const shortcut = new window.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(shortcut);
  assert.equal(shortcut.defaultPrevented, false);
  assert.notEqual(document.activeElement.id, 'search-input');
});
