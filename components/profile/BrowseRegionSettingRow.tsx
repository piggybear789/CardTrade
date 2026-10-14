'use client';

// components/profile/BrowseRegionSettingRow.tsx
//
// "Browsing region" on the Account hub: which region's listings the catalog shows.
//
// A SETTING, NOT HEADER CHROME. Almost nobody needs to change this — the catalog
// already follows the member's trading region, or the IP guess for a visitor who
// has none — so a permanent control in the header was spending prime space on a
// rare action, and its "Choose your region" framing read as setting where you
// TRADE. It now lives here, defaults to Automatic, and says what it does.
//
// Every region in the registry is listed, open for deals or not: browsing is
// display only. Open regions come first and the rest are marked "Browse only", so
// nobody picks a region and then learns at checkout that it cannot complete a deal.
// The contract guards (`checkRegionCompatibility`) refuse regardless.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, GlobalIcon, Location01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { REGIONS, regionLabel, type RegionSource } from '@/domain/region';
import { setBrowseRegion } from '@/lib/actions/region';
import { ALL_REGIONS, AUTOMATIC_REGION } from '@/lib/location/regionParams';
import { SettingsListRow } from '@/components/account/SettingsPrimitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// By NAME, not by code: sorted by code, Switzerland (CH) sat between Canada and Czechia.
const byLabel = (a: (typeof REGIONS)[number], b: (typeof REGIONS)[number]) => a.label.localeCompare(b.label);
const OPEN_REGIONS = REGIONS.filter((r) => r.tradingEnabled).sort(byLabel);
const BROWSE_ONLY_REGIONS = REGIONS.filter((r) => !r.tradingEnabled).sort(byLabel);

export interface BrowseRegionSettingRowProps {
  /** The remembered choice: a region code, `all`, or `auto`. */
  choice: string;
  /** What Automatic resolves to right now, and why. */
  automatic: { code: string | null; source: RegionSource };
  /** The member's own trading region, for the "Your region" tag. */
  tradingRegion: string | null;
}

export function BrowseRegionSettingRow({
  choice,
  automatic,
  tradingRegion,
}: BrowseRegionSettingRowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const automaticLabel = automatic.code ? regionLabel(automatic.code) : 'All regions';
  const automaticReason =
    automatic.source === 'profile'
      ? 'your trading region'
      : automatic.source === 'geo'
        ? 'your location'
        : 'the default';

  const value =
    choice === AUTOMATIC_REGION
      ? `Automatic · ${automaticLabel}`
      : choice === ALL_REGIONS
        ? 'All regions'
        : regionLabel(choice);

  function select(next: string) {
    if (next === choice) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await setBrowseRegion(next);
      if (!result.ok) {
        toast.error(result.message ?? 'Your browsing region could not be saved.');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const renderRegion = (region: (typeof REGIONS)[number]) => (
    <RegionOption
      key={region.code}
      badge={<CodeStamp code={region.code} />}
      label={region.label}
      hint={
        region.tradingEnabled
          ? `Prices in ${region.currency.toUpperCase()}`
          : `Browse only · prices in ${region.currency.toUpperCase()}`
      }
      tag={region.code === tradingRegion ? 'Your region' : null}
      selected={choice === region.code}
      disabled={isPending}
      onSelect={() => select(region.code)}
    />
  );

  return (
    <>
      <SettingsListRow
        icon={Location01Icon}
        label="Browsing region"
        description="Which region's listings the marketplace shows."
        value={value}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Browsing region</DialogTitle>
            <DialogDescription>
              This only changes which listings you see. You can buy from or trade with
              members in countries your region deals with, wherever you browse.
            </DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label="Browsing region" className="space-y-tight">
            <RegionOption
              badge={<GlyphStamp icon={Location01Icon} />}
              label="Automatic"
              hint={`${automaticLabel}, from ${automaticReason}`}
              tag={null}
              selected={choice === AUTOMATIC_REGION}
              disabled={isPending}
              onSelect={() => select(AUTOMATIC_REGION)}
            />
            <RegionOption
              badge={<GlyphStamp icon={GlobalIcon} />}
              label="All regions"
              hint="Every listing, in its own currency"
              tag={null}
              selected={choice === ALL_REGIONS}
              disabled={isPending}
              onSelect={() => select(ALL_REGIONS)}
            />

            {/* Scrolls on its own so the two fixed choices above stay put. No search:
                the list is short enough to scan, and a box above it read as a form. */}
            <div className="-mx-tight !mt-group max-h-[min(22rem,50dvh)] space-y-tight overflow-y-auto border-t border-border px-tight pb-tight">
              <RegionGroup label="Open for deals">{OPEN_REGIONS.map(renderRegion)}</RegionGroup>
              {BROWSE_ONLY_REGIONS.length > 0 ? (
                <RegionGroup label="Browse only">{BROWSE_ONLY_REGIONS.map(renderRegion)}</RegionGroup>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RegionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-tight pt-snug">
      <p className="px-cozy text-meta font-medium text-muted-foreground" aria-hidden>
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * The two-letter country code set like a set symbol on a card: a small fixed
 * square, so the names beside it line up regardless of length.
 */
function CodeStamp({ code }: { code: string }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-meta font-semibold tabular-nums tracking-wider text-foreground"
      aria-hidden
    >
      {code}
    </span>
  );
}

function GlyphStamp({ icon }: { icon: typeof GlobalIcon }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"
      aria-hidden
    >
      <HugeiconsIcon icon={icon} className="size-4" />
    </span>
  );
}

interface RegionOptionProps {
  badge: ReactNode;
  label: string;
  hint: string;
  /** A short marker beside the label, e.g. "Your region". */
  tag: string | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function RegionOption({
  badge,
  label,
  hint,
  tag,
  selected,
  disabled,
  onSelect,
}: RegionOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-cozy rounded-md border border-transparent px-cozy py-snug text-left transition-colors focus:outline-none focus-visible:border-iris disabled:opacity-50',
        selected
          ? 'bg-accent text-accent-foreground'
          : 'hover:border-foreground/10 hover:bg-muted/40',
      )}
    >
      {badge}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-snug">
          <span className="truncate text-body font-medium">{label}</span>
          {tag ? (
            <span className="shrink-0 rounded-full bg-background/80 px-snug text-meta font-medium text-foreground ring-1 ring-border">
              {tag}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            'block text-meta',
            selected ? 'text-accent-foreground/75' : 'text-muted-foreground',
          )}
        >
          {hint}
        </span>
      </span>
      <HugeiconsIcon
        icon={CheckIcon}
        className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
        aria-hidden
      />
    </button>
  );
}
