/* 插件：搜索 —— 场景自适应 + 结果弹窗（Spotlight 式）
   - 打开书：搜索正文命中位置，弹窗列表，▲▼/Enter 跳转，无结果提示
   - 首页：过滤书库表格 + 弹窗列出匹配书籍（元数据），点击/Enter 打开
   - 输入框右侧不再内嵌计数/按钮，全部移入弹窗 */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'search',
  name: '搜索',
  version: '1.1.0',
  description: '打开书时搜正文、首页时搜书库元数据；结果弹窗列表，▲▼/Enter 跳转',
  activate(ctx) {
    /* ---- 输入框（仅输入，无内嵌按钮） ---- */
    const wrap = document.createElement('div');
    wrap.id = 'search-wrap';
    const input = document.createElement('input');
    input.id = 'search-input';
    input.type = 'search';
    input.placeholder = '搜索书库…';
    input.autocomplete = 'off';
    wrap.appendChild(input);
    ctx.ui.addToolbarWidget({ id: 'search', el: wrap });

    /* 占位提示随场景切换：首页=书库，开书=正文 */
    const updatePlaceholder = () => {
      input.placeholder = isHome() ? '搜索书库…' : '搜索正文…';
    };

    /* ---- 结果弹窗 ---- */
    const drop = document.createElement('div');
    drop.id = 'search-drop';
    drop.hidden = true;
    document.body.appendChild(drop);

    let results = [];      // { kind:'book'|'text', snippet, el?, book?, page? }
    let idx = -1;
    let query = '';

    const isHome = () => ctx.state && ctx.state.activeBookId === null;

    function clearTextMarks() {
      document.querySelectorAll('.text-content mark.hit').forEach((m) => {
        const p = m.parentNode;
        p.replaceChild(document.createTextNode(m.textContent), m);
        p.normalize();
      });
    }
    function resetTable() {
      document.querySelectorAll('#home-table .ht-row').forEach((row) => { row.style.display = ''; });
    }
    function close() { drop.hidden = true; }

    function position() {
      const r = input.getBoundingClientRect();
      const maxX = (typeof innerWidth === 'number' ? innerWidth : 1200) - 340;
      drop.style.left = Math.max(8, Math.min(r.left, maxX)) + 'px';
      drop.style.top = (r.bottom + 6) + 'px';
    }

    function highlightSnippet(text, q) {
      const i = (text || '').toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return escapeHtml(text || '');
      return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>'
        + escapeHtml(text.slice(i + q.length));
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /* ---- 首页：过滤表格 + 收集匹配书籍 ---- */
    function homeResults(q) {
      resetTable();
      const ql = q.toLowerCase();
      if (!ql) return [];
      const out = [];
      for (const book of ctx.state.books || []) {
        const folder = (ctx.state.folders || []).find((f) => f.id === book.folderId);
        const fields = [
          { k: '书名', v: book.meta.title },
          { k: '作者', v: book.meta.author },
          { k: '出版社', v: book.meta.publisher },
          { k: '版次', v: book.meta.edition },
          { k: 'ISBN', v: book.meta.isbn },
          { k: '文件', v: book.s2eName },
          { k: '文件夹', v: folder && folder.name },
        ].filter((f) => f.v);
        const hit = ql && fields.some((f) => f.v.toLowerCase().includes(ql));
        const row = document.querySelector(`#home-table .ht-row[data-id="${book.id}"]`);
        if (row) row.style.display = hit ? '' : 'none';
        if (hit) {
          const f = fields.find((f) => f.v.toLowerCase().includes(ql));
          out.push({ kind: 'book', book, snippet: f.k + '：' + f.v, row });
        }
      }
      return out;
    }

    /* ---- 正文：收集命中位置 ---- */
    function textResults(q) {
      const view = ctx.getView && ctx.getView();
      const holder = view && view.textView.holder;
      if (!holder || !q) return [];
      clearTextMarks();
      const ql = q.toLowerCase();
      const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const out = [];
      for (const node of nodes) {
        const i = node.textContent.toLowerCase().indexOf(ql);
        if (i < 0) continue;
        const mark = document.createElement('mark');
        mark.className = 'hit';
        const after = node.splitText(i);
        after.data = after.data.substring(q.length);
        mark.textContent = q;
        node.parentNode.insertBefore(mark, after);
        const para = mark.closest('.body, .heading');
        const anchor = para && para.closest('.page-anchor');
        const page = anchor ? +anchor.dataset.page : '';
        const before = node.data.slice(Math.max(0, i - 18));
        const afterText = after.data.slice(0, 18);
        const snippet = (before ? '…' : '') + before + mark.textContent + afterText + (afterText.length >= 18 ? '…' : '');
        out.push({ kind: 'text', snippet, el: mark, page });
      }
      return out;
    }

    function render() {
      position();
      const n = results.length;
      if (!query) { drop.hidden = true; return; }
      let html = '<div class="sr-head">结果 · ' + n + '</div>';
      if (!n) {
        drop.innerHTML = html + '<div class="sr-empty">无结果</div>';
        drop.hidden = false;
        return;
      }
      html += results.map((r, i) => {
        const title = r.kind === 'book'
          ? (r.book.meta.title || r.book.s2eName) + (r.book.meta.author ? ' · ' + r.book.meta.author : '')
          : 'PDF 第 ' + r.page + ' 页';
        return `<div class="sr-item${i === idx ? ' current' : ''}" data-i="${i}">
          <span class="sr-idx">${i + 1}</span>
          <span class="sr-snippet">${escapeHtml(title)}<span class="sr-sub">${highlightSnippet(r.snippet, query)}</span></span>
        </div>`;
      }).join('');
      drop.innerHTML = html;
      drop.hidden = false;
      drop.querySelectorAll('.sr-item').forEach((item) => {
        item.addEventListener('click', () => { idx = +item.dataset.i; activate(idx, true); });
      });
    }

    function activate(i, byClick) {
      idx = (i + results.length) % results.length;
      render();
      const r = results[idx];
      if (!r) return;
      if (r.kind === 'book') {
        ctx.openBook(r.book.id);   // 首页：打开匹配书籍
      } else {
        document.querySelectorAll('mark.hit.current').forEach((x) => x.classList.remove('current'));
        r.el.classList.add('current');
        r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function run() {
      query = input.value.trim();
      clearTextMarks();
      resetTable();
      results = isHome() ? homeResults(query) : textResults(query);
      idx = -1;
      render();
    }

    input.addEventListener('input', run);
    input.addEventListener('focus', () => { if (query) render(); });
    input.addEventListener('keydown', (e) => {
      if (drop.hidden || !results.length) {
        if (e.key === 'Escape') close();
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); activate(idx + 1, false); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activate(idx - 1, false); }
      else if (e.key === 'Enter') { e.preventDefault(); activate(idx + 1, false); }
      else if (e.key === 'Escape') close();
    });
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#search-wrap') && !e.target.closest('#search-drop')) close();
    });
    ctx.bus.on('book:switch', () => { updatePlaceholder(); if (query) run(); });
    updatePlaceholder();
  },
});
