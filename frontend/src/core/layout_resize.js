const DEFAULT_SIDEBAR_WIDTH = 264;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const SIDEBAR_STORAGE_KEY = 's2e-sidebar-width';
const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.2;
const MIN_PANEL_WIDTH = 240;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sidebarMaxWidth(viewportWidth) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth * 0.45));
}

/** 初始化全局侧边栏拖拽；宽度保存在 localStorage。 */
export function initSidebarResizer({
  handle,
  root = document.documentElement,
  storage = localStorage,
  onCommit = () => {},
}) {
  if (!handle) return () => {};
  const controller = new window.AbortController();
  const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: controller.signal });
  const viewportWidth = () => document.documentElement.clientWidth || window.innerWidth;
  let pointerId = null;
  let width = DEFAULT_SIDEBAR_WIDTH;
  let preferredWidth = DEFAULT_SIDEBAR_WIDTH;

  const apply = (nextWidth, remember = true) => {
    const requested = Number(nextWidth) || DEFAULT_SIDEBAR_WIDTH;
    if (remember) preferredWidth = clamp(requested, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    const maxWidth = sidebarMaxWidth(viewportWidth());
    width = Math.round(clamp(preferredWidth, MIN_SIDEBAR_WIDTH, maxWidth));
    root.style.setProperty('--sbar-w', width + 'px');
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuemax', String(Math.round(maxWidth)));
    return width;
  };

  const commit = () => {
    try { storage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(preferredWidth))); } catch (e) { /* 存储不可用时仍保留本次布局 */ }
    onCommit(width);
  };

  let saved = DEFAULT_SIDEBAR_WIDTH;
  try { saved = Number(storage.getItem(SIDEBAR_STORAGE_KEY)) || DEFAULT_SIDEBAR_WIDTH; } catch (e) { /* 使用默认值 */ }
  apply(saved);

  listen(handle, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    handle.setPointerCapture?.(pointerId);
    handle.classList.add('is-active');
    document.body.classList.add('layout-resizing');
    event.preventDefault();
  });
  listen(document, 'pointermove', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    apply(event.clientX);
  });
  listen(document, 'pointerup', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    handle.releasePointerCapture?.(pointerId);
    pointerId = null;
    handle.classList.remove('is-active');
    document.body.classList.remove('layout-resizing');
    commit();
  });
  listen(handle, 'dblclick', () => {
    apply(DEFAULT_SIDEBAR_WIDTH);
    commit();
  });
  listen(handle, 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    apply(width + (event.key === 'ArrowLeft' ? -10 : 10));
    commit();
  });
  listen(window, 'resize', () => apply(preferredWidth, false));

  return () => {
    controller.abort();
    handle.classList.remove('is-active');
    document.body.classList.remove('layout-resizing');
  };
}

function clampSplitRatio(ratio, viewWidth) {
  if (!Number.isFinite(viewWidth) || viewWidth <= 0) {
    return clamp(Number(ratio) || DEFAULT_SPLIT_RATIO, MIN_SPLIT_RATIO, 1 - MIN_SPLIT_RATIO);
  }
  const minRatio = Math.min(DEFAULT_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, MIN_PANEL_WIDTH / viewWidth));
  return clamp(Number(ratio) || DEFAULT_SPLIT_RATIO, minRatio, 1 - minRatio);
}

/** 初始化单本书的 PDF/文字分割线；返回的清理函数同时提供 setRatio()。 */
export function initSplitResizer({
  view,
  divider,
  initialRatio = DEFAULT_SPLIT_RATIO,
  onChange = () => {},
  onCommit = () => {},
}) {
  if (!view || !divider) return () => {};
  const controller = new window.AbortController();
  const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: controller.signal });
  let pointerId = null;
  let ratio = DEFAULT_SPLIT_RATIO;

  const apply = (nextRatio) => {
    const width = view.getBoundingClientRect().width;
    ratio = Number(clampSplitRatio(nextRatio, width).toFixed(4));
    view.style.setProperty('--pdf-ratio', Number((ratio * 100).toFixed(2)) + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    divider.setAttribute('aria-valuemin', String(Math.round(clampSplitRatio(MIN_SPLIT_RATIO, width) * 100)));
    divider.setAttribute('aria-valuemax', String(Math.round(clampSplitRatio(1 - MIN_SPLIT_RATIO, width) * 100)));
    onChange(ratio);
    return ratio;
  };

  const applyPointer = (clientX) => {
    const rect = view.getBoundingClientRect();
    if (!rect.width) return ratio;
    return apply((clientX - rect.left) / rect.width);
  };

  apply(initialRatio);

  listen(divider, 'pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    pointerId = event.pointerId;
    divider.setPointerCapture?.(pointerId);
    divider.classList.add('is-active');
    document.body.classList.add('layout-resizing');
    event.preventDefault();
  });
  listen(document, 'pointermove', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    applyPointer(event.clientX);
  });
  listen(document, 'pointerup', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    divider.releasePointerCapture?.(pointerId);
    pointerId = null;
    divider.classList.remove('is-active');
    document.body.classList.remove('layout-resizing');
    onCommit(ratio);
  });
  listen(divider, 'dblclick', (event) => {
    if (event.target.closest('button')) return;
    apply(DEFAULT_SPLIT_RATIO);
    onCommit(ratio);
  });
  listen(divider, 'keydown', (event) => {
    if (event.target !== divider || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    apply(ratio + (event.key === 'ArrowLeft' ? -0.02 : 0.02));
    onCommit(ratio);
  });
  listen(window, 'resize', () => apply(ratio));

  const cleanup = () => {
    controller.abort();
    divider.classList.remove('is-active');
    document.body.classList.remove('layout-resizing');
  };
  cleanup.setRatio = apply;
  cleanup.getRatio = () => ratio;
  return cleanup;
}

export const layoutDefaults = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
};
