/* 双视图：PDF 视图 + 文字视图 + 同步/跳转/脚注/双页摊开 */
const HIDE_KINDS = new Set(['cover', 'copyright', 'blank', 'toc']);
const SENT_END = /[。！？!?…."”’』」）\)]$/;

/* 从整本 book.json 构建阅读模型：全局脚注重编号 + 过滤隐藏页 + 跨页续段标记 */
export function buildRenderModel(bookJson) {
  const pages = JSON.parse(JSON.stringify(bookJson.pages || []));
  const fnMap = {};               // (page:index) -> 全局序号
  const footnotes = [null];       // 1 起
  let g = 0;
  for (const pg of pages) {
    for (const it of pg.items) {
      if (it.type === 'footnote') {
        g++;
        const idx = it.index ?? g;
        fnMap[pg.pdf_page + ':' + idx] = g;
        footnotes.push({ id: g, index: idx, text: it.text, page: pg.pdf_page });
      }
    }
  }
  let curPage = 0;
  for (const pg of pages) {
    curPage = pg.pdf_page;
    for (const it of pg.items) {
      if (it.type === 'body') {
        it.text = it.text.replace(/\[(\d+)\]/g, (m, n) => {
          const key = curPage + ':' + n;
          return fnMap[key] ? '⟦' + fnMap[key] + '⟧' : m;
        });
      }
    }
  }
  const shown = pages.filter((p) => !HIDE_KINDS.has(p.page_kind) && p.items && p.items.length > 0);
  for (let i = 1; i < shown.length; i++) {
    const prev = shown[i - 1].items, cur = shown[i].items;
    const last = prev[prev.length - 1], first = cur[0];
    if (last && first && last.type === 'body' && first.type === 'body'
        && !SENT_END.test(last.text.trimEnd()) && first.text.length >= 6) {
      first._continued = true;
    }
  }
  return { pages: shown, footnotes, toc: bookJson.toc || [] };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* ============================ PDF 视图 ============================ */
export class PdfView {
  constructor(panel) {
    this.panel = panel;
    this.holder = panel.querySelector('.pdf-holder');
    this.pdf = null;
    this.pageEls = new Map();
    this.currentPage = 0;
    this.onPageChange = null;
    this._io = null;
    this._pageObs = null;
  }

  async load(pdfDoc) {
    this.pdf = pdfDoc;
    this.holder.innerHTML = '';
    this.pageEls.clear();
    this.currentPage = 0;
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const wrap = el('div', 'pdf-page');
      wrap.dataset.page = i;
      this.holder.appendChild(wrap);
      this.pageEls.set(i, wrap);
    }
    this._observe();
    this.gotoPage(1);
  }

  _observe() {
    this._io?.disconnect();
    this._pageObs?.disconnect();
    this._io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && !en.target.dataset.rendered) this._renderPage(+en.target.dataset.page);
      }
    }, { root: this.panel, rootMargin: '900px' });
    this._pageObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && en.intersectionRatio >= 0.2) this._setCurrent(+en.target.dataset.page);
      }
    }, { root: this.panel, threshold: [0.2, 0.4, 0.6, 0.8] });
    this.pageEls.forEach((w) => { this._io.observe(w); this._pageObs.observe(w); });
  }

  async _renderPage(n) {
    const wrap = this.pageEls.get(n);
    if (!wrap || wrap.dataset.rendered) return;
    wrap.dataset.rendered = '1';
    try {
      const page = await this.pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const panelW = Math.max(this.panel.clientWidth - 24, 200);
      const scale = Math.min((panelW - 8) / vp1.width, 3);
      const viewport = page.getViewport({ scale });
      const canvas = el('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      wrap.appendChild(canvas);
      wrap.appendChild(el('div', 'pg-label', 'PDF 第 ' + n + ' 页'));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch (e) { /* 单页渲染失败忽略 */ }
  }

  _setCurrent(n) {
    if (n === this.currentPage) return;
    this.pageEls.get(this.currentPage)?.classList.remove('current');
    this.currentPage = n;
    this.pageEls.get(n)?.classList.add('current');
    this.onPageChange?.(n);
  }

  gotoPage(n) {
    if (!this.pdf) return;
    n = Math.max(1, Math.min(n, this.pdf.numPages));
    const w = this.pageEls.get(n);
    if (w) {
      this._renderPage(n);
      w.scrollIntoView({ block: 'start' });
      this._setCurrent(n);
    }
  }

  setSpread(on) {
    this.panel.classList.toggle('spread', on);
    // 重新渲染以适配宽度
    this.pageEls.forEach((w, n) => { delete w.dataset.rendered; w.innerHTML = ''; });
    this._io?.disconnect(); this._pageObs?.disconnect();
    this.pageEls.forEach((w) => { this._io.observe(w); this._pageObs.observe(w); });
    this.gotoPage(this.currentPage || 1);
  }
}

/* ============================ 文字视图 ============================ */
export class TextView {
  constructor(panel) {
    this.panel = panel;
    this.holder = panel.querySelector('.text-content');
    this.model = null;
    this.pageAnchors = new Map();
    this.itemEls = new Map();       // page:itemIdx -> element
    this.currentPage = 0;
    this.onPageChange = null;
    this.onScroll = null;
    this._scrollT = null;
    panel.addEventListener('scroll', () => {
      clearTimeout(this._scrollT);
      this._scrollT = setTimeout(() => this._updatePageFromScroll(), 60);
    });
  }

  load(model, meta) {
    this.model = model;
    this.holder.innerHTML = '';
    this.pageAnchors.clear();
    this.itemEls.clear();
    this.currentPage = 0;
    const h1 = el('h1', 'book', meta.title || '');
    this.holder.appendChild(h1);
    const md = el('div', 'meta', [meta.author, meta.publisher, meta.edition, meta.isbn].filter(Boolean).join(' · '));
    this.holder.appendChild(md);

    const referenced = new Set();
    for (const pg of model.pages) {
      const banner = el('div', 'page-banner');
      banner.appendChild(el('span', null, 'PDF 第 ' + pg.pdf_page + ' 页'));
      this.holder.appendChild(banner);
      const anchor = el('div', 'page-anchor');
      anchor.dataset.page = pg.pdf_page;
      this.holder.appendChild(anchor);
      this.pageAnchors.set(pg.pdf_page, anchor);
      pg.items.forEach((it, idx) => {
        this.itemEls.set(pg.pdf_page + ':' + idx, null);
        if (it.type === 'heading') {
          const h = el('h' + Math.min(4, (it.level || 2) + 1), 'heading');
          if (it.number) h.appendChild(el('span', 'num', it.number));
          h.appendChild(document.createTextNode(it.text));
          anchor.appendChild(h);
          this.itemEls.set(pg.pdf_page + ':' + idx, h);
        } else if (it.type === 'body') {
          const p = el('p', 'body' + (it._continued ? ' _continued' : ''));
          p.dataset.page = pg.pdf_page;
          this._renderBody(p, it.text, referenced);
          anchor.appendChild(p);
          this.itemEls.set(pg.pdf_page + ':' + idx, p);
        }
      });
      // 本页未被正文引用的脚注（孤儿脚注）页末小字展示
      const orphans = model.footnotes.filter((f) => f && f.page === pg.pdf_page && !referenced.has(f.id));
      if (orphans.length) {
        const od = el('div', 'fn-orphan');
        orphans.forEach((f) => od.appendChild(el('div', null, '[' + f.id + '] ' + f.text)));
        anchor.appendChild(od);
      }
    }
    this.holder.querySelectorAll('.page-anchor').forEach(() => { /* noop */ });
  }

  _renderBody(p, text, referenced) {
    const parts = text.split(/⟦(\d+)⟧/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const g = +parts[i];
        referenced.add(g);
        const sup = el('sup', 'fnref');
        sup.dataset.g = g;
        sup.textContent = g;
        this._bindFn(sup, g);
        p.appendChild(sup);
      } else if (parts[i]) {
        p.appendChild(document.createTextNode(parts[i]));
      }
    }
  }

  _bindFn(sup, g) {
    const tip = document.getElementById('fn-tooltip');
    sup.addEventListener('mouseenter', () => {
      const fn = this.model.footnotes[g];
      if (!fn) return;
      tip.innerHTML = '';
      tip.appendChild(el('div', 'fn-head', '脚注 ' + g + ' · PDF 第 ' + fn.page + ' 页'));
      tip.appendChild(el('div', null, fn.text));
      tip.style.display = 'block';
      const r = sup.getBoundingClientRect();
      tip.style.left = Math.min(r.left, innerWidth - 340) + 'px';
      tip.style.top = (r.bottom + 8) + 'px';
    });
    sup.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    sup.addEventListener('click', () => {
      const fn = this.model.footnotes[g];
      if (!fn) return;
      const next = sup.nextElementSibling;
      if (next && next.classList.contains('fn-inline')) { next.remove(); sup.classList.remove('open'); return; }
      sup.after(el('span', 'fn-inline', '（' + fn.text + '）'));
      sup.classList.add('open');
    });
  }

  _updatePageFromScroll() {
    const st = this.panel.scrollTop;
    let cur = 0;
    for (const [page, anchor] of this.pageAnchors) {
      const top = anchor.getBoundingClientRect().top + st - 90;
      if (top <= st + 40) cur = page; else break;
    }
    if (!cur && this.model.pages.length) cur = this.model.pages[0].pdf_page;
    if (cur !== this.currentPage) { this.currentPage = cur; this.onPageChange?.(cur); }
    this.onScroll?.(cur);
  }

  scrollToPage(n) {
    const a = this.pageAnchors.get(n);
    if (!a) return;
    const st = this.panel.scrollTop;
    this.panel.scrollTo({ top: a.getBoundingClientRect().top + st - 70, behavior: 'smooth' });
  }

  scrollToItem(page, idx) {
    const e = this.itemEls.get(page + ':' + idx);
    if (!e) return;
    const st = this.panel.scrollTop;
    this.panel.scrollTo({ top: e.getBoundingClientRect().top + st - 70, behavior: 'smooth' });
  }
}
