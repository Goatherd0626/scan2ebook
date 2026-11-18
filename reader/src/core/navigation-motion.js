// 改编自 Rare UI Bounce Sidebar / Gooey Nav，Copyright (c) 2026 Swami Malode。
// 来源与许可见 reader/THIRD_PARTY_NOTICES.md。以浏览器动画实现，复用现有导航状态。
const bound = new WeakMap();
let nextId = 0;
const SVG = 'http://www.w3.org/2000/svg';

function observeNavigation(host, selector, update) {
  let frame = null;
  const schedule = (animate = true) => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => { frame = null; update(animate); });
  };
  const observer = new window.MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' && record.target.matches(selector)
        || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node.matches?.(selector)))) schedule();
  });
  observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-current'] });
  const resize = window.ResizeObserver ? new window.ResizeObserver(() => schedule(false)) : null;
  resize?.observe(host);
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const resnap = () => schedule(false);
  media?.addEventListener?.('change', resnap);
  window.addEventListener('resize', resnap);
  document.fonts?.ready.then(resnap);
  update(false);
  return () => {
    observer.disconnect(); resize?.disconnect();
    media?.removeEventListener?.('change', resnap);
    window.removeEventListener('resize', resnap);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

function reducedMotion() { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }

function bounceSidebar(host) {
  const dot = document.createElement('span');
  dot.className = 'bounce-dot'; dot.setAttribute('aria-hidden', 'true');
  host.classList.add('bounce-nav'); host.appendChild(dot);
  let position = null, animation = null;
  const disconnect = observeNavigation(host, 'a, button', animate => {
    const active = host.querySelector('[aria-current="page"]');
    if (!active || !host.getBoundingClientRect().width) { animation?.cancel(); animation = null; position = null; dot.hidden = true; return; }
    const box = active.getBoundingClientRect(), parent = host.getBoundingClientRect();
    const target = { x: box.left - parent.left + 10, y: box.top - parent.top + box.height / 2 - 3 };
    const current = dot.getBoundingClientRect();
    const from = animation && dot.getAnimations?.().length ? { x: current.left - parent.left, y: current.top - parent.top } : position;
    animation?.cancel(); dot.hidden = false;
    dot.style.transform = `translate(${target.x}px, ${target.y}px)`;
    if (animate && from && !reducedMotion() && typeof dot.animate === 'function') {
      const dx = target.x - from.x, dy = target.y - from.y, distance = Math.hypot(dx, dy);
      if (distance > 1) {
        const arc = Math.min(12, distance * .4);
        const frames = Array.from({ length: 17 }, (_, index) => {
          const t = index / 16, p = 1 - (1 - t) ** 3, curve = Math.sin(Math.PI * p) * arc;
          return { transform: `translate(${from.x + dx * p + dy / distance * curve}px, ${from.y + dy * p - dx / distance * curve}px)` };
        });
        animation = dot.animate(frames, { duration: 250, easing: 'linear' });
      }
    }
    position = target;
  });
  return () => { disconnect(); animation?.cancel(); dot.remove(); };
}

// 两块导航之间的液态颈部，沿用 Rare UI 的收窄曲线。
function neckPath(gap, span) {
  if (gap <= 0 || span <= 0) return '';
  const waist = 100 * (1 - gap / (span * .22));
  if (waist <= 0) return '';
  const start = span - gap, mid = start + gap / 2;
  return `M${start} 0 Q${mid} ${100 - waist} ${span} 0 L${span} 100 Q${mid} ${waist} ${start} 100 Z`;
}

function gooeyNavigation(host) {
  let values = new Map(), frame = null, seamCount = 0;
  const prefix = 'gooey-' + ++nextId;
  function createSeam(button) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.dataset.gooeySeam = ''; svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');
    const defs = document.createElementNS(SVG, 'defs'), gradient = document.createElementNS(SVG, 'linearGradient');
    gradient.id = prefix + '-' + ++seamCount; gradient.setAttribute('x1', '0'); gradient.setAttribute('x2', '1');
    for (const offset of ['0', '1']) {
      const stop = document.createElementNS(SVG, 'stop'); stop.setAttribute('offset', offset); gradient.appendChild(stop);
    }
    defs.appendChild(gradient); svg.appendChild(defs);
    const path = document.createElementNS(SVG, 'path'); path.setAttribute('fill', `url(#${gradient.id})`);
    svg.appendChild(path); button.prepend(svg);
    return svg;
  }
  const disconnect = observeNavigation(host, '.tab', animate => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    const buttons = [...host.querySelectorAll('.tab')].filter(button => window.getComputedStyle(button).display !== 'none');
    const active = buttons.findIndex(button => button.classList.contains('active'));
    const span = parseFloat(window.getComputedStyle(host).getPropertyValue('--gooey-separation')) || 14;
    const open = edge => edge === 0 || edge === buttons.length || edge === active || edge - 1 === active;
    const visible = host.getBoundingClientRect().width > 0;
    const entries = buttons.map((button, index) => {
      const key = button.dataset.navKey || String(index), target = index === 0 ? 0 : open(index) ? span : -1;
      const svg = button.querySelector('[data-gooey-seam]') || (index > 0 ? createSeam(button) : null);
      button.style.borderTopLeftRadius = button.style.borderBottomLeftRadius = open(index) ? '10px' : '0';
      button.style.borderTopRightRadius = button.style.borderBottomRightRadius = open(index + 1) ? '10px' : '0';
      if (svg) {
        svg.style.display = index > 0 ? '' : 'none';
        svg.setAttribute('viewBox', `0 0 ${span} 100`); svg.style.width = span + 'px';
        const stops = svg.querySelectorAll('stop');
        stops[0].style.stopColor = index - 1 === active ? 'var(--gooey-active)' : 'var(--gooey-base)';
        stops[1].style.stopColor = index === active ? 'var(--gooey-active)' : 'var(--gooey-base)';
      }
      return { button, key, target, from: values.get(key) ?? target, path: svg?.querySelector('path') };
    });
    const shouldAnimate = animate && visible && !reducedMotion() && entries.some(entry => Math.abs(entry.from - entry.target) > .1);
    host.dataset.motion = shouldAnimate ? 'running' : 'still';
    const started = window.performance.now();
    const paint = now => {
      const t = shouldAnimate ? Math.min(1, (now - started) / 440) : 1;
      const p = (1 - (1 + 4 * t) * Math.exp(-4 * t)) / (1 - 5 * Math.exp(-4));
      values = new Map();
      for (const entry of entries) {
        const gap = t === 1 ? entry.target : entry.from + (entry.target - entry.from) * p;
        entry.button.style.marginLeft = gap + 'px'; entry.path?.setAttribute('d', neckPath(gap, span));
        values.set(entry.key, gap);
      }
      if (t < 1) frame = window.requestAnimationFrame(paint);
      else {
        frame = null;
        host.dataset.motion = 'still';
        if (active < 0 || !visible) return;
        const viewport = host.getBoundingClientRect();
        const tab = buttons[active].getBoundingClientRect();
        if (tab.right > viewport.right) host.scrollLeft += Math.ceil(tab.right - viewport.right);
        else if (tab.left < viewport.left) host.scrollLeft -= Math.ceil(viewport.left - tab.left);
      }
    };
    paint(started);
  });
  return () => { disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
}

export function initNavigationMotion() {
  if (typeof window.requestAnimationFrame !== 'function') return;
  for (const host of document.querySelectorAll('[data-navigation]')) {
    if (bound.has(host)) continue;
    bound.set(host, host.dataset.navigation === 'bounce' ? bounceSidebar(host) : gooeyNavigation(host));
  }
}
