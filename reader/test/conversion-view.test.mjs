import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const initial = new JSDOM('<body></body>', { url: 'http://127.0.0.1:8765/' });
globalThis.window = initial.window;
globalThis.document = initial.window.document;
const { createConversionView } = await import('../src/core/conversion.js');
const { act } = await import('react');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setup(t, { jobs = [], status = null, onImport = async () => 'book-1' } = {}) {
  const dom = new JSDOM('<main id="workspace"></main>', { url: 'http://127.0.0.1:8765/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/files/s2e')) return { ok: true, blob: async () => new Blob(['test-book']) };
    const value = url.endsWith('/uploads') ? { id: 'upload-1', name: '样书.pdf', pages: 3, size: 20 }
      : url.endsWith('/jobs') ? { id: 'job-1', status: 'running', progress: 0, message: '准备转换', files: [] }
        : status ? await status : { available: true, jobs };
    return { ok: true, json: async () => value };
  };
  let view;
  act(() => { view = createConversionView({ fetchImpl, onImport }); });
  document.getElementById('workspace').append(view.element);
  t.after(() => { act(() => view.deactivate()); dom.window.close(); });
  const upload = async () => {
    const input = document.getElementById('conversion-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [new dom.window.File(['%PDF-test'], '样书.pdf', { type: 'application/pdf' })] });
    await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  };
  const submit = async () => {
    await act(async () => { document.getElementById('conversion-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true })); });
  };
  const fill = async (id, value) => act(async () => {
    const input = document.getElementById(id);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  return { view, calls, upload, submit, fill };
}

test('选择 PDF 后显示页数、自动填写范围并更新摘要', async (t) => {
  const { view, upload } = setup(t);
  await act(() => view.open());
  await upload();
  assert.match(document.getElementById('conversion-file-name').textContent, /样书.pdf/);
  assert.equal(document.getElementById('conversion-end').value, '3');
  assert.match(document.getElementById('conversion-summary-pages').textContent, /3/);
  assert.equal(document.getElementById('conversion-submit').disabled, false);
});

test('历史仍在加载时选择新 PDF，不会被旧任务覆盖', async (t) => {
  let release;
  const status = new Promise((resolve) => { release = resolve; });
  const oldUpload = { id: 'old-upload', name: '历史扫描件.pdf', pages: 8, size: 30 };
  const jobs = [{ id: 'old-job', upload: oldUpload, status: 'completed', pageStart: 2, pageEnd: 8, model: 'old-model', workers: 2, progress: 100, files: [] }];
  const { view, upload } = setup(t, { jobs, status });
  let opening;
  await act(async () => { opening = view.open({ jobId: 'old-job' }); });
  await upload();
  await act(async () => { release({ available: true, jobs }); await opening; });
  assert.match(document.getElementById('conversion-file-name').textContent, /样书.pdf/);
  assert.equal(document.getElementById('conversion-start').value, '1');
  assert.equal(document.getElementById('conversion-end').value, '3');
  assert.equal(document.getElementById('conversion-result').hidden, true);
  assert.equal(document.getElementById('conversion-submit').disabled, false);
});

test('错误页码会阻止提交并将焦点移到对应输入框', async (t) => {
  const { view, upload, submit, calls, fill } = setup(t);
  await act(() => view.open()); await upload();
  await fill('conversion-key', 'test-only-placeholder');
  await fill('conversion-end', '4');
  await submit();
  assert.equal(calls.some((c) => c.url.endsWith('/jobs')), false);
  assert.equal(document.activeElement.id, 'conversion-end');
  assert.match(document.getElementById('conversion-error').textContent, /3/);
});

test('Key 只随开始请求发送，提交或离开转换页后清空', async (t) => {
  const { view, upload, submit, calls, fill } = setup(t);
  await act(() => view.open()); await upload();
  const key = document.getElementById('conversion-key');
  await fill('conversion-key', 'test-only-placeholder');
  await submit();
  assert.equal(key.value, '');
  const request = calls.find((c) => c.url.endsWith('/jobs'));
  assert.equal(JSON.parse(request.options.body).apiKey, 'test-only-placeholder');
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  await fill('conversion-key', 'another-test-placeholder');
  act(() => view.deactivate());
  assert.equal(key.value, '');
});

test('统一添加入口可将选中的 PDF 直接交给转换页', async (t) => {
  const { view, calls } = setup(t);
  const file = new window.File(['%PDF-test'], '从书库添加.pdf', { type: 'application/pdf' });
  await act(() => view.open({ file }));
  assert.equal(calls.filter((call) => call.url.endsWith('/uploads')).length, 1);
  assert.match(document.getElementById('conversion-file-name').textContent, /样书.pdf/);
  assert.equal(document.getElementById('conversion-end').value, '3');
  assert.equal(document.getElementById('conversion-submit').disabled, false);
});

test('任务中心可选择历史任务，已中断任务要求重新输入 Key', async (t) => {
  const upload = { id: 'upload-old', name: '历史扫描件.pdf', pages: 12, size: 30 };
  const jobs = ['new', 'old'].map((id) => ({ id, upload, status: 'interrupted', pageStart: 4, pageEnd: 8, model: 'test-model', workers: 2, progress: 41, files: [], error: '服务已停止，请重新转换' }));
  const { view, calls, submit } = setup(t, { jobs });
  await act(() => view.open({ jobId: 'old' }));
  assert.match(document.getElementById('conversion-status').textContent, /已中断/);
  assert.equal(document.getElementById('conversion-start').value, '4');
  assert.equal(document.getElementById('conversion-end').value, '8');
  assert.equal(document.getElementById('conversion-model').value, 'test-model');
  assert.equal(document.getElementById('conversion-key').value, '');
  await submit();
  assert.equal(calls.some((call) => call.url.endsWith('/jobs')), false);
  assert.equal(document.activeElement.id, 'conversion-key');
});

test('清理任务后移除已失效的转换结果入口', async (t) => {
  const upload = { id: 'upload-old', name: '已完成.pdf', pages: 3, size: 30 };
  const job = { id: 'old', upload, status: 'completed', pageStart: 1, pageEnd: 3, model: 'test-model', workers: 2, progress: 100, files: [] };
  const { view } = setup(t, { jobs: [job] });
  await act(() => view.open({ jobId: 'old' }));
  assert.equal(document.getElementById('conversion-result').hidden, false);
  act(() => window.dispatchEvent(new window.CustomEvent('s2e:tasks-changed', { detail: { cleanup: true } })));
  assert.equal(document.getElementById('conversion-result').hidden, true);
  assert.equal(document.getElementById('conversion-submit').disabled, true);
  assert.match(document.getElementById('conversion-file-name').textContent, /把 PDF 拖到这里/);
});

test('直接打开转换页可选新文件，清理历史保留草稿及页码', async (t) => {
  const source = { id: 'upload-old', name: '历史扫描件.pdf', pages: 9, size: 30 };
  const completed = { id: 'completed', upload: source, status: 'completed', pageStart: 1, pageEnd: 9, model: 'test-model', workers: 2, progress: 100, files: [] };
  const { view, upload, fill } = setup(t, { jobs: [completed] });
  await act(() => view.open());
  assert.equal(document.getElementById('conversion-result').hidden, true);
  assert.match(document.getElementById('conversion-file-name').textContent, /把 PDF 拖到这里/);
  await upload();
  await fill('conversion-start', '2');
  assert.equal(await view.getDraftUploadId(), 'upload-1');
  act(() => window.dispatchEvent(new window.CustomEvent('s2e:tasks-changed', { detail: { cleanup: true } })));
  assert.equal(document.getElementById('conversion-start').value, '2');
  assert.match(document.getElementById('conversion-file-name').textContent, /样书.pdf/);
});

test('默认恢复正在运行的任务，已完成任务可更换 PDF', async (t) => {
  const source = { id: 'upload-old', name: '历史扫描件.pdf', pages: 9, size: 30 };
  const completed = { id: 'completed', upload: source, status: 'completed', pageStart: 1, pageEnd: 9, model: 'test-model', workers: 2, progress: 100, files: [] };
  const running = { ...completed, id: 'running', status: 'running', progress: 45 };
  const { view, upload } = setup(t, { jobs: [completed, running] });
  await act(() => view.open());
  assert.equal(document.getElementById('conversion-progress').dataset.status, 'running');
  assert.equal(await view.getDraftUploadId(), undefined);
  await act(() => view.open({ jobId: 'completed' }));
  assert.equal(document.getElementById('conversion-result').hidden, false);
  assert.equal(document.getElementById('conversion-drop').matches(':disabled'), false);
  await upload();
  assert.equal(document.getElementById('conversion-result').hidden, true);
  assert.equal(document.getElementById('conversion-submit').disabled, false);
});

test('书籍移出书库后仍可由保留的转换结果再次加入', async (t) => {
  const upload = { id: 'upload-old', name: '已完成.pdf', pages: 3, size: 30 };
  const job = { id: 'old', upload, status: 'completed', pageStart: 1, pageEnd: 3, model: 'test-model', workers: 2, progress: 100, files: [{ kind: 's2e', name: '已完成.s2e', url: '/files/s2e' }] };
  const library = new Set();
  const importJobs = [];
  const { view } = setup(t, { jobs: [job], onImport: async (_file, jobId) => { importJobs.push(jobId); library.add('book-1'); return 'book-1'; } });
  await act(() => view.open({ jobId: 'old' }));
  await act(async () => document.getElementById('conversion-read').click());
  library.delete('book-1');
  await act(() => view.open({ jobId: 'old' }));
  await act(async () => document.getElementById('conversion-read').click());
  assert.equal(library.has('book-1'), true);
  assert.deepEqual(importJobs, ['old', 'old']);
});

for (const detail of [{ removedId: 'old' }, { cleanup: true }]) {
  test(`${detail.cleanup ? '清理' : '移除'}已结束任务时，即使页面进度滞后也会重置`, async (t) => {
    const upload = { id: 'upload-old', name: '刚完成.pdf', pages: 3, size: 30 };
    const jobs = [{ id: 'old', upload, status: 'running', pageStart: 1, pageEnd: 3, model: 'test-model', workers: 2, progress: 68, files: [] }];
    const { view } = setup(t, { jobs });
    await act(() => view.open({ jobId: 'old' }));
    jobs.splice(0);
    await act(async () => window.dispatchEvent(new window.CustomEvent('s2e:tasks-changed', { detail })));
    assert.equal(document.getElementById('conversion-progress').hidden, true);
    assert.equal(document.getElementById('conversion-fields').disabled, false);
    assert.equal(document.getElementById('conversion-submit').disabled, true);
  });
}

test('转换失败原因出现在失败卡内，重试设置紧随其后', async (t) => {
  const upload = { id: 'upload-old', name: '失败样书.pdf', pages: 3, size: 30 };
  const jobs = [{ id: 'failed', upload, status: 'failed', pageStart: 1, pageEnd: 3, model: 'test-model', workers: 2, progress: 12, files: [], error: '测试模型不可用，请更换模型后重试' }];
  const { view } = setup(t, { jobs });
  await act(() => view.open({ jobId: 'failed' }));
  assert.match(document.querySelector('#conversion-progress #conversion-error')?.textContent || '', /请更换模型后重试/);
  assert.equal(document.querySelectorAll('#conversion-error').length, 1);
});
