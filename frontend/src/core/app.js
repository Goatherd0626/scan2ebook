/* 核心应用壳：书库 / 标签页 / 双视图 / 导入 / 插件管理器。
   功能（搜索/书签/护眼/脚注/进度）由 src/plugins/ 下的插件提供。 */
import JSZip from 'jszip';
import * as db from './db.js';
import { parseAnnotationSidecar } from './annotation_format.js';
import { confirmSheet, promptSheet, showToast } from './dialogs.js';
import { buildRenderModel, PdfView, TextView, pdfjsLib } from './views.js';
import { initSidebarResizer, initSplitResizer, layoutDefaults } from './layout_resize.js';
import {
  bus, ui, listExtensions, isEnabled, setEnabled,
  activateExtension, deactivateExtension, makeAppCtx, injectCore, renderToolbarWidgets,
} from './extensions.js';

const $ = (id) => document.getElementById(id);

export const state = {
  db: null,
  books: [],
  folders: [],
  tabs: [],                 // [{bookId, wv, pdfView, textView, model}]
  activeBookId: null,
  batchMode: false,
};

let appCtx = null;
const selectedBookIds = new Set();
const expandedHomeFolders = new Set();
let selectionAnchorId = null;
let selectedBookId = null;
let selectedHomeFolderId = null;
let suppressBookClick = false;

/* ============================ 初始化 ============================ */
export async function init() {
  state.db = await db.openDB();
  await loadLibrary();
  renderLibrary();

  appCtx = makeAppCtx();
  injectCore(appCtx, {
    // 绑定好的库 API：插件只需传书对象，不用管 IndexedDB 实例
    db: {
      getBooks: () => db.getBooks(state.db),
      addBook: (book) => db.addBook(state.db, book),
      updateBook: (book) => db.updateBook(state.db, book),
      deleteBooks: (ids) => db.deleteBooks(state.db, ids),
      moveBooks: (ids, folderId) => db.moveBooks(state.db, ids, folderId),
      getAnnotations: (bookId) => db.getAnnotations(state.db, bookId),
      replaceAnnotations: (bookId, records) => db.replaceAnnotations(state.db, bookId, records),
      updateBookAndAnnotations: (book, records) => db.updateBookAndAnnotations(state.db, book, records),
    },
    state,
    getView: () => activeView(),
    toast,
    dialog: { confirm: confirmSheet, prompt: promptSheet },
    openBook: (id) => openBook(id),
  });

  bindTopbar();
  initSidebarResizer({
    handle: $('sidebar-resizer'),
    onCommit: () => {
      const view = activeView();
      if (view) view.pdfView.setSpread(view.prefs.spread && view.prefs.viewMode === 'pdf');
    },
  });
  bindDragDrop();
  bindSettingsDialog();

  // 激活插件（按启停状态）
  for (const ext of listExtensions()) activateExtension(ext.id, appCtx);

  bus.emit('app:ready', state);
  renderToolbarWidgets();

  createTopbarViewSwitch();     // 视图工具条（顶栏搜索框右侧，仅开书时显示）
  createHomeView();              // 首页（Zotero 式书库管理）
  enableCustomTooltips();        // title → 样式化悬浮提示
  const q = new URLSearchParams(location.search).get('book');
  if (q) openBook(q);
  else switchHome();
}

/* ============================ 书库 ============================ */
async function loadLibrary() {
  state.books = await db.getBooks(state.db);
  state.folders = await db.getFolders(state.db);
}

function renderLibrary() {
  const tree = $('library-tree');
  tree.innerHTML = '';
  if (!state.folders.length && !state.books.length) { tree.appendChild(emptyLib()); return; }
  appendBookGroup(tree, state.books.filter((b) => !b.folderId));
  for (const f of state.folders.filter((x) => !x.parentId)) appendFolder(tree, f);
}

function emptyLib() {
  const d = document.createElement('div');
  d.id = 'empty-hint';
  d.innerHTML = '<div class="big"><span class="sf i-home-library" aria-hidden="true"></span></div><div>书库为空</div>';
  const btn = document.createElement('button');
  btn.className = 'import-big';
  btn.textContent = '选择 .s2e 文件导入';
  btn.addEventListener('click', () => $('import-input').click());
  d.appendChild(btn);
  d.appendChild(Object.assign(document.createElement('div'), { className: 'drop-hint', textContent: '也可以把 .s2e 文件直接拖到窗口任意位置' }));
  return d;
}

function bookRow(b) {
  const row = document.createElement('div');
  row.className = 'book-row' + (selectedBookIds.has(b.id) ? ' selected' : '');
  row.dataset.id = b.id;
  row.tabIndex = 0;
  row.draggable = selectedBookIds.has(b.id);
  const cover = document.createElement('span');
  cover.className = 'b-cover c' + ((b.id.charCodeAt(0) + (b.id.charCodeAt(1) || 0)) % 5 + 1);
  cover.textContent = (b.meta.title || b.s2eName || '书').slice(0, 1);
  row.appendChild(cover);
  const t = document.createElement('span');
  t.className = 'b-title';
  t.textContent = b.meta.title || b.s2eName || '未命名';
  t.title = '双击编辑标题';
  t.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    startMetaEdit(row, b, t);
  });
  row.appendChild(t);
  const meta = document.createElement('span');
  meta.className = 'b-meta';
  meta.textContent = (b.meta.author || '').slice(0, 8) + ' · ' + (b.bookJson.pages ? b.bookJson.pages.length : '?') + '页';
  row.appendChild(meta);
  row.addEventListener('click', (e) => {
    selectBookFromEvent(e, b.id, [...document.querySelectorAll('#library-tree .book-row')].map((item) => item.dataset.id));
  });
  row.addEventListener('dblclick', () => openBook(b.id));
  // 拖拽：把书拖到侧边栏文件夹（或首页行）
  cover.draggable = true;
  row.addEventListener('dragstart', (event) => setDraggedBooks(event, b.id));
  return row;
}

function appendBookGroup(parent, books) {
  for (const b of books) parent.appendChild(bookRow(b));
}

async function startMetaEdit(row, book, titleEl) {
  const input = document.createElement('input');
  input.className = 'b-title-input';
  input.value = book.meta.title || '';
  titleEl.replaceWith(input);
  input.focus(); input.select();
  const done = async () => {
    book.meta.title = input.value.trim() || book.s2eName || '未命名';
    await db.updateBook(state.db, book);
    renderLibrary();
    refreshTabTitles();
    toast('书名已更新');
  };
  input.addEventListener('blur', done);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
}

