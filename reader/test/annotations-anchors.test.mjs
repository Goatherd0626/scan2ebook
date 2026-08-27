import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body>
  <div class="text-panel"><div class="text-content"></div></div>
</body>`, { pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.NodeFilter = window.NodeFilter;
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
window.HTMLElement.prototype.scrollTo = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};

const { resolveAnchor, selectionToAnchor } = await import('../src/core/text_anchor.js');
const { TextView } = await import('../src/core/views.js');

function loadView(onSelection = () => {}) {
  const panel = document.querySelector('.text-panel');
  const view = new TextView(panel, { onSelection });
  view.load({
    footnotes: [null], toc: [], pages: [
      { pdf_page: 1, items: [{ type: 'body', text: 'Alpha beta' }] },
      { pdf_page: 2, items: [{ type: 'body', text: 'Gamma delta' }] },
    ],
  }, { title: '锚点测试' });
  return view;
}

test('跨 item 选区序列化为稳定的页码、item 和字符偏移并可恢复', () => {
  const view = loadView();
  const first = view.itemEls.get('1:0').querySelector('.item-content').firstChild;
  const second = view.itemEls.get('2:0').querySelector('.item-content').firstChild;
  const nativeRange = document.createRange();
  nativeRange.setStart(first, 2);
  nativeRange.setEnd(second, 5);
  const selection = { rangeCount: 1, getRangeAt: () => nativeRange, toString: () => nativeRange.toString() };

  const anchor = selectionToAnchor(selection);

  assert.deepEqual(anchor.range, {
    start: { page: 1, item: 0, offset: 2 },
    end: { page: 2, item: 0, offset: 5 },
  });
  assert.equal(anchor.quote, nativeRange.toString());
  assert.equal(resolveAnchor(view, anchor.range).toString(), nativeRange.toString());
  view.destroy();
});

test('TextView 选区事件直接携带稳定锚点', () => {
  let payload = null;
  const view = loadView((selection) => { payload = selection; });
  const text = view.itemEls.get('1:0').querySelector('.item-content').firstChild;
  const nativeRange = document.createRange();
  nativeRange.setStart(text, 1);
  nativeRange.setEnd(text, 6);
  nativeRange.getBoundingClientRect = () => ({ left: 10, top: 20, right: 40, bottom: 30 });
  nativeRange.getClientRects = () => [{ left: 72, top: 44, right: 88, bottom: 62 }];
  window.getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: text,
    focusNode: text,
    getRangeAt: () => nativeRange,
    toString: () => nativeRange.toString(),
  });

  view._onSelection({});

  assert.deepEqual(payload.range, {
    start: { page: 1, item: 0, offset: 1 },
    end: { page: 1, item: 0, offset: 6 },
  });
  assert.equal(payload.quote, 'lpha ');
  assert.equal(payload.rect.left, 72, '浮板应锚定选区第一个文字，而不是合并后的选区外框');
  view.destroy();
});

test('脚注交互展开内容不改变后方文字的持久化偏移', () => {
  const item = document.createElement('p');
  item.className = 'text-item';
  item.dataset.page = '5';
  item.dataset.item = '5:2';
  item.innerHTML = 'Alpha<sup class="fnref" data-source-length="3">1</sup><span class="fn-inline">脚注展开</span>omega';
  document.body.appendChild(item);
  const alpha = item.firstChild;
  const omega = item.lastChild;
  const nativeRange = document.createRange();
  nativeRange.setStart(alpha, 0);
  nativeRange.setEnd(omega, 5);

  const anchor = selectionToAnchor({
    rangeCount: 1,
    getRangeAt: () => nativeRange,
  });

  assert.equal(anchor.range.end.offset, 13, 'Alpha(5) + 原脚注标记(3) + omega(5)');
  const restored = resolveAnchor({ itemEls: new Map([['5:2', item]]) }, anchor.range);
  assert.equal(restored.endContainer, omega);
  assert.equal(restored.endOffset, 5);
  item.remove();
});
