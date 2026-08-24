# scan2ebook —— 扫描版书籍 → 带页码锚定的网页阅读器

把扫描版 PDF 书籍转换成**可跳转的网页阅读器**（单 HTML 文件，双击即开），
同时产出整本结构化 JSON。**每个段落锚定其来源的 PDF 页码**，选中引文可一键
复制「原文 —— PDF 第 N 页」，专为论文引文核对设计。

## 核心思路（AI 驱动结构化）

代码只负责「渲染 + OCR + 渲染输出」，**版面结构（标题/正文/脚注/引用位置/
页面类型）完全交给 AI 判断**——纯代码规则难以覆盖不同书籍的复杂版式
（古籍竖排、双栏、西文书、特殊排印），视觉模型可以通吃：

```
PDF ──▶ 逐页渲染(300dpi) ──▶ Apple Vision OCR(本地免费)
                                    │  （图像 + OCR 文本）
                                    ▼
                       ds-vision 逐页结构化（每页约 0.001 元）
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                      ▼
        整本书 JSON（唯一真源）              网页阅读器(.html)
        pdf_source / book / toc / pages      目录跳转 / 脚注悬浮 / 搜索 / 复制引文
```

- **OCR**：macOS 自带 Vision 框架（免费、离线、M3 神经引擎加速），中英混排；
  PDF 自带文字层时直接取文字层（更准更快）
- **结构化**：DeepSeek V4 Flash Vision Exp 同时看「页面图像 + OCR 文本」，
  判定每页类型（封面/书名页/版权页/目录/正文/空白）、每块性质（标题/正文/脚注）、
  标题层级与编号、正文中脚注引用位置，并修正 OCR 错字
- **页码锚定**：一律以 **PDF 页**为准（原书单双页错位不影响引用核对）

## 安装

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
```

## 使用

```bash
.venv/bin/python -m scan2ebook 书.pdf -o output

# 常用选项
#   --force-ocr     PDF 自带文字层时也强制走 OCR（默认检测到文字层直接抽取）
#   --no-footnotes  丢弃脚注
#   --split-pages   额外输出 pages/page_NNN.json（抽查单页识别质量用）
```

## 输出

| 文件 | 说明 |
|---|---|
| `输出目录/书名.html` | **网页阅读器**（自包含单文件）：侧边目录跳转、页码横幅、脚注悬浮、全文搜索、选中引文一键复制「原文——PDF 第 N 页」、字号/深色模式 |
| `输出目录/书名.json` | **整本书结构化 JSON**（唯一真源） |
| `输出目录/pages/page_NNN.json` | 逐页 JSON（`--split-pages` 可选输出） |

## JSON Schema

```json
{ "pdf_source": "书.pdf",
  "book": {"title": "…", "author": "…", "publisher": "…"},
  "toc": [{"number": "1", "text": "前言", "level": 1, "printed_page": 3, "pdf_page": 18}],
  "pages": [
    {"pdf_page": 3, "page_kind": "body", "items": [
      {"type": "heading", "level": 1, "number": "第一章", "text": "第一章 导论"},
      {"type": "body",    "text": "……市场格局[1]？……"},
      {"type": "footnote","index": 1, "text": "参见吴承明……第12页。"}
    ]},
    {"pdf_page": 13, "page_kind": "toc", "items": [], "toc": [{"number":"1","text":"前言","level":1,"printed_page":3}]}
  ]}
```

约定：
- 键全英文；`items` 为有序数组，数量与顺序由识别内容决定
- **脚注恒在 items 最后**；**一个自然段 = 一个 body**
- 正文中脚注引用位置保留为 `[序号]`；标题带 `number`（印刷编号）与 `level`（1/2/3）
- 每页有 `page_kind`：cover/title/copyright/toc/body/blank/other；
  封面/版权/空白页 items 为空（阅读器不渲染）
- 目录页（page_kind=toc）输出 `toc` 数组（含目录标注的 printed_page）
- **书级 `toc`**：目录条目与正文标题文本模糊匹配，`pdf_page` 为跳转目标；
  扫描件中缺失的内容条目 `pdf_page` 为 null（阅读器灰显）

## 项目结构

```
scan2ebook/
├── scan2ebook/
│   ├── cli.py           # 命令行入口
│   ├── pdf_utils.py     # PDF 渲染 / 文字层探测
│   ├── ocr_engine.py    # Apple Vision OCR 封装
│   ├── vision.py        # ds-vision 逐页结构化（图像+OCR→JSON，含重试/页面分类）
│   ├── toc.py           # 目录装配：TOC 条目 ↔ 正文标题匹配
│   ├── web_reader.py    # 网页阅读器生成（自包含 HTML）
│   ├── llm.py           # DeepSeek 元数据提取
│   ├── page_model.py    # 数据结构（TextBlock/Page）
│   └── config.py        # 环境配置
└── scripts/make_sample_book.py  # 生成合成扫描书用于测试
```

## 已知限制与路线图

- [x] Skill 注册：`~/.dsh/skills/scan2ebook/SKILL.md`
- [ ] 竖排古籍（Vision 支持竖排，提示词需按版式调整）
- [ ] 双栏版面（ds-vision 可处理，需验证）
- [ ] 图表/插图识别与保留
- [ ] 多本书批量处理
- [ ] Web GUI 插件（暂缓）：`~/.dsh/plugins/dsh-client-ui-scan2ebook/`，
      用 `dsh-better-sidebar` 的 `registerTab` 挂侧边栏「📖 电子书转换」
