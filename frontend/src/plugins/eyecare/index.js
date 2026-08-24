/* 插件：阅读环境（护眼）—— 工具栏 👁 浮动面板 + 设置分区，记忆于 localStorage */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'eyecare',
  name: '阅读环境（护眼）',
  version: '1.0.0',
  description: '护眼模式 / 深色模式 / 亮度 / 色温 / 字号 / 行距 / 阅读宽度',
  activate(ctx) {
    const defaults = { eye: false, dark: false, brightness: 100, warmth: 0, fontSize: 17, lineH: 1.9, width: 42 };
    let s;
    try { s = Object.assign({}, defaults, JSON.parse(ctx.storage.get('s2e-settings') || '{}')); }
    catch (e) { s = Object.assign({}, defaults); }

    /* ---- 浮层面板 ---- */
    const panel = document.createElement('div');
    panel.id = 'eyecare-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ec-title">阅读环境</div>
      <div class="ec-row"><label>护眼模式</label><button class="toggle" data-k="eye">关</button></div>
      <div class="ec-row"><label>深色模式</label><button class="toggle" data-k="dark">关</button></div>
      <div class="ec-row"><label>亮度</label><input type="range" data-k="brightness" min="70" max="110"></div>
      <div class="ec-row"><label>色温（暖）</label><input type="range" data-k="warmth" min="0" max="100"></div>
      <div class="ec-row"><label>字号</label><input type="range" data-k="fontSize" min="13" max="26"></div>
      <div class="ec-row"><label>行距</label><input type="range" data-k="lineH" min="1.4" max="2.4" step="0.05"></div>
      <div class="ec-row"><label>阅读宽度</label><input type="range" data-k="width" min="28" max="52"></div>
      <button class="mini" id="ec-reset">恢复默认</button>`;
    document.body.appendChild(panel);

    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.title = '阅读环境';
    btn.textContent = '👁';
    btn.addEventListener('click', () => { panel.hidden = !panel.hidden; syncControls(); });
    ctx.ui.addToolbarWidget({ id: 'eyecare', el: btn });

    panel.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      s[k] = k === 'eye' || k === 'dark' ? !s[k] : parseFloat(e.target.value);
      apply();
    });
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('.toggle');
      if (b) { const k = b.dataset.k; s[k] = !s[k]; apply(); }
      if (e.target.id === 'ec-reset') { s = Object.assign({}, defaults); apply(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });

    /* ---- 设置分区（与面板同一套控件说明） ---- */
    ctx.ui.addSettingsSection({
      id: 'eyecare',
      title: '阅读环境',
      render(sec) {
        sec.appendChild(Object.assign(document.createElement('div'), {
          className: 'p-desc',
          textContent: '使用顶栏 👁 按钮打开调节面板（护眼/深色/亮度/色温/字号/行距/宽度），设置自动记忆。',
        }));
        const reset = document.createElement('button');
        reset.className = 'mini';
        reset.textContent = '恢复默认';
        reset.addEventListener('click', () => { s = Object.assign({}, defaults); apply(); });
        sec.appendChild(reset);
      },
    });

    /* ---- 应用 ---- */
    function mixColor(hex1, hex2, t) {
      const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      const a = p(hex1), b = p(hex2);
      return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
    }
    function apply() {
      document.body.classList.toggle('dark', s.dark);
      const warm = s.eye ? Math.max(45, s.warmth) : s.warmth;
      const paper = s.dark ? '#1f1e1a' : mixColor('#f7f1e4', '#ecd4a6', warm / 100);
      const ink = s.dark ? '#d8d0bf' : mixColor('#3a3126', '#57452a', warm / 100);
      const root = document.documentElement.style;
      root.setProperty('--paper', paper);
      root.setProperty('--ink', ink);
      root.setProperty('--font-size', s.fontSize + 'px');
      root.setProperty('--line-h', s.lineH);
      root.setProperty('--max-width', s.width + 'rem');
      document.body.style.filter = 'brightness(' + (s.brightness / 100) + ')';
      ctx.storage.set('s2e-settings', JSON.stringify(s));
      syncControls();
    }
    function syncControls() {
      panel.querySelectorAll('.toggle').forEach((b) => {
        const on = !!s[b.dataset.k];
        b.textContent = on ? '开' : '关';
        b.classList.toggle('on', on);
      });
      panel.querySelectorAll('input[type=range]').forEach((r) => { r.value = s[r.dataset.k]; });
    }
    apply();
  },
});
