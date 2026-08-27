/* 插件：阅读进度记忆 —— 滚动时自动保存，重开书恢复（核心负责恢复滚动） */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'progress',
  name: '阅读进度记忆',
  version: '1.0.0',
  description: '自动记录每本书读到的页，重新打开时恢复到上次位置',
  activate(ctx) {
    let timer = null;
    const offScroll = ctx.bus.on('text:scroll', ({ bookId, page }) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const book = ctx.state && ctx.state.books.find((b) => b.id === bookId);
        if (!book) return;
        book.progress = { page, at: Date.now() };
        await ctx.db.updateBook(book);
      }, 900);
    });
    return () => {
      offScroll();
      clearTimeout(timer);
      timer = null;
    };
  },
});
