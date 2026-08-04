// components/reviews/ReviewList.tsx
//
// Presentational list of post-transaction reviews shown on a seller's public
// profile. Each row shows the reviewer's display name, that review's star
// rating, an optional comment, and a relative timestamp. Server-rendered.

import { MessageSquare } from 'lucide-react';

import { StarRating } from '@/components/listings/StarRating';
import { EmptyState } from '@/components/ui/empty-state';
import { formatAud, formatRelativeTime } from '@/lib/format';
import type { ReviewWithReviewer } from '@/lib/actions/reviews';

/** Verb phrase for each transaction kind, from the reviewee's perspective. */
const TRANSACTION_KIND_LABEL: Record<ReviewWithReviewer['transactionKind'], string> = {
  bought: 'Bought item from',
  sold: 'Sold item to',
  traded: 'Traded item with',
};

export function ReviewList({
  reviews,
  revieweeName,
}: {
  reviews: ReviewWithReviewer[];
  /** Display name of the profile owner the reviews are about (subtext target). */
  revieweeName: string;
}) {
  if (reviews.length === 0) {
    // Was a bare line of muted text, which reads as a dead end and does not say
    // whether reviews are unsupported or merely absent. `titleAs="h4"` because a
    // seller profile nests h1 (shell) → h2 (section) → h3 (page section) before
    // reaching this state.
    return (
      <EmptyState
        icon={<MessageSquare className="size-6" aria-hidden />}
        title="No Reviews Yet"
        description={`Reviews appear here once ${revieweeName} completes a sale, purchase, or trade.`}
        titleAs="h4"
        compact
      />
    );
  }

  return (
    // `bg-card`, not `bg-white`: the palette's surface is a warm off-white
    // (`40 30% 99%`), so pure white read colder than every card around it.
    <ul className="divide-y rounded-lg border bg-card">
      {reviews.map((review) => (
        <li key={review.id} className="space-y-1.5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="break-words text-sm font-medium">
                {review.reviewerName ?? 'Anonymous'}
              </span>
              <p className="break-words text-xs text-muted-foreground">
                {TRANSACTION_KIND_LABEL[review.transactionKind]} {revieweeName}
                {review.valueCents != null ? ` · ${formatAud(review.valueCents)}` : ''}
              </p>
            </div>
            <StarRating rating={review.rating} hideLabel />
          </div>
          {review.comment ? (
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
              {review.comment}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {formatRelativeTime(review.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
