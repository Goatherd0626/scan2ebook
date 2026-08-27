# scan2ebook —— 扫描版书籍 → 带页码锚定的网页阅读器

把扫描版 PDF 书籍转换成**本地网页阅读器**：Overleaf 式双视图（原 PDF ↔ 转换文字），
书库 + 文件夹分类 + 标签页多开，护眼阅读环境，全文搜索、书签、阅读进度记忆。
**每个段落锚定其来源的 PDF 页码**，可双向跳转，专为论文引文核对设计。

当前版本：**0.1.0**。本项目采用 [MIT License](LICENSE)。

## 平台与环境限制

| 组件 | 当前支持范围 |
|---|---|
| Python 转换器 / Apple Vision OCR | **仅 macOS**；已在 Apple Silicon 上开发和测试，Intel Mac 未持续验证 |
| DSH Skill | DeepSeek Harness 可加载 Skill 的环境 |
| DSH sidebar 插件 | **仅 macOS**；依赖系统文件选择器与 `/usr/bin/open` |
| 独立网页阅读器 | 构建后可在现代桌面浏览器运行；阅读器本身不依赖 Apple Vision |

开发与构建要求：

- Python 3.10 或更高版本；当前主要测试环境为 Python 3.12。
- Node.js 20.19 或更高版本，用于网页阅读器测试和 Vite 构建。
- DSH 插件要求 DeepSeek Harness `>=0.1.1-rc.1`。
- 结构化转换需要用户自己的 DeepSeek API Key 和可用的多模态模型权限。
- 默认模型 `deepseek-v4-flash-vision-exp` 是可配置推荐值，不保证所有账户或未来版本始终可用。

Windows 和 Linux 当前不能运行 Apple Vision OCR 或 DSH 插件的 macOS 原生集成功能。
若 PDF 已有文字层，未来可以增加跨平台路径，但当前发布版本仍按 macOS-only 转换器维护。

## 组件关系与按需安装

本仓库包含四个层次，它们不是必须全部安装的单一程序：

| 组件 | 作用 | 能否单独使用 |
|---|---|---|
| Python 转换器 | OCR、多模态结构化，生成 `.json` / `.html` / `.s2e` | 可以 |
| DSH Skill | 告诉 DSH 何时使用 scan2ebook、如何校验输出 | 可以，但转换时仍需要已安装的 Python 转换器 |
| DSH sidebar 插件 | 在 DSH 中提供选文件、页码、API Key、进度、计费和阅读器启停 UI | 可选，只是 DSH 便利层 |
| 独立网页阅读器 | 导入和阅读已有 `.s2e` 文件 | 可以，不需要 DSH 或转换 API Key |

推荐按需选择：

| 需求 | 安装组合 |
|---|---|
| 只阅读别人提供的 `.s2e` | 仅网页阅读器 |
| 在 DSH 中由 Skill 指导、使用 CLI 转换 | Python 转换器 + Skill + 网页阅读器 |
| 在 DSH sidebar 中完成选文件、转换、进度和阅读器启停 | Python 转换器 + Skill + DSH 插件 + 网页阅读器 |

Skill 不包含 OCR 或阅读器程序；它是工作流说明。DSH 插件也不是转换核心；
它调用同一套 Python 转换器和网页阅读器。因此不使用 DSH 时，转换器和
阅读器仍可以完整工作。

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

## 从源码安装

### 1. Python 转换器

```bash
git clone https://github.com/OWNER/scan2ebook.git
cd scan2ebook

python3 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
```

editable 安装后会提供 `.venv/bin/scan2ebook` 命令。也可以先激活虚拟环境，
再直接使用 `scan2ebook`。

### 2. 独立网页阅读器

```bash
cd frontend
npm ci
npm run build
cd ..
```

构建后的静态网页位于 `frontend/dist/`。使用 Python 转换器启动：

```bash
.venv/bin/scan2ebook serve
```

`frontend/dist/` 不提交到 Git，因此 GitHub 自动生成的 Source code zip/tar.gz
也不包含它。从源码安装的用户必须先执行上述构建命令。如果希望
普通用户下载后直接启动，应在 GitHub Release 中另行附加包含 `dist/`
和启动器的预构建 reader 压缩包，或完成下文的 npm 包。

如果只需要阅读器、不安装 Python 转换器，也可以从 `frontend/` 启动
Vite preview：

```bash
cd frontend
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 8765
```

### 3. DSH Skill（可选）

```bash
mkdir -p ~/.dsh/skills/scan2ebook
cp dsh-skill/scan2ebook/SKILL.md ~/.dsh/skills/scan2ebook/SKILL.md
```

