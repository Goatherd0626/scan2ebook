# Liquid Glass 阅读器界面重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留阅读器现有数据与功能契约的前提下，将首页、阅读区、左右侧栏、工具栏、浮窗和编辑器重构为统一的 macOS Liquid Glass 界面，并完成已确认的交互重组。

**Architecture:** 保留 `style.css` 中与尺寸、滚动、PDF 和文字定位有关的结构规则，新增后加载的 `liquid-glass.css` 作为唯一视觉覆盖层，避免一次性重写 1300 行结构 CSS。核心新增 Promise 化应用内 Dialog 服务；书签、编辑器和注释插件只调整入口与反馈，不改变 IndexedDB、`.s2e` 或正文锚点格式。

**Tech Stack:** Vanilla JavaScript ES modules、CSS Custom Properties、CSS `backdrop-filter`、Vite、Node.js `node:test`、JSDOM、现有 SF Symbols SVG。

**Spec:** `docs/superpowers/specs/2026-08-27-liquid-glass-reader-redesign.md`

## 完成状态(2026-08-27 核验)

- **Task 1–4**:先前会话实现并提交(`ce70993`/`a0fcd35`/`aa0418d`);本批次补齐契约测试与验收:
  - `test/liquid-glass-ui.test.mjs`(入口加载顺序、材质与无障碍回退、四稳定工具栏区域、SVG 同步/摊开、对话框标注、图标按钮可访问名称、窄桌面覆盖、分割控制岛)。
  - `test/icon-assets.test.mjs` 增加 `liquid-glass.css` 的 6 个 SF Symbols 映射(`i-search/i-plus/i-spread/i-sidebar-right/i-xmark/i-sync`)。
- **Task 5**:Emoji 空状态移除、`min-height: 54px` 行高与 12px 间距、`aria-selected`/Escape 清除、空白区起框选、右侧详情 Inspector、书签与注释多选一致。
- **Task 6**:1px 细线 + 38×68 玻璃控制岛骑跨交界(修正双重左移 13px 的偏移)、宽命中区、z-index 45;ctxbar / 注释卡片浮窗统一 Escape / 外点 / 再点关闭路径,注释编辑受外点保护;搜索条锚定输入框,⌘F 按焦点路由(正文/PDF/工具栏→全局,标注栏→标注搜索)。
- **Task 7**:编辑模式横幅(选页提示、Escape 退出、保存自动退出)、不透明编辑 Sheet;设置分组 Sheet + `aria-labelledby`;阅读外观源锚定 Popover(实时预览、应用、取消、立即重置);≤920px 侧栏与 Inspector 覆盖式悬浮(保留 btn-library / annotations-toggle / 新增 dp-close 关闭);滚动内容底部留白(正文 120px、PDF 80px、首页表格 86px)。
- **Task 8**:卫生检查通过(无 Emoji 图标字符、无字符箭头/关闭符、无原生 `confirm/prompt`、`git diff --check` 干净);64 项 `node:test` 全绿;`npm run build` 成功产出 `dist/`。
- **环境限制与真实浏览器复核(2026-08-27 追加)**:系统 Chrome 在本沙箱内 headless 挂起(`sandbox init`/无 GPU),改用 **Playwright 下载的 Chromium headless shell**(安装至 `/tmp/pw-browsers`,驱动脚本 `/tmp/pw/driver.mjs`)对 `npm run build` 产物执行状态走查,共 **19/19 通过**,截图存于 `docs/superpowers/visual-check/`(首页空/选中/批量、双栏/PDF/文字、选区浮窗、书签开关、标注栏与标注搜索路由、外观预览/深色/护眼、设置、窄桌面覆盖、焦点可见性)。浏览器走查中确认:
  - 窄屏覆盖式 Inspector 初始规则位置被同优先级基础规则覆盖 → 已把该媒体块移到 `liquid-glass.css` 文件末尾修复;
  - 标注搜索路由由标注栏 capture 处理器承担(焦点在栏内时 `stopImmediatePropagation`),搜索插件补充了同等保险逻辑 + `search-order.test.mjs` 契约测试;
  - 深色模式正文保持纸面为有意设计(`applyCommitted` 对 dark 仅置 `body.dark`,不覆盖正文 `--paper/--ink`);
  - 样例书无脚注,脚注悬浮弹窗以 jsdom footnotes 契约测试覆盖。


## Global Constraints

