'use client';

// components/payments/AddPaymentMethodDialog.tsx
//
// Standalone dialog wrapper for the payment method form. Used on the profile
// page as a proactive entry point. The BuyButton uses the inline
// `AddPaymentMethodForm` directly without this wrapper.

import { cloneElement, isValidElement, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { CreditCardIcon } from '@hugeicons/core-free-icons';

import { PaymentFormSkeleton } from '@/components/payments/PaymentFormSkeleton';

const AddPaymentMethodForm = dynamic(
  () => import('./AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => <PaymentFormSkeleton />,
  },
);

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
    <>
      {trigger ? (
        isValidElement<{ onClick?: () => void }>(trigger) ? (
          cloneElement(trigger, {
            onClick: () => setOpen(true),
          })
        ) : (
          <div onClick={() => setOpen(true)}>{trigger}</div>
        )
      ) : (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <HugeiconsIcon icon={CreditCardIcon} aria-hidden />
          Add payment method
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a payment method</DialogTitle>
          <DialogDescription>
            Stripe stores the card. Nothing is charged until you agree to a purchase.
          </DialogDescription>
        </DialogHeader>
        <AddPaymentMethodForm
          onAttached={() => {
            setOpen(false);
            // The card is stored server-side, so confirm it and re-render the
            // page that shows it. Without this the dialog just closed and the
            // save looked like it had not happened.
            
            router.refresh();
            onAttached?.();
          }}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
