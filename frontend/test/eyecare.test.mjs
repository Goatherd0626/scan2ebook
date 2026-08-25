import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>
  <div id="plugin-toolbar"></div>
  <div id="toc-tabs"><button data-tt="toc">目录</button></div>
  <div id="toc-list"></div>
  <div id="sd-sections"></div>
  <div class="text-content"><p class="body">排版效果测试文字</p></div>
</body></html>`, { url: 'http://127.0.0.1:8765/', pretendToBeVisual: true });

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.NodeFilter = window.NodeFilter;
globalThis.HTMLElement = window.HTMLElement;

localStorage.setItem('s2e-settings', JSON.stringify({
  eye: true,
  dark: false,
  brightness: 82,
  warmth: 70,
  fontSize: 19,
  lineH: 2.1,
  width: 50,
}));

const extensions = await import('../src/core/extensions.js');
await import('../src/plugins/eyecare/index.js');

const ctx = {
  bus: extensions.bus,
  ui: extensions.ui,
  db: {},
  state: { books: [], folders: [], tabs: [], activeBookId: null },
  getView: () => null,
  openBook: async () => {},
  toast: () => {},
  storage: {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
  },
};

extensions.setEnabled('eyecare', true);
extensions.activateExtension('eyecare', ctx);
after(() => extensions.deactivateExtension('eyecare'));

test('旧设置迁移为互斥外观模式，并将正文宽度迁移为百分比默认值', () => {
  const panel = document.getElementById('eyecare-panel');
  const toolbarButton = document.querySelector('#plugin-toolbar .ec-toolbar-btn');
  assert.ok(panel);
  assert.equal(toolbarButton?.textContent.trim(), 'Aa');
  assert.deepEqual(
    [...panel.querySelectorAll('button[data-mode]')].map((button) => button.dataset.mode),
    ['standard', 'eye', 'dark'],
  );
  assert.deepEqual(
    [...panel.querySelectorAll('input[type="range"]')].map((input) => input.dataset.k),
    ['warmth', 'fontSize', 'lineH', 'contentWidth'],
  );

  const saved = JSON.parse(localStorage.getItem('s2e-settings'));
  assert.equal(saved.mode, 'eye');
  assert.equal(saved.fontSize, 19);
  assert.equal(saved.lineH, 2.1);
  assert.equal(saved.contentWidth, 100);
  assert.equal('brightness' in saved, false);
  assert.equal('width' in saved, false);
});

test('恢复默认图标接入阅读器统一悬浮提示', async () => {
  const { enableCustomTooltips } = await import('../src/core/app.js');
  const panel = document.getElementById('eyecare-panel');
  const reset = panel.querySelector('.ec-reset');
  enableCustomTooltips(panel);
  assert.equal(reset.dataset.tip, '恢复默认');
  assert.equal(reset.hasAttribute('title'), false);
});

test('主题调节只更新预览，应用后才修改并保存阅读界面', () => {
  const panel = document.getElementById('eyecare-panel');
  const toolbarButton = document.querySelector('.ec-toolbar-btn');
  toolbarButton.click();
  assert.equal(panel.hidden, false);
  assert.equal(toolbarButton.getAttribute('aria-expanded'), 'true');
  const originalPaper = document.documentElement.style.getPropertyValue('--paper');

  panel.querySelector('button[data-mode="dark"]').click();
  assert.equal(document.body.classList.contains('dark'), false);
  assert.equal(document.documentElement.style.getPropertyValue('--paper'), originalPaper);
  assert.equal(JSON.parse(localStorage.getItem('s2e-settings')).mode, 'eye');
  assert.equal(panel.querySelector('button[data-mode="dark"]').getAttribute('aria-pressed'), 'true');
  assert.equal(panel.querySelector('.ec-preview').dataset.mode, 'dark');
  assert.equal(panel.querySelector('.ec-apply').disabled, false);

  panel.querySelector('.ec-apply').click();
  assert.equal(document.body.classList.contains('dark'), true);
  assert.equal(JSON.parse(localStorage.getItem('s2e-settings')).mode, 'dark');
  assert.equal(panel.hidden, true);

  toolbarButton.click();
  panel.querySelector('button[data-mode="standard"]').click();
  panel.querySelector('.ec-cancel').click();
  assert.equal(document.body.classList.contains('dark'), true);
  assert.equal(JSON.parse(localStorage.getItem('s2e-settings')).mode, 'dark');
  assert.equal(panel.hidden, true);
});

test('放大的恢复默认按钮立即应用，不需要再次点击应用', () => {
  const panel = document.getElementById('eyecare-panel');
  const toolbarButton = document.querySelector('.ec-toolbar-btn');
  toolbarButton.click();
  const reset = panel.querySelector('.ec-reset');
  assert.equal(reset.textContent.trim(), '');
  const resetIcon = reset.querySelector('.sf.i-reset-clockwise');
  assert.ok(resetIcon, '恢复默认应使用 arrow.clockwise SF Symbol');
  const resetStyle = window.getComputedStyle(reset);
  assert.equal(resetStyle.width, '36px');
  assert.equal(resetStyle.height, '36px');
  assert.equal(resetStyle.backgroundColor, 'rgba(0, 0, 0, 0)');
  assert.equal(resetStyle.borderTopStyle, 'none');
  const iconStyle = window.getComputedStyle(resetIcon);
  assert.equal(iconStyle.width, '22px');
  assert.equal(iconStyle.height, '22px');
  reset.click();
  assert.equal(resetIcon.classList.contains('is-bouncing'), true);
  resetIcon.dispatchEvent(new window.Event('animationend', { bubbles: true }));
  assert.equal(resetIcon.classList.contains('is-bouncing'), false);
  reset.click();
  assert.equal(resetIcon.classList.contains('is-bouncing'), true, '连续点击应重新触发 Bounce');

  const saved = JSON.parse(localStorage.getItem('s2e-settings'));
  assert.equal(saved.mode, 'standard');
  assert.equal(saved.fontSize, 17);
  assert.equal(saved.lineH, 1.9);
  assert.equal(saved.contentWidth, 100);
  assert.equal(document.body.classList.contains('dark'), false);
  assert.equal(document.documentElement.style.getPropertyValue('--font-size'), '17px');
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('.ec-apply').disabled, true);
});

test('字号、行距和宽度先更新预览，应用后才作用于文字容器', () => {
  const panel = document.getElementById('eyecare-panel');
  const fontSize = panel.querySelector('[data-k="fontSize"]');
  const lineHeight = panel.querySelector('[data-k="lineH"]');
  const contentWidth = panel.querySelector('[data-k="contentWidth"]');

  fontSize.value = '21';
  fontSize.dispatchEvent(new window.Event('input', { bubbles: true }));
  lineHeight.value = '2.3';
  lineHeight.dispatchEvent(new window.Event('input', { bubbles: true }));
  contentWidth.value = '80';
  contentWidth.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.equal(document.documentElement.style.getPropertyValue('--font-size'), '17px');
  assert.equal(document.documentElement.style.getPropertyValue('--line-h'), '1.9');
  assert.equal(document.documentElement.style.getPropertyValue('--content-width'), '100%');
  assert.equal(panel.querySelector('[data-output="fontSize"]').textContent, '21 px');
  assert.equal(panel.querySelector('[data-output="lineH"]').textContent, '2.30×');
  assert.equal(panel.querySelector('[data-output="contentWidth"]').textContent, '80%');
  const preview = panel.querySelector('.ec-preview');
  assert.equal(preview.style.getPropertyValue('--font-size'), '21px');
  assert.equal(preview.style.getPropertyValue('--line-h'), '2.3');
  assert.equal(preview.style.getPropertyValue('--content-width'), '80%');

  panel.querySelector('.ec-apply').click();
  assert.equal(document.documentElement.style.getPropertyValue('--font-size'), '21px');
  assert.equal(document.documentElement.style.getPropertyValue('--line-h'), '2.3');
  assert.equal(document.documentElement.style.getPropertyValue('--content-width'), '80%');
  assert.equal(panel.hidden, true);

  const textStyle = window.getComputedStyle(document.querySelector('.text-content'));
  assert.equal(textStyle.fontSize, 'var(--font-size)');
  assert.equal(textStyle.lineHeight, 'var(--line-h)');
  assert.equal(textStyle.width, 'var(--content-width, 100%)');
  assert.equal(textStyle.maxWidth, 'none', '文字栏拉宽后正文应继续使用新增空间');
});
