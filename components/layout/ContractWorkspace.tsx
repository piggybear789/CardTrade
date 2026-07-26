// components/layout/ContractWorkspace.tsx
//
// Shared contract-room layout primitive (demo-contract-ux spec, Req 1 & 3).
//
// Cash sales, private deals, and (once wired) trades all put participant
// context beside a live conversation. Stacking them as equal-width flex
// siblings — the previous approach — left the conversation panel with no
// definite height, so `ContractChat`'s `h-full` could never resolve and the
// message list grew with the page instead of scrolling in place.
//
// This primitive fixes that by giving the conversation column an explicit,
// viewport-bounded height (capped so short laptop screens still see the
// composer) and by giving conversation more width than the compact
// participant summary, rather than the old equal thirds.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function ContractWorkspace({
  parties,
  conversation,
  className,
}: {
  /** Compact participant summary cards, stacked in the narrower column. */
  parties: ReactNode;
  /** The chat/share-link panel, given a real bounded height to scroll in. */
  conversation: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,1.7fr)] lg:items-start',
        className,
      )}
    >
      <div className="flex flex-col gap-4">{parties}</div>
      <div className="flex min-h-[24rem] flex-col lg:h-[34rem] lg:max-h-[calc(100dvh-9rem)]">
        {conversation}
      </div>
    </div>
  );
}
