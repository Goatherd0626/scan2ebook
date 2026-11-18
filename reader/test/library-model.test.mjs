import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFolders, filterLibrary, readingPosition, continueReading, folderTrail, folderBookCount } from '../src/web/library-model.ts';

const books = [
  { id: 'a', s2eName: '山川', importedAt: 30, folderId: 'child', meta: { title: '山川之间', author: '林间' }, bookJson: { pages: [7, 8, 9, 10].map((pdf_page) => ({ pdf_page })) }, progress: { page: 8, at: 100 } },
  { id: 'b', s2eName: 'notes', importedAt: 50, folderId: null, meta: { title: '阅读笔记', author: '周末' }, bookJson: { pages: [{ pdf_page: 1 }] }, progress: null },
  { id: 'c', s2eName: '纸页', importedAt: 20, folderId: null, meta: { title: '纸页与远方' }, bookJson: { pages: [{ pdf_page: 1 }, { pdf_page: 2 }] }, progress: { page: 1, at: 200 } },
];
const folders = [{ id: 'parent', name: '文学' }, { id: 'child', name: '散文', parentId: 'parent' }];

test('阅读位置按转换范围里的页序计算，不把原始 PDF 页码当作百分比', () => {
  assert.deepEqual(readingPosition(books[0]), { page: 8, position: 2, total: 4, percent: 50 });
  assert.equal(readingPosition(books[1]).percent, 0);
});

test('搜索同时匹配作者和文件夹，父文件夹筛选包含子文件夹', () => {
  assert.deepEqual(filterLibrary(books, folders, { query: '林间' }).map((b) => b.id), ['a']);
  assert.deepEqual(filterLibrary(books, folders, { query: '散文', folderId: 'parent' }).map((b) => b.id), ['a']);
  assert.deepEqual(filterLibrary(books, folders, { query: '文学' }).map(b => b.id), ['a']);
  assert.deepEqual(filterLibrary(books, folders, { folderId: 'parent' }).map((b) => b.id), ['a']);
});

test('搜索能找到嵌套文件夹，进入文件夹后搜索仍在其范围内', () => {
  assert.deepEqual(filterFolders(folders, { query: '散文' }).map(f => f.id), ['child']);
  assert.deepEqual(filterFolders(folders, { folderId: 'child', query: '文学' }), []);
});

test('继续阅读选择真正有进度的最近一本，排序不改写书库数组', () => {
  assert.equal(continueReading(books).id, 'c');
  assert.deepEqual(filterLibrary(books, folders, { sort: 'recent' }).map((b) => b.id), ['c', 'a', 'b']);
  assert.deepEqual(books.map((b) => b.id), ['a', 'b', 'c']);
  assert.equal(continueReading([books[1]]), null);
});

test('未开始筛选与空搜索结果能明确区分', () => {
  assert.deepEqual(filterLibrary(books, folders, { status: 'unread' }).map((b) => b.id), ['b']);
  assert.deepEqual(filterLibrary(books, folders, { query: '不存在的书' }), []);
});

test('文件夹路径按父子顺序返回，数量包含子文件夹中的书', () => {
  assert.deepEqual(folderTrail(folders, 'child').map((folder) => folder.id), ['parent', 'child']);
  assert.deepEqual(folderTrail(folders, null), []);
  assert.equal(folderBookCount(books, folders, 'parent'), 1);
  assert.equal(folderBookCount(books, folders, 'child'), 1);
});
