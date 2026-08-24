/* 插件：全文搜索 —— 工具栏搜索框 + 命中高亮 + 上/下跳转 */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'search',
  name: '全文搜索',
  version: '1.0.0',
  description: '当前书全文搜索：命中高亮、上一个/下一个跳转',
  activate(ctx) {
    const wrap = document.createElement('div');
    wrap.id = 'search-wrap';
    const input = document.createElement('input');
    input.id = 'search-input';
    input.type = 'search';
    input.placeholder = '搜索正文…';
    input.autocomplete = 'off';
    const info = document.createElement('span');
    info.id = 'search-info';
    const prev = document.createElement('button');
    prev.className = 'mini'; prev.textContent = '▲'; prev.title = '上一个';
    const next = document.createElement('button');
    next.className = 'mini'; next.textContent = '▼'; next.title = '下一个';
    wrap.append(input, info, prev, next);
    ctx.ui.addToolbarWidget({ id: 'search', el: wrap });

    let matches = [];
    let idx = -1;

    const clear = () => {
      document.querySelectorAll('.text-content mark.hit').forEach((m) => {
        const p = m.parentNode;
        p.replaceChild(document.createTextNode(m.textContent), m);
        p.normalize();
      });
      document.querySelectorAll('#home-table .ht-row').forEach((row) => { row.style.display = ''; });
      matches = [];
      idx = -1;
      info.textContent = '';
    };

    const searchHome = (q) => {
      // 首页模式：过滤书库（元数据匹配：书名/作者/出版社/版次/ISBN/文件名/文件夹名）
      const ql = q.toLowerCase();
      let n = 0;
      document.querySelectorAll('#home-table .ht-row').forEach((row) => {
        const book = ctx.state && ctx.state.books.find((b) => b.id === row.dataset.id);
        let hit = false;
        if (book && ql) {
          const folder = (ctx.state.folders || []).find((f) => f.id === book.folderId);
          const hay = [book.meta.title, book.meta.author, book.meta.publisher,
            book.meta.edition, book.meta.isbn, book.s2eName, folder && folder.name]
            .filter(Boolean).join(' ').toLowerCase();
          hit = hay.includes(ql);
        }
        row.style.display = hit ? '' : 'none';
        if (hit) n++;
      });
      info.textContent = ql ? n + ' 本' : '';
      if (!ql) document.getElementById('home-empty') && (document.getElementById('home-empty').hidden = ctx.state.books.length === 0);
    };

    const isHome = () => ctx.state && ctx.state.activeBookId === null;

    const doSearch = (q) => {
      clear();
      if (!q) { if (isHome()) ctx.bus.emit('search:home', ''); return; }
      if (isHome()) { searchHome(q); return; }
      const view = ctx.getView && ctx.getView();
      const holder = view && view.textView.holder;
      if (!holder) return;
      const ql = q.toLowerCase();
      const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const i = node.textContent.toLowerCase().indexOf(ql);
        if (i < 0) continue;
        const mark = document.createElement('mark');
        mark.className = 'hit';
        const after = node.splitText(i);
        after.data = after.data.substring(q.length);
        mark.textContent = q;
        node.parentNode.insertBefore(mark, after);
        matches.push(mark);
      }
      info.textContent = matches.length ? matches.length + ' 处' : '无结果';
      jump(0);
    };

    const jump = (rel) => {
      if (!matches.length) return;
      idx = (idx + rel + matches.length) % matches.length;
      const m = matches[idx];
      document.querySelectorAll('mark.hit.current').forEach((x) => x.classList.remove('current'));
      m.classList.add('current');
      m.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    input.addEventListener('input', () => doSearch(input.value.trim()));
    next.addEventListener('click', () => jump(1));
    prev.addEventListener('click', () => jump(-1));
  },
});
