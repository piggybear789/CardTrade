import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronLeftIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

/**
 * Cream, borderless phone strip. Safe-area is padding, not a second slab.
 * `compact` is status-bar inset only — hubs and threads already title themselves.
 *
 * Non-compact height is inset + 54px, and every variant must land on that number
 * so the content edge does not shift as you move between routes. It holds only
 * while no child exceeds the 40px row: keep controls at `size-10`/`h-10`, not the
 * 44px tap target used elsewhere. Auth and marketing chrome had drifted to 44px.
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
          : 'pt-[calc(env(safe-area-inset-top)+0.5rem)]',
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
        'inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris',
        className,
      )}
    >
      <HugeiconsIcon icon={ChevronLeftIcon} className="size-6" strokeWidth={1.75} aria-hidden />
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
        'relative inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
