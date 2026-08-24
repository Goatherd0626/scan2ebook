/* 核心应用壳：书库 / 标签页 / 双视图 / 导入 / 插件管理器。
   功能（搜索/书签/护眼/脚注/进度）由 src/plugins/ 下的插件提供。 */
import JSZip from 'jszip';
import * as db from './db.js';
import { buildRenderModel, PdfView, TextView, pdfjsLib } from './views.js';
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
  syncScroll: false,
  batchMode: false,
};

let appCtx = null;
let lastSelection = null;

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
    },
    state,
    getView: () => activeView(),
    toast,
    openBook: (id) => openBook(id),
  });

  bindTopbar();
  bindDragDrop();
  bindSettingsDialog();

  // 激活插件（按启停状态）
  for (const ext of listExtensions()) activateExtension(ext.id, appCtx);

  bus.emit('app:ready', state);
  renderToolbarWidgets();

  createHomeView();              // 首页（Zotero 式书库管理）
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
  d.innerHTML = '<div class="big">📖</div><div>书库为空</div>';
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
  row.className = 'book-row';
  row.dataset.id = b.id;
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.className = 'batch-check';
  row.appendChild(chk);
  const cover = document.createElement('span');
  cover.className = 'b-cover c' + ((b.id.charCodeAt(0) + (b.id.charCodeAt(1) || 0)) % 5 + 1);
  cover.textContent = (b.meta.title || b.s2eName || '书').slice(0, 1);
  row.appendChild(cover);
  const t = document.createElement('span');
  t.className = 'b-title';
  t.textContent = b.meta.title || b.s2eName || '未命名';
  t.title = '双击编辑标题';
  t.addEventListener('dblclick', () => startMetaEdit(row, b, t));
  row.appendChild(t);
  const meta = document.createElement('span');
  meta.className = 'b-meta';
  meta.textContent = (b.meta.author || '').slice(0, 8) + ' · ' + (b.bookJson.pages ? b.bookJson.pages.length : '?') + '页';
  row.appendChild(meta);
  row.addEventListener('click', (e) => {
    if (state.batchMode) { chk.checked = !chk.checked; return; }
    if (e.target !== chk) openBook(b.id);
  });
  chk.addEventListener('click', (e) => e.stopPropagation());
  // 拖拽：把书拖到侧边栏文件夹（或首页行）
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/s2e-book', b.id);
    e.dataTransfer.effectAllowed = 'move';
  });
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
  const name = document.createElement('span');
  name.className = 'f-name'; name.textContent = folder.name;
  name.title = '双击重命名';
  name.addEventListener('dblclick', () => startFolderRename(row, folder, name));
  const x = document.createElement('span');
  x.className = 'bm-x'; x.textContent = '✕';
  x.title = '删除文件夹（书移到根目录）';
  x.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('删除文件夹「' + folder.name + '」？其中的书将移到书库根目录。')) return;
    await db.deleteFolder(state.db, folder.id);
    await db.moveBooks(state.db, state.books.filter((b) => b.folderId === folder.id).map((b) => b.id), null);
    await loadLibrary(); renderLibrary();
  });
  row.append(caret, name, x);
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
    const id = e.dataTransfer.getData('text/s2e-book');
    if (!id) return;
    e.preventDefault();
    const book = state.books.find((b) => b.id === id);
    if (!book) return;
    book.folderId = folder.id;
    await db.updateBook(state.db, book);
    await loadLibrary(); renderLibrary(); renderHome();
    toast('「' + (book.meta.title || book.s2eName) + '」已移入「' + folder.name + '」');
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
  const book = {
    id, s2eName: file.name.replace(/\.s2e$/i, ''), importedAt: Date.now(), folderId: null,
    meta: Object.assign({ title: file.name.replace(/\.s2e$/i, '') }, bookJson.book || {}),
    bookJson, pdfBlob, bookmarks: [], progress: null,
  };
  await db.addBook(state.db, book);
  await loadLibrary();
  renderLibrary();
  renderHome();
  openBook(id);
  toast('已导入「' + (book.meta.title || book.s2eName) + '」');
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

