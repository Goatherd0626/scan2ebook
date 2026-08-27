// @ts-check
/** DSH scan2ebook 插件宿主半：RPC、转换任务与阅读器进程管理。 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'scan2ebook'
export const inject = ['tools']

const EVENT_PREFIX = 'S2E_EVENT '
const MAX_LOG_LINES = 200
const DEFAULT_PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DEFAULT_MODEL = 'deepseek-v4-flash-vision-exp'
const DEFAULT_PORT = 8765

/** @param {unknown} value */
function messageOf(value) {
  return value instanceof Error ? value.message : String(value)
}

/** @param {string} cwd @param {string} input */
export function resolveWorkspacePath(cwd, input) {
  const target = resolve(cwd, input)
  const rel = relative(cwd, target)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('路径必须位于当前工作区内')
  }
  return target
}

/**
 * 解析 PDF：工作区相对路径天然允许；绝对路径必须来自系统文件选择器的显式授权。
 * @param {string} cwd @param {string} input @param {Set<string>} selectedPdfs
 */
export function resolveAuthorizedPdf(cwd, input, selectedPdfs) {
  const raw = String(input || '').trim()
  if (raw === '') throw new Error('请先选择 PDF 文件')
  if (isAbsolute(raw)) {
    const canonical = realpathSync(raw)
    if (!selectedPdfs.has(canonical)) throw new Error('该绝对路径尚未通过系统文件选择器授权')
    return canonical
  }
  const workspaceRoot = realpathSync(cwd)
  const target = realpathSync(resolveWorkspacePath(workspaceRoot, raw))
  const rel = relative(workspaceRoot, target)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('PDF 必须位于当前工作区内')
  }
  return target
}

/** @param {number} value */
export function validatePort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('端口必须是 1024–65535 之间的整数')
  }
  return value
}

/** @param {string} root */
function listPdfs(root) {
  const items = []
  const ignored = new Set(['.git', 'node_modules', '.venv', 'dist', 'build', '.cache'])
  const walk = (dir, depth) => {
    if (depth > 5 || items.length >= 300) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (items.length >= 300) return
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.pdf') {
        const info = statSync(full)
        items.push({ path: relative(root, full), name: entry.name, size: info.size })
      }
    }
  }
  walk(root, 0)
  return items.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
}

/** @param {import('node:child_process').ChildProcessWithoutNullStreams} child @param {(line:string)=>void} onLine */
function readLines(child, streamName, onLine) {
  let pending = ''
  child[streamName].setEncoding('utf8')
  child[streamName].on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) if (line !== '') onLine(line)
  })
  child[streamName].on('end', () => {
    if (pending !== '') onLine(pending)
  })
}

/** @param {string} url @param {number} timeoutMs */
async function probe(url, timeoutMs = 500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** @param {import('node:child_process').ChildProcess} child */
async function terminateChild(child) {
  if (child.exitCode !== null || child.killed) return
  child.kill('SIGTERM')
  await new Promise((done) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      done(undefined)
    }, 1500)
    child.once('exit', () => {
      clearTimeout(timer)
      done(undefined)
    })
  })
}

function choosePdfWithSystemDialog() {
  if (process.platform !== 'darwin') throw new Error('当前系统暂不支持原生 PDF 选择器')
  return new Promise((done, reject) => {
    const script = [
      'set pickedFile to choose file with prompt "选择要转换的 PDF" of type {"com.adobe.pdf"}',
      'return POSIX path of pickedFile',
    ]
    const child = spawn('/usr/bin/osascript', script.flatMap((line) => ['-e', line]), {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) return done(stdout.trim())
      if (/user canceled/i.test(stderr)) return done(null)
      reject(new Error(stderr.trim() || `文件选择器退出码 ${code}`))
    })
  })
}

/** 交给系统默认浏览器打开，避免 DSH 将普通链接接管到内置 sidebar。 */
function openInDefaultBrowser(url) {
  if (process.platform !== 'darwin') throw new Error('当前系统暂不支持从插件打开默认浏览器')
  return new Promise((done, reject) => {
    const child = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      done(undefined)
    })
  })
}

/** API Key 必须由当前 sidebar 显式传入，不回退到宿主环境或持久化存储。 */
export function requireApiKey(value) {
  const apiKey = typeof value === 'string' ? value.trim() : ''
  if (apiKey === '') throw new Error('请先填写 API Key')
  return apiKey
}

