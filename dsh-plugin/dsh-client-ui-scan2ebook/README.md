# Scan2Ebook for DeepSeek Harness

在 DeepSeek Harness 中使用 Scan2Ebook 的图形界面插件。它把 PDF 选择、页码范围、API Key、转换进度、费用估算和网页阅读器放在同一个 sidebar 中。

## 使用前需要准备

- macOS；
- DeepSeek Harness `0.1.1-rc.1` 或更高版本；
- Node.js 20.19 或更高版本；
- DSH 插件 `dsh-better-sidebar`；
- 已安装的 `scan2ebook` Python 转换器；
- 你自己的 DeepSeek API Key。

安装转换器的推荐方式：

```bash
brew install pipx
pipx ensurepath
pipx install git+https://github.com/Goatherd0626/scan2ebook.git
```

## 安装插件

Scan2Ebook 使用 Better Sidebar 显示界面，请按顺序安装：

```bash
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile web add dsh-client-ui-scan2ebook
```

`dsh-better-sidebar` 是必需依赖。如果没有安装，Scan2Ebook 不会在 DSH 侧边栏中出现。Scan2Ebook 插件会自动安装 `scan2ebook-reader`，不需要单独安装网页阅读器。安装完成后重启 DSH。

如果还希望 DSH 在识别到扫描书转换请求时主动打开面板，可以另外安装仓库中的 [Scan2Ebook Skill](https://github.com/Goatherd0626/scan2ebook/tree/main/dsh-skill/scan2ebook)。手动使用 sidebar 不要求安装 Skill。

## 使用方法

1. 在 DSH 侧边栏中打开 **Scan2Ebook**。
2. 点击“选择 PDF”。
3. 输入要转换的起始页和结束页；两端页码都会包含在内。
4. 选择多模态模型。
5. 输入你自己的 API Key。
6. 查看预计费用，点击“开始转换”。
7. 通过进度条查看转换状态。
8. 转换完成后，在同一个 sidebar 中启动网页阅读器。

转换结果会保存在所选 PDF 的同级文件夹中。

## API Key

API Key 只在当前 sidebar 中临时使用：

- 不会读取 DSH 当前使用的 Provider Key；
- 不会写入 `.env`；
- 不会写入钥匙串或浏览器存储；
- 不会写入日志；
- 关闭 sidebar 或 DSH 后会自动清除。

## 网页阅读器

在 sidebar 的“网页阅读器”区域可以：

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

重新执行以下安装命令：

```bash
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile web add dsh-client-ui-scan2ebook
```

然后完全退出并重新启动 DSH。

项目主页：[github.com/Goatherd0626/scan2ebook](https://github.com/Goatherd0626/scan2ebook)

## License

MIT
