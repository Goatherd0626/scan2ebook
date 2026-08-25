# 阅读器插件开发指南

阅读器（`frontend/`）采用**插件架构**：核心只做书库/双视图/事件总线/插件管理器，
功能全部由 `frontend/src/plugins/` 下的插件提供。本文档说明如何开发一个新插件。

## 一、最小示例

在 `frontend/src/plugins/hello/` 下新建 `index.js`：

```js
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'hello',
  name: '示例插件',
  version: '1.0.0',
  description: '一句话说明这个插件做什么',
  activate(ctx) {
    // 插件激活时执行（应用启动时 / 在设置里手动启用时）
    ctx.toast('hello 插件已激活');
    const offBookOpen = ctx.bus.on('book:open', ({ book, bookId }) => {
      console.log('打开的书：', bookId, book.meta.title);
    });

    const button = document.createElement('button');
    button.textContent = 'Hello';
    const removeToolbar = ctx.ui.addToolbarWidget({ id: 'hello', el: button });

    // 必须返回清理函数；停用插件时核心只调用一次。
    return () => {
      offBookOpen();
      removeToolbar();
    };
  },
});
```

然后在 `frontend/src/plugins/index.js` 加一行：

```js
import './hello/index.js';
```

重建即生效：`cd frontend && npm run build`（正式）或 `npm run dev`（热更新）。

## 二、注册表 API

`registerExtension(def)` 接受的字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一标识，只能包含小写字母、数字和连字符；非法或重复 ID 会注册失败 |
| `name` | 建议 | 显示名（设置里可见） |
| `version` | 可选 | 版本号 |
| `description` | 可选 | 插件描述（设置里可见） |
| `enabled` | 可选 | 默认是否启用（默认 true） |
| `activate(ctx)` | 建议 | 激活回调，收到应用级 ctx；应返回 `cleanup()` 清理函数 |
| `deactivate(ctx)` | 可选 | 兼容性的额外停用回调；通常使用 `activate` 返回的清理函数即可 |

插件在设置（⚙ → 插件）里可**启停**，状态持久化于 localStorage
（`s2e-plugin:<id>`）。同一插件不会被重复激活；停用时核心先执行 `activate`
返回的清理函数，再调用可选的 `deactivate(ctx)`。内置插件支持即时启停，无需刷新。

### 生命周期约定

插件必须清理自己拥有的全部资源，包括：

- `ctx.bus.on(...)` 返回的取消订阅函数
- `ctx.ui.add*` 返回的注销函数
- 插件创建并挂到全局页面上的 DOM
- `window` / `document` 上的事件监听器
- 未执行的 `setTimeout` / `setInterval`、观察器和其他异步资源

DOM 事件较多时建议统一使用 `AbortController`：

```js
activate(ctx) {
  const controller = new AbortController();
  document.addEventListener('keydown', onKeydown, { signal: controller.signal });
  window.addEventListener('resize', onResize, { signal: controller.signal });

  const offSwitch = ctx.bus.on('book:switch', onBookSwitch);
  return () => {
    controller.abort();
    offSwitch();
  };
}
```

插件在运行中重新启用时，之前已经打开的书不会重新触发 `book:open`、
`item:render` 或 `page:render`。如果插件会装饰现有正文，需要在 `activate`
中同时扫描 `ctx.state.tabs`，并保证重复处理不会生成重复节点；`footnotes`
插件提供了完整参考。

## 三、上下文 ctx

`activate(ctx)` 注入的内容：

| 字段 | 说明 |
|---|---|
| `ctx.bus` | 事件总线：`on(evt, fn)`（返回取消订阅函数）/ `off` / `emit` |
| `ctx.ui` | UI 扩展点（见下节） |
| `ctx.db` | **绑定好的库 API**：`getBooks() / addBook(book) / updateBook(book) / deleteBooks(ids) / moveBooks(ids, folderId)` —— 只需传书对象，无需管 IndexedDB 实例 |
| `ctx.state` | 核心状态：`books / folders / tabs / activeBookId / batchMode`（注意：`loadLibrary()` 刷新后 books 数组元素是新的对象引用） |
| `ctx.getView()` | 返回当前活动书的视图 `{ bookId, wv, pdfView, textView, model, prefs, applyPrefs, setPrefs }`；首页时可能为 null |
| `ctx.toast(msg)` | 全局提示 |
| `ctx.openBook(id)` | 打开书库中的一本书 |
| `ctx.storage` | `get(k)/set(k,v)`（localStorage 安全包装） |

