// app/onboarding/layout.tsx
//
// Guarantees the signed-in member has a `profiles` row before the wizard renders.
//
// WHY THIS EXISTS. A Profile is provisioned at the two moments a member is born:
// password sign-up (`lib/actions/auth.ts`) and the OAuth callback
// (`lib/auth/ensureProfile.ts`). Nothing repaired a session whose row went missing
// afterwards, and that state is reachable — an already-signed-in member never passes
// through the callback again. What they got instead was a locked door:
//
//   * middleware finds no `onboarding_completed_at` and sends them here;
//   * the wizard's writes match zero rows, and `.single()` reported PostgREST's
//     "Cannot coerce the result to a single JSON object" straight to the screen;
//   * with no dismiss control and no sign-out, there was nowhere else to go.
//
// A real account was bricked exactly this way, and the message a member was left
// with described JSON serialisation.
//
// WHY HERE RATHER THAN IN THE ACTIONS. Repairing inside `completeOnboarding` fixes
// only the LAST step. The wizard writes earlier than that — `setTradingRegion` runs at
// the region step — so a repair at the end still leaves the earlier steps failing
// against a row that does not exist. This layout is the one place every step is
// downstream of, so the row is guaranteed before the member touches anything.
// `completeOnboarding` keeps its own repair as well: it is the action that reported the
// original error, and defence in depth costs one `select` on a path that runs once.
//
// `ensureProfile` is idempotent and returns `created: false` for the normal case, so
// the ordinary member pays a single indexed lookup by primary key.

import type { ReactNode } from 'react';

import { ensureProfile } from '@/lib/auth/ensureProfile';
import { createClient } from '@/lib/supabase/server';

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No redirect on a missing user: `middleware.ts` owns that decision for this route,
  // and duplicating it here would create a second place to keep in step.
  if (user) {
    const metadata = (user.user_metadata ?? {}) as {
      full_name?: string;
      name?: string;
    };
    // A failure is deliberately not fatal. If provisioning cannot be completed the
    // wizard still renders, and its steps report their own errors in member-facing
    // language — which is strictly better than replacing the whole screen with one.
    await ensureProfile(
      user.id,
      user.email ?? '',
      metadata.full_name ?? metadata.name ?? null,
    );
  }

  return <>{children}</>;
}
