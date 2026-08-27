import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div id="plugin-toolbar"></div>
  <div class="text-content">
    <div class="page-anchor" data-page="2"><p class="body">目标 A，目标 B。</p></div>
    <div class="page-anchor" data-page="3"><p class="body">目标 C。</p></div>
  </div>
</body>`, { pretendToBeVisual: true, url: 'http://127.0.0.1:8765/' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.NodeFilter = window.NodeFilter;
window.HTMLElement.prototype.scrollIntoView = function () {};

const extensions = await import('../src/core/extensions.js');
await import('../src/plugins/search/index.js');

test('正文搜索按正文顺序保留同一段内的全部命中', () => {
  extensions.ui.reset();
  extensions.setEnabled('search', true);
  const holder = document.querySelector('.text-content');
  const ctx = {
    bus: extensions.bus,
    ui: extensions.ui,
    state: { activeBookId: 'book-a', books: [], folders: [] },
    getView: () => ({ textView: { holder } }),
    openBook: () => {},
  };
  extensions.activateExtension('search', ctx);
  const input = document.getElementById('search-input');
  input.value = '目标';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  const hits = [...holder.querySelectorAll('mark.hit')];
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((hit) => hit.closest('.page-anchor').dataset.page), ['2', '2', '3']);

  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(holder.querySelector('mark.hit.current'), hits[0]);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(holder.querySelector('mark.hit.current'), hits[1]);
  extensions.deactivateExtension('search');
});
