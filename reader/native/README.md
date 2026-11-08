# 网页端原生转换引擎

网页阅读器的 PDF 转换与 macOS App 使用同一份 `desktop/engine/*.swift` 源码。引擎要求 macOS 14.4 或更高版本，不依赖 Python。

在源码仓库中运行 `npm --prefix reader run build:engine`，会通过系统 Xcode 工具链构建当前 Node 架构的引擎，并进行本机临时签名。产物为 `native/darwin-arm64/scan2ebook-engine` 或 `native/darwin-x64/scan2ebook-engine`。可用 `npm --prefix reader run build:engine -- --arch arm64` 或 `--arch x64` 明确指定目标；交叉编译不代表已在相应处理器上验证运行。

`npm pack` 会先构建前端和当前 Mac 架构的引擎，再将已有的 `native` 资产打包。发布包只支持实际包含的 Mac 架构；可以运行 `npm --prefix reader run test:package -- --arch arm64`（或 `x64`）检查指定架构是否入包。开发构建脚本和 Swift 源码不随 npm 包发布。

非 macOS 环境会跳过引擎编译，并明确提示只能使用网页阅读器；不会生成其他平台的转换引擎。本机临时签名不等于 Developer ID 签名或 Apple 公证。构建过程不读取 API Key，也不调用模型服务。
