import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

const expected = {
  'i-list': 'list.dash.svg',
  'i-folder': 'folder.badge.plus.svg',
  'i-upload': 'square.and.arrow.up.svg',
  'i-gear': 'gear.svg',
  'i-t': 't.square.svg',
  'i-up': 'arrow.up.svg',
  'i-down': 'arrow.down.svg',
  'i-x': 'multiply.svg',
  'i-left': 'arrow.left.svg',
  'i-right': 'arrow.right.svg',
  'i-reset-clockwise': 'arrow.clockwise.svg',
  'vm-pdf': 'pdf.svg',
};

test('全部界面图标通过 CSS mask 引用 SVG 资源', () => {
  const spans = Object.keys(expected).map((className) => `<span class="sf ${className}"></span>`).join('');
  const dom = new JSDOM(`<style>${css}</style>${spans}`);
  for (const [className, fileName] of Object.entries(expected)) {
    const icon = dom.window.document.querySelector('.' + className);
    const maskUrl = dom.window.getComputedStyle(icon).getPropertyValue('--sf');
    assert.match(maskUrl, new RegExp(fileName.replaceAll('.', '\\.')),
      `${className} 应引用 ${fileName}`);

    const svg = readFileSync(join(root, 'src/assets/icons', fileName), 'utf8');
    assert.match(svg, /<svg\b[^>]*\bviewBox="[^"]+"/);
    assert.match(svg, /<path\b/);
  }
});
