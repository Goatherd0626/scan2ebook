# 文字高亮与注释插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有网页阅读器中加入可随 `.s2e` 携带的多色高亮、文字注释和可拖拽右侧标注栏。

**Architecture:** 标注主体实现为 `annotations` 插件；核心只提供独立 IndexedDB store、选区锚点和 `.s2e` 侧文件导入。高亮与注释分别存储，使用 CSS Custom Highlight API 渲染，右侧栏由插件按书籍视图注入。

**Tech Stack:** JavaScript ES modules、IndexedDB、JSZip、CSS Custom Highlight API、JSDOM/node:test、Vite。

**Spec:** `docs/superpowers/specs/2026-08-25-annotations-highlights-design.md`

## Global Constraints

- 不修改 `book.json` 或 PDF；标注使用 `.s2e/annotations.json`。
- 当前 `main` 分支内联开发，不使用 subagent、worktree、独立评审或 smoke test。
- 不新增第三方依赖；保留现有搜索、脚注、跨页段落和视图同步行为。
- macOS 使用 Command，Windows/Linux 使用 Ctrl；多选删除必须确认。

---

### Task 1: 范围模型与高亮集合运算

**Files:**
- Create: `reader/src/plugins/annotations/ranges.js`
- Create: `reader/test/annotations-ranges.test.mjs`

**Interfaces:**
- Produces: `comparePosition(a,b)`, `compareRange(a,b)`, `sameRange(a,b)`, `rangeIntersects(a,b)`, `applyHighlight(records, range, color, quote, now)`, `removeHighlights(records, range, now)`。

- [ ] **Step 1: 写失败测试**：用字面量位置验证跨 item 排序、颜色覆盖时左右拆分、局部取消、相邻同色合并。
- [ ] **Step 2: 运行 `node --test reader/test/annotations-ranges.test.mjs`，确认缺少模块而失败。**
- [ ] **Step 3: 实现纯函数。** 范围统一为半开区间；覆盖流程先对每条旧记录执行差集，再插入新记录并按范围排序、合并同色邻接项：

```js
export function applyHighlight(records, range, color, quote, now = Date.now()) {
  const kept = records.flatMap((record) => subtractRecord(record, range, now));
  kept.push({ id: crypto.randomUUID(), type: 'highlight', range, color, quote, createdAt: now, updatedAt: now });
  return mergeAdjacent(kept.sort(compareRange));
}
```

- [ ] **Step 4: 重跑定向测试，确认通过。**

### Task 2: 独立存储和 annotations.json 格式

**Files:**
- Create: `reader/src/core/annotation_format.js`
- Modify: `reader/src/core/db.js`
- Modify: `reader/src/core/app.js`
- Create: `reader/test/annotations-storage.test.mjs`

**Interfaces:**
- Produces: `parseAnnotationSidecar(text, bookId)`, `buildAnnotationSidecar(records)`, `getAnnotations(db,bookId)`, `replaceAnnotations(db,bookId,records)`, `deleteAnnotations(db,bookId)`。
- App context exposes bound `getAnnotations(bookId)` and `replaceAnnotations(bookId, records)`.

- [ ] **Step 1: 写失败测试**：打开 v2 数据库，保存两本书的记录并验证隔离、替换和删书级联；验证缺失/非法 sidecar 被规范化，导出不含 `bookId`。
- [ ] **Step 2: 运行定向测试，确认 DB v1 没有 `annotations` store 而失败。**
- [ ] **Step 3: 将数据库升级为 v2，创建带 `bookId` index 的 store；实现按书查询和事务内整批替换。**
- [ ] **Step 4: 修改 `deleteBooks`，在同一个读写事务内删除 books 与对应 annotations。**
- [ ] **Step 5: 修改导入流程：读取可选 `annotations.json`，生成新 bookId 后写入独立 store；非法项统计后 toast。**
- [ ] **Step 6: 将绑定后的 annotation API 注入插件 ctx，重跑定向测试。**

### Task 3: 稳定文字锚点与富选区扩展点

**Files:**
- Create: `reader/src/core/text_anchor.js`
- Modify: `reader/src/core/views.js`
- Modify: `reader/src/core/extensions.js`
- Modify: `reader/src/core/app.js`
- Modify: `docs/reader-plugin-dev.md`
- Create: `reader/test/annotations-anchors.test.mjs`

**Interfaces:**
- Produces: `selectionToAnchor(selection)`, `resolveAnchor(textView, range)`, `scrollToAnchor(view, range)`。
- `TextView` selection payload adds `{ range, quote }` while retaining `{ text, rect, view }`.
- `addContextAction` additionally accepts `render({ selection, view, close }) => HTMLElement`.

