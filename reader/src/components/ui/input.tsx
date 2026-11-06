import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn('flex h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60', className)} {...props} />;
}
