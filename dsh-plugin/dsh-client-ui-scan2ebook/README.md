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

API Key 只随一次 `start` RPC 进入本机宿主，并作为 Python 子进程环境变量使用；浏览器不持久化，宿主不写日志。

API Key 来源可在选择 PDF 前配置：

- **macOS 钥匙串（推荐）**：可在 sidebar 中保存、更新或删除；浏览器只读取配置状态，不会取回明文；
- **仅本次转换输入**：只保留在当前 sidebar 的内存中，任务启动后清空；
- **环境变量 / 项目 `.env`**：使用 `DEEPSEEK_API_KEY`，适合已有 CLI 配置的用户。

开发安装：

```bash
dsh plugin --profile web add link:/absolute/path/to/scan2ebook/dsh-plugin/dsh-client-ui-scan2ebook
```

Host 代码更新后重启 `dsh web`；Client 代码更新后硬刷新页面。
