'use client';

// components/feedback/FeedbackDialog.tsx
//
// "Report a problem or suggest a feature" — the one surface for telling us something
// about NoDitto itself (0120). Kind, a message, and the route the member was on.
//
// NOT `ReportDialog`, though it is deliberately built to look like one. That dialog
// flags a LISTING or a MEMBER for moderation and always carries a target; this one has
// no target and lands in a different queue. The two are siblings in style and strangers
// in purpose — see the header of `lib/actions/feedback.ts`.
//
// ONE COMPONENT, SEVERAL TRIGGERS, because the entry points sit in chrome with three
// different visual vocabularies: a dark header icon rail, a light dropdown of ghost
// buttons, and the Account tab's settings rows. Each is a shape, not a variant of
// behaviour — the dialog below the trigger is identical in every case.

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChatFeedbackIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

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
import { submitFeedback, type SubmitFeedbackError } from '@/lib/actions/feedback';
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  type FeedbackKindValue,
} from '@/lib/marketplace-constants';
import { cn } from '@/lib/utils';

/** Placeholder prompts per kind — the question a member is actually being asked. */
const PROMPTS: Record<FeedbackKindValue, string> = {
  BUG: 'What were you doing, and what happened instead of what you expected?',
  IDEA: 'What would you like to be able to do, and what would it let you get done?',
  OTHER: 'Tell us what is on your mind.',
};

/**
 * Human copy for each typed failure.
 *
 * `validation-error` is absent on purpose: the action's own message names the offending
 * field and its bound, which is more use than anything generic that could go here.
 */
const ERROR_MESSAGES: Partial<Record<SubmitFeedbackError, string>> = {
  'not-authenticated': 'Please sign in to send feedback.',
  'rate-limited': 'That is a lot of feedback at once. Please wait a moment and try again.',
  'persistence-error': 'We could not send your feedback. Please try again.',
};

/** How the trigger should look. The dialog it opens is the same in every case. */
export type FeedbackTriggerAppearance =
  /** Round icon button for the dark desktop header rail. */
  | 'header-icon'
  /** Full-width ghost row for the burger dropdown. */
  | 'menu-row'
  /** Ordinary labelled button. */
  | 'button';

export interface FeedbackDialogProps {
  appearance?: FeedbackTriggerAppearance;
  /**
   * A trigger element to use instead of {@link appearance} — for chrome with its own row
   * vocabulary, like the Account tab's `SettingsListRow`.
   *
   * MUST be created in a CLIENT component. Radix clones handlers onto it via `asChild`,
   * and an element built in a Server Component answers `isValidElement` differently on
   * the SSR and browser passes — the hydration mismatch that
   * `components/account/SettingsDialogRows.tsx` documents at length.
   */
  trigger?: ReactNode;
  /**
   * Called when the dialog opens. The burger menu passes its own close here, so the
   * panel is not left hanging open behind the sheet — same arrangement as
   * `StartDealButton`.
   */
  onOpen?: () => void;
  /** Extra classes for the built-in triggers. */
  className?: string;
}

/**
 * A dialog for sending feedback about NoDitto: a bug, a feature idea, or neither.
 *
 * Renders nothing but a trigger until opened. Requires a signed-in member — the action
 * refuses otherwise — so every call site sits inside an authenticated branch.
 */
export function FeedbackDialog({
  appearance = 'button',
  trigger,
  onOpen,
  className,
}: FeedbackDialogProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKindValue | ''>('');
  const [message, setMessage] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // THE PATH IS FROZEN AT OPEN TIME, not read at submit time. The dialog can outlive a
  // navigation — a link in a toast, a router refresh — and "where the member was when
  // they hit the problem" is the page they were looking at when they reached for this,
  // not wherever the app happened to move to while they typed.
  const [capturedPath, setCapturedPath] = useState<string | null>(null);
  useEffect(() => {
    if (open) setCapturedPath(pathname);
  }, [open, pathname]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      onOpen?.();
      return;
    }
    // Closing discards. Nothing here is worth persisting a draft for, and a stale kind
    // left selected from last time reads as a choice the member already made.
    setKind('');
    setMessage('');
    setInlineError(null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    if (!kind) {
      setInlineError('Choose what kind of feedback this is.');
      return;
    }
    if (message.trim().length < FEEDBACK_MESSAGE_MIN) {
      setInlineError(
        `Please add a little more detail — at least ${FEEDBACK_MESSAGE_MIN} characters.`,
      );
      return;
    }

    startTransition(async () => {
      const result = await submitFeedback({ kind, message, pagePath: capturedPath });

      if (result.ok) {
        // THE ONLY ACKNOWLEDGEMENT THERE IS. Nothing else on screen changes, and the
        // member cannot see their own submission anywhere afterwards, so silence here
        // reads as a dropped form. (`ReportDialog` closes without a toast because its
        // copy already promises a moderator will review it.)
        toast.success(
          result.data.kind === 'IDEA'
            ? 'Thanks — your idea is with the team.'
            : 'Thanks — we have got it.',
        );
        handleOpenChange(false);
        return;
      }

      const msg = ERROR_MESSAGES[result.error] ?? result.message;
      setInlineError(msg);
      toast.error(msg);
    });
  }

  const remaining = FEEDBACK_MESSAGE_MAX - message.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          appearance === 'header-icon' ? (
            <button
              type="button"
              aria-label="Send feedback"
              title="Feedback"
              className={cn(
                // Matches the Saved and Messages links beside it rather than restating a
                // treatment: the rail is one row of equal targets and a near-miss here
                // shows up as a 1px bounce on hover.
                'inline-flex size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris',
                className,
              )}
            >
              <HugeiconsIcon icon={ChatFeedbackIcon} className="size-5" aria-hidden />
            </button>
          ) : appearance === 'menu-row' ? (
            // `!h-9`, like every other row in that panel: the `sm` size collapses to
            // 24px from `md` inside a media query, which a plain `h-9` cannot override.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('!h-9 w-full justify-start', className)}
            >
              <HugeiconsIcon icon={ChatFeedbackIcon} aria-hidden />
              Send feedback
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className={className}>
              <HugeiconsIcon icon={ChatFeedbackIcon} aria-hidden />
              Send feedback
            </Button>
          )
        )}
      </DialogTrigger>

      <DialogContent>
        {/* The form is DialogContent's only child, so its flex gap cannot reach header,
            body and footer. Repeating the gap here spaces them the way every other
            dialog does. */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-cozy sm:gap-group">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Tell us about a problem with NoDitto, or something you want it to do.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-group">
            <div className="space-y-snug">
              <Label htmlFor="feedback-kind">What kind of feedback?</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as FeedbackKindValue)}
              >
                <SelectTrigger id="feedback-kind">
                  <SelectValue placeholder="Choose one…" />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_KINDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-snug">
              <Label htmlFor="feedback-message">Details</Label>
              <Textarea
                id="feedback-message"
                placeholder={kind ? PROMPTS[kind] : PROMPTS.OTHER}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={FEEDBACK_MESSAGE_MAX}
                rows={5}
                className="resize-none"
                aria-describedby="feedback-message-count"
              />
              <p
                id="feedback-message-count"
                className="text-right text-meta text-muted-foreground"
              >
                {message.length}/{FEEDBACK_MESSAGE_MAX}
                {remaining < 100 ? ` · ${remaining} left` : ''}
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
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? (
                <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
              ) : null}
              {isPending ? 'Sending…' : 'Send feedback'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
