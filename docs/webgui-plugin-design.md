# DSH 插件设计与实现

> 状态:**已实现并发布**(npm `dsh-client-ui-scan2ebook@0.2.1`,同时支持从仓库路径安装)。
> 源码:`dsh-plugin/dsh-client-ui-scan2ebook/`。
> 目标:在 DeepSeek Harness Desktop 的**右侧栏**提供一个「Scan2Ebook」面板,
> 让不懂命令行的用户也能 选 PDF → 转换 → 打开阅读器。
>
> 要求 DSH Desktop **0.2.0-rc.2 或更高**。

## 一、要实现什么

```
DSH 右侧栏「Scan2Ebook」面板
  ├─ 用系统文件选择器选任意目录中的扫描 PDF
  ├─ 选起止页(1-based、两端闭区间)
  ├─ 配置多模态模型与当次 API Key
  ├─ 点「开始转换」→ 宿主半调用独立安装的 scan2ebook CLI(临时 DEEPSEEK_API_KEY)
  ├─ 实时进度:阶段日志(渲染 / OCR / 视觉结构化)+ 视觉请求次数、token 与费用估算
  ├─ 产物 JSON、HTML、.s2e 写在所选 PDF 的同级目录
  └─ 面板下方单一开关启动/停止网页阅读器,并可点地址行在系统浏览器打开
```

- 重活全在宿主机;Python 流水线提供页码范围与 `S2E_EVENT` 进度协议,插件只负责 GUI、RPC 与子进程生命周期
- 与 Skill 共用同一套 `.s2e` 产物与阅读器,不重复实现

## 二、架构

```
浏览器(DSH 渲染进程)                宿主(DSH 主进程)                    独立进程
┌──────────────────────┐   POST    ┌──────────────────────────┐  spawn   ┌──────────────┐
│ lib/client.js        │ ────────► │ lib/index.js             │ ───────► │ scan2ebook   │
│ React 面板           │ /api/     │ 工具 scan2ebook_open     │          │ (Python CLI) │
│ sidebar.right.pane   │ scan2ebook│ 精确 Fetch 路由 + 分发器 │          └──────────────┘
│   .tab 席位          │ ◄──────── │ 子进程/阅读器生命周期    │  import  ┌──────────────┐
└──────────────────────┘  JSON     └──────────────────────────┘ ───────► │ scan2ebook-  │
                                                                          │ reader (npm) │
                                                                          └──────────────┘
```

两个半边都**无需构建**(手写 ESM bundle),`files` 只打包 `lib/`、`README.md`、`cordis.patch.yml`、`LICENSE`。

## 三、客户端半 `lib/client.js`

注册流程(DSH 0.2 的官方右栏 API):

```js
window.__ModuleLoader__.load({ id: 'dsh-client-ui-scan2ebook', factory: (require) => { ... } })

const inject = ['@deepseek-ai/dsh-client-modules',
                '@deepseek-ai/dsh-client-ui-slots',
                '@deepseek-ai/dsh-client-ui-sidebar-right']
```

1. **注册 tab 类型**:`ctx.sidebarRightTabs.register({ id, kind: 'scan2ebook', priority, title, guide: [{ id, order, title, description, icon }] })`
   —— `guide` 是引导页里给用户看的条目,用户从引导页选择即可打开面板。
2. **注册正文**:`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name, key }, Scan2EbookTab))`
   —— tab 身份(id/kind)与正文注册共用同一个常量,避免错位。
3. **打开面板**:`ctx.sidebarRight.openTab('scan2ebook')`。

面板如何被唤起(三种路径,互为兜底):

| 路径 | 触发者 | 说明 |
|---|---|---|
| 引导页 / 右栏添加菜单 | 用户 | 官方入口,最稳 |
| `scan2ebook_open` 工具调用 | DSH(经 Skill) | 宿主半注册的工具,用户说「把这本书转成电子书」时 DSH 主动唤起 |
| `ui-request` 轮询 + `scan2ebook:open` 事件 | 插件自身 | 每 1200ms 查一次宿主待处理请求(localStorage 记录上次 id),跨进程通信的兜底 |

面板内部:转换视图(模型、API Key、PDF、页码、单价、进度与日志、取消)与阅读器视图(端口、单一启停开关、可点击地址行)。
**API Key 只保存在面板的 React state 中**:不写钥匙串、`.env`、`localStorage` 或日志,关闭面板或 DSH 即清除。

## 四、宿主半 `lib/index.js`

```js
export const name = 'scan2ebook'
export const inject = ['tools', 'connection']

export function apply(ctx, config) {
  ctx.tools.register({ /* scan2ebook_open:唤起面板 */ })
  ctx.effect(() => connection.fetch.register({
    path: '/api/scan2ebook', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => rpcResponse(await handleRpc(request.json().endpoint, ...)),
  }), 'scan2ebook: RPC route')
}
```

**为什么用精确 Fetch 路由,而不是 `connection.rpc.handle`**:0.2 的 `rpc.handle` 在本插件里
注册不成功(实测 `POST /scan2ebook/bootstrap` 返回 **405**,而官方 `/api` 桥返回 401=存在但需认证),
且全仓库 290 个官方包中**没有任何一个**使用 `rpc.handle`;官方包(`dsh-session-log-export`
的 `/api/session.export`、`dsh-client-file-upload` 的 `/api/session/uploadFileBinary`)统一使用
`connection.fetch.register`。因此端点挂在 `/api` 桥下的精确路由上,由桥统一做 Host/Origin 校验与浏览器鉴权。

