'use client';

// components/payments/SavedCardRow.tsx
//
// The card that will be authorised for a trade hold, with Replace in the same
// surface. Profile is no longer the only place to swap it — the accept modal
// and the trade room both need that control, because accept uses the vaulted
// default off-session and never asked which card.

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { CreditCard, Loader2 } from 'lucide-react';

import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';

const AddPaymentMethodForm = dynamic(
  () => import('./AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading payment form…</span>
      </div>
    ),
  },
);

export interface SavedCardRowProps {
  /**
   * Replace/Add the card in this same panel (for a dialog that already has a
   * card form). Off: Replace opens the standalone dialog, for the trade room.
   */
  inline?: boolean;
  /** True when a vaulted card is on file and not mid-replace. */
  onStatus?: (hasCard: boolean) => void;
  className?: string;
}

export function SavedCardRow({ inline = false, onStatus, className }: SavedCardRowProps) {
  const [label, setLabel] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [hasCard, setHasCard] = useState<boolean | null>(null);
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

  useEffect(() => {
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
        <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden />
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