Skill 单独安装时，请确保 `scan2ebook` 命令在 DSH 运行环境的 `PATH` 中。
如果 DSH 从终端启动，可先激活本仓库的 `.venv`。

### 4. DSH sidebar 插件（可选）

```bash
dsh plugin --profile web add link:/absolute/path/to/scan2ebook/dsh-plugin/dsh-client-ui-scan2ebook
```

安装后重启 `dsh web`。当前 `0.1.0` 插件仍是源码联调形态：它会从整个
scan2ebook 仓库定位 `.venv/bin/python` 和阅读器资源，因此不能只复制
`dsh-plugin/` 目录。真正的独立 npm 插件发布需要先解除这个仓库路径依赖。

`pyproject.toml` 当前面向 clone 后的源码 editable 安装。网页阅读器资源仍由仓库中的
`frontend/` 提供，因此首个 0.1.0 版本暂不承诺 PyPI wheel 包含完整阅读器资源。

## npm 安装状态

网页阅读器在技术上可以发布为 npm 包，但当前 **还不能** 执行
`npm install scan2ebook-reader` 后直接使用：

- `frontend/package.json` 当前为 `"private": true`，不允许 npm publish；
- 当前没有把 `dist/` 列为发布文件；
- 当前没有 `scan2ebook-reader` CLI 用于选择端口并启动静态服务；
- DSH 插件目前仍直接依赖仓库根目录的 `.venv` 和 `frontend/`。

后续建议拆成两个 npm 发布物：

1. `scan2ebook-reader`：包含已构建的 `dist/` 和一个跨平台启动 CLI；
2. `dsh-client-ui-scan2ebook`：DSH 集成层，调用已安装的阅读器和 Python
   `scan2ebook` 命令，不再假设用户保留完整 Git 仓库。

建议未来 reader 包的用户接口为（当前尚未实现）：

```bash
# 无需全局安装
npx scan2ebook-reader --port 8765

# 或全局安装后启动
npm install --global scan2ebook-reader
scan2ebook-reader --port 8765
```

npm 包安装后，阅读器程序文件会位于 npm 的 `node_modules` 或全局 npm 前缀中；
用户导入的电子书仍不应存放在 npm 包目录，而应继续使用浏览器 IndexedDB。

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
#   --page-start N  起始 PDF 页码（1-based，两端闭区间）
#   --page-end N    结束 PDF 页码（1-based，两端闭区间）
#   --vision-model  覆盖多模态结构化模型
#   --progress-json 输出供 GUI 消费的 S2E_EVENT 进度行
```

### 阅读器启动方式（三种，任选）

| 方式 | 适合 |
|---|---|
| `python -m scan2ebook serve` | 命令行，自动开浏览器；端口被占用时自动复用已有实例 |
| `python -m scan2ebook 书.pdf --serve` | 转换完直接进阅读器 |
| **双击 `启动阅读器.command`** | Finder 双击即开（零命令行），适合非技术用户 |

阅读器打开后把 `.s2e` 拖进窗口即可导入书库。

### 阅读器程序和电子书存在哪里

- **程序文件**：当前没有系统级安装器。用户 clone 仓库或下载 GitHub Release
  压缩包后，阅读器就位于用户自己选择的仓库/解压目录 `frontend/`，
  构建产物位于 `frontend/dist/`。本地 HTTP 服务只读取这些静态文件。
- **导入的电子书**：存在浏览器 IndexedDB 数据库 `scan2ebook-reader` 中，
  包含 PDF Blob、`book.json`、元数据、文件夹、阅读进度、书签和标注。
- **物理磁盘路径**：由 Chrome / Safari / Edge 等浏览器管理，位于该浏览器的
  profile 数据目录，不是 scan2ebook 可直接管理的普通文件夹。
  开发者可在浏览器 DevTools 的 **Application / Storage → IndexedDB →
  `scan2ebook-reader`** 中查看逻辑数据，不建议直接修改浏览器的底层数据文件。
- **书库隔离规则**：IndexedDB 按 `scheme + host + port` 隔离。
  `127.0.0.1:8765`、`127.0.0.1:9000` 和 `localhost:8765` 是三个不同的书库。
  为了一直看到同一个书库，建议固定使用默认地址
  `http://127.0.0.1:8765`。
- **删除风险**：把 `.s2e` 导入后，技术上可以删除原文件，因为阅读器已保存一份
  PDF 和 JSON。但清理浏览器站点数据、删除浏览器 profile 或更换端口都可能让书库
  不再可见；浏览器配额和存储压力策略也会影响可容纳的 PDF 总量。
  因此建议保留原 `.s2e` 作为备份；带标注的书可使用阅读器的导出功能另存。

