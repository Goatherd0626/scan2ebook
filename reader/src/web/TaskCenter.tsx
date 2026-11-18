import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui/button';
import { showToast } from '../core/dialogs.js';
import { confirmDelete } from '../core/delete-confirm.js';
import { NotificationBell } from '../components/ui/notification-bell';
import { conversionApi, notifyTasksChanged, type ConversionJob } from './conversion-api';
import { Icon } from './Icon';

type Props = {
  onOpenJob?: (id: string) => unknown;
  onImport?: (file: File, id: string) => Promise<string>;
  getDraftUploadId?: () => Promise<string | undefined> | undefined;
};
const labels = { running: '转换中', completed: '已完成', failed: '未完成', cancelled: '已取消', interrupted: '已中断' };
function bytes(value: number) { return value >= 1024 * 1024 ? (value / 1024 / 1024).toFixed(1) + ' MB' : (value > 0 ? Math.max(1, Math.round(value / 1024)) : 0) + ' KB'; }

export function TaskCenter({ onOpenJob, onImport, getDraftUploadId }: Props) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [connected, setConnected] = useState(true);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef(new Map<string, string>());
  const observed = useRef(false);
  const sequence = useRef(0);
  const openRef = useRef(false);
  const api = useRef(conversionApi()).current;
  const active = jobs.find((job) => job.status === 'running');
  const hasActive = Boolean(active);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const state = await api.status();
      if (request !== sequence.current) return;
      const jobs = state.jobs || [];
      const notifications = jobs.filter(job => observed.current && ['completed', 'failed', 'interrupted'].includes(job.status)
        && (previous.current.get(job.id) === 'running' || !previous.current.has(job.id)));
      if (!openRef.current) for (const job of notifications) {
        const completed = job.status === 'completed';
        showToast({ type: completed ? 'success' : 'error', message: '「' + job.upload.name.replace(/\.pdf$/i, '') + '」' + (completed ? '转换完成' : '转换未完成'),
          actionLabel: completed ? '查看结果' : '查看任务', onAction: () => { closePanel(); return onOpenJob?.(job.id); }, doneMessage: '已打开转换任务', duration: 6000 });
      }
      setUnread(current => {
        const ids = new Set(jobs.map(job => job.id));
        const next = new Set([...current].filter(id => ids.has(id)));
        if (!openRef.current) notifications.forEach(job => next.add(job.id));
        return next.size === current.size && [...next].every(id => current.has(id)) ? current : next;
      });
      previous.current = new Map(jobs.map(job => [job.id, job.status])); observed.current = true;
      setJobs(jobs); setConnected(true);
    } catch { if (request === sequence.current) setConnected(false); }
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
    const drawer = panel.current;
    if (!open || !drawer) return;
    const app = document.getElementById('app');
    const trigger = document.getElementById('btn-tasks');
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')]
        .filter(item => item.getClientRects().length);
      const [first] = items;
      const last = items[items.length - 1];
      const focused = document.activeElement;
      if (!drawer.contains(focused) || focused === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    app?.setAttribute('inert', '');
    drawer.querySelector<HTMLButtonElement>('[data-close-tasks]')?.focus();
    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      document.removeEventListener('keydown', handleKeydown, true);
      app?.removeAttribute('inert');
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  function closePanel() { openRef.current = false; setOpen(false); }
  function reportError(failure: unknown, fallback: string) { showToast({ type: 'error', message: failure instanceof Error ? failure.message : fallback }); }
  async function remove(job: ConversionJob, anchor: HTMLElement) {
    if (!await confirmDelete({ anchor, title: '移除这项转换任务？', message: '删除上传副本与下载文件，原始 PDF 和书库电子书保留。', confirmLabel: '移除任务' })) return;
    setWorking(job.id);
    try { await api.remove(job.id); notifyTasksChanged({ removedId: job.id }); showToast({ type: 'success', message: '已移除转换任务' }); }
    catch (failure) { reportError(failure, '任务未能移除，请重试'); }
    finally { setWorking(null); }
  }
  async function cleanup(anchor: HTMLElement) {
    if (!await confirmDelete({ anchor, title: '清理已结束的任务？', message: '将移除转换产物，请先下载所需文件。正在转换的任务和书库不受影响。', confirmLabel: '清理副本' })) return;
    setWorking('cleanup');
    try {
      const result = await api.cleanup(await getDraftUploadId?.());
      notifyTasksChanged({ cleanup: true });
      showToast({ type: 'success', message: '已清理 ' + result.removedJobs + ' 项任务', description: '释放 ' + bytes(result.freedBytes) });
    } catch (failure) { reportError(failure, '清理未完成，请重试'); }
    finally { setWorking(null); }
  }
  async function cancel(job: ConversionJob) {
    setWorking(job.id);
    try { await api.cancel(job.id); notifyTasksChanged(); showToast({ type: 'info', message: '已停止转换' }); }
    catch (failure) { reportError(failure, '取消未完成，请重试'); }
    finally { setWorking(null); }
  }
  async function read(job: ConversionJob) {
    const file = job.files.find((item) => item.kind === 's2e');
    if (!file || !onImport) return;
    setWorking(job.id);
    try { await onImport(await api.book(file), job.id); closePanel(); }
    catch (failure) { reportError(failure, '电子书未能打开，请重试'); }
    finally { setWorking(null); }
  }
  function visit(job: ConversionJob) { closePanel(); onOpenJob?.(job.id); }

  return <>
    <NotificationBell id="btn-tasks" count={unread.size} progress={active?.progress} className={'task-center-trigger' + (active ? ' has-active-task' : '')} title="通知与转换任务" aria-label={unread.size ? `通知，${unread.size} 条未读` : active ? '通知，正在转换' : '通知'} aria-haspopup="dialog" aria-expanded={open} onClick={() => { openRef.current = true; setUnread(new Set()); setOpen(true); refresh(); }} />
    {open && createPortal(<div className="task-drawer-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) closePanel(); }}><section ref={panel} className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-drawer-title">
      <header className="task-drawer-heading"><div><h2 id="task-drawer-title">通知与任务<span>{jobs.length}</span></h2></div><Button data-close-tasks variant="ghost" size="icon" aria-label="关闭通知与任务" onClick={closePanel}><Icon name="close" /></Button></header>
      {!connected && <div className="task-connection-error" role="status">本机服务暂时无法连接。<button onClick={refresh}>重新连接</button></div>}
      <div className="task-list">{!jobs.length ? <div className="task-empty"><Icon name="activity" size={36} /><h3>还没有转换任务</h3><Button variant="outline" onClick={() => { closePanel(); document.getElementById('nav-convert')?.click(); }}>去转换 PDF<Icon name="arrow" size={17} /></Button></div> : jobs.map((job) => <article className={'task-card task-' + job.status} key={job.id}>
        <div className="task-card-top"><span className="task-file-icon"><Icon name="file" size={22} /></span><div><h3>{job.upload.name}</h3><p>第 {job.pageStart}–{job.pageEnd} 页<span>·</span>{job.startedAt ? new Date(job.startedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</p></div><span className="task-status-label">{labels[job.status]}</span></div>
        {job.status === 'running' ? <><div className="task-progress"><span style={{ width: `${job.progress}%` }} /></div><p className="task-message">{job.message}<b>{Math.round(job.progress)}%</b></p></> : job.status !== 'completed' && <p className="task-message">{job.error || job.message}</p>}
        <div className="task-actions">{job.status === 'completed' ? <><Button size="sm" onClick={() => read(job)} disabled={working === job.id}>阅读电子书<Icon name="arrow" size={15} /></Button>{job.files.find((file) => file.kind === 's2e') && <a href={job.files.find((file) => file.kind === 's2e')!.url} download={job.files.find((file) => file.kind === 's2e')!.name}><Icon name="download" size={15} />下载</a>}<button onClick={() => visit(job)}>查看结果</button></> : <><Button variant="outline" size="sm" onClick={() => visit(job)}>{job.status === 'running' ? '查看进度' : '重新转换'}</Button>{job.status === 'running' && <button disabled={working === job.id} onClick={() => cancel(job)}>取消转换</button>}</>}{job.status !== 'running' && <button className="task-remove" aria-label={'移除任务 ' + job.upload.name} disabled={working === job.id} onClick={event => remove(job, event.currentTarget)}><Icon name="trash" size={15} /></button>}</div>
      </article>)}</div>
      <footer className="task-drawer-footer"><Button variant="ghost" size="sm" disabled={!connected || working === 'cleanup'} onClick={event => cleanup(event.currentTarget)}>清理转换副本</Button></footer>
    </section></div>, document.body)}
  </>;
}
