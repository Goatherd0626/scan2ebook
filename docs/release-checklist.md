# 发布与维护检查清单

## 发布状态

- Web 通过 npm 分发，`0.2.1` 包含 Apple Silicon 原生引擎和本机自动化接口。 [npm 版本记录](https://www.npmjs.com/package/scan2ebook-reader?activeTab=versions)
- macOS 桌面包通过 GitHub Release 分发。`v0.2.1` 的 Apple Silicon DMG 使用临时签名，首次打开的处理见安装文档。 [GitHub Release](https://github.com/Goatherd0626/scan2ebook/releases/tag/v0.2.1) · [桌面版说明](../desktop/README.md)

## 发布前

- [ ] 重新构建目标架构的原生引擎和桌面包，确认最低系统版本，并记录实际验收的硬件与系统。
- [ ] 从全新检出验证网页版源码构建和启动。运行 `npm --prefix reader run pack:check` 检查 npm 包在 macOS 上包含匹配架构的引擎与所需文件。
- [ ] 从安装包复制并启动 App，验证书库、PDF 转换、任务清理、下载和阅读。用隔离数据目录、自制 PDF 和本机模拟模型。
- [ ] 验证本机自动化的 PDF 上传、页码预填、状态查询和结果下载。 [本机自动化 API 说明](../reader/AUTOMATION.md)
- [ ] 检查截图、示例和打包文件，保留适当的许可和署名，排除真实书籍、个人信息、密钥和本机环境文件。 [MIT 许可证](../LICENSE) · [第三方许可](../reader/THIRD_PARTY_NOTICES.md)
- [ ] 运行完整 Git 历史的秘密扫描。2026-10-08 的全历史扫描未发现泄露，当前发布以本次扫描为准。
- [ ] 验证 API Key 只用于此次任务，确认它未出现在配置、产物、历史和日志中。

## 测试与辅助工具

- [GitHub Actions](../.github/workflows/ci.yml) 检查秘密、网页端测试与构建、npm 包内容及 macOS 原生引擎回环测试。
- 原生测试自制包含空白页和加密文件的 PDF。运行 `python3 desktop/engine/tests/run.py`，覆盖 PDF 检查、Vision OCR、回环模拟请求、失败重试及打包进程清理。
- 如需更丰富的中英混排、标题和脚注测试页，可在已有 Pillow 与 PyMuPDF 的环境运行 `python3 scripts/make_sample_book.py`，输出到已忽略的 `sample/`。
- Python 仍用于桌面构建、原生和整包测试，以及可选的示例生成、JSON 报告和 DOCX 导出脚本。Web 和 App 的转换均通过 Swift 执行。 [桌面测试](../desktop/README.md) · [辅助脚本](../scripts/)

## 待办

- 完善空白和损坏 PDF、页码越界、限流及取消的跨入口验收记录。
- 补充贡献指南、Issue 模板和安全漏洞报告入口。
