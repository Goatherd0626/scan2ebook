# macOS 独立应用构建

目标：交付当前 Apple Silicon Mac 可双击打开的 Scan2Ebook.app，复用现有网页界面，内置转换器，不要求使用者安装 DSH、Node 或 Python。

## 实现取舍

采用 Tauri 2 和 macOS 系统 WebKit。Rust 负责窗口、应用菜单、书库接口和转换任务；Swift 直接调用系统 PDFKit、Vision 与 URLSession，完成渲染、离线 OCR 和模型结构化。与网页版使用相同的数据和 HTTP 协议；桌面包不携带浏览器、Node 或 Python 运行时。此取舍根据用户进一步强调的小包体要求确定。

数据保存在新的桌面应用目录，不触碰已有 Scan2Ebook Reader 书库。服务只监听随机的本机端口；退出应用时终止正在运行的转换。Key 只通过子进程临时环境传递，不持久化、不进入命令行或日志。

## 工作与验收

- [x] Rust 本地接口：书库、PDF、文件夹、批注、偏好；转换上传、进度、取消、历史、下载和清理。相关 Rust 检查 12 项通过，全部使用隔离目录。
- [x] Tauri 原生外壳：服务生命周期、窗口、macOS 菜单、文件选择、下载和独立数据目录已实现。应用已独立启动；按用户要求不操作原生窗口，菜单、系统下载提示和退出确认未做原生 UI 自动化验收。
- [x] Swift 原生引擎：PDF 检查、离线 OCR 与仅回环地址的模拟模型完整转换通过；8 项原生引擎测试通过，未调用真实付费模型。
- [x] 构建 `.app` 与 `.dmg`，只读挂载安装包、复制应用并独立启动，使用 ego-browser 验证同一前端与实际 Rust/Swift 服务。
- [x] 构建资源与依赖排除在 Git 之外；构建方法及实际验证见桌面版 README 和验收记录，源码提交于 `codex/macos-desktop`。

验收详情见 [2026-11-07 验收记录](desktop-verification-20261107.md)。

用户已确认安装构建工具，Rust 安装在项目 build/ 下，未修改系统 PATH。应用最低 macOS 14.4，满足现有 PDF.js 对系统 WebKit 的要求；实际验收机器为 macOS 26.6.2、arm64。Intel、Developer ID 签名和 Apple 公证不作为本次本机构建的前提。