function appendFolder(parent, folder) {
  const row = document.createElement('div');
  row.className = 'folder-row';
  row.dataset.id = folder.id;
  const caret = document.createElement('span');
  caret.className = 'f-caret'; caret.textContent = '▾';
  const icon = document.createElement('span');
  icon.className = 'sf i-folder-plain folder-icon';
  const name = document.createElement('span');
  name.className = 'f-name'; name.textContent = folder.name;
  name.title = '双击重命名';
  name.addEventListener('dblclick', () => startFolderRename(row, folder, name));
  row.append(caret, icon, name);
  // 拖拽入文件夹：把书（首页行/侧边栏书行）拖到文件夹上松手即移动
  row.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/s2e-book')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    }
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', async (e) => {
    row.classList.remove('drag-over');
    const ids = draggedBookIds(e);
    if (!ids.length) return;
    e.preventDefault();
    await db.moveBooks(state.db, ids, folder.id);
    await loadLibrary(); renderLibrary(); renderHome();
    toast('已将 ' + ids.length + ' 本电子书移入「' + folder.name + '」');
  });
  row.addEventListener('click', () => {
    const ch = parent.querySelector(':scope > .folder-children');
    if (ch) { ch.hidden = !ch.hidden; caret.textContent = ch.hidden ? '▸' : '▾'; }
  });
  parent.appendChild(row);
  const children = document.createElement('div');
  children.className = 'folder-children';
  for (const f of state.folders.filter((x) => x.parentId === folder.id)) appendFolder(children, f);
  appendBookGroup(children, state.books.filter((b) => b.folderId === folder.id));
  if (children.childElementCount) parent.appendChild(children);
}

async function startFolderRename(row, folder, nameEl) {
  const input = document.createElement('input');
  input.className = 'b-title-input';
  input.value = folder.name;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const done = async () => {
    folder.name = input.value.trim() || '未命名';
    await db.addFolder(state.db, folder);
    renderLibrary();
  };
  input.addEventListener('blur', done);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
}

/* ============================ 导入 ============================ */
async function importFile(file) {
  const zip = await JSZip.loadAsync(file);
  const j = zip.file('book.json');
  if (!j) throw new Error('压缩包内缺少 book.json');
  const bookJson = JSON.parse(await j.async('string'));
  let pdfEntry = zip.file('book.pdf') || zip.file(/\.pdf$/i)[0];
  if (!pdfEntry) throw new Error('压缩包内缺少 book.pdf');
  const pdfBlob = await pdfEntry.async('blob');
  const id = crypto.randomUUID();
  const annotationEntry = zip.file('annotations.json');
  const parsedAnnotations = annotationEntry
    ? parseAnnotationSidecar(await annotationEntry.async('string'), id)
    : { records: [], invalidCount: 0 };
  const book = {
    id, s2eName: file.name.replace(/\.s2e$/i, ''), importedAt: Date.now(), folderId: null,
    meta: Object.assign({ title: file.name.replace(/\.s2e$/i, '') }, bookJson.book || {}),
    bookJson, pdfBlob, bookmarks: parsedAnnotations.bookmarks || [], progress: null,
  };
  await db.addBook(state.db, book);
  if (parsedAnnotations.records.length) {
    await db.replaceAnnotations(state.db, id, parsedAnnotations.records);
  }
  await loadLibrary();
  renderLibrary();
  renderHome();
  openBook(id);
  toast('已导入「' + (book.meta.title || book.s2eName) + '」');
  if (parsedAnnotations.invalidCount) toast('已跳过 ' + parsedAnnotations.invalidCount + ' 条无效标注');
}

function bindDragDrop() {
  const ov = (e) => e.preventDefault();
  document.addEventListener('dragover', ov);
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files || []) {
      if (/\.(s2e|zip)$/i.test(f.name)) importFile(f).catch((err) => toast('导入失败：' + err.message));
    }
  });
}

/* ============================ 标签页 ============================ */
export function activeView() {
  return state.tabs.find((t) => t.bookId === state.activeBookId) || null;
}

function waitForPdfObserverDelivery() {
  return new Promise((resolve) => {
    // 两次绘制后再让出一个 task，覆盖 scrollIntoView 触发的 observer 延迟投递。
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  });
}

export async function revealPdfSource(view, page) {
  if (!view || !Number.isFinite(+page)) return;
  if (view.prefs?.viewMode === 'text') view.setPrefs({ viewMode: 'split' });
  await view.pdfPromise;
  // token 防止重叠导航中较早的调用提前恢复 PDF → 文字同步。
  const suppressionToken = {};
  view.textSyncSuppressionToken = suppressionToken;
  view.suppressTextSync = true;
  try {
    view.pdfView.gotoPage(+page);
    await waitForPdfObserverDelivery();
  } finally {
    if (view.textSyncSuppressionToken === suppressionToken) {
      view.suppressTextSync = false;
      delete view.textSyncSuppressionToken;
    }
  }
}

function renderTabs() {
  const tabs = $('tabs');
  const empty = $('tabs-empty');
  tabs.querySelectorAll('.tab').forEach((x) => x.remove());
  // 固定「首页」标签（Zotero 式书库管理页）
  const homeBtn = document.createElement('button');
  homeBtn.className = 'tab' + (state.activeBookId === null ? ' active' : '');
  homeBtn.innerHTML = '<span class="sf i-home-library"></span><span>首页</span>';
  homeBtn.addEventListener('click', switchHome);
  tabs.appendChild(homeBtn);
  for (const t of state.tabs) {
    const book = state.books.find((b) => b.id === t.bookId);
    if (!book) continue;
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.bookId === state.activeBookId ? ' active' : '');
    const title = document.createElement('span');
    title.textContent = book.meta.title || book.s2eName || '书';
    title.style.overflow = 'hidden'; title.style.textOverflow = 'ellipsis';
    title.style.maxWidth = '130px';
    const x = document.createElement('span');
    x.className = 'tab-x';
    x.setAttribute('aria-label', '关闭标签');
    x.innerHTML = '<span class="sf i-xmark" aria-hidden="true"></span>';
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.bookId); });
    btn.append(title, x);
    btn.addEventListener('click', () => switchTab(t.bookId));
    tabs.appendChild(btn);
  }
  empty.hidden = state.tabs.length > 0;
}

