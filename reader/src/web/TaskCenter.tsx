import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui/button';
import { confirmSheet, showToast } from '../core/dialogs.js';
import { conversionApi, notifyTasksChanged, type ConversionJob } from './conversion-api';
import { Icon } from './Icon';

type Props = { onOpenJob?: (id: string) => unknown; onImport?: (file: File, id: string) => Promise<string> };
const labels = { running: '转换中', completed: '已完成', failed: '未完成', cancelled: '已取消', interrupted: '已中断' };
function bytes(value: number) { return value >= 1024 * 1024 ? (value / 1024 / 1024).toFixed(1) + ' MB' : (value > 0 ? Math.max(1, Math.round(value / 1024)) : 0) + ' KB'; }

export function TaskCenter({ onOpenJob, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef(new Map<string, string>());
  const api = useRef(conversionApi()).current;
  const active = jobs.find((job) => job.status === 'running');
  const hasActive = Boolean(active);
  const refresh = useCallback(async () => {
    try {
      const state = await api.status();
      for (const job of state.jobs || []) {
        if (previous.current.get(job.id) === 'running' && job.status === 'completed') {
          showToast({ message: '「' + job.upload.name.replace(/\.pdf$/i, '') + '」转换完成', actionLabel: '查看结果', onAction: () => onOpenJob?.(job.id), doneMessage: '已打开转换结果', duration: 6000 });
        }
      }
      previous.current = new Map((state.jobs || []).map((job) => [job.id, job.status]));
      setJobs(state.jobs || []); setConnected(true);
    } catch { setConnected(false); }
  }, [api, onOpenJob]);
  useEffect(() => {
    refresh();
    const listener = () => { refresh(); };
    window.addEventListener('s2e:tasks-changed', listener);
    return () => window.removeEventListener('s2e:tasks-changed', listener);
  }, [refresh]);
  useEffect(() => {
    let stopped = false;
    const delay = hasActive ? 1500 : open ? 4000 : 15_000;
    let timer = setTimeout(poll, delay);
    async function poll() {
      try { await refresh(); }
      finally { if (!stopped) timer = setTimeout(poll, delay); }
    }
    return () => { stopped = true; clearTimeout(timer); };
  }, [hasActive, open, refresh]);
  useEffect(() => {
    if (!open) return;
    const source = document.activeElement as HTMLElement | null;
    const app = document.getElementById('app');
    app?.setAttribute('inert', '');
    panel.current?.querySelector<HTMLButtonElement>('[data-close-tasks]')?.focus();
    return () => { app?.removeAttribute('inert'); if (source?.isConnected) source.focus(); };
  }, [open]);

  async function remove(job: ConversionJob) {
    if (!await confirmSheet({ title: '移除这项转换任务？', message: '将删除这项任务的上传副本与下载文件。原始 PDF 和已加入书库的电子书会保留。', confirmLabel: '移除任务', danger: true })) return;
    setWorking(job.id); setError('');
    try { await api.remove(job.id); notifyTasksChanged({ removedId: job.id }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '任务未能移除，请重试'); }
    finally { setWorking(null); }
  }
  async function cleanup() {
    if (!await confirmSheet({ title: '清理已结束的转换任务？', message: '将移除已结束任务、上传副本和转换产物。请先下载需要保留的文件。正在转换的任务和书库中的电子书不会被清理。', confirmLabel: '清理转换副本', danger: true })) return;
    setWorking('cleanup'); setError('');
    try {
      const result = await api.cleanup(); notifyTasksChanged({ cleanup: true });
      showToast('已清理 ' + result.removedJobs + ' 项任务，释放 ' + bytes(result.freedBytes));
    } catch (failure) { setError(failure instanceof Error ? failure.message : '清理未完成，请重试'); }
    finally { setWorking(null); }
  }
  async function cancel(job: ConversionJob) {
    setWorking(job.id); setError('');
    try { await api.cancel(job.id); notifyTasksChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '取消未完成，请重试'); }
    finally { setWorking(null); }
  }
  async function read(job: ConversionJob) {
    const file = job.files.find((item) => item.kind === 's2e');
    if (!file || !onImport) return;
    setWorking(job.id); setError('');
    try { await onImport(await api.book(file), job.id); setOpen(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '电子书未能打开，请重试'); }
    finally { setWorking(null); }
  }
  function visit(job: ConversionJob) { setOpen(false); onOpenJob?.(job.id); }

  return <>
    <Button id="btn-tasks" className={'task-center-trigger' + (active ? ' has-active-task' : '')} variant="ghost" aria-label={active ? '任务中心，正在转换' : '任务中心'} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); refresh(); }}><Icon name="activity" size={18} /><span>{active ? Math.round(active.progress) + '%' : '任务'}</span>{active && <i />}</Button>
    {open && createPortal(<div className="task-drawer-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section ref={panel} className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-drawer-title" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key === 'Tab') {
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')].filter((item) => item.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="task-drawer-heading"><div><h2 id="task-drawer-title">转换任务<span>{jobs.length}</span></h2></div><Button data-close-tasks variant="ghost" size="icon" aria-label="关闭任务中心" onClick={() => setOpen(false)}><Icon name="close" /></Button></header>
      {!connected && <div className="task-connection-error" role="status">本机服务暂时无法连接。<button onClick={refresh}>重新连接</button></div>}
      {error && <div className="cv-error" role="alert">{error}</div>}
      <div className="task-list">{!jobs.length ? <div className="task-empty"><Icon name="activity" size={36} /><h3>还没有转换任务</h3><Button variant="outline" onClick={() => { setOpen(false); document.getElementById('nav-convert')?.click(); }}>去转换 PDF<Icon name="arrow" size={17} /></Button></div> : jobs.map((job) => <article className={'task-card task-' + job.status} key={job.id}>
        <div className="task-card-top"><span className="task-file-icon"><Icon name="file" size={22} /></span><div><h3>{job.upload.name}</h3><p>第 {job.pageStart}–{job.pageEnd} 页<span>·</span>{job.startedAt ? new Date(job.startedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</p></div><span className="task-status-label">{labels[job.status]}</span></div>
        {job.status === 'running' ? <><div className="task-progress"><span style={{ width: `${job.progress}%` }} /></div><p className="task-message">{job.message}<b>{Math.round(job.progress)}%</b></p></> : job.status !== 'completed' && <p className="task-message">{job.error || job.message}</p>}
        <div className="task-actions">{job.status === 'completed' ? <><Button size="sm" onClick={() => read(job)} disabled={working === job.id}>阅读电子书<Icon name="arrow" size={15} /></Button>{job.files.find((file) => file.kind === 's2e') && <a href={job.files.find((file) => file.kind === 's2e')!.url} download={job.files.find((file) => file.kind === 's2e')!.name}><Icon name="download" size={15} />下载</a>}<button onClick={() => visit(job)}>查看结果</button></> : <><Button variant="outline" size="sm" onClick={() => visit(job)}>{job.status === 'running' ? '查看进度' : '重新转换'}</Button>{job.status === 'running' && <button disabled={working === job.id} onClick={() => cancel(job)}>取消转换</button>}</>}{job.status !== 'running' && <button className="task-remove" aria-label={'移除任务 ' + job.upload.name} disabled={working === job.id} onClick={() => remove(job)}><Icon name="trash" size={15} /></button>}</div>
      </article>)}</div>
      <footer className="task-drawer-footer"><Button variant="ghost" size="sm" disabled={!connected || working === 'cleanup'} onClick={cleanup}>清理转换副本</Button></footer>
    </section></div>, document.body)}
  </>;
}
