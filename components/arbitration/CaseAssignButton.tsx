'use client';

// components/arbitration/CaseAssignButton.tsx
//
// Take or release an arbitration case.
//
// WHY ASSIGNMENT EXISTS AT ALL. Two support workers deciding the same dispute is not a
// harmless duplication: each outcome moves money, and the second one lands on a record
// the first has already resolved. Taking a case is the cheap coordination signal that
// stops that — it does not lock anything, and it is not permission, it is presence.
//
// It is deliberately NOT enforced as ownership. Anyone on staff can take a case someone
// else holds, because a worker who goes home mid-case must not be able to strand the
// queue behind their own name. The button says whose it is so that reassigning is a
// visible act rather than an accident.

import { useTransition } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon, UserCheck01Icon, UserPlusIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { assignArbitrationCase } from '@/lib/actions/arbitration';
import type { ArbitrationCaseKind } from '@/domain/arbitration/arbitrationCase';
import { Button } from '@/components/ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to assign cases.',
  'persistence-error': 'The assignment could not be saved.',
};

export interface CaseAssignButtonProps {
  caseKind: ArbitrationCaseKind;
  caseRef: string;
  /** Who currently holds the case, or null when nobody does. */
  assigneeId: string | null;
  /** Display name of the holder, when it is somebody other than the viewer. */
  assigneeName?: string | null;
  viewerId: string;
}

/** Take, release, or reassign one case. */
export function CaseAssignButton({
  caseKind,
  caseRef,
  assigneeId,
  assigneeName,
  viewerId,
}: CaseAssignButtonProps) {
  const [isPending, startTransition] = useTransition();

  const mine = assigneeId === viewerId;
  const heldByOther = assigneeId !== null && !mine;

  function apply(next: string | null) {
    startTransition(async () => {
      const result = await assignArbitrationCase(caseKind, caseRef, next);
      if (result.ok) {
        
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Could not update the case.');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-snug">
      {heldByOther ? (
        <span className="text-body text-muted-foreground">
          Held by {assigneeName?.trim() || 'another arbitrator'}
        </span>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant={mine ? 'outline' : 'default'}
        disabled={isPending}
        onClick={() => apply(mine ? null : viewerId)}
      >
        {isPending ? (
          <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
        ) : mine ? (
          <HugeiconsIcon icon={UserCheck01Icon} aria-hidden />
        ) : (
          <HugeiconsIcon icon={UserPlusIcon} aria-hidden />
        )}
        {mine ? 'Release' : heldByOther ? 'Take over' : 'Take case'}
      </Button>
    </div>
  );
}
