import { useEffect, useState, type DragEvent, type MouseEvent } from 'react';
import { readerBridge } from '../core/app.js';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Icon } from './Icon';
import { continueReading, filterLibrary, readingPosition, type BookRecord, type FolderRecord, type LibraryFilter } from './library-model';

type LibraryState = { books: BookRecord[]; folders: FolderRecord[]; selectedIds: string[]; selectedFolderId: string | null; expandedIds: string[] };

function savedView(): 'shelf' | 'list' {
  try { return localStorage.getItem('s2e-library-view') === 'list' ? 'list' : 'shelf'; } catch { return 'shelf'; }
}

export function LibraryPage() {
  const [library, setLibrary] = useState<LibraryState>(() => readerBridge.snapshot());
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [status, setStatus] = useState<LibraryFilter['status']>('all');
  const [sort, setSort] = useState<LibraryFilter['sort']>('recent');
  const [view, setView] = useState(savedView);
  useEffect(() => readerBridge.subscribe(() => setLibrary(readerBridge.snapshot())), []);
  useEffect(() => {
    if (folderId && !library.folders.some((folder) => folder.id === folderId)) setFolderId(null);
  }, [folderId, library.folders]);
  useEffect(() => {
    const reset = () => { setQuery(''); setFolderId(null); setStatus('all'); };
    window.addEventListener('s2e:library-home', reset);
    return () => window.removeEventListener('s2e:library-home', reset);
  }, []);
  const { books, folders, selectedIds } = library;
  const selected = new Set(selectedIds);
  const filtered = filterLibrary(books, folders, { query, folderId, sort, status });
  const recent = continueReading(books);
  const recentPosition = recent && readingPosition(recent);
  const folder = folders.find((item) => item.id === folderId);

  function setLayout(next: 'shelf' | 'list') {
    setView(next);
    try { localStorage.setItem('s2e-library-view', next); } catch {}
  }
  function allowDrop(event: DragEvent) {
    if (event.dataTransfer.types.includes('text/s2e-book')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  }
  function choose(event: MouseEvent, book: BookRecord) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) readerBridge.selectBookOnly(event, book.id);
    else readerBridge.openBook(book.id);
  }
  function clearFilters() { setQuery(''); setFolderId(null); setStatus('all'); }

  return <>
    <div className="home-main editorial-library">
      <header className="library-heading">
        <div><div className="section-kicker"><span className="kicker-line" />YOUR PERSONAL LIBRARY</div><h1>我的书库<span className="library-total">{books.length.toString().padStart(2, '0')}</span></h1><p>随时打开，接着上次读。</p></div>
        <Button id="home-convert" className="primary-action add-book-action" onClick={readerBridge.importBook}><Icon name="plus" size={18} />添加书籍</Button>
      </header>

      {recent && recentPosition && !query && !folderId && <section className="continue-card" aria-label="继续上次阅读">
        <div className="continue-copy"><span className="section-kicker">BACK TO YOUR BOOK</span><h2>{recent.meta.title || recent.s2eName}</h2><p>{recent.meta.author || '继续上次的阅读位置'}<span className="dot-separator">·</span>PDF 第 {recentPosition.page} 页</p>
          <Button className="continue-button" onClick={() => readerBridge.openBook(recent.id)}>继续阅读<Icon name="arrow" size={18} /></Button></div>
        <div className="continue-progress"><span className="progress-caption">阅读位置</span><strong>{recentPosition.percent}<small>%</small></strong><div className="continue-track"><span style={{ width: `${recentPosition.percent}%` }} /></div><span>第 {recentPosition.position} / {recentPosition.total} 页</span></div>
        <span className="continue-decoration" aria-hidden="true">↗</span>
      </section>}

      {!books.length ? <section id="home-empty" className="library-onboarding" aria-label="添加第一本书">
        <div className="onboarding-copy"><span className="section-kicker">START WITH ONE BOOK</span><h2>把纸页，<br />读进日常<span>。</span></h2><p>拖入扫描 PDF，或导入已有的电子书。<br />搜索、批注、核对原页，都在这张书桌上。</p><Button id="home-empty-import" className="primary-action" onClick={readerBridge.importBook}>添加第一本书<Icon name="diagonal" size={19} /></Button><span className="onboarding-formats">支持 PDF · .s2e · ZIP</span></div>
        <div className="onboarding-sheet" aria-hidden="true"><span className="sheet-corner">PDF</span><span className="sheet-title">每一页<br />都有来处。</span><div className="sheet-lines"><i /><i /><i /></div><span className="sheet-arrow">↗</span></div>
      </section> : <>
        <div className="library-controls">
          <div className="library-tabs" role="group" aria-label="阅读状态筛选">{([['all', '全部书籍'], ['reading', '在读'], ['unread', '未开始']] as const).map(([value, label]) => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}{value === 'all' && <span>{books.length}</span>}</button>)}</div>
          <div className="library-control-actions"><label className="library-search"><Icon name="search" size={17} /><Input id="library-filter" type="search" value={query} placeholder="搜索书名、作者、文件夹" aria-label="搜索书库" onChange={(e) => setQuery(e.target.value)} /><kbd>⌘ F</kbd></label><label className="library-sort"><span className="sr-only">书籍排序</span><select aria-label="书籍排序" value={sort} onChange={(e) => setSort(e.target.value as LibraryFilter['sort'])}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">书名排序</option></select></label><div className="layout-toggle" role="group" aria-label="书库布局"><Button variant="ghost" size="icon" aria-label="书架视图" aria-pressed={view === 'shelf'} onClick={() => setLayout('shelf')}><Icon name="grid" size={17} /></Button><Button variant="ghost" size="icon" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setLayout('list')}><Icon name="list" size={19} /></Button></div></div>
        </div>
        <div className="collection-line"><div className="collection-chips"><button className={!folderId ? 'active' : ''} onClick={() => setFolderId(null)} onDragOver={allowDrop} onDrop={(event) => readerBridge.dropBooks(event, null)}>全部位置</button>{folders.map((item) => <button key={item.id} className={folderId === item.id ? 'active' : ''} onClick={() => setFolderId(item.id)} onDragOver={allowDrop} onDrop={(event) => readerBridge.dropBooks(event, item.id)}><Icon name="folder" size={14} />{item.name}</button>)}</div><Button id="home-new-folder" className="new-collection" variant="ghost" size="sm" onClick={readerBridge.createFolder}><Icon name="plus" size={15} />新建文件夹</Button></div>
        <div className="results-heading"><span>{query ? `“${query}”的搜索结果` : folder?.name || '所有书籍'}<small>{filtered.length} 本</small></span>{(query || folderId || status !== 'all') && <button className="clear-filter" onClick={clearFilters}>清除筛选<Icon name="close" size={13} /></button>}</div>
        {folder && <div className="folder-context"><span><Icon name="folder" size={16} />{folder.name}</span><Button variant="ghost" size="sm" onClick={() => readerBridge.showFolderDetails(folder.id)}>文件夹设置<Icon name="more" size={17} /></Button></div>}
        <div id="home-table-wrap" data-layout={view}>
          {view === 'list' && <div className="book-list-head" aria-hidden="true"><span>书籍</span><span>阅读位置</span><span>页数</span><span /></div>}
          <div id="home-table" className={view === 'shelf' ? 'book-grid' : 'book-list'} role="list" aria-label="电子书列表">{filtered.map((book) => {
            const title = book.meta.title || book.s2eName;
            const progress = readingPosition(book);
            const color = book.id.charCodeAt(book.id.length - 1) % 6;
            return <article key={book.id} className={'ht-row book-item' + (selected.has(book.id) ? ' selected' : '')} data-id={book.id} data-tree-hidden="0" role="listitem" draggable={selected.has(book.id)} onDragStart={(event) => readerBridge.dragBooks(event, book.id)}>
              <button className={'book-selection' + (selected.has(book.id) ? ' checked' : '')} role="checkbox" aria-checked={selected.has(book.id)} aria-label={'选择 ' + title} onClick={() => readerBridge.toggleBookSelection(book.id)}><Icon name="check" size={13} /></button>
              <button className={'book-cover cover-' + color} draggable aria-label={'阅读 ' + title} onClick={(event) => choose(event, book)}><span className="cover-index">S2E / {progress.total.toString().padStart(2, '0')}</span><span className="cover-title">{title}</span><span className="cover-author">{book.meta.author || '个人藏书'}</span><span className="cover-sign" aria-hidden="true">↗</span></button>
              <div className="book-info"><button className="ht-title book-title" onClick={(event) => choose(event, book)}>{title}</button><p className="ht-author">{book.meta.author || '作者未标注'}</p><span className="ht-pub sr-only">{book.meta.publisher}</span></div>
              <div className="book-reading"><div className="book-progress-line"><span style={{ width: `${progress.percent}%` }} /></div><span>{progress.position ? `PDF 第 ${progress.page} 页 · ${progress.percent}%` : '还未开始'}</span></div>
              <span className="ht-pages book-pages">{progress.total} 页</span><span className="ht-folder sr-only">{folders.find((item) => item.id === book.folderId)?.name}</span>
              <details className="book-more" name="book-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label={'更多操作 ' + title}><Icon name="more" size={18} /></summary><div className="book-menu"><button onClick={(event) => { event.currentTarget.closest('details')!.open = false; readerBridge.showBookDetails(book.id); }}>查看详情</button><button onClick={(event) => { event.currentTarget.closest('details')!.open = false; readerBridge.showBookDetails(book.id); readerBridge.moveSelection(); }}>移动到文件夹</button><button className="danger" onClick={(event) => { event.currentTarget.closest('details')!.open = false; readerBridge.showBookDetails(book.id); readerBridge.deleteSelection(); }}>移出书库</button></div></details>
            </article>;
          })}</div>
          {!filtered.length && <div className="library-no-results"><Icon name="search" size={30} /><h3>这里还没有符合条件的书。</h3><p>换个关键词，或取消当前筛选再看看。</p><Button variant="outline" onClick={clearFilters}>清除筛选</Button></div>}
        </div>
        <footer className="library-bottom-note"><span><Icon name="lock" size={13} />书库保存在本机</span><span>拖动书籍可移入上方文件夹</span></footer>
      </>}
      <div id="home-batch-bar" className="shelf-selection-bar" hidden={!selectedIds.length}><span>已选 {selectedIds.length} 本</span><button onClick={readerBridge.selectAllVisible}>全选</button><i /><Button variant="ghost" onClick={readerBridge.moveSelection}>移动到…</Button><Button id="home-delete" variant="destructive" onClick={readerBridge.deleteSelection}>移出书库</Button><button className="selection-dismiss" aria-label="取消选择" onClick={readerBridge.clearSelection}><Icon name="close" size={17} /></button></div>
    </div><aside id="detail-panel" />
  </>;
}
