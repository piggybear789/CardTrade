'use client';

// components/sales/EditContractItemsDialog.tsx
//
// Renegotiate WHAT a shopfront contract covers (0064).
//
// Either party may edit, because either may be the one who spotted the problem —
// the buyer wants a fourth card, or the seller has already sold the Charizard to
// someone else and needs to substitute. This mirrors `proposeCashSalePrice`,
// which is likewise open to both sides.
//
// Saving re-prices the contract and clears BOTH acceptances, so each party has to
// accept again. That is the point rather than a side effect: swapping one card for
// another of equal value changes what is being bought, and nobody should be bound
// to goods they did not agree to.
//
// SAME TWO FIELDS THE BUYER OPENED WITH. This used to be the itemised grid while
// the buyer's side was already prose, which is exactly the drift
// `ContractLineItems` exists to prevent: the buyer wrote a sentence and then found
// their own request rendered back as a spreadsheet to fill in. There is still only
// one source of truth for the number charged — the price here IS the contract's
// single line, and `replace_cash_sale_items` re-derives the same sum in SQL and
// aborts if the two disagree.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, PencilLine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { updateCashSaleItems } from '@/lib/actions/cashSale';
import {
  ContractRequestFields,
  requestTotalCents,
  toRequestDraft,
  toRequestLineItems,
  type ContractLine,
  type RequestDraft,
} from '@/components/sales/ContractLineItems';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in again.',
  'not-participant': 'You are not a party to this contract.',
  'not-supported': 'This contract covers a single listed item, so its contents are fixed.',
  'invalid-state': 'Contents are locked once payment has started.',
  'stale-terms':
    'The contract changed while you were editing. Close this and review the current version.',
  'invalid-terms': 'Check the items, quantities and prices.',
  'cash-sale-not-found': 'This contract no longer exists.',
};

export function EditContractItemsDialog({
  cashSaleId,
  termsVersion,
  lines,
  currency,
}: {
  cashSaleId: string;
  /** The version being edited; a mismatch means the counterparty got there first. */
  termsVersion: number;
  lines: readonly ContractLine[];
  /** The contract's own currency (0068), so the price is never shown as guessed. */
  currency?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RequestDraft>(() => toRequestDraft(lines));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const next = toRequestLineItems(draft);
    if (next.length === 0) {
      setError('Describe what this contract covers.');
      return;
    }
    if (requestTotalCents(draft) <= 0) {
      setError('The price has to be more than zero.');
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateCashSaleItems(cashSaleId, termsVersion, next);
      if (result.ok) {
        setOpen(false);
        toast.success('Items updated.');
        router.refresh();
        return;
      }
      setError(
        result.message ?? ERROR_MESSAGES[result.error] ?? 'Something went wrong.',
      );
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Re-seed on open so the editor always starts from the CURRENT contract
          // rather than a stale draft from a previous attempt.
          setDraft(toRequestDraft(lines));
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-tight px-2 text-meta font-medium leading-none [&_svg]:size-3"
        >
          <PencilLine aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change what this contract covers</DialogTitle>
          <DialogDescription>
            Change the items and price this sale covers.
          </DialogDescription>
        </DialogHeader>

        <ContractRequestFields
          value={draft}
          onChange={setDraft}
          disabled={isPending}
          error={error}
          currency={currency}
          idPrefix="edit-contract"
          descriptionLabel="What this contract covers"
          descriptionHint="This is what the sale covers, and what an arbitrator reads if it is disputed."
          priceLabel="Price"
        />

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {isPending ? 'Saving…' : 'Save items'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
