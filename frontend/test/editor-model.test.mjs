import assert from 'node:assert/strict';
import test from 'node:test';

import { archivePageAnnotations, normalizePageItems } from '../src/plugins/editor/model.js';

const range = (startPage, endPage = startPage) => ({
  start: { page: startPage, item: 0, offset: 0 },
  end: { page: endPage, item: 1, offset: 4 },
});

test('页面编辑器按类型规范化字段并拒绝无效内容', () => {
  assert.deepEqual(normalizePageItems([
    { type: 'heading', number: ' 1.2 ', level: 9, text: ' 标题 ' },
    { type: 'body', text: ' 正文 ' },
    { type: 'footnote', index: '3', text: ' 脚注 ' },
    { type: 'figure', text: '应丢弃' },
    { type: 'table', other: true },
  ]), [
    { type: 'heading', number: '1.2', level: 4, text: '标题' },
    { type: 'body', text: '正文' },
    { type: 'footnote', index: 3, text: '脚注' },
    { type: 'figure' },
    { type: 'table' },
  ]);
  assert.throws(() => normalizePageItems([{ type: 'body', text: '   ' }]), /正文不能为空/);
  assert.throws(() => normalizePageItems([{ type: 'unknown', text: 'x' }]), /不支持的 item type/);
});

test('保存页面编辑时移除触及该页的高亮和注释，并把注释归档到底部历史', () => {
  const records = [
    { id: 'h1', type: 'highlight', range: range(4), quote: '高亮' },
    { id: 'n1', type: 'note', range: range(3, 5), quote: '原文', text: '跨页注释' },
    { id: 'n2', type: 'note', range: range(8), quote: '保留', text: '其他页' },
    { id: 'old', type: 'history-note', page: 1, quote: '旧原文', text: '旧历史', archivedAt: 1 },
  ];

  const result = archivePageAnnotations(records, 4, 100, () => 'history-1');

  assert.equal(result.affectedHighlights, 1);
  assert.equal(result.affectedNotes, 1);
  assert.deepEqual(result.records.map((record) => record.id), ['n2', 'old', 'history-1']);
  assert.deepEqual(result.records.at(-1), {
    id: 'history-1', type: 'history-note', page: 4,
    quote: '原文', text: '跨页注释', archivedAt: 100, reason: 'page-edited',
  });
});
