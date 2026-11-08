/* 核心应用壳：书库 / 标签页 / 双视图 / 导入 / 插件管理器。
   功能（搜索/书签/护眼/脚注/进度）由 src/plugins/ 下的插件提供。 */
import JSZip from 'jszip';
import * as db from './db.js';
import { parseAnnotationSidecar } from './annotation_format.js';
import { confirmSheet, promptSheet, selectSheet, showToast } from './dialogs.js';
import { confirmDelete, cancelDeleteConfirmation } from './delete-confirm.js';
import { editName, cancelNameEditor } from './name-editor.js';
import { buildRenderModel, PdfView, TextView, pdfjsLib } from './views.js';
import { initSidebarResizer, initSplitResizer, layoutDefaults } from './layout_resize.js';
import { createConversionView } from './conversion.js';
import { initNavigationMotion } from './navigation-motion.js';
import {
  bus, ui, listExtensions, isEnabled, setEnabled,
  activateExtension, makeAppCtx, injectCore, renderToolbarWidgets, setPersistentStorage, selectSettingsSection,
} from './extensions.js';

const $ = (id) => document.getElementById(id);

export const state = {
  db: null,
  books: [],
  folders: [],
  tabs: [],                 // [{bookId, wv, pdfView, textView, model}]
  activeBookId: null,
};

let appCtx = null;
const selectedBookIds = new Set();
const expandedHomeFolders = new Set();
let selectionAnchorId = null;
let selectedBookId = null;
let selectedHomeFolderId = null;
let detailsOpen = false;
let suppressBookClick = false;
let conversionView = null;
let deletingLibrary = false;
const collapsedSidebarFolders = new Set();
let settingsSource = { screen: 'library', bookId: null };

