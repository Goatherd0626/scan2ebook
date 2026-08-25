/* 插件：脚注交互 —— 正文上标 ⟦g⟧ → 悬浮浮窗 / 点击插入浅灰括号脚注 */
import { registerExtension } from '../../core/extensions.js';

registerExtension({
  id: 'footnotes',
  name: '脚注交互',
  version: '1.0.0',
  description: '正文脚注上标：悬浮显示脚注内容，点击在文中插入浅灰括号脚注（再点收起）',
  activate(ctx) {
    const tip = document.getElementById('fn-tooltip');
    if (!tip) return;

    // item 渲染后：把 body 文本里的 ⟦g⟧ 标记替换为可交互上标
    const offItem = ctx.bus.on('item:render', ({ el, item, model }) => {
      if (item.type !== 'body') return;
      convertMarkers(el, model);
    });

    // 页渲染后：本页未被正文引用的脚注（孤儿）以页末小字展示
    const offPage = ctx.bus.on('page:render', ({ page, anchor, model }) => {
      renderOrphans(page, anchor, model);
    });

    function renderOrphans(page, anchor, model) {
      anchor.querySelector(':scope > .fn-orphan')?.remove();
      const referenced = new Set();
      anchor.querySelectorAll('.body sup.fnref').forEach((s) => referenced.add(+s.dataset.g));
      const orphans = model.footnotes.filter((f) => f && f.page === page && !referenced.has(f.id));
      if (!orphans.length) return;
      const od = document.createElement('div');
      // 孤立脚注也是该页可见内容，需参与页范围与 item 来源悬浮。
      od.className = 'fn-orphan text-item';
      od.dataset.page = page;
      od.dataset.item = page + ':footnotes';
      orphans.forEach((f) => {
        od.appendChild(Object.assign(document.createElement('div'), { textContent: '[' + f.id + '] ' + f.text }));
      });
      anchor.appendChild(od);
    }

    function convertMarkers(container, model) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!/⟦\d+⟧/.test(node.textContent)) continue;
        const parts = node.textContent.split(/⟦(\d+)⟧/);
        const frag = document.createDocumentFragment();
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 1) {
            const g = +parts[i];
            const sup = document.createElement('sup');
            sup.className = 'fnref';
            sup.dataset.g = g;
            sup.textContent = g;
            bindFn(sup, g, model);
            frag.appendChild(sup);
          } else if (parts[i]) {
            frag.appendChild(document.createTextNode(parts[i]));
          }
        }
        node.parentNode.replaceChild(frag, node);
      }
    }

    function restoreMarkers(root = document) {
      root.querySelectorAll('.fn-inline').forEach((node) => node.remove());
      root.querySelectorAll('sup.fnref').forEach((sup) => {
        sup.replaceWith(document.createTextNode('⟦' + sup.dataset.g + '⟧'));
      });
      root.querySelectorAll('.fn-orphan').forEach((node) => node.remove());
    }

    function processOpenViews() {
      for (const view of ctx.state?.tabs || []) {
        const holder = view.textView?.holder;
        if (!holder || !view.model) continue;
        holder.querySelectorAll('.body').forEach((node) => convertMarkers(node, view.model));
        holder.querySelectorAll('.page-anchor').forEach((anchor) => {
          renderOrphans(+anchor.dataset.page, anchor, view.model);
        });
      }
    }

    function bindFn(sup, g, model) {
      sup.addEventListener('mouseenter', () => {
        const fn = model.footnotes[g];
        if (!fn) return;
        tip.innerHTML = '';
        tip.appendChild(Object.assign(document.createElement('div'), {
          className: 'fn-head', textContent: '脚注 ' + g + ' · PDF 第 ' + fn.page + ' 页',
        }));
        tip.appendChild(Object.assign(document.createElement('div'), { textContent: fn.text }));
        tip.style.display = 'block';
        const r = sup.getBoundingClientRect();
        tip.style.left = Math.min(r.left, innerWidth - 340) + 'px';
        tip.style.top = (r.bottom + 8) + 'px';
      });
      sup.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      sup.addEventListener('click', () => {
        const fn = model.footnotes[g];
        if (!fn) return;
        const next = sup.nextElementSibling;
        if (next && next.classList.contains('fn-inline')) { next.remove(); sup.classList.remove('open'); return; }
        sup.after(Object.assign(document.createElement('span'), {
          className: 'fn-inline', textContent: '（' + fn.text + '）',
        }));
        sup.classList.add('open');
      });
    }

    processOpenViews();
    return () => {
      offItem();
      offPage();
      restoreMarkers();
      tip.style.display = 'none';
    };
  },
});