function renderTabs() {
  const tabs = $('tabs');
  const empty = $('tabs-empty');
  tabs.querySelectorAll('.tab').forEach((x) => x.remove());
  // 固定「首页」标签（Zotero 式书库管理页）
  const homeBtn = document.createElement('button');
  homeBtn.className = 'tab' + (state.activeBookId === null ? ' active' : '');
  homeBtn.innerHTML = '🏠 首页';
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
    x.className = 'tab-x'; x.textContent = '×';
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
    <div class="divider">
      <button class="jump" data-dir="text" title="PDF → 文字">←文字</button>
      <button class="jump" data-dir="pdf" title="文字 → PDF">PDF→</button>
    </div>
    <div class="text-panel"><div class="text-content"></div></div>`;
  $('workspace').appendChild(wv);

  const model = buildRenderModel(book.bookJson);
  const pdfView = new PdfView(wv.querySelector('.pdf-panel'));
  const textView = new TextView(wv.querySelector('.text-panel'), {
    onItemRender: (p) => bus.emit('item:render', Object.assign(p, { bookId: book.id })),
    onPageRender: (p) => bus.emit('page:render', Object.assign(p, { bookId: book.id })),
    onPageChange: (n) => {
      bus.emit('page:change', { bookId: book.id, page: n });
      if (state.syncScroll && !lock) { lock = true; pdfView.gotoPage(n); setTimeout(() => { lock = false; }, 150); }
    },
    onScroll: (n) => bus.emit('text:scroll', { bookId: book.id, page: n }),
    onSelection: (sel) => showContextBar(sel),
  });
  textView.load(model, book.meta);

  // pdf.js 的 data 只接受 TypedArray/ArrayBuffer，Blob 需先转
  const pdfPromise = book.pdfBlob.arrayBuffer().then((data) => pdfjsLib.getDocument({ data }).promise);
  pdfPromise.then((doc) => pdfView.load(doc));

  const view = { bookId: book.id, wv, pdfView, textView, model, pdfPromise };
  let lock = false;
  pdfView.onPageChange = (n) => {
    if (state.syncScroll && !lock) { lock = true; textView.scrollToPage(n); setTimeout(() => { lock = false; }, 150); }
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
  renderTabs();
  renderToc();
  bus.emit('book:switch', { bookId: id });
}

function switchHome() {
  state.activeBookId = null;
  for (const t of state.tabs) t.wv.hidden = true;
  const home = document.getElementById('home-view');
  if (home) { home.style.display = ''; renderHome(); }
  renderTabs();
  renderToc();
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.bookId === id);
  if (i < 0) return;
  const [t] = state.tabs.splice(i, 1);
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
function showContextBar(sel) {
  hideContextBar();
  const actions = ui.registry.contextActions;
  if (!actions.length) return;
  const bar = document.createElement('div');
  bar.id = 'ctxbar';
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.addEventListener('click', () => { a.apply(sel.text, activeView()); hideContextBar(); });
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
  const r = sel.rect;
  bar.style.left = Math.min(r.left, innerWidth - bar.offsetWidth - 10) + 'px';
  bar.style.top = (r.top - 40) + 'px';
  lastSelection = sel;
}

function hideContextBar() { document.getElementById('ctxbar')?.remove(); }
document.addEventListener('mousedown', () => setTimeout(hideContextBar, 200));

/* ============================ 设置 / 插件管理器 ============================ */
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
    tog.className = 'toggle';
    const on = isEnabled(ext.id);
    tog.textContent = on ? '开' : '关';
    tog.classList.toggle('on', on);
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
  $('view-modes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.body.dataset.mode = b.dataset.mode;
    $('view-modes').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    bus.emit('view:mode', b.dataset.mode);
  });
  $('btn-sync').addEventListener('click', () => {
    state.syncScroll = !state.syncScroll;
    $('btn-sync').classList.toggle('active', state.syncScroll);
    toast(state.syncScroll ? '已开启同步滚动' : '已关闭同步滚动');
  });
  $('btn-spread').addEventListener('click', () => {
    const view = activeView();
    if (!view) return;
    $('btn-spread').classList.toggle('active');
    view.pdfView.setSpread($('btn-spread').classList.contains('active'));
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
    const name = prompt('文件夹名称：');
    if (!name || !name.trim()) return;
    await db.addFolder(state.db, { id: crypto.randomUUID(), name: name.trim(), parentId: null });
    await loadLibrary(); renderLibrary();
  });
  $('btn-batch').addEventListener('click', toggleBatch);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('settings-dialog').hidden = true; $('settings-mask').hidden = true;
      $('fn-tooltip').style.display = 'none'; hideContextBar();
    }
  });
  // 批量操作条
  const bar = document.createElement('div');
  bar.id = 'batch-bar';
  bar.innerHTML = '<button class="mini" data-action="move">移动到…</button><button class="mini" data-action="delete">删除</button>';
  $('library-panel').insertBefore(bar, $('library-panel').firstChild);
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#batch-bar')) return;
    const btn = e.target.closest('button'); if (!btn) return;
    const ids = [...document.querySelectorAll('.book-row .batch-check:checked')].map((c) => c.closest('.book-row').dataset.id);
    if (!ids.length) { toast('先勾选电子书'); return; }
    if (btn.dataset.action === 'delete') {
      if (!confirm('删除选中的 ' + ids.length + ' 本电子书（阅读器存储中的副本）？')) return;
      await db.deleteBooks(state.db, ids);
      ids.forEach((id) => { if (state.tabs.some((t) => t.bookId === id)) closeTab(id); });
      toast('已删除 ' + ids.length + ' 本');
    } else if (btn.dataset.action === 'move') {
      const f = await selectFolder();
      if (f !== undefined) { await db.moveBooks(state.db, ids, f); toast('已移动'); }
    }
    await loadLibrary(); renderLibrary(); renderHome();
  });
}

async function selectFolder() {
  const names = [{ id: null, name: '（书库根目录）' }, ...state.folders].map((f) => f.name).join('\n');
  const pick = prompt('输入目标文件夹名称（回车移动到书库根目录）：\n现有文件夹：\n' + names);
  if (pick === null) return undefined;
  const f = state.folders.find((x) => x.name === pick.trim());
  return f ? f.id : null;
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
          <div id="home-batch-bar" class="batch-bar" hidden>
            <button class="mini" data-action="move">移动到…</button>
            <button class="mini danger" data-action="delete">删除</button>
          </div>
          <button id="home-batch" class="mini">☑ 批量</button>
          <button id="home-new-folder" class="mini">＋ 文件夹</button>
          <button id="home-import" class="mini primary">⬆ 导入电子书</button>
        </div>
      </div>
      <div id="home-table-wrap">
        <div class="ht-head">
          <span class="htc-check"></span><span class="htc-cover"></span>
          <span class="htc-title">书名</span><span class="htc-author">作者</span>
          <span class="htc-pub">出版社</span><span class="htc-pages">页数</span>
          <span class="htc-folder">文件夹</span><span class="htc-actions"></span>
        </div>
        <div id="home-table"></div>
        <div id="home-empty" hidden>
          <div class="big">📖</div>
          <p>书库还是空的</p>
          <button id="home-empty-import" class="import-big">选择 .s2e 文件导入</button>
          <div class="drop-hint">也可以把 .s2e 文件拖到窗口任意位置</div>
        </div>
      </div>
    </div>
    <aside id="detail-panel" hidden></aside>`;
  $('workspace').appendChild(home);

  $('home-import').addEventListener('click', () => $('import-input').click());
  $('home-empty-import').addEventListener('click', () => $('import-input').click());
  $('home-new-folder').addEventListener('click', async () => {
    const name = prompt('文件夹名称：');
    if (!name || !name.trim()) return;
    await db.addFolder(state.db, { id: crypto.randomUUID(), name: name.trim(), parentId: null });
    await loadLibrary(); renderLibrary(); renderHome();
  });
  $('home-batch').addEventListener('click', () => toggleBatch());
  $('home-batch-bar').addEventListener('click', async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const ids = [...document.querySelectorAll('#home-table .ht-check:checked')]
      .map((c) => c.closest('.ht-row').dataset.id);
    if (!ids.length) { toast('先勾选电子书'); return; }
    if (btn.dataset.action === 'delete') {
      if (!confirm('删除选中的 ' + ids.length + ' 本电子书（阅读器存储中的副本）？')) return;
      await db.deleteBooks(state.db, ids);
      ids.forEach((id) => { if (state.tabs.some((t) => t.bookId === id)) closeTab(id); });
      toast('已删除 ' + ids.length + ' 本');
    } else if (btn.dataset.action === 'move') {
      const f = await selectFolder();
      if (f !== undefined) { await db.moveBooks(state.db, ids, f); toast('已移动'); }
    }
    await loadLibrary(); renderLibrary(); renderHome();
  });
}

