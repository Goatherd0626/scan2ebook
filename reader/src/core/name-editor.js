import { showToast } from './toast.js';

let activeEditor = null;
let nextId = 0;

export function cancelNameEditor() { activeEditor?.close(false, false); }

/** @param {{anchor?: HTMLElement | null, title?: string, value: string, onSave: (name: string) => void | Promise<void>, returnFocus?: () => HTMLElement | null}} options
 * @returns {Promise<boolean>} */
export function editName({ anchor = document.activeElement, title = '重命名', value, onSave, returnFocus } = {}) {
  if (activeEditor?.anchor === anchor) { activeEditor.input.focus(); return activeEditor.result; }
  activeEditor?.close(false, false);
  const controller = new window.AbortController();
  const signal = controller.signal;
  const card = document.createElement('form');
  card.className = 'name-editor';
  card.id = `name-editor-${++nextId}`;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', card.id + '-title');
  card.noValidate = true;
  const heading = document.createElement('h2');
  heading.id = card.id + '-title'; heading.textContent = title;
  const input = document.createElement('input');
  input.type = 'text'; input.value = value; input.setAttribute('aria-label', '名称');
  input.autocomplete = 'off'; input.spellcheck = false;
  const error = document.createElement('p');
  error.id = card.id + '-error'; error.hidden = true; error.textContent = '请输入名称';
  input.setAttribute('aria-describedby', error.id);
  const actions = document.createElement('div'); actions.className = 'name-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.dataset.nameAction = 'cancel'; cancel.textContent = '取消';
  const submit = document.createElement('button');
  submit.type = 'submit'; submit.dataset.nameAction = 'save'; submit.textContent = '保存';
  actions.append(cancel, submit); card.append(heading, input, error, actions);
  const expanded = anchor?.getAttribute('aria-expanded');
  const controls = anchor?.getAttribute('aria-controls');
  anchor?.setAttribute('aria-expanded', 'true'); anchor?.setAttribute('aria-controls', card.id);
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });
  let settled = false, pending = false, composing = false;
  const state = { anchor, input, result, close };
  activeEditor = state;

  function close(saved, restoreFocus = true) {
    if (settled) return;
    settled = true; controller.abort(); card.remove();
    for (const [attribute, previous] of [['aria-expanded', expanded], ['aria-controls', controls]]) {
      if (previous == null) anchor?.removeAttribute(attribute); else anchor?.setAttribute(attribute, previous);
    }
    if (activeEditor === state) activeEditor = null;
    if (restoreFocus) {
      const target = anchor?.isConnected ? anchor : returnFocus?.();
      if (target && !target.closest('[hidden], [inert]')) target.focus({ preventScroll: true });
    }
    resolveResult(saved);
  }

  function position() {
    if (anchor && !anchor.isConnected) { close(false, false); return; }
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const rect = anchor?.getBoundingClientRect() || { left: left + 12, top: top + 12, bottom: top + 12 };
    card.style.maxWidth = `${width - 24}px`;
    const cardWidth = card.offsetWidth || Math.min(360, width - 24), cardHeight = card.offsetHeight || 150;
    card.style.left = Math.max(left + 12, Math.min(rect.left, left + width - cardWidth - 12)) + 'px';
    card.style.top = Math.max(top + 12, Math.min(rect.bottom + 8 + cardHeight > top + height - 12 ? rect.top - cardHeight - 8 : rect.bottom + 8, top + height - cardHeight - 12)) + 'px';
  }

  async function save() {
    if (pending || settled || composing) return;
    const next = input.value.trim();
    if (!next) { error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    if (next === value.trim()) { close(false); return; }
    pending = true; card.setAttribute('aria-busy', 'true');
    input.disabled = submit.disabled = cancel.disabled = true; submit.textContent = '保存中…';
    try { await onSave(next); close(true); }
    catch (failure) {
      if (settled) return;
      showToast({ type: 'error', message: failure instanceof Error ? failure.message : '名称未能保存，请重试' });
      pending = false; card.removeAttribute('aria-busy');
      input.disabled = submit.disabled = cancel.disabled = false; submit.textContent = '保存'; input.focus();
    }
  }

  card.addEventListener('submit', event => { event.preventDefault(); save(); }, { signal });
  cancel.addEventListener('click', () => close(false), { signal });
  input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); }, { signal });
  input.addEventListener('compositionstart', () => { composing = true; }, { signal });
  input.addEventListener('compositionend', () => { composing = false; }, { signal });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); save(); }
  }, { signal });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || composing) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (!pending) close(false);
  }, { signal, capture: true });
  document.addEventListener('pointerdown', event => {
    if (!pending && !card.contains(event.target) && !anchor?.contains(event.target)) close(false, false);
  }, { signal, capture: true });
  card.addEventListener('focusout', event => {
    if (!pending && event.relatedTarget && !card.contains(event.relatedTarget) && !anchor?.contains(event.relatedTarget)) close(false, false);
  }, { signal });
  window.addEventListener('resize', position, { signal });
  window.addEventListener('scroll', position, { signal, capture: true });
  window.visualViewport?.addEventListener('resize', position, { signal });
  window.visualViewport?.addEventListener('scroll', position, { signal });
  (anchor?.closest('[aria-modal="true"]') || document.body).appendChild(card);
  position(); input.focus({ preventScroll: true }); input.select();
  return result;
}
