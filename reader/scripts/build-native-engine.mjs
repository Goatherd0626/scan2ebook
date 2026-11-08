import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = '用法：node scripts/build-native-engine.mjs [--arch arm64|x64]';
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(usage);
  process.exit(0);
}
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--arch')) {
  console.error(usage);
  process.exit(1);
}
const architecture = args[1] ?? process.arch;
if (process.platform !== 'darwin') {
  console.log('当前系统仅构建网页阅读器；PDF 转换需要 macOS 14.4 或更高版本的原生引擎。');
  process.exit(0);
}
const targetArchitecture = { arm64: 'arm64', x64: 'x86_64' }[architecture];
if (!targetArchitecture) {
  console.error(`不支持的处理器架构：${architecture}。${usage}`);
  process.exit(1);
}

const reader = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(reader, '..');
const sourceDirectory = join(root, 'desktop', 'engine');
const sources = readdirSync(sourceDirectory)
  .filter((name) => name.endsWith('.swift'))
  .sort()
  .map((name) => join(sourceDirectory, name));
if (sources.length === 0) throw new Error('尚未找到 Swift 转换引擎源码。');
const output = join(reader, 'native', `darwin-${architecture}`, 'scan2ebook-engine');
const cache = join(root, 'build', 'swift-module-cache');
mkdirSync(dirname(output), { recursive: true });
mkdirSync(cache, { recursive: true });

execFileSync('xcrun', [
  'swiftc', '-parse-as-library', '-O', '-whole-module-optimization',
  '-target', `${targetArchitecture}-apple-macosx14.4`,
  '-module-cache-path', cache, ...sources, '-o', output,
], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' });
console.log(`原生转换引擎已构建：${output}（macOS 14.4+ / ${architecture}）`);
