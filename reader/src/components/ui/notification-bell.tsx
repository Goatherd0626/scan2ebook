// 改编自 Rare UI Notification Bell，Copyright (c) 2026 Swami Malode。
// 来源与完整许可：reader/THIRD_PARTY_NOTICES.md。
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from './button';

type Props = Omit<ComponentProps<typeof Button>, 'children'> & { count: number; progress?: number };

export function NotificationBell({ count, progress, className = '', ...props }: Props) {
  const previous = useRef(count);
  const [ring, setRing] = useState(0);
  useEffect(() => {
    if (count > previous.current) setRing(value => value + 1);
    previous.current = count;
  }, [count]);
  return <Button variant="ghost" {...props} data-unread-count={count} className={'notification-bell ' + className}>
    <svg key={'bell-' + ring} className={'bell-icon' + (ring ? ' is-ringing' : '')} viewBox="0 0 18 18" fill="currentColor" width="22" height="22" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" fillOpacity=".55" d="M3.5 6.5C3.5 3.46279 5.96279 1 9 1C12.0372 1 14.5 3.46279 14.5 6.5V10.75C14.5 11.4408 15.0592 12 15.75 12C16.1642 12 16.5 12.3358 16.5 12.75C16.5 13.1642 16.1642 13.5 15.75 13.5H2.25C1.83579 13.5 1.5 13.1642 1.5 12.75C1.5 12.3358 1.83579 12 2.25 12C2.94079 12 3.5 11.4408 3.5 10.75V6.5Z" />
      <path className="bell-clapper" d="M10.2 15H7.80099C7.64999 15 7.50799 15.068 7.41299 15.185C7.31799 15.302 7.28099 15.456 7.31199 15.603C7.48499 16.425 8.17999 17 9.00099 17C9.82199 17 10.517 16.425 10.69 15.603C10.721 15.456 10.684 15.302 10.589 15.185C10.494 15.068 10.351 15 10.2 15Z" />
    </svg>
    {count > 0 && <span key={'count-' + count} data-slot="notification-count" className="notification-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    {progress !== undefined && <span className="notification-progress">{Math.round(progress)}%</span>}
  </Button>;
}