- 不新增运行时依赖，不改变 `.s2e`、`book.json`、`annotations.json` 和 IndexedDB schema。
- 保留所有既有 DOM ID、业务 `data-*` 属性、插件扩展点和功能结果；结构调整只增加语义容器或状态属性。
- Liquid Glass 只用于工具栏、导航、侧栏、Inspector、Popover、菜单和临时控制；正文、PDF、列表和表单使用实体或标准材质。
- 界面字体使用系统字体，正文继续使用现有宋体族与用户可调字号、行距、正文宽度。
- 支持浅色、深色、护眼模式、`prefers-reduced-motion` 和 `prefers-reduced-transparency` 回退。
- 所有图标按钮必须有 `aria-label`；拖拽保留键盘或点击替代路径。
- 在当前分支内顺序执行，不创建 worktree，不使用子代理，不执行 `test:smoke`。

---

### Task 1: 建立 Liquid Glass 视觉基础层

**Files:**
- Create: `reader/src/liquid-glass.css`
- Modify: `reader/src/main.js`
- Modify: `reader/src/style.css`
- Modify: `reader/test/icon-assets.test.mjs`
- Create: `reader/test/liquid-glass-ui.test.mjs`
- Add: `reader/src/assets/icons/arrow.up.arrow.down.svg`
- Add: `reader/src/assets/icons/magnifyingglass.svg`
- Add: `reader/src/assets/icons/plus.svg`
- Add: `reader/src/assets/icons/rectangle.split.2x1.svg`
- Add: `reader/src/assets/icons/sidebar.right.svg`
- Add: `reader/src/assets/icons/xmark.svg`

**Interfaces:**
- Consumes: existing DOM classes and CSS variables from `style.css`.
- Produces: semantic tokens `--lg-*`, material utilities, unified button/focus/tooltip/icon states consumed by later tasks.

- [x] **Step 1: Write failing visual-contract tests**

```js
test('入口在旧结构样式后加载 Liquid Glass 视觉层', () => {
  assert.match(mainSource, /import ['"]\.\/style\.css['"];?\s*import ['"]\.\/liquid-glass\.css['"]/);
});

test('Liquid Glass 定义材质、动态和无障碍回退', () => {
  assert.match(css, /--lg-accent:\s*#007aff/i);
  assert.match(css, /backdrop-filter:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /prefers-reduced-transparency:\s*reduce/);
});
```

- [x] **Step 2: Run the new tests and verify RED**

Run: `cd reader && node --test test/liquid-glass-ui.test.mjs test/icon-assets.test.mjs`

Expected: FAIL because `liquid-glass.css` is not imported and new icon mappings do not exist.

- [x] **Step 3: Add the visual layer and tokens**

Import `liquid-glass.css` immediately after `style.css`. Define tokens for canvas, paper, glass regular/clear, labels, separators, accent, danger, radii, elevation and motion. Add `.sf` mappings for the six supplied SVG files. Keep layout-critical values such as `--tbar-h`, `--sbar-w`, text sizing and source highlight colors compatible with existing JavaScript.

- [x] **Step 4: Implement platform fallbacks**

Use opaque system surfaces when `backdrop-filter` is unsupported or transparency is reduced. Disable transform/opacity choreography under reduced motion. Provide `:focus-visible` rings with at least 3:1 state contrast and preserve disabled semantics.

- [x] **Step 5: Run focused tests**

Run: `cd reader && node --test test/liquid-glass-ui.test.mjs test/icon-assets.test.mjs`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add reader/src/main.js reader/src/style.css reader/src/liquid-glass.css reader/src/assets/icons reader/test/icon-assets.test.mjs reader/test/liquid-glass-ui.test.mjs
git commit -m "style: 建立 Liquid Glass 阅读器视觉系统"
```

### Task 2: 重组应用框架与顶部工具栏

**Files:**
- Modify: `reader/index.html`
- Modify: `reader/src/core/app.js`
- Modify: `reader/src/core/extensions.js`
- Modify: `reader/src/liquid-glass.css`
- Modify: `reader/test/extensions-lifecycle.test.mjs`
- Modify: `reader/test/layout-resize.test.mjs`
- Modify: `reader/test/liquid-glass-ui.test.mjs`

**Interfaces:**
- Consumes: `ui.addToolbarWidget()` and existing `#tabs`, `#view-switch`, `#plugin-toolbar` controls.
- Produces: stable toolbar regions `#topbar-leading`, `#topbar-document`, `#topbar-context`, `#topbar-trailing`; `syncViewSwitch()` exposes `data-mode` and hides irrelevant controls without layout shift.

