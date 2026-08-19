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
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 lg:px-8">
      <h1 className="text-head font-semibold tracking-tight text-foreground">{title}</h1>
      {lede ? (
        <p className="mt-3 text-lead text-muted-foreground">{lede}</p>
      ) : null}
      <div className="mt-8 space-y-6 text-body leading-relaxed text-foreground/90 [&_h2]:scroll-mt-24 [&_h2]:text-subhead [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-muted-foreground">
        {children}
      </div>
    </article>
  );
}
