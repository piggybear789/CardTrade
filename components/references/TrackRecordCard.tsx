// components/references/TrackRecordCard.tsx
//
// A person's public record on ANOTHER site (0170): today, eBay feedback, for an account
// a member signed in to or staff checked. It sits between who the person is and their
// Trust Network and shows that site's own tally. The feedback rows themselves are drawn
// and counted among the references below (`lib/references/ebayReferences.ts`), each one
// marked as eBay, so this card no longer says the two are kept apart.
//
// WHAT IT NEVER CLAIMS. "No live listings" is shown as exactly that: eBay shows a seller's
// feedback only through their listings, so a seller with none is unreadable, not unrated.
// The proof line says who vouched for the link (the member signing in, or staff), and the
// day the figure was read is always shown, because it is read live and cached for an hour.
//
// Server-renderable: no state, no effects.

import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';

import { PlatformChip } from '@/components/references/referenceLabels';
import {
  externalProofLabel,
  formatAsOf,
  formatFeedbackCount,
  formatFeedbackPercentage,
  type ExternalTrackRecord,
} from '@/domain/references/externalSeller';

function RecordFigures({ record }: { record: ExternalTrackRecord['record'] }) {
  if (record.state === 'FOUND') {
    const { feedbackPercentage, feedbackScore } = record.stats;
    return (
      <div className="sm:text-right">
        <p className="text-body font-semibold tabular-nums text-foreground">
          {feedbackPercentage !== null ? `${formatFeedbackPercentage(feedbackPercentage)} positive` : 'Feedback on eBay'}
        </p>
        <p className="text-meta tabular-nums text-muted-foreground">
          {feedbackScore !== null ? `${formatFeedbackCount(feedbackScore)} feedback · ` : ''}
          as of {formatAsOf(record.asOf)}
        </p>
      </div>
    );
  }
  return (
    <p className="text-meta text-muted-foreground sm:max-w-xs sm:text-right">
      {record.state === 'NO_LISTINGS'
        ? 'eBay shows a seller’s feedback only while they have listings, and there are none right now.'
        : 'eBay is not answering right now. Open their eBay profile to see it.'}
    </p>
  );
}

export function TrackRecordCard({
  records,
  opacity = 1,
}: {
  records: readonly ExternalTrackRecord[];
  /** The page's walk fade, so the card goes with the person it describes. */
  opacity?: number;
}) {
  if (records.length === 0) return null;
  return (
    <section
      aria-labelledby="track-record-heading"
      className="ref-surface rounded-2xl bg-card p-group sm:p-6"
      style={{ opacity }}
    >
      <h2 id="track-record-heading" className="text-subhead font-semibold tracking-tight text-foreground">
        Track record elsewhere
      </h2>
      <p className="mt-tight text-body text-muted-foreground">
        Public feedback from other sites, as each site reports it.
      </p>

      <ul className="mt-group divide-y divide-border/70">
        {records.map((entry) => (
          <li
            key={`${entry.platform}:${entry.username}`}
            className="flex flex-col gap-cozy py-cozy first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-group"
          >
            <div className="flex min-w-0 items-center gap-cozy">
              <PlatformChip slug={entry.platform} className="size-10" />
              <div className="min-w-0">
                <a
                  href={entry.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 rounded-sm text-body font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="break-all">{entry.username}</span>
                  <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">on eBay (opens in a new tab)</span>
                </a>
                <p className="text-meta text-muted-foreground">{externalProofLabel(entry.proof)}</p>
              </div>
            </div>
            <RecordFigures record={entry.record} />
          </li>
        ))}
      </ul>
    </section>
  );
}
