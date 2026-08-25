import type { ReactNode } from 'react';
import Link from 'next/link';

export function PolicyArticle({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-8 md:py-12 lg:px-8">
      <p className="mb-group">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-body font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to home
        </Link>
      </p>
      <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">{title}</h1>
      {lede ? (
        <p className="mt-snug text-body text-muted-foreground md:mt-3 md:text-lead">{lede}</p>
      ) : null}
      <div className="mt-section space-y-group text-body leading-relaxed text-foreground/90 md:space-y-6 [&_h2]:scroll-mt-24 [&_h2]:text-subhead [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-muted-foreground">
        {children}
      </div>
    </article>
  );
}
