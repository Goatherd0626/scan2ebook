# dsh-client-ui-scan2ebook

DeepSeek Harness 本地插件，为 `scan2ebook` 提供左侧导航入口和图形化转换面板。

功能：

- 使用 macOS 系统文件选择器选择任意目录中的 PDF；
- 选择 1-based、两端闭区间的 PDF 页码；
- 配置多模态模型与临时 API Key；
- 展示 OCR/结构化进度、视觉请求次数和费用估算；
- 转换结果直接写入所选 PDF 的同级目录；
- 将“电子书转换”和“网页阅读器”集中在同一个非阻塞右侧 sidebar 中；
- 启动和终止插件管理的本地网页阅读器，并通过系统默认浏览器打开，不占用 DSH 内置 sidebar；
- 提供 `scan2ebook_open` 工具，供 Skill 在识别到转换需求后唤起面板。

API Key 直接在 sidebar 中输入，只保留在当前 sidebar 的浏览器内存中。它只随 `start` RPC 进入本机宿主，并作为 Python 子进程环境变量使用。关闭 sidebar、切换到其他 sidebar Tab 或退出 DSH 后，输入的 Key 会自动清除。

插件不使用 macOS 钥匙串、`.env`、DSH Provider API Key、`localStorage` 或其他持久化存储，也不会把 API Key 写入日志。独立 CLI 会在终端中隐藏输入 Key，同样不会持久化。

## 运行依赖

- macOS（当前原生 PDF 选择器和 OCR 流程仅支持 macOS）；
- DeepSeek Harness `>=0.1.1-rc.1`；
- Node.js `>=20.19`；
- 独立安装的 Python `scan2ebook` 转换器；
- npm 依赖 `scan2ebook-reader@^0.1.0`，安装插件时自动安装。

插件不再从源码位置推导仓库根目录，也不读取仓库中的 `.venv` 或
`reader/dist/`。默认调用 DSH 宿主 `PATH` 中的 `scan2ebook`。如果 DSH
不是从终端启动，建议在 `cordis.patch.yml` 中写明转换器绝对路径：

```yaml
scan2ebookCommand: '/absolute/path/to/venv/bin/scan2ebook'
# 可选；默认由 reader 使用系统应用数据目录
readerDataDir: '/absolute/path/to/reader-data'
```

这只是选择已安装的程序，不要求转换器和插件位于同一个仓库。
如果需要通过 Python 模块入口启动，也可以配置为：

```yaml
scan2ebookCommand: '/absolute/path/to/python'
scan2ebookArgs:
  - '-m'
  - 'scan2ebook'
```

## npm 发布后的安装

正式发布后，DSH 安装插件时会一并解析 reader 依赖：

```bash
dsh plugin --profile web add dsh-client-ui-scan2ebook
```

reader 包必须先于插件发布。安装后重启 `dsh web`。

## 当前仓库源码联调

在 reader 尚未发布到 npm registry 时，先构建 reader 并把本地包安装到
插件目录，然后使用 link 安装：

```bash
cd reader
npm ci
npm run build

cd ../dsh-plugin/dsh-client-ui-scan2ebook
npm install --no-save --package-lock=false ../../reader

dsh plugin --profile web add link:/absolute/path/to/scan2ebook/dsh-plugin/dsh-client-ui-scan2ebook
```

本地安装 reader 只是尚未发布阶段的联调方式；插件运行代码使用的仍是正式包名
`scan2ebook-reader`，没有源码相对路径回退。

Host 代码更新后重启 `dsh web`；Client 代码更新后硬刷新页面。
