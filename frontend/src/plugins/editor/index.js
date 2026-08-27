import { registerExtension } from '../../core/extensions.js';
import { archivePageAnnotations, normalizePageItems } from './model.js';

const TYPE_LABELS = {
  body: '正文', heading: '标题', footnote: '脚注', figure: '图片占位', table: '表格占位',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultItem(type, index) {
  if (type === 'heading') return { type, level: 2, text: '' };
  if (type === 'footnote') return { type, index: index + 1, text: '' };
  if (type === 'figure' || type === 'table') return { type };
  return { type: 'body', text: '' };
}

registerExtension({
  id: 'editor',
  name: '正文编辑模式',
  version: '1.0.0',
  description: '按 PDF 页修正结构化文字内容，并归档受影响注释',
  activate(ctx) {
    let mode = false;
    let activeEditor = null;
    const cleanups = [];

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn text-btn editor-toggle';
    toggle.textContent = '编辑';
    toggle.title = '编辑当前电子书的结构化正文';
    toggle.setAttribute('aria-label', '切换正文编辑模式');
    toggle.setAttribute('aria-pressed', 'false');
    const removeToolbar = ctx.ui.addToolbarWidget({ id: 'editor-toggle', el: toggle });

    function updateToggle() {
      const currentView = ctx.getView?.();
      for (const view of ctx.state?.tabs || []) {
        const active = !!currentView && view.bookId === currentView.bookId && mode;
        view.textView?.setSourcePreviewOnHover?.(active);
        view.wv?.classList.toggle('editor-mode', active);
        let banner = view.wv?.querySelector('.editor-mode-banner');
        if (active && !banner) {
          banner = document.createElement('div');
          banner.className = 'editor-mode-banner';
          banner.setAttribute('role', 'status');
          banner.innerHTML = '<span>选择一页进行编辑</span><span class="editor-mode-hint">Esc 退出</span>'
            + '<button type="button" aria-label="退出编辑模式"><span class="sf i-xmark" aria-hidden="true"></span></button>';
          banner.querySelector('button').addEventListener('click', () => {
            mode = false;
            updateToggle();
          });
          view.wv.querySelector('.text-panel')?.prepend(banner);
        } else if (!active) {
          banner?.remove();
        }
      }
      toggle.hidden = !currentView || currentView.prefs?.viewMode === 'pdf';
      toggle.classList.toggle('active', mode);
      toggle.setAttribute('aria-pressed', mode ? 'true' : 'false');
      toggle.textContent = mode ? '编辑中' : '编辑';
    }

    async function closeEditor(force = false) {
      if (!activeEditor) return true;
      if (!force && activeEditor.isDirty() && !await ctx.dialog.confirm({
        title: '放弃未保存的修改？',
        message: '当前页面的内容修改将不会保存。',
        confirmLabel: '放弃修改',
        danger: true,
      })) return false;
      activeEditor.destroy();
      activeEditor = null;
      return true;
    }

    toggle.addEventListener('click', async () => {
      if (mode && !await closeEditor()) return;
      mode = !mode;
      updateToggle();
      ctx.toast(mode ? '编辑模式已开启：点击文字页内容开始编辑' : '编辑模式已关闭');
    });
    const onEditorKeydown = (event) => {
      if (event.key !== 'Escape' || !mode || activeEditor) return;
      mode = false;
      updateToggle();
    };
    document.addEventListener('keydown', onEditorKeydown);
    cleanups.push(() => document.removeEventListener('keydown', onEditorKeydown));

    async function savePage({ book, view, page, items }) {
      const normalizedItems = normalizePageItems(items);
      const records = await ctx.db.getAnnotations(book.id);
      const archived = archivePageAnnotations(records, page);
      if ((archived.affectedHighlights || archived.affectedNotes)
          && !await ctx.dialog.confirm({
            title: '保存本页修改？',
            message: '保存后将移除本页涉及的 ' + archived.affectedHighlights + ' 处高亮和 '
              + archived.affectedNotes + ' 条注释；注释内容会移到历史注释。',
            confirmLabel: '保存并继续',
            danger: true,
          })) {
        return false;
      }

      const bookJson = clone(book.bookJson);
      const sourcePage = bookJson.pages.find((item) => item.pdf_page === page);
      if (!sourcePage) throw new Error('未找到 PDF 第 ' + page + ' 页');
      sourcePage.items = normalizedItems;

      const remainingToc = (bookJson.toc || []).filter((item) => item.pdf_page !== page);
      const pageToc = normalizedItems.filter((item) => item.type === 'heading').map((item) => ({
        number: item.number,
        text: item.text,
        level: item.level,
        pdf_page: page,
      }));
      bookJson.toc = [...remainingToc, ...pageToc]
        .sort((a, b) => ((a.pdf_page || Number.MAX_SAFE_INTEGER) - (b.pdf_page || Number.MAX_SAFE_INTEGER)));

      const pageSnippet = normalizedItems.map((item) => item.text || '').filter(Boolean).join(' ').slice(0, 40);
      const bookmarks = (book.bookmarks || []).map((bookmark) => (
        bookmark.page === page ? { ...bookmark, snippet: pageSnippet } : bookmark
      ));
      const nextBook = { ...book, bookJson, bookmarks };
      await ctx.db.updateBookAndAnnotations(nextBook, archived.records);
      book.bookJson = bookJson;
      book.bookmarks = bookmarks;
      ctx.bus.emit('annotations:replace', { bookId: book.id, records: archived.records });
      view.reloadContent?.();
      ctx.toast('PDF 第 ' + page + ' 页已保存');
      return true;
    }

    async function openPage(bookId, page) {
      if (!mode || ctx.state.activeBookId !== bookId) return;
      const view = ctx.getView?.();
      const book = ctx.state.books.find((item) => item.id === bookId);
      const sourcePage = book?.bookJson?.pages?.find((item) => item.pdf_page === page);
      if (!view || !book || !sourcePage) return;
      if (!await closeEditor()) return;
      const records = await ctx.db.getAnnotations(bookId);
      if (!mode || ctx.state.activeBookId !== bookId) return;
      const impact = archivePageAnnotations(records, page);
      activeEditor = createPageEditor({
        view,
        page,
        items: sourcePage.items || [],
        impact,
        onCancel: () => closeEditor(),
        onSave: async (items) => {
          try {
            const saved = await savePage({ book, view, page, items });
            if (saved) {
              await closeEditor(true);
              mode = false;
              updateToggle();
            }
            return saved;
          } catch (error) {
            ctx.toast('保存失败：' + error.message);
            throw error;
          }
        },
      });
    }

    cleanups.push(ctx.bus.on('page:select', ({ bookId, page }) => openPage(bookId, page)));
    cleanups.push(ctx.bus.on('book:switch', () => { closeEditor(true); updateToggle(); }));
    cleanups.push(ctx.bus.on('book:close', () => closeEditor(true)));
    updateToggle();

    return () => {
      mode = false;
      closeEditor(true);
      cleanups.forEach((cleanup) => cleanup());
      removeToolbar();
    };
  },
});

function createPageEditor({ view, page, items, impact, onCancel, onSave }) {
  const panel = view.wv.querySelector('.text-panel');
  const controller = new window.AbortController();
  const original = clone(items);
  let draft = clone(items);
  let editingIndex = null;
  let saving = false;

  const overlay = document.createElement('div');
  overlay.className = 'page-editor-overlay';
  overlay.innerHTML = `
    <section class="page-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="page-editor-title" tabindex="-1">
      <header class="page-editor-head">
        <div><span class="page-editor-eyebrow">结构化正文</span><h2 id="page-editor-title">PDF 第 ${page} 页</h2></div>
        <button type="button" class="page-editor-close" data-action="cancel" aria-label="关闭编辑器"><span class="sf i-xmark" aria-hidden="true"></span></button>
      </header>
      <div class="page-editor-impact" role="status"></div>
      <div class="page-editor-items"></div>
      <button type="button" class="page-editor-add" data-action="add-item">＋ 添加内容块</button>
      <div class="page-editor-error" role="alert" hidden></div>
      <footer class="page-editor-footer">
        <button type="button" class="mini" data-action="cancel">取消</button>
        <button type="button" class="mini primary" data-action="save-page">保存本页</button>
      </footer>
    </section>`;
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.page-editor-dialog');
  const itemsHost = overlay.querySelector('.page-editor-items');
  const impactEl = overlay.querySelector('.page-editor-impact');
  const errorEl = overlay.querySelector('.page-editor-error');
  const saveButton = overlay.querySelector('[data-action="save-page"]');
  impactEl.hidden = !(impact.affectedHighlights || impact.affectedNotes);
  impactEl.textContent = impactEl.hidden ? ''
    : '本页关联 ' + impact.affectedHighlights + ' 处高亮、' + impact.affectedNotes
      + ' 条注释；保存后高亮移除，注释归档到历史。';

  function place() {
    const rect = panel.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px',
    });
  }

  function summary(item) {
    if (item.type === 'figure') return '原文图片占位';
    if (item.type === 'table') return '原文表格占位';
    const prefix = item.type === 'heading' && item.number ? item.number + ' ' : '';
    return (prefix + (item.text || '未填写内容')).slice(0, 90);
  }

  function renderFields(card, item, index) {
    const fields = document.createElement('div');
    fields.className = 'page-editor-fields';
    const typeLabel = document.createElement('label');
    typeLabel.textContent = '块类型';
    const type = document.createElement('select');
    type.className = 'page-editor-type';
    for (const value of Object.keys(TYPE_LABELS)) {
      const option = document.createElement('option');
      option.value = value; option.textContent = TYPE_LABELS[value]; option.selected = item.type === value;
      type.appendChild(option);
    }
    type.addEventListener('change', () => {
      draft[index] = defaultItem(type.value, index);
      editingIndex = index;
      renderItems();
    });
    typeLabel.appendChild(type);
    fields.appendChild(typeLabel);

    if (item.type === 'heading') {
      const numberLabel = document.createElement('label');
      numberLabel.textContent = '标题编号';
      const number = document.createElement('input');
      number.value = item.number || '';
      number.addEventListener('input', () => { item.number = number.value; });
      numberLabel.appendChild(number);
      const levelLabel = document.createElement('label');
      levelLabel.textContent = '标题层级';
      const level = document.createElement('input');
      level.type = 'number'; level.min = '1'; level.max = '4'; level.value = item.level || 2;
      level.addEventListener('input', () => { item.level = Number(level.value); });
      levelLabel.appendChild(level);
      fields.append(numberLabel, levelLabel);
    }
    if (item.type === 'footnote') {
      const indexLabel = document.createElement('label');
      indexLabel.textContent = '脚注序号';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.value = item.index || index + 1;
      input.addEventListener('input', () => { item.index = Number(input.value); });
      indexLabel.appendChild(input);
      fields.appendChild(indexLabel);
    }
    if (!['figure', 'table'].includes(item.type)) {
      const textLabel = document.createElement('label');
      textLabel.className = 'page-editor-text-field';
      textLabel.textContent = '具体内容';
      const textarea = document.createElement('textarea');
      textarea.value = item.text || '';
      textarea.rows = item.type === 'body' ? 5 : 3;
      textarea.addEventListener('input', () => { item.text = textarea.value; });
      textLabel.appendChild(textarea);
      fields.appendChild(textLabel);
    } else {
      fields.appendChild(Object.assign(document.createElement('p'), {
        className: 'page-editor-type-note',
        textContent: TYPE_LABELS[item.type] + '按现有 JSON 契约只保存 type，不保存额外内容。',
      }));
    }
    card.appendChild(fields);
  }

  function renderItems() {
    itemsHost.innerHTML = '';
    draft.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'page-editor-item' + (editingIndex === index ? ' editing' : '');
      card.innerHTML = `
        <div class="page-editor-item-head">
          <span class="page-editor-index">${index + 1}</span>
          <span class="page-editor-type-badge">${TYPE_LABELS[item.type] || item.type}</span>
          <span class="page-editor-summary"></span>
          <button type="button" data-action="edit-item">${editingIndex === index ? '收起' : '编辑'}</button>
          <button type="button" class="danger" data-action="delete-item">删除</button>
        </div>`;
      card.querySelector('.page-editor-summary').textContent = summary(item);
      card.querySelector('[data-action="edit-item"]').addEventListener('click', () => {
        editingIndex = editingIndex === index ? null : index;
        renderItems();
      });
      card.querySelector('[data-action="delete-item"]').addEventListener('click', () => {
        draft.splice(index, 1);
        editingIndex = null;
        renderItems();
      });
      if (editingIndex === index) renderFields(card, item, index);
      itemsHost.appendChild(card);
    });
  }

  function isDirty() {
    return JSON.stringify(draft) !== JSON.stringify(original);
  }

  overlay.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancel') onCancel();
    if (action === 'add-item') {
      draft.push(defaultItem('body', draft.length));
      editingIndex = draft.length - 1;
      renderItems();
      itemsHost.lastElementChild?.querySelector('textarea')?.focus();
    }
    if (action === 'save-page' && !saving) {
      errorEl.hidden = true;
      try {
        const normalized = normalizePageItems(draft);
        saving = true;
        saveButton.disabled = true;
        await onSave(normalized);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      } finally {
        saving = false;
        saveButton.disabled = false;
      }
    }
    if (event.target === overlay) onCancel();
  }, { signal: controller.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onCancel();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveButton.click();
  }, { signal: controller.signal });
  window.addEventListener('resize', place, { signal: controller.signal });
  place();
  renderItems();
  dialog.focus();

  return {
    isDirty,
    destroy() { controller.abort(); overlay.remove(); },
  };
}
