# scan2ebook —— 扫描版书籍 → 带页码锚定的电子书

把扫描版 PDF 书籍逐页 OCR 成电子书（Markdown / Word），**每个段落都锚定其来源的
PDF 页码**，方便论文写作时核对引文原始出处。

## 核心思路

```
PDF ──▶ 逐页高清渲染 ──▶ Apple Vision OCR(本地免费) ──▶ 版面分析
(300dpi)                   (中英混排/竖排)                (页眉/页脚/脚注)
                                                              │
                                                              ▼
                                    段落组装(跨页续段/标题层级/脚注)
                                    (可选 DeepSeek 精修标题与元数据)
                                                              │
                                                              ▼
                                     Markdown(每段带 PDF 页码) ──▶ pandoc ──▶ Word(.docx)
```

- **OCR 引擎**：macOS 自带 Vision 框架（免费、离线、M3 神经引擎加速），
  支持简体/繁体中文、英文混排。
- **页码锚定**：一律以 **PDF 页**为准（原书单双页错位不影响引用核对）。
- **结构识别**：规则识别一级/二级标题（第X章 / 一、 / 1.1），可选 DeepSeek 精修。

## 安装

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# pandoc（Markdown→Word）已随项目 vendor/ 附带；也可 brew install pandoc
```

## 使用

```bash
# 基本用法（OCR 全本地，不调用任何 API）
.venv/bin/python -m scan2ebook 书.pdf -o output

# 启用 DeepSeek 精修（先 cp .env.example .env 并填入 API key）
.venv/bin/python -m scan2ebook 书.pdf -o output --with-llm

# 常用选项
#   --force-ocr     PDF 自带文字层时也强制走 OCR（默认检测到文字层直接抽取）
#   --inline-pages  每个正文段落后追加〔PDF 第N页〕可见标记（Markdown 与 Word 都显示）
#   --no-page-notes Word 中不添加 PDF 页码脚注（默认 Word 以脚注形式标注 PDF 页码）
#   --no-footnotes  丢弃脚注
#   --no-docx       只生成 Markdown
```

## 输出

| 文件 | 说明 |
|---|---|
| `输出目录/书名.md` | 带 PDF 页码注释的 Markdown（正文+标题+脚注） |
| `输出目录/书名.docx` | Word 版（标题样式、目录；**每个 PDF 页第一个段落后有脚注「PDF 第 N 页」**） |
| `输出目录/paragraphs.jsonl` | 每个段落的来源 PDF 页码索引（程序化检索用） |
| `输出目录/meta.json` | 元数据与统计 |

**PDF 页码在 Word 里的体现**：默认在每个 PDF 页的第一个段落后生成一个
真正的 Word 脚注「PDF 第 N 页」（引用时看页脚即可核对出处）；不需要时可加
`--no-page-notes` 去掉，或用 `--inline-pages` 改成行内〔PDF 第N页〕标记。

Markdown 源文件中的页码注释（Word 里默认隐藏）：
`<!-- ⏸ PDF 第 12 页 -->`

## 项目结构

```
scan2ebook/
├── scan2ebook/          # 主包
│   ├── cli.py           # 命令行入口
│   ├── pdf_utils.py     # PDF 渲染 / 文字层探测
│   ├── ocr_engine.py    # Apple Vision OCR 封装
│   ├── layout.py        # 版面分类（页眉/页脚/页码/脚注/正文）
│   ├── builder.py       # 段落组装、跨页续段、标题识别、Markdown 输出
│   ├── llm.py           # DeepSeek 精修（可选）
│   ├── docx_out.py      # pandoc / python-docx 转 Word
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
