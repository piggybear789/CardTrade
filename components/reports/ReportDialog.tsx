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

import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import { Button, type ButtonProps } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

/** Reasons when the target is a listing. */
const ITEM_REASONS = [
  'Prohibited item',
  'Counterfeit',
  'Spam',
  'Inappropriate',
  'Other',
] as const;

/** Reasons when the target is a person — used from profiles and contract rooms. */
const USER_REASONS = [
  'Harassment',
  'Scam or fraud',
  'No-show',
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
  /** Semantic style for the trigger; defaults to the low-key ghost treatment. */
  triggerVariant?: ButtonProps['variant'];
  /**
   * `button` — labelled trigger;
   * `icon` — round chip + label below (item detail action row);
   * `icon-only` — flag only, for compact toolbars.
   */
  appearance?: 'button' | 'icon' | 'icon-only';
  /** Extra classes for the `icon-only` trigger, so chrome can size it to match
   *  the buttons beside it. */
  triggerClassName?: string;
}

/**
 * A "Report" affordance that opens a dialog to flag {@link targetId} for
 * moderator review. Calls {@link reportItem} or {@link reportUser} based on
 * {@link targetType}.
 */
export function ReportDialog({
  targetType,
  targetId,
  triggerLabel,
  triggerVariant = 'ghost',
  appearance = 'button',
  triggerClassName,
}: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const targetNoun = targetType === 'item' ? 'listing' : 'user';
  const reasons = targetType === 'item' ? ITEM_REASONS : USER_REASONS;

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
        toast.success('Thanks — your report has been submitted for review.');
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
        {appearance === 'icon' ? (
          <ListingActionIcon icon={Flag} label="Report" />
        ) : appearance === 'icon-only' ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'size-11 text-muted-foreground hover:text-foreground md:size-9',
              triggerClassName,
            )}
            aria-label={triggerLabel}
          >
            <Flag aria-hidden />
          </Button>
        ) : (
          <Button type="button" variant={triggerVariant} size="sm" className="min-h-11 w-full sm:w-auto md:min-h-8">
            <Flag aria-hidden />
            {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {/* The form is DialogContent's only child, so its flex gap cannot reach
            header, body and footer. Repeating the gap here spaces them the same
            way every other dialog does, instead of a one-off `py-4` on the body. */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
          <DialogHeader>
            <DialogTitle>Report {targetNoun}</DialogTitle>
            <DialogDescription>
              Flag this {targetNoun} for our moderators to review. Reports are
              confidential.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-group">
            <div className="space-y-snug">
              <Label htmlFor="report-reason">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="report-reason">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-snug">
              <Label htmlFor="report-details">Details (optional)</Label>
              <Textarea
                id="report-details"
                placeholder="Add any context that will help our moderators…"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={DETAILS_MAX}
                rows={3}
                className="resize-none"
              />
              <p className="text-right text-meta text-muted-foreground">
                {details.length}/{DETAILS_MAX}
              </p>
            </div>

            {inlineError ? (
              <p role="alert" className="text-body text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
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
