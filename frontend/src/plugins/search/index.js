/* 插件：搜索（VS Code 查找框风格）
   - 浮动查找条： [输入框 | 1 of N | ▲ ▼ | ≡结果列表 | ×关闭]
   - 打开书：正文命中高亮 + Enter/▲▼ 循环跳转（Shift+Enter 上一个）
   - 首页：过滤书库表格 + 计数，Enter 打开下一本匹配
   - ≡ 展开/收起结果列表弹窗（可选视图）
   - 入口：顶栏放大镜按钮 / Cmd+F / F3 */

import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'search',
  name: '搜索',
  version: '1.3.0',
  description: '顶栏搜索框 + VS Code 式浮动控件条：正文搜索/书库元数据搜索',
  activate(ctx) {
    const controller = new window.AbortController();
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: controller.signal });

    /* ---------- 顶栏输入框（点击即可输入） ---------- */
    const wrap = document.createElement('div');
    wrap.id = 'search-wrap';
    const input = document.createElement('input');
    input.id = 'search-input';
    input.type = 'search';
    input.placeholder = '搜索书库…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', '搜索书库或正文');
    const searchIcon = document.createElement('span');
    searchIcon.className = 'sf i-search';
    searchIcon.setAttribute('aria-hidden', 'true');
    wrap.append(searchIcon, input);
    const removeToolbar = ctx.ui.addToolbarWidget({ id: 'search', el: wrap });

    /* ---------- 浮动控件条（VS Code 布局，输入框下方右上角） ---------- */
    const strip = document.createElement('div');
    strip.id = 'find-strip';
    strip.hidden = true;
    strip.innerHTML = `
      <span id="find-count"></span>
      <button class="fb-btn" data-act="prev" title="上一个 (Shift+Enter)" aria-label="上一个"><span class="sf i-up"></span></button>
      <button class="fb-btn" data-act="next" title="下一个 (Enter)" aria-label="下一个"><span class="sf i-down"></span></button>
      <button class="fb-btn" data-act="list" title="结果列表" aria-label="结果列表"><span class="sf i-list" aria-hidden="true"></span></button>
      <button class="fb-btn" data-act="close" title="清除并关闭 (Esc)" aria-label="清除并关闭"><span class="sf i-xmark" aria-hidden="true"></span></button>`;
    document.body.appendChild(strip);

    /* ---------- 结果列表弹窗（≡ 展开） ---------- */
    const drop = document.createElement('div');
    drop.id = 'search-drop';
    drop.hidden = true;
    document.body.appendChild(drop);

    const countEl = strip.querySelector('#find-count');
    let results = [];
    let idx = -1;
    let query = '';
    let listOpen = false;

    const isHome = () => ctx.state && ctx.state.activeBookId === null;
    const updatePlaceholder = () => { input.placeholder = isHome() ? '搜索书库…' : '搜索正文…'; };

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function highlightSnippet(text, q) {
      const i = (text || '').toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return escapeHtml(text || '');
      return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>'
        + escapeHtml(text.slice(i + q.length));
    }
    function clearTextMarks() {
      document.querySelectorAll('.text-content mark.hit').forEach((m) => {
        const p = m.parentNode;
        p.replaceChild(document.createTextNode(m.textContent), m);
        p.normalize();
      });
    }
    function resetTable() {
      document.querySelectorAll('#home-table .ht-row, #home-table .ht-folder-row').forEach((row) => {
        row.style.display = '';
        row.hidden = row.dataset.treeHidden === '1';
      });
    }

    /* ---------- 搜索执行 ---------- */
    function homeResults(q) {
      resetTable();
      const ql = q.toLowerCase();
      if (!ql) return [];
      const out = [];
      document.querySelectorAll('#home-table .ht-row, #home-table .ht-folder-row').forEach((row) => {
        row.style.display = 'none';
      });
      for (const book of ctx.state.books || []) {
        const folder = (ctx.state.folders || []).find((f) => f.id === book.folderId);
        const fields = [
          { k: '书名', v: book.meta.title }, { k: '作者', v: book.meta.author },
          { k: '出版社', v: book.meta.publisher }, { k: '版次', v: book.meta.edition },
          { k: 'ISBN', v: book.meta.isbn }, { k: '文件', v: book.s2eName },
          { k: '文件夹', v: folder && folder.name },
        ].filter((f) => f.v);
        const hit = ql && fields.some((f) => f.v.toLowerCase().includes(ql));
        const row = document.querySelector(`#home-table .ht-row[data-id="${book.id}"]`);
        if (row && hit) {
          row.hidden = false;
          row.style.display = '';
          for (const folderId of (row.dataset.folderPath || '').split(',').filter(Boolean)) {
            const folderRow = [...document.querySelectorAll('#home-table .ht-folder-row')]
              .find((item) => item.dataset.folderId === folderId);
            if (folderRow) { folderRow.hidden = false; folderRow.style.display = ''; }
          }
        }
        if (hit) {
          const f = fields.find((f) => f.v.toLowerCase().includes(ql));
          out.push({ kind: 'book', book, snippet: f.k + '：' + f.v });
        }
      }
      return out;
    }

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
        const para = node.parentElement?.closest('.body, .heading, .fn-orphan');
        const anchor = para && para.closest('.page-anchor');
        if (!anchor) continue;
        const text = node.textContent;
        const lower = text.toLowerCase();
        let cursor = 0;
        let matchAt = lower.indexOf(ql, cursor);
        if (matchAt < 0) continue;
        const fragment = document.createDocumentFragment();
        while (matchAt >= 0) {
          if (matchAt > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, matchAt)));
          const matchedText = text.slice(matchAt, matchAt + q.length);
          const mark = document.createElement('mark');
          mark.className = 'hit';
          mark.textContent = matchedText;
          fragment.appendChild(mark);
          const before = text.slice(Math.max(0, matchAt - 18), matchAt);
          const afterStart = matchAt + q.length;
          const afterText = text.slice(afterStart, afterStart + 18);
          out.push({
            kind: 'text', el: mark, page: +anchor.dataset.page,
            snippet: (matchAt > 18 ? '…' : '') + before + matchedText + afterText
              + (afterStart + 18 < text.length ? '…' : ''),
          });
          cursor = afterStart;
          matchAt = lower.indexOf(ql, cursor);
        }
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        node.replaceWith(fragment);
      }
      return out;
    }

    function run() {
      query = input.value.trim();
      clearTextMarks();
      resetTable();
      results = isHome() ? homeResults(query) : textResults(query);
      idx = -1;
      strip.hidden = !query;
      placeStrip();
      updateCount();
      renderList();
    }

    function updateCount() {
      const n = results.length;
      if (!query) { countEl.textContent = ''; return; }
      if (isHome()) { countEl.textContent = n + ' 本'; return; }
      countEl.textContent = n ? (idx >= 0 ? idx + 1 : 1) + ' / ' + n : '0 / 0';
    }

    function jump(i) {
      if (!results.length) return;
      idx = (i + results.length) % results.length;
      const r = results[idx];
      if (isHome()) {
        ctx.openBook(r.book.id);
      } else {
        document.querySelectorAll('mark.hit.current').forEach((x) => x.classList.remove('current'));
        r.el.classList.add('current');
        r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      updateCount();
      renderList();
    }
    const next = () => jump(idx + 1);
    const prev = () => jump(idx - 1);

    /* ---------- 结果列表弹窗 ---------- */
    function renderList() {
      if (!listOpen) return;
      const n = results.length;
      let html = '<div class="sr-head">结果 · ' + n + '</div>';
      if (!query) { drop.hidden = true; return; }
      if (!n) { drop.innerHTML = html + '<div class="sr-empty">无结果</div>'; drop.hidden = false; return; }
      drop.innerHTML = html + results.map((r, i) => {
        const title = r.kind === 'book'
          ? (r.book.meta.title || r.book.s2eName) + (r.book.meta.author ? ' · ' + r.book.meta.author : '')
          : 'PDF 第 ' + r.page + ' 页';
        return `<div class="sr-item${i === idx ? ' current' : ''}" data-i="${i}">
          <span class="sr-idx">${i + 1}</span>
          <span class="sr-snippet">${escapeHtml(title)}<span class="sr-sub">${highlightSnippet(r.snippet, query)}</span></span>
        </div>`;
      }).join('');
      drop.hidden = false;
      const r = strip.getBoundingClientRect();
      const maxX = (typeof innerWidth === 'number' ? innerWidth : 1200) - 360;
      drop.style.left = Math.max(8, Math.min(r.left, maxX)) + 'px';
      drop.style.top = (r.bottom + 8) + 'px';
      drop.querySelectorAll('.sr-item').forEach((item) => {
        item.addEventListener('click', () => {
          idx = +item.dataset.i;
          if (isHome()) ctx.openBook(results[idx].book.id);
          else jump(idx);
        });
      });
    }
    function toggleList() { listOpen = !listOpen; if (listOpen) renderList(); else drop.hidden = true; }

    function clearAll() {
      input.value = ''; query = '';
      clearTextMarks(); resetTable();
      results = []; idx = -1; listOpen = false;
      strip.hidden = true; drop.hidden = true;
      countEl.textContent = '';
    }

    /* ---------- 定位：控件条在输入框正下方，结果列表再往下 ---------- */
    function placeStrip() {
      if (strip.hidden) return;
      const r = input.getBoundingClientRect();
      strip.style.left = Math.max(8, r.left) + 'px';
      strip.style.top = (r.bottom + 6) + 'px';
    }
    listen(window, 'resize', placeStrip);

    /* ---------- 交互 ---------- */
    listen(input, 'input', run);
    listen(input, 'focus', () => { strip.hidden = !query; updatePlaceholder(); });
    listen(input, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (results.length) jump(idx + 1); }
      else if (e.key === 'Escape') { e.preventDefault(); clearAll(); input.blur(); }
    });
    listen(strip.querySelector('[data-act="prev"]'), 'click', prev);
    listen(strip.querySelector('[data-act="next"]'), 'click', next);
    listen(strip.querySelector('[data-act="list"]'), 'click', toggleList);
    listen(strip.querySelector('[data-act="close"]'), 'click', clearAll);
    listen(document, 'mousedown', (e) => {
      if (listOpen && !e.target.closest('#search-drop') && !e.target.closest('#search-wrap') && !e.target.closest('#find-strip')) {
        listOpen = false; drop.hidden = true;
      }
    });
    listen(document, 'keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        // 焦点在右侧标注栏内时打开标注搜索,其余位置打开全局搜索。
        const annInput = document.querySelector('.annotations-sidebar:not([hidden]) .annotations-search-input');
        if (annInput && document.activeElement?.closest('.annotations-sidebar')) {
          annInput.focus();
          annInput.select?.();
        } else {
          input.focus();
          input.select();
        }
      } else if (e.key === 'F3' && query && !strip.hidden) {
        e.preventDefault();
        if (e.shiftKey) prev(); else next();
      } else if (e.key === 'Escape' && query) {
        clearAll();
      }
    });
    const offSwitch = ctx.bus.on('book:switch', () => { updatePlaceholder(); if (query) run(); });
    const offContentChange = ctx.bus.on('book:content-change', () => { if (query) run(); });
    updatePlaceholder();

    return () => {
      controller.abort();
      offSwitch();
      offContentChange();
      clearAll();
      removeToolbar();
      strip.remove();
      drop.remove();
    };
  },
});
