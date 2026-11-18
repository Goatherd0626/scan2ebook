import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { createReaderServer } from '../lib/server.js';
import { createConversionManager } from '../lib/conversion.js';

const API = '/__scan2ebook__/conversion';
const key = 'test-only-placeholder';

async function setup(t, converterOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 's2e-conversion-test-'));
  const distDir = join(root, 'dist');
  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<title>Test</title>');
  const options = {
    port: 0, distDir, storageDir: join(root, 'data'),
    conversionOptions: { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/converter.mjs', import.meta.url))], ...converterOptions },
  };
  let app = await createReaderServer(options);
  t.after(() => app.close());
  const request = (path, body, headers = {}) => fetch(app.url + API + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const upload = async (body = '%PDF-1.7\nTest PDF', headers = {}) => {
    const response = await fetch(app.url + API + '/uploads', {
      method: 'POST', headers: { 'content-type': 'application/pdf', 'x-s2e-filename': encodeURIComponent('测试书.pdf'), ...headers }, body,
    });
    return { status: response.status, value: await response.json() };
  };
  const restart = async () => {
    await app.close();
    app = await createReaderServer(options);
    return app;
  };
  const remove = (id, headers = {}) => fetch(app.url + API + '/jobs/' + id, { method: 'DELETE', headers });
  return { app, request, upload, remove, restart, root };
}

async function settled(request, id) {
  for (let i = 0; i < 120; i++) {
    const job = await request('/jobs/' + id).then((r) => r.json());
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail('测试任务未结束');
}

test('上传 PDF 后读取页数，拒绝非 PDF 和跨源上传', async (t) => {
  const { upload, request } = await setup(t);
  const info = await request('').then((r) => r.json());
  assert.equal(info.available, true);
  const accepted = await upload();
  assert.equal(accepted.status, 201);
  assert.equal(accepted.value.pages, 3);
  assert.equal(accepted.value.name, '测试书.pdf');
  assert.equal('path' in accepted.value, false);
  assert.equal((await upload('not a pdf')).status, 400);
  assert.equal((await upload('%PDF-1.7', { origin: 'https://example.invalid' })).status, 403);
});

test('页码越界、空 Key 和非法并发数不启动转换', async (t) => {
  const { upload, request } = await setup(t);
  const { value } = await upload();
  const args = { uploadId: value.id, pageStart: 1, pageEnd: 3, apiKey: key, workers: 2 };
  for (const patch of [{ pageEnd: 4 }, { pageStart: 2, pageEnd: 1 }, { pageStart: 1.5 }, { apiKey: '' }, { workers: 0 }]) {
    const response = await request('/jobs', { ...args, ...patch });
    assert.equal(response.status, 400);
  }
  assert.deepEqual((await request('').then((r) => r.json())).jobs, []);
});

test('转换完成提供受控下载，任务响应与磁盘文件不保存 Key', async (t) => {
  const { upload, request, app } = await setup(t);
  const { value } = await upload();
  const response = await request('/jobs', { uploadId: value.id, pageStart: 1, pageEnd: 2, apiKey: key });
  assert.equal(response.status, 202);
  const started = await response.json();
  const job = await settled(request, started.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.progress, 100);
  assert.deepEqual(job.files.map((f) => f.kind).sort(), ['html', 'json', 's2e']);
  assert.equal(JSON.stringify(job).includes(key), false);
  const file = job.files.find((f) => f.kind === 's2e');
  const download = await fetch(app.url + file.url);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await request('/jobs/' + job.id + '/files/unknown')).status, 404);
  const files = await readdir(join(app.storageDir, 'conversions'), { recursive: true });
  for (const name of files.filter((name) => /\.(json|html)$/.test(name))) {
    assert.equal((await readFile(join(app.storageDir, 'conversions', name), 'utf8')).includes(key), false);
  }
});

