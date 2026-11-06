import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { shellHtml } from './fixtures/shell.mjs';

const { window } = new JSDOM(shellHtml, { url: 'http://127.0.0.1:8765/', pretendToBeVisual: true });
Object.assign(globalThis, {
  window, document: window.document, indexedDB, IDBKeyRange,
  location: window.location, localStorage: window.localStorage,
  HTMLElement: window.HTMLElement, NodeFilter: window.NodeFilter, File: window.File,
});
globalThis.IntersectionObserver = window.IntersectionObserver = class { observe() {} disconnect() {} };
const narrow = new window.EventTarget();
narrow.matches = false;
window.matchMedia = (query) => query.includes('920px') ? narrow : { matches: false };
await import('../src/plugins/index.js');
const { init } = await import('../src/core/app.js');

test('从桌面缩到窄屏时收起侧栏，避免遮住正文与转换按钮', async () => {
  await init();
  assert.equal(document.body.classList.contains('sidebar-hidden'), false);
  document.getElementById('nav-convert').focus();
  narrow.matches = true;
  const change = new window.Event('change');
  Object.assign(change, { matches: true });
  narrow.dispatchEvent(change);
  assert.equal(document.body.classList.contains('sidebar-hidden'), true);
  assert.equal(document.getElementById('btn-library').getAttribute('aria-pressed'), 'false');
  assert.equal(document.activeElement.id, 'btn-library');
});

test('阅读工具展开后键盘进入搜索，Escape 关闭并恢复触发按钮', () => {
  document.body.dataset.screen = 'reading';
  const trigger = document.getElementById('btn-reader-tools');
  trigger.focus();
  trigger.click();
  assert.equal(document.activeElement.id, 'search-input');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
});
