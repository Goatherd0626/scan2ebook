# Scan2Ebook 本机接口

Web 和 macOS App 提供同一套 HTTP 接口。接口只监听回环地址，供本机的浏览器、脚本和 AI 工具调用。确认操作的是用户想用的书库，上传用户选定的文件即可。

## 找到运行地址

- Web 启动后执行 `scan2ebook-reader --endpoint`。源码方式使用 `npm start -- --endpoint`，如果服务配置了自定义端口，也传入相同的 `--port`。
- macOS App 打开后读取 `~/Library/Application Support/com.scan2ebook.desktop/automation.json`。

两个入口都提供 `url`、`apiVersion`、`edition` 和 `pid`。当前接口为 `apiVersion: 1`，`edition` 为 `web` 或 `macos`。调用前请求 `GET /__scan2ebook__/health`，确认响应的 `app` 为 `scan2ebook-reader`，接口版本、类型和 PID 与连接信息一致。App 被意外关闭后，磁盘上的连接信息可能已过期。

## 书库与转换

下面的路径相对于本机服务地址。

| 用途 | 请求 | 结果 |
|---|---|---|
| 查看书库 | `GET /__scan2ebook__/storage` | `books`、`folders`、注释和偏好。书籍 ID 可用于打开 `/?book=<id>` |
| 查看转换服务 | `GET /__scan2ebook__/conversion` | `available`、`maxFileBytes`、`jobs` |
| 准备 PDF | `POST /__scan2ebook__/conversion/uploads` | `id`、`name`、`pages`、`size`、原 PDF 预览路径 `url` |
| 查看已上传的 PDF | `GET /__scan2ebook__/conversion/uploads/<id>` | 同上 |
| 查看单项任务 | `GET /__scan2ebook__/conversion/jobs/<id>` | `status`、`progress`、`upload`、`files` |

准备转换时先检查 `available`。请求体是 PDF 字节，`Content-Type` 为 `application/pdf`，`X-S2E-Filename` 是经过 URL 编码的文件名。下面用默认 Web 地址和自制样书演示。

```sh
curl --fail --silent --show-error \
  -H 'Content-Type: application/pdf' \
  -H 'X-S2E-Filename: sample.pdf' \
  --data-binary '@/path/to/sample.pdf' \
  'http://127.0.0.1:8765/__scan2ebook__/conversion/uploads'
```

用返回的 `id` 组合链接 `/?view=convert&upload=<id>&pageStart=2&pageEnd=3`。页码从 1 开始，包含首尾两页，可省略页码以准备整本。用户打开本机链接即可预览、确认页码，并在界面输入自己的 DeepSeek API Key 开始转换。使用 App 的地址时，本机链接连到 App 已经打开的同一书库与转换服务。

转换开始后在 `jobs` 里按 `upload.id` 找到任务。完成时可打开 `/?view=convert&job=<id>`，也可用 `files[].url` 下载 `s2e`、`json` 或 `html`。链接有效期间，需要保持对应的本机服务运行并保留该上传或任务。

API Key 由用户在转换页输入。请勿经由聊天、命令行或配置文件传递 Key。自动化验收使用自制 PDF、隔离数据目录和回环模拟模型。
