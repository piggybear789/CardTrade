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
// Saving re-prices the contract from the new lines and clears BOTH acceptances,
// so each party has to accept again. That is the point rather than a side effect:
// swapping one card for another of equal value changes what is being bought, and
// nobody should be bound to goods they did not agree to.
//
// There is no price field. A shopfront contract's price IS the sum of these
// lines; a second way to set it would be a second source of truth for the number
// that gets charged.

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
  ContractLineItemsEditor,
  draftTotalCents,
  toDraftLines,
  toLineItemInput,
  type ContractLine,
  type DraftLine,
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
}: {
  cashSaleId: string;
  /** The version being edited; a mismatch means the counterparty got there first. */
  termsVersion: number;
  lines: readonly ContractLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>(() => toDraftLines(lines));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const next = toLineItemInput(draft);
    if (next.length === 0) {
      setError('A contract has to cover at least one item.');
      return;
    }
    if (draftTotalCents(draft) <= 0) {
      setError('The total has to be more than zero.');
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateCashSaleItems(cashSaleId, termsVersion, next);
      if (result.ok) {
        setOpen(false);
        toast.success('Items updated. You both need to accept the new terms.');
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
          setDraft(toDraftLines(lines));
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PencilLine aria-hidden />
          Change items
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change what this contract covers</DialogTitle>
          <DialogDescription>
            The total is worked out from these items. Saving clears both
            acceptances, so you will each need to accept the new terms.
          </DialogDescription>
        </DialogHeader>

        <ContractLineItemsEditor
          lines={draft}
          onChange={setDraft}
          disabled={isPending}
          error={error}
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
