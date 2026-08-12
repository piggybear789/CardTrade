'use client';

// components/contract/ContractPartyLine.tsx
//
// The two parties as one line inside the header: `You ⇄ Ada Lovelace ✓ 4.8`.
//
// Header stays as a compact name line. Reputation figures live inside each exchange
// side card (`ContractPartyStats`). Optional `showDetails` still expands full cards
// where a room wants them (e.g. cash-sale parties tab uses `ContractPartyDetails`).

import { useState, type ReactNode } from 'react';
import { ChevronDown, ShieldCheck, Star, UserPlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ContractParty } from './types';
import { Avatar } from '@/components/ui/avatar';
import { SocialLinksDisplay } from '@/components/profile/SocialLinksDisplay';

/** One party, collapsed to a name plus its two trust signals. */
function PartyChip({ party, isMe }: { party: ContractParty; isMe: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* `xs` to keep the header a single compact line. Decorative: the name is
          right beside it. An avatar is recognisability only — the shield below is
          the assurance, and this must never be mistaken for it. */}
      <Avatar
        avatarPath={party.avatarPath}
        displayName={isMe ? 'You' : party.name}
        size="xs"
      />
      <span className="truncate text-sm font-medium">
        {isMe ? 'You' : party.name}
      </span>
      <ShieldCheck
        className={cn(
          'size-3.5 shrink-0',
          party.verified ? 'text-trust' : 'text-gold',
        )}
        aria-hidden
      />
      <span className="sr-only">
        {party.verified ? 'DittoShield verified' : 'DittoShield not verified'}
      </span>
      {party.rating === null ? null : (
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          <Star className="size-3 fill-gold text-gold" aria-hidden />
          {Number(party.rating).toFixed(1)}
        </span>
      )}
    </span>
  );
}

/** Short noun for a party stat label, for the compact meta line. */
function shortStatNoun(label: ReactNode): string {
  if (typeof label !== 'string') return '';
  const lower = label.toLowerCase();
  if (lower.includes('purchase')) return 'buys';
  if (lower.includes('sale')) return 'sales';
  if (lower.includes('collateral') || lower.includes('stake')) return 'stake';
  if (lower.includes('value')) return 'value';
  return lower.replace(/\s+completed$/i, '').trim();
}

/** Compact trust line — verified · rating · sales · buys — for exchange side cards. */
export function ContractPartyStats({
  party,
  className,
}: {
  party: ContractParty;
  className?: string;
}) {
  const bits: ReactNode[] = [
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        party.verified ? 'text-trust' : 'text-gold',
      )}
    >
      <ShieldCheck className="size-3 shrink-0" aria-hidden />
      {party.verified ? 'DittoShield verified' : 'Unverified'}
    </span>,
    party.rating === null ? (
      <span className="text-muted-foreground">New</span>
    ) : (
      <span className="inline-flex items-center gap-1">
        <Star className="size-3 fill-gold text-gold" aria-hidden />
        <span className="font-medium tabular-nums">
          {Number(party.rating).toFixed(1)}
        </span>
        <span className="text-muted-foreground">({party.ratingCount})</span>
      </span>
    ),
  ];

  for (const stat of party.stats ?? []) {
    if (stat.muted) continue;
    const noun = shortStatNoun(stat.label);
    bits.push(
      <span className="inline-flex min-w-0 items-baseline gap-1 text-muted-foreground">
        <span className="truncate font-medium tabular-nums text-foreground">
          {stat.value}
        </span>
        {noun ? <span className="shrink-0">{noun}</span> : null}
      </span>,
    );
  }

  return (
    <div
      className={cn(
        'space-y-1',
        className,
      )}
    >
      <p
        aria-label="Reputation summary"
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug',
        )}
      >
        {bits.map((bit, idx) => (
          <span key={idx} className="inline-flex items-center">
            {bit}
          </span>
        ))}
      </p>
      {party.legalEntityName ? (
        <p className="truncate text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{party.legalEntityName}</span>
        </p>
      ) : null}
    </div>
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
      </div>

      <ContractPartyStats party={party} className="pt-3" />
      {party.socialLinks ? <SocialLinksDisplay socialLinks={party.socialLinks} compact /> : null}
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
  showDetails = false,
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
