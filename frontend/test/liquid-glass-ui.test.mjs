import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const mainSource = read('src/main.js');
const lgCss = read('src/liquid-glass.css');
const indexHtml = read('index.html');
const appSource = read('src/core/app.js');

test('入口在旧结构样式后加载 Liquid Glass 视觉层', () => {
  assert.match(mainSource, /import ['"]\.\/style\.css['"];?\s*import ['"]\.\/liquid-glass\.css['"]/);
});

test('Liquid Glass 定义材质、动态和无障碍回退', () => {
  assert.match(lgCss, /--lg-accent:\s*#007aff/i);
  assert.match(lgCss, /backdrop-filter:/);
  assert.match(lgCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(lgCss, /prefers-reduced-transparency:\s*reduce/);
});

test('不支持 backdrop-filter 或降低透明度时使用不透明系统表面', () => {
  assert.match(lgCss, /@supports\s+not\s*\(\s*\(-webkit-backdrop-filter/);
  assert.match(lgCss, /prefers-reduced-transparency:\s*reduce[\s\S]*?backdrop-filter:\s*none/);
});

test('工具栏具有 leading、document、context、trailing 四个稳定区域', () => {
  for (const id of ['topbar-leading', 'topbar-document', 'topbar-context', 'topbar-trailing']) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
});

test('同步和摊开按钮使用 SVG 且按视图模式切换', () => {
  assert.doesNotMatch(appSource, />⇅<|>⿻</);
  assert.match(appSource, /i-sync/);
  assert.match(appSource, /i-spread/);
  assert.match(appSource, /data-mode/);
});

test('设置与页面编辑器对话框带标签且关闭按钮使用 xmark 图标', () => {
  const dom = new JSDOM(indexHtml);
  const dialog = dom.window.document.getElementById('settings-dialog');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'sd-title');
  assert.ok(dialog.querySelector('.sf.i-xmark'), '设置对话框关闭按钮应使用 xmark 图标');
  const editorSource = read('src/plugins/editor/index.js');
  assert.match(editorSource, /aria-labelledby="page-editor-title"/);
});

test('静态图标按钮均有可访问名称', () => {
  const dom = new JSDOM(indexHtml);
  for (const btn of dom.window.document.querySelectorAll('button')) {
    assert.ok(
      btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent.trim(),
      `按钮缺少可访问名称: ${btn.outerHTML}`,
    );
  }
});

test('窄桌面下侧栏与 Inspector 覆盖显示而非挤压阅读区', () => {
  assert.match(lgCss, /@media \(max-width: 920px\) \{[\s\S]*?#sidebar,[\s\S]*?position:\s*fixed/);
  assert.match(lgCss, /\.dp-close\s*\{\s*display:\s*none/);
  assert.match(lgCss, /#detail-panel \.dp-close\s*\{\s*display:\s*inline-flex/);
  assert.match(appSource, /closest\('\.dp-close'\)/);
});

test('分割线跳转按钮构成覆盖式中缝控制岛并骑跨交界', () => {
  const divider = lgCss.slice(lgCss.indexOf('.divider button {'));
  assert.match(divider, /width:\s*38px[\s\S]*?height:\s*34px/);
  assert.match(divider, /\.divider button:first-of-type::after[\s\S]*?width:\s*38px[\s\S]*?height:\s*68px/);
  assert.match(divider, /margin-left:\s*0/);
});