function toggleBatch() {
  state.batchMode = !state.batchMode;
  document.body.classList.toggle('batch-mode', state.batchMode);
  $('btn-batch')?.classList.toggle('active', state.batchMode);
  $('home-batch')?.classList.toggle('active', state.batchMode);
  const bar = $('home-batch-bar'); if (bar) bar.hidden = !state.batchMode;
  renderLibrary();
  renderHome();
}

function renderHome() {
  const table = $('home-table');
  if (!table) return;
  table.innerHTML = '';
  const count = $('home-count');
  if (count) count.textContent = state.books.length + ' 本 · ' + state.folders.length + ' 个文件夹';
  const empty = $('home-empty');
  if (empty) empty.hidden = state.books.length > 0;

  for (const b of state.books) {
    const row = document.createElement('div');
    row.className = 'ht-row' + (b.id === selectedBookId ? ' selected' : '');
    row.dataset.id = b.id;
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/s2e-book', b.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    // 复选框外包占位 span：display:none 的 checkbox 会塌掉 grid 列，导致整行错位
    const chkWrap = document.createElement('span');
    chkWrap.className = 'htc-check';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'ht-check batch-check';
    chkWrap.appendChild(chk);
    row.appendChild(chkWrap);
    chk.addEventListener('click', (e) => e.stopPropagation());

    const cover = document.createElement('span');
    cover.className = 'b-cover c' + ((b.id.charCodeAt(0) + (b.id.charCodeAt(1) || 0)) % 5 + 1);
    cover.textContent = (b.meta.title || b.s2eName || '书').slice(0, 1);
    row.appendChild(cover);
    row.appendChild(cell('ht-title', b.meta.title || b.s2eName || '未命名'));
    row.appendChild(cell('ht-author', b.meta.author || ''));
    row.appendChild(cell('ht-pub', b.meta.publisher || ''));
    row.appendChild(cell('ht-pages', b.bookJson.pages ? b.bookJson.pages.length + ' 页' : ''));
    const folder = state.folders.find((f) => f.id === b.folderId);
    row.appendChild(cell('ht-folder', folder ? folder.name : '—'));
    row.appendChild(cell('ht-actions', ''));

    // 单击 = 选中（显示右侧详情）；双击 = 打开
    row.addEventListener('click', () => selectBook(b.id));
    row.addEventListener('dblclick', () => openBook(b.id));
    table.appendChild(row);
  }
  if (selectedBookId) renderDetail();
}

