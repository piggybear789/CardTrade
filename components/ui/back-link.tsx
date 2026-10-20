// components/ui/back-link.tsx
//
// THE BACK CONTROL. Every "back to somewhere" link on a page renders this, so the
// way out of a page looks the same wherever it is: a small pill above the content
// with an arrow and the name of where it goes ("Back to marketplace"). Naming the
// destination matters more than the arrow; "Back" alone leaves a member guessing
// which page they will land on.
//
// Muted at rest so it never competes with the page's own heading or actions, and
// firming up under the pointer, with the arrow nudging the way it goes. It is a
// link, not `router.back()`: an explicit place survives a page opened in a new tab
// or from a shared URL, and keeps the `nav-back` view transition.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft02Icon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export function BackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      transitionTypes={['nav-back']}
      className={cn(
        'group inline-flex h-8 items-center gap-1.5 rounded-full border border-border/80 bg-card pl-2.5 pr-3.5 text-meta font-medium text-muted-foreground shadow-2xs transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <HugeiconsIcon
        icon={ArrowLeft02Icon}
        className="size-3.5 transition-transform group-hover:-translate-x-0.5"
        aria-hidden
      />
      {children}
    </Link>
  );
}
