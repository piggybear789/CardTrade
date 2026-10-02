'use client';

import { useRouter } from 'next/navigation';

import { DealComposeForm, type DealComposeFormProps } from '@/components/deals/DealComposeForm';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export function DealComposeDialog(props: Omit<DealComposeFormProps, 'onSuccess'>) {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) router.push('/');
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DealComposeForm {...props} />
      </DialogContent>
    </Dialog>
  );
}
