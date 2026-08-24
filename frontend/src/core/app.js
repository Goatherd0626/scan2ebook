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
  injectCore(appCtx, { db, state, getView: () => activeView(), toast, openBook: (id) => openBook(id) });

  bindTopbar();
  bindDragDrop();
  bindSettingsDialog();

  // 激活插件（按启停状态）
  for (const ext of listExtensions()) activateExtension(ext.id, appCtx);

  bus.emit('app:ready', state);
  renderToolbarWidgets();

  const q = new URLSearchParams(location.search).get('book');
  if (q) openBook(q);
  else showEmptyHint();
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
  for (const t of state.tabs) t.wv.hidden = t.bookId !== id;
  renderTabs();
  renderToc();
  bus.emit('book:switch', { bookId: id });
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.bookId === id);
  if (i < 0) return;
  const [t] = state.tabs.splice(i, 1);
  t.wv.remove();
  bus.emit('book:close', { bookId: id });
  if (state.activeBookId === id) {
    const next = state.tabs[Math.min(i, state.tabs.length - 1)];
    if (next) switchTab(next.bookId); else { state.activeBookId = null; showEmptyHint(); }
  }
  renderTabs();
}

function showEmptyHint() {
  const ws = $('workspace');
  const d = document.createElement('div');
  d.id = 'empty-hint';
  d.innerHTML = '<div class="big">📖</div><div>把 .s2e 电子书包拖进来开始阅读<br>或在书库中打开已有电子书</div>';
  const btn = document.createElement('button');
  btn.className = 'import-big';
  btn.textContent = '选择 .s2e 文件导入';
  btn.addEventListener('click', () => $('import-input').click());
  d.appendChild(btn);
  ws.innerHTML = '';
  ws.appendChild(d);
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
  $('btn-batch').addEventListener('click', () => {
    state.batchMode = !state.batchMode;
    document.body.classList.toggle('batch-mode', state.batchMode);
    $('btn-batch').classList.toggle('active', state.batchMode);
    if (!state.batchMode) renderLibrary();
  });
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
    await loadLibrary(); renderLibrary();
  });
}

async function selectFolder() {
  const names = [{ id: null, name: '（书库根目录）' }, ...state.folders].map((f) => f.name).join('\n');
  const pick = prompt('输入目标文件夹名称（回车移动到书库根目录）：\n现有文件夹：\n' + names);
  if (pick === null) return undefined;
  const f = state.folders.find((x) => x.name === pick.trim());
  return f ? f.id : null;
}

/* ============================ 工具 ============================ */
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
