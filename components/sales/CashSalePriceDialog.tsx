'use client';

// components/sales/CashSalePriceDialog.tsx
// Renegotiate the agreed item price. Saving posts a chat note to the other party
// and clears both acceptances, so nothing is charged on the old number.

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { Loader2, TicketPercent } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { proposeCashSalePrice } from '@/lib/actions/cashSale';
import { formatAud } from '@/lib/format';

export interface CashSalePriceDialogProps {
  cashSaleId: string;
  termsVersion: number;
  agreedPriceCents: number;
}

export function CashSalePriceDialog({
  cashSaleId,
  termsVersion,
  agreedPriceCents,
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
        toast.success(`Price change to ${formatAud(cents)} sent.`);
        setOpen(false);
      } else {
        setError(result.message ?? 'The price could not be changed. Refresh and retry.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <TicketPercent aria-hidden />
          Request price change
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Request a price change</DialogTitle>
            <DialogDescription>
              The other party is told in chat and both acceptances reset, so nothing
              is charged until you agree on the new number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="sale-price">Item price (AUD)</Label>
              <Input
                id="sale-price"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Currently {formatAud(agreedPriceCents)}. Shipping and the platform fee
                are shown separately.
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
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
