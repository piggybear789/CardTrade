// app/(marketing)/help/loading.tsx
//
// /help's own placeholder. The `(marketing)` loader is a FLAT prose stack — every h2
// and p a sibling at `space-y-group md:space-y-6`, which is how Terms and Privacy are
// written — but Help groups its copy into four `<section className="space-y-cozy">`
// blocks. Inside a section the gap is 12px, between sections it is the article's
// 16/24px, so the flat placeholder drew every line after the first heading a little
// lower than the page put it, compounding down the column.
//
// Same article and header geometry as `PolicyArticle`; the body mirrors Help's four
// sections, each a `text-subhead` heading over its paragraphs.

import { TextLines } from '@/components/ui/skeleton';

/** Lines per paragraph in each section, phone width (where the copy wraps most). */
const SECTIONS: readonly (readonly number[])[] = [
  [3, 4, 2],
  [4, 4, 3],
  [4, 3],
  [3, 3, 3],
];

export default function HelpLoading() {
  return (
    <article
      className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      <TextLines className="text-subhead md:text-head" widths={['w-24']} />
      {/* ~75 characters: two body lines on a phone, one lead line from `md`. */}
      <TextLines
        className="mt-snug text-body md:mt-cozy md:text-lead"
        widths={['w-full md:w-4/5', 'w-1/3 md:hidden']}
      />

      <div className="mt-section space-y-group text-body md:space-y-6">
        {SECTIONS.map((paragraphs, index) => (
          <div key={index} className="space-y-cozy">
            <TextLines className="text-subhead" widths={['w-40']} />
            {paragraphs.map((lines, pIndex) => (
              <TextLines
                key={pIndex}
                className="text-body"
                widths={[...Array.from({ length: lines - 1 }, () => 'w-full'), 'w-3/5']}
              />
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}
