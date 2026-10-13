'use client';

// components/admin/ExposureOverrideForm.tsx
//
// Staff override of a seller's open-sales limit (ESC-03 layer 1).
//
// A new seller may hold only so much collected-but-unreleased money at once, so a
// stolen-card cash-out through a fresh account is capped. A known trader with a big
// binder may need more, and a suspicious one may need pausing: a figure replaces the
// default limit for that seller, 0 pauses them, and clearing it restores the default.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setExposureLimitOverride } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PendingLabel } from '@/components/ui/pending-label';

export function ExposureOverrideForm() {
  const [isPending, startTransition] = useTransition();
  const [profileId, setProfileId] = useState('');
  const [dollars, setDollars] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  function submit(clear: boolean) {
    setFieldError(null);
    const trimmed = dollars.trim();
    let limitMinor: number | null = null;
    if (!clear) {
      if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        setFieldError('Enter an amount like 2500 or 2500.00, or clear the override.');
        return;
      }
      limitMinor = Math.round(Number(trimmed) * 100);
    }
    startTransition(async () => {
      const result = await setExposureLimitOverride(profileId.trim(), limitMinor);
      if (result.ok) {
        toast.success(clear ? 'Override cleared.' : 'Override saved.');
        return;
      }
      if (result.field === 'limitMinor') {
        setFieldError(result.message ?? 'That amount is not valid.');
        return;
      }
      toast.error(result.message ?? 'The override could not be saved.');
    });
  }

  return (
    <section
      aria-labelledby="exposure-override-heading"
      className="mb-group space-y-snug rounded-lg border border-border p-cozy"
    >
      <h3 id="exposure-override-heading" className="text-subhead font-semibold">
        Seller open-sales limit
      </h3>
      <p className="text-body text-muted-foreground">
        New sellers can hold a limited amount in open sales at once. Set a figure to replace
        that limit for one seller, 0 to pause them, or clear it to restore the default.
      </p>
      <div className="grid gap-snug sm:grid-cols-[2fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-tight">
          <Label htmlFor="exposure-profile">Seller profile ID</Label>
          <Input
            id="exposure-profile"
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-tight">
          <Label htmlFor="exposure-limit">Limit (dollars)</Label>
          <Input
            id="exposure-limit"
            inputMode="decimal"
            value={dollars}
            onChange={(event) => setDollars(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'exposure-limit-error' : undefined}
          />
        </div>
        <Button type="button" size="sm" disabled={isPending || !profileId.trim()} onClick={() => submit(false)}>
          <PendingLabel pending={isPending}>Save limit</PendingLabel>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || !profileId.trim()}
          onClick={() => submit(true)}
        >
          Clear override
        </Button>
      </div>
      {fieldError ? (
        <p id="exposure-limit-error" role="alert" className="text-body text-destructive">
          {fieldError}
        </p>
      ) : null}
    </section>
  );
}
