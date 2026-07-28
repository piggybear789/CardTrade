'use client';

// components/admin/ReportActions.tsx
//
// Client action buttons for triaging a single report in the admin console
// (Phase 6). Each button calls an admin-gated server action (which re-verifies
// `is_admin` server-side), toasts the outcome, and refreshes the server tree so
// the console reflects the new state.
//
// For item reports the moderator can hide the listing; every report can be
// marked actioned or dismissed.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EyeOff, Check, X, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  hideItem,
  setReportStatus,
  type AdminActionResult,
} from '@/lib/actions/admin';
import type { ReportTargetType } from '@/lib/actions/reports';

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

export interface ReportActionsProps {
  reportId: string;
  targetType: ReportTargetType;
  /** The reported item's id — required to hide item listings. */
  targetId: string;
}

export function ReportActions({ reportId, targetType, targetId }: ReportActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<AdminActionResult>,
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(successMessage);
        router.refresh();
        return;
      }
      toast.error(reportError(result));
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {targetType === 'item' && (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => run(() => hideItem(targetId), 'Listing hidden from the catalog.')}
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <EyeOff aria-hidden />
          )}
          Hide listing
        </Button>
      )}

      <Button
        type="button"
        variant="default"
        disabled={isPending}
        onClick={() =>
          run(() => setReportStatus(reportId, 'ACTIONED'), 'Report marked as actioned.')
        }
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Check aria-hidden />
        )}
        Mark actioned
      </Button>

      <Button
        type="button"
        variant="ghost"
        disabled={isPending}
        onClick={() =>
          run(() => setReportStatus(reportId, 'DISMISSED'), 'Report dismissed.')
        }
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <X aria-hidden />
        )}
        Dismiss
      </Button>
    </div>
  );
}
