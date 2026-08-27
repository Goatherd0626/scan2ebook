// dsh-client-ui-scan2ebook 浏览器半：一个非阻塞 dsh-better-sidebar 工具栏。
window.__ModuleLoader__.load({
  id: 'dsh-client-ui-scan2ebook',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    const STYLE_ID = 'dsh-scan2ebook-style'
    const REQUEST_KEY = 'dsh-scan2ebook-last-ui-request'
    const PORT_KEY = 'dsh-scan2ebook-reader-port'
    const SIDEBAR_TAB = 'scan2ebook:tools'
    const bookIcon = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5h7a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z"/><path d="M5 4.5h5M5 7h5M5 9.5h3"/><path d="M12 5h1.2a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H12"/></svg>'
    const readerIcon = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="9" rx="1.4"/><path d="M5 13.5h6M8 11.5v2"/><path d="M5 5h6M5 7.5h4"/></svg>'

    function installStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'scan2ebook'
      style.textContent = `
        .s2e-entry{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:transparent;border:0;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 10px;font-size:13px}.s2e-entry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.s2e-entry-icon{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;flex:none}.s2e-entry-label{overflow:hidden;text-overflow:ellipsis}
        [data-dsh-frame][data-sidebar-collapsed] .s2e-entry,[data-sidebar-collapsed] .s2e-entry{border-radius:50%;justify-content:center;width:36px;height:36px;margin:0 auto 12px;padding:0}[data-dsh-frame][data-sidebar-collapsed] .s2e-entry-label,[data-sidebar-collapsed] .s2e-entry-label{display:none}
        .s2e-side{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family,system-ui)}.s2e-side-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}.s2e-side-head h2{font-size:15px;margin:0}.s2e-side-head p{margin:2px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}.s2e-section-title{display:flex;align-items:center;gap:7px;margin:4px 0 9px}.s2e-section-title h3{font-size:13px;margin:0}.s2e-reader-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px;margin-top:4px}
        .s2e-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}.s2e-card h3{font-size:12px;margin:0 0 10px}.s2e-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}.s2e-field label{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}.s2e-input{box-sizing:border-box;width:100%;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base));color:inherit;padding:0 9px;font:inherit;font-size:12px}.s2e-input:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent);border-color:var(--dsw-alias-brand-primary)}.s2e-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.s2e-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.s2e-error{color:var(--dsw-alias-state-error-primary)}.s2e-ok{color:var(--dsw-alias-state-success-primary)}
        .s2e-file{padding:9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);margin-bottom:10px}.s2e-file-name{font-size:12px;font-weight:600;overflow-wrap:anywhere}.s2e-file-path{font-size:10px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin-top:3px}.s2e-actions{display:flex;gap:7px;flex-wrap:wrap}.s2e-button,.s2e-link-button{box-sizing:border-box;min-height:32px;border-radius:8px;padding:5px 11px;font:inherit;font-size:12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.s2e-primary{border:0;background:var(--dsw-alias-button-info-fill,#4d6bfe);color:#fff;font-weight:600}.s2e-secondary{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}.s2e-danger{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:transparent;color:var(--dsw-alias-state-error-primary)}.s2e-button:disabled{opacity:.45;cursor:default}.s2e-url-button{display:block;border:0;background:transparent;padding:0;text-align:left;cursor:pointer}
        .s2e-estimate{display:flex;justify-content:space-between;gap:8px;padding:8px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:11px;margin-top:8px}.s2e-estimate b{font-variant-numeric:tabular-nums}.s2e-progress-track{height:9px;overflow:hidden;border-radius:99px;background:var(--dsw-alias-bg-layer-2)}.s2e-progress-bar{height:100%;background:linear-gradient(90deg,#4d6bfe,#7c5cff);transition:width .2s}.s2e-progress-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:11px}.s2e-log{box-sizing:border-box;max-height:130px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:9px 0 0;padding:8px;border-radius:8px;background:var(--dsw-alias-markdown-code-block,#111827);color:#d9e1ef;font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.s2e-port{width:94px;text-align:center}.s2e-reader-url{display:block;margin-top:8px;color:var(--dsw-alias-brand-primary);font-size:12px;overflow-wrap:anywhere}.s2e-empty{text-align:center;padding:20px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px}
        @media(max-width:380px){.s2e-row{grid-template-columns:1fr}}
      `
      document.head.appendChild(style)
    }

    async function rpc(endpoint, args) {
      try {
        const response = await fetch(`/scan2ebook/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args: args || {} } }) })
        const body = await response.json().catch(() => ({}))
        if (body.result?.ok) return body.result.value
        throw new Error(body.result?.error?.message || `scan2ebook/${endpoint} HTTP ${response.status}`)
      } catch (error) {
        // DSH 后端已退出时，即使浏览器页面暂未关闭，也立即清除临时 Key。
        window.dispatchEvent(new Event('scan2ebook:host-unavailable'))
        throw error
      }
    }

    function formatCost(value) { const cost = Number(value || 0); return cost === 0 ? '¥0.000' : cost < 0.01 ? `¥${cost.toFixed(4)}` : `¥${cost.toFixed(3)}` }
    function conversionIntent(text) { const value = String(text || '').trim(); return /scan2ebook/i.test(value) || (/(扫描版?(?:书|书籍|pdf)|扫描书|pdf)/i.test(value) && /(电子书|ebook|结构化(?:输出|电子书)?)/i.test(value) && /(转换|转成|制作|生成|识别|整理|结构化)/i.test(value)) }
    function composerText(target) { const card = target?.closest?.('[data-composer-card]'); if (!card) return ''; const input = card.querySelector('textarea,[contenteditable="true"]'); return input?.value || input?.innerText || input?.textContent || '' }
    function Header({ icon, title, subtitle }) { return h('div', { className: 's2e-side-head' }, h('span', { dangerouslySetInnerHTML: { __html: icon } }), h('div', null, h('h2', null, title), h('p', null, subtitle))) }

    function ConversionView({ scope, visible }) {
      const sessionId = scope?.sessionId
      const [pdf, setPdf] = useState(null), [pageStart, setPageStart] = useState(1), [pageEnd, setPageEnd] = useState(1)
      const [model, setModel] = useState('deepseek-v4-flash-vision-exp'), [apiKey, setApiKey] = useState(''), [price, setPrice] = useState(0.001)
      const [job, setJob] = useState(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('请选择一本 PDF。'), [failed, setFailed] = useState(false)
      useEffect(() => { let alive = true; rpc('bootstrap', { sessionId }).then((value) => { if (!alive) return; setModel(value.defaultModel); setPrice(value.defaultPrice); if (value.latestJob) setJob(value.latestJob) }).catch((error) => { if (alive) { setFeedback(error.message); setFailed(true) } }); return () => { alive = false } }, [sessionId])
      useEffect(() => { if (!visible) setApiKey('') }, [visible])
      useEffect(() => { const clearApiKey = () => setApiKey(''); window.addEventListener('pagehide', clearApiKey); window.addEventListener('scan2ebook:host-unavailable', clearApiKey); return () => { window.removeEventListener('pagehide', clearApiKey); window.removeEventListener('scan2ebook:host-unavailable', clearApiKey) } }, [])
      useEffect(() => { if (!job?.id || job.status !== 'running') return; const timer = setInterval(() => rpc('status', { jobId: job.id }).then(setJob).catch(() => {}), 650); return () => clearInterval(timer) }, [job?.id, job?.status])
      useEffect(() => { if (job?.status === 'completed') { setFeedback(`转换完成，文件已写入：${job.outputDir}`); setFailed(false) } else if (job?.status === 'failed') { setFeedback(job.error || '转换失败'); setFailed(true) } else if (job?.status === 'cancelled') { setFeedback('转换已取消'); setFailed(false) } }, [job?.status])
      const choosePdf = useCallback(async () => { setBusy(true); setFailed(false); setFeedback('请在系统窗口中选择 PDF…'); try { const chosen = await rpc('choose-pdf', { sessionId }); if (chosen.cancelled) { setFeedback('已取消选择。'); return } const info = await rpc('inspect', { sessionId, pdf: chosen.path }); setPdf({ path: chosen.path, name: chosen.name, pages: info.pages }); setPageStart(1); setPageEnd(info.pages); setFeedback(`已选择 ${chosen.name}；输出将直接写到该 PDF 的同级目录。`) } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [sessionId])
      const start = useCallback(async () => { if (!pdf) return; setBusy(true); setFailed(false); setFeedback('正在启动转换…'); try { const next = await rpc('start', { sessionId, pdf: pdf.path, pageStart: Number(pageStart), pageEnd: Number(pageEnd), model, apiKey, pricePerRequest: Number(price) }); setJob(next); setFeedback('转换已开始；切换 Tab 或继续聊天都不会中断任务。') } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [sessionId, pdf, pageStart, pageEnd, model, apiKey, price])
      const cancel = useCallback(async () => { if (!job?.id) return; try { setJob(await rpc('cancel', { jobId: job.id })) } catch (error) { setFeedback(error.message); setFailed(true) } }, [job?.id])
      const pages = pdf && Number(pageEnd) >= Number(pageStart) ? Number(pageEnd) - Number(pageStart) + 1 : 0, progress = Math.max(0, Math.min(100, Number(job?.progress || 0))), usage = job?.usage || {}, tokenCount = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)
      return h('div', { className: 's2e-section' }, h('div', { className: 's2e-section-title' }, h('span', { dangerouslySetInnerHTML: { __html: bookIcon } }), h('h3', null, '电子书转换')),
        h('section', { className: 's2e-card' }, h('h3', null, '模型与 API Key'), h('div', { className: 's2e-field' }, h('label', null, '多模态模型'), h('input', { className: 's2e-input', value: model, onChange: (e) => setModel(e.target.value) })), h('div', { className: 's2e-field' }, h('label', null, 'API Key'), h('input', { className: 's2e-input', type: 'password', autoComplete: 'off', spellCheck: false, placeholder: '只在当前 sidebar 内存中保留', value: apiKey, onChange: (e) => setApiKey(e.target.value) })), h('p', { className: 's2e-hint' }, 'API Key 不会写入钥匙串、.env、localStorage 或日志；关闭 sidebar 或 DSH 后自动清除。')),
        h('section', { className: 's2e-card' }, h('h3', null, 'PDF 文件'), pdf ? h('div', { className: 's2e-file' }, h('div', { className: 's2e-file-name' }, `${pdf.name} · ${pdf.pages} 页`), h('div', { className: 's2e-file-path' }, pdf.path)) : h('div', { className: 's2e-empty' }, '尚未选择 PDF'), h('div', { className: 's2e-actions' }, h('button', { className: 's2e-button s2e-primary', disabled: busy || job?.status === 'running', onClick: choosePdf }, pdf ? '重新选择 PDF' : '选择 PDF')), h('p', { className: 's2e-hint' }, '可选择任意目录；结构化 JSON、HTML 和 .s2e 直接写在所选 PDF 的同级目录。')),
        pdf && h('section', { className: 's2e-card' }, h('h3', null, '转换设置'), h('div', { className: 's2e-row' }, h('div', { className: 's2e-field' }, h('label', null, '起始页（闭区间）'), h('input', { className: 's2e-input', type: 'number', min: 1, max: pdf.pages, value: pageStart, onChange: (e) => setPageStart(e.target.value) })), h('div', { className: 's2e-field' }, h('label', null, '结束页（闭区间）'), h('input', { className: 's2e-input', type: 'number', min: 1, max: pdf.pages, value: pageEnd, onChange: (e) => setPageEnd(e.target.value) }))), h('div', { className: 's2e-field' }, h('label', null, '估算单价（元/视觉请求）'), h('input', { className: 's2e-input', type: 'number', min: 0, step: 0.0001, value: price, onChange: (e) => setPrice(e.target.value) })), h('div', { className: 's2e-estimate' }, h('span', null, `${pages} 页，空白页跳过、重试另计`), h('b', null, formatCost(pages * Number(price || 0)))), h('div', { className: 's2e-actions', style: { marginTop: '10px' } }, h('button', { className: 's2e-button s2e-primary', disabled: busy || job?.status === 'running' || pages < 1 || apiKey.trim() === '', onClick: start }, '开始转换'))),
        h('section', { className: 's2e-card' }, h('h3', null, '进度与计费'), h('div', { className: 's2e-progress-track' }, h('div', { className: 's2e-progress-bar', style: { width: `${progress}%` } })), h('div', { className: 's2e-progress-meta' }, h('span', null, job?.message || '尚未开始'), h('span', null, `${progress.toFixed(0)}% · ${Number(usage.requests || 0)} 次${tokenCount ? ` · ${tokenCount} tokens` : ''} · ${formatCost(job?.estimatedCost)}`)), h('pre', { className: 's2e-log' }, (job?.logs || []).slice(-25).join('\n') || '等待任务输出…'), job?.status === 'running' && h('div', { className: 's2e-actions', style: { marginTop: '9px' } }, h('button', { className: 's2e-button s2e-danger', onClick: cancel }, '取消转换'))), h('p', { className: `s2e-hint ${failed ? 's2e-error' : ''}` }, feedback))
    }

    function ReaderView() {
      const [port, setPort] = useState(Number(localStorage.getItem(PORT_KEY) || 8765)), [editing, setEditing] = useState(false), [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('正在检查阅读器状态…'), [failed, setFailed] = useState(false)
      const portRef = useRef(null)
      const refresh = useCallback(async (value = port) => { setFailed(false); try { const next = await rpc('reader-status', { port: Number(value) }); setStatus(next); setFeedback(next.running ? (next.managed ? '阅读器正在运行，由本插件管理。' : '该端口已有服务；可以直接打开，插件不会误杀非托管进程。') : '阅读器未运行。') } catch (error) { setFeedback(error.message); setFailed(true) } }, [port])
      useEffect(() => { refresh() }, [])
      const start = useCallback(async () => { setBusy(true); setFailed(false); setFeedback('正在启动阅读器…'); try { const next = await rpc('reader-start', { port: Number(port) }); setStatus(next); setFeedback('阅读器已启动。') } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [port])
      const open = useCallback(async () => { setBusy(true); setFailed(false); try { await rpc('reader-open', { port: Number(port) }); setFeedback('已在系统默认浏览器中打开阅读器。') } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [port])
      const stop = useCallback(async () => { setBusy(true); setFailed(false); setFeedback('正在终止阅读器…'); try { const next = await rpc('reader-stop', { port: Number(port) }); setStatus(next); setFeedback('阅读器已终止。') } catch (error) { setFeedback(error.message); setFailed(true) } finally { setBusy(false) } }, [port])
      const finishPortEdit = () => { setEditing(false); localStorage.setItem(PORT_KEY, String(port)); refresh(port) }
      return h('div', { className: 's2e-section s2e-reader-section' }, h('div', { className: 's2e-section-title' }, h('span', { dangerouslySetInnerHTML: { __html: readerIcon } }), h('h3', null, '网页阅读器')), h('section', { className: 's2e-card' }, h('h3', null, '服务端口'), h('div', { className: 's2e-actions' }, h('input', { ref: portRef, className: 's2e-input s2e-port', type: 'number', min: 1024, max: 65535, readOnly: !editing, title: '双击修改端口', value: port, onDoubleClick: () => { setEditing(true); setTimeout(() => portRef.current?.select(), 0) }, onChange: (e) => setPort(e.target.value), onBlur: finishPortEdit, onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() } }), !status?.running && h('button', { className: 's2e-button s2e-primary', disabled: busy, onClick: start }, busy ? '正在启动…' : '启动阅读器'), status?.running && h('button', { className: 's2e-button s2e-primary', disabled: busy, onClick: open }, busy ? '正在打开…' : '打开阅读器'), status?.running && status?.managed && h('button', { className: 's2e-button s2e-danger', disabled: busy, onClick: stop }, busy ? '正在终止…' : '终止阅读器')), status?.running && h('button', { className: 's2e-reader-url s2e-url-button', disabled: busy, onClick: open }, status.url), h('p', { className: 's2e-hint' }, '双击端口数字可修改。“打开阅读器”会交给系统默认浏览器，不占用 DSH sidebar。')), h('p', { className: `s2e-hint ${failed ? 's2e-error' : status?.running ? 's2e-ok' : ''}` }, feedback))
    }

    function Scan2EbookView({ scope, visible }) {
      return h('div', { className: 's2e-side' },
        h(Header, { icon: bookIcon, title: 'Scan2Ebook', subtitle: '转换与阅读器集中在右栏，不影响正常聊天。' }),
        h(ConversionView, { scope, visible }),
        h(ReaderView),
      )
    }

    function sidebarRoot() { const column = document.querySelector('[data-pane="sidebar"],[class*="sidebarCol"]'); return column?.querySelector('[class*="logoRow"]')?.parentElement || column?.firstElementChild }
    function mountEntry({ attribute, label, icon, onClick }) { const selector = `[${attribute}]`; if (document.querySelector(selector)) return () => {}; document.querySelector('[data-dsh-scan2ebook-reader-entry]')?.remove(); const entry = document.createElement('button'); entry.type = 'button'; entry.className = 's2e-entry'; entry.setAttribute(attribute, ''); entry.dataset.dshPlugin = 'scan2ebook'; entry.dataset.dshPart = 'sidebar-entry'; entry.title = label; entry.setAttribute('aria-label', label); entry.innerHTML = `<span class="s2e-entry-icon">${icon}</span><span class="s2e-entry-label">${label}</span>`; entry.addEventListener('click', onClick); const place = () => { const root = sidebarRoot(); if (!root || entry.parentElement === root) return; const family = Array.from(root.children).filter((node) => node.matches?.('[data-dsh-taskboard-entry],[data-dsh-ssh-entry],[data-dsh-skill-explorer-entry],[data-dsh-scan2ebook-entry]')); root.insertBefore(entry, family.length ? family[family.length - 1].nextElementSibling : null) }; const observer = new MutationObserver(() => { if (!entry.isConnected) place() }); observer.observe(document.body, { childList: true, subtree: true }); place(); return () => { observer.disconnect(); entry.remove() } }

    function apply(ctx) {
      installStyle()
      const sidebar = ctx.get('betterSidebar')
      if (!sidebar) return
      const openSidebar = () => sidebar.openTab({ type: SIDEBAR_TAB, path: 'open' })
      const disposers = [sidebar.registerTab({ id: SIDEBAR_TAB, title: 'Scan2Ebook', order: 140, single: true, icon: h('span', null, '📖'), component: Scan2EbookView }), mountEntry({ attribute: 'data-dsh-scan2ebook-entry', label: 'Scan2Ebook', icon: bookIcon, onClick: openSidebar })]
      let lastIntent = ''
      const maybeOpen = (event) => { const text = composerText(event.target); if (!conversionIntent(text) || text === lastIntent) return; if (event.type === 'keydown' && (event.key !== 'Enter' || event.shiftKey || event.isComposing)) return; if (event.type === 'click' && !event.target?.closest?.('button')) return; lastIntent = text; setTimeout(openSidebar, 0) }
      document.addEventListener('keydown', maybeOpen, true); document.addEventListener('click', maybeOpen, true); disposers.push(() => document.removeEventListener('keydown', maybeOpen, true), () => document.removeEventListener('click', maybeOpen, true))
      let lastRequest = localStorage.getItem(REQUEST_KEY) || ''
      const pollRequest = async () => { try { const request = await rpc('ui-request', { after: lastRequest }); if (!request) return; lastRequest = request.id; localStorage.setItem(REQUEST_KEY, request.id); openSidebar() } catch {} }
      const timer = setInterval(pollRequest, 1200); pollRequest(); disposers.push(() => clearInterval(timer)); const explicitOpen = () => openSidebar(); document.addEventListener('scan2ebook:open', explicitOpen); disposers.push(() => document.removeEventListener('scan2ebook:open', explicitOpen)); ctx.effect(() => () => { for (const dispose of disposers.splice(0)) dispose?.() }, 'scan2ebook: unified sidebar')
    }
    return { inject: ['betterSidebar'], apply, testHooks: { conversionIntent, validatePort: (port) => Number.isInteger(port) && port >= 1024 && port <= 65535 } }
  },
})