function createBookView(book) {
  const wv = document.createElement('div');
  wv.className = 'book-view';
  wv.dataset.book = book.id;
  wv.innerHTML = `
    <div class="pdf-panel"><div class="pdf-holder"></div></div>
    <div class="divider" role="separator" aria-orientation="vertical"
         aria-label="调整 PDF 与文字视图宽度" tabindex="0">
      <button class="jump" data-dir="text" title="跳转到对应文字段" aria-label="跳转到文字视图"><span class="sf i-right"></span></button>
      <button class="jump" data-dir="pdf" title="跳转到对应 PDF 页" aria-label="跳转到 PDF 视图"><span class="sf i-left"></span></button>
    </div>
    <div class="text-panel"><div class="text-content"></div></div>`;
  $('workspace').appendChild(wv);

  let model = buildRenderModel(book.bookJson);
  const pdfView = new PdfView(wv.querySelector('.pdf-panel'));
  pdfView.onPageChange = (n) => bus.emit('page:change', { bookId: book.id, page: n, source: 'pdf' });
  let view = null;
  const textView = new TextView(wv.querySelector('.text-panel'), {
    onItemRender: (p) => bus.emit('item:render', Object.assign(p, { bookId: book.id })),
    onPageRender: (p) => bus.emit('page:render', Object.assign(p, { bookId: book.id })),
    onPageChange: (n) => {
      bus.emit('page:change', { bookId: book.id, page: n });
      if (prefs.sync && !lock) { lock = true; pdfView.gotoPage(n); setTimeout(() => { lock = false; }, 150); }
    },
    onScroll: (n) => bus.emit('text:scroll', { bookId: book.id, page: n }),
    onSelection: (sel) => showContextBar(sel),
    onPageSelect: (page) => bus.emit('page:select', { bookId: book.id, page }),
    onSourceObject: ({ page }) => revealPdfSource(view, page),
  });
  textView.load(model, book.meta);

  // pdf.js 的 data 只接受 TypedArray/ArrayBuffer，Blob 需先转
  const pdfPromise = book.pdfBlob.arrayBuffer().then((data) => pdfjsLib.getDocument({ data }).promise);
  pdfPromise.then((doc) => pdfView.load(doc));

  view = { bookId: book.id, wv, pdfView, textView, model, pdfPromise };
  enableCustomTooltips(wv);
  // ---- 每本书自己的视图配置（记忆并持久化到 IndexedDB） ----
  book.prefs = Object.assign({
    viewMode: 'split', spread: false, sync: false, splitRatio: layoutDefaults.splitRatio,
  }, book.prefs || {});
  const prefs = book.prefs;
  view.prefs = prefs;   // 供顶栏视图工具条读取
  const persistPrefs = () => { book.prefs = prefs; db.updateBook(state.db, book).catch(() => {}); };
  let splitResizer = null;
  const applyPrefs = () => {
    wv.dataset.mode = prefs.viewMode;
    splitResizer?.setRatio(prefs.splitRatio);
    pdfView.setSpread(prefs.spread && prefs.viewMode === 'pdf');  // 摊开只在仅PDF视图生效
  };
  view.applyPrefs = applyPrefs;
  // 顶栏视图工具条通过 setPrefs 修改当前书配置
  view.setPrefs = (patch, msg) => {
    Object.assign(prefs, patch);
    applyPrefs();
    persistPrefs();
    syncViewSwitch();
    if (msg) toast(msg);
  };
  splitResizer = initSplitResizer({
    view: wv,
    divider: wv.querySelector('.divider'),
    initialRatio: prefs.splitRatio,
    getRightInset: () => {
      const annotations = wv.querySelector('.annotations-sidebar:not([hidden])');
      if (!annotations) return 0;
      return annotations.getBoundingClientRect().width || parseFloat(annotations.style.width) || 0;
    },
    onChange: (ratio) => { prefs.splitRatio = ratio; },
    onCommit: () => {
      persistPrefs();
      pdfView.setSpread(prefs.spread && prefs.viewMode === 'pdf');
    },
  });
  view.refreshLayout = () => splitResizer?.setRatio(prefs.splitRatio);
  view.reloadContent = () => {
    const page = textView.currentPage || pdfView.currentPage || 1;
    model = buildRenderModel(book.bookJson);
    view.model = model;
    textView.load(model, book.meta);
    if (state.activeBookId === book.id) renderToc();
    bus.emit('book:content-change', { bookId: book.id, view, book, model });
    setTimeout(() => textView.scrollToPage(page), 0);
  };
  view.cleanup = () => {
    splitResizer();
    textView.destroy();
  };
  let lock = false;
  pdfView.onPageChange = (n) => {
    if (prefs.sync && !lock && !view.suppressTextSync) { lock = true; textView.scrollToPage(n); setTimeout(() => { lock = false; }, 150); }
  };
  wv.querySelector('.jump[data-dir="text"]').addEventListener('click', () => textView.scrollToPage(pdfView.currentPage || 1));
  wv.querySelector('.jump[data-dir="pdf"]').addEventListener('click', () => pdfView.gotoPage(textView.currentPage || 1));
  return view;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function openBook(id) {
  const exist = state.tabs.find((t) => t.bookId === id);
  if (exist) { switchTab(id); return; }
  const book = state.books.find((b) => b.id === id);
  if (!book) return;
  const view = createBookView(book);
  state.tabs.push(view);
  renderTabs();
  switchTab(id);
  bus.emit('book:open', { view, book, bookId: id, model: view.model });
  if (book.progress && book.progress.page) {
    view.pdfPromise.then(() => {
      view.pdfView.gotoPage(book.progress.page);
      setTimeout(() => view.textView.scrollToPage(book.progress.page), 350);
    });
  }
}

function switchTab(id) {
  state.activeBookId = id;
  const home = document.getElementById('home-view');
  if (home) home.style.display = 'none';
  for (const t of state.tabs) t.wv.hidden = t.bookId !== id;
  const cur = state.tabs.find((t) => t.bookId === id);
  if (cur && cur.applyPrefs) cur.applyPrefs();
  renderTabs();
  renderToc();
  syncViewSwitch();
  bus.emit('book:switch', { bookId: id });
}

function switchHome() {
  state.activeBookId = null;
  for (const t of state.tabs) t.wv.hidden = true;
  const home = document.getElementById('home-view');
  if (home) { home.style.display = ''; renderHome(); }
  renderTabs();
  renderToc();
  syncViewSwitch();
  bus.emit('book:switch', { bookId: null });
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.bookId === id);
  if (i < 0) return;
  const [t] = state.tabs.splice(i, 1);
  t.cleanup?.();
  t.wv.remove();
  bus.emit('book:close', { bookId: id });
  if (state.activeBookId === id) {
    const next = state.tabs[Math.min(i, state.tabs.length - 1)];
    if (next) switchTab(next.bookId); else switchHome();
  }
  renderTabs();
}

function refreshTabTitles() { renderTabs(); }

/* ============================ 目录（核心） ============================ */
function renderToc() {
  const list = $('toc-list');
  list.innerHTML = '';
  const view = activeView();
  if (!view) return;
  const toc = view.model.toc && view.model.toc.length ? view.model.toc : null;
  const items = toc || collectHeadings(view.model.pages);
  for (const e of items) {
    const a = document.createElement('div');
    a.className = 'toc-item l' + (e.level || 2) + (e.pdf_page ? '' : ' no-jump');
    a.textContent = (e.number ? e.number + ' ' : '') + (e.text || '');
    if (e.pdf_page) {
      const sp = document.createElement('span');
      sp.className = 'toc-page'; sp.textContent = 'P' + e.pdf_page;
      a.appendChild(sp);
      a.addEventListener('click', () => { view.pdfView.gotoPage(e.pdf_page); view.textView.scrollToPage(e.pdf_page); });
    } else {
      a.title = '未匹配到正文标题';
    }
    list.appendChild(a);
  }
}

