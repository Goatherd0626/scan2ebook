import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import JSZip from 'jszip';

const args = process.argv.slice(2);
if (args[0] === '--help') process.exit(0);
if (args[0] === 'inspect') {
  console.log(JSON.stringify({ ok: true, pages: 3 }));
  process.exit(0);
}
const value = (flag) => args[args.indexOf(flag) + 1];
const source = args[0];
const model = value('--vision-model');
const first = Number(value('--page-start'));
const last = Number(value('--page-end'));
const emit = (event) => console.log('S2E_EVENT ' + JSON.stringify(event));
const tick = Number(process.env.S2E_TEST_TICK_MS || 20);
emit({ stage: 'ocr', progress: 12, message: '正在识别第 1 页' });
await new Promise((resolve) => setTimeout(resolve, tick));
if (model === 'test-fail') {
  console.error('测试服务拒绝请求 ' + process.env.DEEPSEEK_API_KEY);
  process.exit(1);
}
if (model === 'test-slow') await new Promise((resolve) => setTimeout(resolve, 30_000));
emit({ stage: 'structure', progress: 68, current: Math.min(2, last - first + 1), total: last - first + 1, pdf_page: Math.min(first + 1, last), message: '正在整理正文与脚注' });
await new Promise((resolve) => setTimeout(resolve, tick));
const out = value('-o');
await mkdir(out, { recursive: true });
const stem = basename(source, '.pdf');
const book = {
  book: { title: stem, author: '示例作者', publisher: '自制测试材料' },
  toc: [{ text: '纸页与远方', level: 1, pdf_page: first }],
  pages: Array.from({ length: last - first + 1 }, (_, i) => ({
    pdf_page: first + i, page_kind: 'body', printed_page: String(first + i),
    items: [
      { type: 'heading', level: 1, text: i === 0 ? '纸页与远方' : '沿着文字前行' },
      { type: 'body', text: '翻开一页书，也是在打开一个世界。那些留在纸上的文字，记录着阅读、行走与思考的片刻。这是自制的阅读器测试材料。' },
      { type: 'body', text: '识别后的文字可以搜索，也可以随时回到原始 PDF 核对。每一页都有自己的来处，每一次阅读都能留下书签与批注。' },
      { type: 'footnote', index: 1, text: '本书为自动化测试自制，不包含真实图书内容。' },
    ],
  })),
};
const zip = new JSZip();
zip.file('book.json', JSON.stringify(book));
zip.file('book.pdf', await readFile(source));
await writeFile(join(out, stem + '.s2e'), await zip.generateAsync({ type: 'nodebuffer' }));
await writeFile(join(out, stem + '.json'), JSON.stringify(book));
await writeFile(join(out, stem + '.html'), '<!doctype html><title>自制测试材料</title><p>纸页与远方</p>');
emit({ stage: 'complete', progress: 100, message: '转换完成' });
