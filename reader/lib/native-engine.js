import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const readerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = dirname(readerRoot);
const appEngine = app => join(app, 'Contents', 'Resources', 'scan2ebook-engine');
const nativeCandidates = () => [
  join(readerRoot, 'native', `darwin-${process.arch}`, 'scan2ebook-engine'),
  join(repositoryRoot, 'desktop', 'src-tauri', 'resources', 'scan2ebook-engine'),
  appEngine(join(repositoryRoot, 'dist', 'macos', 'Scan2Ebook.app')),
  appEngine(join(homedir(), 'Applications', 'Scan2Ebook.app')),
  appEngine('/Applications/Scan2Ebook.app'),
];

export async function resolveConverter(options = {}, { platform = process.platform, candidates = nativeCandidates(), searchPath = process.env.PATH || '' } = {}) {
  if (options.command) return { command: options.command, args: options.args || [], kind: 'custom' };
  if (platform !== 'darwin') return null;
  const configured = options.enginePath || process.env.SCAN2EBOOK_ENGINE;
  const paths = configured ? [configured] : [...candidates,
    ...searchPath.split(delimiter).filter(Boolean).map(directory => join(directory, 'scan2ebook-engine'))];
  for (const command of paths) {
    try {
      await access(command, constants.X_OK);
      return { command, args: options.args || [], kind: 'native-swift' };
    } catch {}
  }
  return null;
}

export function converterUnavailableMessage() {
  return process.platform === 'darwin'
    ? '本机缺少原生转换器，请安装 Scan2Ebook macOS App 后重启网页服务；现有电子书仍可阅读'
    : '原生 PDF 转换目前支持 macOS 14.4 及以上；当前仍可导入和阅读电子书';
}
