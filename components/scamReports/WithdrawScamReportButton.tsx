'use client';

// components/scamReports/WithdrawScamReportButton.tsx
//
// Withdraw one of your own scam reports. Confirmed first, because it cannot be undone:
// the report stops matching at once and is deleted 90 days later.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { withdrawScamReport } from '@/lib/actions/scamReports';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function WithdrawScamReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function withdraw() {
    startTransition(async () => {
      const result = await withdrawScamReport(reportId);
      if (result.ok) {
        setOpen(false);
        toast.success('Report withdrawn.');
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={isPending}>
        Withdraw
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Withdraw this report?"
        description="We'll stop using it straight away and delete it after 90 days. You can't undo this."
        confirmLabel="Withdraw report"
        confirmVariant="destructive"
        cancelLabel="Keep it"
        pending={isPending}
        onConfirm={withdraw}
      />
    </>
  );
}
