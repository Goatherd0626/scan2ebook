import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'index.html'), 'utf8'), {
  url: 'http://127.0.0.1:8765/',
  pretendToBeVisual: true,
});
const { window } = dom;

window.indexedDB = indexedDB;
globalThis.window = window;
globalThis.document = window.document;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
globalThis.NodeFilter = window.NodeFilter;
globalThis.HTMLElement = window.HTMLElement;
globalThis.File = window.File;
window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
globalThis.IntersectionObserver = window.IntersectionObserver;

function pointerEvent(type, clientX, pointerId = 1) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  });
  return event;
}

function splitHarness() {
  const view = document.createElement('div');
  view.className = 'book-view';
  view.innerHTML = `
    <div class="pdf-panel"></div>
    <div class="divider" role="separator" tabindex="0">
      <button class="jump" type="button">跳转</button>
    </div>
    <div class="text-panel"></div>`;
  view.getBoundingClientRect = () => ({ left: 100, width: 1000, right: 1100, top: 0, bottom: 600, height: 600 });
  const divider = view.querySelector('.divider');
  divider.setPointerCapture = () => {};
  divider.releasePointerCapture = () => {};
  document.body.appendChild(view);
  return { view, divider, button: divider.querySelector('button') };
}

test('侧边栏拖动时限制宽度、松手后保存，双击恢复默认宽度', async () => {
  localStorage.setItem('s2e-sidebar-width', '320');
  await import('../src/plugins/index.js');
  const { init } = await import('../src/core/app.js');
  await init();

  const rootStyle = document.documentElement.style;
  const handle = document.getElementById('sidebar-resizer');
  assert.ok(handle, '阅读器应创建侧边栏拖拽柄');
  handle.setPointerCapture = () => {};
  handle.releasePointerCapture = () => {};

  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '320px');

  handle.dispatchEvent(pointerEvent('pointerdown', 320));
  document.dispatchEvent(pointerEvent('pointermove', 410));
  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '410px');
  document.dispatchEvent(pointerEvent('pointerup', 410));
  assert.equal(localStorage.getItem('s2e-sidebar-width'), '410');

  handle.dispatchEvent(pointerEvent('pointerdown', 410, 2));
  document.dispatchEvent(pointerEvent('pointermove', 40, 2));
  document.dispatchEvent(pointerEvent('pointerup', 40, 2));
  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '180px');

  handle.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '264px');
  assert.equal(localStorage.getItem('s2e-sidebar-width'), '264');

  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '274px');
  assert.equal(localStorage.getItem('s2e-sidebar-width'), '274');

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '180px');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(rootStyle.getPropertyValue('--sbar-w'), '274px');
});

test('双栏分割线实时调整比例、限制最小栏宽并在松手时提交', async () => {
  const layoutResize = await import('../src/core/layout_resize.js');
  const { view, divider } = splitHarness();
  const commits = [];
  const cleanup = layoutResize.initSplitResizer?.({
    view,
    divider,
    initialRatio: 0.5,
    onCommit: (ratio) => commits.push(ratio),
  }) || (() => {});

  divider.dispatchEvent(pointerEvent('pointerdown', 600, 10));
  document.dispatchEvent(pointerEvent('pointermove', 800, 10));
  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 70);
  assert.deepEqual(commits, [], '拖动中不应持久化');
  document.dispatchEvent(pointerEvent('pointerup', 800, 10));
  assert.deepEqual(commits, [0.7]);

  divider.dispatchEvent(pointerEvent('pointerdown', 800, 11));
  document.dispatchEvent(pointerEvent('pointermove', 1050, 11));
  document.dispatchEvent(pointerEvent('pointerup', 1050, 11));
  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 76);
  assert.equal(commits.at(-1), 0.76);

  cleanup();
  view.remove();
});

test('打开右侧标注栏后双栏比例按剩余阅读区计算', async () => {
  const { initSplitResizer } = await import('../src/core/layout_resize.js');
  const { view, divider } = splitHarness();
  const commits = [];
  const cleanup = initSplitResizer({
    view,
    divider,
    initialRatio: 0.5,
    getRightInset: () => 300,
    onCommit: (ratio) => commits.push(ratio),
  });

  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 35);
  divider.dispatchEvent(pointerEvent('pointerdown', 450, 12));
  document.dispatchEvent(pointerEvent('pointermove', 520, 12));
  document.dispatchEvent(pointerEvent('pointerup', 520, 12));
  assert.equal(commits.at(-1), 0.6);
  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 42);

  cleanup();
  view.remove();
});

test('双栏跳转按钮不触发拖动，双击与键盘可以调整分割线', async () => {
  const layoutResize = await import('../src/core/layout_resize.js');
  const { view, divider, button } = splitHarness();
  const commits = [];
  const cleanup = layoutResize.initSplitResizer?.({
    view,
    divider,
    initialRatio: 0.6,
    onCommit: (ratio) => commits.push(ratio),
  }) || (() => {});

  button.dispatchEvent(pointerEvent('pointerdown', 700, 20));
  document.dispatchEvent(pointerEvent('pointermove', 900, 20));
  document.dispatchEvent(pointerEvent('pointerup', 900, 20));
  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 60);
  assert.deepEqual(commits, []);

  divider.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 50);
  divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(parseFloat(view.style.getPropertyValue('--pdf-ratio')), 52);
  assert.deepEqual(commits, [0.5, 0.52]);

  cleanup();
  view.remove();
});

test('阅读器按书保存双栏比例，视图切换后中缝和跳转按钮保持对应位置', async () => {
  const { openBook, state } = await import('../src/core/app.js');
  const book = {
    id: 'resize-book',
    s2eName: '布局测试',
    importedAt: Date.now(),
    folderId: null,
    meta: { title: '布局测试' },
    bookJson: {
      toc: [],
      pages: [{ pdf_page: 1, page_kind: 'body', items: [{ type: 'body', text: '正文' }] }],
    },
    pdfBlob: { arrayBuffer: () => new Promise(() => {}) },
    bookmarks: [],
    progress: null,
    prefs: { viewMode: 'split', spread: false, sync: false, splitRatio: 0.65 },
  };
  state.books.push(book);
  await openBook(book.id);

  const view = state.tabs.find((item) => item.bookId === book.id);
  const divider = view.wv.querySelector('.divider');
  divider.setPointerCapture = () => {};
  divider.releasePointerCapture = () => {};
  view.wv.getBoundingClientRect = () => ({ left: 0, width: 1000, right: 1000, top: 0, bottom: 600, height: 600 });

  assert.equal(parseFloat(view.wv.style.getPropertyValue('--pdf-ratio')), 65);
  assert.equal(divider.getAttribute('role'), 'separator');
  assert.deepEqual(
    [...divider.querySelectorAll(':scope > button.jump')].map((button) => button.dataset.dir),
    ['text', 'pdf'],
    '恢复上一版纵向双向跳转按钮顺序',
  );

  divider.dispatchEvent(pointerEvent('pointerdown', 650, 30));
  document.dispatchEvent(pointerEvent('pointermove', 700, 30));
  document.dispatchEvent(pointerEvent('pointerup', 700, 30));
  assert.equal(book.prefs.splitRatio, 0.7);

  view.setPrefs({ viewMode: 'pdf' });
  view.setPrefs({ viewMode: 'split' });
  assert.equal(parseFloat(view.wv.style.getPropertyValue('--pdf-ratio')), 70);
  assert.equal(divider.querySelectorAll(':scope > button.jump').length, 2);
});
