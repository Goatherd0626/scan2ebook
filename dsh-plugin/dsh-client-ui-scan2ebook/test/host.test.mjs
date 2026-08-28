import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import * as readerApi from '../../../reader/lib/server.js'
import { apply, requireApiKey, resolveAuthorizedPdf, resolveWorkspacePath, validatePort } from '../lib/index.js'

test('workspace path rejects traversal', () => {
  assert.equal(resolveWorkspacePath('/tmp/work', 'books/a.pdf'), '/tmp/work/books/a.pdf')
  assert.throws(() => resolveWorkspacePath('/tmp/work', '../secret.pdf'), /工作区/)
})

test('reader port validation is bounded', () => {
  assert.equal(validatePort(8765), 8765)
  assert.throws(() => validatePort(80), /1024/)
  assert.throws(() => validatePort(70000), /65535/)
})

test('absolute PDF paths require explicit file-picker authorization', () => {
  assert.throws(() => resolveAuthorizedPdf('/tmp', process.execPath, new Set()), /授权/)
})

test('requires an explicitly supplied API key', () => {
  assert.equal(requireApiKey('  test-secret  '), 'test-secret')
  assert.throws(() => requireApiKey(''), /填写 API Key/)
  assert.throws(() => requireApiKey(undefined), /填写 API Key/)
})

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function createHarness(config = {}, sessions) {
  let rpcHandler
  const cleanups = []
  const ctx = {
    tools: { register() {} },
    get(name) { return name === 'sessions' ? sessions : undefined },
    inject(_deps, callback) {
      callback({ connection: { rpc: { handle(_route, handler) { rpcHandler = handler } } } })
    },
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  apply(ctx, {
    readerApi,
    readerDataDir: mkdtempSync(join(tmpdir(), 'scan2ebook-plugin-reader-')),
    ...config,
  })
  return {
    rpc: (...args) => rpcHandler(...args),
    async cleanup() {
      for (const cleanup of cleanups) await cleanup()
    },
  }
}

test('plugin starts and terminates its managed reader', async () => {
  let openedUrl
  const harness = createHarness({ openExternalUrl: async (url) => { openedUrl = url } })
  const port = await freePort()
  try {
    const started = await harness.rpc('reader-start', { args: { port } })
    assert.equal(started.ok, true)
    assert.equal(started.value.running, true)
    assert.equal(started.value.managed, true)

    const restarted = await harness.rpc('reader-start', { args: { port } })
    assert.equal(restarted.ok, true)
    assert.equal(restarted.value.managed, true)

    const opened = await harness.rpc('reader-open', { args: { port } })
    assert.equal(opened.ok, true)
    assert.equal(opened.value.opened, true)
    assert.equal(openedUrl, `http://127.0.0.1:${port}`)

    const stopped = await harness.rpc('reader-stop', { args: { port } })
    assert.equal(stopped.ok, true)
    assert.equal(stopped.value.running, false)
  } finally {
    await harness.cleanup()
  }
})

test('plugin distinguishes an unrelated service from a scan2ebook reader', async () => {
  const unrelated = createHttpServer((_request, response) => response.end('not a reader'))
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve))
  const port = unrelated.address().port
  const harness = createHarness()
  try {
    const status = await harness.rpc('reader-status', { args: { port } })
    assert.equal(status.ok, true)
    assert.equal(status.value.running, false)
    assert.equal(status.value.occupied, true)

    const started = await harness.rpc('reader-start', { args: { port } })
    assert.equal(started.ok, false)
    assert.match(started.error.message, /其他程序占用/)

    const opened = await harness.rpc('reader-open', { args: { port } })
    assert.equal(opened.ok, false)
    assert.match(opened.error.message, /不是 scan2ebook 阅读器/)
  } finally {
    await harness.cleanup()
    await new Promise((resolve) => unrelated.close(resolve))
  }
})

test('plugin invokes an independently installed scan2ebook command', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'scan2ebook-plugin-'))
  await writeFile(join(cwd, 'book.pdf'), '%PDF-test')
  const calls = []
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify({ pages: 12 }))
      child.stderr.end()
      setImmediate(() => child.emit('exit', 0, null))
    })
    return child
  }
  const sessions = new Map([['session-1', { header: { cwd } }]])
  const harness = createHarness({ scan2ebookCommand: '/opt/scan2ebook/bin/scan2ebook', spawnProcess }, sessions)
  try {
    const inspected = await harness.rpc('inspect', { args: { sessionId: 'session-1', pdf: 'book.pdf' } })
    assert.equal(inspected.ok, true)
    assert.deepEqual(inspected.value, { pages: 12 })
    assert.equal(calls[0].command, '/opt/scan2ebook/bin/scan2ebook')
    assert.deepEqual(calls[0].args, ['inspect', await realpath(join(cwd, 'book.pdf'))])
    assert.equal(calls[0].options.cwd, cwd)
  } finally {
    await harness.cleanup()
  }
})
