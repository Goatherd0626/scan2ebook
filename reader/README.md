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
scan2ebook-reader --help
```

为了避免在局域网暴露本地服务，当前版本只允许监听 `127.0.0.1`、
`localhost` 或 `::1`。

## 电子书存储

导入的 PDF、结构化 JSON、书签、阅读进度和标注存在浏览器 IndexedDB
数据库 `scan2ebook-reader` 中，不存在 npm 包目录。

IndexedDB 按 `scheme + host + port` 隔离，所以 `127.0.0.1:8765` 和
`127.0.0.1:9000` 是两个不同的书库。建议长期使用默认地址，并保留原始
`.s2e` 文件作为备份。

## Node.js API

```js
import { startReader } from 'scan2ebook-reader';

const reader = await startReader({
  host: '127.0.0.1',
  port: 8765,
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
