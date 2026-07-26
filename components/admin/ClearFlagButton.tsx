'use client';

// components/admin/ClearFlagButton.tsx
//
// Client action button for clearing a trade's manual-reconciliation flag in the
// admin console (Phase 6). Calls the admin-gated `clearTradeReconciliationFlag`
// server action (which re-verifies `is_admin` server-side), toasts, and
// refreshes the server tree.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { clearTradeReconciliationFlag } from '@/lib/actions/admin';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to perform this action.',
  'not-found': 'That trade no longer exists.',
  'persistence-error': 'Something went wrong. Please try again.',
};

export interface ClearFlagButtonProps {
  tradeId: string;
}

export function ClearFlagButton({ tradeId }: ClearFlagButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await clearTradeReconciliationFlag(tradeId);
      if (result.ok) {
        toast.success('Reconciliation flag cleared.');
        router.refresh();
        return;
      }
      toast.error(ERROR_MESSAGES[result.error] ?? result.message ?? 'Action failed.');
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={handleClick}
    >
      {isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <CheckCircle2 aria-hidden />
      )}
      Clear flag
    </Button>
  );
}