function collectHeadings(pages) {
  const out = [];
  for (const pg of pages) for (const it of pg.items) {
    if (it.type === 'heading') out.push({ number: it.number, text: it.text, level: it.level, pdf_page: pg.pdf_page });
  }
  return out;
}

/* ============================ 选中文字上下文操作 ============================ */
export function showContextBar(sel) {
  hideContextBar();
  const actions = ui.registry.contextActions;
  if (!actions.length) return;
  const bar = document.createElement('div');
  bar.id = 'ctxbar';
  for (const a of actions) {
    if (typeof a.render === 'function') {
      const content = a.render({ selection: sel, view: activeView(), close: hideContextBar });
      if (content) bar.appendChild(content);
      continue;
    }
    const b = document.createElement('button');
    b.textContent = a.label;
    b.addEventListener('click', () => { a.apply(sel.text, activeView()); hideContextBar(); });
    bar.appendChild(b);
  }
  if (!bar.childElementCount) return;
  document.body.appendChild(bar);
  const r = sel.rect;
  const margin = 8;
  const barWidth = bar.offsetWidth;
  const barHeight = bar.offsetHeight;
  const preferredLeft = r.left;
  const maxLeft = Math.max(margin, innerWidth - barWidth - margin);
  bar.style.left = Math.max(margin, Math.min(preferredLeft, maxLeft)) + 'px';
  const above = r.top - barHeight - margin;
  bar.style.top = (above >= margin ? above : r.bottom + margin) + 'px';
}

export function hideContextBar() { document.getElementById('ctxbar')?.remove(); }
document.addEventListener('mousedown', (event) => {
  if (event.target.closest?.('#ctxbar')) return;
  setTimeout(hideContextBar, 200);
});

/* ============================ 设置 / 插件管理器 ============================ */
/* ============================ 顶栏视图工具条 ============================ */
let viewSwitchEl = null;
function createTopbarViewSwitch() {
  const sw = document.createElement('div');
  sw.id = 'view-switch';
  sw.innerHTML = `
    <div class="seg" data-role="view-modes">
      <button data-mode="split" class="active" title="双栏视图" aria-label="双栏视图"><span class="sf vm-pdf"></span><span class="vm-bar"></span><span class="sf i-t"></span></button>
      <button data-mode="pdf" title="仅 PDF 视图" aria-label="仅 PDF 视图"><span class="sf vm-pdf"></span></button>
      <button data-mode="text" title="仅文字视图" aria-label="仅文字视图"><span class="sf i-t"></span></button>
    </div>
    <span class="view-context-actions">
      <button class="vs-ctl vs-sync" data-act="sync" title="同步滚动（双栏视图）" aria-label="同步滚动"><span class="sf i-sync" aria-hidden="true"></span></button>
      <button class="vs-ctl vs-spread" data-act="spread" title="PDF 双页摊开（仅 PDF 视图）" aria-label="PDF 双页摊开"><span class="sf i-spread" aria-hidden="true"></span></button>
    </span>`;
  const tool = document.getElementById('plugin-toolbar');
  const searchEl = tool.querySelector('#search-wrap');
  tool.insertBefore(sw, searchEl ? searchEl.nextSibling : tool.firstChild);
  viewSwitchEl = sw;

  sw.querySelector('[data-role="view-modes"]').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    const v = activeView();
    if (v && v.setPrefs) v.setPrefs({ viewMode: b.dataset.mode });
  });
  sw.querySelector('[data-act="spread"]').addEventListener('click', () => {
    const v = activeView();
    if (v && v.setPrefs) v.setPrefs({ spread: !v.prefs.spread });
  });
  sw.querySelector('[data-act="sync"]').addEventListener('click', () => {
    const v = activeView();
    if (v && v.setPrefs) v.setPrefs({ sync: !v.prefs.sync }, v.prefs.sync ? '已开启同步滚动' : '已关闭同步滚动');
  });
  enableCustomTooltips(sw);
  syncViewSwitch();
}

function syncViewSwitch() {
  if (!viewSwitchEl) return;
  const v = activeView();
  const prefs = v && v.prefs;
  viewSwitchEl.classList.toggle('show', !!prefs);
  if (!prefs) return;
  viewSwitchEl.dataset.mode = prefs.viewMode;
  viewSwitchEl.querySelectorAll('[data-role="view-modes"] button').forEach((b) => b.classList.toggle('active', b.dataset.mode === prefs.viewMode));
  const spread = viewSwitchEl.querySelector('[data-act="spread"]');
  const sync = viewSwitchEl.querySelector('[data-act="sync"]');
  spread.classList.toggle('active', prefs.spread);
  sync.classList.toggle('active', prefs.sync);
  spread.disabled = prefs.viewMode !== 'pdf';
  sync.disabled = prefs.viewMode !== 'split';
  spread.setAttribute('aria-hidden', prefs.viewMode === 'pdf' ? 'false' : 'true');
  sync.setAttribute('aria-hidden', prefs.viewMode === 'split' ? 'false' : 'true');
}

function bindSettingsDialog() {
  const dlg = $('settings-dialog');
  const mask = $('settings-mask');
  const open = () => { mask.hidden = false; dlg.hidden = false; renderPluginList(); };
  const close = () => { mask.hidden = true; dlg.hidden = true; };
  $('btn-settings').addEventListener('click', () => (dlg.hidden ? open() : close()));
  $('sd-close').addEventListener('click', close);
  mask.addEventListener('click', close);
  window.openSettings = open;
}

function renderPluginList() {
  const host = $('sd-sections');
  // 插件管理分区（核心提供）
  let sec = host.querySelector('.sd-section[data-plugins]');
  if (!sec) {
    sec = document.createElement('div');
    sec.className = 'sd-section';
    sec.dataset.plugins = '1';
    sec.innerHTML = '<div class="sd-sec-title">插件</div>';
    host.prepend(sec);
  }
  sec.querySelectorAll('.plugin-row').forEach((x) => x.remove());
  for (const ext of listExtensions()) {
    const row = document.createElement('div');
    row.className = 'plugin-row';
    const info = document.createElement('span');
    info.className = 'p-info';
    info.innerHTML = '<b>' + ext.name + '</b> <small>' + (ext.version || '') + '</small><br><span class="p-desc">' + (ext.description || '') + '</span>';
    const tog = document.createElement('button');
    tog.className = 'sw';
    tog.type = 'button';
    tog.setAttribute('role', 'switch');
    tog.setAttribute('aria-label', ext.name);
    const on = isEnabled(ext.id);
    tog.classList.toggle('on', on);
    tog.setAttribute('aria-checked', on ? 'true' : 'false');
    tog.addEventListener('click', () => {
      const now = !isEnabled(ext.id);
      setEnabled(ext.id, now);
      if (now) activateExtension(ext.id, appCtx); else deactivateExtension(ext.id);
      renderPluginList();
      toast('插件「' + ext.name + '」' + (now ? '已启用' : '已停用') + '（部分功能需刷新生效）');
    });
    row.append(info, tog);
    sec.appendChild(row);
  }
}

