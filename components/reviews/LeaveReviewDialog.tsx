'use client';

// components/reviews/LeaveReviewDialog.tsx
//
// Dialog for leaving a post-transaction review about a counterparty. Presents a
// clickable 1..5 star selector plus an optional comment, calls the leaveReview
// server action, and on success toasts + refreshes the server tree so the
// surrounding page reflects the new "Reviewed" state.
//
// Only render this when the caller is eligible (a party to a COMPLETED
// transaction who has not already reviewed it); the server action re-enforces
// eligibility regardless.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { toast } from 'sonner';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  leaveReview,
  type LeaveReviewError,
  type ReviewSourceType,
} from '@/lib/actions/reviews';

/** Human-readable copy for each leave-review error code. */
const ERROR_MESSAGES: Record<LeaveReviewError, string> = {
  'not-authenticated': 'Please sign in to leave a review.',
  'validation-error': 'Please pick a rating from 1 to 5.',
  'not-a-participant': 'You can only review your own transactions.',
  'not-completed': 'You can review once the transaction is completed.',
  'invalid-reviewee': 'This person is not part of the transaction.',
  'already-reviewed': 'You have already reviewed this transaction.',
  'persistence-error': 'Something went wrong saving your review.',
};

const COMMENT_MAX = 1000;

export interface LeaveReviewDialogProps {
  /** The counterparty being reviewed. */
  revieweeId: string;
  /** The counterparty's display name, for the dialog copy. */
  revieweeName: string;
  /** Which transaction the review is about. */
  sourceType: ReviewSourceType;
  /** The transaction id. */
  sourceId: string;
}

export function LeaveReviewDialog({
  revieweeId,
  revieweeName,
  sourceType,
  sourceId,
}: LeaveReviewDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [isPending, startTransition] = useTransition();

  const active = hover || rating;

  function handleSubmit() {
    if (rating < 1 || rating > 5) {
      toast.error('Please pick a rating from 1 to 5.');
      return;
    }
    startTransition(async () => {
      const result = await leaveReview({
        revieweeId,
        rating,
        comment: comment.trim() || undefined,
        sourceType,
        sourceId,
      });
      if (result.ok) {
        toast.success('Thanks for your review!');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(ERROR_MESSAGES[result.error] ?? 'Could not save review.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <Star aria-hidden />
          Leave a review
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review {revieweeName}</DialogTitle>
          <DialogDescription>
            Share how the transaction went. Your rating helps other traders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Rating</Label>
            <div
              className="flex items-center gap-1"
              role="radiogroup"
              aria-label="Star rating"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  onClick={() => setRating(value)}
                  onMouseEnter={() => setHover(value)}
                  onMouseLeave={() => setHover(0)}
                  className="rounded p-1.5 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Star
                    className={cn(
                      'size-7 transition-colors',
                      value <= active
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground/40',
                    )}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-comment">Comment (optional)</Label>
            <Textarea
              id="review-comment"
              value={comment}
              maxLength={COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How was your experience?"
              rows={4}
            />
            <p className="text-right text-xs text-muted-foreground">
              {comment.length}/{COMMENT_MAX}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={isPending || rating < 1}
            aria-busy={isPending}
          >
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
