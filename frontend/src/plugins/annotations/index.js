import { registerExtension } from '../../core/extensions.js';
import { resolveAnchor, scrollToAnchor } from '../../core/text_anchor.js';
import { downloadAnnotatedS2e } from './export.js';
import { createAnnotationsSidebar } from './sidebar.js';
import {
  applyHighlight,
  compareRange,
  rangeIntersects,
  removeHighlights,
  sameRange,
} from './ranges.js';

const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];
const HIGHLIGHT_NAMES = [...COLORS.map((color) => 's2e-highlight-' + color), 's2e-note'];

function newId() {
  return globalThis.crypto?.randomUUID?.()
    || 'annotation-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function compareRecords(a, b) {
  if (a.type === 'history-note' || b.type === 'history-note') {
    if (a.type !== b.type) return a.type === 'history-note' ? 1 : -1;
    return (a.archivedAt || 0) - (b.archivedAt || 0);
  }
  return compareRange(a, b);
}

registerExtension({
  id: 'annotations',
  name: '文字高亮与注释',
  version: '1.0.0',
  description: '多色高亮、文字注释和右侧标注栏，标注独立保存',
  activate(ctx) {
    let active = true;
    let warnedUnsupported = false;
    const recordsByBook = new Map();
    const sidebars = new Map();
    const cleanups = [];
    const timers = new Set();

    const cssHighlights = globalThis.CSS?.highlights;
    const HighlightCtor = globalThis.Highlight || globalThis.window?.Highlight;

    function views() {
      return ctx.state?.tabs || [];
    }

    function recordsFor(bookId) {
      return recordsByBook.get(bookId) || [];
    }

    async function ensureRecords(bookId) {
      if (recordsByBook.has(bookId)) return recordsFor(bookId);
      const records = await ctx.db.getAnnotations(bookId);
      if (!active) return [];
      recordsByBook.set(bookId, records.sort(compareRecords));
      refreshRendering();
      return records;
    }

    function clearHighlights() {
      if (!cssHighlights) return;
      HIGHLIGHT_NAMES.forEach((name) => cssHighlights.delete(name));
    }

    function clearMarkers() {
      document.querySelectorAll('.annotations-marker').forEach((marker) => marker.remove());
    }

    function addMarker(view, note, annotatedRange) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'annotations-marker';
      marker.dataset.annotationId = note.id;
      marker.setAttribute('aria-label', '查看注释');
      marker.title = '查看注释';
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        ctx.bus.emit('annotations:reveal', { bookId: view.bookId, id: note.id });
      });
      // 标记紧跟注释范围，而不是放到整个段落/item 的末尾。
      const insertionPoint = annotatedRange.cloneRange();
      insertionPoint.collapse(false);
      insertionPoint.insertNode(marker);
    }

    function refreshRendering() {
      clearMarkers();
      if (!cssHighlights || !HighlightCtor) {
        if (!warnedUnsupported) {
          warnedUnsupported = true;
          ctx.toast('当前浏览器不支持正文高亮显示，标注数据仍会保存');
        }
        return;
      }
      clearHighlights();
      const grouped = Object.fromEntries(HIGHLIGHT_NAMES.map((name) => [name, []]));
      for (const view of views()) {
        for (const record of recordsFor(view.bookId)) {
          if (record.type === 'history-note') continue;
          const domRange = resolveAnchor(view.textView, record.range);
          if (!domRange) continue;
          if (record.type === 'highlight') {
            grouped['s2e-highlight-' + record.color]?.push(domRange);
          } else if (record.type === 'note') {
            grouped['s2e-note'].push(domRange);
            addMarker(view, record, domRange);
          }
        }
      }
      for (const [name, ranges] of Object.entries(grouped)) {
        if (ranges.length) cssHighlights.set(name, new HighlightCtor(...ranges));
      }
    }

    function hydrateQuotes(view, records) {
      for (const record of records) {
        if (record.type === 'history-note') continue;
        if (record.quote) continue;
        record.quote = resolveAnchor(view.textView, record.range)?.toString() || '';
      }
      return records;
    }

    async function persist(view, records) {
      const ordered = hydrateQuotes(view, records).sort(compareRecords);
      recordsByBook.set(view.bookId, ordered);
      await ctx.db.replaceAnnotations(view.bookId, ordered);
      if (!active) return;
      refreshRendering();
      sidebars.get(view.bookId)?.render(ordered);
      ctx.bus.emit('annotations:changed', { bookId: view.bookId, records: ordered });
    }

    function jumpToRecord(view, record) {
      if (view.prefs?.viewMode === 'pdf') view.setPrefs?.({ viewMode: 'split' });
      scrollToAnchor(view, record.range);
      const item = view.textView.itemEls.get(record.range.start.page + ':' + record.range.start.item);
      if (!item) return;
      item.classList.add('annotations-jump-target');
      const timer = setTimeout(() => {
        item.classList.remove('annotations-jump-target');
        timers.delete(timer);
      }, 900);
      timers.add(timer);
    }

    async function deleteRecords(view, ids) {
      const idSet = new Set(ids);
      await persist(view, recordsFor(view.bookId).filter((record) => !idSet.has(record.id)));
    }

    async function editNote(view, id, text) {
      const records = recordsFor(view.bookId);
      const note = records.find((record) => record.id === id && record.type === 'note');
      if (!note) return;
      note.text = text;
      note.updatedAt = Date.now();
      await persist(view, records);
    }

    async function setHighlight(view, range, color, quote) {
      const current = recordsFor(view.bookId);
      const notes = current.filter((record) => record.type !== 'highlight');
      const highlights = applyHighlight(
        current.filter((record) => record.type === 'highlight'), range, color, quote,
      );
      await persist(view, [...notes, ...highlights]);
    }

    async function removeHighlight(view, range) {
      const current = recordsFor(view.bookId);
      const notes = current.filter((record) => record.type !== 'highlight');
      const highlights = removeHighlights(
        current.filter((record) => record.type === 'highlight'), range,
      );
      await persist(view, [...notes, ...highlights]);
    }

    async function setHighlights(view, selectedRecords, color) {
      const current = recordsFor(view.bookId);
      const notes = current.filter((record) => record.type !== 'highlight');
      let highlights = current.filter((record) => record.type === 'highlight');
      for (const record of selectedRecords) {
        highlights = applyHighlight(highlights, record.range, color, record.quote);
      }
      await persist(view, [...notes, ...highlights]);
    }

    async function removeSelectedHighlights(view, selectedRecords) {
      const current = recordsFor(view.bookId);
      const notes = current.filter((record) => record.type !== 'highlight');
      let highlights = current.filter((record) => record.type === 'highlight');
      for (const record of selectedRecords) {
        highlights = removeHighlights(highlights, record.range);
      }
      await persist(view, [...notes, ...highlights]);
    }

    async function clearHistory(view) {
      const histories = recordsFor(view.bookId).filter((record) => record.type === 'history-note');
      if (!histories.length || !confirm('清空全部 ' + histories.length + ' 条历史注释？此操作无法撤销。')) return;
      await persist(view, recordsFor(view.bookId).filter((record) => record.type !== 'history-note'));
    }

    async function exportBook(view) {
      const book = ctx.state.books.find((item) => item.id === view.bookId);
      if (!book) return;
      try {
        await downloadAnnotatedS2e(book, recordsFor(view.bookId));
        ctx.toast('已导出含标注的电子书');
      } catch (error) {
        ctx.toast('导出失败：' + error.message);
      }
    }

    function attachSidebar(view) {
      if (!view?.wv || sidebars.has(view.bookId)) return sidebars.get(view.bookId);
      const sidebar = createAnnotationsSidebar({
        view,
        records: recordsFor(view.bookId),
        onJump: (record) => jumpToRecord(view, record),
        onDelete: (ids) => deleteRecords(view, ids),
        onEdit: (id, text) => editNote(view, id, text),
        onSetHighlight: (range, color, quote) => setHighlight(view, range, color, quote),
        onRemoveHighlight: (range) => removeHighlight(view, range),
        onSetHighlights: (selectedRecords, color) => setHighlights(view, selectedRecords, color),
        onRemoveHighlights: (selectedRecords) => removeSelectedHighlights(view, selectedRecords),
        onClearHistory: () => clearHistory(view),
        onExport: () => exportBook(view),
        onLayoutChange: () => view.refreshLayout?.(),
      });
      sidebars.set(view.bookId, sidebar);
      ensureRecords(view.bookId).then((records) => sidebar.render(records));
      return sidebar;
    }

    function renderSelectionActions({ selection, view, close }) {
      const root = document.createElement('div');
      root.className = 'annotations-context';
      const records = recordsFor(view.bookId);
      const highlights = records.filter((record) => record.type === 'highlight');

      for (const color of COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'annotations-swatch c-' + color;
        swatch.dataset.color = color;
        swatch.title = '高亮为' + color;
        swatch.setAttribute('aria-label', '高亮为' + color);
        swatch.addEventListener('click', async () => {
          const current = recordsFor(view.bookId);
          const notes = current.filter((record) => record.type !== 'highlight');
          const next = applyHighlight(
            current.filter((record) => record.type === 'highlight'),
            selection.range, color, selection.quote || selection.text,
          );
          await persist(view, [...notes, ...next]);
          close();
        });
        root.appendChild(swatch);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'annotations-action annotations-remove-highlight';
      remove.dataset.action = 'remove-highlight';
      remove.title = '取消高亮';
      remove.setAttribute('aria-label', '取消高亮');
      remove.innerHTML = '<span class="annotations-action-icon i-eraser"></span>';
      remove.disabled = !highlights.some((record) => rangeIntersects(record.range, selection.range));
      remove.addEventListener('click', async () => {
        if (remove.disabled) return;
        const current = recordsFor(view.bookId);
        const notes = current.filter((record) => record.type !== 'highlight');
        const next = removeHighlights(
          current.filter((record) => record.type === 'highlight'), selection.range,
        );
        await persist(view, [...notes, ...next]);
        close();
      });
      const divider = document.createElement('span');
      divider.className = 'annotations-context-divider';
      divider.setAttribute('aria-hidden', 'true');
      root.append(divider, remove);

      const noteButton = document.createElement('button');
      noteButton.type = 'button';
      noteButton.className = 'annotations-action annotations-note-action';
      noteButton.dataset.action = 'note';
      const existingNote = records.find((record) => record.type === 'note' && sameRange(record.range, selection.range));
      noteButton.title = existingNote ? '编辑注释' : '添加注释';
      noteButton.setAttribute('aria-label', noteButton.title);
      noteButton.innerHTML = '<span class="annotations-action-icon i-annotate"></span><span>注释</span>';
      noteButton.addEventListener('click', () => {
        root.querySelector('.annotations-note-editor')?.remove();
        const editor = document.createElement('div');
        editor.className = 'annotations-note-editor';
        const textarea = document.createElement('textarea');
        textarea.value = existingNote?.text || '';
        textarea.placeholder = '写下注释…';
        const actions = document.createElement('div');
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = '取消'; cancel.dataset.action = 'cancel-note';
        cancel.addEventListener('click', () => editor.remove());
        const save = document.createElement('button');
        save.type = 'button'; save.textContent = '保存'; save.dataset.action = 'save-note';
        save.addEventListener('click', async () => {
          const text = textarea.value.trim();
          if (!text) { textarea.focus(); return; }
          const current = recordsFor(view.bookId);
          const match = current.find((record) => record.type === 'note' && sameRange(record.range, selection.range));
          const now = Date.now();
          if (match) {
            match.text = text;
            match.quote = selection.quote || selection.text;
            match.updatedAt = now;
          } else {
            current.push({
              id: newId(), bookId: view.bookId, type: 'note', range: structuredClone(selection.range),
              quote: selection.quote || selection.text, text, createdAt: now, updatedAt: now,
            });
          }
          await persist(view, current);
          close();
        });
        actions.append(cancel, save);
        editor.append(textarea, actions);
        root.appendChild(editor);
        textarea.focus();
      });
      root.appendChild(noteButton);
      return root;
    }

    const removeContextAction = ctx.ui.addContextAction({
      id: 'annotations-actions',
      render: renderSelectionActions,
    });
    cleanups.push(removeContextAction);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn annotations-toggle';
    toggle.title = '显示或隐藏标注栏';
    toggle.setAttribute('aria-label', '显示或隐藏标注栏');
    toggle.innerHTML = '<span class="sf i-annotations"></span>';
    function updateToggle() {
      const view = ctx.getView?.();
      const sidebar = view ? sidebars.get(view.bookId) : null;
      toggle.hidden = !sidebar;
      toggle.classList.toggle('active', !!sidebar?.isVisible());
    }
    toggle.addEventListener('click', () => {
      const view = ctx.getView?.();
      const sidebar = view ? sidebars.get(view.bookId) : null;
      if (!sidebar) return;
      sidebar.toggle();
      updateToggle();
    });
    cleanups.push(ctx.ui.addToolbarWidget({ id: 'annotations-toggle', el: toggle }));

    cleanups.push(ctx.bus.on('book:open', ({ view }) => { attachSidebar(view); updateToggle(); }));
    cleanups.push(ctx.bus.on('book:switch', () => updateToggle()));
    cleanups.push(ctx.bus.on('book:close', ({ bookId }) => {
      sidebars.get(bookId)?.destroy();
      sidebars.delete(bookId);
      recordsByBook.delete(bookId);
      refreshRendering();
      updateToggle();
    }));
    cleanups.push(ctx.bus.on('annotations:reveal', ({ bookId, id }) => {
      const sidebar = sidebars.get(bookId);
      sidebar?.reveal(id);
      updateToggle();
    }));
    cleanups.push(ctx.bus.on('annotations:replace', ({ bookId, records }) => {
      recordsByBook.set(bookId, [...records].sort(compareRecords));
      refreshRendering();
      sidebars.get(bookId)?.render(recordsByBook.get(bookId));
    }));
    cleanups.push(ctx.bus.on('book:content-change', () => refreshRendering()));
    for (const view of views()) attachSidebar(view);
    updateToggle();

    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
      sidebars.forEach((sidebar) => sidebar.destroy());
      sidebars.clear();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      clearMarkers();
      clearHighlights();
      recordsByBook.clear();
    };
  },
});