test('拒绝同时启动第二个任务，取消后不误报完成并可再次转换', async (t) => {
  const { upload, request } = await setup(t);
  const { value } = await upload();
  const args = { uploadId: value.id, pageStart: 1, pageEnd: 3, apiKey: key, model: 'test-slow' };
  const first = await request('/jobs', args).then((r) => r.json());
  assert.equal((await request('/jobs', args)).status, 409);
  const cancelled = await request('/jobs/' + first.id + '/cancel', {}).then((r) => r.json());
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.files, []);
  const second = await request('/jobs', { ...args, model: 'test-success' }).then((r) => r.json());
  assert.equal((await settled(request, second.id)).status, 'completed');
});

test('取消网页转换会终止同组子进程并清理原生引擎的工作目录', { skip: process.platform === 'win32' }, async t => {
  const { app, upload, request } = await setup(t, { args: [fileURLToPath(new URL('./fixtures/converter-tree.mjs', import.meta.url))] });
  const { value } = await upload();
  const job = await request('/jobs', { uploadId: value.id, apiKey: key }).then(response => response.json());
  const output = join(app.storageDir, 'conversions', 'jobs', job.id);
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    ready = await stat(join(output, 'child-ready')).then(() => true, () => false);
    if (!ready) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(ready, true, '等待转换子进程安装信号处理器');
  const cancelled = await request('/jobs/' + job.id + '/cancel', {}).then(response => response.json());
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await readFile(join(output, 'child-stopped'), 'utf8'), 'stopped');
  assert.equal((await readdir(output)).some(name => name.startsWith('.work-')), false);
});

test('失败提示会遮蔽 Key，保留源文件以便重试，刷新可读回任务', async (t) => {
  const { upload, request } = await setup(t);
  const { value } = await upload();
  const args = { uploadId: value.id, pageStart: 1, pageEnd: 3, apiKey: key, model: 'test-fail' };
  const first = await request('/jobs', args).then((r) => r.json());
  const failed = await settled(request, first.id);
  assert.equal(failed.status, 'failed');
  assert.equal(JSON.stringify(failed).includes(key), false);
  assert.match(failed.error, /测试服务拒绝/);
  const state = await request('').then((r) => r.json());
  assert.equal(state.jobs[0].id, first.id);
  const second = await request('/jobs', { ...args, model: 'test-success' }).then((r) => r.json());
  assert.equal((await settled(request, second.id)).status, 'completed');
});

test('同时收到开始请求时只启动一个转换进程', async (t) => {
  const { upload, request } = await setup(t);
  const { value } = await upload();
  const args = { uploadId: value.id, pageStart: 1, pageEnd: 3, apiKey: key, model: 'test-slow' };
  const responses = await Promise.all([request('/jobs', args), request('/jobs', args)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
});

test('服务关闭时拒绝尚未开始和随后到达的转换请求', async (t) => {
  const manager = await createConversionManager({
    directory: await mkdtemp(join(tmpdir(), 's2e-closing-test-')),
    command: process.execPath, args: [fileURLToPath(new URL('./fixtures/converter.mjs', import.meta.url))],
  });
  t.after(() => manager.close());
  async function send(path, data, headers = {}) {
    const request = Readable.from([Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))]);
    Object.assign(request, { method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json', ...headers } });
    const chunks = [];
    const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    let status;
    response.writeHead = (value) => { status = value; };
    await manager.handle(request, response, API + path);
    return { status, value: JSON.parse(Buffer.concat(chunks).toString()) };
  }
  const uploaded = await send('/uploads', '%PDF-1.7 test', { 'content-type': 'application/pdf', 'x-s2e-filename': 'test.pdf' });
  const args = { uploadId: uploaded.value.id, pageStart: 1, pageEnd: 3, apiKey: key, model: 'test-slow' };
  const pending = send('/jobs', args);
  await manager.close();
  assert.equal((await pending).status, 503);
  assert.equal((await send('/jobs', args)).status, 503);
});

test('上传后可从同源读取准备好的 PDF 元数据与预览', async (t) => {
  const { upload, app, request } = await setup(t);
  const { value } = await upload();
  assert.equal(value.url, API + '/uploads/' + value.id + '/pdf');
  const metadata = await request('/uploads/' + value.id);
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), value);
  const preview = await fetch(app.url + value.url);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-type'), 'application/pdf');
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.equal(await preview.text(), '%PDF-1.7\nTest PDF');
  assert.equal((await fetch(app.url + value.url, { headers: { origin: 'https://example.invalid' } })).status, 403);
  assert.equal((await request('/uploads/not-authorized')).status, 404);
  assert.equal((await request('/uploads/not-authorized/pdf')).status, 404);
  assert.equal((await request('/uploads/%2e%2e%2fprivate/pdf')).status, 404);
});

