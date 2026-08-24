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
    ctx.bus.on('book:open', ({ book, bookId }) => {
      console.log('打开的书：', bookId, book.meta.title);
    });
  },
  deactivate(ctx) {
    // 停用时执行（便于清理事件监听等）
    // 注意：bus.on 返回的取消订阅函数应在此调用
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
| `id` | ✅ | 唯一标识（小写字母/数字/连字符） |
| `name` | 建议 | 显示名（设置里可见） |
| `version` | 可选 | 版本号 |
| `description` | 可选 | 插件描述（设置里可见） |
| `enabled` | 可选 | 默认是否启用（默认 true） |
| `activate(ctx)` | 建议 | 激活回调，收到应用级 ctx |
| `deactivate(ctx)` | 可选 | 停用回调 |

插件在设置（⚙ → 插件）里可**启停**，状态持久化于 localStorage
（`s2e-plugin:<id>`）。启停会调用 activate/deactivate（部分 DOM 场景需刷新生效）。

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
| `app:ready` | `state` | 应用初始化完成 |
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
| `ctx.ui.addToolbarWidget({ id, el })` | 往顶栏插件区加元素（搜索框、按钮等） |
| `ctx.ui.addTocTab({ id, title, onShow })` | 在左侧目录面板加 tab（需自建 `#tab-body-<id>` 容器） |
| `ctx.ui.addContextAction({ id, label, apply(text, view) })` | 选中正文文字后的浮动操作条项 |
| `ctx.ui.addSettingsSection({ id, title, render(sec) })` | 往 ⚙ 设置对话框加分区 |

## 六、现有插件参考

| 插件 | 学习点 |
|---|---|
| `plugins/footnotes` | `item:render`/`page:render` 事件 + 悬浮/点击交互 |
| `plugins/search` | 顶栏 widget + 键盘快捷键（⌘F/F3）+ 场景感知（首页/开书） |
| `plugins/bookmarks` | `addTocTab` + 数据持久化（`ctx.db.updateBook`） |
| `plugins/eyecare` | `addSettingsSection` + `ctx.storage` 持久化 + CSS 变量应用 |
| `plugins/progress` | 事件订阅 `text:scroll` + 防抖保存 |

## 七、新增插件清单

1. `frontend/src/plugins/<id>/index.js` 写 `registerExtension({...})`
2. `frontend/src/plugins/index.js` 加一行 import
3. 需要新图标：`swift scripts/export_sf_symbol.swift "<SymbolName>" frontend/src/assets/icons/<name>.png [bold]`，
   在 `style.css` 加 `.sf.i-<name> { --sf: url(...) }` 类
4. `npm run build` → 浏览器 Cmd+Shift+R
5. 补 `frontend/test/reader-smoke.mjs` 冒烟断言（核心+插件集成测试，能防回归）

## 八、约定

- 插件之间不直接互相引用；通过 `bus` 事件与 `ctx` API 协作
- 不要改 `src/core/` 来加功能——那是核心，改需求先考虑插件化
- 事件监听器内抛出会被核心吞掉并打 console.error，不会影响阅读器（但也别依赖吞错）
- DOM 类名前缀建议：插件专属元素用自身 id 前缀（如 `#find-strip`、`.fb-btn`）
