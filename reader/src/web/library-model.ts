export type BookRecord = {
  id: string; folderId?: string | null; s2eName: string; importedAt?: number;
  meta: { title?: string; author?: string; publisher?: string };
  bookJson: { pages?: { pdf_page?: number }[] };
  progress?: { page: number; at?: number } | null;
};
export type FolderRecord = { id: string; parentId?: string | null; name: string };
export type LibraryFilter = { query?: string; folderId?: string | null; sort?: 'recent' | 'added' | 'title'; status?: 'all' | 'unread' | 'reading' };

export function readingPosition(book: BookRecord) {
  const pages = book.bookJson.pages || [];
  const page = Number(book.progress?.page || 0);
  const index = pages.findIndex((entry) => Number(entry.pdf_page) === page);
  const position = book.progress && index >= 0 ? index + 1 : 0;
  return { page, position, total: pages.length, percent: pages.length ? Math.round(position / pages.length * 100) : 0 };
}

export function continueReading(books: BookRecord[]): BookRecord | null {
  return books.filter((book) => readingPosition(book).position > 0)
    .sort((a, b) => (b.progress?.at || 0) - (a.progress?.at || 0))[0] || null;
}

export function filterLibrary(books: BookRecord[], folders: FolderRecord[], filter: LibraryFilter = {}) {
  const query = filter.query?.trim().toLocaleLowerCase() || '';
  const folderIds = new Set(filter.folderId ? [filter.folderId] : []);
  if (filter.folderId) {
    for (const id of folderIds) folders.filter((f) => f.parentId === id).forEach((f) => folderIds.add(f.id));
  }
  const result = books.filter((book) => {
    if (filter.folderId && (!book.folderId || !folderIds.has(book.folderId))) return false;
    if (filter.status === 'unread' && readingPosition(book).position) return false;
    if (filter.status === 'reading' && !readingPosition(book).position) return false;
    const folder = folders.find((f) => f.id === book.folderId);
    return !query || [book.meta.title, book.meta.author, book.meta.publisher, book.s2eName, folder?.name]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  });
  const collator = new Intl.Collator('zh-CN', { numeric: true });
  return result.sort((a, b) => {
    if (filter.sort === 'title') return collator.compare(a.meta.title || a.s2eName, b.meta.title || b.s2eName);
    if (filter.sort === 'added') return (b.importedAt || 0) - (a.importedAt || 0);
    return (b.progress?.at || b.importedAt || 0) - (a.progress?.at || a.importedAt || 0);
  });
}
