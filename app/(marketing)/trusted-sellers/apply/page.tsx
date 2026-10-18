import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkBadge01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { getIdentityCheckState } from '@/lib/actions/identity';
import { viewerTradingRegion } from '@/lib/location/resolveRegion';
import { isTradingRegion } from '@/domain/region';
import { signTrustedSellerPhotoUrls } from '@/lib/storage/trustedSellerPhotos';
import { formatShortDate } from '@/lib/format';
import { TrustedSellerApplicationForm } from '@/components/trustedSellers/TrustedSellerApplicationForm';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// app/(marketing)/trusted-sellers/apply/page.tsx
//
// The signed-in half of Trusted Seller (0152, 0153): the application form when there
// is none (or `?edit=1` on a pending one), and a status tracker once it is sent.
// Protected by `proxy.ts`, which also sends a member who has not finished onboarding
// through the wizard first, carrying this path as `redirectTo`.
//
// THE TRACKER is three real stages in order (sent, ID check, review), so the numbered
// and ticked markers say something true. The ID check is its own stage because staff
// cannot approve until it passes, and it is the one thing the applicant can act on.
//
// The applicant's own answer and photos are read back with the service role, keyed by
// their own id, because the 0153 columns carry no member grant. Staff notes, the
// reviewer and any reason are never read here, and a decline is worded neutrally.

export const metadata: Metadata = {
  title: 'Apply to be a Trusted Seller · NoDitto',
};

type Stage = { title: string; detail: string; state: 'done' | 'current' | 'todo' | 'failed' };

