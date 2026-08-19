// app/onboarding/page.tsx
//
// Required after sign-up: accept the rules, then a public name. Guests
// already browse, so creating an account is the decision to transact.
// `proxy.ts` sends an unfinished session back here. There is no guest
// escape in the wizard — guests browse without an account.
//
// Australia is written silently — it is the only live trading region. Identity
// waits until they list or trade. A card waits until checkout. Payouts wait
// until money is owed.

import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { getCachedProfile } from '@/lib/supabase/cachedAuth';
import { OnboardingForm } from './OnboardingForm';

function safeRedirectPath(target: string | null): string | null {
  if (target && target.startsWith('/') && !target.startsWith('//')) {
    return target;
  }
  return null;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const [{ redirectTo }, profile] = await Promise.all([
    searchParams,
    getCachedProfile(),
  ]);

  return (
    <OnboardingForm
      initialDisplayName={profile?.display_name?.trim() ?? ''}
      tradingRegion={DEFAULT_CONFIG_REGION}
      redirectTo={safeRedirectPath(redirectTo ?? null)}
    />
  );
}
