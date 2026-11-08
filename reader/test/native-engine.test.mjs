import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConverter } from '../lib/native-engine.js';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 's2e-native-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configured = process.env.SCAN2EBOOK_ENGINE;
  delete process.env.SCAN2EBOOK_ENGINE;
  t.after(() => { if (configured === undefined) delete process.env.SCAN2EBOOK_ENGINE; else process.env.SCAN2EBOOK_ENGINE = configured; });
  const binary = async relative => {
    const file = join(root, relative);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    return file;
  };
  return { root, binary };
}

test('默认优先打包的原生引擎，不再选择 Python CLI', async t => {
  const { root, binary } = await setup(t);
  const packaged = await binary('native/scan2ebook-engine');
  const installed = await binary('app/scan2ebook-engine');
  await binary('bin/scan2ebook');
  const engine = await resolveConverter({}, { platform: 'darwin', candidates: [packaged, installed], searchPath: join(root, 'bin') });
  assert.deepEqual(engine, { command: packaged, args: [], kind: 'native-swift' });
});

test('可从原生 PATH 查找，只有旧 Python 命令时不会回退', async t => {
  const { root, binary } = await setup(t);
  await binary('legacy/scan2ebook');
  const runtime = { platform: 'darwin', candidates: [], searchPath: join(root, 'legacy') };
  assert.equal(await resolveConverter({}, runtime), null);
  const native = await binary('native/scan2ebook-engine');
  assert.equal((await resolveConverter({}, { ...runtime, searchPath: join(root, 'native') })).command, native);
});

test('非 macOS 不把原生转换显示为可用，测试与外部显式适配器仍可注入', async t => {
  const { binary } = await setup(t);
  const native = await binary('scan2ebook-engine');
  assert.equal(await resolveConverter({}, { platform: 'linux', candidates: [native], searchPath: '' }), null);
  assert.deepEqual(await resolveConverter({ command: process.execPath, args: ['fixture.mjs'] }, { platform: 'linux' }),
    { command: process.execPath, args: ['fixture.mjs'], kind: 'custom' });
});

test('显式指定的原生路径失败时给出不可用状态，成功时保留参数前缀', async t => {
  const { root, binary } = await setup(t);
  const native = await binary('scan2ebook-engine');
  const runtime = { platform: 'darwin', candidates: [native], searchPath: '' };
  assert.equal(await resolveConverter({ enginePath: join(root, 'missing') }, runtime), null);
  const args = ['--test-api-base', 'http://127.0.0.1:1234'];
  assert.deepEqual(await resolveConverter({ enginePath: native, args }, runtime), { command: native, args, kind: 'native-swift' });
});
