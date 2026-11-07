// Folder 轮廓改编自 Rare UI，Copyright (c) 2026 Swami Malode。
// 来源与完整许可：reader/THIRD_PARTY_NOTICES.md。
import type { DragEvent } from 'react';
import { Icon } from './Icon';

const FLAP_PATH = 'M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z';

type Props = {
  name: string; count: number; onOpen: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDetails: () => void; onDelete: (anchor: HTMLElement | null) => void;
};

export function FolderCard({ name, count, onOpen, onDrop, onDetails, onDelete }: Props) {
  return <article className="folder-card" onDragOver={(event) => {
    if (!event.dataTransfer.types.includes('text/s2e-book')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; event.currentTarget.classList.add('drag-over');
  }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.classList.remove('drag-over'); }} onDrop={(event) => {
    event.currentTarget.classList.remove('drag-over');
    if (event.dataTransfer.types.includes('text/s2e-book')) { event.stopPropagation(); onDrop(event); }
  }}>
    <button className="folder-open" onClick={onOpen} aria-label={'打开文件夹 ' + name}>
      <span className="folder-art" aria-hidden="true"><span className="folder-drawing">
        <svg className="folder-back" viewBox="0 0 321 241"><path d={FLAP_PATH} /></svg>
        <span className="folder-paper paper-left"><i /><i /><i /></span><span className="folder-paper paper-middle"><i /><i /><i /></span><span className="folder-paper paper-right"><i /><i /><i /></span>
        <svg className="folder-front" viewBox="0 0 321 241"><path d={FLAP_PATH} /></svg>
      </span></span>
      <span className="folder-label"><strong>{name}</strong><span>{count} 本</span></span>
    </button>
    <details className="folder-more" name="folder-actions" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
    }}><summary aria-label={'文件夹操作 ' + name}><Icon name="more" size={18} /></summary><div className="book-menu"><button onClick={(event) => { event.currentTarget.closest('details')!.open = false; onDetails(); }}>文件夹详情</button><button className="danger" onClick={(event) => { const menu = event.currentTarget.closest('details')!; menu.open = false; onDelete(menu.querySelector('summary')); }}>删除文件夹</button></div></details>
  </article>;
}
