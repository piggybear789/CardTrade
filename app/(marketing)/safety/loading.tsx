// app/(marketing)/safety/loading.tsx
//
// /safety's own placeholder, in a LEAF position. The `(marketing)` loader above it
// draws a flat prose column — right for Help, Terms and Privacy — and /safety is not
// one: under its header sit a warning card and a role tab strip. Under the parent loader
// that whole region was a heading-and-paragraph stack that got replaced by a different
// layout on arrival, which is exactly what structure.md says a parent loader must not do.
//
// Geometry is the page's, term for term: the same `<article>`, `PolicyArticle`'s header
// offsets, the `.cardtrade-warning` card, then `TabbedPanels`' strip from its own shape
// constants. Below the strip it reserves the panel's lede and a rail of stages without
// guessing at their interiors.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { TabbedPanelsSkeleton } from '@/components/ui/tabbed-panels';

export default function SafetyLoading() {
  return (
    <article
      className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      {/* Heading width is canonical texture; the type-scale class reserves its height. */}
      <TextLines className="text-subhead md:text-head" widths={['w-2/3']} />
      {/* ~95 characters, `max-w-prose`: three body lines on a phone, two lead lines
          from `md`. The LINE COUNT and the `md:` responsive gates are the reservation;
          the fraction widths draw from the canonical set. */}
      <TextLines
        className="mt-snug max-w-prose text-body md:mt-cozy md:text-lead"
        widths={['w-full', 'w-full md:w-1/2', 'w-1/3 md:hidden']}
      />

      {/* The one rule above the tabs: a `market-label`, a bold body line, then ~170
          characters of body — four lines on a phone, two from `md`. Line counts and
          `md:` gates kept; widths canonical. */}
      <div className="cardtrade-warning mt-section rounded-lg border p-group">
        <TextLines className="market-label" widths={['w-1/3']} />
        <TextLines className="mt-snug text-body" widths={['w-1/2']} />
        <TextLines
          className="mt-tight text-body"
          widths={['w-full', 'w-full', 'w-full md:w-1/2', 'w-1/3 md:hidden']}
        />
      </div>

      <div className="mt-section">
        <TabbedPanelsSkeleton labels={['Buying', 'Selling', 'Trading']} />

        {/* `RolePanel`: `space-y-section` over the panel lede (`max-w-prose`) and the
            stage rail. */}
        <div className="space-y-section">
          <TextLines
            className="max-w-prose text-body"
            widths={['w-full', 'w-full', 'w-1/2']}
          />
          {/* `StageRail`: each stage is `pb-section pl-12 sm:pl-14` beside a 36px
              numeral, then `space-y-cozy` over a `text-subhead` title, the bordered
              "Your window" row and the bullet list. Two stages — the rest are below
              the fold on every viewport. */}
          <ol>
            {[0, 1].map((index) => (
              <li key={index} className="relative pb-section pl-12 last:pb-0 sm:pl-14">
                <Skeleton className="absolute left-0 top-0 size-9 rounded-full" />
                <div className="space-y-cozy">
                  <TextLines className="text-subhead" widths={['w-1/2']} />
                  <div className="rounded-md border border-border bg-muted px-cozy py-snug">
                    <TextLines className="text-body" widths={['w-2/3']} />
                  </div>
                  <div className="space-y-snug pl-5">
                    <TextLines className="text-body" widths={['w-full', 'w-2/3']} />
                    <TextLines className="text-body" widths={['w-full', 'w-1/2']} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  );
}
