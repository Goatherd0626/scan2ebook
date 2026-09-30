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

test('registers the conversion panel as a native right-sidebar tab', () => {
  assert.match(source, /const TAB_KIND = 'scan2ebook'/)
  assert.match(source, /const inject = \[SLOTS_SERVICE, TABS_SERVICE, SIDEBAR_SERVICE\]/)
  assert.match(source, /tabs\.register\(\{/)
  assert.match(source, /guide: \[\{/)
  assert.match(source, /ctx\.slots\.inject\(TAB_SLOT, \(\) => ctx\.slots\.register\(\{ name: TAB_SLOT, key: TAB_ID \}, Scan2EbookTab\)\)/)
  assert.match(source, /h\(ConversionView, \{ sessionId \}\)/)
  assert.match(source, /h\(ReaderView\)/)
})

test('drops the removed client runtime and the third-party sidebar plugin', () => {
  assert.doesNotMatch(source, /betterSidebar|better-sidebar/)
  assert.doesNotMatch(source, /@deepseek-ai\/dsh-client-runtime/)
  assert.doesNotMatch(source, /MutationObserver|data-dsh-scan2ebook-entry|sidebarCol|logoRow/)
})

test('opens the reader through host RPC instead of an intercepted sidebar link', () => {
  assert.match(source, /rpc\('reader-open'/)
  assert.doesNotMatch(source, /href: status\.url/)
  assert.doesNotMatch(source, /target: '_blank'/)
})

test('keeps one API key only in panel memory and clears it when the tab unmounts', () => {
  assert.match(source, /function ConversionView\(\{ sessionId \}\)/)
  assert.match(source, /useEffect\(\(\) => \(\) => setApiKey\(''\), \[\]\)/)
  assert.match(source, /scan2ebook:host-unavailable/)
  assert.match(source, /pagehide/)
  assert.match(source, /关闭右栏或 DSH 后自动清除/)
  assert.doesNotMatch(source, /keychain|api-key-save|api-key-clear|API_KEY_SOURCE_KEY/i)
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*apiKey/)
})
