/* 核心渲染引擎：PDF 视图 + 文字视图（含事件钩子，供插件挂接） */
import * as pdfjsLib from 'pdfjs-dist';
import { selectionToAnchor } from './text_anchor.js';

const HIDE_KINDS = new Set(['cover', 'copyright', 'blank', 'toc']);
const SENT_END = /[。！？!?…."”’』」）\)]$/;

/* 从整本 book.json 构建阅读模型：全局脚注重编号 + 过滤隐藏页 + 跨页续段标记。
   正文中的脚注标记保留为 ⟦全局序号⟧，由插件（如 footnotes）渲染为交互上标。 */
export function buildRenderModel(bookJson) {
  const pages = JSON.parse(JSON.stringify(bookJson.pages || []));
  const fnMap = {};
  const footnotes = [null];
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
      last._continues = true;
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
    if (w) { this._renderPage(n); w.scrollIntoView({ block: 'start' }); this._setCurrent(n); }
  }

  setSpread(on) {
    this.panel.classList.toggle('spread', on);
    this.pageEls.forEach((w, n) => { delete w.dataset.rendered; w.innerHTML = ''; });
    this._io?.disconnect(); this._pageObs?.disconnect();
    this.pageEls.forEach((w) => { this._io.observe(w); this._pageObs.observe(w); });
    this.gotoPage(this.currentPage || 1);
  }
}

/* ============================ 文字视图 ============================ */
export class TextView {
  constructor(panel, hooks = {}) {
    this.panel = panel;
    this.holder = panel.querySelector('.text-content');
    this.model = null;
    this.pageAnchors = new Map();
    this.itemEls = new Map();
    this.currentPage = 0;
    this.hooks = hooks;            // { onItemRender, onPageRender, onPageChange, onScroll }
    this._scrollT = null;
    this._hoveredItem = null;
    this._pageHover = null;
    this._pageLabel = null;
    this._sourcePreviewOnHover = false;
    this._eventController = new window.AbortController();
    const eventOptions = { signal: this._eventController.signal };
    panel.addEventListener('scroll', () => {
      clearTimeout(this._scrollT);
      this._scrollT = setTimeout(() => this._updatePageFromScroll(), 100);
    }, eventOptions);
    panel.addEventListener('pointermove', (e) => this._onSourcePointerMove(e), eventOptions);
    panel.addEventListener('pointerleave', () => {
      if (this._sourcePreviewOnHover) this._hideSourceHover();
    }, eventOptions);
    panel.addEventListener('click', (e) => this._onSourceClick(e), eventOptions);
    // 选中文字：交给核心派发给插件注册的上下文操作
    panel.addEventListener('mouseup', (e) => this._onSelection(e), eventOptions);
    document.addEventListener('selectionchange', () => this._onSelectionChange(), eventOptions);
  }

  load(model, meta) {
    this.model = model;
    this.holder.innerHTML = '';
    this.pageAnchors.clear();
    this.itemEls.clear();
    this.currentPage = 0;
    this._hoveredItem = null;
    this._pageHover = el('div', 'page-source-hover');
    this._pageHover.hidden = true;
    this._pageHover.setAttribute('aria-hidden', 'true');
    this._pageLabel = el('div', 'page-source-label');
    this._pageLabel.hidden = true;
    this._pageLabel.setAttribute('aria-hidden', 'true');
    this.holder.append(this._pageHover, this._pageLabel);
    const h1 = el('h1', 'book', meta.title || '');
    this.holder.appendChild(h1);
    const md = el('div', 'meta', [meta.author, meta.publisher, meta.edition, meta.isbn].filter(Boolean).join(' · '));
    this.holder.appendChild(md);

    for (const pg of model.pages) {
      const anchor = el('div', 'page-anchor');
      anchor.dataset.page = pg.pdf_page;
      this.holder.appendChild(anchor);
      this.pageAnchors.set(pg.pdf_page, anchor);
      pg.items.forEach((it, idx) => {
        let node = null;
        if (it.type === 'heading') {
          const h = el('h' + Math.min(4, (it.level || 2) + 1), 'heading');
          if (it.number) h.appendChild(el('span', 'num', it.number));
          h.appendChild(document.createTextNode(it.text));
          anchor.appendChild(h);
          node = h;
        } else if (it.type === 'body') {
          const flags = (it._continued ? ' _continued' : '') + (it._continues ? ' _continues' : '');
          const p = el('p', 'body' + flags);
          const content = el('span', 'item-content');
          content.appendChild(document.createTextNode(it.text));
          p.appendChild(content);
          anchor.appendChild(p);
          if (it._continued && !it._continues) {
            const paragraphBreak = el('span', 'paragraph-break');
            paragraphBreak.setAttribute('aria-hidden', 'true');
            anchor.appendChild(paragraphBreak);
          }
          node = p;
        } else if (it.type === 'figure' || it.type === 'table') {
          const label = it.type === 'figure'
            ? '此处原文有图片 · 点击查看 PDF'
            : '此处原文有表格 · 点击查看 PDF';
          const marker = el('button', 'source-object ' + it.type, label);
          marker.type = 'button';
          marker.dataset.type = it.type;
          marker.dataset.page = pg.pdf_page;
          marker.setAttribute('aria-label', label + '，PDF 第 ' + pg.pdf_page + ' 页');
          marker.addEventListener('click', (event) => {
            if (this._sourcePreviewOnHover) { event.preventDefault(); return; }
            this.hooks.onSourceObject?.({ type: it.type, page: pg.pdf_page });
          });
          anchor.appendChild(marker);
          node = marker;
        }
        if (node) {
          node.classList.add('text-item');
          node.dataset.page = pg.pdf_page;
          node.dataset.item = pg.pdf_page + ':' + idx;
        }
        this.itemEls.set(pg.pdf_page + ':' + idx, node);
        if (node) this.hooks.onItemRender?.({ el: node, item: it, page: pg.pdf_page, model });
      });
      this.hooks.onPageRender?.({ page: pg.pdf_page, anchor, model });
    }
  }

