# Scan2Ebook 给 AI 助手的安装与验证说明

项目有两个独立入口。macOS App 内置 Swift 转换引擎。本机网页版由 Node.js 提供服务，在 macOS 上使用同一份原生引擎。按用户需要选用入口，并从当前源码构建。功能和操作见 [README](README.md)。

## 安装与验证边界

- 安装或验证时不索取、读取、保存或回显 API Key，不创建 `.env`，不启动真实转换或调用付费模型。
- 需要安装软件、修改 `PATH` 或写入用户目录之外时，先征求用户确认。
- 保留已有数据。网页版默认使用 `~/Library/Application Support/Scan2Ebook Reader/`，桌面版默认使用 `~/Library/Application Support/com.scan2ebook.desktop/`。测试使用隔离数据目录。

## 本机网页版

在 `reader/` 中运行 `npm ci`、`npm run build`。在支持的 Mac 上运行 `npm run build:engine` 准备 PDF 转换引擎。启动参数、构建依赖和离线检查见 [网页版说明](reader/README.md)。

先用 `node reader/bin/scan2ebook-reader.js --help` 检查入口。构建完成后可双击根目录的「打开 Scan2Ebook.command」，也可在 `reader/` 中运行 `npm start`。默认地址为 `http://127.0.0.1:8765`。

## macOS App

构建需要 Xcode、Rust、Node.js 和 Python 3。按 [桌面版说明](desktop/README.md) 准备依赖并执行 `python3 desktop/scripts/build.py`。本地构建产物位于 `dist/macos/`。App 运行时直接使用系统提供的组件及内置引擎。

原生引擎测试执行 `python3 desktop/engine/tests/run.py`，使用自制 PDF、占位 Key 和本机回环模拟模型。发布相关检查见 [发布与维护检查清单](docs/release-checklist.md)。当前源码版本为 0.2.0，npm 上已有的 `scan2ebook-reader@0.1.0` 为早期阅读器。

安装完成后用简洁中文说明安装了哪个入口、怎样打开，以及如何添加 PDF 或 `.s2e` 文件。转换所需的 Key 由使用者在界面自行输入。

两个入口都支持从本机程序上传 PDF、打开转换页和查询任务。操作见 [本机自动化 API](reader/AUTOMATION.md)。
