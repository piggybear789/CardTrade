// components/reviews/ReviewList.tsx
//
// Presentational list of post-transaction reviews shown on a seller's public
// profile. Each row shows the reviewer's display name, that review's star
// rating, an optional comment, and a relative timestamp. Server-rendered.

import { StarRating } from '@/components/listings/StarRating';
import { formatRelativeTime } from '@/lib/format';
import type { ReviewWithReviewer } from '@/lib/actions/reviews';

export function ReviewList({ reviews }: { reviews: ReviewWithReviewer[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No reviews yet.</p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {reviews.map((review) => (
        <li key={review.id} className="space-y-1.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {review.reviewerName ?? 'Anonymous'}
            </span>
            <StarRating rating={review.rating} hideLabel />
          </div>
          {review.comment ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
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
