'use client';

// components/admin/ScamReportActions.tsx
//
// Per-report and per-match controls for the Scam reports tab (scam-reports spec,
// Req 5–9). Every button calls an admin-gated action that re-checks the caller, the
// recusal rule and, for a ban, the whole guard; nothing here decides anything itself.
//
// A BAN IS TWO PEOPLE. "Propose ban" records a proposal and the action answers
// `approval-required`, which is the expected outcome, so it reads as a success toast.
// "Approve ban" appears only once a proposal exists.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  approveScamFraudBan,
  confirmScamReportMatch,
  deleteScamReport,
  dismissScamReport,
  dismissScamReportMatch,
  notifyScamReportMatch,
  proposeScamFraudBan,
  reviewScamReport,
  saveScamReportNotes,
  setExposureLimitOverride,
  setMemberPayoutHold,
  type AdminActionResult,
} from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to perform this action.',
  'not-found': 'That report or match no longer exists.',
  'persistence-error': 'Something went wrong. Please try again.',
};

const NOTES_MAX = 4000;

function errorMessage(result: Extract<AdminActionResult<unknown>, { ok: false }>): string {
  return result.message ?? ERROR_MESSAGES[result.error] ?? 'Action failed.';
}

/** Shared runner: one pending key, toast on the outcome, refresh on success. */
function useAdminRunner() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function run(
    key: string,
    action: () => Promise<AdminActionResult<unknown>>,
    done: string,
    after?: () => void,
  ) {
    setPendingKey(key);
    startTransition(async () => {
      const result = await action();
      setPendingKey(null);
      // A proposal saved for a second admin is the intended outcome of "Propose".
      if (result.ok || result.error === 'approval-required') {
        toast.success(result.ok ? done : (result.message ?? done));
        after?.();
        router.refresh();
        return;
      }
      toast.error(errorMessage(result));
    });
  }

  return { run, isPending, pendingKey };
}

export interface ScamReportActionsProps {
  reportId: string;
  status: 'SUBMITTED' | 'REVIEWED' | 'CORROBORATED' | 'DISMISSED' | 'WITHDRAWN';
  notes: string | null;
}

export function ScamReportActions({ reportId, status, notes }: ScamReportActionsProps) {
  const { run, isPending, pendingKey } = useAdminRunner();
  const [draft, setDraft] = useState(notes ?? '');
  const [dismissOpen, setDismissOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const notesId = `scam-notes-${reportId}`;
  const reasonId = `scam-dismiss-${reportId}`;
  const open = status !== 'DISMISSED' && status !== 'WITHDRAWN';

  return (
    <div className="space-y-cozy">
      <div className="space-y-tight">
        <Label htmlFor={notesId}>Private notes</Label>
        <Textarea
          id={notesId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={NOTES_MAX}
          rows={3}
          placeholder="What you checked, what worried you, who you asked."
        />
      </div>

      <div className="flex flex-wrap items-center gap-snug">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || draft.trim() === (notes ?? '').trim()}
          onClick={() => run('notes', () => saveScamReportNotes(reportId, draft), 'Notes saved.')}
        >
          <PendingLabel pending={pendingKey === 'notes'}>Save notes</PendingLabel>
        </Button>
        {open && status === 'SUBMITTED' ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => run('reviewed', () => reviewScamReport(reportId, 'REVIEWED'), 'Marked reviewed.')}
          >
            <PendingLabel pending={pendingKey === 'reviewed'}>Mark reviewed</PendingLabel>
          </Button>
        ) : null}
        {open && status !== 'CORROBORATED' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run('corroborated', () => reviewScamReport(reportId, 'CORROBORATED'), 'Marked corroborated.')
            }
          >
            <PendingLabel pending={pendingKey === 'corroborated'}>Mark corroborated</PendingLabel>
          </Button>
        ) : null}
        {open ? (
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setDismissOpen(true)}>
            Dismiss
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title="Dismiss this report?"
        description="It stops matching straight away and is deleted after 90 days. Anyone we told about it is told it's closed."
        confirmLabel="Dismiss report"
        cancelLabel="Keep it"
        pending={pendingKey === 'dismiss'}
        confirmDisabled={!reason.trim()}
        onConfirm={() =>
          run('dismiss', () => dismissScamReport(reportId, reason), 'Report dismissed.', () => {
            setDismissOpen(false);
            setReason('');
          })
        }
      >
        <div className="space-y-tight">
          <Label htmlFor={reasonId}>Why (staff only)</Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Not enough evidence, a dispute rather than a scam, a false report…"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this report now?"
        description="The report, its fingerprints, its matches and every screenshot are deleted for good. Use this for a correction request from the person it's about."
        confirmLabel="Delete report"
        confirmVariant="destructive"
        cancelLabel="Keep it"
        pending={pendingKey === 'delete'}
        onConfirm={() =>
          run('delete', () => deleteScamReport(reportId), 'Report deleted.', () => setDeleteOpen(false))
        }
      />
    </div>
  );
}

