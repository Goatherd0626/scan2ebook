# Scan2Ebook macOS 应用

复用网页的书库、转换和阅读界面。Tauri 使用系统 WebKit；Rust 管理书库和转换任务，Swift 直接使用 PDFKit 与 Vision。应用不包含 Python、Node 或浏览器运行时。

## 安装与使用

从 GitHub Release 下载 [Scan2Ebook 0.2.0 DMG](https://github.com/Goatherd0626/scan2ebook/releases/download/v0.2.0/Scan2Ebook_0.2.0_aarch64.dmg)。打开 DMG，将 **Scan2Ebook** 拖到「应用程序」，然后从「应用程序」打开它。

1. 添加 PDF 或已有的 `.s2e` 电子书。
2. 转换 PDF 时确认页码，输入自己本次使用的 DeepSeek API Key。
3. 完成后阅读或下载电子书。任务中心保留转换历史，并提供取消和清理。

发行包面向 Apple Silicon，最低 macOS 14.4，实际验收系统为 macOS 27.2.1。应用采用临时签名，尚未经过 Apple 公证。若从上述官方 Release 下载，首次打开时遇到无法验证开发者的提示，可先尝试打开 App，再到「系统设置 → 隐私与安全性」为该 App 选择「仍要打开」。 [Apple 官方说明](https://support.apple.com/zh-cn/102445)

桌面书库位于 `~/Library/Application Support/com.scan2ebook.desktop/`，与原网页阅读器的 `Scan2Ebook Reader/` 目录分开，不自动修改或迁移原书库。已有电子书可通过「添加书籍」导入。Key 输入在开始任务或离开转换页时清空，只传入转换子进程的临时环境，不进入配置、历史、日志或命令行。退出应用会停止进行中的转换；完成的结果保留，中断任务可以重新转换。

AI 工具可从应用数据目录读取 `automation.json`，再查询书库、准备 PDF 或获取转换结果。 [本机接口说明](../reader/AUTOMATION.md)

## 开发与构建

需要 Xcode、Rust 和 Node；这些只在开发机器上需要。首次安装构建工具应先征得使用者同意。已有工具时，在仓库根目录执行：

```sh
npm --prefix reader ci
npm --prefix desktop ci
python3 desktop/scripts/build.py
```

脚本构建同一份 `reader/src`，编译 Swift 引擎，执行离线 OCR 自检，生成 `.app` 与 `.dmg`，并复制到 `dist/macos/`。`--app-only` 可只生成应用。构建默认使用无 Finder 自动化的模式，不要求授予 Finder 控制权限。

Swift 引擎通过 `reader/scripts/build-native-engine.mjs` 统一构建，同时供本机网页版与 App 使用；两端的转换运行时均不需要 Python。原生同步和网页回环验收见 [验收记录](../docs/native-web-verification-20261108.md)。

若项目 `build/toolchain/` 内存在 Rust 工具链，脚本会仅对本次构建设置相应环境，不修改系统 PATH。生成资源在 `src-tauri/resources/`，Cargo 产物在 `build/desktop-target/`，均不提交 Git。

## 验证

原生引擎的自制 PDF、真实本机 OCR 和回环假模型测试：

```sh
python3 desktop/engine/tests/run.py
```

Rust 书库、任务协议、取消、子孙进程回收和下载命名检查：

```sh
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

打包后的应用可在只有系统命令的 PATH 下进行完整回环测试；参数需指向自制 PDF 和一个尚不存在的隔离目录：

```sh
python3 desktop/tests/app_smoke.py \
  --app dist/macos/Scan2Ebook.app \
  --directory /tmp/scan2ebook-app-qa \
  --pdf /path/to/self-made-scan.pdf --keep-open
```

此测试从 `.app` 启动实际 Rust 服务和 Swift 引擎，模型只连接显式启用的本机回环地址；不会调用付费 API。其输出包含服务地址，可用 ego-browser 验证相同前端的导入、阅读、转换、取消和下载。原生窗口操作与浏览器验收应分别记录，不能互相替代。模拟模型不证明真实模型的识别质量。

PDF.js 使用 `Promise.withResolvers`，因此最低系统要求对应 WebKit 17.4，参见 [WebKit 官方说明](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)。Tauri 资源打包方式见 [官方文档](https://v2.tauri.app/develop/resources/)。文件夹组件源自 [Rare UI](https://rareui.com)，许可与署名见 [第三方说明](../reader/THIRD_PARTY_NOTICES.md)，应用资源和「关于」菜单也包含署名。
