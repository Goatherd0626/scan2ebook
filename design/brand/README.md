# Scan2Ebook 图形标与字标

采用 **翻页图形 + A · 延续字标**：翻开的书表达阅读，抬起的一页形成独立轮廓，保留原有 `s2e.` 的字体与排版。网页侧栏使用组合标；浏览器页签和 macOS 应用图标单独使用图形。图形由三块实色书页组成，不增加文字或细碎装饰。

- `a-original/logo.svg`、`logo.png`：当前组合标，透明背景。
- `a-original/symbol.svg`、`symbol.png`：独立图形，透明背景。
- `a-original/wordmark.svg`、`wordmark.png`：保留的字标，基于 Helvetica Neue Bold 的字形轮廓。
- `a-original/app-icon.svg`、`app-icon-*.png`：图形版 App 图标。
- `*-inverse.svg`：深色背景使用；`*-mono.svg`、`*-white.svg`：单色与反白。
- `b-rounded/`、`c-editorial/`：前一轮的字形参考稿，不用于当前应用。

SVG 均为路径，不包含运行时字体依赖。图形保留页间留白，小图标使用单色深墨绿与青柠底提高辨识度，提供 16/32/64/1024px PNG。

打开 [Logo 预览](index.html) 可切换浅色和深色，查看组合标、独立图形、App 图标、单色及 16/32/48px 显示效果。[浅色预览](comparison-light.png)、[深色预览](comparison-dark.png)、[实际侧栏](application-light.png)可直接查看。

使用本机 CoreText 导出轮廓及 PNG：

```sh
xcrun swift -module-cache-path build/swift-module-cache design/brand/export.swift design/brand
```

应用使用的组合标、反白组合标和图标源文件位于 `reader/src/assets/brand/`。更新采用版时应同步这里的资源；桌面构建会从同一张 PNG 生成各尺寸原生图标，不重新依赖系统字体。

本轮通过类型检查、3 项相关现有测试及 npm 包内容检查；检查了 SVG 路径与 PNG 透明通道。ego-browser 实测深浅配色、实际侧栏、Logo 返回书库和 SVG 下载，并在 390px 模拟手机视口中检查了预览及侧栏图形。应用与 DMG 已重新构建、通过本机签名校验；包内图标与源资源一致。网页、App 与安装包使用同一图形，没有新增运行时依赖。
