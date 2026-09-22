import type { ReactNode } from 'react';

export function PolicyArticle({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  // `px-group` on a phone, matching every other page gutter in the app. At `px-6`
  // this article measured 327px inside a 375px screen while the catalog beside it
  // measured 343px, so the legal pages read as inset from the rest.
  //
  // NO IN-PAGE BACK LINK, and it is not an omission. The wordmark in `MarketingChrome`
  // and the logo in the desktop header both point at `/` and both render for signed-in
  // and signed-out viewers, so a "Back to home" row above the title was a third control
  // to the same destination on every policy page. `(marketing)/loading.tsx` reserved
  // 60px for it and no longer does — the two have to move together, or the article
  // jumps on swap in whichever direction they disagree.
  return (
    <article className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section">
      <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">{title}</h1>
      {lede ? (
        <p className="mt-snug text-body text-muted-foreground md:mt-cozy md:text-lead">{lede}</p>
      ) : null}
      <div className="mt-section space-y-group text-body text-foreground/90 md:space-y-6 [&_h2]:scroll-mt-24 [&_h2]:text-subhead [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-snug [&_ul]:pl-5 [&_ul]:text-muted-foreground">
        {children}
      </div>
    </article>
  );
}
