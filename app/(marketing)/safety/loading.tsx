// app/(marketing)/safety/loading.tsx
//
// /safety's own placeholder, in a LEAF position. The page is a header, a ruled callout
// paragraph, two prose sections and a stack of collapsed guides, in a `max-w-2xl`
// column. Geometry follows `page.tsx`.

import { TextLines } from '@/components/ui/skeleton';

const PARAGRAPH = ['w-full', 'w-full', 'w-full', 'w-2/3'];

export default function SafetyLoading() {
  return (
    <article
      className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      <TextLines className="text-subhead md:text-head" widths={['w-1/2']} />
      <TextLines className="mt-cozy text-body leading-relaxed md:text-lead" widths={['w-full', 'w-full', 'w-1/3']} />

      <div className="mt-section border-l-2 border-border pl-group">
        <TextLines className="text-body leading-relaxed" widths={PARAGRAPH} />
      </div>

      <div className="mt-region space-y-region">
        {[2, 3].map((count, section) => (
          <div key={section}>
            <TextLines className="text-subhead" widths={['w-1/3']} />
            <div className="mt-group space-y-group">
              {Array.from({ length: count }, (_, index) => (
                <TextLines key={index} className="text-body leading-relaxed" widths={PARAGRAPH} />
              ))}
            </div>
          </div>
        ))}
        <div>
          <TextLines className="text-subhead" widths={['w-1/4']} />
          <TextLines className="mt-tight text-body" widths={['w-2/3']} />
          <div className="mt-group border-t border-border">
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <div key={index} className="flex min-h-12 items-center border-b border-border">
                <TextLines className="w-full text-body" widths={['w-1/4']} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
