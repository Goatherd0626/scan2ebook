import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'inspect') { console.log(JSON.stringify({ ok: true, pages: 3 })); process.exit(0); }
const output = args[args.indexOf('-o') + 1];
await mkdir(join(output, '.work-fixture'), { recursive: true });
const child = spawn(process.execPath, ['-e', `
  const fs = require('node:fs');
  process.on('SIGTERM', () => { fs.writeFileSync(process.argv[1], 'stopped'); process.exit(0); });
  process.send('ready');
  setTimeout(() => process.exit(0), 1500);
`, join(output, 'child-stopped')], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
await once(child, 'message');
await writeFile(join(output, 'child-ready'), 'ready');
console.log('S2E_EVENT ' + JSON.stringify({ stage: 'ocr', progress: 12, message: '测试子进程已启动' }));
setTimeout(() => process.exit(0), 30_000);