- [x] **Step 1: Add failing shell tests**

```js
test('工具栏具有 leading、document、context、trailing 四个稳定区域', () => {
  for (const id of ['topbar-leading', 'topbar-document', 'topbar-context', 'topbar-trailing']) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
});

test('同步和摊开按钮使用 SVG 且按视图模式切换', () => {
  assert.doesNotMatch(appSource, />⇅<|>⿻</);
  assert.match(appSource, /i-sync/);
  assert.match(appSource, /i-spread/);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `cd reader && node --test test/liquid-glass-ui.test.mjs test/extensions-lifecycle.test.mjs test/layout-resize.test.mjs`

- [x] **Step 3: Restructure toolbar markup without changing IDs**

Move `#tabs`, `#view-switch`, `#plugin-toolbar`, settings and import buttons into the four stable regions. Keep plugin widgets in registration order inside the context/trailing group. Replace sync, spread, search and close character glyphs with SVG masks.

- [x] **Step 4: Make view actions contextual**

`syncViewSwitch()` sets `data-mode` and `aria-hidden/disabled` so sync is operable only in split mode, spread only in PDF mode, and editor visibility can follow text/split mode. Use a fixed-width action slot and CSS crossfade to prevent toolbar movement.

- [x] **Step 5: Style the shell**

Create the inset floating toolbar, glass groups, lightweight document tabs, trailing right-inspector control and edge-to-edge workspace. Ensure resize handles remain reachable and existing calculations still use the same workspace dimensions.

- [x] **Step 6: Run focused tests and commit**

Run: `cd reader && node --test test/liquid-glass-ui.test.mjs test/extensions-lifecycle.test.mjs test/layout-resize.test.mjs`

```bash
git add reader/index.html reader/src/core/app.js reader/src/core/extensions.js reader/src/liquid-glass.css reader/test
git commit -m "style: 重构阅读器应用框架与工具栏"
```

### Task 3: 将书签入口迁移到阅读工具栏

**Files:**
- Modify: `reader/src/plugins/bookmarks/index.js`
- Modify: `reader/src/liquid-glass.css`
- Modify: `reader/test/bookmark-context.test.mjs`
- Modify: `reader/test/extensions-lifecycle.test.mjs`

**Interfaces:**
- Consumes: `ctx.ui.addToolbarWidget`, `ctx.bus` 的 `page:change/book:switch/book:close` 事件和现有 `book.bookmarks`。
- Produces: toolbar widget `bookmark-toggle` with `aria-pressed`; selection context no longer registers `bookmark-selection-action`.

- [x] **Step 1: Rewrite the bookmark contract test to fail**

```js
test('书签只从工具栏切换当前页，不进入文字选区浮窗', async () => {
  assert.equal(ui.registry.contextActions.some((item) => item.id === 'bookmark-selection-action'), false);
  const toggle = ui.registry.toolbarWidgets.find((item) => item.id === 'bookmark-toggle').el;
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  toggle.click();
  await flushPromises();
  assert.equal(savedBook.bookmarks[0].page, currentPage);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
});
```

- [x] **Step 2: Run test and verify RED**

Run: `cd reader && node --test test/bookmark-context.test.mjs`

- [x] **Step 3: Move the existing toggle logic**

Remove the context action registration. Register an icon-only toolbar button using `bookmark.svg/bookmark.fill.svg`, update its pressed state on page and book changes, and leave the TOC bookmark tab as browse/delete only. Do not add a shortcut.

- [x] **Step 4: Run bookmark and lifecycle tests**

Run: `cd reader && node --test test/bookmark-context.test.mjs test/extensions-lifecycle.test.mjs`

- [x] **Step 5: Commit**

```bash
git add reader/src/plugins/bookmarks/index.js reader/src/liquid-glass.css reader/test/bookmark-context.test.mjs reader/test/extensions-lifecycle.test.mjs
git commit -m "refactor: 将页书签入口移到阅读工具栏"
```

### Task 4: 建立应用内 Sheet、确认与可撤销反馈

