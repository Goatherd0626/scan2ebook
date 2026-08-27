/* 插件：书签 —— 工具栏 🔖 + 目录面板「书签」tab，存于书记录（IndexedDB） */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'bookmarks',
  name: '书签',
  version: '1.0.0',
  description: '为当前页加书签，在目录面板「书签」tab 中查看与跳转',
  activate(ctx) {
    const controller = new window.AbortController();
    const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, {
      ...options, signal: controller.signal,
    });
    let selectedIds = new Set();
    let selectionAnchorId = null;
    let marquee = null;
    // 「书签」tab 主体
    const body = document.createElement('div');
    body.id = 'tab-body-bookmarks';
    body.className = 'panel-body tab-body';
    body.hidden = true;
    body.tabIndex = 0;
    document.getElementById('toc-panel').appendChild(body);
    const removeTab = ctx.ui.addTocTab({ id: 'bookmarks', title: '书签', onShow: renderList });

    function currentBook() {
      return (ctx.state && ctx.state.books.find((b) => b.id === ctx.state.activeBookId)) || null;
    }

    function normalizeBookmarks(book) {
      const seenPages = new Set();
      book.bookmarks = [...(book.bookmarks || [])]
        .sort((a, b) => (a.page - b.page) || ((a.at || 0) - (b.at || 0)))
        .filter((bookmark) => {
          if (seenPages.has(bookmark.page)) return false;
          seenPages.add(bookmark.page);
          delete bookmark.item;
          return true;
        });
      return book.bookmarks;
    }

    function bookmarkAt(book, page) {
      return normalizeBookmarks(book).find((bookmark) => bookmark.page === page);
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp || Date.now());
      const pad = (value) => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + '  ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    async function removeBookmarks(ids, confirmMultiple = true) {
      const book = currentBook();
      if (!book || !ids.length) return;
      if (confirmMultiple && ids.length > 1 && !confirm('取消选中的 ' + ids.length + ' 个书签？')) return;
      const idSet = new Set(ids);
      book.bookmarks = (book.bookmarks || []).filter((bookmark) => !idSet.has(bookmark.id));
      ids.forEach((id) => selectedIds.delete(id));
      await ctx.db.updateBook(book);
      renderList();
    }

    async function toggleBookmark(source = null) {
      const book = currentBook();
      const view = ctx.getView && ctx.getView();
      if (!book || !view) return;
      const page = source?.page || view.textView.currentPage || view.pdfView.currentPage || 1;
      const anchor = view.textView.pageAnchors.get(page);
      const snippet = source?.snippet || (anchor ? (anchor.textContent || '').trim().slice(0, 40) : '');
      book.bookmarks = book.bookmarks || [];
      const existing = bookmarkAt(book, page);
      if (existing) book.bookmarks = book.bookmarks.filter((bookmark) => bookmark.page !== page);
      else book.bookmarks.push({ id: crypto.randomUUID(), page, snippet, at: Date.now() });
      await ctx.db.updateBook(book);
      renderList();
      ctx.toast((existing ? '已取消书签：PDF 第 ' : '已添加书签：PDF 第 ') + page + ' 页');
    }

    const removeContextAction = ctx.ui.addContextAction({
      id: 'bookmark-selection-action',
      render({ selection, close }) {
        if (selection?.kind !== 'text') return null;
        const book = currentBook();
        const existing = book && bookmarkAt(book, selection.page);
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'bookmark-context-action';
        add.title = existing ? '取消书签' : '添加书签';
        add.setAttribute('aria-label', add.title);
        add.innerHTML = '<span class="bookmark-context-icon '
          + (existing ? 'i-bookmark-context-filled' : 'i-bookmark-context') + '"></span>';
        add.addEventListener('click', async () => {
          await toggleBookmark({ page: selection.page });
          close();
        });
        return add;
      },
    });

    function renderList() {
      const book = currentBook();
      body.innerHTML = '';
      if (!book || !book.bookmarks || !book.bookmarks.length) {
        body.appendChild(Object.assign(document.createElement('div'), {
          className: 'bm-empty', textContent: '暂无书签',
        }));
        return;
      }
      const view = ctx.getView && ctx.getView();
      const ordered = normalizeBookmarks(book);
      selectedIds = new Set([...selectedIds].filter((id) => ordered.some((bookmark) => bookmark.id === id)));
      const multi = document.createElement('div');
      multi.className = 'bm-multi';
      multi.hidden = selectedIds.size < 2;
      multi.innerHTML = '<span>已选 ' + selectedIds.size + ' 个</span><button type="button" class="bm-multi-remove" title="取消所选书签" aria-label="取消所选书签"><span class="bookmark-context-icon i-bookmark-context-filled"></span></button>';
      multi.querySelector('.bm-multi-remove').addEventListener('click', () => removeBookmarks([...selectedIds]));
      body.appendChild(multi);

      const updateSelection = () => {
        body.querySelectorAll('.bm-item').forEach((row) => row.classList.toggle('selected', selectedIds.has(row.dataset.id)));
        multi.hidden = selectedIds.size < 2;
        multi.querySelector('span').textContent = '已选 ' + selectedIds.size + ' 个';
      };

      const selectRow = (event, bookmark) => {
        const anchorIndex = ordered.findIndex((item) => item.id === selectionAnchorId);
        const currentIndex = ordered.findIndex((item) => item.id === bookmark.id);
        if (event.shiftKey && anchorIndex >= 0) {
          selectedIds.clear();
          const [start, end] = [Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex)];
          ordered.slice(start, end + 1).forEach((item) => selectedIds.add(item.id));
        } else if (event.metaKey || event.ctrlKey) {
          if (selectedIds.has(bookmark.id)) selectedIds.delete(bookmark.id); else selectedIds.add(bookmark.id);
          selectionAnchorId = bookmark.id;
        } else {
          selectedIds = new Set([bookmark.id]);
          selectionAnchorId = bookmark.id;
        }
        updateSelection();
      };

      for (const bm of ordered) {
        const row = document.createElement('div');
        row.className = 'bm-item' + (selectedIds.has(bm.id) ? ' selected' : '');
        row.dataset.id = bm.id;
        row.tabIndex = 0;
        const txt = document.createElement('span');
        txt.className = 'bm-text';
        const snippet = (bm.snippet || '').trim();
        txt.textContent = snippet.length > 28 ? snippet.slice(0, 28) + '…' : (snippet || '暂无文字摘要');
        const pg = document.createElement('span');
        pg.className = 'bm-page'; pg.textContent = 'P' + bm.page;
        const content = document.createElement('span');
        content.className = 'bm-content';
        const time = document.createElement('span');
        time.className = 'bm-time';
        time.textContent = formatTime(bm.at);
        content.append(txt, time);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'bm-remove-bookmark';
        remove.title = '取消书签';
        remove.setAttribute('aria-label', '取消书签');
        remove.innerHTML = '<span class="bookmark-context-icon i-bookmark-context-filled"></span>';
        remove.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeBookmarks([bm.id], false);
        });
        row.append(pg, content, remove);
        row.addEventListener('click', (event) => {
          selectRow(event, bm);
          if (!view || event.shiftKey || event.metaKey || event.ctrlKey) return;
          view.pdfView.gotoPage(bm.page);
          view.textView.scrollToPage(bm.page);
        });
        body.appendChild(row);
      }
    }

    listen(body, 'keydown', (event) => {
      if (!['Delete', 'Backspace'].includes(event.key) || !selectedIds.size) return;
      event.preventDefault();
      removeBookmarks([...selectedIds], selectedIds.size > 1);
    });
    listen(body, 'pointerdown', (event) => {
      if (event.button !== 0 || event.target !== body) return;
      const base = (event.metaKey || event.ctrlKey) ? new Set(selectedIds) : new Set();
      selectedIds = new Set(base);
      selectionAnchorId = null;
      const box = document.createElement('div');
      box.className = 'bm-marquee';
      document.body.appendChild(box);
      marquee = { startX: event.clientX, startY: event.clientY, base, box };
      event.preventDefault();
    });
    listen(document, 'pointermove', (event) => {
      if (!marquee) return;
      const left = Math.min(marquee.startX, event.clientX);
      const top = Math.min(marquee.startY, event.clientY);
      const right = Math.max(marquee.startX, event.clientX);
      const bottom = Math.max(marquee.startY, event.clientY);
      Object.assign(marquee.box.style, {
        left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px',
      });
      selectedIds = new Set(marquee.base);
      body.querySelectorAll('.bm-item').forEach((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) selectedIds.add(row.dataset.id);
        row.classList.toggle('selected', selectedIds.has(row.dataset.id));
      });
      const multi = body.querySelector('.bm-multi');
      if (multi) {
        multi.hidden = selectedIds.size < 2;
        multi.querySelector('span').textContent = '已选 ' + selectedIds.size + ' 个';
      }
    });
    listen(document, 'pointerup', () => {
      if (!marquee) return;
      marquee.box.remove();
      marquee = null;
      if (selectedIds.size === 1) selectionAnchorId = [...selectedIds][0];
    });
    const offSwitch = ctx.bus.on('book:switch', () => {
      selectedIds.clear();
      selectionAnchorId = null;
      if (!body.hidden) renderList();
    });
    const offContentChange = ctx.bus.on('book:content-change', () => {
      if (!body.hidden) renderList();
    });

    return () => {
      controller.abort();
      offSwitch();
      offContentChange();
      marquee?.box.remove();
      removeContextAction();
      removeTab();
      body.remove();
    };
  },
});
