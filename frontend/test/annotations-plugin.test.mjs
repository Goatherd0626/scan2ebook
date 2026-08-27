import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div id="plugin-toolbar"></div>
  <div class="book-view" data-book="book-a">
    <div class="text-panel"><div class="text-content"></div></div>
  </div>
</body>`, { pretendToBeVisual: true, url: 'http://127.0.0.1:8765/' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.NodeFilter = window.NodeFilter;
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
window.HTMLElement.prototype.scrollTo = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};

class FakeHighlight {
  constructor(...ranges) { this.ranges = ranges; }
}
const highlights = new Map();
globalThis.Highlight = window.Highlight = FakeHighlight;
globalThis.CSS = window.CSS = { highlights };

const extensions = await import('../src/core/extensions.js');
const { TextView } = await import('../src/core/views.js');
await import('../src/plugins/annotations/index.js');

test('插件从选区创建高亮和注释，渲染段末标记并在停用时完整清理', async () => {
  extensions.ui.reset();
  extensions.setEnabled('annotations', true);
  let stored = [];
  const wv = document.querySelector('.book-view');
  const textView = new TextView(wv.querySelector('.text-panel'));
  textView.load({
    footnotes: [null], toc: [],
    pages: [{ pdf_page: 1, items: [{ type: 'body', text: 'Alpha beta gamma' }] }],
  }, { title: '标注测试' });
  const view = {
    bookId: 'book-a', wv, textView,
    prefs: { viewMode: 'text' },
    setPrefs(patch) { Object.assign(this.prefs, patch); },
  };
  const ctx = {
    bus: extensions.bus,
    ui: extensions.ui,
    db: {
      getAnnotations: async () => structuredClone(stored),
      replaceAnnotations: async (_bookId, records) => { stored = structuredClone(records); },
    },
    state: { activeBookId: 'book-a', tabs: [view], books: [{ id: 'book-a' }] },
    getView: () => view,
    toast: () => {},
    storage: { get: () => null, set: () => {} },
  };

  extensions.activateExtension('annotations', ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const toggle = document.querySelector('#plugin-toolbar .annotations-toggle');
  const sidebar = wv.querySelector('.annotations-sidebar');
  assert.ok(toggle);
  assert.ok(sidebar);
  assert.equal(sidebar.hidden, true);
  toggle.click();
  assert.equal(sidebar.hidden, false);
  const action = extensions.ui.registry.contextActions.find((item) => item.id === 'annotations-actions');
  assert.ok(action);
  const selection = {
    text: 'Alpha', quote: 'Alpha',
    range: { start: { page: 1, item: 0, offset: 0 }, end: { page: 1, item: 0, offset: 5 } },
  };

  let closed = 0;
  const colorMenu = action.render({ selection, view, close: () => { closed += 1; } });
  document.body.appendChild(colorMenu);
  colorMenu.querySelector('[data-color="yellow"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(stored.length, 1);
  assert.equal(stored[0].type, 'highlight');
  assert.equal(stored[0].color, 'yellow');
  assert.equal(highlights.get('s2e-highlight-yellow').ranges.length, 1);
  assert.equal(closed, 1);

  const noteMenu = action.render({ selection, view, close: () => { closed += 1; } });
  document.body.appendChild(noteMenu);
  assert.ok(noteMenu.querySelector('[data-action="remove-highlight"] .i-eraser'));
  assert.ok(noteMenu.querySelector('[data-action="note"] .i-annotate'));
  noteMenu.querySelector('[data-action="note"]').click();
  const editor = noteMenu.querySelector('textarea');
  editor.value = '重点概念';
  noteMenu.querySelector('[data-action="save-note"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(stored.filter((item) => item.type === 'note').length, 1);
  assert.equal(stored.find((item) => item.type === 'note').text, '重点概念');
  assert.equal(highlights.get('s2e-note').ranges.length, 1);
  assert.equal(wv.querySelectorAll('.annotations-marker').length, 1);
  const marker = wv.querySelector('.annotations-marker');
  assert.equal(marker.parentElement.classList.contains('item-content'), true);
  assert.equal(marker.previousSibling.textContent, 'Alpha');
  assert.equal(marker.nextSibling.textContent, ' beta gamma');
  assert.equal(sidebar.querySelectorAll('.annotations-card').length, 1);
  marker.click();
  assert.equal(sidebar.querySelector('.annotations-card').classList.contains('selected'), true);

  extensions.deactivateExtension('annotations');
  assert.equal(wv.querySelectorAll('.annotations-marker').length, 0);
  assert.equal(highlights.has('s2e-highlight-yellow'), false);
  assert.equal(highlights.has('s2e-note'), false);
  assert.equal(wv.querySelector('.annotations-sidebar'), null);
  assert.equal(document.querySelector('.annotations-toggle'), null);
  assert.equal(extensions.ui.registry.contextActions.some((item) => item.id === 'annotations-actions'), false);
  textView.destroy();
});
