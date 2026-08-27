import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
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

test('plugin starts and terminates its managed reader', async () => {
  let rpcHandler
  let openedUrl
  const cleanups = []
  const ctx = {
    tools: { register() {} },
    get() { return undefined },
    inject(_deps, callback) {
      callback({ connection: { rpc: { handle(_route, handler) { rpcHandler = handler } } } })
    },
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  const projectRoot = fileURLToPath(new URL('../../..', import.meta.url))
  apply(ctx, { projectRoot, openExternalUrl: async (url) => { openedUrl = url } })
  const port = await freePort()
  try {
    const started = await rpcHandler('reader-start', { args: { port } })
    assert.equal(started.ok, true)
    assert.equal(started.value.running, true)
    assert.equal(started.value.managed, true)

    const opened = await rpcHandler('reader-open', { args: { port } })
    assert.equal(opened.ok, true)
    assert.equal(opened.value.opened, true)
    assert.equal(openedUrl, `http://127.0.0.1:${port}`)

    const stopped = await rpcHandler('reader-stop', { args: { port } })
    assert.equal(stopped.ok, true)
    assert.equal(stopped.value.running, false)
  } finally {
    for (const cleanup of cleanups) await cleanup()
  }
})