**Files:**
- Create: `reader/src/core/dialogs.js`
- Modify: `reader/src/core/app.js`
- Modify: `reader/src/core/extensions.js`
- Modify: `reader/src/plugins/bookmarks/index.js`
- Modify: `reader/src/plugins/annotations/index.js`
- Modify: `reader/src/plugins/annotations/sidebar.js`
- Modify: `reader/src/plugins/editor/index.js`
- Modify: `reader/src/liquid-glass.css`
- Create: `reader/test/dialogs.test.mjs`
- Modify: `reader/test/folder-delete.test.mjs`
- Modify: `reader/test/home-delete.test.mjs`
- Modify: `reader/test/annotations-sidebar.test.mjs`
- Modify: `reader/test/editor-plugin.test.mjs`

**Interfaces:**
- Produces: `promptSheet(options): Promise<string|null>`, `confirmSheet(options): Promise<boolean>`, `showToast({ message, actionLabel?, onAction? }): void`.
- Consumes: callers await Sheet results; plugin context exposes `ctx.dialog.prompt`, `ctx.dialog.confirm`, and actionable `ctx.toast`.

- [x] **Step 1: Write failing dialog behavior tests**

```js
test('确认 Sheet 支持确认、取消、Escape 和焦点恢复', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger); trigger.focus();
  const result = confirmSheet({ title: '删除电子书', message: '此操作无法撤销', confirmLabel: '删除', danger: true });
  document.querySelector('[data-dialog-action="cancel"]').click();
  assert.equal(await result, false);
  assert.equal(document.activeElement, trigger);
});

test('Toast 的撤销动作只执行一次', () => {
  let count = 0;
  showToast({ message: '注释已删除', actionLabel: '撤销', onAction: () => count++ });
  document.querySelector('[data-toast-action]').click();
  assert.equal(count, 1);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `cd reader && node --test test/dialogs.test.mjs test/home-delete.test.mjs test/folder-delete.test.mjs test/annotations-sidebar.test.mjs test/editor-plugin.test.mjs`

- [x] **Step 3: Implement the dialog service**

Create one modal host at a time, trap Tab within the Sheet, close on Escape where allowed, restore focus to the source, and require an explicit action before discarding dirty input. Keep copy specific: title states the action, message states the consequence, destructive button repeats the destructive verb.

- [x] **Step 4: Replace native prompts/confirms**

Replace every `prompt()` and `confirm()` found in `core/app.js`, bookmarks, annotations and editor with awaited application services. Preserve existing confirmation boundaries: book/folder/batch destructive actions confirm; individual bookmark removal does not.

- [x] **Step 5: Add single-note undo**

Before deleting one note, retain the removed record in memory; save the deletion, show `注释已删除 · 撤销`, and restore through the existing annotations replace path if the action is pressed before the Toast closes. Batch deletion continues to confirm and does not use single-item undo.

- [x] **Step 6: Run dialog and affected feature tests**

Run: `cd reader && node --test test/dialogs.test.mjs test/home-delete.test.mjs test/folder-delete.test.mjs test/annotations-sidebar.test.mjs test/editor-plugin.test.mjs test/bookmark-context.test.mjs`

- [x] **Step 7: Commit**

```bash
git add reader/src/core reader/src/plugins reader/src/liquid-glass.css reader/test
git commit -m "feat: 统一阅读器确认与撤销交互"
```

### Task 5: 重做首页、侧栏与 Finder 式多选视觉

**Files:**
- Modify: `reader/src/core/app.js`
- Modify: `reader/src/plugins/bookmarks/index.js`
- Modify: `reader/src/plugins/annotations/sidebar.js`
- Modify: `reader/src/liquid-glass.css`
- Modify: `reader/test/home-delete.test.mjs`
- Modify: `reader/test/folder-delete.test.mjs`
- Modify: `reader/test/annotations-sidebar.test.mjs`

**Interfaces:**
- Consumes: existing selection sets and Shift/Command/Ctrl/marquee logic.
- Produces: bottom contextual action bars, Escape-to-clear behavior and consistent `aria-selected` state across home/bookmarks/annotations.

- [x] **Step 1: Add failing selection consistency tests**

```js
test('Escape 清除首页选择且多选操作条位于内容区域底部', () => {
  selectRows(['book-a', 'book-b']);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelectorAll('.ht-row.selected').length, 0);
  assert.ok(document.querySelector('.home-selection-bar'));
});