/* ============================ 初始化 ============================ */
/** @param {{ mountHome?: ((host: HTMLElement) => void) | null }} [options] */
export async function init({ mountHome = null } = {}) {
  const mountLibrary = mountHome || (await import('../web/library-entry.tsx')).mountLibrary;
  state.db = await db.openDB();
  const preferenceStorage = db.createPreferenceStorage(state.db);
  setPersistentStorage(preferenceStorage);
  await loadLibrary();
  renderLibrary();

  appCtx = makeAppCtx();
  injectCore(appCtx, {
    // 绑定好的库 API：插件只需传书对象，不关心底层存储实现。
    db: {
      getBooks: () => db.getBooks(state.db),
      addBook: (book) => db.addBook(state.db, book),
      updateBook: (book) => db.updateBook(state.db, book),
      getBookPdf: (book) => db.getBookPdf(state.db, book),
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
  $('workspace').addEventListener('click', (event) => {
    if (event.target.closest('.dp-close')) {
      event.stopPropagation();
      detailsOpen = false;
      $('detail-panel').hidden = true;
    }
  });
  initSidebarResizer({
    handle: $('sidebar-resizer'),
    storage: preferenceStorage,
    onCommit: () => {
      const view = activeView();
      if (view) view.pdfView.setSpread(view.prefs.spread && view.prefs.viewMode === 'pdf');
    },
  });
  bindDragDrop();
  bindSettingsPage();

  // 内置功能统一启用，兼容旧版通过开关停用过的偏好。
  for (const ext of listExtensions()) {
    if (!isEnabled(ext.id)) setEnabled(ext.id, true);
    activateExtension(ext.id, appCtx);
  }

  bus.emit('app:ready', state);
  renderToolbarWidgets();

  createTopbarViewSwitch();     // 视图工具条（顶栏搜索框右侧，仅开书时显示）
  createHomeView(mountLibrary);
  conversionView = createConversionView({ onImport: importFile, onRead: openBook });
  $('workspace').appendChild(conversionView.element);
  enableCustomTooltips();        // title → 样式化悬浮提示
  initNavigationMotion();
  const q = new URLSearchParams(location.search).get('book');
  if (q) openBook(q);
  else if (new URLSearchParams(location.search).get('view') === 'settings') switchSettings(new URLSearchParams(location.search).get('section'));
  else if (new URLSearchParams(location.search).get('view') === 'convert') switchConvert();
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
  d.className = 'library-empty-compact';
  d.innerHTML = '<span class="sf i-home-library" aria-hidden="true"></span>'
    + '<span>暂无电子书</span><small>可在首页或上方按钮导入</small>';
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
    renameBook(b.id, row);
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
  row.addEventListener('keydown', event => {
    if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); renameBook(b.id, row); }
  });
  // 拖拽：把书拖到侧边栏文件夹（或首页行）
  cover.draggable = true;
  row.addEventListener('dragstart', (event) => setDraggedBooks(event, b.id));
  return row;
}

function appendBookGroup(parent, books) {
  for (const b of books) parent.appendChild(bookRow(b));
}

function appendFolder(parent, folder) {
  const row = document.createElement('div');
  row.className = 'folder-row';
  row.dataset.id = folder.id;
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'folder-toggle';
  toggle.setAttribute('aria-controls', 'folder-children-' + folder.id);
  const caret = document.createElement('span');
  caret.className = 'f-caret'; caret.textContent = '▾';
  const icon = document.createElement('span');
  icon.className = 'sf i-folder-plain folder-icon';
  const name = document.createElement('span');
  name.className = 'f-name'; name.textContent = folder.name;
  name.title = '双击重命名';
  name.addEventListener('dblclick', event => { event.stopPropagation(); renameFolder(folder.id, rename); });
  toggle.append(caret, icon, name);
  const rename = document.createElement('button');
  rename.type = 'button'; rename.className = 'folder-rename';
  rename.setAttribute('aria-label', '重命名文件夹 ' + folder.name);
  rename.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg>';
  rename.addEventListener('click', () => renameFolder(folder.id, rename));
  toggle.addEventListener('keydown', event => {
    if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); renameFolder(folder.id, rename); }
  });
  row.append(toggle, rename);
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
    toast({ type: 'success', message: '已将 ' + ids.length + ' 本电子书移入「' + folder.name + '」' });
  });
  parent.appendChild(row);
  const children = document.createElement('div');
  children.className = 'folder-children';
  children.id = 'folder-children-' + folder.id;
  const syncExpanded = () => {
    children.hidden = collapsedSidebarFolders.has(folder.id);
    row.classList.toggle('collapsed', children.hidden);
    toggle.setAttribute('aria-expanded', String(!children.hidden));
    caret.textContent = children.hidden ? '▸' : '▾';
  };
  toggle.addEventListener('click', () => {
    if (collapsedSidebarFolders.has(folder.id)) collapsedSidebarFolders.delete(folder.id); else collapsedSidebarFolders.add(folder.id);
    syncExpanded();
  });
  syncExpanded();
  for (const f of state.folders.filter((x) => x.parentId === folder.id)) appendFolder(children, f);
  appendBookGroup(children, state.books.filter((b) => b.folderId === folder.id));
  parent.appendChild(children);
}

function renameFolder(id, anchor = null) {
  const folder = state.folders.find(item => item.id === id);
  if (!folder) return;
  return editName({ anchor, title: '重命名文件夹', value: folder.name,
    returnFocus: () => [...document.querySelectorAll('.folder-row')].find(row => row.dataset.id === id)?.querySelector('.folder-rename'),
    onSave: async name => {
      await db.addFolder(state.db, { ...folder, name });
      await loadLibrary(); renderLibrary(); renderHome();
      toast({ type: 'success', message: '文件夹名称已更新' });
    },
  });
}

function renameBook(id, anchor = null) {
  const book = state.books.find(item => item.id === id);
  if (!book) return;
  return editName({ anchor, title: '修改书名', value: book.meta.title || book.s2eName || '',
    returnFocus: () => [...document.querySelectorAll('#library-tree .book-row')].find(row => row.dataset.id === id),
    onSave: async title => {
      await db.updateBook(state.db, { ...book, meta: { ...book.meta, title } });
      await loadLibrary(); renderLibrary(); renderHome(); refreshTabTitles();
      toast({ type: 'success', message: '书名已更新' });
    },
  });
}