  _onSelection(e) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    this._clearSourceSelection();
    const anchor = selectionToAnchor(sel);
    if (!anchor) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const nativeRange = sel.getRangeAt(0);
    const rect = nativeRange.getClientRects?.()[0] || nativeRange.getBoundingClientRect();
    this.hooks.onSelection?.({
      kind: 'text',
      text,
      quote: anchor.quote,
      range: anchor.range,
      page: anchor.range.start.page,
      rect,
      view: this,
    });
  }

  _onSelectionChange() {
    if (this._hasActiveSelection()) this._clearSourceSelection();
  }

  _hasActiveSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed) return false;
    return [selection.anchorNode, selection.focusNode]
      .some((node) => node && this.panel.contains(node));
  }

  _updatePageFromScroll() {
    if (this._hasActiveSelection()) return;
    const panelRect = this.panel.getBoundingClientRect();
    const focusY = panelRect.top + panelRect.height * 0.35;
    let cur = 0;
    for (const [page, anchor] of this.pageAnchors) {
      const reference = this._pageItems(anchor)[0];
      if (!reference) continue;
      if (reference.getBoundingClientRect().top <= focusY) cur = page; else break;
    }
    if (!cur && this.model.pages.length) cur = this.model.pages[0].pdf_page;
    if (cur !== this.currentPage) { this.currentPage = cur; this.hooks.onPageChange?.(cur); }
    this.hooks.onScroll?.(cur);
  }

  scrollToPage(n) {
    const a = this.pageAnchors.get(n);
    if (!a) return;
    const reference = this._pageItems(a)[0];
    if (!reference) return;
    const st = this.panel.scrollTop;
    this.panel.scrollTo({ top: reference.getBoundingClientRect().top + st - 70, behavior: 'smooth' });
  }

  scrollToItem(page, idx) {
    const e = this.itemEls.get(page + ':' + idx);
    if (!e) return;
    const st = this.panel.scrollTop;
    this.panel.scrollTo({ top: e.getBoundingClientRect().top + st - 70, behavior: 'smooth' });
  }

  _pageItems(anchor) {
    return [...anchor.querySelectorAll(':scope > .text-item, :scope > .fn-orphan')];
  }

  setSourcePreviewOnHover(on) {
    this._sourcePreviewOnHover = !!on;
    if (!on) this._hideSourceHover();
  }

  _sourceItemFromEvent(event) {
    if (event.target.closest?.('.fnref, .annotations-marker')) return null;
    if (!this._sourcePreviewOnHover && event.target.closest?.('.source-object')) return null;
    const item = event.target.closest?.('.text-item');
    return item && this.holder.contains(item) ? item : null;
  }

  _onSourcePointerMove(event) {
    if (!this._sourcePreviewOnHover) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) { this._hideSourceHover(); return; }
    const item = this._sourceItemFromEvent(event);
    if (!item) { this._hideSourceHover(); return; }
    this._showSourceSelection(item);
  }

  _onSourceClick(event) {
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) { this._clearSourceSelection(); return; }
    const item = this._sourceItemFromEvent(event);
    if (!item) { this._clearSourceSelection(); return; }
    if (!this._sourcePreviewOnHover
        && this._hoveredItem === item && this._pageHover && !this._pageHover.hidden) {
      this._clearSourceSelection();
      return;
    }
    const page = this._showSourceSelection(item);
    if (page) this.hooks.onPageSelect?.(page);
  }

  _showSourceSelection(item) {
    const page = Number(item.dataset.page);
    const anchor = this.pageAnchors.get(page);
    if (!anchor) { this._hideSourceHover(); return 0; }
    const rects = this._pageItems(anchor)
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.bottom > rect.top);
    if (!rects.length) { this._hideSourceHover(); return 0; }

    this._hoveredItem?.classList.remove('source-item-hover');
    this._hoveredItem = item;
    item.classList.add('source-item-hover');

    const holderRect = this.holder.getBoundingClientRect();
    const pagePadding = 6;
    const top = Math.min(...rects.map((rect) => rect.top)) - holderRect.top - pagePadding;
    const bottom = Math.max(...rects.map((rect) => rect.bottom)) - holderRect.top + pagePadding;
    this._pageHover.style.top = top + 'px';
    this._pageHover.style.height = (bottom - top) + 'px';
    this._pageHover.hidden = false;
    this._pageLabel.dataset.page = String(page);
    const panelRect = this.panel.getBoundingClientRect();
    const visibleTop = panelRect.top - holderRect.top + 8;
    const visibleBottom = panelRect.bottom - holderRect.top - 38;
    // 页首滚到工具栏下方时，把页码块收进文字栏可视区，避免被顶栏遮住。
    const labelTop = Math.min(Math.max(top - 36, visibleTop), Math.max(visibleTop, visibleBottom));
    this._pageLabel.style.top = Math.max(0, labelTop) + 'px';
    this._pageLabel.hidden = false;
    return page;
  }

  _clearSourceSelection() {
    this._hideSourceHover();
  }

  _hideSourceHover() {
    this._hoveredItem?.classList.remove('source-item-hover');
    this._hoveredItem = null;
    if (this._pageHover) this._pageHover.hidden = true;
    if (this._pageLabel) this._pageLabel.hidden = true;
  }

  destroy() {
    clearTimeout(this._scrollT);
    this._eventController.abort();
    this._hideSourceHover();
  }
}

export { pdfjsLib };
