'use client';

// components/trade/HandoverChangeBanner.tsx
//
// A pending meeting-change proposal on an agreed trade (ESC-04).
//
// Once terms are agreed, the meeting is what the temporary card holds will be placed
// against, so neither trader may move it alone. The proposer sees that they are
// waiting (and may withdraw); the other trader sees the old and new details side by
// side and accepts or declines. Nothing changes until they accept.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { respondTradeHandoverChange, withdrawTradeHandoverChange } from '@/lib/actions/trades';
import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import { useErrorToast } from '@/lib/hooks/useErrorToast';
import { formatContractDateTime } from '@/lib/format';

export interface HandoverChangeView {
  id: string;
  proposedBy: string;
  terms: { meeting_location: string | null; meeting_at: string | null };
  expiresAt: string;
}

export interface HandoverChangeBannerProps {
  change: HandoverChangeView;
  viewerId: string;
  otherName: string;
  current: { meetingLocation: string | null; meetingAt: string | null };
}

function when(iso: string | null): string {
  return iso ? (formatContractDateTime(iso) ?? iso) : 'No time set';
}

export function HandoverChangeBanner({ change, viewerId, otherName, current }: HandoverChangeBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useErrorToast(error);
  const mine = change.proposedBy === viewerId;

  function run(op: () => Promise<{ ok: boolean; detail?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await op();
      if (!result.ok) {
        setError(result.detail ?? 'That did not go through. Please try again.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby={`handover-change-${change.id}`}
      className="space-y-snug rounded-lg border border-border bg-muted p-cozy text-body"
    >
      <h3 id={`handover-change-${change.id}`} className="font-medium">
        {mine ? `Waiting for ${otherName} to accept the new meeting details` : `${otherName} proposed new meeting details`}
      </h3>
      <dl className="grid gap-tight sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Agreed</dt>
          <dd>{current.meetingLocation ?? 'No place set'}</dd>
          <dd>{when(current.meetingAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Proposed</dt>
          <dd>{change.terms.meeting_location ?? 'No place set'}</dd>
          <dd>{when(change.terms.meeting_at)}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        Nothing changes unless {mine ? otherName : 'you'} accept{mine ? 's' : ''}. The proposal lapses{' '}
        {when(change.expiresAt)}.
      </p>
      <div className="flex flex-wrap gap-snug">
        {mine ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => withdrawTradeHandoverChange(change.id))}
          >
            <PendingLabel pending={isPending}>Withdraw</PendingLabel>
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => run(() => respondTradeHandoverChange({ changeId: change.id, decision: 'ACCEPT' }))}
            >
              <PendingLabel pending={isPending}>Accept</PendingLabel>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => respondTradeHandoverChange({ changeId: change.id, decision: 'DECLINE' }))}
            >
              Decline
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