function cell(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

/* ---- 右侧详情面板（Zotero Info 风格：左标签右值，面板内编辑） ---- */
let selectedBookId = null;

function selectBook(id) {
  selectedBookId = id;
  renderHome();
  renderDetail();
}

function renderDetail() {
  const panel = $('detail-panel');
  const book = state.books.find((b) => b.id === selectedBookId);
  if (!panel) return;
  if (!book) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.hidden = false;
  const folder = state.folders.find((f) => f.id === book.folderId);
  const fmt = (ts) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');
  const ci = (book.id.charCodeAt(0) + (book.id.charCodeAt(1) || 0)) % 5 + 1;
  panel.innerHTML = `
    <div class="dp-head">
      <span class="dp-title">详细信息</span>
      <button class="mini" id="dp-close" title="关闭">✕</button>
    </div>
    <div class="dp-body">
      <div class="dp-cover c${ci}">${escapeHtml((book.meta.title || book.s2eName || '书').slice(0, 1))}</div>
      <h3 class="dp-book">${escapeHtml(book.meta.title || book.s2eName || '未命名')}</h3>
      ${dpRow('作者', book.meta.author)}
      ${dpRow('出版社', book.meta.publisher)}
      ${dpRow('版次', book.meta.edition)}
      ${dpRow('ISBN', book.meta.isbn)}
      ${dpRow('页数', book.bookJson.pages ? book.bookJson.pages.length + ' 页' : '—')}
      ${dpRow('文件夹', folder ? folder.name : '（书库根目录）')}
      ${dpRow('导入时间', fmt(book.importedAt))}
      ${book.progress && book.progress.page ? dpRow('上次阅读', 'PDF 第 ' + book.progress.page + ' 页') : ''}
    </div>
    <div class="dp-actions">
      <button class="mini primary" id="dp-edit">✎ 编辑</button>
      <button class="mini danger" id="dp-delete">删除</button>
    </div>`;
  $('dp-close').addEventListener('click', () => { selectedBookId = null; renderHome(); renderDetail(); });
  $('dp-edit').addEventListener('click', () => renderDetailEdit());
  $('dp-delete').addEventListener('click', async () => {
    if (!confirm('删除「' + (book.meta.title || book.s2eName) + '」？阅读器存储中的副本将被移除。')) return;
    await db.deleteBooks(state.db, [book.id]);
    if (state.tabs.some((t) => t.bookId === book.id)) closeTab(book.id);
    selectedBookId = null;
    await loadLibrary(); renderLibrary(); renderHome(); renderDetail();
    toast('已删除');
  });
}

function dpRow(label, value) {
  return `<div class="dp-row"><span class="dp-label">${label}</span><span class="dp-value">${escapeHtml(value || '—')}</span></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDetailEdit() {
  const panel = $('detail-panel');
  const book = state.books.find((b) => b.id === selectedBookId);
  if (!panel || !book) return;
  const folderOpts = '<option value="">（书库根目录）</option>'
    + state.folders.map((f) => `<option value="${f.id}" ${f.id === book.folderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
  panel.innerHTML = `
    <div class="dp-head">
      <span class="dp-title">编辑信息</span>
      <button class="mini" id="dp-cancel" title="取消">✕</button>
    </div>
    <div class="dp-body">
      ${dpEdit('书名', 'mf-title', book.meta.title || '')}
      ${dpEdit('作者', 'mf-author', book.meta.author || '')}
      ${dpEdit('出版社', 'mf-publisher', book.meta.publisher || '')}
      ${dpEdit('版次', 'mf-edition', book.meta.edition || '')}
      ${dpEdit('ISBN', 'mf-isbn', book.meta.isbn || '')}
      <div class="dp-row"><span class="dp-label">文件夹</span><span class="dp-value"><select id="mf-folder" class="dp-input">${folderOpts}</select></span></div>
    </div>
    <div class="dp-actions">
      <button class="mini" id="dp-cancel2">取消</button>
      <button class="mini primary" id="dp-save">保存</button>
    </div>`;
  const close = () => renderDetail();
  $('dp-cancel').addEventListener('click', close);
  $('dp-cancel2').addEventListener('click', close);
  $('dp-save').addEventListener('click', async () => {
    book.meta.title = $('mf-title').value.trim() || book.s2eName || '未命名';
    book.meta.author = $('mf-author').value.trim();
    book.meta.publisher = $('mf-publisher').value.trim();
    book.meta.edition = $('mf-edition').value.trim();
    book.meta.isbn = $('mf-isbn').value.trim();
    book.folderId = $('mf-folder').value || null;
    await db.updateBook(state.db, book);
    await loadLibrary(); renderLibrary(); renderHome();
    refreshTabTitles();
    renderDetail();
    toast('已保存书籍信息');
  });
}

function dpEdit(label, id, value) {
  return `<div class="dp-row"><span class="dp-label">${label}</span><span class="dp-value"><input id="${id}" class="dp-input" value="${escapeHtml(value || '')}"></span></div>`;
}
/* ============================ 工具 ============================ */
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
