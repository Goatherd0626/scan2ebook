/* 插件：阅读环境 —— 外观主题 + 字号/行距，记忆于 localStorage */
import { registerExtension } from '../../core/extensions.js';

const DEFAULTS = { mode: 'standard', warmth: 55, fontSize: 17, lineH: 1.9, contentWidth: 100 };
const MODES = new Set(['standard', 'eye', 'dark']);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function readSettings(raw) {
  let saved = {};
  try { saved = JSON.parse(raw || '{}'); } catch (e) { /* 无效配置按默认值处理 */ }
  const legacyMode = saved.dark ? 'dark' : saved.eye ? 'eye' : 'standard';
  return {
    mode: MODES.has(saved.mode) ? saved.mode : legacyMode,
    warmth: clamp(saved.warmth, 0, 100, DEFAULTS.warmth),
    fontSize: clamp(saved.fontSize, 13, 26, DEFAULTS.fontSize),
    lineH: clamp(saved.lineH, 1.4, 2.4, DEFAULTS.lineH),
    contentWidth: clamp(saved.contentWidth, 60, 100, DEFAULTS.contentWidth),
  };
}

function mixColor(hex1, hex2, amount) {
  const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const a = parse(hex1), b = parse(hex2);
  return '#' + a.map((value, index) => Math.round(value + (b[index] - value) * amount)
    .toString(16).padStart(2, '0')).join('');
}

