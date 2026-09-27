'use client';

// components/admin/ErrorGroupActions.tsx
//
// The one control on an error group in the operations console (0123): mark it
// resolved. There is no "dismiss" and no "reopen", deliberately — a group reopens by
// itself when the error happens again, so the only decision an operator makes is "this
// is fixed", and the error log checks that claim for them.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { resolveErrorGroup } from '@/lib/actions/admin';

/** Human-readable copy for each admin action error. */
const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to perform this action.',
  'not-found': 'That error group no longer exists.',
  'persistence-error': 'Something went wrong. Please try again.',
};

export function ErrorGroupActions({ fingerprint }: { fingerprint: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function resolve() {
    startTransition(async () => {
      const result = await resolveErrorGroup(fingerprint);
      if (result.ok) {
        toast.success(
          result.data.resolved === 1
            ? 'Marked 1 occurrence resolved.'
            : `Marked ${result.data.resolved} occurrences resolved.`,
        );
        router.refresh();
        return;
      }
      toast.error(ERROR_MESSAGES[result.error] ?? result.message ?? 'Action failed.');
    });
  }

  return (
    <Button type="button" size="sm" disabled={isPending} onClick={resolve}>
      {isPending ? (
        <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
      ) : (
        <HugeiconsIcon icon={CheckIcon} aria-hidden />
      )}
      Mark resolved
    </Button>
  );
}
