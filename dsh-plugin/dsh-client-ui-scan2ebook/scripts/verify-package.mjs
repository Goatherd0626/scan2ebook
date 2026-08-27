import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cache = mkdtempSync(join(tmpdir(), 'scan2ebook-dsh-plugin-npm-cache-'))
const output = execFileSync('npm', ['--cache', cache, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
const report = JSON.parse(output)[0]
const files = new Set(report.files.map((item) => item.path))

for (const required of ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
  assert.ok(files.has(required), `npm 包缺少 ${required}`)
}
for (const forbidden of ['test/', 'scripts/', 'node_modules/', '.env']) {
  assert.equal(
    [...files].some((path) => path === forbidden || path.startsWith(forbidden)),
    false,
    `npm 包不应包含 ${forbidden}`,
  )
}

console.log(`DSH 插件包内容检查通过：${report.filename} · ${report.files.length} files · ${report.size} bytes`)
