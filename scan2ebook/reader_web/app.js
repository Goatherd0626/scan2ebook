/* scan2ebook 阅读器主应用：书库/标签页/双视图/护眼/搜索/书签/进度 */
import * as db from './db.js';
import { buildRenderModel, PdfView, TextView } from './views.js';

const $ = (id) => document.getElementById(id);
const pdfjs = window.pdfjsLib;

const state = {
  db: null,
  books: [],
  folders: [],
  tabs: [],                 // [{bookId, wv, pdfView, textView, model}]
  activeBookId: null,
  syncScroll: false,
  batchMode: false,
  searchMatches: [],
  searchIdx: -1,
  settings: (() => {
    try {
      return Object.assign({ eye: false, dark: false, brightness: 100, warmth: 0,
        fontSize: 17, lineH: 1.9, width: 42 }, JSON.parse(localStorage.getItem('s2e-settings') || '{}'));
    } catch (e) {
      return { eye: false, dark: false, brightness: 100, warmth: 0, fontSize: 17, lineH: 1.9, width: 42 };
    }
  })(),
};

/* ============================ 初始化 ============================ */
async function init() {
  state.db = await db.openDB();
  await loadLibrary();
  renderLibrary();
  bindTopbar();
  bindEyeCare();
  bindDragDrop();
  const q = new URLSearchParams(location.search).get('book');
  if (q) openBook(q);
  else showEmptyHint();
}

async function loadLibrary() {
  state.books = await db.getBooks(state.db);
  state.folders = await db.getFolders(state.db);
}

/* ============================ 书库 ============================ */
function renderLibrary() {
  const tree = $('library-tree');
  tree.innerHTML = '';
  if (state.folders.length === 0 && state.books.length === 0) {
    tree.appendChild(emptyLib());
    return;
  }
  const rootBooks = state.books.filter((b) => !b.folderId);
  appendBookGroup(tree, rootBooks);
  const folderRoots = state.folders.filter((f) => !f.parentId);
  for (const f of folderRoots) appendFolder(tree, f);
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
  const hint = document.createElement('div');
  hint.className = 'drop-hint';
  hint.textContent = '也可以把 .s2e 文件直接拖到窗口任意位置';
  d.appendChild(hint);
  return d;
}

function appendBookGroup(parent, books) {
  for (const b of books) parent.appendChild(bookRow(b));
}

function bookRow(b) {
  const row = document.createElement('div');
  row.className = 'book-row';
  row.dataset.id = b.id;
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.className = 'batch-check';
  row.appendChild(chk);
  const t = document.createElement('span');
  t.className = 'b-title';
  t.textContent = b.meta.title || b.s2eName || '未命名';
  t.title = '双击编辑标题';
  t.addEventListener('dblclick', () => startMetaEdit(row, b, t));
  row.appendChild(t);
  const meta = document.createElement('span');
  meta.className = 'b-meta';
  meta.textContent = (b.meta.author || '').slice(0, 10) + ' · ' + (b.bookJson.pages ? b.bookJson.pages.length : '?') + '页';
  row.appendChild(meta);
  row.addEventListener('click', (e) => {
    if (state.batchMode) { chk.checked = !chk.checked; return; }
    if (e.target !== chk) openBook(b.id);
  });
  chk.addEventListener('click', (e) => e.stopPropagation());
  return row;
}

function startMetaEdit(row, book, titleEl) {
  const input = document.createElement('input');
  input.className = 'b-title-input';
  input.value = book.meta.title || '';
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const done = async () => {
    book.meta.title = input.value.trim() || book.s2eName || '未命名';
    await db.updateBook(state.db, book);
    renderLibrary();
    refreshTabTitles();
    toast('书名已更新');
  };
  input.addEventListener('blur', done);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') input.blur(); });
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
  x.title = '删除文件夹（其中的书移到书库根目录）';
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
  const subFolders = state.folders.filter((f) => f.parentId === folder.id);
  const subBooks = state.books.filter((b) => b.folderId === folder.id);
  for (const f of subFolders) appendFolder(children, f);
  appendBookGroup(children, subBooks);
  if (subFolders.length || subBooks.length) parent.appendChild(children);
}

