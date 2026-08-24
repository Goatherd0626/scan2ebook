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

## 阅读器功能（插件架构）

阅读器采用**插件架构**（学习 dsh-web-ui 的 cordis 插件思想：核心最小化 + 扩展点 + 插件注册）。
核心只做：书库/IndexedDB、标签页、双视图渲染（PDF/文字）、事件总线、插件管理器。
**全部功能都是插件**（`frontend/src/plugins/`），可在 ⚙ 设置里启停：

| 插件 | 功能 |
|---|---|
| `footnotes` | 脚注上标：悬浮显示、点击插入浅灰括号脚注（再点收起） |
| `search` | 全文搜索：命中高亮 + 上/下跳转 |
| `bookmarks` | 书签：🔖 当前页加书签，目录面板「书签」tab 查看跳转 |
| `eyecare` | 阅读环境：护眼/深色/亮度/色温/字号/行距/阅读宽度 |
| `progress` | 阅读进度记忆：自动记录、重开恢复 |

核心功能：双视图（左 PDF / 右文字）+ 中间双向跳转 + 同步滚动开关；视图可切换
双栏 / 仅PDF（可双页摊开）/ 仅文字；书库（文件夹分类、批量移动/删除、双击编辑书名）；
标签页多开；左侧边栏上层书库、下层目录（可跳转）/插件 tab；选中文字上下文操作条。

新增插件 = 在 `frontend/src/plugins/` 建文件夹，写 `index.js` 调 `registerExtension(...)`，
在 `src/plugins/index.js` 加一行 import——核心零改动。

## 项目结构

```
scan2ebook/
├── scan2ebook/           # Python：转换 + 阅读器服务
│   ├── cli.py            # 转换（产出 .s2e / json）
│   ├── reader.py         # 本地阅读器服务（python -m scan2ebook serve）
│   ├── vision.py         # ds-vision 逐页结构化
│   ├── toc.py            # 目录装配：TOC 条目 ↔ 正文标题匹配
│   ├── web_reader.py     # 单文件预览 HTML 生成（轻量预览用）
│   ├── llm.py / ocr_engine.py / pdf_utils.py / config.py / page_model.py
├── frontend/             # 独立前端（Vite，阅读器本体）
│   ├── index.html
│   ├── src/
│   │   ├── main.js       # 入口：pdf.js worker + 插件注册 + 启动
│   │   ├── style.css     # 学术纸质暖色主题
│   │   ├── core/         # 核心：app.js(壳) / views.js(双视图) / db.js / extensions.js(插件系统)
│   │   └── plugins/      # 插件：footnotes / search / bookmarks / eyecare / progress
│   ├── test/reader-smoke.mjs  # jsdom 冒烟测试（npm test）
│   └── package.json      # npm run dev / build
└── scripts/make_sample_book.py  # 生成合成扫描书用于测试
```

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

## 已知限制与路线图

- [x] Skill 注册：`~/.dsh/skills/scan2ebook/SKILL.md`
- [ ] 二期：文字高亮（多色）/ 添加注释 + 右侧注释侧边栏
- [ ] 二期：编辑模式（修正识别错误，写回 JSON）
- [ ] 二期：复制引文（GB/T 7714 模板）、标注导出
- [ ] 竖排古籍 / 双栏版面（ds-vision 可处理，需验证）
- [ ] Web GUI 插件（暂缓）：`~/.dsh/plugins/dsh-client-ui-scan2ebook/`，
      用 `dsh-better-sidebar` 的 `registerTab` 挂侧边栏「📖 电子书转换」
