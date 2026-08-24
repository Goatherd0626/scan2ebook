# scan2ebook —— 扫描版书籍 → 带页码锚定的电子书

把扫描版 PDF 书籍逐页 OCR 成电子书（网页阅读器 / Markdown / Word / EPUB），
**每个段落都锚定其来源的 PDF 页码**，方便论文写作时核对引文原始出处。

## 核心思路（AI 驱动结构化，推荐 --vision 模式）

代码只负责「渲染 + OCR + 存储/渲染」，**版面结构（标题/正文/脚注/引用位置）完全交给 AI 判断**——
纯代码规则难以覆盖不同书籍的复杂版式（古籍竖排、双栏、西文书、特殊排印），视觉模型可以通吃：

```
PDF ──▶ 逐页渲染(300dpi) ──▶ Apple Vision OCR(本地免费) ──▶ ds-vision 逐页结构化
                                                              (图像 + OCR 文本 → JSON)
                                                                     │
                                            逐页 JSON（用户约定结构，见下）│
                                              │                        ▼
                                   网页阅读器(.html)          重建 Markdown/Word/EPUB
                                   目录/脚注悬浮/搜索/复制引文   （脚注落在正文引用位置）
```

每页 JSON（键为英文，items 为有序数组，数量与顺序由识别内容决定，脚注恒在最后；
正文按自然段拆分，一段一个 body；正文中脚注引用位置保留为 `[序号]`）：

```json
{ "pdf_page": 3,
  "items": [
    {"type": "heading", "level": 1, "number": "第一章", "text": "第一章 导论"},
    {"type": "body",    "text": "……市场格局[1]？……"},
    {"type": "footnote","index": 1, "text": "参见吴承明……第12页。"}
  ]}
```

- **OCR 引擎**：macOS 自带 Vision 框架（免费、离线、M3 神经引擎加速），中英混排。
- **结构判断**：DeepSeek V4 Flash Vision Exp 同时看「页面图像 + OCR 文本」，判定
  每块的性质（标题/正文/脚注）、标题层级与编号、正文中脚注引用标记的位置，
  并顺手修正 OCR 错字。成本约 0.001 元/页。
- **页码锚定**：一律以 **PDF 页**为准（原书单双页错位不影响引用核对）。
- 另有纯本地规则模式（`--with-llm` 可加 DeepSeek 精修），适合没有 API key 时兜底。

## 安装

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# pandoc（Markdown→Word）已随项目 vendor/ 附带；也可 brew install pandoc
```

## 使用

```bash
# 推荐：AI 驱动结构化（先 cp .env.example .env 并填入 API key）
.venv/bin/python -m scan2ebook 书.pdf -o output --vision

# 纯本地规则模式（不调用任何 API）
.venv/bin/python -m scan2ebook 书.pdf -o output

# 常用选项
#   --force-ocr     PDF 自带文字层时也强制走 OCR（默认检测到文字层直接抽取）
#   --page-marks    页码呈现方式：banner=页面高亮横幅（默认）/ inline=每段后行内标记
#                   / footnote=页脚注 / none=不显示
#   --inline-pages  等价于 --page-marks inline（旧参数）
#   --no-page-notes 等价于 --page-marks none（旧参数）
#   --no-footnotes  丢弃脚注
#   --no-docx       只生成 Markdown，不转 Word
#   --no-epub       不生成 EPUB
```

## 输出

**`--vision` 模式**（推荐）额外产出：

| 文件 | 说明 |
|---|---|
| `输出目录/书名.html` | **网页阅读器**（自包含单文件）：侧边目录、页码横幅、脚注悬浮、全文搜索、选中引文一键复制「原文——PDF 第 N 页」、字号/深色模式 |
| `输出目录/pages/page_NNN.json` | **逐页结构化 JSON**（用户约定格式，每页一个文件） |
| `输出目录/书名_pages.json` | 全部页合并为一个 JSON |
| `输出目录/书名.md / .docx / .epub` | 由结构化 JSON 重建，**脚注落在正文引用位置**（Word 里是真正的页脚注） |

规则模式产出：`书名.md / .docx / .epub / paragraphs.jsonl / meta.json`（页码以
黄色高亮横幅呈现，`--page-marks` 可切换 inline/footnote/none）。

## 项目结构

```
scan2ebook/
├── scan2ebook/          # 主包
│   ├── cli.py           # 命令行入口（--vision 模式 / 规则模式）
│   ├── pdf_utils.py     # PDF 渲染 / 文字层探测
│   ├── ocr_engine.py    # Apple Vision OCR 封装
│   ├── vision.py        # ds-vision 逐页结构化（图像+OCR→JSON，含重试）
│   ├── web_reader.py    # 网页阅读器生成
│   ├── layout.py        # 规则模式版面分类（页眉/页脚/脚注/正文）
│   ├── builder.py       # 规则模式段落组装 + items→Markdown
│   ├── llm.py           # DeepSeek 元数据/标题精修
│   ├── docx_out.py      # pandoc / python-docx 转 Word/EPUB
│   └── config.py        # 环境配置
├── scripts/make_sample_book.py  # 生成合成扫描书用于测试
└── vendor/pandoc-*/     # pandoc 二进制
```

## 已知限制与路线图

- [ ] 双栏版面按列阅读（已检测，未按列重组）
- [ ] DeepSeek 逐段 OCR 纠错（修形近字/缺字，如 己/已）
- [ ] 竖排古籍（Vision 支持竖排，需版面参数调整）
- [ ] 图表/插图识别与保留
- [ ] EPUB 输出
- [ ] 简单网页界面（拖入 PDF → 下载 docx）
- [ ] 多本书批量处理
- [ ] 原书页码（书页号）识别（如需要可恢复，代码预留了接口）