function startFolderRename(row, folder, nameEl) {
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

/* ============================ 导入 .s2e ============================ */
async function importFile(file) {
  const zip = await JSZip.loadAsync(file);
  const j = zip.file('book.json');
  if (!j) throw new Error('压缩包内缺少 book.json');
  const bookJson = JSON.parse(await j.async('string'));
  let pdfEntry = zip.file('book.pdf');
  if (!pdfEntry) pdfEntry = zip.file(/\.pdf$/i)[0];
  if (!pdfEntry) throw new Error('压缩包内缺少 book.pdf');
  const pdfBlob = await pdfEntry.async('blob');
  const id = crypto.randomUUID();
  const book = {
    id, s2eName: file.name.replace(/\.s2e$/i, ''), importedAt: Date.now(),
    folderId: null,
    meta: Object.assign({ title: file.name.replace(/\.s2e$/i, '') }, bookJson.book || {}),
    bookJson, pdfBlob, bookmarks: [], progress: null,
  };
  await db.addBook(state.db, book);
  await loadLibrary();
  renderLibrary();
  openBook(id);
  toast('已导入「' + (book.meta.title || book.s2eName) + '」');
  return id;
}

function bindDragDrop() {
  const ov = (e) => { e.preventDefault(); };
  document.addEventListener('dragover', ov);
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files || []) {
      if (/\.(s2e|zip)$/i.test(f.name)) importFile(f).catch((err) => toast('导入失败：' + err.message));
    }
  });
}

/* ============================ 标签页 ============================ */
function renderTabs() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  for (const t of state.tabs) {
    const book = state.books.find((b) => b.id === t.bookId);
    if (!book) continue;
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.bookId === state.activeBookId ? ' active' : '');
    const title = document.createElement('span');
    title.textContent = book.meta.title || book.s2eName || '书';
    title.style.overflow = 'hidden'; title.style.textOverflow = 'ellipsis';
    const x = document.createElement('span');
    x.className = 'tab-x'; x.textContent = '×';
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.bookId); });
    btn.append(title, x);
    btn.addEventListener('click', () => switchTab(t.bookId));
    tabs.appendChild(btn);
  }
  if (!state.tabs.length) tabs.innerHTML = '<span style="color:var(--ink-3);font-size:12px;padding:4px">书库中选择一本书打开</span>';
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
  const textView = new TextView(wv.querySelector('.text-panel'));
  textView.load(model, book.meta);
  const pdfPromise = pdfjs.getDocument({ data: book.pdfBlob }).promise;
  pdfPromise.then((doc) => pdfView.load(doc));
  // 同步滚动与跳转
  const view = { bookId: book.id, wv, pdfView, textView, model, pdfPromise };
  let lock = false;
  textView.onPageChange = (n) => {
    if (state.syncScroll && !lock) { lock = true; pdfView.gotoPage(n); setTimeout(() => { lock = false; }, 150); }
  };
  pdfView.onPageChange = (n) => {
    if (state.syncScroll && !lock) { lock = true; textView.scrollToPage(n); setTimeout(() => { lock = false; }, 150); }
  };
  wv.querySelector('.jump[data-dir="text"]').addEventListener('click', () => textView.scrollToPage(pdfView.currentPage || 1));
  wv.querySelector('.jump[data-dir="pdf"]').addEventListener('click', () => pdfView.gotoPage(textView.currentPage || 1));
  // 进度记忆
  textView.onScroll = debounce((n) => { saveProgress(book.id, n); }, 900);
  return view;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function openBook(id) {
  const exist = state.tabs.find((t) => t.bookId === id);
  if (exist) { switchTab(id); return; }
  const book = state.books.find((b) => b.id === id);
  if (!book) return;
  const view = createBookView(book);
  state.tabs.push(view);
  renderTabs();
  switchTab(id);
  // 恢复进度
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
  const view = state.tabs.find((t) => t.bookId === id);
  renderToc(view);
  if (view) setTimeout(() => view.textView._updatePageFromScroll(), 100);
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.bookId === id);
  if (i < 0) return;
  const [t] = state.tabs.splice(i, 1);
  t.wv.remove();
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

/* ============================ 目录 / 书签 ============================ */
function renderToc(view) {
  const tocList = $('toc-list');
  tocList.innerHTML = '';
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
    tocList.appendChild(a);
  }
}

function collectHeadings(pages) {
  const out = [];
  for (const pg of pages) for (const it of pg.items) {
    if (it.type === 'heading') out.push({ number: it.number, text: it.text, level: it.level, pdf_page: pg.pdf_page });
  }
  return out;
}

