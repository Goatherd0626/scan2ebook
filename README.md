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
# 下载或 clone 本仓库后进入项目目录
cd scan2ebook

python3 -m venv .venv
.venv/bin/pip install -e .
```

editable 安装后会提供 `.venv/bin/scan2ebook` 命令。也可以先激活虚拟环境，
再直接使用 `scan2ebook`。开始转换时，CLI 会在终端中隐藏输入 API Key；Key
只供本次进程使用，不写入 `.env`、钥匙串、配置文件或日志。使用 DSH 插件时，
则直接在 sidebar 中输入，关闭 sidebar 或 DSH 后自动清除。

Python 发布包的本地构建与审计：

```bash
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m build --outdir dist
.venv/bin/python scripts/verify_python_package.py dist
.venv/bin/python -m twine check dist/*
```

`scripts/verify_python_package.py` 会检查版本、MIT 许可证、CLI 入口与依赖元数据，
并拒绝包含 `reader/`、DSH 组件、`.env`、PDF 或 `.s2e` 的产物。
正式发布前还应在全新虚拟环境中安装 wheel，运行 `scan2ebook --help`、
`scan2ebook inspect <PDF>` 和 reader 缺失/存在两条路径的冒烟测试。

### 2. 独立网页阅读器

```bash
cd reader
npm ci
npm run build
npm link
```

这会在本机注册 `scan2ebook-reader` 命令。回到仓库根目录后，可以直接启动：

```bash
scan2ebook-reader --port 8765
```

Python 转换器也保留了兼容入口；它只负责调用 PATH 中的独立 reader，
不会从 Python wheel 或本仓库读取前端文件：

```bash
cd ..
.venv/bin/scan2ebook serve
```

`reader/dist/` 不提交到 Git，因此 GitHub 自动生成的 Source code zip/tar.gz
不包含它。`npm pack` 和 `npm publish` 会在打包前自动构建，
并将 `dist/` 放入 reader npm 发布包。

如果只需要阅读器、不安装 Python 转换器，可以直接从 `reader/` 启动
带统一数据存储的 reader 服务：

```bash
cd reader
npm ci
npm run build
npm start -- --host 127.0.0.1 --port 8765
```

### 3. DSH Skill（可选）

```bash
mkdir -p ~/.dsh/skills/scan2ebook
cp dsh-skill/scan2ebook/SKILL.md ~/.dsh/skills/scan2ebook/SKILL.md
```

Skill 单独安装时，请确保 `scan2ebook` 命令在 DSH 运行环境的 `PATH` 中。
如果 DSH 从终端启动，可先激活本仓库的 `.venv`。

### 4. DSH sidebar 插件（可选）

插件现在依赖独立的 `scan2ebook-reader@^0.1.0`，并调用 `PATH` 中的
`scan2ebook` 转换器，不再依赖本仓库根目录、固定 `.venv` 或 `reader/dist/`。
正式 npm 发布后的安装接口为：

```bash
dsh plugin --profile web add dsh-client-ui-scan2ebook
```

当前尚未发布到 npm registry。源码 link 联调和转换器路径配置见
[`dsh-plugin/dsh-client-ui-scan2ebook/README.md`](dsh-plugin/dsh-client-ui-scan2ebook/README.md)。
如果 DSH 运行环境找不到 `scan2ebook`，可在插件配置中将
`scan2ebookCommand` 指向独立 Python 环境里的可执行文件。

Python wheel 只包含转换器，不包含 `reader/`、DSH Skill 或 DSH 插件。
若要使用 `scan2ebook serve` 或转换命令的 `--serve`，还需单独安装
`scan2ebook-reader`。当前 0.1.0 尚未发布到 PyPI 或 npm registry，
本 README 中的 registry 安装命令表示正式发布后的用户接口。

## reader npm 包

`reader/` 现在是可独立打包的 `scan2ebook-reader` npm 包，提供：

- 预构建的 `dist/` 阅读器；
- `scan2ebook-reader` CLI；
- 可供 DSH 插件等 Node.js 程序调用的 `startReader()` API；
- 零第三方运行时依赖的本地 HTTP 服务；
- health 身份检查、端口复用/冲突识别、路径穿越防护和跨平台打开浏览器。

当前代码已经可以生成并本地安装 `.tgz`，但 **尚未发布到 npm registry**。
在正式 `npm publish` 之前，下面的 `npx`/全局安装命令只表示发布后的用户接口：

```bash
# 无需全局安装
npx scan2ebook-reader --port 8765

# 或全局安装后启动
npm install --global scan2ebook-reader
scan2ebook-reader --port 8765
```

npm 包安装后，阅读器程序文件会位于 npm 的 `node_modules` 或全局 npm 前缀中；
用户导入的电子书不存放在 npm 包目录，而是使用独立应用数据目录。

本地打包与安装验证：

```bash
cd reader
npm ci
npm test
npm run build
npm run test:package
npm pack
npm install --global ./scan2ebook-reader-0.1.0.tgz
```

DSH 插件已经直接依赖并调用这个 reader npm 包。正式发布顺序必须是：
先发布 `scan2ebook-reader@0.1.0`，再发布 `dsh-client-ui-scan2ebook@0.1.0`。

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
#   --serve         转换完成后启动已独立安装的阅读器
#   --split-pages   额外输出 pages/page_NNN.json（抽查单页用）
#   --page-start N  起始 PDF 页码（1-based，两端闭区间）
#   --page-end N    结束 PDF 页码（1-based，两端闭区间）
#   --vision-model  覆盖多模态结构化模型
#   --progress-json 输出供 GUI 消费的 S2E_EVENT 进度行
```

### 阅读器启动方式

| 方式 | 适合 |
|---|---|
| `scan2ebook-reader` | 独立 reader CLI，不需要 Python 转换器 |
| `python -m scan2ebook serve` | Python 兼容入口，转发参数给已安装的 `scan2ebook-reader` |
| `python -m scan2ebook 书.pdf --serve` | 转换完后在后台启动已安装的 reader |

阅读器打开后把 `.s2e` 拖进窗口即可导入书库。
`scan2ebook serve --no-browser` 会转换为 reader 的 `--no-open`。如果可执行文件
不在 PATH，可以设置 `SCAN2EBOOK_READER_COMMAND=/absolute/path/to/scan2ebook-reader`，
或给 `scan2ebook serve` 传入 `--reader-command`。转换后找不到 reader 时，
转换产物仍然保留，命令只会记录可操作的安装提示。

### 阅读器程序和电子书存在哪里

- **程序文件**：当前没有系统级安装器。用户 clone 仓库或下载 GitHub Release
  压缩包后，阅读器就位于用户自己选择的仓库/解压目录 `reader/`，
  构建产物位于 `reader/dist/`。npm 安装时则位于对应
  `node_modules/scan2ebook-reader/` 或 npm 全局安装目录。
- **导入的电子书**：不再以浏览器 IndexedDB 为主库。PDF、`book.json`、
  元数据、文件夹、阅读进度、书签、标注和界面偏好统一存在 reader 数据目录。
- **macOS 物理路径**：`~/Library/Application Support/Scan2Ebook Reader/`。
  `library.json` 保存书库索引和偏好；每本书在 `books/<book-id>/` 中独立保存
  `book.pdf`、`record.json` 和 `annotations.json`。
- **端口无关**：`127.0.0.1:8765`、`127.0.0.1:9000` 和 `localhost:8765`
  默认访问同一数据源，不再出现换端口就换书库的情况。
- **旧数据迁移**：首次访问新版时，当前 origin 下的旧 IndexedDB 会自动复制到
  统一目录，但不会自动删除旧库。若过去用过多个端口，分别打开一次即可合并。
- **删除风险**：把 `.s2e` 导入后，技术上可以删除原文件，因为阅读器已保存一份
  PDF 和 JSON。但删除或损坏 `Scan2Ebook Reader` 数据目录仍会丢失书库。
  因此建议保留原 `.s2e` 作为备份，并在关闭 reader 后定期复制整个数据目录；
  带标注的书可使用阅读器的导出功能另存。

## 阅读器功能（插件架构）

阅读器采用**插件架构**（学习 dsh-web-ui 的 cordis 插件思想：核心最小化 + 扩展点 + 插件注册）。
核心只做：书库持久化、标签页、双视图渲染（PDF/文字）、事件总线、插件管理器。
**全部功能都是插件**（`reader/src/plugins/`），可在 ⚙ 设置里启停：

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

新增插件 = 在 `reader/src/plugins/` 建文件夹，写 `index.js` 调 `registerExtension(...)`，
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
├── scan2ebook/           # Python：转换器 + 独立 reader 兼容启动器
│   ├── cli.py            # 转换（产出 .s2e / json）
│   ├── reader.py         # 调用外部 scan2ebook-reader CLI 的兼容层
│   ├── vision.py         # ds-vision 逐页结构化
│   ├── toc.py            # 目录装配：TOC 条目 ↔ 正文标题匹配
│   ├── web_reader.py     # 单文件预览 HTML 生成（轻量预览用）
│   ├── llm.py / ocr_engine.py / pdf_utils.py / config.py / page_model.py
├── reader/               # 独立前端（Vite，阅读器本体）
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
- [x] 打包独立 `scan2ebook-reader` npm 包（包含 `dist/`、CLI 和 Node.js API）
- [ ] 查询 npm 包名可用性并正式发布 `scan2ebook-reader@0.1.0`
- [ ] GitHub Release 附加 reader `.tgz`，并视需要增加不要求 Node.js 的桌面封装
- [x] 解除 DSH 插件对 Git 仓库根目录、固定 `.venv` 和 Python reader 入口的依赖
- [x] Python wheel 仅包含转换器，`scan2ebook serve` 改为调用独立 reader CLI
- [x] 本地构建并审计 Python wheel/sdist，通过 `twine check` 与隔离安装测试
- [ ] 确认 PyPI 包名、账号和 2FA，再发布 `scan2ebook==0.1.0`
- [ ] 先发布 reader，再正式发布 `dsh-client-ui-scan2ebook@0.1.0`
- [ ] 二期：文字高亮（多色）/ 添加注释 + 右侧注释侧边栏
- [ ] 二期：编辑模式（修正识别错误，写回 JSON）
- [ ] 二期：复制引文（GB/T 7714 模板）、标注导出
- [ ] 竖排古籍 / 双栏版面（ds-vision 可处理，需验证）
