import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>
  <div class="text-panel"><div class="text-content"></div></div>
</body></html>`, { pretendToBeVisual: true });

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.NodeFilter = window.NodeFilter;
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
window.HTMLElement.prototype.scrollTo = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};

const { buildRenderModel, TextView } = await import('../src/core/views.js');

function modelWithContinuation() {
  return buildRenderModel({
    toc: [],
    pages: [
      {
        pdf_page: 1,
        page_kind: 'body',
        items: [
          { type: 'heading', level: 1, text: '第一章' },
          { type: 'body', text: '前一段。' },
          { type: 'body', text: '这个自然段从第一页开始' },
        ],
      },
      {
        pdf_page: 2,
        page_kind: 'body',
        items: [
          { type: 'body', text: '并在第二页直接接续结束。' },
          { type: 'body', text: '第二页的新段落。' },
        ],
      },
    ],
  });
}

test('跨页启发式同时标记前后片段，文字视图不再渲染页码横幅和续页文字', () => {
  const model = modelWithContinuation();
  const previous = model.pages[0].items.at(-1);
  const continued = model.pages[1].items[0];
  assert.equal(previous._continues, true);
  assert.equal(continued._continued, true);

  const panel = document.querySelector('.text-panel');
  const view = new TextView(panel);
  view.load(model, { title: '测试书' });

  assert.equal(panel.querySelectorAll('.page-banner').length, 0);
  assert.doesNotMatch(panel.textContent, /PDF 第|续上页/);

  const previousEl = view.itemEls.get('1:2');
  const continuedEl = view.itemEls.get('2:0');
  assert.equal(previousEl.classList.contains('_continues'), true);
  assert.equal(continuedEl.classList.contains('_continued'), true);
  assert.ok(previousEl.querySelector(':scope > .item-content'));
  assert.ok(continuedEl.querySelector(':scope > .item-content'));
  assert.equal(window.getComputedStyle(previousEl).display, 'inline');
  assert.equal(window.getComputedStyle(continuedEl).display, 'inline');
  const paragraphBreak = continuedEl.nextElementSibling;
  assert.equal(paragraphBreak?.classList.contains('paragraph-break'), true);
  assert.equal(window.getComputedStyle(paragraphBreak).display, 'block');
  assert.equal(window.getComputedStyle(paragraphBreak).height, '0px');
  assert.equal(window.getComputedStyle(paragraphBreak).marginBottom, '0.95em');
  view.destroy();
});

test('单击 item 才显示选中框，页级范围在首尾 item 外各留 6px', () => {
  const panel = document.querySelector('.text-panel');
  const sourceSelections = [];
  const selectedPages = [];
  const view = new TextView(panel, {
    onSourceSelect: (selection) => sourceSelections.push(selection),
    onPageSelect: (page) => selectedPages.push(page),
  });
  view.load(modelWithContinuation(), { title: '测试书' });

  const holder = panel.querySelector('.text-content');
  const pageOneLast = view.itemEls.get('1:2');
  const pageTwoFirst = view.itemEls.get('2:0');
  const pageTwoSecond = view.itemEls.get('2:1');
  holder.getBoundingClientRect = () => ({ top: 50, bottom: 650, left: 100, right: 700, width: 600, height: 600 });
  pageOneLast.getBoundingClientRect = () => ({ top: 120, bottom: 160, left: 130, right: 670, width: 540, height: 40 });
  pageTwoFirst.getBoundingClientRect = () => ({ top: 160, bottom: 210, left: 130, right: 670, width: 540, height: 50 });
  pageTwoSecond.getBoundingClientRect = () => ({ top: 220, bottom: 270, left: 130, right: 670, width: 540, height: 50 });
  window.getSelection = () => ({ isCollapsed: true });

  pageTwoFirst.dispatchEvent(new window.MouseEvent('pointermove', {
    bubbles: true, clientX: 300, clientY: 180,
  }));

  const pageHover = holder.querySelector('.page-source-hover');
  const pageLabel = holder.querySelector('.page-source-label');
  assert.equal(pageHover.hidden, true);
  assert.equal(pageLabel.hidden, true);

  pageTwoFirst.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, clientX: 300, clientY: 180,
  }));
  assert.equal(pageHover.hidden, false);
  assert.equal(pageLabel.hidden, false);
  assert.equal(pageLabel.dataset.label, 'PDF 第 2 页');
  assert.equal(pageHover.style.top, '104px');
  assert.equal(pageHover.style.height, '122px');
  assert.equal(pageTwoFirst.classList.contains('source-item-hover'), true);
  assert.equal(pageOneLast.classList.contains('source-item-hover'), false);
  assert.equal(pageTwoFirst.dataset.item, '2:0');
  assert.deepEqual(sourceSelections, [], '点击页/item 选中框不应再触发操作浮板');
  assert.deepEqual(selectedPages, [2]);

  pageTwoFirst.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, clientX: 300, clientY: 180,
  }));
  assert.equal(pageHover.hidden, true);
  assert.deepEqual(sourceSelections, []);

  pageTwoFirst.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, clientX: 300, clientY: 180,
  }));

  window.getSelection = () => ({ isCollapsed: false, anchorNode: pageTwoFirst.firstChild });
  document.dispatchEvent(new window.Event('selectionchange'));
  assert.equal(pageHover.hidden, true);
  assert.equal(pageLabel.hidden, true);
  assert.equal(holder.querySelectorAll('.source-item-hover').length, 0);

  pageTwoSecond.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, clientX: 300, clientY: 240,
  }));
  assert.equal(pageHover.hidden, true);
  assert.equal(pageLabel.hidden, true);
  assert.equal(holder.querySelectorAll('.source-item-hover').length, 0);
  view.destroy();
});

test('编辑模式悬浮预览当前页和 item，单击后才触发页面编辑', () => {
  const panel = document.querySelector('.text-panel');
  const selectedPages = [];
  const view = new TextView(panel, { onPageSelect: (page) => selectedPages.push(page) });
  view.load(modelWithContinuation(), { title: '编辑预览测试' });

  const holder = panel.querySelector('.text-content');
  const pageOneLast = view.itemEls.get('1:2');
  const pageTwoFirst = view.itemEls.get('2:0');
  const pageTwoSecond = view.itemEls.get('2:1');
  holder.getBoundingClientRect = () => ({ top: 50, bottom: 650, left: 100, right: 700, width: 600, height: 600 });
  pageOneLast.getBoundingClientRect = () => ({ top: 120, bottom: 160, left: 130, right: 670, width: 540, height: 40 });
  pageTwoFirst.getBoundingClientRect = () => ({ top: 160, bottom: 210, left: 130, right: 670, width: 540, height: 50 });
  pageTwoSecond.getBoundingClientRect = () => ({ top: 220, bottom: 270, left: 130, right: 670, width: 540, height: 50 });
  window.getSelection = () => ({ isCollapsed: true });

  view.setSourcePreviewOnHover(true);
  pageTwoFirst.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true }));
  assert.equal(holder.querySelector('.page-source-hover').hidden, false);
  assert.equal(holder.querySelector('.page-source-label').dataset.label, 'PDF 第 2 页');
  assert.equal(pageTwoFirst.classList.contains('source-item-hover'), true);
  assert.deepEqual(selectedPages, [], '悬浮只预览，不打开编辑器');

  pageTwoSecond.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true }));
  assert.equal(pageTwoSecond.classList.contains('source-item-hover'), true);
  assert.equal(pageTwoFirst.classList.contains('source-item-hover'), false);
  pageTwoSecond.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(selectedPages, [2]);

  panel.dispatchEvent(new window.MouseEvent('pointerleave'));
  assert.equal(holder.querySelector('.page-source-hover').hidden, true);
  view.setSourcePreviewOnHover(false);
  pageTwoFirst.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true }));
  assert.equal(holder.querySelector('.page-source-hover').hidden, true);
  view.destroy();
});

test('滚动同步使用文字栏 35% 高度处的阅读焦点页', () => {
  const panel = document.querySelector('.text-panel');
  const changes = [];
  const view = new TextView(panel, { onPageChange: (page) => changes.push(page) });
  view.load(modelWithContinuation(), { title: '测试书' });

  panel.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 600, width: 600, height: 400 });
  view.itemEls.get('1:0').getBoundingClientRect = () => ({ top: 110, bottom: 140 });
  view.itemEls.get('2:0').getBoundingClientRect = () => ({ top: 230, bottom: 260 });
  window.getSelection = () => ({ isCollapsed: true });

  view._updatePageFromScroll();

  assert.equal(view.currentPage, 2);
  assert.deepEqual(changes, [2]);
  view.destroy();
});

test('连续滚动停止 100ms 后才更新同步页', async () => {
  const panel = document.querySelector('.text-panel');
  const view = new TextView(panel);
  view.load(modelWithContinuation(), { title: '测试书' });

  panel.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 600, width: 600, height: 400 });
  view.itemEls.get('1:0').getBoundingClientRect = () => ({ top: 110, bottom: 140 });
  view.itemEls.get('2:0').getBoundingClientRect = () => ({ top: 400, bottom: 430 });
  window.getSelection = () => ({ isCollapsed: true });

  panel.dispatchEvent(new window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(view.currentPage, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(view.currentPage, 1);
  view.destroy();
});

test('选择文字期间不更新同步页', () => {
  const panel = document.querySelector('.text-panel');
  const changes = [];
  const view = new TextView(panel, { onPageChange: (page) => changes.push(page) });
  view.load(modelWithContinuation(), { title: '测试书' });

  panel.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 600, width: 600, height: 400 });
  view.itemEls.get('1:0').getBoundingClientRect = () => ({ top: 110, bottom: 140 });
  const pageTwoFirst = view.itemEls.get('2:0');
  pageTwoFirst.getBoundingClientRect = () => ({ top: 120, bottom: 150 });
  view.currentPage = 1;
  window.getSelection = () => ({
    isCollapsed: false,
    anchorNode: pageTwoFirst.firstChild,
    focusNode: pageTwoFirst.firstChild,
  });

  view._updatePageFromScroll();

  assert.equal(view.currentPage, 1);
  assert.deepEqual(changes, []);
  view.destroy();
});
