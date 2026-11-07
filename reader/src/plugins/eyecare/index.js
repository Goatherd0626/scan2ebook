/* 阅读环境模块：外观与排版设置，持久化由宿主统一处理。 */
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
  version: '2.1.0',
  description: '外观与阅读排版',
  activate(ctx) {
    const controller = new window.AbortController();
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: controller.signal });
    let settings = readSettings(ctx.storage.get('s2e-settings'));
    const groups = { appearance: ['mode', 'warmth'], typography: ['fontSize', 'lineH', 'contentWidth'] };
    const preview = `<aside class="settings-preview" aria-label="阅读效果预览">
      <span class="settings-preview-label">预览</span><div class="settings-preview-paper">
      <h3>书页与远方</h3><p>书籍把遥远的风景带到眼前，也为日常留下一点思考的空间。</p>
      <p>在字里行间，找到适合自己的阅读节奏。</p></div></aside>`;
    const slider = (key, label, min, max, step = 1) => `<label class="ec-control" data-control="${key}">
      <span class="ec-control-head"><b>${label}</b><output data-output="${key}"></output></span>
      <input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"></label>`;

    function themeColors() {
      if (settings.mode === 'dark') return { paper: '#1e211b', ink: '#f0f2e9' };
      if (settings.mode === 'eye') {
        const amount = 0.22 + settings.warmth / 100 * 0.58;
        return { paper: mixColor('#fbf8f0', '#edddba', amount), ink: mixColor('#312d26', '#4b3f2e', amount * 0.55) };
      }
      return { paper: '#fbf8f0', ink: '#2e2920' };
    }

    function applySettings(persist = true) {
      const root = document.documentElement.style;
      document.body.classList.toggle('dark', settings.mode === 'dark');
      root.removeProperty('--paper'); root.removeProperty('--ink');
      if (settings.mode === 'eye') {
        const colors = themeColors();
        root.setProperty('--paper', colors.paper); root.setProperty('--ink', colors.ink);
      }
      root.setProperty('--font-size', settings.fontSize + 'px');
      root.setProperty('--line-h', String(settings.lineH));
      root.setProperty('--content-width', settings.contentWidth + '%');
      document.body.style.filter = '';
      if (persist) ctx.storage.set('s2e-settings', JSON.stringify(settings));
      syncControls();
    }

    function syncControls() {
      const host = document.getElementById('settings-content');
      if (!host) return;
      host.querySelectorAll('button[data-mode]').forEach(button => {
        const active = button.dataset.mode === settings.mode;
        button.setAttribute('aria-pressed', String(active));
      });
      host.querySelectorAll('input[data-k]').forEach(input => {
        const value = settings[input.dataset.k];
        input.value = value;
        input.style.setProperty('--per', ((value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100) + '%');
      });
      const outputs = { warmth: Math.round(settings.warmth) + '%', fontSize: Math.round(settings.fontSize) + ' px',
        lineH: settings.lineH.toFixed(2) + '×', contentWidth: Math.round(settings.contentWidth) + '%' };
      host.querySelectorAll('[data-output]').forEach(output => { output.textContent = outputs[output.dataset.output]; });
      const warmth = host.querySelector('[data-control="warmth"]');
      if (warmth) warmth.hidden = settings.mode !== 'eye';
      const colors = themeColors();
      host.querySelectorAll('.settings-preview-paper').forEach(paper => {
        paper.style.backgroundColor = colors.paper; paper.style.color = colors.ink;
        paper.style.setProperty('--font-size', settings.fontSize + 'px');
        paper.style.setProperty('--line-h', String(settings.lineH));
        paper.style.setProperty('--content-width', settings.contentWidth + '%');
      });
    }

    const removeSections = Object.keys(groups).map(id => ctx.ui.addSettingsSection({
      id, title: id === 'appearance' ? '外观' : '阅读排版',
      render(section) {
        const reset = document.createElement('button');
        reset.className = 'settings-reset'; reset.type = 'button'; reset.dataset.reset = id;
        reset.textContent = '恢复默认';
        reset.setAttribute('aria-label', '恢复' + (id === 'appearance' ? '外观' : '阅读排版') + '默认设置');
        section.querySelector('.settings-section-heading').appendChild(reset);
        const layout = document.createElement('div'); layout.className = 'settings-form-layout';
        const controls = id === 'appearance' ? `<div class="settings-modes" role="group" aria-label="外观模式">
          ${[['standard', '浅色'], ['eye', '护眼'], ['dark', '深色']].map(([mode, label]) => `<button type="button" data-mode="${mode}" aria-pressed="false"><span class="mode-sample" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span></button>`).join('')}
          </div>${slider('warmth', '纸张色温', 0, 100)}`
          : slider('fontSize', '字号', 13, 26) + slider('lineH', '行距', 1.4, 2.4, 0.05) + slider('contentWidth', '正文宽度', 60, 100, 5)
            + '<p class="settings-note">用于电子书的文字视图，PDF 原页保持原样。</p>';
        layout.innerHTML = '<div class="settings-controls">' + controls + '</div>' + preview;
        section.appendChild(layout);
        listen(section, 'input', event => {
          const key = event.target.dataset.k;
          if (!key) return;
          settings[key] = Number(event.target.value);
          applySettings(false);
        });
        listen(section, 'change', event => {
          if (event.target.dataset.k) applySettings();
        });
        listen(section, 'click', event => {
          const mode = event.target.closest('button[data-mode]');
          if (mode) { settings.mode = mode.dataset.mode; applySettings(); }
          if (event.target.closest('[data-reset]')) {
            for (const key of groups[id]) settings[key] = DEFAULTS[key];
            applySettings();
          }
        });
        syncControls();
      },
    }));
    applySettings();
    return () => {
      controller.abort();
      removeSections.forEach(remove => remove());
      document.body.classList.remove('dark'); document.body.style.filter = '';
      const root = document.documentElement.style;
      ['--paper', '--ink', '--font-size', '--line-h', '--content-width'].forEach(key => root.removeProperty(key));
    };
  },
});
