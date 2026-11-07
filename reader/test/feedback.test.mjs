import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import { showToast } from '../src/core/dialogs.js';

let deleteApi;
const loadDeleteApi = () => (deleteApi ??= import('../src/core/delete-confirm.js'));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function setup(t) {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="source">删除书籍</button><button id="outside">其他操作</button>
    <button id="home-delete">删除所选</button><div id="toast" role="status"></div>
  </body>`, { pretendToBeVisual: true, url: 'http://127.0.0.1/' });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement });
  const dismissals = [];
  t.after(async () => {
    if (deleteApi) (await deleteApi).cancelDeleteConfirmation();
    dismissals.forEach((dismiss) => dismiss());
    dom.window.close();
  });
  const source = document.getElementById('source');
  source.getBoundingClientRect = () => new window.DOMRect(260, 100, 44, 32);
  source.focus();
  return {
    window, source,
    toast(options) {
      const dismiss = showToast(options);
      dismissals.push(dismiss);
      return dismiss;
    },
  };
}

test('Toast 最多保留三条，旧关闭函数只影响原来的卡片', (t) => {
  const { toast, source } = setup(t);
  const closeFirst = toast({ message: '第一条', duration: 0 });
  const closeSecond = toast({ message: '第二条', duration: 0 });
  toast({ message: '第三条', duration: 0 });
  toast({ message: '第四条', duration: 0 });
  const messages = () => [...document.querySelectorAll('[data-slot="toast-title"]')].map((node) => node.textContent);
  assert.deepEqual(messages(), ['第二条', '第三条', '第四条']);
  closeFirst();
  assert.deepEqual(messages(), ['第二条', '第三条', '第四条']);
  closeSecond();
  assert.deepEqual(messages(), ['第三条', '第四条']);
  assert.equal(document.activeElement, source);
});

test('Toast 为状态和失败分别提供可读图标、描述与 live role', (t) => {
  const { toast } = setup(t);
  toast('资料已保存');
  const info = document.querySelector('[data-slot="toast"]');
  assert.equal(info.dataset.type, 'info');
  assert.equal(info.getAttribute('role'), 'status');
  assert.ok(info.querySelector('[data-slot="toast-icon"] svg'));
  assert.ok(info.querySelector('[data-slot="toast-close"][aria-label="关闭提示"]'));
  toast({ message: '导入失败', description: '请选择完整的电子书文件。', type: 'error', duration: 0 });
  const failure = document.querySelector('[data-slot="toast"][data-type="error"]');
  assert.equal(failure.getAttribute('role'), 'alert');
  assert.match(failure.textContent, /请选择完整的电子书文件/);
});

test('Toast 悬停与键盘焦点暂停倒计时，全部离开后只消耗剩余时间', (t) => {
  const { window, toast, source } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  toast({ message: '阅读位置已保存', duration: 100 });
  const card = document.querySelector('[data-slot="toast"]');
  t.mock.timers.tick(40);
  card.dispatchEvent(new window.MouseEvent('mouseenter'));
  t.mock.timers.tick(500);
  assert.equal(card.isConnected, true);
  card.querySelector('[data-slot="toast-close"]').focus();
  card.dispatchEvent(new window.MouseEvent('mouseleave'));
  t.mock.timers.tick(500);
  assert.equal(card.isConnected, true, '鼠标离开后，焦点仍应暂停提示');
  source.focus();
  t.mock.timers.tick(59);
  assert.equal(card.isConnected, true);
  t.mock.timers.tick(1);
  assert.equal(card.isConnected, false);
});

test('loading 和显式 duration=0 不会自动消失，关闭按钮仍可用', (t) => {
  const { toast } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  toast({ message: '正在导出', type: 'loading' });
  toast({ message: '保留此提示', duration: 0 });
  t.mock.timers.tick(60000);
  assert.equal(document.querySelectorAll('[data-slot="toast"]').length, 2);
  document.querySelector('[data-slot="toast-close"]').click();
  assert.equal(document.querySelectorAll('[data-slot="toast"]').length, 1);
});

test('Toast 动作等待实际完成，只执行一次且不抢焦点', async (t) => {
  const { toast, source } = setup(t);
  let finish;
  let calls = 0;
  toast({
    message: '注释已删除', actionLabel: '撤销', duration: 0,
    onAction: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
  });
  const action = document.querySelector('[data-toast-action]');
  action.click();
  action.click();
  assert.equal(calls, 1);
  assert.equal(action.disabled, true);
  assert.match(document.getElementById('toast').textContent, /注释已删除/);
  assert.doesNotMatch(document.getElementById('toast').textContent, /已撤销/);
  finish();
  await flush();
  assert.match(document.getElementById('toast').textContent, /已撤销/);
  assert.equal(document.querySelector('[data-toast-action]'), null);
  assert.equal(document.activeElement, source);
  action.click();
  assert.equal(calls, 1);
});

test('Toast 捕获动作失败并允许重试，成功后才展示完成文案', async (t) => {
  const { toast } = setup(t);
  let calls = 0;
  toast({
    message: '文件已移走', actionLabel: '撤销', doneMessage: '文件已还原', duration: 0,
    onAction: async () => { calls++; if (calls === 1) throw new Error('临时失败'); },
  });
  const action = document.querySelector('[data-toast-action]');
  action.click();
  await flush();
  const card = document.querySelector('[data-slot="toast"]');
  assert.equal(card.dataset.type, 'error');
  assert.match(card.textContent, /失败/);
  assert.equal(action.disabled, false);
  assert.doesNotMatch(card.textContent, /文件已还原/);
  action.click();
  action.click();
  await flush();
  assert.equal(calls, 2);
  assert.equal(card.dataset.type, 'success');
  assert.match(card.textContent, /文件已还原/);
});

test('已被淘汰的 Toast 在异步动作结束后不会覆盖新提示', async (t) => {
  const { toast } = setup(t);
  let finish;
  toast({ message: '旧提示', actionLabel: '撤销', onAction: () => new Promise((resolve) => { finish = resolve; }), duration: 0 });
  document.querySelector('[data-toast-action]').click();
  for (const message of ['新提示一', '新提示二', '新提示三']) toast({ message, duration: 0 });
  finish();
  await flush();
  assert.equal(document.querySelectorAll('[data-slot="toast"]').length, 3);
  assert.doesNotMatch(document.getElementById('toast').textContent, /已撤销|旧提示/);
});

test('删除首次调用只展开就地确认，确认后返回 true 并还原来源属性与焦点', async (t) => {
  const { source } = setup(t);
  const { confirmDelete } = await loadDeleteApi();
  source.setAttribute('aria-expanded', 'false');
  source.setAttribute('aria-controls', 'original-menu');
  let settled = false;
  const result = confirmDelete({ title: '删除电子书', message: '确认删除所选电子书？' });
  result.then(() => { settled = true; });
  await flush();
  const card = document.querySelector('.delete-confirmation[role="dialog"]');
  assert.ok(card);
  assert.equal(card.dataset.slot, 'delete-button');
  assert.notEqual(card.getAttribute('aria-modal'), 'true');
  assert.equal(document.querySelector('.app-sheet-mask'), null);
  assert.equal(settled, false);
  assert.equal(source.getAttribute('aria-expanded'), 'true');
  assert.equal(source.getAttribute('aria-controls'), card.id);
  assert.equal(document.activeElement, card.querySelector('[data-delete-action="cancel"]'));
  card.querySelector('[data-delete-action="confirm"]').click();
  assert.equal(await result, true);
  assert.equal(document.querySelector('.delete-confirmation'), null);
  assert.equal(source.getAttribute('aria-expanded'), 'false');
  assert.equal(source.getAttribute('aria-controls'), 'original-menu');
  assert.equal(document.activeElement, source);
});

test('删除确认消费 Escape，取消时不触发背景快捷键', async (t) => {
  const { window, source } = setup(t);
  const { confirmDelete } = await loadDeleteApi();
  let backgroundEscapes = 0;
  document.addEventListener('keydown', () => { backgroundEscapes++; });
  const result = confirmDelete({ title: '删除电子书', anchor: source });
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  assert.equal(await result, false);
  assert.equal(event.defaultPrevented, true);
  assert.equal(backgroundEscapes, 0);
  assert.equal(document.activeElement, source);
});

test('删除确认支持点外部取消，Tab 离开后不把焦点拉回来源', async (t) => {
  const { window, source } = setup(t);
  const { confirmDelete } = await loadDeleteApi();
  const outside = document.getElementById('outside');
  const first = confirmDelete({ title: '删除电子书', anchor: source });
  outside.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(await first, false);
  const second = confirmDelete({ title: '删除电子书', anchor: source });
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  outside.focus();
  assert.equal(await second, false);
  assert.equal(document.activeElement, outside);
  assert.equal(source.hasAttribute('aria-expanded'), false);
  assert.equal(source.hasAttribute('aria-controls'), false);
});

test('新的删除请求取消上一条，导航取消会清理当前确认', async (t) => {
  const { source } = setup(t);
  const { confirmDelete, cancelDeleteConfirmation } = await loadDeleteApi();
  const outside = document.getElementById('outside');
  const first = confirmDelete({ title: '删除第一本', anchor: source });
  const second = confirmDelete({ title: '删除第二本', anchor: outside });
  assert.equal(await first, false);
  assert.equal(document.querySelectorAll('.delete-confirmation').length, 1);
  assert.match(document.querySelector('.delete-confirmation').textContent, /删除第二本/);
  assert.equal(source.hasAttribute('aria-expanded'), false);
  cancelDeleteConfirmation();
  assert.equal(await second, false);
  assert.equal(document.querySelector('.delete-confirmation'), null);
  assert.equal(document.activeElement, outside);
});

test('删除确认在窄视口靠近来源展示，滚动后重新定位，来源隐藏则取消', async (t) => {
  const { window, source } = setup(t);
  const { confirmDelete } = await loadDeleteApi();
  Object.defineProperties(window, { innerWidth: { value: 360, configurable: true }, innerHeight: { value: 270, configurable: true } });
  let box = new window.DOMRect(310, 220, 42, 32);
  source.getBoundingClientRect = () => box;
  const result = confirmDelete({ title: '删除电子书', message: '确认删除？', anchor: source });
  const card = document.querySelector('.delete-confirmation');
  assert.ok(parseFloat(card.style.left) >= 12);
  assert.ok(parseFloat(card.style.left) + 320 <= 348);
  assert.ok(parseFloat(card.style.top) < 220, '底部空间不足时应在来源上方');
  box = new window.DOMRect(20, 30, 42, 32);
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(parseFloat(card.style.top), 70);
  source.hidden = true;
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(await result, false);
  assert.equal(card.isConnected, false);
});

test('未提供锚点时使用可见来源，隐藏来源回退到首页删除控件', async (t) => {
  const { source } = setup(t);
  const { confirmDelete, cancelDeleteConfirmation } = await loadDeleteApi();
  source.hidden = true;
  const result = confirmDelete({ title: '删除电子书' });
  const fallback = document.getElementById('home-delete');
  assert.equal(fallback.getAttribute('aria-expanded'), 'true');
  cancelDeleteConfirmation();
  assert.equal(await result, false);
  assert.equal(document.activeElement, fallback);
});
