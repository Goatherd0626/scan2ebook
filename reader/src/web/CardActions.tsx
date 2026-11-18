import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

type Action = { label: string; onSelect: (anchor: HTMLElement) => void; danger?: boolean };
type Props = { className: string; label: string; actions: Action[] };

export function CardActions({ className, label, actions }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    }
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [open]);

  function closeAndFocus() {
    if (menu.current) menu.current.open = false;
    anchor.current?.focus({ preventScroll: true });
  }

  return <details className={className} name="library-card-actions" ref={menu}
    onToggle={event => setOpen(event.currentTarget.open)}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !event.currentTarget.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    }}>
    <summary ref={anchor} aria-label={label}><Icon name="more" size={18} /></summary>
    <div className="book-menu">
      {actions.map(({ label, onSelect, danger }) => <button key={label} type="button" className={danger ? 'danger' : undefined}
        onClick={() => {
          closeAndFocus();
          if (anchor.current) onSelect(anchor.current);
        }}>{label}</button>)}
    </div>
  </details>;
}
