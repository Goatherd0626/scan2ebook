export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];

function comparePosition(a, b) {
  return (a.page - b.page) || (a.item - b.item) || (a.offset - b.offset);
}

function validPosition(position) {
  return position
    && Number.isInteger(position.page) && position.page >= 1
    && Number.isInteger(position.item) && position.item >= 0
    && Number.isInteger(position.offset) && position.offset >= 0;
}

function validRange(range) {
  return range && validPosition(range.start) && validPosition(range.end)
    && comparePosition(range.start, range.end) < 0;
}

function baseRecord(item, bookId, type) {
  if (!item || typeof item.id !== 'string' || !item.id || !validRange(item.range)) return null;
  return {
    id: item.id,
    bookId,
    type,
    range: structuredClone(item.range),
    quote: typeof item.quote === 'string' ? item.quote : '',
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
  };
}

export function parseAnnotationSidecar(text, bookId) {
  let source;
  try { source = typeof text === 'string' ? JSON.parse(text) : text; } catch (error) {
    return { records: [], bookmarks: [], invalidCount: 1 };
  }
  if (!source || source.version !== 1) return { records: [], bookmarks: [], invalidCount: source ? 1 : 0 };
  const records = [];
  const bookmarks = [];
  let invalidCount = 0;
  for (const item of Array.isArray(source.highlights) ? source.highlights : []) {
    const record = baseRecord(item, bookId, 'highlight');
    if (!record || !ANNOTATION_COLORS.includes(item.color)) { invalidCount += 1; continue; }
    records.push({ ...record, color: item.color });
  }
  for (const item of Array.isArray(source.notes) ? source.notes : []) {
    const record = baseRecord(item, bookId, 'note');
    const noteText = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!record || !noteText) { invalidCount += 1; continue; }
    records.push({ ...record, text: noteText });
  }
  for (const item of Array.isArray(source.bookmarks) ? source.bookmarks : []) {
    const valid = item && typeof item.id === 'string' && item.id
      && Number.isInteger(item.page) && item.page >= 1
      && (item.item === undefined || item.item === null || (Number.isInteger(item.item) && item.item >= 0));
    if (!valid) { invalidCount += 1; continue; }
    if (bookmarks.some((bookmark) => bookmark.page === item.page)) continue;
    bookmarks.push({
      id: item.id,
      page: item.page,
      snippet: typeof item.snippet === 'string' ? item.snippet : '',
      at: Number.isFinite(item.at) ? item.at : Date.now(),
    });
  }
  for (const item of Array.isArray(source.historyNotes) ? source.historyNotes : []) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    const valid = item && typeof item.id === 'string' && item.id
      && Number.isInteger(item.page) && item.page >= 1 && text;
    if (!valid) { invalidCount += 1; continue; }
    records.push({
      id: item.id,
      bookId,
      type: 'history-note',
      page: item.page,
      quote: typeof item.quote === 'string' ? item.quote : '',
      text,
      archivedAt: Number.isFinite(item.archivedAt) ? item.archivedAt : Date.now(),
      reason: 'page-edited',
    });
  }
  return { records, bookmarks, invalidCount };
}

function compareRecord(a, b) {
  return comparePosition(a.range.start, b.range.start)
    || comparePosition(a.range.end, b.range.end);
}

function externalRecord(record) {
  const { bookId, storageKey, type, ...data } = record;
  return structuredClone(data);
}

export function buildAnnotationSidecar(records, bookmarks = []) {
  const ordered = records.filter((item) => item.type !== 'history-note').sort(compareRecord);
  const historyNotes = records.filter((item) => item.type === 'history-note')
    .sort((a, b) => (a.archivedAt || 0) - (b.archivedAt || 0))
    .map(externalRecord);
  const seenBookmarkPages = new Set();
  const pageBookmarks = [...bookmarks]
    .sort((a, b) => (a.page - b.page) || ((a.at || 0) - (b.at || 0)))
    .filter((item) => {
      if (seenBookmarkPages.has(item.page)) return false;
      seenBookmarkPages.add(item.page);
      return true;
    })
    .map(({ item, ...bookmark }) => structuredClone(bookmark));
  return {
    version: 1,
    highlights: ordered.filter((item) => item.type === 'highlight').map(externalRecord),
    notes: ordered.filter((item) => item.type === 'note').map(externalRecord),
    bookmarks: pageBookmarks,
    historyNotes,
  };
}