test('书签和注释卡片同步 aria-selected 并支持 Escape 清除', () => {
  selectBookmarkRows(['bookmark-a', 'bookmark-b']);
  selectAnnotationRows(['note-a', 'note-b']);
  assert.equal(document.querySelector('[data-id="bookmark-a"]').getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelector('[data-id="note-a"]').getAttribute('aria-selected'), 'true');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelectorAll('[aria-selected="true"]').length, 0);
});
```

- [x] **Step 2: Run affected tests and verify RED**

Run: `cd reader && node --test test/home-delete.test.mjs test/folder-delete.test.mjs test/bookmark-context.test.mjs test/annotations-sidebar.test.mjs`

- [x] **Step 3: Normalize selection state**

Keep the current event algorithms, but add Escape clearing, `aria-selected`, stable anchors and bottom action-bar placement. Do not reintroduce a multiselect-mode button. Ensure marquee starts from all unused blank space, not only below rows.

- [x] **Step 4: Recompose the library view**

Remove book Emoji empty states, apply larger row height and spacing, preserve inline folder expansion, and make the right detail panel a persistent Inspector. Keep drag-to-folder/root plus the existing click-based move command.

- [x] **Step 5: Recompose left and right sidebars**

Use one Inspector header/tab/list/action structure for directory/bookmarks and notes/highlights. Keep card ordering, search focus routing, color filters, timestamps, history notes and existing jump behavior.

- [x] **Step 6: Run focused tests and commit**

Run: `cd reader && node --test test/home-delete.test.mjs test/folder-delete.test.mjs test/bookmark-context.test.mjs test/annotations-sidebar.test.mjs`

```bash
git add reader/src/core/app.js reader/src/plugins/bookmarks/index.js reader/src/plugins/annotations/sidebar.js reader/src/liquid-glass.css reader/test
git commit -m "style: 重构书库与侧栏交互层级"
```

### Task 6: 重做阅读工作区、选区工具与分割控制岛

**Files:**
- Modify: `reader/src/core/app.js`
- Modify: `reader/src/core/views.js`
- Modify: `reader/src/plugins/annotations/index.js`
- Modify: `reader/src/plugins/annotations/sidebar.js`
- Modify: `reader/src/plugins/search/index.js`
- Modify: `reader/src/liquid-glass.css`
- Modify: `reader/test/annotations-context.test.mjs`
- Modify: `reader/test/annotations-sidebar.test.mjs`
- Modify: `reader/test/layout-resize.test.mjs`
- Modify: `reader/test/search-order.test.mjs`
- Modify: `reader/test/text-view-flow.test.mjs`

**Interfaces:**
- Consumes: `.book-view`, `.pdf-panel`, `.divider`, `.text-panel`, `showContextBar()` and existing resizer contracts.
- Produces: floating divider control island, source-anchored glass Popovers and consistent dismiss behavior.

- [x] **Step 1: Add failing interaction tests**

```js
test('选区浮窗不包含书签且支持 Escape 关闭', () => {
  showTextSelection();
  assert.equal(document.querySelector('.bookmark-context-action'), null);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelector('#ctxbar'), null);
});

test('视图分割控制岛不改变现有拖动与键盘比例', () => {
  assert.equal(separator.getAttribute('role'), 'separator');
  separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  assert.ok(committedRatio > initialRatio);
});
```

- [x] **Step 2: Run focused tests and verify RED where behavior is new**

Run: `cd reader && node --test test/annotations-context.test.mjs test/annotations-sidebar.test.mjs test/layout-resize.test.mjs test/search-order.test.mjs test/text-view-flow.test.mjs`

- [x] **Step 3: Apply content-first workspace styling**

Use a neutral PDF canvas, solid paper text layer and responsive gutters. Make the divider visually thin while retaining its current wide hit target. Group the two jump buttons vertically on the divider and preserve their z-index above tooltips.

- [x] **Step 4: Normalize Popover behavior**

Route outside click, source re-click and Escape through one close path for selection, annotation-card and highlighter Popovers. Keep actual text selection stable while users click inside the Popover. Keep annotation editing protected from accidental outside dismissal.

- [x] **Step 5: Restyle search and annotations without changing search routing**

Global `Command/Ctrl+F` continues to follow focus: right Inspector focus opens annotation search; body, PDF or toolbar focus opens global search. Replace remaining arrow/close characters with SVG icons and anchor result panels to their search control.

- [x] **Step 6: Run focused tests and commit**

Run: `cd reader && node --test test/annotations-context.test.mjs test/annotations-sidebar.test.mjs test/layout-resize.test.mjs test/search-order.test.mjs test/text-view-flow.test.mjs`

```bash
git add reader/src/core reader/src/plugins reader/src/liquid-glass.css reader/test
git commit -m "style: 重构阅读工作区与上下文工具"
```

### Task 7: 统一编辑器、设置、阅读外观与响应式状态

**Files:**
- Modify: `reader/src/plugins/editor/index.js`
- Modify: `reader/src/plugins/eyecare/index.js`
- Modify: `reader/src/core/app.js`
- Modify: `reader/src/liquid-glass.css`
- Modify: `reader/test/editor-plugin.test.mjs`
- Modify: `reader/test/eyecare.test.mjs`
- Modify: `reader/test/liquid-glass-ui.test.mjs`

**Interfaces:**
- Consumes: existing editor dirty state, eyecare preview/apply state and settings plugin registry.
- Produces: `.editor-mode-banner`, entity Sheet visuals and breakpoint/reduced-transparency behavior.

- [x] **Step 1: Add failing mode and accessibility tests**

```js
test('编辑模式显示状态栏并可用 Escape 退出', () => {
  toggle.click();
  assert.match(document.querySelector('.editor-mode-banner').textContent, /选择一页进行编辑/);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});
