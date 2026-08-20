// components/contract/ContractHeader.tsx
//
// The identity strip every contract room opens with: what this contract is, what it is
// worth, who is in it, and what state it is in. One card, two lines.
//
// Deliberately NOT here any more: the eyebrow ("Purchase contract" — the page shell
// already renders that as the route h1) and the "whose move is it" clause, which now
// lives in exactly one place, `ContractActionCard`. The connection indicator only
// appears when the realtime link is degraded; a healthy socket is not news.

import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ContractConnectionStatus } from './ContractConnectionStatus';
import type { ContractConnectionStatus as Status } from './types';

export interface ContractHeaderProps {
  /** The contract's own title — the item, the deal name, the swap. */
  title: string;
  /** The money, in a few words. Right-aligned beside the title. */
  money?: ReactNode;
  /** The compact party line, usually `<ContractPartyLine/>`. */
  parties?: ReactNode;
  /** The flow's status badge. */
  status?: ReactNode;
  /** Realtime connection state. Rendered only while degraded. */
  connectionStatus?: Status;
  className?: string;
}

/** Shared contract-room identity strip. */
export function ContractHeader({
  title,
  money,
  parties,
  status,
  connectionStatus,
  className,
}: ContractHeaderProps) {
  // Initial connection and brief retries are normal background work. Only surface a
  // terminal failure, when the contract may actually be showing stale information.
  const degraded = connectionStatus === 'error';

  return (
    <Card className={cn('border-border shadow-sm', className)}>
      <CardContent className="px-group py-cozy">
        {/* Identity on one line: the workspace below (details + chat) owns the
            vertical budget, so the strip packs title · parties on the left and
            status · money on the right, wrapping only when it must. */}
        <div className="flex flex-wrap items-center justify-between gap-x-group gap-y-snug">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-group gap-y-1">
            {/* The page shell renders the route <h1>; this is the contract's own title. */}
            <h2
              className="min-w-0 max-w-full truncate text-subhead font-semibold tracking-tight"
              title={title}
            >
              {title}
            </h2>
            {parties ? <div className="min-w-0">{parties}</div> : null}
          </div>

          <div className="flex shrink-0 items-center gap-cozy">
            {degraded && connectionStatus ? (
              <ContractConnectionStatus status={connectionStatus} />
            ) : null}
            {status}
            {money ? (
              <p className="display-value shrink-0 text-lead">{money}</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
