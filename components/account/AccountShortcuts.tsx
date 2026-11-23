'use client';
// components/account/AccountShortcuts.tsx
//
// The phone Account hub's shortcuts: everything a member does on the marketplace, as one
// grid of icon tiles above the settings tabs. Phone only; desktop has the rail.
//
// WHY A GRID, NOT TWO LISTS (2026-11-23). These eight destinations were two grouped lists
// of four full-width rows, about 500px of the first screen, so the Profile / Verification /
// Payouts tabs started under the bottom bar and a member opening Account saw no settings
// at all. Shop, Yami and Depop put the same "where are my things" links in a compact
// tile grid at the top of the account tab and keep the list rows for settings. Two rows of
// four tiles say the same eight things in about a third of the height.
//
// Grouped by what the member is doing, one row each: what is waiting on them (activity,
// saves, offers, their listings), then their contracts. The rows are the rail's own groups
// (`CONTRACT_LINKS`), so the two cannot drift.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  BellIcon,
  HandCoinsIcon,
  HandshakeIcon,
  HeartIcon,
  TagsIcon,
} from '@hugeicons/core-free-icons';

import { CONTRACT_LINKS } from '@/components/layout/marketplace-nav-config';
import { useStartDeal } from '@/components/deals/StartDealProvider';
import { CountBadge } from '@/components/ui/count-badge';
import { cn } from '@/lib/utils';

const TILE =
  'relative flex min-h-[4.75rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg px-tight py-snug text-center touch-manipulation transition-colors active:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

function TileBody({
  icon,
  label,
  count = 0,
}: {
  icon: IconSvgElement;
  label: string;
  count?: number;
}) {
  return (
    <>
      <span className="relative grid size-10 place-items-center rounded-full bg-muted text-foreground">
        <HugeiconsIcon icon={icon} className="size-5" strokeWidth={1.75} aria-hidden />
        <CountBadge count={count} className="absolute -right-1 -top-1 ring-2 ring-card" />
      </span>
      <span className="w-full truncate text-meta font-medium text-foreground">{label}</span>
    </>
  );
}

function Tile({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: IconSvgElement;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={TILE}
      aria-label={count && count > 0 ? `${label}, ${count} waiting` : undefined}
    >
      <TileBody icon={icon} label={label} count={count} />
    </Link>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-4 gap-tight">
      {children}
    </div>
  );
}

export function AccountShortcuts({
  unreadNotifications,
  offersWaiting,
  className,
}: {
  /** Unread in-app notifications. */
  unreadNotifications: number;
  /** Pending offers whose next move is this member's. */
  offersWaiting: number;
  className?: string;
}) {
  const { openDeal } = useStartDeal();
  return (
    <nav
      aria-label="Your activity"
      className={cn('surface space-y-tight rounded-xl bg-card p-tight', className)}
    >
      <Row label="Activity">
        <Tile href="/notifications" icon={BellIcon} label="Activity" count={unreadNotifications} />
        <Tile href="/saved" icon={HeartIcon} label="Saved" />
        <Tile href="/offers" icon={HandCoinsIcon} label="Offers" count={offersWaiting} />
        <Tile href="/listings/mine" icon={TagsIcon} label="Listings" />
      </Row>
      <div className="mx-snug h-px bg-border" aria-hidden />
      <Row label="Contracts">
        {CONTRACT_LINKS.map((link) => (
          <Tile key={link.href} href={link.href} icon={link.icon} label={link.label} />
        ))}
        <button type="button" onClick={openDeal} className={TILE}>
          <TileBody icon={HandshakeIcon} label="Private Deal" />
        </button>
      </Row>
    </nav>
  );
}
