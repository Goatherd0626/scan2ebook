import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const CONVERSION_PATH = '/__scan2ebook__/conversion';
const MAX_PDF_BYTES = 512 * 1024 * 1024;
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const problem = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const FILE_KINDS = ['s2e', 'json', 'html'];
const STATUSES = ['running', 'completed', 'failed', 'cancelled', 'interrupted'];
const STAGES = ['start', 'ocr', 'structure', 'finalize', 'complete'];
const VALID_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONVERSION_ERROR = '转换进程已退出，请检查模型、API Key 和账户额度后重试';

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.length });
  response.end(body);
}

function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!request.headers.origin) return true;
  try {
    const origin = new URL(request.headers.origin);
    return origin.protocol === 'http:' && origin.host === request.headers.host;
  } catch { return false; }
}

async function payload(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw problem('请求格式应为 JSON', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw problem('请求内容过大', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw problem('请求内容无法读取'); }
}

async function resolveConverter(options) {
  if (options.command) return { command: options.command, args: options.args || [] };
  const python = join(SOURCE_ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  try {
    await access(python);
    await access(join(SOURCE_ROOT, 'scan2ebook/cli.py'));
    return { command: python, args: ['-m', 'scan2ebook'], cwd: SOURCE_ROOT };
  } catch {}
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const command = join(directory, 'scan2ebook');
    try { await access(command); return { command, args: [] }; } catch {}
  }
  return null;
}

function inspect(converter, file) {
  return new Promise((resolveInspect, reject) => {
    const child = spawn(converter.command, [...converter.args, 'inspect', file], { cwd: converter.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const timer = setTimeout(() => { child.kill(); reject(problem('读取 PDF 超时，请检查文件后重试')); }, 30_000);
    child.stdout.on('data', (chunk) => { if (text.length < 64 * 1024) text += chunk; });
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(problem('转换器无法启动，请检查 Python 转换器是否已安装', 503)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        const info = JSON.parse(text);
        if (code !== 0 || !info.ok || !Number.isInteger(info.pages) || info.pages < 1) throw new Error();
        resolveInspect(info.pages);
      } catch { reject(problem('无法读取这份 PDF，请确认文件未损坏、未加密且至少有一页')); }
    });
  });
}

function publicJob(job) {
  return {
    id: job.id, upload: job.upload, status: job.status, model: job.model,
    pageStart: job.pageStart, pageEnd: job.pageEnd, workers: job.workers,
    stage: job.stage, progress: job.progress, message: job.message, error: job.errorDetail || job.error,
    usage: job.usage, files: job.files, startedAt: job.startedAt, finishedAt: job.finishedAt,
    current: job.current, total: job.total, pdfPage: job.pdfPage,
  };
}

function publicUpload(upload) {
  return { id: upload.id, name: upload.name, pages: upload.pages, size: upload.size,
    url: `${CONVERSION_PATH}/uploads/${upload.id}/pdf` };
}

async function directoryBytes(directory) {
  let info;
  try { info = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  if (!info.isDirectory()) return info.size;
  const sizes = await Promise.all((await readdir(directory)).map((name) => directoryBytes(join(directory, name))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function sendFile(response, file, headers) {
  let handle;
  try { handle = await open(file, 'r'); }
  catch { throw problem('文件已丢失或无法读取，请重新选择或转换', 404); }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw problem('文件不存在', 404);
    response.writeHead(200, { 'content-length': info.size, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin', ...headers });
    await pipeline(handle.createReadStream(), response);
  } finally { await handle.close(); }
}

export async function createConversionManager({ directory, ...options }) {
  const converter = await resolveConverter(options);
  const uploads = new Map();
  const jobs = new Map();
  let starting = false;
  let startingUploadId;
  let closing = false;
  let cleaning = false;
  let writing = Promise.resolve();
  const stateFile = join(directory, 'state.json');

  function persist() {
    const state = JSON.stringify({ version: 1,
      uploads: [...uploads.values()].map(({ id, name, pages, size }) => ({ id, name, pages, size })),
      jobs: [...jobs.values()].map((job) => {
        const { upload, ...info } = publicJob(job);
        // 原始错误日志只用于本次显示；磁盘历史保留固定错误说明。
        return { ...info, uploadId: upload.id, error: job.error };
      }),
    });
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      const temporary = stateFile + '.tmp';
      await writeFile(temporary, state, { mode: 0o600 });
      await rename(temporary, stateFile);
    });
    writing.catch(() => {});
    return writing;
  }

  async function refreshFiles(job) {
    if (job.status !== 'completed') return false;
    const files = [];
    for (const file of job.files) {
      const name = `${job.upload.name.replace(/\.pdf$/i, '')}.${file.kind}`;
      try {
        const info = await stat(join(job.out, name));
        if (info.isFile() && info.size) files.push({ kind: file.kind, name, size: info.size,
          url: `${CONVERSION_PATH}/jobs/${job.id}/files/${file.kind}` });
      } catch {}
    }
    const changed = JSON.stringify(files) !== JSON.stringify(job.files);
    job.files = files;
    if (!files.some((file) => file.kind === 's2e')) {
      job.status = 'failed'; job.message = '电子书文件已丢失';
      job.error = '电子书文件已丢失，请重新转换'; job.files = [];
      return true;
    }
    return changed;
  }

  let saved;
  try { saved = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('转换历史记录无法读取，请检查本地转换数据目录'); }
  if (saved) {
    if (saved.version !== 1 || !Array.isArray(saved.uploads) || !Array.isArray(saved.jobs)) {
      throw new Error('转换历史记录格式无法识别，请检查本地转换数据目录');
    }
    for (const info of saved.uploads) {
      if (!info || !VALID_ID.test(info.id) || typeof info.name !== 'string' || !/\.pdf$/i.test(info.name)
        || info.name !== basename(info.name) || /[\x00-\x1f\\]/.test(info.name)
        || !Number.isInteger(info.pages) || info.pages < 1 || !Number.isInteger(info.size) || info.size < 5) continue;
      const upload = publicUpload(info);
      uploads.set(upload.id, { ...upload, file: join(directory, 'uploads', upload.id, upload.name) });
    }
    for (const info of saved.jobs) {
      const upload = info && uploads.get(info.uploadId);
      if (!upload || !VALID_ID.test(info.id) || !STATUSES.includes(info.status)
        || !Number.isInteger(info.pageStart) || !Number.isInteger(info.pageEnd)
        || info.pageStart < 1 || info.pageEnd < info.pageStart || info.pageEnd > upload.pages) continue;
      const job = {
        id: info.id, upload: publicUpload(upload), status: info.status,
        model: String(info.model || 'deepseek-flash').slice(0, 150), workers: info.workers,
        pageStart: info.pageStart, pageEnd: info.pageEnd, stage: STAGES.includes(info.stage) ? info.stage : 'start',
        progress: Number.isFinite(info.progress) ? Math.max(0, Math.min(100, info.progress)) : 0,
        message: String(info.message || '').slice(-1200), error: info.error ? String(info.error).slice(-1200) : null,
        usage: info.usage ? Object.fromEntries(['requests', 'input_tokens', 'output_tokens'].map((key) => [key, Number(info.usage[key]) || 0])) : null,
        files: Array.isArray(info.files) ? info.files.filter((file) => FILE_KINDS.includes(file?.kind)).map(({ kind }) => ({ kind })) : [],
        startedAt: info.startedAt, finishedAt: info.finishedAt, out: join(directory, 'jobs', info.id),
      };
      for (const key of ['current', 'total', 'pdfPage']) {
        if (Number.isInteger(info[key]) && info[key] >= 0) job[key] = info[key];
      }
      if (job.status === 'running') {
        job.status = 'interrupted'; job.message = '服务已停止，请重新转换'; job.error = job.message;
        job.finishedAt = Date.now(); job.files = [];
      }
      await refreshFiles(job);
      jobs.set(job.id, job);
    }
    await persist();
  }

  async function upload(request) {
    if (!converter) throw problem('尚未安装 Python 转换器，安装后重启本地服务即可转换；现有电子书仍可阅读', 503);
    if (request.headers['content-type']?.split(';')[0] !== 'application/pdf') throw problem('请选择 PDF 文件', 415);
    let name;
    try { name = basename(decodeURIComponent(request.headers['x-s2e-filename'] || '扫描书.pdf')); }
    catch { throw problem('文件名无法读取，请重新选择 PDF'); }
    if (!/\.pdf$/i.test(name)) throw problem('请选择 .pdf 文件');
    name = name.replace(/[\x00-\x1f<>:"|?*\\]/g, '_').slice(-180);
    const id = randomUUID();
    const root = join(directory, 'uploads', id);
    await mkdir(root, { recursive: true });
    const file = join(root, name);
    let size = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > MAX_PDF_BYTES ? problem('PDF 超过 512 MB，请拆分后再试', 413) : null, chunk);
    } });
    try {
      await pipeline(request, meter, createWriteStream(file));
      const handle = await open(file, 'r');
      const header = Buffer.alloc(5);
      try { await handle.read(header, 0, 5, 0); } finally { await handle.close(); }
      if (header.toString() !== '%PDF-') throw problem('这个文件不是有效的 PDF，请重新选择');
      const pages = await inspect(converter, file);
      const info = publicUpload({ id, name, pages, size });
      uploads.set(id, { ...info, file });
      await persist();
      return info;
    } catch (error) {
      uploads.delete(id);
      await rm(root, { force: true, recursive: true });
      throw error;
    }
  }

  async function start(args) {
    if (closing) throw problem('转换服务正在退出，请重新启动后再试', 503);
    if (!converter) throw problem('尚未安装 Python 转换器', 503);
    if (cleaning) throw problem('正在清理转换记录，请稍后再试', 409);
    if (starting || [...jobs.values()].some((job) => job.child)) throw problem('已有任务正在转换，请等待完成或先取消', 409);
    const upload = uploads.get(args.uploadId);
    if (!upload) throw problem('请重新选择 PDF 文件');
    const first = args.pageStart ?? 1;
    const last = args.pageEnd ?? upload.pages;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > upload.pages) {
      throw problem(`页码范围应在 1–${upload.pages} 之间，起始页不能大于结束页`);
    }
    const apiKey = String(args.apiKey || '').trim();
    if (!apiKey) throw problem('请填写本次转换使用的 API Key');
    const workers = args.workers ?? 6;
    if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw problem('并发数应为 1–16 的整数');
    const model = String(args.model || 'deepseek-flash').trim();
    if (!model || model.length > 150) throw problem('请填写有效的模型名称');
    const id = randomUUID();
    starting = true;
    startingUploadId = upload.id;
    try {
      try { if (!(await stat(upload.file)).isFile()) throw new Error(); }
      catch { throw problem('原始 PDF 已丢失，请重新选择 PDF 文件', 404); }
      const out = join(directory, 'jobs', id);
      await mkdir(out, { recursive: true });
      if (closing) throw problem('转换服务正在退出，请重新启动后再试', 503);
      const job = {
        id, upload: publicUpload(upload),
        status: 'running', model, workers, pageStart: first, pageEnd: last,
        stage: 'start', progress: 0, message: '正在准备转换', error: null, usage: null,
        files: [], startedAt: Date.now(), finishedAt: null, out,
      };
      // 凭据仅交给本次子进程，不放入任务对象、命令参数或持久化数据。
      const child = spawn(converter.command, [...converter.args, upload.file, '-o', out,
        '--page-start', String(first), '--page-end', String(last), '--vision-model', model,
        '--workers', String(workers), '--progress-json'], {
        cwd: converter.cwd, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DEEPSEEK_API_KEY: apiKey, PYTHONUNBUFFERED: '1' },
      });
      job.child = child;
      jobs.set(id, job);
      const redact = (value) => String(value || '').replaceAll(apiKey, '[已隐藏]').slice(-1200);
      let lastError = '';
      createInterface({ input: child.stderr }).on('line', (line) => { if (line.trim()) lastError = redact(line); });
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (job.status !== 'running' || !line.startsWith('S2E_EVENT ')) return;
        try {
          const event = JSON.parse(line.slice(10));
          if (STAGES.includes(event.stage)) job.stage = event.stage;
          if (Number.isFinite(event.progress)) job.progress = Math.max(job.progress, Math.min(99, event.progress));
          if (event.message) job.message = redact(event.message);
          if (event.usage) job.usage = Object.fromEntries(['requests', 'input_tokens', 'output_tokens'].map((key) => [key, Number(event.usage[key]) || 0]));
          for (const [field, key] of [['current', 'current'], ['total', 'total'], ['pdf_page', 'pdfPage']]) {
            if (Number.isInteger(event[field]) && event[field] >= 0) job[key] = event[field];
          }
          persist();
        } catch {}
      });
      child.once('error', () => {
        job.status = 'failed'; job.error = '转换器无法启动，请检查 Python 转换器是否已安装';
        job.message = '转换未能开始'; job.finishedAt = Date.now();
        persist();
      });
      job.closed = new Promise((resolveClosed) => child.once('close', async (code) => {
        try {
          if (job.status !== 'running') return;
          job.finishedAt = Date.now();
          if (code !== 0) {
            job.status = 'failed'; job.message = '转换未完成';
            job.error = CONVERSION_ERROR; job.errorDetail = lastError;
            return;
          }
          const stem = basename(upload.file).replace(/\.pdf$/i, '');
          for (const kind of FILE_KINDS) {
            const name = `${stem}.${kind}`;
            try {
              const info = await stat(join(out, name));
              if (info.isFile() && info.size) job.files.push({ kind, name, size: info.size, url: `${CONVERSION_PATH}/jobs/${id}/files/${kind}` });
            } catch {}
          }
          if (!job.files.some((file) => file.kind === 's2e')) {
            job.status = 'failed'; job.message = '电子书文件未生成'; job.error = '转换器没有生成完整的 .s2e 文件，请重试';
          } else {
            job.status = 'completed'; job.progress = 100; job.stage = 'complete'; job.message = '电子书已准备好';
          }
        } finally {
          delete job.child;
          await persist().catch(() => {});
          resolveClosed();
        }
      }));
      await persist();
      return publicJob(job);
    } finally { starting = false; startingUploadId = undefined; }
  }

  async function cancel(job) {
    if (job.status === 'running') {
      job.status = 'cancelled'; job.message = '已取消，文件已保留，可重新转换'; job.finishedAt = Date.now();
      job.child?.kill('SIGTERM');
      const timer = setTimeout(() => job.child?.kill('SIGKILL'), 3000);
      try { await Promise.all([job.closed, persist()]); } finally { clearTimeout(timer); }
    }
    if (job.child) await job.closed;
    return publicJob(job);
  }

  async function removeJobs(selected, allUnused = false) {
    if (cleaning) throw problem('正在清理转换记录，请稍后再试', 409);
    if (selected.some((job) => job.status === 'running' || job.child)) throw problem('任务仍在运行或退出中，请稍后再删除', 409);
    cleaning = true;
    try {
      const removing = new Set(selected.map((job) => job.id));
      const selectedUploads = new Set(selected.map((job) => job.upload.id));
      const referenced = new Set([...jobs.values()].filter((job) => !removing.has(job.id)).map((job) => job.upload.id));
      if (startingUploadId) referenced.add(startingUploadId);
      const unused = [...uploads.values()].filter((upload) => (allUnused || selectedUploads.has(upload.id)) && !referenced.has(upload.id));
      let freedBytes = 0;
      for (const job of selected) {
        freedBytes += await directoryBytes(job.out);
        await rm(job.out, { recursive: true, force: true });
        jobs.delete(job.id);
      }
      for (const upload of unused) {
        const root = join(directory, 'uploads', upload.id);
        freedBytes += await directoryBytes(root);
        await rm(root, { recursive: true, force: true });
        uploads.delete(upload.id);
      }
      await persist();
      return { removedJobs: selected.length, removedUploads: unused.length, freedBytes };
    } finally { cleaning = false; }
  }

  return {
    async handle(request, response, pathname) {
      if (pathname !== CONVERSION_PATH && !pathname.startsWith(CONVERSION_PATH + '/')) return false;
      try {
        if (!sameOrigin(request)) throw problem('拒绝跨源访问转换服务', 403);
        const path = pathname.slice(CONVERSION_PATH.length);
        if ((path === '' || path === '/') && request.method === 'GET') {
          if ((await Promise.all([...jobs.values()].map(refreshFiles))).some(Boolean)) await persist();
          json(response, 200, { available: !!converter, maxFileBytes: MAX_PDF_BYTES,
            message: converter ? '转换服务已就绪' : '尚未安装 Python 转换器，请安装后重启本地服务',
            jobs: [...jobs.values()].reverse().map(publicJob) });
        } else if (path === '/uploads' && request.method === 'POST') {
          json(response, 201, await upload(request));
        } else if (path === '/jobs' && request.method === 'POST') {
          json(response, 202, await start(await payload(request)));
        } else if (path === '/cleanup' && request.method === 'POST') {
          await payload(request);
          json(response, 200, await removeJobs([...jobs.values()].filter((job) => job.status !== 'running' && !job.child), true));
        } else if (/^\/uploads\/[^/]+\/pdf$/.test(path) && request.method === 'GET') {
          const upload = uploads.get(path.split('/')[2]);
          if (!upload) throw problem('找不到这份 PDF，请重新选择文件', 404);
          await sendFile(response, upload.file, { 'content-type': 'application/pdf' });
        } else {
          const match = path.match(/^\/jobs\/([^/]+)(?:\/(cancel|files)(?:\/(s2e|json|html))?)?$/);
          const job = match && jobs.get(match[1]);
          if (!job) throw problem('找不到这项转换任务', 404);
          if (!match[2] && request.method === 'GET') {
            if (await refreshFiles(job)) await persist();
            json(response, 200, publicJob(job));
          } else if (!match[2] && request.method === 'DELETE') json(response, 200, await removeJobs([job]));
          else if (match[2] === 'cancel' && request.method === 'POST') {
            await payload(request);
            json(response, 200, await cancel(job));
          } else if (match[2] === 'files' && request.method === 'GET') {
            if (await refreshFiles(job)) await persist();
            const file = job.status === 'completed' && job.files.find((item) => item.kind === match[3]);
            if (!file) throw problem('文件尚未生成或不存在', 404);
            await sendFile(response, join(job.out, file.name), { 'content-type': 'application/octet-stream',
              'content-disposition': `attachment; filename="book.${file.kind}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            });
          } else throw problem('不支持此操作', 405);
        }
      } catch (error) {
        if (!response.headersSent && !response.destroyed) json(response, error.statusCode || 500, { error: error.statusCode ? error.message : '本地转换服务发生错误，请重试' });
      }
      return true;
    },
    async close() { closing = true; await Promise.all([...jobs.values()].map(cancel)); await writing; },
  };
}
