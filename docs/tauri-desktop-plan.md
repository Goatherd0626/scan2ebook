# Tauri 2 桌面端接入方案

当前已经完成本机网页版。本轮不安装 Rust、不构建 macOS 应用，也不把以下方案当作已验证的桌面交付。

## 采用的路线

建议以 Tauri 2 作为桌面外壳，复用 `reader/src/web` 的 React + TypeScript 界面、Tailwind 样式和 shadcn/ui 组件。不引入 Wasp：当前没有账户、云数据库或多用户业务需求。

Tauri 可以加载现有前端构建产物；Python 转换器可以作为 sidecar 打包。官方文档说明，sidecar 可以是 Python 应用生成的独立可执行文件，并需要为目标架构提供对应二进制。参见 [前端配置](https://v2.tauri.app/start/frontend/) 与 [外部二进制打包](https://v2.tauri.app/develop/sidecar/)。

## 先复用界面，再替换本地服务

当前网页的数据流是：React 界面 → 本机 HTTP API → Node 存储/转换管理器 → Python OCR 与结构化转换。

桌面版建议改为：同一套 React 界面 → TypeScript 传输适配 → Rust 命令与存储 → Python 转换 sidecar。

不建议为套壳直接额外内置一整套 Node 运行时。Rust 先接管文件选择、任务生命周期、存储和受控导出；OCR 与模型结构化继续复用 Python。需要实际打包测试后才能判断包体、启动速度和内存占用。

## 已准备好的复用边界

- `src/web/conversion-api.ts` 集中定义上传、开始、状态、取消、下载、任务移除和清理接口及其 TypeScript 类型。后续可在此适配 Tauri `invoke`/事件，转换组件不必重新设计。
- `src/core/db.js` 是现有书库访问入口。桌面版应在此接入 Rust 存储，继续兼容书籍 JSON、PDF、批注、书签与阅读偏好，避免迁移时丢数据。
- `readerBridge` 连接 React 书库与已有阅读引擎；阅读引擎可以逐步迁移，不与 Rust 打包绑定。
- `reader/dist` 是网页构建产物。桌面端继续使用同一份源代码构建，新增 `src-tauri` 作为平台层。

## 实施顺序与验收

1. 安装经用户确认的 Rust/Xcode 工具，创建最小 Tauri 2 工程，加载现有页面；先验证 PDF worker、字体、主题和键盘操作。
2. 用 Rust 命令实现书库接口，使用独立测试数据目录。导入现有格式，核对批注、进度、书签与阅读偏好。
3. 将 Python 转换器打成 Apple Silicon sidecar，验证 Apple Vision/PyObjC 依赖、中文 OCR 与页码范围；需要 Intel 支持时单独构建对应架构。
4. 实现选择 PDF、取消任务、关闭窗口和退出应用时的进程清理。Key 仍只用于本次任务，不放入配置、钥匙串、日志或命令参数。
5. 完成真实模型转换验收后，再进行签名、公证、安装与升级测试。真实转换需要用户自行输入 Key 并另行授权测试。

后续依赖要求以 [Tauri 官方准备说明](https://v2.tauri.app/start/prerequisites/) 为准。本轮仅核对文档与前端边界，未验证 sidecar 打包、WKWebView 行为、签名或公证。

## 网页版现状与后续验收

- 转换任务索引已持久化；刷新或服务重启后可以查看历史结果。运行中任务重启后显示为中断，需要用户重新输入 Key 后重新转换，不提供断点续传。
- 上传副本与输出位于应用数据目录的 `conversions/`，任务中心已有移除和批量清理入口。清理保留正在运行的任务和书库；桌面端实现时应延续相同边界。
- 真实模型可用性、识别质量及整本长书转换尚未在本轮验证。
