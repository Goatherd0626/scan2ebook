import { spawn } from 'node:child_process';

export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [url] };
  if (platform === 'win32') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] };
  }
  return { command: 'xdg-open', args: [url] };
}

export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const { command, args } = browserCommand(url, platform);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
