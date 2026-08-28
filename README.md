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

## 使用前需要准备

如果需要转换扫描版 PDF，目前需要：

- 一台 Mac；
- Python 3.10 或更高版本；
- Node.js 20.19 或更高版本；
- 你自己的 DeepSeek API Key，并确保账户可以使用多模态模型；
- 如果希望使用图形界面，还需要 DeepSeek Harness。

网页阅读器本身也可以在 Windows 和 Linux 上使用，但扫描识别和 DSH 图形转换功能目前主要支持 macOS。

> 当前 0.1.0 还没有图形化安装器。安装时需要在“终端”中复制几条命令；安装完成后的选书、转换和阅读都可以在图形界面中完成。

## 推荐安装：在 DSH 中使用

这是最完整、也最适合日常使用的方式。安装后，可以在 DSH sidebar 中选择 PDF、设置页码、输入临时 API Key、查看进度并启动阅读器。

### 第一步：安装转换器

如果尚未安装 `pipx`：

```bash
brew install pipx
pipx ensurepath
```

完成后重新打开终端，然后安装 Scan2Ebook 转换器：

```bash
pipx install git+https://github.com/Goatherd0626/scan2ebook.git
```

检查是否安装成功：

```bash
scan2ebook --help
```

### 第二步：安装 DSH 插件

```bash
dsh plugin --profile web add dsh-client-ui-scan2ebook
```

插件会自动安装网页阅读器，不需要再单独安装 `scan2ebook-reader`。安装后重启 DSH。

### 可选：让 DSH 自动识别转换需求

不安装 Skill 也可以手动打开 Scan2Ebook sidebar。安装 Skill 后，当你向 DSH 提出“把这本扫描 PDF 转成电子书”之类的请求时，它可以主动唤起转换面板。

```bash
mkdir -p ~/.dsh/skills/scan2ebook
curl --fail --location \
  https://raw.githubusercontent.com/Goatherd0626/scan2ebook/main/dsh-skill/scan2ebook/SKILL.md \
  --output ~/.dsh/skills/scan2ebook/SKILL.md
```

### 第三步：开始转换

1. 在 DSH 侧边栏中打开 **Scan2Ebook**；入口位于任务看板、SSH、技能中心等入口的下方。
2. 点击“选择 PDF”，从 Mac 中选择要转换的文件。
3. 输入起始页和结束页。页码使用 PDF 中显示的实际页数，并且包含起始页和结束页。
4. 保留默认模型，或者填写你的账户能够使用的多模态模型。
5. 输入你自己的 DeepSeek API Key。
6. 查看预计费用，然后点击“开始转换”。
7. 等待进度条完成。转换结果会保存在原 PDF 所在的文件夹中。

API Key 只在当前 sidebar 中临时使用。关闭 sidebar 或退出 DSH 后会自动清除，不会写入 `.env`、钥匙串、浏览器存储或项目文件。

转换过程中，选定页面的图像和识别文字会发送给你选择的多模态模型服务。请不要处理无权使用或不能上传到第三方服务的材料。

## 只安装网页阅读器

如果你已经有 `.s2e` 文件，只想阅读，不需要安装 Python 转换器、DSH 或 DeepSeek API Key。

安装：

```bash
npm install --global scan2ebook-reader
```

启动：

```bash
scan2ebook-reader
```

阅读器会自动在系统默认浏览器中打开。将 `.s2e` 文件拖入窗口或点击导入，即可加入书库。

也可以不安装，直接临时启动：

```bash
npx scan2ebook-reader
```

## 在 DSH 中启动阅读器

打开 Scan2Ebook sidebar，在“网页阅读器”区域：

- 点击“启动阅读器”启动服务；
- 点击“打开阅读器”或阅读器地址，在系统默认浏览器的新页面中打开；
- 双击端口数字可以修改端口；
- 点击“终止阅读器”可以关闭由插件启动的阅读器。

不同端口默认使用同一个书库，修改端口不会产生一套新的电子书数据。

## 不使用 DSH，直接转换

安装转换器后，也可以直接在终端运行：

```bash
scan2ebook "/路径/书籍.pdf" -o "/路径/输出文件夹"
```

命令会在终端中隐藏输入 API Key。Key 只用于这一次转换，不会保存。

只转换部分页码：

```bash
scan2ebook "/路径/书籍.pdf" -o "/路径/输出文件夹" \
  --page-start 10 \
  --page-end 35
```

转换完成后直接打开阅读器：

```bash
scan2ebook "/路径/书籍.pdf" -o "/路径/输出文件夹" --serve
```

使用 `--serve` 前，需要先安装网页阅读器：

```bash
npm install --global scan2ebook-reader
```

## 转换后会得到什么

转换结果默认包含：

- `书名.s2e`：导入 Scan2Ebook Reader 的电子书文件；
- `书名.json`：结构化文字数据；
- `书名.html`：可以直接打开的轻量预览文件。

在 DSH 插件中转换时，这些文件会放在原 PDF 的同级文件夹中。建议保留 `.s2e` 文件作为备份。

## 阅读器中的数据存在哪里

macOS 上，书库默认保存在：

```text
~/Library/Application Support/Scan2Ebook Reader/
```

这里保存导入的书、阅读进度、文件夹、书签、高亮、注释和阅读设置。它不以端口区分书库。

建议：

- 保留原始 PDF 和转换得到的 `.s2e` 文件；
- 定期备份整个 `Scan2Ebook Reader` 文件夹；
- 备份或恢复数据前，先关闭正在运行的阅读器。

## 常见问题

### DSH 提示找不到 `scan2ebook`

先在终端运行：

```bash
scan2ebook --help
```

如果找不到命令，请重新执行：

```bash
pipx ensurepath
```

然后关闭并重新打开终端和 DSH。

### Reader 启动后没有自动打开浏览器

在浏览器中访问：

```text
http://127.0.0.1:8765
```

### 默认模型无法使用

默认模型是 `deepseek-v4-flash-vision-exp`。实验模型的可用性可能随账户和服务端调整而变化，可以在 sidebar 中改成你账户实际可用的多模态模型。

### 费用是否准确

sidebar 中显示的是估算值。模型价格、重试次数和实际计费方式可能变化，请以模型服务商的最终账单为准。

## 当前限制

- 扫描识别和 DSH 插件当前主要支持 macOS；
- 默认多模态模型不保证对所有账户长期可用；
- 识别结果仍可能出错，正式引用前请回到对应 PDF 页核对；
- 当前没有面向普通用户的一键安装器。

## 更多资料

- [网页阅读器说明](https://github.com/Goatherd0626/scan2ebook/tree/main/reader)
- [DSH 插件说明](https://github.com/Goatherd0626/scan2ebook/tree/main/dsh-plugin/dsh-client-ui-scan2ebook)
- [阅读器插件开发文档](https://github.com/Goatherd0626/scan2ebook/blob/main/docs/reader-plugin-dev.md)
- [发布与维护检查清单](https://github.com/Goatherd0626/scan2ebook/blob/main/docs/release-checklist.md)

问题与建议可以提交到 [GitHub Issues](https://github.com/Goatherd0626/scan2ebook/issues)。
