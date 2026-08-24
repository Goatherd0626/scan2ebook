/* 阅读器核心+插件冒烟测试（jsdom + fake-indexeddb）。
   运行：cd frontend && node test/reader-smoke.mjs
   验证：核心初始化、插件激活（工具栏/目录tab）、.s2e 解析、开书渲染（文字视图+脚注插件）。
   Node 环境限制：PDF 画布渲染与「File→JSZip」为浏览器行为，此处用桩/直测替代。 */
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'index.html'), 'utf-8'), { url: 'http://127.0.0.1:8765/', pretendToBeVisual: true });
const { window } = dom;

// ---- 浏览器全局桩 ----
window.indexedDB = indexedDB;
globalThis.indexedDB = indexedDB;
window.IntersectionObserver = class { constructor() {} observe() {} disconnect() {} unobserve() {} };
globalThis.IntersectionObserver = window.IntersectionObserver;
window.HTMLElement.prototype.scrollTo = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
try { globalThis.window = window; } catch (e) {}
try { globalThis.document = window.document; } catch (e) {}
try { globalThis.localStorage = window.localStorage; } catch (e) {}
try { globalThis.location = window.location; } catch (e) {}
globalThis.NodeFilter = window.NodeFilter;
window.crypto.randomUUID ??= () => 'uuid-' + Math.random().toString(36).slice(2);
try { globalThis.crypto = window.crypto; } catch (e) {}
globalThis.File = window.File;

const errors = [];
window.addEventListener('error', (e) => errors.push('window.onerror: ' + e.message));
process.on('unhandledRejection', (r) => errors.push('unhandledRejection: ' + ((r && r.message) || r)));

/* ---- .s2e 文件格式解析（浏览器 File→JSZip 之外的核心契约） ---- */
const s2ePath = join(root, '../output/本雅明/本雅明机器复制时代的艺术作品.s2e');
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(s2ePath)));
const bookJson = JSON.parse(await zip.file('book.json').async('string'));
const pdfBlob = await zip.file('book.pdf').async('blob');
console.log('=== .s2e 解析 ===');
console.log('book.json + book.pdf 齐全:', !!bookJson && pdfBlob.size > 0, '| 书名:', bookJson.book.title, '| 页数:', bookJson.pages.length);

/* ---- 核心 + 插件 ---- */
await import('../src/plugins/index.js');     // 注册插件（main.js 里同款）
const { init, state, openBook } = await import('../src/core/app.js');
await init();
await new Promise((r) => setTimeout(r, 300));

console.log('=== 初始化 ===');
console.log('书库空提示:', document.body.textContent.includes('书库为空') ? '有' : '无');
console.log('插件工具栏部件:', document.querySelectorAll('#plugin-toolbar > *').length, '个');
console.log('目录tab:', [...document.querySelectorAll('#toc-tabs button')].map((b) => b.textContent).join(','));
console.log('护眼面板已创建:', !!document.getElementById('eyecare-panel'));

/* ---- 开书渲染（绕过 File 上传，直接入库） ---- */
import * as db from '../src/core/db.js';
const id = 'test-book';
const book = { id, s2eName: '本雅明.s2e', importedAt: Date.now(), folderId: null,
  meta: bookJson.book, bookJson, pdfBlob, bookmarks: [], progress: null };
await db.addBook(state.db, book);
state.books.push(book);
await openBook(id);
await new Promise((r) => setTimeout(r, 400));

console.log('=== 开书渲染 ===');
console.log('标签页:', document.querySelectorAll('.tab').length, '个');
console.log('PDF 页容器:', document.querySelectorAll('.pdf-page').length, '个（pdf.js 渲染为浏览器行为，Node 下不画）');
console.log('正文段落:', document.querySelectorAll('.body').length, '个');
console.log('页码横幅:', document.querySelectorAll('.page-banner').length, '个');
console.log('脚注上标(插件):', document.querySelectorAll('sup.fnref').length, '个');
console.log('书签 tab 体:', !!document.getElementById('tab-body-bookmarks') ? '有' : '无');
console.log('=== 错误（忽略 PDF 解析噪音） ===');
const real = errors.filter((e) => !/pdf|PDF|renderTasks|canvas/i.test(e));
console.log(real.length ? real.join('\n') : '（无）');

/* ==== 首页交互：切到首页 → 单击行选中 → 详情面板 ==== */
const homeTab = document.querySelectorAll('#tabs .tab')[0];
homeTab.click();
await new Promise((r) => setTimeout(r, 200));
const firstRow = document.querySelector('#home-table .ht-row');
console.log('=== 首页 ===');
console.log('首页可见:', document.getElementById('home-view').style.display !== 'none');
console.log('表格行数:', document.querySelectorAll('#home-table .ht-row').length, '| 列内容:',
  [...(firstRow ? firstRow.querySelectorAll('.ht-title,.ht-author,.ht-pub,.ht-pages,.ht-folder') : [])].map((s) => s.textContent).join(' | '));