export interface ScamMatchActionsProps {
  reportId: string;
  profileId: string;
  displayName: string;
  status: 'OPEN' | 'CONFIRMED';
  notified: boolean;
  fraudBanned: boolean;
  banProposed: boolean;
  /** Why a ban cannot be proposed yet, from `canFraudBan`. Null when it can. */
  banBlockedReason: string | null;
  /** Whether staff have set their open-sales limit to 0. */
  sellingPaused: boolean;
}

export function ScamMatchActions({
  reportId,
  profileId,
  displayName,
  status,
  notified,
  fraudBanned,
  banProposed,
  banBlockedReason,
  sellingPaused,
}: ScamMatchActionsProps) {
  const { run, isPending, pendingKey } = useAdminRunner();
  const [notThemOpen, setNotThemOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const hintId = `scam-ban-hint-${reportId}-${profileId}`;

  if (fraudBanned) {
    return <p className="text-meta text-muted-foreground">This account is suspended for fraud.</p>;
  }

  return (
    <div className="space-y-tight">
      <div className="flex flex-wrap items-center gap-snug">
        {!notified ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run('notify', () => notifyScamReportMatch(reportId, profileId), `${displayName} has been told and has 14 days to respond.`)
            }
          >
            <PendingLabel pending={pendingKey === 'notify'}>Tell them</PendingLabel>
          </Button>
        ) : null}
        {status === 'OPEN' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run('confirm', () => confirmScamReportMatch(reportId, profileId), 'Match confirmed.')}
          >
            <PendingLabel pending={pendingKey === 'confirm'}>It&rsquo;s them</PendingLabel>
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setNotThemOpen(true)}>
          Not them
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            run('hold', () => setMemberPayoutHold(profileId, true), 'Their unreleased payouts are on hold.')
          }
        >
          <PendingLabel pending={pendingKey === 'hold'}>Hold payouts</PendingLabel>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => run('release', () => setMemberPayoutHold(profileId, false), 'Payout hold lifted.')}
        >
          <PendingLabel pending={pendingKey === 'release'}>Lift hold</PendingLabel>
        </Button>
        {/* The existing open-sales override (ESC-03): 0 stops new sales, clearing it
            returns them to the default policy. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            sellingPaused
              ? run('limit', () => setExposureLimitOverride(profileId, null), 'Open-sales limit back to normal.')
              : run('limit', () => setExposureLimitOverride(profileId, 0), 'Selling paused. They can’t open new sales.')
          }
        >
          <PendingLabel pending={pendingKey === 'limit'}>{sellingPaused ? 'Resume selling' : 'Pause selling'}</PendingLabel>
        </Button>
        {banProposed ? (
          <Button type="button" size="sm" variant="destructive" disabled={isPending} onClick={() => setBanOpen(true)}>
            Approve ban
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending || Boolean(banBlockedReason)}
            aria-describedby={banBlockedReason ? hintId : undefined}
            onClick={() =>
              run('propose', () => proposeScamFraudBan(reportId, profileId), 'Ban proposed. A second admin needs to approve it.')
            }
          >
            <PendingLabel pending={pendingKey === 'propose'}>Propose ban</PendingLabel>
          </Button>
        )}
      </div>
      {!banProposed && banBlockedReason ? (
        <p id={hintId} className="text-meta text-muted-foreground">
          Ban not available yet: {banBlockedReason}
        </p>
      ) : null}

      <ConfirmDialog
        open={notThemOpen}
        onOpenChange={setNotThemOpen}
        title={`Clear ${displayName} from this report?`}
        description="The match is deleted, not kept. If we'd told them about it, they're told it wasn't about them."
        confirmLabel="Clear match"
        cancelLabel="Keep it"
        pending={pendingKey === 'not-them'}
        onConfirm={() =>
          run('not-them', () => dismissScamReportMatch(reportId, profileId), 'Match cleared.', () =>
            setNotThemOpen(false),
          )
        }
      />

      <ConfirmDialog
        open={banOpen}
        onOpenChange={setBanOpen}
        title={`Ban ${displayName} for fraud?`}
        description="This is permanent. Their listings come down, they can't sign in, and their verified identity is blocked from coming back."
        confirmLabel="Approve ban"
        confirmVariant="destructive"
        cancelLabel="Not yet"
        pending={pendingKey === 'ban'}
        onConfirm={() =>
          run('ban', () => approveScamFraudBan(reportId, profileId), `${displayName} is banned.`, () => setBanOpen(false))
        }
      />
    </div>
  );
}
