/* 插件系统核心：注册表 + 事件总线 + 上下文（ctx）。
   设计思想与 dsh-web-ui 的 cordis 插件（inject/apply(ctx)）一致：
   核心提供最小宿主与扩展点，功能由插件以 registerExtension({id, activate(ctx)}) 挂接。 */

const extensions = new Map();
const enabledCache = new Map();

/* ---------- 插件注册 / 启停 ---------- */
export function registerExtension(def) {
  if (!def || !def.id) throw new Error('插件缺少 id');
  extensions.set(def.id, Object.assign({ enabled: true }, def));
}

export function listExtensions() {
  return [...extensions.values()];
}

export function getExtension(id) {
  return extensions.get(id);
}

export function isEnabled(id) {
  const def = extensions.get(id);
  if (!def) return false;
  if (!enabledCache.has(id)) {
    const saved = localStorage.getItem('s2e-plugin:' + id);
    enabledCache.set(id, saved === null ? def.enabled !== false : saved === '1');
  }
  return enabledCache.get(id);
}

export function setEnabled(id, on) {
  enabledCache.set(id, !!on);
  localStorage.setItem('s2e-plugin:' + id, on ? '1' : '0');
}

/* ---------- 事件总线 ---------- */
class Bus {
  constructor() { this._m = new Map(); }
  on(evt, fn) {
    if (!this._m.has(evt)) this._m.set(evt, new Set());
    this._m.get(evt).add(fn);
    return () => this._m.get(evt)?.delete(fn);
  }
  off(evt, fn) { this._m.get(evt)?.delete(fn); }
  emit(evt, payload) {
    this._m.get(evt)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error('[plugin:' + evt + ']', e); } });
  }
}
export const bus = new Bus();

/* ---------- UI 扩展点（核心提供槽位，插件注册） ---------- */
const uiRegistry = {
  toolbarWidgets: [],      // {id, el}  -> #plugin-toolbar
  tocTabs: [],             // {id, title} -> TOC 面板 tab（目录之后）
  contextActions: [],      // {id, label, apply(text, view)}
  settingsSections: [],    // {id, title, render(container)}
};

export const ui = {
  addToolbarWidget(w) { uiRegistry.toolbarWidgets.push(w); renderToolbarWidgets(); },
  addTocTab(tab) { uiRegistry.tocTabs.push(tab); renderTocTabs(); },
  addContextAction(a) { uiRegistry.contextActions.push(a); },
  addSettingsSection(s) { uiRegistry.settingsSections.push(s); renderSettingsSections(); },
  registry: uiRegistry,
  reset() {
    uiRegistry.toolbarWidgets.length = 0;
    uiRegistry.tocTabs.length = 0;
    uiRegistry.contextActions.length = 0;
    uiRegistry.settingsSections.length = 0;
  },
};

/* ---------- 槽位渲染（由核心调用） ---------- */
export function renderToolbarWidgets() {
  const slot = document.getElementById('plugin-toolbar');
  if (!slot) return;
  slot.innerHTML = '';
  for (const w of uiRegistry.toolbarWidgets) slot.appendChild(w.el);
}

export function renderTocTabs() {
  const tabs = document.getElementById('toc-tabs');
  if (!tabs) return;
  // 核心「目录」tab：显示 toc-list，隐藏插件 tab 体
  const coreTab = tabs.querySelector('[data-tt="toc"]');
  if (coreTab && !coreTab.dataset.wired) {
    coreTab.dataset.wired = '1';
    coreTab.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === coreTab));
      document.getElementById('toc-list').hidden = false;
      document.querySelectorAll('.panel-body.tab-body').forEach((x) => { x.hidden = true; });
    });
  }
  // 移除旧插件 tab，按注册顺序重建
  tabs.querySelectorAll('[data-plugintab]').forEach((b) => b.remove());
  uiRegistry.tocTabs.forEach((t, i) => {
    const b = document.createElement('button');
    b.dataset.plugintab = t.id;
    b.dataset.tt = 'plug:' + t.id;
    b.textContent = t.title;
    b.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      document.getElementById('toc-list').hidden = true;
      document.querySelectorAll('.panel-body.tab-body').forEach((x) => { x.hidden = true; });
      const body = document.getElementById('tab-body-' + t.id);
      if (body) body.hidden = false;
      t.onShow?.();
    });
    tabs.appendChild(b);
  });
}

export function renderSettingsSections() {
  const host = document.getElementById('sd-sections');
  if (!host) return;
  host.innerHTML = '';
  for (const s of uiRegistry.settingsSections) {
    const sec = document.createElement('div');
    sec.className = 'sd-section';
    sec.innerHTML = '<div class="sd-sec-title">' + s.title + '</div>';
    host.appendChild(sec);
    try { s.render(sec); } catch (e) { console.error('[settings:' + s.id + ']', e); }
  }
}

/* ---------- 上下文（ctx） ---------- */
export function makeAppCtx() {
  return {
    id: 'app',
    bus,
    ui,
    db: null,               // 由核心在启动时注入
    state: null,            // 核心状态（books/folders/tabs/activeBookId…）
    getView: null,          // 由核心注入：() => 当前活动 bookView
    toast,
    storage: {
      get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
    },
    openBook,
  };
}

export function injectCore(ctx, fns) {
  if (fns.db !== undefined) ctx.db = fns.db;
  if (fns.state !== undefined) ctx.state = fns.state;
  if (fns.getView !== undefined) ctx.getView = fns.getView;
  if (fns.toast !== undefined) toast = fns.toast;
  if (fns.openBook !== undefined) openBook = fns.openBook;
}

/* 激活一个插件（调用其 activate，传入 app 级 ctx） */
export function activateExtension(id, ctx) {
  const def = extensions.get(id);
  if (!def || !isEnabled(id)) return;
  try {
    def._ctx = def.activate ? def.activate(ctx) : null;
  } catch (e) {
    console.error('[plugin:' + id + '] activate 失败', e);
  }
}

export function deactivateExtension(id) {
  const def = extensions.get(id);
  if (def && def.deactivate && def._ctx !== undefined) {
    try { def.deactivate(def._ctx); } catch (e) { console.error('[plugin:' + id + '] deactivate 失败', e); }
  }
}

/* ---------- 由核心注入的后门 ---------- */
export let toast = () => {};
export let openBook = async () => {};
export function setCoreFns(fns) {
  if (fns.toast) toast = fns.toast;
  if (fns.openBook) openBook = fns.openBook;
}