firstRow?.click();
await new Promise((r) => setTimeout(r, 150));
const dp = document.getElementById('detail-panel');
console.log('详情面板显示:', dp && !dp.hidden);
console.log('详情含作者/出版社:', dp?.textContent.includes('出版社') ? '有' : '无', '| 页数:', dp?.textContent.includes('45 页') ? '有' : '无');
console.log('选中行高亮:', document.querySelector('#home-table .ht-row.selected') ? '有' : '无');
console.log('=== 阶段错误 ===', errors.filter((e) => !/pdf|PDF|renderTasks|canvas/i.test(e)).join('\n') || '（无）');

/* ==== 原地编辑：单击值框 → 输入 → blur 自动保存 ==== */
const authorBox = document.querySelector('#detail-panel .dp-edit[data-key="author"]');
authorBox?.click();
await new Promise((r) => setTimeout(r, 100));
const inline = document.querySelector('#detail-panel input.dp-inline');
console.log('=== 原地编辑 ===');
console.log('点击后出现输入框:', !!inline, '| 预填值:', inline?.value);
if (inline) {
  inline.value = '测试作者·王五';
  inline.dispatchEvent(new window.Event('blur'));
  await new Promise((r) => setTimeout(r, 400));
}
const book2 = state.books.find((b) => b.id === 'test-book');
console.log('blur 后已保存:', book2.meta.author === '测试作者·王五' ? '是' : '否 (' + book2.meta.author + ')');
const dp2 = document.getElementById('detail-panel');
console.log('面板回显新作者:', dp2.textContent.includes('测试作者·王五') ? '是' : '否');
console.log('=== 阶段错误 ===', errors.filter((e) => !/pdf|PDF|renderTasks|canvas/i.test(e)).join('\n') || '（无）');

/* ==== 每本书视图配置（顶栏工具条）：默认双栏、切换、摊开仅PDF、首页隐藏 ==== */
document.querySelectorAll('#tabs .tab')[1].click();
await new Promise((r) => setTimeout(r, 300));
const vs = document.getElementById('view-switch');
const bwv = document.querySelector('.book-view');
console.log('=== 视图工具 ===');
console.log('开书时工具条显示:', vs.classList.contains('show'));
console.log('默认模式:', bwv.dataset.mode);
vs.querySelector('button[data-mode="pdf"]').click();
await new Promise((r) => setTimeout(r, 150));
console.log('切仅PDF后 模式:', bwv.dataset.mode, '| 文字面板隐藏:', bwv.querySelector('.text-panel').offsetParent === null ? '是' : '否');
vs.querySelector('[data-act="spread"]').click();
await new Promise((r) => setTimeout(r, 150));
console.log('仅PDF+摊开:', bwv.querySelector('.pdf-panel').classList.contains('spread') ? '摊开中' : '未生效');
vs.querySelector('button[data-mode="split"]').click();
await new Promise((r) => setTimeout(r, 150));
console.log('切双栏后:', bwv.querySelector('.pdf-panel').classList.contains('spread') ? '仍摊开（错误）' : '已回退单页');
vs.querySelector('button[data-mode="pdf"]').click();
await new Promise((r) => setTimeout(r, 150));
console.log('再切仅PDF:', bwv.querySelector('.pdf-panel').classList.contains('spread') ? '恢复摊开（配置记忆）' : '未恢复（错误）');
vs.querySelector('button[data-mode="text"]').click();
await new Promise((r) => setTimeout(r, 150));
console.log('仅文字模式:', bwv.dataset.mode, '| PDF面板隐藏:', bwv.querySelector('.pdf-panel').offsetParent === null ? '是' : '否');
document.querySelectorAll('#tabs .tab')[0].click();
await new Promise((r) => setTimeout(r, 200));
console.log('首页时工具条隐藏:', !vs.classList.contains('show'));
console.log('====');

/* ==== 首页搜索：元数据过滤 ==== */
/* ==== 搜索：VS Code 查找条 ==== */
const setFind = (v) => { const i = document.getElementById('search-input'); i.value = v; i.dispatchEvent(new window.Event('input', { bubbles: true })); };
const countRowsFn = () => [...document.querySelectorAll('#home-table .ht-row')].filter((r) => r.style.display !== 'none').length;
setFind('中国城市出版社');
await new Promise((r) => setTimeout(r, 150));
console.log('=== 查找条 ===');
console.log('浮动条出现:', !document.getElementById('find-strip').hidden, '| 计数:', document.getElementById('find-count').textContent);
console.log('首页命中表格行:', countRowsFn(), '本');
setFind('不存在关键字xyz');
await new Promise((r) => setTimeout(r, 150));
console.log('无结果计数:', document.getElementById('find-count').textContent);
setFind('');
await new Promise((r) => setTimeout(r, 150));
console.log('清空后表格:', countRowsFn(), '本');
document.querySelectorAll('#tabs .tab')[1].click();
await new Promise((r) => setTimeout(r, 300));
setFind('马克思');
await new Promise((r) => setTimeout(r, 200));
console.log('开书搜索「马克思」: 计数', document.getElementById('find-count').textContent, '| 高亮数', document.querySelectorAll('mark.hit').length);
document.getElementById('search-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await new Promise((r) => setTimeout(r, 150));
console.log('Enter 后计数:', document.getElementById('find-count').textContent, '| 当前高亮:', document.querySelectorAll('mark.hit.current').length);
console.log('====');