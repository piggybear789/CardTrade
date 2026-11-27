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
import { Icon } from '@/components/ui/icon';
import { ArrowLeftIcon } from '@/components/ui/icons';

import { cn } from '@/lib/utils';

export function BackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      transitionTypes={['nav-back']}
      className={cn(
        // Tonal, as the quiet button is (2026-11-28): an ink tint, no edge, no drop.
        'group inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground/[0.06] pl-2.5 pr-3.5 text-meta font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.1] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        className,
      )}
    >
      <Icon
        icon={ArrowLeftIcon}
        className="size-3.5"
        aria-hidden
      />
      {children}
    </Link>
  );
}
