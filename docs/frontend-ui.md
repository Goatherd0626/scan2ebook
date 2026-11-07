# 前端交互约定

Web 与 macOS App 共用 `reader/src/`。反馈与导航轻量改编自 [Rare UI](https://www.rareui.com/)，使用现有依赖、CSS 和浏览器动画；来源与许可见 [第三方声明](../reader/THIRD_PARTY_NOTICES.md)。

## 操作反馈

现有和后续的保存、导入、导出、删除、后台结果提示统一调用 `showToast`，不再另建临时提示条或原生 `alert`。输入校验仍紧邻字段，连接状态与转换进度留在对应页面。

```js
import { showToast } from './core/dialogs.js';

showToast({ type: 'success', message: '已保存' });
showToast({ type: 'error', message: '导入失败', description: '请选择完整的电子书。' });
showToast({
  message: '注释已删除', actionLabel: '撤销',
  onAction: () => restoreAnnotation(), doneMessage: '注释已还原',
});
```

支持 `info / success / error / warning / loading`。默认 3.6 秒，悬停或键盘聚焦时暂停，最多同时显示三条。`loading` 与 `duration: 0` 持续显示；调用返回的关闭函数结束该条提示。动作等待 Promise 完成，失败后可重试。Toast 不抢焦点，也不记录密钥或用户文件内容。

## 删除

不可恢复的删除使用 `confirmDelete({ anchor, title, message, confirmLabel })`。确认卡片在来源按钮附近展开，首次操作只展示选择；返回 `true` 后才能修改数据。取消、Esc、点击外部或离开页面均取消，键盘焦点尽量回到来源。文案应明确删除范围，例如「书库副本」或「转换产物」。普通输入与选择仍使用现有表单组件。

## 导航与通知

设置和主要导航使用 Bounce Sidebar，顶部已打开页面使用 Gooey Nav。导航状态继续由现有 `aria-current` 与活动标签控制；动效只表达切换，不改变路由、阅读位置或草稿。系统开启减少动态效果时直接显示最终状态。

铃铛汇总本次打开页面之后的转换完成、失败和中断结果。初次加载的历史不重复提醒，打开通知面板清空未读；面板展开时结果直接显示在列表中。任务、文件下载和清理仍使用原有任务服务，未读数量仅保存在当前页面会话。