/** @param {import('@deepseek-ai/cordis').Context} ctx @param {any} config */
export function apply(ctx, config = {}) {
  const projectRoot = resolve(config.projectRoot || DEFAULT_PROJECT_ROOT)
  const python = join(projectRoot, '.venv', 'bin', 'python')
  const defaultModel = String(config.defaultVisionModel || DEFAULT_MODEL)
  const defaultPort = Number(config.defaultPort || DEFAULT_PORT)
  const defaultPrice = Number(config.estimatedPricePerRequest || 0.001)
  const openExternalUrl = config.openExternalUrl || openInDefaultBrowser
  const jobs = new Map()
  const readers = new Map()
  const selectedPdfs = new Set()
  let latestJobId
  let uiRequest = null

  const sessionCwd = (sessionId) => {
    const session = typeof sessionId === 'string' ? ctx.get('sessions')?.get(sessionId) : undefined
    return resolve(session?.header?.cwd || process.cwd())
  }

  const publicJob = (job) => job === undefined ? null : ({
    id: job.id,
    status: job.status,
    pdf: job.pdf,
    outputDir: job.outputDir,
    model: job.model,
    pageStart: job.pageStart,
    pageEnd: job.pageEnd,
    progress: job.progress,
    stage: job.stage,
    message: job.message,
    usage: job.usage,
    estimatedCost: job.estimatedCost,
    logs: job.logs,
    outputs: job.outputs,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })

  const pushLog = (job, line) => {
    job.logs.push(line)
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES)
  }

  const startJob = async (args) => {
    const cwd = sessionCwd(args.sessionId)
    const pdf = resolveAuthorizedPdf(cwd, String(args.pdf || ''), selectedPdfs)
    if (extname(pdf).toLowerCase() !== '.pdf' || !statSync(pdf).isFile()) throw new Error('请选择有效的 PDF 文件')
    // 用户选择的 PDF 本身就是写入授权边界；产物直接落在其同级目录。
    const outputDir = dirname(pdf)
    const pageStart = Number(args.pageStart)
    const pageEnd = Number(args.pageEnd)
    if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageStart > pageEnd) {
      throw new Error('页码范围必须是有效的两端闭区间')
    }
    const model = String(args.model || defaultModel).trim()
    if (model === '') throw new Error('多模态模型不能为空')
    const pricePerRequest = Number.isFinite(Number(args.pricePerRequest)) && Number(args.pricePerRequest) >= 0
      ? Number(args.pricePerRequest) : defaultPrice
    const id = randomUUID()
    const commandArgs = [
      '-m', 'scan2ebook', pdf, '-o', outputDir,
      '--page-start', String(pageStart), '--page-end', String(pageEnd),
      '--vision-model', model, '--progress-json',
    ]
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      DEEPSEEK_API_KEY: requireApiKey(args.apiKey),
    }
    const child = spawn(python, commandArgs, { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const job = {
      id, child, status: 'running', pdf, outputDir, model, pageStart, pageEnd,
      progress: 0, stage: 'start', message: '正在启动转换任务',
      usage: { requests: 0, input_tokens: 0, output_tokens: 0 }, estimatedCost: 0,
      pricePerRequest, logs: [], outputs: null, error: null,
      startedAt: Date.now(), finishedAt: null,
    }
    jobs.set(id, job)
    latestJobId = id
    readLines(child, 'stdout', (line) => {
      if (!line.startsWith(EVENT_PREFIX)) {
        pushLog(job, line)
        return
      }
      try {
        const event = JSON.parse(line.slice(EVENT_PREFIX.length))
        job.stage = event.stage || job.stage
        job.progress = Number.isFinite(event.progress) ? event.progress : job.progress
        job.message = event.message || job.message
        if (event.usage) {
          job.usage = event.usage
          job.estimatedCost = Number((Number(event.usage.requests || 0) * pricePerRequest).toFixed(6))
        }
        if (event.stage === 'complete') {
          job.outputs = { outputDir: event.output_dir, json: event.book_json, html: event.html, s2e: event.s2e }
        }
      } catch {
        pushLog(job, line)
      }
    })
    readLines(child, 'stderr', (line) => pushLog(job, line))
    child.once('error', (error) => {
      job.status = 'failed'
      job.error = messageOf(error)
      job.finishedAt = Date.now()
    })
    child.once('exit', (code, signal) => {
      if (job.status === 'cancelled') return
      job.finishedAt = Date.now()
      if (code === 0) {
        job.status = 'completed'
        job.progress = 100
        job.message = '转换完成'
      } else {
        job.status = 'failed'
        job.error = signal ? `转换进程被 ${signal} 终止` : `转换进程退出码 ${code}`
        job.message = '转换失败'
      }
    })
    return publicJob(job)
  }

  ctx.tools.register({
    name: 'scan2ebook_open',
    description: '当用户要求把扫描版 PDF 转为结构化电子书时，唤起 scan2ebook 图形化转换面板。不要直接在命令行运行转换；先调用本工具让用户确认 PDF、页码、模型、API Key 与费用。',
    parameters: {
      type: 'object',
      properties: {
        pdf: { type: 'string', description: '可选：用户提到的工作区 PDF 相对路径' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      uiRequest = {
        id: randomUUID(),
        at: Date.now(),
        sessionId: exec.agent?.session?.id || exec.agent?.session?.sessionId || null,
        pdf: typeof args?.pdf === 'string' ? args.pdf : null,
      }
      return '已唤起 scan2ebook 面板。请让用户在侧栏中确认页码、模型、API Key 和费用后点击“开始转换”。'
    },
  })

  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (!connection?.rpc) return
    connection.rpc.handle('/scan2ebook', async (endpoint, payload) => {
      try {
        const args = payload?.args || {}
        if (endpoint === 'bootstrap') {
          const cwd = sessionCwd(args.sessionId)
          return { ok: true, value: {
            cwd, pdfs: listPdfs(cwd), defaultModel, defaultPort, defaultPrice,
            latestJob: publicJob(latestJobId ? jobs.get(latestJobId) : undefined),
          } }
        }
        if (endpoint === 'choose-pdf') {
          const chosen = await choosePdfWithSystemDialog()
          if (chosen === null) return { ok: true, value: { cancelled: true } }
          const canonical = realpathSync(chosen)
          if (extname(canonical).toLowerCase() !== '.pdf' || !statSync(canonical).isFile()) throw new Error('请选择有效的 PDF 文件')
          selectedPdfs.add(canonical)
          return { ok: true, value: { cancelled: false, path: canonical, name: canonical.split('/').pop() } }
        }
        if (endpoint === 'inspect') {
          const cwd = sessionCwd(args.sessionId)
          const pdf = resolveAuthorizedPdf(cwd, String(args.pdf || ''), selectedPdfs)
          const result = await new Promise((done, reject) => {
            const child = spawn(python, ['-m', 'scan2ebook', 'inspect', pdf], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
            let stdout = ''
            let stderr = ''
            child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
            child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
            child.once('error', reject)
            child.once('exit', (code) => code === 0 ? done(JSON.parse(stdout)) : reject(new Error(stderr || stdout || `inspect 退出码 ${code}`)))
          })
          return { ok: true, value: result }
        }
        if (endpoint === 'start') return { ok: true, value: await startJob(args) }
        if (endpoint === 'status') {
          const job = jobs.get(String(args.jobId || latestJobId || ''))
          return { ok: true, value: publicJob(job) }
        }
        if (endpoint === 'cancel') {
          const job = jobs.get(String(args.jobId || latestJobId || ''))
          if (!job) throw new Error('找不到转换任务')
          if (job.status === 'running') {
            job.status = 'cancelled'
            job.message = '正在取消'
            await terminateChild(job.child)
            job.finishedAt = Date.now()
            job.message = '已取消'
          }
          return { ok: true, value: publicJob(job) }
        }
        if (endpoint === 'ui-request') {
          const after = String(args.after || '')
          return { ok: true, value: uiRequest && uiRequest.id !== after ? uiRequest : null }
        }
        if (endpoint === 'reader-start') {
          const port = validatePort(Number(args.port || defaultPort))
          const url = `http://127.0.0.1:${port}`
          const known = readers.get(port)
          if (known?.child?.exitCode === null) return { ok: true, value: { running: true, managed: true, port, url } }
          if (await probe(url)) return { ok: true, value: { running: true, managed: false, port, url } }
          const child = spawn(python, ['-m', 'scan2ebook.reader', '--host', '127.0.0.1', '--port', String(port), '--no-browser'], {
            cwd: projectRoot, stdio: ['ignore', 'ignore', 'pipe'],
          })
          const record = { child, port, url, error: null }
          readers.set(port, record)
          child.stderr.setEncoding('utf8').on('data', (chunk) => { record.error = String(chunk).trim() })
          child.once('exit', () => {})
          for (let index = 0; index < 25 && !await probe(url); index += 1) {
            await new Promise((done) => setTimeout(done, 120))
          }
          if (!await probe(url)) {
            await terminateChild(child)
            readers.delete(port)
            throw new Error(record.error || `阅读器未能在端口 ${port} 启动`)
          }
          return { ok: true, value: { running: true, managed: true, port, url } }
        }
        if (endpoint === 'reader-status') {
          const port = validatePort(Number(args.port || defaultPort))
          const url = `http://127.0.0.1:${port}`
          const record = readers.get(port)
          return { ok: true, value: { running: await probe(url), managed: record?.child?.exitCode === null, port, url } }
        }
        if (endpoint === 'reader-open') {
          const port = validatePort(Number(args.port || defaultPort))
          const url = `http://127.0.0.1:${port}`
          if (!await probe(url)) throw new Error(`端口 ${port} 上没有正在运行的阅读器`)
          await openExternalUrl(url)
          return { ok: true, value: { opened: true, port, url } }
        }
        if (endpoint === 'reader-stop') {
          const port = validatePort(Number(args.port || defaultPort))
          const record = readers.get(port)
          if (!record || record.child.exitCode !== null) throw new Error('该端口的服务不是由本插件启动，不能安全终止')
          await terminateChild(record.child)
          readers.delete(port)
          return { ok: true, value: { running: false, managed: false, port, url: record.url } }
        }
        return { ok: false, error: { code: 'BAD_ENDPOINT', message: `未知 scan2ebook 端点：${String(endpoint)}` } }
      } catch (error) {
        return { ok: false, error: { code: 'ERROR', message: messageOf(error) } }
      }
    }, {})
  })

  ctx.effect(() => () => {
    for (const job of jobs.values()) if (job.status === 'running') terminateChild(job.child)
    for (const reader of readers.values()) terminateChild(reader.child)
  }, 'scan2ebook: terminate managed child processes')
}
