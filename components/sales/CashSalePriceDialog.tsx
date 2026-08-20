'use client';

// components/sales/CashSalePriceDialog.tsx
// Renegotiate the agreed item price. Saving posts a chat note to the other party
// and bumps the terms version, so payment uses the new number.

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { Loader2, TicketPercent as Pencil } from 'lucide-react';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { proposeCashSalePrice } from '@/lib/actions/cashSale';
import { formatMoney } from '@/lib/format';

export interface CashSalePriceDialogProps {
  /** The contract's currency (0068), so the confirmation quotes the real one. */
  currency: string;
  cashSaleId: string;
  termsVersion: number;
  agreedPriceCents: number;
}

export function CashSalePriceDialog({
  cashSaleId,
  termsVersion,
  agreedPriceCents,
  currency,
}: CashSalePriceDialogProps) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState((agreedPriceCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) return;
    setPrice((agreedPriceCents / 100).toFixed(2));
    setError(null);
  }, [open, agreedPriceCents]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const dollars = Number.parseFloat(price);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter a price greater than zero.');
      return;
    }
    const cents = Math.round(dollars * 100);
    setError(null);
    startTransition(async () => {
      const result = await proposeCashSalePrice(cashSaleId, termsVersion, cents);
      if (result.ok) {
        toast.success(`Price change to ${formatMoney(cents, currency)} sent.`);
        setOpen(false);
      } else {
        setError(result.message ?? 'The price could not be changed. Refresh and retry.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-tight px-2 text-meta font-medium leading-none [&_svg]:size-3"
        >
          <Pencil aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Request a price change</DialogTitle>
            <DialogDescription>
              Update the item price. Shipping and the platform fee stay separate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-group py-5">
            <div className="space-y-snug">
              <Label htmlFor="sale-price">Item price</Label>
              <MoneyInput
                id="sale-price"
                // An asking price of zero is not a real answer, unlike postage.
                min="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
              />
              <p className="text-body text-muted-foreground">
                Currently {formatMoney(agreedPriceCents, currency)}. Shipping and the platform fee
                are shown separately.
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-body text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
