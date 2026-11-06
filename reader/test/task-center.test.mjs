import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCenter } from '../src/web/TaskCenter.tsx';

test('连续断线后仍自动重试，服务恢复后更新后台任务状态', async (t) => {
  const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', { url: 'http://127.0.0.1/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let requests = 0;
  const running = { id: 'job-1', status: 'running', progress: 12, files: [], upload: { name: '样书.pdf' } };
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (requests === 2 || requests === 3) throw new Error('offline');
    return { ok: true, json: async () => ({ available: true, jobs: [{ ...running, status: requests >= 4 ? 'completed' : 'running' }] }) };
  });
  const root = createRoot(document.getElementById('app'));
  t.after(() => { act(() => root.unmount()); t.mock.timers.reset(); dom.window.close(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await act(async () => root.render(createElement(TaskCenter)));
  for (let index = 0; index < 4; index++) await act(async () => t.mock.timers.tick(1600));
  assert.ok(requests >= 4, '连续断线也必须保留下一次轮询');
  assert.equal(document.getElementById('btn-tasks').getAttribute('aria-label'), '任务中心');
});
