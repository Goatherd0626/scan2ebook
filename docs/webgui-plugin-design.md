# DSH Web GUI 插件设计稿（待做）

> 状态：**设计稿 / 暂缓**。当前阅读器以「本地网页 + skill」形态交付，
> 等真实扫描书测试稳定、功能定型后再实现。
> 目的：给 DSH Web 界面加一个「📖 电子书转换」侧边栏入口，
> 让非技术用户（不经命令行）也能导入 PDF → 转换 → 打开阅读器。

## 一、背景：DSH 的插件机制（已调研确认）

本机已有三套能力包形态，scan2ebook 选择的前两个已落地：

| 形态 | 位置 | 状态 |
|---|---|---|
| **Skill** | `~/.dsh/skills/scan2ebook/SKILL.md` | ✅ 已注册 |
| **本地网页阅读器** | `frontend/` + `python -m scan2ebook serve` | ✅ 已实现 |
| **Web GUI 客户端插件** | `~/.dsh/plugins/dsh-client-ui-scan2ebook/` | ⏳ 本设计稿 |

调研结论（来自已装插件 `dsh-client-ui-file-mention` 与 `dsh-better-sidebar`）：

- 插件包：`~/.dsh/plugins/<name>/`，含 `package.json`（声明
  `"dsh": { "client": { "platform": "web" } }` 与 `exports["./client"]`）、
  `lib/index.js`（宿主半：`connection.rpc.handle('/xxx', ...)`）、
  `lib/client.js`（浏览器半：`window.__ModuleLoader__.load({id, factory})`）
- 侧边栏标签：用 `dsh-better-sidebar` 的
  `ctx.betterSidebar.registerTab({ id, title, component })`（React 组件，
  组件接收 `{ scope }`，scope 带 sessionId）
- 接线：软链进 `~/.dsh/profiles/web/node_modules/` + `cordis.patch.yml`
  insert loader 条目 + 刷新页面（与 file-mention 的安装流程一致）

## 二、目标形态

```
DSH Web GUI 侧边栏「📖 电子书转换」标签
  ├─ 选择工作区里的扫描 PDF（或拖入）
  ├─ 点击「转换」→ 宿主半 spawn Python 流水线（.venv + DEEPSEEK_API_KEY）
  ├─ 实时回传进度（阶段日志：渲染/OCR/ds-vision 结构化）
  └─ 完成后显示下载/打开按钮：.s2e 包、启动阅读器
```

- 重活全在宿主机（Python 流水线不动），插件只是 GUI 壳 + RPC 桥
- 与 Skill 共用同一套 `.s2e` 产物与阅读器，不重复实现

## 三、模块划分

### 宿主半 `lib/index.js`

```js
export const name = 'scan2ebook'
export const inject = ['connection']   // 或 ctx.inject(['connection'], ...)

export function apply(ctx) {
  ctx.inject(['connection'], ({ connection }) => {
    connection.rpc.handle('/scan2ebook/list-pdfs',  async (ep, { sessionId }) => { /* 列出工作区 PDF */ })
    connection.rpc.handle('/scan2ebook/run',        async (ep, { sessionId, pdf }) => { /* spawn 流水线，流式进度 */ })
    connection.rpc.handle('/scan2ebook/status',     async (ep, { jobId }) => { /* 查询状态 */ })
    connection.rpc.handle('/scan2ebook/cancel',     async (ep, { jobId }) => {})
  })
}
```

### 浏览器半 `lib/client.js`

```js
// 注入 betterSidebar（if 可用）
inject: ['betterSidebar']
function apply(ctx) {
  ctx.betterSidebar.registerTab({
    id: 'scan2ebook',
    title: '📖 电子书转换',
    component: ({ scope }) => {/* React 组件：PDF 列表/拖拽 + 进度 + 下载按钮 */},
  })
}
```

### 打包依赖
前端插件无需构建（参考 file-mention 的「手写 bundle」），宿主半可用纯 Node。

## 四、实现步骤（立项后）

1. `~/.dsh/plugins/dsh-client-ui-scan2ebook/` 建包（对照 file-mention 结构）
2. 宿主半：rpc 桥接 Python（`subprocess.spawn` + 日志流）
3. 浏览器半：better-sidebar tab + 上传/进度 UI（参考 `dsh-better-sidebar/docs/` 组件示例）
4. 接线：软链 + `~/.dsh/profiles/web/cordis.patch.yml` insert
5. 自测：RPC 冒烟（curl/浏览器控制台）、转换一本真实书
6. 授权口径：API key 复用仓库 `.env`；转换结果写入默认输出目录

## 五、注意

- 转换任务很重（几百页 ≈ 数分钟 + ~0.3 元 API 费），进度反馈与取消按钮必须有
- 只允许转换，不做「网页端阅读」——阅读仍用现有阅读器（浏览器打开 8765）
- 相关参考实现：
  - `~/.dsh/plugins/dsh-client-ui-file-mention`（宿主/浏览器半结构）
  - `~/.dsh/profiles/web/node_modules/dsh-better-sidebar/README.md`（registerTab 用法）
