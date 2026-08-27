function clonePosition(position) {
  return { page: position.page, item: position.item, offset: position.offset };
}

function cloneRange(range) {
  return { start: clonePosition(range.start), end: clonePosition(range.end) };
}

function newId() {
  return globalThis.crypto?.randomUUID?.()
    || 'annotation-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function comparePosition(a, b) {
  return (a.page - b.page) || (a.item - b.item) || (a.offset - b.offset);
}

export function compareRange(a, b) {
  return comparePosition(a.range.start, b.range.start)
    || comparePosition(a.range.end, b.range.end);
}

export function sameRange(a, b) {
  return comparePosition(a.start, b.start) === 0 && comparePosition(a.end, b.end) === 0;
}

export function rangeIntersects(a, b) {
  return comparePosition(a.start, b.end) < 0 && comparePosition(b.start, a.end) < 0;
}

function subtractRecord(record, cut, now) {
  if (!rangeIntersects(record.range, cut)) return [{ ...record, range: cloneRange(record.range) }];
  const pieces = [];
  if (comparePosition(record.range.start, cut.start) < 0) {
    pieces.push({
      ...record,
      range: { start: clonePosition(record.range.start), end: clonePosition(cut.start) },
      quote: '',
      updatedAt: now,
    });
  }
  if (comparePosition(cut.end, record.range.end) < 0) {
    pieces.push({
      ...record,
      id: pieces.length ? newId() : record.id,
      range: { start: clonePosition(cut.end), end: clonePosition(record.range.end) },
      quote: '',
      updatedAt: now,
    });
  }
  return pieces;
}

function mergeAdjacent(records) {
  const merged = [];
  for (const record of records) {
    const previous = merged.at(-1);
    const touches = previous && comparePosition(previous.range.end, record.range.start) >= 0;
    if (!previous || previous.color !== record.color || !touches) {
      merged.push(record);
      continue;
    }
    if (comparePosition(record.range.end, previous.range.end) > 0) {
      previous.range.end = clonePosition(record.range.end);
    }
    previous.quote = previous.quote && record.quote
      ? previous.quote + record.quote
      : previous.quote || record.quote;
    previous.createdAt = Math.min(previous.createdAt, record.createdAt);
    previous.updatedAt = Math.max(previous.updatedAt, record.updatedAt);
  }
  return merged;
}

export function removeHighlights(records, range, now = Date.now()) {
  return records.flatMap((record) => subtractRecord(record, range, now)).sort(compareRange);
}

export function applyHighlight(records, range, color, quote, now = Date.now()) {
  if (comparePosition(range.start, range.end) >= 0) return [...records].sort(compareRange);
  const kept = removeHighlights(records, range, now);
  kept.push({
    id: newId(),
    type: 'highlight',
    range: cloneRange(range),
    quote,
    color,
    createdAt: now,
    updatedAt: now,
  });
  return mergeAdjacent(kept.sort(compareRange));
}
