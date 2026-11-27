'use client';

// components/contract/ContractSummary.tsx
//
// The Summary tab's fact sheet, shared by the trade and cash-sale rooms (UX review
// 2026-11-27). Each fact is one row: a small grey label on the left, the answer on
// the right. Photos and the map are thumbnails beside the text, so a whole contract
// fits in a few hundred pixels and the tab ends where the facts end, instead of
// trailing into a full-height map or blank space. Long or rarely needed things
// (the payment breakdown, collateral, evidence, history) keep their own tabs.

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import { ArrowSquareOutIcon, MapPinIcon } from '@/components/ui/icons';

import { formatMoney } from '@/lib/format';
import { mapsExternalUrl, staticMapUrl } from '@/lib/location/googleMaps';
import { cn } from '@/lib/utils';
import { ContractThumbnails } from './ContractImageLightbox';

/** The rows, separated by hairlines. */
export function SummaryList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-border/60 text-body', className)}>{children}</div>;
}

/** One fact: label left, answer right. Stacks on a narrow sheet. */
export function SummaryRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-group gap-y-tight py-cozy first:pt-0 sm:grid-cols-[6rem_minmax(0,1fr)]',
        className,
      )}
    >
      <p className="pt-px text-meta text-muted-foreground">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A photo, a title with a qualifier under it, and a value on the right. */
export function SummaryItem({
  title,
  subtitle,
  images,
  valueCents,
  currency,
  trailing,
}: {
  title: string;
  subtitle?: ReactNode;
  images?: string[];
  valueCents?: number | null;
  currency: string;
  /** Replaces the value, e.g. an edit control. */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-snug">
      <ContractThumbnails images={images ?? []} label={title} size="sm" max={1} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{title}</p>
        {subtitle ? <div className="truncate text-meta text-muted-foreground">{subtitle}</div> : null}
      </div>
      {trailing ??
        (valueCents != null ? (
          <span className="display-value shrink-0">{formatMoney(valueCents, currency)}</span>
        ) : null)}
    </div>
  );
}

/** Label / value pairs inside one row: a fee, the cash, a total. */
export function SummaryFigures({
  rows,
}: {
  rows: { label: ReactNode; value: ReactNode; total?: boolean; muted?: boolean }[];
}) {
  return (
    <dl className="space-y-tight">
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            'flex items-baseline justify-between gap-cozy',
            row.total && 'border-t border-border/60 pt-tight font-semibold',
          )}
        >
          <dt className={cn(!row.total && 'text-foreground')}>{row.label}</dt>
          <dd className={cn('text-right tabular-nums', row.muted && 'text-muted-foreground', row.total && 'display-value')}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A small map with a pin, opening Maps. A pin tile when there is no picture. */
export function MapThumb({
  lat,
  lng,
  label,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string | null;
}) {
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const src = hasCoords ? staticMapUrl(lat, lng, { width: 184, height: 128, precision: 'exact' }) : null;
  const href = hasCoords ? mapsExternalUrl(lat, lng, label ?? undefined) : null;
  const box = 'block h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-muted';
  const inner = src ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote static map
    <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
  ) : (
    <span className="grid h-full w-full place-items-center text-muted-foreground">
      <Icon icon={MapPinIcon} className="size-5" aria-hidden />
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={box} aria-label="Open in Maps">
      {inner}
    </a>
  ) : (
    <span className={box}>{inner}</span>
  );
}

/** "Get directions ↗" for a place. */
export function DirectionsLink({
  lat,
  lng,
  label,
  children = 'Get directions',
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string | null;
  children?: ReactNode;
}) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return (
    <a
      href={mapsExternalUrl(lat, lng, label ?? undefined)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-6 items-center gap-tight text-meta font-semibold text-iris-ink underline-offset-4 hover:underline"
    >
      {children}
      <Icon icon={ArrowSquareOutIcon} className="size-3" aria-hidden />
    </a>
  );
}
