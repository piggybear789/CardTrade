import type { Metadata } from 'next';

import { ReferenceSearch } from '@/components/references/ReferenceSearch';

// app/(marketing)/references/page.tsx
//
// References (0155): literally a search bar. A buyer mid-deal on Instagram or
// Facebook searches the handle they are chatting with, picks from autofill,
// and lands on that person's reference graph. A miss offers Add-a-person.
// Replaces the Trusted Sellers directory landing; the Trusted Seller
// programme itself (apply, badge) still lives at /trusted-sellers/apply.

export const metadata: Metadata = {
  title: 'References · NoDitto',
  description:
    'Search a handle and see references from ID-verified traders, for deals done anywhere.',
};

export default function ReferencesPage() {
  return (
    <article className="mx-auto max-w-4xl px-group py-section sm:px-6 md:py-12">
      <header className="mx-auto max-w-2xl space-y-snug text-center">
        <h1 className="text-head font-semibold tracking-tight text-foreground md:text-[2.5rem] md:leading-tight">
          Search the handle
        </h1>
        <p className="text-pretty text-body text-muted-foreground md:text-lead">
          Find references for the person you are dealing with. Every experience comes from
          someone who passed an ID check.
        </p>
      </header>

      <div className="mt-section">
        <ReferenceSearch />
      </div>
    </article>
  );
}
