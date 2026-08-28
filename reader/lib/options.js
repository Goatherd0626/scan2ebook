export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8765;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`${option} 需要一个值`);
  }
  return value;
}

export function validateHost(value) {
  const host = String(value || '').trim();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error('host 目前只允许 127.0.0.1、localhost 或 ::1，避免在局域网暴露本地阅读器');
  }
  return host;
}

export function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('port 必须是 1024–65535 之间的整数');
  }
  return port;
}

export function parseCliArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    openBrowser: true,
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--no-open') options.openBrowser = false;
    else if (arg === '--data-dir') options.storageDir = readValue(argv, index++, '--data-dir');
    else if (arg.startsWith('--data-dir=')) options.storageDir = arg.slice('--data-dir='.length);
    else if (arg === '--host') options.host = readValue(argv, index++, '--host');
    else if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length);
    else if (arg === '--port') options.port = readValue(argv, index++, '--port');
    else if (arg.startsWith('--port=')) options.port = arg.slice('--port='.length);
    else throw new Error(`未知参数：${arg}`);
  }

  options.host = validateHost(options.host);
  options.port = validatePort(options.port);
  return options;
}

export function helpText() {
  return `scan2ebook-reader

用法:
  scan2ebook-reader [options]

选项:
  --host <host>   监听地址（默认 127.0.0.1，仅允许回环地址）
  --port <port>   监听端口（默认 8765）
  --data-dir <dir> 覆盖数据目录（默认使用系统应用数据目录）
  --no-open       启动后不自动打开浏览器
  -h, --help      显示帮助
  -v, --version   显示版本

注意:
  书库保存在独立应用数据目录，host 和 port 不再隔离数据。`;
}
