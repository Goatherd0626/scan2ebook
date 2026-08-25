import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'index.html'), 'utf8'), {
  url: 'http://127.0.0.1:8765/',
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.NodeFilter = window.NodeFilter;
globalThis.HTMLElement = window.HTMLElement;

const extensions = await import('../src/core/extensions.js');
await import('../src/plugins/index.js');

const {
  activateExtension,
  bus,
  deactivateExtension,
  registerExtension,
  setEnabled,
  ui,
} = extensions;

function pluginContext(updateBook = async () => {}) {
  return {
    bus,
    ui,
    db: { updateBook },
    state: {
      activeBookId: null,
      books: [{ id: 'book-1', progress: null }],
      folders: [],
      tabs: [],
    },
    getView: () => null,
    openBook: async () => {},
    toast: () => {},
    storage: {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
    },
  };
}

function setPluginOn(id, on, ctx) {
  setEnabled(id, on);
  if (on) activateExtension(id, ctx);
  else deactivateExtension(id);
}

test('UI 扩展点返回注销函数并立即移除注册内容', () => {
  ui.reset();
  const button = document.createElement('button');
  const dispose = ui.addToolbarWidget({ id: 'probe-widget', el: button });

  assert.equal(document.querySelectorAll('#plugin-toolbar > button').length, 1);
  dispose();
  assert.equal(document.querySelectorAll('#plugin-toolbar > button').length, 0);
});

test('插件停用执行 activate 返回的清理函数，重复停用不会重复清理', () => {
  let activations = 0;
  let cleanups = 0;
  registerExtension({
    id: 'lifecycle-probe',
    name: '生命周期探针',
    activate() {
      activations += 1;
      return () => { cleanups += 1; };
    },
  });
  const ctx = pluginContext();

  setPluginOn('lifecycle-probe', true, ctx);
  activateExtension('lifecycle-probe', ctx);
  assert.equal(activations, 1, '已激活插件不应重复激活');

  setPluginOn('lifecycle-probe', false, ctx);
  deactivateExtension('lifecycle-probe');
  assert.equal(cleanups, 1, '清理函数只应执行一次');

  setPluginOn('lifecycle-probe', true, ctx);
  assert.equal(activations, 2, '停用后应允许再次激活');
  setPluginOn('lifecycle-probe', false, ctx);
});

test('注册表拒绝非法或重复的插件 id', () => {
  assert.throws(
    () => registerExtension({ id: 'Bad ID' }),
    /小写字母、数字或连字符/,
  );
  registerExtension({ id: 'unique-probe' });
  assert.throws(
    () => registerExtension({ id: 'unique-probe' }),
    /已注册/,
  );
});

test('现有插件停用后清理 DOM、事件和待执行进度保存，并可无重复地重新启用', async () => {
  ui.reset();
  let progressWrites = 0;
  const ctx = pluginContext(async () => { progressWrites += 1; });
  const pluginIds = ['footnotes', 'search', 'bookmarks', 'eyecare', 'progress'];

  for (const id of pluginIds) setPluginOn(id, true, ctx);
  assert.equal(document.querySelectorAll('#search-wrap').length, 1);
  assert.equal(document.querySelectorAll('#find-strip').length, 1);
  assert.equal(document.querySelectorAll('#tab-body-bookmarks').length, 1);
  assert.equal(document.querySelectorAll('#eyecare-panel').length, 1);

  const body = document.createElement('p');
  body.className = 'body';
  body.textContent = '正文⟦1⟧';
  const holder = document.createElement('div');
  holder.appendChild(body);
  document.body.appendChild(holder);
  const footnoteModel = {
    footnotes: [
      null,
      { id: 1, page: 1, text: '脚注' },
      { id: 2, page: 2, text: '孤立脚注' },
    ],
  };
  ctx.state.tabs.push({ textView: { holder }, model: footnoteModel });
  bus.emit('item:render', {
    el: body,
    item: { type: 'body' },
    model: footnoteModel,
  });
  assert.equal(body.querySelectorAll('sup.fnref').length, 1);

  const pageAnchor = document.createElement('div');
  pageAnchor.className = 'page-anchor';
  pageAnchor.dataset.page = '2';
  holder.appendChild(pageAnchor);
  bus.emit('page:render', { page: 2, anchor: pageAnchor, model: footnoteModel });
  const orphan = pageAnchor.querySelector('.fn-orphan');
  assert.ok(orphan);
  assert.equal(orphan.classList.contains('text-item'), true);
  assert.equal(orphan.dataset.page, '2');
  assert.equal(orphan.dataset.item, '2:footnotes');

  bus.emit('text:scroll', { bookId: 'book-1', page: 8 });
  for (const id of pluginIds) setPluginOn(id, false, ctx);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(progressWrites, 0, '停用进度插件应取消待执行的保存');
  assert.equal(document.querySelectorAll('#search-wrap, #find-strip, #search-drop').length, 0);
  assert.equal(document.querySelectorAll('#tab-body-bookmarks').length, 0);
  assert.equal(document.querySelectorAll('#eyecare-panel').length, 0);
  assert.equal(body.querySelectorAll('sup.fnref').length, 0);
  assert.match(body.textContent, /⟦1⟧/);

  for (const id of pluginIds) setPluginOn(id, true, ctx);
  assert.equal(document.querySelectorAll('#search-wrap').length, 1);
  assert.equal(document.querySelectorAll('#find-strip').length, 1);
  assert.equal(document.querySelectorAll('#tab-body-bookmarks').length, 1);
  assert.equal(document.querySelectorAll('#eyecare-panel').length, 1);
  assert.equal(body.querySelectorAll('sup.fnref').length, 1);

  for (const id of pluginIds) setPluginOn(id, false, ctx);
  holder.remove();
});