/* ============================ 导入 ============================ */
/** @param {File} file @param {string | null} [sourceJobId] */
export async function importFile(file, sourceJobId = null) {
  if (sourceJobId) {
    const existing = state.books.find((book) => book.sourceJobId === sourceJobId);
    if (existing) { await openBook(existing.id); return existing.id; }
  }
  const zip = await JSZip.loadAsync(file);
  const j = zip.file('book.json');
  if (!j) throw new Error('压缩包内缺少 book.json');
  const bookJson = JSON.parse(await j.async('string'));
  let pdfEntry = zip.file('book.pdf') || zip.file(/\.pdf$/i)[0];
  if (!pdfEntry) throw new Error('压缩包内缺少 book.pdf');
  const pdfBlob = await pdfEntry.async('blob');
  const id = sourceJobId || crypto.randomUUID();
  const annotationEntry = zip.file('annotations.json');
  const parsedAnnotations = annotationEntry
    ? parseAnnotationSidecar(await annotationEntry.async('string'), id)
    : { records: [], invalidCount: 0 };
  const book = {
    id, s2eName: file.name.replace(/\.s2e$/i, ''), importedAt: Date.now(), folderId: null, sourceJobId,
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
  await openBook(id);
  toast({ type: 'success', message: '已导入「' + (book.meta.title || book.s2eName) + '」' });
  if (parsedAnnotations.invalidCount) toast('已跳过 ' + parsedAnnotations.invalidCount + ' 条无效标注');
  return id;
}

function bindDragDrop() {
  const ov = (e) => e.preventDefault();
  document.addEventListener('dragover', ov);
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files || []);
  });
}

