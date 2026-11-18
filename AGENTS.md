# Scan2Ebook 给 AI 助手的安装与验证说明

项目有两个独立入口。macOS App 内置 Swift 转换引擎。本机网页版由 Node.js 提供服务，在 macOS 上使用同一份原生引擎。按用户需要选择 GitHub Release 的 DMG 或 npm 的 Web 包。功能和操作见 [README](README.md)。

## 安装与验证边界

- 安装或验证时不索取、读取、保存或回显 API Key，不创建 `.env`，不启动真实转换或调用付费模型。
- 需要安装软件、修改 `PATH` 或写入用户目录之外时，先征求用户确认。
- 保留已有数据。网页版默认使用 `~/Library/Application Support/Scan2Ebook Reader/`，桌面版默认使用 `~/Library/Application Support/com.scan2ebook.desktop/`。测试使用隔离数据目录。

## 本机网页版

检查 Node.js 是否为 20.19 或更新版本。使用 `npm install --global scan2ebook-reader@0.2.0` 安装，并用 `scan2ebook-reader --version` 核对版本为 `0.2.0`。当前 npm 包内含 Apple Silicon 引擎，转换要求 macOS 14.4 及以上。

运行 `scan2ebook-reader` 打开页面，默认地址为 `http://127.0.0.1:8765`。需要从源码构建或查看启动参数时，参照 [网页版说明](reader/README.md)。

## macOS App

核对机器为 Apple Silicon，macOS 版本为 14.4 或更新版本。安装包在 GitHub 的 [v0.2.0 Release](https://github.com/Goatherd0626/scan2ebook/releases/tag/v0.2.0)。使用 `Scan2Ebook_0.2.0_aarch64.dmg`，将 App 拖到「应用程序」。临时签名和首次打开的处理见 [桌面版说明](desktop/README.md)。

从源码构建和运行原生引擎测试的步骤见 [桌面版说明](desktop/README.md)。测试使用自制 PDF、占位 Key 和本机回环模拟模型。 [发布与维护检查清单](docs/release-checklist.md)

安装完成后用简洁中文说明安装了哪个入口、怎样打开，以及如何添加 PDF 或 `.s2e` 文件。转换所需的 Key 由使用者在界面自行输入。

两个入口都支持从本机程序上传 PDF、打开转换页和查询任务。操作见 [本机自动化 API](reader/AUTOMATION.md)。
