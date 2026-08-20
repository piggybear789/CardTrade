'use client';

// components/payments/AddPaymentMethodDialog.tsx
//
// Standalone dialog wrapper for the payment method form. Used on the profile
// page as a proactive entry point. The BuyButton uses the inline
// `AddPaymentMethodForm` directly without this wrapper.

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const AddPaymentMethodForm = dynamic(
  () => import('./AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-gold" aria-hidden />
        <span className="sr-only">Loading payment form…</span>
      </div>
    ),
  },
);

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface AddPaymentMethodDialogProps {
  /** Custom trigger element. Defaults to a plain "Add payment method" button. */
  trigger?: React.ReactNode;
  /** Called after a card is successfully attached. */
  onAttached?: () => void;
}

export function AddPaymentMethodDialog({ trigger, onAttached }: AddPaymentMethodDialogProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline">
            <CreditCard aria-hidden />
            Add payment method
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {/* Negative margin cancels DialogContent's flex gap: with the
            description gone there is nothing to separate the title from
            Stripe's own bordered card. */}
        <DialogHeader className="-mb-3 sm:-mb-4">
          <DialogTitle>Add a payment method</DialogTitle>
        </DialogHeader>
        <AddPaymentMethodForm
          onAttached={() => {
            setOpen(false);
            // The card is stored server-side, so confirm it and re-render the
            // page that shows it. Without this the dialog just closed and the
            // save looked like it had not happened.
            toast.success('Payment method saved with Stripe.');
            router.refresh();
            onAttached?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
