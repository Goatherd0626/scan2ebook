# Scan2Ebook for DeepSeek Harness

在 DeepSeek Harness 中使用 Scan2Ebook 的图形界面插件。它把 PDF 选择、页码范围、API Key、转换进度、费用估算和网页阅读器放在 **DSH 原生右侧栏**的一个 tab 中（不依赖任何第三方侧栏插件）。

## 推荐：让 AI 帮你安装

把本页面链接发给一个能够操作本机终端的 AI，让它完成安装。可以直接使用下面这段请求：

```text
请帮我安装 Scan2Ebook 的 DSH 插件。

请先检查环境，缺少软件或需要修改系统时先征求我的确认。使用 pipx 从
https://github.com/Goatherd0626/scan2ebook 安装 scan2ebook 转换器，然后为 DSH desktop profile
安装 dsh-client-ui-scan2ebook。最后用 scan2ebook --help 验证安装，并告诉我如何重启 DSH。

不要向我索要或保存 DeepSeek API Key，不要创建 .env，不要运行真实转换或调用付费 API，也不要修改已有的 Scan2Ebook Reader 书库数据。
```

## 使用前需要准备

- macOS；
- DeepSeek Harness Desktop `0.2.0-rc.2` 或更高版本（官方右栏 API 随该版本发布）；
- Node.js 20.19 或更高版本；
- 已安装的 `scan2ebook` Python 转换器；
- 你自己的 DeepSeek API Key。

安装转换器的推荐方式：

```bash
brew install pipx
pipx ensurepath
pipx install git+https://github.com/Goatherd0626/scan2ebook.git
```

## 安装插件

Scan2Ebook 直接使用 DSH Desktop 自带的右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`），**不需要** `dsh-better-sidebar` 之类的第三方侧栏插件：

```bash
dsh plugin --profile desktop add dsh-client-ui-scan2ebook
```

安装完成后重启 DSH。Scan2Ebook 插件会自动安装 `scan2ebook-reader`，不需要单独安装网页阅读器。

如果还希望 DSH 在识别到扫描书转换请求时主动打开面板，可以另外安装仓库中的 [Scan2Ebook Skill](https://github.com/Goatherd0626/scan2ebook/tree/main/dsh-skill/scan2ebook)。手动使用右栏面板不要求安装 Skill。

## 使用方法

1. 打开 DSH 右侧栏（会话窗口右上角的右栏按钮），在引导页或添加菜单里选择 **Scan2Ebook**。
2. 点击“选择 PDF”。
3. 输入要转换的起始页和结束页；两端页码都会包含在内。
4. 选择多模态模型。
5. 输入你自己的 API Key。
6. 查看预计费用，点击“开始转换”。
7. 通过进度条查看转换状态。
8. 转换完成后，在同一个面板中启动网页阅读器。

转换结果会保存在所选 PDF 的同级文件夹中。

## API Key

API Key 只在当前右栏面板中临时使用：

- 不会读取 DSH 当前使用的 Provider Key；
- 不会写入 `.env`；
- 不会写入钥匙串或浏览器存储；
- 不会写入日志；
- 关闭右栏面板或 DSH 后会自动清除。

## 网页阅读器

在右栏面板的“网页阅读器”区域可以：

- 启动阅读器；
- 双击修改端口；
- 在系统默认浏览器的新页面中打开阅读器；
- 终止由插件启动的阅读器。

不同端口默认访问同一个书库。

## 找不到转换器

先在终端确认：

```bash
scan2ebook --help
```

如果命令不存在，请运行：

```bash
pipx ensurepath
```

然后重新打开终端和 DSH。

## 看不到 Scan2Ebook 入口

重新执行安装命令：

```bash
dsh plugin --profile desktop add dsh-client-ui-scan2ebook
```

然后完全退出并重新启动 DSH。入口在**右侧栏**：打开右栏后，在引导页（添加菜单）里选择 Scan2Ebook；插件不会在左侧栏新增按钮。

项目主页：[github.com/Goatherd0626/scan2ebook](https://github.com/Goatherd0626/scan2ebook)

## License

MIT
