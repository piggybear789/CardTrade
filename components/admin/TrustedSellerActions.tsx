'use client';

// components/admin/TrustedSellerActions.tsx
//
// Per-row controls for one Trusted Seller review (0152): private working notes, and
// the decision buttons the review's status allows. Every call goes to an admin-gated
// action that re-checks the caller server-side.
//
// Notes save on their own button rather than with a decision, because the review is a
// long, off-platform process: notes are written over several sessions before anyone
// decides anything.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  decideTrustedSeller,
  saveTrustedSellerNotes,
  type AdminActionResult,
} from '@/lib/actions/admin';
import {
  TRUSTED_SELLER_NOTES_MAX_LENGTH,
  trustedSellerDecisionOutcome,
  type TrustedSellerDecision,
  type TrustedSellerReviewStatus,
} from '@/domain/trustedSellers/trustedSellerReview';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to perform this action.',
  'not-found': 'That application no longer exists.',
  'persistence-error': 'Something went wrong. Please try again.',
};

function errorMessage(result: Extract<AdminActionResult<unknown>, { ok: false }>): string {
  return result.message ?? ERROR_MESSAGES[result.error] ?? 'Action failed.';
}

const DECISION_LABEL: Record<TrustedSellerDecision, string> = {
  APPROVE: 'Approve',
  DECLINE: 'Decline',
  REVOKE: 'Revoke',
};

const DECISION_DONE: Record<TrustedSellerDecision, string> = {
  APPROVE: 'Approved. Their badge is live.',
  DECLINE: 'Declined.',
  REVOKE: 'Revoked. Their badge is gone.',
};

export interface TrustedSellerActionsProps {
  reviewId: string;
  status: TrustedSellerReviewStatus;
  notes: string | null;
  /** Approval needs a passed ID check; the button stays, disabled, with the reason. */
  identityVerified: boolean;
}

export function TrustedSellerActions({
  reviewId,
  status,
  notes,
  identityVerified,
}: TrustedSellerActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [draft, setDraft] = useState(notes ?? '');
  const notesId = `trusted-notes-${reviewId}`;
  const approveHintId = `trusted-approve-hint-${reviewId}`;

  const decisions = (['APPROVE', 'DECLINE', 'REVOKE'] as const).filter(
    (decision) => trustedSellerDecisionOutcome(status, decision) !== null,
  );

  function run(key: string, action: () => Promise<AdminActionResult<unknown>>, done: string) {
    setPendingAction(key);
    startTransition(async () => {
      const result = await action();
      setPendingAction(null);
      if (result.ok) {
        toast.success(done);
        router.refresh();
        return;
      }
      toast.error(errorMessage(result));
    });
  }

  return (
    <div className="space-y-cozy">
      <div className="space-y-tight">
        <Label htmlFor={notesId}>Private notes</Label>
        <Textarea
          id={notesId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={TRUSTED_SELLER_NOTES_MAX_LENGTH}
          rows={3}
          placeholder="What you checked, who you spoke to, anything that worried you."
        />
      </div>

      <div className="flex flex-wrap items-center gap-snug">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || draft.trim() === (notes ?? '').trim()}
          onClick={() => run('notes', () => saveTrustedSellerNotes(reviewId, draft), 'Notes saved.')}
        >
          <PendingLabel pending={pendingAction === 'notes'}>Save notes</PendingLabel>
        </Button>

        {decisions.map((decision) => {
          const blocked = decision === 'APPROVE' && !identityVerified;
          return (
            <Button
              key={decision}
              type="button"
              size="sm"
              variant={decision === 'APPROVE' ? 'default' : 'ghost'}
              disabled={isPending || blocked}
              aria-describedby={blocked ? approveHintId : undefined}
              onClick={() =>
                run(decision, () => decideTrustedSeller(reviewId, decision), DECISION_DONE[decision])
              }
            >
              <PendingLabel pending={pendingAction === decision}>{DECISION_LABEL[decision]}</PendingLabel>
            </Button>
          );
        })}
      </div>

      {decisions.includes('APPROVE') && !identityVerified ? (
        <p id={approveHintId} className="text-meta text-muted-foreground">
          Approval opens once they pass the ID check.
        </p>
      ) : null}
    </div>
  );
}
