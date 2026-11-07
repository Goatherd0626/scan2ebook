// 轻量改编自 Rare UI Delete Button；来源与许可见 reader/THIRD_PARTY_NOTICES.md。
let activeConfirmation = null;
let confirmationId = 0;

function isVisible(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function findAnchor(anchor) {
  if (isVisible(anchor)) return anchor;
  const focused = document.activeElement?.closest('button, [role="button"], a[href], input, select, [tabindex]');
  if (isVisible(focused) && !focused.closest('.delete-confirmation')) return focused;
  const homeDelete = document.getElementById('home-delete');
  if (isVisible(homeDelete)) return homeDelete;
  return [...document.querySelectorAll('button:not(:disabled), [role="button"], a[href], input:not(:disabled), [tabindex="0"]')]
    .find((element) => isVisible(element) && !element.closest('.delete-confirmation')) || null;
}

function svg(markup, className = '') {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('viewBox', '0 0 24 24');
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke', 'currentColor');
  element.setAttribute('stroke-width', '2.3');
  element.setAttribute('stroke-linecap', 'round');
  element.setAttribute('stroke-linejoin', 'round');
  element.setAttribute('aria-hidden', 'true');
  if (className) element.setAttribute('class', className);
  element.innerHTML = markup;
  return element;
}

function choice(label, action, markup) {
  const wrapper = document.createElement('div');
  wrapper.className = 'delete-confirmation-choice';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'delete-confirmation-action';
  button.dataset.deleteAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(svg(markup));
  const caption = document.createElement('span');
  caption.className = 'delete-confirmation-choice-label';
  caption.setAttribute('aria-hidden', 'true');
  caption.textContent = action === 'confirm' ? '确认' : label;
  wrapper.append(button, caption);
  return { wrapper, button };
}

export function cancelDeleteConfirmation() {
  activeConfirmation?.close(false);
}

/** @param {{title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, anchor?: HTMLElement | null}} [options]
 * @returns {Promise<boolean>} */
export function confirmDelete({ title, message, confirmLabel = '删除', cancelLabel = '取消', anchor } = {}) {
  const source = findAnchor(anchor);
  activeConfirmation?.close(false, false);
  const controller = new window.AbortController();
  const signal = controller.signal;
  const card = document.createElement('section');
  card.id = `delete-confirmation-${++confirmationId}`;
  card.className = 'delete-confirmation';
  card.dataset.slot = 'delete-button';
  card.dataset.state = 'open';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', `${card.id}-title`);
  const tile = document.createElement('span');
  tile.className = 'delete-confirmation-tile';
  tile.appendChild(svg('<path class="delete-confirmation-bin" d="M19 13.5V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5"/><g class="delete-confirmation-lid"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></g>', 'delete-confirmation-trash'));
  const content = document.createElement('div');
  content.className = 'delete-confirmation-content';
  const heading = document.createElement('h2');
  heading.id = `${card.id}-title`;
  heading.textContent = title || '确认删除？';
  content.appendChild(heading);
  if (message) {
    const description = document.createElement('p');
    description.id = `${card.id}-message`;
    description.textContent = message;
    content.appendChild(description);
    card.setAttribute('aria-describedby', description.id);
  }
  const actions = document.createElement('div');
  actions.className = 'delete-confirmation-actions';
  const cancel = choice(cancelLabel, 'cancel', '<path d="M6 6l12 12M18 6L6 18"/>');
  const confirm = choice(confirmLabel, 'confirm', '<path d="M4 12.5 9.5 18 20 7"/>');
  actions.append(cancel.wrapper, confirm.wrapper);
  card.append(tile, content, actions);

  const previousExpanded = source?.getAttribute('aria-expanded');
  const previousControls = source?.getAttribute('aria-controls');
  source?.setAttribute('aria-expanded', 'true');
  source?.setAttribute('aria-controls', card.id);
  let settled = false;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const state = { source, close };
  activeConfirmation = state;

  function close(value, restoreFocus = true) {
    if (settled) return;
    settled = true;
    controller.abort();
    card.remove();
    for (const [attribute, previous] of [['aria-expanded', previousExpanded], ['aria-controls', previousControls]]) {
      if (previous == null) source?.removeAttribute(attribute);
      else source?.setAttribute(attribute, previous);
    }
    if (activeConfirmation === state) activeConfirmation = null;
    if (restoreFocus && isVisible(source)) source.focus({ preventScroll: true });
    resolveResult(value);
  }

  function position() {
    if (source && !isVisible(source)) { close(false, false); return; }
    const gap = 8;
    const gutter = 12;
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const offsetLeft = viewport?.offsetLeft || 0;
    const offsetTop = viewport?.offsetTop || 0;
    card.style.maxWidth = `${Math.max(0, viewportWidth - gutter * 2)}px`;
    const width = Math.min(card.offsetWidth || 320, viewportWidth - gutter * 2);
    const height = Math.min(card.offsetHeight || 96, viewportHeight - gutter * 2);
    const box = source?.getBoundingClientRect() || { left: viewportWidth - gutter, right: viewportWidth - gutter, top: gutter, bottom: gutter };
    if (box.width && box.height && (box.bottom <= offsetTop || box.top >= offsetTop + viewportHeight || box.right <= offsetLeft || box.left >= offsetLeft + viewportWidth)) {
      close(false, false);
      return;
    }
    const left = Math.max(offsetLeft + gutter, Math.min(box.right - width, offsetLeft + viewportWidth - width - gutter));
    const above = box.bottom + gap + height > offsetTop + viewportHeight - gutter;
    const top = Math.max(offsetTop + gutter, Math.min(above ? box.top - height - gap : box.bottom + gap, offsetTop + viewportHeight - height - gutter));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.dataset.placement = above ? 'top' : 'bottom';
    card.style.setProperty('--delete-origin-x', `${Math.max(20, Math.min(width - 20, (box.left + box.right) / 2 - left))}px`);
    card.style.setProperty('--delete-origin-y', above ? 'bottom' : 'top');
  }

  cancel.button.addEventListener('click', () => close(false), { signal });
  confirm.button.addEventListener('click', () => close(true), { signal });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close(false);
  }, { capture: true, signal });
  const outside = (event) => {
    if (!card.contains(event.target) && !source?.contains(event.target)) close(false);
  };
  document.addEventListener('pointerdown', outside, { capture: true, signal });
  document.addEventListener('mousedown', outside, { capture: true, signal });
  card.addEventListener('focusout', (event) => {
    if (!event.relatedTarget || !card.contains(event.relatedTarget)) close(false, false);
  }, { signal });
  window.addEventListener('scroll', position, { capture: true, signal });
  window.addEventListener('resize', position, { signal });
  window.visualViewport?.addEventListener('resize', position, { signal });
  window.visualViewport?.addEventListener('scroll', position, { signal });
  const modal = source?.closest('[aria-modal="true"]');
  (modal || document.body).appendChild(card);
  position();
  modal?.addEventListener('animationend', position, { signal });
  if (!settled) cancel.button.focus({ preventScroll: true });
  return result;
}
