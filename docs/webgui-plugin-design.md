# DSH Web GUI 插件设计与实现

> 状态：**已实现并以本地 link 包安装到 DSH web profile**。
> 源码：`dsh-plugin/dsh-client-ui-scan2ebook/`。
> 目的：给 DSH Web 界面加一个「Scan2Ebook」侧边栏入口，
> 让非技术用户（不经命令行）也能导入 PDF → 转换 → 打开阅读器。

## 一、背景：DSH 的插件机制（已调研确认）

本机三套能力包形态均已落地：

| 形态 | 位置 | 状态 |
|---|---|---|
| **Skill** | `~/.dsh/skills/scan2ebook/SKILL.md` | ✅ 已注册 |
| **本地网页阅读器** | `scan2ebook-reader` npm 包 | ✅ 已实现 |
| **Web GUI 客户端插件** | `dsh-plugin/dsh-client-ui-scan2ebook/`（link 安装） | ✅ 已实现 |

调研结论（来自已装插件 `dsh-client-ui-file-mention` 与 `dsh-better-sidebar`）：

- 插件包：`~/.dsh/plugins/<name>/`，含 `package.json`（声明
  `"dsh": { "client": { "platform": "web" } }` 与 `exports["./client"]`）、
  `lib/index.js`（宿主半：`connection.rpc.handle('/xxx', ...)`）、
  `lib/client.js`（浏览器半：`window.__ModuleLoader__.load({id, factory})`）
- 实际交互位置是 DSH 左侧主导航，与「任务看板 / SSH / 技能中心」同组并排在其后。
  该区域没有公开 slot，因此沿用这些现有插件的自修复 DOM 注入方式，点击后打开一个非阻塞的右侧 sidebar。
- 插件通过自身 `cordis.patch.yml` 接线，并使用
  `dsh plugin --profile web add link:<插件目录>` 安装；无需手改 profile lockfile。

## 二、目标形态

```
DSH Web GUI 左侧「Scan2Ebook」入口 → 单个右侧 sidebar
  ├─ 通过系统文件选择器选择任意目录中的扫描 PDF
  ├─ 选择 PDF 起止页（1-based、两端闭区间）
  ├─ 配置多模态模型与当次 API Key
  ├─ 点击「转换」→ 宿主半调用独立安装的 scan2ebook 命令（临时 DEEPSEEK_API_KEY）
  ├─ 实时回传进度（阶段日志：渲染/OCR/ds-vision 结构化）
  ├─ 按视觉请求次数显示 token 与费用估算
  ├─ 输出 JSON、HTML 和 .s2e 到所选 PDF 的同级目录
  └─ 在同一个 sidebar 下方按可编辑端口启动/打开/终止网页阅读器
```

- 重活全在宿主机；Python 流水线新增页码范围与 `S2E_EVENT` 进度协议，插件负责 GUI、RPC 和进程生命周期
- 与 Skill 共用同一套 `.s2e` 产物与阅读器，不重复实现

## 三、模块划分

### 宿主半 `lib/index.js`

```js
export const name = 'scan2ebook'
export const inject = ['connection']   // 或 ctx.inject(['connection'], ...)

export function apply(ctx) {
  ctx.inject(['connection'], ({ connection }) => {
    connection.rpc.handle('/scan2ebook', async (endpoint, payload) => {
      // bootstrap / inspect / start / status / cancel / ui-request
      // reader-start / reader-status / reader-stop
    })
  })
}
```

### 浏览器半 `lib/client.js`

```js
// 自修复地插入 data-dsh-scan2ebook-entry，位置在
// task-board / ssh / skill-explorer 这一组入口之后。
// 注册单个 dsh-better-sidebar Tab；转换和阅读器作为同一栏内的两个功能区。
```

### 打包依赖
前端插件无需构建（参考 file-mention 的「手写 bundle」）；宿主半依赖
`scan2ebook-reader@^0.1.0`，通过其 Node API 启动、识别和关闭阅读器。
Python 转换器通过 `PATH` 中的 `scan2ebook` 或配置项 `scan2ebookCommand`
发现，不再从插件源码位置推导 Git 仓库与 `.venv`。

## 四、实现步骤（立项后）

1. [x] 建立本地 DSH 双半插件包
2. [x] 宿主半：RPC 桥接 Python（`spawn` + JSON 行进度协议）
3. [x] 浏览器半：单个左侧入口 + 非阻塞右侧 sidebar + 意图检测 + Skill 工具唤起
4. [x] 通过 DSH 官方 `plugin add link:` 接入 web profile
5. [x] Python/Node 测试与阅读器启动/终止进程测试
6. [ ] 用一本真实扫描书做完整付费转换验收

## 五、注意

- 转换任务很重（几百页 ≈ 数分钟 + ~0.3 元 API 费），进度反馈与取消按钮必须有
- 只允许转换，不做「网页端阅读」——阅读仍用现有阅读器（浏览器打开 8765）
- 相关参考实现：
  - `~/.dsh/plugins/dsh-client-ui-file-mention`（宿主/浏览器半结构）
  - `~/.dsh/profiles/web/node_modules/dsh-better-sidebar/README.md`（registerTab 用法）
