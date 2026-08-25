# 文字高亮与注释插件设计

## 目标

为网页阅读器增加多色文字高亮、文字注释和可调整宽度的右侧标注栏。标注数据作为 `.s2e` 中独立的 `annotations.json` 保存，不修改 `book.json` 或 PDF。

## 文件格式与本地存储

`.s2e` 保持 ZIP 容器，新增可选文件：

```text
book.pdf
book.json
annotations.json
```

旧包没有 `annotations.json` 时按空标注导入。侧文件采用版本化结构：

```json
{
  "version": 1,
  "highlights": [],
  "notes": []
}
```

高亮记录包含 `id/range/quote/color/createdAt/updatedAt`，注释记录包含 `id/range/quote/text/createdAt/updatedAt`。IndexedDB 升级到 v2，新增 `annotations` object store；本地记录额外保存 `bookId` 和 `type`，并建立 `bookId` 索引。删除电子书时级联删除标注。浏览器不能覆盖磁盘原文件，因此阅读时写入 IndexedDB，用户点击导出时重建包含侧文件的新 `.s2e`。

## 文字锚点与范围运算

位置使用 `{ page, item, offset }`，范围使用 `{ start, end }`。`page/item` 对应文字视图稳定的 `data-page/data-item`，`offset` 是 item 内纯文本字符偏移。选区允许跨 item、跨 PDF 页。

高亮与注释是独立数据层。同一选区最多一条注释；相同选区再次添加会编辑原注释。设置高亮颜色时，选区覆盖已有颜色；被部分覆盖的旧高亮拆分，邻接同色高亮合并。取消高亮按钮仅在选区与高亮相交时启用，并只移除选区范围内的高亮，不删除注释。

记录同时保存 `quote`。锚点失效时尝试在附近 item 中按 quote 恢复；仍无法恢复的记录保留在侧栏，标记位置变化，并退化到 PDF 页跳转。

## 正文渲染与选区浮窗

使用 CSS Custom Highlight API 分色渲染，不向正文嵌套多层 `mark`，避免与搜索、脚注和跨页段落冲突。五种颜色为黄、绿、蓝、粉、橙。注释范围使用虚线下划线；选区结束 item 的段末插入一个 `personalhotspot.svg` mask 按钮，图标接近竖直并略微倾斜。跨段注释只生成一个末尾图标，点击后打开侧栏并定位相应注释。

选中文字浮窗显示五个色块、取消高亮和添加/编辑注释。取消高亮在无相交高亮时置灰。添加注释会在浮窗中展开编辑器，支持保存和取消。

## 右侧标注栏

顶栏插件区增加开关按钮。侧栏位于电子书视图最右侧，支持 `240–520px` 拖动、双击恢复默认宽度，并记忆开关状态和宽度。窗口过窄时限制侧栏宽度，保证 PDF/文字区最小可用宽度。

侧栏有“注释 / 高亮”两个视图：

- 注释视图只显示有注释内容的记录，按 `page → item → offset` 排序；卡片显示引用原文、注释内容和 PDF 页码。
- 高亮视图按连续高亮范围显示一张卡片，支持五色筛选；点击卡片跳转对应文字。

单击注释卡片选中并在卡片上方显示浮窗，第一版提供跳转、复制原文、修改高亮颜色、编辑注释和删除。双击直接编辑。单选按 Delete/Backspace 直接删除；多选删除必须确认。

多选支持 Shift 连续选择、macOS Command / Windows/Linux Ctrl 增减选择，以及从侧栏空白处拖动矩形框选。多选浮窗第一版只提供“删除所选”。

焦点位于侧栏时，macOS `Command+F`、Windows/Linux `Ctrl+F` 唤起侧栏内 VS Code 风格浮动查找条。注释视图搜索注释正文和引用原文；高亮视图只搜索高亮原文。查找条提供计数、上一个、下一个和关闭。仅 PDF 模式下从侧栏跳转文字时，自动切换为双栏。

## 插件与核心边界

`annotations` 插件拥有范围运算、CSS Highlight 注册、正文标记、选区菜单、右侧栏、搜索筛选、批量选择和导出 UI。插件必须支持运行时启停：启用时扫描已打开视图，停用时移除面板、标记、Highlight 注册、全局监听和定时器。

核心只扩展：

- IndexedDB 标注 CRUD 和删除级联；
- 文字选区的稳定范围信息；
- 可渲染自定义内容的选区 UI 扩展点；
- `.s2e` 导入可选 `annotations.json`；
- 插件上下文中的标注存储 API。

## 错误与兼容

导入时校验 `version/type/range/color/text`，跳过非法记录并提示数量。导出失败以 toast 报错，不改动现有本地数据。目标环境为支持 CSS Custom Highlight API 的现代 Chromium/Safari；不支持时插件显示一次明确提示并停用正文装饰，标注数据仍保留。

## 验证范围

自动测试覆盖范围比较、覆盖/拆分/合并、局部取消、IndexedDB 隔离与级联删除、侧文件导入导出、选区锚点、注释排序、颜色筛选、搜索、多选删除和插件生命周期。最后运行前端测试全集与 Vite production build，不执行额外 smoke test。