/* ============================ 顶栏 ============================ */
function bindTopbar() {
  $('btn-library').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden');
    $('btn-library').classList.toggle('active', !document.body.classList.contains('sidebar-hidden'));
  });
  $('btn-import').addEventListener('click', () => $('import-input').click());
  $('btn-import-lib').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', async (e) => {
    for (const f of e.target.files) {
      if (/\.(s2e|zip)$/i.test(f.name)) importFile(f).catch((err) => toast('导入失败：' + err.message));
    }
    e.target.value = '';
  });
  $('btn-new-folder').addEventListener('click', async () => {
    const name = await promptSheet({ title: '新建文件夹', label: '文件夹名称', confirmLabel: '创建' });
    if (!name || !name.trim()) return;
    await db.addFolder(state.db, { id: crypto.randomUUID(), name: name.trim(), parentId: null });
    await loadLibrary(); renderLibrary();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('settings-dialog').hidden = true; $('settings-mask').hidden = true;
      $('fn-tooltip').style.display = 'none'; hideContextBar();
      selectedBookIds.clear();
      selectedHomeFolderId = null;
      selectionAnchorId = null;
      syncBookSelectionUI();
    }
    if (['Delete', 'Backspace'].includes(e.key) && (selectedBookIds.size || selectedHomeFolderId)
        && (state.activeBookId === null || e.target.closest?.('#library-panel'))
        && !e.target.closest?.('input, textarea, select, [contenteditable="true"]')) {
      e.preventDefault();
      deleteCurrentHomeSelection();
    }
  });
  // 批量操作条
  const bar = document.createElement('div');
  bar.id = 'batch-bar';
  bar.hidden = true;
  bar.innerHTML = '<button class="mini" data-action="move">移动到…</button><button class="mini" data-action="delete">删除</button>';
  $('library-panel').insertBefore(bar, $('library-panel').firstChild);
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#batch-bar')) return;
    const btn = e.target.closest('button'); if (!btn) return;
    const ids = [...selectedBookIds];
    if (!ids.length) { toast('先勾选电子书'); return; }
    if (btn.dataset.action === 'delete') {
      await deleteSelectedBooks(ids);
      return;
    } else if (btn.dataset.action === 'move') {
      const f = await selectFolder();
      if (f !== undefined) { await db.moveBooks(state.db, ids, f); toast('已移动'); }
    }
    await loadLibrary(); renderLibrary(); renderHome();
  });
  bindBookMarquee($('library-tree'), '.book-row');
  bindRootDropTarget(document.querySelector('#library-panel > .panel-head'));
}

async function selectFolder() {
  const names = [{ id: null, name: '（书库根目录）' }, ...state.folders].map((f) => f.name).join('\n');
  const pick = await promptSheet({
    title: '移动电子书',
    message: '现有位置：\n' + names,
    label: '目标文件夹（留空为书库根目录）',
    confirmLabel: '移动',
    allowEmpty: true,
  });
  if (pick === null) return undefined;
  if (!pick.trim() || pick.trim() === '（书库根目录）') return null;
  const f = state.folders.find((x) => x.name === pick.trim());
  return f ? f.id : null;
}

function folderTreeIds(rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

async function deleteSelectedFolder(folder) {
  const folderIds = folderTreeIds(folder.id);
  const folderIdSet = new Set(folderIds);
  const bookIds = state.books.filter((book) => folderIdSet.has(book.folderId)).map((book) => book.id);
  const detail = bookIds.length ? '及其中 ' + bookIds.length + ' 本电子书' : '';
  if (!await confirmSheet({
    title: '删除文件夹“' + folder.name + '”？',
    message: (detail ? '将同时删除' + detail + '。' : '') + '此操作无法撤销。',
    confirmLabel: '删除',
    danger: true,
  })) return;
  if (bookIds.length) {
    await db.deleteBooks(state.db, bookIds);
    bookIds.forEach((id) => {
      selectedBookIds.delete(id);
      if (state.tabs.some((tab) => tab.bookId === id)) closeTab(id);
    });
  }
  for (const id of [...folderIds].reverse()) await db.deleteFolder(state.db, id);
  folderIds.forEach((id) => expandedHomeFolders.delete(id));
  selectedHomeFolderId = null;
  selectionAnchorId = null;
  await loadLibrary();
  renderLibrary();
  renderHome();
  syncBookSelectionUI();
  toast('已删除文件夹' + (bookIds.length ? '及其中 ' + bookIds.length + ' 本电子书' : ''));
}

/* ============================ 首页（Zotero 式书库管理） ============================ */
function createHomeView() {
  const home = document.createElement('div');
  home.id = 'home-view';
  home.style.display = 'none';
  home.innerHTML = `
    <div class="home-main">
      <div class="home-head">
        <div class="home-title">
          <h2>书库</h2>
          <span class="home-count"></span>
        </div>
        <div class="home-actions">
          <div id="home-batch-bar" class="batch-bar home-selection-bar" hidden>
            <button class="mini" data-action="move">移动到…</button>
            <button class="mini danger" data-action="delete">删除</button>
          </div>
          <button id="home-new-folder" class="mini home-tool" title="新建文件夹" aria-label="新建文件夹">
            <span class="sf i-folder"></span>
          </button>
          <button id="home-delete" class="mini home-tool danger" title="删除选中的项目" aria-label="删除选中的项目" disabled>
            <span class="sf i-trash"></span>
          </button>
          <button id="home-import" class="mini home-tool primary" title="导入电子书" aria-label="导入电子书">
            <span class="sf i-upload"></span>
          </button>
        </div>
      </div>
      <div id="home-table-wrap">
        <div class="ht-head">
          <span class="htc-cover"></span>
          <span class="htc-title">书名</span><span class="htc-author">作者</span>
          <span class="htc-pub">出版社</span><span class="htc-pages">页数</span>
          <span class="htc-folder">文件夹</span><span class="htc-actions"></span>
        </div>
        <div id="home-table"></div>
        <div id="home-empty" hidden>
          <div class="big"><span class="sf i-home-library" aria-hidden="true"></span></div>
          <p>书库还是空的</p>
          <button id="home-empty-import" class="import-big">选择 .s2e 文件导入</button>
          <div class="drop-hint">也可以把 .s2e 文件拖到窗口任意位置</div>
        </div>
      </div>
    </div>
    <aside id="detail-panel"></aside>`;
  $('workspace').appendChild(home);

  $('home-import').addEventListener('click', () => $('import-input').click());
  $('home-empty-import').addEventListener('click', () => $('import-input').click());
  $('home-new-folder').addEventListener('click', async () => {
    const name = await promptSheet({ title: '新建文件夹', label: '文件夹名称', confirmLabel: '创建' });
    if (!name || !name.trim()) return;
    await db.addFolder(state.db, { id: crypto.randomUUID(), name: name.trim(), parentId: null });
    await loadLibrary(); renderLibrary(); renderHome();
  });
  $('home-delete').addEventListener('click', () => deleteCurrentHomeSelection());
  $('home-batch-bar').addEventListener('click', async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const ids = [...selectedBookIds];
    if (!ids.length) { toast('先勾选电子书'); return; }
    if (btn.dataset.action === 'delete') {
      await deleteSelectedBooks(ids);
      return;
    } else if (btn.dataset.action === 'move') {
      const f = await selectFolder();
      if (f !== undefined) { await db.moveBooks(state.db, ids, f); toast('已移动'); }
    }
    await loadLibrary(); renderLibrary(); renderHome();
  });
  bindBookMarquee(home.querySelector('.home-main'), '.ht-row');
  bindRootDropTarget(home.querySelector('.home-title'));
}

