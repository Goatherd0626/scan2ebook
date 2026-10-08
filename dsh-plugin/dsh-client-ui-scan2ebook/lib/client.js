// dsh-client-ui-scan2ebook 浏览器半：注册到 DSH Desktop 原生右栏（@deepseek-ai/dsh-client-ui-sidebar-right）。
window.__ModuleLoader__.load({
  id: 'dsh-client-ui-scan2ebook',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    const STYLE_ID = 'dsh-scan2ebook-style'
    const REQUEST_KEY = 'dsh-scan2ebook-last-ui-request'
    const PORT_KEY = 'dsh-scan2ebook-reader-port'
    // 右栏 tab 的身份：类型注册与正文注册共用同一个 id。
    const TAB_ID = 'dsh-client-ui-scan2ebook'
    const TAB_KIND = 'scan2ebook'
    const SLOTS_SERVICE = 'slots'
    const TABS_SERVICE = 'sidebarRightTabs'
    const SIDEBAR_SERVICE = 'sidebarRight'
    // 需要的浏览器侧服务：slot 注册表、右栏 tab 注册表与右栏导航控制器。
    const inject = [SLOTS_SERVICE, TABS_SERVICE, SIDEBAR_SERVICE]
    const TAB_SLOT = 'sidebar.right.pane.tab'
    // 插件端点：宿主半用官方精确 Fetch 路由注册在 /api 桥下。
    const RPC_PATH = '/api/scan2ebook'
    const bookIcon = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5h7a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z"/><path d="M5 4.5h5M5 7h5M5 9.5h3"/><path d="M12 5h1.2a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H12"/></svg>'
    const readerIcon = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="9" rx="1.4"/><path d="M5 13.5h6M8 11.5v2"/><path d="M5 5h6M5 7.5h4"/></svg>'

    function installStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'scan2ebook'
      style.textContent = `
        .s2e-side{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:14px 14px 28px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family,system-ui);font-size:12.5px;line-height:1.5;-webkit-font-smoothing:antialiased}
        .s2e-side *{box-sizing:border-box}
        .s2e-side-head{display:flex;align-items:center;gap:10px;margin:2px 0 16px}
        .s2e-side-head>span:first-child{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;flex:none;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
        .s2e-side-head h2{margin:0;font-size:14.5px;font-weight:650;letter-spacing:-.01em}
        .s2e-side-head p{margin:2px 0 0;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
        .s2e-section{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}
        .s2e-section-title{display:flex;align-items:center;gap:6px;padding:0 2px}
        .s2e-section-title h3{margin:0;font-size:11.5px;font-weight:600;letter-spacing:.03em;color:var(--dsw-alias-label-secondary)}
        .s2e-section-title span{display:inline-flex;color:var(--dsw-alias-label-tertiary)}
        .s2e-card{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
        .s2e-card>h3{margin:0;font-size:12px;font-weight:600;letter-spacing:0;color:var(--dsw-alias-label-primary)}
        .s2e-field{display:flex;flex-direction:column;gap:5px}
        .s2e-field label{font-size:11.5px;font-weight:500;color:var(--dsw-alias-label-secondary)}
        .s2e-input{width:100%;height:32px;padding:0 10px;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;transition:border-color .12s ease,box-shadow .12s ease}
        .s2e-input:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
        .s2e-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
        .s2e-input::placeholder{color:var(--dsw-alias-label-tertiary)}
        .s2e-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .s2e-file{display:flex;flex-direction:column;gap:2px;padding:10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
        .s2e-file-name{font-size:12.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
        .s2e-file-path{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
        .s2e-empty{display:flex;flex-direction:column;align-items:center;gap:7px;padding:18px 8px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
        .s2e-empty .sf-mark{opacity:.4}
        .s2e-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .s2e-button,.s2e-link-button{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 12px;font:inherit;font-size:12.5px;font-weight:550;border-radius:9px;cursor:pointer;text-decoration:none;transition:background .12s ease,color .12s ease,border-color .12s ease,transform .06s ease}
        .s2e-button:active{transform:translateY(.5px)}
        .s2e-primary{border:1px solid transparent;color:#fff;background:var(--dsw-alias-brand-primary)}
        .s2e-primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 86%,#000)}
        .s2e-secondary{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
        .s2e-secondary:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .s2e-danger{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,transparent);color:var(--dsw-alias-state-error-primary);background:transparent}
        .s2e-danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
        .s2e-button:disabled{opacity:.42;cursor:default;transform:none}
        .s2e-block{width:100%}
        .s2e-estimate{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
        .s2e-estimate b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
        .s2e-progress-track{height:6px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
        .s2e-progress-bar{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary),color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,#7c5cff));transition:width .25s ease}
        .s2e-progress-meta{display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
        .s2e-progress-meta span+span{font-size:11px;color:var(--dsw-alias-label-secondary)}
        .s2e-log{margin:0;padding:9px 10px;max-height:132px;overflow:auto;white-space:pre-wrap;word-break:break-word;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
        .s2e-hint{margin:0;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
        .s2e-error{color:var(--dsw-alias-state-error-primary)}
        .s2e-ok{color:var(--dsw-alias-state-success-primary)}
        .s2e-error-card{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,var(--dsw-alias-bg-layer-1))}
        .s2e-error-card>h3{color:var(--dsw-alias-state-error-primary)}
        .s2e-reader-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:14px}
        .s2e-port{width:96px;text-align:center;font-variant-numeric:tabular-nums}
        .s2e-side button.s2e-reader-url{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1)!important;border-radius:9px!important;background:var(--dsw-alias-bg-layer-2)!important;color:var(--dsw-alias-label-primary)!important;font:inherit;font-size:12px;text-align:left;cursor:pointer;transition:background .12s ease}
        .s2e-side button.s2e-reader-url:hover{background:var(--dsw-alias-interactive-bg-hover)!important}
        .s2e-reader-url-label{font-weight:550}
        .s2e-reader-url-value{color:var(--dsw-alias-brand-primary);font-size:11.5px;overflow-wrap:anywhere;text-align:right}
        .s2e-input:disabled{opacity:.55;cursor:default}
        @media(max-width:380px){.s2e-row{grid-template-columns:1fr}}
        @media(prefers-reduced-motion:reduce){.s2e-side *{transition:none!important}}

      `
      document.head.appendChild(style)
    }

    async function rpc(endpoint, args, { timeoutMs = 20000 } = {}) {
      try {
        const response = await fetch(RPC_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, args: args || {} }), signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined })
        const body = await response.json().catch(() => ({}))
        if (body.ok) return body.value
        throw new Error(body.error?.message || `scan2ebook/${endpoint} HTTP ${response.status}`)
      } catch (error) {
        // DSH 后端已退出时，即使浏览器页面暂未关闭，也立即清除临时 Key。
        window.dispatchEvent(new Event('scan2ebook:host-unavailable'))
        const timedOut = error?.name === 'TimeoutError'
        throw new Error(timedOut
          ? `请求 scan2ebook/${endpoint} 超时（${Math.round(timeoutMs / 1000)} 秒无响应）：插件宿主半可能未加载，请完全退出并重新启动 DSH`
          : String(error?.message || error))
      }
    }

    function formatCost(value) { const cost = Number(value || 0); return cost === 0 ? '¥0.000' : cost < 0.01 ? `¥${cost.toFixed(4)}` : `¥${cost.toFixed(3)}` }
    function conversionIntent(text) { const value = String(text || '').trim(); return /scan2ebook/i.test(value) || (/(扫描版?(?:书|书籍|pdf)|扫描书|pdf)/i.test(value) && /(电子书|ebook|结构化(?:输出|电子书)?)/i.test(value) && /(转换|转成|制作|生成|识别|整理|结构化)/i.test(value)) }
    function composerText(target) { const card = target?.closest?.('[data-composer-card]'); if (!card) return ''; const input = card.querySelector('textarea,[contenteditable="true"]'); return input?.value || input?.innerText || input?.textContent || '' }
    function Header({ icon, title, subtitle }) { return h('div', { className: 's2e-side-head' }, h('span', { dangerouslySetInnerHTML: { __html: icon } }), h('div', null, h('h2', null, title), h('p', null, subtitle))) }

    function ConversionView({ sessionId }) {
      const [pdf, setPdf] = useState(null), [pageStart, setPageStart] = useState(1), [pageEnd, setPageEnd] = useState(1)
      const [model, setModel] = useState('deepseek-flash'), [apiKey, setApiKey] = useState(''), [price, setPrice] = useState(0.001)
      const [job, setJob] = useState(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('请选择一本 PDF。'), [failed, setFailed] = useState(false)
      useEffect(() => { let alive = true; rpc('bootstrap', { sessionId }).then((value) => { if (!alive) return; setModel(value.defaultModel); setPrice(value.defaultPrice); if (value.latestJob) setJob(value.latestJob) }).catch((error) => { if (alive) { setFeedback(error.message); setFailed(true) } }); return () => { alive = false } }, [sessionId])
      // 关闭 tab（组件卸载）或页面隐藏时立即丢弃内存中的临时 Key。
      useEffect(() => () => setApiKey(''), [])
      useEffect(() => { const clearApiKey = () => setApiKey(''); window.addEventListener('pagehide', clearApiKey); window.addEventListener('scan2ebook:host-unavailable', clearApiKey); return () => { window.removeEventListener('pagehide', clearApiKey); window.removeEventListener('scan2ebook:host-unavailable', clearApiKey) } }, [])
      useEffect(() => { if (!job?.id || job.status !== 'running') return; const timer = setInterval(() => rpc('status', { jobId: job.id }).then(setJob).catch(() => {}), 650); return () => clearInterval(timer) }, [job?.id, job?.status])
      useEffect(() => { if (job?.status === 'completed') { setFeedback(`转换完成，文件已写入：${job.outputDir}`); setFailed(false) } else if (job?.status === 'failed') { setFeedback(job.error || '转换失败'); setFailed(true) } else if (job?.status === 'cancelled') { setFeedback('转换已取消'); setFailed(false) } }, [job?.status])
      const choosePdf = useCallback(async () => { setBusy(true); setFailed(false); setFeedback('请在系统窗口中选择 PDF…'); try { const chosen = await rpc('choose-pdf', { sessionId }); if (chosen.cancelled) { setFeedback('已取消选择。'); return } const info = await rpc('inspect', { sessionId, pdf: chosen.path }); setPdf({ path: chosen.path, name: chosen.name, pages: info.pages }); setPageStart(1); setPageEnd(info.pages); setFeedback(`已选择 ${chosen.name}；输出将直接写到该 PDF 的同级目录。`) } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [sessionId])
      const start = useCallback(async () => { if (!pdf) return; setBusy(true); setFailed(false); setFeedback('正在启动转换…'); try { const next = await rpc('start', { sessionId, pdf: pdf.path, pageStart: Number(pageStart), pageEnd: Number(pageEnd), model, apiKey, pricePerRequest: Number(price) }); setJob(next); setFeedback('转换已开始；切换 Tab 或继续聊天都不会中断任务。') } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [sessionId, pdf, pageStart, pageEnd, model, apiKey, price])
      const cancel = useCallback(async () => { if (!job?.id) return; try { setJob(await rpc('cancel', { jobId: job.id })) } catch (error) { setFeedback(error.message); setFailed(true) } }, [job?.id])
      const pages = pdf && Number(pageEnd) >= Number(pageStart) ? Number(pageEnd) - Number(pageStart) + 1 : 0, progress = Math.max(0, Math.min(100, Number(job?.progress || 0))), usage = job?.usage || {}, tokenCount = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)
      return h('div', { className: 's2e-section' }, h('div', { className: 's2e-section-title' }, h('span', { dangerouslySetInnerHTML: { __html: bookIcon } }), h('h3', null, '电子书转换')),
        h('section', { className: 's2e-card' }, h('h3', null, '模型与 API Key'), h('div', { className: 's2e-field' }, h('label', null, '多模态模型'), h('input', { className: 's2e-input', value: model, onChange: (e) => setModel(e.target.value) })), h('div', { className: 's2e-field' }, h('label', null, 'API Key'), h('input', { className: 's2e-input', type: 'password', autoComplete: 'off', spellCheck: false, placeholder: '只在当前 panel 内存中保留', value: apiKey, onChange: (e) => setApiKey(e.target.value) })), h('p', { className: 's2e-hint' }, 'API Key 不会写入钥匙串、.env、localStorage 或日志；关闭右栏或 DSH 后自动清除。')),
        h('section', { className: 's2e-card' }, h('h3', null, 'PDF 文件'), pdf ? h('div', { className: 's2e-file' }, h('div', { className: 's2e-file-name' }, `${pdf.name} · ${pdf.pages} 页`), h('div', { className: 's2e-file-path' }, pdf.path)) : h('div', { className: 's2e-empty' }, h('span', { className: 'sf-mark', dangerouslySetInnerHTML: { __html: bookIcon } }), '尚未选择 PDF'), h('div', { className: 's2e-actions' }, h('button', { className: 's2e-button s2e-secondary', disabled: busy || job?.status === 'running', onClick: choosePdf }, pdf ? '重新选择 PDF' : '选择 PDF')), h('p', { className: 's2e-hint' }, '可选择任意目录；结构化 JSON、HTML 和 .s2e 直接写在所选 PDF 的同级目录。', h('p', { className: 's2e-hint' }, '请确认你对所选 PDF 拥有合法处理权；转换会把页面图像与文字发送给你配置的模型服务。'))),
        pdf && h('section', { className: 's2e-card' }, h('h3', null, '转换设置'), h('div', { className: 's2e-row' }, h('div', { className: 's2e-field' }, h('label', null, '起始页（闭区间）'), h('input', { className: 's2e-input', type: 'number', min: 1, max: pdf.pages, value: pageStart, onChange: (e) => setPageStart(e.target.value) })), h('div', { className: 's2e-field' }, h('label', null, '结束页（闭区间）'), h('input', { className: 's2e-input', type: 'number', min: 1, max: pdf.pages, value: pageEnd, onChange: (e) => setPageEnd(e.target.value) }))), h('div', { className: 's2e-field' }, h('label', null, '估算单价（元/视觉请求）'), h('input', { className: 's2e-input', type: 'number', min: 0, step: 0.0001, value: price, onChange: (e) => setPrice(e.target.value) })), h('div', { className: 's2e-estimate' }, h('span', null, `${pages} 页，空白页跳过、重试另计`), h('b', null, formatCost(pages * Number(price || 0)))), h('div', { className: 's2e-actions', style: { marginTop: '10px' } }, h('button', { className: 's2e-button s2e-primary s2e-block', disabled: busy || job?.status === 'running' || pages < 1 || apiKey.trim() === '', onClick: start }, '开始转换'))),
        h('section', { className: 's2e-card' }, h('h3', null, '进度与计费'), h('div', { className: 's2e-progress-track' }, h('div', { className: 's2e-progress-bar', style: { width: `${progress}%` } })), h('div', { className: 's2e-progress-meta' }, h('span', null, job?.message || '尚未开始'), h('span', null, `${progress.toFixed(0)}% · ${Number(usage.requests || 0)} 次${tokenCount ? ` · ${tokenCount} tokens` : ''} · ${formatCost(job?.estimatedCost)}`)), h('pre', { className: 's2e-log' }, (job?.logs || []).slice(-25).join('\n') || '等待任务输出…'), job?.status === 'running' && h('div', { className: 's2e-actions', style: { marginTop: '9px' } }, h('button', { className: 's2e-button s2e-danger', onClick: cancel }, '取消转换'))), h('p', { className: `s2e-hint ${failed ? 's2e-error' : ''}` }, feedback))
    }

    function ReaderView() {
      const [port, setPort] = useState(Number(localStorage.getItem(PORT_KEY) || 8765)), [editing, setEditing] = useState(false), [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('正在检查阅读器状态…'), [failed, setFailed] = useState(false)
      const portRef = useRef(null)
      const refresh = useCallback(async (value = port) => { setFailed(false); try { const next = await rpc('reader-status', { port: Number(value) }); setStatus(next); if (next.occupied) { setFeedback('该端口已被其他程序占用，不是 scan2ebook 阅读器。'); setFailed(true) } else setFeedback(next.running ? (next.managed ? `阅读器正在运行（reader v${next.version || '?'}），由本插件管理。` : `检测到独立运行的 scan2ebook 阅读器（v${next.version || '?'}）；可以打开，但插件不会终止它。`) : '阅读器未运行。') } catch (error) { setFeedback(error.message); setFailed(true) } }, [port])
      useEffect(() => { refresh() }, [])
      // 单一开关：未运行时启动；运行中且由本插件管理时停止。
      const toggle = useCallback(async () => {
        if (busy) return
        const running = !!status?.running
        setBusy(true); setFailed(false)
        try {
          if (running && status?.managed) {
            setFeedback('正在停止阅读器…')
            const next = await rpc('reader-stop', { port: Number(port) })
            setStatus(next); setFeedback('阅读器已停止。')
          } else {
            setFeedback('正在启动阅读器…')
            const next = await rpc('reader-start', { port: Number(port) })
            setStatus(next); setFeedback(next?.reused ? `该端口上已有阅读器在运行（v${next?.version || '?'}）。` : `阅读器已启动（reader v${next?.version || '?'}）。`)
          }
        } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) }
      }, [busy, status, port])
      const open = useCallback(async () => { setBusy(true); setFailed(false); try { await rpc('reader-open', { port: Number(port) }); setFeedback('已在系统默认浏览器中打开阅读器。') } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [port])
      const finishPortEdit = () => { setEditing(false); localStorage.setItem(PORT_KEY, String(port)); refresh(port) }
      const running = !!status?.running
      const external = running && !status?.managed
      const canToggle = !busy && !status?.occupied && !external
      const toggleLabel = busy ? (running ? '正在停止…' : '正在启动…') : (running ? '停止阅读器' : '启动阅读器')
      return h('div', { className: 's2e-section s2e-reader-section' },
        h('div', { className: 's2e-section-title' }, h('span', { dangerouslySetInnerHTML: { __html: readerIcon } }), h('h3', null, '网页阅读器')),
        h('section', { className: 's2e-card' }, h('h3', null, '服务端口'),
          h('div', { className: 's2e-actions' },
            h('input', { ref: portRef, className: 's2e-input s2e-port', type: 'number', min: 1024, max: 65535, readOnly: !editing, disabled: running, title: '双击修改端口', value: port, onDoubleClick: () => { if (running) return; setEditing(true); setTimeout(() => portRef.current?.select(), 0) }, onChange: (e) => setPort(e.target.value), onBlur: finishPortEdit, onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() } }),
            h('button', { className: `s2e-button ${running ? 's2e-danger' : 's2e-primary'}`, disabled: !canToggle, title: external ? '该阅读器不是由本插件启动，不能在此停止' : '', onClick: toggle }, toggleLabel),
          ),
          running && h('button', { className: 's2e-reader-url', disabled: busy, onClick: open, title: '在系统默认浏览器中打开' },
            h('span', { className: 's2e-reader-url-label' }, '在浏览器中打开'),
            h('span', { className: 's2e-reader-url-value' }, status.url),
          ),
          h('p', { className: 's2e-hint' }, running
            ? '点上面的地址行可在系统默认浏览器中打开阅读器；它不占用 DSH 右栏。'
            : '双击端口数字可修改。启动后的阅读器由本插件管理，可随时停止。'),
        ),
        h('p', { className: `s2e-hint ${failed ? 's2e-error' : running ? 's2e-ok' : ''}` }, feedback))
    }

    /** 右栏 tab 正文：官方 sidebar.right.pane.tab 席位，props 由框架注入（含会话标准工具包）。 */
    function Scan2EbookTab(props) {
      const sessionId = props?.sessionId ?? props?.session?.id
      const [hostError, setHostError] = useState('')
      useEffect(() => {
        let alive = true
        setHostError('')
        rpc('bootstrap', { sessionId })
          .then(() => { if (alive) setHostError('') })
          .catch((error) => { if (alive) setHostError(String(error?.message || error)) })
        return () => { alive = false }
      }, [sessionId])
      return h('div', { className: 's2e-side' },
        h(Header, { icon: bookIcon, title: 'Scan2Ebook', subtitle: '转换与阅读器集中在右栏，不影响正常聊天。' }),
        hostError !== '' && h('section', { className: 's2e-card s2e-error-card' },
          h('h3', { className: 's2e-error' }, '无法连接 DSH 宿主'),
          h('p', { className: 's2e-hint' }, hostError),
          h('p', { className: 's2e-hint' }, '这通常说明插件的宿主半没有加载（刚安装/刚改过代码时需要完全重启 DSH）。转换与阅读器按钮在恢复连接前都不会生效。'),
        ),
        h(ConversionView, { sessionId }),
        h(ReaderView),
      )
    }

    function apply(ctx) {
      installStyle()
      const tabs = ctx.get(TABS_SERVICE) ?? ctx[TABS_SERVICE]
      const sidebar = ctx.get(SIDEBAR_SERVICE) ?? ctx[SIDEBAR_SERVICE]
      if (!tabs || !sidebar) return
      const openTab = () => sidebar.openTab(TAB_KIND)
      ctx.effect(() => tabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => 'Scan2Ebook',
        guide: [{
          id: TAB_KIND,
          order: 140,
          title: () => 'Scan2Ebook',
          description: () => '把扫描版 PDF 转成结构化电子书，并启动网页阅读器。',
        }],
      }), 'scan2ebook: right-sidebar tab type')
      ctx.slots.inject(TAB_SLOT, () => ctx.slots.register({ name: TAB_SLOT, key: TAB_ID }, Scan2EbookTab))
      const disposers = []
      let lastIntent = ''
      const maybeOpen = (event) => { const text = composerText(event.target); if (!conversionIntent(text) || text === lastIntent) return; if (event.type === 'keydown' && (event.key !== 'Enter' || event.shiftKey || event.isComposing)) return; if (event.type === 'click' && !event.target?.closest?.('button')) return; lastIntent = text; setTimeout(openTab, 0) }
      document.addEventListener('keydown', maybeOpen, true); document.addEventListener('click', maybeOpen, true)
      disposers.push(() => document.removeEventListener('keydown', maybeOpen, true), () => document.removeEventListener('click', maybeOpen, true))
      let lastRequest = localStorage.getItem(REQUEST_KEY) || ''
      const pollRequest = async () => { try { const request = await rpc('ui-request', { after: lastRequest }); if (!request) return; lastRequest = request.id; localStorage.setItem(REQUEST_KEY, request.id); openTab() } catch {} }
      const timer = setInterval(pollRequest, 1200); pollRequest(); disposers.push(() => clearInterval(timer))
      const explicitOpen = () => openTab(); document.addEventListener('scan2ebook:open', explicitOpen); disposers.push(() => document.removeEventListener('scan2ebook:open', explicitOpen))
      ctx.effect(() => () => { for (const dispose of disposers.splice(0)) dispose?.() }, 'scan2ebook: right-sidebar open paths')
    }

    return { inject, apply, testHooks: { conversionIntent, tabKind: TAB_KIND, tabId: TAB_ID, validatePort: (port) => Number.isInteger(port) && port >= 1024 && port <= 65535 } }
  },
})
