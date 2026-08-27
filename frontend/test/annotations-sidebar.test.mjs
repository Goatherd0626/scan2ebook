import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><button id="outside-focus">正文区域</button><div class="book-view"></div></body>', {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:8765/',
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
window.HTMLElement.prototype.scrollIntoView = function () {};

const { createAnnotationsSidebar } = await import('../src/plugins/annotations/sidebar.js');

const range = (page, start, end) => ({
  start: { page, item: 0, offset: start },
  end: { page, item: 0, offset: end },
});

const records = [
  { id: 'n3', type: 'note', range: range(3, 0, 3), quote: '第三处原文', text: '第三条注释' },
  { id: 'h-blue', type: 'highlight', range: range(2, 4, 8), quote: '蓝色重点', color: 'blue' },
  { id: 'n1', type: 'note', range: range(1, 0, 3), quote: '第一处原文', text: '第一条注释' },
  { id: 'h-yellow', type: 'highlight', range: range(1, 4, 8), quote: '黄色重点', color: 'yellow' },
  { id: 'n2', type: 'note', range: range(2, 0, 3), quote: '第二处原文', text: '第二条注释' },
  { id: 'history-1', type: 'history-note', page: 1, quote: '已修改的原文', text: '历史注释内容', archivedAt: 1 },
];

test('注释按正文顺序排列，支持连续多选并异步确认批量删除', async () => {
  const view = { wv: document.querySelector('.book-view') };
  let deleted = null;
  let batchHighlighted = null;
  let batchCleared = null;
  let historyCleared = 0;
  let confirms = 0;
  let resolveConfirm;
  const sidebar = createAnnotationsSidebar({
    view,
    records,
    onDelete(ids) { deleted = ids; },
    onSetHighlights(selectedRecords, color) {
      batchHighlighted = { ids: selectedRecords.map((record) => record.id), color };
    },
    onRemoveHighlights(selectedRecords) {
      batchCleared = selectedRecords.map((record) => record.id);
    },
    onClearHistory() { historyCleared += 1; },
    confirmDelete(count) {
      confirms += 1;
      assert.equal(count, 3);
      return new Promise((resolve) => { resolveConfirm = resolve; });
    },
  });
  sidebar.setVisible(true);

  const cards = [...view.wv.querySelectorAll('.annotations-card')];
  assert.deepEqual(cards.map((card) => card.dataset.id), ['n1', 'n2', 'n3']);
  assert.match(view.wv.querySelector('.annotations-history-section').textContent, /因编辑正文消失的历史注释/);
  assert.match(view.wv.querySelector('.annotations-history-card').textContent, /历史注释内容/);
  view.wv.querySelector('.annotations-history-clear').click();
  assert.equal(historyCleared, 1);
  cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  let popover = view.wv.querySelector('.annotations-card-popover');
  assert.ok(popover);
  assert.ok(popover.querySelector('[data-action="jump"] .i-popover-jump'));
  assert.ok(popover.querySelector('[data-action="copy"] .i-popover-copy'));
  assert.ok(popover.querySelector('[data-action="remove-highlight"] .i-popover-eraser'));
  assert.ok(popover.querySelector('[data-action="delete"] .i-popover-trash'));
  assert.equal(popover.querySelector('[data-action="edit"]'), null);

  cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(view.wv.querySelector('.annotations-card-popover'), null, '再次单击同一注释应关闭浮板');
  cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  view.wv.querySelector('.annotations-list').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(view.wv.querySelector('.annotations-card-popover'), null, '单击侧栏空白处应关闭浮板');

  cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  cards[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(view.wv.querySelectorAll('.annotations-card.selected').length, 3);
  const multi = view.wv.querySelector('.annotations-multi');
  assert.ok(multi.querySelector('[data-action="delete-selected"] .i-popover-trash'));
  assert.ok(multi.querySelector('[data-action="remove-highlights"] .i-popover-eraser'));
  multi.querySelector('[data-color="blue"]').click();
  assert.deepEqual(batchHighlighted, { ids: ['n1', 'n2', 'n3'], color: 'blue' });
  multi.querySelector('[data-action="remove-highlights"]').click();
  assert.deepEqual(batchCleared, ['n1', 'n2', 'n3']);

  view.wv.querySelector('.annotations-sidebar').dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Delete', bubbles: true,
  }));
  assert.equal(confirms, 1);
  assert.equal(deleted, null, '异步确认完成前不能删除');
  resolveConfirm(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(deleted, ['n1', 'n2', 'n3']);
  sidebar.destroy();
});

