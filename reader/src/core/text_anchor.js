function itemForNode(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest?.('.text-item') || null;
}

function itemPosition(item, offset) {
  const itemParts = String(item.dataset.item || '').split(':');
  const page = Number(item.dataset.page);
  const itemIndex = Number(itemParts.at(-1));
  if (!Number.isInteger(page) || !Number.isInteger(itemIndex)) return null;
  return { page, item: itemIndex, offset };
}

function canonicalLength(node) {
  if (node.nodeType === 3) return node.textContent.length;
  if (node.nodeType === 1) {
    if (node.classList.contains('fn-inline') || node.classList.contains('annotations-marker')) return 0;
    if (node.classList.contains('fnref')) {
      return Number(node.dataset.sourceLength) || node.textContent.length;
    }
  }
  return [...node.childNodes].reduce((sum, child) => sum + canonicalLength(child), 0);
}

function textOffset(item, container, offset) {
  const range = item.ownerDocument.createRange();
  range.selectNodeContents(item);
  try {
    range.setEnd(container, offset);
    return canonicalLength(range.cloneContents());
  } catch (error) { return null; }
}

export function selectionToAnchor(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  const nativeRange = selection.getRangeAt(0);
  const startItem = itemForNode(nativeRange.startContainer);
  const endItem = itemForNode(nativeRange.endContainer);
  if (!startItem || !endItem) return null;
  const startOffset = textOffset(startItem, nativeRange.startContainer, nativeRange.startOffset);
  const endOffset = textOffset(endItem, nativeRange.endContainer, nativeRange.endOffset);
  if (startOffset === null || endOffset === null) return null;
  const start = itemPosition(startItem, startOffset);
  const end = itemPosition(endItem, endOffset);
  if (!start || !end) return null;
  return { range: { start, end }, quote: nativeRange.toString() };
}

function domPoint(item, wantedOffset) {
  const win = item.ownerDocument.defaultView;
  const walker = item.ownerDocument.createTreeWalker(item, win.NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('.annotations-marker, .fn-inline')
        ? win.NodeFilter.FILTER_REJECT
        : win.NodeFilter.FILTER_ACCEPT;
    },
  });
  let remaining = wantedOffset;
  let last = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    last = node;
    const footnote = node.parentElement?.closest('sup.fnref');
    const sourceLength = footnote ? Number(footnote.dataset.sourceLength) || node.textContent.length : node.textContent.length;
    if (remaining <= sourceLength) {
      const offset = footnote && remaining > 0 ? node.textContent.length : remaining;
      return { node, offset };
    }
    remaining -= sourceLength;
  }
  return remaining === 0 && last ? { node: last, offset: last.textContent.length } : null;
}

export function resolveAnchor(textView, anchorRange) {
  const startItem = textView.itemEls.get(anchorRange.start.page + ':' + anchorRange.start.item);
  const endItem = textView.itemEls.get(anchorRange.end.page + ':' + anchorRange.end.item);
  if (!startItem || !endItem) return null;
  const start = domPoint(startItem, anchorRange.start.offset);
  const end = domPoint(endItem, anchorRange.end.offset);
  if (!start || !end) return null;
  const range = startItem.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch (error) { return null; }
  return range;
}

export function scrollToAnchor(view, anchorRange) {
  view?.textView?.scrollToItem(anchorRange.start.page, anchorRange.start.item);
}
