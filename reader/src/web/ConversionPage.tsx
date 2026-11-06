import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { conversionApi, notifyTasksChanged, type ConversionJob, type Upload } from './conversion-api';
import { Icon } from './Icon';
import { PdfPreview } from './PdfPreview';

export type ConversionOpen = { jobId?: string; file?: File };
export type ConversionHandle = { open: (options?: ConversionOpen) => Promise<void>; selectFile: (file: File) => Promise<void>; deactivate: () => void };
export type ConversionProps = { onImport?: (file: File, sourceJobId?: string) => Promise<string>; onRead?: (id: string) => unknown; fetchImpl?: typeof fetch };
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export const ConversionPage = forwardRef<ConversionHandle, ConversionProps>(function ConversionPage({ onImport, fetchImpl }, ref) {
  const api = useMemo(() => conversionApi(fetchImpl), [fetchImpl]);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(false);
  const [serviceMessage, setServiceMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reading, setReading] = useState(false);
  const [first, setFirst] = useState('1');
  const [last, setLast] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [model, setModel] = useState('deepseek-flash');
  const [workers, setWorkers] = useState('6');
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const restored = useRef(false);
  const currentJob = useRef<ConversionJob | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const advanced = useRef<HTMLDetailsElement>(null);
  const busy = submitting || job?.status === 'running';
  const completed = job?.status === 'completed';
  const ended = Boolean(job && !busy && !completed);
  const pages = Number(last) - Number(first) + 1;
  const validRange = Number.isInteger(Number(first)) && Number.isInteger(Number(last)) && Number(first) >= 1 && Number(last) >= Number(first) && Number(last) <= (upload?.pages || 0);

  function showError(message = '', field = '') {
    setError(message); setErrorField(field);
    if (field) {
      if (['conversion-model', 'conversion-workers'].includes(field) && advanced.current) advanced.current.open = true;
      document.getElementById(field)?.focus();
    }
  }
  function updateJob(next: ConversionJob) {
    const previous = currentJob.current;
    currentJob.current = next;
    setJob(next); setConnectionMessage('');
    if (['failed', 'interrupted'].includes(next.status)) setError(next.error || '转换未完成，请检查设置后重试');
    if (previous?.id !== next.id || previous.status !== next.status) notifyTasksChanged();
  }
  useImperativeHandle(ref, () => ({
    async open(options = {}) {
      setActive(true); setApiKey(''); setReveal(false); showError();
      try {
        const state = await api.status();
        setAvailable(state.available === true);
        setServiceMessage(state.available ? '' : state.message || '请先启动本地转换服务');
        const target = options.jobId ? state.jobs?.find((item) => item.id === options.jobId)
          : currentJob.current ? state.jobs?.find((item) => item.id === currentJob.current?.id)
            : !restored.current ? state.jobs?.[0] : undefined;
        if (target) {
          updateJob(target); setUpload(target.upload);
          setFirst(String(target.pageStart)); setLast(String(target.pageEnd)); setModel(target.model); setWorkers(String(target.workers));
        } else if (options.jobId || currentJob.current) { reset(); }
        restored.current = true;
      } catch {
        setAvailable(false);
        setServiceMessage('转换服务未连接。请从 Scan2Ebook 本地服务打开此页面，已有电子书仍可正常阅读。');
      }
    },
    selectFile,
    deactivate() { setActive(false); setApiKey(''); setReveal(false); },
  }), [api, job, uploading, busy]);
  useEffect(() => {
    let listening = true;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ removedId?: string; cleanup?: boolean }>).detail;
      if (detail?.removedId && detail.removedId === currentJob.current?.id) { reset(); return; }
      if (!detail?.cleanup) return;
      if (currentJob.current?.status !== 'running') { reset(); return; }
      const id = currentJob.current.id;
      api.status().then((state) => {
        if (!listening || currentJob.current?.id !== id) return;
        const remaining = state.jobs.find((item) => item.id === id);
        if (remaining) updateJob(remaining);
        else reset();
      }).catch(() => {});
    };
    window.addEventListener('s2e:tasks-changed', listener);
    return () => { listening = false; window.removeEventListener('s2e:tasks-changed', listener); };
  }, [api]);
  useEffect(() => {
    if (!active || job?.status !== 'running') return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try { const next = await api.job(job.id); if (!stopped) updateJob(next); }
      catch (failure) {
        if (stopped) return;
        if ((failure as { status?: number })?.status === 404) { reset(); showError('这项任务已被移除，请重新选择 PDF。'); }
        else { setConnectionMessage('与本地服务的连接暂时中断，正在重连…'); setJob({ ...job }); }
      }
    }, 900);
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, api, job]);
  useEffect(() => {
    if (job?.status === 'running' && window.matchMedia?.('(max-width: 760px)').matches) {
      document.getElementById('conversion-progress')?.scrollIntoView({ block: 'nearest' });
    }
  }, [job?.id]);

  async function selectFile(file?: File) {
    if (!file) return;
    if (uploading || busy) { showError('当前已有任务，请先等待完成或取消，再更换 PDF'); return; }
    showError();
    if (!/\.pdf$/i.test(file.name)) { showError('请选择 PDF 文件，已有 .s2e 电子书可从书库导入'); return; }
    if (!file.size || file.size > 512 * 1024 * 1024) { showError('PDF 应大于 0 且不超过 512 MB'); return; }
    setUploading(true); setUpload(null); setJob(null); currentJob.current = null;
    try { const info = await api.upload(file); setUpload(info); setFirst('1'); setLast(String(info.pages)); }
    catch (failure) { showError(messageOf(failure)); }
    finally { setUploading(false); }
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    if (!upload || uploading || busy || completed) return;
    showError();
    const pageStart = Number(first), pageEnd = Number(last), count = Number(workers);
    if (!Number.isInteger(pageStart) || pageStart < 1 || pageStart > upload.pages) { showError(`起始页应在 1–${upload.pages} 之间`, 'conversion-start'); return; }
    if (!Number.isInteger(pageEnd) || pageEnd < pageStart || pageEnd > upload.pages) { showError(`结束页应在 ${pageStart}–${upload.pages} 之间`, 'conversion-end'); return; }
    if (!apiKey.trim()) { showError('请填写本次使用的 DeepSeek API Key', 'conversion-key'); return; }
    if (!Number.isInteger(count) || count < 1 || count > 16) { showError('同时处理页数应在 1–16 之间', 'conversion-workers'); return; }
    if (!model.trim()) { showError('请填写可用的多模态模型名称', 'conversion-model'); return; }
    setSubmitting(true);
    const task = api.start({ uploadId: upload.id, pageStart, pageEnd, workers: count, model: model.trim(), apiKey: apiKey.trim() });
    setApiKey(''); setReveal(false);
    try { updateJob(await task); }
    catch (failure) { showError(messageOf(failure)); }
    finally { setSubmitting(false); }
  }
  async function cancel() {
    if (!job || cancelling) return;
    setCancelling(true);
    try { updateJob(await api.cancel(job.id)); }
    catch (failure) { showError(messageOf(failure)); }
    finally { setCancelling(false); }
  }
  async function read() {
    const file = job?.files.find((f) => f.kind === 's2e');
    if (!file || !job || reading) return;
    setReading(true);
    try {
      await onImport?.(await api.book(file), job.id);
    } catch (failure) { showError(messageOf(failure)); }
    finally { setReading(false); }
  }
  function reset() {
    currentJob.current = null;
    setJob(null); setUpload(null); setFirst('1'); setLast(''); setApiKey(''); setReveal(false); showError();
    document.getElementById('conversion-drop')?.focus();
  }
  const stage = ['structure', 'vision'].includes(job?.stage || '') ? 1 : ['finalize', 'complete'].includes(job?.stage || '') ? 2 : 0;

  const progressPanel = <Card id="conversion-progress" className="cv-progress" hidden={!job || completed} data-status={job?.status}><h2 id="conversion-status">{job?.status === 'cancelled' ? '转换已取消' : job?.status === 'interrupted' ? '转换已中断' : job?.status === 'failed' ? '转换失败' : '正在转换'}</h2>{ended && <div id="conversion-error" className="cv-error" role="alert" hidden={!error}>{error}</div>}<div className="large-progress" hidden={job?.status !== 'running'}><strong id="conversion-percent">{Math.round(job?.progress || 0)}<small>%</small></strong><span>{job?.total ? `${job.current || 0} / ${job.total} 页` : '准备中'}</span></div><div id="conversion-meter" hidden={job?.status !== 'running'} role="progressbar" aria-label="转换进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job?.progress || 0}><span style={{ width: `${job?.progress || 0}%` }} /></div><p id="conversion-message" hidden={job?.status !== 'running'} role="status" aria-live="polite">{connectionMessage || job?.message}</p><ol className="cv-stages" hidden={job?.status !== 'running'}>{['识别文字', '整理结构', '生成电子书'].map((text, index) => <li key={text} className={index === stage ? 'is-current' : index < stage ? 'is-done' : ''}><span>{index < stage ? '✓' : index + 1}</span>{text}</li>)}</ol>{job?.status === 'running' && <p className="background-note"><Icon name="activity" size={15} />任务在后台继续，可从右上角查看。</p>}<Button id="conversion-cancel" className="quiet-button" type="button" variant="outline" hidden={job?.status !== 'running'} disabled={cancelling} onClick={cancel}>{cancelling ? '正在取消…' : '取消转换'}</Button></Card>;

  return <>
    <header className="converter-heading"><h1>转换 PDF</h1></header>
    <div id="conversion-service" className="cv-notice" role="status" hidden={!serviceMessage}>{serviceMessage}</div>
    <form id="conversion-form" className={'converter-layout' + (job ? ' has-job' : '') + (job && !busy && !completed ? ' retry-state' : '')} noValidate onSubmit={start}>
      <fieldset id="conversion-fields" disabled={busy || completed}>
        <section className={'source-panel' + (upload ? ' source-selected' : '')} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('drag-over'); }} onDragLeave={(event) => event.currentTarget.classList.remove('drag-over')} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove('drag-over'); selectFile(event.dataTransfer.files[0]); }}>
          <input ref={fileInput} id="conversion-file" type="file" accept=".pdf,application/pdf" hidden onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
          <button id="conversion-drop" className={'cv-drop' + (upload ? ' has-file' : '')} type="button" aria-label="选择扫描版 PDF" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <span className="cv-file-icon"><Icon name={upload ? 'file' : 'upload'} size={upload ? 23 : 34} /></span><span className="source-file-info"><strong id="conversion-file-name">{uploading ? '正在读取 PDF…' : upload?.name || '把 PDF 拖到这里'}</strong><span id="conversion-file-meta">{uploading ? '正在确认页数，文件仅传至本机' : upload ? `${upload.pages} 页 · ${(upload.size / 1024 / 1024).toFixed(1)} MB` : '点击选择扫描版 PDF'}</span></span>{upload ? <span className="source-replace">更换<Icon name="diagonal" size={15} /></span> : <span className="cv-file-tag">最大 512 MB</span>}
          </button>
          {upload ? <><div className="source-preview-stage">{upload.url ? <PdfPreview url={upload.url} pageNumber={Math.max(1, Math.min(upload.pages, Number(first) || 1))} /> : <div className="preview-placeholder"><Icon name="file" size={40} /><span>PDF 已就绪</span></div>}</div><footer className="source-preview-footer">{upload.url && <a href={upload.url} target="_blank" rel="noopener noreferrer">查看原 PDF<Icon name="diagonal" size={14} /></a>}</footer></> : null}
        </section>
        <Card className="converter-settings" hidden={busy || completed}>{ended && progressPanel}
          <div className="settings-section"><div className="settings-section-head"><h2>转换范围</h2><Button id="conversion-all" className="quiet-button" type="button" variant="ghost" disabled={!upload} onClick={() => { setFirst('1'); setLast(String(upload!.pages)); showError(); }}>整本转换</Button></div>
            <div className="cv-range"><label htmlFor="conversion-start">起始页<Input id="conversion-start" type="number" min={1} max={upload?.pages} step={1} inputMode="numeric" value={first} aria-invalid={errorField === 'conversion-start' || undefined} onChange={(event) => { setFirst(event.target.value); showError(); }} /></label><span aria-hidden="true">—</span><label htmlFor="conversion-end">结束页<Input id="conversion-end" type="number" min={1} max={upload?.pages} step={1} inputMode="numeric" placeholder="自动填入" value={last} aria-invalid={errorField === 'conversion-end' || undefined} onChange={(event) => { setLast(event.target.value); showError(); }} /></label></div>
            <p className="field-help">按 PDF 实际页序，包含起始和结束页。</p>
          </div>
          <div className="settings-section"><div className="settings-section-head"><h2>DeepSeek API Key</h2></div><label className="sr-only" htmlFor="conversion-key">API Key</label><div className="cv-password"><Input id="conversion-key" type={reveal ? 'text' : 'password'} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="输入本次使用的 API Key" value={apiKey} aria-invalid={errorField === 'conversion-key' || undefined} onChange={(event) => setApiKey(event.target.value)} /><Button id="conversion-reveal" type="button" variant="ghost" aria-label={(reveal ? '隐藏' : '显示') + ' API Key'} aria-pressed={reveal} onClick={() => setReveal(!reveal)}><Icon name="eye" size={17} /></Button></div><p className="field-help">密钥不保存，开始转换或离开后清空。</p>
            <details ref={advanced} className="cv-advanced"><summary>模型与处理选项<span>＋</span></summary><div className="cv-advanced-fields"><label htmlFor="conversion-model">多模态模型<Input id="conversion-model" autoComplete="off" spellCheck={false} value={model} aria-invalid={errorField === 'conversion-model' || undefined} onChange={(event) => setModel(event.target.value)} /></label><label htmlFor="conversion-workers">同时处理页数<Input id="conversion-workers" type="number" min={1} max={16} step={1} value={workers} aria-invalid={errorField === 'conversion-workers' || undefined} onChange={(event) => setWorkers(event.target.value)} /></label><p className="field-help">需使用支持图像输入的模型，限流时可降低同时处理页数。</p></div></details>
          </div>
          <div className="conversion-checkout"><div><span>本次转换</span><strong id="conversion-summary-pages">{upload ? validRange ? `第 ${first}–${last} 页 · 共 ${pages} 页` : '请检查页码范围' : '等待选择 PDF'}</strong></div></div>
          {!ended && <div id="conversion-error" className="cv-error" role="alert" hidden={!error}>{error}</div>}
          <Button id="conversion-submit" className="primary-action convert-submit" type="submit" disabled={!available || !upload || uploading || busy || completed}>{uploading ? '正在读取文件…' : submitting ? '正在开始…' : ['failed', 'cancelled', 'interrupted'].includes(job?.status || '') ? '重新转换' : '开始转换'}<Icon name="diagonal" size={19} /></Button><p className="conversion-consent">所选页面会发送给你的模型服务。请确认材料可上传，费用以服务商账单为准。</p>
        </Card>
      </fieldset>
      <aside className="converter-outcome" hidden={!job || ended} aria-label="转换进度与结果">
        {!ended && progressPanel}
        <Card id="conversion-result" className="cv-result" hidden={!completed}><span className="result-check"><Icon name="check" size={26} /></span><h2>转换完成</h2><Button id="conversion-read" className="primary-action" type="button" disabled={reading} onClick={read}>{reading ? '正在打开…' : '阅读电子书'}<Icon name="arrow" size={18} /></Button><div id="conversion-downloads" className="cv-downloads">{job?.files.map((file) => <a key={file.kind} href={file.url} download={file.name}><Icon name="download" size={14} />{file.kind === 's2e' ? '电子书 .s2e' : file.kind.toUpperCase()}</a>)}</div><Button id="conversion-reset" className="quiet-button" type="button" variant="ghost" onClick={reset}>转换下一本<Icon name="plus" size={16} /></Button></Card>
      </aside>
    </form>
  </>;
});
