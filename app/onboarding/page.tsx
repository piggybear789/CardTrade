// app/onboarding/page.tsx
//
// The route is a thin SERVER component whose only job is to decide which step the
// wizard opens on, because that decision depends on the query string and the query
// string is only knowable before render.
//
// WHY THIS EXISTS AT ALL. The payout leg of seller onboarding finishes on Stripe's own
// hosted pages and returns to `/onboarding?payouts=complete` (or `=refresh` when the
// link expired mid-flow); the hosted identity leg returns `?identity=complete`. When
// the wizard was itself the route it read those markers in a mount effect, so the
// member saw the welcome step — server-rendered HTML is on screen before any effect
// runs — and then a jump to the seller step. Resolving it here renders the right screen
// first time.
//
// A MARKER PICKS A SCREEN AND NOTHING ELSE. It is not evidence that anything completed:
// `UnifiedOnboardingSurface` re-reads the identity and payout status from the provider
// on mount and that read is what decides. Anyone can type `?payouts=complete`.

import { redirect } from 'next/navigation';

import type { Step } from '@/components/onboarding/OnboardingWizard';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { resolveProviderReturn } from '@/components/onboarding/providerReturn';
import { listSelectableRegions } from '@/lib/actions/regionOptions';
import { geoRegionFromRequest } from '@/lib/location/resolveRegion';
import { ensureProfile } from '@/lib/auth/ensureProfile';
import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';

// Profile setup destinations that onboarding itself supersedes. A member sent to
// `/onboarding` by the gate in `proxy.ts` was, more often than not, trying to reach the
// Verification or Payouts tab to do the very thing the wizard now walks them through —
// so returning them there on completion is a detour, not the task they were mid-way
// through. A buyer in particular has no use for a seller verification tab and lands on
// it confused. These fall back to the catalog; a genuine deep link (a listing they
// clicked buy on, a trade) is preserved, because that IS the task onboarding interrupted.
const SUPERSEDED_REDIRECT_PREFIXES = [
  '/profile/payouts',
  '/profile?tab=verification',
  '/profile?tab=payouts',
];

/**
 * Same-origin absolute paths only, so `redirectTo` cannot become an open redirect, and
 * never a profile setup destination onboarding has just superseded (see
 * {@link SUPERSEDED_REDIRECT_PREFIXES}). A rejected target falls back to the catalog.
 */
function safeRedirectPath(target: string | null): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//')) {
    return null;
  }
  if (SUPERSEDED_REDIRECT_PREFIXES.some((prefix) => target.startsWith(prefix))) {
    return null;
  }
  return target;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returningFromProvider =
    params.payouts !== undefined || params.identity !== undefined;

  const initialStep: Step = returningFromProvider ? 'seller-onboarding' : 'welcome';
  // Which step the marker names, for the surface to hold at "confirming" while it
  // asks the provider. Read the same way the profile page reads it.
  const providerReturn = resolveProviderReturn(params);

  // `proxy.ts` sets `redirectTo` when it bounces a member here mid-navigation. Honour it
  // on the way out, or the deep link that triggered onboarding is lost and they land on
  // the catalog instead of the contract they were opening.
  const redirectTo = Array.isArray(params.redirectTo)
    ? params.redirectTo[0]
    : params.redirectTo;
  const nextPath = safeRedirectPath(redirectTo ?? null);

  // Started now, awaited below: neither depends on the profile repair, so sequencing
  // them after it would be a round trip of pure latency.
  const optionsPromise = Promise.all([listSelectableRegions(), geoRegionFromRequest()]);
  // Marks it handled for the `redirect()` path below, which throws before the await;
  // the await itself still rethrows a real failure.
  optionsPromise.catch(() => undefined);

  // GUARANTEE A `profiles` ROW BEFORE THE WIZARD RENDERS. A session whose row went
  // missing after sign-up is reachable — an already-signed-in member never passes
  // through the OAuth callback again — and without the row every wizard write matched
  // zero rows and surfaced PostgREST's "Cannot coerce the result to a single JSON
  // object" with no way out. This is the one place every step is downstream of.
  //
  // It lived in `app/onboarding/layout.tsx` until this pass, and that placement cost a
  // visible beat on every navigation here: a layout sits ABOVE `loading.tsx`, so its two
  // awaits (auth, then the repair) ran before the skeleton could paint and the previous
  // page simply froze. In the page they run behind the loader.
  //
  // No redirect on a missing user: `proxy.ts` owns that decision for this route. A
  // repair failure is deliberately not fatal — the steps report their own errors in
  // member-facing language, which beats replacing the whole screen with one.
  // `completeOnboarding` keeps its own repair as defence in depth.
  const user = await getCachedAuthUser();
  if (user) {
    const metadata = (user.user_metadata ?? {}) as {
      full_name?: string;
      name?: string;
    };
    await ensureProfile(
      user.id,
      user.email ?? '',
      metadata.full_name ?? metadata.name ?? null,
    );
  }

  // Completed members who type /onboarding (or follow a stale bookmark) should
  // not restart the welcome wizard. Stripe return visits still land on the
  // seller step so hosted identity/payout can finish.
  if (!returningFromProvider) {
    const profile = await getCachedProfile();
    if (profile?.onboarding_completed_at) {
      redirect(nextPath ?? '/');
    }
  }

  // Resolved here for the same reason as the step above: the wizard used to
  // load this on mount and, until it landed, its region step rendered the
  // "no regions are open" notice at every member.
  //
  // THE GEO GUESS IS A PRE-SELECTION AND NOTHING MORE. It picks which tile the
  // region step opens on — a member in a country NoDitto is not open in lands on
  // the waitlist tile with their country already chosen — and it never becomes a
  // trading region (see `domain/region/regions.ts` on why an IP must not). Null
  // off-Vercel and in local development, where the step opens as it always has.
  const [regions, guessedRegion] = await optionsPromise;

  return (
    <OnboardingWizard
      initialStep={initialStep}
      redirectTo={nextPath}
      regions={regions}
      guessedRegion={guessedRegion}
      providerReturn={providerReturn}
    />
  );
}
