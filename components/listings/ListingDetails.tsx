// components/listings/ListingDetails.tsx
//
// The listing's facts as a list: what it is, what state it is in, and where it is.
//
// A graded slab showed only a "Graded" pill; the grader and grade were in the title if
// the seller typed them, and the cert number only in the photo. Each fact now has a row,
// and a PSA cert links to PSA's own registry so a buyer can check the slab without
// retyping a number off a photo. Rows without a value are left out.

import { HugeiconsIcon } from '@hugeicons/react';
import { LinkSquare02Icon } from '@hugeicons/core-free-icons';

import { certVerifyUrl } from '@/lib/catalog/graders';
import { formatShortDate } from '@/lib/format';

export function ListingDetails({
  condition,
  grader,
  grade,
  certNumber,
  game,
  createdAt,
  locationLabel,
  className,
}: {
  condition: string;
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
  game: string | null;
  createdAt: string | null;
  locationLabel: string | null;
  className?: string;
}) {
  const verifyUrl = certVerifyUrl(grader, certNumber);
  const rows: { label: string; value: React.ReactNode }[] = [];

  if (grader || grade) rows.push({ label: 'Grade', value: [grader, grade].filter(Boolean).join(' ') });
  if (certNumber) {
    rows.push({
      label: 'Cert number',
      value: verifyUrl ? (
        <span className="inline-flex flex-wrap items-baseline gap-x-snug">
          <span className="tabular-nums">{certNumber}</span>
          <a
            href={verifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-meta font-medium text-iris-ink underline-offset-4 hover:underline"
          >
            Verify on {grader}
            <HugeiconsIcon icon={LinkSquare02Icon} className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </span>
      ) : (
        <span className="tabular-nums">{certNumber}</span>
      ),
    });
  }
  rows.push({ label: 'Condition', value: condition });
  if (game) rows.push({ label: 'Game', value: game });
  const listed = formatShortDate(createdAt);
  if (listed) rows.push({ label: 'Listed', value: listed });
  if (locationLabel) rows.push({ label: 'Location', value: locationLabel });

  return (
    <section aria-labelledby="details-heading" className={className}>
      <h2
        id="details-heading"
        className="mb-tight text-meta font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Details
      </h2>
      <dl className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-group px-cozy py-snug">
            <dt className="shrink-0 text-body text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-right text-body text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