test('服务重启保留完成、失败、取消任务与上传，凭据和原始日志不写入历史', async (t) => {
  const { upload, request, restart, root } = await setup(t);
  const { value } = await upload();
  const args = { uploadId: value.id, apiKey: key };
  const completedId = (await request('/jobs', args).then((r) => r.json())).id;
  const completed = await settled(request, completedId);
  const failedId = (await request('/jobs', { ...args, model: 'test-fail' }).then((r) => r.json())).id;
  await settled(request, failedId);
  const cancelledId = (await request('/jobs', { ...args, model: 'test-slow' }).then((r) => r.json())).id;
  await request('/jobs/' + cancelledId + '/cancel', {}).then((r) => r.json());
  const app = await restart();
  const state = await request('').then((r) => r.json());
  assert.deepEqual(state.jobs.map((job) => job.status), ['cancelled', 'failed', 'completed']);
  assert.equal(state.jobs[2].id, completedId);
  assert.equal(state.jobs[2].startedAt, completed.startedAt);
  assert.equal(state.jobs[2].finishedAt, completed.finishedAt);
  assert.equal(state.jobs[2].current, 2);
  assert.equal(state.jobs[2].total, 3);
  assert.equal(state.jobs[2].pdfPage, 2);
  assert.equal((await fetch(app.url + state.jobs[2].files[0].url)).status, 200);
  assert.equal((await fetch(app.url + state.jobs[0].upload.url)).status, 200);
  assert.equal((await request('/jobs', { uploadId: value.id })).status, 400);
  const restarted = await request('/jobs', args).then((r) => r.json());
  assert.equal((await settled(request, restarted.id)).status, 'completed');
  const saved = await readFile(join(root, 'data/conversions/state.json'), 'utf8');
  for (const secret of [key, root, '测试服务拒绝请求', 'DEEPSEEK_API_KEY', 'errorDetail', '"child"', '"env"', '"command"']) {
    assert.equal(saved.includes(secret), false, '历史不应包含 ' + secret);
  }
});

test('意外停止留下的运行任务恢复为中断，重新转换仍需输入 Key', async (t) => {
  const { upload, request, restart, root, app } = await setup(t);
  const { value } = await upload();
  const started = await request('/jobs', { uploadId: value.id, apiKey: key, model: 'test-slow' }).then((r) => r.json());
  const stateFile = join(root, 'data/conversions/state.json');
  const running = await readFile(stateFile, 'utf8');
  await app.close();
  const work = join(root, 'data/conversions/jobs', started.id, '.work-interrupted');
  await mkdir(work);
  await writeFile(stateFile, running);
  await restart();
  const recovered = await request('/jobs/' + started.id).then((r) => r.json());
  assert.equal(recovered.status, 'interrupted');
  assert.match(recovered.message, /服务已停止，请重新转换/);
  assert.match(recovered.error, /服务已停止，请重新转换/);
  assert.ok(recovered.finishedAt >= recovered.startedAt);
  assert.equal(await stat(work).then(() => true, () => false), false);
  assert.equal((await request('/jobs', { uploadId: value.id })).status, 400);
  const next = await request('/jobs', { uploadId: value.id, apiKey: key }).then((r) => r.json());
  assert.equal((await settled(request, next.id)).status, 'completed');
});