function renderBmList() {
  const list = $('bm-list');
  list.innerHTML = '';
  const view = state.tabs.find((t) => t.bookId === state.activeBookId);
  const book = state.books.find((b) => b.id === state.activeBookId);
  if (!view || !book || !book.bookmarks || !book.bookmarks.length) {
    list.innerHTML = '<div style="color:var(--ink-3);padding:10px">暂无书签（🔖 为当前页加书签）</div>';
    return;
  }
  for (const bm of book.bookmarks) {
    const row = document.createElement('div');
    row.className = 'bm-item';
    const txt = document.createElement('span');
    txt.textContent = bm.snippet || ('PDF 第 ' + bm.page + ' 页');
    txt.style.overflow = 'hidden'; txt.style.textOverflow = 'ellipsis';
    const pg = document.createElement('span');
    pg.className = 'bm-page'; pg.textContent = 'P' + bm.page;
    const x = document.createElement('span');
    x.className = 'bm-x'; x.textContent = '✕';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      book.bookmarks = book.bookmarks.filter((b) => b.id !== bm.id);
      await db.updateBook(state.db, book);
      renderBmList();
    });
    row.append(txt, pg, x);
    row.addEventListener('click', () => { view.pdfView.gotoPage(bm.page); view.textView.scrollToPage(bm.page); });
    list.appendChild(row);
  }
}

async function addBookmark() {
  const book = state.books.find((b) => b.id === state.activeBookId);
  const view = state.tabs.find((t) => t.bookId === state.activeBookId);
  if (!book || !view) return;
  const page = view.textView.currentPage || view.pdfView.currentPage || 1;
  const anchor = view.textView.pageAnchors.get(page);
  const snippet = anchor ? (anchor.textContent || '').trim().slice(0, 40) : '';
  book.bookmarks = book.bookmarks || [];
  book.bookmarks.push({ id: crypto.randomUUID(), page, snippet, at: Date.now() });
  await db.updateBook(state.db, book);
  renderBmList();
  toast('已添加书签：PDF 第 ' + page + ' 页');
}

/* ============================ 进度 ============================ */
async function saveProgress(bookId, page) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;
  book.progress = { page, at: Date.now() };
  await db.updateBook(state.db, book);
}

/* ============================ 搜索 ============================ */
function doSearch(query) {
  const view = state.tabs.find((t) => t.bookId === state.activeBookId);
  if (!view) { $('search-info').textContent = ''; return; }
  clearSearchMarks();
  state.searchMatches = [];
  state.searchIdx = -1;
  const q = query.trim();
  if (!q) { $('search-info').textContent = ''; return; }
  const holder = view.textView.holder;
  const ql = q.toLowerCase();
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const idx = node.textContent.toLowerCase().indexOf(ql);
    if (idx < 0) continue;
    const mark = document.createElement('mark');
    mark.className = 'hit';
    const after = node.splitText(idx);
    after.data = after.data.substring(q.length);
    mark.textContent = q;
    node.parentNode.insertBefore(mark, after);
    state.searchMatches.push(mark);
  }
  $('search-info').textContent = state.searchMatches.length + ' 处';
  jumpSearch(0);
}

function clearSearchMarks() {
  document.querySelectorAll('#text-content mark.hit').forEach((m) => {
    const p = m.parentNode;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  });
}

