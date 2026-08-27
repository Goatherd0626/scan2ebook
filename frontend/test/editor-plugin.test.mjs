import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div id="plugin-toolbar"></div>
  <div class="book-view"><div class="text-panel"></div></div>
</body>`, { pretendToBeVisual: true, url: 'http://127.0.0.1:8765/' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;

const extensions = await import('../src/core/extensions.js');
await import('../src/plugins/editor/index.js');

test('编辑模式按页增删 item，确认后原子保存并归档受影响注释', async () => {
  extensions.ui.reset();
  extensions.setEnabled('editor', true);
  const book = {
    id: 'book-a', meta: { title: '测试书' }, bookmarks: [{ id: 'bm', page: 1, snippet: '旧摘要', at: 1 }],
    bookJson: {
      toc: [{ text: '旧标题', level: 1, pdf_page: 1 }],
      pages: [{
        pdf_page: 1, page_kind: 'body',
        items: [{ type: 'body', text: '错误正文' }, { type: 'heading', level: 1, text: '旧标题' }],
      }],
    },
  };
  const records = [
    { id: 'h1', type: 'highlight', range: { start: { page: 1, item: 0, offset: 0 }, end: { page: 1, item: 0, offset: 2 } }, quote: '错误' },
    { id: 'n1', type: 'note', range: { start: { page: 1, item: 0, offset: 0 }, end: { page: 1, item: 0, offset: 2 } }, quote: '错误', text: '需要保留的注释' },
  ];
  let saved = null;
  let reloads = 0;
  let replacements = null;
  let confirms = 0;
  const hoverModes = [];
  const panel = document.querySelector('.text-panel');
  panel.getBoundingClientRect = () => ({ left: 400, top: 50, width: 600, height: 700, right: 1000, bottom: 750 });
  const view = {
    bookId: 'book-a', wv: document.querySelector('.book-view'),
    textView: { setSourcePreviewOnHover: (on) => hoverModes.push(on) },
    reloadContent: () => { reloads += 1; },
  };
  const ctx = {
    bus: extensions.bus,
    ui: extensions.ui,
    state: { activeBookId: 'book-a', books: [book], tabs: [view] },
    getView: () => view,
    db: {
      getAnnotations: async () => structuredClone(records),
      updateBookAndAnnotations: async (nextBook, nextRecords) => {
        saved = { book: structuredClone(nextBook), records: structuredClone(nextRecords) };
      },
    },
    toast: () => {},
    dialog: { confirm: async () => { confirms += 1; return true; } },
  };
  const offReplace = extensions.bus.on('annotations:replace', (payload) => { replacements = payload.records; });
  extensions.activateExtension('editor', ctx);

  const toggle = document.querySelector('.editor-toggle');
  assert.ok(toggle);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(hoverModes.at(-1), true);
  assert.match(document.querySelector('.editor-mode-banner')?.textContent || '', /选择一页进行编辑/);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(document.querySelector('.editor-mode-banner'), null);
  toggle.click();
  extensions.bus.emit('page:select', { bookId: 'book-a', page: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const editor = document.querySelector('.page-editor-dialog');
  assert.ok(editor);
  assert.equal(editor.querySelectorAll('.page-editor-item').length, 2);
  assert.match(editor.querySelector('.page-editor-impact').textContent, /1 处高亮.*1 条注释/);
  editor.querySelector('.page-editor-item [data-action="delete-item"]').click();
  editor.querySelector('[data-action="add-item"]').click();
  const added = editor.querySelector('.page-editor-item:last-of-type');
  added.querySelector('textarea').value = '修正后的正文';
  added.querySelector('textarea').dispatchEvent(new window.Event('input', { bubbles: true }));
  editor.querySelector('[data-action="save-page"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(confirms, 1);
  assert.deepEqual(saved.book.bookJson.pages[0].items, [
    { type: 'heading', level: 1, text: '旧标题' },
    { type: 'body', text: '修正后的正文' },
  ]);
  assert.deepEqual(saved.records.map((record) => record.type), ['history-note']);
  assert.equal(saved.records[0].text, '需要保留的注释');
  assert.equal(saved.book.bookmarks[0].snippet, '旧标题 修正后的正文');
  assert.equal(replacements.length, 1);
  assert.equal(reloads, 1);
  assert.equal(document.querySelector('.page-editor-overlay'), null);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', '保存一次后应自动退出编辑模式');
  assert.equal(hoverModes.at(-1), false);

  extensions.deactivateExtension('editor');
  offReplace();
});
