# scan2ebook —— 扫描版书籍 → 带页码锚定的网页阅读器

把扫描版 PDF 书籍转换成**本地网页阅读器**：Overleaf 式双视图（原 PDF ↔ 转换文字），
书库 + 文件夹分类 + 标签页多开，护眼阅读环境，全文搜索、书签、阅读进度记忆。
**每个段落锚定其来源的 PDF 页码**，可双向跳转，专为论文引文核对设计。

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
                                    ▼
                 .s2e 电子书包（zip：book.pdf + book.json）
                                    │
                                    ▼
              本地网页阅读器（书库 / 双视图 / 脚注 / 护眼 / 搜索…）
```

- **OCR**：macOS 自带 Vision 框架（免费、离线、M3 神经引擎加速），中英混排
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
# 1) 转换扫描书 → 自动打包成 .s2e（pdf + json）
.venv/bin/python -m scan2ebook 书.pdf -o output

# 2) 启动本地阅读器（自动打开浏览器）
.venv/bin/python -m scan2ebook serve

# 一键：转换完直接拉起阅读器
.venv/bin/python -m scan2ebook 书.pdf -o output --serve

# 常用选项
#   --force-ocr     PDF 自带文字层时也强制走 OCR（默认检测到文字层直接抽取）
#   --no-footnotes  丢弃脚注
#   --no-bundle     不打包 .s2e
#   --serve         转换完成后自动启动阅读器并打开浏览器
#   --split-pages   额外输出 pages/page_NNN.json（抽查单页用）
```

### 阅读器启动方式（三种，任选）

| 方式 | 适合 |
|---|---|
| `python -m scan2ebook serve` | 命令行，自动开浏览器；端口被占用时自动复用已有实例 |
| `python -m scan2ebook 书.pdf --serve` | 转换完直接进阅读器 |
| **双击 `启动阅读器.command`** | Finder 双击即开（零命令行），适合非技术用户 |

阅读器打开后把 `.s2e` 拖进窗口即导入书库；书库存在浏览器 IndexedDB，
导入后电脑上的原文件可删除。

## 阅读器功能

- **双视图**：左 PDF / 右文字（Overleaf 式），中间两个按钮双向跳转；
  「⇅」开启同步滚动；视图可切换：双栏 / 仅PDF（可双页摊开）/ 仅文字
- **书库**：导入的电子书存入浏览器 IndexedDB（电脑原文件可删）；
  文件夹分类、批量移动/删除、双击书名编辑元数据
- **标签页**：多本书同时打开切换
- **左侧边栏**：上层书库，下层当前书目录（可跳转）/ 书签
- **脚注**：上标悬浮显示脚注；点击在文中插入浅灰括号脚注，再点收起
- **护眼**：护眼模式 / 深色模式 / 亮度 / 色温 / 字号 / 行距 / 阅读宽度
- **搜索**：当前书全文搜索，高亮 + 上一个/下一个跳转
- **进度记忆**：自动记录每本书读到哪，重开恢复
- **复制引文**：选中文字后（浏览器）复制，配合页码横幅核对出处

## 输出

| 文件 | 说明 |
|---|---|
| `输出目录/书名.s2e` | **电子书包**（zip：book.pdf + book.json），阅读器主格式 |
| `输出目录/书名.json` | 整本结构化 JSON（唯一真源，供检查/二次处理） |
| `输出目录/书名.html` | 单文件快速预览版阅读器（轻量） |
| `输出目录/pages/page_NNN.json` | 逐页 JSON（`--split-pages` 可选） |

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
- 每页有 `page_kind`：cover/title/copyright/toc/body/blank/other
- 目录页（page_kind=toc）输出 `toc` 数组（含目录标注的 printed_page）
- **书级 `toc`**：目录条目与正文标题文本模糊匹配，`pdf_page` 为跳转目标；
  扫描件中缺失的内容条目 `pdf_page` 为 null（阅读器灰显）

## 项目结构

```
scan2ebook/
├── scan2ebook/
│   ├── cli.py           # 转换命令行（产出 .s2e / json）
│   ├── reader.py        # 本地阅读器服务（python -m scan2ebook.reader）
│   ├── reader_web/      # 阅读器前端（index.html / app.js / views.js / db.js / style.css / lib/）
│   ├── pdf_utils.py     # PDF 渲染 / 文字层探测
│   ├── ocr_engine.py    # Apple Vision OCR 封装
│   ├── vision.py        # ds-vision 逐页结构化（含重试/页面分类）
│   ├── toc.py           # 目录装配：TOC 条目 ↔ 正文标题匹配
│   ├── web_reader.py    # 单文件预览 HTML 生成
│   ├── llm.py           # DeepSeek 元数据提取
│   └── config.py        # 环境配置
└── scripts/make_sample_book.py  # 生成合成扫描书用于测试
```

## 已知限制与路线图

- [x] Skill 注册：`~/.dsh/skills/scan2ebook/SKILL.md`
- [ ] 二期：文字高亮（多色）/ 添加注释 + 右侧注释侧边栏
- [ ] 二期：编辑模式（修正识别错误，写回 JSON）
- [ ] 二期：复制引文（GB/T 7714 模板）、标注导出
- [ ] 竖排古籍 / 双栏版面（ds-vision 可处理，需验证）
- [ ] Web GUI 插件（暂缓）：`~/.dsh/plugins/dsh-client-ui-scan2ebook/`，
      用 `dsh-better-sidebar` 的 `registerTab` 挂侧边栏「📖 电子书转换」
