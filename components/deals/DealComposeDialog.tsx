'use client';

import { useRouter } from 'next/navigation';

import { DealComposeForm } from '@/components/deals/DealComposeForm';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export function DealComposeDialog() {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) router.push('/');
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DealComposeForm />
      </DialogContent>
    </Dialog>
  );
}
