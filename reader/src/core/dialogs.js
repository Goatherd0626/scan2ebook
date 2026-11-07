let activeSheet = null;

export { showToast } from './toast.js';

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.dataset.dialogAction = action;
  element.className = className;
  return element;
}

function focusableElements(root) {
  return [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
}

function openSheet(options, inputOptions = null) {
  activeSheet?.close(null);
  const source = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const mask = document.createElement('div');
  mask.className = 'app-sheet-mask';
  const dialog = document.createElement('section');
  dialog.className = 'app-sheet';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'app-sheet-title');

  const head = document.createElement('header');
  head.className = 'app-sheet-head';
  const title = document.createElement('h2');
  title.id = 'app-sheet-title';
  title.textContent = options.title;
  head.appendChild(title);
  dialog.appendChild(head);

  if (options.message) {
    const message = document.createElement('p');
    message.className = 'app-sheet-message';
    message.textContent = options.message;
    dialog.appendChild(message);
  }

  let input = null;
  if (inputOptions) {
    const field = document.createElement('label');
    field.className = 'app-sheet-field';
    const label = document.createElement('span');
    label.textContent = inputOptions.label || '名称';
    const isSelect = Array.isArray(inputOptions.choices);
    input = document.createElement(isSelect ? 'select' : 'input');
    input.className = 'app-sheet-input';
    if (isSelect) {
      for (const choice of inputOptions.choices) {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        input.appendChild(option);
      }
    } else input.placeholder = inputOptions.placeholder || '';
    input.value = inputOptions.value || '';
    field.append(label, input);
    dialog.appendChild(field);
  }

  const actions = document.createElement('footer');
  actions.className = 'app-sheet-actions';
  const cancel = button(options.cancelLabel || '取消', 'cancel', 'app-sheet-button');
  const confirm = button(options.confirmLabel || '确定', 'confirm', 'app-sheet-button app-sheet-primary');
  if (options.danger) confirm.classList.add('is-danger');
  if (input) confirm.disabled = !inputOptions.allowEmpty && !input.value.trim();
  actions.append(cancel, confirm);
  dialog.appendChild(actions);
  mask.appendChild(dialog);
  document.body.appendChild(mask);

  let settled = false;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const controller = new window.AbortController();
  const close = (value) => {
    if (settled) return;
    settled = true;
    controller.abort();
    mask.remove();
    activeSheet = null;
    source?.focus();
    resolveResult(value);
  };
  activeSheet = { close };

  cancel.addEventListener('click', () => close(null), { signal: controller.signal });
  confirm.addEventListener('click', () => close(input ? input.value.trim() : true), { signal: controller.signal });
  input?.addEventListener('input', () => {
    confirm.disabled = !inputOptions.allowEmpty && !input.value.trim();
  }, { signal: controller.signal });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(null);
      return;
    }
    if (event.key === 'Enter' && input?.tagName === 'INPUT' && event.target === input && !confirm.disabled) {
      event.preventDefault();
      confirm.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }, { signal: controller.signal });
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) close(null);
  }, { signal: controller.signal });

  (input || cancel).focus();
  input?.select?.();
  return result;
}

export function confirmSheet(options) {
  return openSheet(options).then(Boolean);
}

export function promptSheet(options) {
  return openSheet(options, options);
}

export function selectSheet(options) {
  return openSheet(options, { ...options, allowEmpty: true });
}