## 四、事件总线

核心在以下时机 `bus.emit`（插件用 `ctx.bus.on(...)` 订阅；监听器异常会被捕获不崩核心）：

| 事件 | 载荷 | 时机 |
|---|---|---|
| `app:ready` | `state` | 应用初始化完成；运行中重新启用的插件不会收到历史事件 |
| `book:open` | `{ view, book, bookId, model }` | 打开一本书 |
| `book:switch` | `{ bookId }`（首页为 `null`） | 切换标签页 / 切回首页 |
| `book:close` | `{ bookId }` | 关闭书 |
| `item:render` | `{ el, item, page, model, bookId }` | 文字视图每个元素渲染后（heading/body；脚注插件靠它把 `⟦g⟧` 变上标） |
| `page:render` | `{ page, anchor, model, bookId }` | 每页内容渲染完成后 |
| `page:change` | `{ bookId, page }` | 当前页变化 |
| `text:scroll` | `{ bookId, page }` | 文字视图滚动（防抖后） |

## 五、UI 扩展点（ctx.ui）

| 方法 | 作用 |
|---|---|
| `ctx.ui.addToolbarWidget({ id, el })` | 往顶栏插件区加元素（搜索框、按钮等），返回注销函数 |
| `ctx.ui.addTocTab({ id, title, onShow })` | 在左侧目录面板加 tab，返回注销函数；插件仍需自行创建和删除 `#tab-body-<id>` |
| `ctx.ui.addContextAction({ id, label, apply(text, view) })` | 添加选中文字后的浮动操作项，返回注销函数 |
| `ctx.ui.addSettingsSection({ id, title, render(sec) })` | 往 ⚙ 设置对话框加分区，返回注销函数 |

同一扩展点内的 `id` 必须唯一。所有注销函数均可安全地重复调用，但插件通常只需
在自己的 `cleanup()` 中调用一次。

## 六、现有插件参考

| 插件 | 学习点 |
|---|---|
| `plugins/footnotes` | 渲染事件、现有视图补处理，以及停用时恢复原始标记 |
| `plugins/search` | 顶栏 widget、全局快捷键与 `AbortController` 集中清理 |
| `plugins/bookmarks` | `addTocTab`、自有 DOM 清理与 `ctx.db.updateBook` 持久化 |
| `plugins/eyecare` | 多个 UI 扩展点、CSS 状态回滚与 `ctx.storage` 持久化 |
| `plugins/progress` | 事件退订，以及停用时取消尚未执行的防抖保存 |

## 七、新增插件清单

1. `frontend/src/plugins/<id>/index.js` 写 `registerExtension({...})`
2. `frontend/src/plugins/index.js` 加一行 import
3. 需要新图标：优先从 macOS SF Symbols 应用导出 SVG 到 `frontend/src/assets/icons/`，
   在 `style.css` 加 `.sf.i-<name> { --sf: url(...) }`；无法取得 SVG 时再用
   `swift scripts/export_sf_symbol.swift "<SymbolName>" frontend/src/assets/icons/<name>.png [bold]` 导出 PNG 回退
4. `activate(ctx)` 返回清理函数，覆盖事件、UI、DOM、定时器等全部自有资源
5. 在 `frontend/test/*.test.mjs` 补可自动失败的行为测试，运行 `npm test`
6. 可选运行 `npm run test:smoke` 做带本地样书的阅读器集成冒烟
7. `npm run build` → 浏览器 Cmd+Shift+R

推荐在生命周期测试中至少验证：

- 激活后功能和 UI 存在
- 停用后事件不再响应，DOM/UI 注册项和待执行定时器已清理
- 再次启用后功能恢复，且同一节点或监听器只有一份
- 测试使用 `node:assert` 等真实断言，失败时进程返回非零状态

## 八、约定

- 插件之间不直接互相引用；通过 `bus` 事件与 `ctx` API 协作
- 不要改 `src/core/` 来加功能——那是核心，改需求先考虑插件化
- 事件监听器内抛出会被核心吞掉并打 console.error，不会影响阅读器（但也别依赖吞错）
- `activate` 应可在“应用已经打开若干书”的状态下执行；不要只依赖启动阶段事件
- 清理函数应可安全执行一次，并把页面恢复到未启用该插件时的状态
- DOM 类名前缀建议：插件专属元素用自身 id 前缀（如 `#find-strip`、`.fb-btn`）