test('电子书文件丢失时重启后的任务明确失败', async (t) => {
  const { upload, request, restart, root } = await setup(t);
  const { value } = await upload();
  const started = await request('/jobs', { uploadId: value.id, apiKey: key }).then((r) => r.json());
  const completed = await settled(request, started.id);
  await rm(join(root, 'data/conversions/jobs', started.id, completed.files.find((file) => file.kind === 's2e').name));
  await restart();
  const recovered = await request('/jobs/' + started.id).then((r) => r.json());
  assert.equal(recovered.status, 'failed');
  assert.match(recovered.error, /丢失|不存在/);
  assert.deepEqual(recovered.files, []);
  assert.equal((await request('/jobs/' + started.id + '/files/s2e')).status, 404);
});

test('删除结束任务及输出，共享上传保留到最后一个引用消失', async (t) => {
  const { upload, request, remove, app, root, restart } = await setup(t);
  const { value } = await upload();
  const args = { uploadId: value.id, apiKey: key };
  const first = await request('/jobs', args).then((r) => r.json());
  await settled(request, first.id);
  const second = await request('/jobs', { ...args, model: 'test-fail' }).then((r) => r.json());
  await settled(request, second.id);
  const imported = join(root, 'already-imported.s2e');
  await writeFile(imported, '独立的书库副本');
  assert.equal((await remove(first.id, { origin: 'https://example.invalid' })).status, 403);
  const removed = await remove(first.id);
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).removedUploads, 0);
  assert.equal((await request('/jobs/' + first.id)).status, 404);
  await assert.rejects(stat(join(root, 'data/conversions/jobs', first.id)), { code: 'ENOENT' });
  assert.equal((await fetch(app.url + value.url)).status, 200);
  const last = await remove(second.id).then((r) => r.json());
  assert.equal(last.removedUploads, 1);
  assert.equal((await fetch(app.url + value.url)).status, 404);
  assert.equal(await readFile(imported, 'utf8'), '独立的书库副本');
  await restart();
  assert.deepEqual((await request('').then((r) => r.json())).jobs, []);
});

test('删除某个任务不会顺带删除其他尚未使用的上传', async (t) => {
  const { upload, request, remove, app } = await setup(t);
  const used = (await upload()).value;
  const unused = (await upload()).value;
  const started = await request('/jobs', { uploadId: used.id, apiKey: key }).then((r) => r.json());
  await settled(request, started.id);
  const removed = await remove(started.id).then((r) => r.json());
  assert.equal(removed.removedUploads, 1);
  assert.equal((await fetch(app.url + unused.url)).status, 200);
});

test('清理保留运行任务和正在编辑的 PDF 草稿', async (t) => {
  const { upload, request, remove, app, root } = await setup(t);
  const used = (await upload()).value;
  const unused = (await upload('%PDF-1.7\nUnused PDF')).value;
  const draft = (await upload('%PDF-1.7\nDraft PDF')).value;
  const args = { uploadId: used.id, apiKey: key };
  const first = await request('/jobs', args).then((r) => r.json());
  const completed = await settled(request, first.id);
  const active = await request('/jobs', { ...args, model: 'test-slow' }).then((r) => r.json());
  const unrelated = join(root, 'data/conversions/keep-me.txt');
  await writeFile(unrelated, '保留的文件');
  assert.equal((await remove(active.id)).status, 409);
  assert.equal((await request('/cleanup', {}, { origin: 'https://example.invalid' })).status, 403);
  const cleaned = await request('/cleanup', { keepUploadId: draft.id });
  assert.equal(cleaned.status, 200);
  assert.deepEqual(await cleaned.json(), {
    removedJobs: 1, removedUploads: 1,
    freedBytes: completed.files.reduce((total, file) => total + file.size, 0) + unused.size,
  });
  assert.equal((await request('/jobs/' + first.id)).status, 404);
  assert.equal((await request('/jobs/' + active.id).then((r) => r.json())).status, 'running');
  assert.equal((await fetch(app.url + used.url)).status, 200);
  assert.equal((await fetch(app.url + unused.url)).status, 404);
  assert.equal((await fetch(app.url + draft.url)).status, 200);
  assert.equal(await readFile(unrelated, 'utf8'), '保留的文件');
  const cancelled = await request('/jobs/' + active.id + '/cancel', {}).then((r) => r.json());
  assert.equal(cancelled.status, 'cancelled');
  const final = await request('/cleanup', { keepUploadId: draft.id }).then((r) => r.json());
  assert.equal(final.removedJobs, 1);
  assert.equal(final.removedUploads, 1);
});

