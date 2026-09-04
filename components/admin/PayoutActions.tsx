'use client';

// components/admin/PayoutActions.tsx
//
// Operator controls for Cash_Sale Seller releases (Req 4.3).
//
// WHY THIS SCREEN MATTERS. A release in PENDING or FAILED means the Buyer has
// been debited and the platform is holding money that belongs to the Seller. The
// hourly drain retries on its own, but until this existed the only way to see the
// situation at all was a database query.
//
// Pressing retry repeatedly is harmless: the release reuses the sale's persisted
// nonce, so the provider deduplicates instead of paying twice.

import { useState, useTransition } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon, RefreshCwIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { drainCashSalePayouts, retryCashSalePayout } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to perform this action.',
  'not-found': 'That sale no longer exists.',
  'persistence-error': 'The release could not be completed.',
};

export interface RetryPayoutButtonProps {
  cashSaleId: string;
}

/** Retry one owed release. */
export function RetryPayoutButton({ cashSaleId }: RetryPayoutButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await retryCashSalePayout(cashSaleId);
      if (result.ok) {
        
        return;
      }
      // Prefer the action's specific message — "the seller cannot receive funds
      // yet" is far more useful to an operator than a generic failure.
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Retry failed.');
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
      aria-busy={isPending}
    >
      {isPending ? (
        <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
      ) : (
        <HugeiconsIcon icon={RefreshCwIcon} aria-hidden />
      )}
      Retry release
    </Button>
  );
}

/** Run one pass of the whole owed-release queue. */
export function DrainPayoutsButton() {
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      const result = await drainCashSalePayouts();
      if (result.ok) {
        const { considered, settled, stillOwed } = result.data;
        setSummary(
          considered === 0
            ? 'Nothing owed.'
            : `${settled} of ${considered} released, ${stillOwed} still owed.`,
        );
        
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Drain failed.');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-snug">
      <Button
        type="button"
        size="sm"
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? (
          <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
        ) : (
          <HugeiconsIcon icon={RefreshCwIcon} aria-hidden />
        )}
        Run release queue
      </Button>
      {summary ? (
        <span aria-live="polite" className="text-body text-muted-foreground">
          {summary}
        </span>
      ) : null}
    </div>
  );
}