export async function addFiles(files) {
  const selected = [...files];
  for (const file of selected.filter((item) => /\.(s2e|zip)$/i.test(item.name))) {
    try { await importFile(file); } catch (error) { toast({ type: 'error', message: '未能添加「' + file.name + '」', description: error.message }); }
  }
  const pdfs = selected.filter((item) => /\.pdf$/i.test(item.name));
  if (pdfs.length) {
    await switchConvert({ file: pdfs[0] });
    if (pdfs.length > 1) toast('已打开第一份 PDF。一次转换一本，其余文件请在完成后添加。');
  } else if (selected.length && !selected.some((item) => /\.(s2e|zip)$/i.test(item.name))) {
    toast('支持添加 PDF 或 .s2e 电子书');
  }
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
  homeBtn.className = 'tab' + (document.body.dataset.screen === 'library' ? ' active' : '');
  homeBtn.dataset.navKey = 'library';
  if (document.body.dataset.screen === 'library') homeBtn.setAttribute('aria-current', 'page');
  homeBtn.innerHTML = '<span class="sf i-home-library"></span><span>首页</span>';
  homeBtn.addEventListener('click', switchHome);
  tabs.appendChild(homeBtn);
  for (const t of state.tabs) {
    const book = state.books.find((b) => b.id === t.bookId);
    if (!book) continue;
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.bookId === state.activeBookId ? ' active' : '');
    btn.dataset.navKey = t.bookId;
    if (t.bookId === state.activeBookId) btn.setAttribute('aria-current', 'page');
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
         aria-label="调整 PDF 与文字视图宽度" tabindex="0"></div>
    <div class="text-panel"><div class="text-content"></div></div>
    <div class="view-control-island" role="group" aria-label="PDF、文字与书签操作">
      <button class="view-island-action jump" data-dir="pdf" type="button"
              title="跳转到对应 PDF 页" aria-label="跳转到 PDF 视图"><span class="sf i-left" aria-hidden="true"></span></button>
      <button class="view-island-action jump" data-dir="text" type="button"
              title="跳转到对应文字段" aria-label="跳转到文字视图"><span class="sf i-right" aria-hidden="true"></span></button>
      <span class="bookmark-island-slot"></span>
    </div>`;
  $('workspace').appendChild(wv);

  let model = buildRenderModel(book.bookJson);
  const pdfView = new PdfView(wv.querySelector('.pdf-panel'));
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
  const pdfPromise = db.getBookPdf(state.db, book)
    .then((pdfBlob) => pdfBlob.arrayBuffer())
    .then((data) => pdfjsLib.getDocument({ data }).promise);
  pdfPromise.then((doc) => pdfView.load(doc));

  view = { bookId: book.id, wv, pdfView, textView, model, pdfPromise };
  enableCustomTooltips(wv);
  // ---- 每本书自己的视图配置（记忆并持久化到统一数据目录） ----
  book.prefs = Object.assign({
    viewMode: window.matchMedia?.('(max-width: 760px)').matches ? 'text' : 'split',
    spread: false, sync: false, splitRatio: layoutDefaults.splitRatio,
  }, book.prefs || {});
  const prefs = book.prefs;
  view.prefs = prefs;   // 供顶栏视图工具条读取
  const persistPrefs = () => {
    book.prefs = prefs;
    // 书库刷新会更换记录对象，保存视图偏好时合并当前元数据，避免写回旧书名。
    const current = state.books.find(item => item.id === book.id) || book;
    current.prefs = prefs;
    db.updateBook(state.db, current).catch(() => {});
  };
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
    bus.emit('page:change', { bookId: book.id, page: n, source: 'pdf' });
    if (prefs.sync && !lock && !view.suppressTextSync) { lock = true; textView.scrollToPage(n); setTimeout(() => { lock = false; }, 150); }
  };
  wv.querySelector('.view-control-island .jump[data-dir="text"]').addEventListener('click', () => textView.scrollToPage(pdfView.currentPage || 1));
  wv.querySelector('.view-control-island .jump[data-dir="pdf"]').addEventListener('click', () => pdfView.gotoPage(textView.currentPage || 1));
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
  const readingAnchor = document.body.dataset.screen === 'settings' && settingsSource.bookId === id ? settingsSource.readingAnchor : null;
  conversionView?.deactivate();
  setScreen('reading', id);
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
  if (readingAnchor) restoreReadingAnchor(readingAnchor);
}

function switchHome() {
  conversionView?.deactivate();
  setScreen('library');
  state.activeBookId = null;
  for (const t of state.tabs) t.wv.hidden = true;
  const home = document.getElementById('home-view');
  if (home) { home.style.display = ''; renderHome(); }
  renderTabs();
  renderToc();
  syncViewSwitch();
  bus.emit('book:switch', { bookId: null });
}

function setScreen(screen, bookId = null) {
  cancelDeleteConfirmation();
  cancelNameEditor();
  document.body.dataset.screen = screen;
  $('settings-view').hidden = screen !== 'settings';
  document.body.classList.remove('reader-tools-open');
  $('btn-reader-tools')?.setAttribute('aria-expanded', 'false');
  if (window.history?.replaceState) {
    const url = new URL(window.location.href);
    if (screen === 'convert' || screen === 'settings') url.searchParams.set('view', screen); else url.searchParams.delete('view');
    if (screen !== 'settings') url.searchParams.delete('section');
    if (bookId) url.searchParams.set('book', bookId); else url.searchParams.delete('book');
    window.history.replaceState(null, '', url);
  }
  for (const [id, selected] of [['nav-library', screen === 'library' || screen === 'reading'], ['nav-convert', screen === 'convert'], ['btn-settings', screen === 'settings']]) {
    if (selected) $(id)?.setAttribute('aria-current', 'page');
    else $(id)?.removeAttribute('aria-current');
  }
  if (window.matchMedia?.('(max-width: 920px)').matches) {
    document.body.classList.add('sidebar-hidden');
    $('btn-library').setAttribute('aria-pressed', 'false');
  }
}

/** @param {{ jobId?: string, file?: File } | Event | null} [options] */
async function switchConvert(options = null) {
  state.activeBookId = null;
  setScreen('convert');
  for (const tab of state.tabs) tab.wv.hidden = true;
  if ($('home-view')) $('home-view').style.display = 'none';
  renderTabs(); renderToc(); syncViewSwitch();
  bus.emit('book:switch', { bookId: null });
  const request = options && ('jobId' in options || 'file' in options) ? options : undefined;
  await conversionView?.open(request);
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
      <button data-mode="split" class="active" title="双栏视图" aria-label="双栏视图"><span class="split-mode-icon" aria-hidden="true"><span class="sf vm-pdf"></span><span class="vm-bar"></span><span class="sf i-t"></span></span></button>
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

function captureReadingAnchor() {
  const panel = activeView()?.wv.querySelector('.text-panel');
  if (!panel) return null;
  const top = panel.getBoundingClientRect().top;
  const item = [...panel.querySelectorAll('.text-item[data-item]')].find(el => el.getBoundingClientRect().bottom > top + 8);
  return item ? { id: item.dataset.item, offset: item.getBoundingClientRect().top - top } : null;
}

function restoreReadingAnchor(anchor) {
  const panel = activeView()?.wv.querySelector('.text-panel');
  const item = panel && [...panel.querySelectorAll('.text-item[data-item]')].find(el => el.dataset.item === anchor.id);
  if (item) panel.scrollTop += item.getBoundingClientRect().top - panel.getBoundingClientRect().top - anchor.offset;
}

function switchSettings(section = null) {
  if (document.body.dataset.screen !== 'settings') {
    settingsSource = { screen: document.body.dataset.screen || 'library', bookId: state.activeBookId, readingAnchor: captureReadingAnchor() };
  }
  conversionView?.deactivate();
  state.activeBookId = null;
  setScreen('settings');
  for (const tab of state.tabs) tab.wv.hidden = true;
  if ($('home-view')) $('home-view').style.display = 'none';
  selectSettingsSection(section);
  $('settings-back').querySelector('span').textContent = settingsSource.screen === 'reading' ? '返回阅读' : settingsSource.screen === 'convert' ? '返回转换' : '返回书库';
  renderTabs(); renderToc(); syncViewSwitch();
  bus.emit('book:switch', { bookId: null });
  $('settings-view').scrollTop = 0;
  $('settings-title').focus({ preventScroll: true });
}

function bindSettingsPage() {
  $('btn-settings').addEventListener('click', () => switchSettings());
  $('settings-back').addEventListener('click', () => {
    if (settingsSource.screen === 'reading' && state.tabs.some(tab => tab.bookId === settingsSource.bookId)) switchTab(settingsSource.bookId);
    else if (settingsSource.screen === 'convert') switchConvert();
    else switchHome();
    $('btn-settings').focus();
  });
  window.openSettings = switchSettings;
}

/* ============================ 顶栏 ============================ */
function bindTopbar() {
  const toggleTools = (open, focus = false) => {
    const focusInTools = document.activeElement?.closest('#topbar-context');
    document.body.classList.toggle('reader-tools-open', open);
    $('btn-reader-tools')?.setAttribute('aria-expanded', String(open));
    if (open && focus) document.querySelector('#topbar-context input, #topbar-context button')?.focus();
    if (!open && (focus || focusInTools)) $('btn-reader-tools')?.focus();
  };
  window.matchMedia?.('(max-width: 920px)').addEventListener('change', (event) => {
    if (!event.matches) return;
    document.body.classList.add('sidebar-hidden');
    $('btn-library').setAttribute('aria-pressed', 'false');
    toggleTools(false);
    if (document.activeElement?.closest('#sidebar')) $('btn-library').focus();
  });
  $('btn-reader-tools')?.addEventListener('click', () => toggleTools(!document.body.classList.contains('reader-tools-open'), true));
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#topbar')) toggleTools(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleTools(false, Boolean(event.target.closest?.('#topbar-context')));
    if (event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)
        && document.body.dataset.screen === 'reading' && window.matchMedia?.('(max-width: 760px)').matches
        && !event.target.closest?.('.annotations-sidebar')) toggleTools(true);
  });
  $('nav-library')?.addEventListener('click', () => {
    switchHome();
    window.dispatchEvent(new window.Event('s2e:library-home'));
  });
  $('nav-convert')?.addEventListener('click', switchConvert);
  $('btn-library').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden');
    $('btn-library').classList.toggle('active', !document.body.classList.contains('sidebar-hidden'));
    $('btn-library').setAttribute('aria-pressed', String(!document.body.classList.contains('sidebar-hidden')));
  });
  $('btn-import').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen === 'settings') return;
    if (e.target.closest?.('.delete-confirmation, .name-editor, [data-toast-region], .task-drawer')) return;
    if (e.key === 'Escape') {
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
  bindBookMarquee($('library-tree'), '.book-row');
  bindRootDropTarget(document.querySelector('#library-panel > .panel-head'));
}

async function selectFolder() {
  const choices = [{ value: '', label: '书库根目录' }, ...state.folders.map((folder) => {
    const names = [folder.name];
    let parent = state.folders.find((item) => item.id === folder.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = state.folders.find((item) => item.id === parent.parentId);
    }
    return { value: folder.id, label: names.join(' / ') };
  })];
  const pick = await selectSheet({
    title: '移动电子书',
    label: '目标文件夹',
    confirmLabel: '移动',
    choices,
  });
  if (pick === null) return undefined;
  return pick || null;
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

async function deleteSelectedFolder(folder, anchor = null) {
  if (deletingLibrary) return;
  const folderIds = folderTreeIds(folder.id);
  const folderIdSet = new Set(folderIds);
  const bookIds = state.books.filter((book) => folderIdSet.has(book.folderId)).map((book) => book.id);
  const detail = bookIds.length ? '及其中 ' + bookIds.length + ' 本电子书' : '';
  if (!await confirmDelete({ anchor,
    title: '删除文件夹“' + folder.name + '”？',
    message: (detail ? '将同时删除' + detail + '。' : '') + '此操作无法撤销。',
    confirmLabel: '删除',
  })) return;
  deletingLibrary = true;
  try {
    if (bookIds.length) {
      await db.deleteBooks(state.db, bookIds);
      bookIds.forEach((id) => {
        selectedBookIds.delete(id);
        if (state.tabs.some((tab) => tab.bookId === id)) closeTab(id);
      });
    }
    for (const id of [...folderIds].reverse()) await db.deleteFolder(state.db, id);
    folderIds.forEach((id) => expandedHomeFolders.delete(id));
    folderIds.forEach((id) => collapsedSidebarFolders.delete(id));
    selectedHomeFolderId = null;
    selectionAnchorId = null;
    await loadLibrary();
    renderLibrary();
    renderHome();
    syncBookSelectionUI();
    toast({ type: 'success', message: '已删除文件夹' + (bookIds.length ? '及其中 ' + bookIds.length + ' 本电子书' : '') });
  } catch (error) {
    toast({ type: 'error', message: error.message || '文件夹未能删除，请重试' });
  } finally { deletingLibrary = false; }
}

/* ============================ 书库 ============================ */
function createHomeView(mountLibrary) {
  const home = document.createElement('div');
  home.id = 'home-view';
  home.style.display = 'none';
  $('workspace').appendChild(home);
  mountLibrary(home);
  bindBookMarquee(home.querySelector('.home-main'), '.ht-row');
}

function renderHome() {
  for (const id of selectedBookIds) {
    if (!state.books.some((book) => book.id === id)) selectedBookIds.delete(id);
  }
  if (selectedHomeFolderId && !state.folders.some((folder) => folder.id === selectedHomeFolderId)) selectedHomeFolderId = null;
  selectedBookId = selectedBookIds.size === 1 ? [...selectedBookIds][0] : null;
  bus.emit('library:change');
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
    toast({ type: 'success', message: '已将 ' + ids.length + ' 本电子书移到书库根目录' });
  });
}

function syncBookSelectionUI() {
  document.querySelectorAll('.book-row, .ht-row').forEach((row) => {
    const selected = selectedBookIds.has(row.dataset.id);
    row.classList.toggle('selected', selected);
    if (row.getAttribute('role') !== 'listitem') row.setAttribute('aria-selected', selected ? 'true' : 'false');
    row.draggable = selected;
  });
  selectedBookId = selectedBookIds.size === 1 ? [...selectedBookIds][0] : null;
  const homeDelete = $('home-delete');
  if (homeDelete) homeDelete.disabled = !selectedBookIds.size && !selectedHomeFolderId;
  const homeBatch = $('home-batch-bar');
  if (homeBatch) homeBatch.hidden = selectedBookIds.size === 0;
  renderDetail();
  bus.emit('library:change');
}

function selectBookFromEvent(event, id, orderedIds) {
  if (suppressBookClick) { suppressBookClick = false; return; }
  detailsOpen = false;
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
    const blockedTarget = event.target.closest?.('.folder-row, .book-row[draggable="true"], .ht-row[draggable="true"], button, input, textarea, select, .b-cover[draggable="true"]');
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
/** @param {HTMLElement | null} [anchor] */
async function deleteCurrentHomeSelection(anchor = null) {
  if (selectedHomeFolderId) {
    const folder = state.folders.find((item) => item.id === selectedHomeFolderId);
    if (folder) await deleteSelectedFolder(folder, anchor);
    return;
  }
  await deleteSelectedBooks([...selectedBookIds], anchor);
}

async function deleteSelectedBooks(requestedIds = [...selectedBookIds], anchor = null) {
  if (deletingLibrary) return;
  const ids = requestedIds.filter((id) => state.books.some((book) => book.id === id));
  if (!ids.length) return;
  const books = ids.map((id) => state.books.find((book) => book.id === id));
  if (!await confirmDelete({ anchor,
    title: ids.length === 1 ? '移出「' + (books[0].meta?.title || books[0].s2eName || '未命名电子书') + '」？' : '移出 ' + ids.length + ' 本电子书？',
    message: '只删除书库中的副本，原始文件保留。',
    confirmLabel: '移出书库',
  })) return;
  deletingLibrary = true;
  try {
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
    toast({ type: 'success', message: '已移出 ' + ids.length + ' 本电子书' });
  } catch (error) {
    toast({ type: 'error', message: error.message || '电子书未能移出，请重试' });
  } finally { deletingLibrary = false; }
}

function renderDetail() {
  const panel = $('detail-panel');
  if (!panel) return;
  panel.hidden = !detailsOpen;
  if (!detailsOpen) return;
  if (selectedHomeFolderId) {
    const folder = state.folders.find((item) => item.id === selectedHomeFolderId);
    if (folder) {
      const treeIds = folderTreeIds(folder.id);
      const treeSet = new Set(treeIds);
      const bookCount = state.books.filter((book) => treeSet.has(book.folderId)).length;
      const parent = state.folders.find((item) => item.id === folder.parentId);
      panel.innerHTML = `
        <div class="dp-head"><span class="dp-title">详细信息</span><button type="button" class="dp-close icon-btn" title="关闭详细信息" aria-label="关闭详细信息"><span class="sf i-xmark"></span></button></div>
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
      <div class="dp-head"><span class="dp-title">详细信息</span><button type="button" class="dp-close icon-btn" title="关闭详细信息" aria-label="关闭详细信息"><span class="sf i-xmark"></span></button></div>
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
      <div class="dp-head"><span class="dp-title">详细信息</span><button type="button" class="dp-close icon-btn" title="关闭详细信息" aria-label="关闭详细信息"><span class="sf i-xmark"></span></button></div>
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
      <button type="button" class="dp-close icon-btn" title="关闭详细信息" aria-label="关闭详细信息"><span class="sf i-xmark"></span></button>
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
  box.tabIndex = 0; box.setAttribute('role', 'button');
  box.setAttribute('aria-label', '重命名文件夹 ' + folder.name);
  box.addEventListener('click', () => renameFolder(folder.id, box));
  box.addEventListener('keydown', event => {
    if (['Enter', ' ', 'F2'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); renameFolder(folder.id, box); }
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
  toast({ type: 'success', message: '已保存' });
}
/* ============================ 工具 ============================ */
export const readerBridge = {
  snapshot: () => ({
    books: state.books, folders: state.folders,
    selectedIds: [...selectedBookIds], selectedFolderId: selectedHomeFolderId,
    expandedIds: [...expandedHomeFolders],
  }),
  subscribe: (listener) => bus.on('library:change', listener),
  openBook,
  importBook: () => $('import-input').click(),
  showConversion: (jobId) => switchConvert(typeof jobId === 'string' ? { jobId } : null),
  showLibrary: switchHome,
  importConversion: importFile,
  selectBook: (event, id) => selectBookFromEvent(event, id, visibleHomeBookIds($('home-table'))),
  selectBookOnly(event, id) {
    selectBookFromEvent(event, id, visibleHomeBookIds($('home-table')));
  },
  toggleBookSelection(id) {
    selectBookFromEvent({ metaKey: true }, id, visibleHomeBookIds($('home-table')));
  },
  showBookDetails(id) {
    selectBookFromEvent({}, id, visibleHomeBookIds($('home-table')));
    detailsOpen = true; renderDetail();
  },
  showFolderDetails(id) {
    detailsOpen = true;
    selectedHomeFolderId = id; selectedBookIds.clear(); selectionAnchorId = null; syncBookSelectionUI();
  },
  clearSelection() {
    detailsOpen = false;
    selectedBookIds.clear(); selectedHomeFolderId = null; selectionAnchorId = null; syncBookSelectionUI();
  },
  selectAllVisible() {
    detailsOpen = false;
    selectedBookIds.clear();
    visibleHomeBookIds($('home-table')).forEach((id) => selectedBookIds.add(id));
    selectedHomeFolderId = null; syncBookSelectionUI();
  },
  selectFolder(id) {
    detailsOpen = false;
    selectedHomeFolderId = id;
    selectedBookIds.clear(); selectionAnchorId = null;
    if (expandedHomeFolders.has(id)) expandedHomeFolders.delete(id); else expandedHomeFolders.add(id);
    syncBookSelectionUI();
  },
  /** @param {string | null} [parentId] */
  async createFolder(parentId = null) {
    const name = await promptSheet({ title: '新建文件夹', label: '文件夹名称', confirmLabel: '创建' });
    if (!name?.trim()) return;
    await db.addFolder(state.db, { id: crypto.randomUUID(), name: name.trim(), parentId: typeof parentId === 'string' ? parentId : null });
    await loadLibrary(); renderLibrary(); renderHome();
  },
  deleteSelection: deleteCurrentHomeSelection,
  /** @param {string} id @param {HTMLElement | null} [anchor] */
  renameFolder(id, anchor = null) { return renameFolder(id, anchor); },
  /** @param {string} id @param {HTMLElement | null} [anchor] */
  renameBook(id, anchor = null) { return renameBook(id, anchor); },
  /** @param {string} id @param {HTMLElement | null} [anchor] */
  deleteBook(id, anchor = null) { return deleteSelectedBooks([id], anchor); },
  /** @param {string} id @param {HTMLElement | null} [anchor] */
  deleteFolder(id, anchor = null) {
    const folder = state.folders.find(item => item.id === id);
    return folder ? deleteSelectedFolder(folder, anchor) : Promise.resolve();
  },
  async moveSelection() {
    const folder = await selectFolder();
    if (folder === undefined) return;
    await db.moveBooks(state.db, [...selectedBookIds], folder);
    await loadLibrary(); renderLibrary(); renderHome();
  },
  dragBooks: setDraggedBooks,
  async dropBooks(event, folderId) {
    const ids = draggedBookIds(event);
    if (!ids.length) return;
    event.preventDefault();
    await db.moveBooks(state.db, ids, folderId);
    if (folderId) expandedHomeFolders.add(folderId);
    await loadLibrary(); renderLibrary(); renderHome();
  },
};

export function enableCustomTooltips(root = document) {
  root.querySelectorAll('[title]').forEach((el) => {
    el.dataset.tip = el.title;
    el.removeAttribute('title');
  });
}
export function toast(msg) {
  return showToast(msg);
}
