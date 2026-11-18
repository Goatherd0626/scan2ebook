import { useEffect, useState, type DragEvent, type MouseEvent } from 'react';
import { readerBridge } from '../core/app.js';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Icon } from './Icon';
import { FolderCard } from './FolderCard';
import { CardActions } from './CardActions';
import { continueReading, filterFolders, filterLibrary, folderBookCount, folderTrail, readingPosition, type BookRecord, type FolderRecord, type LibraryFilter } from './library-model';

type LibraryState = { books: BookRecord[]; folders: FolderRecord[]; selectedIds: string[] };

function savedView(): 'shelf' | 'list' {
  try { return localStorage.getItem('s2e-library-view') === 'list' ? 'list' : 'shelf'; } catch { return 'shelf'; }
}

export function LibraryPage() {
  const [library, setLibrary] = useState<LibraryState>(readerBridge.snapshot);
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [status, setStatus] = useState<LibraryFilter['status']>('all');
  const [sort, setSort] = useState<LibraryFilter['sort']>('recent');
  const [view, setView] = useState(savedView);
  useEffect(() => readerBridge.subscribe(() => setLibrary(readerBridge.snapshot())), []);
  useEffect(() => { if (folderId && !library.folders.some((folder) => folder.id === folderId)) setFolderId(null); }, [folderId, library.folders]);
  useEffect(() => {
    const reset = () => { setQuery(''); setFolderId(null); setStatus('all'); };
    window.addEventListener('s2e:library-home', reset);
    return () => window.removeEventListener('s2e:library-home', reset);
  }, []);
  const { books, folders, selectedIds } = library;
  const selected = new Set(selectedIds);
  const filter = { query: query.trim(), folderId, sort, status };
  const filtered = filterLibrary(books, folders, filter);
  const visibleSelection = filtered.filter(book => selected.has(book.id)).map(book => book.id);
  const trail = folderTrail(folders, folderId);
  const visibleFolders = filterFolders(folders, filter);
  const hasFilters = Boolean(filter.query || status !== 'all');
  const hasResults = Boolean(filtered.length || visibleFolders.length);
  const recent = continueReading(books);
  const recentPosition = recent && readingPosition(recent);
  const isEmpty = !books.length && !folders.length;

  function setLayout(next: 'shelf' | 'list') {
    setView(next);
    try { localStorage.setItem('s2e-library-view', next); } catch {}
  }
  function choose(event: MouseEvent, book: BookRecord) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) readerBridge.selectBook(event, book.id);
    else readerBridge.openBook(book.id);
  }
  function openFolder(id: string | null) { setFolderId(id); setQuery(''); readerBridge.clearSelection(); }
  function clearFilters() { setQuery(''); setStatus('all'); }
  function allowBookDrop(event: DragEvent) {
    if (event.dataTransfer.types.includes('text/s2e-book')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  }

  return <>
    <div className="home-main compact-library">
      <header className="library-heading">
        <div className="library-location"><nav className="library-breadcrumbs" aria-label="书库位置">
          {folderId ? <button onClick={() => openFolder(null)} onDragOver={allowBookDrop} onDrop={(event) => readerBridge.dropBooks(event, null)}>书库</button> : <h1>书库</h1>}
          {trail.map((folder, index) => <span key={folder.id}><Icon name="arrow" size={13} />{index === trail.length - 1 ? <h1 aria-current="page">{folder.name}</h1> : <button onClick={() => openFolder(folder.id)}>{folder.name}</button>}</span>)}
        </nav>{!isEmpty && <span className="library-total">{filtered.length} 本</span>}</div>
        <Button id="home-new-folder" variant="ghost" className="new-collection" onClick={() => readerBridge.createFolder(folderId)}><Icon name="plus" size={16} />新建文件夹</Button>
      </header>
      {recent && recentPosition && !hasFilters && !folderId && <section className="continue-row" aria-label="继续上次阅读"><Icon name="book" size={20} /><button className="continue-title" onClick={() => readerBridge.openBook(recent.id)}>{recent.meta.title || recent.s2eName}</button><span>第 {recentPosition.page} 页</span><Button className="continue-button" variant="ghost" onClick={() => readerBridge.openBook(recent.id)}>继续阅读<Icon name="arrow" size={16} /></Button></section>}
      {!isEmpty && <div className="library-controls">
        <label className="library-search"><Icon name="search" size={17} /><Input id="library-filter" type="search" value={query} placeholder="搜索书名、作者、文件夹" aria-label="搜索书库" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery('');
          }
        }} /></label>
        <div className="library-tabs" role="group" aria-label="阅读状态筛选">{([['all', '全部'], ['reading', '在读'], ['unread', '未开始']] as const).map(([value, label]) => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div>
        <label className="library-sort"><span className="sr-only">书籍排序</span><select aria-label="书籍排序" value={sort} onChange={(event) => setSort(event.target.value as LibraryFilter['sort'])}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">书名排序</option></select></label>
        <div className="layout-toggle" role="group" aria-label="书库布局"><Button variant="ghost" size="icon" aria-label="网格视图" aria-pressed={view === 'shelf'} onClick={() => setLayout('shelf')}><Icon name="grid" size={17} /></Button><Button variant="ghost" size="icon" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setLayout('list')}><Icon name="list" size={19} /></Button></div>
      </div>}
      {isEmpty ? <section id="home-empty" className="library-empty">
        <Icon name="book" size={38} />
        <h2>书库为空</h2>
        <Button className="primary-action" onClick={readerBridge.importBook}><Icon name="plus" size={16} />添加书籍</Button>
        <p>也可将 PDF 或 .s2e 拖到这里</p>
      </section> : <>
        {visibleFolders.length > 0 && <section className="library-folders" aria-label="文件夹">
          <h2 className="library-section-title">文件夹</h2>
          <div className="folder-grid">{visibleFolders.map(folder => <FolderCard key={folder.id} name={folder.name}
            count={folderBookCount(books, folders, folder.id)}
            parentPath={filter.query ? folderTrail(folders, folder.parentId).map(parent => parent.name).join(' / ') : undefined}
            onOpen={() => openFolder(folder.id)} onDrop={event => readerBridge.dropBooks(event, folder.id)}
            onDetails={() => readerBridge.showFolderDetails(folder.id)} onRename={anchor => readerBridge.renameFolder(folder.id, anchor)}
            onDelete={anchor => readerBridge.deleteFolder(folder.id, anchor)} />)}</div>
        </section>}
        <div className="library-books-heading">
          {visibleFolders.length > 0 && filtered.length > 0 && <h2 className="library-section-title">书籍</h2>}
          {hasResults && hasFilters && <button className="clear-filter" onClick={clearFilters}>清除筛选<Icon name="close" size={13} /></button>}
        </div>
        <div id="home-table-wrap" data-layout={view}>
          {view === 'list' && filtered.length > 0 && <div className="book-list-head" aria-hidden="true"><span>书名</span><span>阅读位置</span><span>页数</span><span /></div>}
          <div id="home-table" className={view === 'shelf' ? 'book-grid' : 'book-list'} role="list" aria-label="电子书列表">{filtered.map((book) => {
            const title = book.meta.title || book.s2eName;
            const progress = readingPosition(book);
            const color = book.id.charCodeAt(book.id.length - 1) % 6;
            return <article key={book.id} className={'ht-row book-item' + (selected.has(book.id) ? ' selected' : '')} data-id={book.id} role="listitem" draggable={selected.has(book.id)} onDragStart={(event) => readerBridge.dragBooks(event, book.id)}>
              <button className="book-open" draggable aria-label={'阅读 ' + title} onClick={(event) => choose(event, book)}><span className={'book-cover cover-' + color} aria-hidden="true">{title.slice(0, 1)}</span><span className="book-info"><span className="ht-title book-title">{title}</span>{book.meta.author && <span className="ht-author">{book.meta.author}</span>}</span></button>
              <div className="book-reading">{progress.position > 0 && <span>第 {progress.page} 页</span>}</div><span className="ht-pages book-pages">{progress.total} 页</span>
              <button className={'book-selection' + (selected.has(book.id) ? ' checked' : '')} role="checkbox" aria-checked={selected.has(book.id)} aria-label={'选择 ' + title} onClick={() => readerBridge.toggleBookSelection(book.id)}><Icon name="check" size={13} /></button>
              <CardActions className="book-more" label={'更多操作 ' + title} actions={[
                { label: '查看详情', onSelect: () => readerBridge.showBookDetails(book.id) },
                { label: '修改书名', onSelect: anchor => readerBridge.renameBook(book.id, anchor) },
                { label: '移动到文件夹', onSelect: anchor => readerBridge.moveBooks([book.id], anchor) },
                { label: '移出书库', onSelect: anchor => readerBridge.deleteBooks([book.id], anchor), danger: true },
              ]} />
            </article>;
          })}</div>
          {!filtered.length && (!hasFilters || !hasResults) && <div className="library-no-results">
            <h2>{filter.query ? '没有匹配的书籍或文件夹' : status !== 'all' ? '没有匹配的书籍' : folderId ? '文件夹里还没有书' : '还没有添加书籍'}</h2>
            {hasFilters && <Button variant="outline" onClick={clearFilters}>清除筛选</Button>}
          </div>}
        </div>
      </>}
      <div id="home-batch-bar" className="shelf-selection-bar" hidden={!visibleSelection.length}>
        <span>已选 {visibleSelection.length} 本</span>
        <button onClick={readerBridge.selectAllVisible}>全选</button>
        <Button variant="ghost" onClick={event => readerBridge.moveBooks(visibleSelection, event.currentTarget)}>移动到…</Button>
        <Button id="home-delete" variant="destructive" onClick={event => readerBridge.deleteBooks(visibleSelection, event.currentTarget)}>移出书库</Button>
        <button className="selection-dismiss" aria-label="取消选择" onClick={readerBridge.clearSelection}><Icon name="close" size={17} /></button>
      </div>
    </div><aside id="detail-panel" />
  </>;
}
