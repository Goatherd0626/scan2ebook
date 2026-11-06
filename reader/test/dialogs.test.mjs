import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><body><div id="toast" role="status"></div></body>`, {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:8765/',
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;

const { confirmSheet, promptSheet, selectSheet, showToast } = await import('../src/core/dialogs.js');

test('确认 Sheet 取消后返回 false 并把焦点还给来源控件', async () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();

  const result = confirmSheet({
    title: '删除电子书',
    message: '此操作无法撤销。',
    confirmLabel: '删除',
    danger: true,
  });
  const dialog = document.querySelector('.app-sheet[role="dialog"]');
  assert.ok(dialog);
  assert.equal(document.activeElement, dialog.querySelector('[data-dialog-action="cancel"]'));
  dialog.querySelector('[data-dialog-action="cancel"]').click();

  assert.equal(await result, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector('.app-sheet-mask'), null);
});

test('输入 Sheet 校验非空值并用 Enter 提交', async () => {
  const result = promptSheet({ title: '新建文件夹', label: '文件夹名称', confirmLabel: '创建' });
  const input = document.querySelector('.app-sheet-input');
  const confirm = document.querySelector('[data-dialog-action="confirm"]');
  assert.equal(confirm.disabled, true);
  input.value = '研究资料';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(confirm.disabled, false);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(await result, '研究资料');
});

test('可撤销 Toast 的动作最多执行一次且不会抢走焦点', async () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  let undoCount = 0;
  showToast({ message: '注释已删除', actionLabel: '撤销', onAction: () => { undoCount += 1; } });
  const action = document.querySelector('[data-toast-action]');
  action.click();
  action.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(undoCount, 1);
  assert.equal(document.activeElement, trigger);
  assert.match(document.getElementById('toast').textContent, /已撤销/);
});

test('应用 Sheet 消费 Escape，不触发背景快捷键', async () => {
  let backgroundEscapeCount = 0;
  const onBackgroundKeydown = (event) => {
    if (event.key === 'Escape') backgroundEscapeCount += 1;
  };
  document.addEventListener('keydown', onBackgroundKeydown);

  const result = confirmSheet({ title: '确认操作', message: '测试 Escape 隔离。' });
  const dialog = document.querySelector('.app-sheet[role="dialog"]');
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));

  assert.equal(await result, false);
  assert.equal(backgroundEscapeCount, 0);
  document.removeEventListener('keydown', onBackgroundKeydown);
});

test('选择 Sheet 使用位置 ID，同名文件夹与书库根目录均可准确选择', async () => {
  const choices = [{ value: '', label: '书库根目录' }, { value: 'folder-a', label: '资料' }, { value: 'folder-b', label: '资料' }];
  const selected = selectSheet({ title: '移动电子书', label: '目标文件夹', choices, confirmLabel: '移动' });
  const select = document.querySelector('select.app-sheet-input');
  assert.equal(document.activeElement, select);
  select.value = 'folder-b';
  document.querySelector('[data-dialog-action="confirm"]').click();
  assert.equal(await selected, 'folder-b');
  const root = selectSheet({ title: '移动电子书', choices });
  assert.equal(document.querySelector('[data-dialog-action="confirm"]').disabled, false);
  document.querySelector('[data-dialog-action="confirm"]').click();
  assert.equal(await root, '');
});
