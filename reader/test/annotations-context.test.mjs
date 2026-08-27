import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.innerWidth = 800;
Object.defineProperties(window.HTMLElement.prototype, {
  offsetWidth: { configurable: true, get() { return this.id === 'ctxbar' ? 180 : 0; } },
  offsetHeight: { configurable: true, get() { return this.id === 'ctxbar' ? 34 : 0; } },
});

const { ui } = await import('../src/core/extensions.js');
const { hideContextBar, showContextBar, state } = await import('../src/core/app.js');

test('富选区扩展可以渲染交互内容且点击浮窗内部不会被提前关闭', async () => {
  ui.reset();
  state.activeBookId = 'book-a';
  state.tabs = [{ bookId: 'book-a' }];
  let received = null;
  const remove = ui.addContextAction({
    id: 'rich-probe',
    render({ selection, view, close }) {
      received = { selection, view };
      const button = document.createElement('button');
      button.className = 'rich-action';
      button.textContent = '添加注释';
      button.addEventListener('click', close);
      return button;
    },
  });
  const selection = {
    text: '原文', quote: '原文',
    range: { start: { page: 1, item: 0, offset: 0 }, end: { page: 1, item: 0, offset: 2 } },
    rect: { left: 30, top: 80 },
  };

  showContextBar(selection);

  const action = document.querySelector('#ctxbar .rich-action');
  assert.ok(action);
  assert.equal(received.selection, selection);
  assert.equal(received.view.bookId, 'book-a');
  action.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.ok(document.getElementById('ctxbar'));

  action.click();
  assert.equal(document.getElementById('ctxbar'), null);
  remove();
  hideContextBar();
});

test('选区浮板从首字位置开始并只在贴近屏幕边缘时偏置', () => {
  ui.reset();
  const remove = ui.addContextAction({
    id: 'position-probe',
    render() { return document.createElement('button'); },
  });

  showContextBar({ text: '原文', rect: { left: 750, top: 100, bottom: 120 } });
  const bar = document.getElementById('ctxbar');
  assert.equal(bar.style.left, '612px');
  assert.equal(bar.style.top, '58px');
  remove();
  hideContextBar();
});
