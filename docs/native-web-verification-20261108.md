# 本机网页版原生引擎同步验收 · 2026-11-08

本机网页版的转换后端已从 Python 默认发现改为 Swift 原生引擎。Web 与 App 使用同一份 `desktop/engine/*.swift` 源码、同一个 Node 构建入口和相同的引擎二进制。网页仍由本机 Node.js 服务提供，转换依赖 macOS PDFKit / Vision，不需要 Python 运行环境。

## 实现与分发

- 默认依次查找包内当前架构引擎、仓库已构建资源 / App、已安装 App 和 PATH 中的 `scan2ebook-engine`。不再查找 `.venv` 或旧 `scan2ebook` Python CLI。`SCAN2EBOOK_ENGINE` 可显式指定原生引擎路径；指定路径不可用时不静默回退。
- 包内引擎放在 `reader/native/darwin-arm64/` 或 `darwin-x64/`。当前实际构建和验收为 arm64 / macOS 14.4 起，Intel 与最低系统版本未实机验收。
- `npm run build:engine` 通过 Xcode 工具链构建并临时签名；桌面构建脚本复制同一产物，保留原有离线 OCR 自检。开发构建需要工具链，使用已打包引擎无需安装 Xcode。
- npm `prepack` / `pack:check` 将当前架构的原生引擎加入网页包。非 macOS 保留书库和阅读，不提供 Python 自动回退。本次没有执行 npm 发布。
- 网页任务使用独立进程组。取消和服务关闭终止转换子进程及其打包进程；取消、失败及中断恢复时清理任务目录内的 `.work-*`。源 PDF 副本和已有书库仍按原有规则保留。

旧 Python CLI 与 DSH 工作流继续兼容；本机网页与 App 不调用该路径。仓库中开发测试或打包使用的 Python 脚本不属于转换运行时。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 类型与回归 | TypeScript 通过；165 项前端 / 网页服务测试全部通过。新增原生发现优先级、禁止 Python 回退、平台可用性、子进程组取消和中断工作目录清理检查。 |
| 独立复核 | 相关原生发现和转换服务 22 项测试由只读审查者独立复跑通过，未发现需修复的代码缺陷。 |
| 默认引擎链路 | `native-web-smoke.mjs` 未注入替代转换命令；服务报告 `engine: native-swift`。自制三页 PDF 经真实 Swift 引擎转换成功，生成 `.s2e` / JSON / HTML，4 次模型请求全部发往本机回环模拟服务。 |
| 取消与隐私 | 原生转换进入慢速回环请求后取消，任务为 cancelled，`.work-*` 已清理；历史文件中没有测试占位字符串。没有输入真实 Key。 |
| 打包检查 | 本地 `.tgz` 共 20 个文件、872,716 字节，包含可执行的 arm64 Mach-O 引擎；目标最低系统 14.4，本机签名检查通过。 |
| 仓库外独立使用 | 将实际 `.tgz` 解压到隔离目录，不依赖仓库或 `node_modules`，服务默认发现包内 Swift 引擎并读出自制 PDF 的 3 页；此检查没有启动模型转换。Node.js 本身仍是网页服务运行依赖。 |
| App 同步 | `build.py --prepare-only` 经共享 Node 入口构建成功并通过离线 OCR 自检。Web 原生资产、Tauri 资源、当前 `dist/macos/Scan2Ebook.app` 的引擎均为 390,080 字节且逐字节一致。当前 App / DMG 的运行产物无需重建替换。 |
| ego-browser | 单一 TaskSpace 3 中实测默认原生服务、重新上传 PDF、开始后清空输入、完成下载、加入书库阅读；原 PDF 的三页画布均完成渲染。 |

本轮只使用自制 PDF、隔离书库、测试占位字符串和显式限制到回环地址的模拟模型，没有访问真实用户书库或付费 API。该验证证明原生程序与网页协议和产物可用，不证明真实 DeepSeek 网络、权限、额度或转录质量。未使用原生窗口自动化工具。

## 复验

```sh
npm --prefix reader run build:engine
npm --prefix reader run test:native -- --pdf /path/to/self-made.pdf
npm --prefix reader run pack:check
python3 desktop/scripts/build.py --prepare-only
```

`test:native` 默认创建新隔离目录，只连接自身启动的回环模型；`--keep-open` 可供 ego-browser 操作同一服务。正常使用更新后需要重启原有本机网页服务，以加载新的后端代码。

截图：[网页原生转换完成](visual-check/native-web-conversion.png)、[原生产物阅读](visual-check/native-web-reading.png)。
