const ITEM_TYPES = new Set(['body', 'heading', 'footnote', 'figure', 'table']);

function normalizeItem(item, index) {
  const type = String(item?.type || '');
  if (!ITEM_TYPES.has(type)) throw new Error('不支持的 item type：' + (type || '空'));
  if (type === 'figure' || type === 'table') return { type };
  const text = String(item.text || '').trim();
  if (!text) {
    const label = type === 'body' ? '正文' : type === 'heading' ? '标题' : '脚注';
    throw new Error('第 ' + (index + 1) + ' 块' + label + '不能为空');
  }
  if (type === 'body') return { type, text };
  if (type === 'heading') {
    const normalized = {
      type,
      number: String(item.number || '').trim(),
      level: Math.max(1, Math.min(4, Number(item.level) || 2)),
      text,
    };
    if (!normalized.number) delete normalized.number;
    return normalized;
  }
  return {
    type,
    index: Math.max(1, Number.parseInt(item.index, 10) || 1),
    text,
  };
}

export function normalizePageItems(items) {
  if (!Array.isArray(items)) throw new Error('页面 items 必须是数组');
  return items.map(normalizeItem);
}

function touchesPage(record, page) {
  if (!record?.range?.start || !record?.range?.end) return false;
  return record.range.start.page <= page && record.range.end.page >= page;
}

export function archivePageAnnotations(records, page, now = Date.now(), createId = () => crypto.randomUUID()) {
  const kept = [];
  const histories = [];
  let affectedHighlights = 0;
  let affectedNotes = 0;
  for (const record of records) {
    if (record.type === 'history-note' || !touchesPage(record, page)) {
      kept.push(record);
      continue;
    }
    if (record.type === 'highlight') {
      affectedHighlights += 1;
      continue;
    }
    if (record.type === 'note') {
      affectedNotes += 1;
      histories.push({
        id: createId(),
        type: 'history-note',
        page,
        quote: record.quote || '',
        text: record.text || '',
        archivedAt: now,
        reason: 'page-edited',
      });
      continue;
    }
    kept.push(record);
  }
  return { records: [...kept, ...histories], affectedHighlights, affectedNotes };
}
