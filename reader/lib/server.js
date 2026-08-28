import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBrowser as openSystemBrowser } from './open-browser.js';
import { DEFAULT_HOST, DEFAULT_PORT, validateHost, validatePort } from './options.js';
import { ReaderStorage, defaultStorageDir } from './storage.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const READER_APP_ID = 'scan2ebook-reader';
export const READER_VERSION = packageJson.version;
export const DEFAULT_DIST_DIR = resolve(PACKAGE_ROOT, 'dist');
export const HEALTH_PATH = '/__scan2ebook__/health';
export const STORAGE_PATH = '/__scan2ebook__/storage';
export const STORAGE_COMMAND_PATH = '/__scan2ebook__/storage/command';
export const STORAGE_PDF_PREFIX = '/__scan2ebook__/storage/books/';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export class PortInUseError extends Error {}

function displayHost(host) {
  return host === '::1' ? '[::1]' : host;
}

export function readerUrl(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return `http://${displayHost(host)}:${port}`;
}

function send(response, statusCode, body, headers = {}, { head = false } = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(statusCode, {
    'content-length': content.length,
    ...headers,
  });
  response.end(head ? undefined : content);
}

function sendJson(response, statusCode, value, options = {}) {
  send(response, statusCode, JSON.stringify(value), {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  }, options);
}

function sameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.host === request.headers.host;
  } catch {
    return false;
  }
}

async function readRequestBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function pdfBookId(pathname) {
  const match = pathname.match(/^\/__scan2ebook__\/storage\/books\/([^/]+)\/pdf$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function assetPath(distDir, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://reader.local').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = resolve(distDir, `.${requested}`);
  const rel = relative(distDir, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    return null;
  }
  return target;
}

export function createRequestHandler({
  distDir = DEFAULT_DIST_DIR,
  version = READER_VERSION,
  storage,
} = {}) {
  return async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://reader.local').pathname;
    if (pathname === HEALTH_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      const body = JSON.stringify({ app: READER_APP_ID, version, storageDir: storage?.storageDir || null });
      send(response, 200, body, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      }, { head: request.method === 'HEAD' });
      return;
    }

    if (storage && pathname === STORAGE_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      try {
        sendJson(response, 200, await storage.snapshot(), { head: request.method === 'HEAD' });
      } catch (error) {
        sendJson(response, 500, { error: error.message });
      }
      return;
    }

    const bookId = storage ? pdfBookId(pathname) : null;
    if (storage && bookId !== null) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        try {
          send(response, 200, await storage.readPdf(bookId), {
            'cache-control': 'no-store',
            'content-type': 'application/pdf',
          }, { head: request.method === 'HEAD' });
        } catch (error) {
          sendJson(response, error?.code === 'ENOENT' ? 404 : 400, { error: error.message });
        }
        return;
      }
      if (request.method === 'PUT') {
        if (!sameOriginRequest(request)) {
          sendJson(response, 403, { error: '拒绝跨源写入' });
          return;
        }
        try {
          await storage.writePdf(bookId, await readRequestBody(request, 1024 * 1024 * 1024));
          sendJson(response, 200, { ok: true });
        } catch (error) {
          sendJson(response, error.statusCode || 400, { error: error.message });
        }
        return;
      }
      send(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD, PUT', 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    if (storage && pathname === STORAGE_COMMAND_PATH) {
      if (request.method !== 'POST') {
        send(response, 405, 'Method Not Allowed', { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      if (!sameOriginRequest(request) || request.headers['content-type']?.split(';')[0] !== 'application/json') {
        sendJson(response, 403, { error: '拒绝跨源或非 JSON 写入' });
        return;
      }
      try {
        const payload = JSON.parse((await readRequestBody(request, 128 * 1024 * 1024)).toString('utf8'));
        sendJson(response, 200, await storage.command(payload));
      } catch (error) {
        sendJson(response, error.statusCode || 400, { error: error.message });
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    const target = assetPath(distDir, request.url || '/');
    if (target === null) {
      send(response, 400, 'Bad Request', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    try {
      const info = await stat(target);
      if (!info.isFile()) throw new Error('not a file');
      const content = await readFile(target);
      const extension = extname(target).toLowerCase();
      const isAsset = relative(distDir, target).split(/[\\/]/)[0] === 'assets';
      send(response, 200, content, {
        'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        'content-type': MIME_TYPES.get(extension) || 'application/octet-stream',
      }, { head: request.method === 'HEAD' });
    } catch {
      send(response, 404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' });
    }
  };
}

async function ensureBuilt(distDir) {
  try {
    const info = await stat(resolve(distDir, 'index.html'));
    if (info.isFile()) return;
  } catch {}
  throw new Error(`未找到已构建的阅读器 ${distDir}，请先运行 npm run build`);
}

export async function createReaderServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  distDir = DEFAULT_DIST_DIR,
  storageDir = defaultStorageDir(),
} = {}) {
  const safeHost = validateHost(host);
  const safePort = port === 0 ? 0 : validatePort(port);
  await ensureBuilt(distDir);
  const storage = await new ReaderStorage(storageDir).init();
  const server = createServer(createRequestHandler({ distDir, storage }));

  await new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(safePort, safeHost);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : safePort;
  return {
    server,
    host: safeHost,
    port: actualPort,
    url: readerUrl(safeHost, actualPort),
    storageDir: storage.storageDir,
    async close() {
      if (!server.listening) return;
      await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}

export async function probeReader({ host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 500 } = {}) {
  const url = readerUrl(host, port);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}${HEALTH_PATH}`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return { status: 'occupied', url };
    const body = await response.json().catch(() => null);
    return body?.app === READER_APP_ID
      ? { status: 'reader', url, version: body.version, storageDir: body.storageDir || null }
      : { status: 'occupied', url };
  } catch {
    return { status: 'free', url };
  } finally {
    clearTimeout(timer);
  }
}

export async function startReader({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  distDir = DEFAULT_DIST_DIR,
  storageDir = defaultStorageDir(),
  openBrowser = true,
  openBrowserImpl = openSystemBrowser,
} = {}) {
  const safeHost = validateHost(host);
  const safePort = validatePort(port);
  const expectedStorageDir = resolve(storageDir);
  const probe = await probeReader({ host: safeHost, port: safePort });
  if (probe.status === 'occupied') {
    throw new PortInUseError(`端口 ${safePort} 已被其他程序占用，请使用 --port 选择其他端口`);
  }
  if (probe.status === 'reader') {
    if (probe.storageDir && resolve(probe.storageDir) !== expectedStorageDir) {
      throw new PortInUseError(`端口 ${safePort} 上的阅读器使用了不同数据目录，请关闭它或更换端口`);
    }
    if (openBrowser) await openBrowserImpl(probe.url);
    return {
      reused: true, host: safeHost, port: safePort, url: probe.url,
      version: probe.version, storageDir: probe.storageDir || expectedStorageDir,
    };
  }

  let instance;
  try {
    instance = await createReaderServer({ host: safeHost, port: safePort, distDir, storageDir });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw new PortInUseError(`端口 ${safePort} 在启动期间被占用，请重试或选择其他端口`);
    }
    throw error;
  }
  if (openBrowser) {
    try {
      await openBrowserImpl(instance.url);
    } catch (error) {
      process.emitWarning(`无法自动打开浏览器：${error.message}`);
    }
  }
  return { ...instance, reused: false, version: READER_VERSION };
}
