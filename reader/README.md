# Scan2Ebook Reader

在本机浏览器里管理书库、阅读 `.s2e` 电子书，也可以直接转换扫描 PDF，无需 DSH。只阅读不需要 Python 或 API Key；转换需要本机 Python 转换器、macOS OCR 和用户自行输入的 DeepSeek API Key。

## 启动当前仓库的改版

项目已经构建好时，双击仓库根目录的 `打开 Scan2Ebook.command`，或在本目录运行：

```bash
npm start
```

首次从源码准备前端时，在本目录执行 `npm ci`、`npm run build`。源码构建工具要求 Node.js 20.19.x 或 22.12 及以上版本。Python 转换器按仓库根目录说明安装；源码目录中存在可用的 `.venv` 时，本地服务会优先调用它，否则查找已安装的 `scan2ebook` 命令。

浏览器访问 `http://127.0.0.1:8765`。点击「添加书籍」：PDF 会自动进入转换页，`.s2e` 或电子书 ZIP 会直接导入书库。转换前可预览原页、确认页码，再输入本次 Key 后开始；完成后可下载结果或直接加入书库阅读。Key 不存储，重试需要重新输入。文件只上传到本机服务，转换时选中页面会发送给所选模型服务。

网页转换的产物先保留在应用数据目录的 `conversions/`，通过下载按钮保存到你选择的位置；浏览器无法直接写入原 PDF 所在目录。这个行为与 DSH 面板不同。

右上角「任务」可查看后台进度、重新打开历史结果、下载电子书或清理已结束的转换。任务索引保存在本机，网页刷新或服务重启后都能找回；意外中断的任务需要重新输入 Key 后重新转换，不提供断点续传。清理只移除转换记录、上传副本和产物，不删除原始 PDF 或已加入书库的电子书。重要结果仍建议另行下载备份。

## 开发与检查

前端采用 React + TypeScript + Vite、Tailwind CSS 与 shadcn/ui 组件方式。书库/转换页在 `src/web`，已有阅读引擎继续通过 `readerBridge` 接入。

```bash
npm run typecheck
npm test
npm run build
```

开发时先启动本地服务，再运行 `npm run dev`；Vite 将本地 API 转发到 `127.0.0.1:8765`。只运行 Vite 或静态预览不能提供真实转换服务。

自动化验证使用隔离的 `--data-dir` 和 `test/fixtures/converter.mjs` 模拟进程，不调用真实模型，也不读取用户书库。Tauri 后续方案见 [`../docs/tauri-desktop-plan.md`](../docs/tauri-desktop-plan.md)。

## 安装

需要 Node.js 20.19 或更高版本。

```bash
npm install --global scan2ebook-reader
```

## 启动

```bash
scan2ebook-reader
```

阅读器会自动在系统默认浏览器中打开。也可以直接访问：

```text
http://127.0.0.1:8765
```

如果不想全局安装，可以临时启动：

```bash
npx scan2ebook-reader
```

## 使用方法

1. 将 PDF 或 `.s2e` 文件拖入页面，或点击「添加书籍」。
2. 在书库点击书籍打开；首页可以继续上次阅读。
3. 在原 PDF 和识别文字之间切换或双向跳转。
4. 使用全文搜索、书签、高亮、注释和阅读进度功能。
5. 点击齿轮进入设置页面：「外观」调整浅色、护眼、深色与纸张色温；「阅读排版」调整字号、行距和正文宽度。修改自动保存，各分类可单独恢复默认；从阅读进入后可返回原段落。
6. 用紧凑网格／列表、搜索和阅读状态筛选找书；点击文件夹进入，点击上方路径返回；勾选书籍可批量移动或移出书库。

阅读功能默认可用，界面不显示插件开关。Web 和 macOS App 共用 `reader/src/` 前端；桌面构建会自动编译并打包同一套页面，界面调整只需维护一次。运行中的网页版刷新即可加载新构建，桌面版通过重新构建并替换 App 更新。

## 修改端口

```bash
scan2ebook-reader --port 9000
```

端口只影响浏览器访问地址，不会创建新的书库。

## 数据与备份

macOS 默认书库位置：

```text
~/Library/Application Support/Scan2Ebook Reader/
```

Windows 默认使用 `%APPDATA%/Scan2Ebook Reader/`，Linux 默认使用用户数据目录下的 `scan2ebook-reader/`。

阅读器会在这里保存导入的电子书、阅读进度、文件夹、书签、高亮、注释和界面设置。建议保留原始 `.s2e` 文件，并定期备份整个数据目录。备份前请先关闭阅读器。

## 支持平台

- macOS；
- Windows；
- 带桌面浏览器的 Linux；
- Chrome、Edge、Safari 或 Firefox 等现代浏览器。

项目主页：[github.com/Goatherd0626/scan2ebook](https://github.com/Goatherd0626/scan2ebook)

## License

MIT

文件夹轮廓改编自 [Rare UI](https://rareui.com)，Copyright (c) 2026 Swami Malode。该部分适用 [第三方许可](THIRD_PARTY_NOTICES.md)。
