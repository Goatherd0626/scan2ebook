import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div class="text-panel"><div class="text-content"></div></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollTo = function () {};
dom.window.HTMLElement.prototype.scrollIntoView = function () {};

const { TextView } = await import('../src/core/views.js');
const { revealPdfSource } = await import('../src/core/app.js');

test('figure and table render in source order and emit their parent PDF page', () => {
  const events = [];
  const panel = document.querySelector('.text-panel');
  const view = new TextView(panel, { onSourceObject: (event) => events.push(event) });
  view.load({
    pages: [{
      pdf_page: 7,
      items: [
        { type: 'body', text: '图前正文。' },
        { type: 'figure' },
        { type: 'body', text: '表前正文。' },
        { type: 'table' },
      ],
    }],
    footnotes: [null],
    toc: [],
  }, { title: '测试书' });

  const placeholders = [...panel.querySelectorAll('button.source-object')];
  assert.deepEqual(placeholders.map((el) => el.dataset.type), ['figure', 'table']);
  assert.deepEqual(placeholders.map((el) => el.dataset.page), ['7', '7']);
  assert.match(placeholders[0].textContent, /原文有图片/);
  assert.match(placeholders[1].textContent, /原文有表格/);

  placeholders[0].click();
  placeholders[1].click();
  assert.deepEqual(events, [
    { type: 'figure', page: 7 },
    { type: 'table', page: 7 },
  ]);
});

test('text-only source reveal switches to split before jumping to PDF', async () => {
  const events = [];
  const view = {
    prefs: { viewMode: 'text' },
    setPrefs(patch) {
      Object.assign(this.prefs, patch);
      events.push('mode:' + patch.viewMode);
    },
    pdfPromise: Promise.resolve(),
    pdfView: { gotoPage: (page) => events.push('pdf:' + page) },
  };

  await revealPdfSource(view, 12);
  assert.deepEqual(events, ['mode:split', 'pdf:12']);
});

test('split source reveal jumps directly without changing mode', async () => {
  const events = [];
  const view = {
    prefs: { viewMode: 'split' },
    setPrefs: () => events.push('unexpected-mode-change'),
    pdfPromise: Promise.resolve(),
    pdfView: { gotoPage: (page) => events.push('pdf:' + page) },
  };

  await revealPdfSource(view, 9);
  assert.deepEqual(events, ['pdf:9']);
});

test('sync-enabled source reveal does not scroll the text pane', async () => {
  const events = [];
  const view = {
    prefs: { viewMode: 'split', sync: true },
    textView: { scrollToPage: (page) => events.push('text:' + page) },
    pdfPromise: Promise.resolve(),
  };
  view.pdfView = {
    gotoPage(page) {
      events.push('pdf:' + page);
      if (view.prefs.sync && !view.suppressTextSync) view.textView.scrollToPage(page);
    },
  };

  await revealPdfSource(view, 4);
  assert.deepEqual(events, ['pdf:4']);
});
