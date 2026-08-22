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

import type { Step } from '@/components/onboarding/OnboardingWizard';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

/** Same-origin absolute paths only, so `redirectTo` cannot become an open redirect. */
function safeRedirectPath(target: string | null): string | null {
  if (target && target.startsWith('/') && !target.startsWith('//')) {
    return target;
  }
  return null;
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

  // `proxy.ts` sets `redirectTo` when it bounces a member here mid-navigation. Honour it
  // on the way out, or the deep link that triggered onboarding is lost and they land on
  // the catalog instead of the contract they were opening.
  const redirectTo = Array.isArray(params.redirectTo)
    ? params.redirectTo[0]
    : params.redirectTo;

  return (
    <OnboardingWizard
      initialStep={initialStep}
      redirectTo={safeRedirectPath(redirectTo ?? null)}
    />
  );
}
