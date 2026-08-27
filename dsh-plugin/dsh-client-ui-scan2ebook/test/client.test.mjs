import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
let registration
const context = {
  window: { __ModuleLoader__: { load(value) { registration = value } } },
  console,
  setInterval,
  clearInterval,
  setTimeout,
  URL,
}
vm.runInNewContext(source, context)
const plugin = registration.factory((name) => {
  if (name !== 'react') throw new Error(`unexpected require: ${name}`)
  return {
    createElement() { return null },
    useCallback(value) { return value },
    useEffect() {},
    useRef(value) { return { current: value } },
    useState(value) { return [value, () => {}] },
  }
})

test('detects scan-to-ebook intent conservatively', () => {
  assert.equal(plugin.testHooks.conversionIntent('请用 scan2ebook 处理这本书'), true)
  assert.equal(plugin.testHooks.conversionIntent('把这个扫描版 PDF 转成结构化电子书'), true)
  assert.equal(plugin.testHooks.conversionIntent('帮我阅读这个 PDF'), false)
})

test('validates editable reader port', () => {
  assert.equal(plugin.testHooks.validatePort(8765), true)
  assert.equal(plugin.testHooks.validatePort(80), false)
  assert.equal(plugin.testHooks.validatePort(65536), false)
})

test('registers one unified sidebar instead of separate conversion and reader tabs', () => {
  assert.match(source, /const SIDEBAR_TAB = 'scan2ebook:tools'/)
  assert.doesNotMatch(source, /scan2ebook:convert|scan2ebook:reader/)
  assert.match(source, /h\(ConversionView, \{ scope, visible \}\)/)
  assert.match(source, /h\(ReaderView\)/)
  assert.doesNotMatch(source, /data-dsh-scan2ebook-reader-entry', label:/)
})

test('opens the reader through host RPC instead of an intercepted sidebar link', () => {
  assert.match(source, /rpc\('reader-open'/)
  assert.doesNotMatch(source, /href: status\.url/)
  assert.doesNotMatch(source, /target: '_blank'/)
})

test('keeps one API key only in sidebar memory and clears it when hidden', () => {
  assert.match(source, /function ConversionView\(\{ scope, visible \}\)/)
  assert.match(source, /if \(!visible\) setApiKey\(''\)/)
  assert.match(source, /scan2ebook:host-unavailable/)
  assert.match(source, /pagehide/)
  assert.match(source, /关闭 sidebar 或 DSH 后自动清除/)
  assert.doesNotMatch(source, /keychain|api-key-save|api-key-clear|API_KEY_SOURCE_KEY/i)
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*apiKey/)
})