function renderHome() {
  const table = $('home-table');
  if (!table) return;
  table.innerHTML = '';
  const count = $('home-count');
  if (count) count.textContent = state.books.length + ' 本 · ' + state.folders.length + ' 个文件夹';
  const empty = $('home-empty');
  if (empty) empty.hidden = state.books.length > 0 || state.folders.length > 0;
  for (const id of [...selectedBookIds]) {
    if (!state.books.some((book) => book.id === id)) selectedBookIds.delete(id);
  }
  if (selectedHomeFolderId && !state.folders.some((folder) => folder.id === selectedHomeFolderId)) {
    selectedHomeFolderId = null;
  }
  selectedBookId = selectedBookIds.size === 1 ? [...selectedBookIds][0] : null;
  const deleteButton = $('home-delete');
  if (deleteButton) deleteButton.disabled = !selectedBookIds.size && !selectedHomeFolderId;
  const batchBar = $('home-batch-bar');
  if (batchBar) batchBar.hidden = selectedBookIds.size < 2;

  for (const folder of state.folders.filter((item) => !item.parentId)) {
    appendHomeFolder(table, folder, 0, []);
  }
  for (const book of state.books.filter((item) => !item.folderId)) {
    appendHomeBook(table, book, 0, []);
  }
  renderDetail();
}

function visibleHomeBookIds(table) {
  return [...table.querySelectorAll('.ht-row')]
    .filter((row) => !row.hidden && row.style.display !== 'none')
    .map((row) => row.dataset.id);
}

function setDraggedBooks(event, fallbackId) {
  const ids = selectedBookIds.has(fallbackId) ? [...selectedBookIds] : [fallbackId];
  event.dataTransfer.setData('text/s2e-books', JSON.stringify(ids));
  event.dataTransfer.setData('text/s2e-book', ids[0]);
  event.dataTransfer.effectAllowed = 'move';
}

function draggedBookIds(event) {
  try {
    const ids = JSON.parse(event.dataTransfer.getData('text/s2e-books') || '[]');
    if (Array.isArray(ids) && ids.length) return ids;
  } catch (error) { /* 兼容旧的单本拖拽载荷 */ }
  const id = event.dataTransfer.getData('text/s2e-book');
  return id ? [id] : [];
}

function bindRootDropTarget(target) {
  if (!target) return;
  target.classList.add('root-drop-target');
  target.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('text/s2e-book')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    target.classList.add('drag-over');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
  target.addEventListener('drop', async (event) => {
    target.classList.remove('drag-over');
    const ids = draggedBookIds(event);
    if (!ids.length) return;
    event.preventDefault();
    await db.moveBooks(state.db, ids, null);
    await loadLibrary();
    renderLibrary();
    renderHome();
    toast('已将 ' + ids.length + ' 本电子书移到书库根目录');
  });
}

function appendHomeBook(table, book, depth, ancestorIds) {
  const row = document.createElement('div');
  const treeHidden = ancestorIds.some((id) => !expandedHomeFolders.has(id));
  row.className = 'ht-row' + (selectedBookIds.has(book.id) ? ' selected' : '');
  row.dataset.id = book.id;
  row.dataset.folderPath = ancestorIds.join(',');
  row.dataset.treeHidden = treeHidden ? '1' : '0';
  row.hidden = treeHidden;
  row.tabIndex = 0;
  row.draggable = selectedBookIds.has(book.id);

  const cover = document.createElement('span');
  cover.className = 'b-cover c' + ((book.id.charCodeAt(0) + (book.id.charCodeAt(1) || 0)) % 5 + 1);
  cover.textContent = (book.meta.title || book.s2eName || '书').slice(0, 1);
  cover.draggable = true;
  row.addEventListener('dragstart', (event) => setDraggedBooks(event, book.id));
  const title = cell('ht-title', book.meta.title || book.s2eName || '未命名');
  title.style.paddingLeft = depth * 18 + 'px';
  row.append(cover, title);
  row.appendChild(cell('ht-author', book.meta.author || ''));
  row.appendChild(cell('ht-pub', book.meta.publisher || ''));
  row.appendChild(cell('ht-pages', book.bookJson.pages ? book.bookJson.pages.length + ' 页' : ''));
  const folder = state.folders.find((item) => item.id === book.folderId);
  row.appendChild(cell('ht-folder', folder ? folder.name : '—'));
  row.appendChild(cell('ht-actions', ''));
  row.addEventListener('click', (event) => {
    selectBookFromEvent(event, book.id, visibleHomeBookIds(table));
  });
  row.addEventListener('dblclick', () => openBook(book.id));
  table.appendChild(row);
}

function appendHomeFolder(table, folder, depth, ancestorIds) {
  const row = document.createElement('div');
  const treeHidden = ancestorIds.some((id) => !expandedHomeFolders.has(id));
  const expanded = expandedHomeFolders.has(folder.id);
  const descendantIds = folderTreeIds(folder.id);
  const folderIdSet = new Set(descendantIds);
  const bookCount = state.books.filter((book) => folderIdSet.has(book.folderId)).length;
  row.className = 'ht-folder-row' + (selectedHomeFolderId === folder.id ? ' selected' : '');
  row.dataset.folderId = folder.id;
  row.dataset.folderPath = ancestorIds.join(',');
  row.dataset.treeHidden = treeHidden ? '1' : '0';
  row.hidden = treeHidden;

  const leading = document.createElement('span');
  leading.className = 'home-folder-leading';
  leading.innerHTML = '<span class="home-folder-caret">' + (expanded ? '▾' : '▸') + '</span><span class="sf i-folder-plain home-folder-glyph"></span>';
  const title = cell('ht-title home-folder-name', folder.name);
  title.style.paddingLeft = depth * 18 + 'px';
  const count = cell('ht-author home-folder-count', bookCount + ' 本');
  const actions = cell('ht-actions', '');
  row.append(leading, title, count, cell('ht-pub', ''), cell('ht-pages', ''), cell('ht-folder', '文件夹'), actions);
  row.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    selectedHomeFolderId = folder.id;
    selectedBookIds.clear();
    selectionAnchorId = null;
    if (expandedHomeFolders.has(folder.id)) expandedHomeFolders.delete(folder.id);
    else expandedHomeFolders.add(folder.id);
    renderHome();
  });
  row.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('text/s2e-book')) return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', async (event) => {
    row.classList.remove('drag-over');
    const ids = draggedBookIds(event);
    if (!ids.length) return;
    event.preventDefault();
    await db.moveBooks(state.db, ids, folder.id);
    expandedHomeFolders.add(folder.id);
    await loadLibrary();
    renderLibrary();
    renderHome();
  });
  table.appendChild(row);

  const nextAncestors = [...ancestorIds, folder.id];
  for (const child of state.folders.filter((item) => item.parentId === folder.id)) {
    appendHomeFolder(table, child, depth + 1, nextAncestors);
  }
  for (const book of state.books.filter((item) => item.folderId === folder.id)) {
    appendHomeBook(table, book, depth + 1, nextAncestors);
  }
}

