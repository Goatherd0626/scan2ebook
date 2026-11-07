# macOS 原生转换器

仅依赖 Foundation、AppKit、PDFKit、Vision、CoreGraphics 和系统 `/usr/bin/ditto`。桌面产物不包含或调用 Python、Node、PyObjC；Python 仅用于开发时启动回环假模型测试。

构建：`sh desktop/engine/build.sh /tmp/scan2ebook-engine`。目标为 arm64 / macOS 13.0，实际运行验证环境为 macOS 26.6.2；未在 macOS 13 真机验证。

CLI：

- `engine inspect FILE`：返回 PDF 页数 JSON，拒绝锁定、损坏和零页文件。
- `engine --self-check [FILE]`：默认自制扫描 PDF，执行真实本机 300 DPI 渲染及 Vision 中英 OCR；不连接模型、不读取 Key。
- `engine FILE -o DIR --page-start N --page-end N --vision-model MODEL --workers N --progress-json`：兼容既有转换参数和 `S2E_EVENT`；输出原文件名的 `.json`、`.html`、`.s2e`。归档根目录为 `book.json` 和原始 `book.pdf`。

每页优先使用可靠文字层，否则进行本机 OCR。供模型的图像缩至宽 1024；少于 3 字的空白/极简页跳过视觉请求。页码保留原 PDF 的 1-based 编号，脚注放在页末，图片与表格仅保留来源标记。复用现有 prompt 和 HTML 模板；TOC 按标题相似度与编号匹配。HTML 对局部脚注编号做全局映射。

Key 只从当前子进程 `DEEPSEEK_API_KEY` 取得，不写入产物、日志或请求参数。网络/解析失败返回失败事件和非零退出，不生成空白伪成功；HTTP 错误不回显服务端原文。父进程消失时引擎退出。中间文件仅在输出目录 `.work-UUID` 内，正常返回时删除；强制取消后的清理由 Rust 进程组与任务生命周期管理。

离线测试：`python3 desktop/engine/tests/run.py`，8 项覆盖 PDF 检查、真实 OCR、自制扫描 PDF 全协议转换、页结构/TOC/脚注/HTML、重试与失败、测试端点边界、父进程退出，以及真实 `ditto` 加入引擎进程组后可被整组取消。测试只用占位 Key 和回环 HTTP，不访问用户书库或真实模型。当前 Codex 沙箱限制系统 Vision 图像服务，完整 OCR 测试需在获准的本机环境运行。

假模型需同时设置环境 `SCAN2EBOOK_TEST_API_BASE=URL` 与显式前缀 `engine --test-api-base URL ...`；URL 必须完全相同，且仅限 `http://127.0.0.1` / IPv6 回环，禁止重定向。该测试证明本机协议和产物可运行，不证明真实模型的转录质量。完整 App 的本地假模型验收由 `desktop/tests/app_smoke.py` 提供。
