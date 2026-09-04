// app/(marketing)/loading.tsx
//
// Help, Terms, and Privacy are a single prose column.

import { Fragment } from 'react';

import { Skeleton, TextLines } from '@/components/ui/skeleton';


/**
 * Lines in each placeholder paragraph, one entry per heading.
 *
 * `PolicyArticle` puts its children in ONE FLAT `space-y-group` stack: the h2s and ps
 * are siblings, so every gap in the body is 16px below `md`. This used to draw four
 * `space-y-3` groups inside a `space-y-6` stack, which is 12px where the real gap is
 * 16 and 24px where it is also 16 — wrong in both directions at once.
 */
const PROSE_BLOCKS = [3, 2, 4, 3, 2] as const;

export default function MarketingLoading() {
  return (
    <article
      // `py-8 md:py-12`, matching `policy-article.tsx`. A flat `py-12` put an extra
      // 16px above and below the column on every phone.
      className="mx-auto max-w-3xl px-6 py-8 md:py-12 lg:px-8"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      {/* "Back to home", which had no placeholder at all. The link is `inline-flex
          min-h-11 items-center` inside a `p.mb-group`, so 60px sits above the title
          and the whole article used to slide down by that much on swap. */}
      <div className="mb-group flex min-h-11 items-center text-body">
        <Skeleton className="inline-block h-[0.9em] w-28 align-middle" />
      </div>

      {/* `text-subhead` (23.8px) below `md`, `md:text-head`. An `h-8` bar was 32. */}
      <TextLines className="text-subhead md:text-head" widths={['w-40']} />

      {/* `mt-snug` (8px) and `text-body` below `md`, not `mt-3 h-5`. Terms' and
          Privacy's ledes both run past 120 characters, so they wrap here and fit on
          one `md:text-lead` line once the column is wide. */}
      <div className="mt-snug text-body md:mt-3 md:text-lead">
        <div>
          <Skeleton className="inline-block h-[0.9em] w-full align-middle" />
        </div>
        <div className="md:hidden">
          <Skeleton className="inline-block h-[0.9em] w-3/5 align-middle" />
        </div>
      </div>

      {/* `mt-section space-y-group md:space-y-6`: 32px above, then 16px between every
          heading and paragraph below `md`. */}
      <div className="mt-section space-y-group md:space-y-6">
        {/* Fragments, so the bars are direct children of the stack: `space-y-*` is
            `& > * + *`, and a wrapper would collect the gaps instead of the lines. */}
        {PROSE_BLOCKS.map((lines, index) => (
          <Fragment key={index}>
            {/* `[&_h2]:text-subhead` — 23.8px, and its own line-height beats the
                container's inherited `leading-relaxed`. */}
            <TextLines className="text-subhead" widths={['w-32']} />
            {/* Body copy inherits `text-body leading-relaxed`, so 21.1px a line. */}
            <TextLines
              className="text-body leading-relaxed"
              widths={[
                ...Array.from({ length: lines - 1 }, () => 'w-full'),
                'w-4/5',
              ]}
            />
          </Fragment>
        ))}
      </div>
    </article>
  );
}
