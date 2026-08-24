/* 插件：书签 —— 工具栏 🔖 + 目录面板「书签」tab，存于书记录（IndexedDB） */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'bookmarks',
  name: '书签',
  version: '1.0.0',
  description: '为当前页加书签，在目录面板「书签」tab 中查看与跳转',
  activate(ctx) {
    // 「书签」tab 主体
    const body = document.createElement('div');
    body.id = 'tab-body-bookmarks';
    body.className = 'panel-body tab-body';
    body.hidden = true;
    document.getElementById('toc-panel').appendChild(body);
    ctx.ui.addTocTab({ id: 'bookmarks', title: '书签', onShow: renderList });

    function currentBook() {
      return (ctx.state && ctx.state.books.find((b) => b.id === ctx.state.activeBookId)) || null;
    }

    async function addBookmark() {
      const book = currentBook();
      const view = ctx.getView && ctx.getView();
      if (!book || !view) return;
      const page = view.textView.currentPage || view.pdfView.currentPage || 1;
      const anchor = view.textView.pageAnchors.get(page);
      const snippet = anchor ? (anchor.textContent || '').trim().slice(0, 40) : '';
      book.bookmarks = book.bookmarks || [];
      book.bookmarks.push({ id: crypto.randomUUID(), page, snippet, at: Date.now() });
      await ctx.db.updateBook(book);
      renderList();
      ctx.toast('已添加书签：PDF 第 ' + page + ' 页');
    }

    function renderList() {
      const book = currentBook();
      body.innerHTML = '<button class="mini add-bm" title="为当前页加书签" style="margin:4px 6px 8px">＋ 添加当前页书签</button>';
      body.querySelector('.add-bm').addEventListener('click', addBookmark);
      if (!book || !book.bookmarks || !book.bookmarks.length) {
        body.innerHTML = '<div style="color:var(--ink-3);padding:10px">暂无书签（🔖 为当前页加书签）</div>';
        return;
      }
      const view = ctx.getView && ctx.getView();
      for (const bm of book.bookmarks) {
        const row = document.createElement('div');
        row.className = 'bm-item';
        const txt = document.createElement('span');
        txt.textContent = bm.snippet || ('PDF 第 ' + bm.page + ' 页');
        txt.style.overflow = 'hidden';
        txt.style.textOverflow = 'ellipsis';
        const pg = document.createElement('span');
        pg.className = 'bm-page'; pg.textContent = 'P' + bm.page;
        const x = document.createElement('span');
        x.className = 'bm-x'; x.textContent = '✕';
        x.addEventListener('click', async (e) => {
          e.stopPropagation();
          book.bookmarks = book.bookmarks.filter((b) => b.id !== bm.id);
          await ctx.db.updateBook(book);
          renderList();
        });
        row.append(txt, pg, x);
        row.addEventListener('click', () => {
          if (view) { view.pdfView.gotoPage(bm.page); view.textView.scrollToPage(bm.page); }
        });
        body.appendChild(row);
      }
    }
  },
});
