// 轻量改编自 Rare UI Toast；来源与许可见 reader/THIRD_PARTY_NOTICES.md。
const queues = new WeakMap();
const types = new Set(['info', 'success', 'error', 'warning', 'loading']);
const glyphs = {
  info: '<circle cx="12" cy="6.25" r="1.6" fill="currentColor" stroke="none"/><path d="M12 11v7" pathLength="1"/>',
  success: '<path d="M6 12.5l4 4 8-9" pathLength="1"/>',
  error: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9" pathLength="1"/>',
  warning: '<path d="M12 6v7" pathLength="1"/><circle cx="12" cy="18" r="1.6" fill="currentColor" stroke="none"/>',
  loading: '<circle cx="12" cy="12" r="8" stroke-opacity=".25"/><path d="M12 4a8 8 0 0 1 8 8"/>',
};

function icon(markup) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

export function showToast(options) {
  const config = typeof options === 'string' ? { message: options } : (options || {});
  let host = document.getElementById('toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast';
    document.body.appendChild(host);
  }
  host.dataset.toastRegion = '1';
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', '操作提示');
  host.removeAttribute('aria-live');
  host.removeAttribute('aria-atomic');
  const view = host.ownerDocument.defaultView;
  const queue = queues.get(host) || [];
  queues.set(host, queue);
  const controller = new view.AbortController();
  const signal = controller.signal;
  const card = document.createElement('section');
  card.className = 'rare-toast';
  card.dataset.slot = 'toast';
  card.setAttribute('aria-atomic', 'true');
  const tile = document.createElement('span');
  tile.dataset.slot = 'toast-icon';
  tile.setAttribute('aria-hidden', 'true');
  const content = document.createElement('div');
  content.className = 'rare-toast-content';
  const title = document.createElement('p');
  title.className = 'toast-message';
  title.dataset.slot = 'toast-title';
  title.textContent = config.message || '';
  const description = document.createElement('p');
  description.dataset.slot = 'toast-description';
  description.textContent = config.description || '';
  description.hidden = !config.description;
  content.append(title, description);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.dataset.slot = 'toast-close';
  dismiss.setAttribute('aria-label', '关闭提示');
  dismiss.appendChild(icon('<path d="M7 7l10 10M17 7L7 17"/>'));
  card.append(tile, content);

  let closed = false;
  let pending = false;
  let completed = false;
  let hovered = false;
  let focused = false;
  let timer = null;
  let startedAt = 0;
  const initialType = types.has(config.type) ? config.type : 'info';
  let remaining = Math.max(0, config.duration ?? (initialType === 'loading' ? 0 : 3600));
  const state = { close };

  function setType(type) {
    card.dataset.type = type;
    card.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    tile.replaceChildren(icon(glyphs[type]));
  }

  function pauseTimer() {
    if (timer === null) return;
    view.clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  }

  function updateTimer() {
    if (closed) return;
    if (hovered || focused || pending) {
      pauseTimer();
      return;
    }
    if (timer !== null || remaining === 0) return;
    startedAt = Date.now();
    timer = view.setTimeout(close, remaining);
  }

  function restartTimer() {
    pauseTimer();
    remaining = Math.max(0, config.duration ?? 3600);
    focused = card.contains(document.activeElement);
    updateTimer();
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    controller.abort();
    card.remove();
    const index = queue.indexOf(state);
    if (index !== -1) queue.splice(index, 1);
    if (!queue.length) host.classList.remove('show');
  }

  if (config.actionLabel && typeof config.onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.dataset.toastAction = '1';
    action.dataset.slot = 'toast-action';
    action.textContent = config.actionLabel;
    action.addEventListener('click', async () => {
      if (closed || pending || completed) return;
      pending = true;
      action.disabled = true;
      card.setAttribute('aria-busy', 'true');
      setType('loading');
      updateTimer();
      try {
        await config.onAction();
        if (closed) return;
        completed = true;
        title.textContent = config.doneMessage || '已撤销';
        description.hidden = true;
        action.remove();
        setType('success');
      } catch {
        if (closed) return;
        title.textContent = '操作失败，请重试';
        description.textContent = `请再次点按「${config.actionLabel}」。`;
        description.hidden = false;
        action.textContent = '重试';
        action.disabled = false;
        setType('error');
      }
      pending = false;
      card.removeAttribute('aria-busy');
      restartTimer();
    }, { signal });
    card.appendChild(action);
  }

  dismiss.addEventListener('click', close, { signal });
  card.addEventListener('mouseenter', () => { hovered = true; updateTimer(); }, { signal });
  card.addEventListener('mouseleave', () => { hovered = false; updateTimer(); }, { signal });
  card.addEventListener('focusin', () => { focused = true; updateTimer(); }, { signal });
  card.addEventListener('focusout', (event) => {
    focused = !!event.relatedTarget && card.contains(event.relatedTarget);
    updateTimer();
  }, { signal });
  card.appendChild(dismiss);
  setType(initialType);
  queue.push(state);
  host.appendChild(card);
  host.classList.add('show');
  while (queue.length > 3) queue[0].close();
  updateTimer();
  return close;
}