```

Assert that settings and page editor use labelled dialogs, close icons use `xmark.svg`, and unsaved dismissal awaits the shared confirm Sheet.

- [x] **Step 2: Run focused tests and verify RED**

Run: `cd reader && node --test test/editor-plugin.test.mjs test/eyecare.test.mjs test/liquid-glass-ui.test.mjs`

- [x] **Step 3: Add editor mode feedback**

Render the mode banner inside the active text panel, support Escape exit, keep page hover targeting and successful-save auto-exit. Restyle block cards and fields as an opaque editing Sheet; preserve item types and annotation archival warnings.

- [x] **Step 4: Restyle settings and reading appearance**

Use a grouped settings Sheet for plugins and a source-anchored reading Popover with live preview, Apply, Cancel and immediate Reset. Preserve the existing preview/apply behavior and reset animation.

- [x] **Step 5: Add responsive and material fallbacks**

At narrow desktop widths, keep content first, allow side Inspectors to overlay instead of shrinking the reader below its minimum width, and retain their close controls. Verify dark and eyecare tokens independently. Ensure all scroll content has insets for floating bars.

- [x] **Step 6: Run focused tests and commit**

Run: `cd reader && node --test test/editor-plugin.test.mjs test/eyecare.test.mjs test/liquid-glass-ui.test.mjs`

```bash
git add reader/src/plugins/editor reader/src/plugins/eyecare reader/src/core/app.js reader/src/liquid-glass.css reader/test
git commit -m "style: 统一阅读工具与编辑界面"
```

### Task 8: 全量验证与视觉复核

**Files:**
- Modify only files required by failures discovered in this task.

**Interfaces:**
- Consumes: completed Liquid Glass UI and all existing feature contracts.
- Produces: verified production build and documented visual states.

- [x] **Step 1: Run source hygiene checks**

Run: `git diff --check && rg -n "📖|>⇅<|>⿻<|>×<|>↑<|>↓<|window\.confirm|window\.prompt|\bconfirm\(|\bprompt\(" reader/src reader/index.html`

Expected: no Emoji structural icon, toolbar character icon or native prompt/confirm remains.

- [x] **Step 2: Run the complete test suite**

Run: `cd reader && npm test`

Expected: all tests pass, zero failures.

- [x] **Step 3: Run production build**

Run: `cd reader && npm run build`

Expected: Vite exits 0 and emits `dist/` assets.

- [x] **Step 4: Inspect primary visual states in a real browser**

Check home with no selection/book/folder/multiselect; split/PDF/text modes; both sidebars; selection/annotation Popovers; global and annotation search; reading appearance; settings; editor mode and page Sheet; confirmation and undo Toast. Repeat in dark and eyecare modes and at narrow desktop width.

- [x] **Step 5: Verify accessibility states**

Keyboard through toolbar, tabs, both Inspectors, dialog controls and resizers; verify Escape routes, focus restoration, visible focus, reduced motion and reduced transparency. Confirm no floating element obscures the focused control.

- [x] **Step 6: Commit final corrections**

```bash
git add reader
git commit -m "fix: 完成 Liquid Glass 界面验证与收尾"
```
