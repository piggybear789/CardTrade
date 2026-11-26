'use client';

// components/sales/BankTransferInstructions.tsx
//
// Where a buyer sends a bank transfer for a cash sale (the BANK_TRANSFER rail). Unlike
// every other bank rail there is nothing to approve in a form: the buyer opens their own
// bank and sends the money to the account Stripe issued them, quoting the reference.
//
// The details come from the provider's read of the payment, never from storage, so a
// reload or another device shows the same account and the amount still owed. Nothing
// here moves money; the payment settles when Stripe matches the incoming transfer, and
// the room updates by itself (webhook and Realtime).

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { BANK_TRANSFER_WAIT_HOURS } from '@/domain/payments/paymentMethods';
import type { BankTransferInstructions as Instructions } from '@/domain/services/types';
import { formatMoney } from '@/lib/format';

function CopyRow({ label, value, emphasise = false }: { label: string; value: string; emphasise?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center justify-between gap-cozy py-snug">
      <div className="min-w-0">
        <p className="text-meta text-muted-foreground">{label}</p>
        <p className={emphasise ? 'break-all font-semibold tabular-nums' : 'break-all tabular-nums'}>{value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error('Could not copy. Select the text instead.');
          }
        }}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

export function BankTransferInstructions({
  instructions,
  totalMinor,
}: {
  instructions: Instructions;
  /** The whole amount for this sale, to say when part has already arrived. */
  totalMinor: number;
}) {
  const money = (minor: number) => formatMoney(minor, instructions.currency);
  const partlyPaid = instructions.amountRemaining > 0 && instructions.amountRemaining < totalMinor;
  return (
    <div className="space-y-group">
      <div className="divide-y rounded-lg border px-cozy">
        <CopyRow label="Amount to send" value={money(instructions.amountRemaining)} emphasise />
        {instructions.reference ? (
          <CopyRow label="Reference (include it exactly)" value={instructions.reference} emphasise />
        ) : null}
        {instructions.accountHolderName ? (
          <CopyRow label="Account name" value={instructions.accountHolderName} />
        ) : null}
        {instructions.routingNumber ? <CopyRow label="Routing number" value={instructions.routingNumber} /> : null}
        {instructions.accountNumber ? <CopyRow label="Account number" value={instructions.accountNumber} /> : null}
        {instructions.bankName ? <CopyRow label="Bank" value={instructions.bankName} /> : null}
      </div>

      <ul className="list-disc space-y-tight pl-5 text-body text-muted-foreground">
        {partlyPaid ? (
          <li>
            Part of this has arrived. Send the remaining {money(instructions.amountRemaining)} with the same
            reference.
          </li>
        ) : null}
        <li>
          Send it from your own US bank as an ACH transfer or a wire. ACH usually arrives within a business day.
        </li>
        <li>
          The card stays reserved for you for {BANK_TRANSFER_WAIT_HOURS / 24} days. If nothing arrives by then the
          sale is cancelled and anything you sent is returned to your bank.
        </li>
        <li>This page updates by itself once the money arrives. NoDitto holds it until you accept the card.</li>
      </ul>

      {instructions.hostedInstructionsUrl ? (
        <Button asChild variant="outline" className="w-full">
          <a href={instructions.hostedInstructionsUrl} target="_blank" rel="noopener noreferrer">
            Open printable instructions
          </a>
        </Button>
      ) : null}
    </div>
  );
}
