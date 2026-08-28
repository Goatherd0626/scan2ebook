# scan2ebook-reader

独立的本地网页阅读器，用于导入和阅读 `scan2ebook` 生成的 `.s2e` 电子书。
它不包含 OCR、Python 转换器、DSH 插件或 API Key 配置。

## 启动

```bash
npx scan2ebook-reader
```

或全局安装：

```bash
npm install --global scan2ebook-reader
scan2ebook-reader
```

默认地址是 `http://127.0.0.1:8765`，启动后自动使用系统默认浏览器打开。

```bash
scan2ebook-reader --port 9000
scan2ebook-reader --no-open
scan2ebook-reader --data-dir "/path/to/custom/library"
scan2ebook-reader --help
```

为了避免在局域网暴露本地服务，当前版本只允许监听 `127.0.0.1`、
`localhost` 或 `::1`。

## 电子书存储

导入的 PDF、结构化 JSON、文件夹、书签、阅读进度、标注和界面偏好都保存在
reader 服务的独立数据目录，不在 npm 包目录或浏览器 profile 中。

macOS 默认位置：

```text
~/Library/Application Support/Scan2Ebook Reader/
├── library.json
└── books/
    └── <book-id>/
        ├── book.pdf
        ├── record.json
        └── annotations.json
```

Windows 使用 `%APPDATA%/Scan2Ebook Reader/`，Linux 使用
`$XDG_DATA_HOME/scan2ebook-reader/` 或 `~/.local/share/scan2ebook-reader/`。
可用 `--data-dir` 或 `SCAN2EBOOK_READER_DATA_DIR` 覆盖。

数据源与 host/port 无关：`127.0.0.1:8765`、`127.0.0.1:9000` 和
`localhost:8765` 只是不同访问入口，默认都使用同一书库。

首次运行新版时，当前地址下的旧 IndexedDB 书库会自动复制到统一目录。
迁移不会删除旧 IndexedDB；如果过去在多个端口各有书库，可分别访问一次
让它们合并。已进入统一库的同 ID 记录不会被其他旧端口覆盖。

仍建议保留原始 `.s2e` 文件，并定期备份整个数据目录。备份前最好先关闭 reader。

## Node.js API

```js
import { startReader } from 'scan2ebook-reader';

const reader = await startReader({
  host: '127.0.0.1',
  port: 8765,
  // storageDir: '/path/to/custom/library',
  openBrowser: false,
});

// 仅能关闭由当前调用新启动的实例。
if (!reader.reused) await reader.close();
```

## 平台

- Node.js `>=20.19`
- macOS、Windows 和带 `xdg-open` 的 Linux 桌面环境
- 现代 Chrome、Edge、Safari 或 Firefox

## License

MIT
