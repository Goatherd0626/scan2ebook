# Tauri 2 桌面端

独立 macOS 应用已采用 Tauri 2 实现，复用 `reader/src` 前端。Rust 提供本机书库与任务服务，Swift 直接使用系统 PDFKit、Vision 和 URLSession；应用不打包 Python 或 Node。

实现、构建方法和验证边界见 [桌面版说明](../desktop/README.md)；本次工作范围见 [构建记录](desktop-build-plan.md)。实际产物位于 `dist/macos/`。

应用使用独立数据目录，不自动修改原网页阅读器书库。首版为 Apple Silicon、macOS 14.4 起，尚未进行 Developer ID 签名和公证。
