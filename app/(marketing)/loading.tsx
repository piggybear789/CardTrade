// app/(marketing)/loading.tsx
//
// Help, Terms, and Privacy are a single prose column. Safety is NOT — it opens on a
// warning card and a role tab strip — so it has its own leaf loader beside its page.

import { Fragment } from 'react';

import { Skeleton, TextLines } from '@/components/ui/skeleton';


/**
 * Lines in each placeholder paragraph, one entry per heading.
 *
 * `PolicyArticle` puts its children in ONE FLAT `space-y-group` stack: the h2s and ps
 * are siblings, so every gap in the body is 16px below `md`. This used to draw four
 * `space-y-cozy` groups inside a `space-y-6` stack, which is 12px where the real gap is
 * 16 and 24px where it is also 16 — wrong in both directions at once.
 */
const PROSE_BLOCKS = [3, 2, 4, 3, 2] as const;

export default function MarketingLoading() {
  return (
    <article
      // `py-section md:py-12`, matching `policy-article.tsx`. A flat `py-12` put an extra
      // 16px above and below the column on every phone.
      // `px-group sm:px-6`, matching `policy-article.tsx`. A bare `px-6` drew this
      // column 16px narrower than the article on every phone, so every line of the
      // placeholder rewrapped on swap.
      className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      {/* NO "Back to home" PLACEHOLDER, because the link is gone from `PolicyArticle`.
          It used to reserve 60px here — `inline-flex min-h-11 items-center` inside a
          `p.mb-group` — and leaving it would recreate the jump it was added to fix,
          just in the other direction: the article would slide UP by that much on swap. */}

      {/* `text-subhead` (23.8px) below `md`, `md:text-head`. An `h-8` bar was 32. */}
      <TextLines className="text-subhead md:text-head" widths={['w-40']} />

      {/* `mt-snug` (8px) and `text-body` below `md`, not `mt-cozy h-5`. Terms' and
          Privacy's ledes run ~130 characters: three `text-body` lines in a phone's
          343px column, and TWO `md:text-lead` lines in the ~704px desktop one — this
          reserved one there, so both pages grew a line on swap. Help's shorter lede
          now over-reserves instead; two of the three pages are the long shape. */}
      <TextLines
        className="mt-snug text-body md:mt-cozy md:text-lead"
        widths={['w-full', 'w-full md:w-1/3', 'w-2/5 md:hidden']}
      />

      {/* `mt-section space-y-group md:space-y-6`: 32px above, then 16px between every
          heading and paragraph below `md`. */}
      <div className="mt-section space-y-group md:space-y-6">
        {/* Fragments, so the bars are direct children of the stack: `space-y-*` is
            `& > * + *`, and a wrapper would collect the gaps instead of the lines. */}
        {PROSE_BLOCKS.map((lines, index) => (
          <Fragment key={index}>
            {/* `[&_h2]:text-subhead` — 23.8px, and its own line-height beats the
                container's inherited body line-height. */}
            <TextLines className="text-subhead" widths={['w-32']} />
            {/* Body copy inherits `text-body`, so 22.4px a line. */}
            <TextLines
              className="text-body"
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
