---
name: scan2ebook
description: 将扫描版书籍 PDF 转换为带原始 PDF 页码锚点的结构化 JSON、HTML 与 .s2e 电子书包。用户要求扫描书 OCR、扫描 PDF 结构化、制作可检索电子书或保留引文页码时使用。
---

# Scan2Ebook

把扫描版 PDF 逐页 OCR 和结构化，产出可检索的 JSON、单文件 HTML 与包含原 PDF 的
`.s2e` 电子书包。每个内容块必须保留来源 `pdf_page`，便于回到原书核对引文。

## 使用方式

当 `scan2ebook_open` 工具存在时，优先调用它打开 DSH 的 Scan2Ebook sidebar：

1. 让用户通过系统文件选择器选择 PDF。
2. 由用户确认两端闭区间页码、视觉模型、当前 sidebar 的临时 API Key 和费用估算。
3. 用户点击“开始转换”后，由 sidebar 展示进度、费用和取消按钮。
4. 不要同时从命令行启动第二份转换任务。

插件不可用时，再使用仓库 CLI：

```bash
.venv/bin/python -m scan2ebook "<输入.pdf>" -o "<输入 PDF 所在目录>"
```

可选参数：

- `--page-start N`：1-based 起始页，闭区间。
- `--page-end N`：1-based 结束页，闭区间。
- `--vision-model MODEL`：覆盖视觉模型。
- `--serve`：转换后启动网页阅读器。

不要在消息、日志或命令行参数中输出 API Key。插件模式下，API Key 只能由用户在
当前 sidebar 中临时输入；不使用钥匙串、`.env`、DSH Provider 或宿主环境变量。
关闭 sidebar 或 DSH 后，该 Key 应自动清除。CLI 模式仍可独立使用
进程环境中的 `DEEPSEEK_API_KEY`。

## 输出约束

- `书名.json`：结构化数据的唯一真源。
- `书名.html`：单文件快速预览。
- `书名.s2e`：原 PDF 与 `book.json` 的完整阅读器包。
- 选择部分页码时，输出中的 `pdf_page` 仍使用原 PDF 的真实页码，不从 1 重新编号。
- `items` 保持原页面阅读顺序；脚注位于页面 `items` 末尾。
- 正文脚注引用保留为 `[序号]`。
- `figure` 与 `table` 只保留位置标记，不臆造图片描述或表格转录。

## 完成检查

转换完成后检查：

1. 输出页数等于所选闭区间的页数，首尾 `pdf_page` 正确。
2. 随机核对 2–3 个正文页的 OCR、段落切分、标题与脚注引用。
3. 检查目录条目跳转；扫描件中不存在的章节允许 `pdf_page: null`。
4. 汇报输出路径、处理页数、视觉请求次数与估算费用。

若某页结构为空，先检查 OCR、API Key 与账户额度，再决定是否重跑该页；不要静默假定成功。