test('完成文件在服务运行中丢失时立即显示失败并拒绝下载', async (t) => {
  const { upload, request, root } = await setup(t);
  const { value } = await upload();
  const started = await request('/jobs', { uploadId: value.id, apiKey: key }).then((r) => r.json());
  const completed = await settled(request, started.id);
  await rm(join(root, 'data/conversions/jobs', started.id, completed.files.find((file) => file.kind === 's2e').name));
  assert.equal((await request('/jobs/' + started.id + '/files/s2e')).status, 404);
  const state = await request('').then((r) => r.json());
  assert.equal(state.jobs[0].status, 'failed');
  assert.match(state.jobs[0].error, /丢失/);
});

test('恢复历史时忽略任意路径字段并拒绝越界文件名', async (t) => {
  const { upload, request, root, app, restart } = await setup(t);
  const selected = (await upload()).value;
  const unsafe = (await upload()).value;
  const started = await request('/jobs', { uploadId: selected.id, apiKey: key }).then((r) => r.json());
  await settled(request, started.id);
  await app.close();
  const stateFile = join(root, 'data/conversions/state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const external = join(root, 'private.pdf');
  await writeFile(external, '%PDF-PRIVATE');
  state.uploads.find((item) => item.id === selected.id).file = external;
  state.uploads.find((item) => item.id === unsafe.id).name = '../../private.pdf';
  state.jobs[0].out = root;
  state.jobs[0].files[0].name = '../../private.pdf';
  await writeFile(stateFile, JSON.stringify(state));
  const restarted = await restart();
  assert.equal(await fetch(restarted.url + selected.url).then((r) => r.text()), '%PDF-1.7\nTest PDF');
  assert.equal((await fetch(restarted.url + unsafe.url)).status, 404);
  const recovered = await request('/jobs/' + started.id).then((r) => r.json());
  assert.equal(recovered.status, 'completed');
  const result = await fetch(restarted.url + recovered.files.find((file) => file.kind === 's2e').url);
  assert.equal(Buffer.from(await result.arrayBuffer()).subarray(0, 2).toString(), 'PK');
});

test('取消后子进程尚未关闭时，删除和清理保留任务及上传', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 's2e-cancelling-test-'));
  const manager = await createConversionManager({ directory,
    command: process.execPath, args: [fileURLToPath(new URL('./fixtures/converter.mjs', import.meta.url))] });
  t.after(() => manager.close());
  async function send(path, method = 'GET', body, contentType = 'application/json') {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const request = contentType === 'application/pdf' ? Readable.from([data]) : {
      async *[Symbol.asyncIterator]() { if (data) yield data; },
    };
    Object.assign(request, { method, headers: { host: '127.0.0.1', 'content-type': contentType, 'x-s2e-filename': 'test.pdf' } });
    const chunks = [];
    const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    let status;
    response.writeHead = (value) => { status = value; };
    await manager.handle(request, response, API + path);
    return { status, value: JSON.parse(Buffer.concat(chunks).toString()) };
  }
  const uploaded = await send('/uploads', 'POST', '%PDF-1.7 test', 'application/pdf');
  const started = await send('/jobs', 'POST', { uploadId: uploaded.value.id, apiKey: key, model: 'test-slow' });
  const path = '/jobs/' + started.value.id;
  const cancelling = send(path + '/cancel', 'POST', {});
  let current;
  for (let i = 0; i < 20; i++) {
    current = await send(path);
    if (current.value.status === 'cancelled') break;
  }
  assert.equal(current.value.status, 'cancelled');
  assert.equal((await send(path, 'DELETE')).status, 409);
  assert.deepEqual((await send('/cleanup', 'POST', {})).value, { removedJobs: 0, removedUploads: 0, freedBytes: 0 });
  assert.equal((await cancelling).status, 200);
  assert.equal((await send(path, 'DELETE')).status, 200);
});