registerExtension({
  id: 'eyecare',
  name: '阅读环境',
  version: '2.0.0',
  description: '标准 / 护眼 / 深色外观，以及字号、行距和正文宽度调节',
  activate(ctx) {
    const controller = new window.AbortController();
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: controller.signal });
    let committed = readSettings(ctx.storage.get('s2e-settings'));
    let draft = { ...committed };

    const panel = document.createElement('div');
    panel.id = 'eyecare-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ec-head">
        <div>
          <div class="ec-title">阅读外观</div>
          <div class="ec-subtitle">让文字更适合长时间阅读</div>
        </div>
        <button class="ec-reset" type="button" title="恢复默认" aria-label="恢复默认"><span class="sf i-reset-clockwise" aria-hidden="true"></span></button>
      </div>
      <div class="ec-preview" aria-hidden="true">
        <span class="ec-preview-label">正文预览</span>
        <p>好的排版让注意力停留在文字本身。</p>
      </div>
      <div class="ec-mode-group" role="group" aria-label="阅读外观">
        <button type="button" data-mode="standard">标准</button>
        <button type="button" data-mode="eye">护眼</button>
        <button type="button" data-mode="dark">深色</button>
      </div>
      <div class="ec-controls">
        <label class="ec-control" data-control="warmth">
          <span class="ec-control-head"><b>色温</b><output data-output="warmth"></output></span>
          <input type="range" data-k="warmth" min="0" max="100" aria-label="护眼色温">
        </label>
        <label class="ec-control">
          <span class="ec-control-head"><b>字号</b><output data-output="fontSize"></output></span>
          <input type="range" data-k="fontSize" min="13" max="26" aria-label="正文字号">
        </label>
        <label class="ec-control">
          <span class="ec-control-head"><b>行距</b><output data-output="lineH"></output></span>
          <input type="range" data-k="lineH" min="1.4" max="2.4" step="0.05" aria-label="正文行距">
        </label>
        <label class="ec-control">
          <span class="ec-control-head"><b>正文宽度</b><output data-output="contentWidth"></output></span>
          <input type="range" data-k="contentWidth" min="60" max="100" step="5" aria-label="正文宽度">
        </label>
      </div>
      <div class="ec-actions">
        <button class="ec-cancel" type="button">取消</button>
        <button class="ec-apply" type="button" disabled>应用</button>
      </div>`;
    document.body.appendChild(panel);

    const toolbarButton = document.createElement('button');
    toolbarButton.className = 'icon-btn ec-toolbar-btn';
    toolbarButton.title = '阅读环境';
    toolbarButton.setAttribute('aria-controls', panel.id);
    toolbarButton.setAttribute('aria-expanded', 'false');
    toolbarButton.innerHTML = '<span class="ec-aa">A<span>a</span></span>';
    const removeToolbar = ctx.ui.addToolbarWidget({ id: 'eyecare', el: toolbarButton });
    const resetIcon = panel.querySelector('.i-reset-clockwise');

    const setPanelOpen = (open) => {
      draft = { ...committed };
      panel.hidden = !open;
      toolbarButton.classList.toggle('active', open);
      toolbarButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) syncControls();
    };

    listen(toolbarButton, 'click', () => setPanelOpen(panel.hidden));
    listen(panel, 'input', (event) => {
      const key = event.target.dataset.k;
      if (!key) return;
      draft[key] = parseFloat(event.target.value);
      syncControls();
    });
    listen(panel, 'click', (event) => {
      const modeButton = event.target.closest('button[data-mode]');
      if (modeButton) {
        draft.mode = modeButton.dataset.mode;
        syncControls();
        return;
      }
      if (event.target.closest('.ec-reset')) {
        resetIcon.classList.remove('is-bouncing');
        void resetIcon.offsetWidth;  // 强制重排，让连续点击也能重新开始动画
        resetIcon.classList.add('is-bouncing');
        committed = { ...DEFAULTS };
        draft = { ...DEFAULTS };
        applyCommitted();
        syncControls();
        return;
      }
      if (event.target.closest('.ec-apply')) {
        committed = { ...draft };
        applyCommitted();
        setPanelOpen(false);
        return;
      }
      if (event.target.closest('.ec-cancel')) {
        setPanelOpen(false);
      }
    });
    listen(document, 'keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) setPanelOpen(false);
    });
    listen(resetIcon, 'animationend', () => resetIcon.classList.remove('is-bouncing'));

    const removeSettings = ctx.ui.addSettingsSection({
      id: 'eyecare',
      title: '阅读环境',
      render(section) {
        section.appendChild(Object.assign(document.createElement('div'), {
          className: 'p-desc',
          textContent: '使用顶栏 Aa 按钮切换标准、护眼或深色外观，并调整正文字号、行距和宽度。设置自动记忆。',
        }));
        const reset = document.createElement('button');
        reset.className = 'mini';
        reset.textContent = '恢复默认';
        reset.addEventListener('click', () => {
          committed = { ...DEFAULTS };
          draft = { ...DEFAULTS };
          applyCommitted();
          if (!panel.hidden) syncControls();
        });
        section.appendChild(reset);
      },
    });

    function themeColors(settings) {
      if (settings.mode === 'dark') return { paper: '#1e1d18', ink: '#ddd5c2' };
      if (settings.mode === 'eye') {
        const amount = 0.22 + settings.warmth / 100 * 0.58;
        return {
          paper: mixColor('#fbf8f0', '#edddba', amount),
          ink: mixColor('#312d26', '#4b3f2e', amount * 0.55),
        };
      }
      return { paper: '#fbf8f0', ink: '#2e2920' };
    }

    function applyCommitted() {
      const root = document.documentElement.style;
      document.body.classList.toggle('dark', committed.mode === 'dark');
      root.removeProperty('--paper');
      root.removeProperty('--ink');
      if (committed.mode === 'eye') {
        // 护眼模式只轻柔地温暖文字纸面，避免整页发黄和对比度骤降。
        const colors = themeColors(committed);
        root.setProperty('--paper', colors.paper);
        root.setProperty('--ink', colors.ink);
      }
      root.setProperty('--font-size', committed.fontSize + 'px');
      root.setProperty('--line-h', String(committed.lineH));
      root.setProperty('--content-width', committed.contentWidth + '%');
      document.body.style.filter = '';  // 清除 v1 亮度设置可能留下的行内样式
      ctx.storage.set('s2e-settings', JSON.stringify(committed));
    }

    function syncControls() {
      panel.querySelectorAll('button[data-mode]').forEach((button) => {
        const active = button.dataset.mode === draft.mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      panel.querySelectorAll('input[type="range"]').forEach((input) => {
        const value = draft[input.dataset.k];
        input.value = value;
        const min = Number(input.min), max = Number(input.max);
        input.style.setProperty('--per', ((value - min) / (max - min) * 100) + '%');
      });
      const warmth = panel.querySelector('[data-k="warmth"]');
      const warmthControl = panel.querySelector('[data-control="warmth"]');
      const warmthEnabled = draft.mode === 'eye';
      warmth.disabled = !warmthEnabled;
      warmthControl.classList.toggle('is-disabled', !warmthEnabled);
      panel.querySelector('[data-output="warmth"]').textContent = Math.round(draft.warmth) + '%';
      panel.querySelector('[data-output="fontSize"]').textContent = Math.round(draft.fontSize) + ' px';
      panel.querySelector('[data-output="lineH"]').textContent = draft.lineH.toFixed(2) + '×';
      panel.querySelector('[data-output="contentWidth"]').textContent = Math.round(draft.contentWidth) + '%';
      syncPreview();
      panel.querySelector('.ec-apply').disabled = Object.keys(DEFAULTS)
        .every((key) => draft[key] === committed[key]);
    }

    function syncPreview() {
      const preview = panel.querySelector('.ec-preview');
      const colors = themeColors(draft);
      preview.dataset.mode = draft.mode;
      preview.style.backgroundColor = colors.paper;
      preview.style.color = colors.ink;
      preview.style.setProperty('--font-size', draft.fontSize + 'px');
      preview.style.setProperty('--line-h', String(draft.lineH));
      preview.style.setProperty('--content-width', draft.contentWidth + '%');
    }

    applyCommitted();
    syncControls();

    return () => {
      controller.abort();
      removeSettings();
      removeToolbar();
      panel.remove();
      document.body.classList.remove('dark');
      document.body.style.filter = '';
      const root = document.documentElement.style;
      ['--paper', '--ink', '--font-size', '--line-h', '--content-width'].forEach((key) => root.removeProperty(key));
    };
  },
});
