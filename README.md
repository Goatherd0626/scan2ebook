# Scan2Ebook

把扫描版 PDF 书籍转换成更适合阅读、检索和核对引文的电子书。

Scan2Ebook 会保留原始 PDF，并生成可搜索的文字版本。阅读时可以在原 PDF 和识别文字之间双向跳转，查看原始页码，适合阅读史料、旧书、扫描教材和论文参考文献。

当前版本：**0.1.0** · [MIT License](https://github.com/Goatherd0626/scan2ebook/blob/main/LICENSE)

## 组件与安装来源

| 组件 | 作用 | 从哪装 | 版本要求 |
|---|---|---|---|
| 转换器（Python CLI） | OCR + 视觉结构化，产出 JSON / HTML / `.s2e` | GitHub 仓库（pipx） | 0.1.0 |
| 网页阅读器 | 双栏对照原文与文字、标注、书库 | npm `scan2ebook-reader`（插件会自动安装） | ≥ 0.1.0 |
| DSH 插件 | 在 DSH 右侧栏提供转换面板 | npm `dsh-client-ui-scan2ebook`，或仓库路径 | ≥ 0.2.0（DSH Desktop ≥ 0.2.0-rc.2） |
| DSH Skill（可选） | 让 DSH 主动唤起面板 | 仓库 `dsh-skill/scan2ebook/SKILL.md` | — |

只读 `.s2e` 文件的话，只需要上表第二行的网页阅读器。

## 你可以用它做什么

- 把扫描版 PDF 转换为 `.s2e` 电子书；
- 同时查看原 PDF 和识别后的文字；
- 从文字跳回对应的 PDF 页，方便核对引文；
- 搜索全文、添加书签、高亮和注释；
- 调整字号、行距、正文宽度，使用护眼或深色模式；
- 在本地书库中按文件夹整理电子书；
- 只转换 PDF 中指定的页码范围。

## 最简单的安装方式：让 AI 帮你安装

你不需要懂 Python、npm 或终端命令。把下面这段话原样发给一个能操作你电脑终端的 AI 助手（DSH、Codex、Claude Code 都可以），它会自己读完仓库里的安装说明并把一切装好：

```text
请帮我在这台 Mac 上安装 Scan2Ebook：
https://github.com/Goatherd0626/scan2ebook

请先读仓库根目录的 AGENTS.md，然后按它执行安装（也可以直接运行仓库里的
scripts/install-dsh-plugin.sh，它是幂等的一键脚本）。
需要安装软件、修改 PATH 或写入用户目录时，先征求我的确认。

安全要求：
- 不要向我索要、读取或保存 DeepSeek API Key；我会自己在面板里输入。
- 不要创建 .env，不要使用钥匙串保存 Key，不要回显任何密钥。
- 不要启动真实转换，不要调用任何付费模型 API。
- 不要修改或删除 ~/Library/Application Support/Scan2Ebook Reader/ 中已有的数据。

装好后请用中文、非技术语言告诉我：怎么重启 DSH、从右侧栏哪里打开 Scan2Ebook、第一次怎么用。
```

> 给 AI 用的细节都在仓库根目录的 [`AGENTS.md`](./AGENTS.md)：每一步的确切命令、版本校验、npm 版本过旧时的回退方案，以及常见故障处理。
> [`scripts/install-dsh-plugin.sh`](./scripts/install-dsh-plugin.sh) 是同一套流程的可执行版本（幂等，可重复运行，不接触 API Key）。

安装完成后，完全退出并重新启动 DSH。Scan2Ebook 显示在会话的**右侧栏**：打开右栏后，在引导页（添加菜单）里选择 Scan2Ebook，也可以直接让 DSH 用 `scan2ebook_open` 唤起面板。插件不会在左侧栏新增按钮。

## 怎样转换一本书

1. 打开 DSH 右侧栏，在引导页里选择 **Scan2Ebook**（或让 DSH 帮你唤起面板）。
2. 点击“选择 PDF”，从 Mac 中选择要转换的文件。
3. 输入起始页和结束页。两端页码都会包含在转换范围内。
4. 保留默认模型（`deepseek-flash`），或者填写你的账户能够使用的多模态模型。
5. 在面板中输入你自己的 DeepSeek API Key。
6. 查看预计费用，然后点击“开始转换”。
7. 等待进度条完成。结果会保存在原 PDF 所在的文件夹中。

API Key 只在当前面板中临时使用。关闭右栏面板或退出 DSH 后会自动清除，不会写入 `.env`、钥匙串、浏览器存储或项目文件。

转换过程中，选定页面的图像和识别文字会发送给你选择的多模态模型服务。请不要处理无权使用或不能上传到第三方服务的材料。

## 怎样打开网页阅读器

在 Scan2Ebook sidebar 的“网页阅读器”区域：

- 点一下「启动阅读器」开始，按钮会就地变成「停止阅读器」（同一个按钮切换启停）；
- 启动后下方出现一条可点击的地址行，点它在系统默认浏览器中打开阅读器；
- 端口可以在未运行时双击数字修改；运行中端口会锁定，避免状态与实际不一致；
- 运行状态行会显示实际运行的 reader 版本（例如 `阅读器正在运行（reader v0.1.0）`）。

不同端口默认使用同一个书库，修改端口不会产生一套新的电子书数据。

## 只想阅读 `.s2e` 文件

只阅读别人提供的 `.s2e` 文件，不需要 Python、DSH 或 DeepSeek API Key。可以把下面这段话发给有终端能力的 AI：

```text
请帮我安装并启动 Scan2Ebook Reader。

要求：
1. 先检查 Node.js 是否满足 20.19 或更高版本；需要安装或升级时先征求我的确认。
2. 从 npm 安装 scan2ebook-reader。
3. 运行 scan2ebook-reader --help 验证安装。
4. 启动阅读器，并告诉我浏览器访问地址。
5. 不要修改或删除我已有的 Scan2Ebook Reader 书库数据。
```

阅读器打开后，将 `.s2e` 文件拖入窗口或点击导入，即可加入书库。

## 转换后会得到什么

- `书名.s2e`：导入 Scan2Ebook Reader 的电子书文件；
- `书名.json`：结构化文字数据；
- `书名.html`：可以直接打开的轻量预览文件。

在 DSH 中转换时，这些文件会放在原 PDF 的同级文件夹中。建议保留 `.s2e` 文件作为备份。

## 阅读器数据存在哪里

macOS 上，书库默认保存在：

```text
~/Library/Application Support/Scan2Ebook Reader/
```

这里保存导入的书、阅读进度、文件夹、书签、高亮、注释和阅读设置。它不以端口区分书库。

建议保留原始 PDF 和 `.s2e` 文件，并定期备份整个 `Scan2Ebook Reader` 文件夹。备份或恢复数据前，请先关闭正在运行的阅读器。

## 常见问题

### 安装后看不到 Scan2Ebook 入口

Scan2Ebook 显示在 DSH 的**右侧栏**，不会在左侧栏新增按钮。让 AI 检查 `dsh-client-ui-scan2ebook` 是否安装在 DSH 的 `desktop` profile 中，然后完全退出并重新启动 DSH；打开右侧栏后，在引导页（添加菜单）里选择 Scan2Ebook。

### DSH 提示找不到 `scan2ebook`

让 AI 检查 `scan2ebook --help` 是否能运行，以及 pipx 的可执行文件目录是否已经加入 DSH 能看到的 PATH。

### Reader 没有自动打开浏览器

在浏览器中访问：

```text
http://127.0.0.1:8765
```

### 默认模型无法使用

默认模型是 `deepseek-flash`（`deepseek-v4-flash-vision-exp` 是其别名，API 会把两者路由到同一个模型）。模型可用性可能随账户和服务端调整而变化，可以在面板中改成你账户实际可用的多模态模型。

### 费用是否准确

面板中显示的是估算值。模型价格、重试次数和实际计费方式可能变化，请以模型服务商的最终账单为准。

<details>
<summary><strong>如果你想自己手动安装</strong></summary>

### 安装 Python 转换器

```bash
brew install pipx
pipx ensurepath
pipx install git+https://github.com/Goatherd0626/scan2ebook.git
scan2ebook --help
```

### 安装 DSH 插件

Scan2Ebook 使用 DSH Desktop 自带的右侧栏，不需要第三方侧栏插件（要求 DSH Desktop `0.2.0-rc.2` 或更高）：

```bash
dsh plugin --profile desktop add "dsh-client-ui-scan2ebook@^0.2.0"
```

如果 npm 上还没有对应的插件版本，或者你想用仓库里的开发版：

```bash
git clone https://github.com/Goatherd0626/scan2ebook.git
dsh plugin --profile desktop add "file:$PWD/scan2ebook/dsh-plugin/dsh-client-ui-scan2ebook"
```

两种方式安装后都需要完全退出并重启 DSH 才会生效。

### 安装 DSH Skill（可选）

```bash
mkdir -p ~/.dsh/skills/scan2ebook
curl --fail --location \
  https://raw.githubusercontent.com/Goatherd0626/scan2ebook/main/dsh-skill/scan2ebook/SKILL.md \
  --output ~/.dsh/skills/scan2ebook/SKILL.md
```

### 只安装网页阅读器

```bash
npm install --global scan2ebook-reader
scan2ebook-reader
```

### 不使用 DSH，直接转换

```bash
scan2ebook "/路径/书籍.pdf" -o "/路径/输出文件夹"
```

只转换部分页码：

```bash
scan2ebook "/路径/书籍.pdf" -o "/路径/输出文件夹" \
  --page-start 10 \
  --page-end 35
```

命令会在终端中隐藏输入 API Key。Key 只用于这一次转换，不会保存。

</details>

## 当前限制

- 扫描识别和 DSH 插件当前主要支持 macOS；
- 网页阅读器可以在 macOS、Windows 和 Linux 的现代桌面浏览器中使用；
- 默认多模态模型不保证对所有账户长期可用；
- 识别结果仍可能出错，正式引用前请回到对应 PDF 页核对；
- 当前没有面向普通用户的一键图形安装器。

## 更多资料

- [给 AI 助手的安装说明（AGENTS.md）](https://github.com/Goatherd0626/scan2ebook/blob/main/AGENTS.md)
- [一键安装脚本](https://github.com/Goatherd0626/scan2ebook/blob/main/scripts/install-dsh-plugin.sh)
- [网页阅读器说明](https://github.com/Goatherd0626/scan2ebook/tree/main/reader)
- [DSH 插件说明](https://github.com/Goatherd0626/scan2ebook/tree/main/dsh-plugin/dsh-client-ui-scan2ebook)
- [阅读器插件开发文档](https://github.com/Goatherd0626/scan2ebook/blob/main/docs/reader-plugin-dev.md)
- [发布与维护检查清单](https://github.com/Goatherd0626/scan2ebook/blob/main/docs/release-checklist.md)

问题与建议可以提交到 [GitHub Issues](https://github.com/Goatherd0626/scan2ebook/issues)。