function cell(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function syncBookSelectionUI() {
  document.querySelectorAll('.book-row, .ht-row').forEach((row) => {
    const selected = selectedBookIds.has(row.dataset.id);
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
    row.draggable = selected;
  });
  document.querySelectorAll('.ht-folder-row').forEach((row) => {
    const selected = row.dataset.folderId === selectedHomeFolderId;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  selectedBookId = selectedBookIds.size === 1 ? [...selectedBookIds][0] : null;
  const homeDelete = $('home-delete');
  if (homeDelete) homeDelete.disabled = !selectedBookIds.size && !selectedHomeFolderId;
  const homeBatch = $('home-batch-bar');
  if (homeBatch) homeBatch.hidden = selectedBookIds.size < 2;
  const sidebarBatch = $('batch-bar');
  if (sidebarBatch) sidebarBatch.hidden = selectedBookIds.size < 2;
  renderDetail();
}

function selectBookFromEvent(event, id, orderedIds) {
  if (suppressBookClick) { suppressBookClick = false; return; }
  selectedHomeFolderId = null;
  const anchorIndex = orderedIds.indexOf(selectionAnchorId);
  const currentIndex = orderedIds.indexOf(id);
  if (event.shiftKey && anchorIndex >= 0 && currentIndex >= 0) {
    selectedBookIds.clear();
    const [start, end] = [Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex)];
    orderedIds.slice(start, end + 1).forEach((bookId) => selectedBookIds.add(bookId));
  } else if (event.metaKey || event.ctrlKey) {
    if (selectedBookIds.has(id)) selectedBookIds.delete(id); else selectedBookIds.add(id);
    selectionAnchorId = id;
  } else {
    selectedBookIds.clear();
    selectedBookIds.add(id);
    selectionAnchorId = id;
  }
  syncBookSelectionUI();
}

function bindBookMarquee(container, rowSelector) {
  if (!container) return;
  let pending = null;
  let marquee = null;
  container.addEventListener('pointerdown', (event) => {
    const blockedTarget = event.target.closest?.('.folder-row, .ht-folder-row, .book-row[draggable="true"], .ht-row[draggable="true"], button, input, textarea, select, .b-cover[draggable="true"]');
    if (event.button !== 0 || blockedTarget) return;
    const base = (event.metaKey || event.ctrlKey) ? new Set(selectedBookIds) : new Set();
    pending = {
      startX: event.clientX,
      startY: event.clientY,
      base,
      startedOnRow: !!event.target.closest?.(rowSelector),
    };
    event.preventDefault();
  });
  document.addEventListener('pointermove', (event) => {
    if (!marquee && pending) {
      if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < 5) return;
      const box = document.createElement('div');
      box.className = 'book-selection-marquee';
      document.body.appendChild(box);
      marquee = { ...pending, box };
      selectedHomeFolderId = null;
      selectedBookIds.clear();
      marquee.base.forEach((id) => selectedBookIds.add(id));
      selectionAnchorId = null;
    }
    if (!marquee) return;
    const left = Math.min(marquee.startX, event.clientX);
    const top = Math.min(marquee.startY, event.clientY);
    const right = Math.max(marquee.startX, event.clientX);
    const bottom = Math.max(marquee.startY, event.clientY);
    Object.assign(marquee.box.style, {
      left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px',
    });
    selectedBookIds.clear();
    marquee.base.forEach((id) => selectedBookIds.add(id));
    container.querySelectorAll(rowSelector).forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) {
        selectedBookIds.add(row.dataset.id);
      }
    });
    syncBookSelectionUI();
  });
  document.addEventListener('pointerup', () => {
    if (marquee) {
      marquee.box.remove();
      marquee = null;
      suppressBookClick = true;
      setTimeout(() => { suppressBookClick = false; }, 0);
      if (selectedBookIds.size === 1) selectionAnchorId = [...selectedBookIds][0];
      syncBookSelectionUI();
    } else if (pending && !pending.startedOnRow && !pending.base.size) {
      selectedBookIds.clear();
      selectedHomeFolderId = null;
      syncBookSelectionUI();
    }
    pending = null;
  });
}

/* ---- 右侧详情面板（Zotero Info 风格：左标签右值，面板内编辑） ---- */
async function deleteCurrentHomeSelection() {
  if (selectedHomeFolderId) {
    const folder = state.folders.find((item) => item.id === selectedHomeFolderId);
    if (folder) await deleteSelectedFolder(folder);
    return;
  }
  await deleteSelectedBooks();
}

async function deleteSelectedBooks(requestedIds = [...selectedBookIds]) {
  const ids = requestedIds.filter((id) => state.books.some((book) => book.id === id));
  if (!ids.length) return;
  const books = ids.map((id) => state.books.find((book) => book.id === id));
  const promptText = ids.length === 1
    ? '删除「' + (books[0].meta?.title || books[0].s2eName || '未命名电子书') + '」（阅读器存储中的副本）？'
    : '删除选中的 ' + ids.length + ' 本电子书（阅读器存储中的副本）？';
  if (!await confirmSheet({
    title: ids.length === 1 ? '删除电子书？' : '删除 ' + ids.length + ' 本电子书？',
    message: promptText,
    confirmLabel: '删除',
    danger: true,
  })) return;
  await db.deleteBooks(state.db, ids);
  ids.forEach((id) => {
    selectedBookIds.delete(id);
    if (state.tabs.some((tab) => tab.bookId === id)) closeTab(id);
  });
  selectionAnchorId = null;
  selectedBookId = null;
  await loadLibrary();
  renderLibrary();
  renderHome();
  renderDetail();
  toast('已删除 ' + ids.length + ' 本电子书');
}

