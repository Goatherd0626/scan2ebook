import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { createReaderServer } from '../lib/server.js';
import { resolveConverter } from '../lib/native-engine.js';

const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
assert.ok(args.includes('--pdf'), '请用 --pdf 指定自制测试 PDF，不使用真实图书或 Key');
const source = resolve(value('--pdf'));
const directory = args.includes('--directory') ? resolve(value('--directory')) : await mkdtemp(join(tmpdir(), 'scan2ebook-native-web-'));
if (args.includes('--directory')) await mkdir(directory);
const engine = await resolveConverter();
assert.equal(engine?.kind, 'native-swift', '请先运行 npm run build:engine 准备原生引擎');
const placeholder = 'test-only-placeholder';
let requests = 0, slowStarted = false;
const model = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer ' + placeholder);
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString()); requests++;
    const vision = Array.isArray(input.messages[0].content);
    if (input.model === 'native-web-test-slow') { slowStarted = true; return; }
    const result = vision ? { page_kind: 'body', items: [
      { type: 'heading', level: 1, text: '原生网页样书' },
      { type: 'body', text: '这是本机原生转换器的自制验证文字，可以搜索并与原 PDF 核对。[1]' },
      { type: 'footnote', index: 1, text: '本次响应仅来自本机模拟模型。' },
    ], toc: [] } : { title: '原生网页样书', author: '自制测试', publisher: '本机' };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  } catch { response.writeHead(400); response.end(); }
});
await new Promise(resolveReady => model.listen(0, '127.0.0.1', resolveReady));
const base = `http://127.0.0.1:${model.address().port}`;
process.env.SCAN2EBOOK_TEST_API_BASE = base;
let app, closed = false;
async function shutdown() {
  if (closed) return; closed = true;
  try { await app?.close(); }
  finally { model.closeAllConnections(); await new Promise(resolveClosed => model.close(resolveClosed)); }
}
try {
  app = await createReaderServer({ port: 0, storageDir: join(directory, 'data'),
    conversionOptions: { args: ['--test-api-base', base] } });
  const api = app.url + '/__scan2ebook__/conversion';
  const json = async (path, body) => {
    const response = await fetch(api + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, `本机请求失败：${path} ${response.status}`); return response.json();
  };
  const state = await json('');
  assert.equal(state.engine, 'native-swift'); assert.equal(state.available, true);
  const input = await readFile(source);
  const uploaded = await fetch(api + '/uploads', { method: 'POST', headers: {
    'content-type': 'application/pdf', 'x-s2e-filename': encodeURIComponent(basename(source)),
  }, body: input });
  assert.equal(uploaded.status, 201);
  const upload = await uploaded.json();
  const pages = Math.min(3, upload.pages);
  const start = model => json('/jobs', { uploadId: upload.id, pageStart: 1, pageEnd: pages, workers: 2, model, apiKey: placeholder });
  let job = await start('native-web-test');
  const deadline = Date.now() + 60_000;
  while (job.status === 'running' && Date.now() < deadline) {
    await new Promise(resolveTick => setTimeout(resolveTick, 100)); job = await json('/jobs/' + job.id);
  }
  assert.equal(job.status, 'completed', job.error || job.message);
  assert.deepEqual(job.files.map(file => file.kind).sort(), ['html', 'json', 's2e']);
  const download = await fetch(app.url + job.files.find(file => file.kind === 's2e').url);
  const archive = await JSZip.loadAsync(await download.arrayBuffer());
  assert.deepEqual(await archive.file('book.pdf').async('nodebuffer'), input);
  const book = JSON.parse(await archive.file('book.json').async('string'));
  assert.deepEqual(book.pages.map(page => page.pdf_page), Array.from({ length: pages }, (_, i) => i + 1));
  assert.match(JSON.stringify(book), /原生网页样书/);
  const completeRequests = requests;
  const slow = await start('native-web-test-slow');
  const slowDeadline = Date.now() + 30_000;
  while (!slowStarted && Date.now() < slowDeadline) await new Promise(resolveTick => setTimeout(resolveTick, 50));
  assert.equal(slowStarted, true, '原生转换已进入本机模拟模型');
  assert.equal((await json('/jobs/' + slow.id + '/cancel', {})).status, 'cancelled');
  const cancelledFiles = await readdir(join(directory, 'data', 'conversions', 'jobs', slow.id));
  assert.equal(cancelledFiles.some(name => name.startsWith('.work-')), false);
  assert.equal((await readFile(join(directory, 'data', 'conversions', 'state.json'), 'utf8')).includes(placeholder), false);
  const report = { url: app.url, pid: process.pid, engine: state.engine, engineFile: basename(engine.command),
    pages, completeModelRequests: completeRequests, cancelled: true, temporaryFilesCleaned: true, paidRequests: 0, directory };
  await writeFile(join(directory, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (args.includes('--keep-open')) {
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  } else await shutdown();
} catch (error) { await shutdown(); throw error; }