请求/响应契约:

```
POST /api/scan2ebook   { "endpoint": "start", "args": { ... } }
→ 200 { "ok": true, "value": { ... } } | { "ok": false, "error": { "code", "message" } }
```

端点:

| 分组 | 端点 |
|---|---|
| 面板引导 | `bootstrap`(cwd、可选 PDF 列表、默认模型/端口/单价)、`choose-pdf`(系统文件选择器,返回授权后的绝对路径)、`inspect`(页数) |
| 转换 | `start`、`status`、`cancel` |
| 唤起 | `ui-request` |
| 阅读器 | `reader-start`、`reader-status`、`reader-open`、`reader-stop` |

安全边界:绝对路径必须来自 `choose-pdf` 的显式授权;工作区路径拒绝 `..` 穿越;
阅读器端口限制在 1024–65535;只有本插件启动的阅读器实例才允许 `reader-stop` 终止。

## 五、打包与配置

`package.json` 的 DSH 声明:

```json
"dsh": {
  "manifestVersion": 1,
  "engines": { "dsh": ">=0.2.0-rc.2" },
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-modules",
               "@deepseek-ai/dsh-client-ui-slots",
               "@deepseek-ai/dsh-client-ui-sidebar-right"]
  }
}
```

`cordis.patch.yml` 可调项:`defaultPort`(8765)、`defaultVisionModel`(`deepseek-flash`)、
`estimatedPricePerRequest`(0.001 元/视觉请求)、`scan2ebookCommand`(`scan2ebook`)。

依赖:`scan2ebook-reader@^0.1.0`(插件会自动装上网页阅读器,用户无需单独安装)。
Python 转换器通过 `PATH` 中的 `scan2ebook` 或 `scan2ebookCommand` 发现,**不从插件源码位置推导仓库路径**。
插件只使用 DSH 自带右侧栏,**不需要** `dsh-better-sidebar` 之类的第三方侧栏插件。

## 六、安装与验证

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile desktop add "dsh-client-ui-scan2ebook@^0.2.0"
```

- **必须带 `@^0.2.0`**:npm 上同时存在 0.1.0(旧版,依赖 better-sidebar),只写包名时 pnpm 可能写入
  `^0.1.0`,而 `0.x` 的 caret 锁小版本,之后永远升不到 0.2.0。
- 安装后**必须完全退出并重启 DSH**(`⌘Q`),插件代码只在启动时加载。
- 从仓库路径安装(开发或 npm 不可用时):
  `"$DSH" plugin --profile desktop add "file:<仓库>/dsh-plugin/dsh-client-ui-scan2ebook"`

验证:

```bash
grep '"version"' ~/.dsh/profiles/desktop/node_modules/dsh-client-ui-scan2ebook/package.json   # ≥ 0.2.0
grep -c sidebarRightTabs ~/.dsh/profiles/desktop/node_modules/dsh-client-ui-scan2ebook/lib/client.js   # ≥ 1
```

## 七、排错

| 现象 | 原因与处理 |
|---|---|
| 面板显示「无法连接 DSH 宿主」+ `HTTP 405` | 宿主半路由没注册:确认插件已安装并**完全重启** DSH;若用了 `rpc.handle` 的旧实现,改用 `/api` 精确路由 |
| 右侧栏没有 Scan2Ebook | DSH 没重启成功;或 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 缺该插件 |
| 装了但功能是旧的 | npm 解析到 0.1.0:显式 `@^0.2.0` 重装(见第六节) |
| 改了插件代码不生效 | 插件不热重载;重装后重启 DSH |

## 八、测试

`dsh-plugin/dsh-client-ui-scan2ebook/test/`(15 项,`npm test`):

- `client.test.mjs`:源码契约——注册原生右栏、声明 `guide`、无 better-sidebar/`dsh-client-runtime`/DOM 注入、API Key 面板卸载即清
- `host.test.mjs`:宿主端点行为(启动/复用/终止阅读器、区分无关服务、调用独立安装的 CLI、路径穿越与端口校验)
- `package-metadata.test.mjs`:DSH 引擎约束、注入列表、独立阅读器依赖

CI 在 `.github/workflows/ci.yml`:秘密扫描(gitleaks 全历史)+ Python(macOS,Apple Vision)+
阅读器(测试/构建/打包)+ 插件(测试/打包)。

## 九、版本记录

- **0.2.1**:面板 PDF 区新增合法使用脚注(确认对所选 PDF 有合法处理权;页面图像与文字会发送给所配置的模型服务)。
- **0.2.0**:迁移到 DSH Desktop 0.2 原生右栏;插件端点改用 `/api/scan2ebook` 精确 Fetch 路由;面板视觉重做;阅读器改为单一启停开关 + 可点击地址行;默认模型 `deepseek-flash`。
- **0.1.0**:早期原型,依赖第三方 `dsh-better-sidebar`,仅适用于 DSH 0.1.x。

## 十、历史沿革

早期原型依赖第三方 `dsh-better-sidebar` 并通过 DOM 注入左侧入口,适用于 DSH 0.1.x;
`@deepseek-ai/dsh-client-runtime` 在 0.2 已移除,该原型随之废弃并通过 `file:` 包被本次实现替换。
旧版 npm 包 `dsh-client-ui-scan2ebook@0.1.0` 仍留在 registry 上作为历史版本。
