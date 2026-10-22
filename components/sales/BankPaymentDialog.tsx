'use client';

// components/sales/BankPaymentDialog.tsx
//
// The second Pay step for a bank rail (0158). The first step chose the rail and showed
// its fee; this one is where the buyer approves exactly that amount in their bank. The
// amount and the fee are restated here because a redirect can take the buyer away for a
// while, and they should leave knowing what their bank is about to ask them to approve.

import dynamic from 'next/dynamic';

import { PaymentFormSkeleton } from '@/components/payments/PaymentFormSkeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { paymentMethodDefinition, type PaymentMethodKind } from '@/domain/payments/paymentMethods';
import type { CashSaleActionResult } from '@/lib/actions/cashSale';

const BankPaymentForm = dynamic(
  () => import('./BankPaymentForm').then((m) => m.BankPaymentForm),
  { ssr: false, loading: () => <PaymentFormSkeleton /> },
);

export interface BankPaymentSession {
  clientSecret: string;
  publishableKey?: string;
  method: PaymentMethodKind;
  /** The total and fee the claim priced, when known before the row re-renders. */
  totalMinor?: number;
  feeMinor?: number;
}

export function BankPaymentDialog({
  cashSaleId,
  session,
  totalLabel,
  feeLabel,
  onOpenChange,
  onFinished,
}: {
  cashSaleId: string;
  /** Null closes the dialog. */
  session: BankPaymentSession | null;
  /** The total being approved, formatted in the contract currency. */
  totalLabel: string;
  /** The service fee inside that total, formatted. */
  feeLabel: string;
  onOpenChange: (open: boolean) => void;
  onFinished: (result: CashSaleActionResult) => void;
}) {
  const rail = session ? paymentMethodDefinition(session.method) : null;
  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rail ? `Pay with ${rail.label}` : 'Pay from your bank'}</DialogTitle>
          <DialogDescription>
            Approve {totalLabel} in your bank, including the {feeLabel} service fee. Nothing
            is taken until you approve it, and NoDitto holds the payment until you accept
            the item.
          </DialogDescription>
        </DialogHeader>
        {session && rail ? (
          <BankPaymentForm
            cashSaleId={cashSaleId}
            clientSecret={session.clientSecret}
            {...(session.publishableKey ? { publishableKey: session.publishableKey } : {})}
            submitLabel={`Pay ${totalLabel} with ${rail.label}`}
            onFinished={onFinished}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
