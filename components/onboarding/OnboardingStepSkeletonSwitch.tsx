'use client';

// components/onboarding/OnboardingStepSkeletonSwitch.tsx
//
// Picks the onboarding loader's step from the query string.
//
// `app/onboarding/page.tsx` opens the wizard on the SELLER step whenever a provider
// return marker (`?identity=` or `?payouts=`) is present, and on the welcome step
// otherwise. A route `loading.tsx` receives no `searchParams`, so the loader always drew
// welcome — and every return from Stripe painted three welcome promises and a "Get
// started" button before snapping to the verification spine. The router has committed
// the destination URL by the time it paints a loading boundary, so this reads it with
// the same test the page uses.

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

export function OnboardingStepSkeletonSwitch({
  welcome,
  seller,
}: {
  welcome: ReactNode;
  seller: ReactNode;
}) {
  const params = useSearchParams();
  const returningFromProvider = params.has('payouts') || params.has('identity');
  return <>{returningFromProvider ? seller : welcome}</>;
}