- [ ] **Step 1: 写失败测试**：在两页多个 `.text-item` 中创建真实 DOM Range，验证序列化起止 `{page,item,offset}` 和反向恢复文字；验证跨 item 选区。
- [ ] **Step 2: 运行定向测试，确认当前选区载荷没有稳定 range 而失败。**
- [ ] **Step 3: 实现 DOM 文本偏移序列化/恢复，忽略无文本的 `.annotations-marker`。**
- [ ] **Step 4: 扩展 TextView 选区载荷和自定义 context render；点击 ctxbar 内部不得被全局 mousedown 提前关闭。**
- [ ] **Step 5: 更新插件指南 API 表和示例，重跑定向测试。**

### Task 4: 注释插件控制器、正文渲染和选区操作

**Files:**
- Create: `reader/src/plugins/annotations/index.js`
- Modify: `reader/src/plugins/index.js`
- Modify: `reader/src/style.css`
- Create: `reader/test/annotations-plugin.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3 的 range、anchor、ctx DB API。
- Produces: 插件 `annotations`；每本书内存记录缓存；`refreshBook(bookId)`；选区颜色、取消高亮、注释保存操作。

- [ ] **Step 1: 写失败集成测试**：激活插件，选择跨 item 文字，应用颜色后验证 store；再次取消局部范围验证拆分；保存注释后验证虚线 Highlight 注册和末尾 marker。
- [ ] **Step 2: 运行定向测试，确认插件尚未注册而失败。**
- [ ] **Step 3: 注册插件和富选区浮窗。** 五个色块调用 `applyHighlight`；取消按钮根据相交记录启停；注释编辑器按完全相同范围更新或新增 note。
- [ ] **Step 4: 实现 CSS Highlight 注册。** 为五种颜色和 note underline 建立命名 Highlight；刷新时解析全部打开视图的 DOM Range，不支持 API 时保留数据并 toast 一次。
- [ ] **Step 5: 在 note 结束 item 追加 mask marker；点击触发侧栏定位。停用插件时删除 marker、Highlight 和监听。**
- [ ] **Step 6: 重跑定向测试，确认高亮、局部取消、注释和生命周期通过。**

### Task 5: 右侧栏、搜索筛选、多选和导出

**Files:**
- Create: `reader/src/plugins/annotations/sidebar.js`
- Modify: `reader/src/plugins/annotations/index.js`
- Modify: `reader/src/style.css`
- Create: `reader/test/annotations-sidebar.test.mjs`

**Interfaces:**
- Produces: `createAnnotationsSidebar({ view, records, onChange, onJump, onExport })`，返回 `{ render(records), reveal(id), destroy() }`。

- [ ] **Step 1: 写失败测试**：注释按 range 排序；切高亮视图并按颜色过滤；栏内 Cmd/Ctrl+F 搜索正确字段；Shift/Cmd/Ctrl/框选更新 selection；批量删除调用 confirm；栏宽限制并记忆。
- [ ] **Step 2: 运行定向测试，确认 sidebar 模块缺失而失败。**
- [ ] **Step 3: 实现右侧栏注入、顶栏开关、240–520px resizer、注释/高亮切换和颜色筛选。**
- [ ] **Step 4: 实现卡片跳转、单击浮窗、双击编辑、键盘删除和矩形框选。仅多选删除调用 `confirm`。**
- [ ] **Step 5: 实现栏内查找条；快捷键仅在 focus 位于侧栏时拦截，注释搜正文+quote，高亮只搜 quote。**
- [ ] **Step 6: 用 JSZip 重建 `book.pdf/book.json/annotations.json`，通过 `square.and.arrow.up.svg` 按钮下载 `<书名>-含标注.s2e`。**
- [ ] **Step 7: 重跑 sidebar 与插件测试。**

### Task 6: 集成验证与构建

**Files:**
- Modify: `reader/test/extensions-lifecycle.test.mjs`
- Modify: `docs/reader-requirements.md`

**Interfaces:**
- Consumes: 完整 annotations 插件。
- Produces: 可运行的生产构建和更新后的需求状态。

- [ ] **Step 1: 扩展生命周期测试，验证插件即时停用/启用不会重复面板、toolbar、marker 或全局监听。**
- [ ] **Step 2: 将需求文档中的高亮、注释、右侧栏和 sidecar 标为已实现；导出 Markdown/CSV 仍保留二期。**
- [ ] **Step 3: 运行 `npm --prefix reader test`，要求全部通过。**
- [ ] **Step 4: 运行 `npm --prefix reader run build` 和 `git diff --check`，要求成功；不运行 smoke test。**
- [ ] **Step 5: 只提交本功能文件和此前已确认但尚未提交的文字视图交互改动，不纳入无关文件。**
