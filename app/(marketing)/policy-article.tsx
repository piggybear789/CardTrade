import type { ReactNode } from 'react';

export function PolicyArticle({
  title,
  lede,
  meta,
  notice,
  children,
}: {
  title: string;
  lede?: string;
  /** e.g. "Effective 21 October 2026". */
  meta?: string;
  /** A short boxed notice under the lede, e.g. that counsel has not yet reviewed it. */
  notice?: string;
  children: ReactNode;
}) {
  // `px-group` on a phone, matching every other page gutter in the app. At `px-6`
  // this article measured 327px inside a 375px screen while the catalog beside it
  // measured 343px, so the legal pages read as inset from the rest.
  //
  // NO IN-PAGE BACK LINK, and it is not an omission. The wordmark in `MarketingChrome`
  // and the logo in the desktop header both point at `/` and both render for signed-in
  // and signed-out viewers, so a "Back to home" row above the title was a third control
  // to the same destination on every policy page. `policy-article-skeleton.tsx` reserved
  // 60px for it and no longer does — the two have to move together, or the article
  // jumps on swap in whichever direction they disagree.
  return (
    <article className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section">
      <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">{title}</h1>
      {lede ? (
        <p className="mt-snug text-body text-muted-foreground md:mt-cozy md:text-lead">{lede}</p>
      ) : null}
      {meta ? <p className="mt-snug text-meta text-muted-foreground">{meta}</p> : null}
      {notice ? (
        <p className="mt-cozy rounded-md border bg-muted p-cozy text-meta text-muted-foreground">{notice}</p>
      ) : null}
      <div className="mt-section space-y-group text-body text-foreground/90 md:space-y-6 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:scroll-mt-24 [&_h2]:text-subhead [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:font-semibold [&_h3]:text-foreground [&_ol]:list-decimal [&_ol]:space-y-snug [&_ol]:pl-5 [&_ol]:text-muted-foreground [&_p]:text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-snug [&_ul]:pl-5 [&_ul]:text-muted-foreground">
        {children}
      </div>
    </article>
  );
}
