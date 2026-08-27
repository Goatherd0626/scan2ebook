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

插件不使用 macOS 钥匙串、`.env`、DSH Provider API Key、`localStorage` 或其他持久化存储，也不会把 API Key 写入日志。CLI 用户仍可以独立使用 `.env`。

开发安装：

```bash
dsh plugin --profile web add link:/absolute/path/to/scan2ebook/dsh-plugin/dsh-client-ui-scan2ebook
```

当前 `0.1.0` 为源码 link 开发安装：插件会从完整 scan2ebook 仓库定位
`.venv/bin/python` 和 `frontend/`，因此还不能把该子目录单独发布为可独立工作的
npm 包。发布 npm 版前需要改为调用 `PATH` 中的 `scan2ebook` 命令和独立阅读器包。

Host 代码更新后重启 `dsh web`；Client 代码更新后硬刷新页面。
