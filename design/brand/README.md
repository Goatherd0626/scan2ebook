# s2e. 字标与应用图标

采用 **A · 延续**：保留原字母标记，校准字距，将末尾圆点单独绘制。网页侧栏、浏览器页签和 macOS 应用图标使用同一套轮廓。

- `a-original/`：延续原字标，基于 Helvetica Neue Bold 的字形轮廓；当前采用版。
- `b-rounded/`：自行绘制的圆角字形，作为比较方案。
- `c-editorial/`：基于 Georgia Bold 的衬线字形，偏书刊气质，作为比较方案。

每个目录包含透明字标 SVG/PNG、反白 SVG、单色 SVG，以及应用图标的 SVG 和 16/32/64/1024px PNG。SVG 已转为路径，不包含运行时字体依赖。主色沿用应用的深墨绿、橄榄绿与青柠色。

打开 [对比预览](index.html) 可切换浅色和深色。预览展示字标、App 图标、侧栏实际尺寸和小尺寸效果；[浅色对比图](comparison-light.png)可直接查看。

使用本机 CoreText 导出轮廓及 PNG：

```sh
xcrun swift -module-cache-path build/swift-module-cache design/brand/export.swift design/brand
```

采用版的交付资源位于 `reader/src/assets/brand/`。更新采用版时应同步这里的 SVG 和图标源 PNG；桌面构建会从这张 PNG 生成各尺寸原生图标，不重新依赖系统字体。

本轮已检查 SVG 路径与 PNG 透明通道、16/32px 图标，以及 ego-browser 中的深浅配色和实际侧栏显示。类型检查、3 项相关现有测试及 npm 包内容检查通过；桌面应用和安装包已重新构建并通过本机签名校验。
