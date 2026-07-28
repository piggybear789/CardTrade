'use client';

// components/contract/ContractPartyLine.tsx
//
// The two parties as one line inside the header: `You ⇄ Ada Lovelace ✓ 4.8`.
//
// Earlier versions of this room gave each participant a full card — verification line,
// a table of reputation figures, and a consent tick — which was ~330px of chrome to say
// two names. The figures still exist, one click away behind "Details"; the consent tick
// is gone entirely because `ContractActionCard` states in words whose move it is.

import { useState } from 'react';
import { ChevronDown, ShieldCheck, Star, UserPlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ContractParty } from './types';

/** One party, collapsed to a name plus its two trust signals. */
function PartyChip({ party, isMe }: { party: ContractParty; isMe: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm font-medium">
        {isMe ? 'You' : party.name}
      </span>
      <ShieldCheck
        className={cn(
          'size-3.5 shrink-0',
          party.verified ? 'text-trust' : 'text-amber-600 dark:text-amber-400',
        )}
        aria-hidden
      />
      <span className="sr-only">
        {party.verified ? 'Identity verified' : 'Identity not verified'}
      </span>
      {party.rating === null ? null : (
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
          {Number(party.rating).toFixed(1)}
        </span>
      )}
    </span>
  );
}

/** The full trust snapshot for one party, revealed by the disclosure. */
function PartyDetail({ party, isMe }: { party: ContractParty; isMe: boolean }) {
  const initial = party.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <section className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3.5">
      <div className="flex min-w-0 items-center gap-3 border-b border-border/70 pb-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-sm font-semibold shadow-sm"
          aria-hidden
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-none">
            {isMe ? 'You' : party.name}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {isMe ? party.name : (party.roleLabel ?? 'Counterparty')}
          </p>
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center gap-1 text-xs font-medium',
            party.verified ? 'text-trust' : 'text-amber-600 dark:text-amber-400',
          )}
        >
          <ShieldCheck className="size-3.5" aria-hidden />
          {party.verified ? 'KYC verified' : 'Not verified'}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 text-xs">
        <div className="min-w-0 border-l-2 border-border pl-2.5">
          <dt className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
            Feedback
          </dt>
          <dd className="mt-0.5 flex items-center gap-1 font-medium">
            {party.rating === null ? (
              'No reviews yet'
            ) : (
              <>
                <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                {Number(party.rating).toFixed(1)}
                <span className="font-normal text-muted-foreground">
                  ({party.ratingCount})
                </span>
              </>
            )}
          </dd>
        </div>
        {(party.stats ?? []).map((stat) => (
          <div key={stat.label} className="min-w-0 border-l-2 border-border pl-2.5">
            <dt className="truncate text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </dt>
            <dd
              className={cn(
                'mt-0.5 truncate',
                stat.muted ? 'text-muted-foreground' : 'font-medium tabular-nums',
              )}
            >
              {stat.value}
            </dd>
          </div>
        ))}
        {party.legalEntityName ? (
          <div className="col-span-2 border-t border-border/70 pt-3">
            <dt className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              Legal seller
            </dt>
            <dd className="mt-0.5 min-w-0 font-medium">
              <span className="block truncate">{party.legalEntityName}</span>
              {party.registrationNumber ? (
                <span className="block font-normal text-muted-foreground">
                  {party.registrationNumber}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export interface ContractPartyDetailsProps {
  /** The viewer. */
  me: ContractParty;
  /** The counterparty, or `null` while a seat is still open. */
  them: ContractParty | null;
  className?: string;
}

/** Full identity and trading-history cards for a dedicated details panel. */
export function ContractPartyDetails({
  me,
  them,
  className,
}: ContractPartyDetailsProps) {
  return (
    <div className={cn('grid w-full gap-3 sm:grid-cols-2', className)}>
      <PartyDetail party={me} isMe />
      {them ? <PartyDetail party={them} isMe={false} /> : null}
    </div>
  );
}

export interface ContractPartyLineProps {
  /** The viewer. */
  me: ContractParty;
  /** The counterparty, or `null` while a deal's seat is still open. */
  them: ContractParty | null;
  /** Whether to offer the expanded trust-and-history disclosure. */
  showDetails?: boolean;
  /** Glyph between the two parties. */
  separator?: string;
  className?: string;
}

/** Both parties on one line, with their figures behind a disclosure. */
export function ContractPartyLine({
  me,
  them,
  showDetails = true,
  separator = '⇄',
  className,
}: ContractPartyLineProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <PartyChip party={me} isMe />
        <span className="shrink-0 text-muted-foreground" aria-hidden>
          {separator}
        </span>
        {them ? (
          <PartyChip party={them} isMe={false} />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <UserPlus className="size-3.5 shrink-0" aria-hidden />
            Open seat
          </span>
        )}
        {showDetails ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Details
            <ChevronDown
              className={cn('size-3 transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
        ) : null}
      </div>

      {showDetails && expanded ? (
        <ContractPartyDetails me={me} them={them} className="mt-3 border-t pt-3" />
      ) : null}
    </div>
  );
}
