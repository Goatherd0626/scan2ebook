# Scan2Ebook

把扫描版 PDF 书籍转换成更适合阅读、检索和核对引文的电子书。

Scan2Ebook 会保留原始 PDF，并生成可搜索的文字版本。阅读时可以在原 PDF 和识别文字之间双向跳转，查看原始页码，适合阅读史料、旧书、扫描教材和论文参考文献。

当前版本 **0.2.1** · [MIT License](LICENSE)

## 使用方式

| 入口 | 功能 | 获取方式 |
|---|---|---|
| macOS 独立应用 | 转换、书库、阅读和本机自动化 | [下载 0.2.1 DMG](https://github.com/Goatherd0626/scan2ebook/releases/download/v0.2.1/Scan2Ebook_0.2.1_aarch64.dmg) |
| 本机网页版 | 转换、书库、阅读和本机自动化 | [npm `scan2ebook-reader@0.2.1`](https://www.npmjs.com/package/scan2ebook-reader/v/0.2.1) |

Web 和 App 共用 Swift 原生引擎，使用 macOS 的 PDFKit 和 Vision。此前为 DSH 和旧命令行工作流保留的插件、Skill 和 Python 转换器已退役。

## 你可以用它做什么

- 把扫描版 PDF 转换为 `.s2e` 电子书，或只转换指定页码范围。
- 同时查看原 PDF 和识别后的文字，点击文字跳回对应的 PDF 页核对引文。
- 搜索全文、添加书签、高亮和注释。
- 调整字号、行距、正文宽度，使用护眼或深色模式。
- 在本地书库中按文件夹整理电子书。

## macOS 独立应用

在 Apple Silicon Mac 上使用，最低要求 macOS 14.4。打开从 GitHub Release 下载的 DMG，将 Scan2Ebook 拖到「应用程序」。桌面包采用临时签名。首次打开时若 macOS 提示无法验证开发者，请查看桌面版说明。 [桌面安装说明](desktop/README.md)

## 本机网页版

安装 Node.js 20.19 或更新版本，然后通过终端安装并启动网页版。

```sh
npm install --global scan2ebook-reader@0.2.1
scan2ebook-reader
```

服务默认在 `http://127.0.0.1:8765` 打开页面。此 npm 版本内置 Apple Silicon 原生引擎，支持在 macOS 14.4 及以上转换 PDF。Windows 和 Linux 可使用书库与阅读功能。 [网页版安装和构建说明](reader/README.md)

## 转换与阅读

1. 点击「添加书籍」或拖入文件。扫描 PDF 会进入转换页，已有 `.s2e` 电子书会直接加入书库。
2. 确认 PDF 实际页序，需要时调整起止页。
3. 输入本次使用的 DeepSeek API Key，点击「开始转换」。模型可以改为自己账户可用的多模态模型。
4. 完成后下载 `.s2e`、JSON、HTML，或点击「阅读电子书」加入书库。

只阅读已有的 `.s2e` 文件无需 API Key。界面在开始转换或离开转换页时清空 Key 输入。中断的任务需重新输入 Key 后再次转换。右上角铃铛可查看任务进度和历史结果。关闭本地服务会停止正在运行的转换。

本机脚本或 AI 工具可以准备 PDF 和页码，打开转换页让用户确认并输入 Key。转换开始后可查询进度，完成后可下载结果。两个入口共用同一套接口。 [本机自动化 API](reader/AUTOMATION.md)

## 书库和转换结果

| 产物 | 用途 |
|---|---|
| `书名.s2e` | 含原 PDF 和识别后的结构化数据，可导入 Scan2Ebook |
| `书名.json` | 结构化文字数据 |
| `书名.html` | 可直接打开的轻量预览 |

转换结果保存在应用数据目录中，可通过下载按钮另存。网页刷新或重启服务后仍可访问历史任务，清理转换任务只移除上传副本和对应产物。

在 macOS 上，网页版和 App 分别使用以下数据目录，记录导入的书、阅读进度、文件夹、书签、高亮、注释和阅读设置。

- 网页版使用 `~/Library/Application Support/Scan2Ebook Reader/`。
- 桌面版使用 `~/Library/Application Support/com.scan2ebook.desktop/`。

可用 `.s2e` 文件在两端导入书籍。请保留原始 PDF 和 `.s2e` 文件，备份或恢复数据前先关闭应用和本机服务。

## 合法使用与版权

- 请确保你要转换的 PDF 是自有、已购买、公有领域或已获授权的材料，并遵守所在地区的版权法规。
- 转换时，选定页面的图像与识别文字会发送给你配置的多模态模型服务，请确认该材料允许上传到第三方服务。
- 请勿处理无权使用、含他人个人信息或涉密的材料，或公开传播受版权保护的转换产物。
- 本仓库不含真实书籍 PDF 或转换产物。

识别结果仍可能出错，正式引用前请回到对应 PDF 页核对。模型价格、重试次数和实际计费方式可能变化，费用以服务商账单为准。

## 更多资料

- [给 AI 助手的安装与验证说明](AGENTS.md)
- [网页阅读器扩展开发](docs/reader-plugin-dev.md)
- [发布与维护检查清单](docs/release-checklist.md)
- [品牌资源](design/brand/README.md)
- [第三方许可与来源](reader/THIRD_PARTY_NOTICES.md)

问题与建议可以提交到 [GitHub Issues](https://github.com/Goatherd0626/scan2ebook/issues)。
