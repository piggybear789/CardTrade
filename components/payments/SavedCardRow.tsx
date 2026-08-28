'use client';

// components/payments/SavedCardRow.tsx
//
// The card that will be authorised for a trade hold, with Replace in the same
// surface. Profile is no longer the only place to swap it — the accept modal
// and the trade room both need that control, because accept uses the vaulted
// default off-session and never asked which card.

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { HugeiconsIcon } from '@hugeicons/react';
import { CreditCardIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';

const AddPaymentMethodForm = dynamic(
  () => import('./AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center" role="status">
        <HugeiconsIcon icon={LoaderCircleIcon} className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading payment form…</span>
      </div>
    ),
  },
);

/** What `getPaymentMethodStatus` resolves to. */
export interface SavedCardStatus {
  hasPaymentMethod: boolean;
  label: string | null;
  expiry: string | null;
}

export interface SavedCardRowProps {
  /**
   * Replace/Add the card in this same panel (for a dialog that already has a
   * card form). Off: Replace opens the standalone dialog, for the trade room.
   */
  inline?: boolean;
  /**
   * The status as the server already knew it, so the real row is in the first
   * paint. Without it this renders a one-line "Checking your card…" and then
   * grows into a ~76px bordered row — directly above the Accept button in the
   * trade room, and inside the accept dialog, which then resizes mid-read.
   *
   * Omit it and the component falls back to fetching on mount, which is still
   * correct for surfaces with no server parent to seed from.
   */
  initialStatus?: SavedCardStatus | null;
  /** True when a vaulted card is on file and not mid-replace. */
  onStatus?: (hasCard: boolean) => void;
  className?: string;
}

export function SavedCardRow({
  inline = false,
  initialStatus = null,
  onStatus,
  className,
}: SavedCardRowProps) {
  const [label, setLabel] = useState<string | null>(initialStatus?.label ?? null);
  const [expiry, setExpiry] = useState<string | null>(initialStatus?.expiry ?? null);
  const [hasCard, setHasCard] = useState<boolean | null>(
    initialStatus ? initialStatus.hasPaymentMethod : null,
  );
  const [replacing, setReplacing] = useState(false);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const applyStatus = useCallback(
    (next: { hasPaymentMethod: boolean; label: string | null; expiry: string | null }) => {
      setHasCard(next.hasPaymentMethod);
      setLabel(next.label);
      setExpiry(next.expiry);
    },
    [],
  );

  useEffect(() => {
    onStatusRef.current?.(hasCard === true && !replacing);
  }, [hasCard, replacing]);

  const refresh = useCallback(() => {
    void getPaymentMethodStatus()
      .then((result) => {
        if (result.ok) applyStatus(result.data);
        else applyStatus({ hasPaymentMethod: false, label: null, expiry: null });
      })
      .catch(() => applyStatus({ hasPaymentMethod: false, label: null, expiry: null }));
  }, [applyStatus]);

  // A seeded row is already showing the answer, so re-asking on mount would
  // spend a round trip to redraw the same thing. Later refreshes (after a card
  // is added or replaced) still go through `refresh`.
  const skipInitialFetch = useRef(initialStatus !== null);
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    refresh();
  }, [refresh]);

  if (inline && (replacing || hasCard === false)) {
    return (
      <div className={className}>
        {hasCard && replacing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-snug"
            onClick={() => setReplacing(false)}
          >
            Keep current card
          </Button>
        ) : null}
        <AddPaymentMethodForm
          onAttached={() => {
            setReplacing(false);
            refresh();
          }}
        />
      </div>
    );
  }

  if (hasCard === null) {
    return (
      <div className={className} role="status">
        <p className="text-body text-muted-foreground">Checking your card…</p>
      </div>
    );
  }

  const replaceControl = inline ? (
    <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(true)}>
      Replace
    </Button>
  ) : (
    <AddPaymentMethodDialog
      trigger={
        <Button type="button" variant="ghost" size="sm">
          {hasCard ? 'Replace' : 'Add card'}
        </Button>
      }
      onAttached={refresh}
    />
  );

  return (
    <div className={className}>
      <div className="flex items-center gap-cozy rounded-lg border p-cozy">
        <HugeiconsIcon icon={CreditCardIcon} className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium">
            {hasCard ? (label ?? 'Card on file') : 'No card on file'}
          </p>
          <p className="text-body text-muted-foreground">
            {hasCard
              ? expiry
                ? `Expires ${expiry}`
                : 'Authorised when both of you accept. Not a charge.'
              : 'Needed to lock this trade.'}
          </p>
        </div>
        {replaceControl}
      </div>
    </div>
  );
}
