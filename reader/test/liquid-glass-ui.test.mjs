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

test('双栏视图横向排列完整 PDF、分隔线与文字图标', () => {
  assert.match(appSource, /data-mode="split"[\s\S]*?vm-pdf[\s\S]*?vm-bar[\s\S]*?i-t/);
  assert.match(lgCss, /button\[data-mode="split"\]\s*\{\s*width:\s*42px/);
  const baseCss = read('src/style.css');
  assert.match(baseCss, /\.split-mode-icon\s*\{[\s\S]*?display:\s*inline-flex[\s\S]*?gap:\s*3px/);
  assert.match(baseCss, /\.split-mode-icon \.vm-bar\s*\{[\s\S]*?width:\s*1px[\s\S]*?height:\s*14px/);
});

test('正文搜索与视图切换之间保留独立分组间距', () => {
  assert.match(lgCss, /#view-switch\s*\{[\s\S]*?margin-left:\s*6px/);
  const baseCss = read('src/style.css');
  assert.match(baseCss, /#view-switch\s*\{[\s\S]*?border-left:\s*0/);
});

test('搜索结果弹层裁切横向内容但保留纵向独立滚动', () => {
  const blockStart = lgCss.indexOf('#search-drop {');
  const blockEnd = lgCss.indexOf('}', blockStart);
  assert.notEqual(blockStart, -1, '应定义 #search-drop 的 Liquid Glass 样式');
  assert.notEqual(blockEnd, -1, '#search-drop 样式块应完整闭合');

  // 只检查弹层自身，避免误匹配后续其他组件的 overflow 声明。
  const searchDropCss = lgCss.slice(blockStart, blockEnd + 1);
  assert.match(searchDropCss, /overflow-x:\s*hidden/);
  assert.match(searchDropCss, /overflow-y:\s*auto/);
  assert.match(searchDropCss, /overscroll-behavior:\s*contain/);
  assert.doesNotMatch(searchDropCss, /(?:^|[;{]\s*)overflow:\s*hidden/);
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

test('窄桌面工具栏使用可读的紧凑控件而不是挤压文字', () => {
  const editorSource = read('src/plugins/editor/index.js');
  assert.match(editorSource, /className = 'sf i-text-editor'/);
  assert.match(editorSource, /className = 'editor-toggle-label'/);
  assert.match(lgCss, /@media \(max-width: 920px\) \{[\s\S]*?#search-wrap:not\(:focus-within\)[\s\S]*?width:\s*36px/);
  assert.match(lgCss, /@media \(max-width: 920px\) \{[\s\S]*?\.editor-toggle-label\s*\{\s*display:\s*none/);
});

test('侧栏空书库使用紧凑导航提示，不重复中央导入空状态', () => {
  const emptyLibrarySource = appSource.slice(appSource.indexOf('function emptyLib()'), appSource.indexOf('function bookRow'));
  assert.match(emptyLibrarySource, /library-empty-compact/);
  assert.doesNotMatch(emptyLibrarySource, /import-big|drop-hint|import-input/);
});

test('双向跳转与书签构成文字栏左缘的三格液态玻璃控制岛', () => {
  assert.match(appSource, /view-control-island[\s\S]*?data-dir="pdf"[\s\S]*?data-dir="text"[\s\S]*?bookmark-island-slot/);
  assert.doesNotMatch(appSource, /<div class="divider"[\s\S]*?<button class="jump"/);
  assert.match(lgCss, /\.view-control-island\s*\{[\s\S]*?left:\s*calc\(var\(--pdf-ratio, 50%\) - 1px\)/);
  assert.match(lgCss, /grid-template-columns:\s*34px[\s\S]*?padding:\s*3px/);
  assert.match(lgCss, /grid-template-rows:\s*repeat\(3, 38px\)/);
  assert.match(lgCss, /backdrop-filter:\s*blur\(24px\) saturate\(1\.7\)/);
  assert.match(lgCss, /\.view-island-action:active\s*\{[\s\S]*?transform:\s*scale\(\.9\)/);
});

test('正文页选择使用单层页背景、深色 item 强调和 Pxx 方形页标', () => {
  const viewsSource = read('src/core/views.js');
  assert.match(viewsSource, /dataset\.page = String\(page\)/);
  assert.doesNotMatch(viewsSource, /dataset\.label = 'PDF 第 ' \+ page/);
  assert.match(viewsSource, /top - 36/);
  assert.match(lgCss, /\.toc-item \.toc-page,[\s\S]*?\.page-source-label\s*\{[\s\S]*?width:\s*30px[\s\S]*?height:\s*30px/);
  assert.match(lgCss, /\.page-source-label::before[\s\S]*?color:\s*#fff/);
  assert.match(lgCss, /\.text-item\.source-item-hover,[\s\S]*?background:\s*var\(--source-item-hover\)/);
});

test('注释搜索复用正文搜索的聚焦材质而不是输入框蓝色方框', () => {
  assert.match(lgCss, /\.annotations-search:focus-within\s*\{[\s\S]*?border-color:\s*color-mix\(in srgb, var\(--lg-accent\) 50%/);
  assert.match(lgCss, /\.annotations-search:focus-within\s*\{[\s\S]*?box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--lg-accent\) 13%/);
  assert.match(lgCss, /\.annotations-search-input,[\s\S]*?\.annotations-search-input:focus\s*\{[\s\S]*?border:\s*0[\s\S]*?outline:\s*0[\s\S]*?box-shadow:\s*none/);
});

test('标注栏在宽屏与窄屏都为顶部工具栏保留安全间距', () => {
  const sidebarSource = read('src/plugins/annotations/sidebar.js');
  assert.match(lgCss, /\.annotations-sidebar\s*\{[\s\S]*?margin:\s*12px 8px 8px 0/);
  assert.match(lgCss, /\.annotations-sidebar\s*\{[\s\S]*?overflow:\s*clip/);
  assert.match(lgCss, /\.annotations-head\s*\{[\s\S]*?flex:\s*0 0 54px/);
  assert.match(lgCss, /@media \(max-width: 920px\) \{[\s\S]*?\.annotations-sidebar\s*\{[\s\S]*?top:\s*calc\(var\(--tbar-h\) \+ 24px\)/);
  assert.match(sidebarSource, /function scrollCardWithinList/);
  assert.doesNotMatch(sidebarSource, /\.scrollIntoView\(/);
});
