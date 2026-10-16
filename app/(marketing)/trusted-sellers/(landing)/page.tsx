import type { Metadata } from 'next';
import Link from 'next/link';

import {
  loadTrustedSellerDirectory,
  type TrustedSellerDirectoryEntry,
} from '@/lib/trustedSellers/directory';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkBadge01Icon } from '@hugeicons/core-free-icons';

import { TrustedSellerDirectory } from '@/components/trustedSellers/TrustedSellerDirectory';
import { Button } from '@/components/ui/button';

// app/(marketing)/trusted-sellers/(landing)/page.tsx
//
// Trusted Sellers (0152): the directory first, the pitch to vendors second. Linked from
// the header for everyone, and from NoDitto's Instagram.
//
// A LEAF in the `(landing)` group so its loader cannot reach `/trusted-sellers/apply`,
// which is a different shape (see the loader rule in the structure steering doc).
//
// FRAMED AS AN INDEPENDENT VETTING LIST, not a storefront. The page says who has been
// vetted and how (photo ID plus a manual look at their selling history); it does not
// steer buyers onto NoDitto or promise anything about deals done elsewhere. The one
// line it must keep is that the badge is our judgement, never a guarantee.
//
// THE APPLY LINKS ARE LITERALS on purpose: the navigation-graph test cannot follow a
// constant, and `/trusted-sellers/apply` would otherwise read as an orphan route.

export const metadata: Metadata = {
  title: 'Trusted Sellers · NoDitto',
  description:
    'Card sellers the NoDitto team has reviewed by hand, and how to apply to become one.',
};

export default async function TrustedSellersPage() {
  // A failed read hides the table behind one line rather than failing the page: the
  // apply link is what a vendor from Instagram came for.
  const sellers: TrustedSellerDirectoryEntry[] | null = await loadTrustedSellerDirectory().catch(
    () => null,
  );

  return (
    <article className="mx-auto max-w-4xl px-group py-section sm:px-6 md:py-12">
      <header className="space-y-snug">
        <p className="inline-flex items-center gap-tight text-meta font-semibold uppercase tracking-wide text-iris-ink">
          <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" aria-hidden />
          Reviewed by the NoDitto team
        </p>
        {/* THE BUTTON SHARES THE TITLE'S ROW and centres on it. Beside the whole
            three-part block it either floated to the block's bottom edge or sat
            between the eyebrow and the lede, matching neither. */}
        <div className="flex flex-wrap items-center justify-between gap-cozy">
          <h1 className="text-head font-semibold tracking-tight text-foreground md:text-[2.5rem] md:leading-tight">
            Trusted Sellers
          </h1>
          {/* The apply page itself, which works for both audiences: `proxy.ts` sends a
              guest to sign-in (with a sign-up link) and back here afterwards. */}
          <Button asChild className="shrink-0">
            <Link href="/trusted-sellers/apply">Apply to join</Link>
          </Button>
        </div>
        <p className="max-w-xl text-pretty text-body text-muted-foreground md:text-lead">
          Card sellers we&rsquo;ve vetted through a series of manual checks. Please be aware that
          this is not a guarantee of safety and you should always be careful when transacting.
        </p>
      </header>

      <div className="mt-section">
        {sellers ? (
          <TrustedSellerDirectory sellers={sellers} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-section text-center text-body text-muted-foreground">
            The list isn&rsquo;t available right now. Try again in a moment.
          </p>
        )}
      </div>

      {/* THE VENDOR PITCH, as one band rather than a second page under the first. */}
      <section
        aria-labelledby="apply-heading"
        className="mt-region flex flex-col gap-group rounded-xl border border-border bg-muted/40 p-group sm:flex-row sm:items-center sm:justify-between md:p-section"
      >
        <div className="min-w-0 space-y-tight">
          <h2 id="apply-heading" className="text-lead font-semibold text-foreground">
            Selling cards already?
          </h2>
          <p className="max-w-xl text-pretty text-body text-muted-foreground">
            Verify your ID and tell us where you sell. If everything checks out, we&rsquo;ll add
            you to this list.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-tight sm:items-end">
          <Button asChild variant="outline">
            <Link href="/sign-up?redirectTo=%2Ftrusted-sellers%2Fapply">Create an account to apply</Link>
          </Button>
          <Link
            href="/trusted-sellers/apply"
            className="inline-flex min-h-9 items-center text-body font-medium text-iris-ink underline-offset-4 hover:underline"
          >
            Already a member? Apply here
          </Link>
        </div>
      </section>
    </article>
  );
}
