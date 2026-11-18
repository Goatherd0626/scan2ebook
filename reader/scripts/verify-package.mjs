import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--arch'), '用法：node scripts/verify-package.mjs [--arch arm64|x64]');
const architecture = args[1] ?? (process.platform === 'darwin' ? process.arch : null);
if (architecture) assert.ok(['arm64', 'x64'].includes(architecture), `不支持的处理器架构：${architecture}`);

const scratch = mkdtempSync(join(tmpdir(), 'scan2ebook-package-check-'));
try {
  const output = execFileSync('npm', ['--cache', join(scratch, 'cache'), 'pack', '--json', '--ignore-scripts', '--pack-destination', scratch], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  const report = JSON.parse(output)[0];
  const files = new Set(report.files.map((item) => item.path));

  for (const required of ['package.json', 'README.md', 'AUTOMATION.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'bin/scan2ebook-reader.js', 'lib/server.js', 'lib/storage.js', 'dist/index.html', 'native/README.md']) {
    assert.ok(files.has(required), `npm 包缺少 ${required}`);
  }
  for (const forbidden of ['src/', 'test/', 'node_modules/', '.env']) {
    assert.equal([...files].some((path) => path === forbidden || path.startsWith(forbidden)), false, `npm 包不应包含 ${forbidden}`);
  }
  if (architecture) {
    const required = `native/darwin-${architecture}/scan2ebook-engine`;
    assert.ok(files.has(required), `npm 包缺少当前构建架构的引擎 ${required}；请先运行 npm run build:engine -- --arch ${architecture}`);
  }

  const nativeArchitectures = [];
  for (const item of report.files) {
    const match = /^native\/darwin-([^/]+)\/scan2ebook-engine$/.exec(item.path);
    if (!match) continue;
    const nativeArchitecture = match[1];
    const cpuType = { arm64: 0x0100000c, x64: 0x01000007 }[nativeArchitecture];
    assert.ok(cpuType, `npm 包含未知架构的引擎 ${item.path}`);
    assert.ok((item.mode & 0o111) !== 0, `npm 包内的引擎不可执行：${item.path}`);
    const engine = execFileSync('tar', ['-xOf', join(scratch, report.filename), `package/${item.path}`], { maxBuffer: 16 * 1024 * 1024 });
    assert.ok(engine.length >= 8, `npm 包内的引擎为空或损坏：${item.path}`);
    assert.equal(engine.readUInt32LE(0), 0xfeedfacf, `npm 包内的引擎不是 Mach-O 64 位文件：${item.path}`);
    assert.equal(engine.readUInt32LE(4), cpuType, `npm 包内引擎的实际架构与目录不符：${item.path}`);
    nativeArchitectures.push(`darwin-${nativeArchitecture}`);
  }

  console.log(`npm 包内容检查通过：${report.filename} · ${report.files.length} files · ${report.size} bytes`);
  console.log(nativeArchitectures.length > 0
    ? `包内原生转换引擎：${nativeArchitectures.sort().join(', ')}（macOS 14.4+）`
    : '包内没有原生转换引擎；此包仅支持网页阅读。');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