function Tracker({ stages }: { stages: Stage[] }) {
  return (
    <ol className="grid gap-group sm:grid-cols-3 sm:gap-cozy">
      {stages.map((stage, index) => (
        <li key={stage.title} className="flex gap-snug sm:flex-col">
          <div className="flex items-center gap-snug sm:w-full">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border text-meta font-semibold',
                stage.state === 'done' && 'border-trust bg-trust text-white',
                stage.state === 'current' && 'border-iris bg-iris/10 text-iris-ink',
                stage.state === 'todo' && 'border-border text-muted-foreground',
                stage.state === 'failed' && 'border-border bg-muted text-muted-foreground',
              )}
              aria-hidden
            >
              {stage.state === 'done' ? <HugeiconsIcon icon={Tick02Icon} className="size-4" /> : index + 1}
            </span>
            {index < stages.length - 1 ? (
              <span
                className={cn(
                  'hidden h-px flex-1 sm:block',
                  stage.state === 'done' ? 'bg-trust' : 'bg-border',
                )}
                aria-hidden
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-body font-semibold text-foreground">
              {stage.title}
              <span className="sr-only">
                {stage.state === 'done' ? ', done' : stage.state === 'current' ? ', in progress' : ''}
              </span>
            </p>
            <p className="text-pretty text-body text-muted-foreground">{stage.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function TrustedSellerApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const user = await getCachedAuthUser();
  if (!user) redirect('/sign-in?redirectTo=%2Ftrusted-sellers%2Fapply');
  const params = await searchParams;

  const admin = createAdminClient();
  const [{ data: review }, identity, region] = await Promise.all([
    // The applicant's own row, own answers only: no staff columns.
    admin
      .from('trusted_seller_reviews')
      .select('status, instagram_handle, requested_at, decided_at, details, photo_paths')
      .eq('profile_id', user.id)
      .maybeSingle(),
    getIdentityCheckState(),
    viewerTradingRegion(),
  ]);

  const identityVerified = identity.ok && identity.data.status === 'VERIFIED';
  const canSell = Boolean(region && isTradingRegion(region));
  const editing = review?.status === 'PENDING' && (Array.isArray(params.edit) ? params.edit[0] : params.edit) === '1';
  const showForm = canSell && (!review || editing);

  // Photos already on a pending application, signed for the edit form's previews.
  const photos = editing && review ? await signTrustedSellerPhotoUrls(admin, review.photo_paths ?? []) : [];
  // A 0152 application was a handle and nothing else; carry it into the text box.
  const initialDetails =
    review?.details ?? (review?.instagram_handle ? `Instagram: @${review.instagram_handle}` : '');
  const photoCount = review?.photo_paths?.length ?? 0;

  const stages: Stage[] = review
    ? [
        {
          title: 'Application sent',
          detail: formatShortDate(review.requested_at) ?? 'Sent',
          state: 'done',
        },
        identityVerified
          ? { title: 'ID check', detail: 'Done with Stripe', state: 'done' }
          : { title: 'ID check', detail: 'Needed before we can approve you', state: 'current' },
        review.status === 'APPROVED'
          ? { title: 'Review', detail: 'Approved', state: 'done' }
          : review.status === 'PENDING'
            ? {
                title: 'Review',
                detail: identityVerified ? 'In progress. This can take a while.' : 'Starts once your ID is checked',
                state: identityVerified ? 'current' : 'todo',
              }
            : { title: 'Review', detail: 'Not approved', state: 'failed' },
      ]
    : [];

  return (
    <article className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12">
      <header className="space-y-snug">
        <p className="inline-flex items-center gap-tight text-meta font-semibold uppercase tracking-wide text-iris-ink">
          <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" aria-hidden />
          Trusted Sellers
        </p>
        <h1 className="text-head font-semibold tracking-tight text-foreground">
          {review && !editing
            ? review.status === 'APPROVED'
              ? "You're a Trusted Seller"
              : review.status === 'PENDING'
                ? 'Thanks, we’ve got your application'
                : 'Your application wasn’t approved'
            : editing
              ? 'Edit your application'
              : 'Apply to be a Trusted Seller'}
        </h1>
        <p className="text-pretty text-body text-muted-foreground md:text-lead">
          {review && !editing
            ? review.status === 'APPROVED'
              ? "You're on the Trusted Sellers list with the badge on your profile."
              : review.status === 'PENDING'
                ? 'We check every application by hand. We’ll let you know here when we’re done.'
                : 'You can keep selling on NoDitto as normal. If you think we got it wrong, get in touch.'
            : 'Tell us about your selling and add any photos that back it up. The more you give us, the quicker we can check.'}
        </p>
      </header>

      <div className="mt-section space-y-group">
        {!canSell ? (
          <p className="rounded-xl border border-border bg-card p-group text-pretty text-body text-muted-foreground">
            Trusted Seller reviews are open in countries where NoDitto is open for selling, and
            yours isn&rsquo;t yet. We&rsquo;ll let you know when it is.
          </p>
        ) : null}

        {/* ID FIRST, when it is outstanding: it is the one stage only they can move. */}
        {canSell && !identityVerified && review?.status !== 'APPROVED' ? (
          <section
            aria-labelledby="identity-heading"
            className="flex flex-col gap-cozy rounded-xl border border-border bg-card p-group sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-tight">
              <h2 id="identity-heading" className="text-body font-semibold text-foreground">
                Verify your ID
              </h2>
              <p className="text-pretty text-body text-muted-foreground">
                Every seller checks a photo ID and a selfie with Stripe. We can&rsquo;t approve you
                until that&rsquo;s done.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/profile?tab=verification">Verify ID</Link>
            </Button>
          </section>
        ) : null}

        {review && !editing ? (
          <section aria-label="Application status" className="space-y-group rounded-xl border border-border bg-card p-group md:p-section">
            <Tracker stages={stages} />

            {initialDetails ? (
              <div className="border-t border-border pt-group">
                <p className="text-meta font-medium text-muted-foreground">What you told us</p>
                <p className="mt-tight line-clamp-4 whitespace-pre-line break-words text-body text-foreground">
                  {initialDetails}
                </p>
                {photoCount > 0 ? (
                  <p className="mt-tight text-meta text-muted-foreground">
                    {photoCount === 1 ? '1 photo attached' : `${photoCount} photos attached`}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-snug border-t border-border pt-group">
              {review.status === 'PENDING' ? (
                <Button asChild variant="outline">
                  <Link href="/trusted-sellers/apply?edit=1">Edit application</Link>
                </Button>
              ) : null}
              <Button asChild variant="ghost">
                <Link href="/references">See References</Link>
              </Button>
            </div>
          </section>
        ) : null}

        {showForm ? (
          <TrustedSellerApplicationForm
            initialDetails={editing ? initialDetails : ''}
            initialPhotos={photos}
            submitLabel={editing ? 'Save changes' : 'Send application'}
          />
        ) : null}
      </div>
    </article>
  );
}
