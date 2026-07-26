'use client';

// components/reports/ReportDialog.tsx
//
// Client entry point for flagging an item or a user for moderator review
// (Phase 6). Renders a low-key trigger button that opens a shadcn Dialog with a
// reason Select plus an optional details textarea, then calls the appropriate
// report server action. On success it toasts and closes; typed errors surface
// inline + as a toast.
//
// Visibility (authenticated non-owner / authenticated viewing someone else) is
// decided by the server component that renders this; the report actions
// re-enforce authentication and self-report guards, so this only drives the
// interaction.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Flag, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  reportItem,
  reportUser,
  type ReportActionResult,
  type ReportTargetType,
} from '@/lib/actions/reports';
import { DETAILS_MAX } from '@/lib/marketplace-constants';

/** The preset reasons offered in the Select. */
const REASONS = [
  'Prohibited item',
  'Counterfeit',
  'Spam',
  'Inappropriate',
  'Other',
] as const;

/** Human-readable copy for each typed report error. */
const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in to submit a report.',
  'validation-error': 'Please pick a reason for your report.',
  'self-report': 'You cannot report your own listing or yourself.',
  'not-found': 'This item is no longer available.',
  'persistence-error': 'Could not submit your report. Please try again.',
};

/** Resolve a user-facing message for a failed report result. */
function messageForError(result: Extract<ReportActionResult, { ok: false }>): string {
  return ERROR_MESSAGES[result.error] ?? result.message ?? 'Could not submit your report.';
}

export interface ReportDialogProps {
  /** Whether the report targets an item or a user. */
  targetType: ReportTargetType;
  /** The id of the item or user being reported. */
  targetId: string;
  /** The trigger's label (e.g. "Report listing" / "Report user"). */
  triggerLabel: string;
}

/**
 * A subtle "Report" affordance that opens a dialog to flag {@link targetId} for
 * moderator review. Calls {@link reportItem} or {@link reportUser} based on
 * {@link targetType}.
 */
export function ReportDialog({ targetType, targetId, triggerLabel }: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const targetNoun = targetType === 'item' ? 'listing' : 'user';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    if (!reason) {
      setInlineError('Please pick a reason for your report.');
      return;
    }

    startTransition(async () => {
      const result =
        targetType === 'item'
          ? await reportItem(targetId, reason, details || undefined)
          : await reportUser(targetId, reason, details || undefined);

      if (result.ok) {
        toast.success('Thanks - your report has been submitted for review.');
        setOpen(false);
        setReason('');
        setDetails('');
        return;
      }

      const msg = messageForError(result);
      setInlineError(msg);
      toast.error(msg);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Flag aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Report {targetNoun}</DialogTitle>
            <DialogDescription>
              Flag this {targetNoun} for our moderators to review. Reports are
              confidential.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="report-reason">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="report-reason">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report-details">Details (optional)</Label>
              <Textarea
                id="report-details"
                placeholder="Add any context that will help our moderators…"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={DETAILS_MAX}
                rows={3}
              />
              <p className="text-right text-xs text-muted-foreground">
                {details.length}/{DETAILS_MAX}
              </p>
            </div>

            {inlineError ? (
              <p role="alert" className="text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Submitting…' : 'Submit report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
