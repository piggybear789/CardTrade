import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Cream, borderless phone strip. Safe-area is padding, not a second slab.
 * `compact` is status-bar inset only — hubs and threads already title themselves.
 */
export function MobileChromeFrame({
  children,
  compact = false,
}: {
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header
      className={cn(
        'bg-background md:hidden',
        compact
          ? 'pt-[env(safe-area-inset-top)]'
          : 'pt-[calc(env(safe-area-inset-top)+0.75rem)]',
      )}
    >
      {compact ? null : (
        <div className="flex min-h-10 items-center gap-1.5 px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-1.5">
          {children}
        </div>
      )}
    </header>
  );
}

export function MobileChromeBack({
  href,
  label = 'Go back',
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      transitionTypes={['nav-back']}
      aria-label={label}
      className={cn(
        'inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-gold/40',
        className,
      )}
    >
      <ChevronLeft className="size-6" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

export function MobileChromeIconButton({
  children,
  className,
  ...props
}: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-gold/40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
