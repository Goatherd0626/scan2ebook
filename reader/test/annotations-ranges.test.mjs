import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyHighlight,
  comparePosition,
  rangeIntersects,
  removeHighlights,
} from '../src/plugins/annotations/ranges.js';

const p = (page, item, offset) => ({ page, item, offset });
const r = (start, end) => ({ start, end });
const shape = (record) => ({ range: record.range, color: record.color });

test('位置按 PDF 页、item 和字符偏移排序', () => {
  assert.ok(comparePosition(p(2, 0, 0), p(10, 0, 0)) < 0);
  assert.ok(comparePosition(p(2, 3, 0), p(2, 4, 0)) < 0);
  assert.equal(comparePosition(p(2, 3, 8), p(2, 3, 8)), 0);
});

test('半开范围只在真实覆盖时相交', () => {
  assert.equal(rangeIntersects(r(p(1, 0, 0), p(1, 0, 5)), r(p(1, 0, 5), p(1, 0, 9))), false);
  assert.equal(rangeIntersects(r(p(1, 0, 0), p(1, 0, 6)), r(p(1, 0, 5), p(1, 0, 9))), true);
});

test('新颜色覆盖旧高亮时保留未覆盖的左右两段', () => {
  const old = [{
    id: 'old', type: 'highlight', color: 'yellow', quote: 'abcdefghij',
    range: r(p(1, 0, 0), p(1, 0, 10)), createdAt: 1, updatedAt: 1,
  }];

  const result = applyHighlight(old, r(p(1, 0, 3), p(1, 0, 7)), 'blue', 'defg', 20);

  assert.deepEqual(result.map(shape), [
    { range: r(p(1, 0, 0), p(1, 0, 3)), color: 'yellow' },
    { range: r(p(1, 0, 3), p(1, 0, 7)), color: 'blue' },
    { range: r(p(1, 0, 7), p(1, 0, 10)), color: 'yellow' },
  ]);
});

test('取消高亮只移除选区覆盖部分并保留跨 item 两端', () => {
  const old = [{
    id: 'old', type: 'highlight', color: 'pink', quote: '跨段高亮',
    range: r(p(3, 1, 4), p(4, 0, 12)), createdAt: 1, updatedAt: 1,
  }];

  const result = removeHighlights(old, r(p(3, 2, 0), p(4, 0, 5)), 30);

  assert.deepEqual(result.map(shape), [
    { range: r(p(3, 1, 4), p(3, 2, 0)), color: 'pink' },
    { range: r(p(4, 0, 5), p(4, 0, 12)), color: 'pink' },
  ]);
});

test('相邻同色高亮自动合并', () => {
  const old = [{
    id: 'old', type: 'highlight', color: 'green', quote: 'abc',
    range: r(p(1, 0, 0), p(1, 0, 3)), createdAt: 1, updatedAt: 1,
  }];

  const result = applyHighlight(old, r(p(1, 0, 3), p(1, 0, 6)), 'green', 'def', 40);

  assert.equal(result.length, 1);
  assert.deepEqual(shape(result[0]), {
    range: r(p(1, 0, 0), p(1, 0, 6)),
    color: 'green',
  });
});
