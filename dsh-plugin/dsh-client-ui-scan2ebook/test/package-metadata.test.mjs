import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const hostSource = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

test('plugin targets DSH Desktop 0.2.x and declares its standalone reader dependency', () => {
  assert.equal(packageJson.version, '0.2.1')
  assert.equal(packageJson.dsh.engines.dsh, '>=0.2.0-rc.2')
  assert.deepEqual(packageJson.dsh.client.inject, [
    '@deepseek-ai/dsh-client-modules',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-sidebar-right',
  ])
  assert.equal(packageJson.dependencies['scan2ebook-reader'], '^0.1.0')
  assert.equal(packageJson.dependencies['dsh-better-sidebar'], undefined)
  assert.equal(packageJson.publishConfig.access, 'public')
  assert.ok(packageJson.files.includes('LICENSE'))
  assert.equal(packageJson.private, undefined)
})

test('host no longer derives converter or reader paths from the source repository', () => {
  assert.doesNotMatch(
    hostSource,
    /DEFAULT_PROJECT_ROOT|config\.projectRoot|scan2ebook\.reader|reader\/dist|join\([^\n]*['"]\.venv/,
  )
  assert.match(hostSource, /import\('scan2ebook-reader'\)/)
  assert.match(hostSource, /scan2ebookCommand/)
})