test('高亮视图支持颜色筛选、栏内搜索和点击跳转', () => {
  const view = { wv: document.querySelector('.book-view') };
  let jumped = null;
  const sidebar = createAnnotationsSidebar({
    view,
    records,
    onJump(record) { jumped = record.id; },
  });
  sidebar.setVisible(true);
  view.wv.querySelector('[data-mode="highlights"]').click();
  assert.deepEqual(
    [...view.wv.querySelectorAll('.annotations-card')].map((card) => card.dataset.id),
    ['h-yellow', 'h-blue'],
  );

  view.wv.querySelector('[data-color="yellow"]').click();
  assert.deepEqual(
    [...view.wv.querySelectorAll('.annotations-card')].map((card) => card.dataset.id),
    ['h-yellow'],
  );
  view.wv.querySelector('[data-color="yellow"]').click();

  const aside = view.wv.querySelector('.annotations-sidebar');
  document.getElementById('outside-focus').focus();
  aside.querySelector('.annotations-list').dispatchEvent(new window.MouseEvent('pointerdown', {
    bubbles: true, button: 0,
  }));
  assert.equal(aside.contains(document.activeElement), true, '单击注释栏空白处应把焦点移入注释栏');
  aside.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'f', metaKey: true, bubbles: true, cancelable: true,
  }));
  const input = aside.querySelector('.annotations-search-input');
  assert.equal(input.closest('.annotations-search').hidden, false);
  let leakedToGlobalSearch = 0;
  const globalSearchProbe = (event) => { leakedToGlobalSearch += 1; event.preventDefault(); };
  document.addEventListener('keydown', globalSearchProbe);
  const outside = document.getElementById('outside-focus');
  outside.focus();
  const outsideFind = new window.KeyboardEvent('keydown', {
    key: 'f', metaKey: true, bubbles: true, cancelable: true,
  });
  outside.dispatchEvent(outsideFind);
  assert.equal(leakedToGlobalSearch, 1, '焦点离开注释栏后应交给全局搜索');

  input.focus();
  const insideFind = new window.KeyboardEvent('keydown', {
    key: 'f', metaKey: true, bubbles: true, cancelable: true,
  });
  input.dispatchEvent(insideFind);
  assert.equal(insideFind.defaultPrevented, true);
  assert.equal(leakedToGlobalSearch, 1, '焦点回到注释栏后不应触发全局搜索');
  assert.equal(document.activeElement, input);
  document.removeEventListener('keydown', globalSearchProbe);
  input.value = '重点';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(aside.querySelector('.annotations-card.search-current')?.dataset.id, 'h-yellow');
  aside.querySelector('[data-search="next"]').click();
  const result = aside.querySelector('.annotations-card.search-current');
  assert.equal(result.dataset.id, 'h-blue');
  result.click();
  const highlightPopover = aside.querySelector('.annotations-card-popover');
  assert.ok(highlightPopover);
  assert.ok(highlightPopover.querySelector('[data-action="jump"]'));
  assert.ok(highlightPopover.querySelector('[data-action="copy"]'));
  assert.equal(highlightPopover.querySelectorAll('.annotations-color').length, 5);
  assert.ok(highlightPopover.querySelector('[data-action="remove-highlight"]'));
  assert.equal(highlightPopover.querySelector('[data-action="delete"]'), null);
  highlightPopover.querySelector('[data-action="jump"]').click();
  assert.equal(jumped, 'h-blue');
  sidebar.destroy();
});

test('右侧栏宽度拖动时限制范围并记忆', () => {
  const view = { wv: document.querySelector('.book-view') };
  view.wv.getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000 });
  const sidebar = createAnnotationsSidebar({ view, records: [] });
  sidebar.setVisible(true);
  const aside = view.wv.querySelector('.annotations-sidebar');
  const resizer = aside.querySelector('.annotations-resizer');

  resizer.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 680 }));
  document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 550 }));
  document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 550 }));

  assert.equal(aside.style.width, '450px');
  assert.equal(localStorage.getItem('s2e-annotations-width'), '450');
  sidebar.destroy();
});
