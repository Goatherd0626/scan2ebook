export type BookRecord = {
  id: string; folderId?: string | null; s2eName: string; importedAt?: number;
  meta: { title?: string; author?: string; publisher?: string };
  bookJson: { pages?: { pdf_page?: number }[] };
  progress?: { page: number; at?: number } | null;
};
export type FolderRecord = { id: string; parentId?: string | null; name: string };
export type LibraryFilter = { query?: string; folderId?: string | null; sort?: 'recent' | 'added' | 'title'; status?: 'all' | 'unread' | 'reading' };

export function folderTrail(folders: FolderRecord[], id?: string | null) {
  const trail: FolderRecord[] = [];
  let current = folders.find((folder) => folder.id === id);
  while (current) {
    trail.unshift(current);
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return trail;
}

export function folderBookCount(books: BookRecord[], folders: FolderRecord[], id: string) {
  return books.filter((book) => folderTrail(folders, book.folderId).some((folder) => folder.id === id)).length;
}

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

function folderScope(folders: FolderRecord[], folderId?: string | null) {
  if (!folderId) return null;
  const ids = new Set([folderId]);
  for (const id of ids) {
    for (const folder of folders) if (folder.parentId === id) ids.add(folder.id);
  }
  return ids;
}

export function filterFolders(folders: FolderRecord[], { folderId = null, query }: LibraryFilter) {
  const term = query?.trim().toLocaleLowerCase();
  if (!term) return folders.filter(folder => (folder.parentId || null) === folderId);
  const scope = folderScope(folders, folderId);
  return folders.filter(folder => folder.id !== folderId && (!scope || scope.has(folder.id))
    && folder.name.toLocaleLowerCase().includes(term));
}

export function filterLibrary(books: BookRecord[], folders: FolderRecord[], filter: LibraryFilter = {}) {
  const query = filter.query?.trim().toLocaleLowerCase() || '';
  const scope = folderScope(folders, filter.folderId);
  const result = books.filter((book) => {
    if (scope && (!book.folderId || !scope.has(book.folderId))) return false;
    if (filter.status === 'unread' && readingPosition(book).position) return false;
    if (filter.status === 'reading' && !readingPosition(book).position) return false;
    if (!query) return true;
    const path = folderTrail(folders, book.folderId);
    return [book.meta.title, book.meta.author, book.meta.publisher, book.s2eName, ...path.map(folder => folder.name)]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  });
  const collator = new Intl.Collator('zh-CN', { numeric: true });
  return result.sort((a, b) => {
    if (filter.sort === 'title') return collator.compare(a.meta.title || a.s2eName, b.meta.title || b.s2eName);
    if (filter.sort === 'added') return (b.importedAt || 0) - (a.importedAt || 0);
    return (b.progress?.at || b.importedAt || 0) - (a.progress?.at || a.importedAt || 0);
  });
}
