import { compareRange, rangeIntersects } from './ranges.js';

const WIDTH_KEY = 's2e-annotations-width';
const OPEN_KEY = 's2e-annotations-open';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;
const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (action) element.dataset.action = action;
  return element;
}

export function createAnnotationsSidebar({
  view,
  records = [],
  onJump = () => {},
  onDelete = () => {},
  onEdit = () => {},
  onSetHighlight = () => {},
  onRemoveHighlight = () => {},
  onSetHighlights = () => {},
  onRemoveHighlights = () => {},
  onClearHistory = () => {},
  onExport = () => {},
  onLayoutChange = () => {},
  confirmDelete = async () => true,
  storage = localStorage,
}) {
  const controller = new window.AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, {
    ...options,
    signal: controller.signal,
  });
  let allRecords = [...records];
  let mode = 'notes';
  let colorFilter = null;
  let query = '';
  let selected = new Set();
  let lastSelected = null;
  let searchIndex = 0;
  let popoverRecordId = null;
  let width = Number(storage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
  let dragging = false;
  let marquee = null;

  const aside = document.createElement('aside');
  aside.className = 'annotations-sidebar';
  aside.tabIndex = 0;
  aside.innerHTML = `
    <div class="annotations-resizer" role="separator" aria-orientation="vertical" aria-label="调整注释栏宽度" tabindex="0"></div>
    <div class="annotations-head">
      <span class="annotations-title">标注</span>
      <span class="annotations-tabs">
        <button type="button" data-mode="notes" class="active">注释</button>
        <button type="button" data-mode="highlights">高亮</button>
      </span>
      <button type="button" class="annotations-export" title="导出含标注的电子书" aria-label="导出含标注的电子书"><span class="sf i-export"></span></button>
    </div>
    <div class="annotations-search" hidden>
      <input class="annotations-search-input" placeholder="搜索标注…" aria-label="搜索标注">
      <span class="annotations-search-count">0 / 0</span>
      <button type="button" data-search="prev" aria-label="上一个"><span class="sf i-up" aria-hidden="true"></span></button>
      <button type="button" data-search="next" aria-label="下一个"><span class="sf i-down" aria-hidden="true"></span></button>
      <button type="button" data-search="close" aria-label="关闭"><span class="sf i-xmark" aria-hidden="true"></span></button>
    </div>
    <div class="annotations-colors" hidden></div>
    <div class="annotations-multi" hidden>
      <span class="annotations-multi-count"></span>
      <span class="annotations-multi-colors"></span>
      <span class="annotations-multi-divider" aria-hidden="true"></span>
      <button type="button" class="annotations-multi-action" data-action="remove-highlights" title="清除所选范围内的高亮" aria-label="清除所选范围内的高亮"><span class="annotations-popover-icon i-popover-eraser"></span></button>
      <button type="button" class="annotations-multi-action is-danger" data-action="delete-selected" title="删除所选注释" aria-label="删除所选注释"><span class="annotations-popover-icon i-popover-trash"></span></button>
    </div>
    <div class="annotations-list"></div>`;
  view.wv.appendChild(aside);

  const resizer = aside.querySelector('.annotations-resizer');
  const tabs = aside.querySelector('.annotations-tabs');
  const search = aside.querySelector('.annotations-search');
  const searchInput = aside.querySelector('.annotations-search-input');
  const searchCount = aside.querySelector('.annotations-search-count');
  const colors = aside.querySelector('.annotations-colors');
  const multi = aside.querySelector('.annotations-multi');
  const multiColors = aside.querySelector('.annotations-multi-colors');
  const list = aside.querySelector('.annotations-list');

  COLORS.forEach((color) => {
    const swatch = button('', null);
    swatch.className = 'annotations-color c-' + color;
    swatch.dataset.color = color;
    swatch.title = '筛选' + color;
    swatch.setAttribute('aria-label', '筛选' + color);
    colors.appendChild(swatch);

    const batchSwatch = button('', null);
    batchSwatch.className = 'annotations-color c-' + color;
    batchSwatch.dataset.color = color;
    batchSwatch.title = '全部高亮为' + color;
    batchSwatch.setAttribute('aria-label', '全部高亮为' + color);
    multiColors.appendChild(batchSwatch);
  });

  function applyWidth(nextWidth) {
    const viewWidth = view.wv.getBoundingClientRect().width;
    const maxWidth = viewWidth > 0 ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewWidth - 480)) : MAX_WIDTH;
    width = Math.round(clamp(Number(nextWidth) || DEFAULT_WIDTH, MIN_WIDTH, maxWidth));
    aside.style.width = width + 'px';
    aside.style.flexBasis = width + 'px';
    resizer.setAttribute('aria-valuenow', String(width));
    if (!aside.hidden) onLayoutChange();
  }

  applyWidth(width);

  function visibleRecords() {
    const needle = query.trim().toLocaleLowerCase();
    return allRecords
      .filter((record) => mode === 'notes' ? record.type === 'note' : record.type === 'highlight')
      .filter((record) => mode !== 'highlights' || !colorFilter || record.color === colorFilter)
      .filter((record) => {
        if (!needle) return true;
        const haystack = mode === 'notes'
          ? (record.text || '') + ' ' + (record.quote || '')
          : record.quote || '';
        return haystack.toLocaleLowerCase().includes(needle);
      })
      .sort(compareRange);
  }

  function visibleHistoryRecords() {
    if (mode !== 'notes') return [];
    const needle = query.trim().toLocaleLowerCase();
    return allRecords
      .filter((record) => record.type === 'history-note')
      .filter((record) => !needle || ((record.text || '') + ' ' + (record.quote || ''))
        .toLocaleLowerCase().includes(needle))
      .sort((a, b) => (a.archivedAt || 0) - (b.archivedAt || 0));
  }

  function renderHistory(records) {
    if (!records.length) return;
    const section = document.createElement('section');
    section.className = 'annotations-history-section';
    const head = document.createElement('div');
    head.className = 'annotations-history-head';
    const title = document.createElement('span');
    title.textContent = '因编辑正文消失的历史注释';
    const clear = button('清空', 'clear-history');
    clear.className = 'annotations-history-clear';
    clear.addEventListener('click', () => onClearHistory());
    head.append(title, clear);
    section.appendChild(head);
    for (const record of records) {
      const card = document.createElement('article');
      card.className = 'annotations-history-card';
      const meta = document.createElement('div');
      meta.className = 'annotations-history-meta';
      meta.textContent = 'PDF 第 ' + record.page + ' 页 · ' + new Date(record.archivedAt).toLocaleString('zh-CN');
      const quote = document.createElement('div');
      quote.className = 'annotations-history-quote';
      quote.textContent = record.quote || '原文已被修改';
      const note = document.createElement('div');
      note.className = 'annotations-history-note';
      note.textContent = record.text;
      const copy = button('', 'copy-history');
      copy.className = 'annotations-history-copy';
      copy.title = '复制历史注释';
      copy.setAttribute('aria-label', '复制历史注释');
      copy.innerHTML = '<span class="annotations-popover-icon i-popover-copy"></span>';
      copy.addEventListener('click', () => navigator.clipboard?.writeText(record.text || ''));
      card.append(meta, quote, note, copy);
      section.appendChild(card);
    }
    list.appendChild(section);
  }

  function updateSelection() {
    list.querySelectorAll('.annotations-card').forEach((card) => {
      const active = selected.has(card.dataset.id);
      card.classList.toggle('selected', active);
      card.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const count = selected.size;
    multi.hidden = count < 2;
    multi.querySelector('.annotations-multi-count').textContent = '已选 ' + count + ' 条';
  }

  async function deleteSelected() {
    if (!selected.size) return;
    const orderedIds = visibleRecords().filter((record) => selected.has(record.id)).map((record) => record.id);
    if (orderedIds.length > 1 && !await confirmDelete(orderedIds.length)) return;
    onDelete(orderedIds);
    selected.clear();
    render();
  }

  function startEdit(record, card) {
    card.querySelector('.annotations-inline-editor')?.remove();
    const editor = document.createElement('div');
    editor.className = 'annotations-inline-editor';
    const textarea = document.createElement('textarea');
    textarea.value = record.text;
    const cancel = button('取消', 'cancel-edit');
    const save = button('保存', 'save-edit');
    cancel.addEventListener('click', (event) => { event.stopPropagation(); editor.remove(); });
    save.addEventListener('click', (event) => {
      event.stopPropagation();
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      onEdit(record.id, text);
      editor.remove();
    });
    editor.append(textarea, cancel, save);
    card.appendChild(editor);
    textarea.focus();
  }

  function hideCardPopover() {
    list.querySelector('.annotations-card-popover')?.remove();
    popoverRecordId = null;
  }

  function popoverAction(label, action, iconClass) {
    const actionButton = button('', action);
    actionButton.className = 'annotations-popover-action';
    actionButton.title = label;
    actionButton.setAttribute('aria-label', label);
    actionButton.innerHTML = '<span class="annotations-popover-icon ' + iconClass + '"></span>';
    return actionButton;
  }

  function popoverDivider() {
    const divider = document.createElement('span');
    divider.className = 'annotations-popover-divider';
    divider.setAttribute('aria-hidden', 'true');
    return divider;
  }

  function showCardPopover(record, card) {
    if (popoverRecordId === record.id && list.querySelector('.annotations-card-popover')) {
      hideCardPopover();
      return;
    }
    hideCardPopover();
    const popover = document.createElement('div');
    popover.className = 'annotations-card-popover';
    popoverRecordId = record.id;

    const navigation = document.createElement('span');
    navigation.className = 'annotations-popover-group';
    const jump = popoverAction('跳转到对应文字', 'jump', 'i-popover-jump');
    jump.addEventListener('click', () => onJump(record));
    const copy = popoverAction('复制原文', 'copy', 'i-popover-copy');
    copy.addEventListener('click', () => navigator.clipboard?.writeText(record.quote || ''));
    navigation.append(jump, copy);

    const highlightColors = document.createElement('span');
    highlightColors.className = 'annotations-popover-group annotations-popover-colors';
    COLORS.forEach((color) => {
      const swatch = button('', null);
      swatch.className = 'annotations-color c-' + color;
      swatch.title = '高亮为' + color;
      swatch.addEventListener('click', () => onSetHighlight(record.range, color, record.quote));
      highlightColors.appendChild(swatch);
    });

    const cleanup = document.createElement('span');
    cleanup.className = 'annotations-popover-group';
    const clearHighlight = popoverAction('清除该注释范围内的高亮', 'remove-highlight', 'i-popover-eraser');
    clearHighlight.disabled = !allRecords.some((item) => (
      item.type === 'highlight' && rangeIntersects(item.range, record.range)
    ));
    clearHighlight.addEventListener('click', () => {
      if (!clearHighlight.disabled) onRemoveHighlight(record.range);
    });
    cleanup.appendChild(clearHighlight);
    if (record.type === 'note') {
      const remove = popoverAction('删除注释', 'delete', 'i-popover-trash');
      remove.classList.add('is-danger');
      remove.addEventListener('click', () => onDelete([record.id]));
      cleanup.appendChild(remove);
    }

    popover.append(navigation, popoverDivider(), highlightColors, popoverDivider(), cleanup);
    card.before(popover);
  }

  function selectCard(event, record, ordered) {
    const index = ordered.findIndex((item) => item.id === record.id);
    const lastIndex = ordered.findIndex((item) => item.id === lastSelected);
    if (event.shiftKey && lastIndex >= 0) {
      selected.clear();
      const [start, end] = [Math.min(index, lastIndex), Math.max(index, lastIndex)];
      ordered.slice(start, end + 1).forEach((item) => selected.add(item.id));
    } else if (event.metaKey || event.ctrlKey) {
      if (selected.has(record.id)) selected.delete(record.id); else selected.add(record.id);
      lastSelected = record.id;
    } else {
      selected = new Set([record.id]);
      lastSelected = record.id;
    }
    updateSelection();
    if (selected.size !== 1) hideCardPopover();
  }

  function createCard(record, ordered) {
    const card = document.createElement('article');
    card.className = 'annotations-card ' + (record.type === 'highlight' ? 'is-highlight c-' + record.color : 'is-note');
    card.dataset.id = record.id;
    card.setAttribute('aria-selected', selected.has(record.id) ? 'true' : 'false');
    card.tabIndex = 0;
    const quote = document.createElement('div');
    quote.className = 'annotations-quote';
    quote.textContent = record.quote || '原文位置已变化';
    card.appendChild(quote);
    if (record.type === 'note') {
      const text = document.createElement('div');
      text.className = 'annotations-note-text';
      text.textContent = record.text;
      card.appendChild(text);
    }
    const page = document.createElement('span');
    page.className = 'annotations-page';
    page.textContent = 'P' + record.range.start.page;
    card.appendChild(page);
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, textarea')) return;
      selectCard(event, record, ordered);
      if (selected.size === 1) showCardPopover(record, card);
    });
    if (record.type === 'note') {
      card.addEventListener('dblclick', (event) => {
        event.preventDefault();
        startEdit(record, card);
      });
    }
    return card;
  }

  function updateSearchCount(ordered) {
    if (!query) { searchCount.textContent = '0 / ' + ordered.length; return; }
    if (searchIndex >= ordered.length) searchIndex = Math.max(0, ordered.length - 1);
    searchCount.textContent = ordered.length ? (searchIndex + 1) + ' / ' + ordered.length : '0 / 0';
  }

  function render(nextRecords) {
    if (nextRecords) allRecords = [...nextRecords];
    const ordered = visibleRecords();
    const histories = visibleHistoryRecords();
    selected = new Set([...selected].filter((id) => ordered.some((record) => record.id === id)));
    popoverRecordId = null;
    list.innerHTML = '';
    if (!ordered.length && !histories.length) {
      const empty = document.createElement('div');
      empty.className = 'annotations-empty';
      empty.textContent = query ? '没有匹配的标注' : (mode === 'notes' ? '暂无注释' : '暂无高亮');
      list.appendChild(empty);
    } else {
      ordered.forEach((record) => list.appendChild(createCard(record, ordered)));
      if (query.trim()) {
        searchIndex = clamp(searchIndex, 0, ordered.length - 1);
        list.querySelectorAll('.annotations-card')[searchIndex]?.classList.add('search-current');
      }
    }
    renderHistory(histories);
    updateSelection();
    updateSearchCount(ordered);
  }

  function showSearch() {
    search.hidden = false;
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    search.hidden = true;
    searchInput.value = '';
    query = '';
    searchIndex = 0;
    render();
    aside.focus();
  }

  function scrollCardWithinList(card, align = 'nearest') {
    if (!card) return;
    const listRect = list.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    let nextTop = list.scrollTop;
    if (align === 'center') {
      nextTop += ((cardRect.top + cardRect.bottom) - (listRect.top + listRect.bottom)) / 2;
    } else if (cardRect.top < listRect.top) {
      nextTop += cardRect.top - listRect.top;
    } else if (cardRect.bottom > listRect.bottom) {
      nextTop += cardRect.bottom - listRect.bottom;
    }
    // 只滚动内容列表，避免浏览器把整个 Inspector 的标题栏推出裁切区域。
    list.scrollTop = Math.max(0, Math.round(nextTop));
  }

  function moveSearch(delta) {
    const cards = [...list.querySelectorAll('.annotations-card')];
    if (!cards.length) return;
    searchIndex = (searchIndex + delta + cards.length) % cards.length;
    cards.forEach((card, index) => card.classList.toggle('search-current', index === searchIndex));
    scrollCardWithinList(cards[searchIndex]);
    updateSearchCount(visibleRecords());
  }

  listen(tabs, 'click', (event) => {
    const target = event.target.closest('[data-mode]');
    if (!target) return;
    mode = target.dataset.mode;
    tabs.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === target));
    colors.hidden = mode !== 'highlights';
    selected.clear();
    lastSelected = null;
    colorFilter = null;
    searchIndex = 0;
    colors.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
    render();
  });
  listen(colors, 'click', (event) => {
    const target = event.target.closest('[data-color]');
    if (!target) return;
    colorFilter = colorFilter === target.dataset.color ? null : target.dataset.color;
    searchIndex = 0;
    colors.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item.dataset.color === colorFilter));
    render();
  });
  listen(searchInput, 'input', () => { query = searchInput.value; searchIndex = 0; render(); });
  listen(search, 'click', (event) => {
    const action = event.target.closest('[data-search]')?.dataset.search;
    if (action === 'close') closeSearch();
    else if (action === 'prev') moveSearch(-1);
    else if (action === 'next') moveSearch(1);
  });
  listen(multi, 'click', (event) => {
    const selectedRecords = visibleRecords().filter((record) => selected.has(record.id));
    const color = event.target.closest('[data-color]')?.dataset.color;
    if (color) onSetHighlights(selectedRecords, color);
    else if (event.target.closest('[data-action="remove-highlights"]')) onRemoveHighlights(selectedRecords);
    else if (event.target.closest('[data-action="delete-selected"]')) deleteSelected();
  });
  listen(document, 'click', (event) => {
    if (!popoverRecordId) return;
    if (event.target.closest?.('.annotations-card-popover, .annotations-card')) return;
    hideCardPopover();
  });
  listen(aside.querySelector('.annotations-export'), 'click', onExport);
  // 快捷键归属只看当前焦点；位于注释栏内时阻止全局正文搜索处理。
  listen(document, 'keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
    const currentView = !view.wv.hidden;
    const ownsShortcut = currentView && !aside.hidden && aside.contains(document.activeElement);
    if (!ownsShortcut) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showSearch();
  }, { capture: true });
  listen(aside, 'keydown', (event) => {
    const editable = event.target.matches?.('input, textarea');
    if (!editable && ['Delete', 'Backspace'].includes(event.key) && selected.size) {
      event.preventDefault(); deleteSelected();
    }
    if (event.key === 'Escape') {
      if (!search.hidden) closeSearch();
      else {
        selected.clear();
        lastSelected = null;
        hideCardPopover();
        updateSelection();
      }
    }
  });

  listen(resizer, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    resizer.classList.add('is-active');
    document.body.classList.add('layout-resizing');
    event.preventDefault();
  });
  listen(document, 'pointermove', (event) => {
    if (!dragging) return;
    applyWidth(view.wv.getBoundingClientRect().right - event.clientX);
  });
  listen(document, 'pointerup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('is-active');
    document.body.classList.remove('layout-resizing');
    storage.setItem(WIDTH_KEY, String(width));
  });
  listen(resizer, 'dblclick', () => { applyWidth(DEFAULT_WIDTH); storage.setItem(WIDTH_KEY, String(width)); });
  listen(resizer, 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    applyWidth(width + (event.key === 'ArrowLeft' ? 10 : -10));
    storage.setItem(WIDTH_KEY, String(width));
  });
  listen(window, 'resize', () => applyWidth(width));

  // 点击不可聚焦的标题/空白区域时也要把快捷键上下文切换到注释栏。
  listen(aside, 'pointerdown', (event) => {
    const focusable = event.target.closest?.('input, textarea, button, [contenteditable="true"], [tabindex]');
    if (focusable && !focusable.disabled) focusable.focus({ preventScroll: true });
    else aside.focus({ preventScroll: true });
  }, { capture: true });

  listen(list, 'pointerdown', (event) => {
    if (event.button !== 0 || event.target !== list) return;
    const base = (event.metaKey || event.ctrlKey) ? new Set(selected) : new Set();
    const box = document.createElement('div');
    box.className = 'annotations-marquee';
    list.appendChild(box);
    marquee = { startX: event.clientX, startY: event.clientY, base, box };
    event.preventDefault();
  });
  listen(document, 'pointermove', (event) => {
    if (!marquee) return;
    const left = Math.min(marquee.startX, event.clientX);
    const top = Math.min(marquee.startY, event.clientY);
    const right = Math.max(marquee.startX, event.clientX);
    const bottom = Math.max(marquee.startY, event.clientY);
    const listRect = list.getBoundingClientRect();
    Object.assign(marquee.box.style, {
      left: left - listRect.left + 'px', top: top - listRect.top + list.scrollTop + 'px',
      width: right - left + 'px', height: bottom - top + 'px',
    });
    selected = new Set(marquee.base);
    list.querySelectorAll('.annotations-card').forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) selected.add(card.dataset.id);
    });
    updateSelection();
  });
  listen(document, 'pointerup', () => {
    if (!marquee) return;
    marquee.box.remove();
    marquee = null;
    updateSelection();
  });

  function setVisible(visible) {
    aside.hidden = !visible;
    storage.setItem(OPEN_KEY, visible ? '1' : '0');
    if (visible) {
      // 兼容旧状态：打开时清除根容器曾被程序滚动后遗留的位置。
      aside.scrollTop = 0;
      render();
    }
    onLayoutChange();
  }

  function reveal(id) {
    const record = allRecords.find((item) => item.id === id);
    if (!record) return;
    mode = record.type === 'note' ? 'notes' : 'highlights';
    tabs.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item.dataset.mode === mode));
    colors.hidden = mode !== 'highlights';
    colorFilter = null;
    query = '';
    searchInput.value = '';
    setVisible(true);
    selected = new Set([id]);
    lastSelected = id;
    render();
    const card = [...list.querySelectorAll('.annotations-card')].find((item) => item.dataset.id === id);
    scrollCardWithinList(card, 'center');
    if (card && record.type === 'note') showCardPopover(record, card);
    updateSelection();
  }

  render();
  setVisible(storage.getItem(OPEN_KEY) === '1');

  return {
    render,
    reveal,
    setVisible,
    toggle() { setVisible(aside.hidden); return !aside.hidden; },
    isVisible() { return !aside.hidden; },
    destroy() {
      controller.abort();
      aside.remove();
      document.body.classList.remove('layout-resizing');
    },
  };
}
