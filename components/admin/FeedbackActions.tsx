'use client';

// components/admin/FeedbackActions.tsx
//
// Triage controls for one feedback row in the operations console (0120).
//
// DELIBERATELY THINNER THAN `ReportActions`. That component can hide a listing, because
// a report names something a moderator can act on. Feedback names nothing — there is no
// target to hide and no account to look at — so the only moves are the two that shrink
// the backlog. Anything that actually happens as a result of this row happens in a repo,
// not here.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, LoaderCircleIcon, XIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { setFeedbackStatus, type AdminActionResult } from '@/lib/actions/admin';

/** Human-readable copy for each admin action error. */
const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to perform this action.',
  'not-found': 'That record no longer exists.',
  'persistence-error': 'Something went wrong. Please try again.',
};

function reportError(result: Extract<AdminActionResult, { ok: false }>): string {
  return ERROR_MESSAGES[result.error] ?? result.message ?? 'Action failed.';
}

export interface FeedbackActionsProps {
  feedbackId: string;
}

export function FeedbackActions({ feedbackId }: FeedbackActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(status: 'ACTIONED' | 'DISMISSED') {
    startTransition(async () => {
      const result = await setFeedbackStatus(feedbackId, status);
      if (result.ok) {
        router.refresh();
        return;
      }
      toast.error(reportError(result));
    });
  }

  return (
    <div className="flex flex-wrap gap-snug">
      <Button
        type="button"
        variant="default"
        disabled={isPending}
        onClick={() => run('ACTIONED')}
      >
        {isPending ? (
          <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
        ) : (
          <HugeiconsIcon icon={CheckIcon} aria-hidden />
        )}
        Mark handled
      </Button>

      <Button
        type="button"
        variant="ghost"
        disabled={isPending}
        onClick={() => run('DISMISSED')}
      >
        {isPending ? (
          <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
        ) : (
          <HugeiconsIcon icon={XIcon} aria-hidden />
        )}
        Dismiss
      </Button>
    </div>
  );
}