## 阅读器功能（插件架构）

阅读器采用**插件架构**（学习 dsh-web-ui 的 cordis 插件思想：核心最小化 + 扩展点 + 插件注册）。
核心只做：书库/IndexedDB、标签页、双视图渲染（PDF/文字）、事件总线、插件管理器。
**全部功能都是插件**（`frontend/src/plugins/`），可在 ⚙ 设置里启停：

| 插件 | 功能 |
|---|---|
| `footnotes` | 脚注上标：悬浮显示、点击插入浅灰括号脚注（再点收起） |
| `search` | 全文搜索：命中高亮 + 上/下跳转 |
| `bookmarks` | 书签：🔖 当前页加书签，目录面板「书签」tab 查看跳转 |
| `eyecare` | 阅读环境：标准/护眼/深色外观、护眼色温、字号、行距、正文宽度与实时预览 |
| `progress` | 阅读进度记忆：自动记录、重开恢复 |

核心功能：**🏠 首页标签页**（Zotero 式书库管理：书名/作者/出版社/页数 表格、行内操作
打开/编辑/移动/删除、批量管理、元数据编辑模态、导入区）；双视图（左 PDF / 右文字）
+ 中间双向跳转 + 同步滚动开关；视图可切换双栏 / 仅PDF（可双页摊开）/ 仅文字；
书库（文件夹分类、批量移动/删除、双击编辑书名）；标签页多开；左侧边栏上层书库、
下层目录（可跳转）/插件 tab；选中文字上下文操作条。

新增插件 = 在 `frontend/src/plugins/` 建文件夹，写 `index.js` 调 `registerExtension(...)`，
在 `src/plugins/index.js` 加一行 import——核心零改动。

## 项目结构

```
scan2ebook/
├── docs/
│   ├── reader-plugin-dev.md    # 阅读器插件开发指南（API/事件/扩展点/示例）
│   ├── webgui-plugin-design.md # DSH Web GUI 插件设计与落地说明
│   └── release-checklist.md    # GitHub 开源发布检查清单
├── dsh-plugin/
│   └── dsh-client-ui-scan2ebook/ # DSH 左侧入口、转换面板、RPC 与阅读器进程管理
├── dsh-skill/
│   └── scan2ebook/SKILL.md     # 可随仓库发布和安装的 DSH Skill
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
      {"type": "figure"},
      {"type": "table"},
      {"type": "footnote","index": 1, "text": "参见吴承明……第12页。"}
    ]},
    {"pdf_page": 13, "page_kind": "toc", "items": [], "toc": [{"number":"1","text":"前言","level":1,"printed_page":3}]}
  ]}
```

约定：
- 键全英文；`items` 为有序数组，数量与顺序由识别内容决定
- **脚注恒在 items 最后**；**一个自然段 = 一个 body**
- 正文中脚注引用位置保留为 `[序号]`；标题带 `number`（印刷编号）与 `level`（1/2/3）
- `figure` / `table` 为仅含 `type` 的标记项，保留原阅读位置，不描述图片或转录表格内容
- 模型输出的 `header` 项表示页眉，程序规范化时丢弃；页脚和页码直接忽略
- 每页有 `page_kind`：cover/title/copyright/toc/body/blank/other
- 目录页（page_kind=toc）输出 `toc` 数组（含目录标注的 printed_page）
- **书级 `toc`**：目录条目与正文标题文本模糊匹配，`pdf_page` 为跳转目标；
  扫描件中缺失的内容条目 `pdf_page` 为 null（阅读器灰显）

## 已知限制与路线图

- [x] Skill 注册：`~/.dsh/skills/scan2ebook/SKILL.md`
- [x] DSH Web GUI 插件：单个「Scan2Ebook」入口和右侧 sidebar，支持任意 PDF、同级输出、页码范围、进度/计费与阅读器启停
- [ ] 发布独立 `scan2ebook-reader` npm 包（包含 `dist/` 和启动 CLI）
- [ ] GitHub Release 附加预构建 reader 压缩包，避免阅读器用户必须安装 Node.js
- [ ] 解除 DSH 插件对 Git 仓库根目录和 `.venv` 固定路径的依赖，再发布 npm 包
- [ ] 二期：文字高亮（多色）/ 添加注释 + 右侧注释侧边栏
- [ ] 二期：编辑模式（修正识别错误，写回 JSON）
- [ ] 二期：复制引文（GB/T 7714 模板）、标注导出
- [ ] 竖排古籍 / 双栏版面（ds-vision 可处理，需验证）
