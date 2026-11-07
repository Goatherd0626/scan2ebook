import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
const { window } = new JSDOM(`<!doctype html><body>
  <div id="plugin-toolbar"></div><nav id="settings-nav"></nav><div id="settings-content"></div>
</body>`, { url: 'http://127.0.0.1:8765/', pretendToBeVisual: true });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage,
  NodeFilter: window.NodeFilter, HTMLElement: window.HTMLElement });
localStorage.setItem('s2e-settings', JSON.stringify({ eye: true, dark: false, brightness: 82,
  warmth: 70, fontSize: 19, lineH: 2.1, width: 50 }));
const extensions = await import('../src/core/extensions.js');
await import('../src/plugins/eyecare/index.js');
const ctx = { ui: extensions.ui, storage: { get: key => localStorage.getItem(key), set: (key, value) => localStorage.setItem(key, value) } };
extensions.setEnabled('eyecare', true);
extensions.activateExtension('eyecare', ctx);
after(() => extensions.deactivateExtension('eyecare'));
const saved = () => JSON.parse(localStorage.getItem('s2e-settings'));
const input = (key, value) => {
  const control = document.querySelector(`[data-k="${key}"]`);
  control.value = value;
  control.dispatchEvent(new window.Event('input', { bubbles: true }));
  control.dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('迁移旧版偏好，保留阅读习惯并清除已废弃的亮度与宽度格式', () => {
  assert.deepEqual(saved(), { mode: 'eye', warmth: 70, fontSize: 19, lineH: 2.1, contentWidth: 100 });
});

test('外观与排版分开显示，不再创建浮层或工具栏 Aa 按钮', () => {
  assert.equal(document.querySelector('.ec-toolbar-btn, #eyecare-panel'), null);
  assert.equal(document.getElementById('settings-section-appearance').hidden, false);
  assert.equal(document.getElementById('settings-section-typography').hidden, true);
  assert.deepEqual([...document.querySelectorAll('#settings-section-typography input')].map(i => i.dataset.k), ['fontSize', 'lineH', 'contentWidth']);
  extensions.selectSettingsSection('typography');
  assert.equal(document.getElementById('settings-section-appearance').hidden, true);
  assert.equal(document.getElementById('settings-section-typography').hidden, false);
});

test('切换外观立即生效且自动记忆，色温只在护眼模式显示', () => {
  extensions.selectSettingsSection('appearance');
  document.querySelector('button[data-mode="dark"]').click();
  assert.equal(document.body.classList.contains('dark'), true);
  assert.equal(saved().mode, 'dark');
  assert.equal(document.querySelector('[data-control="warmth"]').hidden, true);
  assert.equal(document.querySelector('button[data-mode="dark"]').getAttribute('aria-pressed'), 'true');
  document.querySelector('button[data-mode="eye"]').click();
  input('warmth', '80');
  assert.equal(saved().warmth, 80);
  assert.equal(document.body.classList.contains('dark'), false);
  assert.equal(document.querySelector('[data-control="warmth"]').hidden, false);
  assert.match(document.documentElement.style.getPropertyValue('--paper'), /^#/);
});

test('字号、行距与宽度实时更新正文和预览，操作结束自动保存', () => {
  extensions.selectSettingsSection('typography');
  input('fontSize', '21'); input('lineH', '2.3'); input('contentWidth', '80');
  const root = document.documentElement.style;
  assert.equal(root.getPropertyValue('--font-size'), '21px');
  assert.equal(root.getPropertyValue('--line-h'), '2.3');
  assert.equal(root.getPropertyValue('--content-width'), '80%');
  assert.deepEqual(saved(), { mode: 'eye', warmth: 80, fontSize: 21, lineH: 2.3, contentWidth: 80 });
  const preview = document.querySelector('#settings-section-typography .settings-preview-paper');
  assert.equal(preview.style.getPropertyValue('--font-size'), '21px');
  assert.equal(preview.style.getPropertyValue('--content-width'), '80%');
  assert.equal(document.querySelector('[data-output="lineH"]').textContent, '2.30×');
});

test('恢复本类默认值不会覆盖另一类偏好，重新激活能恢复保存值且不重复注册', () => {
  document.querySelector('[data-reset="typography"]').click();
  assert.deepEqual(saved(), { mode: 'eye', warmth: 80, fontSize: 17, lineH: 1.9, contentWidth: 100 });
  input('fontSize', '20');
  document.querySelector('[data-reset="appearance"]').click();
  assert.deepEqual(saved(), { mode: 'standard', warmth: 55, fontSize: 20, lineH: 1.9, contentWidth: 100 });
  extensions.deactivateExtension('eyecare'); extensions.activateExtension('eyecare', ctx);
  assert.equal(document.querySelectorAll('#settings-nav a').length, 2);
  assert.equal(document.documentElement.style.getPropertyValue('--font-size'), '20px');
  assert.equal(document.querySelector('[data-k="fontSize"]').value, '20');
});
