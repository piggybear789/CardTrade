'use client';

// components/payments/AddPaymentMethodDialog.tsx
//
// Standalone dialog wrapper for the payment method form. Used on the profile
// page as a proactive entry point. The BuyButton uses the inline
// `AddPaymentMethodForm` directly without this wrapper.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';

import { AddPaymentMethodForm } from './AddPaymentMethodForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
        <DialogHeader>
          <DialogTitle>Add a payment method</DialogTitle>
          <DialogDescription>
            Encrypted in your browser and sent to Pinch Payments — we never
            store your full card number.
          </DialogDescription>
        </DialogHeader>
        <AddPaymentMethodForm
          onAttached={() => {
            setOpen(false);
            // The card is stored server-side, so confirm it and re-render the
            // page that shows it. Without this the dialog just closed and the
            // save looked like it had not happened.
            toast.success('Payment method saved with Pinch Payments.');
            router.refresh();
            onAttached?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
