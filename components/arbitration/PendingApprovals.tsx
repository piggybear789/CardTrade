'use client';

// components/arbitration/PendingApprovals.tsx
//
// Decisions waiting for a second staff member (ESC-23), on the cases queue and on the
// case they belong to. A decision that moves the threshold or more, and every fraud
// finding, runs only once someone other than its proposer approves it.
//
// The buttons follow what the server worked out for this viewer
// (`PendingApproval.refusal`), and the actions check every rule again, so nothing here
// decides anything itself.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { approveStaffResolution, rejectStaffResolution } from '@/lib/actions/admin';
import type { PendingApproval } from '@/lib/arbitration/approvals';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatContractDateTime, formatMoney, formatRelativeTime } from '@/lib/format';

/** The open case an approval belongs to, where the list is not on that case already. */
export interface ApprovalCaseLink {
  href: string;
  title: string;
}

export function PendingApprovals({
  approvals,
  viewerId,
  caseLinks = {},
}: {
  /** Null when they could not be read. */
  approvals: readonly PendingApproval[] | null;
  viewerId: string;
  caseLinks?: Readonly<Record<string, ApprovalCaseLink>>;
}) {
  if (approvals === null) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 px-cozy py-snug text-body text-destructive"
      >
        Couldn&rsquo;t load the decisions waiting for a second approval. Refresh to try again.
      </p>
    );
  }
  if (approvals.length === 0) return null;

  return (
    <section aria-labelledby="pending-approvals-heading" className="space-y-cozy">
      <div className="space-y-tight">
        <h2 id="pending-approvals-heading" className="text-subhead font-semibold">
          Waiting for a second approval ({approvals.length})
        </h2>
        <p className="text-meta text-muted-foreground">
          Nothing has moved yet. Each runs once a staff member who did not propose it approves.
        </p>
      </div>
      <ul className="space-y-cozy">
        {approvals.map((approval) => (
          <li key={approval.id}>
            <ApprovalCard
              approval={approval}
              viewerId={viewerId}
              caseLink={caseLinks[approval.caseRef] ?? null}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusLine(approval: PendingApproval, mine: boolean): string {
  switch (approval.refusal) {
    case 'SAME_STAFFER':
      return 'Waiting for the other staff member to approve.';
    case 'COOLING_OFF': {
      const at = approval.selfApprovableAt
        ? (formatContractDateTime(approval.selfApprovableAt) ?? approval.selfApprovableAt)
        : null;
      return at
        ? `Nobody else can approve this, so you can approve it yourself from ${at}.`
        : 'Nobody else can approve this yet.';
    }
    case 'RECUSED':
      return 'You are a party to this case, so you cannot decide it.';
    default:
      return mine
        ? 'Nobody else can approve this, so you can approve it yourself.'
        : 'Read the case, then approve it to run it, or reject it.';
  }
}

function ApprovalCard({
  approval,
  viewerId,
  caseLink,
}: {
  approval: PendingApproval;
  viewerId: string;
  caseLink: ApprovalCaseLink | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const [pending, startTransition] = useTransition();
  const mine = approval.proposedById === viewerId;
  const amount = formatMoney(approval.valueMinor, approval.currency);
  const rejectLabel = mine ? 'Withdraw' : 'Reject';

  const run = (kind: 'approve' | 'reject') => {
    startTransition(async () => {
      const result =
        kind === 'approve'
          ? await approveStaffResolution(approval.id)
          : await rejectStaffResolution(approval.id);
      setConfirming(null);
      if (!result.ok) {
        toast.error(result.message ?? `Could not ${kind} that decision.`);
        return;
      }
      toast.success(
        kind === 'approve' ? 'Approved. The decision has run.' : `${mine ? 'Withdrawn' : 'Rejected'}. Nothing moved.`,
      );
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="pb-cozy">
        <div className="flex flex-wrap items-start justify-between gap-snug">
          <CardTitle className="text-lead">{approval.decision}</CardTitle>
          <span className="shrink-0 text-body font-semibold tabular-nums">{amount}</span>
        </div>
        <CardDescription>
          Proposed by {mine ? 'you' : approval.proposedByName} · {formatRelativeTime(approval.proposedAt)}
          {caseLink ? ` · ${caseLink.title}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-cozy">
        <p className="min-w-0 text-body text-muted-foreground">{statusLine(approval, mine)}</p>
        <div className="flex flex-wrap items-center gap-snug">
          {caseLink ? (
            <Button asChild variant="outline" size="sm">
              <Link href={caseLink.href} transitionTypes={['nav-forward']}>
                Open case
              </Link>
            </Button>
          ) : null}
          {approval.refusal !== 'RECUSED' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              aria-haspopup="dialog"
              onClick={() => setConfirming('reject')}
            >
              {rejectLabel}
            </Button>
          ) : null}
          {approval.refusal === null ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              aria-haspopup="dialog"
              onClick={() => setConfirming('approve')}
            >
              Approve and run
            </Button>
          ) : null}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => setConfirming(open ? confirming : null)}
        title={confirming === 'approve' ? 'Approve and run this decision?' : `${rejectLabel} this proposal?`}
        description={
          confirming === 'approve'
            ? `${approval.decision}. ${amount} at stake. It runs as soon as you approve, through the same checks as when it was proposed.`
            : 'Nothing moves. The case stays open for a new decision.'
        }
        confirmLabel={confirming === 'approve' ? 'Approve and run' : rejectLabel}
        confirmVariant={confirming === 'approve' ? 'default' : 'destructive'}
        onConfirm={() => {
          if (confirming) run(confirming);
        }}
        pending={pending}
      />
    </Card>
  );
}
