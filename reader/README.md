# Scan2Ebook Reader

用于阅读 Scan2Ebook 生成的 `.s2e` 电子书。阅读器在本机运行，不需要 DSH、Python 转换器或 DeepSeek API Key。

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

1. 将 `.s2e` 文件拖入阅读器，或点击导入按钮。
2. 双击书名打开电子书。
3. 在原 PDF 和识别文字之间切换或双向跳转。
4. 使用全文搜索、书签、高亮、注释和阅读进度功能。
5. 在设置中调整字号、行距、正文宽度、护眼模式和深色模式。

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