function renderDetail() {
  const panel = $('detail-panel');
  if (!panel) return;
  panel.hidden = false;
  if (selectedHomeFolderId) {
    const folder = state.folders.find((item) => item.id === selectedHomeFolderId);
    if (folder) {
      const treeIds = folderTreeIds(folder.id);
      const treeSet = new Set(treeIds);
      const bookCount = state.books.filter((book) => treeSet.has(book.folderId)).length;
      const parent = state.folders.find((item) => item.id === folder.parentId);
      panel.innerHTML = `
        <div class="dp-head"><span class="dp-title">详细信息</span></div>
        <div class="dp-body">
          <div class="dp-object-icon folder"><span class="sf i-folder-plain"></span></div>
          <h3 class="dp-object-name dp-edit-title dp-folder-name" data-folder-key="name" title="单击修改文件夹名称">${escapeHtml(folder.name)}</h3>
          ${dpField('类型', null, '文件夹', false)}
          ${dpField('位置', null, parent ? parent.name : '书库根目录', false)}
          ${dpField('电子书', null, bookCount + ' 本', false)}
          ${dpField('子文件夹', null, (treeIds.length - 1) + ' 个', false)}
        </div>`;
      bindFolderNameEdit(folder);
      return;
    }
  }
  if (selectedBookIds.size > 1) {
    panel.innerHTML = `
      <div class="dp-head"><span class="dp-title">详细信息</span></div>
      <div class="dp-state">
        <div class="dp-state-icon"><span class="sf i-list"></span></div>
        <strong>已选择 ${selectedBookIds.size} 本电子书</strong>
        <span>可使用顶部工具栏进行移动或删除</span>
      </div>`;
    return;
  }
  const book = state.books.find((b) => b.id === selectedBookId);
  if (!book) {
    panel.innerHTML = `
      <div class="dp-head"><span class="dp-title">详细信息</span></div>
      <div class="dp-state empty">
        <div class="dp-state-icon"><span class="sf i-home-library"></span></div>
        <strong>未选择对象</strong>
        <span>选择电子书或文件夹以查看详细信息</span>
      </div>`;
    return;
  }
  const folder = state.folders.find((f) => f.id === book.folderId);
  const fmt = (ts) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');
  const ci = (book.id.charCodeAt(0) + (book.id.charCodeAt(1) || 0)) % 5 + 1;
  panel.innerHTML = `
    <div class="dp-head">
      <span class="dp-title">详细信息</span>
    </div>
    <div class="dp-body">
      <div class="dp-cover c${ci}">${escapeHtml((book.meta.title || book.s2eName || '书').slice(0, 1))}</div>
      <h3 class="dp-book dp-edit-title" data-key="title" title="单击修改书名">${escapeHtml(book.meta.title || book.s2eName || '未命名')}</h3>
      ${dpField('作者', 'author', book.meta.author)}
      ${dpField('出版社', 'publisher', book.meta.publisher)}
      ${dpField('版次', 'edition', book.meta.edition)}
      ${dpField('ISBN', 'isbn', book.meta.isbn)}
      <div class="dp-row"><span class="dp-label">文件夹</span><span class="dp-value" data-key="folder" data-editable="select">${escapeHtml(folder ? folder.name : '（书库根目录）')}</span></div>
      ${dpField('页数', null, book.bookJson.pages ? book.bookJson.pages.length + ' 页' : '—', false)}
      ${dpField('导入时间', null, fmt(book.importedAt), false)}
      ${book.progress && book.progress.page ? dpField('上次阅读', null, 'PDF 第 ' + book.progress.page + ' 页', false) : ''}
    </div>`;
  bindInlineEdit(book);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dpField(label, key, value, editable = true) {
  const cls = editable ? ' dp-edit' : '';
  const data = editable ? ` data-key="${key}" data-editable="input"` : '';
  return `<div class="dp-row"><span class="dp-label">${label}</span><span class="dp-value${cls}"${data}>${escapeHtml(value || '—')}</span></div>`;
}

function bindFolderNameEdit(folder) {
  const box = document.querySelector('#detail-panel [data-folder-key="name"]');
  if (!box) return;
  box.addEventListener('click', (event) => {
    if (event.target.closest('input')) return;
    const current = folder.name || '未命名';
    box.classList.add('editing');
    box.textContent = '';
    const input = document.createElement('input');
    input.className = 'dp-inline';
    input.value = current;
    box.appendChild(input);
    input.focus();
    input.select();
    const finish = (save) => async () => {
      if (input.dataset.done) return;
      input.dataset.done = '1';
      const nextName = input.value.trim() || current;
      if (save && nextName !== current) {
        folder.name = nextName;
        await db.addFolder(state.db, folder);
        await loadLibrary();
        renderLibrary();
        renderHome();
        toast('文件夹名称已更新');
      } else {
        renderDetail();
      }
    };
    input.addEventListener('blur', finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') finish(false)();
    });
  });
}

/* 原地编辑：单击值框 → 变输入框/下拉；点别处（blur）自动保存，无需确认 */
function bindInlineEdit(book) {
  const panel = $('detail-panel');
  panel.querySelectorAll('[data-editable], .dp-edit-title').forEach((box) => {
    box.addEventListener('click', (e) => {
      if (e.target.closest('input, select')) return;
      if (panel.querySelector('input.dp-inline, select.dp-inline')) return; // 已有编辑进行中
      const key = box.dataset.key;
      const isTitle = box.classList.contains('dp-edit-title');
      const isFolder = key === 'folder';
      const current = isTitle ? (book.meta.title || '') : (isFolder ? (book.folderId || '') : (book.meta[key] || ''));
      box.classList.add('editing');
      box.textContent = '';
      if (isFolder) {
        const sel = document.createElement('select');
        sel.className = 'dp-inline';
        sel.innerHTML = '<option value="">（书库根目录）</option>'
          + state.folders.map((f) => `<option value="${f.id}" ${f.id === book.folderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
        box.appendChild(sel);
        sel.addEventListener('change', async () => {
          book.folderId = sel.value || null;
          await ctxDbSave(book);
        });
      } else {
        const input = document.createElement('input');
        input.className = 'dp-inline';
        input.value = current;
        box.appendChild(input);
        input.focus();
        input.select();
        const done = (save) => async () => {
          if (input.dataset.done) return;
          input.dataset.done = '1';
          const v = input.value.trim();
          if (save && v !== (current || '')) {
            if (isTitle) book.meta.title = v || book.s2eName || '未命名';
            else book.meta[key] = v;
            await ctxDbSave(book);
          } else {
            renderDetail();
          }
        };
        input.addEventListener('blur', done(true));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') done(false)(); });
      }
    });
  });
}

async function ctxDbSave(book) {
  await db.updateBook(state.db, book);
  await loadLibrary(); renderLibrary(); renderHome();
  refreshTabTitles();
  renderDetail();
  toast('已保存');
}
/* ============================ 工具 ============================ */
export function enableCustomTooltips(root = document) {
  root.querySelectorAll('[title]').forEach((el) => {
    el.dataset.tip = el.title;
    el.removeAttribute('title');
  });
}
export function toast(msg) {
  return showToast(msg);
}
