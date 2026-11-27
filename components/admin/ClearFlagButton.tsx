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
import { Icon } from '@/components/ui/icon';
import { CheckCircleIcon, CircleNotchIcon } from '@/components/ui/icons';

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
        
        router.refresh();
        return;
      }
      toast.error(ERROR_MESSAGES[result.error] ?? result.message ?? 'Action failed.');
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={isPending}
      onClick={handleClick}
      aria-busy={isPending}
    >
      {isPending ? (
        <Icon icon={CircleNotchIcon} className="animate-spin" aria-hidden />
      ) : (
        <Icon icon={CheckCircleIcon} aria-hidden />
      )}
      Clear flag
    </Button>
  );
}
