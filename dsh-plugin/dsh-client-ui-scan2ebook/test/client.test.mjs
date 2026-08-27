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
  assert.match(source, /h\(ConversionView, \{ scope \}\)/)
  assert.match(source, /h\(ReaderView\)/)
  assert.doesNotMatch(source, /data-dsh-scan2ebook-reader-entry', label:/)
})

test('opens the reader through host RPC instead of an intercepted sidebar link', () => {
  assert.match(source, /rpc\('reader-open'/)
  assert.doesNotMatch(source, /href: status\.url/)
  assert.doesNotMatch(source, /target: '_blank'/)
})

test('offers explicit API key sources without persisting key material in the browser', () => {
  assert.match(source, /macOS 钥匙串（已配置）/)
  assert.match(source, /仅本次转换输入/)
  assert.match(source, /环境变量 \/ 项目 \.env/)
  assert.match(source, /rpc\('api-key-save'/)
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*apiKey/)
})
