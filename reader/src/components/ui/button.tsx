import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  { variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border border-border bg-card hover:bg-muted',
      ghost: 'hover:bg-muted',
      destructive: 'text-destructive hover:bg-destructive/10',
    },
    size: { default: 'h-10 px-4', sm: 'h-8 px-3', icon: 'size-9' },
  }, defaultVariants: { variant: 'default', size: 'default' } },
);

type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component data-slot="button" data-variant={variant || 'default'} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