function jumpSearch(rel) {
  if (!state.searchMatches.length) return;
  state.searchIdx = (state.searchIdx + rel + state.searchMatches.length) % state.searchMatches.length;
  const m = state.searchMatches[state.searchIdx];
  document.querySelectorAll('mark.hit.current').forEach((x) => x.classList.remove('current'));
  m.classList.add('current');
  m.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ============================ 护眼 / 阅读环境 ============================ */
function mixColor(hex1, hex2, t) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const a = p(hex1), b = p(hex2);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function applySettings() {
  const s = state.settings;
  document.body.classList.toggle('dark', s.dark);
  const warm = s.eye ? Math.max(45, s.warmth) : s.warmth;
  const paper = s.dark ? '#1f1e1a' : mixColor('#f7f1e4', '#ecd4a6', warm / 100);
  const ink = s.dark ? '#d8d0bf' : mixColor('#3a3126', '#57452a', warm / 100);
  const root = document.documentElement.style;
  root.setProperty('--paper', paper);
  root.setProperty('--ink', ink);
  root.setProperty('--font-size', s.fontSize + 'px');
  root.setProperty('--line-h', s.lineH);
  root.setProperty('--max-width', s.width + 'rem');
  document.body.style.filter = 'brightness(' + (s.brightness / 100) + ')';
  localStorage.setItem('s2e-settings', JSON.stringify(s));
  // 同步面板控件
  $('ec-eye').textContent = s.eye ? '开' : '关';
  $('ec-eye').classList.toggle('on', s.eye);
  $('ec-dark').textContent = s.dark ? '开' : '关';
  $('ec-dark').classList.toggle('on', s.dark);
  $('ec-brightness').value = s.brightness;
  $('ec-warmth').value = s.warmth;
  $('ec-font').value = s.fontSize;
  $('ec-lineh').value = s.lineH;
  $('ec-width').value = s.width;
}

function bindEyeCare() {
  $('btn-eyecare').addEventListener('click', () => { $('eyecare-panel').hidden = !$('eyecare-panel').hidden; });
  $('ec-eye').addEventListener('click', () => { state.settings.eye = !state.settings.eye; applySettings(); });
  $('ec-dark').addEventListener('click', () => { state.settings.dark = !state.settings.dark; applySettings(); });
  $('ec-brightness').addEventListener('input', (e) => { state.settings.brightness = +e.target.value; applySettings(); });
  $('ec-warmth').addEventListener('input', (e) => { state.settings.warmth = +e.target.value; applySettings(); });
  $('ec-font').addEventListener('input', (e) => { state.settings.fontSize = +e.target.value; applySettings(); });
  $('ec-lineh').addEventListener('input', (e) => { state.settings.lineH = +e.target.value; applySettings(); });
  $('ec-width').addEventListener('input', (e) => { state.settings.width = +e.target.value; applySettings(); });
  $('ec-reset').addEventListener('click', () => {
    state.settings = { eye: false, dark: false, brightness: 100, warmth: 0, fontSize: 17, lineH: 1.9, width: 42 };
    applySettings();
  });
}

/* ============================ 顶栏 ============================ */
function bindTopbar() {
  $('view-modes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.body.dataset.mode = b.dataset.mode;
    $('view-modes').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  });
  $('btn-sync').addEventListener('click', () => {
    state.syncScroll = !state.syncScroll;
    $('btn-sync').classList.toggle('active', state.syncScroll);
    toast(state.syncScroll ? '已开启同步滚动' : '已关闭同步滚动');
  });
  $('btn-spread').addEventListener('click', () => {
    const view = state.tabs.find((t) => t.bookId === state.activeBookId);
    if (!view) return;
    $('btn-spread').classList.toggle('active');
    view.pdfView.setSpread($('btn-spread').classList.contains('active'));
  });
  $('btn-bookmark').addEventListener('click', addBookmark);
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
    if (e.key === 'Escape') { $('eyecare-panel').hidden = true; $('fn-tooltip').style.display = 'none'; }
  });
  // 批量操作：移动/删除
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#batch-bar')) return;
    const btn = e.target.closest('button'); if (!btn) return;
    const ids = [...document.querySelectorAll('.book-row .batch-check:checked')].map((c) => c.closest('.book-row').dataset.id);
    if (!ids.length) { toast('先勾选电子书'); return; }
    if (btn.dataset.action === 'delete') {
      if (!confirm('删除选中的 ' + ids.length + ' 本电子书（阅读器存储中的副本）？')) return;
      await db.deleteBooks(state.db, ids);
      ids.forEach((id) => { const i = state.tabs.findIndex((t) => t.bookId === id); if (i >= 0) closeTab(id); });
      toast('已删除 ' + ids.length + ' 本');
    } else if (btn.dataset.action === 'move') {
      const f = await selectFolder();
      if (f !== undefined) { await db.moveBooks(state.db, ids, f); toast('已移动'); }
    }
    await loadLibrary(); renderLibrary();
  });
  // 批量操作条（插入到侧边栏顶部）
  const bar = document.createElement('div');
  bar.id = 'batch-bar';
  bar.innerHTML = '<button class="mini" data-action="move">移动到…</button><button class="mini" data-action="delete">删除</button>';
  $('library-panel').insertBefore(bar, $('library-panel').firstChild);
  // 搜索
  $('search-input').addEventListener('input', (e) => doSearch(e.target.value));
  $('search-next').addEventListener('click', () => jumpSearch(1));
  $('search-prev').addEventListener('click', () => jumpSearch(-1));
  // 目录/书签切换
  $('toc-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const t = b.dataset.tt;
    $('toc-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    $('toc-list').hidden = t !== 'toc';
    $('bm-list').hidden = t !== 'bm';
    if (t === 'bm') renderBmList();
  });
}

async function selectFolder() {
  const opts = [{ id: null, name: '（书库根目录）' }, ...state.folders];
  const names = opts.map((f) => f.name).join('\n');
  const pick = prompt('输入目标文件夹名称（回车移动到书库根目录）：\n现有文件夹：\n' + names);
  if (pick === null) return undefined;
  const f = state.folders.find((x) => x.name === pick.trim());
  return f ? f.id : null;
}

/* ============================ 工具 ============================ */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

init();
