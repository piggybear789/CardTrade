'use client';

// components/deals/QuickProfileFields.tsx
//
// The two questions a brand-new account answers before a deal link is created or
// joined: the name other members see, and where they trade. Submitted through
// `completeQuickOnboarding`. Shared by the composer and the join form so the two
// ask them the same way.

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SelectableRegion } from '@/lib/actions/regionOptions';

export function QuickProfileFields({
  idPrefix,
  displayName,
  onDisplayName,
  regionCode,
  onRegion,
  regions,
  quoteCurrency,
}: {
  idPrefix: string;
  displayName: string;
  onDisplayName: (value: string) => void;
  regionCode: string;
  onRegion: (value: string) => void;
  regions: SelectableRegion[];
  /** The currency figures were quoted in, so a change of country can say so. */
  quoteCurrency?: string | null;
}) {
  const chosen = regions.find((region) => region.code === regionCode) ?? null;
  const currencyChanges = chosen != null && quoteCurrency != null && chosen.currency !== quoteCurrency;
  return (
    <>
      <div className="space-y-snug">
        <Label htmlFor={`${idPrefix}-display-name`}>Name other members see</Label>
        <Input
          id={`${idPrefix}-display-name`}
          value={displayName}
          onChange={(event) => onDisplayName(event.target.value)}
          maxLength={50}
          autoComplete="nickname"
        />
      </div>
      <div className="space-y-snug">
        <Label htmlFor={`${idPrefix}-region`}>Where you trade</Label>
        <Select value={regionCode} onValueChange={onRegion}>
          <SelectTrigger id={`${idPrefix}-region`}>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {regions.map((region) => (
              <SelectItem key={region.code} value={region.code}>
                {region.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-meta text-muted-foreground">
          {currencyChanges
            ? `Deals stay inside one country. Your price will be in ${chosen.currency.toUpperCase()}.`
            : 'Deals stay inside one country.'}
        </p>
      </div>
    </>
  );
}
