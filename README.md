# Scan2Ebook

把扫描版 PDF 书籍转换成更适合阅读、检索和核对引文的电子书。

Scan2Ebook 会保留原始 PDF，并生成可搜索的文字版本。阅读时可以在原 PDF 和识别文字之间双向跳转，查看原始页码，适合阅读史料、旧书、扫描教材和论文参考文献。

当前版本：**0.1.0** · [MIT License](https://github.com/Goatherd0626/scan2ebook/blob/main/LICENSE)

## 你可以用它做什么

- 把扫描版 PDF 转换为 `.s2e` 电子书；
- 同时查看原 PDF 和识别后的文字；
- 从文字跳回对应的 PDF 页，方便核对引文；
- 搜索全文、添加书签、高亮和注释；
- 调整字号、行距、正文宽度，使用护眼或深色模式；
- 在本地书库中按文件夹整理电子书；
- 只转换 PDF 中指定的页码范围。

## 最简单的安装方式：让 AI 帮你安装

你不需要先学会 Python、npm 或终端命令。把本页面链接和下面这段话发给一个能够操作你电脑终端的 AI 助手，例如 DSH、Codex 或 Claude Code：

```text
请帮我在这台 Mac 上安装 Scan2Ebook：
https://github.com/Goatherd0626/scan2ebook

目标是让我可以在 DeepSeek Harness 的 sidebar 中选择扫描版 PDF、转换电子书并启动网页阅读器。

请按以下要求操作：
1. 先只读检查 macOS、Python、Node.js、Homebrew、pipx 和 DSH 是否可用，不要直接改动系统。
2. 告诉我缺少什么；需要安装软件、联网下载或修改 PATH 时，先征求我的确认。
3. 使用 pipx 从 GitHub 安装 scan2ebook Python 转换器。
4. 按顺序为 DSH web profile 安装 dsh-better-sidebar 和 dsh-client-ui-scan2ebook。
5. 安装仓库中的 dsh-skill/scan2ebook/SKILL.md，让 DSH 能在识别到扫描书转换请求时唤起面板。
6. 用 scan2ebook --help 验证转换器，并确认两个 DSH 插件的安装命令成功完成。
7. 告诉我需要如何重启 DSH，以及之后从哪里打开 Scan2Ebook。

安全要求：
- 不要向我索要、读取或保存 DeepSeek API Key；我会在 Scan2Ebook sidebar 中自己输入。
- 不要创建 .env，不要使用钥匙串保存 Key。
- 不要启动真实转换，不要调用任何付费模型 API。
- 不要修改或删除 ~/Library/Application Support/Scan2Ebook Reader/ 中已有的数据。
- 完成后列出你安装或修改了什么，以及验证结果。
```

安装完成后，完全退出并重新启动 DSH。Scan2Ebook 入口会显示在任务看板、SSH、技能中心等入口的下方。

## 怎样转换一本书

1. 在 DSH 侧边栏中打开 **Scan2Ebook**。
2. 点击“选择 PDF”，从 Mac 中选择要转换的文件。
3. 输入起始页和结束页。两端页码都会包含在转换范围内。
4. 保留默认模型，或者填写你的账户能够使用的多模态模型。
5. 在 sidebar 中输入你自己的 DeepSeek API Key。
6. 查看预计费用，然后点击“开始转换”。
7. 等待进度条完成。结果会保存在原 PDF 所在的文件夹中。

API Key 只在当前 sidebar 中临时使用。关闭 sidebar 或退出 DSH 后会自动清除，不会写入 `.env`、钥匙串、浏览器存储或项目文件。

转换过程中，选定页面的图像和识别文字会发送给你选择的多模态模型服务。请不要处理无权使用或不能上传到第三方服务的材料。

## 怎样打开网页阅读器

在 Scan2Ebook sidebar 的“网页阅读器”区域：

- 点击“启动阅读器”；
- 点击“打开阅读器”或阅读器地址，在系统默认浏览器的新页面中打开；
- 双击端口数字可以修改端口；
- 点击“终止阅读器”可以关闭由插件启动的阅读器。

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

让 AI 检查 `dsh-better-sidebar` 和 `dsh-client-ui-scan2ebook` 是否都安装在 DSH 的 `web` profile 中，然后完全退出并重新启动 DSH。

### DSH 提示找不到 `scan2ebook`

让 AI 检查 `scan2ebook --help` 是否能运行，以及 pipx 的可执行文件目录是否已经加入 DSH 能看到的 PATH。

### Reader 没有自动打开浏览器

在浏览器中访问：

```text
http://127.0.0.1:8765
```

### 默认模型无法使用

默认模型是 `deepseek-v4-flash-vision-exp`。实验模型的可用性可能随账户和服务端调整而变化，可以在 sidebar 中改成你账户实际可用的多模态模型。

### 费用是否准确

sidebar 中显示的是估算值。模型价格、重试次数和实际计费方式可能变化，请以模型服务商的最终账单为准。

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

Better Sidebar 是必需依赖，请按顺序安装：

```bash
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile web add dsh-client-ui-scan2ebook
```

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

- [网页阅读器说明](https://github.com/Goatherd0626/scan2ebook/tree/main/reader)
- [DSH 插件说明](https://github.com/Goatherd0626/scan2ebook/tree/main/dsh-plugin/dsh-client-ui-scan2ebook)
- [阅读器插件开发文档](https://github.com/Goatherd0626/scan2ebook/blob/main/docs/reader-plugin-dev.md)
- [发布与维护检查清单](https://github.com/Goatherd0626/scan2ebook/blob/main/docs/release-checklist.md)

问题与建议可以提交到 [GitHub Issues](https://github.com/Goatherd0626/scan2ebook/issues)。
