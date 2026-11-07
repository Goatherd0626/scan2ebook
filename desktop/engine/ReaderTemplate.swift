// 复用本仓库 MIT 许可的现有转换 prompt 与独立 HTML 阅读模板；运行时无外部资源。
import Foundation

let userPrompt = #"""
把这一页扫描书籍整理成结构化 JSON。必须只输出一个 JSON 对象，禁止输出任何其他文字或 Markdown。
格式：{"page_kind":"cover|title|copyright|toc|body|blank|other","items":[{"type":"heading|body|footnote|figure|table|header","level":1或2或3(仅heading),"number":"标题印刷编号如 1.1.1 / 第一章(仅heading),"index":脚注序号(仅footnote),"text":"内容(仅heading/body/footnote)"}],"toc":[{"number":"编号","text":"标题文字","level":1或2或3,"printed_page":目录标注页码(数字,无则0)}]}
步骤：
1. 先判断本页类型 page_kind：cover=封面，title=书名页，copyright=版权页，toc=目录页，body=正文页，blank=空白页，other=其他。
2. 若是 toc：提取 "toc" 数组（每行一条，含目录标注的页码 printed_page），items 输出空数组。
3. 若是 cover / copyright / blank：items 输出空数组。
4. 若是 body / title / other：按下列规则输出 items：
- 正文按自然段拆分，每个自然段为一个 body 项；标题用 heading 并给出 level 与 number；脚注用 footnote。
- 页面顶部重复出现的书名、章名或作者名属于 header，不是 heading；页眉即使加粗或字号较大也输出 header。
- 照片、插图、图表、地图等在原阅读位置输出 {"type":"figure"}。
- 表格在原阅读位置输出 {"type":"table"}。
- figure/table 禁止包含任何其他键，不描述图片内容，不转录表格内容。
- header 仅供程序识别并丢弃；页脚和页码仍直接忽略。
- items 的数量与顺序由本页实际内容决定，按阅读顺序排列；脚注项统一放在 items 的最后。
- 正文中的脚注引用标记（①、1、* 等）原地改写为 [序号]，例如：市场格局[1]。
- 页脚、页码一律不要输出。
- 一段文字若跨页，text 写到此页末尾即可，不要自行续写。
- 脚注 text 以内容开头，不要包含脚注标记本身。
OCR 文本仅供参考（以图像为准）：
__OCR__
"""#

let retryPrompt = #"""
上次输出无法解析。严格按照上述完整格式和规则重试：只输出一个合法 JSON 对象，不要输出解释、Markdown 或代码围栏。
"""#

let readerTemplate = #"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root {
  --font-size: 18px; --line-h: 1.9; --max-width: 46rem;
  --bg: #faf9f7; --fg: #26221c; --muted: #8a8377; --accent: #b45309;
  --card: #ffffff; --border: #e7e2d9; --banner-bg: #fff7d6; --banner-fg: #8a6d1a;
  --mark-bg: #ffe27a; --toc-w: 17rem;
}
body.dark {
  --bg: #1c1a17; --fg: #e8e2d8; --muted: #9a9183; --accent: #f0b429;
  --card: #26221c; --border: #3a342b; --banner-bg: #3d3214; --banner-fg: #e8c96a;
  --mark-bg: #6b5414;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font-family: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  font-size: var(--font-size); line-height: var(--line-h); }
#topbar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 12px;
  padding: 10px 20px; background: var(--card); border-bottom: 1px solid var(--border);
  font-family: -apple-system, "PingFang SC", sans-serif; flex-wrap: wrap; }
#topbar .title { font-weight: 700; font-size: 1.05em; margin-right: auto; }
#topbar button { cursor: pointer; border: 1px solid var(--border); background: var(--bg);
  color: var(--fg); border-radius: 6px; padding: 4px 10px; font-size: 13px; }
#topbar input { border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  border-radius: 6px; padding: 5px 10px; width: 220px; font-size: 13px; }
#layout { display: flex; }
#toc { width: var(--toc-w); flex: 0 0 var(--toc-w); position: sticky; top: 52px; align-self: flex-start;
  max-height: calc(100vh - 52px); overflow: auto; padding: 16px 12px; font-size: 14px;
  font-family: -apple-system, "PingFang SC", sans-serif; border-right: 1px solid var(--border); }
#toc .toc-item { display: block; padding: 3px 6px; border-radius: 5px; color: var(--fg);
  text-decoration: none; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#toc .toc-item:hover { background: var(--border); }
#toc .toc-item.l1 { font-weight: 700; margin-top: 6px; }
#toc .toc-item.l2 { padding-left: 22px; }
#toc .toc-item.l3 { padding-left: 38px; color: var(--muted); }
#toc .toc-page { color: var(--muted); font-size: 12px; margin-left: 6px; }
main { flex: 1; min-width: 0; padding: 28px 34px 120px; }
#reader { max-width: var(--max-width); margin: 0 auto; }
.page-banner { text-align: center; margin: 26px 0 18px; }
.page-banner span { display: inline-block; background: var(--banner-bg); color: var(--banner-fg);
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 16px; font-size: 0.8em;
  font-family: -apple-system, "PingFang SC", sans-serif; letter-spacing: 1px; }
h1.book { font-size: 1.6em; text-align: center; margin: 0 0 6px; }
.meta { text-align: center; color: var(--muted); font-size: 0.9em; margin-bottom: 30px; }
.heading { scroll-margin-top: 60px; }
.heading .num { color: var(--muted); font-weight: 400; margin-right: 8px; }
.body { margin: 0 0 1.1em; text-align: justify; }
.body._continued::before { content: "（续上页）"; color: var(--muted); font-size: 0.8em; margin-right: 8px; }
sup.fnref { color: var(--accent); font-weight: 700; cursor: pointer; margin: 0 2px; font-size: 0.72em; }
mark.hit { background: var(--mark-bg); color: inherit; border-radius: 3px; padding: 0 2px; }
#popover { position: fixed; z-index: 100; display: none; max-width: 26rem; background: var(--card);
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; font-size: 0.85em;
  box-shadow: 0 8px 30px rgba(0,0,0,.18); }
#popover .fn-head { font-family: -apple-system, "PingFang SC", sans-serif; font-size: 12px;
  color: var(--muted); margin-bottom: 4px; }
#copybar { position: fixed; z-index: 90; display: none; background: var(--accent); color: #fff;
  border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,.25); font-family: -apple-system, "PingFang SC", sans-serif; }
@media (max-width: 900px) { #toc { display: none; } }
</style>
</head>
<body>
<div id="topbar">
  <span class="title">__TITLE__</span>
  <button id="font-minus">A−</button>
  <button id="font-plus">A＋</button>
  <button id="dark-toggle">🌙</button>
  <input id="search" type="search" placeholder="搜索正文…">
  <span id="search-info" style="font-size:12px;color:var(--muted)"></span>
</div>
<div id="layout">
  <nav id="toc"></nav>
  <main><div id="reader"></div></main>
</div>
<div id="popover"></div>
<button id="copybar"></button>
<script>
const BOOK = __BOOK_JSON__;

const reader = document.getElementById('reader');
const tocEl = document.getElementById('toc');
const popover = document.getElementById('popover');
const copybar = document.getElementById('copybar');

/* ---------- 目录（优先用书级 TOC，回退到正文标题） ---------- */
function renderTOC() {
  const toc = BOOK.toc && BOOK.toc.length ? BOOK.toc : null;
  if (toc) {
    for (const e of toc) {
      const a = document.createElement('a');
      a.className = 'toc-item l' + (e.level || 2);
      a.textContent = (e.number ? e.number + ' ' : '') + e.text;
      if (e.pdf_page) {
        a.href = '#p' + e.pdf_page;
        a.addEventListener('click', () => { document.getElementById('p' + e.pdf_page).scrollIntoView({behavior:'smooth'}); });
        const sp = document.createElement('span');
        sp.className = 'toc-page'; sp.textContent = 'P' + e.pdf_page;
        a.appendChild(sp);
      } else {
        a.style.opacity = '0.5'; a.style.cursor = 'default';
        a.title = '未匹配到正文标题';
      }
      tocEl.appendChild(a);
    }
    return;
  }
  for (const pg of BOOK.pages) for (const it of pg.items) {
    if (it.type !== 'heading') continue;
    const a = document.createElement('a');
    a.className = 'toc-item l' + (it.level || 2);
    a.href = '#p' + pg.pdf_page;
    a.textContent = (it.number ? it.number + ' ' : '') + it.text;
    const sp = document.createElement('span');
    sp.className = 'toc-page'; sp.textContent = 'P' + pg.pdf_page;
    a.appendChild(sp);
    a.addEventListener('click', () => { document.getElementById('p' + pg.pdf_page).scrollIntoView({behavior:'smooth'}); });
    tocEl.appendChild(a);
  }
}

/* ---------- 正文 ---------- */
const HIDE_KINDS = new Set(['cover', 'copyright', 'blank', 'toc']);
function renderPages() {
  const meta = BOOK.metadata || {};
  const h1 = document.createElement('h1');
  h1.className = 'book'; h1.textContent = meta.title || '';
  reader.appendChild(h1);
  const mdiv = document.createElement('div');
  mdiv.className = 'meta';
  mdiv.textContent = [meta.author, meta.publisher, meta.edition, meta.isbn].filter(Boolean).join(' · ');
  reader.appendChild(mdiv);

  for (const pg of BOOK.pages) {
    if (HIDE_KINDS.has(pg.page_kind)) continue;  // 封面/版权/空白/目录页不渲染
    if (!pg.items || pg.items.length === 0) continue;  // 空页（含分册页夹页）不渲染
    const anchor = document.createElement('div');
    anchor.id = 'p' + pg.pdf_page;
    reader.appendChild(anchor);

    const banner = document.createElement('div');
    banner.className = 'page-banner';
    const sp = document.createElement('span');
    sp.textContent = 'PDF 第 ' + pg.pdf_page + ' 页';
    banner.appendChild(sp);
    anchor.appendChild(banner);

    for (const it of pg.items) {
      if (it.type === 'heading') {
        const h = document.createElement('h' + Math.min(4, (it.level||2)+1));
        h.className = 'heading';
        if (it.number) { const n = document.createElement('span'); n.className='num'; n.textContent = it.number; h.appendChild(n); }
        h.appendChild(document.createTextNode(it.text));
        anchor.appendChild(h);
      } else if (it.type === 'body') {
        const p = document.createElement('p');
        p.className = 'body' + (it._continued ? ' _continued' : '');
        p.dataset.page = pg.pdf_page;
        renderBody(p, it.text);
        anchor.appendChild(p);
      }
    }
  }
}
function renderBody(p, text) {
  const parts = text.split(/⟦(\d+)⟧/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const g = parseInt(parts[i], 10);
      const sup = document.createElement('sup');
      sup.className = 'fnref'; sup.dataset.g = g; sup.textContent = g;
      sup.addEventListener('click', (e) => showFn(g, e));
      p.appendChild(sup);
    } else if (parts[i]) {
      p.appendChild(document.createTextNode(parts[i]));
    }
  }
}

/* ---------- 脚注弹窗 ---------- */
let activeFn = null;
function showFn(g, e) {
  const fn = BOOK.footnotes[g];
  if (!fn) return;
  popover.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'fn-head';
  head.textContent = '脚注 ' + g + ' · PDF 第 ' + fn.page + ' 页';
  const body = document.createElement('div');
  body.textContent = fn.text;
  popover.appendChild(head); popover.appendChild(body);
  const r = e.target.getBoundingClientRect();
  popover.style.display = 'block';
  popover.style.left = Math.min(r.left, innerWidth - 420) + 'px';
  popover.style.top = (r.bottom + 8) + 'px';
  activeFn = g;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.fnref') && !e.target.closest('#popover')) popover.style.display = 'none';
});

/* ---------- 搜索 ---------- */
function highlightMatches(query) {
  document.querySelectorAll('mark.hit').forEach(m => {
    const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
  });
  if (!query) { document.getElementById('search-info').textContent = ''; return; }
  const q = query.toLowerCase(); let count = 0, firstEl = null;
  const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const idx = node.textContent.toLowerCase().indexOf(q);
    if (idx < 0) continue;
    const mark = document.createElement('mark');
    mark.className = 'hit';
    const after = node.splitText(idx);
    after.data = after.data.substring(query.length);
    mark.textContent = node.data.substring(idx, idx + query.length);
    node.data = node.data.substring(0, idx);
    node.parentNode.insertBefore(mark, after);
    count++;
    if (!firstEl) firstEl = mark;
    walker.currentNode = after;
  }
  const info = document.getElementById('search-info');
  info.textContent = count ? count + ' 处' : '无结果';
  if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
document.getElementById('search').addEventListener('input', e => highlightMatches(e.target.value.trim()));

/* ---------- 复制引文（含页码） ---------- */
document.addEventListener('mouseup', (e) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { copybar.style.display = 'none'; return; }
  const anchor = sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('[data-page]');
  const page = anchor ? anchor.dataset.page : null;
  if (!page) { copybar.style.display = 'none'; return; }
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (!text) { copybar.style.display = 'none'; return; }
  copybar.textContent = '📋 复制引文（PDF 第 ' + page + ' 页）';
  copybar.style.display = 'block';
  const r = sel.getRangeAt(0).getBoundingClientRect();
  copybar.style.left = (r.left + r.width / 2 - 90) + 'px';
  copybar.style.top = (r.bottom + 10) + 'px';
  copybar.onclick = () => {
    const title = (BOOK.metadata && BOOK.metadata.title) || '';
    const txt = '「' + text + '」——' + (title ? title + '，' : '') + 'PDF 第 ' + page + ' 页';
    navigator.clipboard.writeText(txt).then(() => {
      copybar.textContent = '✅ 已复制'; setTimeout(() => copybar.style.display = 'none', 1200);
    });
  };
});
document.addEventListener('mousedown', () => setTimeout(() => copybar.style.display = 'none', 300));

/* ---------- 字号 / 深色 ---------- */
const rootStyle = document.documentElement.style;
const savedSize = localStorage.getItem('s2e-size');
if (savedSize) rootStyle.setProperty('--font-size', savedSize + 'px');
document.getElementById('font-plus').onclick = () => {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) || 18;
  const next = Math.min(28, cur + 1); rootStyle.setProperty('--font-size', next + 'px'); localStorage.setItem('s2e-size', next);
};
document.getElementById('font-minus').onclick = () => {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) || 18;
  const next = Math.max(12, cur - 1); rootStyle.setProperty('--font-size', next + 'px'); localStorage.setItem('s2e-size', next);
};
if (localStorage.getItem('s2e-dark') === '1') document.body.classList.add('dark');
document.getElementById('dark-toggle').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('s2e-dark', document.body.classList.contains('dark') ? '1' : '0');
};

renderTOC();
renderPages();
</script>
</body>
</html>

"""#
