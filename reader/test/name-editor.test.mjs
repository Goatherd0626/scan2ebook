import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { editName, cancelNameEditor } from '../src/core/name-editor.js';

function setup(t) {
  const dom = new JSDOM('<button id="source">重命名</button><button id="outside">其他操作</button><div id="toast"></div>', { url: 'http://127.0.0.1/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  const anchor = document.getElementById('source');
  anchor.getBoundingClientRect = () => new window.DOMRect(240, 90, 44, 40);
  t.after(() => { cancelNameEditor(); dom.window.close(); });
  return { anchor, input: () => document.querySelector('.name-editor input'), save: () => document.querySelector('[data-name-action="save"]') };
}

test('重命名即选中原名称，Esc 取消且不写入；点外部也不误保存', async t => {
  const { anchor, input } = setup(t);
  let writes = 0;
  const first = editName({ anchor, title: '重命名文件夹', value: '阅读资料', onSave: () => { writes++; } });
  assert.equal(document.activeElement, input());
  assert.equal(input().selectionStart, 0);
  assert.equal(input().selectionEnd, '阅读资料'.length);
  input().value = '不应保存';
  input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(await first, false);
  assert.equal(writes, 0);
  assert.equal(document.activeElement, anchor);
  const second = editName({ anchor, value: '阅读资料', onSave: () => { writes++; } });
  input().value = '也不应保存';
  document.getElementById('outside').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(await second, false);
  assert.equal(writes, 0);
});

test('输入法确认不提交，普通 Enter 等待唯一一次保存完成', async t => {
  const { anchor, input, save } = setup(t);
  const names = [];
  let finish;
  const result = editName({ anchor, value: '原名称', onSave: name => { names.push(name); return new Promise(resolve => { finish = resolve; }); } });
  input().value = '  新名称  ';
  input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  assert.equal(names.length, 0);
  input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  save().click();
  assert.deepEqual(names, ['新名称']);
  assert.equal(save().disabled, true);
  assert.ok(document.querySelector('.name-editor'));
  finish();
  assert.equal(await result, true);
  assert.equal(Boolean(document.querySelector('.name-editor')), false);
});

test('空名称阻止保存，保存失败保留输入并用 Toast 提示，重试后才关闭', async t => {
  const { anchor, input, save } = setup(t);
  let attempts = 0;
  const result = editName({ anchor, value: '原名称', onSave: async () => { if (++attempts === 1) throw new Error('暂时无法保存'); } });
  input().value = '  ';
  save().click();
  assert.equal(attempts, 0);
  assert.equal(input().getAttribute('aria-invalid'), 'true');
  input().value = '保留这个名称';
  input().dispatchEvent(new window.Event('input', { bubbles: true }));
  save().click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(input().value, '保留这个名称');
  assert.equal(save().disabled, false);
  assert.ok(document.querySelector('#toast [data-type="error"]'));
  save().click();
  assert.equal(await result, true);
  assert.equal(attempts, 2);
});

test('重复打开同一来源保留编辑，切换来源与导航取消会清理旧编辑器', async t => {
  const { anchor, input } = setup(t);
  const first = editName({ anchor, value: '原名称', onSave() {} });
  input().value = '正在输入';
  anchor.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  anchor.focus();
  assert.equal(input()?.value, '正在输入', '点回同一来源时的焦点转移不能取消草稿');
  const again = editName({ anchor, value: '原名称', onSave() {} });
  assert.equal(again, first);
  assert.equal(input().value, '正在输入');
  const next = editName({ anchor: document.getElementById('outside'), value: '第二项', onSave() {} });
  assert.equal(await first, false);
  assert.equal(document.querySelectorAll('.name-editor').length, 1);
  cancelNameEditor();
  assert.equal(await next, false);
  assert.equal(Boolean(document.querySelector('.name-editor')), false);
});
